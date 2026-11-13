-- ============================================================================
-- Payments held by TSC through Stripe (20261012000100/200, 20261022000300)
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
-- staff; and editing the steps never moves money that has moved. And
-- (20261022000300) money a payment no longer wants is never recorded as
-- held, a refund puts the payment back where the brand can pay again, and
-- staff cannot pay out Stripe money before the brand approved.
-- ============================================================================

begin;

-- These fixtures approve factories that have no registration number; the
-- registry guard (20261108600000) is tested in registry_checks_test.sql.
set local tsc.skip_registry_guard = 'on';

create extension if not exists pgtap with schema extensions;

select plan(161);

-- ---------------------------------------------------------------------------
-- Fixtures: a brand (owner + member), a factory, a stranger brand, an admin,
-- and four awarded orders: A $2,000, B $6,000, C $2,000, D $2,000.
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
  ('18c00000-0000-0000-0000-00000000000c', '18b00000-0000-0000-0000-00000000000b', 'P18 C', 'A hundred hats.',   'open', 'open_to_all', 100),
  ('18c00000-0000-0000-0000-00000000000d', '18b00000-0000-0000-0000-00000000000b', 'P18 D', 'A hundred scarves.', 'open', 'open_to_all', 100);

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
   '18b00000-0000-0000-0000-0000000000f1', 'submitted', 2000, 100, 28, 30, 70, current_date + 30, now()),
  ('18d00000-0000-0000-0000-00000000000d', '18c00000-0000-0000-0000-00000000000d',
   '18b00000-0000-0000-0000-0000000000f1', 'submitted', 2000, 100, 28, 30, 70, current_date + 30, now());

set local request.jwt.claims = '{"sub":"18a00000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select public.award_quote('18d00000-0000-0000-0000-00000000000a');
select public.award_quote('18d00000-0000-0000-0000-00000000000b');
select public.award_quote('18d00000-0000-0000-0000-00000000000c');
select public.award_quote('18d00000-0000-0000-0000-00000000000d');
reset role;

create temporary table p18 (name text primary key, id uuid);
insert into p18
select 'order_' || lower(right(quote_id::text, 1)), id
from public.production_orders
where quote_id in ('18d00000-0000-0000-0000-00000000000a',
                   '18d00000-0000-0000-0000-00000000000b',
                   '18d00000-0000-0000-0000-00000000000c',
                   '18d00000-0000-0000-0000-00000000000d');
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
select public.set_order_schedule((select id from p18 where name = 'order_d'),
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
  4::bigint, 'fixture: all four orders are under way');

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
  $$select public.record_payment_funded(pg_temp.p18_pay('order_a', 'Fit sample'), 'ch_x', 'card', 'Visa ···4242', 55129)$$,
  '42501', NULL, 'the brand that pays cannot say its own payment arrived');
reset role;

-- ---------------------------------------------------------------------------
-- Starting a checkout: an owner, for what is owed
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"18a00000-0000-0000-0000-000000000002","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$select public.begin_payment_checkout(pg_temp.p18_pay('order_a', 'Fit sample'))$$,
  '42501', 'You need the Release funds permission at P18 Brand to do this. An owner can give it to you in Settings.',
  'a brand member without Release funds cannot start paying');
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
  55129::bigint, 'the owner starts paying $551.29: the $500 step, the $35 service fee and the $16.29 card processing fee');
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

select public.attach_payment_intent(pg_temp.p18_pay('order_a', 'Fit sample'), 'pi_p18_a', 55129);
select public.record_payment_processing(pg_temp.p18_pay('order_a', 'Fit sample'), 'us_bank_account', 'STRIPE TEST BANK ···6789');

select is(pg_temp.p18_state('order_a', 'Fit sample'), 'processing', 'a bank payment is clearing');
select is(pg_temp.p18_notes('18b00000-0000-0000-0000-0000000000f1', 'payment_processing', 'order_a'), 1::bigint,
  'the factory is told it is on its way, not to start');
select ok(
  (select bool_and(n.body like '%still being confirmed%' and n.body not like '%Stripe%') from public.notifications n
    where n.kind = 'payment_processing' and n.order_id = (select id from p18 where name = 'order_a')),
  'in words that name no payment provider');

set local request.jwt.claims = '{"sub":"18a00000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$select public.begin_payment_checkout(pg_temp.p18_pay('order_a', 'Fit sample'))$$,
  '22023', 'that payment is processing, so there is nothing to pay', 'a payment clearing cannot be paid twice');
reset role;

