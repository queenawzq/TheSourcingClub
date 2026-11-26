-- M3 (Nov 26): the Link on a registry or certificate check is a web address
-- when given: refused otherwise, and saved with https:// when it has no
-- scheme (normalise_web_address, 20261126100600). Checked after the staff
-- test, like every other value. Same signatures; grants restated.

create or replace function public.admin_save_registry_check(target_org uuid, site text, site_key text, result text, seen jsonb DEFAULT '{}'::jsonb, note text DEFAULT NULL::text, link text DEFAULT NULL::text, proof jsonb DEFAULT '[]'::jsonb)
 RETURNS registry_checks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  answer text := result;
  where_text text := nullif(trim(coalesce(site, '')), '');
  said text := nullif(trim(coalesce(note, '')), '');
  url text := nullif(trim(coalesce(link, '')), '');
  seen_name text := nullif(trim(coalesce(seen ->> 'name', '')), '');
  seen_number text := nullif(trim(coalesce(seen ->> 'number', '')), '');
  seen_address text := nullif(trim(coalesce(seen ->> 'address', '')), '');
  source_key text := case when site_key ~ '^[a-z_]{2,20}$' then site_key else 'site' end;
  files jsonb;
  saved public.registry_checks;
  reg public.company_registrations;
  cc text;
  typed text;
  problem text;
  explained text;
  matches boolean;
begin
  if not public.is_platform_admin() then
    raise exception 'only platform admins may record registry checks' using errcode = '42501';
  end if;
  if public.is_org_member(target_org) then
    raise exception 'staff cannot review a company they belong to' using errcode = '42501';
  end if;
  if not exists (select 1 from public.orgs o where o.id = target_org) then
    raise exception 'company not found' using errcode = 'P0002';
  end if;
  if answer is null or answer not in ('found', 'not_found', 'could_not_check') then
    raise exception 'choose Found, Not found or Couldn''t check' using errcode = '22023';
  end if;
  if where_text is null then
    raise exception 'say where you checked' using errcode = '22023';
  end if;
  if answer <> 'found' and said is null then
    raise exception 'add a note' using errcode = '22023';
  end if;
  if char_length(where_text) > 120 then
    raise exception 'the site name is too long' using errcode = '22023';
  elsif char_length(coalesce(said, '')) > 1000 then
    raise exception 'the note is too long' using errcode = '22023';
  elsif char_length(coalesce(url, '')) > 500 then
    raise exception 'the link is too long' using errcode = '22023';
  elsif char_length(coalesce(seen_name, '')) > 300 or char_length(coalesce(seen_number, '')) > 60
     or char_length(coalesce(seen_address, '')) > 500 then
    raise exception 'the name, number or address is too long' using errcode = '22023';
  end if;
  url := public.normalise_web_address(url);
  files := public.verification_proof_clean(target_org, proof);

  -- A number read off the registry must look like the country's numbers,
  -- whether or not the company has one (Nov 26): a wrong one is a misread.
  select * into reg from public.company_registrations r where r.org_id = target_org;
  cc := coalesce(reg.country_code, (select f.country_code from public.factory_profiles f where f.org_id = target_org));
  if answer = 'found' and seen_number is not null and cc is not null and cc ~ '^[A-Z]{2}$' then
    problem := public.registration_number_problem(cc, public.normalise_registration_number(cc, seen_number));
    if problem = 'check_digit' then
      raise exception 'the registration number fails its check digit: copy it again from the registry' using errcode = '22023';
    elsif problem is not null and problem not in ('old_number', 'missing') then
      raise exception '%', coalesce(public.registration_number_format_text(cc) || ': copy it again from the registry',
                                    'the registration number is not in the usual format: copy it again from the registry')
        using errcode = '22023';
    end if;
  end if;

  -- Found, with a number, for a vendor with no number yet: the number staff
  -- read off the registry becomes the company's, so the check is on it.
  if answer = 'found' and seen_number is not null and reg.number is null
     and exists (select 1 from public.orgs o where o.id = target_org and o.type = 'factory') then
    if cc is not null and cc ~ '^[A-Z]{2}$' then
      typed := public.normalise_registration_number(cc, seen_number);
      insert into public.company_registrations as r
        (org_id, country_code, number, number_source, no_company_number, check_digit_confirmed, updated_by, updated_at)
      values (target_org, cc, typed, 'staff', false, false, auth.uid(), now())
      on conflict (org_id) do update
        set country_code = excluded.country_code,
            number = excluded.number,
            number_source = 'staff',
            no_company_number = false,
            check_digit_confirmed = false,
            updated_by = excluded.updated_by,
            updated_at = now();
      insert into public.registration_number_entries (org_id, country_code, number, note, entered_by)
      values (target_org, cc, typed, left('Typed in a registry check on ' || where_text, 2000), auth.uid());
    end if;
  end if;

  -- An explanation staff wrote on the Typed: line (a check carrying a reason), newest first.
  select c.details ->> 'readingConfirmed' into explained
    from public.registry_checks c
   where c.org_id = target_org and not c.automatic
     and nullif(trim(coalesce(c.details ->> 'reason', '')), '') is not null
     and c.details ? 'readingConfirmed'
   order by c.checked_at desc
   limit 1;
  select * into reg from public.company_registrations r where r.org_id = target_org;
  matches := answer = 'found' and seen_number is not null and reg.number is not null
             and public.normalise_registration_number(coalesce(reg.country_code, ''), seen_number) = reg.number
             and (seen_name is null or public.company_names_match(seen_name, public.company_title(target_org)));

  saved := public.admin_record_registry_check(
    target_org, source_key, answer,
    coalesce(said, 'Found on ' || where_text),
    answer = 'found',
    jsonb_strip_nulls(jsonb_build_object('name', seen_name, 'address', seen_address)),
    -- The page shows any difference itself; Found with one can be approved.
    true);

  -- The licence's difference stays to be explained unless it was, or this check matches the company.
  update public.registry_checks c
     set details = (c.details - 'readingConfirmed')
                   || case when matches and c.details ? 'readingConfirmed'
                             then jsonb_build_object('readingConfirmed', c.details ->> 'readingConfirmed')
                           when explained is not null then jsonb_build_object('readingConfirmed', explained)
                           else '{}'::jsonb end
                   || jsonb_strip_nulls(jsonb_build_object(
                        'form', 2, 'outcome', answer, 'site', where_text, 'number', seen_number,
                        'reference', url, 'note', said))
                   || jsonb_build_object('proof', files),
         -- Two saves in one transaction (a test, a retry) stay in order.
         checked_at = clock_timestamp()
   where c.id = saved.id
  returning * into saved;

  insert into public.org_review_changes (org_id, kind, subject_id, details, changed_by, changed_at)
  values (target_org, 'registry_check', saved.id,
          jsonb_strip_nulls(jsonb_build_object('result', answer, 'site', where_text, 'note', said, 'files', jsonb_array_length(files))),
          auth.uid(), clock_timestamp());
  return saved;
