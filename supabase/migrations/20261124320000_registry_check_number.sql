-- Staff verification, simpler: fixes from the simple-staff test.
--
-- 1. The number staff type in a Found registry check counts. It was kept only
--    in the check's details, so a company with no number on file (a Chinese
--    company with no licence) stayed "Number not read" forever, the check
--    never showed on its row, and Approve stayed refused. A Found check with a
--    number, for a company with no number yet, now saves that number as the
--    company's (number_source 'staff', as admin_set_registration_number does,
--    with the same check-digit rule), so the check is on its current number.
-- 2. "Couldn't check" with a note is staff's judgement, also for a Chinese
--    company with no number: it counts as the current check, and Approve no
--    longer waits for a number nobody can read.
-- 3. An automatic EU VIES answer counts when it found the number and the
--    name it gives is the company's: staff need not record the same thing by
--    hand. A VIES answer with another name still needs a person's check.
-- 4. More countries' official company registers count as official
--    (registry_source_is_official, the same list as OFFICIAL_SOURCES).
--
-- Additive: each function keeps its signature and grants; the live site
-- keeps working while this applies.

-- ---------------------------------------------------------------------------
-- 4. Official registers (from 20261108700000)
-- ---------------------------------------------------------------------------

create or replace function public.registry_source_is_official(source text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select source in ('vies', 'gib', 'gsxt', 'certidao', 'acts', 'permit', 'national',
                    'companies_house', 'rmc', 'registro_imprese', 'mca', 'rjsc', 'hk_cr', 'state_register')
$$;
grant execute on function public.registry_source_is_official(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. The current check (from 20261124300000)
-- ---------------------------------------------------------------------------

create or replace function public.current_registry_check(target_org uuid)
returns public.registry_checks
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.*
    from public.registry_checks c
    left join public.company_registrations r on r.org_id = c.org_id
   where c.org_id = target_org
     and not c.automatic
     and (r.number = c.number_checked
          -- No registration on file yet: the check made without a number.
          -- A number added later makes it out of date.
          or (r.org_id is null and c.number_checked is null)
          -- A sole proprietor in Turkey or Portugal, checked on its documents
          -- (as before); and outside China, a registration with no number.
          or (r.number is null and c.number_checked is null
              and ((r.no_company_number and r.country_code in ('TR', 'PT'))
                   or r.country_code is distinct from 'CN'))
          -- In China, with no number: only "Couldn't check" with a note,
          -- staff's judgement. A Found check there saves its number (above).
          or (r.number is null and c.number_checked is null and r.country_code = 'CN'
              and c.result = 'could_not_check'
              and nullif(trim(coalesce(c.details ->> 'note', '')), '') is not null))
   order by c.checked_at desc
   limit 1
$$;
revoke all on function public.current_registry_check(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. An automatic VIES answer that matches
-- ---------------------------------------------------------------------------

-- The latest automatic answer on the company's current number, when it found
-- the number and gives the company's own name. Null otherwise.
create or replace function public.registry_matching_automatic_check(target_org uuid)
returns public.registry_checks
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select last.*
    from (select v.*
            from public.registry_checks v
            join public.company_registrations r on r.org_id = v.org_id
           where v.org_id = target_org and v.automatic and r.number is not null
             and v.number_checked = r.number
           order by v.checked_at desc
           limit 1) last
   where last.result = 'registered'
     and nullif(trim(coalesce(last.details ->> 'name', '')), '') is not null
     and public.company_names_match(last.details ->> 'name', public.company_title(target_org))
$$;
revoke all on function public.registry_matching_automatic_check(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1, 2, 3. What Approve waits for (from 20261124300000)
-- ---------------------------------------------------------------------------

create or replace function public.registry_approval_problem(target_org uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  reg public.company_registrations;
  current_check public.registry_checks;
  reading jsonb;
  trading jsonb;
  read_problem text;
  judged boolean;
  automatic boolean := false;
begin
  select * into reg from public.company_registrations r where r.org_id = target_org;
  select * into current_check from public.current_registry_check(target_org);
  -- Couldn't check, with staff's note: their judgement decides (Nov 24).
  judged := current_check.id is not null and current_check.result = 'could_not_check'
            and nullif(trim(coalesce(current_check.details ->> 'note', '')), '') is not null;
  -- A Chinese company with no number: the licence's number, unless staff judged it.
  if reg.country_code = 'CN' and reg.number is null and not reg.no_company_number and not judged then
    read_problem := public.registry_number_read(target_org) ->> 'problem';
    return case
      when read_problem = 'check_digit' then 'number_check_digit_fails'
      when read_problem in ('old_number', 'format') then 'number_needs_staff'
      else 'number_unread' end;
  end if;
  -- No person's check: an automatic one that found the number under this name counts.
  if current_check.id is null then
    select * into current_check from public.registry_matching_automatic_check(target_org);
    automatic := current_check.id is not null;
  end if;
  if current_check.id is null or (current_check.result not in ('found', 'registered') and not judged) then
    return 'no_check';
  end if;
  if not judged then
    if not automatic and not public.registry_check_holds(target_org, current_check.details) then
      return 'renamed';
    end if;
    if public.registry_name_differs(target_org) is not null then
      return 'name_differs';
    end if;
    reading := public.registry_reading_differs(target_org);
    if reading is not null and current_check.details ->> 'readingConfirmed' is distinct from reading ->> 'id'
       and not public.registry_reading_still_confirmed(target_org, current_check.details ->> 'readingConfirmed', reading) then
      return 'document_differs';
    end if;
  end if;
  if exists (select 1 from public.registry_duplicate_orgs(target_org))
     and not exists (select 1 from public.registry_duplicate_reviews d
                      where d.org_id = target_org and d.number = reg.number) then
    return 'duplicate';
  end if;
  trading := public.registry_trading_reading(target_org);
  -- A trading company's licence is a trading licence: only a factory needs a reason for one (Nov 24).
  if trading is not null
     and not exists (select 1 from public.factory_profiles f
                      where f.org_id = target_org and f.vendor_kind = 'trading_company')
     and not exists (select 1 from public.registry_trader_reviews t
                      where t.org_id = target_org and t.reading_id = (trading ->> 'id')::uuid) then
    return 'trading_only';
  end if;
  return null;
end;
$$;
revoke all on function public.registry_approval_problem(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. The registry form saves a typed number (from 20261124300000)
-- ---------------------------------------------------------------------------

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

  -- Found, with a number, for a vendor with no number yet: the number staff
  -- read off the registry becomes the company's, so the check is on it.
  select * into reg from public.company_registrations r where r.org_id = target_org;
  if answer = 'found' and seen_number is not null and reg.number is null
     and exists (select 1 from public.orgs o where o.id = target_org and o.type = 'factory') then
    cc := coalesce(reg.country_code, (select f.country_code from public.factory_profiles f where f.org_id = target_org));
    if cc is not null and cc ~ '^[A-Z]{2}$' then
      typed := public.normalise_registration_number(cc, seen_number);
      problem := public.registration_number_problem(cc, typed);
      if problem = 'check_digit' then
        raise exception 'the registration number fails its check digit: copy it again from the registry' using errcode = '22023';
      elsif problem is not null and problem <> 'old_number' then
        raise exception 'the registration number is not in the usual format: copy it again from the registry' using errcode = '22023';
      end if;
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

  saved := public.admin_record_registry_check(
    target_org, source_key, answer,
    coalesce(said, 'Found on ' || where_text),
    answer = 'found',
    jsonb_strip_nulls(jsonb_build_object('name', seen_name, 'address', seen_address)),
    -- The page shows any difference itself; Found with one can be approved.
    true);

  update public.registry_checks c
     set details = c.details
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
