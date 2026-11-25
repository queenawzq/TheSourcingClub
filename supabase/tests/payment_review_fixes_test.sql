-- Payment reviews, fixes (20261124100100).
--
--  1. No road pays a paused factory: a hand payout of an owed step, a
--     per-step payout's claim (a waiting withdrawal marked paid by bank is in
--     money_review_round19_test).
--  2. A refund that fails after Approve gives the money back where it was
--     taken from and reopens the review; the factory is told.
--  v2 (20261125100000): a hand payout whose number staff revealed before the
--     pause may still be marked paid (the wire may have gone), and no cap
--     takes from it; Unpause brand waits for the bank and for staff's decision.
--  3. A dispute on a step not approved yet pauses the brand only; lost before
--     approval, the paused brand is not told to pay again; lost once the step
--     is approved, the factory is paused then.
--  4. Open on staff's list = a dispute the bank hasn't decided, or a decision
--     (20261125100000).
--
-- Fixtures: slugs pgtap-pr24x-*, ids c25?xxxx-...; every count is scoped to them.
--   F1 (owner 01) <- B1 (owner 03): Q1 approved deposit $200 (charged $214),
--      Q2 approved fit sample $100 ($107). F1 has no Stripe account (paid by hand).
--   F2 (owner 04) <- B2 (owner 07): Q3 fit sample $100 ($107) and Q4 bulk
--      $300 ($321), both funded, neither approved.
--   Staff: 02.
begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

set local session_replication_role = replica;

insert into auth.users (id, email)
select ('c25a0000-0000-0000-0000-0000000000' || k)::uuid, 'pgtap-pr24x-' || k || '@example.com'
  from unnest(array['01','02','03','04','07']) k;
insert into public.platform_admins (user_id, note) values ('c25a0000-0000-0000-0000-000000000002', 'pgtap-pr24x');
insert into public.orgs (id, type, name, slug) values
  ('c25b0000-0000-0000-0000-0000000000b1', 'brand', 'PR24X Brand One', 'pgtap-pr24x-b1'),
  ('c25b0000-0000-0000-0000-0000000000b2', 'brand', 'PR24X Brand Two', 'pgtap-pr24x-b2'),
  ('c25b0000-0000-0000-0000-0000000000e1', 'factory', 'PR24X Factory One', 'pgtap-pr24x-f1'),
  ('c25b0000-0000-0000-0000-0000000000e2', 'factory', 'PR24X Factory Two', 'pgtap-pr24x-f2');
insert into public.org_members (org_id, user_id, role, permissions) values
  ('c25b0000-0000-0000-0000-0000000000e1', 'c25a0000-0000-0000-0000-000000000001', 'owner', '{}'),
  ('c25b0000-0000-0000-0000-0000000000b1', 'c25a0000-0000-0000-0000-000000000003', 'owner', '{}'),
  ('c25b0000-0000-0000-0000-0000000000e2', 'c25a0000-0000-0000-0000-000000000004', 'owner', '{}'),
  ('c25b0000-0000-0000-0000-0000000000b2', 'c25a0000-0000-0000-0000-000000000007', 'owner', '{}');
insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total) values
  ('c25c0000-0000-0000-0000-000000000001', 'c25b0000-0000-0000-0000-0000000000b1', 'PR24X request 1', 'awarded', 'invited_only', 100),
  ('c25c0000-0000-0000-0000-000000000002', 'c25b0000-0000-0000-0000-0000000000b2', 'PR24X request 2', 'awarded', 'invited_only', 100);
insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity, submitted_at) values
  ('c25c1000-0000-0000-0000-000000000001', 'c25c0000-0000-0000-0000-000000000001', 'c25b0000-0000-0000-0000-0000000000e1', 'accepted', 100, 1, now()),
  ('c25c1000-0000-0000-0000-000000000002', 'c25c0000-0000-0000-0000-000000000002', 'c25b0000-0000-0000-0000-0000000000e2', 'accepted', 100, 1, now());
