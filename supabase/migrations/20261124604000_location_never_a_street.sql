-- ============================================================================
-- A brand never reads a vendor's street address.
-- ----------------------------------------------------------------------------
-- Brands read factory_profiles.location (Browse, a vendor's profile, quotes,
-- orders). It is meant to hold "City, Country" (save_company_address_parts),
-- but a location written before the one-address change (20261124400000 left
-- it as it was) or by any other path could hold the full address: Browse
-- showed "Unit 4, Abbey Meadows Mills, Abbey Lane, Leicester LE4 5DQ".
--
-- A trigger now refuses a street in location, whoever writes it. A location
-- with a number or a street word in it, or with the vendor's stored street in
-- it, becomes:
--   1. "City, Country" from the address's structured parts, when they exist
--      (clear_address_parts empties them when the address changes, so parts
--      that exist belong to the current address);
--   2. else its last part, when that part is a place name (the country, as
--      written);
--   3. else the country's name (the short names countryName() uses, then the
--      taxonomy), else nothing.
-- Cities are never guessed from the old text. Existing rows are put through
-- the same rule; a row with no parts keeps the country only until its address
-- is structured again (notes/cards/2026-11-25-flowcheck/a15-production-steps.md).
-- Nothing is renamed or dropped.
-- ============================================================================

create or replace function public.location_has_street(loc text, target_org uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  folded text := lower(regexp_replace(coalesce(loc, ''), '[\s,.;:''"()/-]+', '', 'g'));
  street_folded text;
begin
  if nullif(btrim(coalesce(loc, '')), '') is null then
    return false;
  end if;
  -- The words src/shared/company-address.mjs STREET_WORDS keeps out of a city, less "st" and "duong" (they are
  -- also in St. Gallen and Binh Duong), plus the Portuguese, Spanish and Italian street words.
  if loc ~ '[0-9０-９]' or loc ~ '[路街道号號室楼樓栋棟座层層巷弄村]'
     or loc ~* '\y(road|rd|street|avenue|ave|lane|unit|floor|flat|room|suite|building|bldg|tower|block|no|po box|sokak|sok|cadde|caddesi|cad|mahalle|mahallesi|đường|phố|rua|avenida|calle|via)\y' then
    return true;
  end if;
  if target_org is null then
    return false;
  end if;
  select lower(regexp_replace(a.street, '[\s,.;:''"()/-]+', '', 'g')) into street_folded
    from public.factory_production_addresses a where a.org_id = target_org;
  return length(coalesce(street_folded, '')) >= 4 and position(street_folded in folded) > 0;
end;
$$;

revoke all on function public.location_has_street(text, uuid) from public, anon, authenticated;

-- The English name brands read for a country code: countryName()'s short names first (Hong Kong and Macau are not
-- in the taxonomy), then the taxonomy's.
create or replace function public.brand_country_name(code text)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case upper(code)
    when 'HK' then 'Hong Kong' when 'MO' then 'Macau' when 'TW' then 'Taiwan'
    when 'US' then 'United States' when 'GB' then 'United Kingdom' when 'KR' then 'South Korea'
    else (select t.label_en from public.taxonomy_terms t
           where t.kind = 'country' and t.extra ->> 'code' = upper(code) limit 1)
  end
$$;

revoke all on function public.brand_country_name(text) from public, anon, authenticated;

create or replace function public.location_without_street(loc text, code text, target_org uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  last_part text := btrim(regexp_replace(coalesce(loc, ''), '^.*[,，]', ''));
  parts record;
  country_words text;
begin
  if not public.location_has_street(loc, target_org) then
    return loc;
  end if;
  select a.city_en, coalesce(a.country_code, upper(code)) as cc into parts
    from public.factory_production_addresses a
   where a.org_id = target_org and a.parts_source is not null;
  country_words := public.brand_country_name(parts.cc);
  if parts.city_en ~ '^[A-Za-z][A-Za-z .''-]*$' and country_words is not null
     and lower(parts.city_en) <> lower(country_words)
     and not public.location_has_street(parts.city_en, null) then
    return parts.city_en || ', ' || country_words;
  end if;
  if last_part <> '' and position(',' in loc) + position('，' in loc) > 0
     and not public.location_has_street(last_part, target_org) then
    return last_part;
  end if;
  return public.brand_country_name(code);
end;
$$;

revoke all on function public.location_without_street(text, text, uuid) from public, anon, authenticated;

-- Runs as its owner: the helpers above are not granted to the people whose writes it checks.
create or replace function public.guard_factory_location()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.location := public.location_without_street(new.location, new.country_code, new.org_id);
  return new;
end;
$$;

revoke all on function public.guard_factory_location() from public, anon, authenticated;

drop trigger if exists factory_profiles_location_guard on public.factory_profiles;
create trigger factory_profiles_location_guard
  before insert or update of location on public.factory_profiles
  for each row execute function public.guard_factory_location();

-- Existing rows, through the same rule (the trigger does the work).
update public.factory_profiles p
   set location = p.location
 where public.location_has_street(p.location, p.org_id);
