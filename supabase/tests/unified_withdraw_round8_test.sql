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

-- PayPal: waiting ($100, step 1), waiting ($45, step 2, refunded below after
-- approval: since paused payments, 20261124100000, nothing is taken from the
-- factory; a payment review opens and staff decide it, paying the factory, so
-- the rest of this fixture runs unpaused), on its way ($10, step 3, staff
-- paying), paid ($20, step 4), returned (a cancelled $5 request).
select set_config('tsc.r8_wait', pg_temp.ask(10000)::text, true);
select set_config('tsc.r8_hold', pg_temp.ask(4500)::text, true);
select set_config('tsc.r8_way', pg_temp.ask(1000)::text, true);
select set_config('tsc.r8_paid', pg_temp.ask(2000)::text, true);
select set_config('tsc.r8_back', pg_temp.ask(500)::text, true);
select lives_ok(format($$select pg_temp.as_server(%L)$$,
  format('select public.record_payment_refunded(%L, %L, %L)', pg_temp.pay(2), 'pi_pgtap_r8_2', 'The payment was refunded.')),
  'step 2, held by the $45 request, is refunded');
select is(public.factory_paused('ce8b0000-0000-0000-0000-0000000000e1'), true, 'a refund after approval pauses the factory for a payment review');
select set_config('tsc.r8_review', (select id::text from public.payment_reviews where payment_id = pg_temp.pay(2) and state in ('open', 'decide')), true);
select pg_temp.act_as('02'); set local role authenticated;
select lives_ok($$select public.decide_payment_review(current_setting('tsc.r8_review')::uuid, 'tsc_pays', null, 'pgTAP: TSC bears it')$$,
  'staff decide the review: pay the factory (nothing taken)');
reset role;
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
select is(pg_temp.word(current_setting('tsc.r8_hold')::uuid), 'waiting', 'one whose step was refunded after approval: still waiting, nothing was taken');
select is(pg_temp.word(current_setting('tsc.r8_way')::uuid), 'on_its_way', 'one staff are paying: on its way');
select is(pg_temp.word(current_setting('tsc.r8_paid')::uuid), 'paid', 'a paid one: paid');
select is(pg_temp.word(current_setting('tsc.r8_back')::uuid), 'returned', 'a cancelled one: returned');

-- The withdrawal lines add up to Processing (round 14: withdrawals in progress
-- are not Pending; every step cleared, none disputed, no Stripe money on its way yet).
select is((pg_temp.bal() ->> 'pending_cents')::bigint, 0::bigint, 'no withdrawal is Pending');
select is((pg_temp.bal() ->> 'processing_cents')::bigint,
  (select sum((p ->> 'amount_cents')::bigint) from jsonb_array_elements(pg_temp.bal() -> 'withdrawals') x,
    jsonb_array_elements(coalesce(x -> 'parts', jsonb_build_array(jsonb_build_object('word', x -> 'word', 'amount_cents', x -> 'amount_cents')))) p
    where p ->> 'word' in ('waiting', 'on_hold', 'on_its_way'))::bigint,
  'waiting + on hold + on its way = Processing, to the cent');
-- Paused payments: the $45 on the step refunded after approval stays the factory's.
select is((pg_temp.bal() ->> 'processing_cents')::bigint, (10000 + 4500 + 1000)::bigint, 'that is $100 + $45 + $10; the factory keeps the refunded step''s $45');
select is((select p from jsonb_array_elements(pg_temp.bal() -> 'withdrawals') x, jsonb_array_elements(x -> 'parts') p
            where (x ->> 'id')::uuid = current_setting('tsc.r8_hold')::uuid),
  '{"word": "waiting", "amount_cents": 4500}'::jsonb, 'its part reads waiting, never refunded');

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
select is((pg_temp.bal() ->> 'processing_cents')::bigint,
  (select sum((p ->> 'amount_cents')::bigint) from jsonb_array_elements(pg_temp.bal() -> 'withdrawals') x,
    jsonb_array_elements(coalesce(x -> 'parts', jsonb_build_array(jsonb_build_object('word', x -> 'word', 'amount_cents', x -> 'amount_cents')))) p
    where p ->> 'word' in ('waiting', 'on_hold', 'on_its_way'))::bigint,
  'with Stripe on its way too, the lines still add up to Processing');
