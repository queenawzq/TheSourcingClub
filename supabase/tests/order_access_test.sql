-- ============================================================================
-- Phase 3 access rule tests — production orders, milestones, payments
-- ----------------------------------------------------------------------------
-- Run with:  supabase test db
--
-- Third suite, and the same discipline as the first two: `pgtap3-` slugs,
-- every count scoped to these fixtures, and mostly NEGATIVE assertions. All
-- three suites run against one database with no reset between them, so a bare
-- count(*) would pass alone and fail the moment another suite has run first.
--
-- What this file is really protecting is money. There is no server tier: a
-- policy that accidentally grants everything is a competitor reading a rival's
-- production schedule, and a missing check in a security definer function is
-- anybody confirming anybody's payment.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(68);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, raw_user_meta_data) values
  ('c3000000-0000-0000-0000-000000000001', 'p3-brandowner@example.com',  '{"name":"Brand Owner"}'),
  ('c3000000-0000-0000-0000-000000000002', 'p3-brandmember@example.com', '{"name":"Brand Member"}'),
  ('c3000000-0000-0000-0000-000000000003', 'p3-f1@example.com',          '{"name":"Factory One"}'),
  ('c3000000-0000-0000-0000-000000000004', 'p3-f2@example.com',          '{"name":"Factory Two"}'),
  ('c3000000-0000-0000-0000-000000000005', 'p3-admin@example.com',       '{"name":"Staff"}'),
  ('c3000000-0000-0000-0000-000000000006', 'p3-outsider@example.com',    '{"name":"Outsider"}');

insert into public.platform_admins (user_id, note)
values ('c3000000-0000-0000-0000-000000000005', 'pgtap3 fixture');

insert into public.orgs (id, type, name, slug) values
  ('d3000000-0000-0000-0000-00000000000b', 'brand',   'P3 Brand',     'pgtap3-brand'),
  ('d3000000-0000-0000-0000-0000000000f1', 'factory', 'P3 Factory 1', 'pgtap3-factory-1'),
  ('d3000000-0000-0000-0000-0000000000f2', 'factory', 'P3 Factory 2', 'pgtap3-factory-2'),
  ('d3000000-0000-0000-0000-00000000000c', 'brand',   'P3 Outsider',  'pgtap3-outsider');

insert into public.org_members (org_id, user_id, role) values
  ('d3000000-0000-0000-0000-00000000000b', 'c3000000-0000-0000-0000-000000000001', 'owner'),
  ('d3000000-0000-0000-0000-00000000000b', 'c3000000-0000-0000-0000-000000000002', 'member'),
  ('d3000000-0000-0000-0000-0000000000f1', 'c3000000-0000-0000-0000-000000000003', 'owner'),
  ('d3000000-0000-0000-0000-0000000000f2', 'c3000000-0000-0000-0000-000000000004', 'owner'),
  ('d3000000-0000-0000-0000-00000000000c', 'c3000000-0000-0000-0000-000000000006', 'owner');

insert into public.brand_profiles (org_id, hq_location) values
  ('d3000000-0000-0000-0000-00000000000b', 'London, UK'),
  ('d3000000-0000-0000-0000-00000000000c', 'Berlin, DE');

insert into public.factory_profiles (org_id, country_code, moq, published_at, verification_status) values
  ('d3000000-0000-0000-0000-0000000000f1', 'PT', 100, now(), 'verified'),
  ('d3000000-0000-0000-0000-0000000000f2', 'CN', 100, now(), 'verified');

insert into public.factory_payout_accounts (org_id, bank_name, account_number_last4, is_primary)
values ('d3000000-0000-0000-0000-0000000000f1', 'Banco de Porto', '4417', true);

insert into public.rfqs (id, brand_org_id, title, brief, status, visibility, quantity_total) values
  ('e3000000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-00000000000b',
   'P3 shirts', 'Three hundred organic cotton shirts.', 'open', 'open_to_all', 100);

