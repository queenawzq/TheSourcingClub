-- The profile's email is the sign-in email; nobody types it.
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
-- Signed-in users may now update only full_name, avatar_url and locale (the
-- app writes only locale; set_my_time_zone is security definer). The email
-- follows the sign-in email: it is set at sign-up (handle_new_user) and copied
-- again whenever auth.users.email changes, which Supabase does only once the
-- change is confirmed (double_confirm_changes in config.toml: both the old and
-- the new address must click). Profiles that already differ are recorded in
-- profile_email_realignments and brought back to the sign-in email, and their
-- unsent queued emails with them. A new column on user_profiles is not
-- writable by signed-in users until it is added to the grant below.

revoke update on public.user_profiles from authenticated;
grant update (full_name, avatar_url, locale) on public.user_profiles to authenticated;

create or replace function public.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.user_profiles
     set email = new.email
   where id = new.id
     and email is distinct from new.email;
  return new;
end;
$$;

revoke all on function public.sync_profile_email() from public, anon, authenticated;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function public.sync_profile_email();

-- Profiles that already differ: keep a record of what they said (staff only,
-- read with the database's own access), then bring them back.
create table if not exists public.profile_email_realignments (
  user_id      uuid not null,
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

-- Emails already queued to such an address and not yet sent go to the
-- sign-in address instead: each queue copied the profile's email when it was
-- written, and its sender reads that copy.
update public.notification_email_outbox o
   set recipient_email = u.email
  from auth.users u
 where u.id = o.recipient_user_id and o.sent_at is null
   and u.email is not null and o.recipient_email is distinct from u.email;

update public.onboarding_submission_email_outbox o
   set recipient_email = u.email
  from auth.users u
 where u.id = o.recipient_user_id and o.sent_at is null
   and u.email is not null and o.recipient_email is distinct from u.email;

update public.verification_approval_email_outbox o
   set recipient_email = u.email
  from auth.users u
 where u.id = o.recipient_user_id and o.sent_at is null
   and u.email is not null and o.recipient_email is distinct from u.email;
