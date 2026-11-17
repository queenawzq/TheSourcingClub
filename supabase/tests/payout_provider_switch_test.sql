-- Staff switch PayPal and Wise on and off per region (20261117200000).
-- Mostly negative: who cannot switch, what an off switch refuses, and that a
-- withdrawal already asked for still finishes.
begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

set local session_replication_role = replica;

insert into auth.users (id, email) values
  ('5a000000-0000-0000-0000-000000000001', 'pgtap-sw-cn-owner@example.com'),
  ('5a000000-0000-0000-0000-000000000002', 'pgtap-sw-gb-owner@example.com'),
  ('5a000000-0000-0000-0000-000000000003', 'pgtap-sw-brand@example.com'),
  ('5a000000-0000-0000-0000-000000000004', 'pgtap-sw-staff@example.com'),
  ('5a000000-0000-0000-0000-000000000005', 'pgtap-sw-hk-owner@example.com');

insert into public.platform_admins (user_id, note) values ('5a000000-0000-0000-0000-000000000004', 'pgtap-sw');

insert into public.orgs (id, type, name, slug) values
  ('5b000000-0000-0000-0000-00000000000b', 'brand',   'SW Brand',    'pgtap-sw-brand'),
  ('5b000000-0000-0000-0000-0000000000c1', 'factory', 'SW China',    'pgtap-sw-china'),
  ('5b000000-0000-0000-0000-0000000000e1', 'factory', 'SW Britain',  'pgtap-sw-britain'),
  ('5b000000-0000-0000-0000-0000000000a1', 'factory', 'SW Kowloon',  'pgtap-sw-kowloon');

insert into public.org_members (org_id, user_id, role, permissions) values
  ('5b000000-0000-0000-0000-0000000000c1', '5a000000-0000-0000-0000-000000000001', 'owner', '{}'),
  ('5b000000-0000-0000-0000-0000000000e1', '5a000000-0000-0000-0000-000000000002', 'owner', '{}'),
  ('5b000000-0000-0000-0000-00000000000b', '5a000000-0000-0000-0000-000000000003', 'owner', '{}'),
  ('5b000000-0000-0000-0000-0000000000a1', '5a000000-0000-0000-0000-000000000005', 'owner', '{}');

insert into public.factory_profiles (org_id, country_code, moq, onboarding_completed_at) values
  ('5b000000-0000-0000-0000-0000000000c1', 'CN', 100, now()),
  ('5b000000-0000-0000-0000-0000000000e1', 'GB', 100, now()),
  ('5b000000-0000-0000-0000-0000000000a1', 'HK', 100, now());

-- Each of the two factories has $1,000 approved in its withdrawal balance.
insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total) values
  ('5c000000-0000-0000-0000-0000000000c1', '5b000000-0000-0000-0000-00000000000b', 'SW china request', 'awarded', 'invited_only', 100),
  ('5c000000-0000-0000-0000-0000000000e1', '5b000000-0000-0000-0000-00000000000b', 'SW britain request', 'awarded', 'invited_only', 100);
insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity, submitted_at) values
  ('5c000000-0000-0000-0000-0000000000c2', '5c000000-0000-0000-0000-0000000000c1', '5b000000-0000-0000-0000-0000000000c1', 'accepted', 100, 1, now()),
  ('5c000000-0000-0000-0000-0000000000e2', '5c000000-0000-0000-0000-0000000000e1', '5b000000-0000-0000-0000-0000000000e1', 'accepted', 100, 1, now());
insert into public.production_orders
  (id, rfq_id, quote_id, brand_org_id, factory_org_id, unit_price_cents,
   production_quantity, bulk_subtotal_cents, sample_subtotal_cents, order_total_cents, deposit_pct, balance_pct, order_number)
values
  ('5d000000-0000-0000-0000-0000000000c1', '5c000000-0000-0000-0000-0000000000c1', '5c000000-0000-0000-0000-0000000000c2',
   '5b000000-0000-0000-0000-00000000000b', '5b000000-0000-0000-0000-0000000000c1', 1000, 1, 1000, 0, 1000, 50, 50, 'PSW-1'),
  ('5d000000-0000-0000-0000-0000000000e1', '5c000000-0000-0000-0000-0000000000e1', '5c000000-0000-0000-0000-0000000000e2',
   '5b000000-0000-0000-0000-00000000000b', '5b000000-0000-0000-0000-0000000000e1', 1000, 1, 1000, 0, 1000, 50, 50, 'PSW-2');
