-- Refunds and lost disputes under one balance (20261121200000).
--
-- A refund staff make in Stripe is recorded at the amount Stripe reports and
-- never made bigger. Before approval: a partial refund leaves the step funded
-- at the lower amount; a full one sends it back to Due and the brand pays
-- again. After approval the step stays done and, since paused payments
-- (20261124100000), the factory's earning does NOT go down: the refund or
-- lost dispute is kept on the payment (review_kept_cents), a payment review
-- opens and the factory's withdrawals pause until staff decide. Nothing is
-- taken from a waiting withdrawal, nothing is ever owed to TSC, and no
-- "earnings went down" / "owe TSC" notice is sent. Paid out never falls. A
-- lost dispute is recorded like a refund of the disputed amount; its hold
-- ends and Stripe's fee is recorded.
--
-- Fixtures: slugs pgtap-r17-*, ids c17?xxxx-...; every count is scoped to them.
--   F1 (owner 01): before approval (P1 partial, P2 full, P7 lost dispute),
--                  and a funded deposit refunded in full (P3).
--   F2 (owner 04): a refund under a waiting PayPal withdrawal (P4).
--   F3 (owner 05): money already withdrawn (P5 by PayPal, P6 by Stripe),
--                  then a lost dispute and a refund.
begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

update public.payout_provider_settings set enabled = case
    when provider = 'paypal' and region in ('china', 'elsewhere') then true else false end;

set local session_replication_role = replica;

-- 01 F1 owner, 02 staff, 03 brand owner, 04 F2 owner, 05 F3 owner.
insert into auth.users (id, email)
select ('c17a0000-0000-0000-0000-0000000000' || k)::uuid, 'pgtap-r17-' || k || '@example.com' from unnest(array['01','02','03','04','05']) k;
insert into public.platform_admins (user_id, note) values ('c17a0000-0000-0000-0000-000000000002', 'pgtap-r17');
insert into public.orgs (id, type, name, slug) values
  ('c17b0000-0000-0000-0000-00000000000b', 'brand', 'R17 Brand', 'pgtap-r17-brand'),
  ('c17b0000-0000-0000-0000-0000000000e1', 'factory', 'R17 Factory One', 'pgtap-r17-f1'),
  ('c17b0000-0000-0000-0000-0000000000e2', 'factory', 'R17 Factory Two', 'pgtap-r17-f2'),
  ('c17b0000-0000-0000-0000-0000000000e3', 'factory', 'R17 Factory Three', 'pgtap-r17-f3');
insert into public.org_members (org_id, user_id, role, permissions) values
  ('c17b0000-0000-0000-0000-0000000000e1', 'c17a0000-0000-0000-0000-000000000001', 'owner', '{}'),
  ('c17b0000-0000-0000-0000-00000000000b', 'c17a0000-0000-0000-0000-000000000003', 'owner', '{}'),
  ('c17b0000-0000-0000-0000-0000000000e2', 'c17a0000-0000-0000-0000-000000000004', 'owner', '{}'),
  ('c17b0000-0000-0000-0000-0000000000e3', 'c17a0000-0000-0000-0000-000000000005', 'owner', '{}');
insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total)
select ('c17c0000-0000-0000-0000-00000000000' || n)::uuid, 'c17b0000-0000-0000-0000-00000000000b', 'R17 request ' || n, 'awarded', 'invited_only', 100
  from generate_series(1, 3) n;
insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity, submitted_at)
select ('c17c1000-0000-0000-0000-00000000000' || n)::uuid, ('c17c0000-0000-0000-0000-00000000000' || n)::uuid,
       ('c17b0000-0000-0000-0000-0000000000e' || n)::uuid, 'accepted', 100, 1, now() from generate_series(1, 3) n;
insert into public.production_orders
  (id, rfq_id, quote_id, brand_org_id, factory_org_id, unit_price_cents, status, schedule_brand_agreed_at, schedule_brand_agreed_by,
   production_quantity, bulk_subtotal_cents, sample_subtotal_cents, order_total_cents, deposit_pct, balance_pct, order_number)
select ('c17d0000-0000-0000-0000-00000000000' || n)::uuid, ('c17c0000-0000-0000-0000-00000000000' || n)::uuid,
       ('c17c1000-0000-0000-0000-00000000000' || n)::uuid, 'c17b0000-0000-0000-0000-00000000000b',
       ('c17b0000-0000-0000-0000-0000000000e' || n)::uuid, 100000, 'active', now() - interval '60 days',
       'c17a0000-0000-0000-0000-000000000003', 1, 100000, 0, 100000, 50, 50, 'R17-' || n
  from generate_series(1, 3) n;
