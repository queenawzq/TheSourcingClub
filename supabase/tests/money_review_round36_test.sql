-- One balance, fix round 36 (20261121380000).
--
-- M2 (f1, f4): a PayPal / Wise withdrawal returned after it was recorded paid
--   is recorded: its parts go back to the balance, the step it released is
--   owed again, Paid out drops, the factory is told in the failure's words,
--   and staff see it under Needs checking ("returned").
-- C1 (f2, f3, f4): a debt to TSC is netted against earnings (Available is
--   cleared earnings less the debt); the card's line, To recover and the board
--   say only what earnings do not cover. Total is always the five figures
--   added up, and equals what the factory earned less withdrawal fees.
-- C2 (f3): claim_withdrawal's "owes TSC" detail is the uncovered amount.
-- Edited default bank (f5): "Your saved bank account changed: …" on every route.
-- No method (f1, f5): factory_balance().no_saved_method is the notices' rule.

begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

update public.payout_provider_settings set enabled = case
    when provider = 'paypal' and region in ('china', 'elsewhere') then true else false end;

set local session_replication_role = replica;

insert into auth.users (id, email)
select ('c36a0000-0000-0000-0000-0000000000' || k)::uuid, 'pgtap-r36-' || k || '@example.com'
  from unnest(array['02','03','11','12','13','14','15']) k;
-- 02 is staff; 03 owns the brand; 1N owns factory fN.
insert into public.platform_admins (user_id, note) values ('c36a0000-0000-0000-0000-000000000002', 'pgtap-r36');
insert into public.orgs (id, type, name, slug) values
  ('c36b0000-0000-0000-0000-0000000000b1', 'brand', 'R36 Brand', 'pgtap-r36-brand');
insert into public.orgs (id, type, name, slug)
select ('c36b0000-0000-0000-0000-0000000000f' || n)::uuid, 'factory', 'R36 Factory ' || n, 'pgtap-r36-f' || n from generate_series(1, 5) n;
insert into public.org_members (org_id, user_id, role, permissions) values
  ('c36b0000-0000-0000-0000-0000000000b1', 'c36a0000-0000-0000-0000-000000000003', 'owner', '{}');
insert into public.org_members (org_id, user_id, role, permissions)
select ('c36b0000-0000-0000-0000-0000000000f' || n)::uuid, ('c36a0000-0000-0000-0000-0000000000' || (10 + n))::uuid, 'owner', '{}'
  from generate_series(1, 5) n;

-- Steps pNK: factory N, step K, one order each, cleared and approved.
--   f1: p11 $500 (a $500 PayPal withdrawal is being sent from it); p12 $300.
--   f2: p21 $1,000 paid out the old way, half refunded since (owes $500);
--       p22 $800 (covers it).
--   f3: p31 $1,000 paid out the old way, half refunded (owes $500); p32 $200,
--       $100 of it held by a waiting withdrawal ($400 not covered).
--   f4: p41 $500 withdrawn by PayPal, then refunded in full (owes $500);
--       p42 $800.
--   f5: p51 $100; a default bank account staff pay by hand (no Wise).
create temporary table r36_steps (n int, k int, amount bigint, refunded bigint, state text, note text) on commit drop;
insert into r36_steps values
  (1, 1, 50000, 0, 'confirmed', null), (1, 2, 30000, 0, 'confirmed', null),
  (2, 1, 100000, 53500, 'released', 'BANKREF'), (2, 2, 80000, 0, 'confirmed', null),
  (3, 1, 100000, 53500, 'released', 'BANKREF'), (3, 2, 20000, 0, 'confirmed', null),
  (4, 1, 50000, 53500, 'released', 'Withdrawn'), (4, 2, 80000, 0, 'confirmed', null),
  (5, 1, 10000, 0, 'confirmed', null);
insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total)
select ('c36c0000-0000-0000-0000-0000000000' || n || k)::uuid, 'c36b0000-0000-0000-0000-0000000000b1',
       'R36 request ' || n || k, 'awarded', 'invited_only', 100 from r36_steps;
insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity, submitted_at)
select ('c36c1000-0000-0000-0000-0000000000' || n || k)::uuid, ('c36c0000-0000-0000-0000-0000000000' || n || k)::uuid,
       ('c36b0000-0000-0000-0000-0000000000f' || n)::uuid, 'accepted', 100, 1, now() from r36_steps;
insert into public.production_orders
  (id, rfq_id, quote_id, brand_org_id, factory_org_id, unit_price_cents, status, schedule_brand_agreed_at, schedule_brand_agreed_by,
   production_quantity, bulk_subtotal_cents, sample_subtotal_cents, order_total_cents, deposit_pct, balance_pct, order_number)
select ('c36d0000-0000-0000-0000-0000000000' || n || k)::uuid, ('c36c0000-0000-0000-0000-0000000000' || n || k)::uuid,
       ('c36c1000-0000-0000-0000-0000000000' || n || k)::uuid, 'c36b0000-0000-0000-0000-0000000000b1',
       ('c36b0000-0000-0000-0000-0000000000f' || n)::uuid, amount, 'active', now() - interval '60 days',
       'c36a0000-0000-0000-0000-000000000003', 1, amount, 0, amount, 50, 50, 'R36-' || n || k
  from r36_steps;
insert into public.order_milestones (id, order_id, kind, title, amount_cents, state, sort, completed_at)
select ('c36e00' || n || k || '-0000-0000-0000-000000000000')::uuid, ('c36d0000-0000-0000-0000-0000000000' || n || k)::uuid,
       'approval_and_payment'::public.milestone_type, 'R36 step ' || n || k, amount, 'complete'::public.milestone_state, 10,
       now() - interval '30 days'
  from r36_steps;
insert into public.order_payments
  (id, order_id, milestone_id, amount_cents, charged_cents, amount_received_cents, currency, state, confirmed_at, release_requested_at,
   stripe_payment_intent_id, stripe_charge_id, funds_available_at, released_at, released_note,
   refunded_cents, refund_amount_at, refunded_at)
select ('c36f00' || n || k || '-0000-0000-0000-000000000000')::uuid, ('c36d0000-0000-0000-0000-0000000000' || n || k)::uuid,
       ('c36e00' || n || k || '-0000-0000-0000-000000000000')::uuid, amount, amount * 107 / 100, amount * 107 / 100, 'USD',
       state::public.payment_state, now() - interval '40 days', now() - interval '30 days' + (n * 10 + k) * interval '1 minute',
       'pi_pgtap_r36_' || n || k, 'ch_pgtap_r36_' || n || k, now() - interval '35 days',
       case when state = 'released' then now() - interval '20 days' end, note,
       refunded, case when refunded > 0 then now() - interval '5 days' end, null
  from r36_steps;
insert into public.factory_payout_accounts (id, org_id, method, paypal_email, is_primary, details_changed_at)
select ('c3690000-0000-0000-0000-00000000000' || n)::uuid, ('c36b0000-0000-0000-0000-0000000000f' || n)::uuid,
       'paypal', 'pgtap-r36-f' || n || '@example.com', true, '2026-11-01'
  from generate_series(1, 4) n;
insert into public.factory_payout_accounts (id, org_id, method, bank_name, account_name, account_number_last4, is_primary, details_changed_at)
values ('c3690000-0000-0000-0000-000000000005', 'c36b0000-0000-0000-0000-0000000000f5', 'bank', 'R36 Bank', 'R36 Holder', '1234', true, '2026-11-01');
insert into public.factory_withdrawals
  (id, org_id, account_id, provider, status, amount_cents, currency, paid_to, provider_ref, created_at, paid_at, decided_at)
