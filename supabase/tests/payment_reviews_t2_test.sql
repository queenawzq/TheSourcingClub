-- Paused payments, tester fixes T2 (20261125100000, section 16 and in place).
--   Y1  the factory is told the true cause: a card dispute, or a refund made outside the app
--   R2  a dispute on a held step is told once per dispute, not once per payment
--   A3  "review done" names the order and says the balance is unchanged
--   A4  what left the factory's balance, in its words
--   B6  the brand "can still message vendors"
--   A5/A10/A6  the board's pauses_brand, brand_stays_paused and Stripe's reason
--   R3  Close records what went back another way: a 'manual' line, on the payment
--   B2  production_order_charges: refunded and reversed on funded payments
--
-- Fixtures: slugs pgtap-pr31-*, ids c31?xxxx-...; every count is scoped to them.
--   F1 (owner 01) <- B1 (owner 03), order TSC-931001. Staff: 02.
--   P1, P2, P5 approved and held $100 ($107); P3, P6 held, not approved; P4 due.
begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

set local session_replication_role = replica;

insert into auth.users (id, email)
select ('c31a0000-0000-0000-0000-0000000000' || k)::uuid, 'pgtap-pr31-' || k || '@example.com'
  from unnest(array['01','02','03']) k;
insert into public.platform_admins (user_id, note) values ('c31a0000-0000-0000-0000-000000000002', 'pgtap-pr31');
insert into public.orgs (id, type, name, slug) values
  ('c31b0000-0000-0000-0000-0000000000b1', 'brand', 'PR31 Brand One', 'pgtap-pr31-b1'),
  ('c31b0000-0000-0000-0000-0000000000e1', 'factory', 'PR31 Factory One', 'pgtap-pr31-f1');
insert into public.org_members (org_id, user_id, role, permissions) values
  ('c31b0000-0000-0000-0000-0000000000e1', 'c31a0000-0000-0000-0000-000000000001', 'owner', '{}'),
  ('c31b0000-0000-0000-0000-0000000000b1', 'c31a0000-0000-0000-0000-000000000003', 'owner', '{}');
insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total) values
  ('c31c0000-0000-0000-0000-000000000001', 'c31b0000-0000-0000-0000-0000000000b1', 'PR31 request', 'awarded', 'invited_only', 100);
insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity, submitted_at) values
  ('c31c1000-0000-0000-0000-000000000001', 'c31c0000-0000-0000-0000-000000000001', 'c31b0000-0000-0000-0000-0000000000e1', 'accepted', 100, 1, now());
insert into public.production_orders
  (id, rfq_id, quote_id, brand_org_id, factory_org_id, unit_price_cents, status, schedule_brand_agreed_at, schedule_brand_agreed_by,
   production_quantity, bulk_subtotal_cents, sample_subtotal_cents, order_total_cents, deposit_pct, balance_pct, order_number) values
  ('c31d0000-0000-0000-0000-000000000001', 'c31c0000-0000-0000-0000-000000000001', 'c31c1000-0000-0000-0000-000000000001',
   'c31b0000-0000-0000-0000-0000000000b1', 'c31b0000-0000-0000-0000-0000000000e1', 100000, 'active', now() - interval '60 days',
   'c31a0000-0000-0000-0000-000000000003', 1, 100000, 0, 100000, 50, 50, 'TSC-931001');
insert into public.order_milestones (id, order_id, kind, title, amount_cents, state, completed_at, sort)
select ('c31e000' || n || '-0000-0000-0000-000000000001')::uuid, 'c31d0000-0000-0000-0000-000000000001', 'approval_and_payment',
       'PR31 step ' || n, 10000, case when n in (1, 2, 5) then 'complete' else 'active' end::public.milestone_state,
       case when n in (1, 2, 5) then now() - interval '4 days' end, 10 + n
  from generate_series(1, 6) n;
insert into public.order_payments
  (id, order_id, milestone_id, amount_cents, charged_cents, currency, state, confirmed_at, release_requested_at,
   stripe_payment_intent_id, stripe_charge_id, funds_available_at)
