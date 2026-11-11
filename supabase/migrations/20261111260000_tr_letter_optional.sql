-- v3.1 (tester, Nov 11): Turkish factories with a tax plate (vergi levhası) were stuck:
-- the save still required the letter number the plate doesn't have.

create or replace function public.save_company_registration(
  target_org     uuid,
  country        text,
  number         text,
  access_code    text default null,
  registration_letter_number text default null,
  confirmed      boolean default false,
  no_number      boolean default false
)
returns public.company_registrations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cc text := nullif(upper(trim(coalesce(country, ''))), '');
  problem text;
  code_digits text := regexp_replace(coalesce(access_code, ''), '\D', '', 'g');
  letter text := upper(regexp_replace(public.strip_invisible(registration_letter_number), '\s+', '', 'g'));
  -- China: nothing typed means "read it off the licence".
  from_document boolean := cc = 'CN' and public.normalise_registration_number(cc, number) = '';
  saved public.company_registrations;
begin
  if not public.has_org_permission(target_org, 'settingsAccess') then
    raise exception 'only the company''s owner or someone with Settings access may save its registration'
      using errcode = '42501';
  end if;
  if cc is not null and cc !~ '^[A-Z]{2}$' then
    raise exception 'country must be a two-letter code' using errcode = '22023';
  end if;

  problem := case when coalesce(no_number, false) or from_document then null else public.registration_number_problem(cc, number) end;
  if problem = 'check_digit' and coalesce(confirmed, false) then
    problem := null;
  end if;
  if problem is not null then
    raise exception 'registration number: %', problem using errcode = '22023';
  end if;
  if cc = 'PT' and code_digits <> '' and length(code_digits) <> 12 then
    raise exception 'access code must be 12 digits' using errcode = '22023';
  end if;
  if cc = 'TR' and not coalesce(no_number, false) then
    -- Optional (Nov 11): the tax plate (vergi levhası) most factories hold has no letter number.
    if letter <> '' and letter !~ '^[A-Z0-9]{14}$' then
      raise exception 'registration letter number: format' using errcode = '22023';
    end if;
  end if;
  if coalesce(no_number, false) and cc is distinct from 'TR' and cc is distinct from 'PT' then
    raise exception 'a registration number is required' using errcode = '22023';
  end if;

  insert into public.company_registrations as r
    (org_id, country_code, number, number_source, no_company_number, access_code, registration_letter_number, check_digit_confirmed, updated_by, updated_at)
  values (
    target_org, cc,
    case when coalesce(no_number, false) or from_document then null else public.normalise_registration_number(cc, number) end,
    case when from_document then 'document' else 'typed' end,
    coalesce(no_number, false),
    case when cc = 'PT' and code_digits <> ''
         then substr(code_digits, 1, 4) || '-' || substr(code_digits, 5, 4) || '-' || substr(code_digits, 9, 4) end,
    case when cc = 'TR' then nullif(letter, '') end,
    not coalesce(no_number, false) and not from_document
      and coalesce(public.registration_number_problem(cc, number) = 'check_digit', false),
    auth.uid(), now()
  )
  on conflict (org_id) do update
    set country_code   = excluded.country_code,
        -- Saving the form again keeps the number the licence gave.
        number         = case when excluded.number_source = 'document' and r.country_code = 'CN'
                              then r.number else excluded.number end,
        number_source  = case when excluded.number_source = 'document' and r.country_code = 'CN' and r.number is not null
                              then r.number_source else excluded.number_source end,
        no_company_number = excluded.no_company_number,
        access_code    = excluded.access_code,
        registration_letter_number = excluded.registration_letter_number,
        check_digit_confirmed = excluded.check_digit_confirmed,
        updated_by     = excluded.updated_by,
        updated_at     = case when (r.country_code, r.no_company_number, r.access_code, r.registration_letter_number)
                                   is distinct from (excluded.country_code, excluded.no_company_number, excluded.access_code, excluded.registration_letter_number)
                                or (excluded.number_source = 'typed' and r.number is distinct from excluded.number)
                              then now() else r.updated_at end
  returning * into saved;
  return saved;
end;
$$;


