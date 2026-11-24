-- Paused payments (20261124100000).
--
-- A dispute (on any order payment) or a refund made in Stripe after approval
-- opens a payment review: the factory's withdrawals pause on every road and
-- nothing is taken from its balance; on a dispute the brand is paused to
-- messaging only. Staff decide: Pay factory (nothing taken) or Refund brand
-- (capped at what the factory can still withdraw), and Unpause brand on its
-- own. Our own refunds and refunds before approval pause nothing.
--
-- Fixtures: slugs pgtap-pr24-*, ids c24?xxxx-...; every count is scoped to them.
--   F1 (owner 01) <- B1 (owner 03): P1 approved deposit $200 (charged $214),
--      P2 held fit sample $100 ($107), P4 due bulk $300; a draft request and
--      an open request with a submitted quote from F1.
--   F2 (owner 04) <- B2 (owner 07): P3 approved deposit $300 ($321).
--   F3 (owner 05) <- B2: P5 approved $500 ($535), $200 of it withdrawn by
--      Stripe (sent); P6 approved $150 ($160.50).
--   Staff: 02 (plain), 06 (also a member of B1: two hats).
begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

set local session_replication_role = replica;

insert into auth.users (id, email)
select ('c24a0000-0000-0000-0000-0000000000' || k)::uuid, 'pgtap-pr24-' || k || '@example.com'
  from unnest(array['01','02','03','04','05','06','07']) k;
insert into public.platform_admins (user_id, note) values
  ('c24a0000-0000-0000-0000-000000000002', 'pgtap-pr24'), ('c24a0000-0000-0000-0000-000000000006', 'pgtap-pr24');
insert into public.orgs (id, type, name, slug) values
  ('c24b0000-0000-0000-0000-0000000000b1', 'brand', 'PR24 Brand One', 'pgtap-pr24-b1'),
  ('c24b0000-0000-0000-0000-0000000000b2', 'brand', 'PR24 Brand Two', 'pgtap-pr24-b2'),
  ('c24b0000-0000-0000-0000-0000000000e1', 'factory', 'PR24 Factory One', 'pgtap-pr24-f1'),
  ('c24b0000-0000-0000-0000-0000000000e2', 'factory', 'PR24 Factory Two', 'pgtap-pr24-f2'),
  ('c24b0000-0000-0000-0000-0000000000e3', 'factory', 'PR24 Factory Three', 'pgtap-pr24-f3');
insert into public.org_members (org_id, user_id, role, permissions) values
  ('c24b0000-0000-0000-0000-0000000000e1', 'c24a0000-0000-0000-0000-000000000001', 'owner', '{}'),
  ('c24b0000-0000-0000-0000-0000000000b1', 'c24a0000-0000-0000-0000-000000000003', 'owner', '{}'),
  ('c24b0000-0000-0000-0000-0000000000b1', 'c24a0000-0000-0000-0000-000000000006', 'member', '{}'),
  ('c24b0000-0000-0000-0000-0000000000e2', 'c24a0000-0000-0000-0000-000000000004', 'owner', '{}'),
  ('c24b0000-0000-0000-0000-0000000000e3', 'c24a0000-0000-0000-0000-000000000005', 'owner', '{}'),
  ('c24b0000-0000-0000-0000-0000000000b2', 'c24a0000-0000-0000-0000-000000000007', 'owner', '{}');
insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total) values
  ('c24c0000-0000-0000-0000-000000000001', 'c24b0000-0000-0000-0000-0000000000b1', 'PR24 request 1', 'awarded', 'invited_only', 100),
  ('c24c0000-0000-0000-0000-000000000002', 'c24b0000-0000-0000-0000-0000000000b2', 'PR24 request 2', 'awarded', 'invited_only', 100),
  ('c24c0000-0000-0000-0000-000000000003', 'c24b0000-0000-0000-0000-0000000000b2', 'PR24 request 3', 'awarded', 'invited_only', 100),
  ('c24c0000-0000-0000-0000-000000000004', 'c24b0000-0000-0000-0000-0000000000b1', 'PR24 open request', 'open', 'invited_only', 100),
  ('c24c0000-0000-0000-0000-000000000005', 'c24b0000-0000-0000-0000-0000000000b1', 'PR24 draft request', 'draft', 'invited_only', 100);
insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity, submitted_at) values
  ('c24c1000-0000-0000-0000-000000000001', 'c24c0000-0000-0000-0000-000000000001', 'c24b0000-0000-0000-0000-0000000000e1', 'accepted', 100, 1, now()),
  ('c24c1000-0000-0000-0000-000000000002', 'c24c0000-0000-0000-0000-000000000002', 'c24b0000-0000-0000-0000-0000000000e2', 'accepted', 100, 1, now()),
  ('c24c1000-0000-0000-0000-000000000003', 'c24c0000-0000-0000-0000-000000000003', 'c24b0000-0000-0000-0000-0000000000e3', 'accepted', 100, 1, now()),
  ('c24c1000-0000-0000-0000-000000000004', 'c24c0000-0000-0000-0000-000000000004', 'c24b0000-0000-0000-0000-0000000000e1', 'submitted', 100, 1, now());
