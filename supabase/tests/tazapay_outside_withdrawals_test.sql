-- ============================================================================
-- A factory Tazapay pays stays on the per-step path (20261116300100), while a
-- Wise or PayPal factory's approved step still joins its withdrawal balance.
-- `pgtap-c3-` slugs, c3a…/c3b… ids, every number plainly fake.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;

select plan(10);

set local session_replication_role = replica;

insert into auth.users (id, email) values
  ('c3a00000-0000-0000-0000-000000000001', 'pc3-cn@example.com'),
  ('c3a00000-0000-0000-0000-000000000002', 'pc3-hk@example.com'),
  ('c3a00000-0000-0000-0000-000000000003', 'pc3-paypal@example.com'),
  ('c3a00000-0000-0000-0000-000000000004', 'pc3-wise@example.com'),
  ('c3a00000-0000-0000-0000-000000000005', 'pc3-staff@example.com'),
  ('c3a00000-0000-0000-0000-000000000009', 'pc3-brand@example.com');

insert into public.platform_admins (user_id, note) values ('c3a00000-0000-0000-0000-000000000005', 'pgtap-c3');

insert into public.orgs (id, type, name, slug) values
  ('c3b00000-0000-0000-0000-00000000000b', 'brand',   'PC3 Brand', 'pgtap-c3-brand'),
  ('c3b00000-0000-0000-0000-0000000000f1', 'factory', '深圳市测试针织有限公司', 'pgtap-c3-cn'),
  ('c3b00000-0000-0000-0000-0000000000f2', 'factory', 'PC3 Kowloon Ltd', 'pgtap-c3-hk'),
  ('c3b00000-0000-0000-0000-0000000000f3', 'factory', 'PC3 PayPal Mill', 'pgtap-c3-paypal'),
  ('c3b00000-0000-0000-0000-0000000000f4', 'factory', 'PC3 Wise Mill', 'pgtap-c3-wise');

insert into public.org_members (org_id, user_id, role, permissions) values
  ('c3b00000-0000-0000-0000-0000000000f1', 'c3a00000-0000-0000-0000-000000000001', 'owner', '{}'),
  ('c3b00000-0000-0000-0000-0000000000f2', 'c3a00000-0000-0000-0000-000000000002', 'owner', '{}'),
  ('c3b00000-0000-0000-0000-0000000000f3', 'c3a00000-0000-0000-0000-000000000003', 'owner', '{}'),
  ('c3b00000-0000-0000-0000-0000000000f4', 'c3a00000-0000-0000-0000-000000000004', 'owner', '{}'),
  ('c3b00000-0000-0000-0000-00000000000b', 'c3a00000-0000-0000-0000-000000000009', 'owner', '{}');

-- One order per factory (n = 1..4), each with one funded step not approved yet.
insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total)
select ('c3c00000-0000-0000-0000-00000000001' || n)::uuid, 'c3b00000-0000-0000-0000-00000000000b', 'PC3 request ' || n, 'awarded', 'invited_only', 100
  from generate_series(1, 4) n;
insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity, submitted_at)
select ('c3c00000-0000-0000-0000-00000000002' || n)::uuid, ('c3c00000-0000-0000-0000-00000000001' || n)::uuid,
       ('c3b00000-0000-0000-0000-0000000000f' || n)::uuid, 'accepted', 100, 1, now()
  from generate_series(1, 4) n;
insert into public.production_orders
  (id, rfq_id, quote_id, brand_org_id, factory_org_id, unit_price_cents,
   production_quantity, bulk_subtotal_cents, sample_subtotal_cents, order_total_cents, deposit_pct, balance_pct, order_number)
select ('c3d00000-0000-0000-0000-00000000000' || n)::uuid, ('c3c00000-0000-0000-0000-00000000001' || n)::uuid,
       ('c3c00000-0000-0000-0000-00000000002' || n)::uuid, 'c3b00000-0000-0000-0000-00000000000b',
       ('c3b00000-0000-0000-0000-0000000000f' || n)::uuid, 1000, 1, 1000, 0, 1000, 50, 50, 'PC3-' || n
  from generate_series(1, 4) n;
insert into public.order_milestones (id, order_id, kind, title, amount_cents)
select ('c3e00000-0000-0000-0000-00000000000' || n)::uuid, ('c3d00000-0000-0000-0000-00000000000' || n)::uuid, 'payment_only', 'PC3 step ' || n, 6500
  from generate_series(1, 4) n;
insert into public.order_payments (id, order_id, milestone_id, amount_cents, currency, state, confirmed_at)
select ('c3f00000-0000-0000-0000-00000000000' || n)::uuid, ('c3d00000-0000-0000-0000-00000000000' || n)::uuid,
       ('c3e00000-0000-0000-0000-00000000000' || n)::uuid, 6500, 'USD', 'confirmed', now()
  from generate_series(1, 4) n;

-- A complete mainland account Tazapay pays, a Hong Kong one, PayPal, and a
-- Chinese account Wise pays (a Wise recipient on it).
insert into public.factory_payout_accounts
  (id, org_id, method, bank_name, account_name, account_number_last4, bank_country, is_primary,
   holder_name_local, registration_number, address_line1, address_city, address_state, bank_code, swift, details_changed_at)
