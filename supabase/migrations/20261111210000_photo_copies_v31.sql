-- ============================================================================
-- Photo and license copies across TSC (verification v3.1, A8 and B2; Nov 11)
-- ----------------------------------------------------------------------------
-- 20261111200000 compared every fingerprinted file with every other company's
-- and flagged both sides. v3.1:
--   * Only the LATER uploader is flagged (documents.created_at); the earlier
--     one is told to staff but keeps its level.
--   * Photos are compared with photos (product images, workshop photos,
--     walk-throughs) and license files with license files (business
--     registration, authorisation), never across: a license is not a photo.
--   * License files are fingerprinted too (B2). The same license image at two
--     companies is a strong signal. Only an exact copy counts there: every
--     Chinese business license is printed on the same template, so a "looks
--     alike" match between two licenses is not evidence.
--
-- Additive only: the old functions stay for the site still live (both
-- previews share the qa database). photo_copies() is the server key's only.
-- ============================================================================

-- The kinds the v3.1 screens upload. Both may already exist (the sql and
-- onboarding sessions add them); `if not exists` makes this a no-op then.
-- Nothing below compares to them as enum literals, so the order is free.
alter type public.document_kind add value if not exists 'factory_photo';
alter type public.document_kind add value if not exists 'authorisation';

-- Which group a document kind is compared within, or null (not compared).
create or replace function public.copy_group(kind text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when kind in ('product_image', 'factory_photo', 'walkthrough') then 'photo'
    when kind in ('business_registration', 'authorisation') then 'license'
    else null
  end;
$$;

revoke all on function public.copy_group(text) from public, anon, authenticated;
grant execute on function public.copy_group(text) to service_role;

-- One row per (file of target_org, file of another company) in the same
-- group that is the same file, or (photos only) within 10 of 64 bits of the
-- difference hash. `mine_later` says whether target_org's copy was uploaded
-- after the other company's: only then is target_org the one flagged.
create or replace function public.photo_copies(target_org uuid)
returns table (
  document_id         uuid,
  copy_group          text,
  other_document_id   uuid,
  other_org_id        uuid,
  other_org_name      text,
  match               text,
  distance            integer,
  mine_uploaded_at    timestamptz,
  theirs_uploaded_at  timestamptz,
  mine_later          boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with prints as (
    select f.document_id, f.org_id, f.sha256, f.dhash, d.created_at,
           public.copy_group(d.kind::text) as grp
    from public.photo_fingerprints f
    join public.documents d on d.id = f.document_id
  )
  select mine.document_id,
         mine.grp,
         theirs.document_id,
         theirs.org_id,
         o.name,
         case when mine.sha256 = theirs.sha256 then 'exact' else 'similar' end,
         case when mine.sha256 = theirs.sha256 then 0
              else bit_count(('x' || mine.dhash)::bit(64) # ('x' || theirs.dhash)::bit(64))::integer end,
         mine.created_at,
         theirs.created_at,
         -- A tie (same instant) flags both: neither can claim it first.
         mine.created_at >= theirs.created_at
  from prints mine
  join prints theirs
    on theirs.org_id <> mine.org_id
   and theirs.grp = mine.grp
   and (theirs.sha256 = mine.sha256
        or (mine.grp = 'photo'
            and mine.dhash is not null and theirs.dhash is not null
            and bit_count(('x' || mine.dhash)::bit(64) # ('x' || theirs.dhash)::bit(64)) <= 10))
  join public.orgs o on o.id = theirs.org_id
  where mine.org_id = target_org
    and mine.grp is not null
  order by mine.document_id, 7, o.name;
$$;

revoke all on function public.photo_copies(uuid) from public, anon, authenticated;
grant execute on function public.photo_copies(uuid) to service_role;

-- What staff recorded by hand on each photo (reverse search: own, found
-- elsewhere), latest per photo. The server reads it to decide whether the
-- photos may be High (A1). Server key only; staff read signals through
-- admin_verification_signals() as before.
create or replace function public.photo_staff_marks(target_org uuid)
returns table (document_id uuid, result text, checked_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (s.subject_id) s.subject_id, s.result, s.checked_at
  from public.verification_signals s
  where s.org_id = target_org and s.kind = 'photo' and s.subject_id is not null
  order by s.subject_id, s.checked_at desc;
$$;

revoke all on function public.photo_staff_marks(uuid) from public, anon, authenticated;
grant execute on function public.photo_staff_marks(uuid) to service_role;
