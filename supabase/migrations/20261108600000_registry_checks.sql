-- Basic verification, part 1 (Nov 8): a company's registration number, the
-- official-registry checks staff record against it, and two holes closed.
--
-- 1. `company_registrations`: the number in its country's form (China's
--    Unified Social Credit Code, Turkey's VKN plus trade registry no., Portugal's NIPC plus
--    the permanent-certificate access code, anything else as written). Members
--    and staff read it; a brand never does. Written only by
--    `save_company_registration()`, which refuses a number that fails its
--    country's format or check digit (same rules as
--    src/shared/registration-number.mjs; `npm run check:registration`).
-- 2. `registry_checks`: what staff (or the server, for VIES) found, where, by
--    whom and when. Staff-only. A machine never rejects: a source that is down
--    is recorded as "could_not_check" and the decision stays a person's.
-- 3. `factory_registry_fact()`: the one thing a brand learns from it, the
--    month a verified vendor's registration was last found on an official
--    source.
-- 4. `review_document()` no longer verifies the company. Marking a
--    registration FILE verified used to hand out quoting and the 500 credits
--    with none of the other checks; approval is one act,
--    `admin_review_decision()`.
-- 5. A member could write `documents.status` (documents_own is `for all`),
--    e.g. un-reject a walkthrough to reach the Verified tier. Now refused.

-- ---------------------------------------------------------------------------
-- The rules
-- ---------------------------------------------------------------------------