select throws_ok(
  $$select public.attach_payment_intent(pg_temp.p18_pay('order_a', 'Fit sample'), 'pi_other', 55129)$$,
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

select public.record_payment_funded(pg_temp.p18_pay('order_a', 'Fit sample'), 'ch_p18_a', 'card', 'Visa ···4242', 55129);
select is(pg_temp.p18_state('order_a', 'Fit sample'), 'confirmed', 'the card payment arrived: TSC holds it');
select ok(
  (select n.body like '%received on %' || o.order_number || '%TSC holds it%' from public.notifications n
     join public.production_orders o on o.id = n.order_id
    where n.kind = 'payment_confirmed' and n.org_id = '18b00000-0000-0000-0000-00000000000b'
      and n.order_id = (select id from p18 where name = 'order_a')),
  'the brand''s "TSC holds it" names the order');
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

select public.record_payment_funded(pg_temp.p18_pay('order_a', 'Fit sample'), 'ch_p18_a', 'card', 'Visa ···4242', 55129);
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
select public.record_payment_funded(pg_temp.p18_pay('order_a', 'Balance'), 'ch_p18_a2', 'card', 'Visa ···4242', 165325);
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

select public.record_payment_funded(pg_temp.p18_pay('order_b', 'Fit sample, round 1'), 'ch_p18_b', 'us_bank_account', 'STRIPE TEST BANK ···6789', 162235);
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
-- person can move on the board (payouts owed, and a cancelled order's refund
-- Stripe refused). Bank-wire claims left the board on Nov 7 (20261108309000);
-- held money on a cancelled order is refunded automatically (20261108300000),
-- so it counts only once its refund failed (20261108309000).
select is(
  (select payments_awaiting_confirmation from public.admin_overview_metrics()),
  (select count(*)::integer from public.admin_payment_board() b
    where (b.state = 'confirmed' and b.release_requested_at is not null)
       or (b.state in ('confirmed', 'processing') and b.order_status = 'cancelled' and b.refund_failed_at is not null)),
  'the overview counts every payment waiting on staff, payouts owed included');
select ok(
  (select payments_awaiting_confirmation from public.admin_overview_metrics()) >= 1,
  'which here includes the payout owed');
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

-- ---------------------------------------------------------------------------
-- A payout is claimed before it is sent, so two callers never both pay
-- ---------------------------------------------------------------------------
-- Order A's balance is held and owed to the factory (funding it asked for
-- its payout), which is exactly what the server claims before a transfer.

select ok(public.claim_payment_release(pg_temp.p18_pay('order_a', 'Balance')) is not null,
  'the first caller claims the payout');
select ok(public.claim_payment_release(pg_temp.p18_pay('order_a', 'Balance')) is null,
  'a second caller at the same moment is told it is taken');

select public.release_payment_claim(pg_temp.p18_pay('order_a', 'Balance'), now() - interval '1 second');
select ok(
  (select release_claimed_at is not null from public.order_payments where id = pg_temp.p18_pay('order_a', 'Balance')),
  'handing back a claim that is not yours leaves it alone');
select public.release_payment_claim(pg_temp.p18_pay('order_a', 'Balance'),
  (select release_claimed_at from public.order_payments where id = pg_temp.p18_pay('order_a', 'Balance')));
select ok(
  (select release_claimed_at is null from public.order_payments where id = pg_temp.p18_pay('order_a', 'Balance')),
  'a failed payout hands its claim back');
select ok(public.claim_payment_release(pg_temp.p18_pay('order_a', 'Fit sample')) is null,
  'a payment already paid out cannot be claimed');

select ok(not has_function_privilege('anon', 'public.claim_payment_release(uuid)', 'execute'),
  'a signed-out visitor cannot claim a payout');
select ok(not has_function_privilege('authenticated', 'public.claim_payment_release(uuid)', 'execute'),
  'nor can a signed-in user');
select ok(not has_function_privilege('authenticated', 'public.release_payment_claim(uuid, timestamptz)', 'execute'),
  'nor hand one back');
select ok(not has_function_privilege('authenticated', 'public.claim_stripe_event(text, text)', 'execute'),
  'nor claim a Stripe event');
select ok(has_function_privilege('service_role', 'public.claim_payment_release(uuid)', 'execute'),
  'server code with the service key can');

-- ---------------------------------------------------------------------------
-- A webhook event that timed out is run again; a handled one is not
-- ---------------------------------------------------------------------------

select has_column('public', 'stripe_events', 'processed_at', 'an event records when it was handled');
select is(public.claim_stripe_event('evt_pgtap18_a', 'payment_intent.succeeded'), true,
  'a new event is claimed');
select is(public.claim_stripe_event('evt_pgtap18_a', 'payment_intent.succeeded'), false,
  'a repeat while it is being handled does nothing');
update public.stripe_events set claimed_at = now() - interval '6 minutes' where id = 'evt_pgtap18_a';
select is(public.claim_stripe_event('evt_pgtap18_a', 'payment_intent.succeeded'), true,
  'an attempt that never finished is run again after 5 minutes');
update public.stripe_events set processed_at = now(), claimed_at = now() - interval '6 minutes' where id = 'evt_pgtap18_a';
select is(public.claim_stripe_event('evt_pgtap18_a', 'payment_intent.succeeded'), false,
  'a handled event is never run again');

-- ---------------------------------------------------------------------------
-- Only staff set a factory's trust tier
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"18a00000-0000-0000-0000-000000000003","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$update public.factory_profiles set trust_tier = 'trusted' where org_id = '18b00000-0000-0000-0000-0000000000f1'$$,
  '42501', NULL, 'a factory cannot give itself a trust tier');
select lives_ok(
  $$update public.factory_profiles set moq = 150 where org_id = '18b00000-0000-0000-0000-0000000000f1'$$,
  'but still edits the rest of its profile');
reset role;

-- Verified needs a walkthrough on file; staff then set it through the review.
insert into public.documents (org_id, kind, bucket, storage_path, file_name, size_bytes) values
  ('18b00000-0000-0000-0000-0000000000f1', 'walkthrough', 'org-private', 'pgtap18/walkthrough.mp4', 'walkthrough.mp4', 1000);

set local request.jwt.claims = '{"sub":"18a00000-0000-0000-0000-000000000005","role":"authenticated"}';
set local role authenticated;
select public.admin_review_decision_with_tier('18b00000-0000-0000-0000-0000000000f1', 'approved', null, null, 'verified');
reset role;
select is((select trust_tier::text from public.factory_profiles where org_id = '18b00000-0000-0000-0000-0000000000f1'),
  'verified', 'staff set the tier when approving the factory');