insert into public.production_orders
  (id, rfq_id, quote_id, brand_org_id, factory_org_id, unit_price_cents, status, schedule_brand_agreed_at, schedule_brand_agreed_by,
   production_quantity, bulk_subtotal_cents, sample_subtotal_cents, order_total_cents, deposit_pct, balance_pct, order_number) values
  ('c25d0000-0000-0000-0000-000000000001', 'c25c0000-0000-0000-0000-000000000001', 'c25c1000-0000-0000-0000-000000000001',
   'c25b0000-0000-0000-0000-0000000000b1', 'c25b0000-0000-0000-0000-0000000000e1', 100000, 'active', now() - interval '60 days',
   'c25a0000-0000-0000-0000-000000000003', 1, 100000, 0, 100000, 50, 50, 'PR24X-1'),
  ('c25d0000-0000-0000-0000-000000000002', 'c25c0000-0000-0000-0000-000000000002', 'c25c1000-0000-0000-0000-000000000002',
   'c25b0000-0000-0000-0000-0000000000b2', 'c25b0000-0000-0000-0000-0000000000e2', 100000, 'active', now() - interval '60 days',
   'c25a0000-0000-0000-0000-000000000007', 1, 100000, 0, 100000, 50, 50, 'PR24X-2');
insert into public.order_milestones (id, order_id, kind, title, amount_cents, state, sort, completed_at) values
  ('c25e0001-0000-0000-0000-000000000001', 'c25d0000-0000-0000-0000-000000000001', 'payment_only', 'PR24X deposit', 20000, 'complete', 5, now() - interval '9 days'),
  ('c25e0002-0000-0000-0000-000000000001', 'c25d0000-0000-0000-0000-000000000001', 'approval_and_payment', 'PR24X fit sample', 10000, 'complete', 10, now() - interval '8 days'),
  ('c25e0003-0000-0000-0000-000000000002', 'c25d0000-0000-0000-0000-000000000002', 'approval_and_payment', 'PR24X fit two', 10000, 'active', 5, null),
  ('c25e0004-0000-0000-0000-000000000002', 'c25d0000-0000-0000-0000-000000000002', 'approval_and_payment', 'PR24X bulk two', 30000, 'active', 10, null);
insert into public.order_payments
  (id, order_id, milestone_id, amount_cents, charged_cents, currency, state, confirmed_at, release_requested_at,
   stripe_payment_intent_id, stripe_charge_id, funds_available_at) values
  ('c25f0001-0000-0000-0000-000000000001', 'c25d0000-0000-0000-0000-000000000001', 'c25e0001-0000-0000-0000-000000000001', 20000, 21400, 'USD', 'confirmed',
   now() - interval '20 days', now() - interval '9 days', 'pi_pgtap_pr24x_1', 'ch_pgtap_pr24x_1', now() - interval '15 days'),
  ('c25f0002-0000-0000-0000-000000000001', 'c25d0000-0000-0000-0000-000000000001', 'c25e0002-0000-0000-0000-000000000001', 10000, 10700, 'USD', 'confirmed',
   now() - interval '20 days', now() - interval '8 days', 'pi_pgtap_pr24x_2', 'ch_pgtap_pr24x_2', now() - interval '15 days'),
  ('c25f0003-0000-0000-0000-000000000002', 'c25d0000-0000-0000-0000-000000000002', 'c25e0003-0000-0000-0000-000000000002', 10000, 10700, 'USD', 'confirmed',
   now() - interval '20 days', null, 'pi_pgtap_pr24x_3', 'ch_pgtap_pr24x_3', now() - interval '15 days'),
  ('c25f0004-0000-0000-0000-000000000002', 'c25d0000-0000-0000-0000-000000000002', 'c25e0004-0000-0000-0000-000000000002', 30000, 32100, 'USD', 'confirmed',
   now() - interval '20 days', null, 'pi_pgtap_pr24x_4', 'ch_pgtap_pr24x_4', now() - interval '15 days');
