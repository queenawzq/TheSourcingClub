-- Verification v3 rules (20261111100000): China's number read off the
-- licence, invisible characters, back to review on a change, the trading
-- licence's reason, and what the review AI reads.
-- Fixtures prefixed pgtap93-; every count filters on its own ids.
begin;
create extension if not exists pgtap with schema extensions;
select plan(38);

insert into auth.users (id, email) values
  ('c9300000-0000-0000-0000-000000000001', 'p93-admin@example.com'),
  ('c9300000-0000-0000-0000-000000000002', 'p93-cn1@example.com'),
  ('c9300000-0000-0000-0000-000000000003', 'p93-cn2@example.com'),
  ('c9300000-0000-0000-0000-000000000004', 'p93-cn3@example.com');
insert into public.platform_admins (user_id) values ('c9300000-0000-0000-0000-000000000001');
insert into public.orgs (id, type, name, slug) values
  ('d9300000-0000-0000-0000-0000000000f1', 'factory', 'P93 Ningbo Knit', 'pgtap93-cn1'),
  ('d9300000-0000-0000-0000-0000000000f2', 'factory', 'P93 Copy Knit', 'pgtap93-cn2'),
  ('d9300000-0000-0000-0000-0000000000f3', 'factory', 'P93 Verified Knit', 'pgtap93-cn3');
insert into public.org_members (org_id, user_id, role) values
  ('d9300000-0000-0000-0000-0000000000f1', 'c9300000-0000-0000-0000-000000000002', 'owner'),
  ('d9300000-0000-0000-0000-0000000000f2', 'c9300000-0000-0000-0000-000000000003', 'owner'),
  ('d9300000-0000-0000-0000-0000000000f3', 'c9300000-0000-0000-0000-000000000004', 'owner');
insert into public.factory_profiles (org_id, legal_name, published_at) values
  ('d9300000-0000-0000-0000-0000000000f1', '宁波针织有限公司', now()),
  ('d9300000-0000-0000-0000-0000000000f2', '宁波复制针织有限公司', now()),
  ('d9300000-0000-0000-0000-0000000000f3', '宁波认证针织有限公司', now());
insert into public.documents (id, org_id, kind, bucket, storage_path, file_name, mime_type) values
  ('a9300000-0000-0000-0000-000000000001', 'd9300000-0000-0000-0000-0000000000f1', 'business_registration', 'org-private', 'd9300000-0000-0000-0000-0000000000f1/licence.jpg', 'licence.jpg', 'image/jpeg'),
  ('a9300000-0000-0000-0000-000000000002', 'd9300000-0000-0000-0000-0000000000f2', 'business_registration', 'org-private', 'd9300000-0000-0000-0000-0000000000f2/licence.jpg', 'licence.jpg', 'image/jpeg');

-- Invisible characters ----------------------------------------------------------
select is(public.normalise_registration_number('CN', E'9133​0200MA2AB﻿1234Y'), '91330200MA2AB1234Y', 'zero-width space and BOM stripped');
select is(public.normalise_registration_number('CN', E'⁠ 91330200MA2AB1234Y‍ '), '91330200MA2AB1234Y', 'word joiner, joiner and spaces stripped');
select is(public.registration_number_problem('CN', E'91330200MA2AB1234Y‌'), null, 'a code with an invisible character still passes');
select is(public.normalise_registration_number('PT', E'PT 500​697 256'), '500697256', 'Portugal: prefix and no-break space');

-- China: no number typed --------------------------------------------------------
set local request.jwt.claims = '{"sub":"c9300000-0000-0000-0000-000000000002","role":"authenticated"}';
set local role authenticated;
select lives_ok($$select public.save_company_registration('d9300000-0000-0000-0000-0000000000f1', 'CN', '')$$,
  'a Chinese factory saves with no number');
select is((select number_source from public.company_registrations where org_id = 'd9300000-0000-0000-0000-0000000000f1'), 'document', 'its number will come from the licence');
select is((select number from public.company_registrations where org_id = 'd9300000-0000-0000-0000-0000000000f1'), null, 'and is unknown so far');
select throws_ok($$select public.save_company_registration('d9300000-0000-0000-0000-0000000000f1', 'PT', '')$$,
  '22023', null, 'elsewhere a number is still required');