select is((pg_temp.bal() -> 'parts' ->> 'stripe_on_way_cents')::bigint, 2950::bigint, 'the Stripe part on its way is in parts');
select is((pg_temp.bal() ->> 'total_cents')::bigint,
  (pg_temp.bal() ->> 'awaiting_cents')::bigint + (pg_temp.bal() ->> 'available_cents')::bigint
  + (pg_temp.bal() ->> 'pending_cents')::bigint + (pg_temp.bal() ->> 'processing_cents')::bigint + (pg_temp.bal() ->> 'paid_out_cents')::bigint, 'Total is the sum of the figures');
select is((select count(*)::int from jsonb_array_elements(pg_temp.bal() -> 'withdrawals') x), 8, 'every withdrawal listed once');

-- ===========================================================================
-- Fix round 9 (20261120280000): a payment-only step whose charge was disputed
-- before its payment was recorded: funded, never "added to your balance", and
-- it is held in Pending. (Since paused payments, 20261124100000, no per-step
-- "on hold" notice is sent: a payment review tells the factory.)
-- ===========================================================================
set local session_replication_role = replica;
insert into public.order_milestones (id, order_id, kind, title, amount_cents, state, sort)
values ('ce8e0009-0000-0000-0000-000000000001', 'ce8d0000-0000-0000-0000-000000000001', 'payment_only', 'R8 deposit', 7000, 'active', 90);
insert into public.order_payments (id, order_id, milestone_id, amount_cents, currency, state, stripe_payment_intent_id, disputed_at)
values ('ce8f0009-0000-0000-0000-000000000001', 'ce8d0000-0000-0000-0000-000000000001', 'ce8e0009-0000-0000-0000-000000000001',
        7000, 'USD', 'due', 'pi_pgtap_r8_9', now());
set local session_replication_role = origin;
select lives_ok($$select pg_temp.as_server('select public.record_payment_funded(''ce8f0009-0000-0000-0000-000000000001'', ''ch_pgtap_r8_9'', ''card'', ''Visa ···0259'', 7000)')$$,
  'R9: the payment-only step, its charge already disputed, is funded');
select is((select title || ' | ' || body from public.notifications where org_id = 'ce8b0000-0000-0000-0000-0000000000e1'
            and kind = 'payment_disputed' and subject_id = 'ce8f0009-0000-0000-0000-000000000001'),
  'Payment for "R8 deposit" under review | Our team is reviewing this payment before it goes to your balance.',
  'R9: told in the payment review''s words, never "on hold" or "added to your balance" (paused payments)');
select is((select count(*)::int from public.notifications where org_id = 'ce8b0000-0000-0000-0000-0000000000e1'
            and subject_id = 'ce8f0009-0000-0000-0000-000000000001' and body like '%added to your balance%'), 0,
  'R9: never "added to your balance"');
select ok((select bool_and(r ->> 'figure' = 'pending' and coalesce((r ->> 'held')::boolean, false))
             from jsonb_array_elements(pg_temp.bal() -> 'rows') r where (r ->> 'payment_id')::uuid = 'ce8f0009-0000-0000-0000-000000000001'),
  'R9: held in Pending');
select ok(exists (select 1 from public.notifications where org_id = 'ce8b0000-0000-0000-0000-00000000000b'
                   and subject_id = 'ce8f0009-0000-0000-0000-000000000001' and kind = 'payment_confirmed'),
  'R9: the brand is still told its payment is funded');

-- ===========================================================================
-- Fix round 10 (20261120290000): Needs checking says who asked for each
-- stuck Stripe withdrawal (name, else email); still staff only.
-- ===========================================================================
set local session_replication_role = replica;
insert into public.user_profiles (id, email, full_name) values
  ('ce8a0000-0000-0000-0000-000000000001', 'pgtap-r8-01@example.com', 'R8 Owner'),
  ('ce8a0000-0000-0000-0000-000000000003', 'pgtap-r8-03@example.com', '  ')
on conflict (id) do update set email = excluded.email, full_name = excluded.full_name;
insert into public.stripe_withdrawals (id, org_id, stripe_account_id, request_key, request_id, amount_minor, currency, usd_cents, state,
                                       requested_by, created_at, updated_at, lease_until)
