-- One balance, stage 2 fix round 2 (20261120210000 range).
--
-- F1  a take is refused on a step a per-step Wise/PayPal payout is paying
--     (processing, or a failed one being paid again), whoever inserts it.
-- F3  a failed per-step attempt's recorded fee does not lower what the
--     factory can withdraw: the full step is Available.
-- F7  a Stripe withdrawal that ends refused (or its fee returned) gives back
--     the steps it still holds, whatever code ended it.
-- F4  money staff must look at reaches the board and the overview count: a
--     disputed owed step, and a one-balance Stripe withdrawal stuck half-way.
-- N1  the funded notice says the money is added to the balance on approval.
-- N3  "Add a withdrawal method…" only when the factory has no saved method.
-- Disputes: a dispute recorded closed before it was recorded open leaves the
--     step as the last answer says (the server re-reads Stripe; the database
--     never leaves a closed dispute holding the step).
--
-- Fixtures: slugs pgtap-uw2-*, ids cb2?xxxx-...; every count is scoped to them.
begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

update public.payout_provider_settings set enabled = true where provider in ('wise', 'paypal');

set local session_replication_role = replica;

-- 01..04 owners of h1..h4, 05 brand owner, 06 staff.
insert into auth.users (id, email)
select ('cb2a0000-0000-0000-0000-0000000000' || k)::uuid, 'pgtap-uw2-' || k || '@example.com'
  from unnest(array['01','02','03','04','05','06']) k;
insert into public.platform_admins (user_id, note) values ('cb2a0000-0000-0000-0000-000000000006', 'pgtap-uw2');

-- h1 PayPal, h2 Stripe, h3 an incomplete Wise method, h4 no method.
insert into public.orgs (id, type, name, slug) values
  ('cb2b0000-0000-0000-0000-00000000000b', 'brand', 'UW2 Brand', 'pgtap-uw2-brand');
insert into public.orgs (id, type, name, slug)
select ('cb2b0000-0000-0000-0000-0000000000e' || n)::uuid, 'factory', 'UW2 Factory ' || n, 'pgtap-uw2-factory-' || n
  from generate_series(1, 7) n;
insert into public.org_members (org_id, user_id, role, permissions)
select ('cb2b0000-0000-0000-0000-0000000000e' || n)::uuid, ('cb2a0000-0000-0000-0000-00000000000' || n)::uuid, 'owner', '{}'
  from generate_series(1, 4) n;
insert into public.org_members (org_id, user_id, role, permissions) values
  ('cb2b0000-0000-0000-0000-00000000000b', 'cb2a0000-0000-0000-0000-000000000005', 'owner', '{}');

insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total)
select ('cb2c0000-0000-0000-0000-00000000000' || n)::uuid, 'cb2b0000-0000-0000-0000-00000000000b', 'UW2 request ' || n, 'awarded', 'invited_only', 100
  from generate_series(1, 7) n;
insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity, submitted_at)
select ('cb2c1000-0000-0000-0000-00000000000' || n)::uuid, ('cb2c0000-0000-0000-0000-00000000000' || n)::uuid,
       ('cb2b0000-0000-0000-0000-0000000000e' || n)::uuid, 'accepted', 100, 1, now()
  from generate_series(1, 7) n;
insert into public.production_orders
  (id, rfq_id, quote_id, brand_org_id, factory_org_id, unit_price_cents, status, schedule_brand_agreed_at, schedule_brand_agreed_by,
   production_quantity, bulk_subtotal_cents, sample_subtotal_cents, order_total_cents, deposit_pct, balance_pct, order_number)
select ('cb2d0000-0000-0000-0000-00000000000' || n)::uuid, ('cb2c0000-0000-0000-0000-00000000000' || n)::uuid,
       ('cb2c1000-0000-0000-0000-00000000000' || n)::uuid, 'cb2b0000-0000-0000-0000-00000000000b',
       ('cb2b0000-0000-0000-0000-0000000000e' || n)::uuid, 1000000, 'active', now() - interval '60 days',
       'cb2a0000-0000-0000-0000-000000000005', 1, 1000000, 0, 1000000, 50, 50, 'UW2-' || n
  from generate_series(1, 7) n;

