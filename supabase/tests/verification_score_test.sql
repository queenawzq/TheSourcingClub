-- Verification score (20261112100000): the staff-only read, the registry
-- record form's four answers, and a reason on any sub-check, a certificate
-- included. Mostly negative: nobody but staff reads or writes, an unknown
-- company leaks nothing to a non-admin, staff in the company are refused,
-- and every approval block stays clearable from the new screen.
-- Fixtures prefixed pgtap12-; every count filters on its own ids.
begin;
create extension if not exists pgtap with schema extensions;
select plan(50);

insert into auth.users (id, email) values
  ('c1200000-0000-0000-0000-000000000001', 'p12-admin@example.com'),
  ('c1200000-0000-0000-0000-000000000002', 'p12-staff-member@example.com'),
  ('c1200000-0000-0000-0000-000000000003', 'p12-owner@example.com'),
  ('c1200000-0000-0000-0000-000000000004', 'p12-brand@example.com');
insert into public.platform_admins (user_id) values
  ('c1200000-0000-0000-0000-000000000001'),
  ('c1200000-0000-0000-0000-000000000002');
insert into public.orgs (id, type, name, slug) values
  ('d1200000-0000-0000-0000-0000000000f1', 'factory', 'P12 Tekstil', 'pgtap12-tr'),
  ('d1200000-0000-0000-0000-0000000000f2', 'factory', 'P12 Staff Own Mill', 'pgtap12-own'),
  ('d1200000-0000-0000-0000-0000000000f3', 'factory', 'P12 Renamed Knit', 'pgtap12-renamed'),
  ('d1200000-0000-0000-0000-0000000000f4', 'factory', 'P12 Trader', 'pgtap12-trader'),
  ('d1200000-0000-0000-0000-0000000000b1', 'brand', 'P12 Brand', 'pgtap12-brand');
insert into public.org_members (org_id, user_id, role) values
  ('d1200000-0000-0000-0000-0000000000f1', 'c1200000-0000-0000-0000-000000000003', 'owner'),
  ('d1200000-0000-0000-0000-0000000000f2', 'c1200000-0000-0000-0000-000000000002', 'owner'),
  ('d1200000-0000-0000-0000-0000000000b1', 'c1200000-0000-0000-0000-000000000004', 'owner');
insert into public.factory_profiles (org_id, legal_name, country_code) values
  ('d1200000-0000-0000-0000-0000000000f1', 'P12 Tekstil Ltd. Şti.', 'TR'),
  ('d1200000-0000-0000-0000-0000000000f2', 'P12 Staff Own Mill Lda', 'PT'),
  ('d1200000-0000-0000-0000-0000000000f3', 'P12 Renamed Knit Ltd. Şti.', 'TR'),
  ('d1200000-0000-0000-0000-0000000000f4', 'P12 Trader Ltd. Şti.', 'TR');
insert into public.company_registrations (org_id, country_code, number) values
  ('d1200000-0000-0000-0000-0000000000f1', 'TR', '9123456712'),
  ('d1200000-0000-0000-0000-0000000000f2', 'PT', '519999916'),
  ('d1200000-0000-0000-0000-0000000000f3', 'TR', '9123456720'),
  ('d1200000-0000-0000-0000-0000000000f4', 'TR', '9123456738');
insert into public.documents (id, org_id, kind, bucket, storage_path, file_name, mime_type) values
  ('a1200000-0000-0000-0000-000000000001', 'd1200000-0000-0000-0000-0000000000f1', 'business_registration', 'org-private', 'd1200000-0000-0000-0000-0000000000f1/plate.pdf', 'plate.pdf', 'application/pdf'),
  ('a1200000-0000-0000-0000-000000000004', 'd1200000-0000-0000-0000-0000000000f4', 'business_registration', 'org-private', 'd1200000-0000-0000-0000-0000000000f4/plate.pdf', 'plate.pdf', 'application/pdf'),
  ('a1200000-0000-0000-0000-000000000005', 'd1200000-0000-0000-0000-0000000000f1', 'certificate', 'org-private', 'd1200000-0000-0000-0000-0000000000f1/gots.pdf', 'gots.pdf', 'application/pdf');
insert into public.factory_certifications (id, org_id, term_id, document_id, expires_at)
select 'e1200000-0000-0000-0000-000000000001', 'd1200000-0000-0000-0000-0000000000f1', t.id, 'a1200000-0000-0000-0000-000000000005', '2020-01-31'
  from public.taxonomy_terms t where t.kind = 'certification' and t.slug = 'gots';
insert into public.factory_certifications (id, org_id, term_id)
select 'e1200000-0000-0000-0000-000000000004', 'd1200000-0000-0000-0000-0000000000f4', t.id
  from public.taxonomy_terms t where t.kind = 'certification' and t.slug = 'gots';

