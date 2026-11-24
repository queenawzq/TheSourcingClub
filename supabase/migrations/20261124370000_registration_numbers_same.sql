-- Staff verification, simpler: the same registration number written two ways
-- is no difference, by the country's own rule.
--
-- A Hong Kong company types its 8-digit Business Registration number; its
-- certificate prints the full number (71234567-000-11-25-6). Every Hong Kong
-- company was held at "the number differs from the licence" until staff
-- explained it. An EU VAT number is likewise the country's prefix and the
-- national number (ESB12345678, B12345678).
--
-- registration_numbers_same() is sameRegistrationNumber() in
-- src/shared/registration-number.mjs; keep them identical. The reading's
-- number difference is settled when the licence's number and the company's
-- are the same by it, also on readings stored before this rule.
--
-- Additive: registry_check_settles_reading (from 20261124360000) keeps its
-- signature and grants; one new function.

create or replace function public.registration_numbers_same(country text, a text, b text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  with n as (
    select public.normalise_registration_number(country, a) as x, public.normalise_registration_number(country, b) as y
  ),
  s as (
    select x, y,
           case when length(x) <= length(y) then x else y end as short,
           case when length(x) <= length(y) then y else x end as long
      from n
  )
  select coalesce(x <> '' and y <> '' and (
           x = y
           or (country = 'HK' and short ~ '^\d{8}$' and long ~ '^\d{9,}$' and left(long, 8) = short)
           or (country in ('AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU',
                           'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK')
               and long = country || short)
           or (country = 'GR' and long = 'EL' || short)), false)
    from s
$$;
grant execute on function public.registration_numbers_same(text, text, text) to authenticated, service_role;

create or replace function public.registry_check_settles_reading(target_org uuid, check_details jsonb, reading jsonb)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with reg as (
    select r.country_code, r.number from public.company_registrations r where r.org_id = target_org
  ),
  lines as (
    select d ->> 'field' as field, nullif(trim(coalesce(d ->> 'document', '')), '') as document
      from jsonb_array_elements(case when jsonb_typeof(reading -> 'differences') = 'array' then reading -> 'differences' else '[]'::jsonb end) d
     where coalesce((d ->> 'nearly')::boolean, false) = false
  )
  select coalesce(check_details ->> 'outcome', 'found') = 'found'
     and exists (select 1 from lines)
     and not exists (
       select 1 from lines l
        where case
          when l.field = 'number' then not coalesce(
            -- The licence writes the company's own number another way (Nov 25): no difference at all.
            (select public.registration_numbers_same(coalesce(reg.country_code, ''), l.document, reg.number) from reg)
            or ((select public.normalise_registration_number(coalesce(reg.country_code, ''), check_details ->> 'number') = reg.number from reg)
                and nullif(trim(coalesce(check_details ->> 'number', '')), '') is not null), false)
          else not coalesce(
            nullif(trim(coalesce(check_details ->> 'name', '')), '') is not null
              and (public.company_names_match(check_details ->> 'name', public.company_title(target_org))
                   or (l.document is not null and public.company_names_match(check_details ->> 'name', l.document))), false)
        end)
$$;
revoke all on function public.registry_check_settles_reading(uuid, jsonb, jsonb) from public, anon, authenticated;
