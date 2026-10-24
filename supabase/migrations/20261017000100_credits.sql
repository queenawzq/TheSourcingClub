-- ============================================================================
-- Credits: granted by the database, invites that count, staff adjustments
-- ----------------------------------------------------------------------------
-- Sending a quote has cost 25 credits since migration 061, but nothing ever
-- granted any: the product promises 500 when a factory is verified, and the
-- seed and tests wrote that line by hand. This migration makes the database
-- write it, in the same transaction as the verification, whatever path
-- verified the company.
--
-- 1. Only staff may change a profile's verification_status. Until now a
--    member could update their own row to 'verified' (factory_profiles_write
--    lets members update the row, and the column was not protected). That
--    already skipped review; with credits attached it would also mint them.
-- 2. 500 credits when a factory becomes verified, once per company.
-- 3. Backfill: factories verified before this migration get the same 500,
--    once, quietly (no notification).
-- 4. Invites (the referrals table from migration 005): writes go through a
--    guard; an invite is linked when the invited address signs up and creates
--    a company of the same kind.
-- 5. A factory whose invited factory gets verified earns 500 credits.
--    Brand invites are recorded and linked, but earn nothing yet: the $50
--    brand discount and when it is earned are still to be decided.
-- 6. admin_adjust_credits(): staff add or remove credits, with a reason the
--    company sees, written to the ledger with who did it.
--
-- Safe with the current site live: everything is added. The one tightening
-- (verification_status) touches a column no client code writes; staff paths
-- (admin_review_decision, review_document) are security definer and pass.
-- The old site's "Invite a brand" inserts referrer_org_id, email and message,
-- which is exactly the insert still granted.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Only staff change verification_status
-- ---------------------------------------------------------------------------
-- Security definer functions run as their owner, so current_user is only a
-- client role when the statement came straight from the API.
create or replace function public.guard_verification_status()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user not in ('authenticated', 'anon') or public.is_platform_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.verification_status := 'unverified';
  elsif new.verification_status is distinct from old.verification_status then
    raise exception 'only TSC staff can change a company''s verification'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_verification_status() from public, anon, authenticated;

create trigger factory_profiles_guard_verification
  before insert or update of verification_status on public.factory_profiles
  for each row execute function public.guard_verification_status();

create trigger brand_profiles_guard_verification
  before insert or update of verification_status on public.brand_profiles
  for each row execute function public.guard_verification_status();

-- ---------------------------------------------------------------------------
-- 2 + 5. 500 on verification, and the inviter's 500
-- ---------------------------------------------------------------------------
create or replace function public.verification_credit_grant()
returns integer
language sql
immutable
as $$ select 500 $$;

create or replace function public.referral_credit_grant()
returns integer
language sql
immutable
as $$ select 500 $$;

revoke all on function public.verification_credit_grant() from public;
revoke all on function public.referral_credit_grant() from public;
grant execute on function public.verification_credit_grant() to authenticated, service_role;
grant execute on function public.referral_credit_grant() to authenticated, service_role;

create or replace function public.grant_verification_credits()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  granted  integer;
  invite   public.referrals;
  invited  text;
begin
  -- Once per company: any earlier onboarding line counts (the seed and old
  -- fixtures wrote theirs without a ref), and the unique index on
  -- (org_id, reason, ref_id) settles a race.
  if not exists (
    select 1 from public.credit_ledger
     where org_id = new.org_id and reason = 'onboarding_grant'
  ) then
    insert into public.credit_ledger (org_id, delta, reason, ref_type, ref_id, note)
    values (new.org_id, public.verification_credit_grant(), 'onboarding_grant', 'org', new.org_id, 'Profile verified')
    on conflict (org_id, reason, ref_id) where ref_id is not null do nothing;
    get diagnostics granted = row_count;

    if granted > 0 then
      insert into public.notifications (org_id, kind, subject_type, subject_id, title, body)
      values (new.org_id, 'credits_granted', 'credits', new.org_id,
              format('You have %s credits', public.verification_credit_grant()),
              'Your profile is verified. Each quote you send uses 25 credits.');
    end if;
  end if;

  -- The factory that invited this one, if any, and only factory to factory.
  select r.* into invite
    from public.referrals r
    join public.orgs referrer on referrer.id = r.referrer_org_id
   where r.referred_org_id = new.org_id
     and r.rewarded_at is null
     and referrer.type = 'factory'
   for update of r;

  if found and not exists (
    -- The same people on both sides is not an introduction.
    select 1
      from public.org_members a
      join public.org_members b on b.user_id = a.user_id
     where a.org_id = invite.referrer_org_id and b.org_id = new.org_id
  ) then
    select name into invited from public.orgs where id = new.org_id;

    insert into public.credit_ledger (org_id, delta, reason, ref_type, ref_id, note)
    values (invite.referrer_org_id, public.referral_credit_grant(), 'referral_grant', 'referral', new.org_id,
            format('%s was verified', invited))
    on conflict (org_id, reason, ref_id) where ref_id is not null do nothing;
    get diagnostics granted = row_count;

    update public.referrals set rewarded_at = now() where id = invite.id;

    if granted > 0 then
      insert into public.notifications (org_id, kind, subject_type, subject_id, title, body)
      values (invite.referrer_org_id, 'referral_rewarded', 'credits', invite.referrer_org_id,
              format('You earned %s credits', public.referral_credit_grant()),
              format('%s, the factory you invited, is now verified.', invited));
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.grant_verification_credits() from public, anon, authenticated;