-- Charged = step + 7% fee. Held: approved steps not yet approved (no
-- release_requested_at). Owed: approved or a funded deposit, cleared.
insert into public.order_milestones (id, order_id, kind, title, amount_cents, state, sort, completed_at) values
  ('c17e0001-0000-0000-0000-000000000001', 'c17d0000-0000-0000-0000-000000000001', 'approval_and_payment', 'R17 fit sample', 10000, 'active', 10, null),
  ('c17e0002-0000-0000-0000-000000000001', 'c17d0000-0000-0000-0000-000000000001', 'approval_and_payment', 'R17 lab dip', 5000, 'active', 20, null),
  ('c17e0003-0000-0000-0000-000000000001', 'c17d0000-0000-0000-0000-000000000001', 'payment_only', 'R17 deposit', 20000, 'complete', 5, now() - interval '9 days'),
  ('c17e0007-0000-0000-0000-000000000001', 'c17d0000-0000-0000-0000-000000000001', 'approval_and_payment', 'R17 trims', 8000, 'active', 30, null),
  ('c17e0004-0000-0000-0000-000000000002', 'c17d0000-0000-0000-0000-000000000002', 'payment_only', 'R17 bulk deposit', 30000, 'complete', 10, now() - interval '9 days'),
  ('c17e0005-0000-0000-0000-000000000003', 'c17d0000-0000-0000-0000-000000000003', 'payment_only', 'R17 bulk deposit', 50000, 'complete', 10, now() - interval '9 days'),
  ('c17e0006-0000-0000-0000-000000000003', 'c17d0000-0000-0000-0000-000000000003', 'approval_and_payment', 'R17 fit sample', 15000, 'complete', 5, now() - interval '10 days');
insert into public.order_payments
  (id, order_id, milestone_id, amount_cents, charged_cents, currency, state, confirmed_at, release_requested_at,
   stripe_payment_intent_id, stripe_charge_id, funds_available_at) values
  ('c17f0001-0000-0000-0000-000000000001', 'c17d0000-0000-0000-0000-000000000001', 'c17e0001-0000-0000-0000-000000000001', 10000, 10700, 'USD', 'confirmed',
   now() - interval '20 days', null, 'pi_pgtap_r17_1', 'ch_pgtap_r17_1', now() - interval '15 days'),
  ('c17f0002-0000-0000-0000-000000000001', 'c17d0000-0000-0000-0000-000000000001', 'c17e0002-0000-0000-0000-000000000001', 5000, 5350, 'USD', 'confirmed',
   now() - interval '20 days', null, 'pi_pgtap_r17_2', 'ch_pgtap_r17_2', now() - interval '15 days'),
  ('c17f0003-0000-0000-0000-000000000001', 'c17d0000-0000-0000-0000-000000000001', 'c17e0003-0000-0000-0000-000000000001', 20000, 21400, 'USD', 'confirmed',
   now() - interval '20 days', now() - interval '9 days', 'pi_pgtap_r17_3', 'ch_pgtap_r17_3', now() - interval '15 days'),
  ('c17f0007-0000-0000-0000-000000000001', 'c17d0000-0000-0000-0000-000000000001', 'c17e0007-0000-0000-0000-000000000001', 8000, 8560, 'USD', 'confirmed',
   now() - interval '20 days', null, 'pi_pgtap_r17_7', 'ch_pgtap_r17_7', now() - interval '15 days'),
  ('c17f0004-0000-0000-0000-000000000002', 'c17d0000-0000-0000-0000-000000000002', 'c17e0004-0000-0000-0000-000000000002', 30000, 32100, 'USD', 'confirmed',
   now() - interval '20 days', now() - interval '9 days', 'pi_pgtap_r17_4', 'ch_pgtap_r17_4', now() - interval '15 days'),
  ('c17f0005-0000-0000-0000-000000000003', 'c17d0000-0000-0000-0000-000000000003', 'c17e0005-0000-0000-0000-000000000003', 50000, 53500, 'USD', 'confirmed',
   now() - interval '20 days', now() - interval '9 days', 'pi_pgtap_r17_5', 'ch_pgtap_r17_5', now() - interval '15 days'),
  ('c17f0006-0000-0000-0000-000000000003', 'c17d0000-0000-0000-0000-000000000003', 'c17e0006-0000-0000-0000-000000000003', 15000, 16050, 'USD', 'confirmed',
   now() - interval '20 days', now() - interval '10 days', 'pi_pgtap_r17_6', 'ch_pgtap_r17_6', now() - interval '15 days');

