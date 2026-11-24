-- One balance, fix round 25 (20261121290000): payouts that were being sent
-- when part of them went back to the brand, and removing a default.
--
-- e1: refunded in full while sent, then the payout fails: "returned to the
--     brand", never "back in your balance".
-- e2: refunded twice while sent: told each new amount; the payout completes:
--     told it owes TSC that part.
-- e3: a withdrawal told "on hold" earlier, then sent, then refunded: told.
-- e4: old-pool money refunded while its payout is sent: counted and told.
-- Paused payments (20261124100000): a refund after approval takes nothing
--     from a withdrawal being sent and makes no debt; it opens a payment
--     review. e1-e4 now assert that: the withdrawal is unchanged, nothing is
--     owed, and the factory is paused.
-- e5: removing the default PayPal never makes the switched-off Wise the default.
--
-- Fixtures: slugs pgtap-r25-*, ids b25?xxxx-...; every count is scoped to them.
begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

update public.payout_provider_settings set enabled = case
    when provider = 'paypal' and region in ('china', 'elsewhere') then true else false end;

set local session_replication_role = replica;

insert into auth.users (id, email)
select ('b25a0000-0000-0000-0000-0000000000' || k)::uuid, 'pgtap-r25-' || k || '@example.com'
  from unnest(array['01','02','03','04','05','06','07','08','09']) k;
-- 02 is staff; 03 owns the brand; 0n+? owners: e1 01, e2 04, e3 05, e4 06, e5 07, e6 08, e7 09.
insert into public.platform_admins (user_id, note) values ('b25a0000-0000-0000-0000-000000000002', 'pgtap-r25');
insert into public.orgs (id, type, name, slug) values
  ('b25b0000-0000-0000-0000-00000000000b', 'brand', 'R25 Brand', 'pgtap-r25-brand');
insert into public.orgs (id, type, name, slug)
select ('b25b0000-0000-0000-0000-0000000000e' || n)::uuid, 'factory', 'R25 Factory ' || n, 'pgtap-r25-f' || n from generate_series(1, 7) n;
insert into public.org_members (org_id, user_id, role, permissions) values
  ('b25b0000-0000-0000-0000-00000000000b', 'b25a0000-0000-0000-0000-000000000003', 'owner', '{}'),
  ('b25b0000-0000-0000-0000-0000000000e1', 'b25a0000-0000-0000-0000-000000000001', 'owner', '{}'),
  ('b25b0000-0000-0000-0000-0000000000e2', 'b25a0000-0000-0000-0000-000000000004', 'owner', '{}'),
  ('b25b0000-0000-0000-0000-0000000000e3', 'b25a0000-0000-0000-0000-000000000005', 'owner', '{}'),
  ('b25b0000-0000-0000-0000-0000000000e4', 'b25a0000-0000-0000-0000-000000000006', 'owner', '{}'),
  ('b25b0000-0000-0000-0000-0000000000e5', 'b25a0000-0000-0000-0000-000000000007', 'owner', '{}'),
  ('b25b0000-0000-0000-0000-0000000000e6', 'b25a0000-0000-0000-0000-000000000008', 'owner', '{}'),
  ('b25b0000-0000-0000-0000-0000000000e7', 'b25a0000-0000-0000-0000-000000000009', 'owner', '{}');
insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total)
select ('b25c0000-0000-0000-0000-00000000000' || n)::uuid, 'b25b0000-0000-0000-0000-00000000000b', 'R25 request ' || n, 'awarded', 'invited_only', 100
  from generate_series(1, 7) n;
insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity, submitted_at)
select ('b25c1000-0000-0000-0000-00000000000' || n)::uuid, ('b25c0000-0000-0000-0000-00000000000' || n)::uuid,
       ('b25b0000-0000-0000-0000-0000000000e' || n)::uuid, 'accepted', 100, 1, now() from generate_series(1, 7) n;
insert into public.production_orders
  (id, rfq_id, quote_id, brand_org_id, factory_org_id, unit_price_cents, status, schedule_brand_agreed_at, schedule_brand_agreed_by,
   production_quantity, bulk_subtotal_cents, sample_subtotal_cents, order_total_cents, deposit_pct, balance_pct, order_number)
select ('b25d0000-0000-0000-0000-00000000000' || n)::uuid, ('b25c0000-0000-0000-0000-00000000000' || n)::uuid,
       ('b25c1000-0000-0000-0000-00000000000' || n)::uuid, 'b25b0000-0000-0000-0000-00000000000b',
       ('b25b0000-0000-0000-0000-0000000000e' || n)::uuid, 100000, 'active', now() - interval '60 days',
       'b25a0000-0000-0000-0000-000000000003', 1, 100000, 0, 100000, 50, 50, 'R25-' || n
  from generate_series(1, 7) n;

