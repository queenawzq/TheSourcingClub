-- ============================================================================
-- Admin help for reviewers, and clearing test data (20261016000100)
-- ----------------------------------------------------------------------------
-- `pgtap22-` fixtures; every assertion is about these fixtures only, because
-- the shared database is full of real test leftovers this rule also matches.
--
-- The dangerous half is the cleanup: it deletes companies. So most of this
-- file is companies that must NOT be matched, each failing exactly one part
-- of the rule, and a purge handed a real company's id that must survive.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(58);

-- People. Two hours old unless the test is about age.
insert into auth.users (id, email, created_at) values
  ('c2200000-0000-0000-0000-000000000001', 'p22-reviewer@tsc-staff.com',             now() - interval '2 hours'),
  ('c2200000-0000-0000-0000-000000000002', 'e2e-factory-1790000000001@example.com',  now() - interval '2 hours'),
  ('c2200000-0000-0000-0000-000000000003', 'e2e-brand-1790000000002@example.com',    now() - interval '2 hours'),
  ('c2200000-0000-0000-0000-000000000004', 'owner@p22-realmill.cn',                  now() - interval '2 hours'),
  ('c2200000-0000-0000-0000-000000000005', 'mixed-1790000000003@example.com',        now() - interval '2 hours'),
  ('c2200000-0000-0000-0000-000000000006', 'young-1790000000010@example.com',        now() - interval '2 hours'),
  ('c2200000-0000-0000-0000-000000000007', 'e2e-x-1790000000004@example.com',        now() - interval '2 hours'),
  ('c2200000-0000-0000-0000-000000000008', 'demo-factory-1790000000005@example.com', now() - interval '2 hours'),
  ('c2200000-0000-0000-0000-000000000009', 'sysadmin-1790000000006@example.com',     now() - interval '2 hours'),
  ('c2200000-0000-0000-0000-00000000000a', 'recent-1790000000007@example.com',       now() - interval '5 minutes'),
  ('c2200000-0000-0000-0000-00000000000b', 'jane-1790000000008@gmail.com',           now() - interval '2 hours'),
  ('c2200000-0000-0000-0000-00000000000c', 'signer-1790000000009@example.com',       now() - interval '2 hours');

insert into public.platform_admins (user_id, note)
values ('c2200000-0000-0000-0000-000000000001', 'pgtap22 fixture');

insert into public.orgs (id, type, name, slug, is_demo, created_at) values
  -- test companies
  ('d2200000-0000-0000-0000-00000000000a', 'factory', 'P22 Atelier E2E',  'pgtap22-atelier-e2e-1790000000001', false, now() - interval '2 hours'),
  ('d2200000-0000-0000-0000-00000000000f', 'brand',   'P22 Lone Brand 1790000000011', 'pgtap22-lone-1790000000011', false, now() - interval '2 hours'),
  -- not test companies, one reason each
  ('d2200000-0000-0000-0000-00000000000b', 'brand',   'P22 Trades Real',  'pgtap22-maison-e2e-1790000000002',  false, now() - interval '2 hours'),
  ('d2200000-0000-0000-0000-00000000000e', 'factory', 'P22 Real Mill',    'pgtap22-real-mill',                 false, now() - interval '2 hours'),
  ('d2200000-0000-0000-0000-00000000000c', 'factory', 'P22 Mixed',        'pgtap22-mixed-1790000000003',       false, now() - interval '2 hours'),
  ('d2200000-0000-0000-0000-00000000000d', 'factory', 'P22 Young',        'pgtap22-young-1790000000010',       false, now() - interval '10 minutes'),
  ('d2200000-0000-0000-0000-000000000010', 'factory', 'P22 Unstamped',    'pgtap22-unstamped',                 false, now() - interval '2 hours'),
  ('d2200000-0000-0000-0000-000000000011', 'factory', 'P22 Demo Login',   'pgtap22-demo-1790000000005',        false, now() - interval '2 hours'),
  ('d2200000-0000-0000-0000-000000000012', 'factory', 'P22 Marked Demo',  'pgtap22-marked-1790000000012',      true,  now() - interval '2 hours'),
  -- no members, and nothing in the name says it is a test run
  ('d2200000-0000-0000-0000-000000000017', 'factory', 'P22 Nameless',     'pgtap22-nameless-1790000000013',    false, now() - interval '2 hours'),
  -- no members, and a phone number where a run stamp would be
  ('d2200000-0000-0000-0000-000000000018', 'factory', 'P22 Shenzhen Knit 13800138000', 'pgtap22-shenzhen-knit-13800138000', false, now() - interval '2 hours'),
  -- test companies that share something with the real mill, one thing each,
  -- and a test factory whose only partner is one of them
  ('d2200000-0000-0000-0000-000000000013', 'brand',   'P22 Quoted 1790000000014',  'pgtap22-quoted-1790000000014',  false, now() - interval '2 hours'),
  ('d2200000-0000-0000-0000-000000000014', 'brand',   'P22 Inviter 1790000000015', 'pgtap22-inviter-1790000000015', false, now() - interval '2 hours'),
  ('d2200000-0000-0000-0000-000000000015', 'brand',   'P22 Talker 1790000000016',  'pgtap22-talker-1790000000016',  false, now() - interval '2 hours'),
  ('d2200000-0000-0000-0000-000000000016', 'factory', 'P22 Partner 1790000000017', 'pgtap22-partner-1790000000017', false, now() - interval '2 hours');

