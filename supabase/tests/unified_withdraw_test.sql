-- One balance for every factory, stage 2 (20261120200000): withdrawing.
--
-- Nothing moves at approval; a withdrawal claims exactly the amount asked from
-- the oldest cleared owed steps, by exactly one road (Stripe, or the pool:
-- PayPal / Wise / bank), recorded per step in payment_takes. A part of a step
-- left over stays in the balance for either road. Existing pool money stays
-- pool-only; money already in the factory's Stripe account (D1) is the
-- server's, not tested here.
--
-- Most of what follows is negative: withdrawing the same money twice (same
-- road, both roads, two owners, two tabs), more than the balance, another
-- company's money, the wrong person, and the steps no road may take.
--
-- Fixtures: slugs pgtap-uw-*, ids ca2?xxxx-...; every count is scoped to them.
begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

update public.payout_provider_settings set enabled = true where provider in ('wise', 'paypal');

set local session_replication_role = replica;

-- People. 01/02 two owners of e1, 03 a member of e1, 04..09 owners of e2..e7
-- (08 is the stranger's factory e6), 0a brand owner who is also a member of
-- e1 (two hats), 0b staff, 0c staff who is also an owner of e1, 0d a brand
-- member only.
insert into auth.users (id, email)
select ('ca2a0000-0000-0000-0000-0000000000' || k)::uuid, 'pgtap-uw-' || k || '@example.com'
  from unnest(array['01','02','03','04','05','06','07','08','09','0a','0b','0c','0d']) k;

insert into public.platform_admins (user_id, note) values
  ('ca2a0000-0000-0000-0000-00000000000b', 'pgtap-uw'),
  ('ca2a0000-0000-0000-0000-00000000000c', 'pgtap-uw');

-- e1 PayPal only; e2..e5, e7 Stripe and PayPal; e6 a stranger's factory.
insert into public.orgs (id, type, name, slug) values
  ('ca2b0000-0000-0000-0000-00000000000b', 'brand', 'UW Brand', 'pgtap-uw-brand');
insert into public.orgs (id, type, name, slug)
select ('ca2b0000-0000-0000-0000-0000000000e' || n)::uuid, 'factory', 'UW Factory ' || n, 'pgtap-uw-factory-' || n
  from generate_series(1, 7) n;

insert into public.org_members (org_id, user_id, role, permissions) values
  ('ca2b0000-0000-0000-0000-0000000000e1', 'ca2a0000-0000-0000-0000-000000000001', 'owner', '{}'),
  ('ca2b0000-0000-0000-0000-0000000000e1', 'ca2a0000-0000-0000-0000-000000000002', 'owner', '{}'),
  ('ca2b0000-0000-0000-0000-0000000000e1', 'ca2a0000-0000-0000-0000-000000000003', 'member', '{}'),
  ('ca2b0000-0000-0000-0000-0000000000e1', 'ca2a0000-0000-0000-0000-00000000000a', 'member', '{}'),
  ('ca2b0000-0000-0000-0000-0000000000e1', 'ca2a0000-0000-0000-0000-00000000000c', 'owner', '{}'),
  ('ca2b0000-0000-0000-0000-0000000000e2', 'ca2a0000-0000-0000-0000-000000000004', 'owner', '{}'),
  ('ca2b0000-0000-0000-0000-0000000000e3', 'ca2a0000-0000-0000-0000-000000000005', 'owner', '{}'),
  ('ca2b0000-0000-0000-0000-0000000000e4', 'ca2a0000-0000-0000-0000-000000000006', 'owner', '{}'),
  ('ca2b0000-0000-0000-0000-0000000000e5', 'ca2a0000-0000-0000-0000-000000000007', 'owner', '{}'),
  ('ca2b0000-0000-0000-0000-0000000000e6', 'ca2a0000-0000-0000-0000-000000000008', 'owner', '{}'),
  ('ca2b0000-0000-0000-0000-0000000000e7', 'ca2a0000-0000-0000-0000-000000000009', 'owner', '{}'),
  ('ca2b0000-0000-0000-0000-00000000000b', 'ca2a0000-0000-0000-0000-00000000000a', 'owner', '{}'),
  ('ca2b0000-0000-0000-0000-00000000000b', 'ca2a0000-0000-0000-0000-00000000000d', 'member', '{}');

insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total)
select ('ca2c0000-0000-0000-0000-00000000000' || n)::uuid, 'ca2b0000-0000-0000-0000-00000000000b',
       'UW request ' || n, 'awarded', 'invited_only', 100
  from generate_series(1, 7) n;
insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity, submitted_at)
select ('ca2c1000-0000-0000-0000-00000000000' || n)::uuid, ('ca2c0000-0000-0000-0000-00000000000' || n)::uuid,
       ('ca2b0000-0000-0000-0000-0000000000e' || n)::uuid, 'accepted', 100, 1, now()
  from generate_series(1, 7) n;
insert into public.production_orders
  (id, rfq_id, quote_id, brand_org_id, factory_org_id, unit_price_cents, status, schedule_brand_agreed_at, schedule_brand_agreed_by,
   production_quantity, bulk_subtotal_cents, sample_subtotal_cents, order_total_cents, deposit_pct, balance_pct, order_number)
select ('ca2d0000-0000-0000-0000-00000000000' || n)::uuid, ('ca2c0000-0000-0000-0000-00000000000' || n)::uuid,
       ('ca2c1000-0000-0000-0000-00000000000' || n)::uuid, 'ca2b0000-0000-0000-0000-00000000000b',
       ('ca2b0000-0000-0000-0000-0000000000e' || n)::uuid, 100000, 'active', now() - interval '60 days',
       'ca2a0000-0000-0000-0000-00000000000a', 1, 100000, 0, 100000, 50, 50, 'UW-' || n
  from generate_series(1, 7) n;

-- Approved (owed), cleared steps. Step s of factory n was approved (10 - s)
-- days ago, so a lower s is older.
create temp table uw_steps (n int, s int, amount bigint) on commit drop;
insert into uw_steps values
  (1, 1, 10000), (1, 2, 10000), (1, 3, 10000),
  (2, 1, 10000), (2, 2, 10000), (2, 3, 10000),
  (3, 1, 10000), (3, 2, 10000),
  (4, 1, 10000), (4, 2, 10000),
  (5, 1, 10000), (5, 2, 1000), (5, 3, 2000), (5, 4, 4000), (5, 5, 8000), (5, 6, 16000), (5, 7, 32000), (5, 8, 64000),
  (6, 1, 10000),
  (7, 1, 10000), (7, 2, 10000), (7, 3, 10000);
insert into public.order_milestones (id, order_id, kind, title, amount_cents, state, sort, completed_at)
select ('ca2e000' || s || '-0000-0000-0000-00000000000' || n)::uuid, ('ca2d0000-0000-0000-0000-00000000000' || n)::uuid,
       'approval_and_payment', 'UW step ' || s, amount, 'complete', s * 10, now() - make_interval(days => 10 - s)
  from uw_steps;