-- Steps: (n, s, amount, approved). Approved ones are owed and cleared.
create temp table uw2_steps (n int, s int, amount bigint, approved boolean) on commit drop;
insert into uw2_steps values
  (1, 1, 100000, true),  -- F3: a failed PayPal attempt that recorded a $20 fee
  (1, 2, 10000, true),   -- F1: a PayPal payout processing
  (1, 3, 10000, true),   -- F1: failed, then being paid again (processing)
  (1, 4, 10000, true),   -- disputes and F4
  (2, 1, 10000, true),   -- F7 / F4 stuck: the Stripe road
  (3, 1, 10000, false),  -- N3: approved below, incomplete method
  (4, 1, 10000, false),  -- N3: approved below, no method
  (4, 2, 10000, false),  -- N1: funded below
  (5, 1, 10000, false),  -- N3: Payoneer only
  (6, 1, 10000, false),  -- N3: PayPal switched off
  (7, 1, 10000, false);  -- N3: a Stripe account still verifying
insert into public.order_milestones (id, order_id, kind, title, amount_cents, state, sort, completed_at)
select ('cb2e000' || s || '-0000-0000-0000-00000000000' || n)::uuid, ('cb2d0000-0000-0000-0000-00000000000' || n)::uuid,
       'approval_and_payment', 'UW2 step ' || s, amount,
       case when approved then 'complete' else 'active' end::milestone_state, s * 10,
       case when approved then now() - make_interval(days => 10 - s) end
  from uw2_steps;
insert into public.order_payments
  (id, order_id, milestone_id, amount_cents, currency, state, confirmed_at, release_requested_at,
   stripe_payment_intent_id, stripe_charge_id, funds_available_at)
select ('cb2f000' || s || '-0000-0000-0000-00000000000' || n)::uuid, ('cb2d0000-0000-0000-0000-00000000000' || n)::uuid,
       ('cb2e000' || s || '-0000-0000-0000-00000000000' || n)::uuid, amount, 'USD', 'confirmed',
       now() - interval '30 days', case when approved then now() - make_interval(days => 10 - s) end,
       'pi_pgtap_uw2_' || n || '_' || s, 'ch_pgtap_uw2_' || n || '_' || s, now() - interval '20 days'
  from uw2_steps;
-- N1: h4's second step is due, not yet funded.
update public.order_payments set state = 'due', confirmed_at = null, stripe_charge_id = null, stripe_payment_intent_id = null, funds_available_at = null
 where id = 'cb2f0002-0000-0000-0000-000000000004';

insert into public.factory_payout_accounts (id, org_id, method, paypal_email, is_primary, details_changed_at) values
  ('cb290000-0000-0000-0000-000000000001', 'cb2b0000-0000-0000-0000-0000000000e1', 'paypal', 'pgtap-uw2-paypal@example.com', true, '2026-11-01');
-- h3: a Wise bank account never completed (no number saved).
insert into public.factory_payout_accounts
  (id, org_id, method, bank_name, account_name, account_number_last4, swift, bank_country, is_primary,
   wise_recipient_type, wise_currency, wise_number_key, wise_details, details_changed_at, number_changed_at)
values ('cb290000-0000-0000-0000-000000000003', 'cb2b0000-0000-0000-0000-0000000000e3', 'bank', 'UW2 Bank', null, null, 'BOSHCNSH', 'CN', true,
        'chinese_local_business', 'CNY', 'accountNumber', '{}', '2026-11-01', null);
insert into public.stripe_connect_accounts (org_id, stripe_account_id, country, transfers_active, payouts_enabled, details_submitted)
values ('cb2b0000-0000-0000-0000-0000000000e2', 'acct_pgtap_uw2_2', 'US', true, true, true);
insert into public.factory_payout_accounts (id, org_id, method, payoneer_email, is_primary, details_changed_at) values
  ('cb290000-0000-0000-0000-000000000005', 'cb2b0000-0000-0000-0000-0000000000e5', 'payoneer', 'pgtap-uw2-payoneer@example.com', true, '2026-11-01');
