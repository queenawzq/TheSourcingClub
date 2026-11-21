-- One balance, fix round 16 (20261121100000): every figure and sentence
-- about money is true.
--
-- A payment-only step is the factory's once funded: its notice names the
-- step and the order, and the brand is told it is added to the factory's
-- balance (never "TSC will pay the factory"). A paid step's brand notice
-- says it is added on approval. A payment-only step coming due says the
-- same. Connecting Stripe says it is the default withdrawal method, not that
-- "TSC now pays" it. A disputed step part of which a withdrawal is already
-- sending tells staff that part apart (in_withdrawal_cents). A step's part
-- whose Stripe payout is still on its way reads on its way, not paid out.
--
-- Fixtures: slugs pgtap-r16-*, ids c16?xxxx-...; every count is scoped to them.
begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

update public.payout_provider_settings set enabled = case
    when provider = 'paypal' and region in ('china', 'elsewhere') then true else false end;

set local session_replication_role = replica;

-- 01 factory owner, 02 staff, 03 brand owner.
insert into auth.users (id, email)
select ('c16a0000-0000-0000-0000-0000000000' || k)::uuid, 'pgtap-r16-' || k || '@example.com' from unnest(array['01','02','03']) k;
insert into public.platform_admins (user_id, note) values ('c16a0000-0000-0000-0000-000000000002', 'pgtap-r16');
insert into public.orgs (id, type, name, slug) values
  ('c16b0000-0000-0000-0000-00000000000b', 'brand', 'R16 Brand', 'pgtap-r16-brand'),
  ('c16b0000-0000-0000-0000-0000000000e1', 'factory', 'R16 Factory', 'pgtap-r16-factory');
insert into public.org_members (org_id, user_id, role, permissions) values
  ('c16b0000-0000-0000-0000-0000000000e1', 'c16a0000-0000-0000-0000-000000000001', 'owner', '{}'),
  ('c16b0000-0000-0000-0000-00000000000b', 'c16a0000-0000-0000-0000-000000000003', 'owner', '{}');
insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total)
select ('c16c0000-0000-0000-0000-00000000000' || n)::uuid, 'c16b0000-0000-0000-0000-00000000000b', 'R16 request ' || n, 'awarded', 'invited_only', 100
  from generate_series(1, 2) n;
insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity, submitted_at)
select ('c16c1000-0000-0000-0000-00000000000' || n)::uuid, ('c16c0000-0000-0000-0000-00000000000' || n)::uuid,
       'c16b0000-0000-0000-0000-0000000000e1', 'accepted', 100, 1, now() from generate_series(1, 2) n;
insert into public.production_orders
  (id, rfq_id, quote_id, brand_org_id, factory_org_id, unit_price_cents, status, schedule_brand_agreed_at, schedule_brand_agreed_by,
   production_quantity, bulk_subtotal_cents, sample_subtotal_cents, order_total_cents, deposit_pct, balance_pct, order_number)
select ('c16d0000-0000-0000-0000-00000000000' || n)::uuid, ('c16c0000-0000-0000-0000-00000000000' || n)::uuid,
       ('c16c1000-0000-0000-0000-00000000000' || n)::uuid, 'c16b0000-0000-0000-0000-00000000000b',
       'c16b0000-0000-0000-0000-0000000000e1', 100000, 'active', now() - interval '60 days',
       'c16a0000-0000-0000-0000-000000000003', 1, 100000, 0, 100000, 50, 50, 'R16-' || n
  from generate_series(1, 2) n;
