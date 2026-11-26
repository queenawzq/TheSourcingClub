-- Joining a company needs the invited mailbox, not only the invited address.
--
-- "Confirm email" is off, so signing up gives a session at once and the
-- token's email is whatever address was typed. accept_invitation() matched
-- that address alone: whoever registered an invited address first could join
-- the company with the permissions the invitation gave (Approve samples,
-- Release funds), before the person it was meant for.
--
-- The session now has to show it was opened from that mailbox: a code or link
-- emailed to it (`otp`, `magiclink`), a password-reset link (`recovery`), an
-- email-change or invite link. A password session does not count, so an
-- invited person signed in with a password is emailed a code first. That
-- happens on the Join screens; the sign-up itself stays one step.
--
-- my_invitation_companies() still lists the invitation, so a person signing up
-- with an invited address is offered it rather than having a company created.

create or replace function public.session_proved_mailbox()
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from jsonb_array_elements(
             case when jsonb_typeof(auth.jwt() -> 'amr') = 'array' then auth.jwt() -> 'amr' else '[]'::jsonb end
           ) as entry
     where coalesce(entry ->> 'method', entry #>> '{}')
           in ('otp', 'magiclink', 'recovery', 'email_change', 'invite')
  )
$$;

revoke all on function public.session_proved_mailbox() from public, anon, authenticated;

create or replace function public.accept_invitation(invitation_id uuid)
returns public.orgs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  invite public.org_invitations;
  target_org public.orgs;
  caller_email text;
  who text;
begin
  caller_email := lower(coalesce(auth.jwt() ->> 'email', ''));

  if caller_email = '' then
    raise exception 'must be signed in to accept an invitation'
      using errcode = '42501';
  end if;

  if public.is_platform_admin() then
    raise exception 'The Sourcing Club staff cannot join a company'
      using errcode = '42501', hint = 'staff_address';
  end if;

  select * into invite
  from public.org_invitations
  where id = invitation_id
    and email = caller_email
    and status = 'pending'
    and expires_at > now()
  for update;

  if not found then
    raise exception 'invitation not found, already used, or expired'
      using errcode = 'P0002';
  end if;

  if not public.session_proved_mailbox() then
    raise exception 'enter the code emailed to % to join', caller_email
      using errcode = '42501', hint = 'mailbox_unproven';
  end if;

  select * into target_org from public.orgs where id = invite.org_id;

  insert into public.org_members (org_id, user_id, role, permissions, title)
  values (invite.org_id, auth.uid(), invite.role,
          coalesce(invite.permissions, public.default_member_permissions(target_org.type, true)),
          invite.title)
  on conflict (org_id, user_id) do nothing;

  update public.org_invitations
     set status = 'accepted',
         accepted_at = now(),
         accepted_by = auth.uid()
   where id = invite.id;

  if found then
    select coalesce(nullif(btrim(p.full_name), ''), invite.invited_name, caller_email) into who
      from public.user_profiles p where p.id = auth.uid();
    insert into public.notifications (org_id, kind, subject_type, subject_id, title, body, data)
    values (
      invite.org_id, 'team_member_joined', 'org', invite.org_id,
      format('%s joined %s', coalesce(who, invite.invited_name, caller_email), target_org.name),
      'They accepted the invitation and can now work with the permissions it gave them.',
      jsonb_build_object('user_id', auth.uid())
    );
  end if;

  return target_org;
end;
$$;

revoke all on function public.accept_invitation(uuid) from public, anon;
grant execute on function public.accept_invitation(uuid) to authenticated;
