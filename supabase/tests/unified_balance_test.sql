-- One balance for every factory, stage 1 (20261120100000-range migrations).
--
-- Approval only makes a payment owed: nothing is transferred and nothing joins
-- the withdrawal pool, whatever the factory's withdrawal method. Adding or
-- switching a method moves nothing. One function returns the factory's figures,
-- each dollar in exactly one of them. Most of what follows is negative: a
-- policy or function that grants everything passes every positive test.
--
-- Fixtures: slugs pgtap-ub-*, ids ba1?xxxx-...; every count is scoped to them.
begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

update public.payout_provider_settings set enabled = true where provider in ('wise', 'paypal');

set local session_replication_role = replica;

insert into auth.users (id, email) values
  ('ba1a0000-0000-0000-0000-000000000001', 'pgtap-ub-stripe-owner@example.com'),
  ('ba1a0000-0000-0000-0000-000000000002', 'pgtap-ub-paypal-owner@example.com'),
  ('ba1a0000-0000-0000-0000-000000000003', 'pgtap-ub-wise-owner@example.com'),
  ('ba1a0000-0000-0000-0000-000000000004', 'pgtap-ub-bank-owner@example.com'),
  ('ba1a0000-0000-0000-0000-000000000005', 'pgtap-ub-none-owner@example.com'),
  ('ba1a0000-0000-0000-0000-000000000006', 'pgtap-ub-none-member@example.com'),
  ('ba1a0000-0000-0000-0000-000000000007', 'pgtap-ub-brand-owner@example.com'),
  ('ba1a0000-0000-0000-0000-000000000008', 'pgtap-ub-brand-member@example.com'),
  ('ba1a0000-0000-0000-0000-000000000009', 'pgtap-ub-both-hats@example.com'),
  ('ba1a0000-0000-0000-0000-00000000000a', 'pgtap-ub-stranger@example.com'),
  ('ba1a0000-0000-0000-0000-00000000000b', 'pgtap-ub-staff@example.com'),
  ('ba1a0000-0000-0000-0000-00000000000c', 'pgtap-ub-figures-owner@example.com');

insert into public.platform_admins (user_id, note) values ('ba1a0000-0000-0000-0000-00000000000b', 'pgtap-ub');

-- f1 Stripe, f2 PayPal, f3 Wise, f4 bank (staff-paid), f5 no method,
-- f6 a stranger's factory, f7 the figures factory.
insert into public.orgs (id, type, name, slug) values
  ('ba1b0000-0000-0000-0000-00000000000b', 'brand',   'UB Brand',   'pgtap-ub-brand'),
  ('ba1b0000-0000-0000-0000-0000000000f1', 'factory', 'UB Stripe',  'pgtap-ub-stripe'),
  ('ba1b0000-0000-0000-0000-0000000000f2', 'factory', 'UB PayPal',  'pgtap-ub-paypal'),
  ('ba1b0000-0000-0000-0000-0000000000f3', 'factory', 'UB Wise',    'pgtap-ub-wise'),
  ('ba1b0000-0000-0000-0000-0000000000f4', 'factory', 'UB Bank',    'pgtap-ub-bank'),
  ('ba1b0000-0000-0000-0000-0000000000f5', 'factory', 'UB None',    'pgtap-ub-none'),
  ('ba1b0000-0000-0000-0000-0000000000f6', 'factory', 'UB Other',   'pgtap-ub-other'),
  ('ba1b0000-0000-0000-0000-0000000000f7', 'factory', 'UB Figures', 'pgtap-ub-figures');

insert into public.org_members (org_id, user_id, role, permissions) values
  ('ba1b0000-0000-0000-0000-0000000000f1', 'ba1a0000-0000-0000-0000-000000000001', 'owner', '{}'),
  ('ba1b0000-0000-0000-0000-0000000000f2', 'ba1a0000-0000-0000-0000-000000000002', 'owner', '{}'),
  ('ba1b0000-0000-0000-0000-0000000000f3', 'ba1a0000-0000-0000-0000-000000000003', 'owner', '{}'),
  ('ba1b0000-0000-0000-0000-0000000000f4', 'ba1a0000-0000-0000-0000-000000000004', 'owner', '{}'),
  ('ba1b0000-0000-0000-0000-0000000000f5', 'ba1a0000-0000-0000-0000-000000000005', 'owner', '{}'),
  ('ba1b0000-0000-0000-0000-0000000000f5', 'ba1a0000-0000-0000-0000-000000000006', 'member', '{}'),
  ('ba1b0000-0000-0000-0000-0000000000f5', 'ba1a0000-0000-0000-0000-000000000009', 'member', '{}'),
  ('ba1b0000-0000-0000-0000-00000000000b', 'ba1a0000-0000-0000-0000-000000000007', 'owner', '{}'),
  ('ba1b0000-0000-0000-0000-00000000000b', 'ba1a0000-0000-0000-0000-000000000008', 'member', '{}'),
  ('ba1b0000-0000-0000-0000-00000000000b', 'ba1a0000-0000-0000-0000-000000000009', 'member', '{}'),
  ('ba1b0000-0000-0000-0000-0000000000f6', 'ba1a0000-0000-0000-0000-00000000000a', 'owner', '{}'),
  ('ba1b0000-0000-0000-0000-0000000000f7', 'ba1a0000-0000-0000-0000-00000000000c', 'owner', '{}');

-- One request, quote and active order per factory (n = 1..7), each with:
--   step 1: Paid release, funded ($100, cleared), waiting for approval;
--   step 2: Paid release, funded ($50, not yet cleared), waiting for approval.
insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total)
select ('ba1c0000-0000-0000-0000-00000000000' || n)::uuid, 'ba1b0000-0000-0000-0000-00000000000b',
       'UB request ' || n, 'awarded', 'invited_only', 100
  from generate_series(1, 7) n;
insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity, submitted_at)
select ('ba1c1000-0000-0000-0000-00000000000' || n)::uuid, ('ba1c0000-0000-0000-0000-00000000000' || n)::uuid,
       ('ba1b0000-0000-0000-0000-0000000000f' || n)::uuid, 'accepted', 100, 1, now()
  from generate_series(1, 7) n;