-- ---------------------------------------------------------------------------
-- Money a payment no longer wants is refunded, never recorded (20261022000300)
-- ---------------------------------------------------------------------------

select ok(not has_function_privilege('authenticated', 'public.record_payment_succeeded(uuid, text, text, text, text, bigint)', 'execute'),
  'a signed-in user cannot record a PaymentIntent as paid');
select ok(not has_function_privilege('anon', 'public.record_payment_refunded(uuid, text, text)', 'execute'),
  'a signed-out visitor cannot record a refund');
select ok(not has_function_privilege('authenticated', 'public.record_payment_refunded(uuid, text, text)', 'execute'),
  'nor can a signed-in user');
select ok(has_function_privilege('service_role', 'public.record_payment_succeeded(uuid, text, text, text, text, bigint)', 'execute')
      and has_function_privilege('service_role', 'public.record_payment_refunded(uuid, text, text)', 'execute'),
  'server code with the service key can do both');

-- Order D: the brand opens the Fund page at $551.29, then raises the step to
-- $600 while that intent is still payable, and pays the old intent.
select public.attach_payment_intent(pg_temp.p18_pay('order_d', 'Fit sample'), 'pi_p18_d1', 55129);
set local request.jwt.claims = '{"sub":"18a00000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select public.update_order_milestone_details((select id from p18 where name = 'order_d'),
  jsonb_build_array(
    jsonb_build_object('id', pg_temp.p18_step('order_d', 'Fit sample'), 'kind', 'approval_and_payment',
                       'title', 'Fit sample', 'amount_cents', 60000, 'sort', 10),
    jsonb_build_object('id', pg_temp.p18_step('order_d', 'Balance'), 'kind', 'payment_only',
                       'title', 'Balance', 'amount_cents', 140000, 'sort', 20)));
reset role;

select is(
  public.record_payment_succeeded(pg_temp.p18_pay('order_d', 'Fit sample'), 'pi_p18_d1', 'ch_p18_d1', 'card', 'Visa ···4242', 55129) ->> 'problem',
  'amount_changed', 'the old figure arriving after the amount changed is not recorded');
select is(pg_temp.p18_state('order_d', 'Fit sample'), 'due', 'the payment is still due');
select is(
  public.record_payment_succeeded(pg_temp.p18_pay('order_d', 'Fit sample'), 'pi_p18_dx', 'ch_p18_dx', 'card', 'Visa ···4242', 66149) ->> 'problem',
  'other_intent', 'nor money from an intent that is not the payment''s own');

select public.record_payment_refunded(pg_temp.p18_pay('order_d', 'Fit sample'), 'pi_p18_d1',
  'The amount changed while you were paying. You were refunded; please pay again.');
select is(
  (select row(state::text, stripe_payment_intent_id is null, charged_cents is null, refunded_at is not null)::text
     from public.order_payments where id = pg_temp.p18_pay('order_d', 'Fit sample')),
  row('failed', true, true, true)::text,
  'refunded on an active order: failed, its intent let go so a new one can be made');
select is((select failure_reason from public.order_payments where id = pg_temp.p18_pay('order_d', 'Fit sample')),
  'The amount changed while you were paying. You were refunded; please pay again.', 'with the reason the brand reads');
select is(
  (select count(*) from public.payment_events
    where payment_id = pg_temp.p18_pay('order_d', 'Fit sample') and to_state = 'failed' and note like '%pi_p18_d1%'),
  1::bigint, 'the refund is in the payment''s history, naming the intent');
select is(pg_temp.p18_notes('18b00000-0000-0000-0000-00000000000b', 'payment_refunded', 'order_d'), 1::bigint,
  'the brand is told it was refunded');
select public.record_payment_refunded(pg_temp.p18_pay('order_d', 'Fit sample'), 'pi_p18_d1', 'The payment was refunded.');
select is(
  (select count(*) from public.payment_events where payment_id = pg_temp.p18_pay('order_d', 'Fit sample') and note like '%pi_p18_d1%'),
  1::bigint, 'the same refund reported again writes nothing');

select lives_ok(
  $$select public.attach_payment_intent(pg_temp.p18_pay('order_d', 'Fit sample'), 'pi_p18_d2', 66149)$$,
  'the next checkout attaches a new intent');
select is(
  (public.record_payment_succeeded(pg_temp.p18_pay('order_d', 'Fit sample'), 'pi_p18_d2', 'ch_p18_d2', 'card', 'Visa ···4242', 66149) ->> 'funded')::boolean,
  true, 'and the new amount plus its fees ($661.49) is recorded as held');

-- Staff cannot pay out Stripe money the brand has not approved.
set local request.jwt.claims = '{"sub":"18a00000-0000-0000-0000-000000000005","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$select public.release_payment_to_factory(pg_temp.p18_pay('order_d', 'Fit sample'), 'paid by bank')$$,
  '22023', 'the brand has not approved this step yet: money paid through Stripe is paid out once the brand approves it',
  'staff cannot mark a Stripe-funded payment paid out before the brand approves');
reset role;

-- Held money refunded in Stripe: the brand pays again, and the step cannot
-- be approved meanwhile.
set local request.jwt.claims = '{"sub":"18a00000-0000-0000-0000-000000000003","role":"authenticated"}';
set local role authenticated;
select public.post_milestone_update(pg_temp.p18_step('order_d', 'Fit sample'), 'Scarf sample made.', '{}');
reset role;