-- Nobody but staff ---------------------------------------------------------------
set local role anon;
select throws_ok($$select public.admin_verification_score_input('d1200000-0000-0000-0000-0000000000f1')$$, '42501', null, 'signed out: no score input');
reset role;

set local request.jwt.claims = '{"sub":"c1200000-0000-0000-0000-000000000003","role":"authenticated"}';
set local role authenticated;
select throws_ok($$select public.admin_verification_score_input('d1200000-0000-0000-0000-0000000000f1')$$, '42501', null, 'the company itself cannot read its score input');
select throws_ok($$select public.admin_verification_score_input('d1200000-0000-0000-0000-00000000dead')$$, '42501', null,
  'a non-admin asking about a company that does not exist is refused the same way: no existence leak');
select throws_ok($$select public.admin_record_registry_result('d1200000-0000-0000-0000-0000000000f1', 'gib', 'found')$$, '42501', null, 'the company cannot record its own registry check');
select throws_ok($$select public.admin_record_registry_result('d1200000-0000-0000-0000-00000000dead', 'gib', 'found')$$, '42501', null, 'nor about a company that does not exist');
select throws_ok($$select public.admin_check_reason('d1200000-0000-0000-0000-0000000000f1', 'photos', 'they are ours')$$, '42501', null, 'the company cannot give itself a reason');
select throws_ok($$select public.admin_check_reason('d1200000-0000-0000-0000-00000000dead', 'photos', 'x')$$, '42501', null, 'nor about a company that does not exist');
select throws_ok($$select * from public.verification_check_reasons$$, '42501', null, 'reasons stay unreadable');
select throws_ok($$select * from public.registry_checks$$, '42501', null, 'registry checks stay unreadable');
reset role;

set local request.jwt.claims = '{"sub":"c1200000-0000-0000-0000-000000000004","role":"authenticated"}';
set local role authenticated;
select throws_ok($$select public.admin_verification_score_input('d1200000-0000-0000-0000-0000000000f1')$$, '42501', null, 'a brand cannot read a factory''s score input');
select throws_ok($$select public.admin_record_registry_result('d1200000-0000-0000-0000-0000000000f1', 'gib', 'not_found', null, null, 'gone')$$, '42501', null, 'a brand cannot record a registry check');
select throws_ok($$select public.admin_check_reason('d1200000-0000-0000-0000-0000000000f1', 'certificate', 'x', 'e1200000-0000-0000-0000-000000000001')$$, '42501', null, 'a brand cannot give a reason');
reset role;

-- Staff who belong to the company --------------------------------------------------
set local request.jwt.claims = '{"sub":"c1200000-0000-0000-0000-000000000002","role":"authenticated"}';
set local role authenticated;
select throws_ok($$select public.admin_record_registry_result('d1200000-0000-0000-0000-0000000000f2', 'vies', 'found')$$, '42501', null, 'staff cannot record a check on their own company');
select throws_ok($$select public.admin_check_reason('d1200000-0000-0000-0000-0000000000f2', 'registry', 'it is fine')$$, '42501', null, 'nor give it a reason');
reset role;

-- Staff ------------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"c1200000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select ok((select public.admin_verification_score_input('d1200000-0000-0000-0000-0000000000f1') ?& array['detail', 'extra', 'rules', 'reasons', 'pending', 'profile']),
  'staff read every record the score needs in one call');
select throws_ok($$select public.admin_verification_score_input('d1200000-0000-0000-0000-00000000dead')$$, 'P0002', null, 'staff are told an unknown company is unknown');
select is((public.admin_verification_rules('d1200000-0000-0000-0000-0000000000f1') ->> 'approvalProblem'), 'no_check', 'nothing recorded: approval waits for a registry check');

