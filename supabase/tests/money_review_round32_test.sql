-- One balance, fix round 32 (20261121340000, 20261121350000).
--
-- Pool → takes (e1–e3): convert_withdrawal_pool() turns the old pool into
--   payment_takes with every figure as the pool read it (the numbers below
--   were read from factory_balance() on the code before this round), fully
--   withdrawn steps released, no pool flag or pool_cents left.
-- Per-step payouts (e4, e5): "Pay again" (Wise / PayPal) and "Mark paid out by
--   bank" follow the withdrawal rules: refused while disputed, partly refunded,
--   clearing, or while the factory owes TSC more than its other earnings; they
--   send the factory's money for the step (a bank wire's received amount).
-- Reset (e6, p61): a full refund before approval clears disputed_at.
-- Cause codes (e6, p62 p63; e4, p42): a refund that fails later is funded
--   again only when it was a refund made in Stripe ('stripe_refund'), whatever
--   the note says; a lost dispute is recorded once, by its code.
-- Dead code: the pool's functions are gone; grants exact; no overloads.
begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

update public.payout_provider_settings set enabled = case
    when provider = 'paypal' and region in ('china', 'elsewhere') then true else false end;

set local session_replication_role = replica;

insert into auth.users (id, email)
select ('b32a0000-0000-0000-0000-0000000000' || k)::uuid, 'pgtap-r32-' || k || '@example.com'
  from unnest(array['01','02','03','04','05','06','07','08']) k;
-- 02 is staff; 03 owns both brands; 01, 04, 05, 06, 07, 08 own factories e1 to e6.
insert into public.platform_admins (user_id, note) values ('b32a0000-0000-0000-0000-000000000002', 'pgtap-r32');
insert into public.orgs (id, type, name, slug) values
  ('b32b0000-0000-0000-0000-0000000000b1', 'brand', 'R32 Brand 1', 'pgtap-r32-brand1'),
  ('b32b0000-0000-0000-0000-0000000000b2', 'brand', 'R32 Brand 2', 'pgtap-r32-brand2');
insert into public.orgs (id, type, name, slug)
select ('b32b0000-0000-0000-0000-0000000000e' || n)::uuid, 'factory', 'R32 Factory ' || n, 'pgtap-r32-f' || n from generate_series(1, 6) n;
insert into public.org_members (org_id, user_id, role, permissions) values
  ('b32b0000-0000-0000-0000-0000000000b1', 'b32a0000-0000-0000-0000-000000000003', 'owner', '{}'),
  ('b32b0000-0000-0000-0000-0000000000b2', 'b32a0000-0000-0000-0000-000000000003', 'owner', '{}'),
  ('b32b0000-0000-0000-0000-0000000000e1', 'b32a0000-0000-0000-0000-000000000001', 'owner', '{}'),
  ('b32b0000-0000-0000-0000-0000000000e2', 'b32a0000-0000-0000-0000-000000000004', 'owner', '{}'),
  ('b32b0000-0000-0000-0000-0000000000e3', 'b32a0000-0000-0000-0000-000000000005', 'owner', '{}'),
  ('b32b0000-0000-0000-0000-0000000000e4', 'b32a0000-0000-0000-0000-000000000006', 'owner', '{}'),
  ('b32b0000-0000-0000-0000-0000000000e5', 'b32a0000-0000-0000-0000-000000000007', 'owner', '{}'),
  ('b32b0000-0000-0000-0000-0000000000e6', 'b32a0000-0000-0000-0000-000000000008', 'owner', '{}');

-- Pool steps pNK: factory N, step K, one order each.
--   e1: p11 released $1,000; p12 $1,000 with $600 refunded since (worth $400);
--       p13 $500; p14 $300 for brand 2 with $100 refunded (worth $200).
--       Paid $1,200, being sent $300, waiting $400 (part of an old
--       pre-split request), cancelled $50: p14 stays available.
--   e2: p21 $1,000 with $800 refunded (worth $200); p22 released $500.
--       Paid $500; waiting $600, $400 of which the pool no longer holds.
--   e3: p31 released $1,000 with $700 refunded after it was withdrawn
--       (worth $300); p32 $200. Paid $1,000: owes TSC $500.
--   e4 (not pool; per-step payouts): p41 fine; p42 disputed; p43 $100 of it
--       refunded; p44 still clearing; p45 a bank wire that brought $900.
--   e5: p51 paid out the old way, then half refunded (owes TSC $500); p52 $200.
--   e6: p61 funded, disputed, not approved; p62, p63 funded, not approved.
create temporary table r32_steps (n int, k int, brand int, amount bigint, refunded bigint, state text,
                                  pool boolean, approved boolean) on commit drop;
