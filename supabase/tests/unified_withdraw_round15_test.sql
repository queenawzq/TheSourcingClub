-- One balance, fix round 15: a paid withdrawal from before one balance never
-- puts a new one on hold.
--
-- The demo seed inserted a paid PayPal withdrawal by hand: no pool money
-- behind it and no step taken, so factory_withdrawable() went negative and the
-- factory's next withdrawal read "On hold". Production cannot hold that shape:
-- every request_withdrawal() on main checked the amount against the pool
-- (factory_withdrawable() was pool money only), and pool money never leaves
-- the pool (guard_withdrawal_pool). These pin the two shapes real data has:
--
-- 1. A withdrawal paid before one balance (pool_cents null, no takes) with the
--    pool payment it was paid from: the factory's next withdrawal, of an owed
--    step, is waiting, not on hold, on the card, in its parts and for staff.
-- 2. A withdrawal of an owed step made and paid the way the seed now makes it
--    (request_withdrawal, claim_withdrawal, record_withdrawal): the same.
--
-- Fixtures: slugs pgtap-r15-*, ids d15?xxxx-...; every count is scoped to them.
begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

update public.payout_provider_settings set enabled = case
    when provider = 'paypal' and region in ('china', 'elsewhere') then true else false end;

set local session_replication_role = replica;

insert into auth.users (id, email)
select ('d15a0000-0000-0000-0000-0000000000' || k)::uuid, 'pgtap-r15-' || k || '@example.com' from unnest(array['01','02','03','04']) k;
insert into public.platform_admins (user_id, note) values ('d15a0000-0000-0000-0000-000000000002', 'pgtap-r15');
insert into public.orgs (id, type, name, slug) values
  ('d15b0000-0000-0000-0000-00000000000b', 'brand', 'R15 Brand', 'pgtap-r15-brand'),
  ('d15b0000-0000-0000-0000-0000000000e1', 'factory', 'R15 Legacy', 'pgtap-r15-legacy'),
  ('d15b0000-0000-0000-0000-0000000000e2', 'factory', 'R15 Owed', 'pgtap-r15-owed');
insert into public.org_members (org_id, user_id, role, permissions) values
  ('d15b0000-0000-0000-0000-0000000000e1', 'd15a0000-0000-0000-0000-000000000001', 'owner', '{}'),
  ('d15b0000-0000-0000-0000-00000000000b', 'd15a0000-0000-0000-0000-000000000003', 'owner', '{}'),
  ('d15b0000-0000-0000-0000-0000000000e2', 'd15a0000-0000-0000-0000-000000000004', 'owner', '{}');
insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total) values
  ('d15c0000-0000-0000-0000-000000000001', 'd15b0000-0000-0000-0000-00000000000b', 'R15 legacy request', 'awarded', 'invited_only', 100),
  ('d15c0000-0000-0000-0000-000000000002', 'd15b0000-0000-0000-0000-00000000000b', 'R15 owed request', 'awarded', 'invited_only', 100);
insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity, submitted_at) values
  ('d15c1000-0000-0000-0000-000000000001', 'd15c0000-0000-0000-0000-000000000001', 'd15b0000-0000-0000-0000-0000000000e1', 'accepted', 100, 1, now()),
  ('d15c1000-0000-0000-0000-000000000002', 'd15c0000-0000-0000-0000-000000000002', 'd15b0000-0000-0000-0000-0000000000e2', 'accepted', 100, 1, now());
insert into public.production_orders
  (id, rfq_id, quote_id, brand_org_id, factory_org_id, unit_price_cents, status, schedule_brand_agreed_at, schedule_brand_agreed_by,
   production_quantity, bulk_subtotal_cents, sample_subtotal_cents, order_total_cents, deposit_pct, balance_pct, order_number)
