-- ============================================================================
-- Factories banking in mainland China and Hong Kong withdraw through Tazapay
-- (20261117510000). Mostly negative: what never routes to Tazapay, what a
-- factory cannot write, no step paid both ways, what an off switch refuses,
-- and who cannot read the invoice list or the failure code.
-- `pgtap-c3-` slugs, c31…c3f ids, every number plainly fake.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

set local session_replication_role = replica;

insert into auth.users (id, email) values
  ('c3100000-0000-0000-0000-000000000001', 'pgtap-c3w-cn@example.com'),
  ('c3100000-0000-0000-0000-000000000002', 'pgtap-c3w-hk@example.com'),
  ('c3100000-0000-0000-0000-000000000003', 'pgtap-c3w-gb@example.com'),
  ('c3100000-0000-0000-0000-000000000004', 'pgtap-c3w-wise@example.com'),
  ('c3100000-0000-0000-0000-000000000005', 'pgtap-c3w-staff@example.com'),
  ('c3100000-0000-0000-0000-000000000009', 'pgtap-c3w-brand@example.com');

insert into public.platform_admins (user_id, note) values ('c3100000-0000-0000-0000-000000000005', 'pgtap-c3');

insert into public.orgs (id, type, name, slug) values
  ('c3200000-0000-0000-0000-00000000000b', 'brand',   'PC3W Brand', 'pgtap-c3-w-brand'),
  ('c3200000-0000-0000-0000-0000000000f1', 'factory', 'PC3W Knit', 'pgtap-c3-w-cn'),
  ('c3200000-0000-0000-0000-0000000000f2', 'factory', 'PC3W Kowloon', 'pgtap-c3-w-hk'),
  ('c3200000-0000-0000-0000-0000000000f3', 'factory', 'PC3W Britain', 'pgtap-c3-w-gb'),
  ('c3200000-0000-0000-0000-0000000000f4', 'factory', 'PC3W Wise', 'pgtap-c3-w-wise');

insert into public.org_members (org_id, user_id, role, permissions) values
  ('c3200000-0000-0000-0000-0000000000f1', 'c3100000-0000-0000-0000-000000000001', 'owner', '{}'),
  ('c3200000-0000-0000-0000-0000000000f2', 'c3100000-0000-0000-0000-000000000002', 'owner', '{}'),
  ('c3200000-0000-0000-0000-0000000000f3', 'c3100000-0000-0000-0000-000000000003', 'owner', '{}'),
  ('c3200000-0000-0000-0000-0000000000f4', 'c3100000-0000-0000-0000-000000000004', 'owner', '{}'),
  ('c3200000-0000-0000-0000-00000000000b', 'c3100000-0000-0000-0000-000000000009', 'owner', '{}');

insert into public.factory_profiles (org_id, country_code, moq, onboarding_completed_at) values
  ('c3200000-0000-0000-0000-0000000000f1', 'CN', 100, now()),
  ('c3200000-0000-0000-0000-0000000000f2', 'HK', 100, now()),
  ('c3200000-0000-0000-0000-0000000000f3', 'GB', 100, now()),
  ('c3200000-0000-0000-0000-0000000000f4', 'CN', 100, now());

-- One order each for the CN and HK factories.
insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total)
select ('c3300000-0000-0000-0000-00000000001' || n)::uuid, 'c3200000-0000-0000-0000-00000000000b', 'PC3W request ' || n, 'awarded', 'invited_only', 100
  from generate_series(1, 2) n;
insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity, submitted_at)
select ('c3300000-0000-0000-0000-00000000002' || n)::uuid, ('c3300000-0000-0000-0000-00000000001' || n)::uuid,
       ('c3200000-0000-0000-0000-0000000000f' || n)::uuid, 'accepted', 100, 1, now()
  from generate_series(1, 2) n;
insert into public.production_orders
  (id, rfq_id, quote_id, brand_org_id, factory_org_id, unit_price_cents,
   production_quantity, bulk_subtotal_cents, sample_subtotal_cents, order_total_cents, deposit_pct, balance_pct, order_number)
