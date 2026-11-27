-- ============================================================================
-- An invitation's email is claimed before it is sent, and counted
-- (security audit TSC-11).
--
-- resend_invitation() refused a resend only when `emailed_at` was under ten
-- minutes old, and the server stamps `emailed_at` after the email has gone.
-- Resends pressed at the same moment all read the old stamp and all passed
-- (8 of 10 emailed, locally), and one resend every ten minutes was allowed
-- for ever: the 20-a-day limit counts new invitations, not resends. Anyone
-- with a company of their own could have TSC's sender email any address,
-- with their own words in the name and title.
--
-- Now:
-- - resend_invitation() claims the send (`email_claimed_at`, and a row in
--   `org_invitation_sends`) in the same transaction as the ten-minute check,
--   under the invitation's row lock, so a second resend waits and is refused.
--   The server releases the claim when nothing was sent.
-- - An invitation is sent again at most 3 times; one person resends at most
--   20 a day; one address gets at most 10 invitation emails a day (new
--   invitations and resends, from every company).
-- - The server keys the email on the claim, so each claim is one send to
--   Resend and a retry of the same claim is its replay.
--
-- The site live during the deploy keeps working: it calls the same function
-- and reads the columns it read before.
-- ============================================================================

alter table public.org_invitations add column if not exists email_claimed_at timestamptz;

comment on column public.org_invitations.email_claimed_at is
  'When resend_invitation() last claimed an email for this invitation; the server clears it if nothing was sent. With emailed_at, the ten-minute rule.';

-- Every resend claimed: what the counts read. Server-only, like the claim.
-- Removed with its invitation (a company deleted), so no address outlives it.
create table if not exists public.org_invitation_sends (
  id            bigint generated always as identity primary key,
  invitation_id uuid not null references public.org_invitations (id) on delete cascade,
  email         text not null,
  claimed_by    uuid,
  claimed_at    timestamptz not null default now()
);

create index if not exists org_invitation_sends_invitation_idx on public.org_invitation_sends (invitation_id);
create index if not exists org_invitation_sends_email_idx on public.org_invitation_sends (email, claimed_at);
create index if not exists org_invitation_sends_by_idx on public.org_invitation_sends (claimed_by, claimed_at);

alter table public.org_invitation_sends enable row level security;
revoke all on public.org_invitation_sends from public, anon, authenticated;

-- Invitation emails to one address in the last day, from every company:
-- invitations created and resends claimed.
create or replace function public.invitation_emails_today(target_email text)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select (select count(*) from public.org_invitations
           where email = lower(btrim(target_email)) and created_at > now() - interval '1 day')::int
       + (select count(*) from public.org_invitation_sends
           where email = lower(btrim(target_email)) and claimed_at > now() - interval '1 day')::int;
$$;

revoke all on function public.invitation_emails_today(text) from public, anon, authenticated;

create or replace function public.resend_invitation(target_invitation uuid)
returns public.org_invitations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  invite public.org_invitations;
begin
  if not exists (
    select 1 from public.org_invitations i
     where i.id = target_invitation
       and public.has_org_permission(i.org_id, 'settingsAccess')
  ) then
    raise exception 'invitation not found' using errcode = '42501';
  end if;

  -- The lock is the claim's: a resend pressed at the same moment waits here,
  -- then reads this one's claim below.
  select * into invite from public.org_invitations where id = target_invitation for update;
  if invite.status <> 'pending' then
    raise exception 'This invitation was already accepted or withdrawn' using errcode = '22023';
  end if;
  if greatest(invite.emailed_at, invite.email_claimed_at) > now() - interval '10 minutes' then
    raise exception 'This invitation was emailed a few minutes ago. Try again in 10 minutes.'
      using errcode = '54000', hint = 'resend_too_soon';
  end if;
  if (select count(*) from public.org_invitation_sends where invitation_id = target_invitation) >= 3 then
    raise exception 'This invitation has already been sent again 3 times.'
      using errcode = '54000', hint = 'resend_limit';
  end if;
  if (select count(*) from public.org_invitation_sends
       where claimed_by = auth.uid() and claimed_at > now() - interval '1 day') >= 20 then
    raise exception 'You can resend up to 20 invitations a day. Try again tomorrow.'
      using errcode = '54000', hint = 'resend_daily_limit';
  end if;
  if public.invitation_emails_today(invite.email) >= 10 then
    raise exception 'That address has been sent too many invitations today. Try again tomorrow.'
      using errcode = '54000', hint = 'address_daily_limit';
  end if;

  insert into public.org_invitation_sends (invitation_id, email, claimed_by)
  values (invite.id, invite.email, auth.uid());

  update public.org_invitations
     set expires_at = now() + interval '14 days',
         email_claimed_at = now()
   where id = target_invitation
  returning * into invite;
  return invite;