select public.record_payment_refunded(pg_temp.p18_pay('order_d', 'Fit sample'), 'pi_p18_d2', 'The payment was refunded.');
select is(pg_temp.p18_state('order_d', 'Fit sample'), 'failed', 'held money refunded in Stripe goes back to failed');
select is(pg_temp.p18_notes('18b00000-0000-0000-0000-0000000000f1', 'payment_refunded', 'order_d'), 1::bigint,
  'and the factory, which was told it was held, is told it is not');

set local request.jwt.claims = '{"sub":"18a00000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$select public.approve_milestone(pg_temp.p18_step('order_d', 'Fit sample'), null)$$,
  '22023', NULL, 'a step whose money was refunded cannot be approved');
reset role;

-- A second decline on the same Fund page updates the reason.
select public.record_payment_failed(pg_temp.p18_pay('order_d', 'Fit sample'), 'Your card has insufficient funds.');
select is((select failure_reason from public.order_payments where id = pg_temp.p18_pay('order_d', 'Fit sample')),
  'Your card has insufficient funds.', 'a repeated decline shows its own reason');
select is(
  (select count(*) from public.payment_events
    where payment_id = pg_temp.p18_pay('order_d', 'Fit sample') and from_state = 'failed' and to_state = 'failed'),
  1::bigint, 'with one line in the history');
select public.record_payment_failed(pg_temp.p18_pay('order_d', 'Fit sample'), 'Your card has insufficient funds.');
select is(
  (select count(*) from public.payment_events
    where payment_id = pg_temp.p18_pay('order_d', 'Fit sample') and from_state = 'failed' and to_state = 'failed'),
  1::bigint, 'and the same answer again adds none');

-- Paid again, approved, paid out; then refunded after the payout.
select public.attach_payment_intent(pg_temp.p18_pay('order_d', 'Fit sample'), 'pi_p18_d3', 66149);
select is(
  (public.record_payment_succeeded(pg_temp.p18_pay('order_d', 'Fit sample'), 'pi_p18_d3', 'ch_p18_d3', 'card', 'Visa ···4242', 66149) ->> 'funded')::boolean,
  true, 'the brand pays again');

set local request.jwt.claims = '{"sub":"18a00000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select lives_ok($$select public.approve_milestone(pg_temp.p18_step('order_d', 'Fit sample'), null)$$,
  'and approves the step');
reset role;

-- Stripe can no longer pay this factory, so a person does (20261108710000).
update public.stripe_connect_accounts set transfers_active = false
 where org_id = (select o.factory_org_id from public.production_orders o join public.order_payments p on p.order_id = o.id where p.id = pg_temp.p18_pay('order_d', 'Fit sample'));

set local request.jwt.claims = '{"sub":"18a00000-0000-0000-0000-000000000005","role":"authenticated"}';
set local role authenticated;
select lives_ok(
  $$select public.release_payment_to_factory(pg_temp.p18_pay('order_d', 'Fit sample'), 'paid by bank')$$,
  'staff mark an approved Stripe-funded payment paid out by bank');
reset role;
update public.stripe_connect_accounts set transfers_active = true
 where org_id = (select o.factory_org_id from public.production_orders o join public.order_payments p on p.order_id = o.id where p.id = pg_temp.p18_pay('order_d', 'Fit sample'));
select is(pg_temp.p18_state('order_d', 'Fit sample'), 'released', 'it is paid out');

select public.record_payment_refunded(pg_temp.p18_pay('order_d', 'Fit sample'), 'pi_p18_d3', 'The payment was refunded.');
select ok(
  (select state = 'released' and refunded_at is not null from public.order_payments where id = pg_temp.p18_pay('order_d', 'Fit sample')),
  'a refund after the payout leaves it paid out, marked refunded');
set local request.jwt.claims = '{"sub":"18a00000-0000-0000-0000-000000000005","role":"authenticated"}';
set local role authenticated;
select is(
  (select state::text from public.admin_payment_board() where payment_id = pg_temp.p18_pay('order_d', 'Fit sample')),
  'released', 'and staff see it on the board, to recover by hand');
reset role;

-- The old bank-wire path is unchanged: claimed, confirmed, paid out.
set local request.jwt.claims = '{"sub":"18a00000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select public.mark_payment_sent(pg_temp.p18_pay('order_d', 'Balance'), 'WIRE-P18-D', null);
reset role;
set local request.jwt.claims = '{"sub":"18a00000-0000-0000-0000-000000000005","role":"authenticated"}';
set local role authenticated;
select public.confirm_payment_received(pg_temp.p18_pay('order_d', 'Balance'), null, null);
select lives_ok(
  $$select public.release_payment_to_factory(pg_temp.p18_pay('order_d', 'Balance'), 'wired')$$,
  'a bank-wire payment is still paid out by staff');
reset role;

-- Cancelled orders: money that arrives late is refunded, and stays cancelled.
select public.attach_payment_intent(pg_temp.p18_pay('order_c', 'Balance'), 'pi_p18_c', 165325);
select is(
  public.record_payment_succeeded(pg_temp.p18_pay('order_c', 'Balance'), 'pi_p18_c', 'ch_p18_c', 'card', 'Visa ···4242', 165325) ->> 'problem',
  'order_cancelled', 'an intent paid after the order was cancelled is not recorded');
