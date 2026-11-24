-- Staff verification, simpler (Nov 24).
--
-- 1. A registry check saved for a company with no registration number yet
--    counts. It was stored, but current_registry_check() only matched a
--    check to the company's number, so the page never showed it and Approve
--    kept asking for one: staff were stuck.
-- 2. One registry form: where staff checked (any site), Found / Not found /
--    Couldn't check, the name, number and address as the site shows them,
--    proof files and a link or note (admin_save_registry_check). The page
--    compares the values itself; there is no "Name differs" answer.
--    Found with a difference can be approved; so can "Couldn't check" with a
--    note (staff judgement). Not found still blocks.
-- 3. Certificates: the same form (admin_save_certificate_check).
-- 4. Proof files: bucket org-private, under one staff folder
--    (<staff folder>/<company>/<file>). The company's own policies key on the
--    first folder being its id, so they never match; staff read every
--    org-private object already, and may write and delete in that folder only.
-- 5. Staff may change a vendor's type and its address
--    (admin_update_company_profile); the company is told.
-- 6. Every one of these is kept in org_review_changes (staff only): who,
--    when, what.
--
-- Additive: the old functions stay, for the site live during the deploy.

-- ---------------------------------------------------------------------------
-- 1. A numberless check counts while the company has no number
-- ---------------------------------------------------------------------------

create or replace function public.current_registry_check(target_org uuid)
returns public.registry_checks
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.*
    from public.registry_checks c
    left join public.company_registrations r on r.org_id = c.org_id
   where c.org_id = target_org
     and not c.automatic
     and (r.number = c.number_checked
          -- No number yet (or a sole proprietor with none): the check made
          -- without one. A number added later makes it out of date.
          or (r.number is null and c.number_checked is null))
   order by c.checked_at desc
   limit 1
$$;
revoke all on function public.current_registry_check(uuid) from public, anon, authenticated;

-- From 20261112150000, with "Couldn't check" + a note accepted.
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
  -- Couldn't check, with staff's note: their judgement decides (Nov 24).
  judged := current_check.id is not null and current_check.result = 'could_not_check'
            and nullif(trim(coalesce(current_check.details ->> 'note', '')), '') is not null;
  if current_check.id is null or (current_check.result <> 'found' and not judged) then
    return 'no_check';
  end if;
  if not judged then
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
revoke all on function public.registry_approval_problem(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. The review history (staff only)
-- ---------------------------------------------------------------------------

create table if not exists public.org_review_changes (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.orgs (id) on delete cascade,
  kind       text not null check (kind in ('registry_check', 'certificate_check', 'vendor_kind', 'address')),
  subject_id uuid,
  details    jsonb not null default '{}'::jsonb,
  changed_by uuid references auth.users (id) on delete set null,
  changed_at timestamptz not null default now()
);
create index if not exists org_review_changes_org_idx on public.org_review_changes (org_id, changed_at desc);
alter table public.org_review_changes enable row level security;
revoke all on public.org_review_changes from public, anon, authenticated;
grant all on public.org_review_changes to service_role;

create or replace function public.admin_review_changes(target_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'only platform admins may read the review history' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', c.id, 'kind', c.kind, 'subjectId', c.subject_id, 'details', c.details, 'at', c.changed_at,
             'by', coalesce(nullif(p.full_name, ''), u.email::text))
             order by c.changed_at desc)
      from public.org_review_changes c
      left join auth.users u on u.id = c.changed_by
      left join public.user_profiles p on p.id = c.changed_by
     where c.org_id = target_org), '[]'::jsonb);
end;
$$;
revoke all on function public.admin_review_changes(uuid) from public, anon;
grant execute on function public.admin_review_changes(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Proof files
-- ---------------------------------------------------------------------------

-- The staff folder: a fixed id no company has, so storage_path_org() casts
-- cleanly and is_org_member() is false for every company.
create or replace function public.verification_proof_folder()
returns text
language sql
immutable
as $$ select '5aff0000-0000-4000-8000-000000000001'::text $$;
grant execute on function public.verification_proof_folder() to authenticated;

drop policy if exists "verification proof staff write" on storage.objects;
create policy "verification proof staff write" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'org-private'
    and split_part(name, '/', 1) = public.verification_proof_folder()
    and public.is_platform_admin()
  );

drop policy if exists "verification proof staff delete" on storage.objects;
create policy "verification proof staff delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'org-private'
    and split_part(name, '/', 1) = public.verification_proof_folder()
    and public.is_platform_admin()
  );

