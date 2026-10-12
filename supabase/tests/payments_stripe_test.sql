-- ============================================================================
-- Payments held by TSC through Stripe (20261012000100/200)
-- ----------------------------------------------------------------------------
-- Run with:  supabase test db
--
-- `pgtap18-` slugs and 18a…/18b…/18c…/18d… ids, every count scoped to these
-- fixtures, as in every other suite: they all share one database.
--
-- What this protects: only server code (service_role) can say a payment is
-- clearing, failed, held or paid out; only a brand owner can start paying,
-- and only what is owed; a paid step cannot be approved before its money is
-- held, and approving it is what requests the payout; the fee follows the
-- order's size; cancelling leaves money that is real (clearing or held) for
-- staff; and editing the steps never moves money that has moved.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(61);

-- ---------------------------------------------------------------------------
-- Fixtures: a brand (owner + member), a factory, a stranger brand, an admin,
-- and three awarded orders: A $2,000, B $6,000, C $2,000.
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, raw_user_meta_data) values
  ('18a00000-0000-0000-0000-000000000001', 'p18-owner@example.com',    '{"name":"Brand Owner"}'),
  ('18a00000-0000-0000-0000-000000000002', 'p18-member@example.com',   '{"name":"Brand Member"}'),
  ('18a00000-0000-0000-0000-000000000003', 'p18-factory@example.com',  '{"name":"Factory Owner"}'),
  ('18a00000-0000-0000-0000-000000000004', 'p18-stranger@example.com', '{"name":"Stranger"}'),
  ('18a00000-0000-0000-0000-000000000005', 'p18-admin@example.com',    '{"name":"Staff"}');

insert into public.orgs (id, type, name, slug) values
  ('18b00000-0000-0000-0000-00000000000b', 'brand',   'P18 Brand',    'pgtap18-brand'),
  ('18b00000-0000-0000-0000-0000000000f1', 'factory', 'P18 Factory',  'pgtap18-factory'),
  ('18b00000-0000-0000-0000-00000000000c', 'brand',   'P18 Stranger', 'pgtap18-stranger');

insert into public.org_members (org_id, user_id, role) values
  ('18b00000-0000-0000-0000-00000000000b', '18a00000-0000-0000-0000-000000000001', 'owner'),
  ('18b00000-0000-0000-0000-00000000000b', '18a00000-0000-0000-0000-000000000002', 'member'),
  ('18b00000-0000-0000-0000-0000000000f1', '18a00000-0000-0000-0000-000000000003', 'owner'),
  ('18b00000-0000-0000-0000-00000000000c', '18a00000-0000-0000-0000-000000000004', 'owner');

insert into public.platform_admins (user_id, note) values
  ('18a00000-0000-0000-0000-000000000005', 'pgtap18 staff');

insert into public.brand_profiles (org_id, hq_location) values
  ('18b00000-0000-0000-0000-00000000000b', 'London, UK'),
  ('18b00000-0000-0000-0000-00000000000c', 'Berlin, DE');

insert into public.factory_profiles (org_id, country_code, moq, published_at, verification_status) values
  ('18b00000-0000-0000-0000-0000000000f1', 'PT', 100, now(), 'verified');

insert into public.rfqs (id, brand_org_id, title, brief, status, visibility, quantity_total) values
  ('18c00000-0000-0000-0000-00000000000a', '18b00000-0000-0000-0000-00000000000b', 'P18 A', 'A hundred shirts.', 'open', 'open_to_all', 100),
  ('18c00000-0000-0000-0000-00000000000b', '18b00000-0000-0000-0000-00000000000b', 'P18 B', 'A hundred coats.',  'open', 'open_to_all', 100),
  ('18c00000-0000-0000-0000-00000000000c', '18b00000-0000-0000-0000-00000000000b', 'P18 C', 'A hundred hats.',   'open', 'open_to_all', 100);

-- No sample lines, so each order's total is unit price x quantity.
insert into public.quotes
  (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity,
   bulk_lead_time_days, deposit_pct, balance_pct, valid_until, submitted_at)