insert into r32_steps values
  (1, 1, 1, 100000,     0, 'released', true, true),
  (1, 2, 1, 100000, 64200, 'confirmed', true, true),
  (1, 3, 1,  50000,     0, 'confirmed', true, true),
  (1, 4, 2,  30000, 10700, 'confirmed', true, true),
  (2, 1, 1, 100000, 85600, 'confirmed', true, true),
  (2, 2, 1,  50000,     0, 'released', true, true),
  (3, 1, 1, 100000, 74900, 'released', true, true),
  (3, 2, 1,  20000,     0, 'confirmed', true, true),
  (4, 1, 1, 100000,     0, 'confirmed', false, true),
  (4, 2, 1, 100000,     0, 'confirmed', false, true),
  (4, 3, 1, 100000, 10700, 'confirmed', false, true),
  (4, 4, 1, 100000,     0, 'confirmed', false, true),
  (4, 5, 1, 100000,     0, 'confirmed', false, true),
  (5, 1, 1, 100000, 53500, 'released', false, true),
  (5, 2, 1,  20000,     0, 'confirmed', false, true),
  (6, 1, 1, 100000,     0, 'confirmed', false, false),
  (6, 2, 1, 100000,     0, 'confirmed', false, false),
  (6, 3, 1, 100000,     0, 'confirmed', false, false);
insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total)
select ('b32c0000-0000-0000-0000-0000000000' || n || k)::uuid, ('b32b0000-0000-0000-0000-0000000000b' || brand)::uuid,
       'R32 request ' || n || k, 'awarded', 'invited_only', 100 from r32_steps;
insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity, submitted_at)
select ('b32c1000-0000-0000-0000-0000000000' || n || k)::uuid, ('b32c0000-0000-0000-0000-0000000000' || n || k)::uuid,
       ('b32b0000-0000-0000-0000-0000000000e' || n)::uuid, 'accepted', 100, 1, now() from r32_steps;
insert into public.production_orders
  (id, rfq_id, quote_id, brand_org_id, factory_org_id, unit_price_cents, status, schedule_brand_agreed_at, schedule_brand_agreed_by,
   production_quantity, bulk_subtotal_cents, sample_subtotal_cents, order_total_cents, deposit_pct, balance_pct, order_number)
select ('b32d0000-0000-0000-0000-0000000000' || n || k)::uuid, ('b32c0000-0000-0000-0000-0000000000' || n || k)::uuid,
       ('b32c1000-0000-0000-0000-0000000000' || n || k)::uuid, ('b32b0000-0000-0000-0000-0000000000b' || brand)::uuid,
       ('b32b0000-0000-0000-0000-0000000000e' || n)::uuid, amount, 'active', now() - interval '60 days',
       'b32a0000-0000-0000-0000-000000000003', 1, amount, 0, amount, 50, 50, 'R32-' || n || k
  from r32_steps;
insert into public.order_milestones (id, order_id, kind, title, amount_cents, state, sort, completed_at)
select ('b32e00' || n || k || '-0000-0000-0000-000000000000')::uuid, ('b32d0000-0000-0000-0000-0000000000' || n || k)::uuid,
       'approval_and_payment'::public.milestone_type, 'R32 step ' || n || k, amount, 'complete'::public.milestone_state, 10,
       now() - interval '30 days'
  from r32_steps;
insert into public.order_payments
  (id, order_id, milestone_id, amount_cents, charged_cents, amount_received_cents, currency, state, confirmed_at, release_requested_at,
   withdrawal_pool, stripe_payment_intent_id, stripe_charge_id, funds_available_at, released_at, released_note,
   refunded_cents, refund_amount_at)
select ('b32f00' || n || k || '-0000-0000-0000-000000000000')::uuid, ('b32d0000-0000-0000-0000-0000000000' || n || k)::uuid,
       ('b32e00' || n || k || '-0000-0000-0000-000000000000')::uuid, amount, amount * 107 / 100, amount * 107 / 100, 'USD',
       state::public.payment_state, now() - interval '40 days',
       case when approved then now() - interval '30 days' + (n * 10 + k) * interval '1 minute' end,
       pool, 'pi_pgtap_r32_' || n || k, 'ch_pgtap_r32_' || n || k, now() - interval '35 days',
       case when state = 'released' then now() - interval '20 days' end,
       case when state = 'released' then 'Withdrawn' end,
       refunded, case when refunded > 0 then now() - interval '5 days' end
  from r32_steps;
