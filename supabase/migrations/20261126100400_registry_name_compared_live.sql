-- C2 (Nov 26): the registry check's name is compared with the company's
-- name now, the way the licence reading is (20261126100000): no "renamed
-- since the check" state. A check holds while the name it recorded matches
-- the current name (legal name, else company name) by company_names_match
-- (with no registry name recorded, the names it was checked under, compared
-- the same way), or staff confirmed the difference for this name. A
-- recorded name that no longer matches is "name differs", the problem
-- registry_name_differs already names, with the same words to clear it:
-- record the check again. Same signatures; grants restated.

create or replace function public.registry_check_holds(target_org uuid, check_details jsonb)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when nullif(trim(coalesce(check_details ->> 'name', '')), '') is not null
      then public.company_names_match(check_details ->> 'name', public.company_title(target_org))
        or (coalesce((check_details ->> 'nameDiffersConfirmed')::boolean, false)
            and check_details ->> 'titleAtCheck' is not distinct from public.company_title(target_org))
    -- No registry name recorded: the names it was checked under, compared the same way.
    else (nullif(trim(coalesce(check_details ->> 'titleAtCheck', '')), '') is null
          or public.company_names_match(check_details ->> 'titleAtCheck', public.company_title(target_org)))
     and (nullif(trim(coalesce(check_details ->> 'nameAtCheck', '')), '') is null
          or public.company_names_match(check_details ->> 'nameAtCheck', (select o.name from public.orgs o where o.id = target_org)))
  end
$$;
revoke all on function public.registry_check_holds(uuid, jsonb) from public, anon, authenticated;

create or replace function public.registry_approval_problem(target_org uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
      return 'name_differs';
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
$function$;
revoke all on function public.registry_approval_problem(uuid) from public, anon, authenticated;
