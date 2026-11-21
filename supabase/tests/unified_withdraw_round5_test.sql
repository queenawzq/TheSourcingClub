-- One balance, fix round 5 (20261120240000): the local tester's findings.
--
-- One answer for owner and member: factory_balance() takes Stripe's payout fee
-- out of Paid out and Total, as it does PayPal's and Wise's; members read
-- their company's Stripe withdrawals and still cannot withdraw. A disputed
-- step is held: never Available, never given a clearing date, and the factory
-- is told when it is put on hold and when the hold is lifted. PayPal / Wise
-- "paid out to you" says what arrived.
--
-- Fixtures: slugs pgtap-r5-*, ids cc5?xxxx-...; every count is scoped to them.
begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

update public.payout_provider_settings set enabled = case
    when provider = 'paypal' and region in ('china', 'elsewhere') then true else false end;

set local session_replication_role = replica;

-- 01 owner of k1, 02 member of k1, 03 owner of k2, 04 staff, 05 brand owner.
insert into auth.users (id, email)
select ('cc5a0000-0000-0000-0000-0000000000' || k)::uuid, 'pgtap-r5-' || k || '@example.com'
  from unnest(array['01','02','03','04','05']) k;
insert into public.platform_admins (user_id, note) values ('cc5a0000-0000-0000-0000-000000000004', 'pgtap-r5');
insert into public.orgs (id, type, name, slug) values
  ('cc5b0000-0000-0000-0000-00000000000b', 'brand', 'R5 Brand', 'pgtap-r5-brand'),
  ('cc5b0000-0000-0000-0000-0000000000e1', 'factory', 'R5 Factory', 'pgtap-r5-factory'),
  ('cc5b0000-0000-0000-0000-0000000000e2', 'factory', 'R5 Other', 'pgtap-r5-other');
insert into public.org_members (org_id, user_id, role, permissions) values
  ('cc5b0000-0000-0000-0000-0000000000e1', 'cc5a0000-0000-0000-0000-000000000001', 'owner', '{}'),
  ('cc5b0000-0000-0000-0000-0000000000e1', 'cc5a0000-0000-0000-0000-000000000002', 'member', '{}'),
  ('cc5b0000-0000-0000-0000-0000000000e2', 'cc5a0000-0000-0000-0000-000000000003', 'owner', '{}'),
  ('cc5b0000-0000-0000-0000-00000000000b', 'cc5a0000-0000-0000-0000-000000000005', 'owner', '{}');

insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total) values
  ('cc5c0000-0000-0000-0000-000000000001', 'cc5b0000-0000-0000-0000-00000000000b', 'R5 request', 'awarded', 'invited_only', 100);
insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity, submitted_at) values
  ('cc5c1000-0000-0000-0000-000000000001', 'cc5c0000-0000-0000-0000-000000000001', 'cc5b0000-0000-0000-0000-0000000000e1', 'accepted', 100, 1, now());
insert into public.production_orders
  (id, rfq_id, quote_id, brand_org_id, factory_org_id, unit_price_cents, status, schedule_brand_agreed_at, schedule_brand_agreed_by,
   production_quantity, bulk_subtotal_cents, sample_subtotal_cents, order_total_cents, deposit_pct, balance_pct, order_number)
values ('cc5d0000-0000-0000-0000-000000000001', 'cc5c0000-0000-0000-0000-000000000001', 'cc5c1000-0000-0000-0000-000000000001',
        'cc5b0000-0000-0000-0000-00000000000b', 'cc5b0000-0000-0000-0000-0000000000e1', 100000, 'active', now() - interval '60 days',
        'cc5a0000-0000-0000-0000-000000000005', 1, 100000, 0, 100000, 50, 50, 'R5-1');