insert into public.factory_payout_accounts (id, org_id, method, paypal_email, is_primary, details_changed_at) values
  ('cb290000-0000-0000-0000-000000000006', 'cb2b0000-0000-0000-0000-0000000000e6', 'paypal', 'pgtap-uw2-off@example.com', true, '2026-11-01');
insert into public.stripe_connect_accounts (org_id, stripe_account_id, country, transfers_active, payouts_enabled, details_submitted)
values ('cb2b0000-0000-0000-0000-0000000000e7', 'acct_pgtap_uw2_7', 'US', false, false, false);

-- Legacy per-step attempts on h1.
update public.order_payments set payout_fee_cents = 2000 where id = 'cb2f0001-0000-0000-0000-000000000001';
insert into public.provider_payouts (id, payment_id, factory_org_id, account_id, provider, status, paid_to, amount_cents, currency, failure_code, created_at) values
  ('cb2a1000-0000-0000-0000-000000000011', 'cb2f0001-0000-0000-0000-000000000001', 'cb2b0000-0000-0000-0000-0000000000e1',
   'cb290000-0000-0000-0000-000000000001', 'paypal', 'processing', 'pgtap-uw2-paypal@example.com', 98000, 'USD', null, now() - interval '2 hours'),
  ('cb2a1000-0000-0000-0000-000000000012', 'cb2f0002-0000-0000-0000-000000000001', 'cb2b0000-0000-0000-0000-0000000000e1',
   'cb290000-0000-0000-0000-000000000001', 'paypal', 'processing', 'pgtap-uw2-paypal@example.com', 10000, 'USD', null, now() - interval '1 hour'),
  ('cb2a1000-0000-0000-0000-000000000013', 'cb2f0003-0000-0000-0000-000000000001', 'cb2b0000-0000-0000-0000-0000000000e1',
   'cb290000-0000-0000-0000-000000000001', 'paypal', 'failed', 'pgtap-uw2-paypal@example.com', 10000, 'USD', 'other', now() - interval '2 hours'),
  ('cb2a1000-0000-0000-0000-000000000014', 'cb2f0003-0000-0000-0000-000000000001', 'cb2b0000-0000-0000-0000-0000000000e1',
   'cb290000-0000-0000-0000-000000000001', 'paypal', 'processing', 'pgtap-uw2-paypal@example.com', 10000, 'USD', null, now() - interval '1 hour');

-- A pool withdrawal to hang direct inserts on, and Stripe withdrawal rows.
insert into public.factory_withdrawals (id, org_id, account_id, provider, status, amount_cents, currency, paid_to, pool_cents)
values ('cb2a2000-0000-0000-0000-000000000001', 'cb2b0000-0000-0000-0000-0000000000e1', 'cb290000-0000-0000-0000-000000000001',
        'paypal', 'requested', 100, 'USD', 'pgtap-uw2-paypal@example.com', 0);
insert into public.stripe_withdrawals (id, org_id, stripe_account_id, request_key, request_id, amount_minor, currency, usd_cents, state)
select ('cb280000-0000-0000-0000-00000000000' || k)::uuid, 'cb2b0000-0000-0000-0000-0000000000e2', 'acct_pgtap_uw2_2',
       'pgtap-uw2-sw-' || k, gen_random_uuid(), 100, 'USD', 100, 'claimed'
  from generate_series(1, 7) k;
set local session_replication_role = origin;

-- F3: the $1,000 step's PayPal attempt (its $20 fee recorded before PayPal was
-- asked) fails: nothing was sent.
update public.provider_payouts set status = 'failed', failure_code = 'other'
 where id = 'cb2a1000-0000-0000-0000-000000000011';

create function pg_temp.act_as(who text) returns void language sql as $f$
  select set_config('request.jwt.claims',
    json_build_object('sub', 'cb2a0000-0000-0000-0000-' || lpad(who, 12, '0'), 'role', 'authenticated')::text, true);
$f$;
create function pg_temp.org(n int) returns uuid language sql immutable as $f$
  select ('cb2b0000-0000-0000-0000-0000000000e' || n)::uuid;
