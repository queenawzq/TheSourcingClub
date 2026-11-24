-- The same registration number written two ways is no difference, by the
-- country's rule (20261124370000). Fixtures prefixed pgtap2437-.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

select ok(public.registration_numbers_same('HK', '71234567', '71234567-000-11-25-6'), 'HK: the BR number starts the certificate number');
select ok(not public.registration_numbers_same('HK', '71234568', '71234567-000-11-25-6'), 'HK: another number does not');
select ok(public.registration_numbers_same('ES', 'B12345678', 'ESB12345678'), 'EU: a VAT number is the prefix and the national number');
select ok(public.registration_numbers_same('GR', '094014201', 'EL094014201'), 'Greece writes EL');
select ok(not public.registration_numbers_same('GB', '12345678', 'GB12345678'), 'not outside the EU');

insert into auth.users (id, email) values ('c2437000-0000-0000-0000-000000000001', 'p2437-admin@example.com');
insert into public.platform_admins (user_id) values ('c2437000-0000-0000-0000-000000000001');
insert into public.orgs (id, type, name, slug) values ('d2437000-0000-0000-0000-0000000000a1', 'factory', 'P2437 Harbour Line', 'pgtap2437-harbour');
insert into public.factory_profiles (org_id, country_code, legal_name, vendor_kind) values
  ('d2437000-0000-0000-0000-0000000000a1', 'HK', 'P2437 Harbour Line Limited', 'trading_company');
insert into public.company_registrations (org_id, country_code, number) values ('d2437000-0000-0000-0000-0000000000a1', 'HK', '71243700');
insert into public.documents (id, org_id, kind, bucket, storage_path, file_name, mime_type, size_bytes, status) values
  ('a2437000-0000-0000-0000-000000000001', 'd2437000-0000-0000-0000-0000000000a1', 'business_registration', 'org-private',
   'd2437000-0000-0000-0000-0000000000a1/business_registration/br.png', 'br.png', 'image/png', 10, 'pending');
-- A reading stored before the rule: the certificate's full number "differs".
insert into public.verification_signals (org_id, kind, subject_id, automatic, result, details) values
  ('d2437000-0000-0000-0000-0000000000a1', 'document_reading', 'a2437000-0000-0000-0000-000000000001', true, 'differs',
   '{"numberAtReading":"71243700","extracted":{"readable":true,"legalName":"P2437 Harbour Line Limited","registrationNumber":"71243700-000-11-25-6"},
     "differences":[{"field":"number","document":"71243700-000-11-25-6","typed":"71243700"}]}');

set local request.jwt.claims = '{"sub":"c2437000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
-- Found, as the registry shows it: the registry's own (other) spelling of the number is not needed.
select public.admin_save_registry_check('d2437000-0000-0000-0000-0000000000a1', 'Companies Registry', 'hk_cr', 'found',
  '{"name":"P2437 Harbour Line Limited"}'::jsonb);
reset role;
select ok(public.registry_reading_differs('d2437000-0000-0000-0000-0000000000a1') is not null, 'the stored reading still lists the number');
select is(public.registry_approval_problem('d2437000-0000-0000-0000-0000000000a1'), null, 'and Approve does not wait for an explanation');

select * from finish();
rollback;