values ('ce880000-0000-0000-0000-000000000007', 'ce8b0000-0000-0000-0000-0000000000e1', 'acct_pgtap_r8', 'pgtap-r8-sw-7', gen_random_uuid(),
        100, 'USD', 100, 'claimed', 'ce8a0000-0000-0000-0000-000000000001', now() - interval '1 hour', now() - interval '1 hour', null),
       ('ce880000-0000-0000-0000-000000000008', 'ce8b0000-0000-0000-0000-0000000000e1', 'acct_pgtap_r8', 'pgtap-r8-sw-8', gen_random_uuid(),
        100, 'USD', 100, 'claimed', 'ce8a0000-0000-0000-0000-000000000003', now() - interval '1 hour', now() - interval '1 hour', null);
set local session_replication_role = origin;
select pg_temp.act_as('02'); set local role authenticated;
select is((select x ->> 'requested_by_name' from jsonb_array_elements(public.admin_balance_attention() -> 'stuck') x
            where x ->> 'withdrawal_id' = 'ce880000-0000-0000-0000-000000000007'), 'R8 Owner', 'R10: a stuck row names who asked');
select is((select x ->> 'requested_by_name' from jsonb_array_elements(public.admin_balance_attention() -> 'stuck') x
            where x ->> 'withdrawal_id' = 'ce880000-0000-0000-0000-000000000008'), 'pgtap-r8-03@example.com', 'R10: by email when there is no name');
reset role;
select pg_temp.act_as('01'); set local role authenticated;
select throws_ok($$select public.admin_balance_attention()$$, '42501', null, 'R10: still staff only');
reset role;

-- ===========================================================================
-- Fix round 11 (20261120300000): when a charge was last checked against
-- Stripe is the server's alone; staff's "Balance after" is the one balance.
-- ===========================================================================
select ok(not has_table_privilege('anon', 'public.payment_charge_checks', 'select')
      and not has_table_privilege('anon', 'public.payment_charge_checks', 'insert')
      and not has_table_privilege('authenticated', 'public.payment_charge_checks', 'select')
      and not has_table_privilege('authenticated', 'public.payment_charge_checks', 'insert')
      and not has_table_privilege('authenticated', 'public.payment_charge_checks', 'update')
      and not has_table_privilege('authenticated', 'public.payment_charge_checks', 'delete'),
  'R11: payment_charge_checks is neither readable nor writable by anon or a signed-in person');
select pg_temp.act_as('01'); set local role authenticated;
select throws_ok($$select * from public.payment_charge_checks$$, '42501', null, 'R11: a factory owner cannot read it');
reset role;
select ok(not has_function_privilege('authenticated', 'public.record_charges_checked(uuid[])', 'execute')
      and not has_function_privilege('anon', 'public.record_charges_checked(uuid[])', 'execute')
      and has_function_privilege('service_role', 'public.record_charges_checked(uuid[])', 'execute'),
  'R11: record_charges_checked is the server''s only');
select lives_ok($$select pg_temp.as_server('select public.record_charges_checked(array[''ce8f0001-0000-0000-0000-000000000001''::uuid])')$$,
  'R11: the server records a check');
select ok((select checked_at is not null from public.payment_charge_checks where payment_id = 'ce8f0001-0000-0000-0000-000000000001'),
  'R11: and it is kept');
select pg_temp.act_as('02'); set local role authenticated;
select ok((select bool_and((w ->> 'balance_after_cents')::bigint = (public.factory_balance(('ce8b0000-0000-0000-0000-0000000000e1')::uuid) ->> 'available_cents')::bigint)
             from jsonb_array_elements(public.admin_withdrawals() -> 'withdrawals') w where w ->> 'org_id' = 'ce8b0000-0000-0000-0000-0000000000e1'),
  'R11: staff''s "Balance after" is the factory''s Available balance');
select ok((select count(*) > 0 from jsonb_array_elements(public.admin_withdrawals() -> 'withdrawals') w where w ->> 'org_id' = 'ce8b0000-0000-0000-0000-0000000000e1'),
  'R11: (for this factory''s withdrawals)');
reset role;