-- Order 1: s1 $100 and s2 $50 approved and cleared (oldest first); s5 $30
-- approved and cleared, for the Stripe road; s3 a $70 deposit (payment
-- only) and s4 a $40 paid step, both due.
insert into public.order_milestones (id, order_id, kind, title, amount_cents, state, sort, completed_at) values
  ('c16e0001-0000-0000-0000-000000000001', 'c16d0000-0000-0000-0000-000000000001', 'approval_and_payment', 'R16 step 1', 10000, 'complete', 10, now() - interval '9 days'),
  ('c16e0002-0000-0000-0000-000000000001', 'c16d0000-0000-0000-0000-000000000001', 'approval_and_payment', 'R16 step 2', 5000, 'complete', 20, now() - interval '8 days'),
  ('c16e0005-0000-0000-0000-000000000001', 'c16d0000-0000-0000-0000-000000000001', 'approval_and_payment', 'R16 step 5', 3000, 'complete', 25, now() - interval '7 days'),
  ('c16e0003-0000-0000-0000-000000000001', 'c16d0000-0000-0000-0000-000000000001', 'payment_only', 'R16 deposit', 7000, 'active', 30, null),
  ('c16e0004-0000-0000-0000-000000000001', 'c16d0000-0000-0000-0000-000000000001', 'approval_and_payment', 'R16 step 4', 4000, 'active', 30, null);
insert into public.order_payments
  (id, order_id, milestone_id, amount_cents, currency, state, confirmed_at, release_requested_at,
   stripe_payment_intent_id, stripe_charge_id, funds_available_at) values
  ('c16f0001-0000-0000-0000-000000000001', 'c16d0000-0000-0000-0000-000000000001', 'c16e0001-0000-0000-0000-000000000001', 10000, 'USD', 'confirmed',
   now() - interval '30 days', now() - interval '9 days', 'pi_pgtap_r16_1', 'ch_pgtap_r16_1', now() - interval '20 days'),
  ('c16f0002-0000-0000-0000-000000000001', 'c16d0000-0000-0000-0000-000000000001', 'c16e0002-0000-0000-0000-000000000001', 5000, 'USD', 'confirmed',
   now() - interval '30 days', now() - interval '8 days', 'pi_pgtap_r16_2', 'ch_pgtap_r16_2', now() - interval '20 days'),
  ('c16f0005-0000-0000-0000-000000000001', 'c16d0000-0000-0000-0000-000000000001', 'c16e0005-0000-0000-0000-000000000001', 3000, 'USD', 'confirmed',
   now() - interval '30 days', now() - interval '7 days', 'pi_pgtap_r16_5', 'ch_pgtap_r16_5', now() - interval '20 days');
insert into public.order_payments (id, order_id, milestone_id, amount_cents, currency, state, stripe_payment_intent_id) values
  ('c16f0003-0000-0000-0000-000000000001', 'c16d0000-0000-0000-0000-000000000001', 'c16e0003-0000-0000-0000-000000000001', 7000, 'USD', 'due', 'pi_pgtap_r16_3'),
  ('c16f0004-0000-0000-0000-000000000001', 'c16d0000-0000-0000-0000-000000000001', 'c16e0004-0000-0000-0000-000000000001', 4000, 'USD', 'due', 'pi_pgtap_r16_4');
-- Order 2: one pending deposit, opened below.
insert into public.order_milestones (id, order_id, kind, title, amount_cents, state, sort) values
  ('c16e0001-0000-0000-0000-000000000002', 'c16d0000-0000-0000-0000-000000000002', 'payment_only', 'R16 opening deposit', 2000, 'pending', 10);
insert into public.order_payments (id, order_id, milestone_id, amount_cents, currency, state) values
  ('c16f0001-0000-0000-0000-000000000002', 'c16d0000-0000-0000-0000-000000000002', 'c16e0001-0000-0000-0000-000000000002', 2000, 'USD', 'not_due');

insert into public.factory_payout_accounts (id, org_id, method, paypal_email, is_primary, details_changed_at) values
  ('c1690000-0000-0000-0000-000000000001', 'c16b0000-0000-0000-0000-0000000000e1', 'paypal', 'pgtap-r16@example.com', true, '2026-11-01');
