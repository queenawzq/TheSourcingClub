-- Verification, second round, the tester's findings (20261126100300 on):
-- one block per finding. Fixtures prefixed pgtap-r2f-; every count filters
-- on fixture ids.
begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

insert into auth.users (id, email) values
  ('c2611261-0000-0000-0000-000000000001', 'pgtap-r2f-admin@example.com'),
  ('c2611261-0000-0000-0000-000000000002', 'pgtap-r2f-factory@example.com');
insert into public.platform_admins (user_id) values ('c2611261-0000-0000-0000-000000000001');
insert into public.orgs (id, type, name, slug) values
  ('d2611261-0000-0000-0000-0000000000f1', 'factory', 'R2F Mill', 'pgtap-r2f-mill'),
  ('d2611261-0000-0000-0000-0000000000f2', 'factory', 'R2F No Number', 'pgtap-r2f-no-number'),
  ('d2611261-0000-0000-0000-0000000000b1', 'brand', 'R2F Brand', 'pgtap-r2f-brand');
insert into public.org_members (org_id, user_id, role) values
  ('d2611261-0000-0000-0000-0000000000f1', 'c2611261-0000-0000-0000-000000000002', 'owner');
insert into public.factory_profiles (org_id, legal_name, country_code, location, onboarding_completed_at) values
  ('d2611261-0000-0000-0000-0000000000f1', 'R2F Mill Lda', 'PT', 'Porto, Portugal', now()),
  ('d2611261-0000-0000-0000-0000000000f2', null, 'PT', 'Braga, Portugal', now());
insert into public.brand_profiles (org_id, hq_location) values
  ('d2611261-0000-0000-0000-0000000000b1', 'London, United Kingdom');
insert into public.company_registrations (org_id, country_code, number) values
  ('d2611261-0000-0000-0000-0000000000f1', 'PT', '519211596');

set local request.jwt.claims = '{"sub":"c2611261-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;

-- C1: a registry number in the wrong format is refused, whether or not the company has one --
select throws_ok($$select public.admin_save_registry_check('d2611261-0000-0000-0000-0000000000f1', 'Published acts', 'site', 'found',
  '{"number":"51921159"}'::jsonb)$$,
  '22023', 'A Portuguese company number has 9 digits, e.g. 519211596: copy it again from the registry',
  'C1: a company with a number: an eight-digit registry number is refused');
select throws_ok($$select public.admin_save_registry_check('d2611261-0000-0000-0000-0000000000f2', 'Published acts', 'site', 'found',
  '{"number":"1234"}'::jsonb)$$,
  '22023', 'A Portuguese company number has 9 digits, e.g. 519211596: copy it again from the registry',
  'C1: and one with none, as before');
select lives_ok($$select public.admin_save_registry_check('d2611261-0000-0000-0000-0000000000f1', 'Published acts', 'site', 'found',
  '{"number":"NIF 519211596","name":"R2F Mill Lda"}'::jsonb)$$,
  'C1: a labelled number in the right format is saved');

reset role;
select * from finish();
rollback;
