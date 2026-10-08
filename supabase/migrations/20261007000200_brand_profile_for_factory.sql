-- ============================================================================
-- A brand's profile as a factory sees it, and the factory's saved brands
-- ----------------------------------------------------------------------------
-- The factory's designed brand profile shows what a brand told vendors in
-- onboarding: its intro, categories, what it makes, preferred regions,
-- certifications and services, its sourcing volume and its product images.
-- `brand_profiles` stays locked to its own company, because the same row holds
-- what no vendor may read (annual revenue, business email, website, legal
-- name), and row level security cannot hide columns. So, as with
-- brand_summary_for_factory(), a factory reads it through a function that
-- returns only the safe fields, under the same test: it can see one of the
-- brand's requests. Unlike that function, this one also requires the caller
-- to belong to a factory, so one brand cannot read another's profile.
--
-- The design's "Saved brands" tab and "Save brand" button had nowhere to keep
-- anything. `saved_brands` is the factory's own list, like `saved_rfqs`: only
-- the factory that saved a brand reads or removes the row, and it can only
-- save a brand it could already see. The brand is never told who saved it.
--
-- Additive only: nothing existing changes, so the site already live keeps
-- working while this is applied.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Does the signed-in user belong to a factory that can see one of this brand's
-- requests? The one test both parts below use.
-- ---------------------------------------------------------------------------
create or replace function public.factory_can_see_brand(brand_org uuid)
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
      where m.user_id = auth.uid()
        and o.type = 'factory'
    )
    and exists (
      select 1 from public.rfqs r
      where r.brand_org_id = brand_org
        and public.can_see_rfq(r.id)
    );
$$;

revoke all on function public.factory_can_see_brand(uuid) from public, anon;
grant execute on function public.factory_can_see_brand(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- brand_profile_for_factory
-- ---------------------------------------------------------------------------
-- Returns one JSON object. Every key is listed here on purpose; anything not
-- listed (revenue, email, website, legal name, the business registration,
-- payments, members, order details) never leaves the database this way.
--
--   club_order_count    the brand's orders that weren't cancelled: a count,
--                       no factory names, products or amounts
--   open_request_count  the brand's open requests this caller can see
--   assets              logo and product images only, from the public bucket
-- ---------------------------------------------------------------------------
create or replace function public.brand_profile_for_factory(brand_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  result jsonb;
begin
  if not public.factory_can_see_brand(brand_org) then
    raise exception 'no visibility into this brand' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'org_id', o.id,
    'name', o.name,
    'hq_location', b.hq_location,
    'intro', b.intro,
    'verified', coalesce(b.verification_status = 'verified', false),
    'pieces_per_year_band', b.pieces_per_year_band,
    'order_size_band', b.order_size_band,
    'collections_per_year', b.collections_per_year,
    'reorder_cadence', b.reorder_cadence,
    'sourcing_stage', b.sourcing_stage,
    'target_price_min_cents', b.target_price_min_cents,
    'target_price_max_cents', b.target_price_max_cents,
    'term_ids', coalesce((
      select jsonb_agg(l.term_id order by l.created_at)
      from public.taxonomy_links l
      join public.taxonomy_terms t on t.id = l.term_id
      where l.subject_type = 'brand_profile'
        and l.subject_id = o.id
        and t.kind in ('brand_category', 'product_category', 'market_level', 'region', 'certification', 'service')
    ), '[]'::jsonb),
    'assets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', d.kind,
        'storage_path', d.storage_path,
        'file_name', d.file_name,
        'title', d.title,
        'caption', d.caption,
        'created_at', d.created_at
      ) order by d.created_at)
      from public.documents d
      where d.org_id = o.id
        and d.bucket = 'org-public'
        and d.kind in ('logo', 'product_image')
    ), '[]'::jsonb),
    'club_order_count', (
      select count(*)::int from public.production_orders p
      where p.brand_org_id = o.id and p.status <> 'cancelled'
    ),
    'open_request_count', (
      select count(*)::int from public.rfqs r
      where r.brand_org_id = o.id and r.status = 'open' and public.can_see_rfq(r.id)
    )
  )
  into result
  from public.orgs o
  left join public.brand_profiles b on b.org_id = o.id
  where o.id = brand_org;

  return result;
end;
$$;

revoke all on function public.brand_profile_for_factory(uuid) from public, anon;
grant execute on function public.brand_profile_for_factory(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- saved_brands
-- ---------------------------------------------------------------------------
create table public.saved_brands (
  org_id       uuid not null references public.orgs (id) on delete cascade,
  brand_org_id uuid not null references public.orgs (id) on delete cascade,
  saved_by     uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),

  primary key (org_id, brand_org_id)
);

create index saved_brands_org_idx on public.saved_brands (org_id, created_at desc);

alter table public.saved_brands enable row level security;

-- The factory's own list: nobody else reads it, the brand included.
create policy saved_brands_read on public.saved_brands
  for select to authenticated
  using (public.is_org_member(org_id));

create policy saved_brands_remove on public.saved_brands
  for delete to authenticated
  using (public.is_org_member(org_id));

-- Saved by a member of a factory, as themselves, and only a brand that
-- factory can already see through one of its requests.
create policy saved_brands_add on public.saved_brands
  for insert to authenticated
  with check (
    public.is_org_member(org_id)
    and saved_by = auth.uid()
    and exists (select 1 from public.orgs o where o.id = org_id and o.type = 'factory')
    and public.factory_can_see_brand(brand_org_id)
  );

grant select, insert, delete on public.saved_brands to authenticated;
