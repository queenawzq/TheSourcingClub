-- ============================================================================
-- 004  Documents, storage, and verification review
-- ----------------------------------------------------------------------------
-- Two buckets, deliberately separated before the first real upload:
--
--   org-public   logos, product photos, showcase imagery. Served directly.
--   org-private  business registrations, certificates, tech packs, contracts.
--                Reachable only through a signed URL.
--
-- The split matters because it is effectively irreversible. A business
-- registration that lands in a public bucket may be cached or indexed long
-- after the mistake is noticed, and the factory whose document it is has no
-- way to un-publish it.
--
-- Object paths are always {org_id}/{rest}, which is what the storage policies
-- below key on.
-- ============================================================================

create type public.document_kind as enum (
  'logo',
  'product_image',
  'brand_direction',
  'business_registration',
  'certificate',
  'tech_pack',
  'sketch',
  'reference_image',
  'measurement_chart',
  'quote_attachment',
  'milestone_update',
  'contract',
  'other'
);

create table public.documents (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs (id) on delete cascade,

  kind          public.document_kind not null,
  bucket        text not null check (bucket in ('org-public', 'org-private')),
  storage_path  text not null,

  file_name     text not null,
  mime_type     text,
  size_bytes    bigint check (size_bytes >= 0),

  -- Only meaningful for documents that get reviewed: registrations and
  -- certificates. Everything else stays 'unverified' and nobody looks.
  status        public.verification_status not null default 'unverified',
  reviewed_by   uuid references auth.users (id) on delete set null,
  reviewed_at   timestamptz,
  review_note   text,

  uploaded_by   uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),

  unique (bucket, storage_path)
);

create index documents_org_idx    on public.documents (org_id, kind);
create index documents_review_idx on public.documents (status)
  where kind in ('business_registration', 'certificate');

-- ---------------------------------------------------------------------------
-- Certifications a factory claims, each optionally backed by a document
-- ---------------------------------------------------------------------------
-- The prototypes represent certification status three different ways
-- ('pending'/'uploaded' lowercase in onboarding, 'Verified'/'Uploaded'/'Not
-- uploaded' capitalised on the profile). One enum, one representation.
-- ---------------------------------------------------------------------------

create table public.factory_certifications (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs (id) on delete cascade,
  term_id     uuid not null references public.taxonomy_terms (id) on delete cascade,
  document_id uuid references public.documents (id) on delete set null,
  status      public.verification_status not null default 'unverified',
  expires_at  date,
  created_at  timestamptz not null default now(),
  unique (org_id, term_id)
);

create index factory_certifications_org_idx on public.factory_certifications (org_id);

-- ---------------------------------------------------------------------------
-- Admin review
-- ---------------------------------------------------------------------------

create or replace function public.review_document(
  document_id uuid,
  decision    public.verification_status,
  note        text default null
)
returns public.documents
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  reviewed public.documents;
begin
  if not public.is_platform_admin() then
    raise exception 'only platform admins may review documents'
      using errcode = '42501';
  end if;

  if decision not in ('verified', 'rejected', 'pending') then
    raise exception 'review decision must be verified, rejected or pending'
      using errcode = '22023';
  end if;

  update public.documents
     set status = decision,
         reviewed_by = auth.uid(),
         reviewed_at = now(),
         review_note = note
   where id = document_id
  returning * into reviewed;

  if not found then
    raise exception 'document not found' using errcode = 'P0002';
  end if;

  -- A verified business registration verifies the org itself. This is the
  -- gate that decides whether a factory may quote on open RFQs.
  if reviewed.kind = 'business_registration' then
    update public.factory_profiles
       set verification_status = decision
     where org_id = reviewed.org_id;

    update public.brand_profiles
       set verification_status = decision
     where org_id = reviewed.org_id;
  end if;

  if reviewed.kind = 'certificate' then
    update public.factory_certifications
       set status = decision
     where document_id = reviewed.id;
  end if;

  return reviewed;
end;
$$;

revoke all on function public.review_document(uuid, public.verification_status, text) from public;
grant execute on function public.review_document(uuid, public.verification_status, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Row level security on the metadata table
-- ---------------------------------------------------------------------------

alter table public.documents              enable row level security;
alter table public.factory_certifications enable row level security;

create policy documents_own on public.documents
  for all to authenticated
  using (public.is_org_member(org_id) or public.is_platform_admin())
  with check (public.is_org_member(org_id));

-- Public-bucket imagery on a published factory profile is readable by anyone
-- signed in. Private documents are never covered by this.
create policy documents_public_read on public.documents
  for select to authenticated
  using (
    bucket = 'org-public'
    and exists (
      select 1 from public.factory_profiles f
      where f.org_id = documents.org_id
        and f.published_at is not null
    )
  );

create policy certifications_read on public.factory_certifications
  for select to authenticated
  using (
    public.is_org_member(org_id)
    or public.is_platform_admin()
    or exists (
      select 1 from public.factory_profiles f
      where f.org_id = factory_certifications.org_id
        and f.published_at is not null
    )
  );

create policy certifications_write on public.factory_certifications
  for all to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

grant select, insert, update, delete on public.documents              to authenticated;
grant select, insert, update, delete on public.factory_certifications to authenticated;

-- ============================================================================
-- Storage buckets and their policies
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'org-public', 'org-public', true, 10485760,
    array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
  ),
  (
    'org-private', 'org-private', false, 52428800,
    array[
      'image/png', 'image/jpeg', 'image/webp',
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'application/zip'
    ]
  )
on conflict (id) do nothing;

-- The first path segment is the owning org id. Everything below keys on it.
create or replace function public.storage_path_org(object_name text)
returns uuid
language sql
immutable
as $$
  select nullif(split_part(object_name, '/', 1), '')::uuid;
$$
;

-- org-public: members write their own folder, any signed-in user may read.
create policy "org public read" on storage.objects
  for select to authenticated
  using (bucket_id = 'org-public');

create policy "org public write" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'org-public'
    and public.is_org_member(public.storage_path_org(name))
  );

create policy "org public update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'org-public'
    and public.is_org_member(public.storage_path_org(name))
  );

create policy "org public delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'org-public'
    and public.is_org_member(public.storage_path_org(name))
  );

-- org-private: only the owning org and platform admins, in every direction.
create policy "org private read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'org-private'
    and (
      public.is_org_member(public.storage_path_org(name))
      or public.is_platform_admin()
    )
  );

create policy "org private write" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'org-private'
    and public.is_org_member(public.storage_path_org(name))
  );

create policy "org private update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'org-private'
    and public.is_org_member(public.storage_path_org(name))
  );

create policy "org private delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'org-private'
    and public.is_org_member(public.storage_path_org(name))
  );
