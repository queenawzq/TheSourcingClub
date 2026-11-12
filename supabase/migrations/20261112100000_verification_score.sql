-- Verification score (Nov 12): the staff review page's one score card.
--
-- Queena asked on Nov 11 for one scoring system: every row a percentage,
-- details in a modal. The approved mock (claude/review-ui-mock-573cf7) is the
-- design; this is its data. The arithmetic is src/shared/verification-score.mjs
-- (one module for the page, the queue and `npm run check:verification-score`),
-- as the levels were: what it reads comes from one staff-only read here.
--
-- 1. admin_verification_score_input(): every record the score reads, in one
--    call. Staff only, tested first, before any select.
-- 2. admin_record_registry_result(): the record form's four answers.
--    "Name differs" is a found whose reason IS the confirmation the approval
--    rules ask for (name_differs / document_differs), so the two checkboxes
--    stay gone. Writes through admin_record_registry_check(), whose rules
--    are unchanged, and keeps the answer and the link on the check.
-- 3. A staff reason on any sub-check, a certificate included
--    (admin_check_reason). A reason on "Factory or trader" still lets a
--    trading-only licence be approved: it writes through admin_explain_check.
--
-- Additive: a new column, a widened check, new functions. Nothing the live
-- site calls changes.

-- ---------------------------------------------------------------------------
-- 3. Reasons on a certificate
-- ---------------------------------------------------------------------------

alter table public.verification_check_reasons
  add column if not exists subject_id uuid;

alter table public.verification_check_reasons
  drop constraint if exists verification_check_reasons_check_key_check;
alter table public.verification_check_reasons
  add constraint verification_check_reasons_check_key_check
  check (check_key in ('license_read', 'registry', 'trading_scope', 'address_owner', 'address_site',
                       'photos', 'video', 'certificate'));

-- The mock's check keys, so the screen never needs the old names.
--   licence → license_read, registry, scope → trading_scope,
--   address → address_owner, photos, certificate (with the certification id).
create or replace function public.admin_check_reason(
  target_org uuid,
  check_key  text,
  note       text,
  subject    uuid default null
)
returns public.verification_check_reasons
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  said text := trim(coalesce(note, ''));
  old_key text;
  saved public.verification_check_reasons;
begin
  if not public.is_platform_admin() then
    raise exception 'only platform admins may explain a check' using errcode = '42501';
  end if;
  if public.is_org_member(target_org) then
    raise exception 'staff cannot review a company they belong to' using errcode = '42501';
  end if;
  if not exists (select 1 from public.orgs o where o.id = target_org) then
    raise exception 'org not found' using errcode = 'P0002';
  end if;
  old_key := case check_key
    when 'licence' then 'license_read'
    when 'registry' then 'registry'
    when 'scope' then 'trading_scope'
    when 'address' then 'address_owner'
    when 'photos' then 'photos'
    when 'certificate' then 'certificate'
  end;
  if old_key is null then
    raise exception 'unknown check' using errcode = '22023';
  end if;
  if said = '' then
    raise exception 'say why' using errcode = '22023';
  end if;

  if old_key <> 'certificate' then
    return public.admin_explain_check(target_org, old_key, said);
  end if;

  if subject is null or not exists (select 1 from public.factory_certifications c
                                      where c.id = subject and c.org_id = target_org) then
    raise exception 'certificate not found for this company' using errcode = 'P0002';
  end if;
  insert into public.verification_check_reasons (org_id, check_key, subject_id, note, reasoned_by)
  values (target_org, 'certificate', subject, left(said, 2000), auth.uid())
  returning * into saved;
  return saved;
