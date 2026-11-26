-- Staff edit a company's legal name where Review details shows it (Nov 26),
-- the same way as its name, country and website: one history line
-- (`legal_name`, {from, to}) and one notice to the company.
--
-- The registry and licence checks compare the legal name (company_title()):
-- an empty legal name clears it, and the checks then use the company name.
-- Factories keep theirs in factory_profiles.legal_name, brands in
-- brand_profiles.legal_name; company_title() now reads a brand's too.
--
-- admin_update_company_profile gains a seventh argument. The six-argument
-- form is dropped first (PostgREST refuses overloads) and the grants are
-- restated as before.

-- ---------------------------------------------------------------------------
-- 1. The name the checks use: the legal name, a factory's or a brand's
-- ---------------------------------------------------------------------------

create or replace function public.company_title(target_org uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(nullif(trim(f.legal_name), ''), nullif(trim(b.legal_name), ''), o.name)
    from public.orgs o
    left join public.factory_profiles f on f.org_id = o.id
    left join public.brand_profiles b on b.org_id = o.id
   where o.id = target_org
$$;

revoke all on function public.company_title(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. History kind
-- ---------------------------------------------------------------------------

alter table public.org_review_changes drop constraint if exists org_review_changes_kind_check;
alter table public.org_review_changes add constraint org_review_changes_kind_check
  check (kind in ('registry_check', 'certificate_check', 'vendor_kind', 'address',
                  'address_check', 'scope_check', 'licence_check', 'decision',
                  'company_name', 'country', 'website', 'legal_name'));

-- ---------------------------------------------------------------------------
-- 3. admin_update_company_profile, with the legal name
-- ---------------------------------------------------------------------------

drop function if exists public.admin_update_company_profile(uuid, text, text, text, text, text);

-- Only the arguments given change. Type and address are a vendor's; name,
-- legal name, country and website any company's. A country is a code or a
-- name from the country list ("PT", "Portugal"); for a factory it sets
-- country_code and the location's last part, for a brand the location's last
-- part. An empty website or legal name clears it; an empty name or country is
-- refused. One history line per changed field and one notice to the company.
create function public.admin_update_company_profile(
  target_org   uuid,
  vendor_kind  text default null,
  address      text default null,
  company_name text default null,
  country      text default null,
  website      text default null,
  legal_name   text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  new_kind text := nullif(trim(coalesce(vendor_kind, '')), '');
  new_address text := nullif(trim(coalesce(address, '')), '');
  new_name text := trim(company_name);
  new_country text := trim(country);
  new_website text := nullif(trim(coalesce(website, '')), '');
  new_legal text := nullif(trim(coalesce(legal_name, '')), '');
  company public.orgs;
  old_kind text;
  old_address text;
  old_location text;
  old_country text;
  old_website text;
  old_legal text;
  country_code_new text;
  country_label text;
  kind_changed boolean := false;
  address_changed boolean := false;
  name_changed boolean := false;
  country_changed boolean := false;
  website_changed boolean := false;
  legal_changed boolean := false;
begin
  if not public.is_platform_admin() then
    raise exception 'only platform admins may change a company''s profile' using errcode = '42501';
  end if;
  if public.is_org_member(target_org) then
    raise exception 'staff cannot review a company they belong to' using errcode = '42501';
  end if;
  select * into company from public.orgs o where o.id = target_org;
  if not found then
    raise exception 'company not found' using errcode = 'P0002';
  end if;
  if new_kind is null and new_address is null and company_name is null and country is null
     and website is null and legal_name is null then
    raise exception 'nothing to change' using errcode = '22023';
  end if;
  if company.type <> 'factory' and (new_kind is not null or new_address is not null) then
    raise exception 'only a vendor has a type and an address to change' using errcode = '22023';
  end if;
  if new_kind is not null and new_kind not in ('manufacturer', 'trading_company') then
    raise exception 'type must be Factory or Trading company' using errcode = '22023';
  end if;
  if char_length(coalesce(new_address, '')) > 500 then
    raise exception 'address is too long' using errcode = '22023';
  end if;
  if company_name is not null and new_name = '' then
    raise exception 'Enter the company name' using errcode = '22023';
  end if;
  if char_length(coalesce(new_name, '')) > 200 then
    raise exception 'The company name is too long' using errcode = '22023';
  end if;
  if char_length(coalesce(new_legal, '')) > 200 then
    raise exception 'The legal name is too long' using errcode = '22023';
  end if;
  if char_length(coalesce(new_website, '')) > 300 then
    raise exception 'The website is too long' using errcode = '22023';
  end if;
  if country is not null then
    select t.extra ->> 'code', t.label_en into country_code_new, country_label
      from public.taxonomy_terms t
     where t.kind = 'country'
       and (upper(t.extra ->> 'code') = upper(new_country) or lower(t.label_en) = lower(new_country))
     order by (upper(t.extra ->> 'code') = upper(new_country)) desc
     limit 1;
    if country_label is null then
      raise exception 'Choose a country from the list' using errcode = '22023';
    end if;
  end if;

  if company.type = 'factory' then
    select f.vendor_kind::text, f.location, f.website_url, f.legal_name into old_kind, old_location, old_website, old_legal
      from public.factory_profiles f where f.org_id = target_org;
    select a.address into old_address from public.factory_production_addresses a where a.org_id = target_org;
  else
    select b.hq_location, b.website_url, b.legal_name into old_location, old_website, old_legal
      from public.brand_profiles b where b.org_id = target_org;
  end if;
  old_country := nullif(trim(regexp_replace(coalesce(old_location, ''), '^.*,', '')), '');
  old_legal := nullif(trim(coalesce(old_legal, '')), '');

  if new_kind is not null and new_kind is distinct from old_kind then
    update public.factory_profiles f set vendor_kind = new_kind::public.vendor_kind where f.org_id = target_org;
    insert into public.org_review_changes (org_id, kind, details, changed_by)
    values (target_org, 'vendor_kind', jsonb_strip_nulls(jsonb_build_object('from', old_kind, 'to', new_kind)), auth.uid());
    kind_changed := true;
  end if;
  if new_address is not null and new_address is distinct from old_address then
    insert into public.factory_production_addresses (org_id, address, updated_by, updated_at)
    values (target_org, new_address, auth.uid(), now())
    on conflict (org_id) do update set address = excluded.address, updated_by = excluded.updated_by, updated_at = now();
    insert into public.org_review_changes (org_id, kind, details, changed_by)
    values (target_org, 'address', jsonb_strip_nulls(jsonb_build_object('from', old_address, 'to', new_address)), auth.uid());
    address_changed := true;
  end if;
  if company_name is not null and new_name is distinct from company.name then
    update public.orgs o set name = new_name where o.id = target_org;
    insert into public.org_review_changes (org_id, kind, details, changed_by)
    values (target_org, 'company_name', jsonb_build_object('from', company.name, 'to', new_name), auth.uid());
    name_changed := true;
  end if;
  if legal_name is not null and new_legal is distinct from old_legal then
    if company.type = 'factory' then
      insert into public.factory_profiles as f (org_id, legal_name) values (target_org, new_legal)
      on conflict (org_id) do update set legal_name = excluded.legal_name;
    else
      insert into public.brand_profiles as b (org_id, legal_name) values (target_org, new_legal)
      on conflict (org_id) do update set legal_name = excluded.legal_name;
    end if;
    insert into public.org_review_changes (org_id, kind, details, changed_by)
    values (target_org, 'legal_name', jsonb_strip_nulls(jsonb_build_object('from', old_legal, 'to', new_legal)), auth.uid());
    legal_changed := true;
  end if;
  if country is not null and (old_country is distinct from country_label
      or (company.type = 'factory' and exists (select 1 from public.factory_profiles f
                                                 where f.org_id = target_org
                                                   and f.country_code is distinct from country_code_new))) then
    if company.type = 'factory' then
      insert into public.factory_profiles as f (org_id, country_code, location)
      values (target_org, country_code_new, country_label)
      on conflict (org_id) do update
        set country_code = excluded.country_code,
            location = public.location_with_country(f.location, country_label);
    else
      insert into public.brand_profiles as b (org_id, hq_location)
      values (target_org, country_label)
      on conflict (org_id) do update
        set hq_location = public.location_with_country(b.hq_location, country_label);
    end if;
    insert into public.org_review_changes (org_id, kind, details, changed_by)
    values (target_org, 'country', jsonb_strip_nulls(jsonb_build_object('from', old_country, 'to', country_label)), auth.uid());
    country_changed := true;
  end if;
  if website is not null and new_website is distinct from nullif(trim(coalesce(old_website, '')), '') then
    if company.type = 'factory' then
      insert into public.factory_profiles as f (org_id, website_url) values (target_org, new_website)
      on conflict (org_id) do update set website_url = excluded.website_url;
    else
      insert into public.brand_profiles as b (org_id, website_url) values (target_org, new_website)
      on conflict (org_id) do update set website_url = excluded.website_url;
    end if;
    insert into public.org_review_changes (org_id, kind, details, changed_by)
    values (target_org, 'website', jsonb_strip_nulls(jsonb_build_object('from', old_website, 'to', new_website)), auth.uid());
    website_changed := true;
  end if;

  if kind_changed or address_changed or name_changed or legal_changed or country_changed or website_changed then
    insert into public.notifications (org_id, kind, subject_type, subject_id, title, body)
    values (target_org, 'profile_updated', 'org', target_org, 'Your company profile was updated',
            concat_ws(' ',
              case when name_changed then 'We updated your company name.' end,
              case when legal_changed then 'We updated your legal name.' end,
              case when kind_changed then 'We updated your company type to '
                   || case new_kind when 'trading_company' then 'trading company' else 'factory' end || '.' end,
              case when address_changed then 'We updated your company address.' end,
              case when country_changed then 'We updated your country.' end,
              case when website_changed then 'We updated your website.' end));
  end if;
  return jsonb_build_object(
    'vendorKind', coalesce(new_kind, old_kind),
    'kindChanged', kind_changed, 'addressChanged', address_changed,
    'nameChanged', name_changed, 'legalNameChanged', legal_changed,
    'countryChanged', country_changed, 'websiteChanged', website_changed);
end;
$$;
revoke all on function public.admin_update_company_profile(uuid, text, text, text, text, text, text) from public, anon;
grant execute on function public.admin_update_company_profile(uuid, text, text, text, text, text, text) to authenticated;
