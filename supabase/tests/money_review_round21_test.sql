-- One balance, fix round 21 (20261121250000): a refund recorded as full
-- that fails later always reaches someone, with true amounts.
--
-- F3 (e1, p11): $1,070 charge, $500 lost in a dispute, the other $570
--     refunded (the brand is sent back to pay), then that refund fails: funded
--     again with the $500 loss kept; the notices say $570 and what TSC holds
--     for the factory; the loss is not told twice.
-- F1/F2 (e2, p21): a cancelled order's refund that fails: staff row and the
--     brand told; a second failure after staff resolved it opens it again.
-- F4 (e3, p31): the staff row is the failed refund's own amount, and why.
begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

update public.payout_provider_settings set enabled = case
    when provider = 'paypal' and region in ('china', 'elsewhere') then true else false end;

set local session_replication_role = replica;

insert into auth.users (id, email)
select ('b21a0000-0000-0000-0000-0000000000' || k)::uuid, 'pgtap-r21-' || k || '@example.com'
  from unnest(array['01','02','03','04','05','06','07','08','09']) k;
-- 02 is staff; 03 owns the brand; 0n+? owners: e1 01, e2 04, e3 05, e4 06, e5 07, e6 08, e7 09.
insert into public.platform_admins (user_id, note) values ('b21a0000-0000-0000-0000-000000000002', 'pgtap-r21');
insert into public.orgs (id, type, name, slug) values
  ('b21b0000-0000-0000-0000-00000000000b', 'brand', 'R21 Brand', 'pgtap-r21-brand');
insert into public.orgs (id, type, name, slug)
select ('b21b0000-0000-0000-0000-0000000000e' || n)::uuid, 'factory', 'R21 Factory ' || n, 'pgtap-r21-f' || n from generate_series(1, 7) n;
insert into public.org_members (org_id, user_id, role, permissions) values
  ('b21b0000-0000-0000-0000-00000000000b', 'b21a0000-0000-0000-0000-000000000003', 'owner', '{}'),
  ('b21b0000-0000-0000-0000-0000000000e1', 'b21a0000-0000-0000-0000-000000000001', 'owner', '{}'),
  ('b21b0000-0000-0000-0000-0000000000e2', 'b21a0000-0000-0000-0000-000000000004', 'owner', '{}'),
  ('b21b0000-0000-0000-0000-0000000000e3', 'b21a0000-0000-0000-0000-000000000005', 'owner', '{}'),
  ('b21b0000-0000-0000-0000-0000000000e4', 'b21a0000-0000-0000-0000-000000000006', 'owner', '{}'),
  ('b21b0000-0000-0000-0000-0000000000e5', 'b21a0000-0000-0000-0000-000000000007', 'owner', '{}'),
  ('b21b0000-0000-0000-0000-0000000000e6', 'b21a0000-0000-0000-0000-000000000008', 'owner', '{}'),
  ('b21b0000-0000-0000-0000-0000000000e7', 'b21a0000-0000-0000-0000-000000000009', 'owner', '{}');
insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total)
select ('b21c0000-0000-0000-0000-00000000000' || n)::uuid, 'b21b0000-0000-0000-0000-00000000000b', 'R21 request ' || n, 'awarded', 'invited_only', 100
  from generate_series(1, 7) n;
insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity, submitted_at)
select ('b21c1000-0000-0000-0000-00000000000' || n)::uuid, ('b21c0000-0000-0000-0000-00000000000' || n)::uuid,
       ('b21b0000-0000-0000-0000-0000000000e' || n)::uuid, 'accepted', 100, 1, now() from generate_series(1, 7) n;
insert into public.production_orders
  (id, rfq_id, quote_id, brand_org_id, factory_org_id, unit_price_cents, status, schedule_brand_agreed_at, schedule_brand_agreed_by,
   production_quantity, bulk_subtotal_cents, sample_subtotal_cents, order_total_cents, deposit_pct, balance_pct, order_number)
select ('b21d0000-0000-0000-0000-00000000000' || n)::uuid, ('b21c0000-0000-0000-0000-00000000000' || n)::uuid,
       ('b21c1000-0000-0000-0000-00000000000' || n)::uuid, 'b21b0000-0000-0000-0000-00000000000b',
       ('b21b0000-0000-0000-0000-0000000000e' || n)::uuid, 100000, 'active', now() - interval '60 days',
       'b21a0000-0000-0000-0000-000000000003', 1, 100000, 0, 100000, 50, 50, 'R21-' || n
  from generate_series(1, 7) n;