create trigger factory_profiles_grant_verification_credits
  after update of verification_status on public.factory_profiles
  for each row
  when (new.verification_status = 'verified' and old.verification_status is distinct from 'verified')
  execute function public.grant_verification_credits();

-- ---------------------------------------------------------------------------
-- 3. Backfill
-- ---------------------------------------------------------------------------
insert into public.credit_ledger (org_id, delta, reason, ref_type, ref_id, note)
select f.org_id, public.verification_credit_grant(), 'onboarding_grant', 'org', f.org_id,
       'Verified before credits were granted automatically'
  from public.factory_profiles f
 where f.verification_status = 'verified'
   and not exists (
     select 1 from public.credit_ledger l
      where l.org_id = f.org_id and l.reason = 'onboarding_grant'
   )
on conflict (org_id, reason, ref_id) where ref_id is not null do nothing;

-- ---------------------------------------------------------------------------
-- 4. Invites
-- ---------------------------------------------------------------------------
alter table public.referrals
  add column emailed_at  timestamptz,
  add column rewarded_at timestamptz;

-- An invited company counts once, for one inviter.
create unique index referrals_referred_once_idx
  on public.referrals (referred_org_id)
  where referred_org_id is not null;

create index referrals_email_pending_idx
  on public.referrals (email)
  where accepted_at is null;

-- Clients may say who they invited, nothing else. Linking and rewarding are
-- the database's.
revoke insert, update, delete on public.referrals from authenticated;
grant insert (referrer_org_id, email, message) on public.referrals to authenticated;

-- Public mail providers: two companies on gmail.com are not the same company.
create or replace function public.is_public_email_domain(domain text)
returns boolean
language sql
immutable
as $$
  select lower(coalesce(domain, '')) = any (array[
    'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
    'yahoo.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com',
    'qq.com', 'foxmail.com', '163.com', '126.com', 'yeah.net', 'sina.com', 'sina.cn',
    'sohu.com', 'aliyun.com'
  ])
$$;

revoke all on function public.is_public_email_domain(text) from public;
grant execute on function public.is_public_email_domain(text) to authenticated, service_role;

