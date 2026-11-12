-- Nov 12: "Ask AI for suggestions" stops reading the checks the new review page
-- removed. The contact email domain and the duplicate-company signal are no
-- longer on the staff screen (the score card replaced them), so the model must
-- not suggest staff look at them. Same function otherwise; additive (a
-- redefinition), and the site live during the deploy reads the same shape
-- minus three keys it never required.

create or replace function public.admin_review_assist_input(target_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  org_row public.orgs;
  signed_at     timestamptz;
  signed_terms  text;
  result  jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'review help is limited to platform staff' using errcode = '42501';
  end if;

  select * into org_row from public.orgs o where o.id = target_org;
  if org_row.id is null then
    raise exception 'org not found' using errcode = 'P0002';
  end if;

  -- The row the "Terms accepted" check reads, for its date and version.
  select a.accepted_at, a.terms_version into signed_at, signed_terms
    from public.terms_acceptances a
   where a.org_id = target_org
   order by a.accepted_at desc
   limit 1;

  select jsonb_build_object(
    'today', current_date,
    'company', jsonb_build_object('name', org_row.name, 'type', org_row.type),
    'profile', coalesce(
      (select jsonb_strip_nulls(to_jsonb(f) - array['org_id', 'created_at', 'updated_at', 'published_at',
                                                    'onboarding_completed_at', 'verification_status'])
         from public.factory_profiles f where f.org_id = target_org),
      (select jsonb_strip_nulls(to_jsonb(b) - array['org_id', 'created_at', 'updated_at',
                                                    'onboarding_completed_at', 'verification_status',
                                                    'business_email'])
         from public.brand_profiles b where b.org_id = target_org),
      '{}'::jsonb),
    'categories', coalesce((
      select jsonb_object_agg(kind, labels)
        from (select t.kind, jsonb_agg(t.label_en order by t.label_en) as labels
                from public.taxonomy_links l
                join public.taxonomy_terms t on t.id = l.term_id
               where l.subject_id = target_org
                 and l.subject_type in ('factory_profile', 'brand_profile')
               group by t.kind) k), '{}'::jsonb),
    'certifications', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', t.label_en,
               'status', c.status,
               'expires_on', c.expires_at,
               'expired', c.expires_at is not null and c.expires_at < current_date,
               'file_attached', c.document_id is not null) order by t.label_en)
        from public.factory_certifications c
        join public.taxonomy_terms t on t.id = c.term_id
       where c.org_id = target_org), '[]'::jsonb),
    'files', coalesce((
      select jsonb_agg(jsonb_build_object(
               'kind', d.kind,
               'file_name', d.file_name,
               'size_bytes', coalesce(d.size_bytes, 0),
               'uploaded_on', d.created_at::date,
               'review_status', d.status) order by d.kind, d.created_at)
        from public.documents d
       where d.org_id = target_org
         and d.rfq_id is null and d.quote_id is null and d.order_id is null
         and d.message_id is null and d.milestone_update_id is null), '[]'::jsonb),
    'existing_checks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'check', c ->> 'label', 'result', c ->> 'result',
               'detail', case
                 -- The signature is a person's typed name.
                 when c ->> 'label' = 'Terms accepted' and signed_terms is not null
                   then format('Signed on %s against terms version %s.',
                               to_char(signed_at, 'DD Mon YYYY'), signed_terms)
                 else c ->> 'detail'
               end))
        from jsonb_array_elements(public.org_verification_checks(target_org)) c
       -- Removed from the review page on Nov 12: not read, so never suggested.
       where c ->> 'label' not in ('Contact domain', 'Duplicate company signal')), '[]'::jsonb),
    'registry', (
      select jsonb_strip_nulls(jsonb_build_object(
        'country', r.country_code,
        'registration_number', r.number,
        'number_read_from_document', r.number_source = 'document',
        'sole_proprietor_no_number', r.no_company_number,
        'latest_registry_check', (select jsonb_build_object('source', c.source, 'result', c.result,
                                    'checked_on', c.checked_at::date, 'note', c.note)
                                    from public.current_registry_check(target_org) c),
        'approval_blocked_by', public.registry_approval_problem(target_org),
        'other_companies_with_this_number', (select count(*) from public.registry_duplicate_orgs(target_org)),
        'document_reading', (select jsonb_build_object('result', s.result, 'read_on', s.checked_at::date,
                                     'differences', s.details -> 'differences',
                                     'trading_only_scope', (s.details #>> '{tradingScope,trading}') = 'true',
                                     'trading_words', nullif(s.details #>> '{tradingScope,quote}', ''))
                               from public.verification_signals s
                              where s.org_id = target_org and s.kind = 'document_reading' and s.automatic
                              order by s.checked_at desc limit 1),
        'trading_scope_explained', (select t.note from public.registry_trader_reviews t
                                     where t.org_id = target_org order by t.reviewed_at desc limit 1),
        'reverified_after_change', (select jsonb_agg(jsonb_build_object('changed', v.field, 'on', v.reopened_at::date))
                                      from public.verification_reopenings v where v.org_id = target_org)))
        from public.company_registrations r where r.org_id = target_org)
  ) into result;

  return result;
end;
$$;
