-- One balance, fix round 39 (20261121385000, 20261121387000).
--
-- L1 (h1, h6): a later, larger figure for a returned withdrawal applies in
--   full, also after a first figure kept part of it; one that can apply
--   nothing changes nothing and tells nobody.
-- L2 (h2, h3): a PayPal / Wise withdrawal that fails while still being sent
--   gives back what the provider returned, at once or by a later figure: the
--   factory bears the fee the provider kept, as after Paid.
-- L3 (h4): what the provider kept is measured against what left TSC
--   (leaves_cents), so a full Wise refund keeps nothing.
-- L5 (h5): a per-step payout refused because the factory owes TSC says the
--   part its other earnings do not cover.
-- I2 (h1): the board's Returned row is lifted by a Stripe withdrawal too.
-- (L4 is the server's: scripts/check-payout-webhooks.mjs.)

begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

update public.payout_provider_settings set enabled = case
    when provider = 'paypal' and region in ('china', 'elsewhere') then true else false end;

set local session_replication_role = replica;

insert into auth.users (id, email)
select ('c39a0000-0000-0000-0000-0000000000' || k)::uuid, 'pgtap-r39-' || k || '@example.com'
  from unnest(array['02','03','11','12','13','14','15','16']) k;
-- 02 is staff; 03 owns the brand; 1N owns factory hN.
insert into public.platform_admins (user_id, note) values ('c39a0000-0000-0000-0000-000000000002', 'pgtap-r39');
insert into public.orgs (id, type, name, slug) values
  ('c39b0000-0000-0000-0000-0000000000b1', 'brand', 'R39 Brand', 'pgtap-r39-brand');
insert into public.orgs (id, type, name, slug)
select ('c39b0000-0000-0000-0000-0000000000f' || n)::uuid, 'factory', 'R39 Factory ' || n, 'pgtap-r39-h' || n from generate_series(1, 6) n;
insert into public.org_members (org_id, user_id, role, permissions) values
  ('c39b0000-0000-0000-0000-0000000000b1', 'c39a0000-0000-0000-0000-000000000003', 'owner', '{}');
insert into public.org_members (org_id, user_id, role, permissions)
select ('c39b0000-0000-0000-0000-0000000000f' || n)::uuid, ('c39a0000-0000-0000-0000-0000000000' || (10 + n))::uuid, 'owner', '{}'
  from generate_series(1, 6) n;

-- Steps pNK: factory N, step K, one order each, cleared and approved.
--   h1, h4, h6: pN1 $1,000 withdrawn in full by a paid withdrawal.
--   h2, h3: pN1 $1,000 held by a withdrawal being sent.
--   h5: p51 $1,000 paid out the old way, half refunded (owes $500); p52
--       $1,000 (the step staff pay); p53 $300 (other earnings).
create temporary table r39_steps (n int, k int, amount bigint, refunded bigint, state text, note text) on commit drop;
insert into r39_steps values
  (1, 1, 100000, 0, 'released', 'Withdrawn'),
  (2, 1, 100000, 0, 'confirmed', null),
  (3, 1, 100000, 0, 'confirmed', null),
  (4, 1, 100000, 0, 'released', 'Withdrawn'),
  (5, 1, 100000, 53500, 'released', 'BANKREF'), (5, 2, 100000, 0, 'confirmed', null), (5, 3, 30000, 0, 'confirmed', null),
  (6, 1, 100000, 0, 'released', 'Withdrawn');
insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total)
select ('c39c0000-0000-0000-0000-0000000000' || n || k)::uuid, 'c39b0000-0000-0000-0000-0000000000b1',
       'R39 request ' || n || k, 'awarded', 'invited_only', 100 from r39_steps;
insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity, submitted_at)
select ('c39c1000-0000-0000-0000-0000000000' || n || k)::uuid, ('c39c0000-0000-0000-0000-0000000000' || n || k)::uuid,
       ('c39b0000-0000-0000-0000-0000000000f' || n)::uuid, 'accepted', 100, 1, now() from r39_steps;
