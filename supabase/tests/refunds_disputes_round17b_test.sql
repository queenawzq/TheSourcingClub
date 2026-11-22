-- One balance, fix round 17b (20261121210000): a debt to TSC and a shrunken
-- old pool reach the withdrawals already waiting.
--
-- F1 (owner 01): $500 withdrawn by PayPal and paid, then refunded in full;
--   a $100 PayPal withdrawal of another step was already waiting. Staff cannot
--   pay it (the factory owes TSC $500 that nothing else covers): the board
--   says so first, the factory's withdrawal reads on hold, told once.
-- F2 (owner 04): the same with a small debt its other earnings cover: paid.
-- F3 (owner 05): old-pool money $300; requests of $100 then $150 wait; $100
--   of the pool payment is refunded. The newest request is $50 short: that
--   part reads Refunded and leaves Processing and Total.
--
-- Fixtures: slugs pgtap-r17b-*, ids b17?xxxx-...; every count is scoped to them.
begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

update public.payout_provider_settings set enabled = case
    when provider = 'paypal' and region in ('china', 'elsewhere') then true else false end;

set local session_replication_role = replica;

insert into auth.users (id, email)
select ('b17a0000-0000-0000-0000-0000000000' || k)::uuid, 'pgtap-r17b-' || k || '@example.com' from unnest(array['01','02','03','04','05']) k;
insert into public.platform_admins (user_id, note) values ('b17a0000-0000-0000-0000-000000000002', 'pgtap-r17b');
insert into public.orgs (id, type, name, slug) values
  ('b17b0000-0000-0000-0000-00000000000b', 'brand', 'R17b Brand', 'pgtap-r17b-brand'),
  ('b17b0000-0000-0000-0000-0000000000e1', 'factory', 'R17b Factory One', 'pgtap-r17b-f1'),
  ('b17b0000-0000-0000-0000-0000000000e2', 'factory', 'R17b Factory Two', 'pgtap-r17b-f2'),
  ('b17b0000-0000-0000-0000-0000000000e3', 'factory', 'R17b Factory Three', 'pgtap-r17b-f3');
insert into public.org_members (org_id, user_id, role, permissions) values
  ('b17b0000-0000-0000-0000-0000000000e1', 'b17a0000-0000-0000-0000-000000000001', 'owner', '{}'),
  ('b17b0000-0000-0000-0000-00000000000b', 'b17a0000-0000-0000-0000-000000000003', 'owner', '{}'),
  ('b17b0000-0000-0000-0000-0000000000e2', 'b17a0000-0000-0000-0000-000000000004', 'owner', '{}'),
  ('b17b0000-0000-0000-0000-0000000000e3', 'b17a0000-0000-0000-0000-000000000005', 'owner', '{}');
insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total)
select ('b17c0000-0000-0000-0000-00000000000' || n)::uuid, 'b17b0000-0000-0000-0000-00000000000b', 'R17b request ' || n, 'awarded', 'invited_only', 100
  from generate_series(1, 3) n;
insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity, submitted_at)
select ('b17c1000-0000-0000-0000-00000000000' || n)::uuid, ('b17c0000-0000-0000-0000-00000000000' || n)::uuid,
       ('b17b0000-0000-0000-0000-0000000000e' || n)::uuid, 'accepted', 100, 1, now() from generate_series(1, 3) n;
insert into public.production_orders
  (id, rfq_id, quote_id, brand_org_id, factory_org_id, unit_price_cents, status, schedule_brand_agreed_at, schedule_brand_agreed_by,
   production_quantity, bulk_subtotal_cents, sample_subtotal_cents, order_total_cents, deposit_pct, balance_pct, order_number)
select ('b17d0000-0000-0000-0000-00000000000' || n)::uuid, ('b17c0000-0000-0000-0000-00000000000' || n)::uuid,
       ('b17c1000-0000-0000-0000-00000000000' || n)::uuid, 'b17b0000-0000-0000-0000-00000000000b',
       ('b17b0000-0000-0000-0000-0000000000e' || n)::uuid, 100000, 'active', now() - interval '60 days',
       'b17a0000-0000-0000-0000-000000000003', 1, 100000, 0, 100000, 50, 50, 'R17b-' || n
  from generate_series(1, 3) n;
