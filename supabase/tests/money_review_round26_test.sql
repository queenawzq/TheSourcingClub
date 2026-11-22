-- One balance, fix round 26 (20261121300000).
--
-- e5: a factory with an active Stripe account, a PayPal default and a
--     switched-off Wise removes both: the route goes back to Stripe.
-- e4: old pool $300, two $150 payouts being sent, $107 refunded: the newer
--     is $100 short; it fails: $50 came back, kept, and read as kept.
--
-- Fixtures: slugs pgtap-r26-*, ids b26?xxxx-...; every count is scoped to them.
begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

update public.payout_provider_settings set enabled = case
    when provider = 'paypal' and region in ('china', 'elsewhere') then true else false end;

set local session_replication_role = replica;

insert into auth.users (id, email)
select ('b26a0000-0000-0000-0000-0000000000' || k)::uuid, 'pgtap-r26-' || k || '@example.com'
  from unnest(array['01','02','03','04','05','06','07','08','09']) k;
-- 02 is staff; 03 owns the brand; 0n+? owners: e1 01, e2 04, e3 05, e4 06, e5 07, e6 08, e7 09.
insert into public.platform_admins (user_id, note) values ('b26a0000-0000-0000-0000-000000000002', 'pgtap-r26');
insert into public.orgs (id, type, name, slug) values
  ('b26b0000-0000-0000-0000-00000000000b', 'brand', 'R26 Brand', 'pgtap-r26-brand');
insert into public.orgs (id, type, name, slug)
select ('b26b0000-0000-0000-0000-0000000000e' || n)::uuid, 'factory', 'R26 Factory ' || n, 'pgtap-r26-f' || n from generate_series(1, 7) n;
insert into public.org_members (org_id, user_id, role, permissions) values
  ('b26b0000-0000-0000-0000-00000000000b', 'b26a0000-0000-0000-0000-000000000003', 'owner', '{}'),
  ('b26b0000-0000-0000-0000-0000000000e1', 'b26a0000-0000-0000-0000-000000000001', 'owner', '{}'),
  ('b26b0000-0000-0000-0000-0000000000e2', 'b26a0000-0000-0000-0000-000000000004', 'owner', '{}'),
  ('b26b0000-0000-0000-0000-0000000000e3', 'b26a0000-0000-0000-0000-000000000005', 'owner', '{}'),
  ('b26b0000-0000-0000-0000-0000000000e4', 'b26a0000-0000-0000-0000-000000000006', 'owner', '{}'),
  ('b26b0000-0000-0000-0000-0000000000e5', 'b26a0000-0000-0000-0000-000000000007', 'owner', '{}'),
  ('b26b0000-0000-0000-0000-0000000000e6', 'b26a0000-0000-0000-0000-000000000008', 'owner', '{}'),
  ('b26b0000-0000-0000-0000-0000000000e7', 'b26a0000-0000-0000-0000-000000000009', 'owner', '{}');
insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total)
select ('b26c0000-0000-0000-0000-00000000000' || n)::uuid, 'b26b0000-0000-0000-0000-00000000000b', 'R26 request ' || n, 'awarded', 'invited_only', 100
  from generate_series(1, 7) n;
insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity, submitted_at)
select ('b26c1000-0000-0000-0000-00000000000' || n)::uuid, ('b26c0000-0000-0000-0000-00000000000' || n)::uuid,
       ('b26b0000-0000-0000-0000-0000000000e' || n)::uuid, 'accepted', 100, 1, now() from generate_series(1, 7) n;
insert into public.production_orders
  (id, rfq_id, quote_id, brand_org_id, factory_org_id, unit_price_cents, status, schedule_brand_agreed_at, schedule_brand_agreed_by,
   production_quantity, bulk_subtotal_cents, sample_subtotal_cents, order_total_cents, deposit_pct, balance_pct, order_number)
select ('b26d0000-0000-0000-0000-00000000000' || n)::uuid, ('b26c0000-0000-0000-0000-00000000000' || n)::uuid,
       ('b26c1000-0000-0000-0000-00000000000' || n)::uuid, 'b26b0000-0000-0000-0000-00000000000b',
       ('b26b0000-0000-0000-0000-0000000000e' || n)::uuid, 100000, 'active', now() - interval '60 days',
       'b26a0000-0000-0000-0000-000000000003', 1, 100000, 0, 100000, 50, 50, 'R26-' || n
  from generate_series(1, 7) n;

-- Payments pNK: factory N, step K. Milestones share the id's tail.
create temporary table r26_steps (n int, k int, kind text, title text, amount bigint, charged bigint, state text,
                                  approved boolean, pool boolean) on commit drop;