create or replace function public.guard_referral_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  domain text;
begin
  new.email := lower(btrim(new.email));
  new.created_by := coalesce(auth.uid(), new.created_by);

  if new.email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'enter a valid email address' using errcode = '22023';
  end if;

  -- Service-role writes (seed, tests' setup) skip the people checks below
  -- but not the shape of the address. This function is security definer (it
  -- reads auth.users), so current_user is its owner: the request's role is
  -- what says who is asking.
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') then
    return new;
  end if;

  if not public.is_org_member(new.referrer_org_id) then
    raise exception 'only a member of the company can send its invites' using errcode = '42501';
  end if;

  if exists (select 1 from auth.users u where lower(u.email) = new.email) then
    raise exception 'this address already has a Sourcing Club account' using errcode = '23505';
  end if;

  domain := split_part(new.email, '@', 2);
  if not public.is_public_email_domain(domain) and exists (
    select 1
      from public.org_members m
      join auth.users u on u.id = m.user_id
     where m.org_id = new.referrer_org_id
       and lower(split_part(u.email, '@', 2)) = domain
  ) then
    raise exception 'invite another company: % is your own email domain', domain using errcode = '22023';
  end if;

  if exists (
    select 1 from public.referrals r
     where r.referrer_org_id = new.referrer_org_id and r.email = new.email and r.accepted_at is null
  ) then
    raise exception 'you have already invited %', new.email using errcode = '23505';
  end if;

  if (select count(*) from public.referrals r
       where r.referrer_org_id = new.referrer_org_id
         and r.created_at > now() - interval '24 hours') >= 20 then
    raise exception 'that is 20 invites today; try again tomorrow' using errcode = '54000';
  end if;

  new.referred_org_id := null;
  new.accepted_at := null;
  return new;
end;
$$;

revoke all on function public.guard_referral_insert() from public, anon, authenticated;

create trigger referrals_guard_insert
  before insert on public.referrals
  for each row execute function public.guard_referral_insert();

-- Linking: the invited address creates its company. create_org() inserts the
-- first owner right after the org, so that row is the sign-up.
create or replace function public.link_referral_on_signup()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  joined  public.orgs;
  address text;
  invite  public.referrals;
begin
  if new.role <> 'owner' or exists (
    select 1 from public.org_members m where m.org_id = new.org_id and m.user_id <> new.user_id
  ) then
    return new;
  end if;

  select * into joined from public.orgs where id = new.org_id;
  select lower(email) into address from auth.users where id = new.user_id;
  if address is null then
    return new;
  end if;

  select r.* into invite
    from public.referrals r
    join public.orgs referrer on referrer.id = r.referrer_org_id
   where r.email = address
     and r.accepted_at is null
     and r.referrer_org_id <> new.org_id
     and referrer.type = joined.type
     and not exists (
       select 1 from public.org_members m
        where m.org_id = r.referrer_org_id and m.user_id = new.user_id
     )
   order by r.created_at
   limit 1
   for update of r skip locked;

  if not found or exists (select 1 from public.referrals where referred_org_id = new.org_id) then
    return new;
  end if;

  update public.referrals
     set referred_org_id = new.org_id, accepted_at = now()
   where id = invite.id;

  insert into public.notifications (org_id, kind, subject_type, subject_id, title, body)
  values (invite.referrer_org_id, 'referral_joined', 'referral', invite.id,
          format('%s joined from your invite', joined.name),
          case when joined.type = 'factory'
               then 'You earn 500 credits when TSC verifies their profile.'
               else null end);

  return new;
end;
$$;

revoke all on function public.link_referral_on_signup() from public, anon, authenticated;

create trigger org_members_link_referral
  after insert on public.org_members
  for each row execute function public.link_referral_on_signup();

-- ---------------------------------------------------------------------------
-- 6. Staff adjustment
-- ---------------------------------------------------------------------------
create or replace function public.admin_adjust_credits(
  target_org uuid,
  amount     integer,
  reason     text
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target  public.orgs;
  why     text := btrim(coalesce(reason, ''));
  balance integer;
begin
  if not public.is_platform_admin() then
    raise exception 'only TSC staff can adjust credits' using errcode = '42501';
  end if;

  select * into target from public.orgs where id = target_org for update;
  if not found then
    raise exception 'company not found' using errcode = 'P0002';
  end if;
  if target.type <> 'factory' then
    raise exception 'credits are for factories; % is a brand', target.name using errcode = '22023';
  end if;

  if amount is null or amount = 0 or abs(amount) > 10000 then
    raise exception 'enter an amount between 1 and 10,000 credits' using errcode = '22023';
  end if;
  if length(why) < 5 or length(why) > 300 then
    raise exception 'give a reason the company will understand (5 to 300 characters)' using errcode = '22023';
  end if;

  balance := public.credit_balance(target_org);
  if balance + amount < 0 then
    raise exception 'this company has % credits; you cannot remove %', balance, abs(amount)
      using errcode = '22023';
  end if;

  insert into public.credit_ledger (org_id, delta, reason, note, created_by)
  values (target_org, amount, 'admin_adjustment', why, auth.uid());

  insert into public.notifications (org_id, kind, subject_type, subject_id, title, body)
  values (target_org, 'credits_adjusted', 'credits', target_org,
          case when amount > 0
               then format('TSC added %s credits', amount)
               else format('TSC removed %s credits', abs(amount)) end,
          why);

  return balance + amount;
end;
$$;

revoke all on function public.admin_adjust_credits(uuid, integer, text) from public, anon;
grant execute on function public.admin_adjust_credits(uuid, integer, text) to authenticated;