insert into public.org_members (org_id, user_id, role) values
  ('d2200000-0000-0000-0000-00000000000a', 'c2200000-0000-0000-0000-000000000002', 'owner'),
  ('d2200000-0000-0000-0000-00000000000b', 'c2200000-0000-0000-0000-000000000003', 'owner'),
  ('d2200000-0000-0000-0000-00000000000e', 'c2200000-0000-0000-0000-000000000004', 'owner'),
  ('d2200000-0000-0000-0000-00000000000c', 'c2200000-0000-0000-0000-000000000005', 'owner'),
  ('d2200000-0000-0000-0000-00000000000c', 'c2200000-0000-0000-0000-00000000000b', 'member'),
  ('d2200000-0000-0000-0000-00000000000d', 'c2200000-0000-0000-0000-000000000006', 'owner'),
  ('d2200000-0000-0000-0000-000000000010', 'c2200000-0000-0000-0000-000000000007', 'owner'),
  ('d2200000-0000-0000-0000-000000000011', 'c2200000-0000-0000-0000-000000000008', 'owner');

insert into public.factory_profiles (org_id, legal_name, website_url, country_code, moq, intro, onboarding_completed_at) values
  ('d2200000-0000-0000-0000-00000000000e', 'Realmill Textiles Co., Ltd.', 'https://p22-realmill.cn', 'CN', 300, 'Knitwear since 2004.', now()),
  -- Another customer with the same legal name: the duplicate check names it.
  ('d2200000-0000-0000-0000-000000000010', 'Realmill Textiles Co., Ltd.', null, 'CN', 300, null, null);

-- A signature by a test user who belongs to no company, on the real mill:
-- the user matches the rule, but deleting them would break the record.
insert into public.terms_acceptances (org_id, terms_version, signature, accepted_by)
values ('d2200000-0000-0000-0000-00000000000e', 'terms_factory v1', 'P22 Signer', 'c2200000-0000-0000-0000-00000000000c');

-- Two orders: test brand ↔ real mill (keeps the test brand), and a request
-- between the two test companies (goes with them).
insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total) values
  ('e2200000-0000-0000-0000-000000000001', 'd2200000-0000-0000-0000-00000000000b', 'P22 real order', 'awarded', 'invited_only', 100),
  ('e2200000-0000-0000-0000-000000000002', 'd2200000-0000-0000-0000-00000000000f', 'P22 test order', 'awarded', 'invited_only', 100);
insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity, submitted_at) values
  ('f2200000-0000-0000-0000-000000000001', 'e2200000-0000-0000-0000-000000000001', 'd2200000-0000-0000-0000-00000000000e', 'accepted', 100, 1, now()),
  ('f2200000-0000-0000-0000-000000000002', 'e2200000-0000-0000-0000-000000000002', 'd2200000-0000-0000-0000-00000000000a', 'accepted', 100, 1, now());
insert into public.production_orders
  (id, rfq_id, quote_id, brand_org_id, factory_org_id, unit_price_cents,
   production_quantity, bulk_subtotal_cents, sample_subtotal_cents, order_total_cents, deposit_pct, balance_pct)
values
  ('a2200000-0000-0000-0000-000000000001', 'e2200000-0000-0000-0000-000000000001', 'f2200000-0000-0000-0000-000000000001',
   'd2200000-0000-0000-0000-00000000000b', 'd2200000-0000-0000-0000-00000000000e', 100, 1, 100, 0, 100, 50, 50),
  ('a2200000-0000-0000-0000-000000000002', 'e2200000-0000-0000-0000-000000000002', 'f2200000-0000-0000-0000-000000000002',
   'd2200000-0000-0000-0000-00000000000f', 'd2200000-0000-0000-0000-00000000000a', 100, 1, 100, 0, 100, 50, 50);

-- What the three test brands share with the real mill: a quote on a request,
-- an invitation to quote, and a conversation with a message from the mill.
-- The partner factory quoted on the first brand's request.
insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total) values
  ('e2200000-0000-0000-0000-000000000003', 'd2200000-0000-0000-0000-000000000013', 'P22 quoted', 'open', 'invited_only', 100),
  ('e2200000-0000-0000-0000-000000000004', 'd2200000-0000-0000-0000-000000000014', 'P22 invited', 'open', 'invited_only', 100),
  ('e2200000-0000-0000-0000-000000000005', 'd2200000-0000-0000-0000-000000000015', 'P22 talked', 'open', 'invited_only', 100);
insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity) values
  ('f2200000-0000-0000-0000-000000000003', 'e2200000-0000-0000-0000-000000000003', 'd2200000-0000-0000-0000-00000000000e', 'draft', 100, 1),
  ('f2200000-0000-0000-0000-000000000004', 'e2200000-0000-0000-0000-000000000003', 'd2200000-0000-0000-0000-000000000016', 'draft', 100, 1);
insert into public.rfq_invitations (rfq_id, factory_org_id) values
  ('e2200000-0000-0000-0000-000000000004', 'd2200000-0000-0000-0000-00000000000e');
insert into public.message_threads (id, rfq_id, brand_org_id, factory_org_id) values
  ('b2200000-0000-0000-0000-000000000001', 'e2200000-0000-0000-0000-000000000005',
   'd2200000-0000-0000-0000-000000000015', 'd2200000-0000-0000-0000-00000000000e');
insert into public.messages (id, thread_id, sender_org_id, sender_user_id, body) values
  ('b2200000-0000-0000-0000-000000000002', 'b2200000-0000-0000-0000-000000000001',
   'd2200000-0000-0000-0000-00000000000e', 'c2200000-0000-0000-0000-000000000004', 'P22 we can make this');

-- ---------------------------------------------------------------------------
-- The rule
-- ---------------------------------------------------------------------------

create temp table p22_candidates as
  select org_id from public.test_data_candidates()
   where org_id::text like 'd2200000-%';
create temp table p22_users as
  select user_id from public.test_data_users()
   where user_id::text like 'c2200000-%';
grant select on p22_candidates, p22_users to authenticated, service_role;

select set_eq(
  'select org_id from p22_candidates',
  $$values ('d2200000-0000-0000-0000-00000000000a'::uuid), ('d2200000-0000-0000-0000-00000000000f'::uuid)$$,
  'a stamped company of test users, and one with no members, are test data');