-- Two competing quotes. Unit price 100.01 x 1 unit is deliberate: a 50/50
-- split of 10001 cents cannot be halved evenly, which is what assertion 40
-- turns on.
insert into public.quotes
  (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity,
   bulk_lead_time_days, deposit_pct, balance_pct, valid_until, submitted_at)
values
  ('f3000000-0000-0000-0000-0000000000f1', 'e3000000-0000-0000-0000-000000000001',
   'd3000000-0000-0000-0000-0000000000f1', 'submitted', 10001, 1, 28, 50, 50,
   current_date + 30, now()),
  ('f3000000-0000-0000-0000-0000000000f2', 'e3000000-0000-0000-0000-000000000001',
   'd3000000-0000-0000-0000-0000000000f2', 'submitted', 9000, 1, 30, 30, 70,
   current_date + 30, now());

insert into public.quote_sample_lines (quote_id, stage, cost_cents, sort) values
  ('f3000000-0000-0000-0000-0000000000f1', 'Fit sample', 5000, 1),
  ('f3000000-0000-0000-0000-0000000000f1', 'PP sample',  7000, 2);

-- Award it. This is the call that must create the order and its schedule.
reset role;
set local request.jwt.claims = '{"sub":"c3000000-0000-0000-0000-000000000001","email":"p3-brandowner@example.com","role":"authenticated"}';
set local role authenticated;
select public.award_quote('f3000000-0000-0000-0000-0000000000f1');

reset role;
create temporary table p3 as
select id as order_id from public.production_orders
where quote_id = 'f3000000-0000-0000-0000-0000000000f1';
grant select on p3 to public;

-- ---------------------------------------------------------------------------
-- The order exists, and its money is right
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from public.production_orders
     where quote_id = 'f3000000-0000-0000-0000-0000000000f1'),
  1,
  'awarding a quote creates exactly one production order'
);

select is(
  (select order_total_cents from public.production_orders where id = (select order_id from p3)),
  22001::bigint,
  'the order total is the bulk subtotal plus the sample lines'
);

select is(
  (select count(*)::int from public.order_milestones where order_id = (select order_id from p3)),
  6,
  'the schedule is generated from the quote: two sample stages plus four bulk steps'
);

select is(
  (select sum(amount_cents)::bigint from public.order_milestones where order_id = (select order_id from p3)),
  22001::bigint,
  'the generated schedule totals exactly the order total, sample lines included'
);

-- 10001 split 50/50. Rounding each side independently gives 5000 + 5000 and
-- loses a cent forever, on a figure a brand types into a bank transfer.
select is(
  (select sum(amount_cents)::bigint from public.order_milestones
     where order_id = (select order_id from p3) and kind = 'payment_only'),
  10001::bigint,
  'the derived deposit and balance sum to the bulk subtotal exactly, even when the split does not divide evenly'
);

select is(
  (select count(*)::int from public.order_payments where order_id = (select order_id from p3)),
  0,
  'no payment rows exist while the schedule is still being agreed'
);

select is(
  (select count(*)::int from public.order_milestones
     where order_id = (select order_id from p3)
       and kind in ('approval_only', 'progress_only')
       and amount_cents is not null),
  0,
  'a step with nothing to pay for cannot carry an amount'
);

-- ---------------------------------------------------------------------------
-- Cross-party isolation
-- ---------------------------------------------------------------------------

reset role;
set local request.jwt.claims = '{"sub":"c3000000-0000-0000-0000-000000000004","email":"p3-f2@example.com","role":"authenticated"}';
set local role authenticated;

select is(
  (select count(*)::int from public.production_orders where id = (select order_id from p3)),
  0,
  'a losing factory that quoted CANNOT read the resulting order'
);

select is(
  (select count(*)::int from public.order_milestones where order_id = (select order_id from p3)),
  0,
  'a competing factory CANNOT read another order''s milestones'
);

select is(
  (select count(*)::int from public.factory_payout_accounts
     where org_id = 'd3000000-0000-0000-0000-0000000000f1'),
  0,
  'a factory CANNOT read a competing factory''s payout account'
);

