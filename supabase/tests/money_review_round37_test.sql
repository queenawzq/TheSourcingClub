-- One balance, fix round 37 (20261121385000).
--
-- M-1 (g1): two debts, earnings that cover part: the To recover rows add up to
--   the uncovered amount, the covered part off the oldest.
-- M-2 (g2): the "on hold" notice and the takes guard say the uncovered amount.
-- L-1, L-2, L-4 (g3): a step TSC kept to cover an earlier debt is released,
--   reads as kept (not paid) for both sides, and when it is refunded its To
--   recover row and the notice say TSC kept it, never that it was withdrawn.
-- L-3 (g4, g5): a withdrawal returned after it was paid gives back what came
--   back: the provider's fee stays with the factory unless the provider says
--   it returned it.
-- L-7 (g6): staff's disputed row leaves out what TSC kept as cover.

begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

update public.payout_provider_settings set enabled = case
    when provider = 'paypal' and region in ('china', 'elsewhere') then true else false end;

set local session_replication_role = replica;

insert into auth.users (id, email)
select ('c37a0000-0000-0000-0000-0000000000' || k)::uuid, 'pgtap-r37-' || k || '@example.com'
  from unnest(array['02','03','04','11','12','13','14','15','16']) k;
-- 02 is staff; 03 owns the brand; 04 belongs to nothing; 1N owns factory gN.
insert into public.platform_admins (user_id, note) values ('c37a0000-0000-0000-0000-000000000002', 'pgtap-r37');
insert into public.orgs (id, type, name, slug) values
  ('c37b0000-0000-0000-0000-0000000000b1', 'brand', 'R37 Brand', 'pgtap-r37-brand');
insert into public.orgs (id, type, name, slug)
select ('c37b0000-0000-0000-0000-0000000000f' || n)::uuid, 'factory', 'R37 Factory ' || n, 'pgtap-r37-g' || n from generate_series(1, 6) n;
insert into public.org_members (org_id, user_id, role, permissions) values
  ('c37b0000-0000-0000-0000-0000000000b1', 'c37a0000-0000-0000-0000-000000000003', 'owner', '{}');
insert into public.org_members (org_id, user_id, role, permissions)
select ('c37b0000-0000-0000-0000-0000000000f' || n)::uuid, ('c37a0000-0000-0000-0000-0000000000' || (10 + n))::uuid, 'owner', '{}'
  from generate_series(1, 6) n;

-- Steps pNK: factory N, step K, one order each, cleared and approved.
--   g1: p11, p12 $1,000 paid out the old way, $300 of each refunded since
--       (owes $600); p13 $200 (covers $200 of it: $400 uncovered).
--   g2: p21 $1,000 paid out the old way (refunded below); p22 $300, $100 of
--       it held by a waiting withdrawal.
--   g3: p31 $500 paid out the old way, refunded in full (owes $500); p32 $500
--       (TSC keeps it all for p31, then it is refunded); p33 $100, held by a
--       waiting withdrawal.
--   g4, g5: pN1 $1,000 withdrawn by PayPal (fee $30), returned below.
--   g6: p61 $800; p62 $300 paid out the old way, refunded in full (owes $300).
create temporary table r37_steps (n int, k int, amount bigint, refunded bigint, state text, note text) on commit drop;
insert into r37_steps values
  (1, 1, 100000, 32100, 'released', 'BANKREF'), (1, 2, 100000, 32100, 'released', 'BANKREF'), (1, 3, 20000, 0, 'confirmed', null),
  (2, 1, 100000, 0, 'released', 'BANKREF'), (2, 2, 30000, 0, 'confirmed', null),
  (3, 1, 50000, 53500, 'released', 'BANKREF'), (3, 2, 50000, 0, 'confirmed', null), (3, 3, 10000, 0, 'confirmed', null),
  (4, 1, 100000, 0, 'released', 'Withdrawn'),
  (5, 1, 100000, 0, 'released', 'Withdrawn'),
  (6, 1, 80000, 0, 'confirmed', null), (6, 2, 30000, 32100, 'released', 'BANKREF');
insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total)
select ('c37c0000-0000-0000-0000-0000000000' || n || k)::uuid, 'c37b0000-0000-0000-0000-0000000000b1',
       'R37 request ' || n || k, 'awarded', 'invited_only', 100 from r37_steps;
insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity, submitted_at)
select ('c37c1000-0000-0000-0000-0000000000' || n || k)::uuid, ('c37c0000-0000-0000-0000-0000000000' || n || k)::uuid,
       ('c37b0000-0000-0000-0000-0000000000f' || n)::uuid, 'accepted', 100, 1, now() from r37_steps;
insert into public.production_orders
  (id, rfq_id, quote_id, brand_org_id, factory_org_id, unit_price_cents, status, schedule_brand_agreed_at, schedule_brand_agreed_by,
   production_quantity, bulk_subtotal_cents, sample_subtotal_cents, order_total_cents, deposit_pct, balance_pct, order_number)
select ('c37d0000-0000-0000-0000-0000000000' || n || k)::uuid, ('c37c0000-0000-0000-0000-0000000000' || n || k)::uuid,
       ('c37c1000-0000-0000-0000-0000000000' || n || k)::uuid, 'c37b0000-0000-0000-0000-0000000000b1',
       ('c37b0000-0000-0000-0000-0000000000f' || n)::uuid, amount, 'active', now() - interval '60 days',
       'c37a0000-0000-0000-0000-000000000003', 1, amount, 0, amount, 50, 50, 'R37-' || n || k
  from r37_steps;
insert into public.order_milestones (id, order_id, kind, title, amount_cents, state, sort, completed_at)
select ('c37e00' || n || k || '-0000-0000-0000-000000000000')::uuid, ('c37d0000-0000-0000-0000-0000000000' || n || k)::uuid,
       'approval_and_payment'::public.milestone_type, 'R37 step ' || n || k, amount, 'complete'::public.milestone_state, 10,
       now() - interval '30 days'
  from r37_steps;
insert into public.order_payments
  (id, order_id, milestone_id, amount_cents, charged_cents, amount_received_cents, currency, state, confirmed_at, release_requested_at,
   stripe_payment_intent_id, stripe_charge_id, funds_available_at, released_at, released_note,
   refunded_cents, refund_amount_at, refunded_at)
select ('c37f00' || n || k || '-0000-0000-0000-000000000000')::uuid, ('c37d0000-0000-0000-0000-0000000000' || n || k)::uuid,
       ('c37e00' || n || k || '-0000-0000-0000-000000000000')::uuid, amount, amount * 107 / 100, amount * 107 / 100, 'USD',
       state::public.payment_state, now() - interval '40 days', now() - interval '30 days' + (n * 10 + k) * interval '1 minute',
       'pi_pgtap_r37_' || n || k, 'ch_pgtap_r37_' || n || k, now() - interval '35 days',
       case when state = 'released' then now() - interval '20 days' end, note,
       refunded, case when refunded > 0 then now() - interval '5 days' end, null
  from r37_steps;
-- g1's first debt is the older one.
update public.order_payments set refund_amount_at = now() - interval '6 days' where id = 'c37f0011-0000-0000-0000-000000000000';
update public.order_payments set refund_amount_at = now() - interval '3 days' where id = 'c37f0012-0000-0000-0000-000000000000';
insert into public.factory_payout_accounts (id, org_id, method, paypal_email, is_primary, details_changed_at)
select ('c3790000-0000-0000-0000-00000000000' || n)::uuid, ('c37b0000-0000-0000-0000-0000000000f' || n)::uuid,
       'paypal', 'pgtap-r37-g' || n || '@example.com', true, '2026-11-01'
  from generate_series(1, 6) n;
insert into public.factory_withdrawals
  (id, org_id, account_id, provider, status, amount_cents, currency, paid_to, provider_ref, fee_cents, receives_minor, receives_currency,
   created_at, paid_at, decided_at)
values
  ('c3770000-0000-0000-0000-000000000021', 'c37b0000-0000-0000-0000-0000000000f2', 'c3790000-0000-0000-0000-000000000002', 'paypal', 'requested', 10000, 'USD', 'pgtap-r37-g2@example.com', null, null, null, null, now() - interval '1 day', null, null),
  ('c3770000-0000-0000-0000-000000000031', 'c37b0000-0000-0000-0000-0000000000f3', 'c3790000-0000-0000-0000-000000000003', 'paypal', 'requested', 10000, 'USD', 'pgtap-r37-g3@example.com', null, null, null, null, now() - interval '1 day', null, null),
  ('c3770000-0000-0000-0000-000000000041', 'c37b0000-0000-0000-0000-0000000000f4', 'c3790000-0000-0000-0000-000000000004', 'paypal', 'paid', 100000, 'USD', 'pgtap-r37-g4@example.com', 'B-R37-4', 3000, 97000, 'USD', now() - interval '10 days', now() - interval '9 days', now() - interval '9 days'),
  ('c3770000-0000-0000-0000-000000000051', 'c37b0000-0000-0000-0000-0000000000f5', 'c3790000-0000-0000-0000-000000000005', 'paypal', 'paid', 100000, 'USD', 'pgtap-r37-g5@example.com', 'B-R37-5', 3000, 97000, 'USD', now() - interval '10 days', now() - interval '9 days', now() - interval '9 days');
