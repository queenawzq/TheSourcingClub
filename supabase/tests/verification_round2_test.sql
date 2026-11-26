-- Verification, second round (20261126100000, 20261126100100, 20261126100200):
-- labelled registration numbers, the licence reading compared live, the queue
-- and the finished-signup guard, and staff editing a company's name, legal
-- name, country and website. Fixtures prefixed pgtap-r2-; every count filters on fixture ids.
begin;
create extension if not exists pgtap with schema extensions;
select plan(70);

-- Registration numbers: the same results as check-registration-number.mjs --------
select is(public.normalise_registration_number('PT', 'NIF 519211596'), '519211596', 'NIF label dropped');
select is(public.normalise_registration_number('PT', 'NIPC: 519211596'), '519211596', 'NIPC: label dropped');
select is(public.normalise_registration_number('PT', 'PT 519 211 596'), '519211596', 'PT prefix and spaces dropped');
select is(public.normalise_registration_number('PT', 'pt519211596'), '519211596', 'lower-case pt prefix dropped');
select is(public.normalise_registration_number('PT', 'nif:519211596'), '519211596', 'label with a colon and no space');
select is(public.normalise_registration_number('PT', 'N.º 519 211 596'), '519211596', 'N.º label dropped');
select is(public.normalise_registration_number('CN', '统一社会信用代码：91330100MA2B7C4D3F'), '91330100MA2B7C4D3F', 'Chinese label and full-width colon dropped');
select is(public.normalise_registration_number('CN', '统一社会信用代码 91330100MA2B7C4D3F'), '91330100MA2B7C4D3F', 'Chinese label and a space dropped');
select is(public.normalise_registration_number('TR', 'VKN 4837261591'), '4837261591', 'VKN label dropped');
select is(public.normalise_registration_number('TR', 'Vergi No: 4837261591'), '4837261591', 'Vergi No: label dropped');
select is(public.normalise_registration_number(null, 'No: 12345'), '12345', 'No: label dropped anywhere');
select is(public.normalise_registration_number('GB', 'NO12345'), 'NO12345', 'a number that starts with a label''s letters keeps them');
select is(public.registration_number_problem('PT', 'NIF 519211596'), null, 'a labelled valid number passes');
select is(public.registration_number_problem('PT', '51921159'), 'format', 'eight digits is the wrong format');
select is(public.registration_number_format_text('PT'), 'A Portuguese company number has 9 digits, e.g. 519211596', 'the expected format, said');
select is(public.registration_number_format_text('GB'), null, 'no sentence where there is no rule');

-- Names: legal form and every space ignored ------------------------------------
select ok(public.company_names_match('Hellstitch Lda', 'HELL STITCH - UNIPESSOAL LDA'), 'a trading name with the spaces and legal form ignored');
select ok(public.company_names_match('Acme Textiles B.V.', 'ACME TEXTILES'), 'B.V. is a legal form');
select ok(public.company_names_match('Foo Pvt. Ltd.', 'FOO PRIVATE LIMITED'), 'Pvt. Ltd. and Private Limited');
select ok(not public.company_names_match('Hellstitch Lda', 'Riverbend Knit Ltd'), 'two different companies still differ');
select ok(not public.company_names_match('Lda', 'Ltd'), 'nothing left is no match');

-- Fixtures ----------------------------------------------------------------------
insert into auth.users (id, email) values
  ('c2611260-0000-0000-0000-000000000001', 'pgtap-r2-admin@example.com'),
  ('c2611260-0000-0000-0000-000000000002', 'pgtap-r2-factory@example.com'),
  ('c2611260-0000-0000-0000-000000000003', 'pgtap-r2-brand@example.com'),
  ('c2611260-0000-0000-0000-000000000004', 'pgtap-r2-trader@example.com');