select ('c3400000-0000-0000-0000-00000000000' || n)::uuid, ('c3300000-0000-0000-0000-00000000001' || n)::uuid,
       ('c3300000-0000-0000-0000-00000000002' || n)::uuid, 'c3200000-0000-0000-0000-00000000000b',
       ('c3200000-0000-0000-0000-0000000000f' || n)::uuid, 1000, 1, 1000, 0, 1000, 50, 50, 'PC3W-' || n
  from generate_series(1, 2) n;

-- CN: two funded steps the brand has not approved yet (US$40 and US$25).
-- HK: two steps approved before the migration and outside the balance, as
-- 20261116300100 left them; the second already has a Tazapay payout under way.
insert into public.order_milestones (id, order_id, kind, title, amount_cents) values
  ('c3500000-0000-0000-0000-000000000011', 'c3400000-0000-0000-0000-000000000001', 'payment_only', 'PC3W deposit', 4000),
  ('c3500000-0000-0000-0000-000000000012', 'c3400000-0000-0000-0000-000000000001', 'payment_only', 'PC3W balance', 2500),
  ('c3500000-0000-0000-0000-000000000021', 'c3400000-0000-0000-0000-000000000002', 'payment_only', 'PC3W owed', 3000),
  ('c3500000-0000-0000-0000-000000000022', 'c3400000-0000-0000-0000-000000000002', 'payment_only', 'PC3W under way', 3000);
insert into public.order_payments (id, order_id, milestone_id, amount_cents, currency, state, confirmed_at, release_requested_at) values
  ('c3600000-0000-0000-0000-000000000011', 'c3400000-0000-0000-0000-000000000001', 'c3500000-0000-0000-0000-000000000011', 4000, 'USD', 'confirmed', now(), null),
  ('c3600000-0000-0000-0000-000000000012', 'c3400000-0000-0000-0000-000000000001', 'c3500000-0000-0000-0000-000000000012', 2500, 'USD', 'confirmed', now(), null),
  ('c3600000-0000-0000-0000-000000000021', 'c3400000-0000-0000-0000-000000000002', 'c3500000-0000-0000-0000-000000000021', 3000, 'USD', 'confirmed', now(), now()),
  ('c3600000-0000-0000-0000-000000000022', 'c3400000-0000-0000-0000-000000000002', 'c3500000-0000-0000-0000-000000000022', 3000, 'USD', 'confirmed', now(), now());

-- Accounts: a complete mainland one (Tazapay), a complete Hong Kong one
-- (Tazapay), a British company's US bank and a Taiwan bank (staff send by
-- bank), and a Chinese account Wise pays.
insert into public.factory_payout_accounts
  (id, org_id, method, bank_name, account_name, account_number_last4, bank_country, is_primary,
   holder_name_local, registration_number, address_line1, address_city, address_state, bank_code, swift, details_changed_at, number_changed_at)
values ('c3700000-0000-0000-0000-000000000001', 'c3200000-0000-0000-0000-0000000000f1', 'bank', 'Bank of China', 'PC3W KNIT CO LTD', '1001', 'CN', true,
        '深圳市测试针织有限公司', '91440300MA5G8X2Q73', '1 Test Road', 'Shenzhen', null, null, null, '2026-11-01 00:00:00+00', now()),
       ('c3700000-0000-0000-0000-000000000002', 'c3200000-0000-0000-0000-0000000000f2', 'bank', 'HSBC', 'PC3W KOWLOON LTD', '1002', 'HK', true,
        null, null, '1 Test Road', 'Kwun Tong', 'Kowloon', '004', 'HSBCHKHH', '2026-11-01 00:00:00+00', now()),
       ('c3700000-0000-0000-0000-000000000003', 'c3200000-0000-0000-0000-0000000000f3', 'bank', 'Demo Bank', 'PC3W BRITAIN LTD', '1003', 'US', true,
        null, null, null, null, null, null, 'CHASUS33', '2026-11-01 00:00:00+00', now()),
       ('c3700000-0000-0000-0000-000000000005', 'c3200000-0000-0000-0000-0000000000f3', 'bank', 'Demo Bank', 'PC3W BRITAIN LTD', '1005', 'TW', false,
        null, null, null, null, null, null, 'BKTWTWTP', '2026-11-01 00:00:00+00', now());
