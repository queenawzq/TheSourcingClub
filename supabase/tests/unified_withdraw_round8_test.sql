-- One balance, fix round 8 (20261120270000): the card's figures are the
-- server's. factory_balance().withdrawals lists every withdrawal once with its
-- word (waiting, on_hold, on_its_way, paid, returned), and the lines under
-- the balance (waiting, on hold, on its way) add up to Pending when nothing
-- else is pending.
--
-- Fixtures: slugs pgtap-r8-*, ids ce8?xxxx-...; every count is scoped to them.
begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

update public.payout_provider_settings set enabled = case
    when provider = 'paypal' and region in ('china', 'elsewhere') then true else false end;

set local session_replication_role = replica;

insert into auth.users (id, email)
select ('ce8a0000-0000-0000-0000-0000000000' || k)::uuid, 'pgtap-r8-' || k || '@example.com' from unnest(array['01','02','03']) k;
insert into public.platform_admins (user_id, note) values ('ce8a0000-0000-0000-0000-000000000002', 'pgtap-r8');
insert into public.orgs (id, type, name, slug) values
  ('ce8b0000-0000-0000-0000-00000000000b', 'brand', 'R8 Brand', 'pgtap-r8-brand'),
  ('ce8b0000-0000-0000-0000-0000000000e1', 'factory', 'R8 Factory', 'pgtap-r8-factory');
insert into public.org_members (org_id, user_id, role, permissions) values
  ('ce8b0000-0000-0000-0000-0000000000e1', 'ce8a0000-0000-0000-0000-000000000001', 'owner', '{}'),
  ('ce8b0000-0000-0000-0000-00000000000b', 'ce8a0000-0000-0000-0000-000000000003', 'owner', '{}');
insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total) values
  ('ce8c0000-0000-0000-0000-000000000001', 'ce8b0000-0000-0000-0000-00000000000b', 'R8 request', 'awarded', 'invited_only', 100);
insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity, submitted_at) values
  ('ce8c1000-0000-0000-0000-000000000001', 'ce8c0000-0000-0000-0000-000000000001', 'ce8b0000-0000-0000-0000-0000000000e1', 'accepted', 100, 1, now());
insert into public.production_orders
  (id, rfq_id, quote_id, brand_org_id, factory_org_id, unit_price_cents, status, schedule_brand_agreed_at, schedule_brand_agreed_by,
   production_quantity, bulk_subtotal_cents, sample_subtotal_cents, order_total_cents, deposit_pct, balance_pct, order_number)
values ('ce8d0000-0000-0000-0000-000000000001', 'ce8c0000-0000-0000-0000-000000000001', 'ce8c1000-0000-0000-0000-000000000001',
        'ce8b0000-0000-0000-0000-00000000000b', 'ce8b0000-0000-0000-0000-0000000000e1', 100000, 'active', now() - interval '60 days',
        'ce8a0000-0000-0000-0000-000000000003', 1, 100000, 0, 100000, 50, 50, 'R8-1');
-- Five owed, cleared steps (oldest first): $100, $45, $10, $20, $30, $40.
create temp table r8_steps (s int, amount bigint) on commit drop;
insert into r8_steps values (1, 10000), (2, 4500), (3, 1000), (4, 2000), (5, 3000), (6, 4000);
insert into public.order_milestones (id, order_id, kind, title, amount_cents, state, sort, completed_at)
select ('ce8e000' || s || '-0000-0000-0000-000000000001')::uuid, 'ce8d0000-0000-0000-0000-000000000001',
       'approval_and_payment', 'R8 step ' || s, amount, 'complete', s * 10, now() - make_interval(days => 10 - s)
  from r8_steps;
insert into public.order_payments
  (id, order_id, milestone_id, amount_cents, currency, state, confirmed_at, release_requested_at,
   stripe_payment_intent_id, stripe_charge_id, funds_available_at)
select ('ce8f000' || s || '-0000-0000-0000-000000000001')::uuid, 'ce8d0000-0000-0000-0000-000000000001',
       ('ce8e000' || s || '-0000-0000-0000-000000000001')::uuid, amount, 'USD', 'confirmed', now() - interval '30 days',
       now() - make_interval(days => 10 - s), 'pi_pgtap_r8_' || s, 'ch_pgtap_r8_' || s, now() - interval '20 days'
  from r8_steps;