select ok(not exists (select 1 from p22_candidates where org_id = 'd2200000-0000-0000-0000-00000000000e'),
  'a real company is not test data');
select ok(not exists (select 1 from p22_candidates where org_id = 'd2200000-0000-0000-0000-00000000000b'),
  'a test company with an order with a real company is kept');
select ok(not exists (select 1 from p22_candidates where org_id = 'd2200000-0000-0000-0000-00000000000c'),
  'one member with a real address keeps a stamped company');
select ok(not exists (select 1 from p22_candidates where org_id = 'd2200000-0000-0000-0000-00000000000d'),
  'a company less than an hour old is left alone (a run may be using it)');
select ok(not exists (select 1 from p22_candidates where org_id = 'd2200000-0000-0000-0000-000000000010'),
  'a company whose web address has no run number is not test data');
select ok(not exists (select 1 from p22_candidates where org_id = 'd2200000-0000-0000-0000-000000000011'),
  'a demo login''s company is never test data');
select ok(not exists (select 1 from p22_candidates where org_id = 'd2200000-0000-0000-0000-000000000012'),
  'a company marked as demo is never test data');
select ok(not exists (select 1 from p22_candidates where org_id = 'd2200000-0000-0000-0000-000000000017'),
  'a company with no members is not test data unless its name carries the run number too');
select ok(not exists (select 1 from p22_candidates where org_id = 'd2200000-0000-0000-0000-000000000018'),
  'a phone number in a company''s name and address is not a run number');
select ok(not exists (select 1 from p22_candidates where org_id = 'd2200000-0000-0000-0000-000000000013'),
  'a test company a real factory quoted for is kept');
select ok(not exists (select 1 from p22_candidates where org_id = 'd2200000-0000-0000-0000-000000000014'),
  'a test company that invited a real factory is kept');
select ok(not exists (select 1 from p22_candidates where org_id = 'd2200000-0000-0000-0000-000000000015'),
  'a test company with a conversation with a real company is kept');
select ok(not exists (select 1 from p22_candidates where org_id = 'd2200000-0000-0000-0000-000000000016'),
  'and so is a test company whose partner is kept');

select set_eq(
  'select user_id from p22_users',
  $$values ('c2200000-0000-0000-0000-000000000002'::uuid), ('c2200000-0000-0000-0000-000000000009'::uuid),
           ('c2200000-0000-0000-0000-00000000000c'::uuid)$$,
  'test users: members of test companies only, or of none');

select ok(not public.is_test_email('demo-brand@example.com'), 'a demo login is not a test address');
select ok(not public.is_test_email('buyer@example.com'), 'example.com without a run number is not a test address');
select ok(not public.is_test_email('ops-1790000000000@gmail.com'), 'a run number on a real domain is not a test address');
select ok(public.is_test_email('e2e-1790000000000@qa.test'), 'a run number on a .test domain is');
select ok(not public.is_test_email(null), 'no address is not a test address');
select ok(not public.is_test_email('buyer-13800138000@example.com'), 'a phone number is not a run number');
select ok(not public.is_test_email('buyer-17900000000001@example.com'), 'nor is a longer number that starts like one');

-- ---------------------------------------------------------------------------
-- Doors: nobody but staff
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"c2200000-0000-0000-0000-000000000004","email":"owner@p22-realmill.cn","role":"authenticated"}';
set local role authenticated;

select throws_ok($$select public.admin_review_assist_input('d2200000-0000-0000-0000-00000000000e')$$,
  '42501', null, 'a company cannot read what the AI would be given, even about itself');
select throws_ok($$select public.admin_review_assists('d2200000-0000-0000-0000-00000000000e')$$,
  '42501', null, 'nor the suggestions staff were shown');
select throws_ok($$select public.admin_test_data_preview()$$,
  '42501', null, 'nor the test-data list');
select throws_ok($$select public.admin_review_assist_input('00000000-0000-0000-0000-000000000000')$$,
  '42501', null, 'refused before the company is looked up (no P0002 leak)');