-- s1 $100 owed, cleared (Stripe takes part of it); s2 $50 owed, still clearing
-- (to be disputed); s3 $20 funded, not approved (disputed: nobody told);
-- s4 $80 owed, cleared (PayPal).
create temp table r5_steps (s int, amount bigint, approved boolean, clears interval) on commit drop;
insert into r5_steps values (1, 10000, true, '-20 days'), (2, 5000, true, '2 days'), (3, 2000, false, '-20 days'), (4, 8000, true, '-20 days');
insert into public.order_milestones (id, order_id, kind, title, amount_cents, state, sort, completed_at)
select ('cc5e000' || s || '-0000-0000-0000-000000000001')::uuid, 'cc5d0000-0000-0000-0000-000000000001',
       'approval_and_payment', 'R5 step ' || s, amount, case when approved then 'complete' else 'active' end::milestone_state, s * 10,
       case when approved then now() - make_interval(days => 10 - s) end
  from r5_steps;
insert into public.order_payments
  (id, order_id, milestone_id, amount_cents, currency, state, confirmed_at, release_requested_at,
   stripe_payment_intent_id, stripe_charge_id, funds_available_at)
select ('cc5f000' || s || '-0000-0000-0000-000000000001')::uuid, 'cc5d0000-0000-0000-0000-000000000001',
       ('cc5e000' || s || '-0000-0000-0000-000000000001')::uuid, amount, 'USD', 'confirmed', now() - interval '30 days',
       case when approved then now() - make_interval(days => 10 - s) end,
       'pi_pgtap_r5_' || s, 'ch_pgtap_r5_' || s, now() + clears
  from r5_steps;

insert into public.stripe_connect_accounts (org_id, stripe_account_id, country, transfers_active, payouts_enabled, details_submitted)
values ('cc5b0000-0000-0000-0000-0000000000e1', 'acct_pgtap_r5', 'US', true, true, true),
       ('cc5b0000-0000-0000-0000-0000000000e2', 'acct_pgtap_r5_2', 'US', true, true, true);
insert into public.factory_payout_accounts (id, org_id, method, paypal_email, is_primary, details_changed_at) values
  ('cc590000-0000-0000-0000-000000000001', 'cc5b0000-0000-0000-0000-0000000000e1', 'paypal', 'pgtap-r5@example.com', false, '2026-11-01');
insert into public.stripe_withdrawals (id, org_id, stripe_account_id, request_key, request_id, amount_minor, currency, usd_cents, state)
values ('cc580000-0000-0000-0000-000000000001', 'cc5b0000-0000-0000-0000-0000000000e1', 'acct_pgtap_r5', 'pgtap-r5-sw-1', gen_random_uuid(), 1000, 'USD', 1000, 'claimed'),
       ('cc580000-0000-0000-0000-000000000002', 'cc5b0000-0000-0000-0000-0000000000e1', 'acct_pgtap_r5', 'pgtap-r5-sw-2', gen_random_uuid(), 500, 'USD', 500, 'claimed'),
       ('cc580000-0000-0000-0000-000000000003', 'cc5b0000-0000-0000-0000-0000000000e2', 'acct_pgtap_r5_2', 'pgtap-r5-sw-3', gen_random_uuid(), 100, 'USD', 100, 'paid_out');
set local session_replication_role = origin;

create function pg_temp.act_as(who text) returns void language sql as $f$
  select set_config('request.jwt.claims',
    json_build_object('sub', 'cc5a0000-0000-0000-0000-' || lpad(who, 12, '0'), 'role', 'authenticated')::text, true);
$f$;
create function pg_temp.pay(s int) returns uuid language sql immutable as $f$
  select ('cc5f000' || s || '-0000-0000-0000-000000000001')::uuid;
$f$;
create function pg_temp.step(s int) returns uuid language sql immutable as $f$
  select ('cc5e000' || s || '-0000-0000-0000-000000000001')::uuid;