set local session_replication_role = origin;

create function pg_temp.act_as(who text) returns void language sql as $f$
  select set_config('request.jwt.claims',
    json_build_object('sub', 'c25a0000-0000-0000-0000-' || lpad(who, 12, '0'), 'role', 'authenticated')::text, true);
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
  select ('c25b0000-0000-0000-0000-0000000000' || code)::uuid;
$f$;
create function pg_temp.pay(n int) returns uuid language sql immutable as $f$
  select ('c25f000' || n || '-0000-0000-0000-00000000000' || case when n in (1, 2) then 1 else 2 end)::uuid;
$f$;
create function pg_temp.review(n int, why text) returns uuid language sql security definer as $f$
  select id from public.payment_reviews where payment_id = pg_temp.pay(n) and cause = why order by created_at desc limit 1;
$f$;
grant execute on function pg_temp.review(int, text) to authenticated;
create function pg_temp.told(org uuid, title text) returns text language sql security definer as $f$
  select string_agg(n.body, ' || ' order by n.created_at) from public.notifications n where n.org_id = org and n.title = told.title;
$f$;
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
create function pg_temp.open_count() returns int language sql as $f$
  select count(*)::int from jsonb_array_elements(pg_temp.board()) x
   where (x ->> 'open')::boolean and (x ->> 'factory_org_id')::uuid in (pg_temp.org('e1'), pg_temp.org('e2'));
$f$;

-- ===========================================================================
-- 1. A refund after approval pauses F1; no road pays it meanwhile.
-- ===========================================================================
select lives_ok($$select pg_temp.as_server('select public.record_payment_refund_amount(''c25f0001-0000-0000-0000-000000000001'', ''pi_pgtap_pr24x_1'', 5000)')$$,
  '$50 of the deposit refunded in Stripe after approval');
select is(public.factory_paused(pg_temp.org('e1')), true, 'F1 is paused');

select pg_temp.act_as('02');
set local role authenticated;
select throws_ok($$select public.release_payment_to_factory('c25f0002-0000-0000-0000-000000000001', 'WIRE-PR24X-1')$$,
  '22023', 'This factory''s withdrawals are paused while a payment is reviewed.', 'staff can''t mark the fit sample paid by bank');
reset role;
select is((select state::text from public.order_payments where id = pg_temp.pay(2)), 'confirmed', 'it stays owed');
-- A hand payout staff are sending (20261125100000).
select is(public.review_returnable_cents(pg_temp.org('e1')), 30000::bigint, 'before any reveal, both owed steps could be taken from');
insert into public.payout_number_reveals (account_id, org_id, org_name, staff_user_id, revealed_at)
values (gen_random_uuid(), 'c25b0000-0000-0000-0000-0000000000e1', 'PR24X Factory One', 'c25a0000-0000-0000-0000-000000000002', now() + interval '1 second');
select pg_temp.act_as('02');
set local role authenticated;
select throws_ok($$select public.release_payment_to_factory('c25f0002-0000-0000-0000-000000000001', 'WIRE-PR24X-1')$$,
  '22023', 'This factory''s withdrawals are paused while a payment is reviewed.', 'a number revealed after the pause: still refused');
reset role;
select is(public.review_returnable_cents(pg_temp.org('e1')), 0::bigint, 'once revealed, no cap takes from the steps being sent by hand');
delete from public.payout_number_reveals where org_id = 'c25b0000-0000-0000-0000-0000000000e1';
insert into public.payout_number_reveals (account_id, org_id, org_name, staff_user_id, revealed_at)
values (gen_random_uuid(), 'c25b0000-0000-0000-0000-0000000000e1', 'PR24X Factory One', 'c25a0000-0000-0000-0000-000000000002', now() - interval '1 minute');
select pg_temp.act_as('02');
set local role authenticated;
select lives_ok($$select public.release_payment_to_factory('c25f0002-0000-0000-0000-000000000001', 'WIRE-PR24X-1')$$,
  'revealed before the pause: staff record the wire that already went');