insert into public.production_orders
  (id, rfq_id, quote_id, brand_org_id, factory_org_id, unit_price_cents, status, schedule_brand_agreed_at, schedule_brand_agreed_by,
   production_quantity, bulk_subtotal_cents, sample_subtotal_cents, order_total_cents, deposit_pct, balance_pct, order_number)
select ('c39d0000-0000-0000-0000-0000000000' || n || k)::uuid, ('c39c0000-0000-0000-0000-0000000000' || n || k)::uuid,
       ('c39c1000-0000-0000-0000-0000000000' || n || k)::uuid, 'c39b0000-0000-0000-0000-0000000000b1',
       ('c39b0000-0000-0000-0000-0000000000f' || n)::uuid, amount, 'active', now() - interval '60 days',
       'c39a0000-0000-0000-0000-000000000003', 1, amount, 0, amount, 50, 50, 'R39-' || n || k
  from r39_steps;
insert into public.order_milestones (id, order_id, kind, title, amount_cents, state, sort, completed_at)
select ('c39e00' || n || k || '-0000-0000-0000-000000000000')::uuid, ('c39d0000-0000-0000-0000-0000000000' || n || k)::uuid,
       'approval_and_payment'::public.milestone_type, 'R39 step ' || n || k, amount, 'complete'::public.milestone_state, 10,
       now() - interval '30 days'
  from r39_steps;
insert into public.order_payments
  (id, order_id, milestone_id, amount_cents, charged_cents, amount_received_cents, currency, state, confirmed_at, release_requested_at,
   stripe_payment_intent_id, stripe_charge_id, funds_available_at, released_at, released_note,
   refunded_cents, refund_amount_at, refunded_at)
select ('c39f00' || n || k || '-0000-0000-0000-000000000000')::uuid, ('c39d0000-0000-0000-0000-0000000000' || n || k)::uuid,
       ('c39e00' || n || k || '-0000-0000-0000-000000000000')::uuid, amount, amount * 107 / 100, amount * 107 / 100, 'USD',
       state::public.payment_state, now() - interval '40 days', now() - interval '30 days' + (n * 10 + k) * interval '1 minute',
       'pi_pgtap_r39_' || n || k, 'ch_pgtap_r39_' || n || k, now() - interval '35 days',
       case when state = 'released' then now() - interval '20 days' end, note,
       refunded, case when refunded > 0 then now() - interval '5 days' end, null
  from r39_steps;
insert into public.factory_payout_accounts (id, org_id, method, paypal_email, is_primary, details_changed_at)
select ('c3990000-0000-0000-0000-00000000000' || n)::uuid, ('c39b0000-0000-0000-0000-0000000000f' || n)::uuid,
       'paypal', 'pgtap-r39-h' || n || '@example.com', true, '2026-11-01'
  from generate_series(1, 6) n;
insert into public.factory_withdrawals
  (id, org_id, account_id, provider, status, amount_cents, currency, paid_to, provider_ref, fee_cents, receives_minor, receives_currency,
   created_at, paid_at, decided_at)
