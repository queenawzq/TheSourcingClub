-- Verification v3.1 (Nov 11): staff see the factory's workshop photos.
--
-- admin_verification_signals().photos listed only product images and the
-- walkthrough from the public bucket. It now lists the 'factory_photo'
-- documents too (private bucket), in the same shape, so staff can open them
-- and record "Own photos" on them (admin_record_signal already takes any of
-- the company's documents). Every other field is as in 20261108700000.

create or replace function public.admin_verification_signals(target_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'only platform admins may read verification checks' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'signals', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'kind', s.kind, 'subjectId', s.subject_id, 'result', s.result, 'note', s.note,
        'details', s.details, 'automatic', s.automatic, 'checkedAt', s.checked_at,
        'checkedBy', coalesce(nullif(p.full_name, ''), u.email::text))
        order by s.checked_at desc)
        from public.verification_signals s
        left join auth.users u on u.id = s.checked_by
        left join public.user_profiles p on p.id = s.checked_by
       where s.org_id = target_org), '[]'::jsonb),
    'photos', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'bucket', d.bucket, 'path', d.storage_path, 'name', d.file_name, 'kind', d.kind)
        order by d.created_at)
        from public.documents d
       where d.org_id = target_org
         and ((d.kind in ('product_image', 'walkthrough') and d.bucket = 'org-public')
              -- Workshop and production line photos, in the private bucket;
              -- staff open them by signed URL. Compared as text, like
              -- admin_org_documents.
              or d.kind::text = 'factory_photo')
         and coalesce(d.mime_type, 'image/') like 'image/%'), '[]'::jsonb),
    'registrationFiles', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'bucket', d.bucket, 'path', d.storage_path, 'name', d.file_name,
                                          'mimeType', d.mime_type, 'createdAt', d.created_at)
        order by d.created_at desc)
        from public.documents d
       where d.org_id = target_org and d.kind = 'business_registration'), '[]'::jsonb),
    'certificates', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'slug', t.slug, 'label', t.label_en,
                                          'expiresAt', c.expires_at, 'status', c.status,
                                          'document', case when d.id is null then null else
                                            jsonb_build_object('id', d.id, 'bucket', d.bucket, 'path', d.storage_path, 'name', d.file_name, 'mimeType', d.mime_type) end)
        order by t.label_en)
        from public.factory_certifications c
        join public.taxonomy_terms t on t.id = c.term_id
        left join public.documents d on d.id = c.document_id
       where c.org_id = target_org), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.admin_verification_signals(uuid) from public, anon;
grant execute on function public.admin_verification_signals(uuid) to authenticated;