reset role;
select is((select state::text from public.order_payments where id = pg_temp.pay(2)), 'released', 'paid out');
delete from public.payout_number_reveals where org_id = 'c25b0000-0000-0000-0000-0000000000e1';
select throws_ok($$update public.order_payments set release_claimed_at = now(), stripe_release_started = true where id = 'c25f0002-0000-0000-0000-000000000001'$$,
  '22023', 'This factory''s withdrawals are paused while a payment is reviewed.', 'nor start a per-step payout');
select is((select count(*)::int from jsonb_array_elements(pg_temp.board()) x where (x ->> 'id')::uuid = pg_temp.review(1, 'refund')
            and (x ->> 'charged_cents')::bigint = 21400 and (x ->> 'amount_cents')::bigint = 5000), 1,
  'the row has what was refunded and what was charged ("Partly refunded: $50.00 of $214.00")');
select is(pg_temp.open_count(), 1, 'one open review');

-- ===========================================================================
-- 2. Approve, then the refund fails in Stripe.
-- ===========================================================================
select pg_temp.act_as('02');
set local role authenticated;
select lives_ok(format($$select public.decide_payment_review(%L, 'approve', 4000, 'Refunded for the late sample.')$$, pg_temp.review(1, 'refund')),
  'staff Approve: $40 from F1''s balance');
reset role;
select is((select taken_back_cents from public.order_payments where id = pg_temp.pay(1)), 4000::bigint, 'taken from the reviewed deposit');
select is((select takes from public.payment_reviews where id = pg_temp.review(1, 'refund')),
  jsonb_build_array(jsonb_build_object('payment_id', pg_temp.pay(1), 'cents', 4000)), 'where it was taken from is kept');
select is(public.factory_paused(pg_temp.org('e1')), false, 'F1 unpaused');
select is(pg_temp.open_count(), 0, 'nothing open');

select lives_ok($$select pg_temp.as_server('select public.record_payment_refund_failed(''c25f0001-0000-0000-0000-000000000001'', ''pi_pgtap_pr24x_1'', 0)')$$,
  'the $50 refund fails in Stripe');
select is((select taken_back_cents from public.order_payments where id = pg_temp.pay(1)), 0::bigint, 'the $40 is given back to the deposit');
select is((select row(state, decision, decided_at is null, returned_cents, refund_failed_cents, amount_cents)::text
             from public.payment_reviews where id = pg_temp.review(1, 'refund')),
          row('decide'::text, null::text, true, 0::bigint, 4000::bigint, 0::bigint)::text, 'the review opens again, saying the refund failed');
select is(public.factory_paused(pg_temp.org('e1')), true, 'F1 is paused again until staff decide');
select is(pg_temp.told(pg_temp.org('e1'), 'Refund for "PR24X deposit" didn''t go through'),
  'The refund to the brand didn''t go through. Your earnings from PR24X request 1 (PR24X-1) went back up by $40.00. Withdrawals are paused while our team reviews the payment again.',
  'F1 is told');
select is((select count(*)::int from jsonb_array_elements(pg_temp.board()) x where (x ->> 'id')::uuid = pg_temp.review(1, 'refund')
            and (x ->> 'open')::boolean and x ->> 'refund_failed_at' is not null
            and x ->> 'status_word' = 'Refund failed · decision needed'), 1, 'open on staff''s list, marked as a failed refund');
select is(pg_temp.open_count(), 1, 'counted once');
select pg_temp.act_as('02');
set local role authenticated;
select lives_ok(format($$select public.decide_payment_review(%L, 'decline', null, 'TSC bears it.')$$, pg_temp.review(1, 'refund')), 'staff decide again: Decline');
reset role;
select is(public.factory_paused(pg_temp.org('e1')), false, 'F1 unpaused');

