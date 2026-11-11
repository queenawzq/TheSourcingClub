-- Verification v2, fix round 1 (independent tester, Nov 8).
--
-- 1. The AI reading of the registration is a source like any other: when it
--    shows another number or name than the factory typed, "found" needs staff
--    to confirm the difference, and approval waits for it. A reading is only
--    for the number it was made on and the latest file.
-- 2. A check holds for the names it was made against. Renaming the company
--    (its name or its legal name) afterwards loses the check: the brand's
--    fact goes, staff see "Registry check lost", and approval needs a new one.
-- 3. A sole proprietor (no company number) is never "Official registry": no
--    registry can be asked about a number it does not have.
-- 4. Names lose every accent the same way in SQL and JS (NFD), and
--    Vietnamese legal forms ("Công ty TNHH …") are dropped.
-- 5. A duplicate is explained in a sentence, not "ok".

-- ---------------------------------------------------------------------------
-- 4. Names
-- ---------------------------------------------------------------------------

create or replace function public.company_name_key(raw text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  with plain as (
    -- Every accent off (ç, ş, ğ, ö, ệ, ạ …), then the letters NFD keeps whole.
    select translate(regexp_replace(normalize(lower(replace(coalesce(raw, ''), 'İ', 'i')), NFD), '[̀-ͯ]', '', 'g'),
                     'đıøłßæœ', 'diolsao') as v
  ), chinese as (
    select regexp_replace(v, '(股份有限公司|有限责任公司|有限公司|分公司|公司|厂)$', '') as v from plain
  ), words as (
    select ' ' || regexp_replace(v, '[^[:alnum:]]+', ' ', 'g') || ' ' as v from chinese
  ), phrases as (
    select regexp_replace(v, ' (cong ty|trach nhiem huu han|mot thanh vien|co phan|s a|a s)(?= )', ' ', 'g') as v from words
  ), forms as (
    select regexp_replace(v,
      ' (sa|sl|lda|limitada|unipessoal|sociedade|anonima|ltd|ltda|limited|co|company|corp|corporation|inc|llc|gmbh|plc|jsc|srl|spa|sti|sirketi|ticaret|sanayi|san|tic|ve|as|ith|ihr|imalat|pazarlama|and|e|cia|comercio|industria|tnhh|mtv)(?= )',
      ' ', 'g') as v from phrases
  )
  select trim(regexp_replace(v, '\s+', ' ', 'g')) from forms
$$;

-- ---------------------------------------------------------------------------
-- 1. The AI reading
-- ---------------------------------------------------------------------------

-- The latest AI reading of the latest registration file, made on the current
-- number, when it shows something else: `{ id, differences }`. Null when it
-- agrees, is stale, or there is none.
create or replace function public.registry_reading_differs(target_org uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object('id', s.id, 'differences', s.details -> 'differences')
    from public.verification_signals s
    join public.company_registrations r on r.org_id = s.org_id
   where s.org_id = target_org and s.kind = 'document_reading' and s.automatic
     and s.subject_id = (select d.id from public.documents d
                          where d.org_id = target_org and d.kind = 'business_registration'
                          order by d.created_at desc limit 1)
     and s.details ->> 'numberAtReading' is not distinct from r.number
     and s.id = (select x.id from public.verification_signals x
                  where x.org_id = target_org and x.kind = 'document_reading' and x.automatic
                  order by x.checked_at desc limit 1)
     and jsonb_typeof(s.details -> 'differences') = 'array'
     and jsonb_array_length(s.details -> 'differences') > 0
$$;

revoke all on function public.registry_reading_differs(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. A check holds for the names it was made against
-- ---------------------------------------------------------------------------

create or replace function public.registry_check_holds(target_org uuid, check_details jsonb)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select (check_details ->> 'titleAtCheck' is null or check_details ->> 'titleAtCheck' = public.company_title(target_org))
     and (check_details ->> 'nameAtCheck' is null
          or check_details ->> 'nameAtCheck' = (select o.name from public.orgs o where o.id = target_org))
$$;

revoke all on function public.registry_check_holds(uuid, jsonb) from public, anon, authenticated;

drop function public.admin_record_registry_check(uuid, text, text, text, boolean, jsonb, boolean);

create or replace function public.admin_record_registry_check(
  target_org uuid,
  source     text,
  result     text,
  note       text default null,
  confirmed  boolean default false,
  seen       jsonb default '{}'::jsonb,
  -- "The names or numbers differ and I checked why": needed for a found when
  -- a source (VIES, what staff typed, the AI reading) shows something else.
  name_differs_confirmed boolean default false
)
returns public.registry_checks
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  reg public.company_registrations;
  saved public.registry_checks;
  title text;
  display_name text;
  seen_clean jsonb;
  auto_name text;
  reading jsonb;
  differs boolean := false;
begin
  if not public.is_platform_admin() then
    raise exception 'only platform admins may record registry checks'
      using errcode = '42501';
  end if;
  if not exists (select 1 from public.orgs o where o.id = target_org) then
    raise exception 'company not found' using errcode = 'P0002';
  end if;
  if public.is_org_member(target_org) then
    raise exception 'staff cannot review a company they belong to' using errcode = '42501';
  end if;
  if result not in ('found', 'mismatch', 'not_found', 'could_not_check') then
    raise exception 'result must be found, mismatch, not_found or could_not_check' using errcode = '22023';
  end if;
  if source !~ '^[a-z_]{2,20}$' then
    raise exception 'unknown source' using errcode = '22023';
  end if;
  if nullif(trim(coalesce(note, '')), '') is null then
    raise exception 'say what you saw: the name as shown, what differed, or why it could not be checked'
      using errcode = '22023';
  end if;

  select * into reg from public.company_registrations r where r.org_id = target_org;
  title := public.company_title(target_org);
  select o.name into display_name from public.orgs o where o.id = target_org;

  if source = 'vies' and result = 'found' and not coalesce(confirmed, false) and exists (
    select 1 from (
      select v.result from public.registry_checks v
       where v.org_id = target_org and v.source = 'vies' and v.automatic
         and v.number_checked is not distinct from reg.number
       order by v.checked_at desc limit 1) last
     where last.result <> 'registered')
  then
    raise exception 'VIES itself did not find this number: confirm you checked VIES yourself'
      using errcode = '22023';
  end if;

  select coalesce(jsonb_object_agg(k, left(trim(v), 300)), '{}'::jsonb) into seen_clean
    from jsonb_each_text(coalesce(seen, '{}'::jsonb)) as e(k, v)
   where k in ('name', 'address', 'startDate', 'industry') and nullif(trim(v), '') is not null;

  if result = 'found' then
    if seen_clean ? 'name' and not public.company_names_match(seen_clean ->> 'name', title) then
      differs := true;
    end if;
    select nullif(trim(c.details ->> 'name'), '') into auto_name
      from public.registry_checks c
     where c.org_id = target_org and c.automatic and c.number_checked is not distinct from reg.number
       and nullif(trim(c.details ->> 'name'), '') is not null
     order by c.checked_at desc limit 1;
    if auto_name is not null and auto_name !~ '^-+$' and not public.company_names_match(auto_name, title) then
      differs := true;
    end if;
    reading := public.registry_reading_differs(target_org);
    if reading is not null then
      differs := true;
    end if;
    if differs and not coalesce(name_differs_confirmed, false) then
      raise exception 'a source shows another name or number than "%": confirm the difference and say why', title
        using errcode = '22023';
    end if;
  end if;

  insert into public.registry_checks (org_id, country_code, number_checked, source, result, note, details, automatic, checked_by)
  values (target_org, reg.country_code, reg.number, source, result, nullif(trim(coalesce(note, '')), ''),
          seen_clean
          || jsonb_build_object('titleAtCheck', title, 'nameAtCheck', display_name)
          || case when differs then jsonb_build_object('nameDiffersConfirmed', true) else '{}'::jsonb end
          || case when reading is not null then jsonb_build_object('readingConfirmed', reading ->> 'id') else '{}'::jsonb end,
          false, auth.uid())
  returning * into saved;
  return saved;
end;
$$;

revoke all on function public.admin_record_registry_check(uuid, text, text, text, boolean, jsonb, boolean) from public, anon;
grant execute on function public.admin_record_registry_check(uuid, text, text, text, boolean, jsonb, boolean) to authenticated;

-- 'no_check', 'renamed', 'name_differs', 'document_differs', 'duplicate' or null.
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
begin
  select * into current_check from public.current_registry_check(target_org);
  if current_check.id is null or current_check.result <> 'found' then
    return 'no_check';
  end if;
  if not public.registry_check_holds(target_org, current_check.details) then
    return 'renamed';
  end if;
  if public.registry_name_differs(target_org) is not null then
    return 'name_differs';
  end if;
  reading := public.registry_reading_differs(target_org);
  if reading is not null and current_check.details ->> 'readingConfirmed' is distinct from reading ->> 'id' then
    return 'document_differs';
  end if;
  select * into reg from public.company_registrations r where r.org_id = target_org;
  if exists (select 1 from public.registry_duplicate_orgs(target_org))
     and not exists (select 1 from public.registry_duplicate_reviews d
                      where d.org_id = target_org and d.number = reg.number) then
    return 'duplicate';
  end if;
  return null;
end;
$$;

create or replace function public.guard_approval_needs_registry()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  problem text;
begin
  if new.state <> 'approved' or (tg_op = 'UPDATE' and old.state = 'approved') then
    return new;
  end if;
  if coalesce(current_setting('tsc.skip_registry_guard', true), '') = 'on' then
    return new;
  end if;
  if not exists (select 1 from public.orgs o where o.id = new.org_id and o.type = 'factory') then
    return new;
  end if;
  problem := public.registry_approval_problem(new.org_id);
  if problem = 'no_check' then
    raise exception 'record a registry check that found the company (on its current number) before approving'
      using errcode = '22023';
  elsif problem = 'renamed' then
    raise exception 'the company was renamed after its registry check: check it again before approving'
      using errcode = '22023';
  elsif problem = 'name_differs' then
    raise exception 'the registry names another company: record a check confirming why the names differ before approving'
      using errcode = '22023';
  elsif problem = 'document_differs' then
    raise exception 'the AI reading of the document shows another number or name: record a check confirming why before approving'
      using errcode = '22023';
  elsif problem = 'duplicate' then
    raise exception 'another company uses this registration number: explain it before approving'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2 and 3. What a brand learns, and the queue
-- ---------------------------------------------------------------------------

create or replace function public.factory_registry_fact(target_org uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
           'checkedAt', c.checked_at,
           -- A sole proprietor has no number a registry could be asked about.
           'kind', case when public.registry_source_is_official(c.source) and c.number_checked is not null
                        then 'registry' else 'document' end)
    from public.current_registry_check(target_org) c
    join public.factory_profiles f on f.org_id = c.org_id
   where c.result = 'found'
     and public.registry_check_holds(target_org, c.details)
     and f.verification_status = 'verified'
     and (f.published_at is not null or public.is_org_member(target_org) or public.is_platform_admin())
$$;

create or replace function public.admin_registry_states()
returns table (org_id uuid, state text, kind text, checked_at timestamptz, registration_uploaded_at timestamptz,
               duplicates int, duplicate_names text[], duplicate_explained boolean)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'only platform admins may read registry states' using errcode = '42501';
  end if;
  return query
    select f.org_id,
           case when c.result = 'found' and public.registry_check_holds(f.org_id, c.details) then 'found'
                when f.verification_status = 'verified' and (c.id is not null or exists (
                  select 1 from public.registry_checks x where x.org_id = f.org_id and not x.automatic)) then 'lost'
                else 'none' end,
           case when c.id is null then null
                when public.registry_source_is_official(c.source) and c.number_checked is not null then 'registry'
                else 'document' end,
           c.checked_at,
           (select max(d.created_at) from public.documents d
             where d.org_id = f.org_id and d.kind = 'business_registration'),
           (select count(*)::int from public.registry_duplicate_orgs(f.org_id)),
           (select array_agg(d.name) from public.registry_duplicate_orgs(f.org_id) d),
           exists (select 1 from public.registry_duplicate_reviews x
                     join public.company_registrations r on r.org_id = x.org_id and r.number = x.number
                    where x.org_id = f.org_id)
      from public.factory_profiles f
      left join lateral (select * from public.current_registry_check(f.org_id)) c on true;
end;
$$;

-- ---------------------------------------------------------------------------
-- The staff panel's detail: the reading and the rename, too
-- ---------------------------------------------------------------------------

create or replace function public.admin_registry_detail(target_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  reg_number text;
  current_check public.registry_checks;
begin
  if not public.is_platform_admin() then
    raise exception 'only platform admins may read registry checks'
      using errcode = '42501';
  end if;
  select r.number into reg_number from public.company_registrations r where r.org_id = target_org;
  select * into current_check from public.current_registry_check(target_org);
  return jsonb_build_object(
    'registration', (
      select jsonb_build_object(
        'country', r.country_code, 'number', r.number, 'noCompanyNumber', r.no_company_number, 'accessCode', r.access_code,
        'registrationLetterNumber', r.registration_letter_number, 'confirmed', r.check_digit_confirmed,
        'problem', public.registration_number_problem(r.country_code, r.number),
        'updatedAt', r.updated_at)
        from public.company_registrations r where r.org_id = target_org),
    'location', (select f.location from public.factory_profiles f where f.org_id = target_org),
    'title', public.company_title(target_org),
    'displayName', (select o.name from public.orgs o where o.id = target_org),
    'current', case when current_check.id is null then null else to_jsonb(current_check) end,
    'renamedSinceCheck', current_check.id is not null and current_check.result = 'found'
                         and not public.registry_check_holds(target_org, current_check.details),
    'readingDiffers', public.registry_reading_differs(target_org),
    'sameNumber', (select count(*)::int from public.registry_duplicate_orgs(target_org)),
    'duplicates', coalesce((select jsonb_agg(jsonb_build_object('orgId', d.org_id, 'name', d.name, 'status', d.verification_status))
                              from public.registry_duplicate_orgs(target_org) d), '[]'::jsonb),
    'duplicateExplained', (
      select jsonb_build_object('note', x.note, 'reviewedAt', x.reviewed_at,
                                'reviewedBy', coalesce(nullif(p.full_name, ''), u.email::text))
        from public.registry_duplicate_reviews x
        left join auth.users u on u.id = x.reviewed_by
        left join public.user_profiles p on p.id = x.reviewed_by
       where x.org_id = target_org and x.number = reg_number
       order by x.reviewed_at desc limit 1),
    'nameDiffers', public.registry_name_differs(target_org),
    'approvalProblem', case when exists (select 1 from public.orgs o where o.id = target_org and o.type = 'factory')
                            then public.registry_approval_problem(target_org) end,
    'countryCode', coalesce(
      (select r.country_code from public.company_registrations r where r.org_id = target_org),
      (select f.country_code from public.factory_profiles f where f.org_id = target_org)),
    'checks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'source', c.source, 'result', c.result, 'note', c.note,
        'details', c.details, 'automatic', c.automatic,
        'numberChecked', c.number_checked, 'checkedAt', c.checked_at,
        'checkedBy', coalesce(nullif(p.full_name, ''), u.email::text),
        'nameMatches', case when nullif(trim(c.details ->> 'name'), '') is null then null
                            else public.company_names_match(c.details ->> 'name', public.company_title(target_org)) end)
        order by c.checked_at desc)
        from public.registry_checks c
        left join auth.users u on u.id = c.checked_by
        left join public.user_profiles p on p.id = c.checked_by
       where c.org_id = target_org), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. A duplicate is explained in a sentence
-- ---------------------------------------------------------------------------

create or replace function public.admin_explain_duplicate(target_org uuid, note text)
returns public.registry_duplicate_reviews
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  reg public.company_registrations;
  saved public.registry_duplicate_reviews;
  said text := trim(coalesce(note, ''));
begin
  if not public.is_platform_admin() then
    raise exception 'only platform admins may explain a duplicate number' using errcode = '42501';
  end if;
  if public.is_org_member(target_org) then
    raise exception 'staff cannot review a company they belong to' using errcode = '42501';
  end if;
  select * into reg from public.company_registrations r where r.org_id = target_org;
  if reg.number is null or not exists (select 1 from public.registry_duplicate_orgs(target_org)) then
    raise exception 'no other company uses this number' using errcode = '22023';
  end if;
  -- "ok" explains nothing: a sentence of at least three words.
  if char_length(said) < 15 or array_length(regexp_split_to_array(said, '\s+'), 1) < 3 then
    raise exception 'say in a sentence why two companies share this number' using errcode = '22023';
  end if;
  insert into public.registry_duplicate_reviews (org_id, number, note, reviewed_by)
  values (target_org, reg.number, said, auth.uid())
  returning * into saved;
  return saved;
end;
$$;