insert into public.production_orders
  (id, rfq_id, quote_id, brand_org_id, factory_org_id, unit_price_cents, status, schedule_brand_agreed_at, schedule_brand_agreed_by,
   production_quantity, bulk_subtotal_cents, sample_subtotal_cents, order_total_cents, deposit_pct, balance_pct, order_number) values
  ('c24d0000-0000-0000-0000-000000000001', 'c24c0000-0000-0000-0000-000000000001', 'c24c1000-0000-0000-0000-000000000001',
   'c24b0000-0000-0000-0000-0000000000b1', 'c24b0000-0000-0000-0000-0000000000e1', 100000, 'active', now() - interval '60 days',
   'c24a0000-0000-0000-0000-000000000003', 1, 100000, 0, 100000, 50, 50, 'PR24-1'),
  ('c24d0000-0000-0000-0000-000000000002', 'c24c0000-0000-0000-0000-000000000002', 'c24c1000-0000-0000-0000-000000000002',
   'c24b0000-0000-0000-0000-0000000000b2', 'c24b0000-0000-0000-0000-0000000000e2', 100000, 'active', now() - interval '60 days',
   'c24a0000-0000-0000-0000-000000000007', 1, 100000, 0, 100000, 50, 50, 'PR24-2'),
  ('c24d0000-0000-0000-0000-000000000003', 'c24c0000-0000-0000-0000-000000000003', 'c24c1000-0000-0000-0000-000000000003',
   'c24b0000-0000-0000-0000-0000000000b2', 'c24b0000-0000-0000-0000-0000000000e3', 100000, 'active', now() - interval '60 days',
   'c24a0000-0000-0000-0000-000000000007', 1, 100000, 0, 100000, 50, 50, 'PR24-3');
insert into public.order_milestones (id, order_id, kind, title, amount_cents, state, sort, completed_at) values
  ('c24e0001-0000-0000-0000-000000000001', 'c24d0000-0000-0000-0000-000000000001', 'payment_only', 'PR24 deposit', 20000, 'complete', 5, now() - interval '9 days'),
  ('c24e0002-0000-0000-0000-000000000001', 'c24d0000-0000-0000-0000-000000000001', 'approval_and_payment', 'PR24 fit sample', 10000, 'active', 10, null),
  ('c24e0004-0000-0000-0000-000000000001', 'c24d0000-0000-0000-0000-000000000001', 'approval_and_payment', 'PR24 bulk', 30000, 'pending', 20, null),
  ('c24e0003-0000-0000-0000-000000000002', 'c24d0000-0000-0000-0000-000000000002', 'payment_only', 'PR24 deposit two', 30000, 'complete', 5, now() - interval '9 days'),
  ('c24e0005-0000-0000-0000-000000000003', 'c24d0000-0000-0000-0000-000000000003', 'payment_only', 'PR24 deposit three', 50000, 'complete', 5, now() - interval '9 days'),
  ('c24e0006-0000-0000-0000-000000000003', 'c24d0000-0000-0000-0000-000000000003', 'approval_and_payment', 'PR24 sample three', 15000, 'complete', 10, now() - interval '8 days');
insert into public.order_payments
  (id, order_id, milestone_id, amount_cents, charged_cents, currency, state, confirmed_at, release_requested_at,
   stripe_payment_intent_id, stripe_charge_id, funds_available_at) values
  ('c24f0001-0000-0000-0000-000000000001', 'c24d0000-0000-0000-0000-000000000001', 'c24e0001-0000-0000-0000-000000000001', 20000, 21400, 'USD', 'confirmed',
   now() - interval '20 days', now() - interval '9 days', 'pi_pgtap_pr24_1', 'ch_pgtap_pr24_1', now() - interval '15 days'),
  ('c24f0002-0000-0000-0000-000000000001', 'c24d0000-0000-0000-0000-000000000001', 'c24e0002-0000-0000-0000-000000000001', 10000, 10700, 'USD', 'confirmed',
   now() - interval '20 days', null, 'pi_pgtap_pr24_2', 'ch_pgtap_pr24_2', now() - interval '15 days'),
  ('c24f0003-0000-0000-0000-000000000002', 'c24d0000-0000-0000-0000-000000000002', 'c24e0003-0000-0000-0000-000000000002', 30000, 32100, 'USD', 'confirmed',
   now() - interval '20 days', now() - interval '9 days', 'pi_pgtap_pr24_3', 'ch_pgtap_pr24_3', now() - interval '15 days'),
  ('c24f0005-0000-0000-0000-000000000003', 'c24d0000-0000-0000-0000-000000000003', 'c24e0005-0000-0000-0000-000000000003', 50000, 53500, 'USD', 'confirmed',
   now() - interval '20 days', now() - interval '9 days', 'pi_pgtap_pr24_5', 'ch_pgtap_pr24_5', now() - interval '15 days'),
  ('c24f0006-0000-0000-0000-000000000003', 'c24d0000-0000-0000-0000-000000000003', 'c24e0006-0000-0000-0000-000000000003', 15000, 16050, 'USD', 'confirmed',
   now() - interval '20 days', now() - interval '8 days', 'pi_pgtap_pr24_6', 'ch_pgtap_pr24_6', now() - interval '15 days');
