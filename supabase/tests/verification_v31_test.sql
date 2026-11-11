-- Verification v3.1 (20261111120000): a failing check digit is never stored,
-- staff type the number, a reason on any row, company facts, the production
-- address and the two new document kinds.
-- Fixtures prefixed pgtap31-; every count filters on its own ids.
begin;
create extension if not exists pgtap with schema extensions;
select plan(49);

insert into auth.users (id, email) values
  ('c3100000-0000-0000-0000-000000000001', 'p31-admin@example.com'),
  ('c3100000-0000-0000-0000-000000000002', 'p31-cn1@example.com'),
  ('c3100000-0000-0000-0000-000000000003', 'p31-cn2@example.com'),
  ('c3100000-0000-0000-0000-000000000004', 'p31-trader@example.com'),
  ('c3100000-0000-0000-0000-000000000005', 'p31-facts@example.com');
insert into public.platform_admins (user_id) values ('c3100000-0000-0000-0000-000000000001');
insert into public.orgs (id, type, name, slug) values
  ('d3100000-0000-0000-0000-0000000000f1', 'factory', 'P31 Check Digit Knit', 'pgtap31-cn1'),
  ('d3100000-0000-0000-0000-0000000000f2', 'factory', 'P31 Old Code Knit', 'pgtap31-cn2'),
  ('d3100000-0000-0000-0000-0000000000f3', 'factory', 'P31 Trader', 'pgtap31-trader'),
  ('d3100000-0000-0000-0000-0000000000f4', 'factory', 'P31 Facts Knit', 'pgtap31-facts');
insert into public.org_members (org_id, user_id, role) values
  ('d3100000-0000-0000-0000-0000000000f1', 'c3100000-0000-0000-0000-000000000002', 'owner'),
  ('d3100000-0000-0000-0000-0000000000f2', 'c3100000-0000-0000-0000-000000000003', 'owner'),
  ('d3100000-0000-0000-0000-0000000000f3', 'c3100000-0000-0000-0000-000000000004', 'owner'),
  ('d3100000-0000-0000-0000-0000000000f4', 'c3100000-0000-0000-0000-000000000005', 'owner');
insert into public.factory_profiles (org_id, legal_name, country_code, employee_count, founded_year) values
  ('d3100000-0000-0000-0000-0000000000f1', '宁波校验针织有限公司', 'CN', null, null),
  ('d3100000-0000-0000-0000-0000000000f2', '宁波旧码针织有限公司', 'CN', null, null),
  ('d3100000-0000-0000-0000-0000000000f3', '宁波贸易有限公司', 'CN', null, null),
  ('d3100000-0000-0000-0000-0000000000f4', '宁波事实针织有限公司', 'CN', 300, 2005);
insert into public.documents (id, org_id, kind, bucket, storage_path, file_name, mime_type) values
  ('a3100000-0000-0000-0000-000000000001', 'd3100000-0000-0000-0000-0000000000f1', 'business_registration', 'org-private', 'd3100000-0000-0000-0000-0000000000f1/licence.jpg', 'licence.jpg', 'image/jpeg'),
  ('a3100000-0000-0000-0000-000000000002', 'd3100000-0000-0000-0000-0000000000f2', 'business_registration', 'org-private', 'd3100000-0000-0000-0000-0000000000f2/licence.jpg', 'licence.jpg', 'image/jpeg'),
  ('a3100000-0000-0000-0000-000000000003', 'd3100000-0000-0000-0000-0000000000f3', 'business_registration', 'org-private', 'd3100000-0000-0000-0000-0000000000f3/licence.jpg', 'licence.jpg', 'image/jpeg');

-- B2: the two new kinds ----------------------------------------------------------
select ok('authorisation' = any(enum_range(null::public.document_kind)::text[]), 'authorisation is a document kind');
select ok('factory_photo' = any(enum_range(null::public.document_kind)::text[]), 'factory_photo is a document kind');