-- ===========================================================================
-- 87f83990 (20261120310000): a waiting PayPal request partly on a refunded
-- step is split: that part on hold, the rest still waiting. A clean one is
-- one part. Parts always add up to the amount. Since paused payments
-- (20261124100000) a refund after approval refunds no part: the factory is
-- paused for review and its waiting requests read on hold, whole, until
-- staff decide.
-- ===========================================================================
set local session_replication_role = replica;
insert into auth.users (id, email) values ('ce8a0000-0000-0000-0000-000000000004', 'pgtap-r8-04@example.com');
insert into public.orgs (id, type, name, slug) values ('ce8b0000-0000-0000-0000-0000000000e2', 'factory', 'R8 Parts', 'pgtap-r8-parts');
insert into public.org_members (org_id, user_id, role, permissions) values
  ('ce8b0000-0000-0000-0000-0000000000e2', 'ce8a0000-0000-0000-0000-000000000004', 'owner', '{}');
insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total) values
  ('ce8c0000-0000-0000-0000-000000000002', 'ce8b0000-0000-0000-0000-00000000000b', 'R8 parts request', 'awarded', 'invited_only', 100);
insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity, submitted_at) values
  ('ce8c1000-0000-0000-0000-000000000002', 'ce8c0000-0000-0000-0000-000000000002', 'ce8b0000-0000-0000-0000-0000000000e2', 'accepted', 100, 1, now());
insert into public.production_orders
  (id, rfq_id, quote_id, brand_org_id, factory_org_id, unit_price_cents, status, schedule_brand_agreed_at, schedule_brand_agreed_by,
   production_quantity, bulk_subtotal_cents, sample_subtotal_cents, order_total_cents, deposit_pct, balance_pct, order_number)
values ('ce8d0000-0000-0000-0000-000000000002', 'ce8c0000-0000-0000-0000-000000000002', 'ce8c1000-0000-0000-0000-000000000002',
        'ce8b0000-0000-0000-0000-00000000000b', 'ce8b0000-0000-0000-0000-0000000000e2', 100000, 'active', now() - interval '60 days',
        'ce8a0000-0000-0000-0000-000000000003', 1, 100000, 0, 100000, 50, 50, 'R8-2');
-- Oldest first: $25 clean, then $50 (to be refunded), then $40 clean.
insert into public.order_milestones (id, order_id, kind, title, amount_cents, state, sort, completed_at)
select ('ce8e100' || s || '-0000-0000-0000-000000000002')::uuid, 'ce8d0000-0000-0000-0000-000000000002', 'approval_and_payment',
       'R8 parts step ' || s, a, 'complete', s * 10, now() - make_interval(days => 10 - s)
  from (values (1, 2500), (2, 5000), (3, 4000)) v(s, a);
insert into public.order_payments
  (id, order_id, milestone_id, amount_cents, currency, state, confirmed_at, release_requested_at, stripe_payment_intent_id, stripe_charge_id, funds_available_at)
select ('ce8f100' || s || '-0000-0000-0000-000000000002')::uuid, 'ce8d0000-0000-0000-0000-000000000002',
       ('ce8e100' || s || '-0000-0000-0000-000000000002')::uuid, a, 'USD', 'confirmed', now() - interval '30 days',
       now() - make_interval(days => 10 - s), 'pi_pgtap_r8p_' || s, 'ch_pgtap_r8p_' || s, now() - interval '20 days'
  from (values (1, 2500), (2, 5000), (3, 4000)) v(s, a);
insert into public.factory_payout_accounts (id, org_id, method, paypal_email, is_primary, details_changed_at) values
  ('ce890000-0000-0000-0000-000000000002', 'ce8b0000-0000-0000-0000-0000000000e2', 'paypal', 'pgtap-r8-parts@example.com', true, '2026-11-01');
set local session_replication_role = origin;
create function pg_temp.parts_of(w uuid) returns jsonb language plpgsql as $f$
declare j jsonb;
begin
  perform pg_temp.act_as('04');
  set local role authenticated;
  select x -> 'parts' into j from jsonb_array_elements(public.factory_balance('ce8b0000-0000-0000-0000-0000000000e2') -> 'withdrawals') x
   where (x ->> 'id')::uuid = w;
  reset role;
  return j;
