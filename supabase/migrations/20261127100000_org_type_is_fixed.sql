-- A company's type is fixed; only staff approval decides a factory is real.
--
-- authenticated held UPDATE on every column of orgs, and orgs_owner_update let
-- an owner write their own row, type included. The registry guard on approval
-- runs only for orgs.type = 'factory', so a factory's owner could set its type
-- to brand, sign the brand terms, be approved with no registry check (the
-- approval verifies factory_profiles and grants the 500 credits all the same),
-- then set it back to factory.
--
-- Nothing in the app writes orgs directly: a rename goes through rename_factory
-- and save_account_settings, both security definer. So signed-in users lose
-- UPDATE on orgs altogether (type, name, slug, is_demo). orgs_owner_update
-- stays, inert, so the site live during the deploy keeps working.
--
-- The guard also treats a company with a factory profile as a factory: any
-- member may write factory_profiles, and an approval verifies that profile
-- whatever the company's type, so a brand that added one would skip the check.

revoke update on public.orgs from authenticated;

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
  if not exists (select 1 from public.orgs o where o.id = new.org_id and o.type = 'factory')
     and not exists (select 1 from public.factory_profiles f where f.org_id = new.org_id) then
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

