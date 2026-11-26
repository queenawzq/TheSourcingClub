-- C1 (Nov 26): a registry check refuses a number in the wrong format in
-- every case, not only when the company has no number yet. The review
-- window says the expected format under the field and refuses Save first;
-- this is the guard behind it. Same signature: create or replace keeps the
-- grants, restated below.

create or replace function public.admin_save_registry_check(
  target_org uuid,
  site       text,
  site_key   text,
  result     text,
  seen       jsonb default '{}'::jsonb,
  note       text default null,
  link       text default null,
  proof      jsonb default '[]'::jsonb
)
returns public.registry_checks
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
$$;
revoke all on function public.admin_save_registry_check(uuid, text, text, text, jsonb, text, text, jsonb) from public, anon;
grant execute on function public.admin_save_registry_check(uuid, text, text, text, jsonb, text, text, jsonb) to authenticated;