insert into public.production_orders
  (id, rfq_id, quote_id, brand_org_id, factory_org_id, unit_price_cents, status, schedule_brand_agreed_at, schedule_brand_agreed_by,
   production_quantity, bulk_subtotal_cents, sample_subtotal_cents, order_total_cents, deposit_pct, balance_pct, order_number)
select ('ba1d0000-0000-0000-0000-00000000000' || n)::uuid, ('ba1c0000-0000-0000-0000-00000000000' || n)::uuid,
       ('ba1c1000-0000-0000-0000-00000000000' || n)::uuid, 'ba1b0000-0000-0000-0000-00000000000b',
       ('ba1b0000-0000-0000-0000-0000000000f' || n)::uuid, 15000, 'active', now() - interval '30 days', 'ba1a0000-0000-0000-0000-000000000007', 1, 15000, 0, 15000, 50, 50, 'UB-' || n
  from generate_series(1, 7) n;
insert into public.order_milestones (id, order_id, kind, title, amount_cents, state, sort)
select ('ba1e000' || s || '-0000-0000-0000-00000000000' || n)::uuid, ('ba1d0000-0000-0000-0000-00000000000' || n)::uuid,
       'approval_and_payment', 'UB step ' || s, case s when 1 then 10000 else 5000 end, 'active', s * 10
  from generate_series(1, 7) n, generate_series(1, 2) s;
insert into public.order_payments
  (id, order_id, milestone_id, amount_cents, currency, state, confirmed_at, stripe_payment_intent_id, stripe_charge_id)
select ('ba1f000' || s || '-0000-0000-0000-00000000000' || n)::uuid, ('ba1d0000-0000-0000-0000-00000000000' || n)::uuid,
       ('ba1e000' || s || '-0000-0000-0000-00000000000' || n)::uuid, case s when 1 then 10000 else 5000 end, 'USD', 'confirmed',
       now() - interval '10 days', 'pi_pgtap_ub_' || s || '_' || n, 'ch_pgtap_ub_' || s || '_' || n
  from generate_series(1, 7) n, generate_series(1, 2) s;

-- When the brand's card money clears (Stripe's available_on): step 1 cleared,
-- step 2 still clearing.
update public.order_payments set funds_available_at = now() - interval '5 days'
 where id::text like 'ba1f0001-%';
update public.order_payments set funds_available_at = now() + interval '2 days'
 where id::text like 'ba1f0002-%';

-- Withdrawal methods, as each factory saved them before this change.
insert into public.stripe_connect_accounts (org_id, stripe_account_id, country, transfers_active, payouts_enabled, details_submitted)
values ('ba1b0000-0000-0000-0000-0000000000f1', 'acct_pgtap_ub_1', 'US', true, true, true);
insert into public.factory_payout_accounts (id, org_id, method, paypal_email, is_primary, details_changed_at)
values ('ba190000-0000-0000-0000-000000000002', 'ba1b0000-0000-0000-0000-0000000000f2', 'paypal', 'pgtap-ub-paypal@example.com', true, '2026-11-01');
insert into public.factory_payout_accounts
  (id, org_id, method, bank_name, account_name, account_number_last4, swift, bank_country, is_primary,
   wise_recipient_type, wise_currency, wise_number_key, wise_details, details_changed_at, number_changed_at)
values ('ba190000-0000-0000-0000-000000000003', 'ba1b0000-0000-0000-0000-0000000000f3', 'bank', 'UB Wise Bank', 'UB WISE LTD', '3333', 'BOSHCNSH', 'CN', true,
        'chinese_local_business', 'CNY', 'accountNumber', '{"accountHolderName":"UB WISE LTD"}', '2026-11-01', now());
insert into public.factory_payout_accounts
  (id, org_id, method, bank_name, account_name, account_number_last4, swift, bank_country, is_primary, details_changed_at, number_changed_at)
values ('ba190000-0000-0000-0000-000000000004', 'ba1b0000-0000-0000-0000-0000000000f4', 'bank', 'UB Hand Bank', 'UB BANK LTD', '4444', 'BCOMPTPL', 'HK', true, '2026-11-01', now());
insert into public.factory_payout_preferences (org_id, route) values
  ('ba1b0000-0000-0000-0000-0000000000f2', 'manual'),
  ('ba1b0000-0000-0000-0000-0000000000f3', 'manual'),
  ('ba1b0000-0000-0000-0000-0000000000f4', 'manual');
set local session_replication_role = origin;

create function pg_temp.act_as(who text) returns void language sql as $f$
  select set_config('request.jwt.claims',
    json_build_object('sub', 'ba1a0000-0000-0000-0000-' || lpad(who, 12, '0'), 'role', 'authenticated')::text, true);
$f$;
grant execute on function pg_temp.act_as(text) to authenticated, anon, service_role;

create function pg_temp.org(n int) returns uuid language sql as $f$
  select ('ba1b0000-0000-0000-0000-0000000000f' || n)::uuid;
$f$;
create function pg_temp.pay(n int, s int) returns uuid language sql as $f$
  select ('ba1f000' || s || '-0000-0000-0000-00000000000' || n)::uuid;
$f$;
create function pg_temp.step(n int, s int) returns uuid language sql as $f$
  select ('ba1e000' || s || '-0000-0000-0000-00000000000' || n)::uuid;
$f$;
grant execute on function pg_temp.org(int), pg_temp.pay(int, int), pg_temp.step(int, int) to authenticated, anon, service_role;

-- The one balance, read as the current role. Keys in cents.
create function pg_temp.bal(n int, k text) returns bigint language sql as $f$
  select (public.factory_balance(pg_temp.org(n)) ->> k)::bigint;
$f$;
grant execute on function pg_temp.bal(int, text) to authenticated, anon, service_role;

-- A payment untouched by any payout road: owed, nothing claimed, nothing moved.
create function pg_temp.owed_untouched(p uuid) returns boolean language sql as $f$
  select state = 'confirmed' and release_requested_at is not null and not withdrawal_pool
     and stripe_transfer_id is null and release_claimed_at is null and not stripe_release_started
     and not exists (select 1 from public.provider_payouts x where x.payment_id = p)
     and not exists (select 1 from public.bank_payouts b where b.payment_id = p)
    from public.order_payments where id = p;