values
  ('c3670000-0000-0000-0000-000000000011', 'c36b0000-0000-0000-0000-0000000000f1', 'c3690000-0000-0000-0000-000000000001', 'paypal', 'paying', 50000, 'USD', 'pgtap-r36-f1@example.com', 'B-R36-1', now() - interval '2 days', null, now() - interval '2 days'),
  ('c3670000-0000-0000-0000-000000000021', 'c36b0000-0000-0000-0000-0000000000f2', 'c3690000-0000-0000-0000-000000000002', 'paypal', 'requested', 30000, 'USD', 'pgtap-r36-f2@example.com', null, now() - interval '1 day', null, null),
  ('c3670000-0000-0000-0000-000000000031', 'c36b0000-0000-0000-0000-0000000000f3', 'c3690000-0000-0000-0000-000000000003', 'paypal', 'requested', 10000, 'USD', 'pgtap-r36-f3@example.com', null, now() - interval '1 day', null, null),
  ('c3670000-0000-0000-0000-000000000041', 'c36b0000-0000-0000-0000-0000000000f4', 'c3690000-0000-0000-0000-000000000004', 'paypal', 'paid', 50000, 'USD', 'pgtap-r36-f4@example.com', 'B-R36-4', now() - interval '10 days', now() - interval '9 days', now() - interval '9 days');
update public.factory_withdrawals w set paid_to_changed_at = a.payee_changed_at
  from public.factory_payout_accounts a where a.id = w.account_id and w.org_id::text like 'c36b%';
insert into public.payment_takes (payment_id, org_id, road, factory_withdrawal_id, amount_cents, status, created_at) values
  ('c36f0011-0000-0000-0000-000000000000', 'c36b0000-0000-0000-0000-0000000000f1', 'pool', 'c3670000-0000-0000-0000-000000000011', 50000, 'held', now() - interval '2 days'),
  ('c36f0032-0000-0000-0000-000000000000', 'c36b0000-0000-0000-0000-0000000000f3', 'pool', 'c3670000-0000-0000-0000-000000000031', 10000, 'held', now() - interval '1 day'),
  ('c36f0041-0000-0000-0000-000000000000', 'c36b0000-0000-0000-0000-0000000000f4', 'pool', 'c3670000-0000-0000-0000-000000000041', 50000, 'sent', now() - interval '10 days');
set local session_replication_role = origin;

