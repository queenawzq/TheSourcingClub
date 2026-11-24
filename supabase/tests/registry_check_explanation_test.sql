-- Re-saving a registry check never clears "explain why the typed number
-- differs from the licence" by itself (20261124330000). Fixtures prefixed
-- pgtap2433-; every count filters on its own ids.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

set local tsc.skip_terms_guard = 'on';

insert into auth.users (id, email) values
  ('c2433000-0000-0000-0000-000000000001', 'p2433-admin@example.com');
insert into public.platform_admins (user_id) values ('c2433000-0000-0000-0000-000000000001');
insert into public.orgs (id, type, name, slug) values
  ('d2433000-0000-0000-0000-0000000000c1', 'factory', 'P2433 Copy One', 'pgtap2433-cn1'),
  ('d2433000-0000-0000-0000-0000000000c2', 'factory', 'P2433 Copy Two', 'pgtap2433-cn2');
insert into public.factory_profiles (org_id, country_code) values
  ('d2433000-0000-0000-0000-0000000000c1', 'CN'),
  ('d2433000-0000-0000-0000-0000000000c2', 'CN');
-- Each typed a number one character off what its licence shows.
insert into public.company_registrations (org_id, country_code, number) values
  ('d2433000-0000-0000-0000-0000000000c1', 'CN', '91440111MA5P243300'),
  ('d2433000-0000-0000-0000-0000000000c2', 'CN', '91440111MA5P243326');
insert into public.documents (id, org_id, kind, bucket, storage_path, file_name, mime_type, size_bytes, status) values
  ('a2433000-0000-0000-0000-000000000001', 'd2433000-0000-0000-0000-0000000000c1', 'business_registration', 'org-private',
   'd2433000-0000-0000-0000-0000000000c1/business_registration/licence.png', 'licence.png', 'image/png', 10, 'pending'),
  ('a2433000-0000-0000-0000-000000000002', 'd2433000-0000-0000-0000-0000000000c2', 'business_registration', 'org-private',
   'd2433000-0000-0000-0000-0000000000c2/business_registration/licence.png', 'licence.png', 'image/png', 10, 'pending');
insert into public.verification_signals (org_id, kind, subject_id, automatic, result, details) values
  ('d2433000-0000-0000-0000-0000000000c1', 'document_reading', 'a2433000-0000-0000-0000-000000000001', true, 'differs',
   '{"numberAtReading":"91440111MA5P243300","extracted":{"readable":true,"registrationNumber":"91440111MA5P243313"},
     "differences":[{"field":"number","document":"91440111MA5P243313","typed":"91440111MA5P243300"}]}'),
  ('d2433000-0000-0000-0000-0000000000c2', 'document_reading', 'a2433000-0000-0000-0000-000000000002', true, 'differs',
   '{"numberAtReading":"91440111MA5P243326","extracted":{"readable":true,"registrationNumber":"91440111MA5P243339"},
     "differences":[{"field":"number","document":"91440111MA5P243339","typed":"91440111MA5P243326"}]}');

set local request.jwt.claims = '{"sub":"c2433000-0000-0000-0000-000000000001","role":"authenticated"}';

-- The registry shows the licence's number: the difference is still to explain, however often it is saved.
set local role authenticated;
select public.admin_save_registry_check('d2433000-0000-0000-0000-0000000000c1', 'GSXT', 'gsxt', 'found',
  '{"name":"P2433 Copy One","number":"91440111MA5P243313"}'::jsonb);
reset role;
select is(public.registry_approval_problem('d2433000-0000-0000-0000-0000000000c1'), 'document_differs',
  'a check with the licence''s number leaves the difference to explain');
set local role authenticated;
select public.admin_save_registry_check('d2433000-0000-0000-0000-0000000000c1', 'QCC', 'qcc', 'found',
  '{"name":"P2433 Copy One","number":"91440111MA5P243313"}'::jsonb);
reset role;
select is(public.registry_approval_problem('d2433000-0000-0000-0000-0000000000c1'), 'document_differs',
  'saving the same check again does not clear it');

-- The registry shows the number the company typed: the check matches the company.
set local role authenticated;
select public.admin_save_registry_check('d2433000-0000-0000-0000-0000000000c1', 'GSXT', 'gsxt', 'found',
  '{"name":"P2433 Copy One","number":"91440111MA5P243300"}'::jsonb);
reset role;
select is(public.registry_approval_problem('d2433000-0000-0000-0000-0000000000c1'), null,
  'a check that matches the company clears it');

-- Explained on the Typed: line: the explanation holds through later saves.
set local role authenticated;
select public.admin_save_registry_check('d2433000-0000-0000-0000-0000000000c2', 'GSXT', 'gsxt', 'found',
  '{"number":"91440111MA5P243339"}'::jsonb);
reset role;
select is(public.registry_approval_problem('d2433000-0000-0000-0000-0000000000c2'), 'document_differs', 'not explained yet');
set local role authenticated;
select lives_ok($$select public.admin_record_registry_result('d2433000-0000-0000-0000-0000000000c2', 'gsxt', 'name_differs',
  null, 'P2433 Copy Two', 'The licence photo is an older copy; the typed number is on GSXT')$$, 'staff explain the difference');
select public.admin_save_registry_check('d2433000-0000-0000-0000-0000000000c2', 'GSXT', 'gsxt', 'found',
  '{"number":"91440111MA5P243339"}'::jsonb, 'saved again');
reset role;
select is(public.registry_approval_problem('d2433000-0000-0000-0000-0000000000c2'), null,
  'a later save keeps the explanation');
select is((select count(*)::int from public.registry_checks where org_id = 'd2433000-0000-0000-0000-0000000000c2' and not automatic), 3,
  'every save is kept in the history');

select * from finish();
rollback;
