-- Paused payments: old rows read like new ones (20261125100000, section 14).
--   (a) refunds recorded before payment_refund_lines become lines on the brand's Payments
--   (b) a payment a refund left as 'failed' reads Due, with no failure reason;
--       a lost dispute and a declined card stay failed
--
-- Fixtures: slugs pgtap-pr29-*, ids c29?xxxx-...; every count is scoped to them.
--   B1 (owner 03) -> F1 (owner 01), order TSC-929001, steps 1-7.
begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

set local session_replication_role = replica;

insert into auth.users (id, email)
select ('c29a0000-0000-0000-0000-0000000000' || k)::uuid, 'pgtap-pr29-' || k || '@example.com'
  from unnest(array['01','03']) k;
insert into public.orgs (id, type, name, slug) values
  ('c29b0000-0000-0000-0000-0000000000b1', 'brand', 'PR29 Brand One', 'pgtap-pr29-b1'),
  ('c29b0000-0000-0000-0000-0000000000e1', 'factory', 'PR29 Factory One', 'pgtap-pr29-f1');
insert into public.org_members (org_id, user_id, role, permissions) values
  ('c29b0000-0000-0000-0000-0000000000e1', 'c29a0000-0000-0000-0000-000000000001', 'owner', '{}'),
  ('c29b0000-0000-0000-0000-0000000000b1', 'c29a0000-0000-0000-0000-000000000003', 'owner', '{}');
insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total) values
  ('c29c0000-0000-0000-0000-000000000001', 'c29b0000-0000-0000-0000-0000000000b1', 'PR29 request', 'awarded', 'invited_only', 100);
insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity, submitted_at) values
  ('c29c1000-0000-0000-0000-000000000001', 'c29c0000-0000-0000-0000-000000000001', 'c29b0000-0000-0000-0000-0000000000e1', 'accepted', 100, 1, now());
insert into public.production_orders
  (id, rfq_id, quote_id, brand_org_id, factory_org_id, unit_price_cents, status, schedule_brand_agreed_at, schedule_brand_agreed_by,
   production_quantity, bulk_subtotal_cents, sample_subtotal_cents, order_total_cents, deposit_pct, balance_pct, order_number) values
  ('c29d0000-0000-0000-0000-000000000001', 'c29c0000-0000-0000-0000-000000000001', 'c29c1000-0000-0000-0000-000000000001',
   'c29b0000-0000-0000-0000-0000000000b1', 'c29b0000-0000-0000-0000-0000000000e1', 100000, 'active', now() - interval '60 days',
   'c29a0000-0000-0000-0000-000000000003', 1, 100000, 0, 100000, 50, 50, 'TSC-929001');
insert into public.order_milestones (id, order_id, kind, title, amount_cents, state, sort)
select ('c29e000' || n || '-0000-0000-0000-000000000001')::uuid, 'c29d0000-0000-0000-0000-000000000001', 'approval_and_payment',
       'PR29 step ' || n, 10000, 'active', 10 + n
  from generate_series(1, 7) n;

create function pg_temp.pay(n int) returns uuid language sql immutable as $f$
  select ('c29f000' || n || '-0000-0000-0000-000000000001')::uuid;
$f$;
create function pg_temp.step(n int) returns uuid language sql immutable as $f$
  select ('c29e000' || n || '-0000-0000-0000-000000000001')::uuid;
$f$;

-- 1: held, $10 refunded in Stripe's dashboard before the ledger (no line).
insert into public.order_payments
  (id, order_id, milestone_id, amount_cents, charged_cents, currency, state, confirmed_at, stripe_payment_intent_id, stripe_charge_id,
   refunded_cents, refund_amount_at, fee_bps) values
  (pg_temp.pay(1), 'c29d0000-0000-0000-0000-000000000001', pg_temp.step(1), 10000, 10700, 'USD', 'confirmed', now() - interval '5 days',
   'pi_pgtap_pr29_1', 'ch_pgtap_pr29_1', 1000, now() - interval '4 days', 700);
-- 2: refunded in full in Stripe before approval: left 'failed'.
-- 3: a lost dispute before approval: stays failed.
-- 4: a declined card: stays failed.
-- 5: refunded in full, the refund failed, funded again with the same charge.
-- 6: refunded in full by TSC (the amount changed): left 'failed'.
insert into public.order_payments (id, order_id, milestone_id, amount_cents, currency, state, failed_at, failure_reason, fee_bps)
select pg_temp.pay(n), 'c29d0000-0000-0000-0000-000000000001', pg_temp.step(n), 10000, 'USD', 'failed', now() - interval '3 days', r, 700
  from (values (2, 'The payment was refunded.'), (3, 'Dispute lost: the bank reversed the payment.'), (4, 'Your card was declined.'),
               (6, 'The step''s amount changed.')) v(n, r);
insert into public.order_payments
  (id, order_id, milestone_id, amount_cents, charged_cents, currency, state, confirmed_at, stripe_payment_intent_id, stripe_charge_id, fee_bps) values
  (pg_temp.pay(5), 'c29d0000-0000-0000-0000-000000000001', pg_temp.step(5), 10000, 10700, 'USD', 'confirmed', now() - interval '5 days',
   'pi_pgtap_pr29_5', 'ch_pgtap_pr29_5', 700);