reset role;
set local request.jwt.claims = '{"sub":"c3000000-0000-0000-0000-000000000006","email":"p3-outsider@example.com","role":"authenticated"}';
set local role authenticated;

select is(
  (select count(*)::int from public.production_orders where id = (select order_id from p3)),
  0,
  'an unrelated brand CANNOT read someone else''s production order'
);

select is(
  (select count(*)::int from public.order_milestones where order_id = (select order_id from p3)),
  0,
  'an unrelated org CANNOT read someone else''s milestones'
);

select is(
  (select count(*)::int from public.production_order_summary where id = (select order_id from p3)),
  0,
  'the summary view is governed by the same policy as the table beneath it'
);

-- The brand owes this factory nothing yet, and an unrelated brand never will.
select is(
  (select count(*)::int from public.factory_payout_accounts
     where org_id = 'd3000000-0000-0000-0000-0000000000f1'),
  0,
  'a brand with no money owed CANNOT read a factory''s bank details'
);

-- ---------------------------------------------------------------------------
-- Direct writes are refused
-- ---------------------------------------------------------------------------

reset role;
set local request.jwt.claims = '{"sub":"c3000000-0000-0000-0000-000000000001","email":"p3-brandowner@example.com","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$insert into public.production_orders
      (rfq_id, quote_id, brand_org_id, factory_org_id, unit_price_cents,
       production_quantity, bulk_subtotal_cents, sample_subtotal_cents,
       order_total_cents, deposit_pct, balance_pct)
    values ('e3000000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-0000000000f2',
            'd3000000-0000-0000-0000-00000000000b', 'd3000000-0000-0000-0000-0000000000f2',
            100, 1, 100, 0, 100, 50, 50)$$,
  '42501',
  null,
  'a brand CANNOT insert a production order directly'
);

select throws_ok(
  $$update public.production_orders set unit_price_cents = 1
      where id = (select order_id from p3)$$,
  '42501',
  null,
  'a brand CANNOT change the price on its own order'
);

select throws_ok(
  $$update public.order_milestones set state = 'complete'
      where order_id = (select order_id from p3)$$,
  '42501',
  null,
  'a brand CANNOT mark a step complete with a direct update'
);

select throws_ok(
  $$insert into public.payment_events (payment_id, to_state, actor_kind)
    values (gen_random_uuid(), 'confirmed', 'admin')$$,
  '42501',
  null,
  'nobody can write a payment event directly'
);

select throws_ok(
  $$update public.notifications set title = 'anything'
      where org_id = 'd3000000-0000-0000-0000-00000000000b'$$,
  '22023',
  null,
  'a recipient CANNOT rewrite its own notification, only mark it read'
);

-- service_role bypasses RLS and holds a blanket write grant from migration 008.
-- The select-only design does not constrain it; the trigger does.
reset role;
set local role service_role;

select throws_ok(
  $$update public.production_orders set unit_price_cents = 1
      where id = (select order_id from p3)$$,
  '22023',
  null,
  'even service_role CANNOT rewrite the agreed terms of an order'
);

-- ---------------------------------------------------------------------------
-- Agreeing the schedule
-- ---------------------------------------------------------------------------

reset role;
set local request.jwt.claims = '{"sub":"c3000000-0000-0000-0000-000000000005","email":"p3-admin@example.com","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$select public.agree_schedule((select order_id from p3), 1)$$,
  '42501',
  null,
  'a platform admin CANNOT agree the schedule on behalf of either side'
);

reset role;
set local request.jwt.claims = '{"sub":"c3000000-0000-0000-0000-000000000001","email":"p3-brandowner@example.com","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$select public.set_order_schedule((select order_id from p3),
      '[{"kind":"payment_only","title":"Everything","amount_cents":"1"}]'::jsonb)$$,
  '22023',
  null,
  'a schedule whose steps do not total the agreed order value is refused'
);

