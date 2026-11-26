-- Paused payments, tester fixes (20261125100000, T1).
--   #1 a staff refund that fails after it was made is a Review needed row, counted, closed with a note
--   #2 a full refund of a held step still says what went back
--   #3 an inquiry changes nothing for the two companies' notices
--   #4 no "funded" notice on a charge disputed at funding; those sent a moment before are withdrawn
--   #5 the brand reads its own refunds, one line each
--   #7 paused brands: the most pressing reason first, and how many more
--
-- Fixtures: slugs pgtap-pr28-*, ids c28?xxxx-...; every count is scoped to them.
--   F1 (owner 01) <- B1 (owner 03), order TSC-928001: P1 held $100 ($107), P2/P3/P4 due $100
--   (each with an intent), P5 held $100 ($107). Staff: 02. Another company: F2 (owner 04).
begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

set local session_replication_role = replica;

insert into auth.users (id, email)
select ('c28a0000-0000-0000-0000-0000000000' || k)::uuid, 'pgtap-pr28-' || k || '@example.com'
  from unnest(array['01','02','03','04']) k;
insert into public.platform_admins (user_id, note) values ('c28a0000-0000-0000-0000-000000000002', 'pgtap-pr28');
insert into public.orgs (id, type, name, slug) values
  ('c28b0000-0000-0000-0000-0000000000b1', 'brand', 'PR28 Brand One', 'pgtap-pr28-b1'),
  ('c28b0000-0000-0000-0000-0000000000e1', 'factory', 'PR28 Factory One', 'pgtap-pr28-f1'),
  ('c28b0000-0000-0000-0000-0000000000e2', 'factory', 'PR28 Factory Two', 'pgtap-pr28-f2');
insert into public.org_members (org_id, user_id, role, permissions) values
  ('c28b0000-0000-0000-0000-0000000000e1', 'c28a0000-0000-0000-0000-000000000001', 'owner', '{}'),
  ('c28b0000-0000-0000-0000-0000000000b1', 'c28a0000-0000-0000-0000-000000000003', 'owner', '{}'),
  ('c28b0000-0000-0000-0000-0000000000e2', 'c28a0000-0000-0000-0000-000000000004', 'owner', '{}');
insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total) values
  ('c28c0000-0000-0000-0000-000000000001', 'c28b0000-0000-0000-0000-0000000000b1', 'PR28 request', 'awarded', 'invited_only', 100);
insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity, submitted_at) values
  ('c28c1000-0000-0000-0000-000000000001', 'c28c0000-0000-0000-0000-000000000001', 'c28b0000-0000-0000-0000-0000000000e1', 'accepted', 100, 1, now());
insert into public.production_orders
  (id, rfq_id, quote_id, brand_org_id, factory_org_id, unit_price_cents, status, schedule_brand_agreed_at, schedule_brand_agreed_by,
   production_quantity, bulk_subtotal_cents, sample_subtotal_cents, order_total_cents, deposit_pct, balance_pct, order_number) values
  ('c28d0000-0000-0000-0000-000000000001', 'c28c0000-0000-0000-0000-000000000001', 'c28c1000-0000-0000-0000-000000000001',
   'c28b0000-0000-0000-0000-0000000000b1', 'c28b0000-0000-0000-0000-0000000000e1', 100000, 'active', now() - interval '60 days',
   'c28a0000-0000-0000-0000-000000000003', 1, 100000, 0, 100000, 50, 50, 'TSC-928001');
