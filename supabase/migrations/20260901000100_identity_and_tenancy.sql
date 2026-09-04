-- ============================================================================
-- 001  Identity and tenancy
-- ----------------------------------------------------------------------------
-- Every table in this schema reaches an org_id, and every access policy is
-- expressed in terms of "which orgs is the caller a member of". This migration
-- establishes that spine: orgs, membership, invitations, and the helper
-- functions the rest of the policies are built on.
--
-- Auth is Google OAuth only (v1). There are no passwords in this system.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.org_type as enum ('brand', 'factory');
create type public.org_role as enum ('owner', 'member');
create type public.invitation_status as enum ('pending', 'accepted', 'revoked');

-- ---------------------------------------------------------------------------
-- Shared trigger: keep updated_at honest
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- user_profiles — our mirror of auth.users
-- ---------------------------------------------------------------------------
-- auth.users is not directly readable by clients. This table holds the parts
-- other members of an org legitimately need to see (name, avatar) plus the
-- user's interface language, which drives the en/zh dictionaries.
-- ---------------------------------------------------------------------------

create table public.user_profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  full_name   text,
  avatar_url  text,
  locale      text        not null default 'en' check (locale in ('en', 'zh')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger user_profiles_touch
  before update on public.user_profiles
  for each row execute function public.touch_updated_at();

-- Populate on signup. Google returns name/picture in raw_user_meta_data; the
-- key varies by provider, so fall back through the plausible ones.
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

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- orgs — a brand or a factory
-- ---------------------------------------------------------------------------

create table public.orgs (
  id          uuid primary key default gen_random_uuid(),
  type        public.org_type not null,
  name        text not null check (length(btrim(name)) > 0),
  slug        text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]*$'),

  -- Demo orgs run the exact same code path as real ones. A scheduled job
  -- resets them to seed, so demos can never drift from production behaviour.
  is_demo     boolean not null default false,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index orgs_type_idx on public.orgs (type) where is_demo = false;

create trigger orgs_touch
  before update on public.orgs
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- org_members
-- ---------------------------------------------------------------------------
-- v1 roles are deliberately coarse: owner or member. The granular authority
-- matrix from the design (approve payments, release funds, primary contact)
-- is additive later — a permissions table keyed on this same pair — and does
-- not require changing any foreign key.
-- ---------------------------------------------------------------------------

create table public.org_members (
  org_id      uuid not null references public.orgs (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        public.org_role not null default 'member',
  created_at  timestamptz not null default now(),
  primary key (org_id, user_id)
);

create index org_members_user_idx on public.org_members (user_id);

-- ---------------------------------------------------------------------------
-- platform_admins — internal staff
-- ---------------------------------------------------------------------------
-- Needed from day one: somebody has to review uploaded business registrations
-- and mark off-platform payments as received. Membership is granted by direct
-- database access only; there is deliberately no self-service path in.
-- ---------------------------------------------------------------------------

create table public.platform_admins (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  note        text,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Access helpers
-- ---------------------------------------------------------------------------
-- These are SECURITY DEFINER so they bypass RLS internally. That is what stops
-- a policy on org_members which itself reads org_members from recursing.
-- They are the only functions allowed to do that, and each one is a single
-- narrow read.
-- ---------------------------------------------------------------------------

create or replace function public.current_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select org_id from public.org_members where user_id = auth.uid();
$$;

create or replace function public.is_org_member(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.org_members
    where org_id = target_org and user_id = auth.uid()
  );
$$;

create or replace function public.is_org_owner(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.org_members
    where org_id = target_org and user_id = auth.uid() and role = 'owner'
  );
$$;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.platform_admins where user_id = auth.uid()
  );
$$;

revoke all on function public.current_org_ids()      from public;
revoke all on function public.is_org_member(uuid)    from public;
revoke all on function public.is_org_owner(uuid)     from public;
revoke all on function public.is_platform_admin()    from public;

grant execute on function public.current_org_ids()   to authenticated;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.is_org_owner(uuid)  to authenticated;
grant execute on function public.is_platform_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- org_invitations
-- ---------------------------------------------------------------------------

create table public.org_invitations (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs (id) on delete cascade,

  -- Stored lowercased so invitation lookup is not case-sensitive; Google
  -- addresses come back in whatever case the user typed.
  email       text not null check (email = lower(email) and position('@' in email) > 1),
  role        public.org_role not null default 'member',
  status      public.invitation_status not null default 'pending',

  invited_by  uuid references auth.users (id) on delete set null,
  expires_at  timestamptz not null default (now() + interval '14 days'),
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);

-- One live invitation per address per org.
create unique index org_invitations_pending_idx
  on public.org_invitations (org_id, email)
  where status = 'pending';

create index org_invitations_email_idx on public.org_invitations (email)
  where status = 'pending';

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
-- With no server tier, these policies ARE the authorisation layer. A mistake
-- here is a data breach, not a bug. Migration 006 asserts what each role
-- cannot read.
-- ---------------------------------------------------------------------------

alter table public.user_profiles    enable row level security;
alter table public.orgs             enable row level security;
alter table public.org_members      enable row level security;
alter table public.org_invitations  enable row level security;
alter table public.platform_admins  enable row level security;

-- user_profiles: yourself, plus anyone you share an org with.
create policy user_profiles_self_read on public.user_profiles
  for select to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1 from public.org_members m
      where m.user_id = public.user_profiles.id
        and m.org_id in (select public.current_org_ids())
    )
    or public.is_platform_admin()
  );

