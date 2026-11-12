-- Verification v3, the rules (Nov 11).
--
-- 1. China no longer types its Unified Social Credit Code. The number is the
--    one the AI read off the business licence: a reading of a Chinese
--    company's latest licence writes it to company_registrations.number
--    (number_source 'document'), so the duplicate check, the registry check
--    and "document differs" all run on it. A number already typed by an older
--    factory stays typed, and a reading that differs from it still blocks.
-- 2. Invisible characters (zero-width space and joiners, BOM, word joiner,
--    soft hyphen, direction marks) are stripped from every number before it
--    is compared or stored, as src/shared/registration-number.mjs does.
-- 3. A verified factory whose legal name (or, with none, its company name),
--    registration number or country changes goes back to review: pending,
--    the review queue's ready_for_review, a staff-only row saying what
--    changed, and one line to the factory. Factories verified earlier are
--    untouched until their next change.
-- 4. A licence whose business scope is trading only blocks approval until
--    staff record why (admin_explain_trading_scope), kept per reading.
-- 5. A Chinese company whose number the AI could not read cannot be approved
--    ('number_unread'): staff ask for a clearer licence.
-- 6. admin_review_assist_input() carries the registry results.

-- ---------------------------------------------------------------------------
-- 2. Invisible characters
-- ---------------------------------------------------------------------------