insert into public.platform_admins (user_id) values ('c2611260-0000-0000-0000-000000000001');
insert into public.orgs (id, type, name, slug) values
  ('d2611260-0000-0000-0000-0000000000f1', 'factory', 'R2 Unsigned Mill', 'pgtap-r2-unsigned'),
  ('d2611260-0000-0000-0000-0000000000f2', 'factory', 'R2 Hellstitch', 'pgtap-r2-hellstitch'),
  ('d2611260-0000-0000-0000-0000000000f3', 'factory', 'R2 Upload Only', 'pgtap-r2-upload-only'),
  ('d2611260-0000-0000-0000-0000000000b1', 'brand', 'R2 Brand', 'pgtap-r2-brand'),
  ('d2611260-0000-0000-0000-0000000000a1', 'factory', 'R2 Trader', 'pgtap-r2-trader');
insert into public.org_members (org_id, user_id, role) values
  ('d2611260-0000-0000-0000-0000000000f1', 'c2611260-0000-0000-0000-000000000002', 'owner'),
  ('d2611260-0000-0000-0000-0000000000b1', 'c2611260-0000-0000-0000-000000000003', 'owner'),
  ('d2611260-0000-0000-0000-0000000000a1', 'c2611260-0000-0000-0000-000000000004', 'owner');
insert into public.factory_profiles (org_id, legal_name, country_code, location, website_url, onboarding_completed_at) values
  ('d2611260-0000-0000-0000-0000000000f1', null, 'PT', 'Porto, Portugal', null, null),
  ('d2611260-0000-0000-0000-0000000000f2', 'Hellstitch Lda', 'PT', 'Barcelos, Portugal', 'https://hellstitch.example', now()),
  ('d2611260-0000-0000-0000-0000000000f3', null, 'PT', 'Braga, Portugal', null, null);
insert into public.factory_profiles (org_id, vendor_kind, country_code) values
  ('d2611260-0000-0000-0000-0000000000a1', 'trading_company', 'TR');
insert into public.brand_profiles (org_id, hq_location, onboarding_completed_at) values
  ('d2611260-0000-0000-0000-0000000000b1', 'London, United Kingdom', null);
insert into public.documents (id, org_id, kind, bucket, storage_path, file_name, mime_type) values
  ('a2611260-0000-0000-0000-000000000002', 'd2611260-0000-0000-0000-0000000000f2', 'business_registration', 'org-private',
   'd2611260-0000-0000-0000-0000000000f2/business_registration/cert.png', 'cert.png', 'image/png'),
  ('a2611260-0000-0000-0000-000000000003', 'd2611260-0000-0000-0000-0000000000f3', 'business_registration', 'org-private',
   'd2611260-0000-0000-0000-0000000000f3/business_registration/cert.png', 'cert.png', 'image/png');
insert into public.company_registrations (org_id, country_code, number) values
  ('d2611260-0000-0000-0000-0000000000f2', 'PT', '519211596');
-- Read when the company had another number, and with the licence's trading
-- name; the stored differences are what the old rule saved.
insert into public.verification_signals (org_id, kind, subject_id, result, details, automatic) values
  ('d2611260-0000-0000-0000-0000000000f2', 'document_reading', 'a2611260-0000-0000-0000-000000000002', 'differs',
   '{"numberAtReading":"501964843","extracted":{"legalName":"HELL STITCH - UNIPESSOAL LDA","registrationNumber":"NIF 519211596"},
     "differences":[{"field":"name","document":"HELL STITCH - UNIPESSOAL LDA","typed":"Hellstitch Lda"}]}', true);

-- The queue lists only companies that finished signup -----------------------------
set local request.jwt.claims = '{"sub":"c2611260-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select is((select count(*)::int from public.admin_verification_queue() q where q.org_id::text like 'd2611260-%'), 1,
  'only the finished company is in the queue');
select ok(not exists (select 1 from public.admin_verification_queue() q where q.org_id = 'd2611260-0000-0000-0000-0000000000f3'),
  'an upload alone no longer lists a company');
select ok(not exists (select 1 from public.admin_verification_queue() q where q.org_id = 'd2611260-0000-0000-0000-0000000000b1'),
  'nor a brand that has not finished signup');

reset role;