insert into public.factory_payout_accounts (id, org_id, method, paypal_email, is_primary, details_changed_at)
select ('b3290000-0000-0000-0000-00000000000' || n)::uuid, ('b32b0000-0000-0000-0000-0000000000e' || n)::uuid, 'paypal',
       'pgtap-r32-f' || n || '@example.com', true, '2026-11-01'
  from generate_series(1, 6) n;
update public.order_payments set disputed_at = now() - interval '1 day' where id in ('b32f0042-0000-0000-0000-000000000000', 'b32f0061-0000-0000-0000-000000000000');
update public.order_payments set funds_available_at = now() + interval '2 days' where id = 'b32f0044-0000-0000-0000-000000000000';
update public.order_payments set charged_cents = null, amount_received_cents = 90000, stripe_payment_intent_id = null, stripe_charge_id = null,
       funds_available_at = null where id = 'b32f0045-0000-0000-0000-000000000000';
update public.order_milestones set state = 'active', completed_at = null where id::text like 'b32e006%';
-- Withdrawals wN_K; pool_cents null = an old request wholly from the pool.
insert into public.factory_withdrawals
  (id, org_id, account_id, provider, status, amount_cents, currency, paid_to, pool_cents, created_at, paid_at, decided_at)
values
  ('b3270000-0000-0000-0000-000000000011', 'b32b0000-0000-0000-0000-0000000000e1', 'b3290000-0000-0000-0000-000000000001', 'paypal', 'paid',      120000, 'USD', 'f1', null,  now() - interval '15 days', now() - interval '14 days', now() - interval '14 days'),
  ('b3270000-0000-0000-0000-000000000012', 'b32b0000-0000-0000-0000-0000000000e1', 'b3290000-0000-0000-0000-000000000001', 'paypal', 'paying',     30000, 'USD', 'f1', 30000, now() - interval '3 days',  null, now() - interval '1 day'),
  ('b3270000-0000-0000-0000-000000000013', 'b32b0000-0000-0000-0000-0000000000e1', 'b3290000-0000-0000-0000-000000000001', 'paypal', 'requested',  40000, 'USD', 'f1', null,  now() - interval '4 days',  null, null),
  ('b3270000-0000-0000-0000-000000000014', 'b32b0000-0000-0000-0000-0000000000e1', 'b3290000-0000-0000-0000-000000000001', 'paypal', 'cancelled',   5000, 'USD', 'f1', 5000,  now() - interval '2 days',  null, now() - interval '2 days'),
  ('b3270000-0000-0000-0000-000000000021', 'b32b0000-0000-0000-0000-0000000000e2', 'b3290000-0000-0000-0000-000000000002', 'paypal', 'paid',       50000, 'USD', 'f2', 50000, now() - interval '15 days', now() - interval '14 days', now() - interval '14 days'),
  ('b3270000-0000-0000-0000-000000000022', 'b32b0000-0000-0000-0000-0000000000e2', 'b3290000-0000-0000-0000-000000000002', 'paypal', 'requested',  60000, 'USD', 'f2', 60000, now() - interval '6 days',  null, null),
  ('b3270000-0000-0000-0000-000000000031', 'b32b0000-0000-0000-0000-0000000000e3', 'b3290000-0000-0000-0000-000000000003', 'paypal', 'paid',      100000, 'USD', 'f3', null,  now() - interval '15 days', now() - interval '14 days', now() - interval '14 days');
set local session_replication_role = origin;

create function pg_temp.figures(n int, client int default null) returns jsonb language plpgsql as $f$
declare j jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', 'b32a0000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
  j := public.factory_balance(('b32b0000-0000-0000-0000-0000000000e' || n)::uuid,
                              case when client is not null then ('b32b0000-0000-0000-0000-0000000000b' || client)::uuid end);
  perform set_config('request.jwt.claims', '', true);
  return jsonb_build_object('awaiting', j -> 'awaiting_cents', 'available', j -> 'available_cents', 'pending', j -> 'pending_cents',
    'processing', j -> 'processing_cents', 'paid_out', j -> 'paid_out_cents', 'owed_to_tsc', j -> 'owed_to_tsc_cents', 'total', j -> 'total_cents');
