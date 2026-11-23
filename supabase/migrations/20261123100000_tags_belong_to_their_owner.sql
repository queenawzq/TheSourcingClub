-- ============================================================================
-- A request's or a profile's tags belong to the company that owns it
-- ----------------------------------------------------------------------------
-- taxonomy_links_write checks only that the caller is a member of the row's
-- org_id, and the caller writes org_id. So any company could put its own id
-- on a row and attach categories,
-- certifications or regions to another company's request or profile:
-- the owner then read them as its own, match scores moved, the owner's delete
-- removed nothing (its delete policy is on org_id too), and the primary key
-- (subject_type, subject_id, term_id) stopped it adding that term itself.
-- guard_rfq_subject_permission did not catch it: require_org_permission
-- returns quietly for a caller who is not a member.
--
-- Every writer in the product already uses the subject's owner as org_id
-- (the app's setLinks, save_matching_profile, the reorder and sourcing copies,
-- the seed). So org_id must now BE the owner, for every caller: the request's
-- brand for 'rfq', the company itself for a brand or factory profile. With
-- the existing policies (member of org_id), only the owner's members write.
-- matching_requirements needs nothing: validate_matching_requirements already
-- refuses a row whose org_id is not its subject's brand.
--
-- Rows already written by another company are deleted first: by definition
-- the owner never chose them, and they block the owner's own choice.
--
-- Additive for the live site: it never writes a row whose org_id is not the
-- owner, so it keeps working while this is applied.
-- ============================================================================

create or replace function public.taxonomy_subject_owner(kind public.taxonomy_subject, subject uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case kind
    when 'rfq' then (select r.brand_org_id from public.rfqs r where r.id = subject)
    else subject
  end;
$$;

revoke all on function public.taxonomy_subject_owner(public.taxonomy_subject, uuid) from public, anon, authenticated;

-- Rows another company wrote onto a subject it does not own.
delete from public.taxonomy_links l
 where l.org_id is distinct from public.taxonomy_subject_owner(l.subject_type, l.subject_id);

create or replace function public.guard_subject_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.org_id is distinct from public.taxonomy_subject_owner(new.subject_type, new.subject_id) then
    raise exception 'only the company that owns this request or profile can change its tags'
      using errcode = '42501', hint = 'subject_owner';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_subject_owner() from public, anon, authenticated;

create trigger taxonomy_links_subject_owner
  before insert or update of subject_type, subject_id, org_id on public.taxonomy_links
  for each row execute function public.guard_subject_owner();
