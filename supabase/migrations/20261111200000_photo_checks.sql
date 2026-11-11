-- ============================================================================
-- Photo checks (verification v3, outcome 6; Nov 11)
-- ----------------------------------------------------------------------------
-- A factory's photos are fingerprinted by our own code (api/photo-check.js):
-- the SHA-256 of the file (the same file) and a 64-bit difference hash (the
-- same picture resized or recompressed). The same photo on another company
-- is flagged to staff, with that company's name: staff only, never the
-- factory or a brand.
--
-- Both tables are staff-only and written only by the server key. Staff read
-- through two security definer functions whose first statement is the
-- is_platform_admin() test (CLAUDE.md, Admin operations).
-- Additive only: no existing object changes.
-- ============================================================================

create table public.photo_fingerprints (
  document_id  uuid primary key references public.documents (id) on delete cascade,
  org_id       uuid not null references public.orgs (id) on delete cascade,
  sha256       text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  -- 16 hex characters (64 bits); null when our code cannot decode the image.
  dhash        text check (dhash is null or dhash ~ '^[0-9a-f]{16}$'),
  computed_at  timestamptz not null default now()
);

create index photo_fingerprints_org_idx on public.photo_fingerprints (org_id);
create index photo_fingerprints_sha_idx on public.photo_fingerprints (sha256);

create table public.photo_checks (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs (id) on delete cascade,
  result      jsonb not null,
  checked_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);

create index photo_checks_org_idx on public.photo_checks (org_id, created_at desc);

alter table public.photo_fingerprints enable row level security;
alter table public.photo_checks enable row level security;
-- No policies: nobody reads or writes these through the API but the server key.
revoke all on table public.photo_fingerprints from public, anon, authenticated;
revoke all on table public.photo_checks from public, anon, authenticated;
grant all on table public.photo_fingerprints to service_role;
grant all on table public.photo_checks to service_role;

-- The server records a fingerprint ------------------------------------------
create or replace function public.record_photo_fingerprint(doc uuid, sha text, hash text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_org uuid;
begin
  select org_id into owner_org from public.documents where id = doc;
  if owner_org is null then
    raise exception 'No such document' using errcode = 'P0002';
  end if;
  insert into public.photo_fingerprints (document_id, org_id, sha256, dhash, computed_at)
  values (doc, owner_org, lower(sha), lower(nullif(hash, '')), now())
  on conflict (document_id) do update
    set org_id = excluded.org_id, sha256 = excluded.sha256, dhash = excluded.dhash, computed_at = now();
end;
$$;

revoke all on function public.record_photo_fingerprint(uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_photo_fingerprint(uuid, text, text) to service_role;

-- The server records a check's result ---------------------------------------
create or replace function public.record_photo_check(target_org uuid, check_result jsonb, checker uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  insert into public.photo_checks (org_id, result, checked_by)
  values (target_org, check_result, checker)
  returning id into new_id;
  return new_id;
end;
$$;

revoke all on function public.record_photo_check(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.record_photo_check(uuid, jsonb, uuid) to service_role;

-- Staff: the same photo on another company ----------------------------------
-- One row per (photo of target_org, photo of another company) pair that is
-- the same file, or within 10 of 64 bits of the difference hash. The other
-- company's name is returned to staff only.
create or replace function public.admin_photo_duplicates(target_org uuid)
returns table (
  document_id        uuid,
  other_document_id  uuid,
  other_org_id       uuid,
  other_org_name     text,
  match              text,
  distance           integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Staff only' using errcode = '42501';
  end if;
  return query
  select mine.document_id,
         theirs.document_id,
         theirs.org_id,
         o.name,
         case when mine.sha256 = theirs.sha256 then 'exact' else 'similar' end,
         case when mine.sha256 = theirs.sha256 then 0
              else bit_count(('x' || mine.dhash)::bit(64) # ('x' || theirs.dhash)::bit(64))::integer end
  from public.photo_fingerprints mine
  join public.photo_fingerprints theirs
    on theirs.org_id <> mine.org_id
   and (theirs.sha256 = mine.sha256
        or (mine.dhash is not null and theirs.dhash is not null
            and bit_count(('x' || mine.dhash)::bit(64) # ('x' || theirs.dhash)::bit(64)) <= 10))
  join public.orgs o on o.id = theirs.org_id
  where mine.org_id = target_org
  order by mine.document_id, 6, o.name;
end;
$$;

revoke all on function public.admin_photo_duplicates(uuid) from public, anon;
grant execute on function public.admin_photo_duplicates(uuid) to authenticated, service_role;

-- Staff: the latest check ----------------------------------------------------
create or replace function public.admin_photo_check_latest(target_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  found jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'Staff only' using errcode = '42501';
  end if;
  select c.result into found
  from public.photo_checks c
  where c.org_id = target_org
  order by c.created_at desc
  limit 1;
  return found;
end;
$$;

revoke all on function public.admin_photo_check_latest(uuid) from public, anon;
grant execute on function public.admin_photo_check_latest(uuid) to authenticated, service_role;