-- The form's answers
select throws_ok($$select public.admin_record_registry_result('d1200000-0000-0000-0000-0000000000f1', 'gib', 'mismatch')$$, '22023', null, 'only the four answers');
select throws_ok($$select public.admin_record_registry_result('d1200000-0000-0000-0000-0000000000f1', 'gib', 'name_differs', null, 'Other Ltd')$$, '22023', null, 'Name differs needs a reason');
select throws_ok($$select public.admin_record_registry_result('d1200000-0000-0000-0000-0000000000f1', 'gib', 'found', repeat('x', 501))$$, '22023', null, 'a reference over 500 characters is refused');
select throws_ok($$select public.admin_record_registry_result('d1200000-0000-0000-0000-0000000000f1', 'GIB!', 'found')$$, '22023', null, 'an unknown source is refused, by the old rules');
select lives_ok($$select public.admin_record_registry_result('d1200000-0000-0000-0000-0000000000f1', 'gib', 'not_found')$$, 'Not found needs no note');
select is((public.admin_verification_rules('d1200000-0000-0000-0000-0000000000f1') ->> 'approvalProblem'), 'no_check', 'and does not open approval');
reset role;
-- A transaction has one now(): earlier checks are moved back so the next one is the current one.
update public.registry_checks set checked_at = checked_at - interval '1 hour' where org_id = 'd1200000-0000-0000-0000-0000000000f1';
set local request.jwt.claims = '{"sub":"c1200000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select lives_ok($$select public.admin_record_registry_result('d1200000-0000-0000-0000-0000000000f1', 'gib', 'found', 'https://dijital.gib.gov.tr/x', 'P12 Tekstil Ltd. Şti.')$$, 'Found');
select is((public.admin_verification_rules('d1200000-0000-0000-0000-0000000000f1') ->> 'approvalProblem'), null, 'Found opens approval');
reset role;
select is((select details ->> 'outcome' || ' ' || (details ->> 'reference') || ' ' || note from public.registry_checks
            where org_id = 'd1200000-0000-0000-0000-0000000000f1' order by checked_at desc, id limit 1),
  'found https://dijital.gib.gov.tr/x https://dijital.gib.gov.tr/x', 'the answer and the link are kept on the check');

-- Another source shows another name: Found is refused in words; Name differs + reason is the confirmation.
insert into public.registry_checks (org_id, country_code, number_checked, source, result, automatic, details, checked_at)
values ('d1200000-0000-0000-0000-0000000000f1', 'TR', '9123456712', 'gib', 'registered', true,
        '{"name":"Başka Şirket A.Ş."}', now() + interval '1 second');
set local request.jwt.claims = '{"sub":"c1200000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select is((public.admin_verification_rules('d1200000-0000-0000-0000-0000000000f1') ->> 'approvalProblem'), 'name_differs', 'a source naming another company blocks approval');
select throws_ok($$select public.admin_record_registry_result('d1200000-0000-0000-0000-0000000000f1', 'gib', 'found')$$, '22023',
  'Another source shows a different name or number: choose Name differs and say why', 'Found is refused, saying what to choose');
reset role;
-- A transaction has one now(): earlier checks are moved back so the next one is the current one.
update public.registry_checks set checked_at = checked_at - interval '1 hour' where org_id = 'd1200000-0000-0000-0000-0000000000f1';
set local request.jwt.claims = '{"sub":"c1200000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select lives_ok($$select public.admin_record_registry_result('d1200000-0000-0000-0000-0000000000f1', 'gib', 'name_differs', null, 'Başka Şirket A.Ş.', 'Sold its trading arm in 2024; GİB shows the old owner')$$,
  'Name differs with a reason');
select is((public.admin_verification_rules('d1200000-0000-0000-0000-0000000000f1') ->> 'approvalProblem'), null, 'the reason is the confirmation: approval opens');
reset role;
select is((select (details ->> 'outcome') || ' ' || (details ->> 'nameDiffersConfirmed') from public.registry_checks
            where org_id = 'd1200000-0000-0000-0000-0000000000f1' and not automatic order by checked_at desc limit 1),
  'name_differs true', 'recorded as Name differs, confirmed');

-- The licence read differs from what they typed (document_differs): cleared the same way.
insert into public.verification_signals (org_id, kind, subject_id, result, details, automatic, checked_at)
values ('d1200000-0000-0000-0000-0000000000f1', 'document_reading', 'a1200000-0000-0000-0000-000000000001', 'differs',
        '{"numberAtReading":"9123456712","differences":[{"field":"name","document":"P12 Dokuma","typed":"P12 Tekstil Ltd. Şti."}],"tradingScope":{"trading":false}}',
        true, now() + interval '2 seconds');
set local request.jwt.claims = '{"sub":"c1200000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select is((public.admin_verification_rules('d1200000-0000-0000-0000-0000000000f1') ->> 'approvalProblem'), 'document_differs', 'a reading that differs blocks approval');
reset role;
-- A transaction has one now(): earlier checks are moved back so the next one is the current one.
update public.registry_checks set checked_at = checked_at - interval '1 hour' where org_id = 'd1200000-0000-0000-0000-0000000000f1';
set local request.jwt.claims = '{"sub":"c1200000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select lives_ok($$select public.admin_record_registry_result('d1200000-0000-0000-0000-0000000000f1', 'gib', 'name_differs', null, 'P12 Tekstil Ltd. Şti.', 'The plate shows the old trade name; GİB has the current one')$$,
  'Name differs with a reason, the registry showing their own name');
