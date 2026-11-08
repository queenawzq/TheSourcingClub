-- Verification v2 (20261108700000): names compared, duplicate numbers,
-- Turkey's letter number, signals staff record, and what a brand learns.
-- Fixtures prefixed pgtap87-; every count filters on its own ids.
begin;
create extension if not exists pgtap with schema extensions;
select plan(56);

insert into auth.users (id, email) values
  ('c8700000-0000-0000-0000-000000000001', 'p87-admin@example.com'),
  ('c8700000-0000-0000-0000-000000000002', 'p87-pt@example.com'),
  ('c8700000-0000-0000-0000-000000000003', 'p87-brand@example.com'),
  ('c8700000-0000-0000-0000-000000000004', 'p87-tr@example.com'),
  ('c8700000-0000-0000-0000-000000000005', 'p87-copy@example.com');
insert into public.platform_admins (user_id) values ('c8700000-0000-0000-0000-000000000001');
insert into public.orgs (id, type, name, slug) values
  ('d8700000-0000-0000-0000-0000000000f1', 'factory', 'Fiação do Vale, Lda.', 'pgtap87-pt'),
  ('d8700000-0000-0000-0000-0000000000f2', 'factory', 'Örme Tekstil', 'pgtap87-tr'),
  ('d8700000-0000-0000-0000-0000000000f3', 'factory', 'Copy Knit', 'pgtap87-copy'),
  ('d8700000-0000-0000-0000-0000000000b1', 'brand', 'P87 Brand', 'pgtap87-brand');
insert into public.org_members (org_id, user_id, role) values
  ('d8700000-0000-0000-0000-0000000000f1', 'c8700000-0000-0000-0000-000000000002', 'owner'),
  ('d8700000-0000-0000-0000-0000000000f2', 'c8700000-0000-0000-0000-000000000004', 'owner'),
  ('d8700000-0000-0000-0000-0000000000f3', 'c8700000-0000-0000-0000-000000000005', 'owner'),
  ('d8700000-0000-0000-0000-0000000000b1', 'c8700000-0000-0000-0000-000000000003', 'owner');
insert into public.factory_profiles (org_id, legal_name, published_at) values
  ('d8700000-0000-0000-0000-0000000000f1', 'Fiação do Vale, Lda.', now()),
  ('d8700000-0000-0000-0000-0000000000f2', 'ÖRME TEKSTİL SANAYİ VE TİCARET LİMİTED ŞİRKETİ', now()),
  ('d8700000-0000-0000-0000-0000000000f3', null, now());

-- Names ---------------------------------------------------------------------
select is(public.company_name_key('EDP, S.A.'), 'edp', 'S.A. and punctuation dropped');
select is(public.company_name_key('Fiação do Vale, Lda.'), 'fiacao do vale', 'accents and Lda dropped');
select is(public.company_name_key('ÖRME TEKSTİL SANAYİ VE TİCARET LİMİTED ŞİRKETİ'), 'orme tekstil', 'Turkish capitals and legal form');
select is(public.company_name_key('宁波织造有限公司'), '宁波织造', 'Chinese legal form');
select ok(public.company_names_match('FIACAO DO VALE LDA', 'Fiação do Vale, Lda.'), 'VIES capitals match the title');
select ok(not public.company_names_match('EDP, S.A.', 'Fiação do Vale, Lda.'), 'another company does not');
select ok(not public.company_names_match('', ''), 'two blanks are not a match');

-- Turkey's letter number ------------------------------------------------------
set local request.jwt.claims = '{"sub":"c8700000-0000-0000-0000-000000000004","role":"authenticated"}';
set local role authenticated;
select throws_ok($$select public.save_company_registration('d8700000-0000-0000-0000-0000000000f2', 'TR', '4827361596')$$,
  '22023', 'registration letter number: missing', 'a Turkish VKN needs the letter number');
select throws_ok($$select public.save_company_registration('d8700000-0000-0000-0000-0000000000f2', 'TR', '4827361596', null, 'ABC123')$$,
  '22023', 'registration letter number: format', 'and it is 14 characters');
select lives_ok($$select public.save_company_registration('d8700000-0000-0000-0000-0000000000f2', 'TR', '4827361596', null, 'ab12 cd34 ef56 78')$$,
  'spaces dropped, 14 characters saved');
