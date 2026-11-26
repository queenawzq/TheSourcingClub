-- Paused payments v2, review fixes (20261125100000).
--   B1  no approval while a staff refund is claimed; the claim decides how it is recorded
--   S2  a full staff refund of a held step that fails is funded again, the brand told
--   S4  an inquiry that escalates after approval pauses the factory
--   S5  a failed dashboard refund gives back only its own review's takes
--   M1  the factory's share is cumulative, never rounded per refund
--   M3  Refund… is allowed during an inquiry
--   X2-1 a paused brand's money is recorded but its payment-only step is held until unpaused;
--        its open intents are listed for cancelling and let go
--   X2-3 a paused brand can't mark a payment sent
--   X2-4 a Stripe refund counts as staff's only if it matches its claim
--
-- Fixtures: slugs pgtap-pr27-*, ids c27?xxxx-...; every count is scoped to them.
--   F1 (owner 01) <- B1 (owner 03), order TSC-927001:
--     P1 approved deposit $200 ($214), P2 held fit sample $100 ($107), P3 payment-only
--     $100 due (intent), P4 held lab dip $100 ($107), P5 bulk $300 due (intent),
--     P6 held trims $100 ($107).
--   Staff: 02.
begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

set local session_replication_role = replica;

insert into auth.users (id, email)
select ('c27a0000-0000-0000-0000-0000000000' || k)::uuid, 'pgtap-pr27-' || k || '@example.com'
  from unnest(array['01','02','03']) k;
insert into public.platform_admins (user_id, note) values ('c27a0000-0000-0000-0000-000000000002', 'pgtap-pr27');
insert into public.orgs (id, type, name, slug) values
  ('c27b0000-0000-0000-0000-0000000000b1', 'brand', 'PR27 Brand One', 'pgtap-pr27-b1'),
  ('c27b0000-0000-0000-0000-0000000000e1', 'factory', 'PR27 Factory One', 'pgtap-pr27-f1');
insert into public.org_members (org_id, user_id, role, permissions) values
  ('c27b0000-0000-0000-0000-0000000000e1', 'c27a0000-0000-0000-0000-000000000001', 'owner', '{}'),
  ('c27b0000-0000-0000-0000-0000000000b1', 'c27a0000-0000-0000-0000-000000000003', 'owner', '{}');
insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total) values
  ('c27c0000-0000-0000-0000-000000000001', 'c27b0000-0000-0000-0000-0000000000b1', 'PR27 request', 'awarded', 'invited_only', 100);
insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity, submitted_at) values
  ('c27c1000-0000-0000-0000-000000000001', 'c27c0000-0000-0000-0000-000000000001', 'c27b0000-0000-0000-0000-0000000000e1', 'accepted', 100, 1, now());
insert into public.production_orders
  (id, rfq_id, quote_id, brand_org_id, factory_org_id, unit_price_cents, status, schedule_brand_agreed_at, schedule_brand_agreed_by,
   production_quantity, bulk_subtotal_cents, sample_subtotal_cents, order_total_cents, deposit_pct, balance_pct, order_number) values
  ('c27d0000-0000-0000-0000-000000000001', 'c27c0000-0000-0000-0000-000000000001', 'c27c1000-0000-0000-0000-000000000001',
   'c27b0000-0000-0000-0000-0000000000b1', 'c27b0000-0000-0000-0000-0000000000e1', 100000, 'active', now() - interval '60 days',
   'c27a0000-0000-0000-0000-000000000003', 1, 100000, 0, 100000, 50, 50, 'TSC-927001');
insert into public.order_milestones (id, order_id, kind, title, amount_cents, state, sort, completed_at) values
  ('c27e0001-0000-0000-0000-000000000001', 'c27d0000-0000-0000-0000-000000000001', 'payment_only', 'PR27 deposit', 20000, 'complete', 5, now() - interval '9 days'),
  ('c27e0002-0000-0000-0000-000000000001', 'c27d0000-0000-0000-0000-000000000001', 'approval_and_payment', 'PR27 fit sample', 10000, 'active', 10, null),
  ('c27e0003-0000-0000-0000-000000000001', 'c27d0000-0000-0000-0000-000000000001', 'payment_only', 'PR27 second deposit', 10000, 'active', 11, null),
  ('c27e0004-0000-0000-0000-000000000001', 'c27d0000-0000-0000-0000-000000000001', 'approval_and_payment', 'PR27 lab dip', 10000, 'active', 12, null),
  ('c27e0005-0000-0000-0000-000000000001', 'c27d0000-0000-0000-0000-000000000001', 'approval_and_payment', 'PR27 bulk', 30000, 'active', 20, null),
  ('c27e0006-0000-0000-0000-000000000001', 'c27d0000-0000-0000-0000-000000000001', 'approval_and_payment', 'PR27 trims', 10000, 'active', 13, null);
