-- ============================================================================
-- A company's own terms reach the people who read its profile (flow check R2V6)
-- ----------------------------------------------------------------------------
-- A term a company typed for itself ("羊绒开衫") is readable only by that
-- company (taxonomy_terms_read), so a brand reading a factory's profile could
-- read the LINK to it (taxonomy_links_public_factory_read) but not the term,
-- and the style vanished from every brand screen.
--
-- The read policy is not widened: the option lists come from the same table,
-- and another company's terms must not appear in anyone's pickers. Instead,
-- this returns the custom terms linked to subjects whose links the caller may
-- already read, by the same rules as the link policies:
--   factory_profile: a published profile, or the caller's own;
--   rfq: a request the caller can see (can_see_rfq).
-- Labels are returned as the company typed them; nothing is translated.
-- ============================================================================

create or replace function public.linked_custom_terms(p_subject_type public.taxonomy_subject, p_subject_ids uuid[])
returns table (
  id uuid,
  kind text,
  slug text,
  label_en text,
  label_zh text,
  sort integer,
  aliases text[],
  extra jsonb,
  org_id uuid
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select distinct t.id, t.kind, t.slug, t.label_en, t.label_zh, t.sort, t.aliases, t.extra, t.org_id
  from public.taxonomy_links l
  join public.taxonomy_terms t on t.id = l.term_id
  where t.org_id is not null
    and l.subject_type = p_subject_type
    and l.subject_id = any (p_subject_ids)
    and (
      (p_subject_type = 'factory_profile' and (
        l.org_id in (select public.current_org_ids())
        or exists (
          select 1 from public.factory_profiles f
          where f.org_id = l.org_id and f.published_at is not null
        )
      ))
      or (p_subject_type = 'rfq' and public.can_see_rfq(l.subject_id))
      or public.is_platform_admin()
    );
$$;

revoke all on function public.linked_custom_terms(public.taxonomy_subject, uuid[]) from public, anon;
grant execute on function public.linked_custom_terms(public.taxonomy_subject, uuid[]) to authenticated;