set local request.jwt.claims = '{"sub":"c3100000-0000-0000-0000-000000000005","role":"authenticated"}';
set local role authenticated;
select lives_ok($$insert into public.documents (id, org_id, kind, bucket, storage_path, file_name, mime_type)
  values ('a3100000-0000-0000-0000-000000000004', 'd3100000-0000-0000-0000-0000000000f4', 'authorisation', 'org-private',
          'd3100000-0000-0000-0000-0000000000f4/authorisation.jpg', 'authorisation.jpg', 'image/jpeg')$$,
  'a member uploads an authorisation to the private bucket');
select lives_ok($$insert into public.documents (id, org_id, kind, bucket, storage_path, file_name, mime_type)
  values ('a3100000-0000-0000-0000-000000000005', 'd3100000-0000-0000-0000-0000000000f4', 'factory_photo', 'org-private',
          'd3100000-0000-0000-0000-0000000000f4/floor.jpg', 'floor.jpg', 'image/jpeg')$$,
  'and a workshop photo');

-- B4: the production address, through the profile's own write -------------------
select lives_ok($$update public.factory_profiles set production_address = '浙江省宁波市鄞州区工业园路 18 号 3 栋'
  where org_id = 'd3100000-0000-0000-0000-0000000000f4'$$, 'a member saves its production address');
select throws_ok($$update public.factory_profiles set production_address = repeat('x', 501)
  where org_id = 'd3100000-0000-0000-0000-0000000000f4'$$, '23514', null, 'an address over 500 characters is refused');
update public.factory_profiles set production_address = 'not mine' where org_id = 'd3100000-0000-0000-0000-0000000000f1';
select throws_ok($$select public.admin_registry_detail('d3100000-0000-0000-0000-0000000000f4')$$, '42501', null, 'a member cannot read the staff detail');
select throws_ok($$select public.admin_record_company_facts('d3100000-0000-0000-0000-0000000000f4', 5, null)$$, '42501', null, 'a member cannot record company facts');
select throws_ok($$select public.admin_explain_check('d3100000-0000-0000-0000-0000000000f4', 'photos', 'mine')$$, '42501', null, 'a member cannot explain a check');
select throws_ok($$select public.admin_set_registration_number('d3100000-0000-0000-0000-0000000000f4', '91330200MA2AB1234Y', 'mine')$$, '42501', null, 'a member cannot set its number as staff');
select throws_ok($$select * from public.company_facts$$, '42501', null, 'company facts are unreadable to members');
select throws_ok($$select * from public.verification_check_reasons$$, '42501', null, 'reasons are unreadable to members');
select throws_ok($$select * from public.registration_number_entries$$, '42501', null, 'staff number entries are unreadable to members');
reset role;
select is((select production_address from public.factory_profiles where org_id = 'd3100000-0000-0000-0000-0000000000f1'), null,
  'another company''s address is untouched');

-- A3: a failing check digit is never stored --------------------------------------
set local request.jwt.claims = '{"sub":"c3100000-0000-0000-0000-000000000002","role":"authenticated"}';
set local role authenticated;
select lives_ok($$select public.save_company_registration('d3100000-0000-0000-0000-0000000000f1', 'CN', '')$$, 'a Chinese factory saves with no number');
reset role;
select lives_ok($$select public.record_verification_signal('d3100000-0000-0000-0000-0000000000f1', 'document_reading', 'a3100000-0000-0000-0000-000000000001', 'agrees',
  jsonb_build_object('extracted', jsonb_build_object('registrationNumber', '91350100M000100Y44', 'legalName', '宁波校验针织有限公司'),
                     'differences', '[]'::jsonb, 'tradingScope', jsonb_build_object('trading', false)), 'c3100000-0000-0000-0000-000000000001')$$,
  'the AI reads a number whose check digit fails');