create function pg_temp.as_staff() returns void language sql as $f$
  select set_config('request.jwt.claims', json_build_object('sub', 'c36a0000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
$f$;
create function pg_temp.figures(n int) returns jsonb language plpgsql as $f$
declare j jsonb;
begin
  perform pg_temp.as_staff();
  j := public.factory_balance(('c36b0000-0000-0000-0000-0000000000f' || n)::uuid);
  perform set_config('request.jwt.claims', '', true);
  return jsonb_build_object('available', j -> 'available_cents', 'processing', j -> 'processing_cents', 'paid_out', j -> 'paid_out_cents',
    'owed_to_tsc', j -> 'owed_to_tsc_cents', 'uncovered', j -> 'uncovered_debt_cents');
end;
$f$;
-- Total = Awaiting + Available + Pending + Processing + Paid out, and it is
-- what the factory earned (its steps, net of refunds) less withdrawal fees.
create function pg_temp.total_holds(n int) returns boolean language plpgsql as $f$
declare j jsonb; earned bigint; fees bigint;
begin
  perform pg_temp.as_staff();
  j := public.factory_balance(('c36b0000-0000-0000-0000-0000000000f' || n)::uuid);
  perform set_config('request.jwt.claims', '', true);
  select coalesce(sum(public.payment_factory_cents(p)), 0) into earned
    from public.order_payments p join public.production_orders o on o.id = p.order_id
   where o.factory_org_id = ('c36b0000-0000-0000-0000-0000000000f' || n)::uuid and p.state in ('confirmed', 'released');
  select coalesce(sum(w.fee_cents) filter (where w.status = 'paid'), 0) + coalesce(sum(w.kept_cents) filter (where w.returned_at is not null), 0)
    into fees from public.factory_withdrawals w where w.org_id = ('c36b0000-0000-0000-0000-0000000000f' || n)::uuid;
  return (j ->> 'total_cents')::bigint = (j ->> 'awaiting_cents')::bigint + (j ->> 'available_cents')::bigint + (j ->> 'pending_cents')::bigint
                                        + (j ->> 'processing_cents')::bigint + (j ->> 'paid_out_cents')::bigint
     and (j ->> 'total_cents')::bigint = earned - fees;
end;
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
  select ('c36f00' || nk || '-0000-0000-0000-000000000000')::uuid;
$f$;
create function pg_temp.wd(nk int) returns uuid language sql immutable as $f$
  select ('c3670000-0000-0000-0000-0000000000' || nk)::uuid;
$f$;
create function pg_temp.org(n int) returns uuid language sql immutable as $f$
  select ('c36b0000-0000-0000-0000-0000000000f' || n)::uuid;
$f$;
-- The server's answers (service role only).
create function pg_temp.server(sql text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  set local role service_role;
  execute sql;
  reset role;
  perform set_config('request.jwt.claims', '', true);
end;
$f$;
-- A staff call's refusal: hint and detail (null when it went through).
create function pg_temp.staff_refusal(sql text) returns text language plpgsql as $f$
declare h text; d text;
begin
  perform pg_temp.as_staff();
  set local role authenticated;
  begin
    execute sql;
    reset role;
    return null;
  exception when others then
    get stacked diagnostics h = pg_exception_hint, d = pg_exception_detail;
    reset role;
    return coalesce(nullif(h, ''), sqlstate) || coalesce(' ' || nullif(d, ''), '');
  end;
end;
$f$;

-- ===========================================================================
-- M2. PayPal pays f1's $500 withdrawal, then returns it.
-- ===========================================================================
select pg_temp.server(format('select public.record_withdrawal(%L, %L)', pg_temp.wd(11), 'paid'));
select is((select state::text from public.order_payments where id = pg_temp.pay(11)), 'released', 'f1: paid: the step it took in full is released');
select is((pg_temp.figures(1) ->> 'paid_out')::bigint, 50000::bigint, 'and is Paid out');
select pg_temp.server(format('select public.record_withdrawal(%L, %L, sentence => %L)', pg_temp.wd(11), 'failed',
  'PayPal returned this to TSC, so nothing arrived: check the factory''s PayPal address. The amount is back in the factory''s balance, so it can withdraw again.'));
select is((select status from public.factory_withdrawals where id = pg_temp.wd(11)), 'failed', 'returned after Paid: recorded as failed');
select ok((select returned_at is not null and back_cents = 50000 from public.factory_withdrawals where id = pg_temp.wd(11)),
          'with when it came back, and all of it back in the balance');
select is((select status from public.payment_takes where factory_withdrawal_id = pg_temp.wd(11)), 'returned', 'its part is handed back');
select is((select state::text from public.order_payments where id = pg_temp.pay(11)), 'confirmed', 'the step is owed again');
select ok(exists (select 1 from public.payment_events where payment_id = pg_temp.pay(11) and from_state = 'released' and to_state = 'confirmed'),
          'and its history says so');
select is(pg_temp.figures(1), '{"available":80000,"processing":0,"paid_out":0,"owed_to_tsc":0,"uncovered":0}'::jsonb,
          'Paid out drops by it (it never arrived); the $500 is available again');
select ok(pg_temp.total_holds(1), 'f1: Total adds up');
select is((select body from public.notifications where org_id = pg_temp.org(1) and kind = 'withdrawal' and title = 'Withdrawal of $500.00 did not go through'),
          'The amount is back in your balance. Check your withdrawal method, then withdraw again.', 'the factory is told, in the failure''s words');
select is((select count(*)::int from jsonb_array_elements(pg_temp.attention('returned')) x where x ->> 'withdrawal_id' = pg_temp.wd(11)::text), 1,
          'staff see it under Needs checking');
select is((select x ->> 'reason' from jsonb_array_elements(pg_temp.attention('returned')) x where x ->> 'withdrawal_id' = pg_temp.wd(11)::text),
          'PayPal returned this to TSC, so nothing arrived: check the factory''s PayPal address. The amount is back in the factory''s balance, so it can withdraw again.',
          'with the reason');
select pg_temp.server(format('select public.record_withdrawal(%L, %L)', pg_temp.wd(11), 'failed'));
select is((select count(*)::int from public.notifications where org_id = pg_temp.org(1) and kind = 'withdrawal' and title like '% did not go through'), 1,
          'told once');
select ok(pg_get_functiondef('public.admin_overview_metrics()'::regprocedure) like '%attention -> ''returned''%', 'the overview counts it');

-- ===========================================================================
-- C1. f2 owes $500 and earns $800: netted, nothing uncovered.
-- ===========================================================================
select is(pg_temp.figures(2), '{"available":30000,"processing":0,"paid_out":100000,"owed_to_tsc":50000,"uncovered":0}'::jsonb,
          'f2: Available is net of the debt; its earnings cover it, so nothing is uncovered (no line on the card)');
select ok(pg_temp.total_holds(2), 'f2: Total adds up');
select is((select count(*)::int from jsonb_array_elements(pg_temp.attention('recover')) x where x ->> 'org_id' = pg_temp.org(2)::text), 0,
          'and nothing To recover');
select pg_temp.server(format('select public.claim_owed_steps(%L, 30000, %L, %L)', pg_temp.org(2), 'pool', pg_temp.wd(21)));
select is((select count(*)::int from public.payment_takes where org_id = pg_temp.org(2)), 1, 'withdrawing $300 takes $300 of the $800 step, nothing else');
select is(pg_temp.figures(2), '{"available":0,"processing":30000,"paid_out":100000,"owed_to_tsc":50000,"uncovered":0}'::jsonb,
          'the debt is still netted from Available');
select pg_temp.server(format('select public.record_withdrawal(%L, %L)', pg_temp.wd(21), 'paid'));
select is((select state::text from public.order_payments where id = pg_temp.pay(22)), 'confirmed',
          'paid: the $500 TSC holds for the debt stays on the step (approved, in the balance)');
select is(pg_temp.figures(2), '{"available":0,"processing":0,"paid_out":130000,"owed_to_tsc":50000,"uncovered":0}'::jsonb, 'Paid out: what reached the factory');
select ok(pg_temp.total_holds(2), 'f2: Total still adds up');

-- ===========================================================================
-- C1, C2. f3 owes $500; $100 of other earnings, $100 held by a waiting withdrawal.
-- ===========================================================================
select is(pg_temp.figures(3), '{"available":-40000,"processing":10000,"paid_out":100000,"owed_to_tsc":50000,"uncovered":40000}'::jsonb,
          'f3: the card''s line says the $400 its earnings do not cover');
select is((select (x ->> 'amount_cents')::bigint from jsonb_array_elements(pg_temp.attention('recover')) x where x ->> 'payment_id' = pg_temp.pay(31)::text),
          40000::bigint, 'To recover: the uncovered $400');
select is(pg_temp.staff_refusal(format('select public.claim_withdrawal(%L)', pg_temp.wd(31))), 'withdrawal_owes_tsc $400.00',
          'staff cannot pay the waiting withdrawal; the amount is the uncovered one');
select is((select (x ->> 'owes_tsc_cents')::bigint from jsonb_array_elements((select public.admin_withdrawals() from (select pg_temp.as_staff()) s) -> 'withdrawals') x
            where x ->> 'id' = pg_temp.wd(31)::text), 40000::bigint, 'and its board row says the same amount');
select ok(pg_temp.total_holds(3), 'f3: Total adds up, below zero Available included');

-- ===========================================================================
-- C1 + M2. f4 owes $500, then the withdrawal behind it comes back.
-- ===========================================================================
select is(pg_temp.figures(4), '{"available":30000,"processing":0,"paid_out":50000,"owed_to_tsc":50000,"uncovered":0}'::jsonb,
          'f4: $500 owed, netted from the $800 step; nothing uncovered');
select pg_temp.server(format('select public.record_withdrawal(%L, %L, sentence => %L)', pg_temp.wd(41), 'failed', 'PayPal returned this to TSC.'));
select is(pg_temp.figures(4), '{"available":80000,"processing":0,"paid_out":0,"owed_to_tsc":0,"uncovered":0}'::jsonb,
          'the withdrawal came back, so the debt is gone; the $800 step is the factory''s, the refunded step was the brand''s');
select ok(pg_temp.total_holds(4), 'f4: Total adds up');
select is((select body from public.notifications where org_id = pg_temp.org(4) and kind = 'withdrawal' and title like '% did not go through'),
          'This amount was returned to the brand.', 'told truly that none of it came back to the balance (the brand had it back already)');

-- ===========================================================================
-- Edited default bank; no method.
-- ===========================================================================
do $$ begin perform set_config('request.jwt.claims', json_build_object('sub', 'c36a0000-0000-0000-0000-000000000015', 'role', 'authenticated')::text, true); end $$;
update public.factory_payout_accounts set account_name = 'R36 New Holder' where id = 'c3690000-0000-0000-0000-000000000005';
-- The notice is a deferred trigger (read at commit): run it now.
set constraints all immediate;
do $$ begin perform set_config('request.jwt.claims', '', true); end $$;
select is((select body from public.notifications where org_id = pg_temp.org(5) and kind = 'payout_method_changed'),
          'Your saved bank account changed: it is now R36 Bank ending 1234, in the name of R36 New Holder. If nobody at your company made this change, email operations@contact.sourcing-club.com now.',
          'f5: an edit of the default bank says what changed, never that it is now the default');
select ok(public.factory_has_no_saved_method(pg_temp.org(5)), 'f5: a bank TSC pays by hand is no way to withdraw: the notices ask for one');
select ok((select (public.factory_balance(pg_temp.org(5)) ->> 'no_saved_method')::boolean from (select pg_temp.as_staff()) s),
          'and the card and the order page read the same rule');
select ok((select not (public.factory_balance(pg_temp.org(1)) ->> 'no_saved_method')::boolean from (select pg_temp.as_staff()) s),
          'f1 (PayPal): asked by none of them');

-- Grants and shape.
select ok(not has_function_privilege('authenticated', p, 'execute'), p || ': not for clients')
  from unnest(array['public.reopen_untaken_step(uuid)',
                    'public.record_withdrawal(uuid, text, text, bigint, bigint, character, text)', 'public.claim_owed_steps(uuid, bigint, text, uuid)']) p;
select ok(has_function_privilege('authenticated', 'public.admin_balance_attention()', 'execute'), 'admin_balance_attention: staff''s check inside');
select is((select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and proname = f), 1, f || ': one function, no overloads')
  from unnest(array['record_withdrawal', 'claim_owed_steps', 'claim_withdrawal', 'factory_balance', 'admin_balance_attention',
                    'admin_overview_metrics', 'admin_withdrawals', 'payment_debt_cents', 'factory_debt_cents',
                    'notify_default_bank_change', 'claim_payment_release']) f;
select ok(not exists (select 1 from pg_proc where proname in ('cover_factory_debt', 'payment_debt_raw_cents', 'payment_covered_cents')),
          'no debt cover: the debt is netted');
select ok(not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'payment_takes' and column_name = 'covers_payment_id'),
          'and no take is TSC''s');
select ok(not exists (select 1 from pg_proc where proname = 'claim_payment_release' and prosrc like '%withdrawal_claim%'),
          'claim_payment_release no longer reads tsc.withdrawal_claim');

select * from finish();
rollback;