insert into public.factory_payout_accounts
  (id, org_id, method, bank_name, account_name, account_number_last4, swift, bank_country, is_primary,
   wise_recipient_type, wise_currency, wise_number_key, wise_details, details_changed_at, number_changed_at)
values ('c3700000-0000-0000-0000-000000000004', 'c3200000-0000-0000-0000-0000000000f4', 'bank', 'Demo Bank', 'PC3W WISE LTD', '1004', 'BOSHCNSH', 'CN', true,
        'chinese_local_business', 'CNY', 'accountNumber', '{"accountHolderName":"PC3W WISE LTD"}', '2026-11-01 00:00:00+00', now());
insert into public.payout_account_numbers (account_id, vault_secret_id, number_kind)
values ('c3700000-0000-0000-0000-000000000001', vault.create_secret('0000000000c31001', 'payout-number-c3w-1'), 'account'),
       ('c3700000-0000-0000-0000-000000000002', vault.create_secret('0000000000c31002', 'payout-number-c3w-2'), 'account');
insert into public.company_registrations (org_id, country_code, number)
values ('c3200000-0000-0000-0000-0000000000f1', 'CN', '91440300MA5G8X2Q73');

-- The HK factory's second step: a per-step Tazapay payout already processing.
insert into public.provider_payouts (id, payment_id, factory_org_id, account_id, provider, status, paid_to, amount_cents, currency)
values ('c3800000-0000-0000-0000-000000000022', 'c3600000-0000-0000-0000-000000000022', 'c3200000-0000-0000-0000-0000000000f2',
        'c3700000-0000-0000-0000-000000000002', 'tazapay', 'processing', 'HSBC ending 1002', 3000, 'USD');
insert into public.provider_payout_attempts (payout_id) values ('c3800000-0000-0000-0000-000000000022');

set local session_replication_role = origin;

create function pg_temp.act_as(who int) returns void language sql as $f$
  select set_config('request.jwt.claims',
    json_build_object('sub', 'c3100000-0000-0000-0000-' || lpad(who::text, 12, '0'), 'role', 'authenticated')::text, true);
$f$;
grant execute on function pg_temp.act_as(int) to authenticated, anon, service_role;
create function pg_temp.acct(n int) returns public.factory_payout_accounts language sql as $f$
  select * from public.factory_payout_accounts where id = ('c3700000-0000-0000-0000-00000000000' || n)::uuid;
$f$;
grant execute on function pg_temp.acct(int) to authenticated, service_role;

-- --- Which provider pays an account -----------------------------------------------
select is(public.withdrawal_provider_for(pg_temp.acct(1)), 'tazapay', 'a mainland China bank with no Wise recipient is Tazapay''s');
select is(public.withdrawal_provider_for(pg_temp.acct(2)), 'tazapay', 'and a Hong Kong one');
select is(public.withdrawal_provider_for(pg_temp.acct(3)), 'bank', 'a US bank never routes to Tazapay');
select is(public.withdrawal_provider_for(pg_temp.acct(5)), 'bank', 'nor a Taiwan bank');
select is(public.withdrawal_provider_for(pg_temp.acct(4)), 'wise', 'a Chinese account with a Wise recipient stays Wise''s');

-- --- What the migration pooled (its own statement, run on these fixtures) ---------
select public.join_owed_to_pool(x.org_id)
  from (select distinct a.org_id from public.factory_payout_accounts a
         where a.is_primary and public.tazapay_pays_account(a) and a.org_id = 'c3200000-0000-0000-0000-0000000000f2') x;
select ok((select withdrawal_pool from public.order_payments where id = 'c3600000-0000-0000-0000-000000000021'),
  'an owed step of a Tazapay factory joins its balance');
select ok(not (select withdrawal_pool from public.order_payments where id = 'c3600000-0000-0000-0000-000000000022'),
  'a step whose Tazapay payout is under way does not');
