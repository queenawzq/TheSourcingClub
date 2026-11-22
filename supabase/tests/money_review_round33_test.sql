-- One balance, fix round 33 (20261121350000, 20261121370000).
--
-- H1 (f1, f2): a per-step payout never counts the step it pays as cover for
--   what the factory owes TSC: refused while the debt is more than the
--   factory's OTHER earnings, on every per-step road (Wise / PayPal "Pay
--   again", "Mark paid out by bank", Payoneer).
-- M2 (f3, f4, f5): a partly refunded step tells staff whether the factory can
--   withdraw the rest now or once it adds a withdrawal method; the Payoneer
--   road follows the same rules.
-- D2 (f6, f7): converting the old pool never stops on a pool step refunded in
--   full after it was withdrawn (reset to be paid again): what was withdrawn
--   from it is owed to TSC, as the pool said, until the brand pays it again.
--   A withdrawal beyond every step goes on the last one.
-- D1 (f8): a pool step still clearing or disputed converts; its money is in
--   Available and Pending together, as the pool's Available was.

begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

update public.payout_provider_settings set enabled = case
    when provider = 'paypal' and region in ('china', 'elsewhere') then true else false end;

set local session_replication_role = replica;

insert into auth.users (id, email)
select ('c33a0000-0000-0000-0000-0000000000' || k)::uuid, 'pgtap-r33-' || k || '@example.com'
  from unnest(array['02','03','11','12','13','14','15','16','17','18']) k;
-- 02 is staff; 03 owns the brand; 1N owns factory fN.
insert into public.platform_admins (user_id, note) values ('c33a0000-0000-0000-0000-000000000002', 'pgtap-r33');
insert into public.orgs (id, type, name, slug) values
  ('c33b0000-0000-0000-0000-0000000000b1', 'brand', 'R33 Brand', 'pgtap-r33-brand');
insert into public.orgs (id, type, name, slug)
select ('c33b0000-0000-0000-0000-0000000000f' || n)::uuid, 'factory', 'R33 Factory ' || n, 'pgtap-r33-f' || n from generate_series(1, 8) n;
insert into public.org_members (org_id, user_id, role, permissions) values
  ('c33b0000-0000-0000-0000-0000000000b1', 'c33a0000-0000-0000-0000-000000000003', 'owner', '{}');
insert into public.org_members (org_id, user_id, role, permissions)
select ('c33b0000-0000-0000-0000-0000000000f' || n)::uuid, ('c33a0000-0000-0000-0000-0000000000' || (10 + n))::uuid, 'owner', '{}'
  from generate_series(1, 8) n;

-- Steps pNK: factory N, step K, one order each, all cleared unless said.
--   f1: p11 paid out the old way, then half refunded (owes TSC $500);
--       p12 $1,000; p13 $300 (other earnings $300, less than the debt).
--   f2: p21 paid out, half refunded (owes $500); p22 $1,000; p23 $600 (covers it).
--   f3 (Payoneer only): p31 $1,000, $100 of it refunded.
--   f4 (PayPal): p41 $1,000, $100 of it refunded.
--   f5 (Payoneer): p51 $1,000, disputed.
--   f6 (old pool): p61 released $400; p62 $100, refunded in full after it was
--       withdrawn and reset to be paid again (failed). Paid $500.
--   f7 (old pool): p71 released $400. Paid $450 (more than the pool held).
--   f8 (old pool): p81 $500 still clearing; p82 $200 disputed. No withdrawal.
create temporary table r33_steps (n int, k int, amount bigint, refunded bigint, state text, pool boolean) on commit drop;
insert into r33_steps values
  (1, 1, 100000, 53500, 'released', false), (1, 2, 100000, 0, 'confirmed', false), (1, 3, 30000, 0, 'confirmed', false),
  (2, 1, 100000, 53500, 'released', false), (2, 2, 100000, 0, 'confirmed', false), (2, 3, 60000, 0, 'confirmed', false),
  (3, 1, 100000, 10700, 'confirmed', false),
  (4, 1, 100000, 10700, 'confirmed', false),
  (5, 1, 100000, 0, 'confirmed', false),
  (6, 1, 40000, 0, 'released', true), (6, 2, 10000, 0, 'failed', true),
  (7, 1, 40000, 0, 'released', true),
  (8, 1, 50000, 0, 'confirmed', true), (8, 2, 20000, 0, 'confirmed', true);
insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total)
select ('c33c0000-0000-0000-0000-0000000000' || n || k)::uuid, 'c33b0000-0000-0000-0000-0000000000b1',
       'R33 request ' || n || k, 'awarded', 'invited_only', 100 from r33_steps;
insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity, submitted_at)
select ('c33c1000-0000-0000-0000-0000000000' || n || k)::uuid, ('c33c0000-0000-0000-0000-0000000000' || n || k)::uuid,
       ('c33b0000-0000-0000-0000-0000000000f' || n)::uuid, 'accepted', 100, 1, now() from r33_steps;
insert into public.production_orders
  (id, rfq_id, quote_id, brand_org_id, factory_org_id, unit_price_cents, status, schedule_brand_agreed_at, schedule_brand_agreed_by,
   production_quantity, bulk_subtotal_cents, sample_subtotal_cents, order_total_cents, deposit_pct, balance_pct, order_number)
select ('c33d0000-0000-0000-0000-0000000000' || n || k)::uuid, ('c33c0000-0000-0000-0000-0000000000' || n || k)::uuid,
       ('c33c1000-0000-0000-0000-0000000000' || n || k)::uuid, 'c33b0000-0000-0000-0000-0000000000b1',
       ('c33b0000-0000-0000-0000-0000000000f' || n)::uuid, amount, 'active', now() - interval '60 days',
       'c33a0000-0000-0000-0000-000000000003', 1, amount, 0, amount, 50, 50, 'R33-' || n || k
  from r33_steps;
insert into public.order_milestones (id, order_id, kind, title, amount_cents, state, sort, completed_at)
select ('c33e00' || n || k || '-0000-0000-0000-000000000000')::uuid, ('c33d0000-0000-0000-0000-0000000000' || n || k)::uuid,
       'approval_and_payment'::public.milestone_type, 'R33 step ' || n || k, amount, 'complete'::public.milestone_state, 10,
       now() - interval '30 days'
  from r33_steps;
insert into public.order_payments
  (id, order_id, milestone_id, amount_cents, charged_cents, amount_received_cents, currency, state, confirmed_at, release_requested_at,
   withdrawal_pool, stripe_payment_intent_id, stripe_charge_id, funds_available_at, released_at, released_note,
   refunded_cents, refund_amount_at, refunded_at, failed_at)
select ('c33f00' || n || k || '-0000-0000-0000-000000000000')::uuid, ('c33d0000-0000-0000-0000-0000000000' || n || k)::uuid,
       ('c33e00' || n || k || '-0000-0000-0000-000000000000')::uuid, amount,
       case when state <> 'failed' then amount * 107 / 100 end, case when state <> 'failed' then amount * 107 / 100 end, 'USD',
       state::public.payment_state, case when state <> 'failed' then now() - interval '40 days' end,
       now() - interval '30 days' + (n * 10 + k) * interval '1 minute',
       pool, case when state <> 'failed' then 'pi_pgtap_r33_' || n || k end, case when state <> 'failed' then 'ch_pgtap_r33_' || n || k end,
       case when state <> 'failed' then now() - interval '35 days' end,
       case when state = 'released' then now() - interval '20 days' end,
       case when state = 'released' then case when pool then 'Withdrawn' else 'BANKREF' end end,
       refunded, case when refunded > 0 then now() - interval '5 days' end,
       case when state = 'failed' then now() - interval '3 days' end,
       case when state = 'failed' then now() - interval '3 days' end
  from r33_steps;
-- f3 and f5 are paid by Payoneer (no withdrawal method); the rest by PayPal.
insert into public.factory_payout_accounts (id, org_id, method, paypal_email, payoneer_email, is_primary, details_changed_at)
select ('c3390000-0000-0000-0000-00000000000' || n)::uuid, ('c33b0000-0000-0000-0000-0000000000f' || n)::uuid,
       case when n in (3, 5) then 'payoneer' else 'paypal' end,
       case when n not in (3, 5) then 'pgtap-r33-f' || n || '@example.com' end,
       case when n in (3, 5) then 'pgtap-r33-f' || n || '@example.com' end,
       true, '2026-11-01'
  from generate_series(1, 8) n;