select public.attach_payment_intent(pg_temp.p18_pay('order_b', 'Fit sample, round 1'), 'pi_p18_b', 162235);
select public.record_payment_refunded(pg_temp.p18_pay('order_b', 'Fit sample, round 1'), 'pi_p18_b', 'The payment was refunded.');
select is(
  (select row(state::text, stripe_payment_intent_id is null)::text
     from public.order_payments where id = pg_temp.p18_pay('order_b', 'Fit sample, round 1')),
  row('cancelled', false)::text,
  'money held on a cancelled order and refunded in Stripe is cancelled, and keeps its intent as the record');

-- The bell says what the card will be charged: the step plus the fee, 7% on
-- this order (order_d's steps are edited after their notices, so not those).
select is(
  (select count(*) from public.notifications n
    join public.order_payments p on p.id = n.subject_id
   where n.kind = 'payment_due'
     and p.id in (pg_temp.p18_pay('order_a', 'Fit sample'), pg_temp.p18_pay('order_a', 'Balance'))
     and n.title like public.format_money(public.payment_charge_cents(p.id), p.currency) || ' is due on %'),
  2::bigint,
  'a due notice names the amount with both fees');

-- The note is said with the amount, not instead of it, and a factory TSC had no
-- way to pay at the time is told what to do first.
select is(
  (select n.body from public.notifications n
    where n.kind = 'milestone_approved' and n.subject_id = pg_temp.p18_step('order_a', 'Fit sample')),
  'The brand approved this step. TSC will send you $500.00 once you add a withdrawal method. Their note: Lovely fit.',
  'an approval says the amount, what to do and the note');

-- ===========================================================================
-- The card processing fee, on top of the brand's payment (20261113900000)
-- ---------------------------------------------------------------------------
-- The negatives first: nobody signed in writes the rate or a payment's
-- snapshot of it, whichever company they are in, both included.
-- ===========================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('18a00000-0000-0000-0000-000000000006', 'p18-both@example.com', '{"name":"Both Companies"}');
insert into public.org_members (org_id, user_id, role) values
  ('18b00000-0000-0000-0000-00000000000b', '18a00000-0000-0000-0000-000000000006', 'owner'),
  ('18b00000-0000-0000-0000-0000000000f1', '18a00000-0000-0000-0000-000000000006', 'owner');

-- One person at a time: the brand owner, the factory owner, someone in both.
create function pg_temp.p18_as(who text) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    format('{"sub":"18a00000-0000-0000-0000-00000000000%s","role":"authenticated"}', who), true);
  perform set_config('role', 'authenticated', true);
end;
$$;

select pg_temp.p18_as('1');
select throws_ok($$insert into public.payment_processing_rates (processor, currency, percent_bps, fixed_cents) values ('stripe_card', 'EUR', 0, 0)$$,
  '42501', NULL, 'a brand owner cannot add a card rate');
select throws_ok($$update public.payment_processing_rates set percent_bps = 0, fixed_cents = 0$$,
  '42501', NULL, 'nor change one');
select throws_ok($$delete from public.payment_processing_rates$$,
  '42501', NULL, 'nor delete one');
select throws_ok($$update public.order_payments set processing_fee_bps = 0, processing_fee_fixed_cents = 0 where id = pg_temp.p18_pay('order_a', 'Balance')$$,
  '42501', NULL, 'nor take the card fee off its own payment');
select is((select percent_bps from public.payment_processing_rates where processor = 'stripe_card' and currency = 'USD'),
  290, 'but it can read the rate: it is not secret, and the order page''s figures need it');
reset role;

select pg_temp.p18_as('3');
select throws_ok($$insert into public.payment_processing_rates (processor, currency, percent_bps, fixed_cents) values ('stripe_card', 'EUR', 0, 0)$$,
  '42501', NULL, 'a factory owner cannot add a card rate');
select throws_ok($$update public.payment_processing_rates set percent_bps = 2000$$,
  '42501', NULL, 'nor change one');
select throws_ok($$delete from public.payment_processing_rates$$,
  '42501', NULL, 'nor delete one');
select throws_ok($$update public.order_payments set processing_fee_bps = 2000 where id = pg_temp.p18_pay('order_a', 'Balance')$$,
  '42501', NULL, 'nor change the card fee on a payment of its order');
reset role;

select pg_temp.p18_as('6');
select throws_ok($$insert into public.payment_processing_rates (processor, currency, percent_bps, fixed_cents) values ('stripe_card', 'EUR', 0, 0)$$,
  '42501', NULL, 'someone in both the brand and the factory cannot add a card rate');
select throws_ok($$update public.payment_processing_rates set percent_bps = 0$$,
  '42501', NULL, 'nor change one');
select throws_ok($$truncate public.payment_processing_rates$$,
  '42501', NULL, 'nor empty the table');
select throws_ok($$update public.order_payments set processing_fee_bps = 0, processing_fee_fixed_cents = 0 where id = pg_temp.p18_pay('order_a', 'Balance')$$,
  '42501', NULL, 'nor take the card fee off a payment');
select throws_ok($$insert into public.order_payments (order_id, milestone_id, amount_cents) values ((select id from p18 where name = 'order_a'), pg_temp.p18_step('order_a', 'Balance'), 100)$$,
  '42501', NULL, 'nor insert a payment of its own');
reset role;

set local role anon;
select throws_ok($$select * from public.payment_processing_rates$$,
  '42501', NULL, 'a signed-out visitor cannot read the rate');