insert into r26_steps values
  (1, 1, 'payment_only', 'R26 deposit',      50000, 53500, 'confirmed', true, false),
  (2, 1, 'payment_only', 'R26 deposit',      50000, 53500, 'confirmed', true, false),
  (3, 1, 'payment_only', 'R26 deposit',      50000, 53500, 'confirmed', true, false),
  (4, 1, 'payment_only', 'R26 pool deposit', 30000, 32100, 'confirmed', true, true);
insert into public.order_milestones (id, order_id, kind, title, amount_cents, state, sort, completed_at)
select ('b26e00' || n || k || '-0000-0000-0000-000000000000')::uuid, ('b26d0000-0000-0000-0000-00000000000' || n)::uuid,
       kind::public.milestone_type, title, amount, (case when approved then 'complete' else 'active' end)::public.milestone_state, k * 10,
       case when approved then now() - interval '9 days' end
  from r26_steps;
insert into public.order_payments
  (id, order_id, milestone_id, amount_cents, charged_cents, amount_received_cents, currency, state, confirmed_at, release_requested_at,
   withdrawal_pool, stripe_payment_intent_id, stripe_charge_id, funds_available_at, released_at, released_note, processing_at)
select ('b26f00' || n || k || '-0000-0000-0000-000000000000')::uuid, ('b26d0000-0000-0000-0000-00000000000' || n)::uuid,
       ('b26e00' || n || k || '-0000-0000-0000-000000000000')::uuid, amount, charged, charged, 'USD', state::public.payment_state,
       case when state <> 'processing' then now() - interval '20 days' end,
       case when approved then now() - interval '9 days' end,
       pool, 'pi_pgtap_r26_' || n || k, case when charged is not null then 'ch_pgtap_r26_' || n || k end,
       case when charged is not null then now() - interval '15 days' end,
       case when state = 'released' then now() - interval '8 days' end,
       case when state = 'released' then 'Paid by PayPal' end,
       case when state = 'processing' then now() - interval '1 hour' end
  from r26_steps;
insert into public.factory_payout_accounts (id, org_id, method, paypal_email, is_primary, details_changed_at)
select ('b2690000-0000-0000-0000-00000000000' || n)::uuid, ('b26b0000-0000-0000-0000-0000000000e' || n)::uuid, 'paypal',
       'pgtap-r26-f' || n || '@example.com', true, '2026-11-01'
  from generate_series(1, 7) n where n <> 4;
insert into public.factory_payout_accounts (id, org_id, method, paypal_email, is_primary, details_changed_at)
values ('b2690000-0000-0000-0000-000000000004', 'b26b0000-0000-0000-0000-0000000000e4', 'paypal', 'pgtap-r26-f4@example.com', true, '2026-11-01');
insert into public.factory_payout_accounts
  (id, org_id, method, bank_name, account_name, account_number_last4, swift, bank_country, is_primary,
   wise_recipient_type, wise_currency, wise_number_key, wise_details, details_changed_at, number_changed_at)
values ('b2690000-0000-0000-0000-0000000000a4', 'b26b0000-0000-0000-0000-0000000000e4', 'bank', 'R26 Bank', 'R26 MILL LTD', '1234', 'BOSHCNSH', 'CN', false,
        'chinese_local_business', 'CNY', 'accountNumber', '{"accountHolderName":"R26 MILL LTD"}', '2026-11-01', now()),
       ('b2690000-0000-0000-0000-0000000000a5', 'b26b0000-0000-0000-0000-0000000000e5', 'bank', 'R26 Bank', 'R26 MILL LTD', '5678', 'BOSHCNSH', 'CN', false,
        'chinese_local_business', 'CNY', 'accountNumber', '{"accountHolderName":"R26 MILL LTD"}', '2026-11-01', now());
insert into public.factory_payout_preferences (org_id, route)
select ('b26b0000-0000-0000-0000-0000000000e' || n)::uuid, 'manual' from generate_series(1, 7) n;
insert into public.stripe_connect_accounts (org_id, stripe_account_id, country, transfers_active, payouts_enabled, details_submitted)
values ('b26b0000-0000-0000-0000-0000000000e5', 'acct_pgtap_r26_5', 'US', true, true, true);
set local session_replication_role = origin;
-- The old pool, turned into an owed step as the migration does (20261121350000).
select public.convert_withdrawal_pool();

create function pg_temp.act_as(who text) returns void language sql as $f$
  select set_config('request.jwt.claims',
    json_build_object('sub', 'b26a0000-0000-0000-0000-' || lpad(who, 12, '0'), 'role', 'authenticated')::text, true);
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
  select ('b26b0000-0000-0000-0000-0000000000e' || n)::uuid;
$f$;
create function pg_temp.owner(n int) returns text language sql immutable as $f$
  select case n when 1 then '01' when 2 then '04' when 3 then '05' when 4 then '06' when 5 then '07' when 6 then '08' else '09' end;
