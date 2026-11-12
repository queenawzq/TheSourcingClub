-- v3.1 (tester, Nov 11): a verified factory renamed itself in Settings
-- (orgs.name, the name brands see beside "Verified") and stayed verified,
-- with no notice. Any rename of a verified factory now sends it back to
-- review, whether or not it has a separate legal name, and the notice
-- names what changed.

alter table public.verification_reopenings drop constraint if exists verification_reopenings_field_check;
alter table public.verification_reopenings add constraint verification_reopenings_field_check
  check (field in ('legal_name', 'company_name', 'number', 'country'));

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
                       when 'company_name' then 'Your company name changed: TSC will verify it again'
                       else 'Your registration number changed: TSC will verify it again' end,
          null);
end;
$$;

revoke all on function public.note_verification_reopened(uuid, text, text, text) from public, anon, authenticated;

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
              where f.org_id = new.id and f.verification_status = 'verified') then
    update public.factory_profiles set verification_status = 'pending' where org_id = new.id;
    perform public.note_verification_reopened(new.id, 'company_name', old.name, new.name);
  end if;
  return new;
end;
$$;

revoke all on function public.reopen_on_org_rename() from public, anon, authenticated;