insert into public.order_payments
  (id, order_id, milestone_id, amount_cents, charged_cents, currency, state, confirmed_at, release_requested_at,
   stripe_payment_intent_id, stripe_charge_id, funds_available_at) values
  ('c27f0001-0000-0000-0000-000000000001', 'c27d0000-0000-0000-0000-000000000001', 'c27e0001-0000-0000-0000-000000000001', 20000, 21400, 'USD', 'confirmed',
   now() - interval '20 days', now() - interval '9 days', 'pi_pgtap_pr27_1', 'ch_pgtap_pr27_1', now() - interval '15 days'),
  ('c27f0002-0000-0000-0000-000000000001', 'c27d0000-0000-0000-0000-000000000001', 'c27e0002-0000-0000-0000-000000000001', 10000, 10700, 'USD', 'confirmed',
   now() - interval '20 days', null, 'pi_pgtap_pr27_2', 'ch_pgtap_pr27_2', now() - interval '15 days'),
  ('c27f0004-0000-0000-0000-000000000001', 'c27d0000-0000-0000-0000-000000000001', 'c27e0004-0000-0000-0000-000000000001', 10000, 10700, 'USD', 'confirmed',
   now() - interval '20 days', null, 'pi_pgtap_pr27_4', 'ch_pgtap_pr27_4', now() - interval '15 days'),
  ('c27f0006-0000-0000-0000-000000000001', 'c27d0000-0000-0000-0000-000000000001', 'c27e0006-0000-0000-0000-000000000001', 10000, 10700, 'USD', 'confirmed',
   now() - interval '20 days', null, 'pi_pgtap_pr27_6', 'ch_pgtap_pr27_6', now() - interval '15 days');
insert into public.order_payments (id, order_id, milestone_id, amount_cents, charged_cents, currency, state, stripe_payment_intent_id) values
  ('c27f0003-0000-0000-0000-000000000001', 'c27d0000-0000-0000-0000-000000000001', 'c27e0003-0000-0000-0000-000000000001', 10000, 10700, 'USD', 'due', 'pi_pgtap_pr27_3'),
  ('c27f0005-0000-0000-0000-000000000001', 'c27d0000-0000-0000-0000-000000000001', 'c27e0005-0000-0000-0000-000000000001', 30000, 32100, 'USD', 'due', 'pi_pgtap_pr27_5');
set local session_replication_role = origin;

create function pg_temp.act_as(who text) returns void language sql as $f$
  select set_config('request.jwt.claims',
    json_build_object('sub', 'c27a0000-0000-0000-0000-' || lpad(who, 12, '0'), 'role', 'authenticated')::text, true);
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
create function pg_temp.pay(n int) returns uuid language sql immutable as $f$
  select ('c27f000' || n || '-0000-0000-0000-000000000001')::uuid;
$f$;
create function pg_temp.step(n int) returns uuid language sql immutable as $f$
  select ('c27e000' || n || '-0000-0000-0000-000000000001')::uuid;
$f$;
-- Staff 02 claims a refund; returns its id.
create function pg_temp.claim(n int, cents bigint, payer text) returns uuid language plpgsql as $f$
declare j jsonb;
begin
  perform pg_temp.act_as('02');
  set local role authenticated;
  j := public.claim_staff_refund(pg_temp.pay(n), cents, payer, 'pgTAP refund');
  reset role;
  return (j ->> 'staff_refund_id')::uuid;
end;
$f$;
create function pg_temp.made(r uuid, ref text) returns void language plpgsql as $f$
begin
  perform pg_temp.as_server(format('select public.record_staff_refund(%L, %L, ''succeeded'')', r, ref));
end;
$f$;
create function pg_temp.decide(n int, cents bigint) returns void language plpgsql as $f$
declare v uuid;
begin
  select id into v from public.payment_reviews where payment_id = pg_temp.pay(n) and cause = 'refund' and state = 'decide';
  perform pg_temp.act_as('02');
  set local role authenticated;
  perform public.decide_payment_review(v, 'factory_at_fault', cents, 'pgTAP decision');
  reset role;
