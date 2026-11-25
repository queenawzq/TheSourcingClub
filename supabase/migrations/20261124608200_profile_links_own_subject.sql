-- ============================================================================
-- A company links terms only to its own profile, and only its own custom terms
-- ----------------------------------------------------------------------------
-- taxonomy_links_write checks only that the writer belongs to the link's org.
-- Nothing tied a profile link's subject to that org, so a member of one
-- company could insert (factory_profile, subject_id = another vendor's org,
-- org_id = its own) and the public link policy showed the tag on the other
-- vendor's profile; nor did anything stop a link to another company's custom
-- term (the foreign key ignores RLS).
--
-- The guard, as the request links already have one (guard_rfq_subject_permission):
--   brand_profile / factory_profile: subject_id must be the link's org_id;
--   any link to a custom term: the term must belong to the link's org_id.
-- Every existing row complies (checked on the stack before writing this), so
-- nothing changes for the live site.
-- ============================================================================

create or replace function public.guard_taxonomy_link_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  term_org uuid;
begin
  if new.subject_type in ('brand_profile', 'factory_profile') and new.subject_id <> new.org_id then
    raise exception 'A profile''s tags belong to its own company' using errcode = '42501';
  end if;
  select t.org_id into term_org from public.taxonomy_terms t where t.id = new.term_id;
  if term_org is not null and term_org <> new.org_id then
    raise exception 'That option belongs to another company' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger taxonomy_links_owner
  before insert or update on public.taxonomy_links
  for each row execute function public.guard_taxonomy_link_owner();

revoke all on function public.guard_taxonomy_link_owner() from public, anon, authenticated;
