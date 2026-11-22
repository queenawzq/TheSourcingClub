-- One rule per check (20261121400000).
--
-- Whether a waiting PayPal / Wise withdrawal can go is withdrawal_blocker():
-- withdrawal_covered (the page's word), claim_withdrawal (staff approve) and
-- the guard on any move off 'requested' all say the same, debt first.
--   fa: step a1 $1,000 cleared; withdrawal wa $500 held on it. Can go; then
--       a1 is disputed: "over balance" everywhere.
--   fb: step b1 paid out the old way, then half refunded (owes TSC $500);
--       step b2 $300, all of it held by withdrawal wb. Owes TSC everywhere,
--       also once b2 is disputed too (debt is said first).
-- What the factory earns from a step is payment_factory_base_cents less its
-- refunded part, for every fixture payment.

begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

set local session_replication_role = replica;

insert into auth.users (id, email)
select ('c38a0000-0000-0000-0000-0000000000' || k)::uuid, 'pgtap-s1-' || k || '@example.com'
  from unnest(array['02','03','11','12']) k;
-- 02 is staff; 03 owns the brand; 11 owns fa, 12 owns fb.
insert into public.platform_admins (user_id, note) values ('c38a0000-0000-0000-0000-000000000002', 'pgtap-s1');
insert into public.orgs (id, type, name, slug) values
  ('c38b0000-0000-0000-0000-0000000000b1', 'brand', 'S1 Brand', 'pgtap-s1-brand'),
  ('c38b0000-0000-0000-0000-0000000000f1', 'factory', 'S1 Factory A', 'pgtap-s1-fa'),
  ('c38b0000-0000-0000-0000-0000000000f2', 'factory', 'S1 Factory B', 'pgtap-s1-fb');
insert into public.org_members (org_id, user_id, role, permissions) values
  ('c38b0000-0000-0000-0000-0000000000b1', 'c38a0000-0000-0000-0000-000000000003', 'owner', '{}'),
  ('c38b0000-0000-0000-0000-0000000000f1', 'c38a0000-0000-0000-0000-000000000011', 'owner', '{}'),
  ('c38b0000-0000-0000-0000-0000000000f2', 'c38a0000-0000-0000-0000-000000000012', 'owner', '{}');

-- Steps: n = factory (1 fa, 2 fb), k = step.
create temporary table s1_steps (n int, k int, amount bigint, refunded bigint, state text) on commit drop;
insert into s1_steps values (1, 1, 100000, 0, 'confirmed'), (2, 1, 100000, 53500, 'released'), (2, 2, 30000, 0, 'confirmed');
insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total)
select ('c38c0000-0000-0000-0000-0000000000' || n || k)::uuid, 'c38b0000-0000-0000-0000-0000000000b1',
       'S1 request ' || n || k, 'awarded', 'invited_only', 100 from s1_steps;
insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity, submitted_at)
select ('c38c1000-0000-0000-0000-0000000000' || n || k)::uuid, ('c38c0000-0000-0000-0000-0000000000' || n || k)::uuid,
       ('c38b0000-0000-0000-0000-0000000000f' || n)::uuid, 'accepted', 100, 1, now() from s1_steps;
insert into public.production_orders
  (id, rfq_id, quote_id, brand_org_id, factory_org_id, unit_price_cents, status, schedule_brand_agreed_at, schedule_brand_agreed_by,
   production_quantity, bulk_subtotal_cents, sample_subtotal_cents, order_total_cents, deposit_pct, balance_pct, order_number)
select ('c38d0000-0000-0000-0000-0000000000' || n || k)::uuid, ('c38c0000-0000-0000-0000-0000000000' || n || k)::uuid,
       ('c38c1000-0000-0000-0000-0000000000' || n || k)::uuid, 'c38b0000-0000-0000-0000-0000000000b1',
       ('c38b0000-0000-0000-0000-0000000000f' || n)::uuid, amount, 'active', now() - interval '60 days',
       'c38a0000-0000-0000-0000-000000000003', 1, amount, 0, amount, 50, 50, 'S1-' || n || k
  from s1_steps;
insert into public.order_milestones (id, order_id, kind, title, amount_cents, state, sort, completed_at)
select ('c38e00' || n || k || '-0000-0000-0000-000000000000')::uuid, ('c38d0000-0000-0000-0000-0000000000' || n || k)::uuid,
       'approval_and_payment'::public.milestone_type, 'S1 step ' || n || k, amount, 'complete'::public.milestone_state, 10,
       now() - interval '30 days'
  from s1_steps;
insert into public.order_payments
  (id, order_id, milestone_id, amount_cents, charged_cents, amount_received_cents, currency, state, confirmed_at, release_requested_at,
   stripe_payment_intent_id, stripe_charge_id, funds_available_at, released_at, released_note, refunded_cents, refund_amount_at)