select throws_ok(
  $$select public.set_order_schedule((select order_id from p3),
      '[{"kind":"approval_only","title":"Free lunch","amount_cents":"500"}]'::jsonb)$$,
  '22023',
  null,
  'a step with no payment cannot be given an amount'
);

select lives_ok(
  $$select public.agree_schedule((select order_id from p3), 1)$$,
  'the brand can agree the schedule it was given'
);

select is(
  (select status::text from public.production_orders where id = (select order_id from p3)),
  'pending_schedule',
  'the order does NOT start when only one side has agreed'
);

select throws_ok(
  $$select public.agree_schedule((select order_id from p3), 1)$$,
  '22023',
  null,
  'a side cannot agree the same schedule twice'
);

-- The factory edits. Both agreements must fall away, including the brand's.
reset role;
set local request.jwt.claims = '{"sub":"c3000000-0000-0000-0000-000000000003","email":"p3-f1@example.com","role":"authenticated"}';
set local role authenticated;

select lives_ok(
  $$select public.set_order_schedule((select order_id from p3),
      '[{"kind":"approval_and_payment","title":"Fit sample","amount_cents":"5000","sort":"10"},
        {"kind":"approval_and_payment","title":"PP sample","amount_cents":"7000","sort":"20"},
        {"kind":"payment_only","title":"Bulk deposit","amount_cents":"5000","sort":"30"},
        {"kind":"progress_only","title":"Bulk production","sort":"40"},
        {"kind":"approval_only","title":"QC photos","sort":"50"},
        {"kind":"payment_only","title":"Final balance","amount_cents":"5001","sort":"60"}]'::jsonb)$$,
  'either side can rewrite the schedule while it is still being agreed'
);

select is(
  (select schedule_brand_agreed_at from public.production_orders where id = (select order_id from p3)),
  null,
  'editing the schedule withdraws an agreement the other side had already given'
);

-- The stale-revision trap: the brand agreed at revision 1, the factory has
-- since edited. Re-submitting the brand's agreement at the old revision would
-- otherwise activate the order on terms the brand never saw.
reset role;
set local request.jwt.claims = '{"sub":"c3000000-0000-0000-0000-000000000001","email":"p3-brandowner@example.com","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$select public.agree_schedule((select order_id from p3), 1)$$,
  '22023',
  null,
  'agreeing a schedule at a stale revision is refused after the other side edited it'
);

select lives_ok(
  $$select public.agree_schedule((select order_id from p3), 2)$$,
  'the brand can agree again once it has read the revision that exists'
);

select is(
  (select status::text from public.production_orders where id = (select order_id from p3)),
  'pending_schedule',
  'still not started: the factory has not agreed its own edit'
);

reset role;
set local request.jwt.claims = '{"sub":"c3000000-0000-0000-0000-000000000003","email":"p3-f1@example.com","role":"authenticated"}';
set local role authenticated;

select lives_ok(
  $$select public.agree_schedule((select order_id from p3), 2)$$,
  'the factory agrees too'
);

select is(
  (select status::text from public.production_orders where id = (select order_id from p3)),
  'active',
  'the order becomes active only after BOTH sides have agreed'
);

select is(
  (select count(*)::int from public.order_payments where order_id = (select order_id from p3)),
  4,
  'activation creates one payment per paying step, and none for the others'
);

select is(
  (select count(*)::int from public.order_payments p
     join public.order_milestones m on m.id = p.milestone_id
     where m.order_id = (select order_id from p3)
       and m.kind in ('approval_only', 'progress_only')),
  0,
  'an approval-only step has NO payment row at all, not a zero-amount one'
);

reset role;
set local role service_role;
select throws_ok(
  $$select public.set_order_schedule((select order_id from p3), '[]'::jsonb)$$,
  '22023',
  null,
  'the schedule cannot be rewritten once the order is running'
);

-- ---------------------------------------------------------------------------
-- Doing the work
-- ---------------------------------------------------------------------------

reset role;
create temporary table p3m as
select id as fit_id from public.order_milestones
where order_id = (select order_id from p3) and title = 'Fit sample';
grant select on p3m to public;

