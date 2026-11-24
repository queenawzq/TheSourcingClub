-- Staff verification, simpler: a bilingual licence's name is any of its names.
--
-- The document reading stores a licence with two names (a Hong Kong
-- certificate's English and Chinese) as one line, the names joined with
-- " / ". A registry check recording exactly the certificate's name did not
-- settle the name difference, because it was compared with the joined text,
-- so "or record a check with the name the registry shows" was not true there.
-- Each part is now compared on its own.
--
-- registry_check_settles_reading (from 20261124370000) keeps its signature
-- and grants; nothing else changes.

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
                   -- A bilingual licence's names are stored joined with " / " (Nov 25): any one of them is the licence's.
                   or (l.document is not null and exists (
                         select 1 from unnest(string_to_array(l.document, ' / ')) as part(name)
                          where public.company_names_match(check_details ->> 'name', trim(part.name))))), false)
        end)
$$;
revoke all on function public.registry_check_settles_reading(uuid, jsonb, jsonb) from public, anon, authenticated;