reset role;
select is(public.registry_approval_problem('d9300000-0000-0000-0000-0000000000f1'), 'number_unread', 'approval waits for the number');

-- The AI reads it, with a zero-width space in it
select lives_ok($$select public.record_verification_signal('d9300000-0000-0000-0000-0000000000f1', 'document_reading', 'a9300000-0000-0000-0000-000000000001', 'agrees',
  jsonb_build_object('extracted', jsonb_build_object('registrationNumber', E'9133​0200MA2AB1234Y', 'legalName', '宁波针织有限公司', 'businessScope', '针织服装制造'),
                     'differences', '[]'::jsonb, 'numberAtReading', null, 'tradingScope', jsonb_build_object('trading', false)), 'c9300000-0000-0000-0000-000000000001')$$,
  'the AI reads the licence');
select is((select number from public.company_registrations where org_id = 'd9300000-0000-0000-0000-0000000000f1'), '91330200MA2AB1234Y', 'the number read becomes the company''s, cleaned');
select is((select details ->> 'numberAtReading' from public.verification_signals where org_id = 'd9300000-0000-0000-0000-0000000000f1'), '91330200MA2AB1234Y', 'the reading is at that number');
select is(public.registry_reading_differs('d9300000-0000-0000-0000-0000000000f1'), null, 'and does not differ from itself');
select is(public.registry_approval_problem('d9300000-0000-0000-0000-0000000000f1'), 'no_check', 'next, staff check the registry');

-- The same licence number on a second company: the duplicate check sees it
set local request.jwt.claims = '{"sub":"c9300000-0000-0000-0000-000000000003","role":"authenticated"}';
set local role authenticated;
select lives_ok($$select public.save_company_registration('d9300000-0000-0000-0000-0000000000f2', 'CN', null)$$, 'the second factory saves, no number');
reset role;
select lives_ok($$select public.record_verification_signal('d9300000-0000-0000-0000-0000000000f2', 'document_reading', 'a9300000-0000-0000-0000-000000000002', 'differs',
  jsonb_build_object('extracted', jsonb_build_object('registrationNumber', '91330200MA2AB1234Y', 'legalName', '宁波复制针织有限公司', 'businessScope', '服装批发；进出口贸易'),
                     'differences', '[{"field":"number","document":"x","typed":"y"}]'::jsonb, 'numberAtReading', null,
                     'tradingScope', jsonb_build_object('trading', true, 'quote', '批发, 进出口, 贸易')), 'c9300000-0000-0000-0000-000000000001')$$,
  'its licence carries the first one''s number');
select is((select result from public.verification_signals where org_id = 'd9300000-0000-0000-0000-0000000000f2'), 'agrees', 'a number difference is not one when the number is the document''s');
select is((select count(*)::int from public.registry_duplicate_orgs('d9300000-0000-0000-0000-0000000000f2')), 1, 'the duplicate is found on the number read');
set local request.jwt.claims = '{"sub":"c9300000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select lives_ok($$select public.admin_record_registry_check('d9300000-0000-0000-0000-0000000000f2', 'gsxt', 'found', 'GSXT shows the company', false, '{"name":"宁波复制针织有限公司"}'::jsonb)$$, 'staff record a found check');
select is(public.admin_verification_rules('d9300000-0000-0000-0000-0000000000f2') ->> 'approvalProblem', 'duplicate', 'the duplicate blocks first');
select lives_ok($$select public.admin_explain_duplicate('d9300000-0000-0000-0000-0000000000f2', 'Same owner, a second site')$$, 'staff explain it');