values ('c3a10000-0000-0000-0000-000000000001', 'c3b00000-0000-0000-0000-0000000000f1', 'bank', 'Bank of China', 'PC3 KNIT CO LTD', '0001', 'CN', true,
        '深圳市测试针织有限公司', '91440300MA5G8X2Q73', '1 Test Road', 'Shenzhen', null, null, null, '2026-11-01 00:00:00+00'),
       ('c3a10000-0000-0000-0000-000000000002', 'c3b00000-0000-0000-0000-0000000000f2', 'bank', 'HSBC', 'PC3 KOWLOON LTD', '0002', 'HK', true,
        null, null, '1 Test Road', 'Kwun Tong', 'Kowloon', '004', 'HSBCHKHH', '2026-11-01 00:00:00+00');
insert into public.factory_payout_accounts (id, org_id, method, paypal_email, is_primary, details_changed_at)
values ('c3a10000-0000-0000-0000-000000000003', 'c3b00000-0000-0000-0000-0000000000f3', 'paypal', 'pc3@example.com', true, '2026-11-01 00:00:00+00');
insert into public.factory_payout_accounts
  (id, org_id, method, bank_name, account_name, account_number_last4, swift, bank_country, is_primary,
   wise_recipient_type, wise_currency, wise_number_key, wise_details, details_changed_at, number_changed_at)
values ('c3a10000-0000-0000-0000-000000000004', 'c3b00000-0000-0000-0000-0000000000f4', 'bank', 'Demo Bank', 'PC3 WISE LTD', '0004', 'BOSHCNSH', 'CN', true,
        'chinese_local_business', 'CNY', 'accountNumber', '{"accountHolderName":"PC3 WISE LTD"}', '2026-11-01 00:00:00+00', now());
insert into public.payout_account_numbers (account_id, vault_secret_id, number_kind)
values ('c3a10000-0000-0000-0000-000000000001', vault.create_secret('0000000000c30001', 'payout-number-c3-1'), 'account'),
       ('c3a10000-0000-0000-0000-000000000002', vault.create_secret('0000000000c30002', 'payout-number-c3-2'), 'account');
insert into public.company_registrations (org_id, country_code, number)
values ('c3b00000-0000-0000-0000-0000000000f1', 'CN', '91440300MA5G8X2Q73');

set local session_replication_role = origin;

-- The brand approves each step (the join trigger runs as it does in production).
update public.order_payments set release_requested_at = now()
 where id in ('c3f00000-0000-0000-0000-000000000001', 'c3f00000-0000-0000-0000-000000000002',
              'c3f00000-0000-0000-0000-000000000003', 'c3f00000-0000-0000-0000-000000000004');

select ok(not (select withdrawal_pool from public.order_payments where id = 'c3f00000-0000-0000-0000-000000000001'),
  'a mainland China factory Tazapay pays: its approved step is not put in a balance');
select ok(not (select withdrawal_pool from public.order_payments where id = 'c3f00000-0000-0000-0000-000000000002'),
  'a Hong Kong factory Tazapay pays: nor is its step');
select ok((select withdrawal_pool from public.order_payments where id = 'c3f00000-0000-0000-0000-000000000003'),
  'a PayPal factory''s approved step still joins its balance');
select ok((select withdrawal_pool from public.order_payments where id = 'c3f00000-0000-0000-0000-000000000004'),
  'a Chinese account Wise pays still joins its balance');
select is(public.factory_withdrawable('c3b00000-0000-0000-0000-0000000000f1'), 0::bigint, 'the Tazapay factory has nothing to withdraw');
select is(public.factory_withdrawable('c3b00000-0000-0000-0000-0000000000f3'), 6500::bigint, 'the PayPal factory has its step to withdraw');

-- Saving the default again (what a factory does when it edits its account) does not pool what it is owed.
update public.factory_payout_accounts set is_primary = true where id = 'c3a10000-0000-0000-0000-000000000001';
select ok(not (select withdrawal_pool from public.order_payments where id = 'c3f00000-0000-0000-0000-000000000001'),
  'and saving its account again leaves the step to be paid on its own');

-- Staff pay the Tazapay factory's step on its own.
select set_config('request.jwt.claims', json_build_object('sub', 'c3a00000-0000-0000-0000-000000000005', 'role', 'authenticated')::text, true);
set local role authenticated;
select ok((public.claim_provider_payout('c3f00000-0000-0000-0000-000000000001', 'tazapay',
  (select details_changed_at from public.factory_payout_accounts where id = 'c3a10000-0000-0000-0000-000000000001'), false)) ->> 'key' is not null,
  'staff can Pay with Tazapay on the China step');
select ok((public.claim_provider_payout('c3f00000-0000-0000-0000-000000000002', 'tazapay',
  (select details_changed_at from public.factory_payout_accounts where id = 'c3a10000-0000-0000-0000-000000000002'), false)) ->> 'key' is not null,
  'and on the Hong Kong step');
select throws_ok($$ select public.claim_provider_payout('c3f00000-0000-0000-0000-000000000003', 'paypal', '2026-11-01 00:00:00+00', false) $$,
  '22023', null, 'the PayPal factory''s step is paid only by a withdrawal');
reset role;

select * from finish();
rollback;
