-- ============================================================================
-- The day's 20 invites are counted per person as well as per company
-- ----------------------------------------------------------------------------
-- 20261024000502 made a question about an address with an account count
-- toward the day's 20, but the 20 were counted per company, and anyone can
-- create another company (create_org has no limit). A second company reset
-- the count, so the invite form still answered "does this address have a
-- Sourcing Club account?" without limit: the question /api/account-exists
-- answers only under a rate limit (CLAUDE.md, Auth).
--
-- Now the person sending is counted too: 20 a day across every company they
-- belong to. The company's own 20 stay, so a company with several members
-- still sends 20 a day between them, as before; a person sends at most 20
-- whichever company they send for. created_by is the caller (the guard sets
-- it from auth.uid(), whatever the client sent), and a client can neither
-- update nor delete an invite, so the count cannot be reset.
--
-- Counted in the database rather than by routing the answer through the
-- per-IP limiter: a client can insert into referrals directly with the
-- publishable key and read refused_at back, never touching /api/send-invite,
-- so only the guard sees every question.
--
-- Safe with the current site live: one new index, and the same trigger
-- function, replaced. The refusal is the same error the site already shows.
-- ============================================================================

create index referrals_sender_recent_idx
  on public.referrals (created_by, created_at);

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
  -- invites are rows too, and count. Per company, and per person across
  -- every company they are in, so a new company does not start a new 20.
  if (select count(*) from public.referrals r
       where r.referrer_org_id = new.referrer_org_id
         and r.created_at > now() - interval '24 hours') >= 20
     or (select count(*) from public.referrals r
          where r.created_by = new.created_by
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