-- Payments pNK: factory N, step K. Milestones share the id's tail.
create temporary table r25_steps (n int, k int, kind text, title text, amount bigint, charged bigint, state text,
                                  approved boolean, pool boolean) on commit drop;
insert into r25_steps values
  (1, 1, 'payment_only', 'R25 deposit',      50000, 53500, 'confirmed', true, false),
  (2, 1, 'payment_only', 'R25 deposit',      50000, 53500, 'confirmed', true, false),
  (3, 1, 'payment_only', 'R25 deposit',      50000, 53500, 'confirmed', true, false),
  (4, 1, 'payment_only', 'R25 pool deposit', 30000, 32100, 'confirmed', true, true);
insert into public.order_milestones (id, order_id, kind, title, amount_cents, state, sort, completed_at)
select ('b25e00' || n || k || '-0000-0000-0000-000000000000')::uuid, ('b25d0000-0000-0000-0000-00000000000' || n)::uuid,
       kind::public.milestone_type, title, amount, (case when approved then 'complete' else 'active' end)::public.milestone_state, k * 10,
       case when approved then now() - interval '9 days' end
  from r25_steps;
insert into public.order_payments
  (id, order_id, milestone_id, amount_cents, charged_cents, amount_received_cents, currency, state, confirmed_at, release_requested_at,
   withdrawal_pool, stripe_payment_intent_id, stripe_charge_id, funds_available_at, released_at, released_note, processing_at)
select ('b25f00' || n || k || '-0000-0000-0000-000000000000')::uuid, ('b25d0000-0000-0000-0000-00000000000' || n)::uuid,
       ('b25e00' || n || k || '-0000-0000-0000-000000000000')::uuid, amount, charged, charged, 'USD', state::public.payment_state,
       case when state <> 'processing' then now() - interval '20 days' end,
       case when approved then now() - interval '9 days' end,
       pool, 'pi_pgtap_r25_' || n || k, case when charged is not null then 'ch_pgtap_r25_' || n || k end,
       case when charged is not null then now() - interval '15 days' end,
       case when state = 'released' then now() - interval '8 days' end,
       case when state = 'released' then 'Paid by PayPal' end,
       case when state = 'processing' then now() - interval '1 hour' end
  from r25_steps;
insert into public.factory_payout_accounts (id, org_id, method, paypal_email, is_primary, details_changed_at)
select ('b2590000-0000-0000-0000-00000000000' || n)::uuid, ('b25b0000-0000-0000-0000-0000000000e' || n)::uuid, 'paypal',
       'pgtap-r25-f' || n || '@example.com', true, '2026-11-01'
  from generate_series(1, 7) n where n <> 4;
insert into public.factory_payout_accounts (id, org_id, method, paypal_email, is_primary, details_changed_at)
values ('b2590000-0000-0000-0000-000000000004', 'b25b0000-0000-0000-0000-0000000000e4', 'paypal', 'pgtap-r25-f4@example.com', true, '2026-11-01');
insert into public.factory_payout_accounts
  (id, org_id, method, bank_name, account_name, account_number_last4, swift, bank_country, is_primary,
   wise_recipient_type, wise_currency, wise_number_key, wise_details, details_changed_at, number_changed_at)
values ('b2590000-0000-0000-0000-0000000000a4', 'b25b0000-0000-0000-0000-0000000000e4', 'bank', 'R25 Bank', 'R25 MILL LTD', '1234', 'BOSHCNSH', 'CN', false,
        'chinese_local_business', 'CNY', 'accountNumber', '{"accountHolderName":"R25 MILL LTD"}', '2026-11-01', now()),
       ('b2590000-0000-0000-0000-0000000000a5', 'b25b0000-0000-0000-0000-0000000000e5', 'bank', 'R25 Bank', 'R25 MILL LTD', '5678', 'BOSHCNSH', 'CN', false,
        'chinese_local_business', 'CNY', 'accountNumber', '{"accountHolderName":"R25 MILL LTD"}', '2026-11-01', now());
insert into public.factory_payout_preferences (org_id, route)
select ('b25b0000-0000-0000-0000-0000000000e' || n)::uuid, 'manual' from generate_series(1, 7) n;
set local session_replication_role = origin;
-- The old pool, turned into takes as the migration does (20261121350000).
select public.convert_withdrawal_pool();

create function pg_temp.act_as(who text) returns void language sql as $f$
  select set_config('request.jwt.claims',
    json_build_object('sub', 'b25a0000-0000-0000-0000-' || lpad(who, 12, '0'), 'role', 'authenticated')::text, true);
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
  select ('b25b0000-0000-0000-0000-0000000000e' || n)::uuid;