insert into public.order_payments (id, order_id, milestone_id, amount_cents, currency, state) values
  ('c24f0004-0000-0000-0000-000000000001', 'c24d0000-0000-0000-0000-000000000001', 'c24e0004-0000-0000-0000-000000000001', 30000, 'USD', 'due');
-- F3 withdrew $200 of P5 by Stripe.
insert into public.stripe_connect_accounts (org_id, stripe_account_id, country, transfers_active, payouts_enabled, details_submitted)
values ('c24b0000-0000-0000-0000-0000000000e3', 'acct_pgtap_pr24', 'US', true, true, true);
insert into public.stripe_withdrawals (id, org_id, stripe_account_id, request_key, request_id, amount_minor, currency, usd_cents, state)
values ('c2480000-0000-0000-0000-000000000003', 'c24b0000-0000-0000-0000-0000000000e3', 'acct_pgtap_pr24', 'pgtap-pr24-sw-1', gen_random_uuid(), 20000, 'USD', 20000, 'paid_out');
insert into public.payment_takes (payment_id, org_id, road, stripe_withdrawal_id, amount_cents, status) values
  ('c24f0005-0000-0000-0000-000000000003', 'c24b0000-0000-0000-0000-0000000000e3', 'stripe', 'c2480000-0000-0000-0000-000000000003', 20000, 'sent');
set local session_replication_role = origin;

create function pg_temp.act_as(who text) returns void language sql as $f$
  select set_config('request.jwt.claims',
    json_build_object('sub', 'c24a0000-0000-0000-0000-' || lpad(who, 12, '0'), 'role', 'authenticated')::text, true);