-- Payments pNK: factory N, step K. Milestones share the id's tail.
create temporary table r21_steps (n int, k int, kind text, title text, amount bigint, charged bigint, state text,
                                  approved boolean, pool boolean) on commit drop;
insert into r21_steps values
  (1, 1, 'approval_and_payment', 'R21 fit sample', 100000, 107000, 'confirmed', false, false),
  (2, 1, 'approval_and_payment', 'R21 trims',       10000,  10700, 'confirmed', false, false),
  (3, 1, 'approval_and_payment', 'R21 labels',      10000,  10700, 'confirmed', false, false);
update public.production_orders set status = 'cancelled' where id = 'b21d0000-0000-0000-0000-000000000002';
insert into public.order_milestones (id, order_id, kind, title, amount_cents, state, sort, completed_at)
select ('b21e00' || n || k || '-0000-0000-0000-000000000000')::uuid, ('b21d0000-0000-0000-0000-00000000000' || n)::uuid,
       kind::public.milestone_type, title, amount, (case when approved then 'complete' else 'active' end)::public.milestone_state, k * 10,
       case when approved then now() - interval '9 days' end
  from r21_steps;
insert into public.order_payments
  (id, order_id, milestone_id, amount_cents, charged_cents, amount_received_cents, currency, state, confirmed_at, release_requested_at,
   withdrawal_pool, stripe_payment_intent_id, stripe_charge_id, funds_available_at, released_at, released_note, processing_at)
select ('b21f00' || n || k || '-0000-0000-0000-000000000000')::uuid, ('b21d0000-0000-0000-0000-00000000000' || n)::uuid,
       ('b21e00' || n || k || '-0000-0000-0000-000000000000')::uuid, amount, charged, charged, 'USD', state::public.payment_state,
       case when state <> 'processing' then now() - interval '20 days' end,
       case when approved then now() - interval '9 days' end,
       pool, 'pi_pgtap_r21_' || n || k, case when charged is not null then 'ch_pgtap_r21_' || n || k end,
       case when charged is not null then now() - interval '15 days' end,
       case when state = 'released' then now() - interval '8 days' end,
       case when state = 'released' then 'Paid by PayPal' end,
       case when state = 'processing' then now() - interval '1 hour' end
  from r21_steps;
insert into public.factory_payout_accounts (id, org_id, method, paypal_email, is_primary, details_changed_at)
select ('b2190000-0000-0000-0000-00000000000' || n)::uuid, ('b21b0000-0000-0000-0000-0000000000e' || n)::uuid, 'paypal',
       'pgtap-r21-f' || n || '@example.com', true, '2026-11-01'
  from generate_series(1, 7) n;
insert into public.factory_payout_preferences (org_id, route)
select ('b21b0000-0000-0000-0000-0000000000e' || n)::uuid, 'manual' from generate_series(1, 7) n;
set local session_replication_role = origin;

create function pg_temp.act_as(who text) returns void language sql as $f$
  select set_config('request.jwt.claims',
    json_build_object('sub', 'b21a0000-0000-0000-0000-' || lpad(who, 12, '0'), 'role', 'authenticated')::text, true);
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
  select ('b21b0000-0000-0000-0000-0000000000e' || n)::uuid;
$f$;
create function pg_temp.owner(n int) returns text language sql immutable as $f$
  select case n when 1 then '01' when 2 then '04' when 3 then '05' when 4 then '06' when 5 then '07' when 6 then '08' else '09' end;
$f$;
create function pg_temp.pay(nk int) returns uuid language sql immutable as $f$
  select ('b21f00' || nk || '-0000-0000-0000-000000000000')::uuid;
$f$;
create function pg_temp.p(nk int) returns public.order_payments language sql as $f$
  select * from public.order_payments where id = pg_temp.pay(nk);
$f$;
create function pg_temp.bal(n int) returns jsonb language plpgsql as $f$
declare j jsonb;
begin
  perform pg_temp.act_as(pg_temp.owner(n));
  set local role authenticated;
  j := public.factory_balance(pg_temp.org(n));
  reset role;
  return j;
end;
$f$;
create function pg_temp.refund(nk int, total bigint) returns void language plpgsql as $f$
begin
  perform pg_temp.as_server(format('select public.record_payment_refund_amount(%L, %L, %s)', pg_temp.pay(nk), 'pi_pgtap_r21_' || nk, total));
