-- ============================================================================
-- A vendor's country follows its address, and its location is set only there.
-- ----------------------------------------------------------------------------
-- 1. save_company_address_parts (20261124400000) set the location brands read
--    ("Porto, Portugal") but left factory_profiles.country_code, which Browse
--    filters on and matching compares, at the old country. A vendor whose
--    address moved to Porto without typing "Portugal" was then shown in Porto
--    and filed under China. A country read from the address (typed, or
--    inferred from a city found in it) now sets country_code in the same
--    statement. No country read leaves it as it was.
-- 2. save_account_settings: a null location leaves the location as it is. A
--    vendor's Settings no longer sends one (its location is read from its
--    address), so a Settings save can't overwrite what the address gave. It
--    answers with the location stored.
--
-- Same signatures; create or replace keeps the grants, restated below.
-- ============================================================================

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
     set location = shown,
         country_code = coalesce(code, p.country_code)
   where p.org_id = target_org
     and (p.location is distinct from shown or p.country_code is distinct from coalesce(code, p.country_code));
  return true;
end;
$$;

revoke all on function public.save_company_address_parts(uuid, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.save_company_address_parts(uuid, text, jsonb, text, text) to service_role;

create or replace function public.save_account_settings(target_org uuid, account_name text, phone text, location text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  company public.orgs;
  stored text;
begin
  if not public.has_org_permission(target_org, 'settingsAccess') then
    raise exception 'You need Settings access to change the company''s details'
      using errcode = '42501', hint = 'missing_permission:settingsAccess';
  end if;
  if account_name is not null and nullif(btrim(account_name), '') is null then
    raise exception 'Account name is required' using errcode = '22023';
  end if;
  if length(account_name) > 200 or length($3) > 80 or length($4) > 300 then
    raise exception 'Account details are too long' using errcode = '22023';
  end if;

  select * into company from public.orgs where id = target_org;
  if account_name is not null then
    if btrim(account_name) is distinct from company.name and not public.is_org_owner(target_org) then
      raise exception 'Only a company owner can change the company''s name' using errcode = '42501';
    end if;
    update public.orgs set name = btrim(account_name) where id = target_org returning * into company;
  end if;

  insert into public.company_contact_details (org_id, phone) values (target_org, nullif(btrim($3), ''))
    on conflict (org_id) do update set phone = excluded.phone;
  if company.type = 'brand' then
    if $4 is not null then
      update public.brand_profiles set hq_location = nullif(btrim($4), '') where org_id = target_org;
    end if;
    select hq_location into stored from public.brand_profiles where org_id = target_org;
  else
    if $4 is not null then
      update public.factory_profiles set location = nullif(btrim($4), '') where org_id = target_org;
    end if;
    select p.location into stored from public.factory_profiles p where p.org_id = target_org;
  end if;
  return jsonb_build_object('name', company.name, 'phone', coalesce(nullif(btrim($3), ''), ''), 'location', coalesce(stored, ''));
end;
$$;

revoke all on function public.save_account_settings(uuid, text, text, text) from public, anon;
grant execute on function public.save_account_settings(uuid, text, text, text) to authenticated;

notify pgrst, 'reload schema';