values
  ('d15d0000-0000-0000-0000-000000000001', 'd15c0000-0000-0000-0000-000000000001', 'd15c1000-0000-0000-0000-000000000001',
   'd15b0000-0000-0000-0000-00000000000b', 'd15b0000-0000-0000-0000-0000000000e1', 19500, 'active', now() - interval '60 days',
   'd15a0000-0000-0000-0000-000000000003', 1, 19500, 0, 19500, 50, 50, 'R15-1'),
  ('d15d0000-0000-0000-0000-000000000002', 'd15c0000-0000-0000-0000-000000000002', 'd15c1000-0000-0000-0000-000000000002',
   'd15b0000-0000-0000-0000-00000000000b', 'd15b0000-0000-0000-0000-0000000000e2', 19500, 'active', now() - interval '60 days',
   'd15a0000-0000-0000-0000-000000000003', 1, 19500, 0, 19500, 50, 50, 'R15-2');
-- Each factory: a $65 fit sample and a $130 step, both approved and cleared.
-- Factory 1's $65 was in the pool and withdrawn before one balance.
insert into public.order_milestones (id, order_id, kind, title, amount_cents, state, sort, completed_at) values
  ('d15e0001-0000-0000-0000-000000000001', 'd15d0000-0000-0000-0000-000000000001', 'approval_and_payment', 'R15 fit', 6500, 'complete', 10, now() - interval '20 days'),
  ('d15e0002-0000-0000-0000-000000000001', 'd15d0000-0000-0000-0000-000000000001', 'approval_and_payment', 'R15 step', 13000, 'complete', 20, now() - interval '5 days'),
  ('d15e0001-0000-0000-0000-000000000002', 'd15d0000-0000-0000-0000-000000000002', 'approval_and_payment', 'R15 fit', 6500, 'complete', 10, now() - interval '20 days'),
  ('d15e0002-0000-0000-0000-000000000002', 'd15d0000-0000-0000-0000-000000000002', 'approval_and_payment', 'R15 step', 13000, 'complete', 20, now() - interval '5 days');
insert into public.order_payments
  (id, order_id, milestone_id, amount_cents, currency, state, confirmed_at, release_requested_at, released_at, released_note,
   withdrawal_pool, stripe_payment_intent_id, stripe_charge_id, funds_available_at) values
  ('d15f0001-0000-0000-0000-000000000001', 'd15d0000-0000-0000-0000-000000000001', 'd15e0001-0000-0000-0000-000000000001', 6500, 'USD', 'released',
   now() - interval '30 days', now() - interval '20 days', now() - interval '15 days', 'Withdrawn',
   true, 'pi_pgtap_r15_1', 'ch_pgtap_r15_1', now() - interval '25 days'),
  ('d15f0002-0000-0000-0000-000000000001', 'd15d0000-0000-0000-0000-000000000001', 'd15e0002-0000-0000-0000-000000000001', 13000, 'USD', 'confirmed',
   now() - interval '30 days', now() - interval '5 days', null, null,
   false, 'pi_pgtap_r15_2', 'ch_pgtap_r15_2', now() - interval '25 days'),
  ('d15f0001-0000-0000-0000-000000000002', 'd15d0000-0000-0000-0000-000000000002', 'd15e0001-0000-0000-0000-000000000002', 6500, 'USD', 'confirmed',
   now() - interval '30 days', now() - interval '20 days', null, null,
   false, 'pi_pgtap_r15_3', 'ch_pgtap_r15_3', now() - interval '25 days'),
  ('d15f0002-0000-0000-0000-000000000002', 'd15d0000-0000-0000-0000-000000000002', 'd15e0002-0000-0000-0000-000000000002', 13000, 'USD', 'confirmed',
   now() - interval '30 days', now() - interval '5 days', null, null,
   false, 'pi_pgtap_r15_4', 'ch_pgtap_r15_4', now() - interval '25 days');
insert into public.factory_payout_accounts (id, org_id, method, paypal_email, is_primary, details_changed_at) values
  ('d1590000-0000-0000-0000-000000000011', 'd15b0000-0000-0000-0000-0000000000e1', 'paypal', 'pgtap-r15-legacy@example.com', true, '2026-11-01'),
  ('d1590000-0000-0000-0000-000000000021', 'd15b0000-0000-0000-0000-0000000000e2', 'paypal', 'pgtap-r15-owed@example.com', true, '2026-11-01');
