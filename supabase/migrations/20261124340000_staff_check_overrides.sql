-- Staff verification, simpler: staff decide three checks themselves.
--
-- The address, factory or trader, and the licence were scored only by the
-- automatic checks (the map, the AI reading); a reason could lift a low score
-- to 60, nothing more. Staff now record their own result with a note, which
-- the score uses instead of the automatic one:
--   address:  confirmed | problem | could_not_check (details.address: the address it was for)
--   scope:    factory | trading_company | could_not_tell
--   licence:  original | problem | could_not_check (subject: the licence file)
-- "Factory" on a factory whose licence reads as trading only is also the
-- explanation Approve waits for (admin_explain_trading_scope), so staff do not
-- say it twice.
--
-- Additive: one more kind on verification_signals, and admin_record_signal
-- (from 20261108700000) keeps its signature and grants.

alter table public.verification_signals drop constraint if exists verification_signals_kind_check;
alter table public.verification_signals add constraint verification_signals_kind_check
  check (kind in ('document_reading', 'address', 'photo', 'certificate', 'scope', 'licence'));

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
  elsif kind = 'address' then
    if result not in ('confirmed', 'problem', 'could_not_check') then
      raise exception 'result must be confirmed, problem or could_not_check' using errcode = '22023';
    end if;
    if nullif(trim(coalesce(details ->> 'address', '')), '') is null then
      raise exception 'the company has no address to check' using errcode = '22023';
    end if;
    subject := null;
  elsif kind = 'scope' then
    if result not in ('factory', 'trading_company', 'could_not_tell') then
      raise exception 'result must be factory, trading_company or could_not_tell' using errcode = '22023';
    end if;
    if not exists (select 1 from public.orgs o where o.id = target_org and o.type = 'factory') then
      raise exception 'company not found' using errcode = 'P0002';
    end if;
    subject := null;
  elsif kind = 'licence' then
    if result not in ('original', 'problem', 'could_not_check') then
      raise exception 'result must be original, problem or could_not_check' using errcode = '22023';
    end if;
    if not exists (select 1 from public.documents d
                    where d.id = subject and d.org_id = target_org and d.kind = 'business_registration') then
      raise exception 'licence not found for this company' using errcode = 'P0002';
    end if;
  else
    raise exception 'staff record photo, certificate, address, scope and licence checks only' using errcode = '22023';
  end if;
  if nullif(trim(coalesce(note, '')), '') is null then
    raise exception 'say what you saw' using errcode = '22023';
  end if;
  select coalesce(jsonb_object_agg(k, left(trim(v), 500)), '{}'::jsonb) into clean
    from jsonb_each_text(coalesce(details, '{}'::jsonb)) as e(k, v)
   where k in ('link', 'number', 'source', 'address') and nullif(trim(v), '') is not null;
  if kind = 'photo' and result = 'found_elsewhere' and not clean ? 'link' then
    raise exception 'give the link where the photo was found' using errcode = '22023';
  end if;
  insert into public.verification_signals (org_id, kind, subject_id, result, note, details, automatic, checked_by)
  values (target_org, kind, subject, result, trim(note), clean, false, auth.uid())
  returning * into saved;
  -- A factory with a trading licence, judged a factory: that is the explanation Approve waits for.
  if kind = 'scope' and result = 'factory' and public.registry_trading_reading(target_org) is not null
     and not exists (select 1 from public.factory_profiles f where f.org_id = target_org and f.vendor_kind = 'trading_company') then
    perform public.admin_explain_trading_scope(target_org, trim(note));
  end if;
  return saved;
end;
$$;

revoke all on function public.admin_record_signal(uuid, text, uuid, text, text, jsonb) from public, anon;
grant execute on function public.admin_record_signal(uuid, text, uuid, text, text, jsonb) to authenticated;