$f$;
create function pg_temp.pay(nk int) returns uuid language sql immutable as $f$
  select ('b26f00' || nk || '-0000-0000-0000-000000000000')::uuid;
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
  perform pg_temp.as_server(format('select public.record_payment_refund_amount(%L, %L, %s)', pg_temp.pay(nk), 'pi_pgtap_r26_' || nk, total));
end;
$f$;
create function pg_temp.refund_failed(nk int, total bigint) returns void language plpgsql as $f$
begin
  perform pg_temp.as_server(format('select public.record_payment_refund_failed(%L, %L, %s)', pg_temp.pay(nk), 'pi_pgtap_r26_' || nk, total));
end;
$f$;
create function pg_temp.lost(nk int, amount bigint) returns void language plpgsql as $f$
begin
  perform pg_temp.as_server(format('select public.record_payment_dispute_lost(%L, %L, %s, 1500)', pg_temp.pay(nk), 'du_pgtap_r26_' || nk, amount));
end;
$f$;
create function pg_temp.req(n int, amount bigint) returns uuid language plpgsql as $f$
declare w uuid;
begin
  perform pg_temp.act_as(pg_temp.owner(n));
  set local role authenticated;
  w := (public.request_withdrawal(pg_temp.org(n), amount, ('b2690000-0000-0000-0000-00000000000' || n)::uuid)).id;
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
  perform pg_temp.as_server(format('select public.record_withdrawal(%L, ''paid'', ''PP-R26'', 0, %s, ''USD'', null)', w,
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




-- A ---------------------------------------------------------------------------
select is(public.uses_stripe_payout(pg_temp.org(5)), false, 'e5 pays by its PayPal default (route manual)');
select pg_temp.act_as('07'); set local role authenticated;
select lives_ok($$select public.remove_payout_account('b2690000-0000-0000-0000-000000000005')$$, 'the owner removes the PayPal: no default left');
select lives_ok($$select public.remove_payout_account('b2690000-0000-0000-0000-0000000000a5')$$, 'then the switched-off Wise, its last method');
reset role;
select is((select count(*)::int from public.factory_payout_preferences where org_id = pg_temp.org(5) and route = 'manual'), 0, 'the manual route is gone');
select is(row(public.uses_stripe_payout(pg_temp.org(5)), public.factory_has_no_payout_method(pg_temp.org(5))), row(true, false),
  'its active Stripe account is how it is paid again');

-- B ---------------------------------------------------------------------------
select set_config('tsc.r26_p1', pg_temp.req(4, 15000)::text, true);
set local session_replication_role = replica;
update public.factory_withdrawals set created_at = now() - interval '1 hour' where id = current_setting('tsc.r26_p1')::uuid;
-- and its part of the deposit with it (in one transaction both are "now").
update public.payment_takes set created_at = now() - interval '1 hour' where factory_withdrawal_id = current_setting('tsc.r26_p1')::uuid;
set local session_replication_role = origin;
select set_config('tsc.r26_p2', pg_temp.req(4, 15000)::text, true);
select lives_ok($$select pg_temp.claim(current_setting('tsc.r26_p1')::uuid)$$, 'the older $150 is sent');
select lives_ok($$select pg_temp.claim(current_setting('tsc.r26_p2')::uuid)$$, 'the newer $150 is sent');
select lives_ok($$select pg_temp.refund(41, 10700)$$, '$107 of the pool deposit is refunded: the newer is $100 short');
select lives_ok($$select pg_temp.as_server(format('select public.record_withdrawal(%L, ''failed'', sentence => ''unclaimed'')', current_setting('tsc.r26_p2')))$$,
  'the newer fails');
select is((select back_cents from public.factory_withdrawals where id = current_setting('tsc.r26_p2')::uuid), 5000::bigint, '$50 came back: kept on it');
select is((select x ->> 'back_cents' from jsonb_array_elements(pg_temp.bal(4) -> 'withdrawals') x where x ->> 'id' = current_setting('tsc.r26_p2')), '5000',
  'the card reads what was kept, not a figure worked out again');
select is((select body from public.notifications where subject_id = current_setting('tsc.r26_p2')::uuid and title like '% did not go through'),
  '$50.00 is back in your balance. Check your withdrawal method, then withdraw again.', 'the notice says the same');
select set_config('tsc.r26_c', pg_temp.req(4, 1000)::text, true);
select pg_temp.act_as('06'); set local role authenticated;
select lives_ok($$select public.cancel_withdrawal(current_setting('tsc.r26_c')::uuid)$$, 'a cancelled one');
reset role;
select is((select back_cents from public.factory_withdrawals where id = current_setting('tsc.r26_c')::uuid), 1000::bigint, 'keeps what came back too');

select is((select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and proname = f), 1, f || ': one function, no overloads')
  from unnest(array['guard_payout_account_delete', 'record_withdrawal', 'cancel_withdrawal', 'factory_balance']) f;

select * from finish();
rollback;