end;
$f$;

create function pg_temp.act_as(who text) returns void language sql as $f$
  select set_config('request.jwt.claims',
    json_build_object('sub', 'b32a0000-0000-0000-0000-' || lpad(who, 12, '0'), 'role', 'authenticated')::text, true);
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
create function pg_temp.pay(nk int) returns uuid language sql immutable as $f$
  select ('b32f00' || nk || '-0000-0000-0000-000000000000')::uuid;
$f$;
create function pg_temp.p(nk int) returns public.order_payments language sql as $f$
  select * from public.order_payments where id = pg_temp.pay(nk);
$f$;
create function pg_temp.wd(nk int) returns public.factory_withdrawals language sql as $f$
  select * from public.factory_withdrawals where id = ('b3270000-0000-0000-0000-0000000000' || nk)::uuid;
$f$;
-- A staff call's refusal, as its hint (null when it went through).
create function pg_temp.staff_hint(sql text) returns text language plpgsql as $f$
declare h text;
begin
  perform pg_temp.act_as('02');
  set local role authenticated;
  begin
    execute sql;
    reset role;
    return null;
  exception when others then
    get stacked diagnostics h = pg_exception_hint;
    reset role;
    return coalesce(nullif(h, ''), sqlstate);
  end;
end;
$f$;
create function pg_temp.take(nk int, w int, st text) returns bigint language sql as $f$
  select sum(amount_cents)::bigint from public.payment_takes
   where payment_id = pg_temp.pay(nk) and factory_withdrawal_id = ('b3270000-0000-0000-0000-0000000000' || w)::uuid and status = st;
$f$;

-- ===========================================================================
-- 5. The old pool becomes takes, every figure as it was.
-- ===========================================================================
select is(public.convert_withdrawal_pool(), 8, 'the eight pool steps are converted');
select is(pg_temp.figures(1), '{"total":210000,"pending":0,"awaiting":0,"paid_out":120000,"available":20000,"processing":70000,"owed_to_tsc":0}'::jsonb,
  'e1: the figures the pool gave');
select is(pg_temp.figures(1, 1), '{"total":190000,"pending":0,"awaiting":0,"paid_out":120000,"available":0,"processing":70000,"owed_to_tsc":0}'::jsonb,
  'e1, brand 1: the same');
select is(pg_temp.figures(1, 2), '{"total":20000,"pending":0,"awaiting":0,"paid_out":0,"available":20000,"processing":0,"owed_to_tsc":0}'::jsonb,
  'e1, brand 2: the same');
select is(pg_temp.figures(2), '{"total":70000,"pending":0,"awaiting":0,"paid_out":50000,"available":0,"processing":20000,"owed_to_tsc":0}'::jsonb,
  'e2 (a waiting withdrawal the pool no longer covered): the same');
select is(pg_temp.figures(3), '{"total":50000,"pending":0,"awaiting":0,"paid_out":100000,"available":-50000,"processing":0,"owed_to_tsc":50000}'::jsonb,
  'e3 (paid beyond what the pool now holds): the same, owed to TSC');
select is((select count(*)::int from public.order_payments where withdrawal_pool), 0, 'no pool payment is left');
select is((select count(*)::int from public.factory_withdrawals where org_id::text like 'b32b%' and pool_cents is distinct from 0), 0,
  'every withdrawal''s pool_cents is 0');
select is((select string_agg(right(left(id::text, 8), 2) || ' ' || state::text, ', ' order by id) from public.order_payments
            where id in (pg_temp.pay(11), pg_temp.pay(12), pg_temp.pay(13), pg_temp.pay(22), pg_temp.pay(31), pg_temp.pay(32))),
  '11 released, 12 confirmed, 13 confirmed, 22 released, 31 released, 32 released', 'fully withdrawn steps are released, the rest are not');
select is(row(pg_temp.take(11, 11, 'sent'), pg_temp.take(12, 11, 'sent'), pg_temp.take(12, 12, 'held'), pg_temp.take(13, 12, 'held'),
              pg_temp.take(13, 13, 'held'), pg_temp.take(21, 22, 'held'), pg_temp.take(22, 21, 'sent'), pg_temp.take(31, 31, 'sent'),
              pg_temp.take(32, 31, 'sent')),
  row(100000::bigint, 20000::bigint, 20000::bigint, 10000::bigint, 40000::bigint, 60000::bigint, 50000::bigint, 80000::bigint, 20000::bigint),
  'the takes, in the pool''s order');