-- The licence reading, compared live --------------------------------------------
select is(public.registry_reading_differs('d2611260-0000-0000-0000-0000000000f2'), null,
  'the licence''s trading name and labelled number agree with the company: no difference, whatever number it was read on');
update public.company_registrations set number = '501964843' where org_id = 'd2611260-0000-0000-0000-0000000000f2';
select is(public.registry_reading_differs('d2611260-0000-0000-0000-0000000000f2') -> 'differences' -> 0 ->> 'field', 'number',
  'a number changed to another one differs at once');
update public.company_registrations set number = '519211596' where org_id = 'd2611260-0000-0000-0000-0000000000f2';
select is(public.registry_reading_differs('d2611260-0000-0000-0000-0000000000f2'), null, 'and corrected, it settles at once');
update public.factory_profiles set legal_name = 'Riverbend Knit Ltd' where org_id = 'd2611260-0000-0000-0000-0000000000f2';
select is(public.registry_reading_differs('d2611260-0000-0000-0000-0000000000f2') -> 'differences' -> 0 ->> 'field', 'name',
  'another company''s name differs');
select is(public.registry_approval_problem('d2611260-0000-0000-0000-0000000000f2'), 'no_check', 'approval is still held (no check yet)');
update public.factory_profiles set legal_name = 'Hellstitch Lda' where org_id = 'd2611260-0000-0000-0000-0000000000f2';

-- Signup can't be marked finished without the terms -------------------------------
set local request.jwt.claims = '{"sub":"c2611260-0000-0000-0000-000000000002","role":"authenticated"}';
set local role authenticated;
select throws_ok($$update public.factory_profiles set onboarding_completed_at = now() where org_id = 'd2611260-0000-0000-0000-0000000000f1'$$,
  '22023', 'Sign the terms to finish signing up', 'a factory that has not signed cannot finish signup');
reset role;
select is((select onboarding_completed_at from public.factory_profiles where org_id = 'd2611260-0000-0000-0000-0000000000f1'), null, 'nothing was saved');
set local request.jwt.claims = '{"sub":"c2611260-0000-0000-0000-000000000003","role":"authenticated"}';
set local role authenticated;
select throws_ok($$update public.brand_profiles set onboarding_completed_at = now() where org_id = 'd2611260-0000-0000-0000-0000000000b1'$$,
  '22023', null, 'nor a brand');
reset role;
-- A brand that signed a vendor's terms has still not signed its own.
insert into public.terms_acceptances (org_id, terms_version, signature, accepted_by, legal_document_id)
select 'd2611260-0000-0000-0000-0000000000b1', 'terms_factory v1', 'R2 Brand', 'c2611260-0000-0000-0000-000000000003', d.id
  from public.legal_documents d where d.kind = 'terms_factory' order by d.version desc limit 1;
set local role authenticated;
select throws_ok($$update public.brand_profiles set onboarding_completed_at = now() where org_id = 'd2611260-0000-0000-0000-0000000000b1'$$,
  '22023', null, 'a brand needs the brand terms');
reset role;
insert into public.terms_acceptances (org_id, terms_version, signature, accepted_by, legal_document_id)
select 'd2611260-0000-0000-0000-0000000000b1', 'terms_brand v1', 'R2 Brand', 'c2611260-0000-0000-0000-000000000003', d.id
  from public.legal_documents d where d.kind = 'terms_brand' order by d.version desc limit 1;
set local role authenticated;
select lives_ok($$update public.brand_profiles set onboarding_completed_at = now() where org_id = 'd2611260-0000-0000-0000-0000000000b1'$$,
  'signed: the brand finishes signup');
reset role;
insert into public.terms_acceptances (org_id, terms_version, signature, accepted_by, legal_document_id)
select 'd2611260-0000-0000-0000-0000000000a1', 'terms_trading v1', 'R2 Trader', 'c2611260-0000-0000-0000-000000000004', d.id
  from public.legal_documents d where d.kind = 'terms_trading' order by d.version desc limit 1;