select is((select registration_letter_number from public.company_registrations where org_id = 'd8700000-0000-0000-0000-0000000000f2'),
  'AB12CD34EF5678', 'stored upper-case without spaces');
select lives_ok($$select public.save_company_registration('d8700000-0000-0000-0000-0000000000f2', 'TR', null, null, null, false, true)$$,
  'a sole proprietor gives no letter number');
select lives_ok($$select public.save_company_registration('d8700000-0000-0000-0000-0000000000f2', 'TR', '4827361596', null, 'AB12CD34EF5678')$$,
  'back to the company number');

-- Duplicate numbers: the factory is told yes or no, never which ---------------
reset role;
set local request.jwt.claims = '{"sub":"c8700000-0000-0000-0000-000000000005","role":"authenticated"}';
set local role authenticated;
select is(public.registration_in_use('d8700000-0000-0000-0000-0000000000f3'), false, 'no number, not in use');
select lives_ok($$select public.save_company_registration('d8700000-0000-0000-0000-0000000000f3', 'TR', '4827361596', null, 'ZZ12CD34EF5678')$$,
  'a second company saves the same VKN: not refused');
select is(public.registration_in_use('d8700000-0000-0000-0000-0000000000f3'), true, 'and is told it is in use');
select throws_ok($$select public.registration_in_use('d8700000-0000-0000-0000-0000000000f2')$$, '42501', null, 'but cannot ask about another company');

-- VIES names another company: found needs the confirmation ---------------------
reset role;
set local request.jwt.claims = '{"sub":"c8700000-0000-0000-0000-000000000002","role":"authenticated"}';
set local role authenticated;
select lives_ok($$select public.save_company_registration('d8700000-0000-0000-0000-0000000000f1', 'PT', '500697256')$$, 'the factory types a real company''s NIPC');
reset role;
select lives_ok($$select public.record_registry_check('d8700000-0000-0000-0000-0000000000f1', '500697256', 'vies', 'registered', '{"name":"EDP, S.A.","address":"LISBOA"}'::jsonb)$$, 'VIES names EDP');
update public.registry_checks set checked_at = checked_at - interval '2 minutes' where org_id = 'd8700000-0000-0000-0000-0000000000f1';
set local request.jwt.claims = '{"sub":"c8700000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select is(public.admin_registry_detail('d8700000-0000-0000-0000-0000000000f1') ->> 'nameDiffers', 'EDP, S.A.', 'staff are shown the other name');
select throws_ok($$select public.admin_record_registry_check('d8700000-0000-0000-0000-0000000000f1', 'vies', 'found', 'VIES: registered')$$,
  '22023', null, '"Found" is refused while VIES names another company');
select throws_ok($$select public.admin_record_registry_check('d8700000-0000-0000-0000-0000000000f1', 'document', 'found', 'Certidão shows the name')$$,
  '22023', null, 'on any source, not only VIES');
select throws_ok($$select public.admin_record_registry_check('d8700000-0000-0000-0000-0000000000f1', 'certidao', 'found', 'Shows a name', false, '{"name":"Someone Else Lda"}'::jsonb)$$,
  '22023', null, 'and when the name staff typed differs');
select lives_ok($$select public.admin_record_registry_check('d8700000-0000-0000-0000-0000000000f1', 'certidao', 'found', 'Group company: EDP owns the factory, per the certidão', false, '{"name":"EDP, S.A."}'::jsonb, true)$$,
  'staff confirm the difference with a note');
select is(public.admin_registry_detail('d8700000-0000-0000-0000-0000000000f1') ->> 'approvalProblem', null, 'then nothing stops approval');
reset role;
update public.factory_profiles set legal_name = 'Renamed Lda' where org_id = 'd8700000-0000-0000-0000-0000000000f1';
set local request.jwt.claims = '{"sub":"c8700000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select is(public.admin_registry_detail('d8700000-0000-0000-0000-0000000000f1') ->> 'approvalProblem', 'renamed', 'a rename afterwards opens the question again');
select throws_ok($$select public.admin_review_decision('d8700000-0000-0000-0000-0000000000f1', 'approved')$$,
  '22023', null, 'and the database refuses approval');