insert into public.factory_payout_accounts (id, org_id, method, paypal_email, is_primary, details_changed_at) values
  ('c1790000-0000-0000-0000-000000000002', 'c17b0000-0000-0000-0000-0000000000e2', 'paypal', 'pgtap-r17-f2@example.com', true, '2026-11-01'),
  ('c1790000-0000-0000-0000-000000000003', 'c17b0000-0000-0000-0000-0000000000e3', 'paypal', 'pgtap-r17-f3@example.com', true, '2026-11-01');
insert into public.factory_payout_preferences (org_id, route) values
  ('c17b0000-0000-0000-0000-0000000000e2', 'manual'), ('c17b0000-0000-0000-0000-0000000000e3', 'manual');
insert into public.stripe_connect_accounts (org_id, stripe_account_id, country, transfers_active, payouts_enabled, details_submitted)
values ('c17b0000-0000-0000-0000-0000000000e3', 'acct_pgtap_r17', 'US', true, true, true);
insert into public.stripe_withdrawals (id, org_id, stripe_account_id, request_key, request_id, amount_minor, currency, usd_cents, state)
values ('c1780000-0000-0000-0000-000000000003', 'c17b0000-0000-0000-0000-0000000000e3', 'acct_pgtap_r17', 'pgtap-r17-sw-1', gen_random_uuid(), 15000, 'USD', 15000, 'claimed');
set local session_replication_role = origin;

create function pg_temp.act_as(who text) returns void language sql as $f$
  select set_config('request.jwt.claims',
    json_build_object('sub', 'c17a0000-0000-0000-0000-' || lpad(who, 12, '0'), 'role', 'authenticated')::text, true);
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
create function pg_temp.org(n int) returns uuid language sql immutable as $f$
  select ('c17b0000-0000-0000-0000-0000000000e' || n)::uuid;
$f$;
create function pg_temp.pay(n int) returns uuid language sql immutable as $f$
  select ('c17f000' || n || '-0000-0000-0000-00000000000' || case when n in (1, 2, 3, 7) then 1 when n = 4 then 2 else 3 end)::uuid;
$f$;
create function pg_temp.bal(n int) returns jsonb language plpgsql as $f$
declare j jsonb;
begin
  perform pg_temp.act_as(case n when 1 then '01' when 2 then '04' else '05' end);
  set local role authenticated;
  j := public.factory_balance(pg_temp.org(n));
  reset role;
  return j;
end;
$f$;
create function pg_temp.line(j jsonb) returns text language sql immutable as $f$
  select format('awaiting %s, available %s, pending %s, processing %s, paid out %s, total %s',
    j ->> 'awaiting_cents', j ->> 'available_cents', j ->> 'pending_cents', j ->> 'processing_cents', j ->> 'paid_out_cents', j ->> 'total_cents');
$f$;
-- Total = Awaiting + Available + Pending + Processing + Paid out.
create function pg_temp.adds_up(j jsonb) returns boolean language sql immutable as $f$
  select (j ->> 'total_cents')::bigint = (j ->> 'awaiting_cents')::bigint + (j ->> 'available_cents')::bigint + (j ->> 'pending_cents')::bigint
                                        + (j ->> 'processing_cents')::bigint + (j ->> 'paid_out_cents')::bigint;
$f$;
create function pg_temp.told(org uuid, subject uuid) returns text language sql as $f$
  select string_agg(title || ' | ' || body, ' || ' order by created_at, title) from public.notifications where org_id = org and subject_id = subject;
$f$;
create function pg_temp.told_count(org uuid, subject uuid) returns int language sql as $f$
  select count(*)::int from public.notifications where org_id = org and subject_id = subject;
$f$;
create function pg_temp.refund(n int, total bigint) returns void language plpgsql as $f$
begin
  perform pg_temp.as_server(format('select public.record_payment_refund_amount(%L, %L, %s)', pg_temp.pay(n), 'pi_pgtap_r17_' || n, total));
end;
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
create function pg_temp.owed_count() returns int language plpgsql as $f$
declare n int;
begin
  perform pg_temp.act_as('02');
  set local role authenticated;
  select payments_awaiting_confirmation into n from public.admin_overview_metrics();
  reset role;
  return n;
