-- ============================================================================
-- Staff add a company's business registration (Tazapay, C4)
-- ----------------------------------------------------------------------------
-- A mainland China factory with no registration number on file cannot be paid
-- through Tazapay (tazapayDetailsProblems, src/shared/tazapay-payout.mjs:
-- 'not_on_file'). Until now only the company could save one
-- (save_company_registration: owners and Settings access); staff could read it
-- but not add it, except by editing an AI reading and running it again.
--
-- admin_save_company_registration(target_org, country, number, note,
-- confirmed) is the staff entry from the company's review page:
--   - The admin test is the first statement, before any select: checking
--     later would tell a non-admin whether the company exists (P0002 versus
--     42501).
--   - Staff who belong to the company cannot change its registration, the
--     same rule as admin_set_registration_number().
--   - Vendors only (orgs.type 'factory', trading companies included): a brand
--     has no registration on file.
--   - The number passes the same rules as the company's own save
--     (registration_number_problem, normalise_registration_number). A failed
--     check digit may be confirmed outside China; in China the trigger
--     company_registrations_cn_check_digit refuses it whatever is said.
--     China's old 15-digit number is refused, as it is for the company.
--   - A note is required, at the database: the company reads it in its
--     notification.
--   - The row is written with number_source 'staff' and updated_by the staff
--     member; registration_number_entries keeps who entered what and why, as
--     it does for admin_set_registration_number().
--   - The company is notified in the same transaction (one row per company,
--     which every member's bell reads), with the note as its body.
--   - A changed number on a verified vendor still reopens its verification
--     (company_registrations_reopen); a first number does not.
--
-- Safe with the live site while applied: one new function, no table or
-- existing function changed.
-- ============================================================================

create or replace function public.admin_save_company_registration(
  target_org uuid,
  country    text,
  number     text,
  note       text,
  confirmed  boolean default false
)
returns public.company_registrations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cc       text := nullif(upper(trim(coalesce(country, ''))), '');
  said     text := trim(coalesce(note, ''));
  v        text;
  problem  text;
  flagged  boolean := false;
  previous public.company_registrations;
  saved    public.company_registrations;
begin
  if not public.is_platform_admin() then
    raise exception 'only TSC staff can add a company''s registration' using errcode = '42501';
  end if;
  if public.is_org_member(target_org) then
    raise exception 'staff cannot change the registration of a company they belong to' using errcode = '42501';
  end if;
  if not exists (select 1 from public.orgs o where o.id = target_org and o.type = 'factory') then
    raise exception 'company not found' using errcode = 'P0002';
  end if;

  if cc is null or cc !~ '^[A-Z]{2}$' then
    raise exception 'country must be a two-letter code' using errcode = '22023';
  end if;
  if char_length(said) < 5 or char_length(said) > 500 then
    raise exception 'note: 5 to 500 characters' using errcode = '22023';
  end if;

  v := public.normalise_registration_number(cc, number);
  problem := public.registration_number_problem(cc, number);
  if problem = 'check_digit' and coalesce(confirmed, false) and cc <> 'CN' then
    problem := null;
    flagged := true;
  end if;
  if problem is not null then
    raise exception 'registration number: %', problem using errcode = '22023';
  end if;

  select * into previous from public.company_registrations r where r.org_id = target_org;

  insert into public.company_registrations as r
    (org_id, country_code, number, number_source, no_company_number, check_digit_confirmed, updated_by, updated_at)
  values (target_org, cc, v, 'staff', false, flagged, auth.uid(), now())
  on conflict (org_id) do update
    set country_code          = excluded.country_code,
        number                = excluded.number,
        number_source         = 'staff',
        no_company_number     = false,
        check_digit_confirmed = excluded.check_digit_confirmed,
        -- A second field belongs to its country's number.
        access_code           = case when r.country_code = excluded.country_code then r.access_code end,
        registration_letter_number = case when r.country_code = excluded.country_code then r.registration_letter_number end,
        updated_by            = excluded.updated_by,
        updated_at            = case when (r.country_code, r.number) is distinct from (excluded.country_code, excluded.number)
                                     then now() else r.updated_at end
  returning * into saved;

  insert into public.registration_number_entries (org_id, country_code, number, note, entered_by)
  values (target_org, cc, v, said, auth.uid());

  insert into public.notifications (org_id, kind, subject_type, subject_id, title, body)
  values (target_org, 'registration_number_set', 'org', target_org,
          case when previous.number is null then 'TSC added your registration number'
               when (previous.country_code, previous.number) is distinct from (cc, v) then 'TSC changed your registration number'
               else 'TSC updated your registration number' end,
          said);

  return saved;
end;
$$;

revoke all on function public.admin_save_company_registration(uuid, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.admin_save_company_registration(uuid, text, text, text, boolean) to authenticated;