end;
$f$;
create function pg_temp.approve(n int) returns void language plpgsql as $f$
begin
  perform pg_temp.act_as('03');
  set local role authenticated;
  perform public.approve_milestone(pg_temp.step(n), null);
  reset role;
end;
$f$;
create function pg_temp.told(org_code text, t text) returns text language sql as $f$
  select string_agg(body, ' || ' order by created_at) from public.notifications
   where org_id = ('c27b0000-0000-0000-0000-0000000000' || org_code)::uuid and title = t
     and order_id = 'c27d0000-0000-0000-0000-000000000001';
$f$;

-- ===========================================================================
-- 0. Negatives first: the new helpers are the server's alone.
-- ===========================================================================
select ok(not has_function_privilege('authenticated', 'public.staff_refund_matches(uuid, text, bigint)', 'execute'), 'staff_refund_matches: server only');
select ok(not has_function_privilege('authenticated', 'public.staff_refund_attempt(uuid, boolean)', 'execute'), 'staff_refund_attempt: server only');
select ok(not has_function_privilege('authenticated', 'public.forget_cancelled_intent(uuid, text)', 'execute'), 'forget_cancelled_intent: server only');
select ok(not has_function_privilege('authenticated', 'public.paused_brand_open_intents(uuid)', 'execute'), 'paused_brand_open_intents: server only');
select ok(not has_function_privilege('authenticated', 'public.release_held_while_paused(uuid)', 'execute'), 'release_held_while_paused: server only');
select ok(not has_function_privilege('authenticated', 'public.note_review_refunds(uuid, jsonb)', 'execute'), 'note_review_refunds: server only');
select ok(not has_function_privilege('authenticated', 'public.record_payment_refund_failed(uuid, text, bigint, text)', 'execute'), 'record_payment_refund_failed: server only');
select pg_temp.act_as('01');
set local role authenticated;
select throws_ok($$select count(*) from public.payment_review_refunds$$, '42501', null, 'nobody reads which review a refund belongs to');
reset role;

-- ===========================================================================
-- B1. No approval while a refund is claimed; the claim decides.
-- ===========================================================================
select set_config('tsc.b1', pg_temp.claim(2, 1070, null)::text, true);
select throws_ok($$select pg_temp.approve(2)$$, '22023', 'A refund is in progress for this step.', 'the brand can''t approve while staff refund it');
select throws_ok($$update public.order_payments set release_requested_at = now() where id = 'c27f0002-0000-0000-0000-000000000001'$$,
  '22023', 'A refund is in progress for this step.', 'nor any path ask for its payout');
select lives_ok($$select pg_temp.made(current_setting('tsc.b1')::uuid, 're_pgtap_pr27_b1')$$, 'Stripe made it');
select ok((select not approved_at_claim and kept_cents = 0 from public.staff_refunds where id = current_setting('tsc.b1')::uuid),
  'recorded as the held step it was claimed for');
select ok((select refunded_cents = 1070 and review_kept_cents = 0 and factory_refund_cents = 1000 from public.order_payments where id = pg_temp.pay(2)),
  'the factory''s earning for it went down, as a held refund');
select lives_ok($$select pg_temp.approve(2)$$, 'the claim done, the brand approves');
select lives_ok($$select pg_temp.as_server(format('select public.record_staff_refund_failed(%L, ''failed later'')', current_setting('tsc.b1')))$$,
  'then the refund fails in Stripe');
select ok((select refunded_cents = 0 and review_kept_cents = 0 from public.order_payments where id = pg_temp.pay(2)),
  'undone exactly: nothing taken from another refund''s kept part');

-- ===========================================================================
-- S2. A full staff refund of a held step that fails later is funded again.
-- ===========================================================================
select set_config('tsc.s2', pg_temp.claim(6, 10700, null)::text, true);
select lives_ok($$select pg_temp.made(current_setting('tsc.s2')::uuid, 're_pgtap_pr27_s2')$$, 'all of the trims refunded');
select is((select state::text from public.order_payments where id = pg_temp.pay(6)), 'due', 'the step waits for the brand''s payment again (Due)');
select lives_ok($$select pg_temp.as_server('select public.record_full_refund_failed(''c27f0006-0000-0000-0000-000000000001'', ''pi_pgtap_pr27_6'', ''ch_pgtap_pr27_6'', 10700, 0, 10700, 0, null)')$$,
  'Stripe fails that refund');