-- Owed (approved or funded deposits, cleared), oldest first: 1 and 4 are
-- withdrawn first; 2 and 5 are under the waiting withdrawals; 3 is old-pool money.
insert into public.order_milestones (id, order_id, kind, title, amount_cents, state, sort, completed_at) values
  ('b17e0001-0000-0000-0000-000000000001', 'b17d0000-0000-0000-0000-000000000001', 'payment_only', 'R17b bulk deposit', 50000, 'complete', 10, now() - interval '9 days'),
  ('b17e0002-0000-0000-0000-000000000001', 'b17d0000-0000-0000-0000-000000000001', 'approval_and_payment', 'R17b fit sample', 10000, 'complete', 20, now() - interval '8 days'),
  ('b17e0004-0000-0000-0000-000000000002', 'b17d0000-0000-0000-0000-000000000002', 'payment_only', 'R17b bulk deposit', 50000, 'complete', 10, now() - interval '9 days'),
  ('b17e0005-0000-0000-0000-000000000002', 'b17d0000-0000-0000-0000-000000000002', 'approval_and_payment', 'R17b fit sample', 30000, 'complete', 20, now() - interval '8 days'),
  ('b17e0003-0000-0000-0000-000000000003', 'b17d0000-0000-0000-0000-000000000003', 'payment_only', 'R17b pool deposit', 30000, 'complete', 10, now() - interval '9 days');
insert into public.order_payments
  (id, order_id, milestone_id, amount_cents, charged_cents, currency, state, confirmed_at, release_requested_at, withdrawal_pool,
   stripe_payment_intent_id, stripe_charge_id, funds_available_at) values
  ('b17f0001-0000-0000-0000-000000000001', 'b17d0000-0000-0000-0000-000000000001', 'b17e0001-0000-0000-0000-000000000001', 50000, 53500, 'USD', 'confirmed',
   now() - interval '20 days', now() - interval '9 days', false, 'pi_pgtap_r17b_1', 'ch_pgtap_r17b_1', now() - interval '15 days'),
  ('b17f0002-0000-0000-0000-000000000001', 'b17d0000-0000-0000-0000-000000000001', 'b17e0002-0000-0000-0000-000000000001', 10000, 10700, 'USD', 'confirmed',
   now() - interval '20 days', now() - interval '8 days', false, 'pi_pgtap_r17b_2', 'ch_pgtap_r17b_2', now() - interval '15 days'),
  ('b17f0004-0000-0000-0000-000000000002', 'b17d0000-0000-0000-0000-000000000002', 'b17e0004-0000-0000-0000-000000000002', 50000, 53500, 'USD', 'confirmed',
   now() - interval '20 days', now() - interval '9 days', false, 'pi_pgtap_r17b_4', 'ch_pgtap_r17b_4', now() - interval '15 days'),
  ('b17f0005-0000-0000-0000-000000000002', 'b17d0000-0000-0000-0000-000000000002', 'b17e0005-0000-0000-0000-000000000002', 30000, 32100, 'USD', 'confirmed',
   now() - interval '20 days', now() - interval '8 days', false, 'pi_pgtap_r17b_5', 'ch_pgtap_r17b_5', now() - interval '15 days'),
  ('b17f0003-0000-0000-0000-000000000003', 'b17d0000-0000-0000-0000-000000000003', 'b17e0003-0000-0000-0000-000000000003', 30000, 32100, 'USD', 'confirmed',
   now() - interval '20 days', now() - interval '9 days', true, 'pi_pgtap_r17b_3', 'ch_pgtap_r17b_3', now() - interval '15 days');
insert into public.factory_payout_accounts (id, org_id, method, paypal_email, is_primary, details_changed_at)
select ('b1790000-0000-0000-0000-00000000000' || n)::uuid, ('b17b0000-0000-0000-0000-0000000000e' || n)::uuid, 'paypal',
       'pgtap-r17b-f' || n || '@example.com', true, '2026-11-01' from generate_series(1, 3) n;
insert into public.factory_payout_preferences (org_id, route)
select ('b17b0000-0000-0000-0000-0000000000e' || n)::uuid, 'manual' from generate_series(1, 3) n;
set local session_replication_role = origin;

create function pg_temp.act_as(who text) returns void language sql as $f$
  select set_config('request.jwt.claims',
    json_build_object('sub', 'b17a0000-0000-0000-0000-' || lpad(who, 12, '0'), 'role', 'authenticated')::text, true);
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
  select ('b17b0000-0000-0000-0000-0000000000e' || n)::uuid;
$f$;
create function pg_temp.pay(n int) returns uuid language sql immutable as $f$
  select ('b17f000' || n || '-0000-0000-0000-00000000000' || case when n in (1, 2) then 1 when n in (4, 5) then 2 else 3 end)::uuid;
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
  perform pg_temp.as_server(format('select public.record_payment_refund_amount(%L, %L, %s)', pg_temp.pay(n), 'pi_pgtap_r17b_' || n, total));
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
create function pg_temp.recover(n int) returns jsonb language sql as $f$
  select coalesce(jsonb_agg(x order by x ->> 'amount_cents'), '[]'::jsonb) from jsonb_array_elements(pg_temp.attention() -> 'recover') x
   where (x ->> 'org_id')::uuid = pg_temp.org(n);
