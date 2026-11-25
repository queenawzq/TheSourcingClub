-- One address per vendor: the factory's "Factory Address", the trading
-- company's "Company Address".
--
-- The full address stays where the production address already lives,
-- factory_production_addresses (members and staff only, 20261111120000),
-- written through the write-only factory_profiles.production_address. A brand
-- can read factory_profiles, so factory_profiles.location now holds only what
-- the server derives from the address: "City, Country", or the country alone
-- (src/shared/company-address.mjs brandLocation).
--
-- The parts (street, city, its English name, region, postcode, country) are
-- written by the server alone (api/structure-address.js), after a model split
-- the address and every part was found in the typed text. A changed address
-- clears them, whoever changed it (the company or staff).
--
-- Existing companies: the production address is the address; else the old
-- location (a factory's "City, Country", a trading company's headquarters) is
-- copied in. location itself is left as it is until the company saves its
-- address again. Nothing is deleted or renamed.

alter table public.factory_production_addresses
  add column if not exists street           text check (street is null or char_length(street) <= 200),
  add column if not exists city             text check (city is null or char_length(city) <= 60),
  add column if not exists city_en          text check (city_en is null or char_length(city_en) <= 60),
  add column if not exists region           text check (region is null or char_length(region) <= 120),
  add column if not exists postal_code      text check (postal_code is null or char_length(postal_code) <= 12),
  add column if not exists country_code     text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  add column if not exists country_inferred boolean not null default false,
  add column if not exists parts_source     text check (parts_source is null or parts_source in ('model', 'typed')),
  add column if not exists parts_at         timestamptz;

comment on column public.factory_production_addresses.address is
  'The vendor''s one address (factory or office), as typed. Members and staff only: a brand reads factory_profiles.location ("City, Country").';
comment on column public.factory_production_addresses.country_inferred is
  'True when no country was written and country_code came from the city or region named.';
comment on column public.factory_production_addresses.parts_source is
  'model: parts from api/structure-address.js, each found in the typed text. typed: no parts could be had, the address is kept as typed.';

-- A changed address clears its parts, so they never describe an older one.
create or replace function public.clear_address_parts()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.address is distinct from old.address and new.parts_at is not distinct from old.parts_at then
    new.street := null;
    new.city := null;
    new.city_en := null;
    new.region := null;
    new.postal_code := null;
    new.country_code := null;
    new.country_inferred := false;
    new.parts_source := null;
    new.parts_at := null;
  end if;
  return new;
end;
$$;

revoke all on function public.clear_address_parts() from public, anon, authenticated;

drop trigger if exists factory_production_addresses_clear_parts on public.factory_production_addresses;
create trigger factory_production_addresses_clear_parts
  before update on public.factory_production_addresses
  for each row execute function public.clear_address_parts();

-- The server's record of the parts, and what a brand reads. Written only when
-- the address is still the one that was split (`for_address`): a company that
-- saved again meanwhile is not given the older address's city.
create or replace function public.save_company_address_parts(
  target_org     uuid,
  for_address    text,
  parts          jsonb,
  brand_location text,
  source         text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  changed integer;
  code text := upper(nullif(trim(parts ->> 'country_code'), ''));
  shown text := nullif(trim(brand_location), '');
begin
  if source not in ('model', 'typed') then
    raise exception 'unknown parts source %', source using errcode = '22023';
  end if;
  if code is not null and code !~ '^[A-Z]{2}$' then
    code := null;
  end if;

  update public.factory_production_addresses a
     set street = nullif(trim(parts ->> 'street'), ''),
         city = nullif(trim(parts ->> 'city'), ''),
         city_en = nullif(trim(parts ->> 'city_en'), ''),
         region = nullif(trim(parts ->> 'region'), ''),
         postal_code = nullif(trim(parts ->> 'postal_code'), ''),
         country_code = code,
         country_inferred = code is not null and coalesce((parts ->> 'country_inferred')::boolean, false),
         parts_source = source,
         parts_at = now()
   where a.org_id = target_org
     and a.address = for_address;
  get diagnostics changed = row_count;
  if changed = 0 then
    return false;
  end if;

  update public.factory_profiles p
     set location = shown
   where p.org_id = target_org
     and p.location is distinct from shown;
  return true;
end;
$$;

revoke all on function public.save_company_address_parts(uuid, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.save_company_address_parts(uuid, text, jsonb, text, text) to service_role;

-- Existing vendors with a location and no address: the location is the address.
insert into public.factory_production_addresses (org_id, address, updated_at)
select p.org_id, left(trim(public.strip_invisible(p.location)), 500), coalesce(p.updated_at, now())
  from public.factory_profiles p
 where nullif(trim(public.strip_invisible(p.location)), '') is not null
   and not exists (select 1 from public.factory_production_addresses a where a.org_id = p.org_id)
on conflict (org_id) do nothing;