select is((public.admin_verification_rules('d1200000-0000-0000-0000-0000000000f1') ->> 'approvalProblem'), null, 'clears the reading''s difference');

-- Renamed since the check: Update check clears it.
select lives_ok($$select public.admin_record_registry_result('d1200000-0000-0000-0000-0000000000f3', 'gib', 'found', null, 'P12 Renamed Knit Ltd. Şti.')$$, 'checked under the old name');
reset role;
update public.factory_profiles set legal_name = 'P12 Renamed Knit Toptan Ltd. Şti.' where org_id = 'd1200000-0000-0000-0000-0000000000f3';
set local request.jwt.claims = '{"sub":"c1200000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select is((public.admin_verification_rules('d1200000-0000-0000-0000-0000000000f3') ->> 'approvalProblem'), 'renamed', 'renamed since the check');
select is((public.admin_verification_score_input('d1200000-0000-0000-0000-0000000000f3') #>> '{detail,renamedSinceCheck}'), 'true', 'and the score input says so');
reset role;
-- A transaction has one now(): earlier checks are moved back so the next one is the current one.
update public.registry_checks set checked_at = checked_at - interval '1 hour' where org_id = 'd1200000-0000-0000-0000-0000000000f3';
set local request.jwt.claims = '{"sub":"c1200000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select lives_ok($$select public.admin_record_registry_result('d1200000-0000-0000-0000-0000000000f3', 'gib', 'found', null, 'P12 Renamed Knit Toptan Ltd. Şti.')$$, 'Update check');
select is((public.admin_verification_rules('d1200000-0000-0000-0000-0000000000f3') ->> 'approvalProblem'), null, 'clears it');

-- A reason on any sub-check
select throws_ok($$select public.admin_check_reason('d1200000-0000-0000-0000-0000000000f1', 'company_size', 'x')$$, '22023', null, 'an unknown check is refused');
select throws_ok($$select public.admin_check_reason('d1200000-0000-0000-0000-0000000000f1', 'photos', '   ')$$, '22023', null, 'an empty reason is refused');
select throws_ok($$select public.admin_check_reason('d1200000-0000-0000-0000-0000000000f1', 'certificate', 'valid')$$, 'P0002', null, 'a certificate reason names the certificate');
select throws_ok($$select public.admin_check_reason('d1200000-0000-0000-0000-0000000000f1', 'certificate', 'valid', 'e1200000-0000-0000-0000-000000000004')$$, 'P0002', null,
  'and only one of this company''s certificates');
select lives_ok($$select public.admin_check_reason('d1200000-0000-0000-0000-0000000000f1', 'certificate', 'Renewed; the new one is on its way', 'e1200000-0000-0000-0000-000000000001')$$, 'a reason on a certificate');
select lives_ok($$select public.admin_check_reason('d1200000-0000-0000-0000-0000000000f1', 'address', 'Seen on the video call')$$, 'a reason on the address');
select is((select string_agg(r ->> 'checkKey' || coalesce(':' || (r ->> 'subjectId'), ''), ',' order by r ->> 'checkKey')
             from jsonb_array_elements(public.admin_verification_score_input('d1200000-0000-0000-0000-0000000000f1') -> 'reasons') r),
  'address_owner,certificate:e1200000-0000-0000-0000-000000000001', 'the score reads each reason with what it is about');

-- Factory or trader: the reason is what lets a trading-only licence be approved.
reset role;
insert into public.verification_signals (org_id, kind, subject_id, result, details, automatic)
values ('d1200000-0000-0000-0000-0000000000f4', 'document_reading', 'a1200000-0000-0000-0000-000000000004', 'agrees',
        '{"numberAtReading":"9123456738","differences":[],"tradingScope":{"trading":true,"read":true,"recognised":true,"quote":"Toptan giyim ticareti"}}', true);
set local request.jwt.claims = '{"sub":"c1200000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select lives_ok($$select public.admin_record_registry_result('d1200000-0000-0000-0000-0000000000f4', 'gib', 'found', null, 'P12 Trader Ltd. Şti.')$$, 'the trader is found on GİB');
select is((public.admin_verification_rules('d1200000-0000-0000-0000-0000000000f4') ->> 'approvalProblem'), 'trading_only', 'a trading-only licence blocks approval');
select lives_ok($$select public.admin_check_reason('d1200000-0000-0000-0000-0000000000f4', 'scope', 'Owns a sewing unit next door, seen on the video call')$$, 'a reason on Factory or trader');
select is((public.admin_verification_rules('d1200000-0000-0000-0000-0000000000f4') ->> 'approvalProblem'), null, 'opens approval');
reset role;

select * from finish();
rollback;