end;
$f$;
create function pg_temp.refund_failed(nk int, total bigint) returns void language plpgsql as $f$
begin
  perform pg_temp.as_server(format('select public.record_payment_refund_failed(%L, %L, %s)', pg_temp.pay(nk), 'pi_pgtap_r21_' || nk, total));
end;
$f$;
create function pg_temp.lost(nk int, amount bigint) returns void language plpgsql as $f$
begin
  perform pg_temp.as_server(format('select public.record_payment_dispute_lost(%L, %L, %s, 1500)', pg_temp.pay(nk), 'du_pgtap_r21_' || nk, amount));
end;
$f$;
create function pg_temp.req(n int, amount bigint) returns uuid language plpgsql as $f$
declare w uuid;
begin
  perform pg_temp.act_as(pg_temp.owner(n));
  set local role authenticated;
  w := (public.request_withdrawal(pg_temp.org(n), amount, ('b2190000-0000-0000-0000-00000000000' || n)::uuid)).id;
  reset role;
  return w;
end;
$f$;
create function pg_temp.claim(w uuid) returns void language plpgsql as $f$
begin
  perform pg_temp.act_as('02');
  set local role authenticated;
  perform public.claim_withdrawal(w);
  reset role;
end;
$f$;
create function pg_temp.pay_out(w uuid) returns void language plpgsql as $f$
begin
  perform pg_temp.claim(w);
  perform pg_temp.as_server(format('select public.record_withdrawal(%L, ''paid'', ''PP-R21'', 0, %s, ''USD'', null)', w,
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
create function pg_temp.recover(n int) returns jsonb language plpgsql as $f$
declare j jsonb;
begin
  perform pg_temp.act_as('02');
  set local role authenticated;
  select coalesce(jsonb_agg(x), '[]'::jsonb) into j from jsonb_array_elements(public.admin_balance_attention() -> 'recover') x
   where (x ->> 'org_id')::uuid = pg_temp.org(n);
  reset role;
  return j;
end;
$f$;
create function pg_temp.told(org uuid, subject uuid) returns text language sql as $f$
  select string_agg(title || ' | ' || body, ' || ' order by created_at, title) from public.notifications where org_id = org and subject_id = subject;
$f$;


create function pg_temp.failed(nk int, charged bigint, refunded_now bigint, failed bigint, lost bigint) returns void language plpgsql as $f$
begin
  perform pg_temp.as_server(format('select public.record_full_refund_failed(%L, %L, %L, %s, %s, %s, %s, %s)', pg_temp.pay(nk),
    'pi_pgtap_r21_' || nk, 'ch_pgtap_r21_' || nk, charged, refunded_now, failed, lost, case when lost > 0 then '1500' else 'null' end));
end;
$f$;
create function pg_temp.staff_rows(nk int) returns jsonb language plpgsql as $f$
declare j jsonb;
begin
  perform pg_temp.act_as('02');
  set local role authenticated;
  select coalesce(jsonb_agg(x), '[]'::jsonb) into j from jsonb_array_elements(public.admin_balance_attention() -> 'refund_failed') x
   where x ->> 'payment_id' = pg_temp.pay(nk)::text;
  reset role;
  return j;
end;
$f$;

-- ===========================================================================
-- F3. Funded again: the failed refund's amount, the loss kept.
-- ===========================================================================
select lives_ok($$select pg_temp.lost(11, 50000)$$, '$500 of the $1,070 charge is lost in a dispute before approval');
select lives_ok($$select pg_temp.refund(11, 57000)$$, 'the other $570 is refunded: all of it went back, the brand is sent back to pay');
select is((pg_temp.p(11)).state::text, 'failed', 'sent back to pay');
select lives_ok($$select pg_temp.failed(11, 107000, 0, 57000, 50000)$$, 'then the $570 refund fails, before the brand paid again');
select is(row((pg_temp.p(11)).state::text, (pg_temp.p(11)).charged_cents, (pg_temp.p(11)).dispute_lost_cents, (pg_temp.p(11)).refunded_cents),
  row('confirmed'::text, 107000::bigint, 50000::bigint, 0::bigint), 'funded again with the charge, the $500 loss kept');
select is((select body from public.notifications where org_id = 'b21b0000-0000-0000-0000-00000000000b' and subject_id = pg_temp.pay(11) and title like 'Refund for%'),
  'Your $570.00 refund didn''t go through, so TSC still holds your payment for this step. You don''t need to pay again.', 'the brand reads the failed refund''s own amount');
select is((select body from public.notifications where org_id = pg_temp.org(1) and subject_id = pg_temp.pay(11) and title = 'Payment held for "R21 fit sample"'
            order by created_at desc limit 1),
  'TSC holds $532.71 for this step on R21 request 1 (R21-1). You can start this work; it is added to your balance when the brand approves it.',
  'the factory reads what TSC holds for it, the loss taken off');
select set_config('tsc.r21_told', (select count(*)::text from public.notifications where subject_id = pg_temp.pay(11)), true);
select lives_ok($$select pg_temp.lost(11, 50000)$$, 'the lost dispute is read again later');
select is((select count(*)::text from public.notifications where subject_id = pg_temp.pay(11)), current_setting('tsc.r21_told'), 'nobody is told twice');

-- ===========================================================================
-- F1 / F2. A cancelled order's refund that fails.
-- ===========================================================================
select lives_ok($$select pg_temp.as_server(format('select public.record_payment_refunded(%L, %L, %L)', pg_temp.pay(21), 'pi_pgtap_r21_21', 'The payment was refunded.'))$$,
  'staff refund the cancelled order''s payment in full');
select is(row((pg_temp.p(21)).state::text, (pg_temp.p(21)).stripe_payment_intent_id), row('cancelled'::text, 'pi_pgtap_r21_21'::text), 'cancelled, keeping its charge');
select lives_ok($$select pg_temp.failed(21, 10700, 0, 10700, 0)$$, 'that refund fails');
select is((pg_temp.staff_rows(21) -> 0 ->> 'cause') || ' ' || (pg_temp.staff_rows(21) -> 0 ->> 'amount_cents'), 'cancelled 10700', 'staff see it, as a cancelled order''s');
select is((select title || ' | ' || body from public.notifications where org_id = 'b21b0000-0000-0000-0000-00000000000b' and subject_id = pg_temp.pay(21) and title like 'Refund for%'),
  'Refund for "R21 trims" didn''t go through | Your $107.00 refund didn''t go through. TSC will send it again.', 'the brand is told');
select lives_ok($$select pg_temp.as_server('select public.record_refund_failure_resolved(''pi_pgtap_r21_21'')')$$, 'staff refund it again in Stripe');
select is(jsonb_array_length(pg_temp.staff_rows(21)), 0, 'the row goes');
select lives_ok($$select pg_temp.failed(21, 10700, 0, 10700, 0)$$, 'and that refund fails too');
select is(jsonb_array_length(pg_temp.staff_rows(21)), 1, 'the row is back for staff');

-- ===========================================================================
-- F4. Why, and what is left to refund.
-- ===========================================================================
select lives_ok($$select pg_temp.refund(31, 10700)$$, 'the labels charge is refunded in full before approval');
set local session_replication_role = replica;
update public.order_payments set state = 'confirmed', confirmed_at = now(), stripe_payment_intent_id = 'pi_pgtap_r21_31b', stripe_charge_id = 'ch_pgtap_r21_31b',
       charged_cents = 10700, amount_received_cents = 10700, refunded_at = null where id = pg_temp.pay(31);
set local session_replication_role = origin;
select lives_ok($$select pg_temp.failed(31, 10700, 3700, 7000, 0)$$, 'the brand paid again; then $70 of the first refund fails ($37 of it went through)');
select is((pg_temp.staff_rows(31) -> 0 ->> 'cause') || ' ' || (pg_temp.staff_rows(31) -> 0 ->> 'amount_cents'), 'paid_again 7000',
  'staff see why, and the $70 left to refund');

-- ===========================================================================
-- Grants and shape.
-- ===========================================================================
select ok(not has_function_privilege('authenticated', 'public.record_full_refund_failed(uuid, text, text, bigint, bigint, bigint, bigint, bigint)', 'execute')
      and has_function_privilege('service_role', 'public.record_full_refund_failed(uuid, text, text, bigint, bigint, bigint, bigint, bigint)', 'execute'),
  'record_full_refund_failed is the server''s');
select is((select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and proname = f), 1, f || ': one function, no overloads')
  from unnest(array['record_full_refund_failed', 'admin_balance_attention']) f;

select * from finish();
rollback;