-- 7: a cancelled order's payment, refunded in full (the record stays on it).
insert into public.order_payments
  (id, order_id, milestone_id, amount_cents, charged_cents, currency, state, confirmed_at, stripe_payment_intent_id, stripe_charge_id,
   refunded_at, fee_bps) values
  (pg_temp.pay(7), 'c29d0000-0000-0000-0000-000000000001', pg_temp.step(7), 10000, 10700, 'USD', 'cancelled', now() - interval '5 days',
   'pi_pgtap_pr29_7', 'ch_pgtap_pr29_7', now() - interval '2 days', 700);

insert into public.payment_events (payment_id, stripe_ref, from_state, to_state, actor_kind, note, cause, created_at) values
  (pg_temp.pay(2), 'pi_pgtap_pr29_2', 'confirmed', 'failed', 'system', 'The payment was refunded. (Stripe pi_pgtap_pr29_2)', 'stripe_refund', now() - interval '3 days'),
  (pg_temp.pay(3), 'pi_pgtap_pr29_3', 'confirmed', 'failed', 'system', 'Dispute lost: the bank reversed the payment. (Stripe pi_pgtap_pr29_3)', 'dispute_lost', now() - interval '3 days'),
  (pg_temp.pay(4), null, 'processing', 'failed', 'system', 'Your card was declined.', null, now() - interval '3 days'),
  (pg_temp.pay(5), 'pi_pgtap_pr29_5', 'confirmed', 'failed', 'system', 'The payment was refunded. (Stripe pi_pgtap_pr29_5)', 'stripe_refund', now() - interval '3 days'),
  (pg_temp.pay(5), 'pi_pgtap_pr29_5', 'failed', 'confirmed', 'system', 'The refund failed: funded again.', null, now() - interval '2 days'),
  -- Written before stripe_ref and cause: the note names the charge.
  (pg_temp.pay(6), null, 'confirmed', 'failed', 'system', 'The step''s amount changed. (Stripe pi_pgtap_pr29_6)', null, now() - interval '3 days'),
  -- Another charge refunded on a failed step: no change of state, not the step's own.
  (pg_temp.pay(4), 'pi_pgtap_pr29_4x', 'failed', 'failed', 'system', 'A payment that was not this step''s own was refunded: x (Stripe pi_pgtap_pr29_4x)', null, now() - interval '1 day');
set local session_replication_role = origin;

create function pg_temp.lines(n int) returns text language sql as $f$
  select coalesce(string_agg(concat_ws(':', kind, amount_cents, payment_intent), ', ' order by refunded_at, kind), '')
    from public.payment_refund_lines where payment_id = pg_temp.pay(n);
$f$;
create function pg_temp.charge(n int) returns bigint language sql as $f$
  select public.charge_cents(p) from public.order_payments p where p.id = pg_temp.pay(n);
$f$;

select ok(not has_function_privilege('authenticated', 'public.backfill_old_refunds()', 'execute'), 'the backfill: migration only');
select cmp_ok(pg_temp.charge(2), '>', 10000::bigint, 'a refunded step''s charge includes the fee');

select lives_ok($$select public.backfill_old_refunds()$$, 'runs');

-- (a)
select is(pg_temp.lines(1), 'stripe_dashboard:1000:pi_pgtap_pr29_1', 'a partial dashboard refund: its line');
select is(pg_temp.lines(2), 'stripe_dashboard:' || pg_temp.charge(2) || ':pi_pgtap_pr29_2', 'a full dashboard refund: the charge, from its event');
select is(pg_temp.lines(3), '', 'a lost dispute is not a refund line');
select is(pg_temp.lines(4), '', 'a declined card: none; another charge refunded on it: none');
select is(pg_temp.lines(5), '', 'a refund that failed and funded the step again: none');
select is(pg_temp.lines(6), 'automatic:' || pg_temp.charge(6) || ':pi_pgtap_pr29_6', 'TSC''s own refund, from an event older than its code');
select is(pg_temp.lines(7), 'cancellation:10700:pi_pgtap_pr29_7', 'a cancelled order''s refund');

-- (b)
select is((select concat_ws(' | ', state, coalesce(failure_reason, '-'), coalesce(failed_at::text, '-')) from public.order_payments where id = pg_temp.pay(2)),
  'due | - | -', 'refunded in Stripe: Due, no failure reason');
select is((select concat_ws(' | ', state, coalesce(failure_reason, '-')) from public.order_payments where id = pg_temp.pay(6)),
  'due | -', 'refunded by TSC: Due');
select is((select state::text from public.order_payments where id = pg_temp.pay(3)), 'failed', 'a lost dispute stays failed ("Reversed by your bank")');
select is((select concat_ws(' | ', state, failure_reason) from public.order_payments where id = pg_temp.pay(4)),
  'failed | Your card was declined.', 'a declined card stays failed, with its reason');
select is((select count(*)::int from public.payment_events where payment_id = pg_temp.pay(2) and from_state = 'failed' and to_state = 'due'), 1,
  'the move is recorded');

-- Again: nothing changes.
select lives_ok($$select public.backfill_old_refunds()$$, 'runs again');
select is((select count(*)::int from public.payment_refund_lines where order_id = 'c29d0000-0000-0000-0000-000000000001'), 4, 'no line twice');
select is((select count(*)::int from public.payment_events where payment_id in (pg_temp.pay(2), pg_temp.pay(6)) and to_state = 'due'), 2, 'no move twice');

-- The brand reads them.
select set_config('request.jwt.claims', json_build_object('sub', 'c29a0000-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from jsonb_array_elements(public.brand_payment_refunds('c29b0000-0000-0000-0000-0000000000b1'))), 4,
  'on the brand''s Payments');
reset role;

select * from finish();
rollback;