select is((select number from public.company_registrations where org_id = 'd3100000-0000-0000-0000-0000000000f1'), null, 'it is not stored');
select is((select details ->> 'numberReadProblem' || ' ' || (details ->> 'numberRead') from public.verification_signals
            where org_id = 'd3100000-0000-0000-0000-0000000000f1'), 'check_digit 91350100M000100Y44', 'the reading keeps it and says why');
select is(public.registry_approval_problem('d3100000-0000-0000-0000-0000000000f1'), 'number_check_digit_fails', 'approval names the check digit');
select throws_ok($$update public.company_registrations set number = '91350100M000100Y44', number_source = 'typed'
  where org_id = 'd3100000-0000-0000-0000-0000000000f1'$$, '22023', null, 'even a direct write cannot store it');

set local request.jwt.claims = '{"sub":"c3100000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select throws_ok($$select public.admin_set_registration_number('d3100000-0000-0000-0000-0000000000f1', '91350100M000100Y44', 'from the licence')$$,
  '22023', null, 'staff cannot store it either');
select throws_ok($$select public.admin_set_registration_number('d3100000-0000-0000-0000-0000000000f1', '91330200MA2AB1234Y', '  ')$$,
  '22023', null, 'staff say where the number comes from');
select lives_ok($$select public.admin_set_registration_number('d3100000-0000-0000-0000-0000000000f1', '9133 0200 MA2AB 1234Y', 'Read off the licence photo: the AI misread one character')$$,
  'staff type the number off the licence');
select is((select number || ' ' || number_source from public.company_registrations where org_id = 'd3100000-0000-0000-0000-0000000000f1'),
  '91330200MA2AB1234Y staff', 'stored normalised, as staff''s');
