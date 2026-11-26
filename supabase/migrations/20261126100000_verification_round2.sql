-- Verification, second round (Nov 26).
--
-- 1. A typed registration number keeps only the number: "NIF 519211596",
--    "NIPC: 519211596", "VKN 4837261591", "统一社会信用代码：…", "No: 12345"
--    are stored as the bare number (normalise_registration_number, the same
--    rule as normaliseRegistrationNumber() in src/shared/registration-number.mjs).
--    A number in the wrong format says what the country's number looks like
--    (registration_number_format_text, registrationProblemText()).
-- 2. The licence reading is compared with the company as it is now. The
--    reading keeps what the document says; registry_reading_differs() works
--    out the differences when asked, so a reading never goes out of date
--    because the number changed, and a corrected number or name settles a
--    difference at once.
-- 3. The verification queue lists only companies that finished signup, and a
--    signed-in client cannot mark signup finished before the company has
--    signed the current terms of its kind. Fixtures, the seed and server code
--    (any role but authenticated) are not checked.
-- 4. Staff edit a company's name, country and website where the review page
--    shows them (admin_update_company_profile, factories and brands), with a
--    history line per field and one notice to the company.
--
-- Additive for the live site: every function keeps its signature except
-- admin_update_company_profile, whose old (uuid, text, text) form is dropped
-- and recreated with three more defaulted parameters, so calls with two or
-- three arguments still work.

-- ---------------------------------------------------------------------------
-- 1. Registration numbers
-- ---------------------------------------------------------------------------