select is((select state::text || ' ' || stripe_payment_intent_id from public.order_payments where id = pg_temp.pay(6)), 'confirmed pi_pgtap_pr27_6',
  'funded again with the same charge, not filed as a stray payment');
select is(pg_temp.told('b1', 'Refund for "PR27 trims" didn''t go through'),
  'Your $107.00 refund didn''t go through, so TSC still holds your payment for this step. You don''t need to pay again.', 'the brand is told');
select is((select count(*)::int from public.payment_refund_failures where payment_id = pg_temp.pay(6)), 0, 'no stray row for staff');

-- ===========================================================================
-- M1. The factory's share is cumulative.
-- ===========================================================================
create function pg_temp.cents(k int) returns void language plpgsql as $f$
declare r uuid;
begin
  for i in 1..k loop
    r := pg_temp.claim(1, 1, 'factory');
    perform pg_temp.made(r, 're_pgtap_pr27_m1_' || i);
  end loop;
end;
$f$;
select lives_ok($$select pg_temp.cents(15)$$, 'fifteen 1¢ refunds of the deposit, the factory paying');
select is((select sum(factory_cents)::bigint from public.staff_refunds where payment_id = pg_temp.pay(1)), 14::bigint,
  'the factory bore 14¢: its share of 15¢, never a cent per refund');

-- ===========================================================================
-- S5. A failed dashboard refund gives back only its own review's takes.
-- ===========================================================================
select lives_ok($$select pg_temp.as_server('select public.record_payment_refund_amount(''c27f0001-0000-0000-0000-000000000001'', ''pi_pgtap_pr27_1'', 1015)')$$,
  'a $10 refund in Stripe''s dashboard');
select lives_ok($$select pg_temp.as_server('select public.note_review_refunds(''c27f0001-0000-0000-0000-000000000001'', ' || quote_literal(jsonb_build_array(jsonb_build_object('id', 're_pgtap_pr27_a', 'amount', 1000, 'created', extract(epoch from now())))::text) || ')')$$,
  'noted on its review');
select lives_ok($$select pg_temp.decide(1, 900)$$, 'the factory pays $9');
select lives_ok($$select pg_temp.as_server('select public.record_payment_refund_amount(''c27f0001-0000-0000-0000-000000000001'', ''pi_pgtap_pr27_1'', 1515)')$$,
  'a second, $5, in the dashboard');
select lives_ok($$select pg_temp.as_server('select public.note_review_refunds(''c27f0001-0000-0000-0000-000000000001'', ' || quote_literal(jsonb_build_array(jsonb_build_object('id', 're_pgtap_pr27_a', 'amount', 1000, 'created', extract(epoch from now())),
                                                            jsonb_build_object('id', 're_pgtap_pr27_b', 'amount', 500, 'created', extract(epoch from now())))::text) || ')')$$,
  'noted on its own review');
select lives_ok($$select pg_temp.decide(1, 450)$$, 'the factory pays $4.50');
select is((select taken_back_cents from public.order_payments where id = pg_temp.pay(1)), 1364::bigint, '14¢ + $9 + $4.50 taken');
select lives_ok($$select pg_temp.as_server('select public.record_payment_refund_failed(''c27f0001-0000-0000-0000-000000000001'', ''pi_pgtap_pr27_1'', 515, ''re_pgtap_pr27_a'')')$$,
  'the first ($10) fails');
select is((select taken_back_cents from public.order_payments where id = pg_temp.pay(1)), 464::bigint, 'only its $9 comes back');
select is((select string_agg(state || ' ' || returned_cents, ', ' order by state) from public.payment_reviews where payment_id = pg_temp.pay(1) and cause = 'refund'),
  'factory_at_fault 450, refund_failed 0', 'its review closes (all of it failed: nothing left with the brand); the other keeps its decision');
select is((select review_id from public.payment_review_refunds where stripe_refund_id = 're_pgtap_pr27_a'),
          (select id from public.payment_reviews where payment_id = pg_temp.pay(1) and cause = 'refund' and state = 'refund_failed'), 'the closed one is the failed refund''s own');
create function pg_temp.tsc_pays(n int) returns void language plpgsql as $f$
declare v uuid;
begin
  select id into v from public.payment_reviews where payment_id = pg_temp.pay(n) and cause = 'refund' and state = 'decide';
  perform pg_temp.act_as('02');
  set local role authenticated;
  perform public.decide_payment_review(v, 'no_fault', null, 'pgTAP');
  reset role;