reset role;
select is(public.registry_approval_problem('d3100000-0000-0000-0000-0000000000f1'), 'no_check', 'next, the registry check');
set local role authenticated;
select is(public.admin_verification_rules('d3100000-0000-0000-0000-0000000000f1') #>> '{numberRead,problem}', 'check_digit', 'the panel shows what was read and why it was not used');
select is(public.admin_verification_rules('d3100000-0000-0000-0000-0000000000f1') #>> '{staffNumber,note}', 'Read off the licence photo: the AI misread one character', 'and staff''s note');
select is(public.admin_registry_detail('d3100000-0000-0000-0000-0000000000f1') #>> '{registration,source}', 'staff', 'the registry detail says whose number it is');

-- An old 15-digit code, and a Hong Kong CR, are staff's to type
reset role;
select lives_ok($$select public.record_verification_signal('d3100000-0000-0000-0000-0000000000f2', 'document_reading', 'a3100000-0000-0000-0000-000000000002', 'agrees',
  jsonb_build_object('extracted', jsonb_build_object('registrationNumber', '330200000012345'), 'differences', '[]'::jsonb), 'c3100000-0000-0000-0000-000000000001')$$,
  'the AI reads an old 15-digit code');
insert into public.company_registrations (org_id, country_code, number_source) values ('d3100000-0000-0000-0000-0000000000f2', 'CN', 'document');
select is(public.registry_approval_problem('d3100000-0000-0000-0000-0000000000f2'), 'number_needs_staff', 'approval asks staff for the number, not a clearer licence');
set local request.jwt.claims = '{"sub":"c3100000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select lives_ok($$select public.admin_set_registration_number('d3100000-0000-0000-0000-0000000000f2', '330200000012345', 'Old registration code, before 2015')$$,
  'staff store the old code');
reset role;
select is(public.registry_approval_problem('d3100000-0000-0000-0000-0000000000f2'), 'no_check', 'and it is no longer a dead end');
set local role authenticated;
select lives_ok($$select public.admin_set_registration_number('d3100000-0000-0000-0000-0000000000f2', '1234567', 'Hong Kong CR', 'hk')$$,
  'a Hong Kong company''s CR');
select is((select country_code || ' ' || number from public.company_registrations where org_id = 'd3100000-0000-0000-0000-0000000000f2'),
  'HK 1234567', 'under Hong Kong');

-- A10: a reason on any row --------------------------------------------------------
select lives_ok($$select public.admin_explain_check('d3100000-0000-0000-0000-0000000000f4', 'address_site', 'Visited on video: sewing lines on two floors')$$,
  'staff give a reason on the address row');
select throws_ok($$select public.admin_explain_check('d3100000-0000-0000-0000-0000000000f4', 'mood', 'x')$$, '22023', null, 'only the seven rows');
select throws_ok($$select public.admin_explain_check('d3100000-0000-0000-0000-0000000000f4', 'photos', '')$$, '22023', null, 'a reason needs words');
select is(public.admin_verification_rules('d3100000-0000-0000-0000-0000000000f4') #>> '{reasons,address_site,note}',
  'Visited on video: sewing lines on two floors', 'the panel reads it per row');

-- The trading reason still works, and is the same reason
reset role;
select lives_ok($$select public.record_verification_signal('d3100000-0000-0000-0000-0000000000f3', 'document_reading', 'a3100000-0000-0000-0000-000000000003', 'agrees',
  jsonb_build_object('extracted', jsonb_build_object('registrationNumber', ''), 'differences', '[]'::jsonb,
                     'tradingScope', jsonb_build_object('trading', true, 'quote', '服装批发')), 'c3100000-0000-0000-0000-000000000001')$$,
  'a trading-only licence is read');
set local request.jwt.claims = '{"sub":"c3100000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select is((public.admin_explain_trading_scope('d3100000-0000-0000-0000-0000000000f3', 'Owns the workshop next door; lease seen')).note,
  'Owns the workshop next door; lease seen', 'admin_explain_trading_scope still returns its row');
select is(public.admin_verification_rules('d3100000-0000-0000-0000-0000000000f3') #>> '{reasons,trading_scope,note}',
  'Owns the workshop next door; lease seen', 'and the reason shows on the trading row');
select is(public.admin_verification_rules('d3100000-0000-0000-0000-0000000000f3') #>> '{tradingOnly,explanation,note}',
  'Owns the workshop next door; lease seen', 'and as the trading explanation');
reset role;
select is((select count(*)::int from public.verification_check_reasons where org_id = 'd3100000-0000-0000-0000-0000000000f3')
          + (select count(*)::int from public.registry_trader_reviews where org_id = 'd3100000-0000-0000-0000-0000000000f3'),
  2, 'one reason, one trader review');

-- B3: company facts ----------------------------------------------------------------
set local request.jwt.claims = '{"sub":"c3100000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select lives_ok($$select public.admin_record_company_facts('d3100000-0000-0000-0000-0000000000f4', 12, '2021-06-01')$$, 'staff record insured staff and the founding date');
select is((public.admin_verification_rules('d3100000-0000-0000-0000-0000000000f4') -> 'companyFacts') - 'recordedAt',
  '{"insuredStaff": 12, "foundedOn": "2021-06-01", "claimedEmployees": 300, "claimedFoundedYear": 2005}'::jsonb,
  'the panel reads them beside what the factory claims');
select throws_ok($$select public.admin_record_company_facts('d3100000-0000-0000-0000-0000000000f4', -1, null)$$, '22023', null, 'insured staff is a count');
select throws_ok($$select public.admin_record_company_facts('d3100000-0000-0000-0000-0000000000f4', null, current_date + 1)$$, '22023', null, 'a founding date in the future is refused');
select is(public.admin_registry_detail('d3100000-0000-0000-0000-0000000000f4') ->> 'productionAddress',
  '浙江省宁波市鄞州区工业园路 18 号 3 栋', 'staff read the production address');
select ok((select count(*) from public.admin_org_documents('d3100000-0000-0000-0000-0000000000f4')) = 2, 'staff see the authorisation and the workshop photo');
reset role;

select * from finish();
rollback;