end;
$$;

revoke all on function public.resend_invitation(uuid) from public, anon;
grant execute on function public.resend_invitation(uuid) to authenticated;

-- The server gives a claim back when nothing was sent (no email set up, a
-- test address, the email service refused it), so Resend can be pressed
-- again at once and the attempt is not counted.
create or replace function public.release_invitation_email(target_invitation uuid, claimed timestamptz)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from public.org_invitation_sends
   where invitation_id = target_invitation and claimed_at = claimed;
  update public.org_invitations
     set email_claimed_at = null
   where id = target_invitation and email_claimed_at = claimed;
$$;

revoke all on function public.release_invitation_email(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.release_invitation_email(uuid, timestamptz) to service_role;

-- The guard as in 20261104100000, with one addition: an address that has had
-- 10 invitation emails today is not invited again until tomorrow.
create or replace function public.guard_org_invitation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  kind     public.org_type;
  bad      text;
  inviter  uuid := auth.uid();
begin
  if tg_op = 'UPDATE' then
    -- A client may only withdraw a pending invitation. Accepting happens in
    -- accept_invitation(), which runs as the definer.
    if current_user = 'authenticated'
       and not (old.status = 'pending' and new.status = 'revoked') then
      raise exception 'Only a pending invitation can be withdrawn' using errcode = '42501';
    end if;
    return new;
  end if;

  -- The service role (seed, server) writes what it means to.
  if inviter is null then
    return new;
  end if;

  select type into kind from public.orgs where id = new.org_id;

  new.email := lower(btrim(new.email));
  new.invited_by := inviter;
  new.role := 'member';
  new.status := 'pending';
  new.expires_at := now() + interval '14 days';
  new.title := nullif(btrim(coalesce(new.title, '')), '');
  new.invited_name := nullif(btrim(coalesce(new.invited_name, '')), '');
  new.emailed_at := null;
  new.email_claimed_at := null;

  if new.permissions is null then
    new.permissions := array(
      select p from unnest(public.default_member_permissions(kind, true)) p
       where public.member_has_permission(inviter, new.org_id, p));
  end if;

  select p into bad from unnest(new.permissions) p
   where not p = any (public.permission_keys(kind)) limit 1;
  if bad is not null then
    raise exception 'A % company has no permission called %', kind, bad using errcode = '22023';
  end if;

  -- The primary contact is chosen among people already on the team.
  new.permissions := array(select distinct p from unnest(new.permissions) p
                            where p <> 'primaryContact' order by p);

  -- No inviting a second address of your own with more than you hold.
  select p into bad from unnest(new.permissions) p
   where not public.member_has_permission(inviter, new.org_id, p) limit 1;
  if bad is not null then
    raise exception 'You can only give permissions you have yourself (not %)', public.permission_label(kind, bad)
      using errcode = '42501', hint = 'permission_not_held:' || bad;
  end if;

  if exists (
    select 1 from public.org_members m
      join auth.users u on u.id = m.user_id
     where m.org_id = new.org_id and lower(u.email) = new.email
  ) then
    raise exception '% is already on this team', new.email using errcode = '23505', hint = 'already_member';
  end if;

  if exists (
    select 1 from public.platform_admins a
      join auth.users u on u.id = a.user_id
     where lower(u.email) = new.email
  ) then
    raise exception 'That address belongs to The Sourcing Club staff, who cannot join a company'
      using errcode = '42501', hint = 'staff_address';
  end if;

  -- Per person, not per company: a second company is not a second allowance.
  if (select count(*) from public.org_invitations
       where invited_by = inviter and created_at > now() - interval '1 day') >= 20 then
    raise exception 'You can invite up to 20 people a day. Try again tomorrow.'
      using errcode = '54000', hint = 'daily_limit';
  end if;

  -- Withdrawing and inviting again is a new invitation, so one address is
  -- capped across every company, whoever invites it.
  if public.invitation_emails_today(new.email) >= 10 then
    raise exception 'That address has been sent too many invitations today. Try again tomorrow.'
      using errcode = '54000', hint = 'address_daily_limit';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_org_invitation() from public, anon, authenticated;