update public.order_payments set disputed_at = now() - interval '1 day'
 where id in ('c33f0051-0000-0000-0000-000000000000', 'c33f0082-0000-0000-0000-000000000000');
-- Never cleared yet (main never wrote the date): it clears 7 days after it was confirmed.
update public.order_payments set funds_available_at = null, confirmed_at = now() - interval '2 days'
 where id = 'c33f0081-0000-0000-0000-000000000000';
insert into public.factory_withdrawals
  (id, org_id, account_id, provider, status, amount_cents, currency, paid_to, pool_cents, created_at, paid_at, decided_at)
values
  ('c3370000-0000-0000-0000-000000000061', 'c33b0000-0000-0000-0000-0000000000f6', 'c3390000-0000-0000-0000-000000000006', 'paypal', 'paid', 50000, 'USD', 'f6', null, now() - interval '15 days', now() - interval '14 days', now() - interval '14 days'),
  ('c3370000-0000-0000-0000-000000000071', 'c33b0000-0000-0000-0000-0000000000f7', 'c3390000-0000-0000-0000-000000000007', 'paypal', 'paid', 45000, 'USD', 'f7', null, now() - interval '15 days', now() - interval '14 days', now() - interval '14 days');
set local session_replication_role = origin;

create function pg_temp.figures(n int) returns jsonb language plpgsql as $f$
declare j jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', 'c33a0000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
  j := public.factory_balance(('c33b0000-0000-0000-0000-0000000000f' || n)::uuid);
  perform set_config('request.jwt.claims', '', true);
  return jsonb_build_object('awaiting', j -> 'awaiting_cents', 'available', j -> 'available_cents', 'pending', j -> 'pending_cents',
    'processing', j -> 'processing_cents', 'paid_out', j -> 'paid_out_cents', 'owed_to_tsc', j -> 'owed_to_tsc_cents', 'total', j -> 'total_cents');
end;
$f$;
create function pg_temp.pay(nk int) returns uuid language sql immutable as $f$
  select ('c33f00' || nk || '-0000-0000-0000-000000000000')::uuid;
$f$;
-- A staff call's refusal, as its hint (null when it went through).
create function pg_temp.staff_hint(sql text) returns text language plpgsql as $f$
declare h text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', 'c33a0000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
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

-- ===========================================================================
-- H1. The step being paid is no cover for what the factory owes TSC.
-- ===========================================================================
select is(public.factory_debt_cents('c33b0000-0000-0000-0000-0000000000f1'), 50000::bigint, 'f1 owes TSC $500');
select is(pg_temp.staff_hint(format('select public.claim_provider_payout(%L, %L, %L, false)', pg_temp.pay(12), 'paypal', '2026-11-01')),
          'payout_owes_tsc', 'f1: "Pay again" on its $1,000 step is refused: only $300 of other earnings cover the $500');
select is((select count(*)::int from public.provider_payouts where payment_id = pg_temp.pay(12)), 0, 'and nothing was asked of PayPal');
select is(pg_temp.staff_hint(format('select public.release_payment_to_factory(%L, %L, %L)', pg_temp.pay(12), 'BANKREF12', '2026-11-01')),
          'payout_owes_tsc', 'f1: "Mark paid out by bank" too');
select is(pg_temp.staff_hint(format('select public.claim_provider_payout(%L, %L, %L, false)', pg_temp.pay(22), 'paypal', '2026-11-01')),
          null, 'f2: its $600 of other earnings cover the $500: paid');
select is((select amount_cents from public.provider_payouts where payment_id = pg_temp.pay(22)), 100000::bigint, 'the whole step');

-- ===========================================================================
-- M2. A partly refunded step; and the Payoneer road follows the rules.
-- ===========================================================================
select is(pg_temp.staff_hint(format('select public.release_payment_to_factory(%L, %L, %L)', pg_temp.pay(31), 'PAYONEER31 by bank', '2026-11-01')),
          'payout_refunded_no_method', 'f3 has no method to withdraw to: staff are told it withdraws once it adds one');