end;
$f$;
create function pg_temp.reviews(n int) returns jsonb language plpgsql as $f$
declare j jsonb;
begin
  perform pg_temp.act_as('02');
  set local role authenticated;
  select coalesce(jsonb_agg(jsonb_build_object('pay', x ->> 'payment_id', 'cause', x ->> 'cause', 'amount', (x ->> 'amount_cents')::bigint,
                                               'withdrawn', (x ->> 'withdrawn_cents')::bigint, 'fee', x -> 'dispute_fee_cents')
                            order by x ->> 'cause'), '[]'::jsonb) into j
    from jsonb_array_elements(public.payment_review_board()) x
   where (x ->> 'factory_org_id')::uuid = pg_temp.org(n) and (x ->> 'factory_paused')::boolean;
  reset role;
  return j;
end;
$f$;
create function pg_temp.recover(n int) returns jsonb language sql as $f$
  select coalesce(jsonb_agg(x order by x ->> 'amount_cents'), '[]'::jsonb) from jsonb_array_elements(pg_temp.attention() -> 'recover') x
   where (x ->> 'org_id')::uuid = pg_temp.org(n);
$f$;

-- ===========================================================================
-- 1. Before approval.
-- ===========================================================================
select is(pg_temp.line(pg_temp.bal(1)), 'awaiting 23000, available 20000, pending 0, processing 0, paid out 0, total 43000',
  'F1 before: $100 + $50 + $80 awaiting approval, the $200 deposit available');

-- A partial refund ($53.50 of the $107.00 charge) is recorded, never made bigger.
select lives_ok($$select pg_temp.refund(1, 5350)$$, 'half of the fit sample''s charge is refunded in Stripe');
select ok((select state = 'confirmed' and refunded_cents = 5350 and factory_refund_cents = 5000 and refund_amount_at is not null
             from public.order_payments where id = pg_temp.pay(1)),
  'still funded, at the lower amount: the factory''s part is in proportion ($50.00 of the $53.50)');
select is(pg_temp.line(pg_temp.bal(1)), 'awaiting 18000, available 20000, pending 0, processing 0, paid out 0, total 38000',
  'Awaiting approval drops by the factory''s $50.00; nothing else moves');
select ok(exists (select 1 from jsonb_array_elements(pg_temp.bal(1) -> 'rows') r
                   where (r ->> 'payment_id')::uuid = pg_temp.pay(1) and r ->> 'figure' = 'refunded'
                     and (r ->> 'amount_cents')::bigint = -5000 and r ->> 'cause' = 'refund' and r ->> 'at' is not null),
  'a dated Refunded row of its own, below zero');
select is((select title || ' | ' || body from public.notifications where org_id = 'c17b0000-0000-0000-0000-00000000000b' and subject_id = pg_temp.pay(1)),
  'Your payment for "R17 fit sample" was refunded | $53.50 was refunded to your card.', 'the brand is told what went back');
select is(pg_temp.told(pg_temp.org(1), pg_temp.pay(1)),
  'Payment for "R17 fit sample" refunded | The brand was refunded $53.50. Your earnings from R17 request 1 (R17-1) went down by $50.00.', 'the factory is told its part');
select ok((select count(*) = 0 from public.notifications where org_id = 'c17b0000-0000-0000-0000-00000000000b' and subject_id = pg_temp.pay(1)
            and body like '%Pay again%'), 'no "pay again" for a partial refund');

-- The same total again: nothing; a smaller one (a refund that failed): recorded quietly.
create temp table r17_seen on commit drop as
  select (select count(*) from public.notifications where subject_id = pg_temp.pay(1))::int as notes,
         (select count(*) from public.payment_events where payment_id = pg_temp.pay(1))::int as events;
select lives_ok($$select pg_temp.refund(1, 5350)$$, 'the same refund reported again');
select ok((select count(*) from public.notifications where subject_id = pg_temp.pay(1))::int = (select notes from r17_seen)
      and (select count(*) from public.payment_events where payment_id = pg_temp.pay(1))::int = (select events from r17_seen),
  'changes nothing and tells nobody');
select lives_ok($$select pg_temp.refund(1, 2675)$$, 'an older copy of the charge reports less refunded');
select ok((select refunded_cents = 5350 from public.order_payments where id = pg_temp.pay(1)), 'never lowers it (20261121230000)');
select lives_ok($$select pg_temp.as_server(format('select public.record_payment_refund_failed(%L, %L, 2675)', pg_temp.pay(1), 'pi_pgtap_r17_1'))$$,
  'Stripe, read again, says a refund failed: $26.75 in all');
select ok((select refunded_cents = 2675 and factory_refund_cents = 2500 from public.order_payments where id = pg_temp.pay(1)),
  'the smaller total is recorded');