reset role;
set local request.jwt.claims = '{"sub":"c3000000-0000-0000-0000-000000000001","email":"p3-brandowner@example.com","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$select public.post_milestone_update((select fit_id from p3m), 'Looks good to me')$$,
  '42501',
  null,
  'a brand CANNOT post a factory update'
);

reset role;
set local request.jwt.claims = '{"sub":"c3000000-0000-0000-0000-000000000004","email":"p3-f2@example.com","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$select public.post_milestone_update((select fit_id from p3m), 'Hello from a competitor')$$,
  '42501',
  null,
  'a factory CANNOT post an update on an order it is not part of'
);

reset role;
set local request.jwt.claims = '{"sub":"c3000000-0000-0000-0000-000000000003","email":"p3-f1@example.com","role":"authenticated"}';
set local role authenticated;

select lives_ok(
  $$select public.post_milestone_update((select fit_id from p3m), 'Fit sample photographed, front and back.')$$,
  'the factory can post an update on its open step'
);

select throws_ok(
  $$select public.approve_milestone((select fit_id from p3m))$$,
  '42501',
  null,
  'a factory CANNOT approve its own work'
);

select lives_ok(
  $$select public.submit_milestone((select fit_id from p3m))$$,
  'the factory sends the step for approval'
);

-- Approving a sample makes money due, so it takes an owner.
reset role;
set local request.jwt.claims = '{"sub":"c3000000-0000-0000-0000-000000000002","email":"p3-brandmember@example.com","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$select public.approve_milestone((select fit_id from p3m))$$,
  '42501',
  null,
  'a non-owner brand member CANNOT approve a step that releases a payment'
);

-- The brand CAN see the factory's update. This is the positive twin of the
-- isolation tests, and the one whose absence is silent: get the policy wrong
-- and the gallery is simply empty, with no error anywhere.
select is(
  (select count(*)::int from public.milestone_updates
     where milestone_id = (select fit_id from p3m)),
  1,
  'the brand CAN read the factory''s update on its own order'
);

reset role;
set local request.jwt.claims = '{"sub":"c3000000-0000-0000-0000-000000000004","email":"p3-f2@example.com","role":"authenticated"}';
set local role authenticated;

select is(
  (select count(*)::int from public.milestone_updates
     where milestone_id = (select fit_id from p3m)),
  0,
  'a competing factory CANNOT read that update'
);

reset role;
set local request.jwt.claims = '{"sub":"c3000000-0000-0000-0000-000000000001","email":"p3-brandowner@example.com","role":"authenticated"}';
set local role authenticated;

select lives_ok(
  $$select public.approve_milestone((select fit_id from p3m), 'Nice work')$$,
  'the brand owner approves the sample'
);

select is(
  (select state::text from public.order_payments
     where milestone_id = (select fit_id from p3m)),
  'due',
  'approving the sample makes its payment due'
);

-- ---------------------------------------------------------------------------
-- The payment gate
-- ---------------------------------------------------------------------------

reset role;
create temporary table p3p as
select id as pay_id from public.order_payments where milestone_id = (select fit_id from p3m);
grant select on p3p to public;

reset role;
set local request.jwt.claims = '{"sub":"c3000000-0000-0000-0000-000000000003","email":"p3-f1@example.com","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$select public.mark_payment_sent((select pay_id from p3p))$$,
  '42501',
  null,
  'a factory CANNOT mark a payment sent on its own order'
);

select throws_ok(
  $$select public.confirm_payment_received((select pay_id from p3p))$$,
  '42501',
  null,
  'the factory that is owed the money CANNOT confirm it arrived'
);

reset role;
set local request.jwt.claims = '{"sub":"c3000000-0000-0000-0000-000000000001","email":"p3-brandowner@example.com","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$select public.confirm_payment_received((select pay_id from p3p))$$,
  '42501',
  null,
  'the brand that sent the money CANNOT confirm it arrived'
);

