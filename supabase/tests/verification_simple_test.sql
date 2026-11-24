-- Staff verification, simpler (20261124300000): the registry form saves for a
-- company with no registration number yet, the record counts, and only staff
-- read or write any of it. Fixtures prefixed pgtap24-; counts filter on ids.
begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

insert into auth.users (id, email) values
  ('c2400000-0000-0000-0000-000000000001', 'p24-admin@example.com'),
  ('c2400000-0000-0000-0000-000000000003', 'p24-owner@example.com');
insert into public.platform_admins (user_id) values ('c2400000-0000-0000-0000-000000000001');
insert into auth.users (id, email) values
  ('c2400000-0000-0000-0000-000000000002', 'p24-staff-member@example.com'),
  ('c2400000-0000-0000-0000-000000000004', 'p24-brand@example.com');
insert into public.platform_admins (user_id) values ('c2400000-0000-0000-0000-000000000002');
insert into public.orgs (id, type, name, slug) values
  ('d2400000-0000-0000-0000-0000000000f1', 'factory', 'P24 Lakeside Garments', 'pgtap24-nonumber'),
  ('d2400000-0000-0000-0000-0000000000f2', 'factory', 'P24 Anadolu Tekstil', 'pgtap24-tr'),
  ('d2400000-0000-0000-0000-0000000000f3', 'factory', 'P24 Staff Own Mill', 'pgtap24-own'),
  ('d2400000-0000-0000-0000-0000000000b1', 'brand', 'P24 Brand', 'pgtap24-brand');
insert into public.org_members (org_id, user_id, role) values
  ('d2400000-0000-0000-0000-0000000000f1', 'c2400000-0000-0000-0000-000000000003', 'owner'),
  ('d2400000-0000-0000-0000-0000000000f3', 'c2400000-0000-0000-0000-000000000002', 'owner'),
  ('d2400000-0000-0000-0000-0000000000b1', 'c2400000-0000-0000-0000-000000000004', 'owner');
insert into public.factory_profiles (org_id, legal_name, country_code) values
  ('d2400000-0000-0000-0000-0000000000f1', 'P24 Lakeside Garments Co., Ltd.', 'CN'),
  ('d2400000-0000-0000-0000-0000000000f2', 'P24 Anadolu Tekstil Ltd. Şti.', 'TR'),
  ('d2400000-0000-0000-0000-0000000000f3', 'P24 Staff Own Mill Lda', 'PT');
insert into public.company_registrations (org_id, country_code, number) values
  ('d2400000-0000-0000-0000-0000000000f2', 'TR', '9123456712');
insert into public.factory_certifications (id, org_id, term_id)
select 'e2400000-0000-0000-0000-000000000001', 'd2400000-0000-0000-0000-0000000000f2', t.id
  from public.taxonomy_terms t where t.kind = 'certification' and t.slug = 'gots';
insert into storage.objects (bucket_id, name) values
  ('org-private', '5aff0000-0000-4000-8000-000000000001/d2400000-0000-0000-0000-0000000000f2/shot.png');

-- Nobody but staff ----------------------------------------------------------------
set local role anon;
select throws_ok($$select public.admin_save_registry_check('d2400000-0000-0000-0000-0000000000f2', 'GİB', 'gib', 'found')$$, '42501', null, 'signed out: no registry save');
reset role;
set local request.jwt.claims = '{"sub":"c2400000-0000-0000-0000-000000000003","role":"authenticated"}';
set local role authenticated;
select throws_ok($$select public.admin_save_registry_check('d2400000-0000-0000-0000-0000000000f1', 'GSXT', 'gsxt', 'found')$$, '42501', null, 'the company cannot record its own check');
select throws_ok($$select public.admin_update_company_profile('d2400000-0000-0000-0000-0000000000f1', 'trading_company')$$, '42501', null, 'nor change its type through the staff function');
select throws_ok($$select public.admin_review_changes('d2400000-0000-0000-0000-0000000000f1')$$, '42501', null, 'nor read the review history');
select throws_ok($$select * from public.org_review_changes$$, '42501', null, 'the history table is unreadable');
reset role;
set local request.jwt.claims = '{"sub":"c2400000-0000-0000-0000-000000000004","role":"authenticated"}';
set local role authenticated;
select throws_ok($$select public.admin_save_certificate_check('d2400000-0000-0000-0000-0000000000f2', 'e2400000-0000-0000-0000-000000000001', 'GOTS', 'found')$$, '42501', null, 'a brand cannot record a certificate check');
select throws_ok($$select public.admin_update_company_profile('d2400000-0000-0000-0000-0000000000f2', null, 'Somewhere')$$, '42501', null, 'nor edit a factory''s address');
reset role;
set local request.jwt.claims = '{"sub":"c2400000-0000-0000-0000-000000000002","role":"authenticated"}';
set local role authenticated;
select throws_ok($$select public.admin_save_registry_check('d2400000-0000-0000-0000-0000000000f3', 'VIES', 'vies', 'found')$$, '42501', null, 'staff cannot check a company they belong to');
select throws_ok($$select public.admin_update_company_profile('d2400000-0000-0000-0000-0000000000f3', 'trading_company')$$, '42501', null, 'nor change its type');
reset role;