insert into public.order_payments
  (id, order_id, milestone_id, amount_cents, currency, state, confirmed_at, release_requested_at,
   stripe_payment_intent_id, stripe_charge_id, funds_available_at)
select ('ca2f000' || s || '-0000-0000-0000-00000000000' || n)::uuid, ('ca2d0000-0000-0000-0000-00000000000' || n)::uuid,
       ('ca2e000' || s || '-0000-0000-0000-00000000000' || n)::uuid, amount, 'USD', 'confirmed',
       now() - interval '30 days', now() - make_interval(days => 10 - s),
       'pi_pgtap_uw_' || n || '_' || s, 'ch_pgtap_uw_' || n || '_' || s, now() - interval '20 days'
  from uw_steps;

-- e5's steps no road may take, and the ones only some may:
--   s1 $100   owed, cleared                              -> both roads
--   s2 $10    owed, still clearing                       -> neither
--   s3 $20    refunded after approval                    -> neither
--   s4 $40    a legacy PayPal payout still processing    -> neither
--   s5 $80    a legacy PayPal payout that failed (R1)    -> both roads
--   s6 $160   existing pool money (P3)                   -> pool only, never a take
--   s7 $320   the brand's charge is disputed             -> neither
--   s8 $640   no Stripe charge (confirmed by staff)      -> pool only
update public.order_payments set funds_available_at = now() + interval '2 days'
 where id = 'ca2f0002-0000-0000-0000-000000000005';
update public.order_payments set refunded_at = now() - interval '1 day'
 where id = 'ca2f0003-0000-0000-0000-000000000005';
update public.order_payments set withdrawal_pool = true
 where id = 'ca2f0006-0000-0000-0000-000000000005';
update public.order_payments set stripe_charge_id = null, stripe_payment_intent_id = null, funds_available_at = null
 where id = 'ca2f0008-0000-0000-0000-000000000005';
-- The dispute as the server records it from Stripe (record_payment_disputed is
-- exercised in section 5).
update public.order_payments set disputed_at = now() - interval '1 day'
 where id = 'ca2f0007-0000-0000-0000-000000000005';

-- Methods: a PayPal account for every factory; a Stripe account for e2..e5, e7.
insert into public.factory_payout_accounts (id, org_id, method, paypal_email, is_primary, details_changed_at)
select ('ca290000-0000-0000-0000-00000000000' || n)::uuid, ('ca2b0000-0000-0000-0000-0000000000e' || n)::uuid,
       'paypal', 'pgtap-uw-paypal-' || n || '@example.com', true, '2026-11-01'
  from generate_series(1, 7) n;
insert into public.stripe_connect_accounts (org_id, stripe_account_id, country, transfers_active, payouts_enabled, details_submitted)
select ('ca2b0000-0000-0000-0000-0000000000e' || n)::uuid, 'acct_pgtap_uw_' || n, 'US', true, true, true
  from unnest(array[2, 3, 4, 5, 7]) n;

-- The legacy per-step payouts on e5.
insert into public.provider_payouts (id, payment_id, factory_org_id, account_id, provider, status, paid_to, amount_cents, currency, failure_code, created_at)
values
  ('ca2a1000-0000-0000-0000-000000000004', 'ca2f0004-0000-0000-0000-000000000005', 'ca2b0000-0000-0000-0000-0000000000e5',
   'ca290000-0000-0000-0000-000000000005', 'paypal', 'processing', 'pgtap-uw-paypal-5@example.com', 4000, 'USD', null, now() - interval '1 hour'),
  ('ca2a1000-0000-0000-0000-000000000005', 'ca2f0005-0000-0000-0000-000000000005', 'ca2b0000-0000-0000-0000-0000000000e5',
   'ca290000-0000-0000-0000-000000000005', 'paypal', 'failed', 'pgtap-uw-paypal-5@example.com', 8000, 'USD', 'other', now() - interval '1 hour');

-- Stripe withdrawal rows as the server claims them before asking Stripe:
-- sw(n, k), claimed, nothing owed decided yet.
insert into public.stripe_withdrawals (id, org_id, stripe_account_id, request_key, request_id, amount_minor, currency, usd_cents, state)
select ('ca280000-0000-0000-0000-0000000000' || n || k)::uuid, ('ca2b0000-0000-0000-0000-0000000000e' || n)::uuid,
       'acct_pgtap_uw_' || n, 'pgtap-uw-sw-' || n || '-' || k, gen_random_uuid(), 100, 'USD', 100, 'claimed'
  from unnest(array[2, 3, 4, 5, 7]) n, generate_series(1, 4) k;
set local session_replication_role = origin;

-- ---------------------------------------------------------------------------
-- Helpers.
-- ---------------------------------------------------------------------------
create function pg_temp.act_as(who text) returns void language sql as $f$
  select set_config('request.jwt.claims',
    json_build_object('sub', 'ca2a0000-0000-0000-0000-' || lpad(who, 12, '0'), 'role', 'authenticated')::text, true);
$f$;
create function pg_temp.org(n int) returns uuid language sql immutable as $f$
  select ('ca2b0000-0000-0000-0000-0000000000e' || n)::uuid;
$f$;
create function pg_temp.pay(n int, s int) returns uuid language sql immutable as $f$
  select ('ca2f000' || s || '-0000-0000-0000-00000000000' || n)::uuid;
$f$;
create function pg_temp.acct(n int) returns uuid language sql immutable as $f$
  select ('ca290000-0000-0000-0000-00000000000' || n)::uuid;
$f$;
create function pg_temp.sw(n int, k int) returns uuid language sql immutable as $f$
  select ('ca280000-0000-0000-0000-0000000000' || n || k)::uuid;
$f$;
grant execute on function pg_temp.act_as(text), pg_temp.org(int), pg_temp.pay(int, int), pg_temp.acct(int), pg_temp.sw(int, int)
  to authenticated, anon, service_role;

-- An owner (or anyone) asks for a PayPal withdrawal, as authenticated.
create function pg_temp.ask(who text, n int, amount bigint) returns uuid language plpgsql as $f$
declare w uuid;
begin
  perform pg_temp.act_as(who);
  set local role authenticated;
  select (public.request_withdrawal(pg_temp.org(n), amount, pg_temp.acct(n))).id into w;
  reset role;
  return w;
end;
$f$;

-- The server claims owed steps for a Stripe withdrawal.
create function pg_temp.stripe_claim(n int, amount bigint, withdrawal uuid, road text default 'stripe') returns jsonb language plpgsql as $f$
declare r jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  set local role service_role;
  r := public.claim_owed_steps(pg_temp.org(n), amount, road, withdrawal);
  reset role;
  return r;
end;
$f$;