$f$;

create function pg_temp.req(n int, amount bigint) returns uuid language plpgsql as $f$
declare w uuid;
begin
  perform pg_temp.act_as(case n when 1 then '01' when 2 then '04' else '05' end);
  set local role authenticated;
  w := (public.request_withdrawal(pg_temp.org(n), amount, ('b1790000-0000-0000-0000-00000000000' || n)::uuid)).id;
  reset role;
  return w;
end;
$f$;
create function pg_temp.pay_out(w uuid) returns void language plpgsql as $f$
begin
  perform pg_temp.act_as('02');
  set local role authenticated;
  perform public.claim_withdrawal(w);
  reset role;
  perform pg_temp.as_server(format('select public.record_withdrawal(%L, ''paid'', ''PP-R17B'', 0, %s, ''USD'', null)', w,
    (select amount_cents from public.factory_withdrawals where id = w)));
end;
$f$;
create function pg_temp.staff_row(w uuid) returns jsonb language plpgsql as $f$
declare j jsonb;
begin
  perform pg_temp.act_as('02');
  set local role authenticated;
  select x into j from jsonb_array_elements(public.admin_withdrawals() -> 'withdrawals') x where x ->> 'id' = w::text;
  reset role;
  return j;
end;
$f$;
create function pg_temp.wd(n int, w uuid) returns jsonb language sql as $f$
  select x from jsonb_array_elements(pg_temp.bal(n) -> 'withdrawals') x where x ->> 'id' = w::text;
$f$;

-- ===========================================================================
-- 1. A debt nothing else covers stops a withdrawal already waiting.
-- ===========================================================================
select lives_ok($$select pg_temp.pay_out(pg_temp.req(1, 50000))$$, 'F1 withdrew its $500 deposit by PayPal, paid');
select set_config('tsc.r17b_w1', pg_temp.req(1, 10000)::text, true);
select is((select payment_id from public.payment_takes where factory_withdrawal_id = current_setting('tsc.r17b_w1')::uuid), pg_temp.pay(2),
  'a $100 withdrawal of the fit sample waits');
select is(pg_temp.staff_row(current_setting('tsc.r17b_w1')::uuid) ->> 'covered', 'true', 'staff could pay it');
select lives_ok($$select pg_temp.refund(1, 53500)$$, 'the deposit''s charge is refunded in full after it was withdrawn');
select is((pg_temp.bal(1) ->> 'owed_to_tsc_cents')::bigint, 50000::bigint, 'F1 owes TSC $500');
select ok((pg_temp.staff_row(current_setting('tsc.r17b_w1')::uuid) ->> 'covered')::boolean = false
      and (pg_temp.staff_row(current_setting('tsc.r17b_w1')::uuid) ->> 'owes_tsc_cents')::bigint = 50000,
  'the board says it is not covered, and by how much the factory owes TSC (its To recover row)');
select ok(exists (select 1 from jsonb_array_elements(pg_temp.recover(1)) x where (x ->> 'amount_cents')::bigint = 50000), 'which is on Needs checking');
select pg_temp.act_as('02'); set local role authenticated;
select throws_ok($$select public.claim_withdrawal(current_setting('tsc.r17b_w1')::uuid)$$, '22023', 'the factory owes TSC $500.00',
  'staff Pay is refused, naming the debt');
reset role;
select is((select status from public.factory_withdrawals where id = current_setting('tsc.r17b_w1')::uuid), 'requested', 'nothing was sent');
select is(pg_temp.wd(1, current_setting('tsc.r17b_w1')::uuid) ->> 'word', 'on_hold', 'the factory''s withdrawal reads on hold');
select is((select count(*)::int from public.notifications where org_id = pg_temp.org(1) and kind = 'withdrawal'
            and subject_id = current_setting('tsc.r17b_w1')::uuid and title = 'Withdrawal of $100.00 on hold'
            and body = 'You owe TSC $500.00 for a payment refunded after you withdrew it. This withdrawal is on hold until your earnings cover that amount.'), 1,
  'and the factory is told, once, what it owes (20261121230000: not the refunded step, not to withdraw again)');
select ok(pg_temp.adds_up(pg_temp.bal(1)), 'Total = Awaiting + Available + Pending + Processing + Paid out');