insert into public.order_milestones (id, order_id, kind, title, amount_cents, state, sort) values
  ('c28e0001-0000-0000-0000-000000000001', 'c28d0000-0000-0000-0000-000000000001', 'approval_and_payment', 'PR28 fit sample', 10000, 'active', 10),
  ('c28e0002-0000-0000-0000-000000000001', 'c28d0000-0000-0000-0000-000000000001', 'approval_and_payment', 'PR28 lab dip', 10000, 'active', 11),
  ('c28e0003-0000-0000-0000-000000000001', 'c28d0000-0000-0000-0000-000000000001', 'approval_and_payment', 'PR28 trims', 10000, 'active', 12),
  ('c28e0004-0000-0000-0000-000000000001', 'c28d0000-0000-0000-0000-000000000001', 'approval_and_payment', 'PR28 bulk', 10000, 'active', 13),
  ('c28e0005-0000-0000-0000-000000000001', 'c28d0000-0000-0000-0000-000000000001', 'approval_and_payment', 'PR28 labels', 10000, 'active', 14);
insert into public.order_payments
  (id, order_id, milestone_id, amount_cents, charged_cents, currency, state, confirmed_at, stripe_payment_intent_id, stripe_charge_id, funds_available_at) values
  ('c28f0001-0000-0000-0000-000000000001', 'c28d0000-0000-0000-0000-000000000001', 'c28e0001-0000-0000-0000-000000000001', 10000, 10700, 'USD', 'confirmed',
   now() - interval '5 days', 'pi_pgtap_pr28_1', 'ch_pgtap_pr28_1', now() - interval '2 days'),
  ('c28f0005-0000-0000-0000-000000000001', 'c28d0000-0000-0000-0000-000000000001', 'c28e0005-0000-0000-0000-000000000001', 10000, 10700, 'USD', 'confirmed',
   now() - interval '5 days', 'pi_pgtap_pr28_5', 'ch_pgtap_pr28_5', now() - interval '2 days');
insert into public.order_payments (id, order_id, milestone_id, amount_cents, charged_cents, currency, state, stripe_payment_intent_id) values
  ('c28f0002-0000-0000-0000-000000000001', 'c28d0000-0000-0000-0000-000000000001', 'c28e0002-0000-0000-0000-000000000001', 10000, 10700, 'USD', 'due', 'pi_pgtap_pr28_2'),
  ('c28f0003-0000-0000-0000-000000000001', 'c28d0000-0000-0000-0000-000000000001', 'c28e0003-0000-0000-0000-000000000001', 10000, 10700, 'USD', 'due', 'pi_pgtap_pr28_3'),
  ('c28f0004-0000-0000-0000-000000000001', 'c28d0000-0000-0000-0000-000000000001', 'c28e0004-0000-0000-0000-000000000001', 10000, 10700, 'USD', 'due', 'pi_pgtap_pr28_4');
set local session_replication_role = origin;

create function pg_temp.act_as(who text) returns void language sql as $f$
  select set_config('request.jwt.claims',
    json_build_object('sub', 'c28a0000-0000-0000-0000-' || lpad(who, 12, '0'), 'role', 'authenticated')::text, true);
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
  select ('c28f000' || n || '-0000-0000-0000-000000000001')::uuid;
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
create function pg_temp.close(r uuid, note text) returns void language plpgsql as $f$
begin
  perform pg_temp.act_as('02');
  set local role authenticated;
  perform public.close_staff_refund_failure(r, note, 0);
  reset role;
end;
$f$;
create function pg_temp.told(org_code text, t text) returns int language sql as $f$
  select count(*)::int from public.notifications
   where org_id = ('c28b0000-0000-0000-0000-0000000000' || org_code)::uuid and title like t
     and order_id = 'c28d0000-0000-0000-0000-000000000001';
$f$;
create function pg_temp.fund(n int) returns void language plpgsql as $f$
begin
  perform pg_temp.as_server(format('select public.record_payment_funded(%L, %L, ''card'', ''Visa'', 10700)', pg_temp.pay(n), 'ch_pgtap_pr28_' || n));
end;
$f$;