-- [{ path, name, type, size }] → the same list, checked: at most 10, each in
-- this company's part of the staff folder, each uploaded.
create or replace function public.verification_proof_clean(target_org uuid, proof jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  item jsonb;
  out jsonb := '[]'::jsonb;
  prefix text := public.verification_proof_folder() || '/' || target_org::text || '/';
  p text;
begin
  if proof is null or jsonb_typeof(proof) <> 'array' then
    return '[]'::jsonb;
  end if;
  if jsonb_array_length(proof) > 10 then
    raise exception 'at most 10 files' using errcode = '22023';
  end if;
  for item in select * from jsonb_array_elements(proof) loop
    p := item ->> 'path';
    if p is null or left(p, length(prefix)) <> prefix or p ~ '\.\.' or char_length(p) > 400 then
      raise exception 'file not found' using errcode = '22023';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'org-private' and o.name = p) then
      raise exception 'file not found' using errcode = '22023';
    end if;
    out := out || jsonb_build_array(jsonb_build_object(
      'path', p,
      'name', left(coalesce(nullif(trim(item ->> 'name'), ''), split_part(p, '/', 3)), 200),
      'type', left(coalesce(item ->> 'type', ''), 100)));
  end loop;
  return out;
end;
$$;
revoke all on function public.verification_proof_clean(uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The registry form
-- ---------------------------------------------------------------------------

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
  if char_length(where_text) > 120 or char_length(coalesce(said, '')) > 1000 or char_length(coalesce(url, '')) > 500
     or char_length(coalesce(seen_name, '')) > 300 or char_length(coalesce(seen_number, '')) > 60
     or char_length(coalesce(seen_address, '')) > 500 then
    raise exception 'too long' using errcode = '22023';
  end if;
  files := public.verification_proof_clean(target_org, proof);

  saved := public.admin_record_registry_check(
    target_org, source_key, answer,
    coalesce(said, 'Found on ' || where_text),
    answer = 'found',
    jsonb_strip_nulls(jsonb_build_object('name', seen_name, 'address', seen_address)),
    -- The page shows any difference itself; Found with one can be approved.
    true);

  update public.registry_checks c
     set details = c.details
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

-- ---------------------------------------------------------------------------
-- 3. The certificate form
-- ---------------------------------------------------------------------------

create or replace function public.admin_save_certificate_check(
  target_org  uuid,
  certificate uuid,
  site        text,
  result      text,
  seen        jsonb default '{}'::jsonb,
  note        text default null,
  link        text default null,
  proof       jsonb default '[]'::jsonb
)
returns public.verification_signals
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  answer text := result;
  where_text text := nullif(trim(coalesce(site, '')), '');
  said text := nullif(trim(coalesce(note, '')), '');
  url text := nullif(trim(coalesce(link, '')), '');
  files jsonb;
  saved public.verification_signals;
begin
  if not public.is_platform_admin() then
    raise exception 'only platform admins may record checks' using errcode = '42501';
  end if;
  if public.is_org_member(target_org) then
    raise exception 'staff cannot review a company they belong to' using errcode = '42501';
  end if;
  if answer is null or answer not in ('found', 'expired', 'not_found', 'could_not_check') then
    raise exception 'choose Found, Expired, Not found or Couldn''t check' using errcode = '22023';
  end if;
  if not exists (select 1 from public.factory_certifications c where c.id = certificate and c.org_id = target_org) then
    raise exception 'certificate not found for this company' using errcode = 'P0002';
  end if;
  if where_text is null then
    raise exception 'say where you checked' using errcode = '22023';
  end if;
  if answer in ('not_found', 'could_not_check') and said is null then
    raise exception 'add a note' using errcode = '22023';
  end if;
  if char_length(where_text) > 120 or char_length(coalesce(said, '')) > 1000 or char_length(coalesce(url, '')) > 500
     or char_length(coalesce(seen ->> 'number', '')) > 120 or char_length(coalesce(seen ->> 'holder', '')) > 300 then
    raise exception 'too long' using errcode = '22023';
  end if;
  files := public.verification_proof_clean(target_org, proof);

  insert into public.verification_signals (org_id, kind, subject_id, result, note, details, automatic, checked_by)
  values (target_org, 'certificate', certificate, answer,
          coalesce(said, case answer when 'found' then 'Found on ' when 'expired' then 'Expired on ' else 'Checked on ' end || where_text),
          jsonb_strip_nulls(jsonb_build_object(
            'form', 2, 'site', where_text, 'link', url, 'note', said,
            'number', nullif(trim(coalesce(seen ->> 'number', '')), ''),
            'holder', nullif(trim(coalesce(seen ->> 'holder', '')), '')))
          || jsonb_build_object('proof', files),
          false, auth.uid())
  returning * into saved;
  update public.verification_signals s set checked_at = clock_timestamp() where s.id = saved.id returning * into saved;

  insert into public.org_review_changes (org_id, kind, subject_id, details, changed_by)
  values (target_org, 'certificate_check', certificate,
          jsonb_strip_nulls(jsonb_build_object('result', answer, 'site', where_text, 'note', said, 'files', jsonb_array_length(files))),
          auth.uid());
  return saved;
end;
$$;
revoke all on function public.admin_save_certificate_check(uuid, uuid, text, text, jsonb, text, text, jsonb) from public, anon;
grant execute on function public.admin_save_certificate_check(uuid, uuid, text, text, jsonb, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Change type, edit address
-- ---------------------------------------------------------------------------

create or replace function public.admin_update_company_profile(
  target_org  uuid,
  vendor_kind text default null,
  address     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  new_kind text := nullif(trim(coalesce(vendor_kind, '')), '');
  new_address text := nullif(trim(coalesce(address, '')), '');
  old_kind text;
  old_address text;
  kind_changed boolean := false;
  address_changed boolean := false;
begin
  if not public.is_platform_admin() then
    raise exception 'only platform admins may change a company''s profile' using errcode = '42501';
  end if;
  if public.is_org_member(target_org) then
    raise exception 'staff cannot review a company they belong to' using errcode = '42501';
  end if;
  select f.vendor_kind::text into old_kind from public.factory_profiles f where f.org_id = target_org;
  if not found then
    raise exception 'company not found' using errcode = 'P0002';
  end if;
  if new_kind is null and new_address is null then
    raise exception 'nothing to change' using errcode = '22023';
  end if;
  if new_kind is not null and new_kind not in ('manufacturer', 'trading_company') then
    raise exception 'type must be Factory or Trading company' using errcode = '22023';
  end if;
  if char_length(coalesce(new_address, '')) > 500 then
    raise exception 'address is too long' using errcode = '22023';
  end if;
  select a.address into old_address from public.factory_production_addresses a where a.org_id = target_org;

  if new_kind is not null and new_kind <> old_kind then
    update public.factory_profiles f set vendor_kind = new_kind::public.vendor_kind where f.org_id = target_org;
    insert into public.org_review_changes (org_id, kind, details, changed_by)
    values (target_org, 'vendor_kind', jsonb_build_object('from', old_kind, 'to', new_kind), auth.uid());
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

  if kind_changed or address_changed then
    insert into public.notifications (org_id, kind, subject_type, subject_id, title, body)
    values (target_org, 'profile_updated', 'org', target_org, 'Your company profile was updated',
            concat_ws(' ',
              case when kind_changed then 'We updated your company type to '
                   || case new_kind when 'trading_company' then 'Trading company' else 'Factory' end || '.' end,
              case when address_changed then 'We updated your company address.' end));
  end if;
  return jsonb_build_object('vendorKind', coalesce(new_kind, old_kind), 'kindChanged', kind_changed, 'addressChanged', address_changed);
end;
$$;
revoke all on function public.admin_update_company_profile(uuid, text, text) from public, anon;
grant execute on function public.admin_update_company_profile(uuid, text, text) to authenticated;

-- The notice is emailed like the other account notices (from 20261120240000).
CREATE OR REPLACE FUNCTION public.notification_email_category(kind text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case
    when kind in ('rfq_invited', 'rfq_cancelled', 'quote_received', 'quote_withdrawn',
                  'quote_accepted', 'quote_declined', 'rfq_matched', 'capacity_reminder')
      then 'rfq'
    when kind in ('payment_due', 'payment_sent', 'payment_confirmed', 'payment_rejected',
                  'payment_failed', 'payment_refunded', 'payment_disputed', 'funds_released',
                  'milestone_submitted', 'milestone_approved', 'milestone_dispute',
                  'milestone_reminder', 'milestone_due_soon',
                  'schedule_updated', 'schedule_agreed',
                  'order_created', 'order_activated', 'order_completed', 'order_cancelled',
                  'cancellation_proposed', 'cancellation_withdrawn', 'cancellation_declined')
      then 'payments'
    when kind in ('message', 'call_proposed', 'call_accepted', 'call_declined',
                  'call_countered', 'call_cancelled', 'call_started')
      then 'messages'
    when kind in ('payout_method_changed', 'profile_updated')
      then 'account'
    else null
  end
$function$;