-- A small debt the factory's other earnings cover: paid as before.
select lives_ok($$select pg_temp.pay_out(pg_temp.req(2, 50000))$$, 'F2 withdrew its $500 deposit by PayPal, paid');
select set_config('tsc.r17b_w2', pg_temp.req(2, 10000)::text, true);
select lives_ok($$select pg_temp.refund(4, 10700)$$, '$107 of the deposit''s charge is refunded after it was withdrawn');
select is((pg_temp.bal(2) ->> 'owed_to_tsc_cents')::bigint, 10000::bigint, 'F2 owes TSC $100, and has $200 more earned');
select is(pg_temp.staff_row(current_setting('tsc.r17b_w2')::uuid) ->> 'covered', 'true', 'its waiting withdrawal is still covered');
select pg_temp.act_as('02'); set local role authenticated;
select lives_ok($$select public.claim_withdrawal(current_setting('tsc.r17b_w2')::uuid)$$, 'and staff can pay it');
reset role;

-- ===========================================================================
-- 2. Old-pool money refunded while pool withdrawals wait.
-- ===========================================================================
-- The old pool, turned into an owed step as the migration does (20261121350000).
select is(public.convert_withdrawal_pool(), 1, 'F3''s pool deposit is converted');
select set_config('tsc.r17b_p1', pg_temp.req(3, 10000)::text, true);
-- Asked an hour before the next (one transaction gives both the same now()).
set local session_replication_role = replica;
update public.factory_withdrawals set created_at = now() - interval '1 hour' where id = current_setting('tsc.r17b_p1')::uuid;
update public.payment_takes set created_at = now() - interval '1 hour' where factory_withdrawal_id = current_setting('tsc.r17b_p1')::uuid;
set local session_replication_role = origin;
select set_config('tsc.r17b_p2', pg_temp.req(3, 15000)::text, true);
select is((select array_agg((select sum(t.amount_cents) from public.payment_takes t where t.factory_withdrawal_id = w.id)::bigint order by w.created_at, w.id)
             from public.factory_withdrawals w where w.org_id = pg_temp.org(3)),
  array[10000, 15000]::bigint[], 'F3 asked for $100 then $150 of its $300 old-pool money');
select is(pg_temp.line(pg_temp.bal(3)), 'awaiting 0, available 5000, pending 0, processing 25000, paid out 0, total 30000', 'F3 before');
select lives_ok($$select pg_temp.refund(3, 10700)$$, '$107 of the pool deposit''s charge is refunded');
select is(pg_temp.line(pg_temp.bal(3)), 'awaiting 0, available 0, pending 0, processing 20000, paid out 0, total 20000',
  'the $50 the pool no longer holds leaves Processing and Total');
select ok(pg_temp.adds_up(pg_temp.bal(3)), 'Total = Awaiting + Available + Pending + Processing + Paid out');
select is(pg_temp.wd(3, current_setting('tsc.r17b_p2')::uuid) -> 'parts',
  '[{"word": "waiting", "amount_cents": 10000}, {"word": "refunded", "amount_cents": 5000}]'::jsonb,
  'the newest request: $100 it still holds, $50 refunded');
select is(pg_temp.wd(3, current_setting('tsc.r17b_p1')::uuid) -> 'parts' -> 0 ->> 'amount_cents', '10000', 'the older one keeps its $100');
select is((select count(*)::int from public.notifications where org_id = pg_temp.org(3) and kind = 'withdrawal'
            and subject_id = current_setting('tsc.r17b_p2')::uuid and title = 'Withdrawal of $150.00 on hold'), 1, 'the factory is told, once');
select pg_temp.act_as('05'); set local role authenticated;
select is((public.my_withdrawal_balance(pg_temp.org(3)) -> 'returnable' ->> current_setting('tsc.r17b_p2'))::bigint, 10000::bigint,
  'cancelling it gives back $100');
select lives_ok($$select public.cancel_withdrawal(current_setting('tsc.r17b_p2')::uuid)$$, 'the owner cancels it');
reset role;
select is((select body from public.notifications where org_id = pg_temp.org(3) and kind = 'withdrawal'
            and subject_id = current_setting('tsc.r17b_p2')::uuid and title like '%cancelled'), '$100.00 is back in your balance.', 'told truthfully');
select is(pg_temp.line(pg_temp.bal(3)), 'awaiting 0, available 10000, pending 0, processing 10000, paid out 0, total 20000', 'F3 after');
select is(pg_temp.wd(3, current_setting('tsc.r17b_p1')::uuid) ->> 'word', 'waiting', 'the older request is covered again');

-- ===========================================================================
-- 3. Grants and shape.
-- ===========================================================================
select ok(not has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute'), f || ' is the server''s')
  from unnest(array['public.factory_debt_uncovered_cents(uuid)', 'public.withdrawal_refunded_cents(public.factory_withdrawals)']) f;
select is((select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and proname = f), 1, f || ': one function, no overloads')
  from unnest(array['factory_debt_uncovered_cents', 'withdrawal_refunded_cents', 'claim_withdrawal', 'admin_withdrawals',
                    'withdrawal_covered', 'tell_withdrawal_refunded', 'factory_balance']) f;

select * from finish();
rollback;