-- ===========================================================================
-- 0. Negatives first.
-- ===========================================================================
select pg_temp.act_as('01');
set local role authenticated;
select throws_ok($$select public.close_staff_refund_failure(gen_random_uuid(), 'x', 0)$$, '42501', null, 'a factory cannot close a staff refund');
select throws_ok($$select public.brand_payment_refunds('c28b0000-0000-0000-0000-0000000000b1')$$, '42501', null, 'nor read the brand''s refunds');
reset role;
select pg_temp.act_as('04');
set local role authenticated;
select throws_ok($$select public.brand_payment_refunds('c28b0000-0000-0000-0000-0000000000b1')$$, '42501', null, 'another company cannot either');
reset role;
select ok(not has_function_privilege('authenticated', 'public.staff_refund_board_rows()', 'execute'), 'the board''s refund rows: server only');
select ok(not has_function_privilege('authenticated', 'public.withdraw_funded_notices(uuid)', 'execute'), 'withdrawing notices: internal');
select ok(not has_function_privilege('authenticated', 'public.payment_has_chargeback(uuid)', 'execute'), 'internal helper');

-- ===========================================================================
-- #1. A staff refund that fails after it was made.
-- ===========================================================================
create temp table t1_before on commit drop as
  select (pg_temp.staff_json($$select to_jsonb((select payments_awaiting_confirmation from public.admin_overview_metrics()))$$))::int as n;
select set_config('tsc.r1', (pg_temp.staff_json($$select public.claim_staff_refund('c28f0001-0000-0000-0000-000000000001', 1070, null, 'Short delivery.')$$) ->> 'staff_refund_id'), true);
select lives_ok($$select pg_temp.as_server(format('select public.record_staff_refund(%L, ''re_pgtap_pr28_1'', ''succeeded'')', current_setting('tsc.r1')))$$, 'made');
select is((select count(*)::int from jsonb_array_elements(pg_temp.staff_json($$select public.payment_review_board()$$)) x
            where x ->> 'id' = current_setting('tsc.r1')), 0, 'a refund made is not a row');
