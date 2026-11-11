-- ============================================================================
-- Photo and license copies: never between two demo companies (v3.1; Nov 11)
-- ----------------------------------------------------------------------------
-- The demo seed gives its companies the same placeholder files, so every
-- seeded factory came out "same license / photo as another company", Low,
-- on the preview. A copy between two orgs that are both `is_demo` is not
-- evidence of anything. A real company and a demo one still count.
-- Same signature as 20261111210000: create or replace only.
--
-- "Demo" is `orgs.is_demo`, or what scripts/seed-demo.mjs itself treats as
-- its own: a company whose first member is a demo login (demo-…@example.com
-- or .net, src/shared/demo-logins.mjs). The seed does not set is_demo.
-- ============================================================================

create or replace function public.org_is_demo(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select o.is_demo from public.orgs o where o.id = target_org), false)
      or coalesce((
           select u.email ~* '^demo-[^@]*@example\.(com|net)$'
           from public.org_members m
           join auth.users u on u.id = m.user_id
           where m.org_id = target_org
           order by m.created_at, m.user_id
           limit 1), false);
$$;

revoke all on function public.org_is_demo(uuid) from public, anon, authenticated;
grant execute on function public.org_is_demo(uuid) to service_role;

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
    and not (public.org_is_demo(mine.org_id) and public.org_is_demo(theirs.org_id))
  order by mine.document_id, 7, o.name;
$$;

revoke all on function public.photo_copies(uuid) from public, anon, authenticated;
grant execute on function public.photo_copies(uuid) to service_role;