$f$;

create function pg_temp.approve(n int, s int) returns void language plpgsql as $f$
begin
  perform pg_temp.act_as('7');
  set local role authenticated;
  perform public.approve_milestone(pg_temp.step(n, s), null);
  reset role;
end;
$f$;

-- ===========================================================================
-- 1. Before any approval: everything funded is Awaiting approval.
-- ===========================================================================
select pg_temp.act_as('5'); set local role authenticated;
select is(pg_temp.bal(5, 'awaiting_cents'), 15000::bigint, 'funded, not approved: Awaiting approval');
select is(pg_temp.bal(5, 'available_cents'), 0::bigint, 'nothing Available before approval');
select is(pg_temp.bal(5, 'pending_cents'), 0::bigint, 'nothing Pending before approval');
select is(pg_temp.bal(5, 'paid_out_cents'), 0::bigint, 'nothing Paid out before approval');
reset role;

-- ===========================================================================
-- 2. Approving makes a payment owed, on every kind of factory. No transfer, no
--    pool, no claim, no payout row.
-- ===========================================================================
select pg_temp.approve(n, 1) from generate_series(1, 5) n;

select ok(pg_temp.owed_untouched(pg_temp.pay(1, 1)), 'Stripe factory: approval leaves the payment owed, not transferred or claimed');
select ok(pg_temp.owed_untouched(pg_temp.pay(2, 1)), 'PayPal factory: approval does not put the payment in the withdrawal pool');
select ok(pg_temp.owed_untouched(pg_temp.pay(3, 1)), 'Wise factory: approval does not put the payment in the withdrawal pool');
select ok(pg_temp.owed_untouched(pg_temp.pay(4, 1)), 'bank factory: approval does not put the payment in the withdrawal pool');
select ok(pg_temp.owed_untouched(pg_temp.pay(5, 1)), 'factory with no method: approval leaves the payment owed');
select is((select count(*)::int from public.factory_withdrawals where org_id in (select pg_temp.org(n) from generate_series(1, 7) n)), 0,
  'approval opens no withdrawal for anyone');
select is((select count(*)::int from public.stripe_withdrawals where org_id in (select pg_temp.org(n) from generate_series(1, 7) n)), 0,
  'and no Stripe withdrawal');
select is((select state::text from public.order_milestones where id = pg_temp.step(1, 1)), 'complete', 'the step itself completes');

-- The factory is told the money is in its balance, never that it is on its way.
create function pg_temp.approved_note(n int) returns text language sql as $f$
  select coalesce(title, '') || ' | ' || coalesce(body, '') from public.notifications
   where org_id = pg_temp.org(n) and kind = 'milestone_approved' and subject_id = pg_temp.step(n, 1)
   order by created_at desc limit 1;
$f$;
select ok(pg_temp.approved_note(1) like '%$100.00 added to your balance%', 'Stripe factory: "$100.00 added to your balance"');
select ok(pg_temp.approved_note(1) not like '%on its way%', 'and not "on its way"');
select ok(pg_temp.approved_note(1) not like '%Add a withdrawal method to receive earnings.%', 'a factory with a method is not asked to add one');
select ok(pg_temp.approved_note(2) like '%$100.00 added to your balance%' and pg_temp.approved_note(2) not like '%Add a withdrawal method%',
  'PayPal factory: added to your balance, no ask for a method');
select ok(pg_temp.approved_note(3) like '%$100.00 added to your balance%' and pg_temp.approved_note(3) not like '%Add a withdrawal method%',
  'Wise factory: added to your balance, no ask for a method');
select ok(pg_temp.approved_note(4) like '%$100.00 added to your balance%Add a withdrawal method to receive earnings.%',
  'staff-paid bank only: added to your balance, and asked to add a method it can withdraw to');
select ok(pg_temp.approved_note(5) like '%$100.00 added to your balance%', 'no method: "$100.00 added to your balance"');
select ok(pg_temp.approved_note(5) like '%Add a withdrawal method to receive earnings.%', 'and "Add a withdrawal method to receive earnings."');
select ok(pg_temp.approved_note(5) not like '%on its way%', 'and not "on its way"');
select is((select count(*)::int from public.notifications where org_id = pg_temp.org(5) and kind = 'milestone_approved'), 1,
  'one notification for one approval');

-- ===========================================================================
-- 3. The IMG 75 case: no method, $100 owed and cleared. Available, not Pending.
-- ===========================================================================
select pg_temp.act_as('5'); set local role authenticated;
select is(pg_temp.bal(5, 'available_cents'), 10000::bigint, 'no method: owed and cleared money is Available');
select is(pg_temp.bal(5, 'pending_cents'), 0::bigint, 'and not Pending');
select is(pg_temp.bal(5, 'paid_out_cents'), 0::bigint, 'and not Paid out');
select is(pg_temp.bal(5, 'awaiting_cents'), 5000::bigint, 'the step not approved yet is still Awaiting approval');
select is(pg_temp.bal(5, 'total_cents'), 15000::bigint, 'total is everything funded');
select is((public.factory_balance(pg_temp.org(5)) ->> 'has_method')::boolean, false, 'IMG 75: no usable method, so the card offers "Add withdrawal method"');
reset role;

-- ===========================================================================
-- 4. Adding or switching a method moves nothing (D6). The IMG 76 case: after
--    adding PayPal the money is still Available, not Paid out.
-- ===========================================================================
create temp table ub_before on commit drop as
  select id, release_requested_at, state, withdrawal_pool, release_claimed_at from public.order_payments
   where order_id in (select ('ba1d0000-0000-0000-0000-00000000000' || n)::uuid from generate_series(1, 7) n);
create function pg_temp.nothing_moved() returns boolean language sql as $f$
  select not exists (
    select 1 from public.order_payments p join ub_before b on b.id = p.id
     where (p.release_requested_at, p.state, p.withdrawal_pool, p.release_claimed_at, p.stripe_transfer_id, p.stripe_release_started)
       is distinct from (b.release_requested_at, b.state, b.withdrawal_pool, b.release_claimed_at, null::text, false))
  and not exists (select 1 from public.provider_payouts x where x.payment_id in (select id from ub_before))
  and not exists (select 1 from public.factory_withdrawals w where w.org_id in (select pg_temp.org(n) from generate_series(1, 7) n));