select ('c31f000' || n || '-0000-0000-0000-000000000001')::uuid, 'c31d0000-0000-0000-0000-000000000001',
       ('c31e000' || n || '-0000-0000-0000-000000000001')::uuid, 10000, 10700, 'USD', 'confirmed', now() - interval '5 days',
       case when n in (1, 2, 5) then now() - interval '4 days' end,
       'pi_pgtap_pr31_' || n, 'ch_pgtap_pr31_' || n, now() - interval '2 days'
  from unnest(array[1, 2, 3, 5, 6]) n;
insert into public.order_payments (id, order_id, milestone_id, amount_cents, charged_cents, currency, state, stripe_payment_intent_id) values
  ('c31f0004-0000-0000-0000-000000000001', 'c31d0000-0000-0000-0000-000000000001', 'c31e0004-0000-0000-0000-000000000001', 10000, 10700, 'USD', 'due', 'pi_pgtap_pr31_4');
set local session_replication_role = origin;

create function pg_temp.act_as(who text) returns void language sql as $f$
  select set_config('request.jwt.claims',
    json_build_object('sub', 'c31a0000-0000-0000-0000-' || lpad(who, 12, '0'), 'role', 'authenticated')::text, true);
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
  select ('c31f000' || n || '-0000-0000-0000-000000000001')::uuid;
$f$;
create function pg_temp.staff_json(sql text) returns jsonb language plpgsql as $f$
declare j jsonb;
begin
  perform pg_temp.act_as('02');
  set local role authenticated;
  execute sql into j;
  reset role;
  return j;
end;
$f$;
create function pg_temp.staff(sql text) returns void language plpgsql as $f$
begin
  perform pg_temp.act_as('02');
  set local role authenticated;
  execute sql;
  reset role;
end;
$f$;
create function pg_temp.decide(r uuid, decision text, amount bigint, note text) returns void language plpgsql as $f$
begin
  perform pg_temp.act_as('02');
  set local role authenticated;
  perform public.decide_payment_review(r, decision, amount, note);
  reset role;
end;
$f$;
create function pg_temp.close(r uuid, note text, amount bigint) returns void language plpgsql as $f$
begin
  perform pg_temp.act_as('02');
  set local role authenticated;
  perform public.close_staff_refund_failure(r, note, amount);
  reset role;
end;
$f$;
create function pg_temp.dispute(n int, ref text, status text) returns void language plpgsql as $f$
begin
  perform pg_temp.as_server(format('select public.record_payment_review_dispute(%L, %L, %L, 10700, now() + interval ''7 days'', 1500)',
                                   pg_temp.pay(n), ref, status));
end;
$f$;
create function pg_temp.lost(n int, ref text) returns void language plpgsql as $f$
begin
  perform pg_temp.dispute(n, ref, 'lost');
  perform pg_temp.as_server(format('select public.record_payment_dispute_lost(%L, %L, 10700, 1500)', pg_temp.pay(n), ref));
end;
$f$;
create function pg_temp.body(org_code text, title_like text, step int) returns text language sql as $f$
  select string_agg(body, ' || ' order by created_at, body) from public.notifications
   where org_id = ('c31b0000-0000-0000-0000-0000000000' || org_code)::uuid and title like title_like
     and subject_id = pg_temp.pay(step);
$f$;
create function pg_temp.review(n int, ref text) returns uuid language sql as $f$
  select v.id from public.payment_reviews v where v.payment_id = pg_temp.pay(n) and v.stripe_ref = ref;
$f$;
create function pg_temp.row_of(id uuid) returns jsonb language sql as $f$
  select x from jsonb_array_elements(pg_temp.staff_json($$select public.payment_review_board()$$)) x where x ->> 'id' = id::text;
$f$;

-- ===========================================================================
-- Y1, B6. A chargeback on an approved step: the factory reads "disputed a card
-- payment"; the brand "can still message vendors".
-- ===========================================================================
select pg_temp.dispute(1, 'dp_pgtap_pr31_1', 'needs_response');
select is(pg_temp.body('e1', 'Withdrawals paused', 1),
  'A brand disputed a card payment for "PR31 step 1" on PR31 request (TSC-931001), so our team is reviewing it. Withdrawals are paused until the review is done.',
  'Y1: a card dispute, in its own words');
select is(pg_temp.body('b1', 'Account under review', 1),
  'A payment for "PR31 step 1" on PR31 request (TSC-931001) was disputed with your bank. Until our review is done, you can''t fund or approve steps or accept quotes. You can still message vendors.',
  'B6: the brand can still message vendors');