create or replace function public.normalise_registration_number(country text, raw text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  with t as (
    select btrim(replace(upper(translate(public.strip_invisible(raw),
      '０１２３４５６７８９ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ－．／　：＃',
      '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-./ :#')), 'İ', 'I'), E' \t\r\n') as v
  ), labelled as (
    -- The label typed before the number. A Latin one needs a space, colon,
    -- "#" or dot after it, so a number that starts with those letters keeps them.
    select regexp_replace(regexp_replace(v,
             '^(统一社会信用代码|社会信用代码|信用代码)\s*:?\s*(?=\S)', ''),
             '^(UNIFIED SOCIAL CREDIT CODE|USCC|NIF/NIPC|NIPC|NIF|VKN|VERGI NO|VERGI NUMARASI|TAX ID|TAX NO|VAT NO|VAT|NO|NR|Nº|N\.º)(\s*[:#.]+\s*|\s+)(?=\S)', '') as v
      from t
  ), bare as (
    select regexp_replace(v, '[\s ./-]', '', 'g') as v from labelled
  )
  select case when country = 'PT' and v ~ '^PT\d{9}$' then substr(v, 3) else v end from bare
$$;

-- What a country's number looks like; null where there is no rule.
create or replace function public.registration_number_format_text(country text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case country
    when 'CN' then 'A Unified Social Credit Code has 18 characters, e.g. 91330100MA2B7C4D3F'
    when 'TR' then 'A Turkish company tax number (VKN) has 10 digits, e.g. 4837261591'
    when 'PT' then 'A Portuguese company number has 9 digits, e.g. 519211596'
  end
$$;
grant execute on function public.registration_number_format_text(text) to authenticated, service_role;


-- From 20261124330000, the wrong-format message says what the number looks like.
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
        raise exception '%', coalesce(public.registration_number_format_text(cc) || ': copy it again from the registry',
                                      'the registration number is not in the usual format: copy it again from the registry')
          using errcode = '22023';
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

-- From 20261111120000, the same.
create or replace function public.admin_set_registration_number(
  target_org uuid,
  number     text,
  note       text,
  country    text default null
)
returns public.company_registrations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cc text;
  v text;
  problem text;
  said text := trim(coalesce(note, ''));
  saved public.company_registrations;
begin
  if not public.is_platform_admin() then
    raise exception 'only platform admins may set a registration number' using errcode = '42501';
  end if;
  if public.is_org_member(target_org) then
    raise exception 'staff cannot review a company they belong to' using errcode = '42501';
  end if;
  if not exists (select 1 from public.orgs o where o.id = target_org and o.type = 'factory') then
    raise exception 'org not found' using errcode = 'P0002';
  end if;
  cc := coalesce(nullif(upper(trim(coalesce(country, ''))), ''),
                 (select r.country_code from public.company_registrations r where r.org_id = target_org),
                 (select f.country_code from public.factory_profiles f where f.org_id = target_org));
  if cc is null or cc !~ '^[A-Z]{2}$' then
    raise exception 'country must be a two-letter code' using errcode = '22023';
  end if;
  if said = '' then
    raise exception 'say where the number comes from' using errcode = '22023';
  end if;
  v := public.normalise_registration_number(cc, number);
  problem := public.registration_number_problem(cc, v);
  if problem = 'old_number' then
    problem := null;
  end if;
  if problem = 'format' and public.registration_number_format_text(cc) is not null then
    raise exception '%', public.registration_number_format_text(cc) using errcode = '22023';
  end if;
  if problem is not null then
    raise exception 'registration number: %', problem using errcode = '22023';
  end if;

  insert into public.company_registrations as r
    (org_id, country_code, number, number_source, no_company_number, check_digit_confirmed, updated_by, updated_at)
  values (target_org, cc, v, 'staff', false, false, auth.uid(), now())
  on conflict (org_id) do update
    set country_code = excluded.country_code,
        number = excluded.number,
        number_source = 'staff',
        no_company_number = false,
        check_digit_confirmed = false,
        updated_by = excluded.updated_by,
        updated_at = case when (r.country_code, r.number) is distinct from (excluded.country_code, excluded.number)
                          then now() else r.updated_at end
  returning * into saved;

  insert into public.registration_number_entries (org_id, country_code, number, note, entered_by)
  values (target_org, cc, v, left(said, 2000), auth.uid());
  return saved;
end;
$$;

revoke all on function public.admin_set_registration_number(uuid, text, text, text) from public, anon;
grant execute on function public.admin_set_registration_number(uuid, text, text, text) to authenticated;
-- ---------------------------------------------------------------------------
-- 2. The licence reading against the company as it is now
-- ---------------------------------------------------------------------------

-- At most one character apart on a CJK name of four or more characters: a
-- blurred photo's misread, which staff look at, never "differs" (nearlySameCjk
-- in api/registry-assist.js, on company_name_key without spaces).
create or replace function public.cjk_names_nearly_same(a text, b text)
returns boolean
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  x text := replace(public.company_name_key(a), ' ', '');
  y text := replace(public.company_name_key(b), ' ', '');
  i int := 0;
  j int := 0;
begin
  if x = '' or y = '' or x = y or x !~ '[㐀-鿿豈-﫿]' or y !~ '[㐀-鿿豈-﫿]' then
    return false;
  end if;
  if least(length(x), length(y)) < 4 or abs(length(x) - length(y)) > 1 then
    return false;
  end if;
  while i < length(x) and i < length(y) and substr(x, i + 1, 1) = substr(y, i + 1, 1) loop
    i := i + 1;
  end loop;
  while j < length(x) - i and j < length(y) - i
        and substr(x, length(x) - j, 1) = substr(y, length(y) - j, 1) loop
    j := j + 1;
  end loop;
  return length(x) - i - j <= 1 and length(y) - i - j <= 1;
end;
$$;

-- The latest AI reading of the latest registration file, when what it read
-- differs from the company now: `{ id, differences }`, null when it agrees or
-- there is none. Worked out on every call from details.extracted, the same
-- rule as compareDocument() (api/registry-assist.js): a number the document
-- writes another way by the country's rule is the same; a misread number
-- (wrong format or check digit, while the company's is valid) and a CJK name
-- one character off are for staff to look at, not differences.
create or replace function public.registry_reading_differs(target_org uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with reading as (
    select s.id, s.details -> 'extracted' as x
      from public.verification_signals s
     where s.org_id = target_org and s.kind = 'document_reading' and s.automatic
       and s.subject_id = (select d.id from public.documents d
                            where d.org_id = target_org and d.kind = 'business_registration'
                            order by d.created_at desc limit 1)
       and s.id = (select x.id from public.verification_signals x
                    where x.org_id = target_org and x.kind = 'document_reading' and x.automatic
                    order by x.checked_at desc limit 1)
  ), company as (
    select r.country_code as cc, r.number, public.company_title(target_org) as title
      from (select target_org as org_id) o
      left join public.company_registrations r on r.org_id = o.org_id
  ), values_read as (
    select rd.id, c.cc, c.number, c.title,
           nullif(trim(coalesce(rd.x ->> 'registrationNumber', '')), '') as doc_number_raw,
           public.normalise_registration_number(c.cc, rd.x ->> 'registrationNumber') as doc_number,
           public.normalise_registration_number(c.cc, c.number) as typed,
           array_remove(array[nullif(trim(coalesce(rd.x ->> 'legalName', '')), ''),
                              nullif(trim(coalesce(rd.x ->> 'legalNameEnglish', '')), '')], null) as names
      from reading rd cross join company c
  ), lines as (
    select v.id, jsonb_build_object('field', 'number', 'document', v.doc_number_raw, 'typed', v.number) as line, 1 as at
      from values_read v
     where v.doc_number <> '' and v.typed <> '' and v.doc_number <> v.typed
       and not public.registration_numbers_same(coalesce(v.cc, ''), v.doc_number, v.typed)
       and not (v.cc is not null
                and public.registration_number_problem(v.cc, v.doc_number) is not null
                and public.registration_number_problem(v.cc, v.typed) is null)
    union all
    select v.id, jsonb_build_object('field', 'name', 'document', array_to_string(v.names, ' / '), 'typed', v.title), 2
      from values_read v
     where cardinality(v.names) > 0 and nullif(trim(coalesce(v.title, '')), '') is not null
       and not exists (select 1 from unnest(v.names) n(name) where public.company_names_match(n.name, v.title))
       and not exists (select 1 from unnest(v.names) n(name) where public.cjk_names_nearly_same(n.name, v.title))
  )
  select jsonb_build_object('id', min(l.id::text)::uuid, 'differences', jsonb_agg(l.line order by l.at))
    from lines l
  having count(*) > 0
$$;
revoke all on function public.registry_reading_differs(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Finished signup
-- ---------------------------------------------------------------------------

-- A signed-in client marking its company's signup finished (insert or update
-- of onboarding_completed_at from nothing) needs the current terms of its
-- kind signed. Only the authenticated role is checked: the seed, fixtures and
-- server code run as other roles. Runs as the definer, so it reads
-- current_user before anything else: inside, current_user is the owner, and
-- the caller's role is the transaction's `role` setting.
create or replace function public.guard_onboarding_needs_terms()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.onboarding_completed_at is null
     or (tg_op = 'UPDATE' and old.onboarding_completed_at is not null) then
    return new;
  end if;
  if coalesce(nullif(current_setting('role', true), ''), 'none') <> 'authenticated' then
    return new;
  end if;
  if not public.org_signed_current_terms(new.org_id) then
    raise exception 'Sign the terms to finish signing up' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_onboarding_needs_terms() from public, anon, authenticated;

drop trigger if exists factory_profiles_onboarding_needs_terms on public.factory_profiles;
create trigger factory_profiles_onboarding_needs_terms
  before insert or update of onboarding_completed_at on public.factory_profiles
  for each row execute function public.guard_onboarding_needs_terms();
drop trigger if exists brand_profiles_onboarding_needs_terms on public.brand_profiles;
create trigger brand_profiles_onboarding_needs_terms
  before insert or update of onboarding_completed_at on public.brand_profiles
  for each row execute function public.guard_onboarding_needs_terms();

-- The queue: only companies that finished signup. Same signature and columns;
-- everything else is 20261119100000's text.
create or replace function public.admin_verification_queue()
returns table (
  org_id              uuid,
  org_name            text,
  org_type            public.org_type,
  org_slug            text,
  vendor_kind         public.vendor_kind,
  location            text,
  legal_name          text,
  website_url         text,
  intro               text,
  submitted_at        timestamptz,
  state               public.org_review_state,
  risk                public.org_review_risk,
  note                text,
  owner_user_id       uuid,
  owner_name          text,
  verification_status public.verification_status,
  evidence_received   integer,
  evidence_expected   integer,
  profile_completion  integer,
  verification_score  integer,
  verification_checks jsonb,
  capabilities        jsonb,
  decided_at          timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- First statement, before any select: checking afterwards leaks whether a
  -- row exists through the difference between P0002 and 42501.
  if not public.is_platform_admin() then
    raise exception 'this queue is limited to platform staff' using errcode = '42501';
  end if;

  return query
  with candidates as (
    select
      o.id,
      o.name,
      o.type,
      o.slug,
      f.vendor_kind                    as vendor_kind,
      f.location                       as location,
      f.legal_name                     as legal_name,
      f.website_url                    as website_url,
      f.intro                          as intro,
      f.verification_status            as verification_status,
      -- The latest submission: a profile sent back counts from then.
      greatest(
        coalesce(f.onboarding_completed_at, f.updated_at),
        (select max(x.resubmitted_at) from public.review_resubmission_email_outbox x where x.org_id = o.id)
      ) as submitted_at
    from public.orgs o
    join public.factory_profiles f on f.org_id = o.id
    where o.is_demo = false
      -- Only a company that finished signup (Nov 26): an upload alone no longer lists it.
      and f.onboarding_completed_at is not null

    union all

    select
      o.id,
      o.name,
      o.type,
      o.slug,
      null::public.vendor_kind,
      b.hq_location,
      b.legal_name,
      b.website_url,
      b.intro,
      b.verification_status,
      greatest(
        coalesce(b.onboarding_completed_at, b.updated_at),
        (select max(x.resubmitted_at) from public.review_resubmission_email_outbox x where x.org_id = o.id)
      )
    from public.orgs o
    join public.brand_profiles b on b.org_id = o.id
    where o.is_demo = false
      -- Only a company that finished signup (Nov 26): an upload alone no longer lists it.
      and b.onboarding_completed_at is not null
  )
  select
    c.id,
    c.name,
    c.type,
    c.slug,
    c.vendor_kind,
    c.location,
    c.legal_name,
    c.website_url,
    c.intro,
    c.submitted_at,
    coalesce(r.state, case c.verification_status
      when 'verified' then 'approved'::public.org_review_state
      when 'rejected' then 'declined'::public.org_review_state
      else 'ready_for_review'::public.org_review_state
    end),
    r.risk,
    r.note,
    r.owner_user_id,
    u.full_name,
    c.verification_status,
    -- Capped. org_evidence_received() counts every registration document, so
    -- a company that uploaded its licence three times was rendering on the
    -- review screen as "3 of 1 received".
    least(public.org_evidence_received(c.id), public.org_evidence_expected(c.id)),
    public.org_evidence_expected(c.id),
    public.org_profile_completion(c.id),
    public.org_verification_score(c.id),
    public.org_verification_checks(c.id),
    -- What the company says it does, for the designed chip section. Labels,
    -- not slugs: this is the one place the vocabulary is displayed rather
    -- than matched on.
    coalesce((
      select jsonb_agg(t.label_en order by t.label_en)
        from public.taxonomy_links l
        join public.taxonomy_terms t on t.id = l.term_id
       where l.org_id = c.id
         and l.subject_type in ('brand_profile', 'factory_profile')
    ), '[]'::jsonb),
    r.decided_at
  from candidates c
  left join public.org_reviews r on r.org_id = c.id
  left join public.user_profiles u on u.id = r.owner_user_id
  order by
    -- Undecided first, oldest submission first inside that: a queue sorted by
    -- how long someone has been waiting, not by when we last touched it.
    case coalesce(r.state, case c.verification_status
      when 'verified' then 'approved'::public.org_review_state
      when 'rejected' then 'declined'::public.org_review_state
      else 'ready_for_review'::public.org_review_state
    end)
      when 'ready_for_review'  then 0
      when 'in_review'         then 1
      when 'needs_information' then 2
      else 3
    end,
    c.submitted_at asc;
end;
$$;

revoke all on function public.admin_verification_queue() from public, anon;
grant execute on function public.admin_verification_queue() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Staff edit a company's name, country and website
-- ---------------------------------------------------------------------------

alter table public.org_review_changes drop constraint if exists org_review_changes_kind_check;
alter table public.org_review_changes add constraint org_review_changes_kind_check
  check (kind in ('registry_check', 'certificate_check', 'vendor_kind', 'address',
                  'address_check', 'scope_check', 'licence_check', 'decision',
                  'company_name', 'country', 'website'));

-- The country shown is the last part of the location ("Porto, Portugal").
create or replace function public.location_with_country(location text, country_label text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when nullif(trim(coalesce(location, '')), '') is null or position(',' in location) = 0 then country_label
    else regexp_replace(location, ',[^,]*$', '') || ', ' || country_label
  end
$$;
revoke all on function public.location_with_country(text, text) from public, anon, authenticated;

drop function if exists public.admin_update_company_profile(uuid, text, text);

-- Only the arguments given change. Type and address are a vendor's; name,
-- country and website any company's. A country is a code or a name from the
-- country list ("PT", "Portugal"); for a factory it sets country_code and the
-- location's last part, for a brand the location's last part. An empty
-- website clears it; an empty name or country is refused. One history line
-- per changed field and one notice to the company.
create function public.admin_update_company_profile(
  target_org   uuid,
  vendor_kind  text default null,
  address      text default null,
  company_name text default null,
  country      text default null,
  website      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  new_kind text := nullif(trim(coalesce(vendor_kind, '')), '');
  new_address text := nullif(trim(coalesce(address, '')), '');
  new_name text := trim(company_name);
  new_country text := trim(country);
  new_website text := nullif(trim(coalesce(website, '')), '');
  company public.orgs;
  old_kind text;
  old_address text;
  old_location text;
  old_country text;
  old_website text;
  country_code_new text;
  country_label text;
  kind_changed boolean := false;
  address_changed boolean := false;
  name_changed boolean := false;
  country_changed boolean := false;
  website_changed boolean := false;
begin
  if not public.is_platform_admin() then
    raise exception 'only platform admins may change a company''s profile' using errcode = '42501';
  end if;
  if public.is_org_member(target_org) then
    raise exception 'staff cannot review a company they belong to' using errcode = '42501';
  end if;
  select * into company from public.orgs o where o.id = target_org;
  if not found then
    raise exception 'company not found' using errcode = 'P0002';
  end if;
  if new_kind is null and new_address is null and company_name is null and country is null and website is null then
    raise exception 'nothing to change' using errcode = '22023';
  end if;
  if company.type <> 'factory' and (new_kind is not null or new_address is not null) then
    raise exception 'only a vendor has a type and an address to change' using errcode = '22023';
  end if;
  if new_kind is not null and new_kind not in ('manufacturer', 'trading_company') then
    raise exception 'type must be Factory or Trading company' using errcode = '22023';
  end if;
  if char_length(coalesce(new_address, '')) > 500 then
    raise exception 'address is too long' using errcode = '22023';
  end if;
  if company_name is not null and new_name = '' then
    raise exception 'Enter the company name' using errcode = '22023';
  end if;
  if char_length(coalesce(new_name, '')) > 200 then
    raise exception 'The company name is too long' using errcode = '22023';
  end if;
  if char_length(coalesce(new_website, '')) > 300 then
    raise exception 'The website is too long' using errcode = '22023';
  end if;
  if country is not null then
    select t.extra ->> 'code', t.label_en into country_code_new, country_label
      from public.taxonomy_terms t
     where t.kind = 'country'
       and (upper(t.extra ->> 'code') = upper(new_country) or lower(t.label_en) = lower(new_country))
     order by (upper(t.extra ->> 'code') = upper(new_country)) desc
     limit 1;
    if country_label is null then
      raise exception 'Choose a country from the list' using errcode = '22023';
    end if;
  end if;

  if company.type = 'factory' then
    select f.vendor_kind::text, f.location, f.website_url into old_kind, old_location, old_website
      from public.factory_profiles f where f.org_id = target_org;
    select a.address into old_address from public.factory_production_addresses a where a.org_id = target_org;
  else
    select b.hq_location, b.website_url into old_location, old_website
      from public.brand_profiles b where b.org_id = target_org;
  end if;
  old_country := nullif(trim(regexp_replace(coalesce(old_location, ''), '^.*,', '')), '');

  if new_kind is not null and new_kind is distinct from old_kind then
    update public.factory_profiles f set vendor_kind = new_kind::public.vendor_kind where f.org_id = target_org;
    insert into public.org_review_changes (org_id, kind, details, changed_by)
    values (target_org, 'vendor_kind', jsonb_strip_nulls(jsonb_build_object('from', old_kind, 'to', new_kind)), auth.uid());
    kind_changed := true;
  end if;
  if new_address is not null and new_address is distinct from old_address then
    insert into public.factory_production_addresses (org_id, address, updated_by, updated_at)
    values (target_org, new_address, auth.uid(), now())
    on conflict (org_id) do update set address = excluded.address, updated_by = excluded.updated_by, updated_at = now();
    insert into public.org_review_changes (org_id, kind, details, changed_by)
    values (target_org, 'address', jsonb_strip_nulls(jsonb_build_object('from', old_address, 'to', new_address)), auth.uid());
    address_changed := true;
  end if;
  if company_name is not null and new_name is distinct from company.name then
    update public.orgs o set name = new_name where o.id = target_org;
    insert into public.org_review_changes (org_id, kind, details, changed_by)
    values (target_org, 'company_name', jsonb_build_object('from', company.name, 'to', new_name), auth.uid());
    name_changed := true;
  end if;
  if country is not null and (old_country is distinct from country_label
      or (company.type = 'factory' and exists (select 1 from public.factory_profiles f
                                                 where f.org_id = target_org
                                                   and f.country_code is distinct from country_code_new))) then
    if company.type = 'factory' then
      insert into public.factory_profiles as f (org_id, country_code, location)
      values (target_org, country_code_new, country_label)
      on conflict (org_id) do update
        set country_code = excluded.country_code,
            location = public.location_with_country(f.location, country_label);
    else
      insert into public.brand_profiles as b (org_id, hq_location)
      values (target_org, country_label)
      on conflict (org_id) do update
        set hq_location = public.location_with_country(b.hq_location, country_label);
    end if;
    insert into public.org_review_changes (org_id, kind, details, changed_by)
    values (target_org, 'country', jsonb_strip_nulls(jsonb_build_object('from', old_country, 'to', country_label)), auth.uid());
    country_changed := true;
  end if;
  if website is not null and new_website is distinct from nullif(trim(coalesce(old_website, '')), '') then
    if company.type = 'factory' then
      insert into public.factory_profiles as f (org_id, website_url) values (target_org, new_website)
      on conflict (org_id) do update set website_url = excluded.website_url;
    else
      insert into public.brand_profiles as b (org_id, website_url) values (target_org, new_website)
      on conflict (org_id) do update set website_url = excluded.website_url;
    end if;
    insert into public.org_review_changes (org_id, kind, details, changed_by)
    values (target_org, 'website', jsonb_strip_nulls(jsonb_build_object('from', old_website, 'to', new_website)), auth.uid());
    website_changed := true;
  end if;

  if kind_changed or address_changed or name_changed or country_changed or website_changed then
    insert into public.notifications (org_id, kind, subject_type, subject_id, title, body)
    values (target_org, 'profile_updated', 'org', target_org, 'Your company profile was updated',
            concat_ws(' ',
              case when name_changed then 'We updated your company name.' end,
              case when kind_changed then 'We updated your company type to '
                   || case new_kind when 'trading_company' then 'trading company' else 'factory' end || '.' end,
              case when address_changed then 'We updated your company address.' end,
              case when country_changed then 'We updated your country.' end,
              case when website_changed then 'We updated your website.' end));
  end if;
  return jsonb_build_object(
    'vendorKind', coalesce(new_kind, old_kind),
    'kindChanged', kind_changed, 'addressChanged', address_changed,
    'nameChanged', name_changed, 'countryChanged', country_changed, 'websiteChanged', website_changed);
end;
$$;
revoke all on function public.admin_update_company_profile(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.admin_update_company_profile(uuid, text, text, text, text, text) to authenticated;