-- Factory 1's withdrawal of the $65, paid before one balance: no pool_cents,
-- no step taken (as every withdrawal made on main is).
insert into public.factory_withdrawals
  (id, org_id, account_id, provider, status, amount_cents, currency, paid_to, provider_ref, fee_cents, receives_minor, receives_currency,
   requested_by, decided_by, decided_at, paid_at, created_at)
values
  ('d1580000-0000-0000-0000-000000000001', 'd15b0000-0000-0000-0000-0000000000e1', 'd1590000-0000-0000-0000-000000000011', 'paypal', 'paid',
   6500, 'USD', 'pgtap-r15-legacy@example.com', 'PP-R15-OLD', 130, 6370, 'USD',
   'd15a0000-0000-0000-0000-000000000001', 'd15a0000-0000-0000-0000-000000000002', now() - interval '15 days', now() - interval '15 days', now() - interval '16 days');
set local session_replication_role = origin;
-- The old pool, turned into takes as the migration does (20261121350000).
select is(public.convert_withdrawal_pool(), 1, 'factory 1''s pool step is converted');

create function pg_temp.act_as(who text) returns void language sql as $f$
  select set_config('request.jwt.claims',
    json_build_object('sub', 'd15a0000-0000-0000-0000-' || lpad(who, 12, '0'), 'role', 'authenticated')::text, true);
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
create function pg_temp.bal(org uuid, who text) returns jsonb language plpgsql as $f$
declare j jsonb;
begin
  perform pg_temp.act_as(who);
  set local role authenticated;
  j := public.factory_balance(org);
  reset role;
  return j;
end;
$f$;
create function pg_temp.line(j jsonb) returns text language sql immutable as $f$
  select format('awaiting %s, available %s, pending %s, processing %s, paid out %s, total %s',
    j ->> 'awaiting_cents', j ->> 'available_cents', j ->> 'pending_cents', j ->> 'processing_cents', j ->> 'paid_out_cents', j ->> 'total_cents');
$f$;
create function pg_temp.word(j jsonb, w uuid) returns text language sql immutable as $f$
  select x ->> 'word' from jsonb_array_elements(j -> 'withdrawals') x where (x ->> 'id')::uuid = w;
$f$;
create function pg_temp.part_words(j jsonb, w uuid) returns text language sql immutable as $f$
  select string_agg(p ->> 'word', ',') from jsonb_array_elements(j -> 'withdrawals') x,
         jsonb_array_elements(x -> 'parts') p where (x ->> 'id')::uuid = w;
$f$;
create function pg_temp.staff_covered(w uuid) returns boolean language plpgsql as $f$
declare j jsonb;
begin
  perform pg_temp.act_as('02');
  set local role authenticated;
  j := public.admin_withdrawals();
  reset role;
  return (select (x ->> 'covered')::boolean from jsonb_array_elements(j -> 'withdrawals') x where (x ->> 'id')::uuid = w);
end;
$f$;

-- ===========================================================================
-- 1. Paid before one balance, from the pool: the next withdrawal is waiting.
-- ===========================================================================
select is((select sum(amount_cents) from public.payment_takes where factory_withdrawal_id = 'd1580000-0000-0000-0000-000000000001' and status = 'sent')::bigint, 6500::bigint,
  'the old withdrawal is a sent take on the pool step it was paid from: nothing short');
select is(pg_temp.line(pg_temp.bal('d15b0000-0000-0000-0000-0000000000e1', '01')),
  'awaiting 0, available 13000, pending 0, processing 0, paid out 6370, total 19370',
  'before asking: the $130 step available, the old $65 paid out less its fee');

select pg_temp.act_as('01'); set local role authenticated;
select lives_ok($$select set_config('tsc.r15_w1',
  (public.request_withdrawal('d15b0000-0000-0000-0000-0000000000e1', 13000, 'd1590000-0000-0000-0000-000000000011')).id::text, true)$$,
  'the owner asks to withdraw the $130 by PayPal');
reset role;

select is((select coalesce(pool_cents, 0) from public.factory_withdrawals where id = current_setting('tsc.r15_w1')::uuid), 0::bigint,
  'none of it comes from the pool');