insert into public.factory_payout_preferences (org_id, route) values ('c16b0000-0000-0000-0000-0000000000e1', 'manual');
insert into public.stripe_connect_accounts (org_id, stripe_account_id, country, transfers_active, payouts_enabled, details_submitted)
values ('c16b0000-0000-0000-0000-0000000000e1', 'acct_pgtap_r16', 'US', true, true, true);
insert into public.stripe_withdrawals (id, org_id, stripe_account_id, request_key, request_id, amount_minor, currency, usd_cents, state)
values ('c1680000-0000-0000-0000-000000000001', 'c16b0000-0000-0000-0000-0000000000e1', 'acct_pgtap_r16', 'pgtap-r16-sw-1', gen_random_uuid(), 3000, 'USD', 3000, 'claimed');
set local session_replication_role = origin;

create function pg_temp.act_as(who text) returns void language sql as $f$
  select set_config('request.jwt.claims',
    json_build_object('sub', 'c16a0000-0000-0000-0000-' || lpad(who, 12, '0'), 'role', 'authenticated')::text, true);
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
create function pg_temp.bal() returns jsonb language plpgsql as $f$
declare j jsonb;
begin
  perform pg_temp.act_as('01');
  set local role authenticated;
  j := public.factory_balance('c16b0000-0000-0000-0000-0000000000e1');
  reset role;
  return j;
end;
$f$;
create function pg_temp.body(org text, k text, subject uuid) returns text language sql as $f$
  select string_agg(body, ' || ') from public.notifications where org_id = org::uuid and kind = k and subject_id = subject;
$f$;
create function pg_temp.attention() returns jsonb language plpgsql as $f$
declare j jsonb;
begin
  perform pg_temp.act_as('02');
  set local role authenticated;
  j := public.admin_balance_attention();
  reset role;
  return j;
end;
$f$;

-- ===========================================================================
-- 1. Funding: a deposit is the factory's at once; a paid step on approval.
-- ===========================================================================
select lives_ok($$select pg_temp.as_server('select public.record_payment_funded(''c16f0003-0000-0000-0000-000000000001'', ''ch_pgtap_r16_3'', ''card'', ''Visa ···4242'', 7000)')$$,
  'the deposit is funded');
select is(pg_temp.body('c16b0000-0000-0000-0000-0000000000e1', 'payment_confirmed', 'c16f0003-0000-0000-0000-000000000001'),
  '$70.00 added to your balance for "R16 deposit" on R16 request 1 (R16-1).', 'the factory''s notice names the step and the order');
select matches(pg_temp.body('c16b0000-0000-0000-0000-00000000000b', 'payment_confirmed', 'c16f0003-0000-0000-0000-000000000001'),
  ' received on R16 request 1 \(R16-1\)\. We add \$70\.00 to the factory''s balance\.$', 'the brand is told the amount added to the factory''s balance');
select lives_ok($$select pg_temp.as_server('select public.record_payment_funded(''c16f0004-0000-0000-0000-000000000001'', ''ch_pgtap_r16_4'', ''card'', ''Visa ···4242'', 4000)')$$,
  'the paid step is funded');
select matches(pg_temp.body('c16b0000-0000-0000-0000-00000000000b', 'payment_confirmed', 'c16f0004-0000-0000-0000-000000000001'),
  ' received on R16 request 1 \(R16-1\)\. TSC holds it and adds it to the factory''s balance when you approve this step\.$', 'a paid step: added on approval');
select is((select count(*)::int from public.notifications where org_id = 'c16b0000-0000-0000-0000-00000000000b'
            and subject_id in ('c16f0003-0000-0000-0000-000000000001', 'c16f0004-0000-0000-0000-000000000001')
            and (body like '%TSC will pay the factory%' or body like '%pays the factory when you approve%')), 0,
  'never "TSC will pay the factory"');

-- ===========================================================================
-- 2. A deposit coming due says it is added once funded.
-- ===========================================================================
select lives_ok($$select pg_temp.as_server('select public.advance_order_chain(''c16d0000-0000-0000-0000-000000000002'')')$$, 'order 2 opens its deposit');
select is(pg_temp.body('c16b0000-0000-0000-0000-00000000000b', 'payment_due', 'c16f0001-0000-0000-0000-000000000002'),
  '"R16 opening deposit". Fund it by card. Once you pay, $20.00 goes to the factory''s balance.',
  'a deposit due: added to the factory''s balance once funded, not "held until the step is done"');