insert into public.factory_payout_accounts (id, org_id, method, paypal_email, is_primary, details_changed_at) values
  ('ce890000-0000-0000-0000-000000000001', 'ce8b0000-0000-0000-0000-0000000000e1', 'paypal', 'pgtap-r8@example.com', true, '2026-11-01');
insert into public.stripe_connect_accounts (org_id, stripe_account_id, country, transfers_active, payouts_enabled, details_submitted)
values ('ce8b0000-0000-0000-0000-0000000000e1', 'acct_pgtap_r8', 'US', true, true, true);
insert into public.stripe_withdrawals (id, org_id, stripe_account_id, request_key, request_id, amount_minor, currency, usd_cents, state)
select ('ce880000-0000-0000-0000-00000000000' || k)::uuid, 'ce8b0000-0000-0000-0000-0000000000e1', 'acct_pgtap_r8',
       'pgtap-r8-sw-' || k, gen_random_uuid(), 100, 'USD', 100, 'claimed' from generate_series(1, 3) k;
set local session_replication_role = origin;

create function pg_temp.act_as(who text) returns void language sql as $f$
  select set_config('request.jwt.claims',
    json_build_object('sub', 'ce8a0000-0000-0000-0000-' || lpad(who, 12, '0'), 'role', 'authenticated')::text, true);
$f$;
create function pg_temp.pay(s int) returns uuid language sql immutable as $f$
  select ('ce8f000' || s || '-0000-0000-0000-000000000001')::uuid;