reset role;

select ok(not has_function_privilege('authenticated', 'public.order_payment_processing_fee()', 'execute'),
  'the trigger that sets the rate is not callable by a signed-in user');
select is((select row(percent_bps, fixed_cents)::text from public.payment_processing_rates
            where processor = 'stripe_card' and currency = 'USD'),
  row(290, 30::bigint)::text, 'after all that, the rate is still Stripe US standard: 2.9% + 30c');

-- ---------------------------------------------------------------------------
-- The money path
-- ---------------------------------------------------------------------------

select is(
  (select count(*) from public.order_payments
    where order_id in (select id from p18 where name in ('order_a', 'order_b', 'order_c', 'order_d'))
      and (processing_fee_bps, processing_fee_fixed_cents) is distinct from (290, 30::bigint)),
  0::bigint, 'every payment on an order started now is priced at 2.9% + 30c');

-- The gross-up at the amounts the plan names.
select is(public.processing_fee_for(107, 290, 30), 35::bigint,
  '$1 step at 7%: a $0.35 card fee, $1.42 in all');
select is(public.processing_fee_for(534998, 290, 30), 16010::bigint,
  '$4,999.99 step at 7%: a $160.10 card fee, $5,510.08 in all');
select is(public.processing_fee_for(525000, 290, 30), 15711::bigint,
  '$5,000 step at 5%: a $157.11 card fee, $5,407.11 in all');
select is(public.processing_fee_for(53500, 290, 30), 1629::bigint,
  '$500 step at 7%: a $16.29 card fee, $551.29 in all');
select is(public.processing_fee_for(787500000, 290, 30), 23519599::bigint,
  'a $7.5M deposit at 5%: a $235,195.99 card fee, $8,110,195.99 in all, exact in bigint');
select is(public.processing_fee_for(53500, 0, 0), 0::bigint, 'a 0 rate adds nothing');

-- Rounding: TSC never nets under the step plus the service fee, and a cent
-- less would. Stripe's percentage taken as ceil, the side that costs TSC.
select is(
  (select count(*) from (
     select b, b + public.processing_fee_for(b, 290, 30) as t
     from (select generate_series(1, 300000, 37)::bigint as b
           union all select generate_series(99999000, 100001000)::bigint) amounts
   ) x
   where not (x.t - ceil((x.t * 290)::numeric / 10000)::bigint - 30 >= x.b
              and (x.t - 1) - ceil(((x.t - 1) * 290)::numeric / 10000)::bigint - 30 < x.b)),
  0::bigint, 'over 10,000 amounts, Stripe''s fee taken, TSC keeps the base or a cent over, and the total is the least that does');

-- The figures every screen reads, for the $500 step: one source.
select is(
  (select row(public.service_fee_cents(p), public.processing_fee_cents(p), public.charge_cents(p))::text
     from public.order_payments p where p.id = pg_temp.p18_pay('order_a', 'Fit sample')),
  row(3500::bigint, 1629::bigint, 55129::bigint)::text,
  'the $500 step''s fields: $35 service fee, $16.29 card fee, $551.29 charged');
select is(
  (select row(c.service_fee_cents, c.processing_fee_cents, c.fee_cents, c.charged_cents)::text
     from public.order_step_charges c where c.payment_id = pg_temp.p18_pay('order_a', 'Fit sample')),
  row(3500::bigint, 1629::bigint, 5129::bigint, 55129::bigint)::text,
  'and the order page''s view says the same, fee_cents being everything on top');
select is(public.payment_charge_cents(pg_temp.p18_pay('order_a', 'Fit sample')), 55129::bigint,
  'and so does payment_charge_cents');
select ok(
  (select bool_and(c.charged_cents = public.charge_cents(p))
     from public.order_step_charges c join public.order_payments p on p.id = c.payment_id
    where c.order_id in (select id from p18 where name in ('order_a', 'order_b', 'order_c', 'order_d'))),
  'every step''s charge on the order page is its payment''s charge_cents');
select is(
  (select string_agg(n.title, ' | ') from public.notifications n
    where n.kind = 'payment_due' and n.subject_id = pg_temp.p18_pay('order_a', 'Fit sample')),
  '$551.29 is due on P18 A (' || (select order_number from public.production_orders where id = (select id from p18 where name = 'order_a')) || ')',
  'the bell and email say "$551.29 is due", the Fund screen''s total');

-- The factory's figures carry neither fee.
select is(
  (select total_cents from public.production_order_summary where id = (select id from p18 where name = 'order_a')),
  200000::bigint,
  'the factory''s order summary counts step amounts only');

-- Four new orders at the plan's amounts, each paid in one step but the last.
insert into public.rfqs (id, brand_org_id, title, brief, status, visibility, quantity_total) values
  ('18c00000-0000-0000-0000-0000000000e1', '18b00000-0000-0000-0000-00000000000b', 'P18 E1', 'One dollar.',    'open', 'open_to_all', 100),
  ('18c00000-0000-0000-0000-0000000000e2', '18b00000-0000-0000-0000-00000000000b', 'P18 E2', 'Just under.',    'open', 'open_to_all', 100),
  ('18c00000-0000-0000-0000-0000000000e3', '18b00000-0000-0000-0000-00000000000b', 'P18 E3', 'Five thousand.', 'open', 'open_to_all', 100),
  ('18c00000-0000-0000-0000-0000000000e4', '18b00000-0000-0000-0000-00000000000b', 'P18 E4', 'A big order.',   'open', 'open_to_all', 100000),
  ('18c00000-0000-0000-0000-0000000000f6', '18b00000-0000-0000-0000-00000000000b', 'P18 F',  'An older order.', 'open', 'open_to_all', 100);