$f$;

-- PayPal, saved and made the default by the owner.
insert into public.factory_payout_accounts (id, org_id, method, paypal_email, is_primary, details_changed_at)
values ('ba190000-0000-0000-0000-000000000051', pg_temp.org(5), 'paypal', 'pgtap-ub-none@example.com', true, now());
select ok(pg_temp.nothing_moved(), 'adding PayPal as the default moves nothing');
select pg_temp.act_as('5'); set local role authenticated;
select lives_ok($$select public.choose_payout_method(pg_temp.org(5), 'ba190000-0000-0000-0000-000000000051')$$, 'the owner chooses PayPal');
reset role;
select ok(pg_temp.nothing_moved(), 'choosing PayPal (preference manual) moves nothing');
select pg_temp.act_as('5'); set local role authenticated;
select is(pg_temp.bal(5, 'available_cents'), 10000::bigint, 'IMG 76: after adding PayPal the money is still Available');
select is(pg_temp.bal(5, 'paid_out_cents'), 0::bigint, 'IMG 76: and not Paid out');
select is((public.factory_balance(pg_temp.org(5)) ->> 'has_method')::boolean, true, 'IMG 76: with PayPal saved the card offers Withdraw');
reset role;

-- Wise, then a staff-paid bank account (saved with their numbers, as the
-- add-method functions would).
set local session_replication_role = replica;
insert into public.factory_payout_accounts
  (id, org_id, method, bank_name, account_name, account_number_last4, swift, bank_country, is_primary,
   wise_recipient_type, wise_currency, wise_number_key, wise_details, details_changed_at, number_changed_at)
values ('ba190000-0000-0000-0000-000000000052', pg_temp.org(5), 'bank', 'UB None Wise', 'UB NONE LTD', '5252', 'BOSHCNSH', 'CN', false,
        'chinese_local_business', 'CNY', 'accountNumber', '{"accountHolderName":"UB NONE LTD"}', now(), now());
set local session_replication_role = origin;
select ok(pg_temp.nothing_moved(), 'adding a Wise account moves nothing');
select pg_temp.act_as('5'); set local role authenticated;
select lives_ok($$select public.choose_payout_method(pg_temp.org(5), 'ba190000-0000-0000-0000-000000000052')$$, 'the owner switches the default to Wise');
reset role;
select ok(pg_temp.nothing_moved(), 'switching the default to Wise moves nothing');
insert into public.factory_payout_accounts
  (id, org_id, method, bank_name, account_name, account_number_last4, swift, bank_country, is_primary, details_changed_at, number_changed_at)
values ('ba190000-0000-0000-0000-000000000053', pg_temp.org(5), 'bank', 'UB None Bank', 'UB NONE LTD', '5353', 'BCOMPTPL', 'HK', false, now(), now());
update public.factory_payout_accounts set is_primary = false where org_id = pg_temp.org(5);
update public.factory_payout_accounts set is_primary = true where id = 'ba190000-0000-0000-0000-000000000053';
select ok(pg_temp.nothing_moved(), 'a bank account made the default moves nothing');

-- A Stripe account: created, then able to take transfers, then chosen.
insert into public.stripe_connect_accounts (org_id, stripe_account_id, country, transfers_active)
values (pg_temp.org(5), 'acct_pgtap_ub_5', 'US', false);
update public.stripe_connect_accounts set transfers_active = true, payouts_enabled = true, details_submitted = true where org_id = pg_temp.org(5);
select ok(pg_temp.nothing_moved(), 'a Stripe account becoming ready moves nothing');
select pg_temp.act_as('5'); set local role authenticated;
select lives_ok($$select public.choose_payout_method(pg_temp.org(5), null)$$, 'the owner chooses Stripe as the default');
reset role;
select ok(pg_temp.nothing_moved(), 'choosing Stripe moves nothing: not pooled first, not claimed');
-- And back to PayPal, by the preferences row directly (any writer).
update public.factory_payout_preferences set route = 'manual' where org_id = pg_temp.org(5);
update public.factory_payout_accounts set is_primary = false where org_id = pg_temp.org(5);
update public.factory_payout_accounts set is_primary = true where id = 'ba190000-0000-0000-0000-000000000051';
select ok(pg_temp.nothing_moved(), 'changing the preference row moves nothing');
-- The old helper, if it is still callable by the server, joins nothing.
do $$ begin
  if to_regprocedure('public.join_owed_to_pool(uuid)') is not null then
    perform public.join_owed_to_pool(pg_temp.org(5));
  end if;
end $$;
select ok(pg_temp.nothing_moved(), 'join_owed_to_pool, if it remains, moves nothing');
select pg_temp.act_as('5'); set local role authenticated;
select is(pg_temp.bal(5, 'available_cents'), 10000::bigint, 'after every method change the money is still Available');
select is(pg_temp.bal(5, 'total_cents'), 15000::bigint, 'and the total has not changed');
reset role;

-- ===========================================================================
-- 5. Each dollar in exactly one figure (D3). The figures factory (f7) holds one
--    payment per situation, each a different power of two so a dollar counted
--    twice, or not at all, shows in the sum.
-- ===========================================================================
set local session_replication_role = replica;
insert into public.order_milestones (id, order_id, kind, title, amount_cents, state, sort)
select ('ba1e00' || lpad(s::text, 2, '0') || '-0000-0000-0000-000000000077')::uuid, 'ba1d0000-0000-0000-0000-000000000007',
       'approval_and_payment', 'UB figure ' || s, (1 << s) * 100, 'active', 100 + s
  from generate_series(3, 10) s;
insert into public.order_payments
  (id, order_id, milestone_id, amount_cents, currency, state, confirmed_at, release_requested_at,
   withdrawal_pool, stripe_payment_intent_id, stripe_charge_id, funds_available_at)