$f$;
create function pg_temp.pay(n int, s int) returns uuid language sql immutable as $f$
  select ('cb2f000' || s || '-0000-0000-0000-00000000000' || n)::uuid;
$f$;
create function pg_temp.step(n int, s int) returns uuid language sql immutable as $f$
  select ('cb2e000' || s || '-0000-0000-0000-00000000000' || n)::uuid;
$f$;
create function pg_temp.sw(k int) returns uuid language sql immutable as $f$
  select ('cb280000-0000-0000-0000-00000000000' || k)::uuid;
$f$;
grant execute on function pg_temp.act_as(text), pg_temp.org(int), pg_temp.pay(int, int), pg_temp.step(int, int), pg_temp.sw(int)
  to authenticated, anon, service_role;

create function pg_temp.as_server(sql text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  set local role service_role;
  execute sql;
  reset role;
end;
$f$;
create function pg_temp.stripe_claim(n int, amount bigint, withdrawal uuid) returns jsonb language plpgsql as $f$
declare r jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  set local role service_role;
  r := public.claim_owed_steps(pg_temp.org(n), amount, 'stripe', withdrawal);
  reset role;
  return r;
end;
$f$;
create function pg_temp.fig(n int, p uuid) returns text language sql as $f$
  select string_agg(distinct r ->> 'figure', ',' order by r ->> 'figure')
    from jsonb_array_elements(public.factory_balance(pg_temp.org(n)) -> 'rows') r
   where (r ->> 'payment_id')::uuid = p;
$f$;
create function pg_temp.fig_cents(n int, p uuid, f text) returns bigint language sql as $f$
  select coalesce(sum((r ->> 'amount_cents')::bigint), 0)::bigint
    from jsonb_array_elements(public.factory_balance(pg_temp.org(n)) -> 'rows') r
   where (r ->> 'payment_id')::uuid = p and r ->> 'figure' = f;
$f$;
grant execute on function pg_temp.fig(int, uuid), pg_temp.fig_cents(int, uuid, text) to authenticated, service_role;
create function pg_temp.held(p uuid) returns bigint language sql as $f$
  select coalesce(sum(amount_cents), 0)::bigint from public.payment_takes where payment_id = p and status in ('held', 'sent');
$f$;
create function pg_temp.overview() returns int language plpgsql as $f$
declare c int;
begin
  perform pg_temp.act_as('06');
  set local role authenticated;
  select payments_awaiting_confirmation into c from public.admin_overview_metrics();
  reset role;
  return c;
end;
$f$;

-- ===========================================================================
-- F1. No take, from any writer, on a step a per-step payout is paying.
-- ===========================================================================
select throws_ok(format($$insert into public.payment_takes (payment_id, org_id, road, factory_withdrawal_id, amount_cents, status)
                          values (%L, %L, 'pool', 'cb2a2000-0000-0000-0000-000000000001', 100, 'held')$$, pg_temp.pay(1, 2), pg_temp.org(1)),
  '22023', null, 'F1: the database refuses a take on a step whose PayPal payout is processing');
select throws_ok(format($$insert into public.payment_takes (payment_id, org_id, road, factory_withdrawal_id, amount_cents, status)
                          values (%L, %L, 'pool', 'cb2a2000-0000-0000-0000-000000000001', 100, 'held')$$, pg_temp.pay(1, 3), pg_temp.org(1)),
  '22023', null, 'F1: and on a failed step staff are paying again');
select is(pg_temp.held(pg_temp.pay(1, 2)) + pg_temp.held(pg_temp.pay(1, 3)), 0::bigint, 'F1: nothing was taken from either');
select pg_temp.act_as('01'); set local role authenticated;
select is(pg_temp.fig(1, pg_temp.pay(1, 2)), 'processing', 'F1: a step being paid per step is Processing, not Available');
select is(pg_temp.fig(1, pg_temp.pay(1, 3)), 'processing', 'F1: so is a failed step being paid again');
reset role;
-- The claim itself (the race's other side, run here in order) leaves them alone.
select throws_ok($$
  select pg_temp.act_as('01'); set local role authenticated;
  select public.request_withdrawal(pg_temp.org(1), 100000 + 10000 + 1, 'cb290000-0000-0000-0000-000000000001');
$$, '22023', 'That is more than your balance.', 'F1: a withdrawal cannot reach steps being paid per step');
reset role;

-- ===========================================================================
-- F3. A failed attempt's recorded fee is not taken from the factory.
-- ===========================================================================
select pg_temp.act_as('01'); set local role authenticated;
select is(pg_temp.fig_cents(1, pg_temp.pay(1, 1), 'available'), 100000::bigint,
  'F3: after a failed PayPal attempt the whole $1,000 step is Available, not $980');
select is((public.my_withdrawal_balance(pg_temp.org(1)) ->> 'owed_cents')::bigint, 100000::bigint + 10000,
  'F3: and withdrawable in full (with the clean step)');
reset role;
select pg_temp.act_as('01'); set local role authenticated;
select lives_ok($$select public.request_withdrawal(pg_temp.org(1), 100000, 'cb290000-0000-0000-0000-000000000001')$$,
  'F3: the owner withdraws the whole $1,000');
reset role;
select is(pg_temp.held(pg_temp.pay(1, 1)), 100000::bigint, 'F3: the take is the whole step');

-- ===========================================================================
-- Disputes, and F4: disputed owed money is staff's to see.
-- ===========================================================================
select set_config('tsc.uw2_before', pg_temp.overview()::text, true);
select lives_ok(format($$select pg_temp.as_server(%L)$$, format('select public.record_payment_disputed(%L, false)', pg_temp.pay(1, 4))),
  'a dispute recorded closed before it was recorded open');
select ok((select disputed_at is null from public.order_payments where id = pg_temp.pay(1, 4)), 'leaves an undisputed step undisputed');
select lives_ok(format($$select pg_temp.as_server(%L)$$, format('select public.record_payment_disputed(%L, true)', pg_temp.pay(1, 4))),
  'the dispute is recorded open');
select pg_temp.act_as('01'); set local role authenticated;
select is(pg_temp.fig(1, pg_temp.pay(1, 4)), 'pending', 'a disputed owed step is Pending');
reset role;
select pg_temp.act_as('06'); set local role authenticated;
select ok(exists (select 1 from jsonb_array_elements(public.admin_balance_attention() -> 'disputed') d
                   where (d ->> 'payment_id')::uuid = pg_temp.pay(1, 4)),
  'F4: the disputed owed step is on the staff board');
reset role;
select pg_temp.act_as('01'); set local role authenticated;
select throws_ok($$select public.admin_balance_attention()$$, '42501', null, 'F4: the board stays staff only');
reset role;
select is(pg_temp.overview(), current_setting('tsc.uw2_before')::int + 1, 'F4: and counted on the overview');
select lives_ok(format($$select pg_temp.as_server(%L)$$, format('select public.record_payment_disputed(%L, false)', pg_temp.pay(1, 4))),
  'the dispute is won');
select ok((select disputed_at is null from public.order_payments where id = pg_temp.pay(1, 4)), 'the step is no longer disputed');
select pg_temp.act_as('01'); set local role authenticated;
select is(pg_temp.fig(1, pg_temp.pay(1, 4)), 'available', 'and Available again');
reset role;
select is(pg_temp.overview(), current_setting('tsc.uw2_before')::int, 'F4: and off the overview count');

-- ===========================================================================
-- F7. A Stripe withdrawal that ends with nothing sent gives its steps back,
--     whatever code ended it (an old deployment marks the row itself).
-- ===========================================================================
select lives_ok($$select pg_temp.stripe_claim(2, 4000, pg_temp.sw(1))$$, 'Stripe claims $40');
select is(pg_temp.held(pg_temp.pay(2, 1)), 4000::bigint, 'held');
select lives_ok($$select pg_temp.as_server(format('update public.stripe_withdrawals set state = %L, reason = %L where id = %L', 'refused', 'x', pg_temp.sw(1)))$$,
  'the row is marked refused directly');
select is(pg_temp.held(pg_temp.pay(2, 1)), 0::bigint, 'F7: its held takes are returned');
select lives_ok($$select pg_temp.stripe_claim(2, 3000, pg_temp.sw(2))$$, 'another Stripe withdrawal claims $30');
select lives_ok($$select pg_temp.as_server(format('update public.stripe_withdrawals set state = %L where id = %L', 'fee_returned', pg_temp.sw(2)))$$,
  'it ends with its fee returned before any transfer');
select is(pg_temp.held(pg_temp.pay(2, 1)), 0::bigint, 'F7: returned too');
-- A part already asked of Stripe (attempted) is not returned by the row
-- ending: the server must first confirm no transfer exists (F5).
-- A take already sent stays sent: that money is in the factory's Stripe account.
select lives_ok($$select pg_temp.stripe_claim(2, 2000, pg_temp.sw(3))$$, 'a third claims $20');
select lives_ok(format($$select pg_temp.as_server(%L)$$,
  (select format('select public.record_take_sent(%L, %L)', id, 'tr_pgtap_uw2') from public.payment_takes where stripe_withdrawal_id = pg_temp.sw(3))),
  'its transfer goes');
select lives_ok($$select pg_temp.as_server(format('update public.stripe_withdrawals set state = %L where id = %L', 'fee_returned', pg_temp.sw(3)))$$,
  'and then its payout fails');
select is((select status from public.payment_takes where stripe_withdrawal_id = pg_temp.sw(3)), 'sent', 'F7: a sent take stays sent');

-- F5: a part already asked of Stripe is not returned by the row ending.
select lives_ok($$select pg_temp.stripe_claim(2, 500, pg_temp.sw(5))$$, 'a fifth claims $5');
select lives_ok(format($$select pg_temp.as_server(%L)$$,
  (select format('select public.mark_take_attempted(%L)', id) from public.payment_takes where stripe_withdrawal_id = pg_temp.sw(5))),
  'its transfer is asked for, and the answer is lost');
select lives_ok($$select pg_temp.as_server(format('update public.stripe_withdrawals set state = %L, reason = %L where id = %L', 'refused', 'x', pg_temp.sw(5)))$$,
  'an old server marks the row refused');
select is((select status from public.payment_takes where stripe_withdrawal_id = pg_temp.sw(5)), 'held',
  'F5: an attempted part stays held: it may have been transferred');
select lives_ok(format($$select pg_temp.as_server(%L)$$, format('select public.return_stripe_takes(%L)', pg_temp.sw(5))),
  'return_stripe_takes on it');
select is((select status from public.payment_takes where stripe_withdrawal_id = pg_temp.sw(5)), 'held', 'F5: still held');
select lives_ok(format($$select pg_temp.as_server(%L)$$,
  (select format('select public.return_take(%L)', id) from public.payment_takes where stripe_withdrawal_id = pg_temp.sw(5))),
  'the server confirmed no transfer exists: return_take');
select is((select status from public.payment_takes where stripe_withdrawal_id = pg_temp.sw(5)), 'returned', 'F5: now it is back in the balance');
-- R3-1: only the call holding the withdrawal's live lease hands a part back.
select lives_ok($$select pg_temp.stripe_claim(2, 300, pg_temp.sw(7))$$, 'a seventh claims $3');
select lives_ok(format($$select pg_temp.as_server(%L)$$,
  (select format('select public.mark_take_attempted(%L)', id) from public.payment_takes where stripe_withdrawal_id = pg_temp.sw(7))),
  'its transfer is asked for');
set local session_replication_role = replica;
update public.stripe_withdrawals set lease_until = '2999-01-01 00:00:00+00' where id = pg_temp.sw(7);
set local session_replication_role = origin;
select throws_ok(format($$select pg_temp.as_server(%L)$$,
  (select format('select public.return_take(%L)', id) from public.payment_takes where stripe_withdrawal_id = pg_temp.sw(7))),
  '22023', null, 'R3-1: return_take is refused while another call holds the withdrawal');
select throws_ok(format($$select pg_temp.as_server(%L)$$,
  (select format('select public.return_take_leased(%L, %L)', id, '2000-01-01 00:00:00+00') from public.payment_takes where stripe_withdrawal_id = pg_temp.sw(7))),
  '22023', null, 'R3-1: and return_take_leased with someone else''s lease');
select is((select status from public.payment_takes where stripe_withdrawal_id = pg_temp.sw(7)), 'held', 'R3-1: the part stays held');
select is(public.lease_stripe_withdrawal(pg_temp.sw(7)), null::public.stripe_withdrawals,
  'R3-1: and nobody else can take the lease while it is live');
select lives_ok(format($$select pg_temp.as_server(%L)$$,
  (select format('select public.return_take_leased(%L, %L)', id, '2999-01-01 00:00:00+00') from public.payment_takes where stripe_withdrawal_id = pg_temp.sw(7))),
  'R3-1: the call holding the lease returns it');
select is((select status from public.payment_takes where stripe_withdrawal_id = pg_temp.sw(7)), 'returned', 'R3-1: returned');
select ok(not has_function_privilege('authenticated', 'public.return_take_leased(uuid, timestamptz)', 'execute')
      and not has_function_privilege('authenticated', 'public.lease_stripe_withdrawal(uuid)', 'execute')
      and not has_function_privilege('anon', 'public.return_take_leased(uuid, timestamptz)', 'execute')
      and not has_function_privilege('anon', 'public.lease_stripe_withdrawal(uuid)', 'execute'), 'R3-1: both are the server''s');
select ok(not has_function_privilege('authenticated', 'public.mark_take_attempted(uuid)', 'execute')
      and not has_function_privilege('anon', 'public.mark_take_attempted(uuid)', 'execute'), 'mark_take_attempted is the server''s');

-- F4: a one-balance Stripe withdrawal stuck half-way is staff's to see.
select set_config('tsc.uw2_before', pg_temp.overview()::text, true);
select lives_ok($$select pg_temp.stripe_claim(2, 1000, pg_temp.sw(4))$$, 'a fourth claims $10, and its call dies');
set local session_replication_role = replica;
update public.stripe_withdrawals set created_at = now() - interval '1 hour', updated_at = now() - interval '1 hour',
       lease_until = now() - interval '58 minutes' where id = pg_temp.sw(4);
set local session_replication_role = origin;
select is(pg_temp.overview(), current_setting('tsc.uw2_before')::int + 1, 'F4: a withdrawal stuck for an hour is counted for staff');
select pg_temp.act_as('06'); set local role authenticated;
select ok(exists (select 1 from jsonb_array_elements(public.admin_balance_attention() -> 'stuck') x
                   where (x ->> 'withdrawal_id')::uuid = pg_temp.sw(4) and (x ->> 'held_cents')::bigint = 1000),
  'F4: and listed on the board with what it holds');
reset role;

-- F4: a Stripe withdrawal refused because TSC's Stripe balance was short is
-- staff's to see (refusal_cause = 'platform_short').
set local session_replication_role = replica;
update public.stripe_withdrawals set state = 'refused', reason = 'x', refusal_cause = 'platform_short' where id = pg_temp.sw(6);
set local session_replication_role = origin;
select pg_temp.act_as('06'); set local role authenticated;
select ok(exists (select 1 from jsonb_array_elements(public.admin_balance_attention() -> 'stuck') x
                   where (x ->> 'withdrawal_id')::uuid = pg_temp.sw(6) and x ->> 'refusal_cause' = 'platform_short'),
  'F4: a withdrawal refused for a short platform balance is on the staff board');
reset role;

-- ===========================================================================
-- F2 (database side). A PayPal withdrawal whose step is found disputed before
-- it is paid: staff cannot approve it; declining returns its parts.
-- ===========================================================================
select set_config('tsc.uw2_f2', (select (public.request_withdrawal(pg_temp.org(1), 10000, 'cb290000-0000-0000-0000-000000000001')).id::text
  from (select pg_temp.act_as('01')) a), true);
reset role;
select is((select string_agg(distinct payment_id::text, ',') from public.payment_takes
            where factory_withdrawal_id = current_setting('tsc.uw2_f2')::uuid and status = 'held'), pg_temp.pay(1, 4)::text,
  'F2: the withdrawal holds the clean step');
select lives_ok(format($$select pg_temp.as_server(%L)$$, format('select public.record_payment_disputed(%L, true)', pg_temp.pay(1, 4))),
  'the server finds the brand''s charge disputed before paying');
select throws_ok($$
  select pg_temp.act_as('06'); set local role authenticated;
  select public.claim_withdrawal(current_setting('tsc.uw2_f2')::uuid);
$$, '22023', null, 'F2: staff cannot approve it');
reset role;
select pg_temp.act_as('06'); set local role authenticated;
select lives_ok($$select public.decline_withdrawal(current_setting('tsc.uw2_f2')::uuid, 'The brand disputed this payment.')$$, 'F2: staff decline it');
reset role;
select is((select string_agg(distinct status, ',') from public.payment_takes where factory_withdrawal_id = current_setting('tsc.uw2_f2')::uuid),
  'returned', 'F2: declining returns its parts');
select lives_ok(format($$select pg_temp.as_server(%L)$$, format('select public.record_payment_disputed(%L, false)', pg_temp.pay(1, 4))),
  'the dispute is won');

-- ===========================================================================
-- N3 / N1. Notification words.
-- ===========================================================================
create function pg_temp.approve(n int, s int) returns void language plpgsql as $f$
begin
  perform pg_temp.act_as('05');
  set local role authenticated;
  perform public.approve_milestone(pg_temp.step(n, s), null);
  reset role;
end;
$f$;
create function pg_temp.note(n int, k text, subject uuid) returns text language sql as $f$
  select coalesce(title, '') || ' | ' || coalesce(body, '') from public.notifications
   where org_id = pg_temp.org(n) and kind = k and subject_id = subject order by created_at desc limit 1;
$f$;
select pg_temp.approve(3, 1);
select pg_temp.approve(4, 1);
select ok(pg_temp.note(3, 'milestone_approved', pg_temp.step(3, 1)) like '%$100.00 added to your balance%', 'N3: incomplete method: added to your balance');
select ok(pg_temp.note(3, 'milestone_approved', pg_temp.step(3, 1)) not like '%Add a withdrawal method%',
  'N3: a factory with a saved (incomplete) method is not asked to add one');
select ok(pg_temp.note(4, 'milestone_approved', pg_temp.step(4, 1)) like '%Add a withdrawal method to receive earnings.%',
  'N3: a factory with no saved method is');
select pg_temp.approve(5, 1);
select ok(pg_temp.note(5, 'milestone_approved', pg_temp.step(5, 1)) like '%Add a withdrawal method to receive earnings.%',
  'N3: Payoneer only (no longer a way to withdraw): asked to add a method');
update public.payout_provider_settings set enabled = false where provider = 'paypal';
select pg_temp.approve(6, 1);
update public.payout_provider_settings set enabled = true where provider = 'paypal';
select ok(pg_temp.note(6, 'milestone_approved', pg_temp.step(6, 1)) not like '%Add a withdrawal method%',
  'N3: a saved PayPal switched off for now: not asked to add a method');
select pg_temp.approve(7, 1);
select ok(pg_temp.note(7, 'milestone_approved', pg_temp.step(7, 1)) like '%added to your balance%'
      and pg_temp.note(7, 'milestone_approved', pg_temp.step(7, 1)) not like '%Add a withdrawal method%',
  'N3: a Stripe account still verifying: not asked to add a method');

select lives_ok(format($$select pg_temp.as_server(%L)$$,
  format('select public.record_payment_funded(%L, %L, %L, %L, %s)', pg_temp.pay(4, 2), 'ch_pgtap_uw2_4_2', 'card', 'Visa ···4242', 10000)),
  'the brand funds the next step');
select ok((select string_agg(coalesce(body, ''), ' ') from public.notifications where org_id = pg_temp.org(4)
            and created_at = now() and body like '%TSC holds%') like '%added to your balance when the brand approves it%',
  'N1: the funded notice says it is added to the balance when the brand approves it');
select ok((select count(*) = 0 from public.notifications where org_id = pg_temp.org(4) and body like '%paid to you when the brand approves%'),
  'N1: never "paid to you when the brand approves it"');

select * from finish();
rollback;