values
  ('18d00000-0000-0000-0000-00000000000a', '18c00000-0000-0000-0000-00000000000a',
   '18b00000-0000-0000-0000-0000000000f1', 'submitted', 2000, 100, 28, 30, 70, current_date + 30, now()),
  ('18d00000-0000-0000-0000-00000000000b', '18c00000-0000-0000-0000-00000000000b',
   '18b00000-0000-0000-0000-0000000000f1', 'submitted', 6000, 100, 28, 30, 70, current_date + 30, now()),
  ('18d00000-0000-0000-0000-00000000000c', '18c00000-0000-0000-0000-00000000000c',
   '18b00000-0000-0000-0000-0000000000f1', 'submitted', 2000, 100, 28, 30, 70, current_date + 30, now());

set local request.jwt.claims = '{"sub":"18a00000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select public.award_quote('18d00000-0000-0000-0000-00000000000a');
select public.award_quote('18d00000-0000-0000-0000-00000000000b');
select public.award_quote('18d00000-0000-0000-0000-00000000000c');
reset role;

create temporary table p18 (name text primary key, id uuid);
insert into p18
select 'order_' || lower(right(quote_id::text, 1)), id
from public.production_orders
where quote_id in ('18d00000-0000-0000-0000-00000000000a',
                   '18d00000-0000-0000-0000-00000000000b',
                   '18d00000-0000-0000-0000-00000000000c');
grant select on p18 to public;

-- Each order: a Paid release "Fit sample" (25%), then a payment-only "Balance".
set local request.jwt.claims = '{"sub":"18a00000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select public.set_order_schedule((select id from p18 where name = 'order_a'),
  '[{"kind":"approval_and_payment","title":"Fit sample","amount_cents":50000,"sort":10},
    {"kind":"payment_only","title":"Balance","amount_cents":150000,"sort":20}]'::jsonb);
select public.set_order_schedule((select id from p18 where name = 'order_b'),
  '[{"kind":"approval_and_payment","title":"Fit sample","amount_cents":150000,"sort":10},
    {"kind":"payment_only","title":"Balance","amount_cents":450000,"sort":20}]'::jsonb);
select public.set_order_schedule((select id from p18 where name = 'order_c'),
  '[{"kind":"approval_and_payment","title":"Fit sample","amount_cents":50000,"sort":10},
    {"kind":"payment_only","title":"Balance","amount_cents":150000,"sort":20}]'::jsonb);
select public.agree_schedule(id, (select schedule_revision from public.production_orders where id = p18.id))
from p18;
reset role;

-- The step and its payment, by order and title.
create function pg_temp.p18_step(order_name text, step text) returns uuid
language sql as $$
  select m.id from public.order_milestones m
   where m.order_id = (select id from p18 where name = order_name) and m.title = step
$$;
create function pg_temp.p18_pay(order_name text, step text) returns uuid
language sql as $$
  select p.id from public.order_payments p where p.milestone_id = pg_temp.p18_step(order_name, step)
$$;
create function pg_temp.p18_state(order_name text, step text) returns text
language sql as $$
  select state::text from public.order_payments where id = pg_temp.p18_pay(order_name, step)
$$;
create function pg_temp.p18_notes(org uuid, note_kind text, order_name text) returns bigint
language sql as $$
  select count(*) from public.notifications
   where org_id = org and kind = note_kind
     and order_id = (select id from p18 where name = order_name)
$$;

select is(
  (select count(*) from public.production_orders where id in (select id from p18) and status = 'active'),
  3::bigint, 'fixture: all three orders are under way');

-- ---------------------------------------------------------------------------
-- The fee follows the order's size, and is fixed per order
-- ---------------------------------------------------------------------------

select is((select fee_bps from public.order_payments where id = pg_temp.p18_pay('order_a', 'Fit sample')),
  700, 'an order under $5,000 is charged 7%');
select is((select fee_bps from public.order_payments where id = pg_temp.p18_pay('order_b', 'Balance')),
  500, 'an order of $5,000 or more is charged 5%');