insert into public.order_milestones (id, order_id, kind, title, amount_cents) values
  ('5e000000-0000-0000-0000-0000000000c1', '5d000000-0000-0000-0000-0000000000c1', 'payment_only', 'SW step', 100000),
  ('5e000000-0000-0000-0000-0000000000e1', '5d000000-0000-0000-0000-0000000000e1', 'payment_only', 'SW step', 100000);
insert into public.order_payments (id, order_id, milestone_id, amount_cents, currency, state, confirmed_at, release_requested_at, withdrawal_pool) values
  ('5f000000-0000-0000-0000-0000000000c1', '5d000000-0000-0000-0000-0000000000c1', '5e000000-0000-0000-0000-0000000000c1', 100000, 'USD', 'confirmed', now(), now(), true),
  ('5f000000-0000-0000-0000-0000000000e1', '5d000000-0000-0000-0000-0000000000e1', '5e000000-0000-0000-0000-0000000000e1', 100000, 'USD', 'confirmed', now(), now(), true);

-- Saved before any switch went off: PayPal at both, and a Wise bank at the Chinese one.
insert into public.factory_payout_accounts (id, org_id, method, paypal_email, is_primary, details_changed_at) values
  ('5a100000-0000-0000-0000-0000000000c1', '5b000000-0000-0000-0000-0000000000c1', 'paypal', 'pgtap-sw-cn@example.com', true, now()),
  ('5a100000-0000-0000-0000-0000000000e1', '5b000000-0000-0000-0000-0000000000e1', 'paypal', 'pgtap-sw-gb@example.com', true, now());
insert into public.factory_payout_accounts
  (id, org_id, method, bank_name, account_name, account_number_last4, swift, bank_country, is_primary,
   wise_recipient_type, wise_currency, wise_number_key, wise_details, details_changed_at, number_changed_at)
values ('5a100000-0000-0000-0000-0000000000c2', '5b000000-0000-0000-0000-0000000000c1', 'bank', 'SW Bank', 'SW CHINA LTD', '1234', 'BOSHCNSH', 'CN', false,
        'chinese_local_business', 'CNY', 'accountNumber', '{"accountHolderName":"SW CHINA LTD"}', now(), now());
set local session_replication_role = origin;

create function pg_temp.act_as(who int) returns void language sql as $f$
  select set_config('request.jwt.claims',
    json_build_object('sub', '5a000000-0000-0000-0000-' || lpad(who::text, 12, '0'), 'role', 'authenticated')::text, true);
$f$;
grant execute on function pg_temp.act_as(int) to authenticated, anon, service_role;

-- The migration's starting state.
select is((select count(*)::int from public.payout_provider_settings), 5, 'five switches (Tazapay has one, 20261117510000)');
select is((select string_agg(provider || ':' || region || ':' || enabled, ',' order by provider, region) from public.payout_provider_settings),
  'paypal:china:true,paypal:elsewhere:true,tazapay:china:true,wise:china:false,wise:elsewhere:false', 'PayPal on and Wise off, in both regions; Tazapay on');