select is(public.factory_withdrawable('c3200000-0000-0000-0000-0000000000f2'), 3000::bigint, 'only the owed step is in the balance');

-- --- Approving joins the balance now --------------------------------------------
update public.order_payments set release_requested_at = now() - interval '2 minutes' where id = 'c3600000-0000-0000-0000-000000000011';
update public.order_payments set release_requested_at = now() - interval '1 minute' where id = 'c3600000-0000-0000-0000-000000000012';
select ok((select bool_and(withdrawal_pool) from public.order_payments
            where id in ('c3600000-0000-0000-0000-000000000011', 'c3600000-0000-0000-0000-000000000012')),
  'a mainland factory''s approved steps join its balance');
select is(public.factory_withdrawable('c3200000-0000-0000-0000-0000000000f1'), 6500::bigint, 'and it can withdraw them');

-- --- No step paid both ways --------------------------------------------------------
select pg_temp.act_as(5); set local role authenticated;
select throws_ok($$ select public.claim_provider_payout('c3600000-0000-0000-0000-000000000011', 'tazapay', '2026-11-01 00:00:00+00', false) $$,
  '22023', 'this payment is in the factory''s balance: it is paid when the factory withdraws', 'Pay with Tazapay is refused on a step in the balance');
select throws_ok($$ select public.claim_provider_payout('c3600000-0000-0000-0000-000000000021', 'tazapay', '2026-11-01 00:00:00+00', false) $$,
  '22023', 'this payment is in the factory''s balance: it is paid when the factory withdraws', 'and on a step the migration pooled');
select throws_ok($$ select public.claim_provider_payout_to_tell('c3600000-0000-0000-0000-000000000011', '2026-11-01 00:00:00+00') $$,
  '22023', null, 'a tell cannot start a per-step payout on it either');
select is((public.claim_provider_payout('c3600000-0000-0000-0000-000000000022', 'tazapay', '2026-11-01 00:00:00+00', false)) ->> 'resumed', 'true',
  'a step whose per-step payout already started carries on');
-- The number: not for steps in the balance alone.
select throws_ok($$ select * from public.payout_tazapay_beneficiary('c3700000-0000-0000-0000-000000000001') $$,
  '22023', 'TSC does not owe this company a payout by hand, so its number stays hidden', 'no Tazapay withdrawal open: the number stays hidden');
reset role;

-- An incomplete Tazapay account is refused when asked, not when staff pay.
select set_config('request.jwt.claims', '', true);
update public.factory_payout_accounts set holder_name_local = null where id = 'c3700000-0000-0000-0000-000000000001';
select pg_temp.act_as(1); set local role authenticated;
select throws_ok($$ select public.request_withdrawal('c3200000-0000-0000-0000-0000000000f1', 100, 'c3700000-0000-0000-0000-000000000001') $$,
  '22023', 'Complete this withdrawal method first.', 'a mainland account missing what Tazapay needs is refused');
reset role;
select set_config('request.jwt.claims', '', true);
update public.factory_payout_accounts set holder_name_local = '深圳市测试针织有限公司' where id = 'c3700000-0000-0000-0000-000000000001';
update public.factory_payout_accounts set details_changed_at = '2026-11-01 00:00:00+00' where id = 'c3700000-0000-0000-0000-000000000001';

-- --- The factory cannot write where it is paid ------------------------------------
select pg_temp.act_as(1); set local role authenticated;
select throws_ok($$ insert into public.factory_withdrawals (org_id, provider, amount_cents, paid_to)
    values ('c3200000-0000-0000-0000-0000000000f1', 'tazapay', 100, 'x') $$, '42501', null, 'a factory cannot write a withdrawal itself');
select throws_ok($$ update public.order_payments set withdrawal_pool = false where id = 'c3600000-0000-0000-0000-000000000011' $$,
  '42501', null, 'nor take a step out of its balance');