select is(public.payment_fee_cents(pg_temp.p18_pay('order_a', 'Fit sample')),
  3500::bigint, 'the fee is computed on the step: 7% of $500 is $35');

-- ---------------------------------------------------------------------------
-- A paid step's money falls due as the step opens
-- ---------------------------------------------------------------------------

select is(pg_temp.p18_state('order_a', 'Fit sample'), 'due',
  'the open Paid release step is due now: it is funded before the work');
select is(pg_temp.p18_state('order_a', 'Balance'), 'not_due',
  'the next step is not due yet');
select is(pg_temp.p18_notes('18b00000-0000-0000-0000-00000000000b', 'payment_due', 'order_a'), 1::bigint,
  'the brand is told to fund it');
select is(
  (select awaiting_factory from public.production_order_summary where id = (select id from p18 where name = 'order_a')),
  false, 'an unfunded step is not the factory''s turn');

-- ---------------------------------------------------------------------------
-- Only server code records what Stripe says
-- ---------------------------------------------------------------------------

select ok(not has_function_privilege('authenticated', 'public.record_payment_funded(uuid, text, text, text, bigint)', 'execute'),
  'a signed-in user cannot record a payment as funded');
select ok(not has_function_privilege('authenticated', 'public.record_payment_processing(uuid, text, text)', 'execute'),
  'nor as clearing');
select ok(not has_function_privilege('authenticated', 'public.record_payment_failed(uuid, text)', 'execute'),
  'nor as failed');
select ok(not has_function_privilege('authenticated', 'public.record_payment_released(uuid, text)', 'execute'),
  'nor as paid out');
select ok(not has_function_privilege('authenticated', 'public.attach_payment_intent(uuid, text, bigint)', 'execute'),
  'nor attach a PaymentIntent');
select ok(has_function_privilege('service_role', 'public.record_payment_funded(uuid, text, text, text, bigint)', 'execute'),
  'server code with the service key can');

set local request.jwt.claims = '{"sub":"18a00000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$select public.record_payment_funded(pg_temp.p18_pay('order_a', 'Fit sample'), 'ch_x', 'card', 'Visa ···4242', 53500)$$,
  '42501', NULL, 'the brand that pays cannot say its own payment arrived');
reset role;

-- ---------------------------------------------------------------------------
-- Starting a checkout: an owner, for what is owed
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"18a00000-0000-0000-0000-000000000002","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$select public.begin_payment_checkout(pg_temp.p18_pay('order_a', 'Fit sample'))$$,
  '42501', 'only a brand owner can pay for a step', 'a brand member cannot start paying');
reset role;

set local request.jwt.claims = '{"sub":"18a00000-0000-0000-0000-000000000003","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$select public.begin_payment_checkout(pg_temp.p18_pay('order_a', 'Fit sample'))$$,
  '42501', NULL, 'the factory cannot start paying itself');
reset role;

-- The id is looked up first: a stranger cannot even read the row.
insert into p18 values ('pay_a_fit', pg_temp.p18_pay('order_a', 'Fit sample'));
set local request.jwt.claims = '{"sub":"18a00000-0000-0000-0000-000000000004","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$select public.begin_payment_checkout((select id from p18 where name = 'pay_a_fit'))$$,
  '42501', NULL, 'a stranger cannot start a checkout on someone else''s order');
reset role;

set local request.jwt.claims = '{"sub":"18a00000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select is(
  (public.begin_payment_checkout(pg_temp.p18_pay('order_a', 'Fit sample')) ->> 'charged_cents')::bigint,
  53500::bigint, 'the owner starts paying $535: the $500 step plus the $35 fee');
select throws_ok(
  $$select public.begin_payment_checkout(pg_temp.p18_pay('order_a', 'Balance'))$$,
  '22023', 'that payment is not_due, so there is nothing to pay', 'a step not open yet cannot be paid');
reset role;

-- ---------------------------------------------------------------------------
-- Approving a paid step needs its money held
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"18a00000-0000-0000-0000-000000000003","role":"authenticated"}';
set local role authenticated;
select public.post_milestone_update(pg_temp.p18_step('order_a', 'Fit sample'), 'Fit sample sewn.', '{}');
reset role;

