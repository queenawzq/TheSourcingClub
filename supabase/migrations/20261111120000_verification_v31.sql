-- Verification v3.1 (Nov 11): the database side of the fix round.
--
-- A3  China's number. A number whose check digit fails is never stored, from
--     any path (the reading, a typed save, staff). The reading keeps what it
--     read (details.extracted.registrationNumber) and says why it was not
--     used (details.numberReadProblem). Approval then names the problem:
--     'number_check_digit_fails', or 'number_needs_staff' for an old 15-digit
--     code or anything else that is not a Unified Social Credit Code (a Hong
--     Kong CR, say). Either way staff type the number off the licence with
--     admin_set_registration_number(), number_source 'staff'.
-- A10 A staff reason on any of the seven score rows: admin_explain_check().
--     admin_explain_trading_scope() keeps working and writes through it.
-- B3  Company facts staff record from the annual report: insured staff and
--     founding date (admin_record_company_facts). Staff-only table: a brand
--     can read factory_profiles.
-- B4  factory_profiles.production_address, written by the factory's own
--     profile save (factory_profiles_write), read by staff in
--     admin_registry_detail().
-- B2  Document kinds 'authorisation' (who may act for the company) and
--     'factory_photo' (workshop and production line). Both go to the private
--     bucket (src/lib/domain/documents.js PRIVATE_KINDS); staff see them in
--     admin_org_documents().
--
-- Additive: new columns, tables and functions; changed functions keep their
-- signatures.

-- ---------------------------------------------------------------------------
-- B2. Document kinds
-- ---------------------------------------------------------------------------

alter type public.document_kind add value if not exists 'authorisation';
alter type public.document_kind add value if not exists 'factory_photo';

