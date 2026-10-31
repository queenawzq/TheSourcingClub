-- ============================================================================
-- Removing the bank account TSC pays in one step (20261030000100)
-- ----------------------------------------------------------------------------
-- Run with:  supabase test db
--
-- `pgtap30-` slugs and 30a…/30b… ids, every check scoped to these fixtures.
--
-- What this protects: removing the account TSC pays while others exist moves
-- the mark to the one chosen (else the newest) in the same call; the last
-- account may be removed; money staff are sending still keeps the last one;
-- only the company's owner may remove, and never another company's account.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(9);

set local session_replication_role = replica;

insert into auth.users (id, email) values
  ('30a00000-0000-0000-0000-000000000001', 'p30-owner@example.com'),
  ('30a00000-0000-0000-0000-000000000002', 'p30-member@example.com'),
  ('30a00000-0000-0000-0000-000000000003', 'p30-owed-owner@example.com');

insert into public.orgs (id, type, name, slug) values
  ('30b00000-0000-0000-0000-00000000000b', 'brand',   'P30 Brand',     'pgtap30-brand'),
  ('30b00000-0000-0000-0000-0000000000f1', 'factory', 'P30 Mill',      'pgtap30-mill'),
  ('30b00000-0000-0000-0000-0000000000f2', 'factory', 'P30 Owed Mill', 'pgtap30-owed-mill');

insert into public.org_members (org_id, user_id, role) values
  ('30b00000-0000-0000-0000-0000000000f1', '30a00000-0000-0000-0000-000000000001', 'owner'),
  ('30b00000-0000-0000-0000-0000000000f1', '30a00000-0000-0000-0000-000000000002', 'member'),
  ('30b00000-0000-0000-0000-0000000000f2', '30a00000-0000-0000-0000-000000000003', 'owner');

insert into public.factory_payout_accounts (id, org_id, is_primary, bank_name, account_name, created_at) values
  ('30c00000-0000-0000-0000-000000000001', '30b00000-0000-0000-0000-0000000000f1', true,  'P30 First',  'P30 Mill Ltd', now() - interval '3 days'),
  ('30c00000-0000-0000-0000-000000000002', '30b00000-0000-0000-0000-0000000000f1', false, 'P30 Second', 'P30 Mill Ltd', now() - interval '2 days'),
  ('30c00000-0000-0000-0000-000000000003', '30b00000-0000-0000-0000-0000000000f1', false, 'P30 Third',  'P30 Mill Ltd', now() - interval '1 day'),
  ('30c00000-0000-0000-0000-0000000000f2', '30b00000-0000-0000-0000-0000000000f2', true,  'P30 Owed',   'P30 Owed Mill Ltd', now());

insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total) values
  ('30d00000-0000-0000-0000-000000000001', '30b00000-0000-0000-0000-00000000000b', 'P30 order', 'awarded', 'invited_only', 100);
insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity, submitted_at) values
  ('30e00000-0000-0000-0000-000000000001', '30d00000-0000-0000-0000-000000000001', '30b00000-0000-0000-0000-0000000000f2', 'accepted', 100, 1, now());
insert into public.production_orders
  (id, rfq_id, quote_id, brand_org_id, factory_org_id, unit_price_cents,
   production_quantity, bulk_subtotal_cents, sample_subtotal_cents, order_total_cents, deposit_pct, balance_pct)
values
  ('30f00000-0000-0000-0000-000000000001', '30d00000-0000-0000-0000-000000000001', '30e00000-0000-0000-0000-000000000001',
   '30b00000-0000-0000-0000-00000000000b', '30b00000-0000-0000-0000-0000000000f2', 50000, 1, 50000, 0, 50000, 50, 50);
insert into public.order_milestones (id, order_id, kind, title, amount_cents) values
  ('30900000-0000-0000-0000-000000000001', '30f00000-0000-0000-0000-000000000001', 'payment_only', 'P30 deposit', 50000);
insert into public.order_payments (id, order_id, milestone_id, amount_cents, currency, state, confirmed_at, release_requested_at) values
  ('30800000-0000-0000-0000-000000000001', '30f00000-0000-0000-0000-000000000001', '30900000-0000-0000-0000-000000000001', 50000, 'USD', 'confirmed', now(), now());

set local session_replication_role = origin;

-- A member who is not an owner.
select set_config('request.jwt.claims', json_build_object('sub', '30a00000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  $$ select public.remove_payout_account('30c00000-0000-0000-0000-000000000001') $$,
  '42501', null, 'a member who is not an owner cannot remove a payout account'
);
reset role;

-- The owner.
select set_config('request.jwt.claims', json_build_object('sub', '30a00000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;

select throws_ok(
  $$ select public.remove_payout_account('30c00000-0000-0000-0000-0000000000f2') $$,
  'P0002', null, 'another company''s account is not there to remove'
);

-- Removing the primary with a choice: the chosen one is paid next.
select is(
  public.remove_payout_account('30c00000-0000-0000-0000-000000000001', '30c00000-0000-0000-0000-000000000002'),
  '30c00000-0000-0000-0000-000000000002'::uuid,
  'removing the account TSC pays makes the chosen one the account TSC pays'
);
select is(
  (select array_agg(id order by id) from public.factory_payout_accounts where org_id = '30b00000-0000-0000-0000-0000000000f1' and is_primary),
  array['30c00000-0000-0000-0000-000000000002'::uuid],
  'exactly one account is paid afterwards'
);

-- Removing the primary without a choice: the newest other one is paid next.
select is(
  public.remove_payout_account('30c00000-0000-0000-0000-000000000002'),
  '30c00000-0000-0000-0000-000000000003'::uuid,
  'without a choice, the most recently added account becomes the one TSC pays'
);

-- The last one may go: TSC then holds the released earnings.
select is(
  public.remove_payout_account('30c00000-0000-0000-0000-000000000003'),
  null::uuid,
  'the last payout account can be removed'
);
select is(
  (select count(*)::int from public.factory_payout_accounts where org_id = '30b00000-0000-0000-0000-0000000000f1'),
  0,
  'the company has no payout account left'
);
reset role;

-- The owed company's last account: staff are sending money to it now.
select set_config('request.jwt.claims', json_build_object('sub', '30a00000-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  $$ select public.remove_payout_account('30c00000-0000-0000-0000-0000000000f2') $$,
  'P0001',
  'TSC is about to pay this account, so it cannot be removed until that payment is sent',
  'the last account cannot be removed while TSC is sending it a payment'
);
reset role;

select is(
  (select count(*)::int from public.factory_payout_accounts where id = '30c00000-0000-0000-0000-0000000000f2'),
  1,
  'the owed account is still there'
);

select * from finish();
rollback;