create or replace function public.normalise_registration_number(country text, raw text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  -- A Chinese keyboard types full-width digits and letters (１２３, ＡＢＣ):
  -- they are the same characters to us.
  with t as (
    select regexp_replace(upper(translate(coalesce(raw, ''),
      '０１２３４５６７８９ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ－．／　',
      '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-./ ')), '[\s./-]', '', 'g') as v
  )
  select case when country = 'PT' and v ~ '^PT\d{9}$' then substr(v, 3) else v end from t
$$;

-- Null when acceptable; else 'missing', 'format', 'old_number' (China's
-- pre-2017 15 digits) or 'check_digit' (which the factory may confirm).
-- Turkey is the VKN (10 digits, mod-10), the one Turkish number with a check
-- digit (research, Nov 8).
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
begin
  if v = '' then return 'missing'; end if;
  if country = 'CN' then
    if v ~ '^\d{15}$' then return 'old_number'; end if;
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

grant execute on function public.normalise_registration_number(text, text) to authenticated, service_role;
grant execute on function public.registration_number_problem(text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. The number
-- ---------------------------------------------------------------------------

create table public.company_registrations (
  org_id       uuid primary key references public.orgs (id) on delete cascade,
  country_code text check (country_code ~ '^[A-Z]{2}$'),
  -- Null only for a sole proprietor, whose tax number is the owner's
  -- national ID and is never asked for (no_company_number).
  number       text,
  no_company_number boolean not null default false,
  access_code  text check (access_code ~ '^\d{4}-\d{4}-\d{4}$'),
  -- Turkey: the number on the tax registration letter (mükellefiyet
  -- yazısı), which staff enter with the VKN at GİB's letter check.
  registration_letter_number text check (char_length(registration_letter_number) between 1 and 40),
  -- The check digit failed and the factory said the number is right anyway.
  check_digit_confirmed boolean not null default false,
  updated_by   uuid references auth.users (id) on delete set null,
  updated_at   timestamptz not null default now(),
  check (number is not null or no_company_number)
);

alter table public.company_registrations enable row level security;

create policy company_registrations_read on public.company_registrations
  for select to authenticated
  using (public.is_org_member(org_id) or public.is_platform_admin());

revoke all on public.company_registrations from anon, authenticated;
grant select on public.company_registrations to authenticated;
grant all on public.company_registrations to service_role;

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
  saved public.company_registrations;
begin
  -- The number is what staff check and what a brand's dated fact rests on,
  -- so it is a company setting: owners and Settings access only.
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

  if char_length(trim(coalesce(registration_letter_number, ''))) > 40 then
    raise exception 'registration letter number is too long' using errcode = '22023';
  end if;
  -- No company number is a sole proprietor's answer in Turkey and Portugal
  -- (their tax number is the owner's ID). In China an individual business
  -- has a credit code (92…), so the code is always required there.
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
    case when cc = 'TR' then nullif(regexp_replace(trim(coalesce(registration_letter_number, '')), '\s+', ' ', 'g'), '') end,
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

revoke all on function public.save_company_registration(uuid, text, text, text, text, boolean, boolean) from public, anon;
grant execute on function public.save_company_registration(uuid, text, text, text, text, boolean, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. What was checked
-- ---------------------------------------------------------------------------

create table public.registry_checks (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.orgs (id) on delete cascade,
  country_code   text,
  number_checked text,
  source         text not null check (source ~ '^[a-z_]{2,20}$'),
  -- 'registered' is VIES's own answer (a VAT registration exists, maybe under
  -- another company's name): never a match, only a person records 'found'.
  result         text not null check (result in ('found', 'mismatch', 'not_found', 'could_not_check', 'registered')),
  note           text check (char_length(note) <= 2000),
  details        jsonb not null default '{}'::jsonb,
  automatic      boolean not null default false,
  checked_by     uuid references auth.users (id) on delete set null,
  checked_at     timestamptz not null default now()
);

create index registry_checks_org_idx on public.registry_checks (org_id, checked_at desc);

alter table public.registry_checks enable row level security;
-- No policy and no grant: staff read and write through the functions below.
revoke all on public.registry_checks from anon, authenticated;
grant all on public.registry_checks to service_role;

create or replace function public.admin_record_registry_check(
  target_org uuid,
  source     text,
  result     text,
  note       text default null,
  -- Staff say they looked at VIES themselves, when VIES's own latest answer
  -- on this number was not "registered".
  confirmed  boolean default false
)
returns public.registry_checks
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  reg public.company_registrations;
  saved public.registry_checks;
begin
  if not public.is_platform_admin() then
    raise exception 'only platform admins may record registry checks'
      using errcode = '42501';
  end if;
  if not exists (select 1 from public.orgs o where o.id = target_org) then
    raise exception 'company not found' using errcode = 'P0002';
  end if;
  if result not in ('found', 'mismatch', 'not_found', 'could_not_check') then
    raise exception 'result must be found, mismatch, not_found or could_not_check' using errcode = '22023';
  end if;
  -- Every result says what was seen (the name as the registry or the
  -- document shows it), so a "found" can be checked by the next person.
  if nullif(trim(coalesce(note, '')), '') is null then
    raise exception 'say what you saw: the name as shown, what differed, or why it could not be checked'
      using errcode = '22023';
  end if;

  select * into reg from public.company_registrations r where r.org_id = target_org;

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

  insert into public.registry_checks (org_id, country_code, number_checked, source, result, note, automatic, checked_by)
  values (target_org, reg.country_code, reg.number, source, result, nullif(trim(coalesce(note, '')), ''), false, auth.uid())
  returning * into saved;
  return saved;
end;
$$;

revoke all on function public.admin_record_registry_check(uuid, text, text, text, boolean) from public, anon;
grant execute on function public.admin_record_registry_check(uuid, text, text, text, boolean) to authenticated;

-- The server's own record (VIES). Service role only: a client that could call
-- it would write its own "found".
create or replace function public.record_registry_check(
  target_org     uuid,
  number_checked text,
  source         text,
  result         text,
  details        jsonb default '{}'::jsonb,
  requested_by   uuid default null
)
returns public.registry_checks
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  saved public.registry_checks;
begin
  insert into public.registry_checks (org_id, country_code, number_checked, source, result, details, automatic, checked_by)
  select target_org, r.country_code, number_checked, source, result, coalesce(details, '{}'::jsonb), true, requested_by
    from (select (select country_code from public.company_registrations where org_id = target_org) as country_code) r
  returning * into saved;
  return saved;
end;
$$;

revoke all on function public.record_registry_check(uuid, text, text, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.record_registry_check(uuid, text, text, text, jsonb, uuid) to service_role;

-- Who may ask the server to run a registry check for a company: staff, or the
-- company's own members (after saving their number).
create or replace function public.can_request_registry_check(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_platform_admin() or public.is_org_member(target_org)
$$;

revoke all on function public.can_request_registry_check(uuid) from public, anon;
grant execute on function public.can_request_registry_check(uuid) to authenticated;

-- Everything the staff panel shows: the number and every check, newest first,
-- with who checked.
create or replace function public.admin_registry_detail(target_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'only platform admins may read registry checks'
      using errcode = '42501';
  end if;
  return jsonb_build_object(
    'registration', (
      select jsonb_build_object(
        'country', r.country_code, 'number', r.number, 'noCompanyNumber', r.no_company_number, 'accessCode', r.access_code,
        'registrationLetterNumber', r.registration_letter_number, 'confirmed', r.check_digit_confirmed,
        'problem', public.registration_number_problem(r.country_code, r.number),
        'updatedAt', r.updated_at)
        from public.company_registrations r where r.org_id = target_org),
    'location', (select f.location from public.factory_profiles f where f.org_id = target_org),
    'title', (select coalesce(nullif(f.legal_name, ''), o.name) from public.orgs o
                left join public.factory_profiles f on f.org_id = o.id where o.id = target_org),
    'current', (select to_jsonb(c) from public.current_registry_check(target_org) c where c.id is not null),
    'sameNumber', (
      select count(distinct o.org_id)::int
        from public.company_registrations o
        join public.company_registrations r on r.org_id = target_org
       where o.org_id <> target_org and o.number = r.number and r.number is not null
         and o.country_code is not distinct from r.country_code),
    'countryCode', coalesce(
      (select r.country_code from public.company_registrations r where r.org_id = target_org),
      (select f.country_code from public.factory_profiles f where f.org_id = target_org)),
    'checks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'source', c.source, 'result', c.result, 'note', c.note,
        'details', c.details, 'automatic', c.automatic,
        'numberChecked', c.number_checked, 'checkedAt', c.checked_at,
        'checkedBy', coalesce(nullif(p.full_name, ''), u.email::text))
        order by c.checked_at desc)
        from public.registry_checks c
        left join auth.users u on u.id = c.checked_by
        left join public.user_profiles p on p.id = c.checked_by
       where c.org_id = target_org), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.admin_registry_detail(uuid) from public, anon;
grant execute on function public.admin_registry_detail(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. What a brand learns
-- ---------------------------------------------------------------------------

-- The latest check a PERSON recorded against the company's current number
-- decides: 'found' gives the brand its dated fact; a later mismatch or not
-- found takes it away, and so does changing the number. VIES's automatic
-- answer never counts (a valid VAT number can be another company's).
create or replace function public.current_registry_check(target_org uuid)
returns public.registry_checks
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.*
    from public.registry_checks c
    join public.company_registrations r on r.org_id = c.org_id
     and (r.number = c.number_checked
          -- A sole proprietor in Turkey or Portugal, checked on its documents.
          or (r.number is null and c.number_checked is null and r.no_company_number
              and r.country_code in ('TR', 'PT')))
   where c.org_id = target_org
     and not c.automatic
   order by c.checked_at desc
   limit 1
$$;

revoke all on function public.current_registry_check(uuid) from public, anon, authenticated;

-- What a brand learns: when the company was last found to match, and on
-- what kind of source ('registry', or 'document' for its uploaded
-- registration), and nothing else (no number, note or person). Null for an
-- unverified or unpublished vendor, or when the current check is no match.
create or replace function public.factory_registry_fact(target_org uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
           'checkedAt', c.checked_at,
           'kind', case when c.source = 'document' then 'document' else 'registry' end)
    from public.current_registry_check(target_org) c
    join public.factory_profiles f on f.org_id = c.org_id
   where c.result = 'found'
     and f.verification_status = 'verified'
     and (f.published_at is not null or public.is_org_member(target_org) or public.is_platform_admin())
$$;

revoke all on function public.factory_registry_fact(uuid) from public, anon;
grant execute on function public.factory_registry_fact(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. A registration file no longer verifies the company
-- ---------------------------------------------------------------------------

create or replace function public.review_document(
  document_id uuid,
  decision    public.verification_status,
  note        text default null
)
returns public.documents
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  reviewed public.documents;
begin
  if not public.is_platform_admin() then
    raise exception 'only platform admins may review documents'
      using errcode = '42501';
  end if;

  if decision not in ('verified', 'rejected', 'pending') then
    raise exception 'review decision must be verified, rejected or pending'
      using errcode = '22023';
  end if;

  update public.documents
     set status = decision,
         reviewed_by = auth.uid(),
         reviewed_at = now(),
         review_note = note
   where id = document_id
  returning * into reviewed;

  if not found then
    raise exception 'document not found' using errcode = 'P0002';
  end if;

  -- A business registration file is one piece of evidence. The company is
  -- approved (quoting, the 500 credits) only by admin_review_decision().

  if reviewed.kind = 'certificate' then
    update public.factory_certifications c
       set status = decision
     where c.document_id = reviewed.id;
  end if;

  return reviewed;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. A member cannot review its own files
-- ---------------------------------------------------------------------------

create or replace function public.guard_document_review()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user not in ('authenticated', 'anon') or public.is_platform_admin() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.status not in ('unverified', 'pending') then
      new.status := 'unverified';
    end if;
    new.reviewed_by := null;
    new.reviewed_at := null;
    new.review_note := null;
  elsif new.status is distinct from old.status
     or new.reviewed_by is distinct from old.reviewed_by
     or new.reviewed_at is distinct from old.reviewed_at
     or new.review_note is distinct from old.review_note then
    raise exception 'only TSC staff can review a document' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_document_review() from public, anon, authenticated;

create trigger documents_guard_review
  before insert or update on public.documents
  for each row execute function public.guard_document_review();

-- ---------------------------------------------------------------------------
-- 6. Basic means the registry was checked
-- ---------------------------------------------------------------------------

-- Approving a vendor needs a person's "found, matches" on its current number
-- (the panel greys "Approve" and says why). Only the move INTO approved is
-- checked, so a badge change on a company already approved still works. SQL
-- tests that approve fixtures with no registry set `tsc.skip_registry_guard`;
-- no client can set it (set_config is not in an exposed schema).
create or replace function public.guard_approval_needs_registry()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
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
  if coalesce((select c.result from public.current_registry_check(new.org_id) c), '') <> 'found' then
    raise exception 'record a registry check that found the company (on its current number) before approving'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_approval_needs_registry() from public, anon, authenticated;

create trigger org_reviews_approval_needs_registry
  before insert or update of state on public.org_reviews
  for each row execute function public.guard_approval_needs_registry();

-- ---------------------------------------------------------------------------
-- 7. Staff: each vendor's registry state, for the queue
-- ---------------------------------------------------------------------------

-- 'found' (with the source kind), 'lost' (verified, but its current check is
-- not a match: a later not found, or a changed number), or 'none'. Staff have
-- no org and cannot be notified, so the queue is where a lost check shows.
create or replace function public.admin_registry_states()
returns table (org_id uuid, state text, kind text, checked_at timestamptz, registration_uploaded_at timestamptz)
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
           case when c.source = 'document' then 'document' when c.id is not null then 'registry' end,
           c.checked_at,
           -- The latest registration upload, so the queue says both dates in
           -- the reader's zone (the check line's own date is UTC text).
           (select max(d.created_at) from public.documents d
             where d.org_id = f.org_id and d.kind = 'business_registration')
      from public.factory_profiles f
      left join lateral (select * from public.current_registry_check(f.org_id)) c on true;
end;
$$;

revoke all on function public.admin_registry_states() from public, anon;
grant execute on function public.admin_registry_states() to authenticated;

-- ---------------------------------------------------------------------------
-- 8. A brand no longer opens a factory's registration documents
-- ---------------------------------------------------------------------------

-- A registration (licence, tax registration letter) carries the
-- number staff check and, for a sole proprietor, the owner's national ID. The
-- brand reads its status and the dated fact instead. Certificates stay
-- readable. Both the documents policy and the storage policy call this
-- function (20261104000500), so this one change closes both.
create or replace function public.can_preview_vendor_document(target_document uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.documents d
    join public.factory_profiles f on f.org_id = d.org_id
    where d.id = target_document and f.published_at is not null
      and d.kind = 'certificate'
      and exists (select 1 from public.org_members m join public.orgs o on o.id = m.org_id
                  where m.user_id = auth.uid() and o.type = 'brand')
  );
$$;
