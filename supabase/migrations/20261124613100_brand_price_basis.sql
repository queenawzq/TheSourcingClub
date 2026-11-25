-- ============================================================================
-- The brand's price range keeps its shipping basis ("$14-$26 FOB per unit")
-- ----------------------------------------------------------------------------
-- The designed field is one box ("e.g. $12-$28 FOB per unit"). Only the two
-- numbers were stored, so the profile and the vendor's view showed
-- "$14 - $26 per unit": FOB against landed changes the number a vendor
-- compares. The basis is the Incoterms 2020 code read from the same box
-- (src/lib/domain/brand-profile-fields.js), or null when none is named.
--
-- Additive: a new nullable column, and brand_profile_for_factory() returns one
-- more key. The live site ignores both.
-- ============================================================================

alter table public.brand_profiles
  add column if not exists target_price_basis text
    check (target_price_basis in ('EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'));

comment on column public.brand_profiles.target_price_basis is
  'Incoterm the typed price range is quoted on (FOB, DDP, ...), or null.';

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
    'target_price_basis', b.target_price_basis,
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