create policy user_profiles_self_write on public.user_profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- orgs: members read their own. Creation goes through create_org() below, so
-- there is deliberately no INSERT policy — an org can never exist without an
-- owner attached to it.
create policy orgs_member_read on public.orgs
  for select to authenticated
  using (id in (select public.current_org_ids()) or public.is_platform_admin());

create policy orgs_owner_update on public.orgs
  for update to authenticated
  using (public.is_org_owner(id))
  with check (public.is_org_owner(id));

-- org_members: you can see who else is in your orgs. Only owners change
-- membership, and only through the RPCs, so no INSERT policy here either.
create policy org_members_read on public.org_members
  for select to authenticated
  using (org_id in (select public.current_org_ids()) or public.is_platform_admin());

create policy org_members_owner_update on public.org_members
  for update to authenticated
  using (public.is_org_owner(org_id))
  with check (public.is_org_owner(org_id));

create policy org_members_owner_delete on public.org_members
  for delete to authenticated
  using (
    -- Owners may remove others; anyone may remove themselves.
    (public.is_org_owner(org_id) and user_id <> auth.uid())
    or user_id = auth.uid()
  );

-- org_invitations: owners manage them; an invitee may read the one addressed
-- to their own email so the accept screen can show which org invited them.
create policy org_invitations_owner_all on public.org_invitations
  for all to authenticated
  using (public.is_org_owner(org_id))
  with check (public.is_org_owner(org_id));

create policy org_invitations_invitee_read on public.org_invitations
  for select to authenticated
  using (email = lower(coalesce(auth.jwt() ->> 'email', '')));

-- platform_admins: readable only by admins. Never writable from a client.
create policy platform_admins_read on public.platform_admins
  for select to authenticated
  using (public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- create_org — the only way an org comes into existence
-- ---------------------------------------------------------------------------
-- Atomic so an org can never exist without an owner. Slugs are derived from
-- the name and de-duplicated with a numeric suffix.
-- ---------------------------------------------------------------------------

create or replace function public.create_org(
  org_name text,
  org_kind public.org_type
)
returns public.orgs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  base_slug text;
  final_slug text;
  suffix int := 1;
  new_org public.orgs;
begin
  if auth.uid() is null then
    raise exception 'must be signed in to create an organisation'
      using errcode = '42501';
  end if;

  if org_name is null or length(btrim(org_name)) = 0 then
    raise exception 'organisation name is required' using errcode = '22023';
  end if;

  base_slug := regexp_replace(lower(btrim(org_name)), '[^a-z0-9]+', '-', 'g');
  base_slug := btrim(base_slug, '-');
  if base_slug = '' then
    base_slug := 'org';
  end if;

  final_slug := base_slug;
  while exists (select 1 from public.orgs where slug = final_slug) loop
    suffix := suffix + 1;
    final_slug := base_slug || '-' || suffix;
  end loop;

  insert into public.orgs (type, name, slug)
  values (org_kind, btrim(org_name), final_slug)
  returning * into new_org;

  insert into public.org_members (org_id, user_id, role)
  values (new_org.id, auth.uid(), 'owner');

  return new_org;
end;
$$;

revoke all on function public.create_org(text, public.org_type) from public;
grant execute on function public.create_org(text, public.org_type) to authenticated;

-- ---------------------------------------------------------------------------
-- accept_invitation — join an org you were invited to
-- ---------------------------------------------------------------------------

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
begin
  caller_email := lower(coalesce(auth.jwt() ->> 'email', ''));

  if caller_email = '' then
    raise exception 'must be signed in to accept an invitation'
      using errcode = '42501';
  end if;

  select * into invite
  from public.org_invitations
  where id = invitation_id
    and email = caller_email
    and status = 'pending'
    and expires_at > now();

  if not found then
    raise exception 'invitation not found, already used, or expired'
      using errcode = 'P0002';
  end if;

  insert into public.org_members (org_id, user_id, role)
  values (invite.org_id, auth.uid(), invite.role)
  on conflict (org_id, user_id) do nothing;

  update public.org_invitations
     set status = 'accepted',
         accepted_at = now(),
         accepted_by = auth.uid()
   where id = invite.id;

  select * into target_org from public.orgs where id = invite.org_id;
  return target_org;
end;
$$;

revoke all on function public.accept_invitation(uuid) from public;
grant execute on function public.accept_invitation(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Table grants. RLS decides the rows; these decide the verbs.
-- ---------------------------------------------------------------------------

grant select                         on public.orgs            to authenticated;
grant update                         on public.orgs            to authenticated;
grant select, update                 on public.user_profiles   to authenticated;
grant select, update, delete         on public.org_members     to authenticated;
grant select, insert, update, delete on public.org_invitations to authenticated;
grant select                         on public.platform_admins to authenticated;