-- The files a reviewer sees. Same shape; the two new kinds added. Compared as
-- text, so the body does not depend on the values above being committed.
create or replace function public.admin_org_documents(target_org uuid)
returns table (
  id           uuid,
  kind         public.document_kind,
  bucket       text,
  storage_path text,
  file_name    text,
  mime_type    text,
  size_bytes   bigint,
  status       public.verification_status,
  review_note  text,
  reviewed_at  timestamptz,
  created_at   timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'these documents are limited to platform staff' using errcode = '42501';
  end if;

  return query
  select d.id, d.kind, d.bucket, d.storage_path, d.file_name, d.mime_type,
         d.size_bytes, d.status, d.review_note, d.reviewed_at, d.created_at
    from public.documents d
   where d.org_id = target_org
     and d.kind::text in ('business_registration', 'certificate', 'logo',
                          'product_image', 'walkthrough', 'brand_direction', 'other',
                          'authorisation', 'factory_photo')
   order by d.created_at;
end;
$$;

revoke all on function public.admin_org_documents(uuid) from public;
grant execute on function public.admin_org_documents(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- B4. The production address
-- ---------------------------------------------------------------------------

alter table public.factory_profiles
  add column if not exists production_address text
    check (production_address is null or char_length(production_address) <= 500);

comment on column public.factory_profiles.production_address is
  'Full street address of the production site, as the factory typed it. The address checks use it as the typed address.';

-- ---------------------------------------------------------------------------
-- A3. China's number
-- ---------------------------------------------------------------------------

alter table public.company_registrations
  drop constraint if exists company_registrations_number_source_check;
alter table public.company_registrations
  add constraint company_registrations_number_source_check
  check (number_source in ('typed', 'document', 'staff'));

-- No path stores a Chinese number whose check digit fails. Checked only when
-- the number is written, so a row holding an older number can still change
-- its other columns.
create or replace function public.guard_cn_check_digit()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.country_code = 'CN' and new.number is not null
     and (tg_op = 'INSERT' or new.number is distinct from old.number or new.country_code is distinct from old.country_code)
     and public.registration_number_problem('CN', new.number) = 'check_digit' then
    raise exception 'registration number: check_digit' using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_cn_check_digit() from public, anon, authenticated;

drop trigger if exists company_registrations_cn_check_digit on public.company_registrations;
create trigger company_registrations_cn_check_digit
  before insert or update on public.company_registrations
  for each row execute function public.guard_cn_check_digit();

-- Numbers already stored from a reading with a failing check digit go back to
-- unknown, so approval asks staff for the number. Verified factories are left
-- as they are: clearing theirs would send them back to review.
update public.company_registrations r
   set number = null, check_digit_confirmed = false
 where r.country_code = 'CN' and r.number_source = 'document' and r.number is not null
   and public.registration_number_problem('CN', r.number) = 'check_digit'
   and not exists (select 1 from public.factory_profiles f
                    where f.org_id = r.org_id and f.verification_status = 'verified');

-- The reading gives the number only when it is a valid code. Otherwise the
-- reading keeps what it read and says why it was not used.
create or replace function public.apply_reading_number()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  reg public.company_registrations;
  read_number text;
  problem text;
  latest_file uuid;
begin
  if new.kind <> 'document_reading' or not new.automatic then
    return new;
  end if;
  select * into reg from public.company_registrations r where r.org_id = new.org_id;
  if reg.org_id is null or reg.country_code is distinct from 'CN' then
    return new;
  end if;
  read_number := nullif(public.normalise_registration_number('CN', new.details #>> '{extracted,registrationNumber}'), '');
  problem := case when read_number is null then null else public.registration_number_problem('CN', read_number) end;
  if problem is not null then
    new.details := coalesce(new.details, '{}'::jsonb)
                   || jsonb_build_object('numberRead', read_number, 'numberReadProblem', problem);
  end if;
  if reg.number is not null and reg.number_source <> 'document' then
    return new;
  end if;
  select d.id into latest_file from public.documents d
   where d.org_id = new.org_id and d.kind = 'business_registration'
   order by d.created_at desc limit 1;
  if new.subject_id is distinct from latest_file then
    return new;
  end if;
  -- Unreadable, a failing check digit, or not a code: the number stays
  -- unknown and approval names why.
  if read_number is null or problem is not null then
    return new;
  end if;
  update public.company_registrations
     set number = read_number, number_source = 'document',
         check_digit_confirmed = false,
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

-- The latest automatic reading of the company's latest licence.
create or replace function public.registry_latest_reading(target_org uuid)
returns public.verification_signals
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select x.* from public.verification_signals x
   where x.org_id = target_org and x.kind = 'document_reading' and x.automatic
     and x.subject_id = (select d.id from public.documents d
                          where d.org_id = target_org and d.kind = 'business_registration'
                          order by d.created_at desc limit 1)
   order by x.checked_at desc limit 1
$$;

revoke all on function public.registry_latest_reading(uuid) from public, anon, authenticated;

-- What the latest reading read as the number, and why it was not used:
-- `{ number, problem }`, problem null when it is a valid code. Null when
-- nothing was read.
create or replace function public.registry_number_read(target_org uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object('number', v.n,
           'problem', public.registration_number_problem('CN', v.n))
    from (select nullif(public.normalise_registration_number('CN', s.details #>> '{extracted,registrationNumber}'), '') as n
            from public.registry_latest_reading(target_org) s) v
   where v.n is not null
$$;

revoke all on function public.registry_number_read(uuid) from public, anon, authenticated;

create table if not exists public.registration_number_entries (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs (id) on delete cascade,
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  number      text not null,
  note        text not null check (char_length(trim(note)) between 1 and 2000),
  entered_by  uuid references auth.users (id) on delete set null,
  entered_at  timestamptz not null default now()
);

create index if not exists registration_number_entries_org_idx on public.registration_number_entries (org_id, entered_at desc);
alter table public.registration_number_entries enable row level security;
revoke all on public.registration_number_entries from anon, authenticated;
grant all on public.registration_number_entries to service_role;

-- Staff type the number off the licence. A Chinese code must pass its check
-- digit; an old 15-digit code is accepted. `country` changes the country
-- (a Hong Kong company's CR under 'HK'); null keeps the current one.
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
-- A10. A reason on any row
-- ---------------------------------------------------------------------------

create table if not exists public.verification_check_reasons (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs (id) on delete cascade,
  check_key   text not null check (check_key in ('license_read', 'registry', 'trading_scope',
                                                 'address_owner', 'address_site', 'photos', 'video')),
  note        text not null check (char_length(trim(note)) between 1 and 2000),
  reasoned_by uuid references auth.users (id) on delete set null,
  reasoned_at timestamptz not null default now()
);

create index if not exists verification_check_reasons_org_idx on public.verification_check_reasons (org_id, check_key, reasoned_at desc);
alter table public.verification_check_reasons enable row level security;
revoke all on public.verification_check_reasons from anon, authenticated;
grant all on public.verification_check_reasons to service_role;

create or replace function public.admin_explain_check(target_org uuid, check_key text, note text)
returns public.verification_check_reasons
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  said text := trim(coalesce(note, ''));
  trading jsonb;
  saved public.verification_check_reasons;
begin
  if not public.is_platform_admin() then
    raise exception 'only platform admins may explain a check' using errcode = '42501';
  end if;
  if public.is_org_member(target_org) then
    raise exception 'staff cannot review a company they belong to' using errcode = '42501';
  end if;
  if check_key is null or check_key not in ('license_read', 'registry', 'trading_scope',
                                            'address_owner', 'address_site', 'photos', 'video') then
    raise exception 'unknown check' using errcode = '22023';
  end if;
  if not exists (select 1 from public.orgs o where o.id = target_org) then
    raise exception 'org not found' using errcode = 'P0002';
  end if;
  if said = '' then
    raise exception 'say why' using errcode = '22023';
  end if;

  insert into public.verification_check_reasons (org_id, check_key, note, reasoned_by)
  values (target_org, check_key, left(said, 2000), auth.uid())
  returning * into saved;

  -- A reason on a trading-only licence is what lets it be approved.
  if check_key = 'trading_scope' then
    trading := public.registry_trading_reading(target_org);
    if trading is not null then
      insert into public.registry_trader_reviews (org_id, reading_id, note, reviewed_by)
      values (target_org, (trading ->> 'id')::uuid, left(said, 2000), auth.uid());
    end if;
  end if;
  return saved;
end;
$$;

revoke all on function public.admin_explain_check(uuid, text, text) from public, anon;
grant execute on function public.admin_explain_check(uuid, text, text) to authenticated;

-- Same refusals as before; writes through admin_explain_check.
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
  perform public.admin_explain_check(target_org, 'trading_scope', note);
  select * into saved from public.registry_trader_reviews t
   where t.org_id = target_org and t.reading_id = (reading ->> 'id')::uuid
   order by t.reviewed_at desc limit 1;
  return saved;
end;
$$;

revoke all on function public.admin_explain_trading_scope(uuid, text) from public, anon;
grant execute on function public.admin_explain_trading_scope(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- B3. Company facts
-- ---------------------------------------------------------------------------

create table if not exists public.company_facts (
  org_id        uuid primary key references public.orgs (id) on delete cascade,
  insured_staff integer check (insured_staff is null or insured_staff between 0 and 10000000),
  founded_on    date check (founded_on is null or founded_on >= date '1800-01-01'),
  recorded_by   uuid references auth.users (id) on delete set null,
  recorded_at   timestamptz not null default now()
);

alter table public.company_facts enable row level security;
revoke all on public.company_facts from anon, authenticated;
grant all on public.company_facts to service_role;

-- Null means "not known": both are replaced every time.
create or replace function public.admin_record_company_facts(target_org uuid, insured_staff integer, founded_on date)
returns public.company_facts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  saved public.company_facts;
begin
  if not public.is_platform_admin() then
    raise exception 'only platform admins may record company facts' using errcode = '42501';
  end if;
  if public.is_org_member(target_org) then
    raise exception 'staff cannot review a company they belong to' using errcode = '42501';
  end if;
  if not exists (select 1 from public.orgs o where o.id = target_org) then
    raise exception 'org not found' using errcode = 'P0002';
  end if;
  if insured_staff is not null and (insured_staff < 0 or insured_staff > 10000000) then
    raise exception 'insured staff must be a count' using errcode = '22023';
  end if;
  if founded_on is not null and (founded_on > current_date or founded_on < date '1800-01-01') then
    raise exception 'the founding date must be in the past' using errcode = '22023';
  end if;
  insert into public.company_facts as f (org_id, insured_staff, founded_on, recorded_by, recorded_at)
  values (target_org, admin_record_company_facts.insured_staff, admin_record_company_facts.founded_on, auth.uid(), now())
  on conflict (org_id) do update
    set insured_staff = excluded.insured_staff,
        founded_on = excluded.founded_on,
        recorded_by = excluded.recorded_by,
        recorded_at = excluded.recorded_at
  returning * into saved;
  return saved;
end;
$$;

revoke all on function public.admin_record_company_facts(uuid, integer, date) from public, anon;
grant execute on function public.admin_record_company_facts(uuid, integer, date) to authenticated;

-- ---------------------------------------------------------------------------
-- What stops approval: the number's two new problems
-- ---------------------------------------------------------------------------

-- 'number_check_digit_fails', 'number_needs_staff', 'number_unread',
-- 'no_check', 'renamed', 'name_differs', 'document_differs', 'duplicate',
-- 'trading_only' or null.
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
begin
  select * into reg from public.company_registrations r where r.org_id = target_org;
  if reg.country_code = 'CN' and reg.number is null and not reg.no_company_number then
    read_problem := public.registry_number_read(target_org) ->> 'problem';
    return case
      when read_problem = 'check_digit' then 'number_check_digit_fails'
      when read_problem in ('old_number', 'format') then 'number_needs_staff'
      else 'number_unread' end;
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
  if problem = 'number_check_digit_fails' then
    raise exception 'the number read off the business licence fails its check digit: type it from the licence before approving'
      using errcode = '22023';
  elsif problem = 'number_needs_staff' then
    raise exception 'the number on the business licence is not a unified social credit code: type it from the licence before approving'
      using errcode = '22023';
  elsif problem = 'number_unread' then
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
-- For the staff panel
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
    'numberRead', public.registry_number_read(target_org),
    'staffNumber', (select jsonb_build_object('number', e.number, 'country', e.country_code, 'note', e.note,
                             'enteredAt', e.entered_at,
                             'enteredBy', coalesce(nullif(p.full_name, ''), u.email::text))
                      from public.registration_number_entries e
                      left join auth.users u on u.id = e.entered_by
                      left join public.user_profiles p on p.id = e.entered_by
                     where e.org_id = target_org
                     order by e.entered_at desc limit 1),
    'tradingOnly', case when trading is null then null else jsonb_build_object(
        'readingId', trading ->> 'id',
        'quote', trading ->> 'quote',
        'explanation', (select jsonb_build_object('note', t.note, 'reviewedAt', t.reviewed_at)
                          from public.registry_trader_reviews t
                         where t.org_id = target_org and t.reading_id = (trading ->> 'id')::uuid
                         order by t.reviewed_at desc limit 1)) end,
    -- The latest reason per row: { license_read: { note, reasonedAt, reasonedBy }, ... }.
    'reasons', coalesce((
      select jsonb_object_agg(x.check_key, jsonb_build_object('note', x.note, 'reasonedAt', x.reasoned_at, 'reasonedBy', x.who))
        from (select distinct on (c.check_key) c.check_key, c.note, c.reasoned_at,
                     coalesce(nullif(p.full_name, ''), u.email::text) as who
                from public.verification_check_reasons c
                left join auth.users u on u.id = c.reasoned_by
                left join public.user_profiles p on p.id = c.reasoned_by
               where c.org_id = target_org
               order by c.check_key, c.reasoned_at desc) x), '{}'::jsonb)
      -- A trading reason given before v3.1 still counts.
      || coalesce((select jsonb_build_object('trading_scope', jsonb_build_object('note', t.note, 'reasonedAt', t.reviewed_at,
                                'reasonedBy', coalesce(nullif(p.full_name, ''), u.email::text)))
                     from public.registry_trader_reviews t
                     left join auth.users u on u.id = t.reviewed_by
                     left join public.user_profiles p on p.id = t.reviewed_by
                    where t.org_id = target_org
                      and not exists (select 1 from public.verification_check_reasons c
                                       where c.org_id = target_org and c.check_key = 'trading_scope')
                    order by t.reviewed_at desc limit 1), '{}'::jsonb),
    'companyFacts', jsonb_build_object(
      'insuredStaff', (select f.insured_staff from public.company_facts f where f.org_id = target_org),
      'foundedOn', (select f.founded_on from public.company_facts f where f.org_id = target_org),
      'recordedAt', (select f.recorded_at from public.company_facts f where f.org_id = target_org),
      'claimedEmployees', (select p.employee_count from public.factory_profiles p where p.org_id = target_org),
      'claimedFoundedYear', (select p.founded_year from public.factory_profiles p where p.org_id = target_org)),
    'reopenings', coalesce((select jsonb_agg(jsonb_build_object('field', v.field, 'oldValue', v.old_value,
                                    'newValue', v.new_value, 'reopenedAt', v.reopened_at) order by v.reopened_at desc)
                              from public.verification_reopenings v where v.org_id = target_org), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.admin_verification_rules(uuid) from public, anon;
grant execute on function public.admin_verification_rules(uuid) to authenticated;

-- admin_registry_detail: as in 20261108700200, plus the number's source and
-- the production address.
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
        'source', r.number_source,
        'updatedAt', r.updated_at)
        from public.company_registrations r where r.org_id = target_org),
    'location', (select f.location from public.factory_profiles f where f.org_id = target_org),
    'productionAddress', (select f.production_address from public.factory_profiles f where f.org_id = target_org),
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

revoke all on function public.admin_registry_detail(uuid) from public, anon;
grant execute on function public.admin_registry_detail(uuid) to authenticated;