set local request.jwt.claims = '{"sub":"18a00000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$select public.approve_milestone(pg_temp.p18_step('order_a', 'Fit sample'), null)$$,
  '22023', 'fund "Fit sample" first: TSC pays the factory from the money it holds when you approve',
  'the brand cannot approve a paid step before it is funded');
reset role;

-- ---------------------------------------------------------------------------
-- A bank payment: clearing, then it comes back, then a card works
-- ---------------------------------------------------------------------------

select public.attach_payment_intent(pg_temp.p18_pay('order_a', 'Fit sample'), 'pi_p18_a', 53500);
select public.record_payment_processing(pg_temp.p18_pay('order_a', 'Fit sample'), 'us_bank_account', 'STRIPE TEST BANK ···6789');

select is(pg_temp.p18_state('order_a', 'Fit sample'), 'processing', 'a bank payment is clearing');
select is(pg_temp.p18_notes('18b00000-0000-0000-0000-0000000000f1', 'payment_processing', 'order_a'), 1::bigint,
  'the factory is told it is on its way, not to start');

set local request.jwt.claims = '{"sub":"18a00000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$select public.begin_payment_checkout(pg_temp.p18_pay('order_a', 'Fit sample'))$$,
  '22023', 'that payment is processing, so there is nothing to pay', 'a payment clearing cannot be paid twice');
reset role;

select throws_ok(
  $$select public.attach_payment_intent(pg_temp.p18_pay('order_a', 'Fit sample'), 'pi_other', 53500)$$,
  '22023', NULL, 'a payment keeps one PaymentIntent');

select public.record_payment_failed(pg_temp.p18_pay('order_a', 'Fit sample'), 'The bank account is closed.');
select is(pg_temp.p18_state('order_a', 'Fit sample'), 'failed', 'the bank payment came back');
select is((select failure_reason from public.order_payments where id = pg_temp.p18_pay('order_a', 'Fit sample')),
  'The bank account is closed.', 'with the reason');
select is(pg_temp.p18_notes('18b00000-0000-0000-0000-00000000000b', 'payment_failed', 'order_a'), 1::bigint,
  'the brand is told to pay again');
select is(pg_temp.p18_notes('18b00000-0000-0000-0000-0000000000f1', 'payment_failed', 'order_a'), 1::bigint,
  'and the factory, which was told it was on its way');
select is(
  (select awaiting_brand from public.production_order_summary where id = (select id from p18 where name = 'order_a')),
  true, 'a failed payment is the brand''s turn');

set local request.jwt.claims = '{"sub":"18a00000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select lives_ok(
  $$select public.begin_payment_checkout(pg_temp.p18_pay('order_a', 'Fit sample'))$$,
  'a failed payment can be paid again');
reset role;

select public.record_payment_funded(pg_temp.p18_pay('order_a', 'Fit sample'), 'ch_p18_a', 'card', 'Visa ···4242', 53500);
select is(pg_temp.p18_state('order_a', 'Fit sample'), 'confirmed', 'the card payment arrived: TSC holds it');
select is(
  (select row(confirmed_by is null, confirmed_at is not null, release_requested_at is null, payment_method_label)::text
     from public.order_payments where id = pg_temp.p18_pay('order_a', 'Fit sample')),
  row(true, true, true, 'Visa ···4242')::text,
  'stamped by Stripe, not a person, and not yet owed to the factory');
select is((select state::text from public.order_milestones where id = pg_temp.p18_step('order_a', 'Fit sample')),
  'active', 'funding does not finish a Paid release step: the brand still approves it');
select is(
  (select awaiting_factory from public.production_order_summary where id = (select id from p18 where name = 'order_a')),
  true, 'once funded, the work is the factory''s turn');

select public.record_payment_funded(pg_temp.p18_pay('order_a', 'Fit sample'), 'ch_p18_a', 'card', 'Visa ···4242', 53500);
select is(
  (select count(*) from public.payment_events
    where payment_id = pg_temp.p18_pay('order_a', 'Fit sample') and to_state = 'confirmed'),
  1::bigint, 'the same webhook twice records it once');

