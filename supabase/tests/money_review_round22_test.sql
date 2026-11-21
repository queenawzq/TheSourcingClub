-- One balance, round 22 (20261121260000): TSC's own refund of an extra
-- payment (a stray intent) that fails is never funded again as the step's
-- payment, in the database too: staff refund it again (cause 'stray').
--
-- Fixtures: slugs pgtap-r22-*, ids b22?xxxx-...; every count is scoped to them.
begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

update public.payout_provider_settings set enabled = case
    when provider = 'paypal' and region in ('china', 'elsewhere') then true else false end;

set local session_replication_role = replica;

insert into auth.users (id, email)
select ('b22a0000-0000-0000-0000-0000000000' || k)::uuid, 'pgtap-r22-' || k || '@example.com'
  from unnest(array['01','02','03','04','05','06','07','08','09']) k;
-- 02 is staff; 03 owns the brand; 0n+? owners: e1 01, e2 04, e3 05, e4 06, e5 07, e6 08, e7 09.
insert into public.platform_admins (user_id, note) values ('b22a0000-0000-0000-0000-000000000002', 'pgtap-r22');
insert into public.orgs (id, type, name, slug) values
  ('b22b0000-0000-0000-0000-00000000000b', 'brand', 'R22 Brand', 'pgtap-r22-brand');
insert into public.orgs (id, type, name, slug)
select ('b22b0000-0000-0000-0000-0000000000e' || n)::uuid, 'factory', 'R22 Factory ' || n, 'pgtap-r22-f' || n from generate_series(1, 7) n;
insert into public.org_members (org_id, user_id, role, permissions) values
  ('b22b0000-0000-0000-0000-00000000000b', 'b22a0000-0000-0000-0000-000000000003', 'owner', '{}'),
  ('b22b0000-0000-0000-0000-0000000000e1', 'b22a0000-0000-0000-0000-000000000001', 'owner', '{}'),
  ('b22b0000-0000-0000-0000-0000000000e2', 'b22a0000-0000-0000-0000-000000000004', 'owner', '{}'),
  ('b22b0000-0000-0000-0000-0000000000e3', 'b22a0000-0000-0000-0000-000000000005', 'owner', '{}'),
  ('b22b0000-0000-0000-0000-0000000000e4', 'b22a0000-0000-0000-0000-000000000006', 'owner', '{}'),
  ('b22b0000-0000-0000-0000-0000000000e5', 'b22a0000-0000-0000-0000-000000000007', 'owner', '{}'),
  ('b22b0000-0000-0000-0000-0000000000e6', 'b22a0000-0000-0000-0000-000000000008', 'owner', '{}'),
  ('b22b0000-0000-0000-0000-0000000000e7', 'b22a0000-0000-0000-0000-000000000009', 'owner', '{}');
insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total)
select ('b22c0000-0000-0000-0000-00000000000' || n)::uuid, 'b22b0000-0000-0000-0000-00000000000b', 'R22 request ' || n, 'awarded', 'invited_only', 100
  from generate_series(1, 7) n;
insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity, submitted_at)
select ('b22c1000-0000-0000-0000-00000000000' || n)::uuid, ('b22c0000-0000-0000-0000-00000000000' || n)::uuid,
       ('b22b0000-0000-0000-0000-0000000000e' || n)::uuid, 'accepted', 100, 1, now() from generate_series(1, 7) n;
insert into public.production_orders
  (id, rfq_id, quote_id, brand_org_id, factory_org_id, unit_price_cents, status, schedule_brand_agreed_at, schedule_brand_agreed_by,
   production_quantity, bulk_subtotal_cents, sample_subtotal_cents, order_total_cents, deposit_pct, balance_pct, order_number)
select ('b22d0000-0000-0000-0000-00000000000' || n)::uuid, ('b22c0000-0000-0000-0000-00000000000' || n)::uuid,
       ('b22c1000-0000-0000-0000-00000000000' || n)::uuid, 'b22b0000-0000-0000-0000-00000000000b',
       ('b22b0000-0000-0000-0000-0000000000e' || n)::uuid, 100000, 'active', now() - interval '60 days',
       'b22a0000-0000-0000-0000-000000000003', 1, 100000, 0, 100000, 50, 50, 'R22-' || n
  from generate_series(1, 7) n;

-- Payments pNK: factory N, step K. Milestones share the id's tail.
create temporary table r22_steps (n int, k int, kind text, title text, amount bigint, charged bigint, state text,
                                  approved boolean, pool boolean) on commit drop;
insert into r22_steps values
  (1, 1, 'approval_and_payment', 'R22 fit sample', 10000, null, 'processing', false, false);
insert into public.order_milestones (id, order_id, kind, title, amount_cents, state, sort, completed_at)
select ('b22e00' || n || k || '-0000-0000-0000-000000000000')::uuid, ('b22d0000-0000-0000-0000-00000000000' || n)::uuid,
       kind::public.milestone_type, title, amount, (case when approved then 'complete' else 'active' end)::public.milestone_state, k * 10,
       case when approved then now() - interval '9 days' end
  from r22_steps;
insert into public.order_payments
  (id, order_id, milestone_id, amount_cents, charged_cents, amount_received_cents, currency, state, confirmed_at, release_requested_at,
   withdrawal_pool, stripe_payment_intent_id, stripe_charge_id, funds_available_at, released_at, released_note, processing_at)