values
  ('c3970000-0000-0000-0000-000000000011', 'c39b0000-0000-0000-0000-0000000000f1', 'c3990000-0000-0000-0000-000000000001', 'paypal', 'paid', 100000, 'USD', 'pgtap-r39-h1@example.com', 'B-R39-1', 3000, 97000, 'USD', now() - interval '10 days', now() - interval '9 days', now() - interval '9 days'),
  ('c3970000-0000-0000-0000-000000000021', 'c39b0000-0000-0000-0000-0000000000f2', 'c3990000-0000-0000-0000-000000000002', 'paypal', 'paying', 100000, 'USD', 'pgtap-r39-h2@example.com', 'B-R39-2', 3000, 97000, 'USD', now() - interval '40 days', null, now() - interval '40 days'),
  ('c3970000-0000-0000-0000-000000000031', 'c39b0000-0000-0000-0000-0000000000f3', 'c3990000-0000-0000-0000-000000000003', 'wise', 'paying', 100000, 'USD', 'pgtap-r39-h3@example.com', '5039', 3000, 680000, 'CNY', now() - interval '2 days', null, now() - interval '2 days'),
  ('c3970000-0000-0000-0000-000000000041', 'c39b0000-0000-0000-0000-0000000000f4', 'c3990000-0000-0000-0000-000000000004', 'wise', 'paid', 100000, 'USD', 'pgtap-r39-h4@example.com', '5049', 1500, 690000, 'CNY', now() - interval '10 days', now() - interval '9 days', now() - interval '9 days'),
  ('c3970000-0000-0000-0000-000000000061', 'c39b0000-0000-0000-0000-0000000000f6', 'c3990000-0000-0000-0000-000000000006', 'paypal', 'paid', 100000, 'USD', 'pgtap-r39-h6@example.com', 'B-R39-6', 3000, 97000, 'USD', now() - interval '10 days', now() - interval '9 days', now() - interval '9 days');
update public.factory_withdrawals w set paid_to_changed_at = a.payee_changed_at
  from public.factory_payout_accounts a where a.id = w.account_id and w.org_id::text like 'c39b%';
insert into public.payment_takes (payment_id, org_id, road, factory_withdrawal_id, amount_cents, status, created_at) values
  ('c39f0011-0000-0000-0000-000000000000', 'c39b0000-0000-0000-0000-0000000000f1', 'pool', 'c3970000-0000-0000-0000-000000000011', 100000, 'sent', now() - interval '10 days'),
  ('c39f0021-0000-0000-0000-000000000000', 'c39b0000-0000-0000-0000-0000000000f2', 'pool', 'c3970000-0000-0000-0000-000000000021', 100000, 'held', now() - interval '40 days'),
  ('c39f0031-0000-0000-0000-000000000000', 'c39b0000-0000-0000-0000-0000000000f3', 'pool', 'c3970000-0000-0000-0000-000000000031', 100000, 'held', now() - interval '2 days'),
  ('c39f0041-0000-0000-0000-000000000000', 'c39b0000-0000-0000-0000-0000000000f4', 'pool', 'c3970000-0000-0000-0000-000000000041', 100000, 'sent', now() - interval '10 days'),
  ('c39f0061-0000-0000-0000-000000000000', 'c39b0000-0000-0000-0000-0000000000f6', 'pool', 'c3970000-0000-0000-0000-000000000061', 100000, 'sent', now() - interval '10 days');
-- What left TSC's Wise balance (the quote's total; Wise's fee inside the
-- amount): $990 for h3, $999.99 for h4 (the step-down stopped a cent short).
-- Guarded, so this file runs (and fails) on a schema without the column.
do $$ begin
  execute $q$update public.factory_withdrawals set leaves_cents = 99000 where id = 'c3970000-0000-0000-0000-000000000031'$q$;
  execute $q$update public.factory_withdrawals set leaves_cents = 99999 where id = 'c3970000-0000-0000-0000-000000000041'$q$;
exception when undefined_column then null;
end $$;
set local session_replication_role = origin;

