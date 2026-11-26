-- The profile's email is the sign-up email; nobody types it.
--
-- user_profiles_self_write lets a person update their own profile, and
-- authenticated held UPDATE on every column, email included. Nothing asked for
-- a confirmation and nothing tied it to auth.users.email. Yet that column is
-- what TSC mails (queue_notification_emails, the onboarding and review
-- decision emails) and what org_verification_checks reads to decide whether a
-- company's people use its website's domain. So anyone could point a company's
-- notification emails at any address, making TSC's sender a relay for mail to
-- strangers, and a member could "corroborate" a website domain they do not
-- hold.
--
-- Signed-in users may now update only locale, the one column the app writes
-- (set_my_time_zone is security definer). A new column on user_profiles is not
-- writable by signed-in users until it is added to this grant. The email is
-- set at sign-up (handle_new_user) and only the server key changes it after
-- that. It is deliberately NOT copied from auth.users.email on change: the app
-- offers no email change, and whether Auth applies one without confirmation
-- depends on settings outside this repository.
--
-- Profiles that already differ from the sign-in email are recorded in
-- profile_email_realignments (staff only) and brought back to it. Queued
-- emails to them that no sender has tried yet are re-pointed too; a row
-- already attempted keeps its address, so a retry under the same idempotency
-- key never changes its recipient.

revoke update on public.user_profiles from authenticated;
grant update (locale) on public.user_profiles to authenticated;

create table if not exists public.profile_email_realignments (
  user_id      uuid not null references auth.users (id) on delete cascade,
  old_email    text,
  new_email    text not null,
  realigned_at timestamptz not null default now()
);
alter table public.profile_email_realignments enable row level security;
revoke all on public.profile_email_realignments from public, anon, authenticated;

insert into public.profile_email_realignments (user_id, old_email, new_email)
select p.id, p.email, u.email
  from public.user_profiles p
  join auth.users u on u.id = p.id
 where u.email is not null
   and p.email is distinct from u.email;

update public.user_profiles p
   set email = u.email
  from auth.users u
 where u.id = p.id
   and u.email is not null
   and p.email is distinct from u.email;

update public.notification_email_outbox o
   set recipient_email = u.email
  from auth.users u
 where u.id = o.recipient_user_id
   and o.status = 'pending' and o.attempts = 0
   and u.email is not null and o.recipient_email is distinct from u.email;

update public.onboarding_submission_email_outbox o
   set recipient_email = u.email
  from auth.users u
 where u.id = o.recipient_user_id
   and o.status = 'pending' and o.attempts = 0
   and u.email is not null and o.recipient_email is distinct from u.email;

update public.verification_approval_email_outbox o
   set recipient_email = u.email
  from auth.users u
 where u.id = o.recipient_user_id
   and o.status = 'pending' and o.attempts = 0
   and u.email is not null and o.recipient_email is distinct from u.email;

-- One a sender already tried keeps its address, so it is stopped rather than
-- retried to that address (or re-sent to the new one under the same key).
update public.notification_email_outbox o
   set status = 'skipped', last_error = 'address realigned to the sign-up email (20261126200000)'
  from auth.users u
 where u.id = o.recipient_user_id
   and o.status in ('pending', 'failed') and o.attempts > 0
   and u.email is not null and o.recipient_email is distinct from u.email;

update public.verification_approval_email_outbox o
   set status = 'skipped', last_error = 'address realigned to the sign-up email (20261126200000)'
  from auth.users u
 where u.id = o.recipient_user_id
   and o.status in ('pending', 'failed', 'unconfirmed') and o.attempts > 0
   and u.email is not null and o.recipient_email is distinct from u.email;
