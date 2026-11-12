-- Fix round 4 (Nov 12): a plain Run again re-read the licence, which made a
-- new document_reading row with the same differences, and the staff record
-- that had confirmed the difference (readingConfirmed = the old reading's id)
-- stopped counting: Approve was blocked again with nothing changed.
-- A confirmation now holds for a later reading that shows the very same
-- differences (field, what the document says, what they typed). A reading
-- with another difference still needs a new record.

create or replace function public.registry_reading_still_confirmed(target_org uuid, confirmed_id text, reading jsonb)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with lines(list) as (
    select s.details -> 'differences'
      from public.verification_signals s
     where s.org_id = target_org and s.kind = 'document_reading'
       and confirmed_id ~ '^[0-9a-f-]{36}$' and s.id = confirmed_id::uuid
  ),
  norm(which, field, document, typed) as (
    select 'confirmed', d ->> 'field', lower(trim(coalesce(d ->> 'document', ''))), lower(trim(coalesce(d ->> 'typed', '')))
      from lines, jsonb_array_elements(case when jsonb_typeof(lines.list) = 'array' then lines.list else '[]'::jsonb end) d
     where coalesce((d ->> 'nearly')::boolean, false) = false
    union all
    select 'now', d ->> 'field', lower(trim(coalesce(d ->> 'document', ''))), lower(trim(coalesce(d ->> 'typed', '')))
      from jsonb_array_elements(case when jsonb_typeof(reading -> 'differences') = 'array' then reading -> 'differences' else '[]'::jsonb end) d
     where coalesce((d ->> 'nearly')::boolean, false) = false
  )
  select exists (select 1 from lines)
     and exists (select 1 from norm where which = 'now')
     and not exists (select field, document, typed from norm where which = 'now'
                     except select field, document, typed from norm where which = 'confirmed')
     and not exists (select field, document, typed from norm where which = 'confirmed'
                     except select field, document, typed from norm where which = 'now')
$$;
revoke all on function public.registry_reading_still_confirmed(uuid, text, jsonb) from public, anon, authenticated;

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
  if reading is not null and current_check.details ->> 'readingConfirmed' is distinct from reading ->> 'id'
     and not public.registry_reading_still_confirmed(target_org, current_check.details ->> 'readingConfirmed', reading) then
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