insert into public.quotes
  (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity,
   bulk_lead_time_days, deposit_pct, balance_pct, valid_until, submitted_at)
values
  ('18d00000-0000-0000-0000-0000000000e1', '18c00000-0000-0000-0000-0000000000e1',
   '18b00000-0000-0000-0000-0000000000f1', 'submitted', 1, 100, 28, 30, 70, current_date + 30, now()),
  ('18d00000-0000-0000-0000-0000000000e2', '18c00000-0000-0000-0000-0000000000e2',
   '18b00000-0000-0000-0000-0000000000f1', 'submitted', 499999, 1, 28, 30, 70, current_date + 30, now()),
  ('18d00000-0000-0000-0000-0000000000e3', '18c00000-0000-0000-0000-0000000000e3',
   '18b00000-0000-0000-0000-0000000000f1', 'submitted', 5000, 100, 28, 30, 70, current_date + 30, now()),
  ('18d00000-0000-0000-0000-0000000000e4', '18c00000-0000-0000-0000-0000000000e4',
   '18b00000-0000-0000-0000-0000000000f1', 'submitted', 25000, 100000, 28, 30, 70, current_date + 30, now()),
  ('18d00000-0000-0000-0000-0000000000f6', '18c00000-0000-0000-0000-0000000000f6',
   '18b00000-0000-0000-0000-0000000000f1', 'submitted', 2000, 100, 28, 30, 70, current_date + 30, now());

select pg_temp.p18_as('1');
select public.award_quote(q) from unnest(array[
  '18d00000-0000-0000-0000-0000000000e1', '18d00000-0000-0000-0000-0000000000e2',
  '18d00000-0000-0000-0000-0000000000e3', '18d00000-0000-0000-0000-0000000000e4',
  '18d00000-0000-0000-0000-0000000000f6']::uuid[]) q;
reset role;

insert into p18
select case right(quote_id::text, 2) when 'f6' then 'order_f' else 'order_' || right(quote_id::text, 2) end, id
from public.production_orders
where quote_id in ('18d00000-0000-0000-0000-0000000000e1', '18d00000-0000-0000-0000-0000000000e2',
                   '18d00000-0000-0000-0000-0000000000e3', '18d00000-0000-0000-0000-0000000000e4',
                   '18d00000-0000-0000-0000-0000000000f6');

select pg_temp.p18_as('1');
select public.set_order_schedule((select id from p18 where name = 'order_e1'),
  '[{"kind":"payment_only","title":"Full payment","amount_cents":100,"sort":10}]'::jsonb);
select public.set_order_schedule((select id from p18 where name = 'order_e2'),
  '[{"kind":"payment_only","title":"Full payment","amount_cents":499999,"sort":10}]'::jsonb);
select public.set_order_schedule((select id from p18 where name = 'order_e3'),
  '[{"kind":"payment_only","title":"Full payment","amount_cents":500000,"sort":10}]'::jsonb);
select public.set_order_schedule((select id from p18 where name = 'order_e4'),
  '[{"kind":"payment_only","title":"Deposit","amount_cents":750000000,"sort":10},
    {"kind":"payment_only","title":"Balance","amount_cents":1750000000,"sort":20}]'::jsonb);
select public.set_order_schedule((select id from p18 where name = 'order_f'),
  '[{"kind":"approval_and_payment","title":"Fit sample","amount_cents":50000,"sort":10},
    {"kind":"payment_only","title":"Balance","amount_cents":150000,"sort":20}]'::jsonb);
select public.agree_schedule(id, (select schedule_revision from public.production_orders where id = p18.id))
from p18 where name in ('order_e1', 'order_e2', 'order_e3', 'order_e4', 'order_f');
reset role;

-- What the brand is asked for at checkout: step, service fee, card fee, total.
create function pg_temp.p18_checkout(order_name text, step text) returns text
language sql as $$
  select row(j ->> 'amount_cents', j ->> 'fee_cents', j ->> 'processing_fee_cents', j ->> 'charged_cents')::text
  from (select public.begin_payment_checkout(pg_temp.p18_pay(order_name, step)) as j) x
$$;

select pg_temp.p18_as('1');
select is(pg_temp.p18_checkout('order_e1', 'Full payment'), row('100', '7', '35', '142')::text,
  'a $1 order: $1.00 + $0.07 + $0.35 card fee = $1.42 charged');
select is(pg_temp.p18_checkout('order_e2', 'Full payment'), row('499999', '34999', '16010', '551008')::text,
  'a $4,999.99 order (7%): $4,999.99 + $349.99 + $160.10 = $5,510.08 charged');
select is(pg_temp.p18_checkout('order_e3', 'Full payment'), row('500000', '25000', '15711', '540711')::text,
  'a $5,000 order (5%): $5,000.00 + $250.00 + $157.11 = $5,407.11 charged');
-- Decision 8: Stripe takes at most $999,999.99 in one card payment.
select throws_ok($$select public.begin_payment_checkout(pg_temp.p18_pay('order_e4', 'Deposit'))$$,
  '22003',
  'This payment is $8,110,195.99, more than a card can be charged at once ($999,999.99). Split this step into smaller steps, or contact TSC.',
  'a $7.5M deposit is refused at checkout in words, not "try again in a few minutes"');