-- Nobody but staff switches, and nobody writes the table.
set local role anon;
select throws_ok($$select public.set_payout_provider('paypal', 'china', false)$$, '42501', null, 'anon cannot switch');
select throws_ok($$select * from public.payout_provider_settings$$, '42501', null, 'anon cannot read the switches');
select throws_ok($$select public.payout_providers_for('5b000000-0000-0000-0000-0000000000c1')$$, '42501', null, 'anon cannot ask a company''s providers');
reset role; select pg_temp.act_as(1); set local role authenticated;
select throws_ok($$select public.set_payout_provider('paypal', 'china', false)$$, '42501', null, 'a factory owner cannot switch');
select throws_ok($$update public.payout_provider_settings set enabled = false$$, '42501', null, 'a factory owner cannot update the table');
select throws_ok($$insert into public.payout_provider_settings (provider, region, enabled) values ('paypal', 'china', false)$$, '42501', null, 'a factory owner cannot insert');
select throws_ok($$delete from public.payout_provider_settings$$, '42501', null, 'a factory owner cannot delete');
select throws_ok($$select public.payout_region('5b000000-0000-0000-0000-0000000000c1')$$, '42501', null, 'the region rule is not callable');
select throws_ok($$select public.payout_provider_enabled('5b000000-0000-0000-0000-0000000000c1', 'paypal')$$, '42501', null, 'the internal check is not callable');
select is((select count(*)::int from public.payout_provider_settings), 5, 'a factory reads the switches');
select is(public.payout_providers_for('5b000000-0000-0000-0000-0000000000c1'), '{"region":"china","paypal":true,"wise":false,"tazapay":true}'::jsonb, 'a factory reads its own providers');
select throws_ok($$select public.payout_providers_for('5b000000-0000-0000-0000-0000000000e1')$$, '42501', null, 'not another company''s');
reset role; select pg_temp.act_as(3); set local role authenticated;
select throws_ok($$select public.set_payout_provider('wise', 'elsewhere', true)$$, '42501', null, 'a brand cannot switch');
reset role; select pg_temp.act_as(5); set local role authenticated;
select is(public.payout_providers_for('5b000000-0000-0000-0000-0000000000a1')->>'region', 'china', 'Hong Kong is in the China region');
reset role; select pg_temp.act_as(2); set local role authenticated;
select is(public.payout_providers_for('5b000000-0000-0000-0000-0000000000e1')->>'region', 'elsewhere', 'Britain is elsewhere');

-- Staff: a withdrawal asked for while PayPal is on, then PayPal off for China.
reset role; select pg_temp.act_as(1); set local role authenticated;
select lives_ok($$select public.request_withdrawal('5b000000-0000-0000-0000-0000000000c1', 40000, '5a100000-0000-0000-0000-0000000000c1')$$, 'asked to PayPal while it is on');
reset role; select pg_temp.act_as(4); set local role authenticated;
select throws_ok($$select public.set_payout_provider('paypal', 'mars', false)$$, '22023', null, 'an unknown region is refused');
select throws_ok($$select public.set_payout_provider('paypal', 'china', null)$$, '22023', null, 'neither on nor off is refused');
select is((public.set_payout_provider('paypal', 'china', false)).enabled, false, 'staff switch PayPal off for China');
select is((select updated_by from public.payout_provider_settings where provider = 'paypal' and region = 'china'),
  '5a000000-0000-0000-0000-000000000004'::uuid, 'and who did it is kept');

-- Off for China: the Chinese factory cannot withdraw to PayPal, the British one still can.
reset role; select pg_temp.act_as(1); set local role authenticated;
select is(public.payout_providers_for('5b000000-0000-0000-0000-0000000000c1')->>'paypal', 'false', 'the factory reads PayPal as off');
select throws_ok($$select public.request_withdrawal('5b000000-0000-0000-0000-0000000000c1', 10000, '5a100000-0000-0000-0000-0000000000c1')$$,
  '22023', 'This withdrawal method is not available right now.', 'a new withdrawal to PayPal is refused while it is off for China');
select throws_ok($$select public.request_withdrawal('5b000000-0000-0000-0000-0000000000c1', 10000, '5a100000-0000-0000-0000-0000000000c2')$$,
  '22023', 'This withdrawal method is not available right now.', 'and to Wise, which starts off');
select throws_ok($$insert into public.factory_payout_accounts (org_id, method, paypal_email, is_primary) values ('5b000000-0000-0000-0000-0000000000c1', 'paypal', 'pgtap-sw-cn2@example.com', false)$$,
  '22023', null, 'a new PayPal method is refused while it is off');