select lives_ok(
  $$select public.mark_payment_sent((select pay_id from p3p), 'REF-991')$$,
  'the brand owner records the payment as sent'
);

-- Now the factory owes nothing more, and the bank details become readable —
-- but only because a payment is genuinely outstanding.
select is(
  (select count(*)::int from public.factory_payout_accounts
     where org_id = 'd3000000-0000-0000-0000-0000000000f1'),
  1,
  'a brand CAN read the factory''s bank details once it actually owes money'
);

select is(
  (select paid_cents from public.production_order_summary where id = (select order_id from p3)),
  0::bigint,
  'the brand saying it paid does NOT count as funded'
);

select is(
  (select state::text from public.order_milestones where id = (select fit_id from p3m)),
  'approved',
  'the step does not complete while the payment is only claimed sent'
);

select is(
  (select count(*)::int from public.order_milestones
     where order_id = (select order_id from p3) and title = 'PP sample' and state = 'active'),
  0,
  'production does NOT open while an earlier payment is only marked sent'
);

reset role;
set local request.jwt.claims = '{"sub":"c3000000-0000-0000-0000-000000000005","email":"p3-admin@example.com","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$select public.release_payment_to_factory((select pay_id from p3p))$$,
  '22023',
  null,
  'funds cannot be released before the payment is confirmed'
);

select lives_ok(
  $$select public.confirm_payment_received((select pay_id from p3p))$$,
  'a platform admin confirms the money arrived'
);

select is(
  (select state::text from public.order_milestones where id = (select fit_id from p3m)),
  'complete',
  'the step completes on the admin''s confirmation'
);

select is(
  (select count(*)::int from public.order_milestones
     where order_id = (select order_id from p3) and title = 'PP sample' and state = 'active'),
  1,
  'the next step opens once the admin confirms, WITHOUT waiting for release'
);

select is(
  (select paid_cents from public.production_order_summary where id = (select order_id from p3)),
  5000::bigint,
  'the header total moves because a payment row moved, not because anything was typed'
);

select throws_ok(
  $$select public.confirm_payment_received((select pay_id from p3p))$$,
  '22023',
  null,
  'a payment cannot be confirmed twice'
);

select lives_ok(
  $$select public.release_payment_to_factory((select pay_id from p3p))$$,
  'the admin releases the funds'
);

select is(
  (select state::text from public.order_milestones where id = (select fit_id from p3m)),
  'complete',
  'releasing funds changes no milestone state; the work already opened'
);

select is(
  (select count(*)::int from public.payment_events where payment_id = (select pay_id from p3p)),
  4,
  'every payment transition left an event behind: due, sent, confirmed, released'
);

-- ---------------------------------------------------------------------------
-- Leaving early
-- ---------------------------------------------------------------------------

reset role;
set local request.jwt.claims = '{"sub":"c3000000-0000-0000-0000-000000000003","email":"p3-f1@example.com","role":"authenticated"}';
set local role authenticated;

select lives_ok(
  $$select public.propose_cancellation((select order_id from p3), 'Mill cannot source the fabric')$$,
  'a party can propose cancelling a running order'
);

select throws_ok(
  $$select public.accept_cancellation((select order_id from p3))$$,
  '42501',
  null,
  'the side that proposed a cancellation CANNOT accept it alone'
);

reset role;
set local request.jwt.claims = '{"sub":"c3000000-0000-0000-0000-000000000001","email":"p3-brandowner@example.com","role":"authenticated"}';
set local role authenticated;

select lives_ok(
  $$select public.accept_cancellation((select order_id from p3))$$,
  'the other side accepts, and the order closes'
);

select is(
  (select state::text from public.order_payments where id = (select pay_id from p3p)),
  'released',
  'a payment that already moved is NOT cancelled with the order'
);

select ok(
  (select count(*) from public.order_payments
     where order_id = (select order_id from p3) and state = 'cancelled') > 0,
  'payments that had not moved are cancelled'
);

select * from finish();
rollback;