-- A refund made in Stripe after approval keeps "requested a refund".
select pg_temp.as_server(format('select public.record_payment_refund_amount(%L, ''pi_pgtap_pr31_5'', 5350)', pg_temp.pay(5)));
select is(pg_temp.body('e1', 'Withdrawals paused', 5),
  'A brand requested a refund for "PR31 step 5" on PR31 request (TSC-931001), so our team is reviewing the payment. Withdrawals are paused until the review is done.',
  'Y1: a refund made outside the app keeps its words');

-- ===========================================================================
-- R2. A held step not approved, two disputes: told twice, once each.
-- ===========================================================================
select pg_temp.dispute(3, 'dp_pgtap_pr31_3a', 'needs_response');
select pg_temp.dispute(3, 'dp_pgtap_pr31_3b', 'needs_response');
select pg_temp.dispute(3, 'dp_pgtap_pr31_3a', 'needs_response');
select is((select count(*)::int from public.notifications where org_id = 'c31b0000-0000-0000-0000-0000000000e1'
            and title = 'Payment for "PR31 step 3" disputed'), 2, 'R2: one notice per dispute');
select is((select distinct body from public.notifications where org_id = 'c31b0000-0000-0000-0000-0000000000e1'
            and title = 'Payment for "PR31 step 3" disputed'),
  'A brand disputed a card payment for "PR31 step 3" on PR31 request (TSC-931001), so our team is reviewing it.', 'C1: in the dispute''s words');
select is((select count(*)::int from public.notifications where org_id = 'c31b0000-0000-0000-0000-0000000000e1'
            and subject_id = pg_temp.pay(3) and title = 'Withdrawals paused'), 0, 'not approved: withdrawals not paused');

-- Disputed before it was recorded (the same second): told once, when funded.
select pg_temp.dispute(4, 'dp_pgtap_pr31_4', 'needs_response');
select is((select count(*)::int from public.notifications where org_id = 'c31b0000-0000-0000-0000-0000000000e1'
            and subject_id = pg_temp.pay(4)), 0, 'not funded yet: nothing to tell');
select pg_temp.as_server(format('select public.record_payment_funded(%L, ''ch_pgtap_pr31_4'', ''card'', ''Visa'', 10700)', pg_temp.pay(4)));
select is((select string_agg(title, ',') from public.notifications where org_id = 'c31b0000-0000-0000-0000-0000000000e1'
            and subject_id = pg_temp.pay(4)), 'Payment for "PR31 step 4" disputed', 'funded: told once, as disputed, never "added" or "held"');

-- ===========================================================================
-- A5, A10, A6. The board's flags and Stripe's reason.
-- ===========================================================================
select pg_temp.as_server($$select public.record_payment_review_dispute_reason('dp_pgtap_pr31_1', 'product_not_received')$$);
select is((select concat_ws(' | ', x ->> 'dispute_reason', x ->> 'dispute_reason_words', x ->> 'pauses_brand', x ->> 'brand_stays_paused')
             from (select pg_temp.row_of(pg_temp.review(1, 'dp_pgtap_pr31_1')) x) q),
  'product_not_received | Product not received | true | true', 'A6 the reason in words; A10 pauses the brand; A5 another dispute keeps it paused');
select is((select concat_ws(' | ', coalesce(x ->> 'dispute_reason', '-'), x ->> 'pauses_brand')
             from (select pg_temp.row_of((select id from public.payment_reviews where payment_id = pg_temp.pay(5))) x) q),
  '- | false', 'a refund made in Stripe pauses no brand');
select is(public.dispute_reason_words('some_new_reason'), 'Some New Reason', 'a reason Stripe adds later still reads');

-- ===========================================================================
-- A3, A4. Staff decide: what the factory reads.
-- ===========================================================================
select pg_temp.lost(1, 'dp_pgtap_pr31_1');
select pg_temp.dispute(2, 'dp_pgtap_pr31_2', 'needs_response');
select pg_temp.lost(2, 'dp_pgtap_pr31_2');
select lives_ok($$select pg_temp.decide(pg_temp.review(2, 'dp_pgtap_pr31_2'), 'no_fault', null, 'Stolen card.')$$,
  'no fault on P2');