select throws_ok($$select public.record_review_assist('d2200000-0000-0000-0000-00000000000e', 'check', 'x', '{}', 'c2200000-0000-0000-0000-000000000001')$$,
  '42501', null, 'a signed-in user cannot write suggestions, even naming staff');
select throws_ok($$select public.purge_test_data(array['d2200000-0000-0000-0000-00000000000a'::uuid], '{}', 'c2200000-0000-0000-0000-000000000001')$$,
  '42501', null, 'a signed-in user cannot run the cleanup, even naming staff');
select throws_ok($$select * from public.test_data_candidates()$$,
  '42501', null, 'the rule itself is server-only');
select throws_ok($$select * from public.org_review_assists$$,
  '42501', null, 'the suggestions table cannot be read');
select throws_ok($$insert into public.org_review_assists (org_id, kind, output) values ('d2200000-0000-0000-0000-00000000000e', 'check', '{}')$$,
  '42501', null, 'nor written');

reset role;
set local role anon;
select throws_ok($$select public.admin_test_data_preview()$$,
  '42501', null, 'a signed-out visitor cannot call the preview');
reset role;

-- ---------------------------------------------------------------------------
-- Staff: what the AI reads
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"c2200000-0000-0000-0000-000000000001","email":"p22-reviewer@tsc-staff.com","role":"authenticated"}';
set local role authenticated;

select is(public.admin_review_assist_input('d2200000-0000-0000-0000-00000000000e') #>> '{profile,legal_name}',
  'Realmill Textiles Co., Ltd.', 'the AI reads the company''s own details');
select ok(public.admin_review_assist_input('d2200000-0000-0000-0000-00000000000e') -> 'member_email_domains' ? 'p22-realmill.cn',
  'and its members'' email domains');
select ok(position('owner@' in public.admin_review_assist_input('d2200000-0000-0000-0000-00000000000e')::text) = 0,
  'but never a member''s address');
select ok(not (public.admin_review_assist_input('d2200000-0000-0000-0000-00000000000e')::text ~ '"(value|weight)"'),
  'and none of the completeness percentages, so there is no number to repeat');
select ok(position('P22 Signer' in public.admin_review_assist_input('d2200000-0000-0000-0000-00000000000e')::text) = 0,
  'nor the name typed to sign the terms');
select is((select c ->> 'detail' from jsonb_array_elements(public.admin_review_assist_input('d2200000-0000-0000-0000-00000000000e') -> 'existing_checks') c
            where c ->> 'check' = 'Terms accepted'),
  format('Signed on %s against terms version terms_factory v1.', to_char(now(), 'DD Mon YYYY')),
  'the terms check still says when, and which version');
select ok(position('P22 Unstamped' in public.admin_review_assist_input('d2200000-0000-0000-0000-00000000000e')::text) = 0,
  'nor the other company the duplicate check found');
select is((select c ->> 'result' from jsonb_array_elements(public.admin_review_assist_input('d2200000-0000-0000-0000-00000000000e') -> 'existing_checks') c
            where c ->> 'check' = 'Duplicate company signal'),
  'Review', 'though the check still says there is one');
select ok(position('P22 Unstamped' in public.org_verification_checks('d2200000-0000-0000-0000-00000000000e')::text) > 0,
  '(the reviewer''s own check does name it, so the test above means something)');
select throws_ok($$select public.admin_review_assist_input('00000000-0000-0000-0000-000000000000')$$,
  'P0002', null, 'staff are told when the company does not exist');

select ok((public.admin_test_data_preview() -> 'companies') @> '[{"id":"d2200000-0000-0000-0000-00000000000a"}]',
  'staff see a test company in the preview');
select ok(not ((public.admin_test_data_preview() -> 'companies') @> '[{"id":"d2200000-0000-0000-0000-00000000000e"}]'),
  'and not the real one');
select is((select (c ->> 'orders')::int from jsonb_array_elements(public.admin_test_data_preview() -> 'companies') c
            where c ->> 'id' = 'd2200000-0000-0000-0000-00000000000a'),
  1, 'with what deleting it would take with it');