end;
$f$;
select set_config('tsc.r8p_mixed', (select (public.request_withdrawal('ce8b0000-0000-0000-0000-0000000000e2', 7500, 'ce890000-0000-0000-0000-000000000002')).id::text
  from (select pg_temp.act_as('04')) a), true);
reset role;
select set_config('tsc.r8p_clean', (select (public.request_withdrawal('ce8b0000-0000-0000-0000-0000000000e2', 4000, 'ce890000-0000-0000-0000-000000000002')).id::text
  from (select pg_temp.act_as('04')) a), true);
reset role;
select is((select sum(amount_cents)::bigint from public.payment_takes where factory_withdrawal_id = current_setting('tsc.r8p_mixed')::uuid
            and payment_id = 'ce8f1002-0000-0000-0000-000000000002'), 5000::bigint, 'the $75 request holds $25 of step 1 and $50 of step 2');
select is(pg_temp.parts_of(current_setting('tsc.r8p_mixed')::uuid), '[{"word": "waiting", "amount_cents": 7500}]'::jsonb,
  'before any refund: one part, waiting, the whole $75');
select lives_ok($$select pg_temp.as_server('select public.record_payment_refunded(''ce8f1002-0000-0000-0000-000000000002'', ''pi_pgtap_r8p_2'', ''The payment was refunded.'')')$$,
  'the $50 step is refunded');
select is(pg_temp.parts_of(current_setting('tsc.r8p_mixed')::uuid),
  '[{"word": "on_hold", "amount_cents": 7500}]'::jsonb,
  'the $75 request: paused for the payment review, the whole $75 on hold, nothing refunded');
select is((select sum((p ->> 'amount_cents')::bigint)::bigint from jsonb_array_elements(pg_temp.parts_of(current_setting('tsc.r8p_mixed')::uuid)) p),
  7500::bigint, 'its parts add up to its amount');
select set_config('tsc.r8p_review', (select id::text from public.payment_reviews where payment_id = 'ce8f1002-0000-0000-0000-000000000002' and state in ('open', 'decide')), true);
select pg_temp.act_as('02'); set local role authenticated;
select lives_ok($$select public.decide_payment_review(current_setting('tsc.r8p_review')::uuid, 'tsc_pays', null, 'pgTAP: TSC bears it')$$,
  'staff decide that review too: pay the factory');
reset role;
select is(pg_temp.parts_of(current_setting('tsc.r8p_clean')::uuid), '[{"word": "waiting", "amount_cents": 4000}]'::jsonb,
  'a clean request: one part, with its word and its whole amount');

-- ===========================================================================
-- 13ac6414 (20261120320000): Stripe is asked at most once a minute per
-- company; a payout's status only moves forward.
-- ===========================================================================
select ok(not has_function_privilege('authenticated', 'public.claim_balance_stripe_read(uuid)', 'execute')
      and not has_function_privilege('anon', 'public.claim_balance_stripe_read(uuid)', 'execute')
      and has_function_privilege('service_role', 'public.claim_balance_stripe_read(uuid)', 'execute'),
  'claim_balance_stripe_read is the server''s only');
select ok(not has_table_privilege('authenticated', 'public.balance_stripe_reads', 'select')
      and not has_table_privilege('authenticated', 'public.balance_stripe_reads', 'insert')
      and not has_table_privilege('anon', 'public.balance_stripe_reads', 'select'), 'balance_stripe_reads is no client''s');
create function pg_temp.claim_read() returns boolean language plpgsql as $f$
declare took boolean;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  set local role service_role;
  took := public.claim_balance_stripe_read('ce8b0000-0000-0000-0000-0000000000e1');
  reset role;
  return took;
end;
$f$;
select is(pg_temp.claim_read(), true, 'the first balance read in a minute may ask Stripe');
select is(pg_temp.claim_read(), false, 'a second within 60 seconds may not');
set local session_replication_role = replica;
update public.balance_stripe_reads set read_at = now() - interval '61 seconds' where org_id = 'ce8b0000-0000-0000-0000-0000000000e1';
set local session_replication_role = origin;
select is(pg_temp.claim_read(), true, 'after a minute, it may again');
select is(pg_temp.claim_read(), false, 'and then not again at once');
-- The payout status trigger.
select lives_ok($$select pg_temp.as_server('update public.stripe_withdrawals set payout_status = ''in_transit'' where id = ''ce880000-0000-0000-0000-000000000002''')$$,
  'an older answer (in_transit) is written on a paid payout');
