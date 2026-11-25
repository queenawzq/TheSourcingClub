-- A bilingual licence's name, stored joined with " / ", is any of its names
-- (20261124380000). Fixtures prefixed pgtap2438-.
begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

insert into auth.users (id, email) values ('c2438000-0000-0000-0000-000000000001', 'p2438-admin@example.com');
insert into public.platform_admins (user_id) values ('c2438000-0000-0000-0000-000000000001');
insert into public.orgs (id, type, name, slug) values ('d2438000-0000-0000-0000-0000000000a1', 'factory', 'Harbourview Sourcing 2438', 'pgtap2438-harbourview');
insert into public.factory_profiles (org_id, country_code, legal_name, vendor_kind) values
  ('d2438000-0000-0000-0000-0000000000a1', 'HK', 'Harbourview Sourcing 2438 Limited', 'trading_company');
insert into public.company_registrations (org_id, country_code, number) values ('d2438000-0000-0000-0000-0000000000a1', 'HK', '71243800');
insert into public.documents (id, org_id, kind, bucket, storage_path, file_name, mime_type, size_bytes, status) values
  ('a2438000-0000-0000-0000-000000000001', 'd2438000-0000-0000-0000-0000000000a1', 'business_registration', 'org-private',
   'd2438000-0000-0000-0000-0000000000a1/business_registration/br.png', 'br.png', 'image/png', 10, 'pending');
insert into public.verification_signals (org_id, kind, subject_id, automatic, result, details) values
  ('d2438000-0000-0000-0000-0000000000a1', 'document_reading', 'a2438000-0000-0000-0000-000000000001', true, 'differs',
   '{"numberAtReading":"71243800","extracted":{"readable":true,"legalName":"港景採購有限公司","legalNameEnglish":"HARBOURVIEW SOURCING LIMITED","registrationNumber":"71243800-000-11-25-6"},
     "differences":[{"field":"name","document":"港景採購有限公司 / HARBOURVIEW SOURCING LIMITED","typed":"Harbourview Sourcing 2438 Limited"}]}');

set local request.jwt.claims = '{"sub":"c2438000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select public.admin_save_registry_check('d2438000-0000-0000-0000-0000000000a1', 'Companies Registry', 'hk_cr', 'found',
  '{"name":"HARBOURVIEW SOURCING LIMITED","number":"71243800"}'::jsonb);
reset role;
select is(public.registry_approval_problem('d2438000-0000-0000-0000-0000000000a1'), null,
  'a check with the certificate''s English name settles it');

set local role authenticated;
select public.admin_save_registry_check('d2438000-0000-0000-0000-0000000000a1', 'Companies Registry', 'hk_cr', 'found',
  '{"name":"港景採購有限公司","number":"71243800"}'::jsonb);
reset role;
select is(public.registry_approval_problem('d2438000-0000-0000-0000-0000000000a1'), null,
  'and so does one with its Chinese name');

set local role authenticated;
select public.admin_save_registry_check('d2438000-0000-0000-0000-0000000000a1', 'Companies Registry', 'hk_cr', 'found',
  '{"name":"Another Trading Limited","number":"71243800"}'::jsonb);
reset role;
select is(public.registry_approval_problem('d2438000-0000-0000-0000-0000000000a1'), 'document_differs',
  'another name still waits');

select * from finish();
rollback;