select is((pg_temp.bal(1) ->> 'awaiting_cents')::bigint, 20500::bigint, 'and the factory''s earning comes back up');
select is((select count(*) from public.notifications where subject_id = pg_temp.pay(1))::int, (select notes from r17_seen) + 2,
  'the brand and the factory are told the refund did not go through (20261121240000)');

-- Refunded in full before approval: as before, back to Due; the brand pays again.
select lives_ok($$select pg_temp.refund(2, 5350)$$, 'the lab dip''s charge is refunded in full');
select ok((select state = 'due' and refunded_cents = 0 and factory_refund_cents = 0 and stripe_payment_intent_id is null
                  and failure_reason is null
             from public.order_payments where id = pg_temp.pay(2)),
  'back to be paid again: the next charge starts with nothing refunded');
select matches((select body from public.notifications where org_id = 'c17b0000-0000-0000-0000-00000000000b' and subject_id = pg_temp.pay(2)),
  'Pay again from the step''s payment page on R17 request 1 \(R17-1\)\.$', 'the brand is asked to pay again');

-- A dispute lost before approval: the same, in the bank's words.
select lives_ok(format($$select pg_temp.as_server(%L)$$,
  format('select public.record_payment_dispute_lost(%L, %L, 8560, 1500)', pg_temp.pay(7), 'du_pgtap_r17_7')),
  'the brand''s bank decides the trims charge against TSC');
select ok((select state = 'failed' and failure_reason = 'Your bank reversed this payment.' and disputed_at is null and dispute_lost_cents = 0
             from public.order_payments where id = pg_temp.pay(7)), 'back to be paid again');
select is((select title || ' | ' || body from public.notifications where org_id = 'c17b0000-0000-0000-0000-00000000000b' and subject_id = pg_temp.pay(7)),
  'Your bank reversed your payment for "R17 trims" | $85.60 went back to your card. Pay again from the step''s payment page on R17 request 1 (R17-1).',
  'the brand is told, and asked to pay again');
select is(pg_temp.told(pg_temp.org(1), pg_temp.pay(7)),
  'Payment for "R17 trims" reversed | TSC no longer holds money for this step on R17 request 1 (R17-1). The brand has been asked to pay again; we will tell you when it is held.',
  'the factory is told');
select lives_ok(format($$select pg_temp.as_server(%L)$$,
  format('select public.record_payment_dispute_lost(%L, %L, 8560, 1500)', pg_temp.pay(7), 'du_pgtap_r17_7')), 'the same dispute reported again');
select is(pg_temp.told_count(pg_temp.org(1), pg_temp.pay(7)) + pg_temp.told_count('c17b0000-0000-0000-0000-00000000000b', pg_temp.pay(7)), 2,
  'once');