-- ---------------------------------------------------------------------------
-- Approving releases it: the step completes and the payout is requested
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"18a00000-0000-0000-0000-000000000002","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$select public.approve_milestone(pg_temp.p18_step('order_a', 'Fit sample'), null)$$,
  '42501', NULL, 'a brand member cannot approve a step that releases money');
reset role;

set local request.jwt.claims = '{"sub":"18a00000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select lives_ok(
  $$select public.approve_milestone(pg_temp.p18_step('order_a', 'Fit sample'), 'Lovely fit.')$$,
  'the brand owner approves the funded step');
reset role;

select is((select state::text from public.order_milestones where id = pg_temp.p18_step('order_a', 'Fit sample')),
  'complete', 'the step is complete');
select ok(
  (select release_requested_at is not null and state = 'confirmed'
     from public.order_payments where id = pg_temp.p18_pay('order_a', 'Fit sample')),
  'its payout is requested; the money is still held until it goes');
select is(pg_temp.p18_state('order_a', 'Balance'), 'due',
  'the chain moved on the approval, not the payout: the balance is due');

select public.record_payment_released(pg_temp.p18_pay('order_a', 'Fit sample'), 'tr_p18_a');
select public.record_payment_released(pg_temp.p18_pay('order_a', 'Fit sample'), 'tr_p18_other');
select is(
  (select state::text || ' ' || stripe_transfer_id from public.order_payments where id = pg_temp.p18_pay('order_a', 'Fit sample')),
  'released tr_p18_a', 'paid out once; a repeat changes nothing');
select is(pg_temp.p18_notes('18b00000-0000-0000-0000-0000000000f1', 'funds_released', 'order_a'), 1::bigint,
  'the factory is told it was paid');

-- A payment-only step has nothing to approve: funding it pays it out.
select public.record_payment_funded(pg_temp.p18_pay('order_a', 'Balance'), 'ch_p18_a2', 'card', 'Visa ···4242', 160500);
select is((select state::text from public.order_milestones where id = pg_temp.p18_step('order_a', 'Balance')),
  'complete', 'funding the balance completes it');
select ok(
  (select release_requested_at is not null from public.order_payments where id = pg_temp.p18_pay('order_a', 'Balance')),
  'and requests its payout at once');
select is((select status::text from public.production_orders where id = (select id from p18 where name = 'order_a')),
  'completed', 'and the order is done');

-- ---------------------------------------------------------------------------
-- Editing the steps never moves money that has moved
-- ---------------------------------------------------------------------------

select public.record_payment_processing(pg_temp.p18_pay('order_b', 'Fit sample'), 'us_bank_account', 'STRIPE TEST BANK ···6789');

set local request.jwt.claims = '{"sub":"18a00000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select public.update_order_milestone_details((select id from p18 where name = 'order_b'),
  jsonb_build_array(
    jsonb_build_object('id', pg_temp.p18_step('order_b', 'Fit sample'), 'kind', 'approval_and_payment',
                       'title', 'Fit sample, round 1', 'amount_cents', 150000, 'sort', 10),
    jsonb_build_object('id', pg_temp.p18_step('order_b', 'Balance'), 'kind', 'payment_only',
                       'title', 'Balance', 'amount_cents', 450000, 'sort', 20)));
reset role;

select is(pg_temp.p18_state('order_b', 'Fit sample, round 1'), 'processing',
  'renaming a step leaves its clearing payment alone');

-- ---------------------------------------------------------------------------
-- Cancelling: what was never paid is cancelled, real money stays for staff
-- ---------------------------------------------------------------------------

select public.record_payment_failed(pg_temp.p18_pay('order_c', 'Fit sample'), 'Your card was declined.');

