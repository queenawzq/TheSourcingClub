-- ============================================================================
-- Removing a bank-paid factory's payout account (20261029000300)
-- ----------------------------------------------------------------------------
-- Run with:  supabase test db
--
-- `pgtap29-` slugs and 29a…/29b… ids, every check scoped to these fixtures.
--
-- What this protects: an owner cannot remove the bank account TSC is about
-- to pay by bank, and can once that payment is sent; a factory Stripe pays
-- is not held back by it; server code is never refused. With several
-- accounts, the one TSC pays cannot be removed until another is chosen, and
-- only the company's owner chooses (set_primary_payout_account).
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(10);

-- Fixtures without their triggers (state guards, fee, notifications): this
-- suite is about the delete guard alone.
set local session_replication_role = replica;

insert into auth.users (id, email) values
  ('29a00000-0000-0000-0000-000000000001', 'p29-bank-owner@example.com'),
  ('29a00000-0000-0000-0000-000000000002', 'p29-stripe-owner@example.com');

insert into public.orgs (id, type, name, slug) values
  ('29b00000-0000-0000-0000-00000000000b', 'brand',   'P29 Brand',        'pgtap29-brand'),
  ('29b00000-0000-0000-0000-0000000000f1', 'factory', 'P29 Bank Mill',    'pgtap29-bank-mill'),
  ('29b00000-0000-0000-0000-0000000000f2', 'factory', 'P29 Stripe Mill',  'pgtap29-stripe-mill');

-- permissions is filled by a trigger, which replica mode skips.
insert into public.org_members (org_id, user_id, role, permissions) values
  ('29b00000-0000-0000-0000-0000000000f1', '29a00000-0000-0000-0000-000000000001', 'owner', '{primaryContact}'),
  ('29b00000-0000-0000-0000-0000000000f2', '29a00000-0000-0000-0000-000000000002', 'owner', '{primaryContact}');

insert into public.stripe_connect_accounts (org_id, stripe_account_id, country, details_submitted, payouts_enabled, transfers_active) values
  ('29b00000-0000-0000-0000-0000000000f2', 'acct_p29stripe', 'GB', true, true, true);

insert into public.factory_payout_accounts (id, org_id, is_primary, bank_name, account_name) values
  ('29c00000-0000-0000-0000-0000000000f1', '29b00000-0000-0000-0000-0000000000f1', true, 'P29 Bank', 'P29 Bank Mill Ltd'),
  ('29c00000-0000-0000-0000-0000000000f2', '29b00000-0000-0000-0000-0000000000f2', true, 'P29 Bank', 'P29 Stripe Mill Ltd');

insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total) values
  ('29d00000-0000-0000-0000-000000000001', '29b00000-0000-0000-0000-00000000000b', 'P29 bank order', 'awarded', 'invited_only', 100),
  ('29d00000-0000-0000-0000-000000000002', '29b00000-0000-0000-0000-00000000000b', 'P29 stripe order', 'awarded', 'invited_only', 100);
insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity, submitted_at) values
  ('29e00000-0000-0000-0000-000000000001', '29d00000-0000-0000-0000-000000000001', '29b00000-0000-0000-0000-0000000000f1', 'accepted', 100, 1, now()),
  ('29e00000-0000-0000-0000-000000000002', '29d00000-0000-0000-0000-000000000002', '29b00000-0000-0000-0000-0000000000f2', 'accepted', 100, 1, now());
insert into public.production_orders
  (id, rfq_id, quote_id, brand_org_id, factory_org_id, unit_price_cents,
   production_quantity, bulk_subtotal_cents, sample_subtotal_cents, order_total_cents, deposit_pct, balance_pct)
values
  ('29f00000-0000-0000-0000-000000000001', '29d00000-0000-0000-0000-000000000001', '29e00000-0000-0000-0000-000000000001',
   '29b00000-0000-0000-0000-00000000000b', '29b00000-0000-0000-0000-0000000000f1', 124800, 1, 124800, 0, 124800, 50, 50),
  ('29f00000-0000-0000-0000-000000000002', '29d00000-0000-0000-0000-000000000002', '29e00000-0000-0000-0000-000000000002',
   '29b00000-0000-0000-0000-00000000000b', '29b00000-0000-0000-0000-0000000000f2', 124800, 1, 124800, 0, 124800, 50, 50);
insert into public.order_milestones (id, order_id, kind, title, amount_cents) values
  ('29900000-0000-0000-0000-000000000001', '29f00000-0000-0000-0000-000000000001', 'payment_only', 'P29 deposit', 124800),
  ('29900000-0000-0000-0000-000000000002', '29f00000-0000-0000-0000-000000000002', 'payment_only', 'P29 deposit', 124800);