end;
$f$;
select is(public.factory_paused('c27b0000-0000-0000-0000-0000000000e1'), false, 'nothing to decide: the factory carries on');

-- ===========================================================================
-- M3. Refund… during an inquiry.
-- ===========================================================================
select lives_ok($$select pg_temp.as_server('select public.record_payment_review_dispute(''c27f0004-0000-0000-0000-000000000001'', ''dp_pgtap_pr27_4'', ''warning_needs_response'', 10700, now() + interval ''7 days'', null)')$$,
  'an inquiry on the lab dip');
select lives_ok($$select pg_temp.as_server('select public.record_payment_disputed(''c27f0004-0000-0000-0000-000000000001'', true)')$$, 'its step on hold');
select is((select public.staff_refund_refusal(p) from public.order_payments p where p.id = pg_temp.pay(4)), null,
  'Refund… is offered: refunding is how an inquiry is usually settled');

-- ===========================================================================
-- S4. The inquiry escalates after approval: the factory is paused.
-- ===========================================================================
select lives_ok($$select pg_temp.as_server('select public.record_payment_disputed(''c27f0004-0000-0000-0000-000000000001'', false)')$$, 'hold lifted for the test');
select lives_ok($$select pg_temp.approve(4)$$, 'the brand approves the lab dip (an inquiry pauses nobody)');
select is(public.factory_paused('c27b0000-0000-0000-0000-0000000000e1'), false, 'the factory isn''t paused by an inquiry');
select lives_ok($$select pg_temp.as_server('select public.record_payment_review_dispute(''c27f0004-0000-0000-0000-000000000001'', ''dp_pgtap_pr27_4'', ''needs_response'', 10700, now() + interval ''7 days'', 1500)')$$,
  'it becomes a chargeback');
select ok((select pauses_factory and state = 'open' from public.payment_reviews where stripe_ref = 'dp_pgtap_pr27_4'), 'the review now pauses the factory');
select is(public.factory_paused('c27b0000-0000-0000-0000-0000000000e1'), true, 'the factory can''t withdraw while the bank decides');
select ok(pg_temp.told('e1', 'Withdrawals paused') like '%"PR27 lab dip"%', 'and is told');
select is(public.brand_paused('c27b0000-0000-0000-0000-0000000000b1'), true, 'the brand is paused');

-- ===========================================================================
-- X2-3. A paused brand can't mark a payment sent.
-- ===========================================================================
select pg_temp.act_as('03');
set local role authenticated;
select throws_ok($$select public.mark_payment_sent('c27f0005-0000-0000-0000-000000000001', 'WIRE-1', null)$$,
  '42501', 'You can''t fund steps while your account is under review.', 'no bank-transfer claim while paused');
reset role;

-- ===========================================================================
-- W2c. Who was at fault.
-- ===========================================================================
create function pg_temp.resolve(review uuid, fault text, cents bigint) returns void language plpgsql as $f$
begin
  perform pg_temp.act_as('02');
  set local role authenticated;
  perform public.decide_payment_review(review, fault, cents, 'pgTAP resolve');
  reset role;
end;
$f$;
create function pg_temp.paused_brands() returns jsonb language plpgsql as $f$
declare j jsonb;
begin
  perform pg_temp.act_as('02');
  set local role authenticated;
  j := public.admin_paused_brands();
  reset role;
  return j;
end;
$f$;
select is((select b ->> 'reason' || ' · ' || (b ->> 'order_number') from jsonb_array_elements(pg_temp.paused_brands()) b
            where (b ->> 'org_id')::uuid = 'c27b0000-0000-0000-0000-0000000000b1'), 'Bank ruling pending · TSC-927001', 'Users: why the brand is paused');
select ok((select b ->> 'owner_email' = 'pgtap-pr27-03@example.com' from jsonb_array_elements(pg_temp.paused_brands()) b
            where (b ->> 'org_id')::uuid = 'c27b0000-0000-0000-0000-0000000000b1'), 'with its owner''s email');
select lives_ok($$select pg_temp.as_server('select public.record_payment_review_dispute(''c27f0004-0000-0000-0000-000000000001'', ''dp_pgtap_pr27_4'', ''lost'', 10700, null, 1500)')$$,
  'the bank rules for the brand on the lab dip');