$f$;
grant execute on function pg_temp.act_as(text), pg_temp.pay(int) to authenticated, service_role;
create function pg_temp.as_server(sql text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  set local role service_role;
  execute sql;
  reset role;
end;
$f$;
create function pg_temp.bal() returns jsonb language plpgsql as $f$
declare j jsonb;
begin
  perform pg_temp.act_as('01');
  set local role authenticated;
  j := public.factory_balance('ce8b0000-0000-0000-0000-0000000000e1');
  reset role;
  return j;
end;
$f$;
create function pg_temp.ask(amount bigint) returns uuid language plpgsql as $f$
declare w uuid;
begin
  perform pg_temp.act_as('01');
  set local role authenticated;
  select (public.request_withdrawal('ce8b0000-0000-0000-0000-0000000000e1', amount, 'ce890000-0000-0000-0000-000000000001')).id into w;
  reset role;
  return w;
end;
$f$;
create function pg_temp.word(w uuid) returns text language sql as $f$
  select string_agg(x ->> 'word', ',') from jsonb_array_elements(pg_temp.bal() -> 'withdrawals') x where (x ->> 'id')::uuid = w;
$f$;
create function pg_temp.stripe_paid(k int, amount bigint, status text, arrives date) returns void language plpgsql as $f$
declare sw uuid := ('ce880000-0000-0000-0000-00000000000' || k)::uuid;
begin
  perform pg_temp.as_server(format('select public.claim_owed_steps(%L, %s, ''stripe'', %L)', 'ce8b0000-0000-0000-0000-0000000000e1', amount, sw));
  perform pg_temp.as_server((select string_agg(format('select public.record_take_sent(%L, %L);', id, 'tr_pgtap_r8_' || k), ' ')
                               from public.payment_takes where stripe_withdrawal_id = sw));
  perform pg_temp.as_server(format('update public.stripe_withdrawals set state = ''paid_out'', usd_cents = %s, amount_minor = %s, fee_cents = 50, fee_local_minor = 50, payout_minor = %s, payout_id = %L, payout_status = %L, payout_arrives_on = %L where id = %L',
    amount, amount, amount - 50, 'po_pgtap_r8_' || k, status, arrives, sw));
end;
$f$;

-- PayPal: waiting ($100, step 1), on hold ($45, step 2, refunded below),
-- on its way ($10, step 3, staff paying), paid ($20, step 4), returned
-- (a cancelled $5 request).
select set_config('tsc.r8_wait', pg_temp.ask(10000)::text, true);
select set_config('tsc.r8_hold', pg_temp.ask(4500)::text, true);
select set_config('tsc.r8_way', pg_temp.ask(1000)::text, true);
select set_config('tsc.r8_paid', pg_temp.ask(2000)::text, true);
select set_config('tsc.r8_back', pg_temp.ask(500)::text, true);
select lives_ok(format($$select pg_temp.as_server(%L)$$,
  format('select public.record_payment_refunded(%L, %L, %L)', pg_temp.pay(2), 'pi_pgtap_r8_2', 'The payment was refunded.')),
  'step 2, held by the $45 request, is refunded');
select pg_temp.act_as('02'); set local role authenticated;
select lives_ok($$select public.claim_withdrawal(current_setting('tsc.r8_way')::uuid)$$, 'staff start paying the $10 request');
reset role;
select lives_ok(format($$select pg_temp.as_server(%L)$$,
  format('select public.record_withdrawal(%L, ''paid'', ''PP-R8'', 40, 1960, ''USD'', null)', current_setting('tsc.r8_paid'))),
  'the $20 request is paid');
select pg_temp.act_as('01'); set local role authenticated;
select lives_ok($$select public.cancel_withdrawal(current_setting('tsc.r8_back')::uuid)$$, 'the $5 request is cancelled');
reset role;

select is(pg_temp.word(current_setting('tsc.r8_wait')::uuid), 'waiting', 'a requested, covered PayPal withdrawal: waiting');
select is(pg_temp.word(current_setting('tsc.r8_hold')::uuid), 'on_hold', 'one whose step was refunded: on hold');
select is(pg_temp.word(current_setting('tsc.r8_way')::uuid), 'on_its_way', 'one staff are paying: on its way');
select is(pg_temp.word(current_setting('tsc.r8_paid')::uuid), 'paid', 'a paid one: paid');
select is(pg_temp.word(current_setting('tsc.r8_back')::uuid), 'returned', 'a cancelled one: returned');

-- The lines under the balance add up to Pending (nothing else is pending here:
-- every step cleared, none disputed, no Stripe money on its way yet).
select is((pg_temp.bal() ->> 'pending_cents')::bigint,
  (select sum((x ->> 'amount_cents')::bigint) from jsonb_array_elements(pg_temp.bal() -> 'withdrawals') x
    where x ->> 'word' in ('waiting', 'on_hold', 'on_its_way'))::bigint,
  'waiting + on hold + on its way = Pending, to the cent');
select is((pg_temp.bal() ->> 'pending_cents')::bigint, (10000 + 4500 + 1000)::bigint, 'that is $100 + $45 + $10');

-- Stripe: on its way before its arrival day, paid after, returned when refused
-- or its payout failed.
select pg_temp.stripe_paid(1, 3000, 'in_transit', current_date + 2);
select pg_temp.stripe_paid(2, 2000, 'paid', current_date - 1);
select lives_ok($$select pg_temp.as_server('update public.stripe_withdrawals set state = ''refused'', reason = ''x'' where id = ''ce880000-0000-0000-0000-000000000003''')$$,
  'a third Stripe withdrawal is refused');
select is(pg_temp.word('ce880000-0000-0000-0000-000000000001'), 'on_its_way', 'Stripe, before its arrival day: on its way');
select is(pg_temp.word('ce880000-0000-0000-0000-000000000002'), 'paid', 'Stripe, arrived: paid');
select is(pg_temp.word('ce880000-0000-0000-0000-000000000003'), 'returned', 'Stripe, refused: returned');
select is((select (x ->> 'amount_cents')::bigint from jsonb_array_elements(pg_temp.bal() -> 'withdrawals') x where x ->> 'id' = 'ce880000-0000-0000-0000-000000000001'),
  2950::bigint, 'a Stripe withdrawal''s amount is the US dollars that left, net of the fee');
select is((pg_temp.bal() ->> 'pending_cents')::bigint,
  (select sum((x ->> 'amount_cents')::bigint) from jsonb_array_elements(pg_temp.bal() -> 'withdrawals') x
    where x ->> 'word' in ('waiting', 'on_hold', 'on_its_way'))::bigint,
  'with Stripe on its way too, the lines still add up to Pending');
select is((pg_temp.bal() -> 'parts' ->> 'stripe_on_way_cents')::bigint, 2950::bigint, 'the Stripe part on its way is in parts');
select is((pg_temp.bal() ->> 'total_cents')::bigint,
  (pg_temp.bal() ->> 'awaiting_cents')::bigint + (pg_temp.bal() ->> 'available_cents')::bigint
  + (pg_temp.bal() ->> 'pending_cents')::bigint + (pg_temp.bal() ->> 'paid_out_cents')::bigint, 'Total is the sum of the four');
select is((select count(*)::int from jsonb_array_elements(pg_temp.bal() -> 'withdrawals') x), 8, 'every withdrawal listed once');

select * from finish();
rollback;