select throws_ok($$ select public.set_payout_provider('tazapay', 'china', false) $$, '42501', null, 'nor switch Tazapay');
select throws_ok($$ update public.payout_provider_settings set enabled = false where provider = 'tazapay' $$, '42501', null, 'nor write the switch');
select throws_ok($$ insert into public.payout_provider_settings (provider, region, enabled) values ('tazapay', 'elsewhere', true) $$,
  '42501', null, 'nor add one');
select is((public.request_withdrawal('c3200000-0000-0000-0000-0000000000f1', 3000, 'c3700000-0000-0000-0000-000000000001')).provider, 'tazapay',
  'a withdrawal to the mainland account is Tazapay''s, decided by the database');
select is((public.request_withdrawal('c3200000-0000-0000-0000-0000000000f1', 3500, 'c3700000-0000-0000-0000-000000000001')).provider, 'tazapay',
  'and a second one while the first waits');
select throws_ok($$ update public.factory_withdrawals set provider = 'bank' where org_id = 'c3200000-0000-0000-0000-0000000000f1' $$,
  '42501', null, 'nor change its provider afterwards');
select throws_ok($$ select * from public.withdrawal_invoice_steps((select id from public.factory_withdrawals where org_id = 'c3200000-0000-0000-0000-0000000000f1' limit 1)) $$,
  '42501', null, 'nor read the invoice list (server only)');
reset role;

-- --- Staff: the number for an open Tazapay withdrawal, and approve ---------------
select pg_temp.act_as(9); set local role authenticated;
select throws_ok($$ select * from public.payout_tazapay_beneficiary('c3700000-0000-0000-0000-000000000001') $$, '42501', null, 'the brand cannot read the number');
reset role; select pg_temp.act_as(5); set local role authenticated;
select is((select account_number from public.payout_tazapay_beneficiary('c3700000-0000-0000-0000-000000000001')), '0000000000c31001',
  'staff read the number for an open Tazapay withdrawal');
create temp table c3w on commit drop as
  select (select id from public.factory_withdrawals where org_id = 'c3200000-0000-0000-0000-0000000000f1' and amount_cents = 3000) as w1,
         (select id from public.factory_withdrawals where org_id = 'c3200000-0000-0000-0000-0000000000f1' and amount_cents = 3500) as w2;
grant select on c3w to authenticated, service_role;
select is(public.claim_withdrawal((select w1 from c3w)) ->> 'provider', 'tazapay', 'staff approve the first through Tazapay');
select is(public.claim_withdrawal((select w2 from c3w)) ->> 'provider', 'tazapay', 'and the second');
reset role;
-- The first was approved first.
update public.factory_withdrawals set decided_at = now() - interval '1 minute' where id = (select w1 from c3w);

-- --- The invoice lists what the database releases ----------------------------------
set local role service_role;
select is((select string_agg(payment_id || ':' || amount_cents, ',' order by payment_id) from public.withdrawal_invoice_steps((select w1 from c3w))),
  'c3600000-0000-0000-0000-000000000011:3000', 'the first withdrawal pays US$30 of the oldest step');
select is((select string_agg(payment_id || ':' || amount_cents || ':' || step_title || ':' || order_number, ',' order by payment_id)
             from public.withdrawal_invoice_steps((select w2 from c3w))),
  'c3600000-0000-0000-0000-000000000011:1000:PC3W deposit:PC3W-1,c3600000-0000-0000-0000-000000000012:2500:PC3W balance:PC3W-1',
  'the second pays the rest of it and the next step, with titles and order numbers');
reset role;

-- --- Switched off: nothing new, what is under way finishes ---------------------------
select pg_temp.act_as(5); set local role authenticated;
select throws_ok($$ select public.set_payout_provider('tazapay', 'elsewhere', false) $$, '22023', null, 'Tazapay has no switch but China''s');
select is((public.set_payout_provider('tazapay', 'china', false)).enabled, false, 'staff switch Tazapay off');
reset role; select pg_temp.act_as(1); set local role authenticated;
select is(public.payout_providers_for('c3200000-0000-0000-0000-0000000000f1') ->> 'tazapay', 'false', 'the factory reads Tazapay as off');
select throws_ok($$ select public.save_tazapay_payout_account('c3200000-0000-0000-0000-0000000000f1', null, 'HK', 'HSBC', 'PC3W KNIT CO LTD', null, null,
    '004', 'HSBCHKHH', '1 Test Road', 'Kowloon', 'Kowloon', '0000000000c31009', '0000000000c31009') $$,
  '22023', 'this withdrawal method is not available right now', 'a new Hong Kong bank account is refused while it is off');