select is((select b ->> 'reason' from jsonb_array_elements(pg_temp.paused_brands()) b
            where (b ->> 'org_id')::uuid = 'c27b0000-0000-0000-0000-0000000000b1'), 'Bank ruled for the brand', 'Users follows the ruling');
select lives_ok(format($$select pg_temp.resolve(%L, 'brand_at_fault', null)$$, (select id from public.payment_reviews where stripe_ref = 'dp_pgtap_pr27_4')),
  'staff: the brand was at fault');
select is((select state from public.payment_reviews where stripe_ref = 'dp_pgtap_pr27_4'), 'brand_at_fault', 'resolved');
select is(public.brand_paused('c27b0000-0000-0000-0000-0000000000b1'), true, 'the brand stays paused');
select is(public.factory_paused('c27b0000-0000-0000-0000-0000000000e1'), false, 'the factory can withdraw again, nothing taken');
select is((select b ->> 'reason' || ' · ' || (b ->> 'order_number') from jsonb_array_elements(pg_temp.paused_brands()) b
            where (b ->> 'org_id')::uuid = 'c27b0000-0000-0000-0000-0000000000b1'), 'Brand at fault · TSC-927001', 'Users: Brand at fault');
select ok(pg_temp.told('e1', 'Withdrawals resumed') like '%"PR27 lab dip" on % is done. You can withdraw your balance again.', 'the factory is told, without the note');
-- A refund made in Stripe has no brand at fault.
select lives_ok($$select pg_temp.as_server('select public.record_payment_refund_amount(''c27f0001-0000-0000-0000-000000000001'', ''pi_pgtap_pr27_1'', 1715)')$$,
  'another refund of the deposit in Stripe''s dashboard');
select throws_ok(format($$select pg_temp.resolve(%L, 'brand_at_fault', null)$$,
                        (select id from public.payment_reviews where payment_id = pg_temp.pay(1) and cause = 'refund' and state = 'decide')),
  '22023', 'a refund made in Stripe has no brand at fault', 'refused on a refund row');
select lives_ok(format($$select pg_temp.resolve(%L, 'no_fault', null)$$,
                        (select id from public.payment_reviews where payment_id = pg_temp.pay(1) and cause = 'refund' and state = 'decide')),
  'not the factory: TSC absorbs it');
select throws_ok(format($$select pg_temp.resolve(%L, 'tsc_pays', null)$$, (select id from public.payment_reviews where stripe_ref = 'dp_pgtap_pr27_4')),
  '22023', 'choose who was at fault', 'the old names are gone');

-- ===========================================================================
-- X2-1. A paused brand's money is recorded, its payment-only step held.
-- ===========================================================================
create temp table intents on commit drop as select * from public.paused_brand_open_intents('c27b0000-0000-0000-0000-0000000000b1');
select is((select string_agg(payment_intent, ',' order by payment_intent) from intents), 'pi_pgtap_pr27_3,pi_pgtap_pr27_5',
  'its open intents are listed for the server to cancel');
select is((select public.forget_cancelled_intent(pg_temp.pay(5), 'pi_pgtap_pr27_5')), true, 'a cancelled one is let go');
select is((select stripe_payment_intent_id from public.order_payments where id = pg_temp.pay(5)), null, 'so a new one is made after the pause');
select lives_ok($$select pg_temp.as_server('select public.record_payment_funded(''c27f0003-0000-0000-0000-000000000001'', ''ch_pgtap_pr27_3'', ''card'', ''Visa'', 10700)')$$,
  'a page opened before the pause pays the second deposit anyway');
select ok((select state = 'confirmed' and release_requested_at is null from public.order_payments where id = pg_temp.pay(3)),
  'the money is recorded, but nothing is paid out');
select is((select state::text from public.order_milestones where id = pg_temp.step(3)), 'active', 'and the step doesn''t move on');
select ok(pg_temp.told('e1', 'Payment held for "PR27 second deposit"') like '%when our team finishes a payment review.', 'the factory is told it is held');
select pg_temp.act_as('02');
set local role authenticated;
select lives_ok($$select public.unpause_brand_org('c27b0000-0000-0000-0000-0000000000b1')$$, 'staff unpause the brand');
reset role;
select ok((select release_requested_at is not null from public.order_payments where id = pg_temp.pay(3)), 'then the held deposit is paid out');
select is((select state::text from public.order_milestones where id = pg_temp.step(3)), 'complete', 'and its step completes');
select is(pg_temp.told('e1', '$100.00 added to your balance'), '$100.00 added to your balance for "PR27 second deposit" on PR27 request (TSC-927001).',
  'the factory is told');