select is((select payout_status from public.stripe_withdrawals where id = 'ce880000-0000-0000-0000-000000000002'), 'paid',
  'it stays paid: a status never goes back');
select lives_ok($$select pg_temp.as_server('update public.stripe_withdrawals set payout_status = ''failed'' where id = ''ce880000-0000-0000-0000-000000000002''')$$,
  'a payout that fails after it was paid');
select is((select payout_status from public.stripe_withdrawals where id = 'ce880000-0000-0000-0000-000000000002'), 'failed',
  'paid → failed is allowed');

-- ===========================================================================
-- 6251227f (20261120330000): a method can be removed unless money is on its
-- way to it; the payment-only funded notice is titled "$X added to your
-- balance", a held step's keeps "Payment held for …".
-- ===========================================================================
set local session_replication_role = replica;
insert into auth.users (id, email) values ('ce8a0000-0000-0000-0000-000000000005', 'pgtap-r8-05@example.com');
insert into public.orgs (id, type, name, slug) values ('ce8b0000-0000-0000-0000-0000000000e3', 'factory', 'R8 Remove', 'pgtap-r8-remove');
insert into public.org_members (org_id, user_id, role, permissions) values
  ('ce8b0000-0000-0000-0000-0000000000e3', 'ce8a0000-0000-0000-0000-000000000005', 'owner', '{}');
insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total) values
  ('ce8c0000-0000-0000-0000-000000000003', 'ce8b0000-0000-0000-0000-00000000000b', 'R8 remove request', 'awarded', 'invited_only', 100);
insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity, submitted_at) values
  ('ce8c1000-0000-0000-0000-000000000003', 'ce8c0000-0000-0000-0000-000000000003', 'ce8b0000-0000-0000-0000-0000000000e3', 'accepted', 100, 1, now());
insert into public.production_orders
  (id, rfq_id, quote_id, brand_org_id, factory_org_id, unit_price_cents, status, schedule_brand_agreed_at, schedule_brand_agreed_by,
   production_quantity, bulk_subtotal_cents, sample_subtotal_cents, order_total_cents, deposit_pct, balance_pct, order_number)
values ('ce8d0000-0000-0000-0000-000000000003', 'ce8c0000-0000-0000-0000-000000000003', 'ce8c1000-0000-0000-0000-000000000003',
        'ce8b0000-0000-0000-0000-00000000000b', 'ce8b0000-0000-0000-0000-0000000000e3', 100000, 'active', now() - interval '60 days',
        'ce8a0000-0000-0000-0000-000000000003', 1, 100000, 0, 100000, 50, 50, 'R8-3');
-- s1: $90 owed, cleared (in the balance, no withdrawal). s2: a payment-only
-- deposit, due. s3: an approval step, due.
insert into public.order_milestones (id, order_id, kind, title, amount_cents, state, sort, completed_at) values
  ('ce8e2001-0000-0000-0000-000000000003', 'ce8d0000-0000-0000-0000-000000000003', 'approval_and_payment', 'R8 remove step', 9000, 'complete', 10, now() - interval '5 days'),
  ('ce8e2002-0000-0000-0000-000000000003', 'ce8d0000-0000-0000-0000-000000000003', 'payment_only', 'R8 remove deposit', 6000, 'active', 20, null),
  ('ce8e2003-0000-0000-0000-000000000003', 'ce8d0000-0000-0000-0000-000000000003', 'approval_and_payment', 'R8 remove fit', 3000, 'active', 30, null);
insert into public.order_payments
  (id, order_id, milestone_id, amount_cents, currency, state, confirmed_at, release_requested_at, stripe_payment_intent_id, stripe_charge_id, funds_available_at) values
  ('ce8f2001-0000-0000-0000-000000000003', 'ce8d0000-0000-0000-0000-000000000003', 'ce8e2001-0000-0000-0000-000000000003', 9000, 'USD', 'confirmed',
   now() - interval '30 days', now() - interval '5 days', 'pi_pgtap_r8r_1', 'ch_pgtap_r8r_1', now() - interval '20 days');