-- Run something as the server.
create function pg_temp.as_server(sql text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  set local role service_role;
  execute sql;
  reset role;
end;
$f$;

-- What has been given up from a step: held + sent takes.
create function pg_temp.taken(p uuid) returns bigint language sql as $f$
  select coalesce(sum(amount_cents), 0)::bigint from public.payment_takes
   where payment_id = p and status in ('held', 'sent');
$f$;
create function pg_temp.takes_on(p uuid, st text) returns bigint language sql as $f$
  select coalesce(sum(amount_cents), 0)::bigint from public.payment_takes where payment_id = p and status = st;
$f$;
create function pg_temp.take_of(p uuid, withdrawal uuid) returns bigint language sql as $f$
  select coalesce(sum(amount_cents), 0)::bigint from public.payment_takes
   where payment_id = p and (stripe_withdrawal_id = withdrawal or factory_withdrawal_id = withdrawal) and status in ('held', 'sent');
$f$;

-- The one balance, read as the factory's owner. Keys in cents.
create function pg_temp.bal(n int, k text) returns bigint language sql as $f$
  select (public.factory_balance(pg_temp.org(n)) ->> k)::bigint;
$f$;
create function pg_temp.reach(n int, k text) returns bigint language sql as $f$
  select (public.my_withdrawal_balance(pg_temp.org(n)) ->> k)::bigint;
$f$;
grant execute on function pg_temp.bal(int, text), pg_temp.reach(int, text) to authenticated, service_role;

-- Each dollar in exactly one figure: total = the sum of the four, and every
-- payment's rows add up to the payment.
create function pg_temp.figures_add_up(n int) returns boolean language sql as $f$
  with b as (select public.factory_balance(pg_temp.org(n)) j)
  select (j ->> 'total_cents')::bigint
           = (j ->> 'awaiting_cents')::bigint + (j ->> 'available_cents')::bigint
             + (j ->> 'pending_cents')::bigint + (j ->> 'paid_out_cents')::bigint
     and not exists (
       select 1 from public.order_payments p join public.production_orders o on o.id = p.order_id
        where o.factory_org_id = pg_temp.org(n) and p.state in ('confirmed', 'released') and not p.withdrawal_pool
          and p.refunded_at is null and p.disputed_at is null
          and p.amount_cents - coalesce(p.payout_fee_cents, 0) is distinct from (
            select sum((r ->> 'amount_cents')::bigint) from jsonb_array_elements(j -> 'rows') r
             where (r ->> 'payment_id')::uuid = p.id))
    from b;
$f$;
grant execute on function pg_temp.figures_add_up(int) to authenticated, service_role;

-- The figure(s) a payment is in, e.g. 'pending' or 'available,pending'.
create function pg_temp.fig(n int, p uuid) returns text language sql as $f$
  select string_agg(distinct r ->> 'figure', ',' order by r ->> 'figure')
    from jsonb_array_elements(public.factory_balance(pg_temp.org(n)) -> 'rows') r
   where (r ->> 'payment_id')::uuid = p;
$f$;
grant execute on function pg_temp.fig(int, uuid) to authenticated, service_role;

-- A Stripe claim on one payment, inside a withdrawal's claim: whatever the
-- answer, did it claim the row?
create function pg_temp.stripe_claimed_alone(p uuid) returns boolean language plpgsql as $f$
begin
  begin
    perform set_config('tsc.withdrawal_claim', 'on', true);
    perform public.claim_payment_release(p);
  exception when others then
    null;
  end;
  perform set_config('tsc.withdrawal_claim', '', true);
  return (select release_claimed_at is not null or stripe_release_started from public.order_payments where id = p);
end;
$f$;

-- ===========================================================================
-- 0. The new functions are not the client's to call. The one table is read
--    only, and only by its factory and staff.
-- ===========================================================================
select ok(not has_function_privilege('authenticated', 'public.claim_owed_steps(uuid, bigint, text, uuid)', 'execute'),
  'a signed-in person cannot call claim_owed_steps directly (request_withdrawal calls it)');
select ok(not has_function_privilege('anon', 'public.claim_owed_steps(uuid, bigint, text, uuid)', 'execute'), 'nor can anon');
select ok(has_function_privilege('service_role', 'public.claim_owed_steps(uuid, bigint, text, uuid)', 'execute'), 'the server can');
select ok(not has_function_privilege('authenticated', 'public.owed_reachable(uuid)', 'execute')
      and not has_function_privilege('anon', 'public.owed_reachable(uuid)', 'execute'), 'owed_reachable is internal');
select ok(not has_function_privilege('authenticated', 'public.record_take_sent(uuid, text)', 'execute')
      and not has_function_privilege('anon', 'public.record_take_sent(uuid, text)', 'execute'), 'record_take_sent is the server''s');
select ok(not has_function_privilege('authenticated', 'public.return_stripe_takes(uuid)', 'execute')
      and not has_function_privilege('anon', 'public.return_stripe_takes(uuid)', 'execute'), 'return_stripe_takes is the server''s');
select ok(not has_function_privilege('authenticated', 'public.return_take(uuid)', 'execute')
      and not has_function_privilege('anon', 'public.return_take(uuid)', 'execute'), 'return_take is the server''s');
select ok(not has_function_privilege('authenticated', 'public.record_payment_disputed(uuid, boolean)', 'execute')
      and not has_function_privilege('anon', 'public.record_payment_disputed(uuid, boolean)', 'execute'), 'record_payment_disputed is the server''s');
select ok(has_function_privilege('authenticated', 'public.request_withdrawal(uuid, bigint, uuid)', 'execute')
      and not has_function_privilege('anon', 'public.request_withdrawal(uuid, bigint, uuid)', 'execute'), 'request_withdrawal: signed in only');
select ok(not has_table_privilege('authenticated', 'public.payment_takes', 'insert')
      and not has_table_privilege('authenticated', 'public.payment_takes', 'update')
      and not has_table_privilege('authenticated', 'public.payment_takes', 'delete')
      and not has_table_privilege('anon', 'public.payment_takes', 'select'),
  'payment_takes: no client writes, nothing for anon');
select ok(not has_column_privilege('authenticated', 'public.order_payments', 'disputed_at', 'update')
      and not has_column_privilege('authenticated', 'public.factory_withdrawals', 'pool_cents', 'update')
      and not has_column_privilege('authenticated', 'public.stripe_withdrawals', 'owed_cents', 'update'),
  'the new columns cannot be written by clients');
-- Both roads take the same lock before claiming (situation 8).
select ok(pg_get_functiondef('public.claim_owed_steps(uuid, bigint, text, uuid)'::regprocedure) ~* 'public\.orgs[^;]*for update',
  'claim_owed_steps locks the company row, the same lock request_withdrawal takes');

-- What each road can reach, before anything is withdrawn.
select pg_temp.act_as('07'); set local role authenticated;
select is(pg_temp.reach(5, 'available_cents'), (16000 + 10000 + 8000 + 64000)::bigint,
  'e5: PayPal reaches pool money + owed cleared steps (not clearing, refunded, processing or disputed ones)');
select is(pg_temp.reach(5, 'pool_cents'), 16000::bigint, 'e5: of which existing pool money');
select is(pg_temp.reach(5, 'owed_cents'), (10000 + 8000 + 64000)::bigint, 'e5: and owed cleared money');
select is(pg_temp.reach(5, 'stripe_owed_cents'), (10000 + 8000)::bigint,
  'e5: Stripe reaches only owed cleared steps with a charge: never pool money, never a step with no charge');
-- R1: the failed legacy attempt's step is Available again.
select is(pg_temp.fig(5, pg_temp.pay(5, 5)), 'available', 'R1: a step whose legacy PayPal payout failed is Available again');
select is(pg_temp.fig(5, pg_temp.pay(5, 4)), 'pending', 'a step whose legacy payout is still processing stays Pending');
select is(pg_temp.fig(5, pg_temp.pay(5, 2)), 'pending', 'an uncleared step is Pending');
select ok(pg_temp.fig(5, pg_temp.pay(5, 7)) is distinct from 'available', 'a disputed step is not Available');
select is(pg_temp.fig(5, pg_temp.pay(5, 3)), null, 'a refunded step is in no figure');
reset role;
select pg_temp.act_as('0b'); set local role authenticated;
select ok(exists (select 1 from public.admin_payment_board() b where b.payment_id = pg_temp.pay(5, 5) and b.provider_status = 'failed'),
  'R1: and the board still shows the failed attempt');
reset role;

-- ===========================================================================
-- 1. The pool road, exact amounts (P1), e1: three $100 steps, PayPal.
-- ===========================================================================
select pg_temp.act_as('01'); set local role authenticated;
select is(pg_temp.reach(1, 'available_cents'), 30000::bigint, 'e1: all three approved steps are reachable by PayPal');
select is(pg_temp.bal(1, 'available_cents'), 30000::bigint, 'e1: and Available');
reset role;

-- Amounts that are not amounts.
select throws_ok($$select pg_temp.ask('01', 1, 0)$$, '22023', null, 'a withdrawal of $0 is refused');
select throws_ok($$select pg_temp.ask('01', 1, -100)$$, '22023', null, 'a negative withdrawal is refused');
select throws_ok($$select pg_temp.ask('01', 1, null)$$, '22023', null, 'a withdrawal with no amount is refused');
select throws_ok($$select pg_temp.ask('01', 1, 30001)$$, '22023', 'That is more than your balance.', 'a cent over the balance is refused');

-- The wrong people.
select throws_ok($$select pg_temp.ask('03', 1, 100)$$, '42501', null, 'a member who is not an owner cannot withdraw');
select throws_ok($$select pg_temp.ask('08', 1, 100)$$, '42501', null, 'another factory''s owner cannot withdraw this factory''s money');
select throws_ok($$select pg_temp.ask('0a', 1, 100)$$, '42501', null, 'two hats: the brand''s owner, a member of the factory, cannot withdraw it');
select throws_ok($$select pg_temp.ask('0d', 1, 100)$$, '42501', null, 'a brand member cannot withdraw a factory''s money');
select throws_ok($$select pg_temp.ask('0b', 1, 100)$$, '42501', null, 'staff who are not in the company cannot withdraw for it');
select throws_ok($$
  select pg_temp.act_as('0a');
  set local role authenticated;
  select public.request_withdrawal('ca2b0000-0000-0000-0000-00000000000b', 100, pg_temp.acct(1));
$$, null, null, 'two hats: the brand owner cannot withdraw on the brand''s side with the factory''s method');
reset role;
select throws_ok($$
  select set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  select public.request_withdrawal(pg_temp.org(1), 100, pg_temp.acct(1));
$$, '42501', null, 'signed out: refused');
reset role;
select throws_ok($$
  select pg_temp.act_as('01');
  set local role authenticated;
  select public.claim_owed_steps(pg_temp.org(1), 100, 'pool', null);
$$, '42501', null, 'an owner cannot call the claim directly');
reset role;
select is((select count(*)::int from public.payment_takes where org_id = pg_temp.org(1)), 0, 'none of that took anything');
select is((select count(*)::int from public.factory_withdrawals where org_id in (pg_temp.org(1), 'ca2b0000-0000-0000-0000-00000000000b')), 0,
  'and opened no withdrawal');

-- $150 from two $100 steps takes 100 + 50.
select set_config('tsc.uw_a', pg_temp.ask('01', 1, 15000)::text, true);
select ok(coalesce(current_setting('tsc.withdrawal_claim', true), '') <> 'on', 'the claim setting is not left on after request_withdrawal');
select is(public.claim_payment_release(pg_temp.pay(1, 3)), null::timestamptz, 'so the next statement cannot claim another owed step for Stripe');
select is(pg_temp.take_of(pg_temp.pay(1, 1), current_setting('tsc.uw_a')::uuid), 10000::bigint, 'exact amount: $150 takes the oldest step whole');
select is(pg_temp.take_of(pg_temp.pay(1, 2), current_setting('tsc.uw_a')::uuid), 5000::bigint, 'and $50 of the next');
select is(pg_temp.taken(pg_temp.pay(1, 3)), 0::bigint, 'and nothing of the newest');
select is((select road from public.payment_takes where factory_withdrawal_id = current_setting('tsc.uw_a')::uuid group by road), 'pool',
  'the takes are the pool road''s');
select is((select status from public.payment_takes where factory_withdrawal_id = current_setting('tsc.uw_a')::uuid group by status), 'held',
  'held while the withdrawal waits');
select ok((select amount_cents = coalesce(pool_cents, 0) + 15000 and pool_cents = 0
             from public.factory_withdrawals where id = current_setting('tsc.uw_a')::uuid),
  'the withdrawal is the takes plus pool money (none here)');
select ok((select not withdrawal_pool from public.order_payments where id = pg_temp.pay(1, 2)),
  'a claimed step does not join the old pool');
select pg_temp.act_as('01'); set local role authenticated;
select is(pg_temp.reach(1, 'available_cents'), 15000::bigint, 'the $50 left on the step and the newest step are still reachable');
select is(pg_temp.bal(1, 'available_cents'), 15000::bigint, 'Available $150');
select is(pg_temp.bal(1, 'pending_cents'), 15000::bigint, 'Pending $150: the withdrawal');
select is(pg_temp.bal(1, 'total_cents'), 30000::bigint, 'total unchanged');
select ok(pg_temp.figures_add_up(1), 'each dollar in exactly one figure');
select is(pg_temp.fig(1, pg_temp.pay(1, 2)), 'available,pending', 'the half-taken step is half Pending, half Available');
reset role;

-- The second owner's later withdrawal uses the remainder before newer steps.
select set_config('tsc.uw_b', pg_temp.ask('02', 1, 5000)::text, true);
select is(pg_temp.take_of(pg_temp.pay(1, 2), current_setting('tsc.uw_b')::uuid), 5000::bigint,
  'a later withdrawal takes the $50 left on the older step');
select is(pg_temp.taken(pg_temp.pay(1, 3)), 0::bigint, 'before touching the newer step');
select is(pg_temp.taken(pg_temp.pay(1, 2)), 10000::bigint, 'the older step is now taken in full, by two withdrawals');

-- The whole balance from two tabs / two owners: the second is refused.
select set_config('tsc.uw_c', pg_temp.ask('01', 1, 10000)::text, true);
select throws_ok($$select pg_temp.ask('02', 1, 10000)$$, '22023', 'That is more than your balance.',
  'two owners: the same whole balance asked twice, the second is refused');
select throws_ok($$select pg_temp.ask('01', 1, 1)$$, '22023', 'That is more than your balance.', 'and not a cent more from the same tab');
select pg_temp.act_as('01'); set local role authenticated;
select is(pg_temp.reach(1, 'available_cents'), 0::bigint, 'nothing left to reach');
select is(pg_temp.bal(1, 'available_cents'), 0::bigint, 'Available $0, never below');
select ok(pg_temp.figures_add_up(1), 'each dollar still in one figure');
reset role;

-- A step a PayPal withdrawal holds cannot be paid by the old per-step paths.
select throws_ok($$
  select pg_temp.act_as('0b'); set local role authenticated;
  select public.claim_provider_payout(pg_temp.pay(1, 3), 'paypal', '2026-11-01'::timestamptz, false);
$$, '22023', 'this payment is in the factory''s balance: it is paid when the factory withdraws',
  'staff cannot open a per-step PayPal payout on a step a withdrawal holds');
reset role;
select throws_ok($$
  select pg_temp.act_as('0b'); set local role authenticated;
  select public.release_payment_to_factory(pg_temp.pay(1, 3), 'paid by hand', '2026-11-01'::timestamptz);
$$, '22023', 'this payment is in the factory''s balance: it is paid when the factory withdraws',
  'nor mark it paid by bank');
reset role;
select ok((select state = 'confirmed' from public.order_payments where id = pg_temp.pay(1, 3)), 'the held step is untouched');

-- Staff in the factory cannot pay its own withdrawal.
select throws_ok($$
  select pg_temp.act_as('0c');
  set local role authenticated;
  select public.claim_withdrawal(current_setting('tsc.uw_c')::uuid);
$$, '42501', null, 'staff who own the factory cannot approve its withdrawal');
reset role;
select throws_ok($$
  select pg_temp.act_as('0c');
  set local role authenticated;
  select public.mark_withdrawal_paid_by_bank(current_setting('tsc.uw_c')::uuid, 'REF-1');
$$, '42501', null, 'nor mark it paid');
reset role;

-- Cancelled: the takes go back.
select pg_temp.act_as('02'); set local role authenticated;
select lives_ok($$select public.cancel_withdrawal(current_setting('tsc.uw_c')::uuid)$$, 'the other owner cancels the third withdrawal');
reset role;
select is(pg_temp.takes_on(pg_temp.pay(1, 3), 'returned'), 10000::bigint, 'its take is returned');
select is(pg_temp.taken(pg_temp.pay(1, 3)), 0::bigint, 'and the step is whole again');
select pg_temp.act_as('01'); set local role authenticated;
select is(pg_temp.reach(1, 'available_cents'), 10000::bigint, 'and reachable again');
reset role;

-- Paid: the takes are sent; a step is released only once fully sent.
select lives_ok(format($$select pg_temp.as_server(%L)$$,
  format('select public.record_withdrawal(%L, ''paid'', ''pp-uw-a'', 300, 14700, ''USD'', null)', current_setting('tsc.uw_a'))),
  'the first withdrawal is paid, fee $3');
select is(pg_temp.takes_on(pg_temp.pay(1, 1), 'sent'), 10000::bigint, 'its takes are sent');
select ok((select state = 'released' and released_note = 'Withdrawn' and stripe_transfer_id is null from public.order_payments where id = pg_temp.pay(1, 1)),
  'the step it took in full is released, by withdrawal, with no Stripe transfer');
select ok((select state = 'confirmed' from public.order_payments where id = pg_temp.pay(1, 2)),
  'the step half-sent (the other half still held) is not released yet');
select pg_temp.act_as('01'); set local role authenticated;
select is(pg_temp.bal(1, 'paid_out_cents'), (15000 - 300)::bigint, 'Paid out is the withdrawal less its fee');
select is(pg_temp.bal(1, 'pending_cents'), 5000::bigint, 'Pending is the other withdrawal');
select is(pg_temp.bal(1, 'available_cents'), 10000::bigint, 'Available is the newest step');
select is(pg_temp.bal(1, 'total_cents'), (30000 - 300)::bigint, 'the fee is in no figure');
reset role;
select lives_ok(format($$select pg_temp.as_server(%L)$$,
  format('select public.record_withdrawal(%L, ''paid'', ''pp-uw-b'', 0, 5000, ''USD'', null)', current_setting('tsc.uw_b'))),
  'the second withdrawal is paid');
select ok((select state = 'released' from public.order_payments where id = pg_temp.pay(1, 2)), 'now the step two withdrawals shared is released');

-- A take can never be more than what is left on a step, whoever writes it.
select throws_ok(format($$insert into public.payment_takes (payment_id, org_id, road, factory_withdrawal_id, amount_cents, status)
                          values (%L, %L, 'pool', %L, 1, 'held')$$, pg_temp.pay(1, 1), pg_temp.org(1), current_setting('tsc.uw_b')),
  null, null, 'the database refuses a take on a step already taken in full');

-- ===========================================================================
-- 2. The Stripe road, exact amounts, and the pool road after it (e2).
-- ===========================================================================
select set_config('tsc.uw_s1', pg_temp.stripe_claim(2, 15000, pg_temp.sw(2, 1))::text, true);
select is((current_setting('tsc.uw_s1')::jsonb ->> 'claimed_cents')::bigint, 15000::bigint, 'Stripe: exactly $150 claimed');
select is(pg_temp.take_of(pg_temp.pay(2, 1), pg_temp.sw(2, 1)), 10000::bigint, 'Stripe: the oldest step whole');
select is(pg_temp.take_of(pg_temp.pay(2, 2), pg_temp.sw(2, 1)), 5000::bigint, 'Stripe: $50 of the next');
select is(pg_temp.taken(pg_temp.pay(2, 3)), 0::bigint, 'Stripe: nothing of the newest');
select is(jsonb_array_length(current_setting('tsc.uw_s1')::jsonb -> 'takes'), 2, 'the answer lists the two takes');
select ok((select bool_and(t ->> 'charge_id' like 'ch_pgtap_uw_2_%') from jsonb_array_elements(current_setting('tsc.uw_s1')::jsonb -> 'takes') t),
  'each with the charge it transfers from');
select is((select owed_cents from public.stripe_withdrawals where id = pg_temp.sw(2, 1)), 15000::bigint, 'the Stripe withdrawal owns its claim');
select is((select string_agg(distinct road, ',') from public.payment_takes where stripe_withdrawal_id = pg_temp.sw(2, 1)), 'stripe', 'on the Stripe road');
select ok((select release_claimed_at is null and not stripe_release_started and not withdrawal_pool and stripe_transfer_id is null
             from public.order_payments where id = pg_temp.pay(2, 3)), 'the unclaimed step is untouched');
-- The setting that lets a withdrawal claim is not left on.
select ok(coalesce(current_setting('tsc.withdrawal_claim', true), '') <> 'on', 'tsc.withdrawal_claim is off once the claim returns');
select is(public.claim_payment_release(pg_temp.pay(2, 3)), null::timestamptz,
  'so the next statement cannot claim another owed step for a transfer');
select ok((select release_claimed_at is null from public.order_payments where id = pg_temp.pay(2, 3)), 'and it stays unclaimed');

-- The same Stripe withdrawal twice, another company's, a road that is not one.
-- Asked again for the same Stripe withdrawal (a call resumed after a crash):
-- refused, or answered with the claim it already has; never a second claim.
create function pg_temp.claim_again(n int, amount bigint, withdrawal uuid) returns void language plpgsql as $f$
begin
  perform pg_temp.stripe_claim(n, amount, withdrawal);
exception when others then
  null;
end;
$f$;
select pg_temp.claim_again(2, 100, pg_temp.sw(2, 1));
select pg_temp.claim_again(2, 15000, pg_temp.sw(2, 1));
select is((select sum(amount_cents)::bigint from public.payment_takes where stripe_withdrawal_id = pg_temp.sw(2, 1) and status in ('held', 'sent')),
  15000::bigint, 'a Stripe withdrawal claimed again claims nothing more');
select is((select owed_cents from public.stripe_withdrawals where id = pg_temp.sw(2, 1)), 15000::bigint, 'and keeps its first claim');
select throws_ok($$select pg_temp.stripe_claim(3, 100, pg_temp.sw(2, 2))$$, '22023', null, 'nor claim for another company''s withdrawal');
select throws_ok($$select pg_temp.stripe_claim(2, 100, pg_temp.sw(2, 2), 'cash')$$, '22023', null, 'nor by a road that is not one');
select throws_ok($$select pg_temp.stripe_claim(2, 0, pg_temp.sw(2, 2))$$, '22023', null, 'Stripe: $0 refused');
select throws_ok($$select pg_temp.stripe_claim(2, -1, pg_temp.sw(2, 2))$$, '22023', null, 'Stripe: negative refused');
select throws_ok($$select pg_temp.stripe_claim(2, 15001, pg_temp.sw(2, 2))$$, '22023', null, 'Stripe: more than is left refused');
select is((select owed_cents from public.stripe_withdrawals where id = pg_temp.sw(2, 2)), null::bigint, 'and the refused one owns nothing');

-- The remaining $50 is withdrawable by PayPal, and is used before the newer step.
select pg_temp.act_as('04'); set local role authenticated;
select is(pg_temp.reach(2, 'available_cents'), 15000::bigint, 'after Stripe took $150, PayPal reaches the $50 left and the newest step');
select is(pg_temp.reach(2, 'stripe_owed_cents'), 15000::bigint, 'and so does Stripe');
reset role;
select set_config('tsc.uw_p2', pg_temp.ask('04', 2, 5000)::text, true);
select is(pg_temp.take_of(pg_temp.pay(2, 2), current_setting('tsc.uw_p2')::uuid), 5000::bigint,
  'PayPal takes the $50 Stripe left on the step');
select is(pg_temp.taken(pg_temp.pay(2, 3)), 0::bigint, 'before the newer step');
select is(pg_temp.taken(pg_temp.pay(2, 2)), 10000::bigint, 'the step is split between the two roads, in full, never more');

-- Stripe transfers go: the step Stripe took whole is released with its transfer.
select lives_ok(format($$select pg_temp.as_server(%L)$$,
  (select string_agg(format('select public.record_take_sent(%L, %L);', id, 'tr_pgtap_uw_' || substr(payment_id::text, 1, 8)), ' ')
     from public.payment_takes where stripe_withdrawal_id = pg_temp.sw(2, 1))),
  'the server records both Stripe transfers');
select is(pg_temp.takes_on(pg_temp.pay(2, 1), 'sent'), 10000::bigint, 'Stripe takes are sent');
select ok((select state = 'released' and stripe_transfer_id = 'tr_pgtap_uw_ca2f0001' from public.order_payments where id = pg_temp.pay(2, 1)),
  'the step paid in full by Stripe is released with its transfer');
select ok((select state = 'confirmed' from public.order_payments where id = pg_temp.pay(2, 2)),
  'the split step waits for its PayPal half');
select pg_temp.act_as('04'); set local role authenticated;
select ok(pg_temp.figures_add_up(2), 'e2: each dollar in one figure mid-way');
reset role;
select lives_ok(format($$select pg_temp.as_server(%L)$$,
  format('select public.record_withdrawal(%L, ''paid'', ''pp-uw-2'', 0, 5000, ''USD'', null)', current_setting('tsc.uw_p2'))),
  'the PayPal withdrawal is paid');
select ok((select state = 'released' and stripe_transfer_id is null from public.order_payments where id = pg_temp.pay(2, 2)),
  'a step paid by both roads is released with no stripe_transfer_id (it was not paid in full by Stripe)');
-- The released step cannot be taken again by either road.
select throws_ok($$select pg_temp.stripe_claim(2, 10001, pg_temp.sw(2, 2))$$, '22023', null, 'Stripe cannot reach past what is left');

-- A Stripe withdrawal that ends with nothing sent gives its takes back.
select lives_ok($$select pg_temp.stripe_claim(2, 4000, pg_temp.sw(2, 3))$$, 'Stripe claims $40 of the newest step');
select is(pg_temp.taken(pg_temp.pay(2, 3)), 4000::bigint, 'held');
select lives_ok(format($$select pg_temp.as_server(%L)$$, format('select public.return_stripe_takes(%L)', pg_temp.sw(2, 3))),
  'the transfer never went: the server returns the takes');
select is(pg_temp.taken(pg_temp.pay(2, 3)), 0::bigint, 'the step is whole again');
select is(pg_temp.takes_on(pg_temp.pay(2, 3), 'returned'), 4000::bigint, 'the take is kept, as returned');
select pg_temp.act_as('04'); set local role authenticated;
select is(pg_temp.bal(2, 'available_cents'), 10000::bigint, 'and Available again');
select ok(pg_temp.figures_add_up(2), 'e2: each dollar in one figure at the end');
reset role;

-- ===========================================================================
-- 3. Stripe then pool, and Stripe twice (e3): the whole balance to Stripe.
-- ===========================================================================
select lives_ok($$select pg_temp.stripe_claim(3, 20000, pg_temp.sw(3, 1))$$, 'e3: Stripe claims the whole balance');
select throws_ok($$select pg_temp.stripe_claim(3, 1, pg_temp.sw(3, 2))$$, '22023', null, 'Stripe twice: a second Stripe withdrawal is refused');
select throws_ok($$select pg_temp.ask('05', 3, 1)$$, '22023', 'That is more than your balance.', 'Stripe then PayPal: refused');
select is((select count(*)::int from public.factory_withdrawals where org_id = pg_temp.org(3)), 0, 'no PayPal withdrawal was opened');
select pg_temp.act_as('05'); set local role authenticated;
select is(pg_temp.reach(3, 'available_cents'), 0::bigint, 'e3: PayPal reaches nothing');
select is(pg_temp.bal(3, 'available_cents'), 0::bigint, 'e3: Available $0');
select is(pg_temp.bal(3, 'pending_cents'), 20000::bigint, 'e3: Pending $200 while Stripe sends it');
select ok(pg_temp.figures_add_up(3), 'e3: each dollar in one figure');
reset role;

-- ===========================================================================
-- 4. Pool then Stripe, and pool twice (e4).
-- ===========================================================================
select lives_ok($$select pg_temp.ask('06', 4, 20000)$$, 'e4: PayPal asks for the whole balance');
select throws_ok($$select pg_temp.stripe_claim(4, 1, pg_temp.sw(4, 1))$$, '22023', null, 'PayPal then Stripe: refused');
select throws_ok($$select pg_temp.ask('06', 4, 1)$$, '22023', 'That is more than your balance.', 'PayPal twice: refused');
select is((select count(*)::int from public.payment_takes where org_id = pg_temp.org(4) and road = 'stripe'), 0, 'no Stripe take on e4');
select is((select owed_cents from public.stripe_withdrawals where id = pg_temp.sw(4, 1)), null::bigint, 'the Stripe withdrawal owns nothing');

-- ===========================================================================
-- 5. Steps no road may take (e5).
-- ===========================================================================
update public.order_payments set disputed_at = null where id = pg_temp.pay(5, 7);
select lives_ok(format($$select pg_temp.as_server(%L)$$, format('select public.record_payment_disputed(%L, true)', pg_temp.pay(5, 7))),
  'the server records the brand''s dispute');
select ok((select disputed_at is not null from public.order_payments where id = pg_temp.pay(5, 7)), 'disputed_at is set');
select pg_temp.act_as('07'); set local role authenticated;
select is(pg_temp.fig(5, pg_temp.pay(5, 7)), 'pending', 'a disputed owed step is Pending');
reset role;

select throws_ok($$select pg_temp.stripe_claim(5, 18001, pg_temp.sw(5, 1))$$, '22023', null,
  'Stripe cannot reach pool money, uncleared, refunded, processing, disputed or charge-less steps');
select lives_ok($$select pg_temp.stripe_claim(5, 18000, pg_temp.sw(5, 1))$$, 'Stripe takes exactly what it can reach');
select is(pg_temp.taken(pg_temp.pay(5, 1)), 10000::bigint, 'the clean step');
select is(pg_temp.taken(pg_temp.pay(5, 5)), 8000::bigint, 'R1: and the step whose legacy payout failed');
select ok(coalesce(current_setting('tsc.withdrawal_claim', true), '') <> 'on', 'the claim setting is off again');

select throws_ok($$select pg_temp.ask('07', 5, 80001)$$, '22023', 'That is more than your balance.',
  'PayPal cannot reach uncleared, refunded, processing or disputed steps');
select set_config('tsc.uw_p5', pg_temp.ask('07', 5, 80000)::text, true);
select ok((select pool_cents = 16000 from public.factory_withdrawals where id = current_setting('tsc.uw_p5')::uuid),
  'PayPal takes existing pool money first');
select is(pg_temp.take_of(pg_temp.pay(5, 8), current_setting('tsc.uw_p5')::uuid), 64000::bigint, 'then the step with no Stripe charge');
select is((select count(*)::int from public.payment_takes
            where payment_id in (pg_temp.pay(5, 2), pg_temp.pay(5, 3), pg_temp.pay(5, 4), pg_temp.pay(5, 6), pg_temp.pay(5, 7))), 0,
  'nothing was ever taken from an uncleared, refunded, processing, pool or disputed step');

-- The legacy per-step paths refuse a step a withdrawal claimed.
select throws_ok($$
  select pg_temp.act_as('0b'); set local role authenticated;
  select public.release_payment_to_factory(pg_temp.pay(5, 8), 'paid by hand', '2026-11-01'::timestamptz);
$$, '22023', 'this payment is in the factory''s balance: it is paid when the factory withdraws', 'staff cannot mark a claimed step paid by bank');
reset role;
select throws_ok($$
  select pg_temp.act_as('0b'); set local role authenticated;
  select public.claim_provider_payout(pg_temp.pay(5, 5), 'paypal', '2026-11-01'::timestamptz, false);
$$, '22023', null, 'R1: staff cannot "Pay again" a failed step once a withdrawal claimed it');
reset role;
select throws_ok($$
  select pg_temp.act_as('0b'); set local role authenticated;
  select public.claim_provider_payout(pg_temp.pay(5, 8), 'paypal', '2026-11-01'::timestamptz, false);
$$, '22023', 'this payment is in the factory''s balance: it is paid when the factory withdraws', 'nor open a new per-step payout on a pool-claimed step');
reset role;
select ok(not pg_temp.stripe_claimed_alone(pg_temp.pay(5, 1)), 'nor can the legacy Stripe claim take a claimed step, even inside a claim');
select ok(not pg_temp.stripe_claimed_alone(pg_temp.pay(5, 8)), 'nor a pool-claimed one');
select ok((select count(*) = 0 from public.provider_payouts where payment_id in (pg_temp.pay(5, 5), pg_temp.pay(5, 8))
             and id <> 'ca2a1000-0000-0000-0000-000000000005'), 'no new per-step payout row exists');

select ok((select state = 'confirmed' and released_at is null from public.order_payments where id = pg_temp.pay(5, 8)),
  'the claimed step is still unpaid');

-- A pool withdrawal whose claimed step was refunded since cannot be approved.
set local session_replication_role = replica;
update public.order_payments set refunded_at = now() where id = pg_temp.pay(5, 8);
set local session_replication_role = origin;
select throws_ok($$
  select pg_temp.act_as('0b'); set local role authenticated;
  select public.claim_withdrawal(current_setting('tsc.uw_p5')::uuid);
$$, '22023', null, 'staff cannot pay a withdrawal whose step was refunded since it was asked');
reset role;

-- ===========================================================================
-- 6. Each dollar in exactly one figure, through every step of both roads (e7).
-- ===========================================================================
create function pg_temp.four(n int) returns text language sql as $f$
  select format('%s/%s/%s/%s=%s', j ->> 'awaiting_cents', j ->> 'available_cents', j ->> 'pending_cents', j ->> 'paid_out_cents', j ->> 'total_cents')
    from (select public.factory_balance(pg_temp.org(n)) j) b;
$f$;
grant execute on function pg_temp.four(int) to authenticated;

select pg_temp.act_as('09'); set local role authenticated;
select is(pg_temp.four(7), '0/30000/0/0=30000', 'figures start: $300 Available');
reset role;
select lives_ok($$select pg_temp.stripe_claim(7, 15000, pg_temp.sw(7, 1))$$, 'Stripe claims $150');
select pg_temp.act_as('09'); set local role authenticated;
select is(pg_temp.four(7), '0/15000/15000/0=30000', 'claimed by Stripe: Pending, not Available');
select ok(pg_temp.figures_add_up(7), 'rows add up');
reset role;
select lives_ok(format($$select pg_temp.as_server(%L)$$,
  (select string_agg(format('select public.record_take_sent(%L, %L);', id, 'tr_pgtap_uw_7_' || substr(payment_id::text, 1, 8)), ' ')
     from public.payment_takes where stripe_withdrawal_id = pg_temp.sw(7, 1))),
  'the transfers are recorded');
select pg_temp.act_as('09'); set local role authenticated;
select is(pg_temp.four(7), '0/15000/0/15000=30000', 'sent to Stripe: Paid out here (the server re-splits it from Stripe)');
select is((public.factory_balance(pg_temp.org(7)) -> 'parts' ->> 'stripe_released_cents')::bigint, 15000::bigint,
  'and counted as Stripe-released, including the partial step');
select ok(exists (select 1 from jsonb_array_elements(public.factory_balance(pg_temp.org(7)) -> 'rows') r
                   where (r ->> 'payment_id')::uuid = pg_temp.pay(7, 2) and r ->> 'figure' = 'paid_out' and (r ->> 'stripe')::boolean
                     and (r ->> 'amount_cents')::bigint = 5000),
  'the Stripe half of the split step is a Stripe paid-out row of $50');
select ok(pg_temp.figures_add_up(7), 'rows add up');
reset role;
select set_config('tsc.uw_p7', pg_temp.ask('09', 7, 10000)::text, true);
select is(pg_temp.take_of(pg_temp.pay(7, 2), current_setting('tsc.uw_p7')::uuid), 5000::bigint, 'PayPal takes the $50 left first');
select is(pg_temp.take_of(pg_temp.pay(7, 3), current_setting('tsc.uw_p7')::uuid), 5000::bigint, 'then $50 of the newest');
select pg_temp.act_as('09'); set local role authenticated;
select is(pg_temp.four(7), '0/5000/10000/15000=30000', 'PayPal asked: Pending');
select ok(pg_temp.figures_add_up(7), 'rows add up');
reset role;
select lives_ok(format($$select pg_temp.as_server(%L)$$,
  format('select public.record_withdrawal(%L, ''paid'', ''pp-uw-7'', 200, 9800, ''USD'', null)', current_setting('tsc.uw_p7'))),
  'PayPal pays it, fee $2');
select pg_temp.act_as('09'); set local role authenticated;
select is(pg_temp.four(7), '0/5000/0/24800=29800', 'paid: Paid out net of the fee; the fee is in no figure');
reset role;
select ok((select state = 'released' and stripe_transfer_id is not null from public.order_payments where id = pg_temp.pay(7, 1)),
  'the step Stripe paid in full is released with its transfer');
select ok((select state = 'released' and stripe_transfer_id is null from public.order_payments where id = pg_temp.pay(7, 2)),
  'the split step is released without one');
select ok((select state = 'confirmed' from public.order_payments where id = pg_temp.pay(7, 3)), 'the half-taken step is not released');

-- ===========================================================================
-- 7. Who reads the takes.
-- ===========================================================================
select pg_temp.act_as('03'); set local role authenticated;
select ok((select count(*) from public.payment_takes where org_id = pg_temp.org(1)) > 0, 'a member reads its factory''s takes');
reset role;
select pg_temp.act_as('08'); set local role authenticated;
select is((select count(*)::int from public.payment_takes where org_id <> pg_temp.org(6) and org_id::text like 'ca2b%'), 0,
  'another factory reads none');
select throws_ok($$update public.payment_takes set status = 'returned'$$, '42501', null, 'and cannot write');
reset role;
select pg_temp.act_as('0d'); set local role authenticated;
select is((select count(*)::int from public.payment_takes where org_id::text like 'ca2b%'), 0, 'the brand reads none');
reset role;
select pg_temp.act_as('01'); set local role authenticated;
select throws_ok($$update public.payment_takes set status = 'returned' where org_id = pg_temp.org(1)$$, '42501', null, 'the owner cannot return a take');
select throws_ok($$delete from public.payment_takes where org_id = pg_temp.org(1)$$, '42501', null, 'nor delete one');
select throws_ok(format($$insert into public.payment_takes (payment_id, org_id, road, amount_cents, status) values (%L, %L, 'pool', 1, 'returned')$$,
  pg_temp.pay(1, 3), pg_temp.org(1)), '42501', null, 'nor write one');
reset role;
select pg_temp.act_as('0b'); set local role authenticated;
select ok((select count(*) from public.payment_takes where org_id::text like 'ca2b%') > 0, 'staff read them');
reset role;
select throws_ok($$
  select set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  select count(*) from public.payment_takes;
$$, '42501', null, 'anon reads nothing');
reset role;

-- ===========================================================================
-- 8. Never twice, never below zero, across every fixture.
-- ===========================================================================
select is((select count(*)::int from public.order_payments p join public.production_orders o on o.id = p.order_id
            where o.factory_org_id::text like 'ca2b%'
              and pg_temp.taken(p.id) > p.amount_cents - coalesce(p.payout_fee_cents, 0)), 0,
  'no step''s held + sent takes ever exceed its amount');
select is((select count(*)::int from public.payment_takes t join public.order_payments p on p.id = t.payment_id
            where t.org_id::text like 'ca2b%' and p.withdrawal_pool), 0, 'no take on existing pool money');
select is((select count(*)::int from public.payment_takes t
            where t.org_id::text like 'ca2b%'
              and ((t.road = 'stripe') <> (t.stripe_withdrawal_id is not null) or (t.road = 'pool') <> (t.factory_withdrawal_id is not null))), 0,
  'every take belongs to exactly one withdrawal of its road');
select is((select count(*)::int from public.factory_withdrawals w
            where w.org_id::text like 'ca2b%' and w.status in ('requested', 'paying', 'paid')
              and w.amount_cents <> coalesce(w.pool_cents, w.amount_cents)
                 + coalesce((select sum(t.amount_cents) from public.payment_takes t
                              where t.factory_withdrawal_id = w.id and t.status in ('held', 'sent')), 0)), 0,
  'every open or paid PayPal withdrawal is exactly its pool money plus its takes');
select pg_temp.act_as('0b'); set local role authenticated;
select is((select count(*)::int from generate_series(1, 7) n where pg_temp.bal(n, 'available_cents') < 0 or pg_temp.reach(n, 'available_cents') < 0), 0,
  'no balance below zero');
reset role;

select * from finish();
rollback;