select lives_ok($$select pg_temp.as_server(format('select public.record_staff_refund_failed(%L, ''Stripe refused the refund: the card was closed. Nothing was refunded, and the factory''''s balance is unchanged.'')', current_setting('tsc.r1')))$$,
  'Stripe fails it later');
create temp table r1row on commit drop as
  select x from jsonb_array_elements(pg_temp.staff_json($$select public.payment_review_board()$$)) x where x ->> 'id' = current_setting('tsc.r1');
select is((select concat_ws(' | ', x ->> 'kind', x ->> 'step', x ->> 'step_line', x ->> 'flag', x ->> 'open', (x -> 'actions')::text, x ->> 'amount_cents', x ->> 'order_number') from r1row),
  'staff_refund | 2 | Refund failed | Refund failed | true | ["refund_again", "close"] | 1070 | TSC-928001', 'its own row on Review needed, with Refund again and Close');
select ok((select x ->> 'failure' like 'Stripe refused the refund: the card was closed.%' from r1row), 'with Stripe''s reason in words');
select is((pg_temp.staff_json($$select to_jsonb((select payments_awaiting_confirmation from public.admin_overview_metrics()))$$))::int, (select n from t1_before) + 1,
  'counted on the overview');
select throws_ok($$select pg_temp.close(current_setting('tsc.r1')::uuid, '  ')$$,
  '22023', 'add a note', 'closing needs a note');
select lives_ok($$select pg_temp.close(current_setting('tsc.r1')::uuid, 'Refunded by bank transfer.')$$,
  'staff close it: refunded another way');
select is((select concat_ws(' | ', x ->> 'step', x ->> 'step_line', x ->> 'open') from jsonb_array_elements(pg_temp.staff_json($$select public.payment_review_board()$$)) x
            where x ->> 'id' = current_setting('tsc.r1')), '3 | Refund failed · closed | false', 'done, not counted');
select is((pg_temp.staff_json($$select to_jsonb((select payments_awaiting_confirmation from public.admin_overview_metrics()))$$))::int, (select n from t1_before),
  'off the overview');
select throws_ok($$select pg_temp.close(current_setting('tsc.r1')::uuid, 'again')$$,
  '22023', 'this refund isn''t waiting on staff', 'closed once');

-- ===========================================================================
-- #2 and #5. A full refund of a held step; the brand's own refund lines.
-- ===========================================================================
select set_config('tsc.r2', (pg_temp.staff_json($$select public.claim_staff_refund('c28f0005-0000-0000-0000-000000000001', 10700, null, 'Labels cancelled.')$$) ->> 'staff_refund_id'), true);
select lives_ok($$select pg_temp.as_server(format('select public.record_staff_refund(%L, ''re_pgtap_pr28_5'', ''succeeded'')', current_setting('tsc.r2')))$$, 'all of the labels refunded');
select ok((select state = 'due' and refunded_at is not null and failure_reason is null from public.order_payments where id = pg_temp.pay(5)),
  'the step waits for a payment again (Due, never Failed), marked as refunded (refunded_at)');
select is((pg_temp.staff_json($$select public.admin_order_payments('928001')$$) -> 'payments' -> 4 ->> 'refunded_cents'), '10700',
  'staff still read what went back: $107.00');
select pg_temp.act_as('03');
set local role authenticated;
select is((select string_agg(x ->> 'amount_cents', ',' order by x ->> 'amount_cents') from jsonb_array_elements(public.brand_payment_refunds('c28b0000-0000-0000-0000-0000000000b1')) x),
  '10700', 'the brand reads its refund made, one line (the one that failed is not a refund)');
reset role;

-- ===========================================================================
-- #3. An inquiry at funding: normal notices.
-- ===========================================================================
select lives_ok($$select pg_temp.as_server('select public.record_payment_review_dispute(''c28f0002-0000-0000-0000-000000000001'', ''dp_pgtap_pr28_2'', ''warning_needs_response'', 10700, now() + interval ''7 days'', null)')$$,
  'an inquiry on the lab dip''s charge');
select lives_ok($$select pg_temp.as_server('select public.record_payment_disputed(''c28f0002-0000-0000-0000-000000000001'', true)')$$, 'its step on hold');
select lives_ok($$select pg_temp.fund(2)$$, 'funded');
select is(pg_temp.told('e1', 'Payment for "PR28 lab dip" disputed'), 0, 'the factory hears nothing of an inquiry');
select is(pg_temp.told('e1', 'Payment held for "PR28 lab dip"'), 1, 'but that the money is held, as usual');
select is(pg_temp.told('b1', 'Your payment for "PR28 lab dip" is funded'), 1, 'and the brand that it is funded');

-- ===========================================================================
-- #4. A chargeback at funding, and one a moment after.
-- ===========================================================================
select lives_ok($$select pg_temp.as_server('select public.record_payment_review_dispute(''c28f0003-0000-0000-0000-000000000001'', ''dp_pgtap_pr28_3'', ''needs_response'', 10700, now() + interval ''7 days'', 1500)')$$,
  'a chargeback on the trims'' charge');
select lives_ok($$select pg_temp.fund(3)$$, 'recorded as funded');
select is(pg_temp.told('b1', 'Your payment for "PR28 trims" is funded'), 0, 'the brand is not told it is funded');
select is(pg_temp.told('e1', 'Payment held for "PR28 trims"'), 0, 'nor the factory that it is held');
select is(pg_temp.told('e1', 'Payment for "PR28 trims" disputed'), 1, 'the factory is told it is under review');
select lives_ok($$select pg_temp.fund(4)$$, 'the bulk funded');
select is(pg_temp.told('b1', 'Your payment for "PR28 bulk" is funded'), 1, 'told funded');
select lives_ok($$select pg_temp.as_server('select public.record_payment_review_dispute(''c28f0004-0000-0000-0000-000000000001'', ''dp_pgtap_pr28_4'', ''needs_response'', 10700, now() + interval ''7 days'', 1500)')$$,
  'a chargeback a moment later');
select is(pg_temp.told('b1', 'Your payment for "PR28 bulk" is funded'), 0, 'that unread "funded" is withdrawn');
select is(pg_temp.told('e1', 'Payment held for "PR28 bulk"'), 0, 'and the factory''s "held"');
select is(pg_temp.told('b1', 'Account under review'), 2, 'the brand is told its account is under review (two chargebacks)');
select pg_temp.act_as('01');
set local role authenticated;
select is((select string_agg(x #>> '{}', ',' order by x #>> '{}') from jsonb_array_elements(public.order_pause('c28d0000-0000-0000-0000-000000000001') -> 'disputed_payment_ids') x),
  'c28f0003-0000-0000-0000-000000000001,c28f0004-0000-0000-0000-000000000001', 'the order page knows which steps read Disputed (not the inquiry''s)');
reset role;

-- ===========================================================================
-- #7. Paused brands: the most pressing reason first, and how many more.
-- ===========================================================================
select lives_ok($$select pg_temp.as_server('select public.record_payment_review_dispute(''c28f0003-0000-0000-0000-000000000001'', ''dp_pgtap_pr28_3'', ''won'', 10700, null, 1500)')$$,
  'the bank rules for TSC on the trims');
select is((select concat_ws(' · ', b ->> 'reason', b ->> 'order_number', '+' || (b ->> 'more')) from jsonb_array_elements(pg_temp.staff_json($$select public.admin_paused_brands()$$)) b
            where b ->> 'org_id' = 'c28b0000-0000-0000-0000-0000000000b1'), 'Bank ruling pending · TSC-928001 · +1',
  'the bank still deciding comes first, with one more');

-- ===========================================================================
-- Rulings after T1: an inquiry leaves the payment as it was; refund lines by kind.
-- ===========================================================================
create temp table before_inq on commit drop as
  select state, disputed_at, release_requested_at, failure_reason, refunded_cents from public.order_payments where id = pg_temp.pay(1);
select lives_ok($$select pg_temp.as_server('select public.record_payment_review_dispute(''c28f0001-0000-0000-0000-000000000001'', ''dp_pgtap_pr28_1i'', ''warning_needs_response'', 10700, now() + interval ''6 days'', null)')$$,
  'an inquiry on the fit sample''s charge');
select ok((select p.state = b.state and p.disputed_at is not distinct from b.disputed_at and p.release_requested_at is not distinct from b.release_requested_at
                  and p.failure_reason is not distinct from b.failure_reason and p.refunded_cents = b.refunded_cents
             from public.order_payments p, before_inq b where p.id = pg_temp.pay(1)),
  'the payment''s fields the two companies read are untouched (only a chargeback sets disputed_at)');
select lives_ok($$select pg_temp.as_server('select public.record_payment_refund_amount(''c28f0002-0000-0000-0000-000000000001'', ''pi_pgtap_pr28_2'', 1070)')$$,
  'a $10.70 refund of the lab dip in Stripe''s dashboard');
select pg_temp.act_as('03');
set local role authenticated;
select is((select string_agg((x ->> 'kind') || ' ' || (x ->> 'amount_cents') || ' ' || coalesce(x ->> 'note', '-'), ', ' order by x ->> 'kind')
             from jsonb_array_elements(public.brand_payment_refunds('c28b0000-0000-0000-0000-0000000000b1')) x),
  'staff 10700 Labels cancelled., stripe_dashboard 1070 -',
  'one line per refund that went through, with its kind; the failed one has none; a reset payment''s refund stays');
select ok(not exists (select 1 from jsonb_array_elements(public.brand_payment_refunds('c28b0000-0000-0000-0000-0000000000b1')) x
                        where x ? 'factory_cents' or x ? 'factory_share'), 'nothing about the factory''s share');
reset role;

select * from finish();
rollback;
