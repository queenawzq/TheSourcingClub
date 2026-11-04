-- Published vendors share registration and certificate files with signed-in brands.
-- Files stay in private storage and are served through short-lived signed URLs.
create function public.can_preview_vendor_document(target_document uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.documents d
    join public.factory_profiles f on f.org_id = d.org_id
    where d.id = target_document and f.published_at is not null
      and d.kind in ('business_registration', 'certificate')
      and exists (select 1 from public.org_members m join public.orgs o on o.id = m.org_id
                  where m.user_id = auth.uid() and o.type = 'brand')
  );
$$;
revoke all on function public.can_preview_vendor_document(uuid) from public;
grant execute on function public.can_preview_vendor_document(uuid) to authenticated;
create policy brand_vendor_verification_read on public.documents for select to authenticated
  using (public.can_preview_vendor_document(id));
create policy "brand vendor verification private read" on storage.objects for select to authenticated
  using (bucket_id = 'org-private' and exists (
    select 1 from public.documents d where d.bucket = bucket_id and d.storage_path = name
      and public.can_preview_vendor_document(d.id)
  ));
notify pgrst, 'reload schema';
