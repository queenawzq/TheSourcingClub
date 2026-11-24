-- Staff verification, simpler: a registry check that shows the licence's name
-- settles a name difference between the licence and what the company typed.
--
-- A Chinese factory types its English name; its licence carries its Chinese
-- legal name. Staff record Found with the name the registry shows, the
-- licence's. Approve kept waiting for "the name on the licence differs from
-- what they typed", because only a check showing the TYPED name (or an
-- explanation on the Typed: line, which the page offered for numbers only)
-- cleared it, and re-saving the check changed nothing.
--
-- Now the current check settles the reading's differences when, for each one:
--   name:   the check's name is the company's or the licence's (any script);
--   number: the check's number is the company's (as before: a registry that
--           shows the licence's number leaves the typed number to explain).
-- This is read by the approval rule itself, so checks already saved count
-- without being saved again.
--
-- Additive: registry_approval_problem (from 20261124320000) keeps its
-- signature and grants; one new helper, revoked from every role.

create or replace function public.registry_check_settles_reading(target_org uuid, check_details jsonb, reading jsonb)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with reg as (
    select r.country_code, r.number from public.company_registrations r where r.org_id = target_org
  ),
  lines as (
    select d ->> 'field' as field, nullif(trim(coalesce(d ->> 'document', '')), '') as document
      from jsonb_array_elements(case when jsonb_typeof(reading -> 'differences') = 'array' then reading -> 'differences' else '[]'::jsonb end) d
     where coalesce((d ->> 'nearly')::boolean, false) = false
  )
  select coalesce(check_details ->> 'outcome', 'found') = 'found'
     and exists (select 1 from lines)
     and not exists (
       select 1 from lines l
        where case
          when l.field = 'number' then not coalesce(
            (select public.normalise_registration_number(coalesce(reg.country_code, ''), check_details ->> 'number') = reg.number from reg)
              and nullif(trim(coalesce(check_details ->> 'number', '')), '') is not null, false)
          else not coalesce(
            nullif(trim(coalesce(check_details ->> 'name', '')), '') is not null
              and (public.company_names_match(check_details ->> 'name', public.company_title(target_org))
                   or (l.document is not null and public.company_names_match(check_details ->> 'name', l.document))), false)
        end)
$$;
revoke all on function public.registry_check_settles_reading(uuid, jsonb, jsonb) from public, anon, authenticated;

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
       and not public.registry_reading_still_confirmed(target_org, current_check.details ->> 'readingConfirmed', reading)
       -- The check itself shows what settles each difference (Nov 25): the licence's name, the company's number.
       and not public.registry_check_settles_reading(target_org, current_check.details, reading) then
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