select ('b22f00' || n || k || '-0000-0000-0000-000000000000')::uuid, ('b22d0000-0000-0000-0000-00000000000' || n)::uuid,
       ('b22e00' || n || k || '-0000-0000-0000-000000000000')::uuid, amount, charged, charged, 'USD', state::public.payment_state,
       case when state <> 'processing' then now() - interval '20 days' end,
       case when approved then now() - interval '9 days' end,
       pool, 'pi_pgtap_r22_' || n || k, case when charged is not null then 'ch_pgtap_r22_' || n || k end,
       case when charged is not null then now() - interval '15 days' end,
       case when state = 'released' then now() - interval '8 days' end,
       case when state = 'released' then 'Paid by PayPal' end,
       case when state = 'processing' then now() - interval '1 hour' end
  from r22_steps;
insert into public.factory_payout_accounts (id, org_id, method, paypal_email, is_primary, details_changed_at)
select ('b2290000-0000-0000-0000-00000000000' || n)::uuid, ('b22b0000-0000-0000-0000-0000000000e' || n)::uuid, 'paypal',
       'pgtap-r22-f' || n || '@example.com', true, '2026-11-01'
  from generate_series(1, 7) n;
insert into public.factory_payout_preferences (org_id, route)
select ('b22b0000-0000-0000-0000-0000000000e' || n)::uuid, 'manual' from generate_series(1, 7) n;
set local session_replication_role = origin;

create function pg_temp.act_as(who text) returns void language sql as $f$
  select set_config('request.jwt.claims',
    json_build_object('sub', 'b22a0000-0000-0000-0000-' || lpad(who, 12, '0'), 'role', 'authenticated')::text, true);
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
  select ('b22b0000-0000-0000-0000-0000000000e' || n)::uuid;
$f$;
create function pg_temp.owner(n int) returns text language sql immutable as $f$
  select case n when 1 then '01' when 2 then '04' when 3 then '05' when 4 then '06' when 5 then '07' when 6 then '08' else '09' end;
$f$;
create function pg_temp.pay(nk int) returns uuid language sql immutable as $f$
  select ('b22f00' || nk || '-0000-0000-0000-000000000000')::uuid;
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
  perform pg_temp.as_server(format('select public.record_payment_refund_amount(%L, %L, %s)', pg_temp.pay(nk), 'pi_pgtap_r22_' || nk, total));
end;
$f$;
create function pg_temp.refund_failed(nk int, total bigint) returns void language plpgsql as $f$
begin
  perform pg_temp.as_server(format('select public.record_payment_refund_failed(%L, %L, %s)', pg_temp.pay(nk), 'pi_pgtap_r22_' || nk, total));
end;
$f$;
create function pg_temp.lost(nk int, amount bigint) returns void language plpgsql as $f$
begin
  perform pg_temp.as_server(format('select public.record_payment_dispute_lost(%L, %L, %s, 1500)', pg_temp.pay(nk), 'du_pgtap_r22_' || nk, amount));
end;
$f$;
create function pg_temp.req(n int, amount bigint) returns uuid language plpgsql as $f$
declare w uuid;
begin
  perform pg_temp.act_as(pg_temp.owner(n));
  set local role authenticated;
  w := (public.request_withdrawal(pg_temp.org(n), amount, ('b2290000-0000-0000-0000-00000000000' || n)::uuid)).id;
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
  perform pg_temp.as_server(format('select public.record_withdrawal(%L, ''paid'', ''PP-R22'', 0, %s, ''USD'', null)', w,
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
    'pi_pgtap_r22_' || nk, 'ch_pgtap_r22_' || nk, charged, refunded_now, failed, lost, case when lost > 0 then '1500' else 'null' end));
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


-- The brand paid while the step's amount changed: TSC refunded that intent
-- (record_payment_refunded with the reason), and the brand was sent back to pay.
select lives_ok($$select pg_temp.as_server(format('select public.record_payment_refunded(%L, %L, %L)', pg_temp.pay(11), 'pi_pgtap_r22_11',
  'The amount changed while you were paying. You were refunded; please pay again.'))$$, 'TSC refunds an extra payment (the amount changed)');
select is((pg_temp.p(11)).state::text, 'failed', 'the brand is sent back to pay');
select lives_ok($$select pg_temp.failed(11, 10700, 0, 10700, 0)$$, 'that refund fails in Stripe');
select is(row((pg_temp.p(11)).state::text, (pg_temp.p(11)).stripe_payment_intent_id), row('failed'::text, null::text),
  'the step is never funded with it: its amount is not the step''s');
select is((pg_temp.staff_rows(11) -> 0 ->> 'cause') || ' ' || (pg_temp.staff_rows(11) -> 0 ->> 'amount_cents'), 'stray 10700', 'staff refund it again');
select is((select count(*)::int from public.notifications where subject_id = pg_temp.pay(11) and title like 'Refund for%'), 0, 'nobody else is told');
select throws_ok($$insert into public.payment_refund_failures (payment_id, payment_intent, amount_cents, currency, cause)
  values ('b22f0011-0000-0000-0000-000000000000', 'pi_x', 1, 'USD', 'other')$$, '23514', null, 'causes are paid_again, cancelled or stray');

select * from finish();
rollback;