reset role; select pg_temp.act_as(3); set local role authenticated;
select throws_ok($$ select public.save_tazapay_payout_account('c3200000-0000-0000-0000-0000000000f3', null, 'HK', 'HSBC', 'PC3W BRITAIN LTD', null, null,
    '004', 'HSBCHKHH', '1 Test Road', 'Kowloon', 'Kowloon', '0000000000c31008', '0000000000c31008') $$,
  '22023', 'this withdrawal method is not available right now', 'so is one for a company outside China: the switch covers every account Tazapay pays');
reset role;
select is((select count(*)::int from public.factory_payout_accounts
            where org_id in ('c3200000-0000-0000-0000-0000000000f1', 'c3200000-0000-0000-0000-0000000000f3')), 3, 'no account was added');

-- The withdrawals already approved finish.
set local role service_role;
select is((public.record_withdrawal((select w1 from c3w), 'paid', 'pot_c3w1', 500, 17500, 'CNY')).status, 'paid', 'the first is recorded paid');
select is((public.record_withdrawal((select w2 from c3w), 'failed', null, null, null, null, 'Your bank didn''t accept this payout.')).status, 'failed',
  'the second is recorded failed');
select ok(public.record_withdrawal_failure_code((select w2 from c3w), 'PF020106'), 'and Tazapay''s code is kept');
select ok(not public.record_withdrawal_failure_code((select w2 from c3w), 'Bank account 0000000000c31001 is invalid'), 'never a sentence');
select ok(not public.record_withdrawal_failure_code((select w2 from c3w), '0000000000c31001'), 'never the account number');
select ok(not public.record_withdrawal_failure_code((select w1 from c3w), 'PF020106'), 'nor a code on a withdrawal that did not fail');
reset role;
select is((select code from public.withdrawal_failure_codes where withdrawal_id = (select w2 from c3w)), 'PF020106', 'the kept code is the code');
select is((select state from public.order_payments where id = 'c3600000-0000-0000-0000-000000000011'), 'confirmed',
  'a step the paid withdrawals cover only in part is not released');

-- The balance is back (the failed one), and still nothing new goes to Tazapay while it is off.
select is(public.factory_withdrawable('c3200000-0000-0000-0000-0000000000f1'), 3500::bigint, 'the failed withdrawal is back in the balance');
select pg_temp.act_as(1); set local role authenticated;
select throws_ok($$ select public.request_withdrawal('c3200000-0000-0000-0000-0000000000f1', 100, 'c3700000-0000-0000-0000-000000000001') $$,
  '22023', 'This withdrawal method is not available right now.', 'a new Tazapay withdrawal is refused while it is off');
reset role;

-- Staff read the code on the board; nobody else reads it.
select pg_temp.act_as(5); set local role authenticated;
select is((select w ->> 'failure_code' from jsonb_array_elements(public.admin_withdrawals() -> 'withdrawals') w
            where (w ->> 'id')::uuid = (select w2 from c3w)), 'PF020106', 'staff read the code on the board');
reset role; select pg_temp.act_as(1); set local role authenticated;
select throws_ok($$ select * from public.withdrawal_failure_codes $$, '42501', null, 'the factory cannot read the code table');
select throws_ok($$ select public.record_withdrawal_failure_code((select w2 from c3w), 'PF1') $$, '42501', null, 'nor write a code');
select throws_ok($$ select public.admin_withdrawals() $$, '42501', null, 'nor read the board');
reset role; set local role anon;
select throws_ok($$ select * from public.withdrawal_failure_codes $$, '42501', null, 'signed out reads nothing');
reset role;

select * from finish();
rollback;