select ('ba1f00' || lpad(s::text, 2, '0') || '-0000-0000-0000-000000000077')::uuid, 'ba1d0000-0000-0000-0000-000000000007',
       ('ba1e00' || lpad(s::text, 2, '0') || '-0000-0000-0000-000000000077')::uuid, (1 << s) * 100, 'USD', 'confirmed',
       now() - interval '20 days',
       case when s = 3 then null else now() - interval '3 days' end,
       s in (6, 7, 8),
       'pi_pgtap_ub_fig_' || s, 'ch_pgtap_ub_fig_' || s,
       case when s = 5 then now() + interval '2 days' else now() - interval '10 days' end
  from generate_series(3, 10) s;
-- s=3  $8    funded, not approved                     -> Awaiting approval
-- s=4  $16   owed, cleared                            -> Available
-- s=5  $32   owed, still clearing                     -> Pending
-- s=6  $64   in the pool, no withdrawal               -> Available (P3: stays pool money)
-- s=7  $128  in the pool, a withdrawal requested      -> Pending
-- s=8  $256  in the pool, withdrawn and paid, fee $2  -> Paid out $254
-- s=9  $512  refunded after approval                  -> none
-- s=10 $1024 cancelled before it was paid            -> none
update public.order_payments set state = 'released', released_at = now() where id = 'ba1f0008-0000-0000-0000-000000000077';
-- (refunded in full: no writer leaves a confirmed row with only refunded_at, 20261121350000)
update public.order_payments set refunded_cents = 51200, refund_amount_at = now() where id = 'ba1f0009-0000-0000-0000-000000000077';
update public.order_payments set state = 'cancelled', release_requested_at = null where id = 'ba1f0010-0000-0000-0000-000000000077';
insert into public.factory_payout_accounts (id, org_id, method, paypal_email, is_primary, details_changed_at)
values ('ba190000-0000-0000-0000-000000000007', pg_temp.org(7), 'paypal', 'pgtap-ub-figures@example.com', true, '2026-11-01');
insert into public.factory_withdrawals (org_id, account_id, provider, status, amount_cents, currency, paid_to, fee_cents, receives_minor, receives_currency, paid_at)
values (pg_temp.org(7), 'ba190000-0000-0000-0000-000000000007', 'paypal', 'requested', 12800, 'USD', 'pgtap-ub-figures@example.com', null, null, null, null),
       (pg_temp.org(7), 'ba190000-0000-0000-0000-000000000007', 'paypal', 'paid', 25600, 'USD', 'pgtap-ub-figures@example.com', 200, 25400, 'USD', now());
-- The figures factory's own first two steps stay unfunded for this section.
update public.order_payments set state = 'not_due', confirmed_at = null, funds_available_at = null
 where id in (pg_temp.pay(7, 1), pg_temp.pay(7, 2));
set local session_replication_role = origin;
-- The old pool, turned into takes as the migration does (20261121350000):
-- the figures stay as they were.
select is(public.convert_withdrawal_pool(), 3, 'the three pool steps are converted');

select pg_temp.act_as('c'); set local role authenticated;
select is(pg_temp.bal(7, 'awaiting_cents'), 800::bigint, 'Awaiting approval: only the funded step not yet approved');
select is(pg_temp.bal(7, 'available_cents'), (1600 + 6400)::bigint, 'Available: owed and cleared, plus pool money not in a withdrawal');
select is(pg_temp.bal(7, 'pending_cents'), 3200::bigint, 'Pending: owed money still clearing');
select is(pg_temp.bal(7, 'processing_cents'), 12800::bigint, 'Processing: a requested pool withdrawal, not Pending');
select is(pg_temp.bal(7, 'paid_out_cents'), 25400::bigint, 'Paid out: the paid withdrawal, net of its fee');
select is(pg_temp.bal(7, 'total_cents'),
  pg_temp.bal(7, 'awaiting_cents') + pg_temp.bal(7, 'available_cents') + pg_temp.bal(7, 'pending_cents') + pg_temp.bal(7, 'processing_cents') + pg_temp.bal(7, 'paid_out_cents'),
  'Total is the sum of the figures, withdrawals in progress included');
select is(pg_temp.bal(7, 'total_cents'), (800 + 1600 + 3200 + 6400 + 12800 + 25400)::bigint,
  'and every dollar is in exactly one: refunded and cancelled money is in none, the fee in none');
reset role;

-- The same money once its charge clears moves from Pending to Available.
update public.order_payments set funds_available_at = now() - interval '1 minute' where id = 'ba1f0005-0000-0000-0000-000000000077';
select pg_temp.act_as('c'); set local role authenticated;
select is(pg_temp.bal(7, 'available_cents'), (1600 + 3200 + 6400)::bigint, 'cleared: the step moves to Available');
select is(pg_temp.bal(7, 'pending_cents'), 0::bigint, 'and out of Pending');
reset role;

-- A step whose charge was never given a cleared date (approved before this
-- change) is not stuck in Pending forever: once funded long ago, it is Available
-- or Pending, never both and never neither.
update public.order_payments set funds_available_at = null where id = 'ba1f0004-0000-0000-0000-000000000077';
select pg_temp.act_as('c'); set local role authenticated;
select is(pg_temp.bal(7, 'total_cents'), (800 + 1600 + 3200 + 6400 + 12800 + 25400)::bigint,
  'a step with no cleared date still counts once');
reset role;

-- The Stripe and other factories after approval: step 1 Available, step 2
-- Awaiting, whatever the method.
select pg_temp.act_as('1'); set local role authenticated;
select is(pg_temp.bal(1, 'available_cents'), 10000::bigint, 'Stripe factory: approved and cleared money is Available');
select is((public.factory_balance(pg_temp.org(1)) ->> 'has_method')::boolean, true, 'a ready Stripe account is a usable method');
reset role;
select pg_temp.act_as('2'); set local role authenticated;
select is(pg_temp.bal(2, 'available_cents'), 10000::bigint, 'PayPal factory: the same');
reset role;
select pg_temp.act_as('3'); set local role authenticated;
select is(pg_temp.bal(3, 'available_cents'), 10000::bigint, 'Wise factory: the same');
reset role;
select pg_temp.act_as('4'); set local role authenticated;
select is(pg_temp.bal(4, 'available_cents'), 10000::bigint, 'bank factory: the same');
select is((public.factory_balance(pg_temp.org(4)) ->> 'has_method')::boolean, false,
  'a bank account staff would pay by hand is not a way to withdraw (20261117500000): no usable method');