-- Duplicate: staff explain it, keyed to the number -----------------------------
select is(public.admin_registry_detail('d8700000-0000-0000-0000-0000000000f3') -> 'duplicates' -> 0 ->> 'name', 'ÖRME TEKSTİL SANAYİ VE TİCARET LİMİTED ŞİRKETİ', 'staff see which company shares it');
reset role;
-- staff found it on GİB (fixture), under its own name
set local request.jwt.claims = '{"sub":"c8700000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select lives_ok($$select public.admin_record_registry_check('d8700000-0000-0000-0000-0000000000f3', 'gib', 'found', 'GİB letter: Copy Knit', false, '{"name":"Copy Knit"}'::jsonb)$$, 'a found check on the copied number');
select is(public.admin_registry_detail('d8700000-0000-0000-0000-0000000000f3') ->> 'approvalProblem', 'duplicate', 'the duplicate still stops approval');
select throws_ok($$select public.admin_review_decision('d8700000-0000-0000-0000-0000000000f3', 'approved')$$, '22023', null, 'in the database too');
select throws_ok($$select public.admin_explain_duplicate('d8700000-0000-0000-0000-0000000000f3', '  ')$$, '22023', null, 'an explanation needs words');
select throws_ok($$select public.admin_explain_duplicate('d8700000-0000-0000-0000-0000000000f3', 'ok')$$, '22023', null, '"ok" explains nothing');
select lives_ok($$select public.admin_explain_duplicate('d8700000-0000-0000-0000-0000000000f3', 'Same owner, two sites')$$, 'staff explain it');
select is(public.admin_registry_detail('d8700000-0000-0000-0000-0000000000f3') ->> 'approvalProblem', null, 'then approval is open');

-- Signals ---------------------------------------------------------------------
reset role;
insert into public.documents (id, org_id, kind, bucket, storage_path, file_name, mime_type) values
  ('a8700000-0000-0000-0000-000000000001', 'd8700000-0000-0000-0000-0000000000f3', 'product_image', 'org-public', 'd8700000-0000-0000-0000-0000000000f3/floor.jpg', 'floor.jpg', 'image/jpeg');
insert into public.factory_certifications (id, org_id, term_id, status)
  select 'e8700000-0000-0000-0000-000000000001', 'd8700000-0000-0000-0000-0000000000f3', t.id, 'unverified'
    from public.taxonomy_terms t where t.kind = 'certification' and t.slug = 'gots';
update public.factory_profiles set verification_status = 'verified' where org_id = 'd8700000-0000-0000-0000-0000000000f3';
set local request.jwt.claims = '{"sub":"c8700000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select throws_ok($$select public.admin_record_signal('d8700000-0000-0000-0000-0000000000f3', 'photo', 'a8700000-0000-0000-0000-000000000001', 'found_elsewhere', 'On Alibaba')$$,
  '22023', null, 'a photo found elsewhere needs the link');
select lives_ok($$select public.admin_record_signal('d8700000-0000-0000-0000-0000000000f3', 'photo', 'a8700000-0000-0000-0000-000000000001', 'own', 'No match on Lens or TinEye')$$, 'staff record a photo');
select throws_ok($$select public.admin_record_signal('d8700000-0000-0000-0000-0000000000f1', 'photo', 'a8700000-0000-0000-0000-000000000001', 'own', 'x')$$,
  'P0002', null, 'a photo must be the company''s own');
select lives_ok($$select public.admin_record_signal('d8700000-0000-0000-0000-0000000000f3', 'certificate', 'e8700000-0000-0000-0000-000000000001', 'found', 'GOTS database lists it', '{"number":"CU 123456"}'::jsonb)$$, 'staff record a certificate');

-- What the brand learns, and whom it may invite -------------------------------
reset role;
set local request.jwt.claims = '{"sub":"c8700000-0000-0000-0000-000000000003","role":"authenticated"}';
set local role authenticated;
select is((select count(*)::int from public.factory_certificate_checks('d8700000-0000-0000-0000-0000000000f3')), 1, 'a brand learns the certificate was checked');
select throws_ok($$select public.admin_verification_signals('d8700000-0000-0000-0000-0000000000f3')$$, '42501', null, 'but reads no signal');
select is((public.factory_registry_fact('d8700000-0000-0000-0000-0000000000f3') ->> 'kind'), 'registry', 'GİB is an official registry');
reset role;
insert into public.rfqs (id, brand_org_id, title, status) values ('f8700000-0000-0000-0000-000000000001', 'd8700000-0000-0000-0000-0000000000b1', 'P87 request', 'draft');
set local request.jwt.claims = '{"sub":"c8700000-0000-0000-0000-000000000003","role":"authenticated"}';
set local role authenticated;
select throws_ok($$insert into public.rfq_invitations (rfq_id, factory_org_id) values ('f8700000-0000-0000-0000-000000000001', 'd8700000-0000-0000-0000-0000000000f1')$$,
  '42501', 'this vendor is not verified yet', 'a brand cannot invite a factory that is not verified');