select is(pg_temp.staff_hint(format('select public.claim_provider_payout(%L, %L, %L, false)', pg_temp.pay(41), 'paypal', '2026-11-01')),
          'payout_refunded', 'f4 can withdraw the rest now');
select is(pg_temp.staff_hint(format('select public.release_payment_by_payoneer(%L, %L, %L, null)', pg_temp.pay(31), 'pgtap-r33-f3@example.com', 'PO-R33-31')),
          'payout_refunded_no_method', 'Payoneer: a partly refunded step is refused');
select is(pg_temp.staff_hint(format('select public.release_payment_by_payoneer(%L, %L, %L, null)', pg_temp.pay(51), 'pgtap-r33-f5@example.com', 'PO-R33-51')),
          'payout_disputed', 'Payoneer: a disputed step is refused');
select is((select state::text from public.order_payments where id = pg_temp.pay(51)), 'confirmed', 'and stays owed');

-- ===========================================================================
-- D2. A pool step refunded in full after it was withdrawn converts.
-- ===========================================================================
select lives_ok($$select public.convert_withdrawal_pool()$$, 'the conversion never stops on a step refunded in full after it was withdrawn');
select is(pg_temp.figures(6), '{"total":40000,"pending":0,"awaiting":0,"paid_out":50000,"available":-10000,"processing":0,"owed_to_tsc":10000}'::jsonb,
          'f6: as the pool read it: $500 paid out, $100 owed to TSC');
select is(public.payment_debt_cents((select p from public.order_payments p where id = pg_temp.pay(62))), 10000::bigint,
          'the debt is on the step that went back');
select is((select (x ->> 'amount_cents')::bigint from jsonb_array_elements(
             (select public.admin_balance_attention() from (select set_config('request.jwt.claims',
               json_build_object('sub', 'c33a0000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true)) s) -> 'recover') x
            where x ->> 'payment_id' = pg_temp.pay(62)::text), 10000::bigint, 'staff see it under To recover');
select is(pg_temp.figures(7), '{"total":40000,"pending":0,"awaiting":0,"paid_out":45000,"available":-5000,"processing":0,"owed_to_tsc":5000}'::jsonb,
          'f7: a withdrawal beyond every step: the rest is owed, as the pool read it');
-- The brand pays the step again: it covers what was withdrawn, as the pool did.
set local session_replication_role = replica;
update public.order_payments set state = 'confirmed', charged_cents = 10700, amount_received_cents = 10700,
       confirmed_at = now() - interval '10 days', funds_available_at = now() - interval '1 day',
       stripe_payment_intent_id = 'pi_pgtap_r33_62b', stripe_charge_id = 'ch_pgtap_r33_62b'
 where id = pg_temp.pay(62);
set local session_replication_role = origin;
select is(pg_temp.figures(6), '{"total":50000,"pending":0,"awaiting":0,"paid_out":50000,"available":0,"processing":0,"owed_to_tsc":0}'::jsonb,
          'paid again: nothing owed, nothing more to withdraw');

-- ===========================================================================
-- D1. A pool step still clearing, or disputed.
-- ===========================================================================
select is(((pg_temp.figures(8) ->> 'available')::bigint + (pg_temp.figures(8) ->> 'pending')::bigint), 70000::bigint,
          'f8: Available and Pending together are what the pool called Available');
select is((pg_temp.figures(8) ->> 'pending')::bigint, 70000::bigint, 'still clearing and disputed: Pending');
select is((select count(*)::int from public.order_payments where withdrawal_pool), 0, 'no pool payment is left');

-- Grants and shape.
select ok(not has_function_privilege('authenticated', 'public.per_step_payout_check(public.order_payments, uuid)', 'execute'),
          'per_step_payout_check: not for clients');
select ok(has_function_privilege('authenticated', 'public.release_payment_by_payoneer(uuid, text, text, text)', 'execute'),
          'release_payment_by_payoneer: still staff''s own check inside');
select is((select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and proname = f), 1, f || ': one function, no overloads')
  from unnest(array['per_step_payout_check', 'release_payment_by_payoneer', 'tell_withdrawal_refunded', 'payment_debt_cents',
                    'factory_debt_cents', 'factory_balance', 'my_withdrawal_balance']) f;

select * from finish();
rollback;