reset role;

select is(
  (select row(service_fee_cents, processing_fee_cents, charged_cents)::text from public.order_step_charges
    where payment_id = pg_temp.p18_pay('order_e4', 'Deposit')),
  row(37500000::bigint, 23519599::bigint, 811019599::bigint)::text,
  'the $25M order''s deposit is exact in bigint: $375,000 service fee, $235,195.99 card fee, $8,110,195.99');
select is(
  (select total_charged_cents = (select sum(public.charge_cents(p)) from public.order_payments p where p.order_id = c.order_id)
     from public.production_order_charges c where c.order_id = (select id from p18 where name = 'order_e4')),
  true, 'and the order header''s total is the sum of its payments'' charges');
select is((select total_cents from public.production_order_summary where id = (select id from p18 where name = 'order_e4')),
  2500000000::bigint, 'while the factory''s total stays $25,000,000.00');

-- The riskiest line: what Stripe received is checked against the full charge.
select public.attach_payment_intent(pg_temp.p18_pay('order_e3', 'Full payment'), 'pi_p18_e3', 540711);
select is(
  public.record_payment_succeeded(pg_temp.p18_pay('order_e3', 'Full payment'), 'pi_p18_e3', 'ch_p18_e3', 'card', 'Visa ···4242', 525000) ->> 'problem',
  'amount_changed', 'the step plus the service fee alone ($5,250) is not the charge: refused as amount_changed');
select is(pg_temp.p18_state('order_e3', 'Full payment'), 'due', 'and the payment stays due');
select is(
  (public.record_payment_succeeded(pg_temp.p18_pay('order_e3', 'Full payment'), 'pi_p18_e3', 'ch_p18_e3', 'card', 'Visa ···4242', 540711) ->> 'funded')::boolean,
  true, 'the full $5,407.11 is recorded as funded');
select is(
  (select row(p.charged_cents, public.processing_fee_cents(p))::text
     from public.order_payments p where p.id = pg_temp.p18_pay('order_e3', 'Full payment')),
  row(540711::bigint, 15711::bigint)::text, 'charged $5,407.11, of which $157.11 is the card fee');
set local request.jwt.claims = '{"sub":"18a00000-0000-0000-0000-000000000005","role":"authenticated"}';
set local role authenticated;
select is(
  (select row(amount_cents, fee_cents, processing_fee_cents)::text from public.admin_payment_board()
    where payment_id = pg_temp.p18_pay('order_d', 'Fit sample')),
  row(60000::bigint, 4200::bigint, 1949::bigint)::text,
  'staff see the step, the service fee and the card fee: what to send the factory is still the step');
reset role;

-- A payment inserted with a rate of its own gets the database's instead.
insert into public.order_milestones (order_id, sort, kind, title, amount_cents)
values ((select id from p18 where name = 'order_e3'), 30, 'payment_only', 'Extra', 10000);
insert into public.order_payments (order_id, milestone_id, amount_cents, processing_fee_bps, processing_fee_fixed_cents)
values ((select id from p18 where name = 'order_e3'), pg_temp.p18_step('order_e3', 'Extra'), 10000, 0, 0);
select is(
  (select row(processing_fee_bps, processing_fee_fixed_cents)::text from public.order_payments
    where id = pg_temp.p18_pay('order_e3', 'Extra')),
  row(290, 30::bigint)::text, 'a payment inserted with a 0 rate is given its order''s rate anyway');

-- An order whose payments were made before the card fee (simulated): its
-- figures, and an intent opened at them, do not change.
update public.order_payments set processing_fee_bps = 0, processing_fee_fixed_cents = 0
 where order_id = (select id from p18 where name = 'order_f');
select pg_temp.p18_as('1');
select is(pg_temp.p18_checkout('order_f', 'Fit sample'), row('50000', '3500', '0', '53500')::text,
  'an older order''s step is still charged $535.00: no card fee');
reset role;
select public.attach_payment_intent(pg_temp.p18_pay('order_f', 'Fit sample'), 'pi_p18_f', 53500);
select is(
  (public.record_payment_succeeded(pg_temp.p18_pay('order_f', 'Fit sample'), 'pi_p18_f', 'ch_p18_f', 'card', 'Visa ···4242', 53500) ->> 'funded')::boolean,
  true, 'and its intent opened before the change pays at $535.00, with no "amount changed" refund');
insert into public.order_milestones (order_id, sort, kind, title, amount_cents)
values ((select id from p18 where name = 'order_f'), 30, 'payment_only', 'Extra', 10000);
insert into public.order_payments (order_id, milestone_id, amount_cents, processing_fee_bps, processing_fee_fixed_cents)
values ((select id from p18 where name = 'order_f'), pg_temp.p18_step('order_f', 'Extra'), 10000, 290, 30);
select is(
  (select row(processing_fee_bps, processing_fee_fixed_cents)::text from public.order_payments
    where id = pg_temp.p18_pay('order_f', 'Extra')),
  row(0, 0::bigint)::text, 'a step added to an older order is priced like its siblings, with no card fee');

-- The old bank wire records the step and service fee, with no card fee.
select is(
  (select row(p.charged_cents, public.processing_fee_cents(p))::text
     from public.order_payments p where p.id = pg_temp.p18_pay('order_d', 'Balance')),
  row(149800::bigint, 0::bigint)::text,
  'a bank wire confirmed by staff is charged the $1,400 step and its $98 service fee, card fee 0');

select * from finish();
rollback;