-- ===========================================================================
-- 3. Connecting Stripe makes it the default withdrawal method.
-- ===========================================================================
select pg_temp.act_as('01'); set local role authenticated;
select lives_ok($$select public.choose_payout_method('c16b0000-0000-0000-0000-0000000000e1', null)$$, 'the owner makes the Stripe account the default');
reset role;
select is((select body from public.notifications where org_id = 'c16b0000-0000-0000-0000-0000000000e1' and kind = 'payout_method_changed'
            and body like 'Your connected payout account%'),
  'Your connected payout account is now your default withdrawal method. If nobody at your company made this change, email operations@contact.sourcing-club.com now.',
  'it says what changed, not that TSC now pays it');
select is((select count(*)::int from public.notifications where org_id = 'c16b0000-0000-0000-0000-0000000000e1' and body like 'TSC now pays your connected%'), 0,
  'never "TSC now pays your connected payout account"');
select pg_temp.act_as('01'); set local role authenticated;
select lives_ok($$select public.choose_payout_method('c16b0000-0000-0000-0000-0000000000e1', 'c1690000-0000-0000-0000-000000000001')$$, 'and back to PayPal');
reset role;

-- ===========================================================================
-- 4. A dispute on a step part of which a PayPal payout is already sending:
--    staff are told that part apart.
-- ===========================================================================
select set_config('tsc.r16_w', (select (public.request_withdrawal('c16b0000-0000-0000-0000-0000000000e1', 12000, 'c1690000-0000-0000-0000-000000000001')).id::text
  from (select pg_temp.act_as('01')) a), true);
reset role;
select is((select amount_cents from public.payment_takes where factory_withdrawal_id = current_setting('tsc.r16_w')::uuid
            and payment_id = 'c16f0002-0000-0000-0000-000000000001'), 2000::bigint, 'the $120 request takes $100 of step 1 and $20 of step 2');
select pg_temp.act_as('02'); set local role authenticated;
select lives_ok($$select public.claim_withdrawal(current_setting('tsc.r16_w')::uuid)$$, 'staff start paying it');
reset role;
select lives_ok($$select pg_temp.as_server('select public.record_payment_disputed(''c16f0002-0000-0000-0000-000000000001'', true)')$$,
  'step 2''s charge is disputed');
select is((select (x ->> 'in_withdrawal_cents')::bigint from jsonb_array_elements(pg_temp.attention() -> 'disputed') x
            where (x ->> 'payment_id')::uuid = 'c16f0002-0000-0000-0000-000000000001'), 2000::bigint,
  'staff see the $20 already in a payout being sent');
select is((select (x ->> 'amount_cents')::bigint from jsonb_array_elements(pg_temp.attention() -> 'disputed') x
            where (x ->> 'payment_id')::uuid = 'c16f0002-0000-0000-0000-000000000001'), 5000::bigint, 'of the $50 step');
select pg_temp.act_as('01'); set local role authenticated;
select throws_ok($$select public.admin_balance_attention()$$, '42501', null, 'still staff only');
reset role;

-- ===========================================================================
-- 5. A step's part in a Stripe withdrawal whose payout is still on its way
--    to the bank reads on its way, not paid out; the figures are unchanged.
-- ===========================================================================
select lives_ok($$select pg_temp.as_server('select public.claim_owed_steps(''c16b0000-0000-0000-0000-0000000000e1'', 3000, ''stripe'', ''c1680000-0000-0000-0000-000000000001'')')$$,
  'a $30 Stripe withdrawal claims cleared money');
select lives_ok(format($$select pg_temp.as_server(%L)$$, (select string_agg(format('select public.record_take_sent(%L, %L);', id, 'tr_pgtap_r16'), ' ')
                                 from public.payment_takes where stripe_withdrawal_id = 'c1680000-0000-0000-0000-000000000001')),
  'its transfers are sent');