$f$;
grant execute on function pg_temp.act_as(text) to authenticated, service_role;
create function pg_temp.as_server(sql text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  set local role service_role;
  execute sql;
  reset role;
end;
$f$;
create function pg_temp.org(code text) returns uuid language sql immutable as $f$
  select ('c24b0000-0000-0000-0000-0000000000' || code)::uuid;
$f$;
create function pg_temp.pay(n int) returns uuid language sql immutable as $f$
  select ('c24f000' || n || '-0000-0000-0000-00000000000' || case when n in (1, 2, 4) then 1 when n = 3 then 2 else 3 end)::uuid;
$f$;
create function pg_temp.bal(code text, who text) returns jsonb language plpgsql as $f$
declare j jsonb;
begin
  perform pg_temp.act_as(who);
  set local role authenticated;
  j := public.factory_balance(pg_temp.org(code));
  reset role;
  return j;
end;
$f$;
create function pg_temp.avail(code text, who text) returns bigint language sql as $f$
  select (pg_temp.bal(code, who) ->> 'available_cents')::bigint;
$f$;
create function pg_temp.review(n int, why text) returns uuid language sql security definer as $f$
  select id from public.payment_reviews where payment_id = pg_temp.pay(n) and cause = why order by created_at desc limit 1;
$f$;
grant execute on function pg_temp.review(int, text) to authenticated;
create function pg_temp.board() returns jsonb language plpgsql as $f$
declare j jsonb;
begin
  perform pg_temp.act_as('02');
  set local role authenticated;
  j := public.payment_review_board();
  reset role;
  return j;
end;
$f$;
create function pg_temp.told(org uuid, title text) returns text language sql as $f$
  select string_agg(body, ' || ' order by created_at) from public.notifications where org_id = org and notifications.title = told.title
     and order_id in ('c24d0000-0000-0000-0000-000000000001', 'c24d0000-0000-0000-0000-000000000002', 'c24d0000-0000-0000-0000-000000000003');
$f$;

-- ===========================================================================
-- 0. Negatives first.
-- ===========================================================================
select pg_temp.act_as('01');
set local role authenticated;
select throws_ok($$select count(*) from public.payment_reviews$$, '42501', null, 'a factory cannot read payment reviews');
select throws_ok($$insert into public.payment_reviews (payment_id, order_id, factory_org_id, brand_org_id, cause)
                   values ('c24f0001-0000-0000-0000-000000000001', 'c24d0000-0000-0000-0000-000000000001',
                           'c24b0000-0000-0000-0000-0000000000e1', 'c24b0000-0000-0000-0000-0000000000b1', 'refund')$$,
  '42501', null, 'nobody writes a review directly');
select throws_ok($$select public.payment_review_board()$$, '42501', null, 'a factory cannot read the staff board');
select throws_ok($$select public.decide_payment_review('c24f0001-0000-0000-0000-000000000001', 'pay_factory')$$, '42501', null,
  'a factory cannot decide its own review');
select throws_ok($$select public.unpause_brand('c24f0001-0000-0000-0000-000000000001')$$, '42501', null, 'nor unpause a brand');
select throws_ok($$select public.record_payment_review_dispute('c24f0001-0000-0000-0000-000000000001', 'dp_x', 'needs_response', 1, null, null)$$,
  '42501', null, 'only the server records a dispute');
select throws_ok($$select public.factory_paused('c24b0000-0000-0000-0000-0000000000e2')$$, '42501', null,
  'a company cannot ask whether another is paused');
select throws_ok($$select public.my_payment_pause('c24b0000-0000-0000-0000-0000000000e2')$$, '42501', null,
  'nor read another company''s status');
reset role;
select pg_temp.act_as('03');
set local role authenticated;
select throws_ok($$select public.payment_review_board()$$, '42501', null, 'a brand cannot read the staff board');
select is(public.my_payment_pause('c24b0000-0000-0000-0000-0000000000b1') ->> 'brand_paused', 'false', 'a brand reads its own status');
reset role;

-- ===========================================================================
-- 1. A dispute on an approved payment pauses the factory and the brand, and
--    changes no figure.
-- ===========================================================================
create temp table pr24_before on commit drop as select pg_temp.bal('e1', '01') as f1;
select lives_ok($$select pg_temp.as_server('select public.record_payment_review_dispute(''c24f0001-0000-0000-0000-000000000001'', ''dp_pgtap_pr24_1'', ''needs_response'', 21400, now() + interval ''7 days'', 1500)')$$,
  'the server records a dispute on the approved deposit');
select is((select count(*)::int from public.payment_reviews where payment_id = pg_temp.pay(1)), 1, 'one review');
select lives_ok($$select pg_temp.as_server('select public.record_payment_review_dispute(''c24f0001-0000-0000-0000-000000000001'', ''dp_pgtap_pr24_1'', ''needs_response'', 21400, now() + interval ''7 days'', 1500)')$$,
  'the same event again');
select is((select count(*)::int from public.payment_reviews where payment_id = pg_temp.pay(1)), 1, 'still one review');
select ok(public.factory_paused(pg_temp.org('e1')) and public.brand_paused(pg_temp.org('b1')), 'factory and brand paused');
select is(pg_temp.bal('e1', '01') - 'review' - 'rows', (select f1 from pr24_before) - 'review' - 'rows', 'no figure changed');
select is(pg_temp.bal('e1', '01') -> 'review' ->> 'step_title', 'PR24 deposit', 'the card names the step');
select is(pg_temp.told(pg_temp.org('e1'), 'Withdrawals paused'),
  'A brand requested a refund for "PR24 deposit" on PR24 request 1 (PR24-1), so our team is reviewing the payment. Withdrawals are paused until the review is done.',
  'the factory is told, without blame');
select is(pg_temp.told(pg_temp.org('b1'), 'Account under review'),
  'A payment for "PR24 deposit" on PR24 request 1 (PR24-1) was disputed with your bank. Until our review is done, you can only message vendors.',
  'the brand is told what it can still do');
select is(public.factory_paused(pg_temp.org('e2')), false, 'another factory is not paused');

-- ===========================================================================
-- 2. Every withdrawal road refuses while the factory is paused.
-- ===========================================================================
select throws_ok($$insert into public.payment_takes (payment_id, org_id, road, stripe_withdrawal_id, amount_cents)
                   values ('c24f0001-0000-0000-0000-000000000001', 'c24b0000-0000-0000-0000-0000000000e1', 'stripe',
                           'c2480000-0000-0000-0000-000000000003', 100)$$,
  '22023', 'Withdrawals are paused while a payment is reviewed.', 'a new take is refused');
select throws_ok($$insert into public.stripe_withdrawals (org_id, stripe_account_id, request_key, request_id, amount_minor, currency, state)
                   values ('c24b0000-0000-0000-0000-0000000000e1', 'acct_pgtap_pr24_x', 'pgtap-pr24-sw-2', gen_random_uuid(), 100, 'USD', 'claimed')$$,
  '22023', 'Withdrawals are paused while a payment is reviewed.', 'a Stripe withdrawal is refused');
select is(public.withdrawal_blocker(jsonb_populate_record(null::public.factory_withdrawals,
            jsonb_build_object('id', gen_random_uuid(), 'org_id', pg_temp.org('e1')))), 'payment_under_review',
  'a waiting withdrawal is held, so staff cannot pay it');
select throws_ok($$select public.check_withdrawal_can_go(jsonb_populate_record(null::public.factory_withdrawals,
                     jsonb_build_object('id', gen_random_uuid(), 'org_id', 'c24b0000-0000-0000-0000-0000000000e1')))$$,
  '22023', 'Withdrawals are paused while a payment is reviewed.', 'staff paying a waiting withdrawal is refused (claim_withdrawal, guard_withdrawal_takes)');

-- ===========================================================================
-- 3. The paused brand: messaging only.
-- ===========================================================================
select pg_temp.act_as('03');
set local role authenticated;
select throws_ok($$select public.begin_payment_checkout('c24f0004-0000-0000-0000-000000000001')$$,
  '42501', 'You can''t fund steps while your account is under review.', 'cannot fund a step');
select throws_ok($$select public.award_quote('c24c1000-0000-0000-0000-000000000004')$$,
  '42501', 'You can''t accept quotes while your account is under review.', 'cannot accept a quote');
select throws_ok($$select public.approve_milestone('c24e0002-0000-0000-0000-000000000001')$$,
  '42501', 'You can''t approve steps while your account is under review.', 'cannot approve a funded step');
select throws_ok($$select public.propose_cancellation('c24d0000-0000-0000-0000-000000000001', 'pgtap')$$,
  '42501', 'You can''t cancel orders while your account is under review.', 'cannot cancel');
select throws_ok($$update public.rfqs set status = 'open' where id = 'c24c0000-0000-0000-0000-000000000005'$$,
  '42501', 'You can''t post requests while your account is under review.', 'cannot post a request');
select lives_ok($$update public.rfqs set title = 'PR24 draft, edited' where id = 'c24c0000-0000-0000-0000-000000000005'$$,
  'can still write a draft');
select is(public.my_payment_pause(pg_temp.org('b1')) ->> 'brand_paused', 'true', 'its own status says paused');
reset role;
-- The factory on the same order may still propose cancelling; the brand may not accept.
select pg_temp.act_as('01');
set local role authenticated;
select lives_ok($$select public.propose_cancellation('c24d0000-0000-0000-0000-000000000001', 'pgtap factory')$$, 'the factory can propose');
reset role;
select pg_temp.act_as('03');
set local role authenticated;
select throws_ok($$select public.accept_cancellation('c24d0000-0000-0000-0000-000000000001')$$,
  '42501', 'You can''t cancel orders while your account is under review.', 'the paused brand cannot accept it');
reset role;
select pg_temp.act_as('01');
set local role authenticated;
select lives_ok($$select public.withdraw_cancellation('c24d0000-0000-0000-0000-000000000001')$$, 'the factory withdraws it');
reset role;

-- ===========================================================================
-- 4. Refunds: after approval the factory keeps its part and is paused, the
--    brand is not; before approval nothing pauses.
-- ===========================================================================
create temp table pr24_f2 on commit drop as select pg_temp.avail('e2', '04') as before;
select lives_ok($$select pg_temp.as_server('select public.record_payment_refund_amount(''c24f0003-0000-0000-0000-000000000002'', ''pi_pgtap_pr24_3'', 5350)')$$,
  'staff refund $53.50 of the approved deposit in Stripe');
select ok((select refunded_cents = 5350 and review_kept_cents = 5350 and factory_refund_cents = 0
             from public.order_payments where id = pg_temp.pay(3)), 'recorded, and the factory keeps its part');
select is(pg_temp.avail('e2', '04'), (select before from pr24_f2), 'Available unchanged');
select ok(public.factory_paused(pg_temp.org('e2')) and not public.brand_paused(pg_temp.org('b2')), 'factory paused, brand not');
select is((select amount_cents from public.payment_reviews where id = pg_temp.review(3, 'refund')), 5350::bigint, 'the review carries the amount');
select lives_ok($$select pg_temp.as_server('select public.record_payment_refund_amount(''c24f0003-0000-0000-0000-000000000002'', ''pi_pgtap_pr24_3'', 10700)')$$,
  'a second refund on the same payment');
select is((select count(*)::int from public.payment_reviews where payment_id = pg_temp.pay(3)), 1, 'still one open review');
select is((select amount_cents from public.payment_reviews where id = pg_temp.review(3, 'refund')), 10700::bigint, 'its amount grew');
select lives_ok($$select pg_temp.as_server('select public.record_payment_refund_failed(''c24f0003-0000-0000-0000-000000000002'', ''pi_pgtap_pr24_3'', 5350)')$$,
  'part of it failed');
select ok((select refunded_cents = 5350 and review_kept_cents = 5350 and factory_refund_cents = 0
             from public.order_payments where id = pg_temp.pay(3)), 'the kept part follows; still nothing taken');
select is((select amount_cents from public.payment_reviews where id = pg_temp.review(3, 'refund')), 5350::bigint,
  'the open review says only what still went back');

-- Before approval: lower amount, no review.
select lives_ok($$select pg_temp.as_server('select public.record_payment_refund_amount(''c24f0002-0000-0000-0000-000000000001'', ''pi_pgtap_pr24_2'', 1070)')$$,
  'a partial refund of the held fit sample');
select ok((select factory_refund_cents = 1000 and review_kept_cents = 0 from public.order_payments where id = pg_temp.pay(2)),
  'before approval it lowers the step, as before');
select is((select count(*)::int from public.payment_reviews where payment_id = pg_temp.pay(2)), 0, 'and opens no review');

-- ===========================================================================
-- 5. Staff decide.
-- ===========================================================================
select pg_temp.act_as('06');
set local role authenticated;
select throws_ok(format($$select public.decide_payment_review(%L, 'pay_factory')$$, pg_temp.review(1, 'dispute')),
  '42501', null, 'staff in the brand leave it to someone else');
select throws_ok(format($$select public.unpause_brand(%L)$$, pg_temp.review(1, 'dispute')),
  '42501', null, 'nor unpause it');
reset role;
select is((select (x ->> 'returnable_cents')::bigint from jsonb_array_elements(pg_temp.board()) x where (x ->> 'id')::uuid = pg_temp.review(1, 'dispute')),
  20000::bigint, 'the board offers up to the $200 deposit still with us');
select is((select (x ->> 'factory_part_cents')::bigint from jsonb_array_elements(pg_temp.board()) x where (x ->> 'id')::uuid = pg_temp.review(1, 'dispute')),
  20000::bigint, 'the factory''s part of the $214 dispute is $200');
select pg_temp.act_as('02');
set local role authenticated;
select throws_ok(format($$select public.decide_payment_review(%L, 'refund_brand', 5000, 'early')$$, pg_temp.review(1, 'dispute')),
  '22023', 'The bank hasn''t decided this dispute yet. Refund brand is available once the brand has its money back.',
  'no Refund brand while the bank has not decided');
reset role;
select lives_ok($$select pg_temp.as_server('select public.record_payment_review_dispute(''c24f0001-0000-0000-0000-000000000001'', ''dp_pgtap_pr24_1'', ''lost'', 21400, null, 1500)')$$,
  'the bank decides for the brand');
select lives_ok($$select pg_temp.as_server('select public.record_payment_dispute_lost(''c24f0001-0000-0000-0000-000000000001'', ''dp_pgtap_pr24_1'', 21400, 1500)')$$,
  'recorded as lost after approval');
select ok((select dispute_lost_cents = 21400 and review_kept_cents = 21400 and factory_refund_cents = 0
             from public.order_payments where id = pg_temp.pay(1)), 'nothing taken by itself');
select pg_temp.act_as('02');
set local role authenticated;
select throws_ok(format($$select public.decide_payment_review(%L, 'refund_brand', 25000, 'too much')$$, pg_temp.review(1, 'dispute')),
  '22023', 'You can take up to $200.00, the factory''s part of what the brand got back.', 'never more than the factory''s part of what went back');
select throws_ok(format($$select public.decide_payment_review(%L, 'refund_brand', 5000, '  ')$$, pg_temp.review(1, 'dispute')),
  '22023', 'Add a note for the factory.', 'a note is required');
select throws_ok(format($$select public.decide_payment_review(%L, 'refund_brand', 0, 'zero')$$, pg_temp.review(1, 'dispute')),
  '22023', 'Enter an amount to refund.', 'a positive amount');
select lives_ok(format($$select public.decide_payment_review(%L, 'refund_brand', 5000, 'The sample did not arrive.')$$, pg_temp.review(1, 'dispute')),
  'refund $50 to the brand');
select throws_ok(format($$select public.decide_payment_review(%L, 'pay_factory')$$, pg_temp.review(1, 'dispute')),
  '22023', 'this review was already decided', 'decided once');
reset role;
select is((select taken_back_cents from public.order_payments where id = pg_temp.pay(1)), 5000::bigint, 'taken from the reviewed step');
select is(pg_temp.avail('e1', '01'), ((select f1 from pr24_before) ->> 'available_cents')::bigint - 5000, 'Available down by $50, never below zero');
select ok(exists (select 1 from jsonb_array_elements(pg_temp.bal('e1', '01') -> 'rows') r
                   where r ->> 'cause' = 'returned' and (r ->> 'amount_cents')::bigint = -5000), 'a dated "returned" row');
select is(public.factory_paused(pg_temp.org('e1')), false, 'the factory can withdraw again');
select is(public.brand_paused(pg_temp.org('b1')), true, 'the brand stays paused until staff unpause it');
select is(pg_temp.told(pg_temp.org('e1'), 'Payment review complete'),
  '$50.00 for "PR24 deposit" was returned to the brand. You can withdraw the rest of your balance. Note from our team: The sample did not arrive.',
  'the factory is told what was returned and the note');
select pg_temp.act_as('02');
set local role authenticated;
select lives_ok(format($$select public.unpause_brand(%L)$$, pg_temp.review(1, 'dispute')), 'unpause the brand');
select throws_ok(format($$select public.unpause_brand(%L)$$, pg_temp.review(1, 'dispute')), '22023', null, 'once');
reset role;
select is(public.brand_paused(pg_temp.org('b1')), false, 'the brand is unpaused');
select is(pg_temp.told(pg_temp.org('b1'), 'Account review complete'), 'Your account is no longer under review.', 'and told');
select pg_temp.act_as('03');
set local role authenticated;
select lives_ok($$select public.begin_payment_checkout('c24f0004-0000-0000-0000-000000000001')$$, 'it can fund again');
reset role;

-- A dispute on a step not approved yet: its money is not in the balance, so
-- only the brand is paused (20261124100100); neither Pay factory nor Refund
-- brand applies, and unpausing the brand closes the review.
select lives_ok($$select pg_temp.as_server('select public.record_payment_review_dispute(''c24f0002-0000-0000-0000-000000000001'', ''dp_pgtap_pr24_2'', ''needs_response'', 9630, null, null)')$$,
  'a dispute on the held fit sample');
select is((select pauses_factory from public.payment_reviews where id = pg_temp.review(2, 'dispute')), false,
  'before approval the factory is not paused for it');
select is((select count(*)::int from public.notifications where data ->> 'review_id' = pg_temp.review(2, 'dispute')::text and title = 'Withdrawals paused'),
  0, 'and is not told it is');
select is(public.brand_paused(pg_temp.org('b1')), true, 'the brand is paused');
select pg_temp.act_as('02');
set local role authenticated;
select throws_ok(format($$select public.decide_payment_review(%L, 'refund_brand', 1000, 'no')$$, pg_temp.review(2, 'dispute')),
  '22023', 'This step isn''t approved, so the factory isn''t paused. Use Unpause brand.', 'no Refund brand before approval');
select throws_ok(format($$select public.decide_payment_review(%L, 'pay_factory')$$, pg_temp.review(2, 'dispute')),
  '22023', 'This step isn''t approved, so the factory isn''t paused. Use Unpause brand.', 'no Pay factory either');
select lives_ok(format($$select public.unpause_brand(%L)$$, pg_temp.review(2, 'dispute')), 'unpause the brand');
reset role;
select is((select decision from public.payment_reviews where id = pg_temp.review(2, 'dispute')), 'brand_unpaused',
  'which closes the review');

-- Pay factory: nothing taken.
select pg_temp.act_as('02');
set local role authenticated;
select lives_ok(format($$select public.decide_payment_review(%L, 'pay_factory')$$, pg_temp.review(3, 'refund')), 'pay F2');
reset role;
select is(pg_temp.avail('e2', '04'), (select before from pr24_f2), 'nothing taken');
select is(public.factory_paused(pg_temp.org('e2')), false, 'F2 unpaused');
select is(pg_temp.told(pg_temp.org('e2'), 'Withdrawals resumed'), 'The review of the payment for "PR24 deposit two" is done. You can withdraw your balance again.',
  'F2 is told');

-- ===========================================================================
-- 6. Two reviews on one factory; money already withdrawn; a lost dispute
--    after approval takes nothing by itself.
-- ===========================================================================
select lives_ok($$select pg_temp.as_server('select public.record_payment_review_dispute(''c24f0005-0000-0000-0000-000000000003'', ''dp_pgtap_pr24_5'', ''needs_response'', 53500, null, null)')$$,
  'a dispute on F3''s deposit');
select lives_ok($$select pg_temp.as_server('select public.record_payment_refund_amount(''c24f0006-0000-0000-0000-000000000003'', ''pi_pgtap_pr24_6'', 16050)')$$,
  'a full refund of F3''s approved sample');
select is((select count(*)::int from public.payment_reviews where factory_org_id = pg_temp.org('e3') and decided_at is null), 2, 'two open reviews');
select is((select (x ->> 'returnable_cents')::bigint from jsonb_array_elements(pg_temp.board()) x where (x ->> 'id')::uuid = pg_temp.review(5, 'dispute')),
  45000::bigint, 'the $200 already withdrawn is not offered: $300 + $150');
select is((select (x ->> 'withdrawn_cents')::bigint from jsonb_array_elements(pg_temp.board()) x where (x ->> 'id')::uuid = pg_temp.review(5, 'dispute')),
  20000::bigint, 'the board says what already left');
select lives_ok($$select pg_temp.as_server('select public.record_payment_review_dispute(''c24f0005-0000-0000-0000-000000000003'', ''dp_pgtap_pr24_5'', ''lost'', 53500, null, 1500)')$$,
  'the dispute is lost');
select lives_ok($$select pg_temp.as_server('select public.record_payment_dispute_lost(''c24f0005-0000-0000-0000-000000000003'', ''dp_pgtap_pr24_5'', 53500, 1500)')$$,
  'and recorded as lost');
select ok((select dispute_lost_cents = 53500 and review_kept_cents = 53500 and factory_refund_cents = 0
             from public.order_payments where id = pg_temp.pay(5)), 'the factory keeps its part until staff decide');
select is((select dispute_status || ' ' || coalesce(decision, 'undecided') from public.payment_reviews where id = pg_temp.review(5, 'dispute')),
  'lost undecided', 'the outcome is shown, nothing decided');
select pg_temp.act_as('02');
set local role authenticated;
select lives_ok(format($$select public.decide_payment_review(%L, 'pay_factory')$$, pg_temp.review(6, 'refund')), 'decide one');
reset role;
select is(public.factory_paused(pg_temp.org('e3')), true, 'still paused by the other');
select is(pg_temp.told(pg_temp.org('e3'), 'Payment review complete'),
  'The review of the payment for "PR24 sample three" is done. Withdrawals stay paused while another payment is reviewed.', 'and told so');
select pg_temp.act_as('02');
set local role authenticated;
select throws_ok(format($$select public.decide_payment_review(%L, 'refund_brand', 46000, 'too much')$$, pg_temp.review(5, 'dispute')),
  '22023', 'You can take up to $450.00, the factory''s balance now.', 'never more than the balance now (the $200 withdrawn is not offered)');
select lives_ok(format($$select public.decide_payment_review(%L, 'refund_brand', 45000, 'Goods not delivered.')$$, pg_temp.review(5, 'dispute')),
  'refund all that is left');
reset role;
select is((select sum(taken_back_cents)::bigint from public.order_payments where id in (pg_temp.pay(5), pg_temp.pay(6))), 45000::bigint,
  'spread over what had not left: $300 of the deposit and the $150 sample');
select is(pg_temp.avail('e3', '05'), 0::bigint, 'Available is zero, never below');
select is(public.factory_paused(pg_temp.org('e3')), false, 'F3 unpaused');

-- ===========================================================================
-- 6b. A disputed step is on hold: never taken from; Pay factory says it stays
--     on hold, and the factory is told when the bank settles it.
-- ===========================================================================
select lives_ok($$select pg_temp.as_server('select public.record_payment_review_dispute(''c24f0003-0000-0000-0000-000000000002'', ''dp_pgtap_pr24_3'', ''needs_response'', 32100, null, null)')$$,
  'a dispute on F2''s approved deposit');
select lives_ok($$select pg_temp.as_server('select public.record_payment_disputed(''c24f0003-0000-0000-0000-000000000002'', true)')$$, 'its charge is disputed');
select is(public.review_returnable_cents(pg_temp.org('e2')), 0::bigint, 'a step on hold is never offered to take from');
select pg_temp.act_as('02');
set local role authenticated;
select lives_ok(format($$select public.decide_payment_review(%L, 'pay_factory')$$, pg_temp.review(3, 'dispute')), 'staff let F2 withdraw');
select lives_ok(format($$select public.unpause_brand(%L)$$, pg_temp.review(3, 'dispute')), 'and unpause its brand');
reset role;
select is((select body from public.notifications where org_id = pg_temp.org('e2') and dedupe_key = 'payment_review_done:' || pg_temp.review(3, 'dispute')),
  'The review of the payment for "PR24 deposit two" is done. You can withdraw your balance again. "PR24 deposit two" stays on hold until the payment is settled.',
  'the factory is told the step stays on hold');
select is((select (x ->> 'open')::boolean from jsonb_array_elements(pg_temp.board()) x where (x ->> 'id')::uuid = pg_temp.review(3, 'dispute')), false,
  'decided: under Decided, waiting for the bank, not counted as open (20261124100100)');
select lives_ok($$select pg_temp.as_server('select public.record_payment_review_dispute(''c24f0003-0000-0000-0000-000000000002'', ''dp_pgtap_pr24_3'', ''won'', 32100, null, null)')$$,
  'the bank decides for us');
select is(pg_temp.told(pg_temp.org('e2'), 'Hold lifted on "PR24 deposit two"'), '$300.00 is no longer on hold.', 'the factory is told the hold lifted');
select is((select (x ->> 'dispute_status') from jsonb_array_elements(pg_temp.board()) x where (x ->> 'id')::uuid = pg_temp.review(3, 'dispute')), 'won',
  'its row says the bank decided');
select lives_ok($$select pg_temp.as_server('select public.record_payment_disputed(''c24f0003-0000-0000-0000-000000000002'', false)')$$, 'the hold is lifted');

-- ===========================================================================
-- 7. Nothing is owed, ever; the overview counts open reviews.
-- ===========================================================================
select is((select count(*)::int from public.order_payments p where p.order_id in
            ('c24d0000-0000-0000-0000-000000000001', 'c24d0000-0000-0000-0000-000000000002', 'c24d0000-0000-0000-0000-000000000003')
            and coalesce(public.payment_debt_cents(p), 0) > 0), 0, 'no payment carries a debt');
select is(public.factory_debt_uncovered_cents(pg_temp.org('e3')), 0::bigint, 'no factory owes anything');
select is((select count(*)::int from jsonb_array_elements(pg_temp.board()) x where (x ->> 'open')::boolean
            and (x ->> 'factory_org_id')::uuid in (pg_temp.org('e1'), pg_temp.org('e2'), pg_temp.org('e3'))), 1,
  'open on staff''s list: only F3''s paused brand (decided reviews are not counted)');

select * from finish();
rollback;
