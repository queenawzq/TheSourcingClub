-- ============================================================================
-- Tell the factory to fix an incomplete Tazapay account (20261116300000).
-- `pgtap-c3-` slugs, c3a…/c3b… ids, every number plainly fake.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

set local session_replication_role = replica;

insert into auth.users (id, email) values
  ('c3a00000-0000-0000-0000-000000000001', 'pc3-factory@example.com'),
  ('c3a00000-0000-0000-0000-000000000003', 'pc3-brand@example.com'),
  ('c3a00000-0000-0000-0000-000000000005', 'pc3-staff@example.com'),
  ('c3a00000-0000-0000-0000-000000000006', 'pc3-staff-in-factory@example.com');
insert into public.platform_admins (user_id, note) values
  ('c3a00000-0000-0000-0000-000000000005', 'pgtap-c3'),
  ('c3a00000-0000-0000-0000-000000000006', 'pgtap-c3');
insert into public.orgs (id, type, name, slug) values
  ('c3b00000-0000-0000-0000-00000000000b', 'brand',   'PC3 Brand', 'pgtap-c3-brand'),
  ('c3b00000-0000-0000-0000-0000000000f1', 'factory', 'PC3 HK Mill', 'pgtap-c3-mill');
insert into public.org_members (org_id, user_id, role, permissions) values
  ('c3b00000-0000-0000-0000-0000000000f1', 'c3a00000-0000-0000-0000-000000000001', 'owner', '{}'),
  ('c3b00000-0000-0000-0000-0000000000f1', 'c3a00000-0000-0000-0000-000000000006', 'member', '{}'),
  ('c3b00000-0000-0000-0000-00000000000b', 'c3a00000-0000-0000-0000-000000000003', 'owner', '{}');
insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total)
values ('c3c00000-0000-0000-0000-000000000001', 'c3b00000-0000-0000-0000-00000000000b', 'PC3 request', 'awarded', 'invited_only', 100);
insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity, submitted_at)
values ('c3c00000-0000-0000-0000-000000000002', 'c3c00000-0000-0000-0000-000000000001', 'c3b00000-0000-0000-0000-0000000000f1', 'accepted', 100, 1, now());
insert into public.production_orders
  (id, rfq_id, quote_id, brand_org_id, factory_org_id, unit_price_cents,
   production_quantity, bulk_subtotal_cents, sample_subtotal_cents, order_total_cents, deposit_pct, balance_pct, order_number)
values ('c3d00000-0000-0000-0000-000000000001', 'c3c00000-0000-0000-0000-000000000001', 'c3c00000-0000-0000-0000-000000000002',
        'c3b00000-0000-0000-0000-00000000000b', 'c3b00000-0000-0000-0000-0000000000f1', 1000, 1, 1000, 0, 1000, 50, 50, 'PC3-1');
insert into public.order_milestones (id, order_id, kind, title, amount_cents)
values ('c3e00000-0000-0000-0000-000000000001', 'c3d00000-0000-0000-0000-000000000001', 'payment_only', 'PC3 step', 100000);
insert into public.order_payments (id, order_id, milestone_id, amount_cents, currency, state, confirmed_at, release_requested_at)
values ('c3f00000-0000-0000-0000-000000000001', 'c3d00000-0000-0000-0000-000000000001',
        'c3e00000-0000-0000-0000-000000000001', 100000, 'USD', 'confirmed', now(), now());
-- A Hong Kong account with no bank code, SWIFT or district: Tazapay can't pay it yet.
insert into public.factory_payout_accounts
  (id, org_id, method, bank_name, account_name, account_number_last4, bank_country, is_primary, address_line1, address_city, details_changed_at)
values ('c3a10000-0000-0000-0000-000000000001', 'c3b00000-0000-0000-0000-0000000000f1', 'bank', 'HSBC', 'PC3 MILL LTD', '0003', 'HK', true,
        '1 Test Road', 'Hong Kong', '2026-11-01 00:00:00+00');
insert into public.payout_account_numbers (account_id, vault_secret_id, number_kind)
values ('c3a10000-0000-0000-0000-000000000001', vault.create_secret('0000000000c30001', 'payout-number-c3-1'), 'account');

set local session_replication_role = origin;

create function pg_temp.act_as(who int) returns void language sql as $f$
  select set_config('request.jwt.claims',
    json_build_object('sub', 'c3a00000-0000-0000-0000-' || lpad(who::text, 12, '0'), 'role', 'authenticated')::text, true);
$f$;
grant execute on function pg_temp.act_as(int) to authenticated, anon, service_role;

set local role authenticated;

-- The factory, the brand and staff in the factory cannot use it.
select pg_temp.act_as(1);
select throws_ok($$ select public.claim_provider_payout_to_tell('c3f00000-0000-0000-0000-000000000001', '2026-11-01 00:00:00+00') $$,
  '42501', null, 'the factory owner cannot claim to tell');
select pg_temp.act_as(3);
select throws_ok($$ select public.claim_provider_payout_to_tell('c3f00000-0000-0000-0000-000000000001', '2026-11-01 00:00:00+00') $$,
  '42501', null, 'the brand cannot claim to tell');
select pg_temp.act_as(6);
select throws_ok($$ select public.claim_provider_payout_to_tell('c3f00000-0000-0000-0000-000000000001', '2026-11-01 00:00:00+00') $$,
  '42501', null, 'staff who belong to the factory cannot claim to tell');

-- Staff: paying still refuses the incomplete account; telling is allowed.
select pg_temp.act_as(5);
select throws_ok($$ select public.claim_provider_payout('c3f00000-0000-0000-0000-000000000001', 'tazapay', '2026-11-01 00:00:00+00', false) $$,
  '22023', null, 'paying an incomplete Hong Kong account is still refused');
select throws_ok($$ select public.claim_provider_payout_to_tell('c3f00000-0000-0000-0000-000000000001', '2026-01-01 00:00:00+00') $$,
  '22023', null, 'a tell on details that changed since the page read them is refused');
select ok((public.claim_provider_payout_to_tell('c3f00000-0000-0000-0000-000000000001', '2026-11-01 00:00:00+00') ->> 'payout_id') is not null,
  'staff can claim to tell the factory about an incomplete account');
select is(current_setting('tsc.tazapay_tell', true), 'off', 'the tell mark is cleared after the claim');
select throws_ok($$ select public.claim_provider_payout('c3f00000-0000-0000-0000-000000000001', 'tazapay', '2026-11-01 00:00:00+00', false) $$,
  '22023', 'this bank account is missing details Tazapay needs', 'after a tell in the same transaction, paying still runs the full check');
reset role;

select * from finish();
rollback;