-- A funded deposit (the factory's already) refunded in full: the step stays done.
select lives_ok($$select pg_temp.refund(3, 21400)$$, 'the deposit''s charge is refunded in full, after it was added to the balance');
select ok((select state = 'confirmed' and release_requested_at is not null and refunded_cents = 21400 and factory_refund_cents = 0
                  and review_kept_cents = 21400
             from public.order_payments where id = pg_temp.pay(3)) and public.factory_paused(pg_temp.org(1)),
  'the payment stays the factory''s step, its earning kept: a payment review pauses the factory instead (20261124100000)');
select is((select state from public.order_milestones where id = 'c17e0003-0000-0000-0000-000000000001'), 'complete', 'the step stays done');
select is((select title || ' | ' || body from public.notifications where org_id = 'c17b0000-0000-0000-0000-00000000000b' and subject_id = pg_temp.pay(3)),
  'Your payment for "R17 deposit" was refunded | $214.00 was refunded to your card.', 'the brand is told, and not asked to pay again');
select is(pg_temp.told(pg_temp.org(1), pg_temp.pay(3)),
  'Withdrawals paused | A brand requested a refund for "R17 deposit" on R17 request 1 (R17-1), so our team is reviewing the payment. Withdrawals are paused until the review is done.',
  'the factory is told its withdrawals are paused, not that its earnings went down');
select is(pg_temp.line(pg_temp.bal(1)), 'awaiting 7500, available 20000, pending 0, processing 0, paid out 0, total 27500',
  'F1 after: the fit sample at $75.00, the deposit still Available while it is reviewed; the lab dip and the trims in no figure');
select ok(pg_temp.adds_up(pg_temp.bal(1)), 'Total = Awaiting + Available + Pending + Processing + Paid out');
select is((pg_temp.bal(1) ->> 'owed_to_tsc_cents')::bigint, 0::bigint, 'nothing had left TSC: nothing is owed');

-- ===========================================================================
-- 2. A refund under a waiting PayPal withdrawal.
-- ===========================================================================
select pg_temp.act_as('04'); set local role authenticated;
select lives_ok($$select set_config('tsc.r17_w2',
  (public.request_withdrawal('c17b0000-0000-0000-0000-0000000000e2', 25000, 'c1790000-0000-0000-0000-000000000002')).id::text, true)$$,
  'F2 asks to withdraw $250 of its $300 deposit');
reset role;
select is(pg_temp.line(pg_temp.bal(2)), 'awaiting 0, available 5000, pending 0, processing 25000, paid out 0, total 30000', 'F2 before');
select lives_ok($$select pg_temp.refund(4, 10700)$$, 'staff refund $107.00 of the deposit''s charge (a short shipment)');
select ok((select refunded_cents = 10700 and factory_refund_cents = 0 and review_kept_cents = 10700 from public.order_payments where id = pg_temp.pay(4))
          and public.factory_paused(pg_temp.org(2)),
  'the factory''s part is kept: a payment review pauses F2 (20261124100000)');
select is(pg_temp.line(pg_temp.bal(2)), 'awaiting 0, available 5000, pending 0, processing 25000, paid out 0, total 30000',
  'nothing is taken: not from the $50 still with TSC, not from the waiting withdrawal');
select ok(pg_temp.adds_up(pg_temp.bal(2)), 'Total = Awaiting + Available + Pending + Processing + Paid out');
select is((select x -> 'parts' from jsonb_array_elements(pg_temp.bal(2) -> 'withdrawals') x where x ->> 'id' = current_setting('tsc.r17_w2')),
  '[{"word": "on_hold", "amount_cents": 25000}]'::jsonb,
  'the withdrawal: all $250 still held by it, nothing refunded out of it (paused, not lowered)');
select is((select x ->> 'word' from jsonb_array_elements(pg_temp.bal(2) -> 'withdrawals') x where x ->> 'id' = current_setting('tsc.r17_w2')),
  'on_hold', 'it is on hold until cancelled');
select is((select count(*)::int from public.notifications where org_id = pg_temp.org(2) and kind = 'withdrawal' and title like '%on hold'), 0,
  'no "withdrawal on hold, refunded" notice: the refund took nothing from it');
select is(pg_temp.told(pg_temp.org(2), pg_temp.pay(4)),
  'Withdrawals paused | A brand requested a refund for "R17 bulk deposit" on R17 request 2 (R17-2), so our team is reviewing the payment. Withdrawals are paused until the review is done.',
  'the factory is told, once, that its withdrawals are paused');
select pg_temp.act_as('02'); set local role authenticated;
select throws_ok($$select public.claim_withdrawal(current_setting('tsc.r17_w2')::uuid)$$, '22023', null, 'staff cannot pay it');
reset role;
select pg_temp.act_as('04'); set local role authenticated;
select is((public.my_withdrawal_balance(pg_temp.org(2)) -> 'returnable' ->> current_setting('tsc.r17_w2'))::bigint, 25000::bigint,
  'cancelling gives back all it holds');
select lives_ok($$select public.cancel_withdrawal(current_setting('tsc.r17_w2')::uuid)$$, 'the owner cancels it');
reset role;
select is((select body from public.notifications where org_id = pg_temp.org(2) and kind = 'withdrawal' and title like '%cancelled'),
  'The amount is back in your balance.', 'and is told truthfully what comes back: all of it');
select is(pg_temp.line(pg_temp.bal(2)), 'awaiting 0, available 30000, pending 0, processing 0, paid out 0, total 30000', 'F2 after: nothing taken');

-- ===========================================================================
-- 3. Refunded or lost after the money left: once owed to TSC; now a
--    payment review, and nothing is owed (20261124100000).
-- ===========================================================================
select lives_ok($$select pg_temp.as_server('select public.claim_owed_steps(''c17b0000-0000-0000-0000-0000000000e3'', 15000, ''stripe'', ''c1780000-0000-0000-0000-000000000003'')')$$,
  'F3 withdraws the $150 fit sample through Stripe');
select lives_ok(format($$select pg_temp.as_server(%L)$$, format('select public.record_take_sent(%L, %L)',
  (select id from public.payment_takes where stripe_withdrawal_id = 'c1780000-0000-0000-0000-000000000003'), 'tr_pgtap_r17')), 'its transfer goes');
select pg_temp.act_as('05'); set local role authenticated;
select lives_ok($$select set_config('tsc.r17_w3',
  (public.request_withdrawal('c17b0000-0000-0000-0000-0000000000e3', 40000, 'c1790000-0000-0000-0000-000000000003')).id::text, true)$$,
  'and asks for $400 of its $500 deposit by PayPal');
reset role;
select pg_temp.act_as('02'); set local role authenticated;
select lives_ok($$select public.claim_withdrawal(current_setting('tsc.r17_w3')::uuid)$$, 'staff pay it');
reset role;
select lives_ok(format($$select pg_temp.as_server(%L)$$,
  format('select public.record_withdrawal(%L, ''paid'', ''PP-R17'', 1000, 39000, ''USD'', null)', current_setting('tsc.r17_w3'))), 'PayPal paid it');
select is(pg_temp.line(pg_temp.bal(3)), 'awaiting 0, available 10000, pending 0, processing 0, paid out 54000, total 64000', 'F3 before');
create temp table r17_before on commit drop as select (pg_temp.bal(3) ->> 'paid_out_cents')::bigint as paid_out, pg_temp.owed_count() as owed;

select lives_ok($$select pg_temp.as_server('select public.record_payment_disputed(''c17f0005-0000-0000-0000-000000000003'', true)')$$,
  'the brand disputes the deposit''s charge');
-- The server opens the dispute's payment review alongside (20261124100000).
select lives_ok($$select pg_temp.as_server('select public.record_payment_review_dispute(''c17f0005-0000-0000-0000-000000000003'', ''du_pgtap_r17_5'', ''needs_response'', 53500, now() + interval ''7 days'', null)')$$,
  'and the server opens its payment review');
select ok(exists (select 1 from jsonb_array_elements(pg_temp.attention() -> 'disputed') x where (x ->> 'payment_id')::uuid = pg_temp.pay(5)
                   and (x ->> 'in_withdrawal_cents')::bigint = 40000), 'staff see it, $400 of it already withdrawn');
select lives_ok(format($$select pg_temp.as_server(%L)$$,
  format('select public.record_payment_dispute_lost(%L, %L, 53500, 1500)', pg_temp.pay(5), 'du_pgtap_r17_5')), 'TSC loses the dispute');
select ok((select disputed_at is null and dispute_lost_cents = 53500 and dispute_lost_at is not null and dispute_fee_cents = 1500
                  and factory_refund_cents = 0 and review_kept_cents = 53500 and state = 'confirmed'
             from public.order_payments where id = pg_temp.pay(5)),
  'recorded as the disputed amount gone back; the hold ends; the fee kept; the factory''s earning kept for the review');
select is(pg_temp.told(pg_temp.org(3), pg_temp.pay(5)),
  'Withdrawals paused | A brand disputed a card payment for "R17 bulk deposit" on R17 request 3 (R17-3), so our team is reviewing it. Withdrawals are paused until the review is done.',
  'the factory is told only that withdrawals are paused: no hold notice, no "owe TSC"');
select is((select title || ' | ' || body from public.notifications where org_id = 'c17b0000-0000-0000-0000-00000000000b' and subject_id = pg_temp.pay(5)
              and kind = 'payment_refunded'),
  'Your bank reversed your payment for "R17 bulk deposit" | $535.00 went back to your card.', 'the brand is told (besides its own "Account under review")');
select ok(not exists (select 1 from jsonb_array_elements(pg_temp.attention() -> 'disputed') x where (x ->> 'payment_id')::uuid = pg_temp.pay(5)),
  'staff are no longer told to respond to it');
select lives_ok(format($$select pg_temp.as_server(%L)$$,
  format('select public.record_payment_dispute_lost(%L, %L, 53500, 1500)', pg_temp.pay(5), 'du_pgtap_r17_5')), 'the same loss reported again');
select lives_ok($$select pg_temp.as_server('select public.record_payment_disputed(''c17f0005-0000-0000-0000-000000000003'', true)')$$,
  'and a later read of the charge says "disputed"');
select ok((select disputed_at is null from public.order_payments where id = pg_temp.pay(5))
      and pg_temp.told_count(pg_temp.org(3), pg_temp.pay(5)) = 1, 'never on hold again; nobody told twice');

select lives_ok(format($$select pg_temp.as_server(%L)$$,
  format('select public.record_payment_refunded(%L, %L, %L)', pg_temp.pay(6), 'pi_pgtap_r17_6', 'The payment was refunded.')),
  'the fit sample''s charge is refunded in full, after the factory withdrew it');
select ok((select state = 'released' and refunded_cents = 16050 and factory_refund_cents = 0 and review_kept_cents = 16050
             from public.order_payments where id = pg_temp.pay(6)),
  'it stays paid out; the whole charge is recorded as refunded; the factory''s earning kept for a review');
select is(pg_temp.told(pg_temp.org(3), pg_temp.pay(6)),
  'Withdrawals paused | A brand requested a refund for "R17 fit sample" on R17 request 3 (R17-3), so our team is reviewing the payment. Withdrawals are paused until the review is done.',
  'the factory is told its withdrawals are paused, not that it owes TSC');

select is(pg_temp.line(pg_temp.bal(3)), 'awaiting 0, available 10000, pending 0, processing 0, paid out 54000, total 64000',
  'F3 after: nothing moves; nothing is owed to TSC');
select is((pg_temp.bal(3) ->> 'paid_out_cents')::bigint, (select paid_out from r17_before), 'Paid out never falls');
select is((pg_temp.bal(3) ->> 'owed_to_tsc_cents')::bigint, 0::bigint, 'owed to TSC: nothing');
select ok(pg_temp.adds_up(pg_temp.bal(3)), 'Total = Awaiting + Available + Pending + Processing + Paid out');

select is(pg_temp.recover(3), '[]'::jsonb, 'nothing to recover on Needs checking');
select is(pg_temp.reviews(3),
  jsonb_build_array(
    jsonb_build_object('pay', pg_temp.pay(5)::text, 'cause', 'dispute', 'amount', 53500, 'withdrawn', 40000, 'fee', 1500),
    jsonb_build_object('pay', pg_temp.pay(6)::text, 'cause', 'refund', 'amount', 16050, 'withdrawn', 15000, 'fee', null)),
  'staff see both as open payment reviews: the cause, the amount, what was already withdrawn, the dispute fee');
select is(pg_temp.owed_count(), (select owed from r17_before) + 2, 'and the overview counts them');

select pg_temp.act_as('05'); set local role authenticated;
select throws_ok($$select public.request_withdrawal('c17b0000-0000-0000-0000-0000000000e3', 100, 'c1790000-0000-0000-0000-000000000003')$$,
  '22023', 'Withdrawals are paused while a payment is reviewed.', 'nothing more can be withdrawn while the payments are reviewed');
select ok((public.my_withdrawal_balance(pg_temp.org(3)) ->> 'available_cents')::bigint = 10000
          and (public.my_payment_pause(pg_temp.org(3)) -> 'factory' ->> 'count')::int = 2,
  'Withdraw shows the $100 balance, not lowered, and says it is paused by two reviews');
select throws_ok($$select public.admin_balance_attention()$$, '42501', null, 'a factory cannot read staff''s list');
reset role;
select is((select (public.owed_reachable(pg_temp.org(3)) ->> 'stripe_cents')::bigint), 10000::bigint,
  'the Stripe road carries no debt either');

-- ===========================================================================
-- 4. Grants and shape.
-- ===========================================================================
select ok(not has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute'), f || ' is the server''s')
  from unnest(array['public.record_payment_refund_amount(uuid, text, bigint)', 'public.record_payment_dispute_lost(uuid, text, bigint, bigint)',
                    'public.withdrawal_refunded_part(uuid)', 'public.take_refunded_cents(public.payment_takes)',
                    'public.payment_debt_cents(public.order_payments)', 'public.factory_debt_cents(uuid, uuid)',
                    'public.payment_factory_base_cents(public.order_payments)', 'public.record_payment_refunded(uuid, text, text, text)',
                    'public.record_payment_disputed(uuid, boolean)', 'public.owed_reachable(uuid)']) f;
select ok(has_function_privilege('service_role', 'public.record_payment_refund_amount(uuid, text, bigint)', 'execute')
      and has_function_privilege('service_role', 'public.record_payment_dispute_lost(uuid, text, bigint, bigint)', 'execute')
      and has_function_privilege('service_role', 'public.withdrawal_refunded_part(uuid)', 'execute'), 'the server can record and check');
select is((select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and proname = f), 1, f || ': one function, no overloads')
  from unnest(array['record_payment_refund_amount', 'record_payment_dispute_lost', 'withdrawal_refunded_part', 'take_refunded_cents',
                    'payment_debt_cents', 'factory_debt_cents', 'payment_factory_base_cents', 'payment_factory_cents', 'factory_balance',
                    'owed_reachable', 'admin_balance_attention', 'record_payment_refunded']) f;

select * from finish();
rollback;