select is(pg_temp.body('e1', 'Payment review complete', 2),
  'The review of the payment for "PR31 step 2" on PR31 request (TSC-931001) is done. Withdrawals stay paused while another payment is reviewed.',
  'A3: the order');
select lives_ok($$select pg_temp.decide(pg_temp.review(1, 'dp_pgtap_pr31_1'), 'factory_at_fault', 3250, 'The goods did not arrive.')$$,
  'factory at fault on P1, $32.50');
select is(pg_temp.body('e1', 'Payment review complete', 1),
  '$32.50 was taken from your balance for the brand''s refund of "PR31 step 1" on PR31 request (TSC-931001). Withdrawals stay paused while another payment is reviewed. Note from our team: The goods did not arrive.',
  'A4: what left its balance');
select is((select x ->> 'brand_stays_paused' from (select pg_temp.row_of(pg_temp.review(3, 'dp_pgtap_pr31_3a')) x) q), 'true',
  'A5: still paused by P3''s other dispute');

-- ===========================================================================
-- R3. Close a failed staff refund, $5.00 sent another way.
-- ===========================================================================
select set_config('tsc.r6', (pg_temp.staff_json($$select public.claim_staff_refund('c31f0006-0000-0000-0000-000000000001', 1070, null, 'Short delivery.')$$) ->> 'staff_refund_id'), true);
select pg_temp.as_server(format('select public.record_staff_refund(%L, ''re_pgtap_pr31_6'', ''succeeded'')', current_setting('tsc.r6')));
select pg_temp.as_server(format('select public.record_staff_refund_failed(%L, ''Stripe refused the refund.'')', current_setting('tsc.r6')));
select throws_ok($$select pg_temp.close(current_setting('tsc.r6')::uuid, 'Sent by bank.', 1071)$$,
  '22023', null, 'no more than the failed refund');
select throws_ok($$select pg_temp.close(current_setting('tsc.r6')::uuid, 'Sent by bank.', null)$$,
  '22023', null, 'the amount is asked');
select lives_ok($$select pg_temp.close(current_setting('tsc.r6')::uuid, 'Sent $5.00 by bank transfer.', 500)$$,
  'closed with $5.00 sent another way');
select is((select manual_refunded_cents::int from public.order_payments where id = pg_temp.pay(6)), 500, 'on the payment');
select is((select concat_ws(' | ', x ->> 'kind', x ->> 'amount_cents', x ->> 'note') from jsonb_array_elements(
             (select j from (select pg_temp.act_as('03')) a, lateral (select public.brand_payment_refunds('c31b0000-0000-0000-0000-0000000000b1') j) b)) x
            where x ->> 'payment_id' = 'c31f0006-0000-0000-0000-000000000001'),
  'manual | 500 | Sent $5.00 by bank transfer.', 'the brand reads it, by our team, with the note');
select is((select concat_ws(' | ', x ->> 'refunded_cents', x ->> 'refundable_cents')
             from (select pg_temp.staff_json($$select public.staff_refund_preview('c31f0006-0000-0000-0000-000000000001')$$) x) q),
  '500 | 10200', 'staff read it as refunded, and can refund only the rest');
select is((select close_refunded_cents::int from public.staff_refunds where id = current_setting('tsc.r6')::uuid), 500, 'the claim keeps the amount');
select is((select x ->> 'close_refunded_cents' from jsonb_array_elements(
             pg_temp.staff_json($$select public.staff_refund_preview('c31f0006-0000-0000-0000-000000000001')$$) -> 'staff_refunds') x
            where x ->> 'id' = current_setting('tsc.r6')), '500', 'and staff read it');

-- ===========================================================================
-- B2. What went back on funded payments, at the brand's figures.
-- ===========================================================================
select is((select concat_ws(' | ', refunded_charged_cents, reversed_charged_cents) from public.production_order_charges
            where order_id = 'c31d0000-0000-0000-0000-000000000001'),
  (select concat_ws(' | ', sum(refunded_cents + manual_refunded_cents), sum(dispute_lost_cents)) from public.order_payments
    where order_id = 'c31d0000-0000-0000-0000-000000000001' and state in ('confirmed', 'released')),
  'refunded (Stripe and another way) and reversed by the bank');
select is((select reversed_charged_cents::int from public.production_order_charges where order_id = 'c31d0000-0000-0000-0000-000000000001'),
  21400, 'two lost disputes of $107');

select * from finish();
rollback;