create function pg_temp.as_staff() returns void language sql as $f$
  select set_config('request.jwt.claims', json_build_object('sub', 'c39a0000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
$f$;
create function pg_temp.org(n int) returns uuid language sql immutable as $f$
  select ('c39b0000-0000-0000-0000-0000000000f' || n)::uuid;
$f$;
create function pg_temp.pay(nk int) returns uuid language sql immutable as $f$
  select ('c39f00' || nk || '-0000-0000-0000-000000000000')::uuid;
$f$;
create function pg_temp.wd(nk int) returns uuid language sql immutable as $f$
  select ('c3970000-0000-0000-0000-0000000000' || nk)::uuid;
$f$;
create function pg_temp.balance(n int) returns jsonb language plpgsql as $f$
declare j jsonb;
begin
  perform pg_temp.as_staff();
  j := public.factory_balance(pg_temp.org(n));
  perform set_config('request.jwt.claims', '', true);
  return j;
end;
$f$;
create function pg_temp.figures(n int) returns jsonb language sql as $f$
  select jsonb_build_object('available', j -> 'available_cents', 'processing', j -> 'processing_cents', 'paid_out', j -> 'paid_out_cents',
    'total', j -> 'total_cents') from (select pg_temp.balance(n) j) s;
$f$;
-- Total = the five figures added up = what the factory earned less
-- withdrawal fees (a provider's kept part is one).
create function pg_temp.total_holds(n int) returns boolean language plpgsql as $f$
declare j jsonb; earned bigint; fees bigint;
begin
  j := pg_temp.balance(n);
  select coalesce(sum(public.payment_factory_cents(p)), 0) into earned
    from public.order_payments p join public.production_orders o on o.id = p.order_id
   where o.factory_org_id = pg_temp.org(n) and p.state in ('confirmed', 'released');
  select coalesce(sum(w.fee_cents) filter (where w.status = 'paid'), 0) + coalesce(sum(w.kept_cents) filter (where w.status = 'failed'), 0)
    into fees from public.factory_withdrawals w where w.org_id = pg_temp.org(n);
  return (j ->> 'total_cents')::bigint = (j ->> 'awaiting_cents')::bigint + (j ->> 'available_cents')::bigint + (j ->> 'pending_cents')::bigint
                                        + (j ->> 'processing_cents')::bigint + (j ->> 'paid_out_cents')::bigint
     and (j ->> 'total_cents')::bigint = earned - fees;
end;
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
create function pg_temp.row(nk int) returns jsonb language sql as $f$
  select jsonb_build_object('status', status, 'back', back_cents, 'kept', kept_cents) from public.factory_withdrawals where id = pg_temp.wd(nk);
$f$;
create function pg_temp.notices(n int) returns text[] language sql as $f$
  select coalesce(array_agg(body order by created_at, body), '{}') from public.notifications where org_id = pg_temp.org(n) and kind = 'withdrawal';
$f$;
create function pg_temp.returned_rows() returns jsonb language plpgsql as $f$
declare j jsonb;
begin
  perform pg_temp.as_staff();
  j := public.admin_balance_attention() -> 'returned';
  perform set_config('request.jwt.claims', '', true);
  return j;
end;
$f$;

-- ===========================================================================
-- L1. h1: PayPal returns a paid $1,000 withdrawal and gives back $970; later
-- it says $900 came back.
-- ===========================================================================
select pg_temp.server(format('select public.record_withdrawal_returned(%L, 97000, %L)', pg_temp.wd(11), 'PayPal returned this to TSC.'));
select is(pg_temp.row(11), '{"status":"failed","back":97000,"kept":3000}'::jsonb, 'h1: $970 back, $30 kept');
select pg_temp.server(format('select public.record_withdrawal_returned(%L, 90000, null)', pg_temp.wd(11)));
select is(pg_temp.row(11), '{"status":"failed","back":90000,"kept":10000}'::jsonb,
          'the later figure applies in full: $100 kept, $900 back (the part handed back of the kept take is taken again)');
select is(pg_temp.figures(1), '{"available":90000,"processing":0,"paid_out":0,"total":90000}'::jsonb,
          'the factory bears what PayPal kept; Paid out stays 0');
select ok(pg_temp.total_holds(1), 'h1: Total adds up');
select is((select jsonb_build_object('amount', amount_cents, 'status', status) from public.payment_takes where factory_withdrawal_id = pg_temp.wd(11)),
          '{"amount":10000,"status":"sent"}'::jsonb, 'one take, sent at what was kept');
select is(pg_temp.notices(1),
          array['$970.00 is back in your balance. PayPal kept $30.00 of it. Check your withdrawal method, then withdraw again.',
                'PayPal kept $100.00 of it.'],
          'the factory is told all PayPal kept, never "$0.00"');
-- The same figure again, or a smaller kept one: nothing changes, nobody is told.
select pg_temp.server(format('select public.record_withdrawal_returned(%L, 90000, null)', pg_temp.wd(11)));
select pg_temp.server(format('select public.record_withdrawal_returned(%L, 95000, null)', pg_temp.wd(11)));
select is(pg_temp.row(11), '{"status":"failed","back":90000,"kept":10000}'::jsonb, 'a repeat or a smaller kept figure changes nothing');
select is(cardinality(pg_temp.notices(1)), 2, 'and tells nobody');

-- I2. The returned row waits on the board until the factory asks again, by a
-- Stripe withdrawal too.
select ok(exists (select 1 from jsonb_array_elements(pg_temp.returned_rows()) x where x ->> 'withdrawal_id' = pg_temp.wd(11)::text),
          'h1: on the board as returned');
set local session_replication_role = replica;
-- (A minute on: now() is the return's time within this transaction.)
insert into public.stripe_withdrawals (org_id, stripe_account_id, request_key, request_id, amount_minor, currency, usd_cents, state, created_at)
values (pg_temp.org(1), 'acct_pgtap_r39_1', 'pgtap-r39-k1', gen_random_uuid(), 5000, 'USD', 5000, 'refused', now() + interval '1 minute');
set local session_replication_role = origin;
select ok(not exists (select 1 from jsonb_array_elements(pg_temp.returned_rows()) x where x ->> 'withdrawal_id' = pg_temp.wd(11)::text),
          'a later Stripe withdrawal lifts it, as a PayPal or Wise one does');

-- ===========================================================================
-- L1. h6: a later figure with nothing handed back to take it from (a part
-- handed back before handed_back_cents was kept): no change, no notice.
-- ===========================================================================
select pg_temp.server(format('select public.record_withdrawal_returned(%L, 97000, %L)', pg_temp.wd(61), 'PayPal returned this to TSC.'));
do $$ begin
  execute $q$update public.payment_takes set handed_back_cents = 0 where factory_withdrawal_id = 'c3970000-0000-0000-0000-000000000061'$q$;
exception when undefined_column then null;
end $$;
select pg_temp.server(format('select public.record_withdrawal_returned(%L, 90000, null)', pg_temp.wd(61)));
select is(pg_temp.row(61), '{"status":"failed","back":97000,"kept":3000}'::jsonb, 'h6: nothing to take it from: nothing changes');
select is(cardinality(pg_temp.notices(6)), 1, 'and no "PayPal kept $0.00 of it."');

-- ===========================================================================
-- L2. h2: a PayPal withdrawal never claimed (still being sent) is returned
-- after 30 days; PayPal gives back what it sent ($970) and keeps its fee.
-- ===========================================================================
select is(pg_temp.figures(2), '{"available":0,"processing":100000,"paid_out":0,"total":100000}'::jsonb, 'h2: $1,000 being sent');
select pg_temp.server(format('select public.record_withdrawal_returned(%L, 97000, %L)', pg_temp.wd(21), 'PayPal returned this to TSC, so nothing arrived.'));
select is(pg_temp.row(21), '{"status":"failed","back":97000,"kept":3000}'::jsonb, 'failed: $970 back, $30 kept');
select is(pg_temp.figures(2), '{"available":97000,"processing":0,"paid_out":0,"total":97000}'::jsonb,
          'the factory bears PayPal''s fee, as after Paid');
select ok(pg_temp.total_holds(2), 'h2: Total adds up');
select is(pg_temp.notices(2),
          array['$970.00 is back in your balance. PayPal kept $30.00 of it. Check your withdrawal method, then withdraw again.'],
          'told what came back and what PayPal kept');
select is((select jsonb_build_object('returned_at', w.returned_at is not null, 'failed_at', (to_jsonb(w) ->> 'failed_at') is not null)
             from public.factory_withdrawals w where w.id = pg_temp.wd(21)),
          '{"returned_at":false,"failed_at":true}'::jsonb, 'not "returned after it was paid": not on the board''s Returned list');
select is((select state::text from public.order_payments where id = pg_temp.pay(21)), 'confirmed', 'the step stays owed, less the fee');

-- h3: a Wise withdrawal being sent fails; the state change comes first (all
-- of it taken as back), then the refund says $960 of the $990 that left.
select pg_temp.server(format('select public.record_withdrawal(%L, %L, sentence => %L)', pg_temp.wd(31), 'failed', 'Wise refunded this transfer to TSC''s balance.'));
select is(pg_temp.row(31), '{"status":"failed","back":100000,"kept":null}'::jsonb, 'h3: failed, all of it back');
select pg_temp.server(format('select public.record_withdrawal_returned(%L, 96000, null)', pg_temp.wd(31)));
select is(pg_temp.row(31), '{"status":"failed","back":97000,"kept":3000}'::jsonb, 'the later figure: Wise kept $30 of the $990 that left');
select is(pg_temp.figures(3), '{"available":97000,"processing":0,"paid_out":0,"total":97000}'::jsonb, 'the factory bears it');
select ok(pg_temp.total_holds(3), 'h3: Total adds up');
select is((pg_temp.notices(3))[2], 'Wise kept $30.00 of it.', 'and is told');

-- ===========================================================================
-- L3. h4: a paid Wise withdrawal of which $999.99 left TSC comes back in
-- full: Wise kept nothing.
-- ===========================================================================
select pg_temp.server(format('select public.record_withdrawal_returned(%L, 99999, %L)', pg_temp.wd(41), 'The factory''s bank returned this transfer.'));
select is(pg_temp.row(41), '{"status":"failed","back":100000,"kept":0}'::jsonb, 'h4: all of it back, nothing kept');
select is(pg_temp.notices(4), array['The amount is back in your balance. Check your withdrawal method, then withdraw again.'],
          'never "Wise kept $0.01 of it."');
select is(pg_temp.figures(4), '{"available":100000,"processing":0,"paid_out":0,"total":100000}'::jsonb, 'the whole amount is back');
select ok(pg_temp.total_holds(4), 'h4: Total adds up');

-- ===========================================================================
-- L5. h5 owes $500; its other earnings are $300: paying p52 by step is
-- refused, saying the $200 they do not cover.
-- ===========================================================================
create function pg_temp.refusal(nk int) returns jsonb language plpgsql as $f$
declare h text; d text;
begin
  perform public.per_step_payout_check((select p from public.order_payments p where p.id = pg_temp.pay(nk)), pg_temp.org(nk / 10));
  return null;
exception when others then
  get stacked diagnostics h = pg_exception_hint, d = pg_exception_detail;
  return jsonb_build_object('hint', h, 'detail', d);
end;
$f$;
select is(public.factory_debt_cents(pg_temp.org(5)), 50000::bigint, 'h5 owes TSC $500');
select is(pg_temp.refusal(52), '{"hint":"payout_owes_tsc","detail":"$200.00"}'::jsonb,
          'refused with the $200 its other earnings do not cover, not the whole $500');

-- Grants and shape.
select ok(not has_function_privilege('authenticated', 'public.record_withdrawal_returned(uuid, bigint, text)', 'execute'),
          'record_withdrawal_returned: not for clients');
select ok(not has_function_privilege('authenticated', 'public.per_step_payout_check(public.order_payments, uuid)', 'execute'),
          'per_step_payout_check: not for clients');
select is((select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and proname = f), 1, f || ': one function, no overloads')
  from unnest(array['record_withdrawal', 'record_withdrawal_returned', 'factory_balance', 'admin_balance_attention', 'per_step_payout_check']) f;

select * from finish();
rollback;