-- ===========================================================================
-- 3. Disputes on steps not approved yet: the brand only.
-- ===========================================================================
select lives_ok($$select pg_temp.as_server('select public.record_payment_review_dispute(''c25f0003-0000-0000-0000-000000000002'', ''dp_pgtap_pr24x_3'', ''needs_response'', 10700, null, null)')$$,
  'a dispute on F2''s funded fit sample');
select is(row(public.factory_paused(pg_temp.org('e2')), public.brand_paused(pg_temp.org('b2'))), row(false, true),
  'the brand is paused, the factory is not');
select is(pg_temp.told(pg_temp.org('e2'), 'Withdrawals paused'), null, 'the factory is told nothing');
select is((select (x ->> 'factory_paused')::boolean from jsonb_array_elements(pg_temp.board()) x where (x ->> 'id')::uuid = pg_temp.review(3, 'dispute')),
  false, 'staff''s row says the factory isn''t paused');
select is(pg_temp.open_count(), 1, 'open: the bank is deciding');

select lives_ok($$select pg_temp.as_server('select public.record_payment_review_dispute(''c25f0003-0000-0000-0000-000000000002'', ''dp_pgtap_pr24x_3'', ''lost'', 10700, null, 1500)')$$,
  'the bank decides for the brand');
select lives_ok($$select pg_temp.as_server('select public.record_payment_dispute_lost(''c25f0003-0000-0000-0000-000000000002'', ''dp_pgtap_pr24x_3'', 10700, 1500)')$$,
  'recorded lost before approval');
select is((select state::text from public.order_payments where id = pg_temp.pay(3)), 'failed', 'the step is to be paid again');
select is(pg_temp.told(pg_temp.org('b2'), 'Your bank reversed your payment for "PR24X fit two"'), '$107.00 went back to your card.',
  'the paused brand is not told to pay again');
select is(pg_temp.told(pg_temp.org('e2'), 'Payment for "PR24X fit two" reversed'), 'TSC no longer holds money for this step on PR24X request 2 (PR24X-2).',
  'nor is the factory told the brand was asked to (20261125100000)');

-- A dispute opened before approval, the step approved after, then lost: the
-- money is in F2's balance now, so F2 is paused then.
select lives_ok($$select pg_temp.as_server('select public.record_payment_review_dispute(''c25f0004-0000-0000-0000-000000000002'', ''dp_pgtap_pr24x_4'', ''needs_response'', 32100, null, null)')$$,
  'a dispute on F2''s funded bulk');
select pg_temp.act_as('02');
set local role authenticated;
select throws_ok(format($$select public.unpause_brand(%L)$$, pg_temp.review(4, 'dispute')), '22023', 'the bank hasn''t decided yet',
  'staff can''t unpause the brand while the bank decides (v2)');
reset role;
select is((select (x ->> 'open')::boolean from jsonb_array_elements(pg_temp.board()) x where (x ->> 'id')::uuid = pg_temp.review(4, 'dispute')), true,
  'it stays open and counted while the bank hasn''t decided');
update public.order_payments set release_requested_at = now() where id = 'c25f0004-0000-0000-0000-000000000002';
select lives_ok($$select pg_temp.as_server('select public.record_payment_review_dispute(''c25f0004-0000-0000-0000-000000000002'', ''dp_pgtap_pr24x_4'', ''lost'', 32100, null, 1500)')$$,
  'approved since, then the bank decides for the brand');
select is((select row(pauses_factory, state)::text from public.payment_reviews where id = pg_temp.review(4, 'dispute')),
  row(true, 'decide')::text, 'the review pauses the factory, for staff to decide');
select is(public.factory_paused(pg_temp.org('e2')), true, 'F2 is paused');
select is(pg_temp.told(pg_temp.org('e2'), 'Withdrawals paused'),
  'A brand requested a refund for "PR24X bulk two" on PR24X request 2 (PR24X-2), so our team is reviewing the payment. Withdrawals are paused until the review is done.',
  'and told once');

select * from finish();
rollback;