end;
$function$;
revoke all on function public.admin_save_registry_check(uuid, text, text, text, jsonb, text, text, jsonb) from public, anon;
grant execute on function public.admin_save_registry_check(uuid, text, text, text, jsonb, text, text, jsonb) to authenticated;

create or replace function public.admin_save_certificate_check(target_org uuid, certificate uuid, site text, result text, seen jsonb DEFAULT '{}'::jsonb, note text DEFAULT NULL::text, link text DEFAULT NULL::text, proof jsonb DEFAULT '[]'::jsonb)
 RETURNS verification_signals
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  answer text := result;
  where_text text := nullif(trim(coalesce(site, '')), '');
  said text := nullif(trim(coalesce(note, '')), '');
  url text := nullif(trim(coalesce(link, '')), '');
  files jsonb;
  saved public.verification_signals;
begin
  if not public.is_platform_admin() then
    raise exception 'only platform admins may record checks' using errcode = '42501';
  end if;
  if public.is_org_member(target_org) then
    raise exception 'staff cannot review a company they belong to' using errcode = '42501';
  end if;
  if answer is null or answer not in ('found', 'expired', 'not_found', 'could_not_check') then
    raise exception 'choose Found, Expired, Not found or Couldn''t check' using errcode = '22023';
  end if;
  if not exists (select 1 from public.factory_certifications c where c.id = certificate and c.org_id = target_org) then
    raise exception 'certificate not found for this company' using errcode = 'P0002';
  end if;
  if where_text is null then
    raise exception 'say where you checked' using errcode = '22023';
  end if;
  if answer in ('not_found', 'could_not_check') and said is null then
    raise exception 'add a note' using errcode = '22023';
  end if;
  if char_length(where_text) > 120 then
    raise exception 'the site name is too long' using errcode = '22023';
  elsif char_length(coalesce(said, '')) > 1000 then
    raise exception 'the note is too long' using errcode = '22023';
  elsif char_length(coalesce(url, '')) > 500 then
    raise exception 'the link is too long' using errcode = '22023';
  elsif char_length(coalesce(seen ->> 'number', '')) > 120 or char_length(coalesce(seen ->> 'holder', '')) > 300 then
    raise exception 'the number or holder is too long' using errcode = '22023';
  end if;
  url := public.normalise_web_address(url);
  files := public.verification_proof_clean(target_org, proof);

  insert into public.verification_signals (org_id, kind, subject_id, result, note, details, automatic, checked_by)
  values (target_org, 'certificate', certificate, answer,
          coalesce(said, case answer when 'found' then 'Found on ' when 'expired' then 'Expired on ' else 'Checked on ' end || where_text),
          jsonb_strip_nulls(jsonb_build_object(
            'form', 2, 'site', where_text, 'link', url, 'note', said,
            'number', nullif(trim(coalesce(seen ->> 'number', '')), ''),
            'holder', nullif(trim(coalesce(seen ->> 'holder', '')), '')))
          || jsonb_build_object('proof', files),
          false, auth.uid())
  returning * into saved;
  update public.verification_signals s set checked_at = clock_timestamp() where s.id = saved.id returning * into saved;

  insert into public.org_review_changes (org_id, kind, subject_id, details, changed_by)
  values (target_org, 'certificate_check', certificate,
          jsonb_strip_nulls(jsonb_build_object('result', answer, 'site', where_text, 'note', said, 'files', jsonb_array_length(files))),
          auth.uid());
  return saved;
end;
$function$;
revoke all on function public.admin_save_certificate_check(uuid, uuid, text, text, jsonb, text, text, jsonb) from public, anon;
grant execute on function public.admin_save_certificate_check(uuid, uuid, text, text, jsonb, text, text, jsonb) to authenticated;