reset role;

-- An approved step whose charge has not cleared: Pending, on any road.
select pg_temp.approve(2, 2);
select ok(pg_temp.owed_untouched(pg_temp.pay(2, 2)), 'approving an uncleared step leaves it owed and untouched too');
select pg_temp.act_as('2'); set local role authenticated;
select is(pg_temp.bal(2, 'pending_cents'), 5000::bigint, 'PayPal factory: approved but still clearing is Pending');
select is(pg_temp.bal(2, 'available_cents'), 10000::bigint, 'and not Available');
select is(pg_temp.bal(2, 'awaiting_cents'), 0::bigint, 'and no longer Awaiting approval');
reset role;

-- ===========================================================================
-- 6. Who may read the balance.
-- ===========================================================================
select pg_temp.act_as('6'); set local role authenticated;
select is(pg_temp.bal(5, 'available_cents'), 10000::bigint, 'a member of the factory reads its balance');
reset role;
select pg_temp.act_as('9'); set local role authenticated;
select is(pg_temp.bal(5, 'available_cents'), 10000::bigint, 'a person in both the brand and the factory reads it as the factory');
select throws_ok($$select public.factory_balance(pg_temp.org(1))$$, '42501', null,
  'but not the balance of another factory on the same brand''s orders');
reset role;
select pg_temp.act_as('7'); set local role authenticated;
select throws_ok($$select public.factory_balance(pg_temp.org(5))$$, '42501', null, 'the brand owner on the order cannot read the factory''s balance');
reset role;
select pg_temp.act_as('8'); set local role authenticated;
select throws_ok($$select public.factory_balance(pg_temp.org(5))$$, '42501', null, 'a brand member cannot either');
reset role;
select pg_temp.act_as('a'); set local role authenticated;
select throws_ok($$select public.factory_balance(pg_temp.org(5))$$, '42501', null, 'another company''s owner cannot');
select throws_ok($$select public.factory_balance(null)$$, null, null, 'nor with no company');
reset role;
set local role anon;
select throws_ok($$select public.factory_balance('ba1b0000-0000-0000-0000-0000000000f5')$$, '42501', null, 'signed out: refused');
reset role;
select ok(not has_function_privilege('anon', 'public.factory_balance(uuid, uuid)', 'execute'), 'anon holds no execute grant on the balance');
select pg_temp.act_as('b'); set local role authenticated;
select is(pg_temp.bal(5, 'available_cents'), 10000::bigint, 'staff read a factory''s balance');
reset role;
-- The helpers behind it are internal, and recording a cleared date is the server's.
select ok(not has_function_privilege('authenticated', 'public.record_payment_funds_available(uuid, timestamptz)', 'execute')
      and not has_function_privilege('anon', 'public.record_payment_funds_available(uuid, timestamptz)', 'execute'),
  'only the server records when a charge clears');
select ok(has_function_privilege('service_role', 'public.record_payment_funds_available(uuid, timestamptz)', 'execute'),
  'and the server can');
select ok(not has_function_privilege('authenticated', 'public.payment_cleared(public.order_payments)', 'execute'), 'payment_cleared is internal');
select ok(not has_function_privilege('authenticated', 'public.factory_can_withdraw(uuid)', 'execute'), 'factory_can_withdraw is internal');
select pg_temp.act_as('5'); set local role authenticated;
select throws_ok($$select public.record_payment_funds_available(pg_temp.pay(5, 2), now() - interval '9 days')$$, '42501', null,
  'the factory owner cannot call it to mark its own money cleared');
reset role;
-- The server records a cleared date: an approved step moves to Available.
select pg_temp.approve(5, 2);
select pg_temp.act_as('5'); set local role authenticated;
select is(pg_temp.bal(5, 'pending_cents'), 5000::bigint, 'an approved step still clearing is Pending');
reset role;
set local role service_role;
select lives_ok($$select public.record_payment_funds_available('ba1f0002-0000-0000-0000-000000000005', now() - interval '1 minute')$$,
  'the server records that the charge has cleared');
reset role;
select pg_temp.act_as('5'); set local role authenticated;
select is(pg_temp.bal(5, 'pending_cents'), 0::bigint, 'it leaves Pending');
select is(pg_temp.bal(5, 'available_cents'), 15000::bigint, 'and is Available');
select is(pg_temp.bal(5, 'total_cents'), 15000::bigint, 'the total is unchanged');
reset role;

-- ===========================================================================
-- 7. No client writes the money fields, and the pool guards still hold.
-- ===========================================================================
select ok(not has_table_privilege('authenticated', 'public.order_payments', 'UPDATE'), 'no UPDATE on order_payments for a signed-in account');
select ok(not has_table_privilege('authenticated', 'public.order_payments', 'INSERT'), 'no INSERT either');
select ok(not has_column_privilege('authenticated', 'public.order_payments', 'funds_available_at', 'UPDATE'), 'no column grant on the cleared date');
select ok(not has_column_privilege('authenticated', 'public.order_payments', 'withdrawal_pool', 'UPDATE'), 'no column grant on withdrawal_pool');
select ok(not has_column_privilege('authenticated', 'public.order_payments', 'release_requested_at', 'UPDATE'), 'no column grant on release_requested_at');
select pg_temp.act_as('4'); set local role authenticated;
select throws_ok($$update public.order_payments set funds_available_at = now() - interval '9 days' where id = pg_temp.pay(4, 2)$$,
  '42501', null, 'the factory owner cannot mark its own money cleared');
select throws_ok($$update public.order_payments set withdrawal_pool = true where id = pg_temp.pay(4, 1)$$,
  '42501', null, 'nor put a step in the pool');
select throws_ok($$update public.order_payments set release_requested_at = now() where id = pg_temp.pay(4, 2)$$,
  '42501', null, 'nor make an unapproved step owed');
