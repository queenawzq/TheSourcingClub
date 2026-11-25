-- China's old 15-digit registration number (注册号, licences issued before
-- 2015) is a valid number when its MOD 11,10 check digit passes, and a Found
-- registry check in China carries a number (20261124616100). Fixtures
-- prefixed pgtapd3-.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

select is(public.registration_number_problem('CN', '370900200020864'), null, 'CN: an old 15-digit number with its check digit passes');
select is(public.registration_number_problem('CN', '3709 0020 0020 864'), null, 'CN: written with spaces, too');
select is(public.registration_number_problem('CN', '370900200020865'), 'check_digit', 'CN: one digit off fails its check digit');
select is(public.registration_number_problem('CN', '37090020002086'), 'format', 'CN: 14 digits is not a number');

insert into auth.users (id, email) values
  ('c3d30000-0000-0000-0000-000000000001', 'pgtapd3-admin@example.com'),
  ('c3d30000-0000-0000-0000-000000000002', 'pgtapd3-member@example.com');
insert into public.platform_admins (user_id) values ('c3d30000-0000-0000-0000-000000000001');
insert into public.orgs (id, type, name, slug) values
  ('d3d30000-0000-0000-0000-0000000000a1', 'factory', 'Pgtap D3 Tianyuan', 'pgtapd3-tianyuan'),
  ('d3d30000-0000-0000-0000-0000000000a2', 'factory', 'Pgtap D3 Ningyang', 'pgtapd3-ningyang');
insert into public.org_members (org_id, user_id, role) values ('d3d30000-0000-0000-0000-0000000000a2', 'c3d30000-0000-0000-0000-000000000002', 'owner');
insert into public.factory_profiles (org_id, country_code) values
  ('d3d30000-0000-0000-0000-0000000000a1', 'CN'),
  ('d3d30000-0000-0000-0000-0000000000a2', 'CN');
insert into public.company_registrations (org_id, country_code, number_source) values
  ('d3d30000-0000-0000-0000-0000000000a1', 'CN', 'document'),
  ('d3d30000-0000-0000-0000-0000000000a2', 'CN', 'document');
insert into public.documents (id, org_id, kind, bucket, storage_path, file_name, mime_type, size_bytes, status) values
  ('a3d30000-0000-0000-0000-000000000001', 'd3d30000-0000-0000-0000-0000000000a1', 'business_registration', 'org-private',
   'd3d30000-0000-0000-0000-0000000000a1/business_registration/licence.jpg', 'licence.jpg', 'image/jpeg', 10, 'pending');

-- The reading of an old licence stores its number, as it does a credit code.
insert into public.verification_signals (org_id, kind, subject_id, automatic, result, details) values
  ('d3d30000-0000-0000-0000-0000000000a1', 'document_reading', 'a3d30000-0000-0000-0000-000000000001', true, 'agrees',
   '{"extracted":{"readable":true,"legalName":"山东天源服装股份有限公司","registrationNumber":"370991200001232"},"differences":[]}');
select is((select number || ' ' || number_source from public.company_registrations where org_id = 'd3d30000-0000-0000-0000-0000000000a1'),
  '370991200001232 document', 'the reading stores the old number');
select is(public.registry_approval_problem('d3d30000-0000-0000-0000-0000000000a1'), 'no_check',
  'approval then waits for a registry check, not for staff to type the number');

-- Found with no number, for a Chinese company with none: refused, in words.
set local request.jwt.claims = '{"sub":"c3d30000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select throws_ok($$select public.admin_save_registry_check('d3d30000-0000-0000-0000-0000000000a2', 'GSXT', 'gsxt', 'found', '{"name":"山东宁阳服装有限公司"}'::jsonb)$$,
  '22023', 'add the registration number the registry shows', 'Found in China without a number is refused');
select lives_ok($$select public.admin_save_registry_check('d3d30000-0000-0000-0000-0000000000a2', 'GSXT', 'gsxt', 'found', '{"number":"370991200004565"}'::jsonb)$$,
  'Found with the old number is saved');
reset role;
select is((select number || ' ' || number_source from public.company_registrations where org_id = 'd3d30000-0000-0000-0000-0000000000a2'),
  '370991200004565 staff', 'and the number becomes the company''s');
select is(public.registry_approval_problem('d3d30000-0000-0000-0000-0000000000a2'), null, 'nothing else waits');
select isnt((select id from public.current_registry_check('d3d30000-0000-0000-0000-0000000000a2')), null, 'the check is the current one, drawn on the page');

-- Not staff: refused before anything is read.
set local request.jwt.claims = '{"sub":"c3d30000-0000-0000-0000-000000000002","role":"authenticated"}';
set local role authenticated;
select throws_ok($$select public.admin_save_registry_check('d3d30000-0000-0000-0000-0000000000a1', 'GSXT', 'gsxt', 'found', '{"number":"370991200001232"}'::jsonb)$$,
  '42501', null, 'a company member cannot record a registry check');
reset role;

select * from finish();
rollback;
