-- ============================================================================
-- 025  Published factories are nameable
-- ----------------------------------------------------------------------------
-- factory_profiles has admitted published profiles to any signed-in user since
-- migration 003 — that is what makes a directory possible. But the org row
-- carrying the NAME was still restricted, so a brand choosing who to invite
-- would see a list of profiles with no names on them.
--
-- Consistent with the existing rule rather than a new one: if the profile is
-- public, the name on it is too. Everything on orgs is a public identifier —
-- id, type, name, slug — so there is nothing here to redact, which is why a
-- row policy suffices where brand_profiles needed a function.
--
-- An unpublished factory stays invisible, name included.
--
-- Scoped to BRANDS. The first version of this policy admitted any signed-in
-- user and the test suite immediately caught what that meant: one factory
-- could read a competitor's org row. Brands need the directory to choose who
-- to invite; factories have no reason to browse each other, and competitor
-- isolation is a rule worth keeping narrow.
-- ============================================================================

-- Definer, because reading orgs to find out what kind of org the caller
-- belongs to would re-enter the orgs policy and recurse.
create or replace function public.caller_has_brand_org()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.org_members m
    join public.orgs o on o.id = m.org_id
    where m.user_id = auth.uid() and o.type = 'brand'
  );
$$;

revoke all on function public.caller_has_brand_org() from public;
grant execute on function public.caller_has_brand_org() to authenticated;

create policy orgs_published_factory_read on public.orgs
  for select to authenticated
  using (
    public.caller_has_brand_org()
    and exists (
      select 1 from public.factory_profiles f
      where f.org_id = orgs.id and f.published_at is not null
    )
  );
