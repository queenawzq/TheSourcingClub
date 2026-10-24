-- ============================================================================
-- An invite to an address that has an account counts toward the day's 20
-- ----------------------------------------------------------------------------
-- The invite guard (20261017000100) refused an address that already has a
-- Sourcing Club account by raising, which rolled the row back, so the refusal
-- never counted toward the 20 invites a day. The invite form was therefore a
-- way to ask, without limit, whether any address is a customer: the question
-- /api/account-exists answers only under a rate limit (CLAUDE.md, Auth).
--
-- Now such an invite is kept, stamped refused_at, and counts like any other.
-- It is never emailed (api/send-invite.js reads the stamp and says the
-- address has an account), never linked to a sign-up, and not shown as a
-- pending invite. The day's limit is checked before anything else, so the
-- 21st question of the day gets no answer. Asking again about an address
-- already refused gets the same answer, which says nothing new.
--
-- Safe with the current site live: one new nullable column, and the same
-- two trigger functions, replaced. A refused invite now saves instead of
-- raising; the old site never read that error.
-- ============================================================================

alter table public.referrals
  add column refused_at timestamptz;

comment on column public.referrals.refused_at is
  'The address already had an account: kept only so it counts toward the day''s invites. Never emailed or linked.';

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
  new.refused_at := null;

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

  -- First, so that no answer below is given past the day's 20. Refused
  -- invites are rows too, and count.
  if (select count(*) from public.referrals r
       where r.referrer_org_id = new.referrer_org_id
         and r.created_at > now() - interval '24 hours') >= 20 then
    raise exception 'that is 20 invites today; try again tomorrow' using errcode = '54000';
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
     where r.referrer_org_id = new.referrer_org_id and r.email = new.email
       and r.accepted_at is null and r.refused_at is not null
  ) then
    raise exception 'this address already has a Sourcing Club account' using errcode = '23505';
  end if;

  if exists (
    select 1 from public.referrals r
     where r.referrer_org_id = new.referrer_org_id and r.email = new.email and r.accepted_at is null
  ) then
    raise exception 'you have already invited %', new.email using errcode = '23505';
  end if;

  -- Kept, not raised: a raise rolls the row back, and the question would
  -- not count toward the limit.
  if exists (select 1 from auth.users u where lower(u.email) = new.email) then
    new.refused_at := now();
  end if;

  new.referred_org_id := null;
  new.accepted_at := null;
  return new;
end;
$$;

revoke all on function public.guard_referral_insert() from public, anon, authenticated;

-- Linking: as before, but never through a refused invite.
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
     and r.refused_at is null
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