-- ===========================================================================
-- W2c. No fault on a dispute: TSC absorbs it and the brand is unpaused.
-- ===========================================================================
select lives_ok($$select pg_temp.approve(6)$$, 'the unpaused brand approves the trims');
select lives_ok($$select pg_temp.as_server('select public.record_payment_review_dispute(''c27f0006-0000-0000-0000-000000000001'', ''dp_pgtap_pr27_6'', ''needs_response'', 10700, now() + interval ''7 days'', 1500)')$$,
  'a stolen card disputes the trims');
select lives_ok($$select pg_temp.as_server('select public.record_payment_review_dispute(''c27f0006-0000-0000-0000-000000000001'', ''dp_pgtap_pr27_6'', ''lost'', 10700, null, 1500)')$$,
  'the bank rules for the cardholder');
select ok(public.brand_paused('c27b0000-0000-0000-0000-0000000000b1') and public.factory_paused('c27b0000-0000-0000-0000-0000000000e1'), 'both paused');
select lives_ok(format($$select pg_temp.resolve(%L, 'no_fault', null)$$, (select id from public.payment_reviews where stripe_ref = 'dp_pgtap_pr27_6')),
  'staff: no one was at fault');
select ok(not public.brand_paused('c27b0000-0000-0000-0000-0000000000b1') and not public.factory_paused('c27b0000-0000-0000-0000-0000000000e1'),
  'both can carry on');
select is((select taken_back_cents from public.order_payments where id = pg_temp.pay(6)), 0::bigint, 'nothing taken from the factory');
select ok(pg_temp.told('b1', 'Account review complete') is not null, 'the brand is told');

-- A staff refund may take less than the factory's share.
create function pg_temp.claim_part(cents bigint, factory bigint) returns uuid language plpgsql as $f$
declare j jsonb;
begin
  perform pg_temp.act_as('02');
  set local role authenticated;
  j := public.claim_staff_refund(pg_temp.pay(1), cents, 'factory', 'pgTAP part', factory);
  reset role;
  return (j ->> 'staff_refund_id')::uuid;
end;
$f$;
select throws_ok($$select pg_temp.claim_part(1000, 1000)$$, '22023', 'You can take up to $9.34 from the factory''s balance.',
  'never more than the factory''s share');
select lives_ok($$select pg_temp.claim_part(1000, 500)$$, 'half of it from the factory''s balance');
select is((select factory_cents from public.staff_refunds where payment_id = pg_temp.pay(1) and status = 'claimed'), 500::bigint, 'TSC pays the rest');

-- ===========================================================================
-- X2-4. A Stripe refund is staff's only if it matches its claim.
-- ===========================================================================
select ok(public.staff_refund_matches(current_setting('tsc.b1')::uuid, 'pi_pgtap_pr27_2', 1070), 'its claim''s intent and amount: staff''s');
select ok(not public.staff_refund_matches(current_setting('tsc.b1')::uuid, 'pi_pgtap_pr27_2', 1071), 'another amount: not');
select ok(not public.staff_refund_matches(current_setting('tsc.b1')::uuid, 'pi_other', 1070), 'another intent: not');
select ok(not public.staff_refund_matches(gen_random_uuid(), 'pi_pgtap_pr27_2', 1070), 'an unknown claim: not');

-- ===========================================================================
-- Re-check round: R1–R4.
-- ===========================================================================
select lives_ok($$select pg_temp.as_server(format('select public.record_staff_refund_failed(%L, ''cleared for the next test'')',
                  (select id from public.staff_refunds where payment_id = 'c27f0001-0000-0000-0000-000000000001' and status = 'claimed')))$$,
  'the open claim is refused by Stripe');
select lives_ok($$select pg_temp.claim_part(100, 0)$$, 'a claim with $0 from the factory''s balance');
select is((select factory_cents from public.staff_refunds where payment_id = pg_temp.pay(1) and status = 'claimed'), 0::bigint, '$0 taken: TSC pays it all');
select lives_ok($$select pg_temp.as_server(format('select public.record_staff_refund_failed(%L, ''refused'')',
                  (select id from public.staff_refunds where payment_id = 'c27f0001-0000-0000-0000-000000000001' and status = 'claimed')))$$,
  'cleared');

