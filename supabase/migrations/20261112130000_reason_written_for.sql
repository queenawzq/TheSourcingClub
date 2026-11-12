-- Nov 12, fix round 2: a staff reason belongs to the problem it explains.
-- `written_for` keeps the check's verdict at the time the reason was written;
-- the score lifts a check only while its verdict is still that one
-- (src/shared/verification-score.mjs). Older reasons have none and keep
-- lifting as before. Additive: a new column, a new function, and the score
-- input redefined to carry it.

alter table public.verification_check_reasons
  add column if not exists written_for text;

create or replace function public.admin_check_reason_for(
  target_org  uuid,
  check_key   text,
  note        text,
  subject     uuid default null,
  written_for text default null
)
returns public.verification_check_reasons
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  saved public.verification_check_reasons;
begin
  -- admin_check_reason runs every staff test first.
  saved := public.admin_check_reason(target_org, check_key, note, subject);
  if saved.id is not null and nullif(trim(coalesce(written_for, '')), '') is not null then
    update public.verification_check_reasons r
       set written_for = left(trim(written_for), 400)
     where r.id = saved.id
    returning * into saved;
  end if;
  return saved;
end;
$$;

revoke all on function public.admin_check_reason_for(uuid, text, text, uuid, text) from public, anon;
grant execute on function public.admin_check_reason_for(uuid, text, text, uuid, text) to authenticated;

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
               'checkKey', r.check_key, 'subjectId', r.subject_id, 'note', r.note, 'at', r.reasoned_at, 'writtenFor', r.written_for,
               'by', coalesce(nullif(p.full_name, ''), u.email::text))
               order by r.reasoned_at desc)
        from public.verification_check_reasons r
        left join auth.users u on u.id = r.reasoned_by
        left join public.user_profiles p on p.id = r.reasoned_by
       where r.org_id = target_org), '[]'::jsonb),
    -- An automatic check that has not answered yet: a licence uploaded in the
    -- last 2 minutes and not read, photos newer than the last photo check.
    'pending', jsonb_build_object(
      'registration', latest_licence.id is not null
                      and latest_licence.created_at > now() - interval '2 minutes'
                      and not exists (select 1 from public.verification_signals s
                                       where s.org_id = target_org and s.kind = 'document_reading'
                                         and s.subject_id = latest_licence.id),
      'photos', newest_photo is not null and newest_photo > now() - interval '2 minutes'
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