set local request.jwt.claims = '{"sub":"18a00000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select public.propose_cancellation((select id from p18 where name = 'order_b'), 'Season dropped');
select public.propose_cancellation((select id from p18 where name = 'order_c'), 'Season dropped');
reset role;
set local request.jwt.claims = '{"sub":"18a00000-0000-0000-0000-000000000003","role":"authenticated"}';
set local role authenticated;
select public.accept_cancellation((select id from p18 where name = 'order_b'));
select public.accept_cancellation((select id from p18 where name = 'order_c'));
reset role;

select is(pg_temp.p18_state('order_c', 'Fit sample'), 'cancelled', 'a failed payment is cancelled with the order');
select is(pg_temp.p18_state('order_b', 'Fit sample, round 1'), 'processing',
  'a bank payment already on its way is left alone');
select is(pg_temp.p18_state('order_b', 'Balance'), 'cancelled', 'and the step never reached is cancelled');

select public.record_payment_funded(pg_temp.p18_pay('order_b', 'Fit sample, round 1'), 'ch_p18_b', 'us_bank_account', 'STRIPE TEST BANK ···6789', 157500);
select is(pg_temp.p18_state('order_b', 'Fit sample, round 1'), 'confirmed',
  'when it lands on a cancelled order, it is recorded as held');
select ok(
  (select release_requested_at is null from public.order_payments where id = pg_temp.p18_pay('order_b', 'Fit sample, round 1')),
  'and nothing is paid out from a cancelled order');

-- ---------------------------------------------------------------------------
-- The staff board, and the factory's Stripe account
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"18a00000-0000-0000-0000-000000000004","role":"authenticated"}';
set local role authenticated;
select throws_ok($$select * from public.admin_payment_board()$$, '42501', NULL,
  'a company cannot read the staff payments board');
reset role;

set local request.jwt.claims = '{"sub":"18a00000-0000-0000-0000-000000000005","role":"authenticated"}';
set local role authenticated;
select is(
  (select order_status from public.admin_payment_board()
    where payment_id = pg_temp.p18_pay('order_b', 'Fit sample, round 1')),
  'cancelled', 'staff see money held on a cancelled order, to refund it');
select is(
  (select factory_stripe_ready from public.admin_payment_board()
    where payment_id = pg_temp.p18_pay('order_a', 'Balance')),
  false, 'and a payout owed to a factory with no Stripe account, to pay by bank');
-- The overview card is staff's only prompt: it counts exactly what only a
-- person can move on the board (wire claims, payouts owed, held on cancelled).
select is(
  (select payments_awaiting_confirmation from public.admin_overview_metrics()),
  (select count(*)::integer from public.admin_payment_board() b
    where b.state = 'sent'
       or (b.state = 'confirmed' and b.release_requested_at is not null)
       or (b.state in ('confirmed', 'processing') and b.order_status = 'cancelled')),
  'the overview counts every payment waiting on staff, payouts owed included');
select ok(
  (select payments_awaiting_confirmation from public.admin_overview_metrics()) >= 2,
  'which here includes the payout owed and the money held on the cancelled order');
reset role;

insert into public.stripe_connect_accounts (org_id, stripe_account_id, country, transfers_active)
values ('18b00000-0000-0000-0000-0000000000f1', 'acct_p18', 'PT', true);

set local request.jwt.claims = '{"sub":"18a00000-0000-0000-0000-000000000003","role":"authenticated"}';
set local role authenticated;
select is((select stripe_account_id from public.stripe_connect_accounts where org_id = '18b00000-0000-0000-0000-0000000000f1'),
  'acct_p18', 'the factory reads its own payout setup');
select throws_ok(
  $$update public.stripe_connect_accounts set transfers_active = false where org_id = '18b00000-0000-0000-0000-0000000000f1'$$,
  '42501', NULL, 'but cannot change it: only Stripe''s word, through the server, does');
reset role;

set local request.jwt.claims = '{"sub":"18a00000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.stripe_connect_accounts where org_id = '18b00000-0000-0000-0000-0000000000f1'),
  0::bigint, 'a brand cannot read how its factory is paid');
select throws_ok($$select count(*) from public.stripe_customers$$, '42501', NULL,
  'nor anyone''s Stripe customer');
reset role;

select * from finish();
rollback;