select ('c38f00' || n || k || '-0000-0000-0000-000000000000')::uuid, ('c38d0000-0000-0000-0000-0000000000' || n || k)::uuid,
       ('c38e00' || n || k || '-0000-0000-0000-000000000000')::uuid, amount, amount * 107 / 100, amount * 107 / 100, 'USD',
       state::public.payment_state, now() - interval '40 days', now() - interval '30 days' + (n * 10 + k) * interval '1 minute',
       'pi_pgtap_s1_' || n || k, 'ch_pgtap_s1_' || n || k, now() - interval '35 days',
       case when state = 'released' then now() - interval '20 days' end,
       case when state = 'released' then 'BANKREF' end,
       refunded, case when refunded > 0 then now() - interval '5 days' end
  from s1_steps;
insert into public.factory_payout_accounts (id, org_id, method, paypal_email, is_primary, details_changed_at, payee_changed_at)
select ('c3890000-0000-0000-0000-00000000000' || n)::uuid, ('c38b0000-0000-0000-0000-0000000000f' || n)::uuid,
       'paypal', 'pgtap-s1-f' || n || '@example.com', true, '2026-11-01', '2026-11-01'
  from generate_series(1, 2) n;
insert into public.factory_withdrawals
  (id, org_id, account_id, provider, status, amount_cents, currency, paid_to, paid_to_changed_at, created_at)
values
  ('c3870000-0000-0000-0000-0000000000a1', 'c38b0000-0000-0000-0000-0000000000f1', 'c3890000-0000-0000-0000-000000000001', 'paypal', 'requested', 50000, 'USD', 'fa', '2026-11-01', now() - interval '1 day'),
  ('c3870000-0000-0000-0000-0000000000b1', 'c38b0000-0000-0000-0000-0000000000f2', 'c3890000-0000-0000-0000-000000000002', 'paypal', 'requested', 30000, 'USD', 'fb', '2026-11-01', now() - interval '1 day');
insert into public.payment_takes (payment_id, org_id, road, factory_withdrawal_id, amount_cents, status) values
  ('c38f0011-0000-0000-0000-000000000000', 'c38b0000-0000-0000-0000-0000000000f1', 'pool', 'c3870000-0000-0000-0000-0000000000a1', 50000, 'held'),
  ('c38f0022-0000-0000-0000-000000000000', 'c38b0000-0000-0000-0000-0000000000f2', 'pool', 'c3870000-0000-0000-0000-0000000000b1', 30000, 'held');
set local session_replication_role = origin;

create function pg_temp.w(which text) returns public.factory_withdrawals language sql as $f$
  select * from public.factory_withdrawals where id = ('c3870000-0000-0000-0000-0000000000' || which)::uuid;