-- Both approved and still held: owed to each factory.
insert into public.order_payments (id, order_id, milestone_id, amount_cents, currency, state, confirmed_at, release_requested_at) values
  ('29800000-0000-0000-0000-000000000001', '29f00000-0000-0000-0000-000000000001', '29900000-0000-0000-0000-000000000001', 124800, 'USD', 'confirmed', now(), now()),
  ('29800000-0000-0000-0000-000000000002', '29f00000-0000-0000-0000-000000000002', '29900000-0000-0000-0000-000000000002', 124800, 'USD', 'confirmed', now(), now());

set local session_replication_role = origin;

-- The bank-paid factory's owner, while TSC owes it a bank payout.
select set_config('request.jwt.claims', json_build_object('sub', '29a00000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;

select throws_ok(
  $$ delete from public.factory_payout_accounts where id = '29c00000-0000-0000-0000-0000000000f1' $$,
  'P0001',
  'TSC is about to pay this account, so it cannot be removed until that payment is sent',
  'an owner cannot remove the bank account TSC is about to pay'
);

reset role;
select is(
  (select count(*)::int from public.factory_payout_accounts where id = '29c00000-0000-0000-0000-0000000000f1'),
  1, 'and the account is still there'
);

-- Paid out by staff: nothing is owed, so the owner may remove it.
update public.order_payments set state = 'released', released_at = now()
 where id = '29800000-0000-0000-0000-000000000001';
select set_config('request.jwt.claims', json_build_object('sub', '29a00000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok(
  $$ delete from public.factory_payout_accounts where id = '29c00000-0000-0000-0000-0000000000f1' $$,
  'once the payment is sent, the owner can remove the account'
);
reset role;
select is(
  (select count(*)::int from public.factory_payout_accounts where id = '29c00000-0000-0000-0000-0000000000f1'),
  0, 'and it is gone'
);

-- A factory Stripe pays: its bank row is not where the money goes.
select set_config('request.jwt.claims', json_build_object('sub', '29a00000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok(
  $$ delete from public.factory_payout_accounts where id = '29c00000-0000-0000-0000-0000000000f2' $$,
  'a factory paid through Stripe is not held back by money Stripe will pay'
);
reset role;

-- Server code (seed reset, test-data purge) is never refused.
update public.order_payments set state = 'confirmed', released_at = null
 where id = '29800000-0000-0000-0000-000000000001';
insert into public.factory_payout_accounts (id, org_id, is_primary, bank_name, account_name) values
  ('29c00000-0000-0000-0000-0000000000f3', '29b00000-0000-0000-0000-0000000000f1', true, 'P29 Bank', 'P29 Bank Mill Ltd');
select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
select lives_ok(
  $$ delete from public.factory_payout_accounts where id = '29c00000-0000-0000-0000-0000000000f3' $$,
  'server code can still remove it'
);

-- Two bank accounts: the one TSC pays (A) and a second one (B).
reset role;
select set_config('request.jwt.claims', null, true);
insert into public.factory_payout_accounts (id, org_id, is_primary, bank_name, account_name) values
  ('29c00000-0000-0000-0000-0000000000a1', '29b00000-0000-0000-0000-0000000000f1', true,  'P29 Bank A', 'P29 Bank Mill Ltd'),
  ('29c00000-0000-0000-0000-0000000000a2', '29b00000-0000-0000-0000-0000000000f1', false, 'P29 Bank B', 'P29 Bank Mill Ltd');

select set_config('request.jwt.claims', json_build_object('sub', '29a00000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  $$ delete from public.factory_payout_accounts where id = '29c00000-0000-0000-0000-0000000000a1' $$,
  'P0001',
  'this is the account TSC pays: choose another account for TSC to pay before removing it',
  'the account TSC pays cannot be removed while another exists'
);
select lives_ok(
  $$ select public.set_primary_payout_account('29c00000-0000-0000-0000-0000000000a2') $$,
  'the owner chooses the second account for TSC to pay'
);
reset role;

-- Someone who owns another company cannot move it back.
select set_config('request.jwt.claims', json_build_object('sub', '29a00000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  $$ select public.set_primary_payout_account('29c00000-0000-0000-0000-0000000000a1') $$,
  'P0002',
  'that bank account does not exist',
  'nobody outside the company chooses which account TSC pays: its accounts are not even visible to them'
);
reset role;

select set_config('request.jwt.claims', json_build_object('sub', '29a00000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok(
  $$ delete from public.factory_payout_accounts where id = '29c00000-0000-0000-0000-0000000000a1' $$,
  'and the first account, no longer the one TSC pays, can then be removed'
);
reset role;

select * from finish();
rollback;