set local request.jwt.claims = '{"sub":"c2611260-0000-0000-0000-000000000004","role":"authenticated"}';
set local role authenticated;
select lives_ok($$update public.factory_profiles set onboarding_completed_at = now() where org_id = 'd2611260-0000-0000-0000-0000000000a1'$$,
  'a trading company that signed the trading terms finishes signup');
reset role;
select lives_ok($$update public.factory_profiles set onboarding_completed_at = now() where org_id = 'd2611260-0000-0000-0000-0000000000f3'$$,
  'the database owner (seed, fixtures, server code) is not checked');
update public.factory_profiles set onboarding_completed_at = null where org_id = 'd2611260-0000-0000-0000-0000000000f3';

-- admin_update_company_profile: staff only, refused before any read ----------------
set local role anon;
select throws_ok($$select public.admin_update_company_profile('d2611260-0000-0000-0000-0000000000f2', company_name => 'X')$$,
  '42501', null, 'signed out: refused');
reset role;
set local request.jwt.claims = '{"sub":"c2611260-0000-0000-0000-000000000002","role":"authenticated"}';
set local role authenticated;
select throws_ok($$select public.admin_update_company_profile('d2611260-0000-0000-0000-0000000000f2', company_name => 'X')$$,
  '42501', null, 'a company cannot rename another');
select throws_ok($$select public.admin_update_company_profile('d2611260-0000-0000-0000-0000000000f1', company_name => 'X')$$,
  '42501', null, 'nor itself');
select throws_ok($$select public.admin_update_company_profile('d2611260-0000-0000-0000-0000000000ff', company_name => 'X')$$,
  '42501', null, 'and a missing company is the same refusal (no existence leak)');
reset role;
select is((select name from public.orgs where id = 'd2611260-0000-0000-0000-0000000000f2'), 'R2 Hellstitch', 'nothing changed');

set local request.jwt.claims = '{"sub":"c2611260-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select throws_ok($$select public.admin_update_company_profile('d2611260-0000-0000-0000-0000000000f2', company_name => '  ')$$,
  '22023', 'Enter the company name', 'an empty name is refused');
select throws_ok($$select public.admin_update_company_profile('d2611260-0000-0000-0000-0000000000f2', country => 'Atlantis')$$,
  '22023', 'Choose a country from the list', 'a country not on the list is refused');
select throws_ok($$select public.admin_update_company_profile('d2611260-0000-0000-0000-0000000000b1', vendor_kind => 'trading_company')$$,
  '22023', null, 'a brand has no vendor type');
select lives_ok($$select public.admin_update_company_profile('d2611260-0000-0000-0000-0000000000f2',
  company_name => 'R2 Hell Stitch', country => 'ES', website => 'https://hellstitch.example/new')$$, 'staff change a factory''s name, country and website');
select lives_ok($$select public.admin_update_company_profile('d2611260-0000-0000-0000-0000000000b1',
  company_name => 'R2 Brand Studio', country => 'Portugal', website => 'brand.example')$$, 'and a brand''s');
select lives_ok($$select public.admin_update_company_profile('d2611260-0000-0000-0000-0000000000b1', company_name => 'R2 Brand Studio')$$,
  'the same name again changes nothing');
reset role;

select is((select name from public.orgs where id = 'd2611260-0000-0000-0000-0000000000f2'), 'R2 Hell Stitch', 'the name is saved');
select is((select country_code || ' ' || location from public.factory_profiles where org_id = 'd2611260-0000-0000-0000-0000000000f2'),
  'ES Barcelos, Spain', 'a factory''s country code and the location''s country follow');
select is((select hq_location || ' ' || website_url from public.brand_profiles where org_id = 'd2611260-0000-0000-0000-0000000000b1'),
  'London, Portugal https://brand.example', 'a brand''s location and website (given https://, M1)');
select is((select array_agg(kind order by kind) from public.org_review_changes where org_id = 'd2611260-0000-0000-0000-0000000000f2'),
  array['company_name', 'country', 'website'], 'one history line per changed field');
