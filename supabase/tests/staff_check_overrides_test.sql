-- Staff record their own result on the address, factory-or-trader and licence
-- checks (20261124340000). Fixtures prefixed pgtap2434-; every count filters on
-- its own ids.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users (id, email) values
  ('c2434000-0000-0000-0000-000000000001', 'p2434-admin@example.com'),
  ('c2434000-0000-0000-0000-000000000002', 'p2434-owner@example.com');
insert into public.platform_admins (user_id) values ('c2434000-0000-0000-0000-000000000001');
insert into public.orgs (id, type, name, slug) values
  ('d2434000-0000-0000-0000-0000000000f1', 'factory', 'P2434 Mill', 'pgtap2434-mill');
insert into public.org_members (org_id, user_id, role) values
  ('d2434000-0000-0000-0000-0000000000f1', 'c2434000-0000-0000-0000-000000000002', 'owner');
insert into public.factory_profiles (org_id, country_code) values ('d2434000-0000-0000-0000-0000000000f1', 'CN');
insert into public.documents (id, org_id, kind, bucket, storage_path, file_name, mime_type, size_bytes, status) values
  ('a2434000-0000-0000-0000-000000000001', 'd2434000-0000-0000-0000-0000000000f1', 'business_registration', 'org-private',
   'd2434000-0000-0000-0000-0000000000f1/business_registration/licence.png', 'licence.png', 'image/png', 10, 'pending'),
  ('a2434000-0000-0000-0000-000000000002', 'd2434000-0000-0000-0000-0000000000f1', 'product_image', 'org-public',
   'd2434000-0000-0000-0000-0000000000f1/product_image/shirt.png', 'shirt.png', 'image/png', 10, 'pending');
-- The licence reads as trading only.
insert into public.verification_signals (org_id, kind, subject_id, automatic, result, details) values
  ('d2434000-0000-0000-0000-0000000000f1', 'document_reading', 'a2434000-0000-0000-0000-000000000001', true, 'read',
   '{"extracted":{"readable":true},"tradingScope":{"trading":true,"quote":"服装批发"}}');

-- The company's own people cannot record staff results.
set local request.jwt.claims = '{"sub":"c2434000-0000-0000-0000-000000000002","role":"authenticated"}';
set local role authenticated;
select throws_ok($$select public.admin_record_signal('d2434000-0000-0000-0000-0000000000f1', 'scope', null, 'factory', 'we are a factory')$$,
  '42501', null, 'a company member cannot record a staff result');
reset role;

set local request.jwt.claims = '{"sub":"c2434000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;

-- Address: for the address shown, with a note.
select lives_ok($$select public.admin_record_signal('d2434000-0000-0000-0000-0000000000f1', 'address', null, 'problem',
  'Right street, but a shop front', '{"address":"18 Jiangdong 3rd Road"}'::jsonb)$$, 'staff record a problem with the address');
select throws_ok($$select public.admin_record_signal('d2434000-0000-0000-0000-0000000000f1', 'address', null, 'confirmed', 'seen it')$$,
  '22023', 'the company has no address to check', 'an address result needs the address it was for');
select throws_ok($$select public.admin_record_signal('d2434000-0000-0000-0000-0000000000f1', 'address', null, 'own', 'x', '{"address":"a"}'::jsonb)$$,
  '22023', null, 'an address result is one of the three');
select throws_ok($$select public.admin_record_signal('d2434000-0000-0000-0000-0000000000f1', 'address', null, 'confirmed', '  ', '{"address":"a"}'::jsonb)$$,
  '22023', 'say what you saw', 'a note is required');

-- Licence: only on the company's own licence file.
select lives_ok($$select public.admin_record_signal('d2434000-0000-0000-0000-0000000000f1', 'licence', 'a2434000-0000-0000-0000-000000000001', 'original',
  'Saw the original on site')$$, 'staff record the licence as original');
select throws_ok($$select public.admin_record_signal('d2434000-0000-0000-0000-0000000000f1', 'licence', 'a2434000-0000-0000-0000-000000000002', 'original', 'x')$$,
  'P0002', null, 'a product photo is not a licence');

-- Factory or trader: "Factory" on a trading licence is the explanation Approve waits for.
reset role;
select ok(public.registry_trading_reading('d2434000-0000-0000-0000-0000000000f1') is not null, 'the licence reads as trading only');
set local role authenticated;
select lives_ok($$select public.admin_record_signal('d2434000-0000-0000-0000-0000000000f1', 'scope', null, 'factory',
  'Their own sewing lines, seen on site')$$, 'staff record it as a factory');
select throws_ok($$select public.admin_record_signal('d2434000-0000-0000-0000-0000000000f1', 'scope', null, 'shop', 'x')$$,
  '22023', null, 'a factory-or-trader result is one of the three');
reset role;
select is((select count(*)::int from public.registry_trader_reviews where org_id = 'd2434000-0000-0000-0000-0000000000f1'), 1,
  'the trading licence counts as explained');
select is((select count(*)::int from public.verification_signals
            where org_id = 'd2434000-0000-0000-0000-0000000000f1' and not automatic and kind in ('address', 'licence', 'scope')), 3,
  'each record is kept, as staff''s');

select * from finish();
rollback;