-- A trading-only licence needs a reason ---------------------------------------
select is(public.admin_verification_rules('d9300000-0000-0000-0000-0000000000f2') ->> 'approvalProblem', 'trading_only', 'then the trading licence blocks');
select is(public.admin_verification_rules('d9300000-0000-0000-0000-0000000000f2') #>> '{tradingOnly,quote}', '批发, 进出口, 贸易', 'staff see the words');
select throws_ok($$select public.admin_review_decision('d9300000-0000-0000-0000-0000000000f2', 'approved')$$,
  '22023', 'the licence''s business scope is trading only: record why before approving', 'approval is refused');
select throws_ok($$select public.admin_explain_trading_scope('d9300000-0000-0000-0000-0000000000f2', '  ')$$, '22023', null, 'a reason needs words');
select throws_ok($$select public.admin_explain_trading_scope('d9300000-0000-0000-0000-0000000000f1', 'fine')$$, '22023', null, 'a making licence has nothing to explain');
select lives_ok($$select public.admin_explain_trading_scope('d9300000-0000-0000-0000-0000000000f2', 'Video shows its own sewing lines; the licence is the sales arm')$$, 'staff record why');
select is(public.admin_verification_rules('d9300000-0000-0000-0000-0000000000f2') #>> '{tradingOnly,explanation,note}', 'Video shows its own sewing lines; the licence is the sales arm', 'the reason is kept with it');
select is(public.admin_verification_rules('d9300000-0000-0000-0000-0000000000f2') ->> 'approvalProblem', null, 'approval opens');
select ok(public.admin_review_assist_input('d9300000-0000-0000-0000-0000000000f2') #>> '{registry,document_reading,trading_only_scope}' = 'true', 'the review AI sees the trading scope');
select is(public.admin_review_assist_input('d9300000-0000-0000-0000-0000000000f2') #>> '{registry,other_companies_with_this_number}', '1', 'and the duplicate, as a count without names');
reset role;
set local request.jwt.claims = '{"sub":"c9300000-0000-0000-0000-000000000002","role":"authenticated"}';
set local role authenticated;
select throws_ok($$select public.admin_explain_trading_scope('d9300000-0000-0000-0000-0000000000f2', 'x')$$, '42501', null, 'a factory cannot explain it');

-- A verified factory that changes who it is goes back to review -------------------
reset role;
update public.factory_profiles set verification_status = 'verified' where org_id = 'd9300000-0000-0000-0000-0000000000f3';
set local tsc.skip_registry_guard = 'on';
insert into public.org_reviews (org_id, state) values ('d9300000-0000-0000-0000-0000000000f3', 'approved')
  on conflict (org_id) do update set state = 'approved';
set local tsc.skip_registry_guard = 'off';
set local request.jwt.claims = '{"sub":"c9300000-0000-0000-0000-000000000004","role":"authenticated"}';
set local role authenticated;
update public.factory_profiles set legal_name = '宁波新名字针织有限公司' where org_id = 'd9300000-0000-0000-0000-0000000000f3';
reset role;
select is((select verification_status::text from public.factory_profiles where org_id = 'd9300000-0000-0000-0000-0000000000f3'), 'pending', 'a rename by the factory sends it back to review');
select is((select state::text from public.org_reviews where org_id = 'd9300000-0000-0000-0000-0000000000f3'), 'ready_for_review', 'into the staff queue');
select is((select count(*)::int from public.notifications where org_id = 'd9300000-0000-0000-0000-0000000000f3' and kind = 'verification_reopened'), 1, 'the factory is told in one line');
set local request.jwt.claims = '{"sub":"c9300000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select is(public.admin_verification_rules('d9300000-0000-0000-0000-0000000000f3') #>> '{reopenings,0,field}', 'legal_name', 'staff see why');
reset role;
insert into public.company_registrations (org_id, country_code, number, number_source)
  values ('d9300000-0000-0000-0000-0000000000f3', 'CN', '91330200MA2AB56783', 'document');
update public.factory_profiles set verification_status = 'verified' where org_id = 'd9300000-0000-0000-0000-0000000000f3';
update public.company_registrations set number = '91330200MA2AB1234Y' where org_id = 'd9300000-0000-0000-0000-0000000000f3';
select is((select verification_status::text from public.factory_profiles where org_id = 'd9300000-0000-0000-0000-0000000000f3'), 'pending', 'a new number does too');
update public.factory_profiles set verification_status = 'verified' where org_id = 'd9300000-0000-0000-0000-0000000000f3';
update public.factory_profiles set legal_name = '宁波新名字针织有限公司 ' where org_id = 'd9300000-0000-0000-0000-0000000000f3';
select is((select verification_status::text from public.factory_profiles where org_id = 'd9300000-0000-0000-0000-0000000000f3'), 'verified', 'a trailing space is not a change');

select * from finish();
rollback;
