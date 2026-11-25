-- Flow check R3t1 (Nov 25): a licence issued before 2015 carries the old
-- 15-digit registration number (注册号), not the 18-character credit code.
-- It is still a valid licence and GSXT finds the company by it, but the
-- number was refused everywhere ('old_number'): the reading never stored it,
-- Approve waited for "type the number from the licence" with nowhere to type
-- it, and the company could not be approved.
--
-- 1. registration_number_problem: a 15-digit Chinese number passes when its
--    GB/T 17710 (ISO 7064 MOD 11,10) check digit does, else 'check_digit',
--    like the 18-character code. Same rule as registrationNumberProblem()
--    in src/shared/registration-number.mjs. 'old_number' is no longer given.
-- 2. admin_save_registry_check: Found for a Chinese company with no number
--    must carry the number the registry shows (it becomes the company's, as
--    before). A Found saved without one was never the current check, so it
--    vanished from the page.
-- 3. Backfill: a Chinese company whose latest licence reading gave a valid
--    old number, and that has no number yet, gets it from the reading, as
--    apply_reading_number() would have stored it.
--
-- Additive: both functions keep their signatures and grants.

create or replace function public.registration_number_problem(country text, raw text)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v text := public.normalise_registration_number(country, raw);
  chars constant text := '0123456789ABCDEFGHJKLMNPQRTUWXY';
  weights constant int[] := array[1,3,9,27,19,26,16,17,20,29,25,13,8,24,10,30,28];
  total int := 0;
  c int;
  i int;
  p int;
  s int;
begin
  if v = '' then return 'missing'; end if;
  if country = 'CN' then
    -- The old registration number: 14 digits and a MOD 11,10 check digit.
    if v ~ '^\d{15}$' then
      p := 10;
      for i in 1..14 loop
        s := (p + substr(v, i, 1)::int) % 10;
        if s = 0 then s := 10; end if;
        p := (s * 2) % 11;
      end loop;
      return case when (11 - p) % 10 = substr(v, 15, 1)::int then null else 'check_digit' end;
    end if;
    if v !~ '^[0-9A-HJ-NPQRTUWXY]{2}\d{6}[0-9A-HJ-NPQRTUWXY]{10}$' then return 'format'; end if;
    for i in 1..17 loop
      total := total + (strpos(chars, substr(v, i, 1)) - 1) * weights[i];
    end loop;
    c := 31 - (total % 31);
    if c = 31 then c := 0; end if;
    return case when substr(chars, c + 1, 1) = substr(v, 18, 1) then null else 'check_digit' end;
  elsif country = 'TR' then
    if v !~ '^\d{10}$' then return 'format'; end if;
    for i in 1..9 loop
      c := (substr(v, i, 1)::int + (10 - i)) % 10;
      if c <> 0 then
        c := (c * (2 ^ (10 - i))::int) % 9;
        total := total + case when c = 0 then 9 else c end;
      end if;
    end loop;
    return case when (10 - total % 10) % 10 = substr(v, 10, 1)::int then null else 'check_digit' end;
  elsif country = 'PT' then
    if v !~ '^[1-9]\d{8}$' then return 'format'; end if;
    for i in 1..8 loop
      total := total + substr(v, i, 1)::int * (10 - i);
    end loop;
    c := total % 11;
    c := case when c < 2 then 0 else 11 - c end;
    return case when c = substr(v, 9, 1)::int then null else 'check_digit' end;
  end if;
  return case when v ~ '^[0-9A-Z]{3,40}$' then null else 'format' end;
end;
$$;

grant execute on function public.registration_number_problem(text, text) to authenticated, service_role;

-- 2.
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
  -- A Chinese company with no number yet: Found carries the number the registry shows. Without it the check
  -- counted for nothing and was never drawn (current_registry_check), so the page showed no check at all.
  if answer = 'found' and seen_number is null
     and exists (select 1 from public.company_registrations r
                  where r.org_id = target_org and r.country_code = 'CN' and r.number is null and not r.no_company_number) then
    raise exception 'add the registration number the registry shows' using errcode = '22023';
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

-- 3. Backfill: the number the latest reading gave, now that it passes.
with read as (
  select r.org_id, s.id as signal_id, public.normalise_registration_number('CN', s.details #>> '{extracted,registrationNumber}') as n
    from public.company_registrations r
    cross join lateral public.registry_latest_reading(r.org_id) s
   where r.country_code = 'CN' and r.number is null and not r.no_company_number
     and coalesce(r.number_source, 'document') = 'document'
     and s.id is not null
), fixed as (
  select * from read where n ~ '^\d{15}$' and public.registration_number_problem('CN', n) is null
), readings as (
  update public.verification_signals v
     set details = (v.details - 'numberReadProblem')
                   || jsonb_build_object('numberAtReading', f.n, 'numberFromDocument', true)
                   || case when jsonb_typeof(v.details -> 'numberCheck') = 'object'
                           then jsonb_build_object('numberCheck', (v.details -> 'numberCheck') || jsonb_build_object('problem', null))
                           else '{}'::jsonb end
    from fixed f
   where v.id = f.signal_id
  returning v.org_id
)
update public.company_registrations r
   set number = f.n, number_source = 'document', check_digit_confirmed = false, updated_at = now()
  from fixed f
 where r.org_id = f.org_id and r.org_id in (select org_id from readings);
