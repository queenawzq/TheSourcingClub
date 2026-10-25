-- ============================================================================
-- Admin AI help: no person's name, and no other customer, in what it reads
-- ----------------------------------------------------------------------------
-- admin_review_assist_input() (20261016000100) passed the evidence checks'
-- detail lines through as they are. Two of them name someone:
--
--   "Terms accepted" quotes the signature: Signed "Jane Doe" on ...
--   "Duplicate company signal" lists the OTHER companies that share a legal
--   name or website domain.
--
-- The privacy policy published with that migration says no one's name or
-- email address goes to the model, and the other companies are not part of
-- the submission being reviewed. So those two lines are rewritten here, from
-- the same rows, without the names: the date and terms version stay, and the
-- duplicate check still says there is one. Every other line is unchanged.
--
-- Same signature and shape; only the two details differ. Staff still see the
-- full lines on the review page, which reads org_verification_checks().
-- ============================================================================

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
                || jsonb_strip_nulls(jsonb_build_object(
                     'business_email_domain', nullif(split_part(lower(b.business_email), '@', 2), '')))
         from public.brand_profiles b where b.org_id = target_org),
      '{}'::jsonb),
    'member_email_domains', coalesce((
      select jsonb_agg(distinct split_part(lower(u.email), '@', 2))
        from public.org_members m
        join auth.users u on u.id = m.user_id
       where m.org_id = target_org and u.email like '%@%'), '[]'::jsonb),
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
                 -- The names are other customers'.
                 when c ->> 'label' = 'Duplicate company signal' and c ->> 'result' <> 'Clear'
                   then 'Shares a legal name or website domain with at least one other company on the platform.'
                 else c ->> 'detail'
               end))
        from jsonb_array_elements(public.org_verification_checks(target_org)) c), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

revoke all on function public.admin_review_assist_input(uuid) from public, anon;
grant execute on function public.admin_review_assist_input(uuid) to authenticated;
