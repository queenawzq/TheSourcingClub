-- ============================================================================
-- 024  Admin allowlist
-- ----------------------------------------------------------------------------
-- platform_admins references auth.users, so an admin can only be added after
-- they have signed in at least once. That is an awkward ordering: the people
-- who need the tool cannot be granted it until they have already used the
-- product, and whoever adds them has to be watching for the moment they
-- appear.
--
-- This inverts it. An address is added to the allowlist, and whoever signs in
-- with it becomes an admin — before, after, or never. Existing users are
-- promoted immediately; future ones on their first sign-in.
--
-- The security of this rests on the same thing sign-in does: the address is
-- proved by receiving a one-time code at it. Someone who cannot read that
-- mailbox cannot claim the row, and there are no passwords to guess.
--
-- Removing an address from this table does NOT revoke an existing admin — the
-- platform_admins row is the grant, and it has to be deleted deliberately.
-- That is on purpose: a revocation should be an explicit act, not a side
-- effect of tidying a list.
-- ============================================================================

create table public.admin_emails (
  email      text primary key check (email = lower(email) and position('@' in email) > 1),
  note       text,
  created_at timestamptz not null default now()
);

alter table public.admin_emails enable row level security;

-- Readable by admins only, and never writable from a client. Adding an admin
-- is a database operation, deliberately — a self-service path into this table
-- would be a self-service path to platform admin.
create policy admin_emails_read on public.admin_emails
  for select to authenticated
  using (public.is_platform_admin());

grant select on public.admin_emails to authenticated;

insert into public.admin_emails (email, note) values
  ('john@hexagontechnologies.io', 'Founder'),
  ('queenawzq@gmail.com',         'Design'),
  ('johnmahan7@gmail.com',        'Founder, second address')
on conflict (email) do nothing;

-- ---------------------------------------------------------------------------
-- Promote on sign-in
-- ---------------------------------------------------------------------------
-- handle_new_user() already runs on auth.users insert to create the profile
-- row. Rather than adding a second trigger on the same event — two triggers
-- with an undefined order between them — this extends the existing one.
-- ---------------------------------------------------------------------------

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

  -- An allowlisted address becomes an admin on first sign-in.
  if exists (select 1 from public.admin_emails a where a.email = lower(new.email)) then
    insert into public.platform_admins (user_id, note)
    values (new.id, 'promoted from the admin allowlist')
    on conflict (user_id) do nothing;
  end if;

  return new;
end;
$$;

-- Anyone on the list who has already signed up.
insert into public.platform_admins (user_id, note)
select u.id, 'promoted from the admin allowlist'
from auth.users u
join public.admin_emails a on a.email = lower(u.email)
on conflict (user_id) do nothing;