insert into public.order_payments (id, order_id, milestone_id, amount_cents, currency, state, stripe_payment_intent_id) values
  ('ce8f2002-0000-0000-0000-000000000003', 'ce8d0000-0000-0000-0000-000000000003', 'ce8e2002-0000-0000-0000-000000000003', 6000, 'USD', 'due', 'pi_pgtap_r8r_2'),
  ('ce8f2003-0000-0000-0000-000000000003', 'ce8d0000-0000-0000-0000-000000000003', 'ce8e2003-0000-0000-0000-000000000003', 3000, 'USD', 'due', 'pi_pgtap_r8r_3');
insert into public.factory_payout_accounts (id, org_id, method, paypal_email, is_primary, details_changed_at) values
  ('ce890000-0000-0000-0000-000000000031', 'ce8b0000-0000-0000-0000-0000000000e3', 'paypal', 'pgtap-r8-rm-a@example.com', true, '2026-11-01'),
  ('ce890000-0000-0000-0000-000000000032', 'ce8b0000-0000-0000-0000-0000000000e3', 'paypal', 'pgtap-r8-rm-b@example.com', false, '2026-11-01');
-- A withdrawal waiting to the second (non-default) account.
insert into public.factory_withdrawals (id, org_id, account_id, provider, status, amount_cents, currency, paid_to)
values ('ce870000-0000-0000-0000-000000000031', 'ce8b0000-0000-0000-0000-0000000000e3', 'ce890000-0000-0000-0000-000000000032', 'paypal', 'requested', 1000, 'USD', 'pgtap-r8-rm-b@example.com');
set local session_replication_role = origin;

select pg_temp.act_as('05'); set local role authenticated;
select throws_ok($$select public.remove_payout_account('ce890000-0000-0000-0000-000000000032', null)$$, 'P0001',
  'TSC is about to pay this account, so it cannot be removed until that payment is sent',
  'a non-default account with a withdrawal waiting to it cannot be removed');
reset role;
update public.factory_withdrawals set status = 'cancelled' where id = 'ce870000-0000-0000-0000-000000000031';
select pg_temp.act_as('05'); set local role authenticated;
select lives_ok($$select public.remove_payout_account('ce890000-0000-0000-0000-000000000032', null)$$,
  'once that withdrawal ended, it can be removed');
select lives_ok($$select public.remove_payout_account('ce890000-0000-0000-0000-000000000031', null)$$,
  'approved money waiting in the balance, with no withdrawal open, does not stop removing the last method');
reset role;
select is((select count(*)::int from public.factory_payout_accounts where org_id = 'ce8b0000-0000-0000-0000-0000000000e3'), 0, 'the factory has no method left');
select ok((select state = 'confirmed' and release_requested_at is not null from public.order_payments where id = 'ce8f2001-0000-0000-0000-000000000003'),
  'and its $90 is still owed, in its balance');

select lives_ok($$select pg_temp.as_server('select public.record_payment_funded(''ce8f2002-0000-0000-0000-000000000003'', ''ch_pgtap_r8r_2'', ''card'', ''Visa'', 6000)')$$,
  'the payment-only deposit is funded');
select is((select title from public.notifications where org_id = 'ce8b0000-0000-0000-0000-0000000000e3' and subject_id = 'ce8f2002-0000-0000-0000-000000000003'
            and kind = 'payment_confirmed'), '$60.00 added to your balance', 'its notice is titled "$60.00 added to your balance"');
select lives_ok($$select pg_temp.as_server('select public.record_payment_funded(''ce8f2003-0000-0000-0000-000000000003'', ''ch_pgtap_r8r_3'', ''card'', ''Visa'', 3000)')$$,
  'an approval step is funded');
select is((select title from public.notifications where org_id = 'ce8b0000-0000-0000-0000-0000000000e3' and subject_id = 'ce8f2003-0000-0000-0000-000000000003'
            and kind = 'payment_confirmed'), 'Payment held for "R8 remove fit"', 'its notice keeps "Payment held for …"');

select * from finish();
rollback;
