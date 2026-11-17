-- Adding a withdrawal method never changes the default (20261117300000): the
-- first method a factory saves is its default, every later one is just added,
-- and Stripe becoming able to pay does not take over from a saved method.
begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

set local session_replication_role = replica;

insert into auth.users (id, email) values
  ('7da00000-0000-0000-0000-000000000001', 'pgtap-dk-paypal-owner@example.com'),
  ('7da00000-0000-0000-0000-000000000002', 'pgtap-dk-stripe-owner@example.com'),
  ('7da00000-0000-0000-0000-000000000003', 'pgtap-dk-bank-owner@example.com');

insert into public.orgs (id, type, name, slug) values
  ('7db00000-0000-0000-0000-0000000000a1', 'factory', 'DK PayPal first', 'pgtap-dk-paypal'),
  ('7db00000-0000-0000-0000-0000000000b1', 'factory', 'DK Stripe first', 'pgtap-dk-stripe'),
  ('7db00000-0000-0000-0000-0000000000c1', 'factory', 'DK Bank first',   'pgtap-dk-bank');

insert into public.org_members (org_id, user_id, role, permissions) values
  ('7db00000-0000-0000-0000-0000000000a1', '7da00000-0000-0000-0000-000000000001', 'owner', '{}'),
  ('7db00000-0000-0000-0000-0000000000b1', '7da00000-0000-0000-0000-000000000002', 'owner', '{}'),
  ('7db00000-0000-0000-0000-0000000000c1', '7da00000-0000-0000-0000-000000000003', 'owner', '{}');

insert into public.factory_profiles (org_id, country_code, moq, onboarding_completed_at) values
  ('7db00000-0000-0000-0000-0000000000a1', 'GB', 100, now()),
  ('7db00000-0000-0000-0000-0000000000b1', 'GB', 100, now()),
  ('7db00000-0000-0000-0000-0000000000c1', 'CN', 100, now());

-- Stripe can already pay the second factory.
insert into public.stripe_connect_accounts (org_id, stripe_account_id, country, transfers_active)
values ('7db00000-0000-0000-0000-0000000000b1', 'acct_dk_fake', 'GB', true);
set local session_replication_role = origin;

-- Wise is off at first; staff switch it on for China so the third factory can save one.
update public.payout_provider_settings set enabled = true where provider = 'wise' and region = 'china';

create function pg_temp.act_as(who int) returns void language sql as $f$
  select set_config('request.jwt.claims',
    json_build_object('sub', '7da00000-0000-0000-0000-' || lpad(who::text, 12, '0'), 'role', 'authenticated')::text, true);
$f$;
grant execute on function pg_temp.act_as(int) to authenticated, anon, service_role;

create function pg_temp.primary_of(org text) returns text language sql as $f$
  select coalesce(paypal_email, bank_name) from public.factory_payout_accounts where org_id = org::uuid and is_primary;
$f$;
grant execute on function pg_temp.primary_of(text) to authenticated;

-- PayPal first, no Stripe: the first is the default, the rest are only added.
select pg_temp.act_as(1); set local role authenticated;
select lives_ok($$insert into public.factory_payout_accounts (org_id, method, paypal_email, is_primary)
  values ('7db00000-0000-0000-0000-0000000000a1', 'paypal', 'pgtap-dk-first@example.com', true)$$, 'the first PayPal account is saved');
select is(pg_temp.primary_of('7db00000-0000-0000-0000-0000000000a1'), 'pgtap-dk-first@example.com', 'the first method saved is the default');
select lives_ok($$select public.save_bank_payout_account(
    target_org => '7db00000-0000-0000-0000-0000000000a1', bank_name => 'DK Bank', account_name => 'DK PAYPAL FIRST LTD',
    bank_country => 'GB', swift => 'BARCGB22', account_number => '0000000012345678', account_number_again => '0000000012345678')$$,
  'a bank account is added beside it');
select is(pg_temp.primary_of('7db00000-0000-0000-0000-0000000000a1'), 'pgtap-dk-first@example.com', 'adding a bank account leaves the default');
select lives_ok($$insert into public.factory_payout_accounts (org_id, method, paypal_email, is_primary)
  values ('7db00000-0000-0000-0000-0000000000a1', 'paypal', 'pgtap-dk-second@example.com', false)$$, 'a second PayPal account is added');