select throws_ok($$update public.order_payments set release_claimed_at = now(), stripe_release_started = true where id = pg_temp.pay(4, 1)$$,
  '42501', null, 'nor claim a step for Stripe');
reset role;
select pg_temp.act_as('7'); set local role authenticated;
select throws_ok($$update public.order_payments set release_requested_at = now() where id = pg_temp.pay(4, 2)$$,
  '42501', null, 'the brand cannot make a step owed without approving it');
reset role;
-- Any function that records the cleared date is for the server only.
select ok(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosrc like '%funds_available_at%' and p.prokind = 'f'
     and p.prosecdef
     and has_function_privilege('authenticated', p.oid, 'execute')
     and p.proname not in ('factory_balance')
     and p.prosrc ~* 'set[^;]*funds_available_at\s*='),
  'no definer function a signed-in account can call writes the cleared date');

-- A step a withdrawal holds part of is guarded by its take (the old pool's
-- guards went with the pool, 20261121350000).
select throws_ok($$update public.order_payments set release_claimed_at = now() where id = 'ba1f0006-0000-0000-0000-000000000077'$$,
  '22023', null, 'a withdrawn step cannot be claimed for a Stripe transfer');
select throws_ok($$update public.order_payments set state = 'released', released_at = now() where id = 'ba1f0006-0000-0000-0000-000000000077'$$,
  '22023', null, 'a withdrawn step cannot be released outside a withdrawal');

-- ===========================================================================
-- 8. The staff board: balance money is not waiting on staff.
-- ===========================================================================
select pg_temp.act_as('b'); set local role authenticated;
select set_config('tsc.ub_owed_before', (select payments_awaiting_confirmation::text from public.admin_overview_metrics()), true);
reset role;
select pg_temp.approve(3, 2);
select pg_temp.act_as('b'); set local role authenticated;
select is((select payments_awaiting_confirmation from public.admin_overview_metrics()),
  current_setting('tsc.ub_owed_before')::int, 'approving a step adds nothing to staff''s count: it waits on the factory');
reset role;

-- A pool withdrawal asked for is still staff's to approve, and counted.
set local session_replication_role = replica;
insert into public.factory_withdrawals (id, org_id, account_id, provider, status, amount_cents, currency, paid_to)
values ('ba1a2000-0000-0000-0000-000000000001', pg_temp.org(7), 'ba190000-0000-0000-0000-000000000007', 'paypal', 'requested', 100, 'USD', 'pgtap-ub-figures@example.com');
set local session_replication_role = origin;
select pg_temp.act_as('b'); set local role authenticated;
select ok(exists (select 1 from jsonb_array_elements(public.admin_withdrawals() -> 'withdrawals') w
                   where w ->> 'id' = 'ba1a2000-0000-0000-0000-000000000001' and w ->> 'status' = 'requested'),
  'a requested pool withdrawal is on staff''s withdrawals board');
select is((select payments_awaiting_confirmation from public.admin_overview_metrics()),
  current_setting('tsc.ub_owed_before')::int + 1, 'and counted on the overview');
reset role;
delete from public.factory_withdrawals where id = 'ba1a2000-0000-0000-0000-000000000001';

-- A per-step payout that failed (a step paid before this change by PayPal) is
-- still staff's to see.
set local session_replication_role = replica;
insert into public.provider_payouts (id, payment_id, factory_org_id, account_id, provider, status, paid_to, amount_cents, currency, failure_code)
values ('ba1a1000-0000-0000-0000-000000000001', pg_temp.pay(4, 1), pg_temp.org(4), 'ba190000-0000-0000-0000-000000000004', 'paypal', 'failed', 'x', 10000, 'USD', 'other');
set local session_replication_role = origin;
select pg_temp.act_as('b'); set local role authenticated;
select ok(exists (select 1 from public.admin_payment_board() b where b.payment_id = pg_temp.pay(4, 1) and b.provider_status = 'failed'),
  'a failed payout stays on the board');
select is((select payments_awaiting_confirmation from public.admin_overview_metrics()),
  current_setting('tsc.ub_owed_before')::int + 1, 'and is counted for staff');
-- Owed money in a balance ranks below what waits on staff, with held money.
select ok(
  (select max(x.ordinality) from public.admin_payment_board() with ordinality x where x.payment_id = pg_temp.pay(4, 1))
  < (select min(x.ordinality) from public.admin_payment_board() with ordinality x
      where x.payment_id in (pg_temp.pay(1, 1), pg_temp.pay(2, 1), pg_temp.pay(3, 1), pg_temp.pay(5, 1))),
  'the failed payout is listed before every owed balance step');
reset role;
select pg_temp.act_as('5'); set local role authenticated;
select throws_ok($$select * from public.admin_payment_board()$$, '42501', null, 'the board stays staff only');
reset role;

-- ===========================================================================
-- 9. Fixes round 1 (20261120110000).
-- ===========================================================================

-- F1: the database refuses a Stripe claim on an owed step nobody started,
-- whatever the JavaScript does (an old deployment, a stray caller).
select is(public.claim_payment_release(pg_temp.pay(1, 1)), null::timestamptz,
  'F1: an owed, unstarted step on a Stripe factory cannot be claimed for a transfer');
select ok((select release_claimed_at is null and not stripe_release_started from public.order_payments where id = pg_temp.pay(1, 1)),
  'F1: and the row stays unclaimed');
set local role service_role;
select is(public.claim_payment_release(pg_temp.pay(1, 1)), null::timestamptz, 'F1: not even with the server key');
reset role;
select ok(pg_temp.owed_untouched(pg_temp.pay(1, 1)), 'F1: still owed and untouched');
-- Round 36: tsc.withdrawal_claim (never set by anything) no longer opens it.
select set_config('tsc.withdrawal_claim', 'on', true);
select is(public.claim_payment_release(pg_temp.pay(1, 1)), null::timestamptz, 'F1: the old tsc.withdrawal_claim setting no longer claims it');
select ok((select release_claimed_at is null from public.order_payments where id = pg_temp.pay(1, 1)), 'F1: and nothing is claimed');
select set_config('tsc.withdrawal_claim', '', true);

