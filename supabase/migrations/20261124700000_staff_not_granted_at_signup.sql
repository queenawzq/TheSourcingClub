-- Signing up never makes anyone staff.
--
-- 20260904000200 promoted any new account whose address was in admin_emails.
-- It trusted the address because sign-in then needed a code emailed to it.
-- That stopped being true: sign-up is by password and "Confirm email" is off,
-- so the account's address is whatever was typed. Whoever signed up first
-- with an allowlisted address that had no account yet became platform staff,
-- with no email read and no one told.
--
-- handle_new_user() now only creates the profile. Staff are added on purpose,
-- by account id, once the person has an account:
--
--   insert into public.platform_admins (user_id, note) values ('<auth.users id>', '<who, why>');
--
-- Existing platform_admins rows are untouched, so nobody loses access.
-- admin_emails stays (a migration adds, it does not drop while the live site
-- runs) but grants nothing any more.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.user_profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name'
    ),
    coalesce(
      new.raw_user_meta_data ->> 'avatar_url',
      new.raw_user_meta_data ->> 'picture'
    )
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

comment on table public.admin_emails is
  'No longer read. Signing up does not grant staff (20261124700000); add staff to platform_admins by user_id.';