select is(public.withdrawal_back_cents(pg_temp.wd(22)), 20000::bigint, 'e2: cancelling its waiting $600 gives back the $200 still there');
select is(public.withdrawal_refunded_cents(pg_temp.wd(22)), 40000::bigint, 'e2: the $400 refunded since is its refunded part');
select ok(not public.withdrawal_covered(pg_temp.wd(22)), 'e2: it is not covered');
select pg_temp.act_as('02'); set local role authenticated;
select is((select (x ->> 'amount_cents')::bigint from jsonb_array_elements(public.admin_balance_attention() -> 'recover') x
            where x ->> 'payment_id' = pg_temp.pay(31)::text), 50000::bigint, 'e3: To recover names the step, $500');
select is((select count(*)::int from jsonb_array_elements(public.admin_balance_attention() -> 'recover') x where x -> 'payment_id' = 'null'::jsonb), 0,
  'no row without a step');
reset role;
select is(public.convert_withdrawal_pool(), 0, 'converting again finds nothing');

-- ===========================================================================
-- 2. Per-step payouts follow the withdrawal rules.
-- ===========================================================================
select is(pg_temp.staff_hint(format('select public.claim_provider_payout(%L, %L, %L, false)', pg_temp.pay(42), 'paypal', '2026-11-01')),
  'payout_disputed', 'Pay again: refused while the charge is disputed');
select is(pg_temp.staff_hint(format('select public.claim_provider_payout(%L, %L, %L, false)', pg_temp.pay(43), 'paypal', '2026-11-01')),
  'payout_refunded', 'refused when part of the step went back to the brand');
select is(pg_temp.staff_hint(format('select public.claim_provider_payout(%L, %L, %L, false)', pg_temp.pay(44), 'paypal', '2026-11-01')),
  'payout_not_cleared', 'refused while the charge is clearing');
select is(pg_temp.staff_hint(format('select public.claim_provider_payout(%L, %L, %L, false)', pg_temp.pay(52), 'paypal', '2026-11-01')),
  'payout_owes_tsc', 'refused while the factory owes TSC more than its other earnings');
select pg_temp.act_as('02'); set local role authenticated;
select is((public.claim_provider_payout(pg_temp.pay(45), 'paypal', '2026-11-01', false) ->> 'amount_cents')::bigint, 90000::bigint,
  'a bank wire that brought $900 sends $900, not the $1,000 step');
reset role;
select is((select amount_cents from public.provider_payouts where payment_id = pg_temp.pay(45)), 90000::bigint, 'and the payout row carries it');
select is(pg_temp.staff_hint(format('select public.release_payment_to_factory(%L, %L, %L)', pg_temp.pay(42), 'BANKREF42', '2026-11-01')),
  'payout_disputed', 'Mark paid out by bank: refused while disputed');
select is(pg_temp.staff_hint(format('select public.release_payment_to_factory(%L, %L, %L)', pg_temp.pay(52), 'BANKREF52', '2026-11-01')),
  'payout_owes_tsc', 'and while the factory owes TSC');
select is(pg_temp.staff_hint(format('select public.release_payment_to_factory(%L, %L, %L)', pg_temp.pay(41), 'BANKREF41', '2026-11-01')),
  null, 'a clean step is marked paid');
select is((pg_temp.p(41)).state::text, 'released', 'released');

-- ===========================================================================
-- 3. One reset: a full refund before approval clears the dispute.
-- ===========================================================================
select lives_ok($$select pg_temp.as_server(format('select public.record_payment_refunded(%L, %L, %L)', pg_temp.pay(61), 'pi_pgtap_r32_61', 'The payment was refunded.'))$$,
  'a disputed, unapproved step is refunded in full');
select is(row((pg_temp.p(61)).state::text, (pg_temp.p(61)).disputed_at), row('due'::text, null::timestamptz),
  'back to pay, and the old charge''s dispute is not carried to the next');

-- ===========================================================================
-- 4. Why money went back is a code, not the note.
-- ===========================================================================
select lives_ok($$select pg_temp.as_server(format('select public.record_payment_refunded(%L, %L, %L, %L)', pg_temp.pay(62), 'pi_pgtap_r32_62', 'The payment was refunded.', 'not_needed'))$$,
  'TSC''s own refund, whose note reads like a Stripe one');