$f$;
-- A call's refusal, as its hint (null when it went through), as staff or as the database itself.
create function pg_temp.hint(sql text, staff boolean) returns text language plpgsql as $f$
declare h text;
begin
  if staff then
    perform set_config('request.jwt.claims', json_build_object('sub', 'c38a0000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
    set local role authenticated;
  end if;
  begin
    execute sql;
    reset role;
    raise exception 'went through' using hint = 'went_through';
  exception when others then
    get stacked diagnostics h = pg_exception_hint;
    reset role;
    return nullif(h, '');
  end;
end;
$f$;

-- fa: nothing in the way.
select is(public.withdrawal_blocker(pg_temp.w('a1')), null, 'fa: nothing stops the withdrawal');
select ok(public.withdrawal_covered(pg_temp.w('a1')), 'fa: the page says it is covered');
select is(pg_temp.hint($$update public.factory_withdrawals set status = 'paying' where id = 'c3870000-0000-0000-0000-0000000000a1'$$, false),
          'went_through', 'fa: the guard lets it move');

-- fa, its step disputed since: "over balance" from all three.
update public.order_payments set disputed_at = now() where id = 'c38f0011-0000-0000-0000-000000000000';
select is(public.withdrawal_blocker(pg_temp.w('a1')), 'withdrawal_over_balance', 'fa disputed: over balance');
select ok(not public.withdrawal_covered(pg_temp.w('a1')), 'fa disputed: the page says on hold');
select is(pg_temp.hint($$update public.factory_withdrawals set status = 'paying' where id = 'c3870000-0000-0000-0000-0000000000a1'$$, false),
          'withdrawal_over_balance', 'fa disputed: the guard refuses');
select is(pg_temp.hint($$select public.claim_withdrawal('c3870000-0000-0000-0000-0000000000a1')$$, true),
          'withdrawal_over_balance', 'fa disputed: staff approving is refused the same way');

-- fb: owes TSC more than its other earnings.
select is(public.withdrawal_blocker(pg_temp.w('b1')), 'withdrawal_owes_tsc', 'fb: owes TSC');
select ok(not public.withdrawal_covered(pg_temp.w('b1')), 'fb: the page says on hold');
select is(pg_temp.hint($$update public.factory_withdrawals set status = 'paid' where id = 'c3870000-0000-0000-0000-0000000000b1'$$, false),
          'withdrawal_owes_tsc', 'fb: the guard refuses');
select is(pg_temp.hint($$select public.claim_withdrawal('c3870000-0000-0000-0000-0000000000b1')$$, true),
          'withdrawal_owes_tsc', 'fb: staff approving is refused the same way');
update public.order_payments set disputed_at = now() where id = 'c38f0022-0000-0000-0000-000000000000';
select is(public.withdrawal_blocker(pg_temp.w('b1')), 'withdrawal_owes_tsc', 'fb, its step disputed too: the debt is said first');
select is(pg_temp.hint($$update public.factory_withdrawals set status = 'paying' where id = 'c3870000-0000-0000-0000-0000000000b1'$$, false),
          'withdrawal_owes_tsc', 'fb, both: the guard says the debt first too');

-- What the factory earns from a step: one formula.
select is((select count(*) from public.order_payments p where p.id::text like 'c38f00%'
            and public.payment_factory_cents(p) <> greatest(public.payment_factory_base_cents(p) - p.factory_refund_cents, 0)), 0::bigint,
          'payment_factory_cents is the base less the refunded part');
select is((select public.payment_factory_cents(p) from public.order_payments p where p.id = 'c38f0021-0000-0000-0000-000000000000'), 50000::bigint,
          'b1: $1,000 less its $500 refunded part');

-- The two new functions are internal.
select ok(not has_function_privilege('authenticated', 'public.withdrawal_blocker(public.factory_withdrawals)', 'execute'), 'withdrawal_blocker: not for clients');
select ok(not has_function_privilege('authenticated', 'public.check_withdrawal_can_go(public.factory_withdrawals)', 'execute'), 'check_withdrawal_can_go: not for clients');
select ok(not has_function_privilege('anon', 'public.check_withdrawal_can_go(public.factory_withdrawals)', 'execute'), 'nor for anon');

-- Simplify review L5: the Stripe road's "owes TSC" (claim_owed_steps) names
-- what the other earnings do not cover, as every other refusal does; with
-- the debt covered, asking for more than it leaves is over the balance.
set local session_replication_role = replica;
update public.order_payments set disputed_at = null where id = 'c38f0022-0000-0000-0000-000000000000';
delete from public.payment_takes where factory_withdrawal_id = 'c3870000-0000-0000-0000-0000000000b1';
insert into public.stripe_withdrawals (id, org_id, stripe_account_id, request_key, request_id, amount_minor, currency, usd_cents, state)
values ('c3860000-0000-0000-0000-0000000000b2', 'c38b0000-0000-0000-0000-0000000000f2', 'acct_pgtap_s1_fb', 'pgtap-s1-sw-b2',
        gen_random_uuid(), 10000, 'USD', 10000, 'claimed');
set local session_replication_role = origin;
select is(public.factory_debt_uncovered_cents('c38b0000-0000-0000-0000-0000000000f2'), 20000::bigint, 'fb owes $500, $300 of it covered: $200 uncovered');
select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
select throws_ok($$select public.claim_owed_steps('c38b0000-0000-0000-0000-0000000000f2', 10000, 'stripe', 'c3860000-0000-0000-0000-0000000000b2')$$,
  '22023', 'the factory owes TSC $200.00', 'L5: the Stripe road names the uncovered $200, not the whole $500');
-- b2 grows to $2,300: the debt is covered, the Stripe road reaches $1,800.
set local session_replication_role = replica;
update public.order_payments set amount_cents = 230000, charged_cents = 246100, amount_received_cents = 246100
 where id = 'c38f0022-0000-0000-0000-000000000000';
set local session_replication_role = origin;
select is(public.factory_debt_uncovered_cents('c38b0000-0000-0000-0000-0000000000f2'), 0::bigint, 'fb: the debt is covered now');
select is(pg_temp.hint($$select public.claim_owed_steps('c38b0000-0000-0000-0000-0000000000f2', 200000, 'stripe', 'c3860000-0000-0000-0000-0000000000b2')$$, false),
  'withdrawal_over_balance', 'L5: $2,000 of $1,800 reachable is over the balance, never "owes TSC $0.00"');
select is((select count(*)::int from public.payment_takes where stripe_withdrawal_id = 'c3860000-0000-0000-0000-0000000000b2'), 0, 'nothing was taken');

select * from finish();
rollback;