select is((select details from public.org_review_changes where org_id = 'd2611260-0000-0000-0000-0000000000f2' and kind = 'company_name'),
  '{"from":"R2 Hellstitch","to":"R2 Hell Stitch"}'::jsonb, 'the history says from and to');
select is((select changed_by from public.org_review_changes where org_id = 'd2611260-0000-0000-0000-0000000000f2' and kind = 'website'),
  'c2611260-0000-0000-0000-000000000001'::uuid, 'and who');
select is((select count(*)::int from public.org_review_changes where org_id = 'd2611260-0000-0000-0000-0000000000b1'), 3,
  'the brand''s three, and none for the unchanged name');
select is((select count(*)::int from public.notifications where org_id = 'd2611260-0000-0000-0000-0000000000f2' and kind = 'profile_updated'), 1,
  'the factory gets one notice');
select is((select title from public.notifications where org_id = 'd2611260-0000-0000-0000-0000000000b1' and kind = 'profile_updated'),
  'Your company profile was updated', 'the brand too, in the existing words, once');

-- The legal name (20261126100200): staff only, edited like the others; the checks read it ----
set local request.jwt.claims = '{"sub":"c2611260-0000-0000-0000-000000000002","role":"authenticated"}';
set local role authenticated;
select throws_ok($$select public.admin_update_company_profile('d2611260-0000-0000-0000-0000000000f2', legal_name => 'X Lda')$$,
  '42501', null, 'a company cannot change another''s legal name');
select throws_ok($$select public.admin_update_company_profile('d2611260-0000-0000-0000-0000000000f1', legal_name => 'X Lda')$$,
  '42501', null, 'nor its own');
reset role;
select is(public.company_title('d2611260-0000-0000-0000-0000000000f2'), 'Hellstitch Lda', 'the checks compare the legal name');

set local request.jwt.claims = '{"sub":"c2611260-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select lives_ok($$select public.admin_update_company_profile('d2611260-0000-0000-0000-0000000000f2', legal_name => '  Hell Stitch Unipessoal Lda ')$$,
  'staff change a factory''s legal name');
reset role;
select is((select legal_name from public.factory_profiles where org_id = 'd2611260-0000-0000-0000-0000000000f2'),
  'Hell Stitch Unipessoal Lda', 'the legal name is saved, trimmed');
select is((select details from public.org_review_changes where org_id = 'd2611260-0000-0000-0000-0000000000f2' and kind = 'legal_name'),
  '{"from":"Hellstitch Lda","to":"Hell Stitch Unipessoal Lda"}'::jsonb, 'one history line, from and to');
select is((select count(*)::int from public.notifications where org_id = 'd2611260-0000-0000-0000-0000000000f2' and kind = 'profile_updated'
            and title = 'Your company profile was updated' and body = 'We updated your legal name.'), 1, 'the company is told, once');
select is(public.company_title('d2611260-0000-0000-0000-0000000000f2'), 'Hell Stitch Unipessoal Lda', 'and the checks use the new legal name');

set local role authenticated;
select lives_ok($$select public.admin_update_company_profile('d2611260-0000-0000-0000-0000000000f2', legal_name => '')$$,
  'an empty legal name clears it');
select lives_ok($$select public.admin_update_company_profile('d2611260-0000-0000-0000-0000000000b1', legal_name => 'R2 Brand Studio Limited')$$,
  'staff set a brand''s legal name');
reset role;
select is((select legal_name from public.factory_profiles where org_id = 'd2611260-0000-0000-0000-0000000000f2'), null, 'the legal name is cleared');
select is(public.company_title('d2611260-0000-0000-0000-0000000000f2'), 'R2 Hell Stitch', 'and the checks fall back to the company name');
select is((select count(*)::int from public.org_review_changes where org_id = 'd2611260-0000-0000-0000-0000000000f2' and kind = 'legal_name'), 2,
  'clearing it is a history line too');
select is(public.company_title('d2611260-0000-0000-0000-0000000000b1'), 'R2 Brand Studio Limited', 'a brand''s checks compare its legal name');

select * from finish();
rollback;