select lives_ok($$select pg_temp.as_server(format('select public.record_full_refund_failed(%L, %L, %L, 107000, 0, 107000, 0, null)', pg_temp.pay(62), 'pi_pgtap_r32_62', 'ch_pgtap_r32_62'))$$,
  'and that refund fails');
select is((pg_temp.p(62)).state::text, 'due', 'it is not funded again');
select is((select cause from public.payment_refund_failures where payment_id = pg_temp.pay(62)), 'stray', 'staff refund it again');

select lives_ok($$select pg_temp.as_server(format('select public.record_payment_refunded(%L, %L, %L, %L)', pg_temp.pay(63), 'pi_pgtap_r32_63', 'Refunded in Stripe, any words.', 'stripe_refund'))$$,
  'a refund made in Stripe, in other words');
select is((select cause from public.payment_events where payment_id = pg_temp.pay(63) and to_state = 'due'), 'stripe_refund', 'its event keeps the code');
select lives_ok($$select pg_temp.as_server(format('select public.record_full_refund_failed(%L, %L, %L, 107000, 0, 107000, 0, null)', pg_temp.pay(63), 'pi_pgtap_r32_63', 'ch_pgtap_r32_63'))$$,
  'and it fails');
select is(row((pg_temp.p(63)).state::text, (pg_temp.p(63)).stripe_payment_intent_id), row('confirmed'::text, 'pi_pgtap_r32_63'::text),
  'funded again with the charge TSC still holds');

select lives_ok($$select pg_temp.as_server(format('select public.record_payment_dispute_lost(%L, %L, 107000, 1500)', pg_temp.pay(42), 'du_pgtap_r32_42'))$$,
  'a dispute is lost');
select lives_ok($$select pg_temp.as_server(format('select public.record_payment_dispute_lost(%L, %L, 107000, 1500)', pg_temp.pay(42), 'du_pgtap_r32_42'))$$,
  'and told again');
select is((select count(*)::int from public.payment_events where payment_id = pg_temp.pay(42) and cause = 'dispute_lost'), 1, 'recorded once, by its code');

-- ===========================================================================
-- 6. Dead code gone; grants exact; no overloads.
-- ===========================================================================
select is((select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and proname = f), 0, f || ' is gone')
  from unnest(array['withdrawal_pool_refunded_cents', 'factory_withdrawable', 'release_withdrawn_payments', 'withdrawn_by_payment',
                    'return_take', 'return_stripe_takes', 'join_withdrawal_pool', 'guard_withdrawal_pool', 'guard_provider_payout_pool']) f;
select pg_temp.act_as('01'); set local role authenticated;
select ok(not (public.my_withdrawal_balance('b32b0000-0000-0000-0000-0000000000e1') ? 'pool_cents'),
  'my_withdrawal_balance has no pool_cents');
-- R33 (L4): kept one deploy, deprecated, for the live site's Withdraw button.
select is(public.my_withdrawal_balance('b32b0000-0000-0000-0000-0000000000e1') -> 'withdrawn', '{}'::jsonb,
  'my_withdrawal_balance: withdrawn is empty (deprecated)');
select is(public.my_withdrawal_balance('b32b0000-0000-0000-0000-0000000000e1') -> 'pool', 'true'::jsonb,
  'my_withdrawal_balance: pool is true while the company withdraws from TSC (deprecated)');
reset role;
select is((select proacl::text from pg_proc where oid = f::regprocedure), '{postgres=X/postgres,service_role=X/postgres}',
  f || ': postgres and the server only')
  from unnest(array['public.reset_refunded_payment(uuid, public.payment_state, text, bigint, bigint)',
                    'public.per_step_payout_check(public.order_payments, uuid)', 'public.convert_withdrawal_pool()',
                    'public.record_payment_refunded(uuid, text, text, text)']) f;
select is((select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and proname = f), 1, f || ': one function, no overloads')
  from unnest(array['reset_refunded_payment', 'per_step_payout_check', 'convert_withdrawal_pool', 'record_payment_refunded',
                    'record_full_refund_failed', 'record_payment_dispute_lost', 'claim_provider_payout', 'release_payment_to_factory',
                    'factory_balance', 'my_withdrawal_balance', 'request_withdrawal', 'claim_withdrawal']) f;

select * from finish();
rollback;