reset role;

-- ---------------------------------------------------------------------------
-- The server: saving suggestions, and the cleanup
-- ---------------------------------------------------------------------------

set local role service_role;

select throws_ok($$select public.record_review_assist('d2200000-0000-0000-0000-00000000000e', 'check', 'x', '{}', 'c2200000-0000-0000-0000-000000000004')$$,
  '42501', null, 'the server cannot save suggestions for someone who is not staff');
select lives_ok($$select public.record_review_assist('d2200000-0000-0000-0000-00000000000e', 'check', 'test/model',
                    '{"findings":[{"topic":"Website"}]}', 'c2200000-0000-0000-0000-000000000001')$$,
  'it saves them for staff');
select throws_ok($$select public.purge_test_data(array['d2200000-0000-0000-0000-00000000000a'::uuid], '{}', 'c2200000-0000-0000-0000-000000000004')$$,
  '42501', null, 'the cleanup refuses anyone but staff');

create temp table p22_purge as
  select public.purge_test_data(
    array['d2200000-0000-0000-0000-00000000000a', 'd2200000-0000-0000-0000-00000000000f',
          'd2200000-0000-0000-0000-00000000000e', 'd2200000-0000-0000-0000-00000000000b',
          'd2200000-0000-0000-0000-000000000013', 'd2200000-0000-0000-0000-000000000014',
          'd2200000-0000-0000-0000-000000000015', 'd2200000-0000-0000-0000-000000000016']::uuid[],
    array['c2200000-0000-0000-0000-000000000002', 'c2200000-0000-0000-0000-000000000009',
          'c2200000-0000-0000-0000-00000000000b', 'c2200000-0000-0000-0000-00000000000c']::uuid[],
    'c2200000-0000-0000-0000-000000000001') as result;

reset role;

select is((select (result ->> 'companies')::int from p22_purge), 2, 'only the two test companies are deleted');
select is((select (result ->> 'skipped')::int from p22_purge), 6, 'the six that do not match the rule are skipped');
select ok(exists (select 1 from public.orgs where id = 'd2200000-0000-0000-0000-00000000000e')
      and exists (select 1 from public.orgs where id = 'd2200000-0000-0000-0000-00000000000b'),
  'a real company passed in by mistake, and the test company trading with it, survive');
select ok(exists (select 1 from public.production_orders where id = 'a2200000-0000-0000-0000-000000000001'),
  'the real company''s order survives');
select ok(not exists (select 1 from public.production_orders where id = 'a2200000-0000-0000-0000-000000000002'),
  'the order between test companies is gone');
select ok(exists (select 1 from public.quotes where id = 'f2200000-0000-0000-0000-000000000003')
      and exists (select 1 from public.rfq_invitations where rfq_id = 'e2200000-0000-0000-0000-000000000004'),
  'a real factory''s quote and its invitation survive, though the requests are a test company''s');
select ok(exists (select 1 from public.message_threads where id = 'b2200000-0000-0000-0000-000000000001')
      and exists (select 1 from public.messages where id = 'b2200000-0000-0000-0000-000000000002'),
  'and so do its conversation and the message it sent');
select ok(not exists (select 1 from auth.users where id in ('c2200000-0000-0000-0000-000000000002', 'c2200000-0000-0000-0000-000000000009'))
      and exists (select 1 from auth.users where id = 'c2200000-0000-0000-0000-00000000000b'),
  'test users are deleted, a real one passed in is not');
select ok(exists (select 1 from auth.users where id = 'c2200000-0000-0000-0000-00000000000c')
      and (select result -> 'keptUsers' from p22_purge) @> '[{"id":"c2200000-0000-0000-0000-00000000000c"}]',
  'a test user whose signature a real company holds is kept, and named');

select is((select version from public.current_legal_documents() where kind = 'privacy'), 4,
  'privacy policy v4 is the current one');

select * from finish();

rollback;