-- R2: a try holds a two-minute lease; a retry after it gets a new key.
select set_config('tsc.r2', pg_temp.claim(1, 107, 'factory')::text, true);
create temp table r2 on commit drop as
  select public.staff_refund_attempt(current_setting('tsc.r2')::uuid, false) as first;
select ok((select not (first ? 'busy') from r2), 'the first try takes the lease');
select is((public.staff_refund_attempt(current_setting('tsc.r2')::uuid, true) ->> 'busy'), 'true', 'a retry while it runs is busy: nothing sent twice');
update public.staff_refunds set attempt_at = now() - interval '3 minutes', claimed_at = now() - interval '3 minutes' where id = current_setting('tsc.r2')::uuid;
select isnt(public.staff_refund_attempt(current_setting('tsc.r2')::uuid, true) ->> 'key', (select first ->> 'key' from r2),
  'after the lease, a retry gets a new key');

-- R1: refused, then made after all: Stripe decides.
select lives_ok($$select pg_temp.as_server(format('select public.record_staff_refund_failed(%L, ''refused'')', current_setting('tsc.r2')))$$,
  'Stripe refuses it (as far as we know)');
select is((select status || ' ' || factory_cents from public.staff_refunds where id = current_setting('tsc.r2')::uuid), 'failed 100',
  'failed; its $1.00 given back');
create temp table r1_before on commit drop as select taken_back_cents as t, refunded_cents as r from public.order_payments where id = pg_temp.pay(1);
select lives_ok($$select pg_temp.as_server(format('select public.record_staff_refund(%L, ''re_pgtap_pr27_r1'', ''succeeded'')', current_setting('tsc.r2')))$$,
  'then Stripe says it was made');
select ok((select status = 'made' and recovered_at is not null and factory_cents = 100 from public.staff_refunds where id = current_setting('tsc.r2')::uuid),
  'recorded, the factory''s part taken again');
select ok((select taken_back_cents = (select t from r1_before) + 100 and refunded_cents = (select r from r1_before) + 107
             from public.order_payments where id = pg_temp.pay(1)), 'the payment says so');
select is((select x ->> 'flag' from jsonb_array_elements(public.staff_refund_rows(pg_temp.pay(1))) x where (x ->> 'id')::uuid = current_setting('tsc.r2')::uuid),
  'Refund succeeded after a failure', 'flagged for staff');
select is((select count(*)::int from public.notifications where dedupe_key = 'staff_refund:' || current_setting('tsc.r2') || ':recovered'), 2,
  'both sides told it was refunded');

-- R3: a refund made before approval never belongs to a review.
select is(public.note_review_refunds(pg_temp.pay(1), jsonb_build_array(jsonb_build_object('id', 're_pgtap_pr27_old', 'amount', 50,
            'created', extract(epoch from now() - interval '15 days')))), 0, 'made before approval: not noted');
select is((select count(*)::int from public.payment_review_refunds where stripe_refund_id = 're_pgtap_pr27_old'), 0, 'on no review');

-- R4: a review whose refund failed entirely closes; the factory resumes.
select set_config('tsc.r4', (select refunded_cents::text from public.order_payments where id = pg_temp.pay(1)), true);
select lives_ok(format($$select pg_temp.as_server('select public.record_payment_refund_amount(''c27f0001-0000-0000-0000-000000000001'', ''pi_pgtap_pr27_1'', %s)')$$,
                       current_setting('tsc.r4')::bigint + 300), 'a $3 refund in Stripe''s dashboard');
select is(public.factory_paused('c27b0000-0000-0000-0000-0000000000e1'), true, 'the factory is paused for it');
select lives_ok(format($$select pg_temp.as_server('select public.record_payment_refund_failed(''c27f0001-0000-0000-0000-000000000001'', ''pi_pgtap_pr27_1'', %s)')$$,
                       current_setting('tsc.r4')), 'it fails in Stripe');
select is((select count(*) filter (where state = 'decide') || ' ' || count(*) filter (where state = 'refund_failed')
             from public.payment_reviews where payment_id = pg_temp.pay(1) and cause = 'refund'), '0 2',
  'nothing left with the brand: the review closes');
select is(public.factory_paused('c27b0000-0000-0000-0000-0000000000e1'), false, 'the factory resumes');
select is((select public.payment_review_step_line(v) from public.payment_reviews v where v.payment_id = pg_temp.pay(1) and v.state = 'refund_failed' limit 1),
  'Refund failed · nothing returned', 'the board says so');

select * from finish();
rollback;