$f$;
grant execute on function pg_temp.act_as(text), pg_temp.pay(int), pg_temp.step(int) to authenticated, anon, service_role;
create function pg_temp.as_server(sql text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  set local role service_role;
  execute sql;
  reset role;
end;
$f$;
-- The one balance as a given person reads it.
create function pg_temp.bal_as(who text) returns jsonb language plpgsql as $f$
declare j jsonb;
begin
  perform pg_temp.act_as(who);
  set local role authenticated;
  j := public.factory_balance('cc5b0000-0000-0000-0000-0000000000e1');
  reset role;
  return j;
end;
$f$;
create function pg_temp.sum4(j jsonb) returns bigint language sql as $f$
  select (j ->> 'awaiting_cents')::bigint + (j ->> 'available_cents')::bigint + (j ->> 'pending_cents')::bigint + (j ->> 'processing_cents')::bigint + (j ->> 'paid_out_cents')::bigint;
$f$;
create function pg_temp.notes(k text, subject uuid) returns text language sql as $f$
  select string_agg(title || ' | ' || body, ' || ' order by created_at, title like 'Hold lifted%') from public.notifications
   where org_id = 'cc5b0000-0000-0000-0000-0000000000e1' and kind = k and subject_id = subject;
$f$;

-- ===========================================================================
-- 1. Stripe's payout fee is in no figure, for owner and member alike.
-- ===========================================================================
select set_config('tsc.r5_total0', (pg_temp.bal_as('01') ->> 'total_cents'), true);
select lives_ok($$select pg_temp.as_server('select public.claim_owed_steps(''cc5b0000-0000-0000-0000-0000000000e1'', 1000, ''stripe'', ''cc580000-0000-0000-0000-000000000001'')')$$,
  'a $10 Stripe withdrawal claims $10');
select lives_ok(format($$select pg_temp.as_server(%L)$$,
  (select format('select public.record_take_sent(%L, %L)', id, 'tr_pgtap_r5_1') from public.payment_takes where stripe_withdrawal_id = 'cc580000-0000-0000-0000-000000000001')),
  'its transfer goes');
select lives_ok($$select pg_temp.as_server('update public.stripe_withdrawals set state = ''paid_out'', fee_cents = 33, fee_local_minor = 33, payout_minor = 967, payout_id = ''po_pgtap_r5'', payout_status = ''in_transit'', payout_arrives_on = current_date + 2 where id = ''cc580000-0000-0000-0000-000000000001''')$$,
  'Stripe takes its 33c fee and pays out $9.67, arriving in two days');
-- Fix round 8: on its way until its arrival day: Pending, at the US dollars it
-- took from the balance less the fee; the total does not move.
select is((pg_temp.bal_as('01') -> 'parts' ->> 'stripe_on_way_cents')::bigint, 967::bigint, 'on its way: $9.67 in parts.stripe_on_way_cents');
select is((pg_temp.bal_as('01') ->> 'paid_out_cents')::bigint, 0::bigint, 'and not yet Paid out');
select is((pg_temp.bal_as('01') ->> 'total_cents')::bigint, current_setting('tsc.r5_total0')::bigint - 33, 'Total drops by the fee only');
select is((select w ->> 'word' from jsonb_array_elements(pg_temp.bal_as('01') -> 'withdrawals') w where w ->> 'id' = 'cc580000-0000-0000-0000-000000000001'),
  'on_its_way', 'the withdrawal reads On its way');
select is((select (w ->> 'amount_cents')::bigint from jsonb_array_elements(pg_temp.bal_as('01') -> 'withdrawals') w where w ->> 'id' = 'cc580000-0000-0000-0000-000000000001'),
  967::bigint, 'for the US dollars that left, net of the fee');
select lives_ok($$select pg_temp.as_server('update public.stripe_withdrawals set payout_status = ''paid'', payout_arrives_on = current_date - 1 where id = ''cc580000-0000-0000-0000-000000000001''')$$,
  'the payout arrives');
select is((select w ->> 'word' from jsonb_array_elements(pg_temp.bal_as('01') -> 'withdrawals') w where w ->> 'id' = 'cc580000-0000-0000-0000-000000000001'),
  'paid', 'the withdrawal reads Paid');
select is((pg_temp.bal_as('01') -> 'parts' ->> 'stripe_on_way_cents')::bigint, 0::bigint, 'nothing on its way any more');
select is((pg_temp.bal_as('01') -> 'parts' ->> 'stripe_withdrawal_fees_cents')::bigint, 33::bigint, 'the fee is counted once, in parts');
select is((pg_temp.bal_as('01') ->> 'paid_out_cents')::bigint, 967::bigint, 'Paid out is what left for the bank: $9.67');
select is((pg_temp.bal_as('01') ->> 'total_cents')::bigint, current_setting('tsc.r5_total0')::bigint - 33,
  'Total drops by the fee only');
select is((pg_temp.bal_as('01') ->> 'total_cents')::bigint, pg_temp.sum4(pg_temp.bal_as('01')), 'Total is the sum of the four');
select is(pg_temp.bal_as('02'), pg_temp.bal_as('01'), 'owner and member read exactly the same balance');
-- A fee given back (the payout failed) is in no withdrawal fee.
select lives_ok($$select pg_temp.as_server('select public.claim_owed_steps(''cc5b0000-0000-0000-0000-0000000000e1'', 500, ''stripe'', ''cc580000-0000-0000-0000-000000000002'')')$$,
  'a second, $5 Stripe withdrawal');
select lives_ok(format($$select pg_temp.as_server(%L)$$,
  (select format('select public.record_take_sent(%L, %L)', id, 'tr_pgtap_r5_2') from public.payment_takes where stripe_withdrawal_id = 'cc580000-0000-0000-0000-000000000002')),
  'its transfer goes');
select lives_ok($$select pg_temp.as_server('update public.stripe_withdrawals set state = ''fee_returned'', fee_cents = 33 where id = ''cc580000-0000-0000-0000-000000000002''')$$,
  'its payout fails and the fee goes back');
select is((pg_temp.bal_as('01') -> 'parts' ->> 'stripe_withdrawal_fees_cents')::bigint, 33::bigint, 'a returned fee is not counted');
select is(pg_temp.bal_as('02'), pg_temp.bal_as('01'), 'owner and member still agree');

-- ===========================================================================
-- 2. Members read their company's Stripe withdrawals, not others'; they still
--    cannot withdraw.
-- ===========================================================================
select pg_temp.act_as('02'); set local role authenticated;
select is((select count(*)::int from public.stripe_withdrawals where org_id = 'cc5b0000-0000-0000-0000-0000000000e1'), 2,
  'a member reads its company''s Stripe withdrawals');
select is((select payout_status from public.stripe_withdrawals where id = 'cc580000-0000-0000-0000-000000000001'), 'paid',
  'with where the payout is');
select is((select count(*)::int from public.stripe_withdrawals where org_id = 'cc5b0000-0000-0000-0000-0000000000e2'), 0,
  'and not another company''s');
select throws_ok($$select public.request_withdrawal('cc5b0000-0000-0000-0000-0000000000e1', 100, 'cc590000-0000-0000-0000-000000000001')$$,
  '42501', null, 'a member still cannot withdraw');
select throws_ok($$update public.stripe_withdrawals set state = 'refused' where id = 'cc580000-0000-0000-0000-000000000001'$$,
  '42501', null, 'nor change a withdrawal');
reset role;
select pg_temp.act_as('03'); set local role authenticated;
select is((select count(*)::int from public.stripe_withdrawals where org_id = 'cc5b0000-0000-0000-0000-0000000000e1'), 0,
  'another factory''s owner reads none of them');
reset role;
select pg_temp.act_as('05'); set local role authenticated;
select is((select count(*)::int from public.stripe_withdrawals where org_id = 'cc5b0000-0000-0000-0000-0000000000e1'), 0, 'nor does the brand');
reset role;

-- ===========================================================================
-- 3. A disputed step is held: never Available, never given a clearing date.
--    The factory is told, once, and told again when the hold is lifted.
-- ===========================================================================
select ok((pg_temp.bal_as('01') ->> 'next_cleared_at') is not null, 'before the dispute, the clearing step gives a clearing date');
select lives_ok(format($$select pg_temp.as_server(%L)$$, format('select public.record_payment_disputed(%L, true)', pg_temp.pay(2))),
  'the brand disputes the clearing step''s charge');
select is((select string_agg(distinct r ->> 'figure', ',') from jsonb_array_elements(pg_temp.bal_as('01') -> 'rows') r
            where (r ->> 'payment_id')::uuid = pg_temp.pay(2)), 'pending', 'a disputed step is Pending');
select ok((select bool_and((r ->> 'held')::boolean) and bool_and(r ->> 'held_reason' = 'disputed') and bool_and(not (r ? 'clears_at') or r ->> 'clears_at' is null)
             from jsonb_array_elements(pg_temp.bal_as('01') -> 'rows') r where (r ->> 'payment_id')::uuid = pg_temp.pay(2)),
  'held, because disputed, with no clearing date on its row');
select is(pg_temp.bal_as('01') ->> 'next_cleared_at', null, 'and no clearing date for the balance: it is not becoming available');
select is((pg_temp.bal_as('01') -> 'parts' ->> 'disputed_cents')::bigint, 5000::bigint, 'counted as disputed');
select is((pg_temp.bal_as('01') ->> 'total_cents')::bigint, pg_temp.sum4(pg_temp.bal_as('01')), 'Total is still the sum of the four');
select is(pg_temp.notes('payment_disputed', pg_temp.pay(2)),
  'Payment for "R5 step 2" on hold | The brand disputed the charge. $50.00 is held until the dispute is settled.',
  'the factory is told, in the approved words');
select lives_ok(format($$select pg_temp.as_server(%L)$$, format('select public.record_payment_disputed(%L, true)', pg_temp.pay(2))),
  'the same dispute recorded again');
select is((select count(*)::int from public.notifications where kind = 'payment_disputed' and subject_id = pg_temp.pay(2)), 1, 'is not told twice');
select lives_ok(format($$select pg_temp.as_server(%L)$$, format('select public.record_payment_disputed(%L, false)', pg_temp.pay(2))),
  'TSC wins the dispute');
select is(pg_temp.notes('payment_disputed', pg_temp.pay(2)),
  'Payment for "R5 step 2" on hold | The brand disputed the charge. $50.00 is held until the dispute is settled. || Hold lifted on "R5 step 2" | The dispute is settled. $50.00 is no longer on hold.',
  'and told the hold is lifted');
select ok((pg_temp.bal_as('01') ->> 'next_cleared_at') is not null, 'the step clears again on its date');
select lives_ok(format($$select pg_temp.as_server(%L)$$, format('select public.record_payment_disputed(%L, true)', pg_temp.pay(3))),
  'a step not yet approved is disputed');
select is((select count(*)::int from public.notifications where kind = 'payment_disputed' and subject_id = pg_temp.pay(3)), 0,
  'the factory is not told of money it was never told was its own');

-- ===========================================================================
-- 4. PayPal "paid out to you" says what arrived.
-- ===========================================================================
select set_config('tsc.r5_w', (select (public.request_withdrawal('cc5b0000-0000-0000-0000-0000000000e1', 3050, 'cc590000-0000-0000-0000-000000000001')).id::text
  from (select pg_temp.act_as('01')) a), true);
reset role;
select lives_ok(format($$select pg_temp.as_server(%L)$$,
  format('select public.record_withdrawal(%L, ''paid'', ''PP-R5'', 60, 2990, ''USD'', null)', current_setting('tsc.r5_w'))),
  'PayPal pays $30.50 less its 60c fee');
select is((select title from public.notifications where kind = 'funds_released' and subject_id = current_setting('tsc.r5_w')::uuid),
  '$29.90 paid out to you', 'the notice says what arrived, $29.90, not the $30.50 asked');
select ok((select body from public.notifications where kind = 'funds_released' and subject_id = current_setting('tsc.r5_w')::uuid) like '%you receive $29.90%',
  'and its body names the fee and what arrives');
select is((pg_temp.bal_as('02') ->> 'total_cents')::bigint, pg_temp.sum4(pg_temp.bal_as('02')), 'the member''s Total is still the sum of the four');
select is(pg_temp.bal_as('02'), pg_temp.bal_as('01'), 'and still the owner''s');

select * from finish();
rollback;