$f$;
create function pg_temp.owner(n int) returns text language sql immutable as $f$
  select case n when 1 then '01' when 2 then '04' when 3 then '05' when 4 then '06' when 5 then '07' when 6 then '08' else '09' end;
$f$;
create function pg_temp.pay(nk int) returns uuid language sql immutable as $f$
  select ('b25f00' || nk || '-0000-0000-0000-000000000000')::uuid;
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
  perform pg_temp.as_server(format('select public.record_payment_refund_amount(%L, %L, %s)', pg_temp.pay(nk), 'pi_pgtap_r25_' || nk, total));
end;
$f$;
create function pg_temp.refund_failed(nk int, total bigint) returns void language plpgsql as $f$
begin
  perform pg_temp.as_server(format('select public.record_payment_refund_failed(%L, %L, %s)', pg_temp.pay(nk), 'pi_pgtap_r25_' || nk, total));
end;
$f$;
create function pg_temp.lost(nk int, amount bigint) returns void language plpgsql as $f$
begin
  perform pg_temp.as_server(format('select public.record_payment_dispute_lost(%L, %L, %s, 1500)', pg_temp.pay(nk), 'du_pgtap_r25_' || nk, amount));
end;
$f$;
create function pg_temp.req(n int, amount bigint) returns uuid language plpgsql as $f$
declare w uuid;
begin
  perform pg_temp.act_as(pg_temp.owner(n));
  set local role authenticated;
  w := (public.request_withdrawal(pg_temp.org(n), amount, ('b2590000-0000-0000-0000-00000000000' || n)::uuid)).id;
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
  perform pg_temp.as_server(format('select public.record_withdrawal(%L, ''paid'', ''PP-R25'', 0, %s, ''USD'', null)', w,
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



create function pg_temp.told_w(w text, pattern text) returns text language sql as $f$
  select string_agg(title || ' | ' || body, ' || ' order by created_at, (data ->> 'gone_cents')::bigint nulls first)
    from public.notifications where subject_id = w::uuid and title like pattern;
$f$;

-- e1 ------------------------------------------------------------------------
select set_config('tsc.r25_w1', pg_temp.req(1, 50000)::text, true);
select lives_ok($$select pg_temp.claim(current_setting('tsc.r25_w1')::uuid)$$, 'e1: staff send $500');
select lives_ok($$select pg_temp.refund(11, 53500)$$, 'e1: the brand is refunded in full while it is sent');
select lives_ok($$select pg_temp.as_server(format('select public.record_withdrawal(%L, ''failed'', sentence => ''unclaimed'')', current_setting('tsc.r25_w1')))$$,
  'e1: the payout fails');
-- Paused payments: the refund took nothing from it, so all of it comes back.
select is(pg_temp.told_w(current_setting('tsc.r25_w1'), '% did not go through'),
  'Withdrawal of $500.00 did not go through | The amount is back in your balance. Check your withdrawal method, then withdraw again.',
  'e1: the amount is back in its balance (the refund took nothing from it)');
select is(row((select x ->> 'back_cents' from jsonb_array_elements(pg_temp.bal(1) -> 'withdrawals') x where x ->> 'id' = current_setting('tsc.r25_w1')),
              (pg_temp.bal(1) ->> 'available_cents')::bigint, public.factory_paused(pg_temp.org(1))),
          row('50000'::text, 50000::bigint, true),
  'e1: the card reads all $500 came back; the factory is under review');

-- e2 ------------------------------------------------------------------------
select set_config('tsc.r25_w2', pg_temp.req(2, 50000)::text, true);
select lives_ok($$select pg_temp.claim(current_setting('tsc.r25_w2')::uuid)$$, 'e2: staff send $500');
select lives_ok($$select pg_temp.refund(21, 10700)$$, 'e2: $107 refunded while sent');
select lives_ok($$select pg_temp.refund(21, 21400)$$, 'e2: $107 more');
select is(row(pg_temp.told_w(current_setting('tsc.r25_w2'), '% being checked'),
              (select amount_cents from public.payment_reviews where payment_id = pg_temp.pay(21) and decided_at is null)),
          row(null::text, 21400::bigint),
  'e2: no "being checked" notice: one payment review holds all $214 of the charge that went back so far');
select lives_ok($$select pg_temp.as_server(format('select public.record_withdrawal(%L, ''paid'', ''PP-R25'', 0, 50000, ''USD'', null)', current_setting('tsc.r25_w2')))$$,
  'e2: the payout completes');
select is(pg_temp.told_w(current_setting('tsc.r25_w2'), '% paid out to you'),
  '$500.00 paid out to you | Sent to pgtap-r25-f2@example.com. Payout fee $0.00 is taken from this payment: you receive $500.00.',
  'e2: told it was paid, never that it owes TSC');
select is(row((pg_temp.bal(2) ->> 'owed_to_tsc_cents')::bigint, public.factory_paused(pg_temp.org(2))), row(0::bigint, true),
  'e2: it owes nothing; the factory is under review');

-- e3 ------------------------------------------------------------------------
select set_config('tsc.r25_w3', pg_temp.req(3, 50000)::text, true);
-- Told "on hold" earlier, while it waited (and covered again since).
insert into public.notifications (org_id, kind, subject_type, subject_id, title, body)
values (pg_temp.org(3), 'withdrawal', 'withdrawal', current_setting('tsc.r25_w3')::uuid, 'Withdrawal of $500.00 on hold', 'earlier');
select lives_ok($$select pg_temp.claim(current_setting('tsc.r25_w3')::uuid)$$, 'e3: staff send it');
select lives_ok($$select pg_temp.refund(31, 10700)$$, 'e3: $107 refunded while sent');
select is(row(pg_temp.told_w(current_setting('tsc.r25_w3'), '% being checked'),
              (select title from public.notifications where org_id = pg_temp.org(3) and title = 'Withdrawals paused')),
          row(null::text, 'Withdrawals paused'::text),
  'e3: told its withdrawals are paused (no "being checked"), though it was told "on hold" before');

-- e4 ------------------------------------------------------------------------
select set_config('tsc.r25_w4', pg_temp.req(4, 30000)::text, true);
select is((select sum(amount_cents) from public.payment_takes where factory_withdrawal_id = current_setting('tsc.r25_w4')::uuid and payment_id = pg_temp.pay(41))::bigint, 30000::bigint, 'e4: $300 of the old-pool deposit, held by its take');
select lives_ok($$select pg_temp.claim(current_setting('tsc.r25_w4')::uuid)$$, 'e4: staff send it');
select lives_ok($$select pg_temp.refund(41, 10700)$$, 'e4: $107 of the pool deposit refunded while sent');
-- Paused payments: nothing at risk on the withdrawal; the factory is paused.
select is(row((pg_temp.staff_row(current_setting('tsc.r25_w4')::uuid) ->> 'refunded_cents')::bigint, public.factory_paused(pg_temp.org(4))),
          row(0::bigint, true), 'e4: staff see nothing refunded on it; the factory is under review');
select is(row(pg_temp.told_w(current_setting('tsc.r25_w4'), '% being checked'),
              (select title from public.notifications where org_id = pg_temp.org(4) and title = 'Withdrawals paused')),
          row(null::text, 'Withdrawals paused'::text), 'e4: the factory is told its withdrawals are paused');
select is((select x -> 'parts' from jsonb_array_elements(pg_temp.bal(4) -> 'withdrawals') x where x ->> 'id' = current_setting('tsc.r25_w4')),
  '[{"word": "on_its_way", "amount_cents": 30000}]'::jsonb, 'e4: its block: all $300 on its way');
select ok((pg_temp.bal(4) ->> 'total_cents')::bigint = (pg_temp.bal(4) ->> 'awaiting_cents')::bigint + (pg_temp.bal(4) ->> 'available_cents')::bigint
  + (pg_temp.bal(4) ->> 'pending_cents')::bigint + (pg_temp.bal(4) ->> 'processing_cents')::bigint + (pg_temp.bal(4) ->> 'paid_out_cents')::bigint
  and (pg_temp.bal(4) ->> 'processing_cents')::bigint = 30000, 'e4: Processing $300, Total adds up');

-- e5 ------------------------------------------------------------------------
select pg_temp.act_as('07'); set local role authenticated;
select is(public.remove_payout_account('b2590000-0000-0000-0000-000000000005'), null::uuid,
  'e5: removing the default PayPal makes no default of the switched-off Wise');
reset role;
select is((select is_primary from public.factory_payout_accounts where id = 'b2590000-0000-0000-0000-0000000000a5'), false, 'e5: the Wise account is not the default');
select ok(not has_function_privilege('anon', 'public.payout_account_usable(uuid)', 'execute'), 'payout_account_usable is not anon''s');
select is((select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and proname = f), 1, f || ': one function, no overloads')
  from unnest(array['withdrawal_refunded_cents', 'factory_balance', 'tell_withdrawal_refunded', 'record_withdrawal', 'remove_payout_account',
                    'payout_account_usable']) f;

select * from finish();
rollback;
