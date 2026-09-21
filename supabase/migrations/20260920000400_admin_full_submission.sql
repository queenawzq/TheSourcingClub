-- ============================================================================
-- Everything a company submitted, for the person reviewing it
-- ----------------------------------------------------------------------------
-- The review screen has a modal titled "Full onboarding submission". It was
-- not one. It read a six-entry `details` list built for the summary panel --
-- legal name, website, location, profile status, last note, decided -- and
-- looked up eight keys that were never in it, so "Year founded", "Team size",
-- "Typical MOQ", "Production lead time", "Business type", "Target FOB" and
-- "Annual volume" all rendered as an em dash. Three figures were not even
-- looked up: "10-14 days", "7,200 units" and "$15,000-$40,000" were literals
-- in the markup, shown under the heading of whichever company was open.
--
-- A reviewer deciding whether a company may trade was therefore reading a
-- fabricated capacity figure and a row of dashes where the answers were.
--
-- This returns the submission itself. Whole rows as jsonb rather than a
-- hand-picked column list, because a curated list is exactly how the first
-- eight fields went missing: a field added to onboarding tomorrow appears
-- here without anyone remembering to add it.
-- ============================================================================
create or replace function public.admin_verification_detail(target_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  result jsonb;
begin
  -- First statement, before any select: checking afterwards leaks whether a
  -- row exists through the difference between P0002 and 42501.
  if not public.is_platform_admin() then
    raise exception 'this submission is limited to platform staff' using errcode = '42501';
  end if;

  if not exists (select 1 from public.orgs o where o.id = target_org) then
    raise exception 'org not found' using errcode = 'P0002';
  end if;

  select jsonb_build_object(
    'orgId', target_org,

    'org', (select to_jsonb(o) from public.orgs o where o.id = target_org),

    -- Whichever one exists. A company is a brand or a vendor, never both.
    'profile', coalesce(
      (select to_jsonb(f) from public.factory_profiles f where f.org_id = target_org),
      (select to_jsonb(b) from public.brand_profiles  b where b.org_id = target_org)),

    -- Who filled it in, and how to reach them.
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', p.full_name,
               'email', p.email,
               'role', m.role,
               'locale', p.locale) order by m.role, p.full_name)
        from public.org_members m
        join public.user_profiles p on p.id = m.user_id
       where m.org_id = target_org
    ), '[]'::jsonb),

    -- Selections, grouped by the question that was asked rather than flattened
    -- into one list: "Production types: cut and sew, knitwear" is what the
    -- vendor answered; a single undifferentiated chip row is not.
    'selections', coalesce((
      select jsonb_object_agg(kind, labels)
        from (
          select k.label_en as kind,
                 jsonb_agg(t.label_en order by t.label_en) as labels
            from public.taxonomy_links l
            join public.taxonomy_terms t on t.id = l.term_id
            join public.taxonomy_kinds k on k.kind = t.kind
           where l.org_id = target_org
             and l.subject_type in ('brand_profile', 'factory_profile')
           group by k.label_en
        ) grouped
    ), '{}'::jsonb),

    'certifications', coalesce((
      select jsonb_agg(jsonb_build_object(
               'label', t.label_en,
               'status', c.status,
               'expiresAt', c.expires_at,
               'documentId', c.document_id) order by t.label_en)
        from public.factory_certifications c
        join public.taxonomy_terms t on t.id = c.term_id
       where c.org_id = target_org
    ), '[]'::jsonb),

    -- Declared capacity, with the reference style it was derived from. The
    -- units figure is what the factory told us, not a guess.
    'capacity', (
      select jsonb_build_object(
               'inputMode', c.input_mode,
               'lineHours', c.line_hours,
               'monthlyUnits', c.monthly_units,
               'category', t.label_en)
        from public.factory_capacity c
        left join public.taxonomy_terms t on t.id = c.category_term_id
       where c.org_id = target_org),

    'capacityMonths', coalesce((
      select jsonb_agg(jsonb_build_object('month', m.month, 'level', m.level)
                       order by m.month)
        from public.factory_capacity_months m
       where m.org_id = target_org
    ), '[]'::jsonb),

    'references', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.sort)
        from public.profile_references r
       where r.org_id = target_org
    ), '[]'::jsonb),

    'showcase', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.sort)
        from public.profile_showcase_items s
       where s.org_id = target_org
    ), '[]'::jsonb),

    -- What they signed, and when. Previously rendered as the literal
    -- "Signed electronically, Aug 12" with a made-up signatory name.
    -- "Decision makers" on the brand flow. The name and role typed into that
    -- modal are still dropped by the screen; the address is what reaches us.
    'invitations', coalesce((
      select jsonb_agg(jsonb_build_object(
               'email', i.email,
               'role', i.role,
               'status', i.status,
               'createdAt', i.created_at) order by i.created_at)
        from public.org_invitations i
       where i.org_id = target_org
    ), '[]'::jsonb),

    'terms', (
      select jsonb_build_object(
               'signature', a.signature,
               'version', a.terms_version,
               'acceptedAt', a.accepted_at,
               'signedBy', p.full_name)
        from public.terms_acceptances a
        left join public.user_profiles p on p.id = a.accepted_by
       where a.org_id = target_org
       order by a.accepted_at desc
       limit 1)
  ) into result;

  return result;
end;
$$;

revoke all on function public.admin_verification_detail(uuid) from public;
grant execute on function public.admin_verification_detail(uuid) to authenticated;
