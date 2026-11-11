-- Verification v2 (Nov 8): what the independent tester broke in #88, and the
-- checks Queena asked for (address, photos, certificates, a trader's signals).
--
-- 1. Names are compared. A registry's answer (VIES, or what staff saw on QCC
--    or another source) that names another company is shown, and "found"
--    needs staff to confirm the difference, here and at approval. A valid
--    number can be someone else's: EDP's NIPC typed by "Fiação do Vale" was
--    approved with VIES saying "EDP, S.A.".
-- 2. A number another company uses blocks approval until staff explain it,
--    keyed to the number (changing it re-opens the question).
-- 3. Turkey's tax letter number (Dilekçe No., 14 characters) is required:
--    without it GİB's letter check cannot be run.
-- 4. The brand's fact says "registry" only for an official source.
-- 5. `verification_signals`: staff-only record of the AI reading of the
--    registration, the address check, each photo's reverse search and each
--    certificate's check. A brand learns only "certificate checked <month>".
-- 6. A brand cannot invite a factory that is not verified.
-- 7. Staff who belong to a company cannot record its checks.

-- ---------------------------------------------------------------------------
-- 1. Names
-- ---------------------------------------------------------------------------

-- The part of a company name that identifies it: case, accents, punctuation
-- and the legal form dropped ("EDP, S.A." → "edp"; "ÖRME TEKSTİL SANAYİ VE
-- TİCARET LİMİTED ŞİRKETİ" → "orme tekstil"; "宁波织造有限公司" → "宁波织造").
-- Same rules as companyNameKey() in src/shared/registration-number.mjs
-- (`npm run check:registration`).
create or replace function public.company_name_key(raw text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  with lowered as (
    select translate(lower(replace(coalesce(raw, ''), 'İ', 'i')),
      'áàâãäåçéèêëíìîïıñóòôõöøúùûüşğýÿœæ',
      'aaaaaaceeeeiiiiinoooooouuuusgyyoa') as v
  ), chinese as (
    select regexp_replace(v, '(股份有限公司|有限责任公司|有限公司|分公司|公司|厂)$', '') as v from lowered
  ), words as (
    select regexp_replace(v, '[^[:alnum:]]+', ' ', 'g') as v from chinese
  ), forms as (
    select regexp_replace(' ' || v || ' ',
      ' (s a|sa|s l|sl|lda|limitada|unipessoal|sociedade|anonima|ltd|ltda|limited|co|company|corp|corporation|inc|llc|gmbh|plc|jsc|srl|spa|sti|sirketi|ticaret|sanayi|san|tic|ve|a s|as|ith|ihr|imalat|pazarlama|and|e|cia|comercio|industria)(?= )',
      ' ', 'g') as v from words
  )
  select trim(regexp_replace(regexp_replace(v, ' (s a|a s) ', ' ', 'g'), '\s+', ' ', 'g')) from forms
$$;

grant execute on function public.company_name_key(text) to authenticated, service_role;

create or replace function public.company_names_match(a text, b text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select public.company_name_key(a) <> '' and public.company_name_key(a) = public.company_name_key(b)
$$;

grant execute on function public.company_names_match(text, text) to authenticated, service_role;

-- The name the company goes by for these checks: its legal name, else its name.
create or replace function public.company_title(target_org uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(nullif(trim(f.legal_name), ''), o.name)
    from public.orgs o left join public.factory_profiles f on f.org_id = o.id
   where o.id = target_org
$$;

revoke all on function public.company_title(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Duplicate numbers
-- ---------------------------------------------------------------------------

create or replace function public.registry_duplicate_orgs(target_org uuid)
returns table (org_id uuid, name text, verification_status text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select o.id, coalesce(nullif(f.legal_name, ''), o.name), f.verification_status::text
    from public.company_registrations r
    join public.company_registrations x on x.number = r.number and x.org_id <> r.org_id
     and x.country_code is not distinct from r.country_code
    join public.orgs o on o.id = x.org_id
    left join public.factory_profiles f on f.org_id = o.id
   where r.org_id = target_org and r.number is not null
   order by o.created_at
$$;

revoke all on function public.registry_duplicate_orgs(uuid) from public, anon, authenticated;

create table public.registry_duplicate_reviews (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs (id) on delete cascade,
  number      text not null,
  note        text not null check (char_length(trim(note)) between 1 and 2000),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz not null default now()
);

create index registry_duplicate_reviews_org_idx on public.registry_duplicate_reviews (org_id, reviewed_at desc);
alter table public.registry_duplicate_reviews enable row level security;
revoke all on public.registry_duplicate_reviews from anon, authenticated;
grant all on public.registry_duplicate_reviews to service_role;

create or replace function public.admin_explain_duplicate(target_org uuid, note text)
returns public.registry_duplicate_reviews
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  reg public.company_registrations;
  saved public.registry_duplicate_reviews;
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
  if nullif(trim(coalesce(note, '')), '') is null then
    raise exception 'say why two companies share this number' using errcode = '22023';
  end if;
  insert into public.registry_duplicate_reviews (org_id, number, note, reviewed_by)
  values (target_org, reg.number, trim(note), auth.uid())
  returning * into saved;
  return saved;
end;
$$;

revoke all on function public.admin_explain_duplicate(uuid, text) from public, anon;
grant execute on function public.admin_explain_duplicate(uuid, text) to authenticated;

-- The factory, after saving: is its number already another company's? Yes or
-- no, never which one.
create or replace function public.registration_in_use(target_org uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not (public.is_org_member(target_org) or public.is_platform_admin()) then
    raise exception 'not a member of this company' using errcode = '42501';
  end if;
  return exists (select 1 from public.registry_duplicate_orgs(target_org));
end;
$$;

revoke all on function public.registration_in_use(uuid) from public, anon;
grant execute on function public.registration_in_use(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. What stops approval: one answer for the guard and the screen
-- ---------------------------------------------------------------------------

-- 'no_check', 'name_differs', 'duplicate' or null.
create or replace function public.registry_approval_problem(target_org uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  reg public.company_registrations;
begin
  if coalesce((select c.result from public.current_registry_check(target_org) c), '') <> 'found' then
    return 'no_check';
  end if;
  if public.registry_name_differs(target_org) is not null then
    return 'name_differs';
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

revoke all on function public.registry_approval_problem(uuid) from public, anon, authenticated;

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
  elsif problem = 'name_differs' then
    raise exception 'the registry names another company: record a check confirming why the names differ before approving'
      using errcode = '22023';
  elsif problem = 'duplicate' then
    raise exception 'another company uses this registration number: explain it before approving'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Recording a check: what was seen, and a confirmed difference
-- ---------------------------------------------------------------------------

drop function public.admin_record_registry_check(uuid, text, text, text, boolean);

create or replace function public.admin_record_registry_check(
  target_org uuid,
  source     text,
  result     text,
  note       text default null,
  confirmed  boolean default false,
  -- What the source showed, typed by staff: name, address, startDate, industry.
  seen       jsonb default '{}'::jsonb,
  -- "The names differ and I checked why": needed for a found when the source
  -- names another company.
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
  seen_clean jsonb;
  auto_name text;
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

  -- Only the four fields, each short text.
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
    if differs and not coalesce(name_differs_confirmed, false) then
      raise exception 'the source names another company than "%": confirm the names differ and say why', title
        using errcode = '22023';
    end if;
  end if;

  insert into public.registry_checks (org_id, country_code, number_checked, source, result, note, details, automatic, checked_by)
  values (target_org, reg.country_code, reg.number, source, result, nullif(trim(coalesce(note, '')), ''),
          seen_clean || case when differs then jsonb_build_object('nameDiffersConfirmed', true, 'titleAtCheck', title) else '{}'::jsonb end,
          false, auth.uid())
  returning * into saved;
  return saved;
end;
$$;

revoke all on function public.admin_record_registry_check(uuid, text, text, text, boolean, jsonb, boolean) from public, anon;
grant execute on function public.admin_record_registry_check(uuid, text, text, text, boolean, jsonb, boolean) to authenticated;

-- The other name a registry gave for the company's current number, when it
-- is not the company's: the name staff typed on the current check, or the
-- latest automatic answer (VIES) with a name. Null when they agree, when no
-- source named anyone, or when the current check confirmed the difference;
-- a confirmation holds only for the title it was made against, so a rename
-- afterwards opens the question again.
create or replace function public.registry_name_differs(target_org uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  reg public.company_registrations;
  title text := public.company_title(target_org);
  current_check public.registry_checks;
  auto_name text;
begin
  select * into reg from public.company_registrations r where r.org_id = target_org;
  select * into current_check from public.current_registry_check(target_org);
  if current_check.id is not null and coalesce((current_check.details ->> 'nameDiffersConfirmed')::boolean, false)
     and current_check.details ->> 'titleAtCheck' is not distinct from title then
    return null;
  end if;
  if current_check.id is not null and nullif(trim(current_check.details ->> 'name'), '') is not null
     and not public.company_names_match(current_check.details ->> 'name', title) then
    return current_check.details ->> 'name';
  end if;
  select nullif(trim(c.details ->> 'name'), '') into auto_name
    from public.registry_checks c
   where c.org_id = target_org and c.automatic and c.number_checked is not distinct from reg.number
     and nullif(trim(c.details ->> 'name'), '') is not null
   order by c.checked_at desc limit 1;
  if auto_name is not null and auto_name !~ '^-+$' and not public.company_names_match(auto_name, title) then
    return auto_name;
  end if;
  return null;
end;
$$;

revoke all on function public.registry_name_differs(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Turkey's letter number is required
-- ---------------------------------------------------------------------------

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
  letter text := upper(regexp_replace(coalesce(registration_letter_number, ''), '\s+', '', 'g'));
  saved public.company_registrations;
begin
  if not public.has_org_permission(target_org, 'settingsAccess') then
    raise exception 'only the company''s owner or someone with Settings access may save its registration'
      using errcode = '42501';
  end if;
  if cc is not null and cc !~ '^[A-Z]{2}$' then
    raise exception 'country must be a two-letter code' using errcode = '22023';
  end if;

  problem := case when coalesce(no_number, false) then null else public.registration_number_problem(cc, number) end;
  if problem = 'check_digit' and coalesce(confirmed, false) then
    problem := null;
  end if;
  if problem is not null then
    raise exception 'registration number: %', problem using errcode = '22023';
  end if;
  if cc = 'PT' and code_digits <> '' and length(code_digits) <> 12 then
    raise exception 'access code must be 12 digits' using errcode = '22023';
  end if;
  -- GİB's letter check takes the VKN and the letter's 14-character number
  -- (Dilekçe No.); without it the one strong Turkish check cannot be run.
  if cc = 'TR' and not coalesce(no_number, false) then
    if letter = '' then
      raise exception 'registration letter number: missing' using errcode = '22023';
    elsif letter !~ '^[A-Z0-9]{14}$' then
      raise exception 'registration letter number: format' using errcode = '22023';
    end if;
  end if;
  if coalesce(no_number, false) and cc is distinct from 'TR' and cc is distinct from 'PT' then
    raise exception 'a registration number is required' using errcode = '22023';
  end if;

  insert into public.company_registrations as r
    (org_id, country_code, number, no_company_number, access_code, registration_letter_number, check_digit_confirmed, updated_by, updated_at)
  values (
    target_org, cc,
    case when coalesce(no_number, false) then null else public.normalise_registration_number(cc, number) end,
    coalesce(no_number, false),
    case when cc = 'PT' and code_digits <> ''
         then substr(code_digits, 1, 4) || '-' || substr(code_digits, 5, 4) || '-' || substr(code_digits, 9, 4) end,
    case when cc = 'TR' then nullif(letter, '') end,
    not coalesce(no_number, false) and coalesce(public.registration_number_problem(cc, number) = 'check_digit', false),
    auth.uid(), now()
  )
  on conflict (org_id) do update
    set country_code   = excluded.country_code,
        number         = excluded.number,
        no_company_number = excluded.no_company_number,
        access_code    = excluded.access_code,
        registration_letter_number = excluded.registration_letter_number,
        check_digit_confirmed = excluded.check_digit_confirmed,
        updated_by     = excluded.updated_by,
        updated_at     = case when (r.country_code, r.number, r.no_company_number, r.access_code, r.registration_letter_number)
                                   is distinct from (excluded.country_code, excluded.number, excluded.no_company_number, excluded.access_code, excluded.registration_letter_number)
                              then now() else r.updated_at end
  returning * into saved;
  return saved;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. "Official registry" means an official source
-- ---------------------------------------------------------------------------

create or replace function public.registry_source_is_official(source text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select source in ('vies', 'gib', 'gsxt', 'certidao', 'acts', 'permit', 'national')
$$;

grant execute on function public.registry_source_is_official(text) to authenticated, service_role;

create or replace function public.factory_registry_fact(target_org uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
           'checkedAt', c.checked_at,
           'kind', case when public.registry_source_is_official(c.source) then 'registry' else 'document' end)
    from public.current_registry_check(target_org) c
    join public.factory_profiles f on f.org_id = c.org_id
   where c.result = 'found'
     and f.verification_status = 'verified'
     and (f.published_at is not null or public.is_org_member(target_org) or public.is_platform_admin())
$$;

-- ---------------------------------------------------------------------------
-- 7. Signals: AI reading, address, photos, certificates
-- ---------------------------------------------------------------------------

create table public.verification_signals (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs (id) on delete cascade,
  kind        text not null check (kind in ('document_reading', 'address', 'photo', 'certificate')),
  -- The document (photo, registration) or factory_certifications row it is about.
  subject_id  uuid,
  result      text not null check (char_length(result) between 1 and 40),
  note        text check (char_length(note) <= 2000),
  details     jsonb not null default '{}'::jsonb,
  automatic   boolean not null default false,
  checked_by  uuid references auth.users (id) on delete set null,
  checked_at  timestamptz not null default now()
);

create index verification_signals_org_idx on public.verification_signals (org_id, kind, checked_at desc);
alter table public.verification_signals enable row level security;
revoke all on public.verification_signals from anon, authenticated;
grant all on public.verification_signals to service_role;

-- What staff record by hand: a photo's reverse search, a certificate's check.
create or replace function public.admin_record_signal(
  target_org uuid,
  kind       text,
  subject    uuid,
  result     text,
  note       text,
  details    jsonb default '{}'::jsonb
)
returns public.verification_signals
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  saved public.verification_signals;
  clean jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'only platform admins may record checks' using errcode = '42501';
  end if;
  if public.is_org_member(target_org) then
    raise exception 'staff cannot review a company they belong to' using errcode = '42501';
  end if;
  if kind = 'photo' then
    if result not in ('own', 'found_elsewhere', 'could_not_check') then
      raise exception 'result must be own, found_elsewhere or could_not_check' using errcode = '22023';
    end if;
    if not exists (select 1 from public.documents d where d.id = subject and d.org_id = target_org) then
      raise exception 'photo not found for this company' using errcode = 'P0002';
    end if;
  elsif kind = 'certificate' then
    if result not in ('found', 'not_found', 'expired', 'could_not_check') then
      raise exception 'result must be found, not_found, expired or could_not_check' using errcode = '22023';
    end if;
    if not exists (select 1 from public.factory_certifications c where c.id = subject and c.org_id = target_org) then
      raise exception 'certificate not found for this company' using errcode = 'P0002';
    end if;
  else
    raise exception 'staff record photo and certificate checks only' using errcode = '22023';
  end if;
  if nullif(trim(coalesce(note, '')), '') is null then
    raise exception 'say what you saw' using errcode = '22023';
  end if;
  select coalesce(jsonb_object_agg(k, left(trim(v), 500)), '{}'::jsonb) into clean
    from jsonb_each_text(coalesce(details, '{}'::jsonb)) as e(k, v)
   where k in ('link', 'number', 'source') and nullif(trim(v), '') is not null;
  if kind = 'photo' and result = 'found_elsewhere' and not clean ? 'link' then
    raise exception 'give the link where the photo was found' using errcode = '22023';
  end if;
  insert into public.verification_signals (org_id, kind, subject_id, result, note, details, automatic, checked_by)
  values (target_org, kind, subject, result, trim(note), clean, false, auth.uid())
  returning * into saved;
  return saved;
end;
$$;

revoke all on function public.admin_record_signal(uuid, text, uuid, text, text, jsonb) from public, anon;
grant execute on function public.admin_record_signal(uuid, text, uuid, text, text, jsonb) to authenticated;

-- The server's own (the AI reading, the address check). Service role only.
create or replace function public.record_verification_signal(
  target_org   uuid,
  kind         text,
  subject      uuid,
  result       text,
  details      jsonb,
  requested_by uuid
)
returns public.verification_signals
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.verification_signals (org_id, kind, subject_id, result, details, automatic, checked_by)
  values (target_org, kind, subject, result, coalesce(details, '{}'::jsonb), true, requested_by)
  returning *
$$;

revoke all on function public.record_verification_signal(uuid, text, uuid, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.record_verification_signal(uuid, text, uuid, text, jsonb, uuid) to service_role;

-- Everything the staff panel shows beyond the registry: photos and
-- certificates with their checks, the latest reading and address check, and
-- the registration files (newest first).
create or replace function public.admin_verification_signals(target_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'only platform admins may read verification checks' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'signals', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'kind', s.kind, 'subjectId', s.subject_id, 'result', s.result, 'note', s.note,
        'details', s.details, 'automatic', s.automatic, 'checkedAt', s.checked_at,
        'checkedBy', coalesce(nullif(p.full_name, ''), u.email::text))
        order by s.checked_at desc)
        from public.verification_signals s
        left join auth.users u on u.id = s.checked_by
        left join public.user_profiles p on p.id = s.checked_by
       where s.org_id = target_org), '[]'::jsonb),
    'photos', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'bucket', d.bucket, 'path', d.storage_path, 'name', d.file_name, 'kind', d.kind)
        order by d.created_at)
        from public.documents d
       where d.org_id = target_org and d.kind in ('product_image', 'walkthrough') and d.bucket = 'org-public'
         and coalesce(d.mime_type, 'image/') like 'image/%'), '[]'::jsonb),
    'registrationFiles', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'bucket', d.bucket, 'path', d.storage_path, 'name', d.file_name,
                                          'mimeType', d.mime_type, 'createdAt', d.created_at)
        order by d.created_at desc)
        from public.documents d
       where d.org_id = target_org and d.kind = 'business_registration'), '[]'::jsonb),
    'certificates', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'slug', t.slug, 'label', t.label_en,
                                          'expiresAt', c.expires_at, 'status', c.status,
                                          'document', case when d.id is null then null else
                                            jsonb_build_object('id', d.id, 'bucket', d.bucket, 'path', d.storage_path, 'name', d.file_name, 'mimeType', d.mime_type) end)
        order by t.label_en)
        from public.factory_certifications c
        join public.taxonomy_terms t on t.id = c.term_id
        left join public.documents d on d.id = c.document_id
       where c.org_id = target_org), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.admin_verification_signals(uuid) from public, anon;