-- The stuck save: no registration row, staff record Found ---------------------------
set local request.jwt.claims = '{"sub":"c2400000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select lives_ok($$select public.admin_record_registry_result('d2400000-0000-0000-0000-0000000000f1', 'gsxt', 'found', null, 'P24 Lakeside Garments Co., Ltd.')$$,
  'staff record Found for a company with no registration number yet');
reset role;

select is((select count(*)::int from public.registry_checks where org_id = 'd2400000-0000-0000-0000-0000000000f1' and not automatic), 1,
  'the check was stored');
select isnt((public.current_registry_check('d2400000-0000-0000-0000-0000000000f1')).id, null,
  'and it is the current check: the page shows it (was: saved and never shown)');
select isnt(public.registry_approval_problem('d2400000-0000-0000-0000-0000000000f1'), 'no_check',
  'and Approve no longer says a registry check is missing');

-- The form's rules ---------------------------------------------------------------
set local request.jwt.claims = '{"sub":"c2400000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select throws_ok($$select public.admin_save_registry_check('d2400000-0000-0000-0000-0000000000f2', '', 'gib', 'found')$$, '22023', 'say where you checked', 'where is required');
select throws_ok($$select public.admin_save_registry_check('d2400000-0000-0000-0000-0000000000f2', 'GİB', 'gib', 'not_found')$$, '22023', 'add a note', 'Not found needs a note');
select throws_ok($$select public.admin_save_registry_check('d2400000-0000-0000-0000-0000000000f2', 'GİB', 'gib', 'found', '{}', null, null,
  '[{"path":"5aff0000-0000-4000-8000-000000000001/d2400000-0000-0000-0000-0000000000f1/x.png"}]')$$, '22023', 'file not found', 'a proof file must be this company''s');
select lives_ok($$select public.admin_save_registry_check('d2400000-0000-0000-0000-0000000000f2', 'GİB', 'gib', 'not_found', '{}', 'No taxpayer with that number')$$, 'Not found with a note saves');
reset role;
select is(public.registry_approval_problem('d2400000-0000-0000-0000-0000000000f2'), 'no_check', 'Not found still blocks Approve');
set local role authenticated;
select lives_ok($$select public.admin_save_registry_check('d2400000-0000-0000-0000-0000000000f2', 'e-Devlet', 'edevlet', 'could_not_check', '{}', 'Site down all day')$$, 'Couldn''t check with a note saves');
reset role;
select is(public.registry_approval_problem('d2400000-0000-0000-0000-0000000000f2'), null, 'Couldn''t check with a note: staff judgement, Approve open');
set local role authenticated;
select lives_ok($$select public.admin_save_registry_check('d2400000-0000-0000-0000-0000000000f2', 'GİB', 'gib', 'found',
  '{"name":"Anadolu Örme Sanayi A.Ş.","number":"9123456712","address":"Bursa"}', null, 'https://example.com/x',
  '[{"path":"5aff0000-0000-4000-8000-000000000001/d2400000-0000-0000-0000-0000000000f2/shot.png","name":"shot.png","type":"image/png"}]')$$,
  'Found with another name saves, no reason asked');
reset role;
select is(public.registry_approval_problem('d2400000-0000-0000-0000-0000000000f2'), null, 'Found with a difference can be approved');
select is((select jsonb_array_length(details -> 'proof') from public.current_registry_check('d2400000-0000-0000-0000-0000000000f2')), 1, 'the proof file is kept on the check');
select is((select details ->> 'number' from public.current_registry_check('d2400000-0000-0000-0000-0000000000f2')), '9123456712', 'and the number the site shows');

-- Certificates, type and address ----------------------------------------------------
set local role authenticated;
select lives_ok($$select public.admin_save_certificate_check('d2400000-0000-0000-0000-0000000000f2', 'e2400000-0000-0000-0000-000000000001', 'Textile Exchange', 'expired', '{"number":"CU1234"}')$$, 'Expired saves without a note');
select lives_ok($$select public.admin_update_company_profile('d2400000-0000-0000-0000-0000000000f2', 'trading_company', 'No. 8 Organize Sanayi, Nilüfer, Bursa, Türkiye')$$, 'staff change type and address');
reset role;
select is((select vendor_kind::text from public.factory_profiles where org_id = 'd2400000-0000-0000-0000-0000000000f2'), 'trading_company', 'the type changed');
select is((select address from public.factory_production_addresses where org_id = 'd2400000-0000-0000-0000-0000000000f2'), 'No. 8 Organize Sanayi, Nilüfer, Bursa, Türkiye', 'the address changed');
select is((select body from public.notifications where org_id = 'd2400000-0000-0000-0000-0000000000f2' and kind = 'profile_updated'),
  'We updated your company type to Trading company. We updated your company address.', 'the company is told once, both changes named');
select is((select count(*)::int from public.org_review_changes where org_id = 'd2400000-0000-0000-0000-0000000000f2'), 6, 'every save is in the history');

select * from finish();
rollback;