-- Round 1: names in more scripts, the AI reading, renames, sole proprietors --
select is(public.company_name_key('Công ty TNHH Dệt May Sài Gòn'), 'det may sai gon', 'Vietnamese legal form and accents');
select ok(public.company_names_match('CÔNG TY TNHH DỆT MAY SÀI GÒN', 'Dệt May Sài Gòn Co., Ltd'), 'the same Vietnamese company, two ways');

reset role;
insert into public.documents (id, org_id, kind, bucket, storage_path, file_name, mime_type) values
  ('a8700000-0000-0000-0000-000000000002', 'd8700000-0000-0000-0000-0000000000f2', 'business_registration', 'org-private', 'd8700000-0000-0000-0000-0000000000f2/letter.png', 'letter.png', 'image/png');
select lives_ok($$select public.record_verification_signal('d8700000-0000-0000-0000-0000000000f2', 'document_reading', 'a8700000-0000-0000-0000-000000000002', 'differs',
  '{"numberAtReading":"4827361596","differences":[{"field":"number","document":"1111111111","typed":"4827361596"}]}'::jsonb, null)$$, 'the server records an AI reading that differs');
set local request.jwt.claims = '{"sub":"c8700000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select ok((public.admin_registry_detail('d8700000-0000-0000-0000-0000000000f2') -> 'readingDiffers') is not null, 'staff see what the document shows');
select throws_ok($$select public.admin_record_registry_check('d8700000-0000-0000-0000-0000000000f2', 'document', 'found', 'Letter shows the company')$$,
  '22023', null, '"found" is refused while the AI reading shows another number');
select lives_ok($$select public.admin_record_registry_check('d8700000-0000-0000-0000-0000000000f2', 'gib', 'found', 'GİB shows our VKN; the AI misread a smudged digit', false, '{}'::jsonb, true)$$,
  'staff confirm the difference with a note');
select is(public.admin_registry_detail('d8700000-0000-0000-0000-0000000000f2') ->> 'approvalProblem', 'duplicate', 'the reading no longer stops approval (the duplicate still does)');
select lives_ok($$select public.admin_explain_duplicate('d8700000-0000-0000-0000-0000000000f2', 'Same owner as Copy Knit, two sites')$$, 'explained');
select lives_ok($$select public.admin_review_decision('d8700000-0000-0000-0000-0000000000f2', 'approved')$$, 'approved');
reset role;
update public.orgs set name = 'Bosphorus Premium Knit' where id = 'd8700000-0000-0000-0000-0000000000f2';
set local request.jwt.claims = '{"sub":"c8700000-0000-0000-0000-000000000003","role":"authenticated"}';
set local role authenticated;
select is(public.factory_registry_fact('d8700000-0000-0000-0000-0000000000f2'), null, 'a rename after approval takes the brand''s fact away');
reset role;
set local request.jwt.claims = '{"sub":"c8700000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select is((select state from public.admin_registry_states() where org_id = 'd8700000-0000-0000-0000-0000000000f2'), 'lost', 'and staff see the check lost');
reset role;
update public.company_registrations set number = null, no_company_number = true where org_id = 'd8700000-0000-0000-0000-0000000000f2';
update public.orgs set name = 'Örme Tekstil' where id = 'd8700000-0000-0000-0000-0000000000f2';
set local request.jwt.claims = '{"sub":"c8700000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select lives_ok($$select public.admin_record_registry_check('d8700000-0000-0000-0000-0000000000f2', 'gib', 'found', 'Sole proprietor, letter seen')$$, 'a sole proprietor checked');
select is(public.factory_registry_fact('d8700000-0000-0000-0000-0000000000f2') ->> 'kind', 'document', 'a sole proprietor is never "Official registry"');

select * from finish();
rollback;