update public.factory_withdrawals w set paid_to_changed_at = a.payee_changed_at
  from public.factory_payout_accounts a where a.id = w.account_id and w.org_id::text like 'c37b%';
insert into public.payment_takes (payment_id, org_id, road, factory_withdrawal_id, amount_cents, status, created_at) values
  ('c37f0022-0000-0000-0000-000000000000', 'c37b0000-0000-0000-0000-0000000000f2', 'pool', 'c3770000-0000-0000-0000-000000000021', 10000, 'held', now() - interval '1 day'),
  ('c37f0033-0000-0000-0000-000000000000', 'c37b0000-0000-0000-0000-0000000000f3', 'pool', 'c3770000-0000-0000-0000-000000000031', 10000, 'held', now() - interval '1 day'),
  ('c37f0041-0000-0000-0000-000000000000', 'c37b0000-0000-0000-0000-0000000000f4', 'pool', 'c3770000-0000-0000-0000-000000000041', 100000, 'sent', now() - interval '10 days'),
  ('c37f0051-0000-0000-0000-000000000000', 'c37b0000-0000-0000-0000-0000000000f5', 'pool', 'c3770000-0000-0000-0000-000000000051', 100000, 'sent', now() - interval '10 days');
set local session_replication_role = origin;

create function pg_temp.as_staff() returns void language sql as $f$
  select set_config('request.jwt.claims', json_build_object('sub', 'c37a0000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
$f$;
create function pg_temp.balance(n int) returns jsonb language plpgsql as $f$
declare j jsonb;
begin
  perform pg_temp.as_staff();
  j := public.factory_balance(('c37b0000-0000-0000-0000-0000000000f' || n)::uuid);
  perform set_config('request.jwt.claims', '', true);
  return j;
end;
$f$;
create function pg_temp.figures(n int) returns jsonb language sql as $f$
  select jsonb_build_object('available', j -> 'available_cents', 'processing', j -> 'processing_cents', 'paid_out', j -> 'paid_out_cents',
    'uncovered', j -> 'uncovered_debt_cents', 'total', j -> 'total_cents') from (select pg_temp.balance(n) j) s;
$f$;
create function pg_temp.attention(list text) returns jsonb language plpgsql as $f$
declare j jsonb;
begin
  perform pg_temp.as_staff();
  j := public.admin_balance_attention() -> list;
  perform set_config('request.jwt.claims', '', true);
  return j;
end;
$f$;
create function pg_temp.pay(nk int) returns uuid language sql immutable as $f$
  select ('c37f00' || nk || '-0000-0000-0000-000000000000')::uuid;
$f$;
create function pg_temp.wd(nk int) returns uuid language sql immutable as $f$
  select ('c3770000-0000-0000-0000-0000000000' || nk)::uuid;
$f$;
create function pg_temp.org(n int) returns uuid language sql immutable as $f$
  select ('c37b0000-0000-0000-0000-0000000000f' || n)::uuid;
$f$;
create function pg_temp.server(sql text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  set local role service_role;
  execute sql;
  reset role;
  perform set_config('request.jwt.claims', '', true);
end;
$f$;
-- payment_kept_by_tsc() as a signed-in person reads it.
create function pg_temp.kept_as(who text, nk int) returns boolean language plpgsql as $f$
declare b boolean;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', ('c37a0000-0000-0000-0000-0000000000' || who), 'role', 'authenticated')::text, true);
  set local role authenticated;
  select public.payment_kept_by_tsc(p) into b from public.order_payments p where p.id = pg_temp.pay(nk);
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return b;
end;
$f$;
create function pg_temp.recover(n int) returns jsonb language sql as $f$
  select coalesce(jsonb_agg(jsonb_build_object('payment', x ->> 'payment_id', 'amount', (x ->> 'amount_cents')::bigint) order by x ->> 'payment_id'), '[]'::jsonb)
    from jsonb_array_elements(pg_temp.attention('recover')) x where x ->> 'org_id' = pg_temp.org(n)::text;
$f$;

-- ===========================================================================
-- M-1. g1 owes $300 twice; $200 of earnings cover the older one in part.
-- ===========================================================================
select is((pg_temp.figures(1) ->> 'uncovered')::bigint, 40000::bigint, 'g1: $400 is not covered (the card''s line)');
select is(pg_temp.recover(1),
          jsonb_build_array(jsonb_build_object('payment', pg_temp.pay(11)::text, 'amount', 10000),
                            jsonb_build_object('payment', pg_temp.pay(12)::text, 'amount', 30000)),
          'To recover: $100 of the older debt and $300 of the newer, never $300 twice');
select is((select sum((x ->> 'amount_cents')::bigint) from jsonb_array_elements(pg_temp.attention('recover')) x where x ->> 'org_id' = pg_temp.org(1)::text),
          40000::numeric, 'the rows add up to the uncovered amount');

-- ===========================================================================
-- M-2. g2: $500 refunded after it was paid out; $200 of earnings left.
-- ===========================================================================
select pg_temp.server(format('select public.record_payment_refund_amount(%L, %L, 53500)', pg_temp.pay(21), 'pi_pgtap_r37_21'));
select is((pg_temp.figures(2) ->> 'uncovered')::bigint, 30000::bigint, 'g2: $300 not covered');
select is((select body from public.notifications where org_id = pg_temp.org(2) and kind = 'withdrawal' and title = 'Withdrawal of $100.00 on hold'),
          'You owe TSC $300.00 for a payment refunded after you withdrew it. This withdrawal is on hold until your earnings cover that amount.',
          'the notice says the uncovered $300, as the card does (not the whole $500)');
create function pg_temp.guard_detail() returns text language plpgsql as $f$
declare d text;
begin
  update public.factory_withdrawals set status = 'paying', lease_until = now() + interval '1 minute' where id = pg_temp.wd(21);
  return null;
exception when others then
  get stacked diagnostics d = pg_exception_detail;
  return d;
end;
$f$;
select is(pg_temp.guard_detail(), '$300.00', 'the takes guard refuses with the uncovered amount too');

-- ===========================================================================
-- L-4. g3: TSC keeps all of p32 for p31's debt.
-- ===========================================================================
select is(public.cover_factory_debt(pg_temp.org(3)), 50000::bigint, 'g3: $500 kept from p32');
select is((select state::text from public.order_payments where id = pg_temp.pay(32)), 'released', 'p32 is released: TSC kept all of it');
select is(pg_temp.kept_as('13', 32), true, 'the factory reads it as kept by TSC, not paid');
select is(pg_temp.kept_as('03', 32), true, 'and so does the brand');
select is(pg_temp.kept_as('04', 32), null::boolean, 'someone outside the order reads nothing');
select is(pg_temp.kept_as('13', 31), false, 'a step paid out the old way is not kept');

-- ===========================================================================
-- L-1, L-2. p32 is refunded in full after TSC kept it.
-- ===========================================================================
select pg_temp.server(format('select public.record_payment_refund_amount(%L, %L, 53500)', pg_temp.pay(32), 'pi_pgtap_r37_32'));
select is((pg_temp.figures(3) ->> 'uncovered')::bigint, 50000::bigint, 'g3: the $500 TSC kept is owed again, none of it covered');
select is((select jsonb_build_object('amount', x -> 'amount_cents', 'kept', x -> 'kept_cents', 'withdrawn', x -> 'withdrawn_cents', 'by', x -> 'withdrawn_by')
             from jsonb_array_elements(pg_temp.attention('recover')) x where x ->> 'payment_id' = pg_temp.pay(32)::text),
          '{"amount":50000,"kept":50000,"withdrawn":0,"by":[]}'::jsonb,
          'To recover: kept by TSC, never "withdrawn by bank transfer"');
select is((select body from public.notifications where org_id = pg_temp.org(3) and kind = 'withdrawal' and title = 'Withdrawal of $100.00 on hold'),
          'You owe TSC $500.00 for a payment refunded after TSC kept it to cover an earlier amount you owed. This withdrawal is on hold until your earnings cover that amount.',
          'the notice says TSC kept it, never that the factory withdrew it');
select is(pg_temp.balance(3) ->> 'debt_kept', 'kept', 'and the card''s line can say the same');
select is(pg_temp.balance(2) ->> 'debt_kept', null, 'g2''s debt is from a withdrawal: no kept line');

-- ===========================================================================
-- L-3. g4: PayPal returns a paid $1,000 withdrawal (fee $30) and does not say
-- what came back; g5: it says all of it did.
-- ===========================================================================
select is(pg_temp.figures(4), '{"available":0,"processing":0,"paid_out":97000,"uncovered":0,"total":97000}'::jsonb,
          'g4: paid, the $30 fee taken from it');
select pg_temp.server(format('select public.record_withdrawal(%L, %L, sentence => %L)', pg_temp.wd(41), 'failed', 'PayPal returned this to TSC.'));
select is((select jsonb_build_object('status', status, 'back', back_cents, 'kept', kept_cents) from public.factory_withdrawals where id = pg_temp.wd(41)),
          '{"status":"failed","back":97000,"kept":3000}'::jsonb, 'returned: $970 came back; PayPal kept its $30 fee');
select is(pg_temp.figures(4), '{"available":97000,"processing":0,"paid_out":0,"uncovered":0,"total":97000}'::jsonb,
          'the factory gets back $970, not $1,000: it bears the fee (Total unchanged)');
select is((select amount_cents from public.payment_takes where factory_withdrawal_id = pg_temp.wd(41) and status = 'sent'), 3000::bigint,
          'what PayPal kept stays sent');
select is((select state::text from public.order_payments where id = pg_temp.pay(41)), 'confirmed', 'the step is owed again, less the fee');
select is((select body from public.notifications where org_id = pg_temp.org(4) and kind = 'withdrawal' and title = 'Withdrawal of $1,000.00 did not go through'),
          '$970.00 is back in your balance. PayPal kept $30.00 of it. Check your withdrawal method, then withdraw again.',
          'the factory is told what came back and what PayPal kept');

select pg_temp.server(format('select public.record_withdrawal_returned(%L, 100000, %L)', pg_temp.wd(51), 'PayPal returned this to TSC.'));
select is((select jsonb_build_object('status', status, 'back', back_cents, 'kept', kept_cents) from public.factory_withdrawals where id = pg_temp.wd(51)),
          '{"status":"failed","back":100000,"kept":0}'::jsonb, 'g5: PayPal says all $1,000 came back: all of it goes back');
select is(pg_temp.figures(5), '{"available":100000,"processing":0,"paid_out":0,"uncovered":0,"total":100000}'::jsonb,
          'the fee came back with it');
select is((select body from public.notifications where org_id = pg_temp.org(5) and kind = 'withdrawal' and title = 'Withdrawal of $1,000.00 did not go through'),
          'The amount is back in your balance. Check your withdrawal method, then withdraw again.', 'told in the failure''s words');
select pg_temp.server(format('select public.record_withdrawal_returned(%L, 100000, null)', pg_temp.wd(51)));
select is((select count(*)::int from public.notifications where org_id = pg_temp.org(5) and kind = 'withdrawal' and title like '% did not go through'), 1,
          'a repeat does nothing');

-- ===========================================================================
-- L-7. g6: TSC keeps $300 of p61 for p62; then p61's charge is disputed.
-- ===========================================================================
select is(public.cover_factory_debt(pg_temp.org(6)), 30000::bigint, 'g6: $300 kept from p61');
select pg_temp.server(format('select public.record_payment_disputed(%L, true)', pg_temp.pay(61)));
select is((select (x ->> 'amount_cents')::bigint from jsonb_array_elements(pg_temp.attention('disputed')) x where x ->> 'payment_id' = pg_temp.pay(61)::text),
          50000::bigint, 'staff''s disputed row: $500 on hold, not the $300 TSC kept');

-- Grants and shape.
select ok(not has_function_privilege('authenticated', p, 'execute'), p || ': not for clients')
  from unnest(array['public.record_withdrawal_returned(uuid, bigint, text)', 'public.payment_tsc_kept_cents(uuid)']) p;
select ok(not has_function_privilege('anon', 'public.payment_kept_by_tsc(public.order_payments)', 'execute'), 'payment_kept_by_tsc: not for anon');
select ok(has_function_privilege('authenticated', 'public.payment_kept_by_tsc(public.order_payments)', 'execute'), 'payment_kept_by_tsc: a computed column the screens read');
select is((select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and proname = f), 1, f || ': one function, no overloads')
  from unnest(array['record_withdrawal', 'record_withdrawal_returned', 'factory_balance', 'admin_balance_attention', 'tell_withdrawal_refunded',
                    'guard_withdrawal_takes', 'payment_kept_by_tsc', 'payment_tsc_kept_cents']) f;

select * from finish();
rollback;