end;
$$;
revoke all on function public.admin_check_reason(uuid, text, text, uuid) from public, anon;
grant execute on function public.admin_check_reason(uuid, text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The registry record form
-- ---------------------------------------------------------------------------

create or replace function public.admin_record_registry_result(
  target_org       uuid,
  source           text,
  result           text,
  reference        text default null,
  name_on_registry text default null,
  reason           text default null
)
returns public.registry_checks
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  said text := nullif(trim(coalesce(reason, '')), '');
  link text := nullif(trim(coalesce(reference, '')), '');
  seen_name text := nullif(trim(coalesce(name_on_registry, '')), '');
  -- The parameter, named apart from registry_checks.result for the UPDATE below.
  answer text := result;
  note_text text;
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
  if result is null or result not in ('found', 'name_differs', 'not_found', 'could_not_check') then
    raise exception 'result must be found, name_differs, not_found or could_not_check' using errcode = '22023';
  end if;
  if char_length(coalesce(link, '')) > 500 or char_length(coalesce(seen_name, '')) > 300 then
    raise exception 'too long' using errcode = '22023';
  end if;
  -- The reason is the confirmation: "they differ, and this is why".
  if result = 'name_differs' and said is null then
    raise exception 'say why the name differs' using errcode = '22023';
  end if;

  note_text := coalesce(said, link, case result
    when 'found' then 'Found, name and number match'
    when 'not_found' then 'Not found'
    else 'Could not check' end);

  begin
    saved := public.admin_record_registry_check(
      target_org,
      source,
      case when result = 'name_differs' then 'found' else result end,
      note_text,
      -- Found on VIES is "I checked VIES myself".
      result in ('found', 'name_differs'),
      case when seen_name is null then '{}'::jsonb else jsonb_build_object('name', seen_name) end,
      result = 'name_differs');
  exception when sqlstate '22023' then
    if sqlerrm like 'a source shows another name or number%' then
      raise exception 'Another source shows a different name or number: choose Name differs and say why'
        using errcode = '22023';
    end if;
    raise;
  end;

  update public.registry_checks c
     set details = c.details
                   || jsonb_build_object('outcome', answer)
                   || case when link is null then '{}'::jsonb else jsonb_build_object('reference', link) end
                   || case when said is null then '{}'::jsonb else jsonb_build_object('reason', said) end
   where c.id = saved.id
  returning * into saved;
  return saved;
end;
$$;
revoke all on function public.admin_record_registry_result(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.admin_record_registry_result(uuid, text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 1. What the score reads
-- ---------------------------------------------------------------------------

create or replace function public.admin_verification_score_input(target_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  latest_licence public.documents;
  last_photo_check timestamptz;
  newest_photo timestamptz;
begin
  if not public.is_platform_admin() then
    raise exception 'only platform admins may read verification checks' using errcode = '42501';
  end if;
  if not exists (select 1 from public.orgs o where o.id = target_org) then
    raise exception 'company not found' using errcode = 'P0002';
  end if;

  select * into latest_licence from public.documents d
   where d.org_id = target_org and d.kind = 'business_registration'
   order by d.created_at desc limit 1;
  select max(c.created_at) into last_photo_check from public.photo_checks c where c.org_id = target_org;
  select max(d.created_at) into newest_photo from public.documents d
   where d.org_id = target_org and d.kind::text in ('product_image', 'walkthrough', 'factory_photo');

  return jsonb_build_object(
    'now', now(),
    'detail', public.admin_registry_detail(target_org),
    'extra', public.admin_verification_signals(target_org),
    'rules', public.admin_verification_rules(target_org),
    'photoCheck', (select c.result from public.photo_checks c where c.org_id = target_org
                    order by c.created_at desc limit 1),
    -- Every staff reason, newest first, with what it is about.
    'reasons', coalesce((
      select jsonb_agg(jsonb_build_object(
               'checkKey', r.check_key, 'subjectId', r.subject_id, 'note', r.note, 'at', r.reasoned_at,
               'by', coalesce(nullif(p.full_name, ''), u.email::text))
               order by r.reasoned_at desc)
        from public.verification_check_reasons r
        left join auth.users u on u.id = r.reasoned_by
        left join public.user_profiles p on p.id = r.reasoned_by
       where r.org_id = target_org), '[]'::jsonb),
    -- An automatic check that has not answered yet: a licence uploaded in the
    -- last 10 minutes and not read, photos newer than the last photo check.
    'pending', jsonb_build_object(
      'registration', latest_licence.id is not null
                      and latest_licence.created_at > now() - interval '10 minutes'
                      and not exists (select 1 from public.verification_signals s
                                       where s.org_id = target_org and s.kind = 'document_reading'
                                         and s.subject_id = latest_licence.id),
      'photos', newest_photo is not null and newest_photo > now() - interval '10 minutes'
                and (last_photo_check is null or last_photo_check < newest_photo)),
    'profile', (
      select jsonb_build_object(
               'name', o.name, 'legalName', f.legal_name, 'website', f.website_url, 'location', f.location,
               'countryCode', f.country_code, 'foundedYear', f.founded_year, 'employees', f.employee_count,
               'intro', f.intro, 'moq', f.moq, 'leadDays', f.typical_lead_days, 'vendorKind', f.vendor_kind,
               'status', f.verification_status)
        from public.orgs o left join public.factory_profiles f on f.org_id = o.id
       where o.id = target_org),
    'terms', (
      select jsonb_build_object('signature', a.signature, 'acceptedAt', a.accepted_at, 'signedBy', p.full_name)
        from public.terms_acceptances a
        left join public.user_profiles p on p.id = a.accepted_by
       where a.org_id = target_org
       order by a.accepted_at desc limit 1),
    'submittedBy', (
      select jsonb_build_object('name', p.full_name, 'email', u.email)
        from public.org_members m
        join auth.users u on u.id = m.user_id
        left join public.user_profiles p on p.id = m.user_id
       where m.org_id = target_org and m.role = 'owner'
       order by m.created_at limit 1)
  );
end;
$$;
revoke all on function public.admin_verification_score_input(uuid) from public, anon;
grant execute on function public.admin_verification_score_input(uuid) to authenticated;