select is((select sum(amount_cents) from public.payment_takes where factory_withdrawal_id = current_setting('tsc.r15_w1')::uuid and status = 'held'),
  13000::numeric, 'it takes the $130 step');
select ok(public.withdrawal_covered((select w from public.factory_withdrawals w where w.id = current_setting('tsc.r15_w1')::uuid)),
  'approving it would go through');
select is(pg_temp.word(pg_temp.bal('d15b0000-0000-0000-0000-0000000000e1', '01'), current_setting('tsc.r15_w1')::uuid), 'waiting',
  'the factory''s list calls it waiting (Processing), not on hold');
select is(pg_temp.part_words(pg_temp.bal('d15b0000-0000-0000-0000-0000000000e1', '01'), current_setting('tsc.r15_w1')::uuid), 'waiting',
  'one part, waiting: nothing of it is on hold');
select is(pg_temp.staff_covered(current_setting('tsc.r15_w1')::uuid), true, 'staff''s board says it can be paid');
select is(pg_temp.line(pg_temp.bal('d15b0000-0000-0000-0000-0000000000e1', '01')),
  'awaiting 0, available 0, pending 0, processing 13000, paid out 6370, total 19370',
  'waiting: the $130 is Processing, Total unchanged');

select pg_temp.act_as('02'); set local role authenticated;
select lives_ok($$select public.claim_withdrawal(current_setting('tsc.r15_w1')::uuid)$$, 'staff can start paying it');
reset role;

-- ===========================================================================
-- 2. A withdrawal of an owed step, made and paid the real way (the seed's
--    Kowloon): the next one is waiting too.
-- ===========================================================================
select pg_temp.act_as('04'); set local role authenticated;
select lives_ok($$select set_config('tsc.r15_w2',
  (public.request_withdrawal('d15b0000-0000-0000-0000-0000000000e2', 6500, 'd1590000-0000-0000-0000-000000000021')).id::text, true)$$,
  'the owner asks to withdraw the $65 fit sample');
reset role;
select pg_temp.act_as('02'); set local role authenticated;
select lives_ok($$select public.claim_withdrawal(current_setting('tsc.r15_w2')::uuid)$$, 'staff approve it');
reset role;
select lives_ok(format($$select pg_temp.as_server(%L)$$,
  format('select public.record_withdrawal(%L, ''paid'', ''PP-R15'', 130, 6370, ''USD'', null)', current_setting('tsc.r15_w2'))),
  'PayPal paid it');
select is((select status from public.payment_takes where factory_withdrawal_id = current_setting('tsc.r15_w2')::uuid), 'sent',
  'the step it took is sent');
select is((public.owed_reachable('d15b0000-0000-0000-0000-0000000000e2') ->> 'any_cents')::bigint, 13000::bigint, 'nothing short: the $130 step is still there to withdraw');

select pg_temp.act_as('04'); set local role authenticated;
select lives_ok($$select set_config('tsc.r15_w3',
  (public.request_withdrawal('d15b0000-0000-0000-0000-0000000000e2', 13000, 'd1590000-0000-0000-0000-000000000021')).id::text, true)$$,
  'then asks for the $130 step');
reset role;
select ok(public.withdrawal_covered((select w from public.factory_withdrawals w where w.id = current_setting('tsc.r15_w3')::uuid)),
  'approving it would go through');
select is(pg_temp.word(pg_temp.bal('d15b0000-0000-0000-0000-0000000000e2', '04'), current_setting('tsc.r15_w3')::uuid), 'waiting',
  'the factory''s list calls it waiting, not on hold');
select is(pg_temp.staff_covered(current_setting('tsc.r15_w3')::uuid), true, 'staff''s board says it can be paid');
select is(pg_temp.line(pg_temp.bal('d15b0000-0000-0000-0000-0000000000e2', '04')),
  'awaiting 0, available 0, pending 0, processing 13000, paid out 6370, total 19370',
  'the $65 paid out less its fee, the $130 Processing');

select * from finish();
rollback;