-- F2: legacy per-step attempts stay staff's after the factory changes its details
-- or its default. A failed Wise payout (f3) and a processing PayPal payout (f2).
select pg_temp.act_as('b'); set local role authenticated;
select set_config('tsc.ub_f2_before', (select payments_awaiting_confirmation::text from public.admin_overview_metrics()), true);
reset role;
set local session_replication_role = replica;
insert into public.provider_payouts (id, payment_id, factory_org_id, account_id, provider, status, paid_to, amount_cents, currency, failure_code, created_at)
values ('ba1a1000-0000-0000-0000-000000000003', pg_temp.pay(3, 1), pg_temp.org(3), 'ba190000-0000-0000-0000-000000000003', 'wise', 'failed', 'UB WISE LTD', 10000, 'USD', 'details_rejected', now() - interval '1 hour'),
       ('ba1a1000-0000-0000-0000-000000000002', pg_temp.pay(2, 1), pg_temp.org(2), 'ba190000-0000-0000-0000-000000000002', 'paypal', 'processing', 'pgtap-ub-paypal@example.com', 10000, 'USD', null, now() - interval '1 hour');
set local session_replication_role = origin;
-- The Wise factory fixes its details; the PayPal factory moves to Stripe.
update public.factory_payout_accounts set account_name = 'UB WISE LIMITED', details_changed_at = now() where id = 'ba190000-0000-0000-0000-000000000003';
insert into public.stripe_connect_accounts (org_id, stripe_account_id, country, transfers_active, payouts_enabled, details_submitted)
values (pg_temp.org(2), 'acct_pgtap_ub_2', 'US', true, true, true);
select pg_temp.act_as('2'); set local role authenticated;
select lives_ok($$select public.choose_payout_method(pg_temp.org(2), null)$$, 'F2: the PayPal factory switches its default to Stripe mid-payout');
reset role;
select pg_temp.act_as('b'); set local role authenticated;
select is((select provider_status from public.admin_payment_board() where payment_id = pg_temp.pay(3, 1)), 'failed',
  'F2: the failed Wise payout is still on the board after the factory edited its details');
select is((select provider || '/' || provider_status from public.admin_payment_board() where payment_id = pg_temp.pay(2, 1)), 'paypal/processing',
  'F2: the PayPal payout in flight is still on the board, as PayPal, after the switch to Stripe');
select is((select payments_awaiting_confirmation from public.admin_overview_metrics()), current_setting('tsc.ub_f2_before')::int + 2,
  'F2: the overview counts both');
-- One rule in both places: for these fixtures, overview rows = board rows waiting on staff.
select is(
  (select count(*)::int from public.admin_payment_board() b
    where b.payment_id in (select pg_temp.pay(n, s) from generate_series(1, 7) n, generate_series(1, 2) s)
      and b.state = 'confirmed' and b.release_requested_at is not null
      and (b.stripe_release_started or b.provider_status in ('processing', 'failed'))),
  3, 'F2: the board''s waiting-on-staff rows for these fixtures are the three attempts (f2, f3, f4)');
reset role;
select pg_temp.act_as('2'); set local role authenticated;
select is(pg_temp.bal(2, 'pending_cents'), 5000::bigint, 'F2: its clearing step is Pending');
select is(pg_temp.bal(2, 'processing_cents'), 10000::bigint, 'F2: the payout in flight is processing, not Pending');
select is(pg_temp.bal(2, 'available_cents'), 0::bigint, 'F2: not Available, so it cannot be taken twice');
reset role;

-- F4: a refunded-then-repaid payment forgets the old charge's cleared date.
select ok((select funds_available_at is not null from public.order_payments where id = pg_temp.pay(6, 1)), 'F4: the first charge cleared');
select lives_ok($$select public.record_payment_refunded(pg_temp.pay(6, 1), 'pi_pgtap_ub_1_6', 'The payment was refunded.')$$, 'F4: the charge is refunded');
select ok((select state::text <> 'confirmed' and funds_available_at is null from public.order_payments where id = pg_temp.pay(6, 1)),
  'F4: it leaves confirmed and its cleared date is forgotten');
select lives_ok($$select public.record_payment_funded(pg_temp.pay(6, 1), 'ch_pgtap_ub_repaid_6', 'card', 'Visa ···4242', 10000)$$, 'F4: the brand pays again');
select ok((select state = 'confirmed' and funds_available_at is null and stripe_charge_id = 'ch_pgtap_ub_repaid_6' from public.order_payments where id = pg_temp.pay(6, 1)),
  'F4: the new charge has no cleared date until the server records one');
select pg_temp.approve(6, 1);
select pg_temp.act_as('a'); set local role authenticated;
select is(pg_temp.bal(6, 'pending_cents'), 10000::bigint, 'F4: approved on a new, uncleared charge: Pending');
select is(pg_temp.bal(6, 'available_cents'), 0::bigint, 'F4: not Available on the old charge''s date');
reset role;
set local role service_role;
select public.record_payment_funds_available(pg_temp.pay(6, 1), now() - interval '1 minute');
reset role;
select pg_temp.act_as('a'); set local role authenticated;
select is(pg_temp.bal(6, 'available_cents'), 10000::bigint, 'F4: once the new date is recorded it is Available');
reset role;
-- And the trigger on its own: a changed charge id forgets the date; the same
-- statement writing a date keeps it.
update public.order_payments set stripe_charge_id = 'ch_pgtap_ub_other' where id = pg_temp.pay(7, 1);
update public.order_payments set funds_available_at = now() - interval '1 day' where id = pg_temp.pay(1, 2);
update public.order_payments set stripe_charge_id = 'ch_pgtap_ub_swapped' where id = pg_temp.pay(1, 2);
select ok((select funds_available_at is null from public.order_payments where id = pg_temp.pay(1, 2)), 'F4: a new charge id forgets the old date');
update public.order_payments set stripe_charge_id = 'ch_pgtap_ub_swapped2', funds_available_at = now() - interval '2 hours' where id = pg_temp.pay(1, 2);
select ok((select funds_available_at is not null from public.order_payments where id = pg_temp.pay(1, 2)), 'F4: a date written with the new charge is kept');

select * from finish();
rollback;