select lives_ok($$select pg_temp.as_server('update public.stripe_withdrawals set state = ''paid_out'', fee_cents = 50, fee_local_minor = 50, payout_minor = 2950, payout_id = ''po_pgtap_r16'', payout_status = ''in_transit'', payout_arrives_on = current_date + 2 where id = ''c1680000-0000-0000-0000-000000000001''')$$,
  'its payout is on its way, arriving in two days');
select is((select sum((r ->> 'amount_cents')::bigint) from jsonb_array_elements(pg_temp.bal() -> 'rows') r
            where r ->> 'figure' = 'on_its_way'
              and (r ->> 'payment_id')::uuid in (select payment_id from public.payment_takes where stripe_withdrawal_id = 'c1680000-0000-0000-0000-000000000001'))::bigint,
  3000::bigint, 'the steps it took read on its way');
select is((select count(*)::int from jsonb_array_elements(pg_temp.bal() -> 'rows') r
            where r ->> 'figure' = 'paid_out' and (r ->> 'stripe')::boolean
              and (r ->> 'payment_id')::uuid in (select payment_id from public.payment_takes where stripe_withdrawal_id = 'c1680000-0000-0000-0000-000000000001')), 0,
  'none of it reads paid out yet');
select is((pg_temp.bal() ->> 'total_cents')::bigint,
  (pg_temp.bal() ->> 'awaiting_cents')::bigint + (pg_temp.bal() ->> 'available_cents')::bigint + (pg_temp.bal() ->> 'pending_cents')::bigint
  + (pg_temp.bal() ->> 'processing_cents')::bigint + (pg_temp.bal() ->> 'paid_out_cents')::bigint, 'Total is still the sum of the figures');
select lives_ok($$select pg_temp.as_server('update public.stripe_withdrawals set payout_status = ''paid'', payout_arrives_on = current_date - 1 where id = ''c1680000-0000-0000-0000-000000000001''')$$,
  'the payout lands');
select is((select count(*)::int from jsonb_array_elements(pg_temp.bal() -> 'rows') r where r ->> 'figure' = 'on_its_way'), 0, 'then nothing reads on its way');

-- ===========================================================================
-- 6. Grants: the new helper is for other functions only; the replaced ones
--    keep theirs, one each.
-- ===========================================================================
select ok(not has_function_privilege('authenticated', 'public.withdrawal_refunded_cents(public.factory_withdrawals)', 'execute')
      and not has_function_privilege('anon', 'public.withdrawal_refunded_cents(public.factory_withdrawals)', 'execute'),
  'withdrawal_refunded_cents is not callable by a person');
select ok(has_function_privilege('authenticated', 'public.factory_balance(uuid, uuid)', 'execute')
      and not has_function_privilege('anon', 'public.factory_balance(uuid, uuid)', 'execute'), 'factory_balance: members, never anon');
select ok(not has_function_privilege('authenticated', 'public.record_payment_funded(uuid, text, text, text, bigint)', 'execute')
      and has_function_privilege('service_role', 'public.record_payment_funded(uuid, text, text, text, bigint)', 'execute'), 'record_payment_funded: the server only');
select ok(not has_function_privilege('authenticated', 'public.advance_order_chain(uuid)', 'execute'), 'advance_order_chain: not a person');
select ok(has_function_privilege('authenticated', 'public.choose_payout_method(uuid, uuid)', 'execute')
      and not has_function_privilege('anon', 'public.choose_payout_method(uuid, uuid)', 'execute'), 'choose_payout_method: signed in only');
select is((select count(*)::int from pg_proc where proname in ('factory_balance', 'admin_balance_attention', 'advance_order_chain',
            'record_payment_funded', 'choose_payout_method', 'withdrawal_refunded_cents') and pronamespace = 'public'::regnamespace), 6, 'no overloads');

select * from finish();
rollback;