select is(pg_temp.primary_of('7db00000-0000-0000-0000-0000000000a1'), 'pgtap-dk-first@example.com', 'adding a second PayPal account leaves the default');
select is((select count(*)::int from public.factory_payout_accounts where org_id = '7db00000-0000-0000-0000-0000000000a1' and is_primary), 1, 'one default');
select is((select route from public.factory_payout_preferences where org_id = '7db00000-0000-0000-0000-0000000000a1'), 'manual',
  'the saved method is recorded as the route');
reset role;

-- Then a Stripe bank, and Stripe becomes able to pay: the default stays PayPal.
insert into public.stripe_connect_accounts (org_id, stripe_account_id, country, transfers_active)
values ('7db00000-0000-0000-0000-0000000000a1', 'acct_dk_later', 'GB', false);
update public.stripe_connect_accounts set transfers_active = true where org_id = '7db00000-0000-0000-0000-0000000000a1';
select ok(not public.uses_stripe_payout('7db00000-0000-0000-0000-0000000000a1'), 'Stripe set up later does not take over from PayPal');
select ok(public.withdraws_from_balance('7db00000-0000-0000-0000-0000000000a1'), 'the factory still withdraws to its saved method');
select pg_temp.act_as(1); set local role authenticated;
select is(pg_temp.primary_of('7db00000-0000-0000-0000-0000000000a1'), 'pgtap-dk-first@example.com', 'and PayPal is still the saved default');
-- Make default still moves it.
select lives_ok($$select public.choose_payout_method('7db00000-0000-0000-0000-0000000000a1', null)$$, 'Make default on Stripe still works');
reset role;
select ok(public.uses_stripe_payout('7db00000-0000-0000-0000-0000000000a1'), 'Stripe is the default once chosen');

-- Stripe first: a PayPal account added beside it does not take over.
select pg_temp.act_as(2); set local role authenticated;
select lives_ok($$insert into public.factory_payout_accounts (org_id, method, paypal_email, is_primary)
  values ('7db00000-0000-0000-0000-0000000000b1', 'paypal', 'pgtap-dk-beside-stripe@example.com', true)$$, 'PayPal is added beside Stripe');
select is((select count(*)::int from public.factory_payout_preferences where org_id = '7db00000-0000-0000-0000-0000000000b1'), 0,
  'no route is written when Stripe was there first');
reset role;
select ok(public.uses_stripe_payout('7db00000-0000-0000-0000-0000000000b1'), 'Stripe stays the default after PayPal is added');

-- A Wise bank first, then another Wise bank: the first stays the default.
select pg_temp.act_as(3); set local role authenticated;
select lives_ok($$select public.save_wise_payout_account('7db00000-0000-0000-0000-0000000000c1', null, 'DK First Bank', 'chinese_local_business', 'CNY',
    '{"legalType":"BUSINESS","accountHolderName":"DK BANK FIRST LTD","swiftCode":"BKCHCNBJ","address.country":"CN","address.city":"Ningbo","address.firstLine":"1 Road"}'::jsonb,
    'accountNumber', '0000 0000 0000 1111', '0000 0000 0000 1111')$$, 'the first Wise bank is saved');
select is(pg_temp.primary_of('7db00000-0000-0000-0000-0000000000c1'), 'DK First Bank', 'the first Wise bank is the default');
select lives_ok($$select public.save_wise_payout_account('7db00000-0000-0000-0000-0000000000c1', null, 'DK Second Bank', 'chinese_local_business', 'CNY',
    '{"legalType":"BUSINESS","accountHolderName":"DK BANK FIRST LTD","swiftCode":"BKCHCNBJ","address.country":"CN","address.city":"Ningbo","address.firstLine":"1 Road"}'::jsonb,
    'accountNumber', '0000 0000 0000 2222', '0000 0000 0000 2222')$$, 'a second Wise bank is added');
select is(pg_temp.primary_of('7db00000-0000-0000-0000-0000000000c1'), 'DK First Bank', 'adding a second Wise bank leaves the default');
reset role;

-- Nobody calls the trigger function.
select ok(not has_function_privilege('authenticated', 'public.keep_manual_route_on_method()', 'execute'), 'the route trigger is not callable');

select * from finish();
rollback;