grant execute on function public.admin_verification_signals(uuid) to authenticated;

-- What a brand learns about a vendor's certificates: which ones staff found
-- on the issuer's own lookup, and the month. Only for a verified, published
-- vendor (or its own members, or staff); never the note, number or person.
create or replace function public.factory_certificate_checks(target_org uuid)
returns table (certification_id uuid, term_id uuid, checked_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.id, c.term_id, s.checked_at
    from public.factory_certifications c
    join public.factory_profiles f on f.org_id = c.org_id
    join lateral (
      select v.result, v.checked_at from public.verification_signals v
       where v.org_id = c.org_id and v.kind = 'certificate' and v.subject_id = c.id and not v.automatic
       order by v.checked_at desc limit 1) s on true
   where c.org_id = target_org
     and s.result = 'found'
     and f.verification_status = 'verified'
     and (f.published_at is not null or public.is_org_member(target_org) or public.is_platform_admin())
$$;

revoke all on function public.factory_certificate_checks(uuid) from public, anon;
grant execute on function public.factory_certificate_checks(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. The staff panel's detail and the queue
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
begin
  if not public.is_platform_admin() then
    raise exception 'only platform admins may read registry checks'
      using errcode = '42501';
  end if;
  select r.number into reg_number from public.company_registrations r where r.org_id = target_org;
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
    'current', (select to_jsonb(c) from public.current_registry_check(target_org) c where c.id is not null),
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

drop function public.admin_registry_states();

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
           case when c.result = 'found' then 'found'
                when f.verification_status = 'verified' and (c.id is not null or exists (
                  select 1 from public.registry_checks x where x.org_id = f.org_id and not x.automatic)) then 'lost'
                else 'none' end,
           case when c.id is null then null
                when public.registry_source_is_official(c.source) then 'registry' else 'document' end,
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

revoke all on function public.admin_registry_states() from public, anon;
grant execute on function public.admin_registry_states() to authenticated;

-- ---------------------------------------------------------------------------
-- 9. A brand cannot invite a factory that is not verified
-- ---------------------------------------------------------------------------

-- Only a signed-in person's insert is checked: the server's own writes and
-- fixtures are not. A pending factory's page is reachable by its link; the
-- page greys "Request quote", and this is what that grey stands for.
create or replace function public.guard_invite_verified_factory()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;
  if not exists (select 1 from public.factory_profiles f
                  where f.org_id = new.factory_org_id and f.verification_status = 'verified') then
    raise exception 'this vendor is not verified yet' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_invite_verified_factory() from public, anon, authenticated;

create trigger rfq_invitations_verified_factory
  before insert on public.rfq_invitations
  for each row execute function public.guard_invite_verified_factory();