create or replace function public.strip_invisible(raw text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select regexp_replace(coalesce(raw, ''), '[­​-‏‪-‮⁠-⁤﻿]', '', 'g')
$$;

grant execute on function public.strip_invisible(text) to authenticated, service_role;

create or replace function public.normalise_registration_number(country text, raw text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  with t as (
    select regexp_replace(upper(translate(public.strip_invisible(raw),
      '０１２３４５６７８９ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ－．／　',
      '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-./ ')), '[\s ./-]', '', 'g') as v
  )
  select case when country = 'PT' and v ~ '^PT\d{9}$' then substr(v, 3) else v end from t
$$;

-- ---------------------------------------------------------------------------
-- 1. China's number comes from the document
-- ---------------------------------------------------------------------------

alter table public.company_registrations
  add column if not exists number_source text not null default 'typed'
    check (number_source in ('typed', 'document'));

-- A Chinese company may be saved before its licence is read.
do $$
declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.company_registrations'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) ilike '%no_company_number%'
              and pg_get_constraintdef(oid) not ilike '%CN%'
  loop
    execute format('alter table public.company_registrations drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.company_registrations
  add constraint company_registrations_number_or_reason
  check (number is not null or no_company_number or country_code = 'CN');

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

-- The AI reading of a Chinese company's latest licence gives the number, when
-- the company has typed none. The reading is then "at" that number, and has
-- no number difference to report.
create or replace function public.apply_reading_number()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  reg public.company_registrations;
  read_number text;
  latest_file uuid;
begin
  if new.kind <> 'document_reading' or not new.automatic then
    return new;
  end if;
  select * into reg from public.company_registrations r where r.org_id = new.org_id;
  if reg.org_id is null or reg.country_code is distinct from 'CN'
     or (reg.number is not null and reg.number_source <> 'document') then
    return new;
  end if;
  select d.id into latest_file from public.documents d
   where d.org_id = new.org_id and d.kind = 'business_registration'
   order by d.created_at desc limit 1;
  if new.subject_id is distinct from latest_file then
    return new;
  end if;
  read_number := nullif(public.normalise_registration_number('CN', new.details #>> '{extracted,registrationNumber}'), '');
  -- Unreadable or not a code: the number stays unknown and approval waits.
  if read_number is null or coalesce(public.registration_number_problem('CN', read_number), 'ok') not in ('ok', 'check_digit') then
    return new;
  end if;
  update public.company_registrations
     set number = read_number, number_source = 'document',
         check_digit_confirmed = coalesce(public.registration_number_problem('CN', read_number) = 'check_digit', false),
         updated_at = case when number is distinct from read_number then now() else updated_at end
   where org_id = new.org_id;
  new.details := jsonb_set(coalesce(new.details, '{}'::jsonb), '{numberAtReading}', to_jsonb(read_number))
                 || jsonb_build_object('numberFromDocument', true,
                      'differences', coalesce((select jsonb_agg(x) from jsonb_array_elements(
                        case when jsonb_typeof(new.details -> 'differences') = 'array' then new.details -> 'differences' else '[]'::jsonb end) x
                        where x ->> 'field' is distinct from 'number'), '[]'::jsonb));
  if new.result = 'differs' and jsonb_array_length(new.details -> 'differences') = 0 then
    new.result := 'agrees';
  end if;
  return new;
end;
$$;

revoke all on function public.apply_reading_number() from public, anon, authenticated;

drop trigger if exists verification_signals_reading_number on public.verification_signals;
create trigger verification_signals_reading_number
  before insert on public.verification_signals
  for each row execute function public.apply_reading_number();

-- ---------------------------------------------------------------------------
-- 3. A verified factory that changes who it is goes back to review
-- ---------------------------------------------------------------------------

create table if not exists public.verification_reopenings (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs (id) on delete cascade,
  field       text not null check (field in ('legal_name', 'number', 'country')),
  old_value   text,
  new_value   text,
  reopened_at timestamptz not null default now()
);

create index if not exists verification_reopenings_org_idx on public.verification_reopenings (org_id, reopened_at desc);
alter table public.verification_reopenings enable row level security;
revoke all on public.verification_reopenings from anon, authenticated;
grant all on public.verification_reopenings to service_role;

-- Records it and tells the company; the caller moves the status.
create or replace function public.note_verification_reopened(target_org uuid, changed text, old_value text, new_value text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.verification_reopenings (org_id, field, old_value, new_value)
  values (target_org, changed, left(old_value, 300), left(new_value, 300));
  update public.org_reviews set state = 'ready_for_review', decided_at = null
   where org_id = target_org and state = 'approved';
  insert into public.notifications (org_id, kind, subject_type, subject_id, title, body)
  values (target_org, 'verification_reopened', 'org', target_org,
          case changed when 'legal_name' then 'Your legal name changed: TSC will verify it again'
                       else 'Your registration number changed: TSC will verify it again' end,
          null);
end;
$$;

revoke all on function public.note_verification_reopened(uuid, text, text, text) from public, anon, authenticated;

create or replace function public.reopen_on_legal_name_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.verification_status = 'verified' and new.verification_status = 'verified'
     and trim(public.strip_invisible(coalesce(new.legal_name, ''))) is distinct from trim(public.strip_invisible(coalesce(old.legal_name, ''))) then
    new.verification_status := 'pending';
    perform public.note_verification_reopened(new.org_id, 'legal_name', old.legal_name, new.legal_name);
  end if;
  return new;
end;
$$;

revoke all on function public.reopen_on_legal_name_change() from public, anon, authenticated;

drop trigger if exists factory_profiles_reopen_on_rename on public.factory_profiles;
create trigger factory_profiles_reopen_on_rename
  before update of legal_name on public.factory_profiles
  for each row execute function public.reopen_on_legal_name_change();

-- With no legal name, the company's name is its legal name.
create or replace function public.reopen_on_org_rename()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if trim(public.strip_invisible(coalesce(new.name, ''))) is not distinct from trim(public.strip_invisible(coalesce(old.name, ''))) then
    return new;
  end if;
  if exists (select 1 from public.factory_profiles f
              where f.org_id = new.id and f.verification_status = 'verified'
                and nullif(trim(coalesce(f.legal_name, '')), '') is null) then
    update public.factory_profiles set verification_status = 'pending' where org_id = new.id;
    perform public.note_verification_reopened(new.id, 'legal_name', old.name, new.name);
  end if;
  return new;
end;
$$;

revoke all on function public.reopen_on_org_rename() from public, anon, authenticated;

drop trigger if exists orgs_reopen_on_rename on public.orgs;
create trigger orgs_reopen_on_rename
  after update of name on public.orgs
  for each row execute function public.reopen_on_org_rename();

create or replace function public.reopen_on_number_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  changed text;
begin
  if old.number is not null and new.number is distinct from old.number then
    changed := 'number';
  elsif old.country_code is not null and new.country_code is distinct from old.country_code then
    changed := 'country';
  else
    return new;
  end if;
  if exists (select 1 from public.factory_profiles f where f.org_id = new.org_id and f.verification_status = 'verified') then
    update public.factory_profiles set verification_status = 'pending' where org_id = new.org_id;
    perform public.note_verification_reopened(new.org_id, changed,
      case changed when 'number' then old.number else old.country_code end,
      case changed when 'number' then new.number else new.country_code end);
  end if;
  return new;
end;
$$;

revoke all on function public.reopen_on_number_change() from public, anon, authenticated;

drop trigger if exists company_registrations_reopen on public.company_registrations;
create trigger company_registrations_reopen
  after update on public.company_registrations
  for each row execute function public.reopen_on_number_change();

-- ---------------------------------------------------------------------------
-- 4. A trading-only licence needs a reason
-- ---------------------------------------------------------------------------

create table if not exists public.registry_trader_reviews (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs (id) on delete cascade,
  reading_id  uuid not null references public.verification_signals (id) on delete cascade,
  note        text not null check (char_length(trim(note)) between 1 and 2000),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz not null default now()
);

create index if not exists registry_trader_reviews_org_idx on public.registry_trader_reviews (org_id, reviewed_at desc);
alter table public.registry_trader_reviews enable row level security;
revoke all on public.registry_trader_reviews from anon, authenticated;
grant all on public.registry_trader_reviews to service_role;

-- The latest reading of the latest registration file, when its scope reads
-- as trading only: `{ id, quote }`. Null otherwise.
create or replace function public.registry_trading_reading(target_org uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object('id', s.id, 'quote', s.details #>> '{tradingScope,quote}')
    from public.verification_signals s
   where s.id = (select x.id from public.verification_signals x
                  where x.org_id = target_org and x.kind = 'document_reading' and x.automatic
                    and x.subject_id = (select d.id from public.documents d
                                         where d.org_id = target_org and d.kind = 'business_registration'
                                         order by d.created_at desc limit 1)
                  order by x.checked_at desc limit 1)
     and (s.details #>> '{tradingScope,trading}') = 'true'
$$;

revoke all on function public.registry_trading_reading(uuid) from public, anon, authenticated;

create or replace function public.admin_explain_trading_scope(target_org uuid, note text)
returns public.registry_trader_reviews
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  reading jsonb;
  saved public.registry_trader_reviews;
begin
  if not public.is_platform_admin() then
    raise exception 'only platform admins may explain a trading licence' using errcode = '42501';
  end if;
  if public.is_org_member(target_org) then
    raise exception 'staff cannot review a company they belong to' using errcode = '42501';
  end if;
  reading := public.registry_trading_reading(target_org);
  if reading is null then
    raise exception 'the licence does not read as trading only' using errcode = '22023';
  end if;
  if nullif(trim(coalesce(note, '')), '') is null then
    raise exception 'say why a trading licence is acceptable for this factory' using errcode = '22023';
  end if;
  insert into public.registry_trader_reviews (org_id, reading_id, note, reviewed_by)
  values (target_org, (reading ->> 'id')::uuid, trim(note), auth.uid())
  returning * into saved;
  return saved;
end;
$$;

revoke all on function public.admin_explain_trading_scope(uuid, text) from public, anon;
grant execute on function public.admin_explain_trading_scope(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- What stops approval
-- ---------------------------------------------------------------------------

-- 'number_unread', 'no_check', 'renamed', 'name_differs', 'document_differs',
-- 'duplicate', 'trading_only' or null.
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
begin
  select * into reg from public.company_registrations r where r.org_id = target_org;
  if reg.country_code = 'CN' and reg.number is null and not reg.no_company_number then
    return 'number_unread';
  end if;
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
  if exists (select 1 from public.registry_duplicate_orgs(target_org))
     and not exists (select 1 from public.registry_duplicate_reviews d
                      where d.org_id = target_org and d.number = reg.number) then
    return 'duplicate';
  end if;
  trading := public.registry_trading_reading(target_org);
  if trading is not null and not exists (select 1 from public.registry_trader_reviews t
                                          where t.org_id = target_org and t.reading_id = (trading ->> 'id')::uuid) then
    return 'trading_only';
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
  if problem = 'number_unread' then
    raise exception 'the number could not be read off the business licence: ask the factory for a clearer licence before approving'
      using errcode = '22023';
  elsif problem = 'no_check' then
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
  elsif problem = 'trading_only' then
    raise exception 'the licence''s business scope is trading only: record why before approving'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- For the staff panel: the v3 states in one read
-- ---------------------------------------------------------------------------

create or replace function public.admin_verification_rules(target_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  trading jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'only platform admins may read this' using errcode = '42501';
  end if;
  trading := public.registry_trading_reading(target_org);
  return jsonb_build_object(
    'approvalProblem', public.registry_approval_problem(target_org),
    'numberSource', (select r.number_source from public.company_registrations r where r.org_id = target_org),
    'tradingOnly', case when trading is null then null else jsonb_build_object(
        'readingId', trading ->> 'id',
        'quote', trading ->> 'quote',
        'explanation', (select jsonb_build_object('note', t.note, 'reviewedAt', t.reviewed_at)
                          from public.registry_trader_reviews t
                         where t.org_id = target_org and t.reading_id = (trading ->> 'id')::uuid
                         order by t.reviewed_at desc limit 1)) end,
    'reopenings', coalesce((select jsonb_agg(jsonb_build_object('field', v.field, 'oldValue', v.old_value,
                                    'newValue', v.new_value, 'reopenedAt', v.reopened_at) order by v.reopened_at desc)
                              from public.verification_reopenings v where v.org_id = target_org), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.admin_verification_rules(uuid) from public, anon;
grant execute on function public.admin_verification_rules(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. What "Ask AI for suggestions" reads: the registry results too. No other
--    company's name: a duplicate is a count.
-- ---------------------------------------------------------------------------

create or replace function public.admin_review_assist_input(target_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  org_row public.orgs;
  signed_at     timestamptz;
  signed_terms  text;
  result  jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'review help is limited to platform staff' using errcode = '42501';
  end if;

  select * into org_row from public.orgs o where o.id = target_org;
  if org_row.id is null then
    raise exception 'org not found' using errcode = 'P0002';
  end if;

  -- The row the "Terms accepted" check reads, for its date and version.
  select a.accepted_at, a.terms_version into signed_at, signed_terms
    from public.terms_acceptances a
   where a.org_id = target_org
   order by a.accepted_at desc
   limit 1;

  select jsonb_build_object(
    'today', current_date,
    'company', jsonb_build_object('name', org_row.name, 'type', org_row.type),
    'profile', coalesce(
      (select jsonb_strip_nulls(to_jsonb(f) - array['org_id', 'created_at', 'updated_at', 'published_at',
                                                    'onboarding_completed_at', 'verification_status'])
         from public.factory_profiles f where f.org_id = target_org),
      (select jsonb_strip_nulls(to_jsonb(b) - array['org_id', 'created_at', 'updated_at',
                                                    'onboarding_completed_at', 'verification_status',
                                                    'business_email'])
                || jsonb_strip_nulls(jsonb_build_object(
                     'business_email_domain', nullif(split_part(lower(b.business_email), '@', 2), '')))
         from public.brand_profiles b where b.org_id = target_org),
      '{}'::jsonb),
    'member_email_domains', coalesce((
      select jsonb_agg(distinct split_part(lower(u.email), '@', 2))
        from public.org_members m
        join auth.users u on u.id = m.user_id
       where m.org_id = target_org and u.email like '%@%'), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_object_agg(kind, labels)
        from (select t.kind, jsonb_agg(t.label_en order by t.label_en) as labels
                from public.taxonomy_links l
                join public.taxonomy_terms t on t.id = l.term_id
               where l.subject_id = target_org
                 and l.subject_type in ('factory_profile', 'brand_profile')
               group by t.kind) k), '{}'::jsonb),
    'certifications', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', t.label_en,
               'status', c.status,
               'expires_on', c.expires_at,
               'expired', c.expires_at is not null and c.expires_at < current_date,
               'file_attached', c.document_id is not null) order by t.label_en)
        from public.factory_certifications c
        join public.taxonomy_terms t on t.id = c.term_id
       where c.org_id = target_org), '[]'::jsonb),
    'files', coalesce((
      select jsonb_agg(jsonb_build_object(
               'kind', d.kind,
               'file_name', d.file_name,
               'size_bytes', coalesce(d.size_bytes, 0),
               'uploaded_on', d.created_at::date,
               'review_status', d.status) order by d.kind, d.created_at)
        from public.documents d
       where d.org_id = target_org
         and d.rfq_id is null and d.quote_id is null and d.order_id is null
         and d.message_id is null and d.milestone_update_id is null), '[]'::jsonb),
    'existing_checks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'check', c ->> 'label', 'result', c ->> 'result',
               'detail', case
                 -- The signature is a person's typed name.
                 when c ->> 'label' = 'Terms accepted' and signed_terms is not null
                   then format('Signed on %s against terms version %s.',
                               to_char(signed_at, 'DD Mon YYYY'), signed_terms)
                 -- The names are other customers'.
                 when c ->> 'label' = 'Duplicate company signal' and c ->> 'result' <> 'Clear'
                   then 'Shares a legal name or website domain with at least one other company on the platform.'
                 else c ->> 'detail'
               end))
        from jsonb_array_elements(public.org_verification_checks(target_org)) c), '[]'::jsonb),
    'registry', (
      select jsonb_strip_nulls(jsonb_build_object(
        'country', r.country_code,
        'registration_number', r.number,
        'number_read_from_document', r.number_source = 'document',
        'sole_proprietor_no_number', r.no_company_number,
        'latest_registry_check', (select jsonb_build_object('source', c.source, 'result', c.result,
                                    'checked_on', c.checked_at::date, 'note', c.note)
                                    from public.current_registry_check(target_org) c),
        'approval_blocked_by', public.registry_approval_problem(target_org),
        'other_companies_with_this_number', (select count(*) from public.registry_duplicate_orgs(target_org)),
        'document_reading', (select jsonb_build_object('result', s.result, 'read_on', s.checked_at::date,
                                     'differences', s.details -> 'differences',
                                     'trading_only_scope', (s.details #>> '{tradingScope,trading}') = 'true',
                                     'trading_words', nullif(s.details #>> '{tradingScope,quote}', ''))
                               from public.verification_signals s
                              where s.org_id = target_org and s.kind = 'document_reading' and s.automatic
                              order by s.checked_at desc limit 1),
        'trading_scope_explained', (select t.note from public.registry_trader_reviews t
                                     where t.org_id = target_org order by t.reviewed_at desc limit 1),
        'reverified_after_change', (select jsonb_agg(jsonb_build_object('changed', v.field, 'on', v.reopened_at::date))
                                      from public.verification_reopenings v where v.org_id = target_org)))
        from public.company_registrations r where r.org_id = target_org)
  ) into result;

  return result;
end;
$$;