select is((select count(*)::int from public.factory_payout_accounts where org_id = '5b000000-0000-0000-0000-0000000000c1'), 2, 'the saved methods stay');
select throws_ok($$select public.save_wise_payout_account('5b000000-0000-0000-0000-0000000000c1', null, 'SW Bank', 'chinese_local_business', 'CNY',
    '{"legalType":"BUSINESS","accountHolderName":"SW CHINA LTD","swiftCode":"BKCHCNBJ","address.country":"CN","address.city":"Ningbo","address.firstLine":"1 Road"}'::jsonb,
    'accountNumber', '0000 0000 0000 5678', '0000 0000 0000 5678')$$,
  '22023', null, 'a new Wise method is refused while Wise is off');
reset role; select pg_temp.act_as(2); set local role authenticated;
select lives_ok($$select public.request_withdrawal('5b000000-0000-0000-0000-0000000000e1', 10000, '5a100000-0000-0000-0000-0000000000e1')$$, 'elsewhere, PayPal still works');
select lives_ok($$insert into public.factory_payout_accounts (org_id, method, paypal_email, is_primary) values ('5b000000-0000-0000-0000-0000000000e1', 'paypal', 'pgtap-sw-gb2@example.com', false)$$,
  'elsewhere, a new PayPal method is saved');
select throws_ok($$select public.save_wise_payout_account('5b000000-0000-0000-0000-0000000000e1', null, 'SW Bank', 'sort_code', 'GBP',
    '{"legalType":"BUSINESS","accountHolderName":"SW BRITAIN LTD","sortCode":"040004","address.country":"GB","address.city":"London","address.firstLine":"1 Road"}'::jsonb,
    'accountNumber', '12345678', '12345678')$$,
  '22023', null, 'a new Wise method is refused elsewhere too while Wise is off');

-- The withdrawal asked for before the switch still finishes.
reset role; select pg_temp.act_as(4); set local role authenticated;
select is((public.claim_withdrawal((select id from public.factory_withdrawals where org_id = '5b000000-0000-0000-0000-0000000000c1' and status = 'requested')))->>'provider',
  'paypal', 'staff still approve the open PayPal withdrawal');
reset role;
select is((public.record_withdrawal((select id from public.factory_withdrawals where org_id = '5b000000-0000-0000-0000-0000000000c1' and status = 'paying'), 'paid', 'SWBATCH', 0, 40000, 'USD')).status,
  'paid', 'and the server records it paid');

-- Still off for China: a saved PayPal address can be corrected.
select pg_temp.act_as(1); set local role authenticated;
select lives_ok($$update public.factory_payout_accounts set paypal_email = 'pgtap-sw-cn3@example.com' where id = '5a100000-0000-0000-0000-0000000000c1'$$, 'a saved PayPal address can still be corrected');
reset role;

-- Back on: the Chinese factory withdraws again; Wise on for China lets it save Wise.
select pg_temp.act_as(4); set local role authenticated;
select lives_ok($$select public.set_payout_provider('paypal', 'china', true)$$, 'staff switch PayPal back on');
select lives_ok($$select public.set_payout_provider('wise', 'china', true)$$, 'staff switch Wise on for China');
reset role; select pg_temp.act_as(1); set local role authenticated;
select lives_ok($$select public.request_withdrawal('5b000000-0000-0000-0000-0000000000c1', 10000, '5a100000-0000-0000-0000-0000000000c1')$$, 'PayPal on again: the withdrawal goes');
select lives_ok($$select public.request_withdrawal('5b000000-0000-0000-0000-0000000000c1', 10000, '5a100000-0000-0000-0000-0000000000c2')$$, 'Wise on for China: the saved Wise bank is offered again');
select lives_ok($$select public.save_wise_payout_account('5b000000-0000-0000-0000-0000000000c1', null, 'SW Bank', 'chinese_local_business', 'CNY',
    '{"legalType":"BUSINESS","accountHolderName":"SW CHINA LTD","swiftCode":"BKCHCNBJ","address.country":"CN","address.city":"Ningbo","address.firstLine":"1 Road"}'::jsonb,
    'accountNumber', '0000 0000 0000 5678', '0000 0000 0000 5678')$$, 'Wise on for China: a new Wise method is saved');
reset role; select pg_temp.act_as(2); set local role authenticated;
select is(public.payout_providers_for('5b000000-0000-0000-0000-0000000000e1')->>'wise', 'false', 'Wise stays off elsewhere');
reset role;

select * from finish();
rollback;
