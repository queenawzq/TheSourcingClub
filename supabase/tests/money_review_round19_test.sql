-- One balance, fix round 19 (20261121230000): the money review's findings.
--
-- H1  (e1, p11): a smaller refund total (an older copy of the charge) never
--     lowers what is recorded; only record_payment_refund_failed lowers it.
-- M2  (e2, p21 p22): a Stripe withdrawal of owed steps is refused in the
--     database while the factory owes TSC more than its other earnings.
-- M3  (e2): the waiting withdrawal on hold because of that debt is told what
--     is owed, never an unrelated step, never to withdraw again.
-- L1  (e3, p31): staff's record of a bank transfer is refused while the
--     factory is paused by a payment review (20261124100100), and recorded
--     once staff decide; the refund leaves no debt.
-- L2  (e4, p41): an older old-pool withdrawal the pool still covers is
--     covered and paid, though a newer one is short.
--     (e5, p51 p52): the pool paid beyond what it holds no longer blocks a
--     later withdrawal of other earnings that cover the debt.
-- L3  (e6, p61): a dispute lost while the payment was processing is recorded
--     once the payment is funded.
-- L4  (e6, p62): part of a charge lost before approval keeps the step
--     funded with the rest.
-- L5  (e6, p63): a refund before the payment is funded records nothing (a
--     refund of the step amount is not taken as full); recorded and told once
--     funded.
-- L6  (e7, p71): the To recover row names an old per-step PayPal payout.
--
-- Paused payments (20261124100000): a refund after approval no longer lowers
-- the factory's earning or makes a debt; it opens a payment review and pauses
-- the factory's withdrawals. M2/M3, L1, L2, L6 and F5 now assert that; where a
-- fixture's later steps need the factory unpaused, staff decide Pay factory.
--
-- Fixtures: slugs pgtap-r19-*, ids b19?xxxx-...; every count is scoped to them.
begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

update public.payout_provider_settings set enabled = case
    when provider = 'paypal' and region in ('china', 'elsewhere') then true else false end;

set local session_replication_role = replica;

insert into auth.users (id, email)
select ('b19a0000-0000-0000-0000-0000000000' || k)::uuid, 'pgtap-r19-' || k || '@example.com'
  from unnest(array['01','02','03','04','05','06','07','08','09']) k;
-- 02 is staff; 03 owns the brand; 0n+? owners: e1 01, e2 04, e3 05, e4 06, e5 07, e6 08, e7 09.
insert into public.platform_admins (user_id, note) values ('b19a0000-0000-0000-0000-000000000002', 'pgtap-r19');
insert into public.orgs (id, type, name, slug) values
  ('b19b0000-0000-0000-0000-00000000000b', 'brand', 'R19 Brand', 'pgtap-r19-brand');
insert into public.orgs (id, type, name, slug)
select ('b19b0000-0000-0000-0000-0000000000e' || n)::uuid, 'factory', 'R19 Factory ' || n, 'pgtap-r19-f' || n from generate_series(1, 7) n;
insert into public.org_members (org_id, user_id, role, permissions) values
  ('b19b0000-0000-0000-0000-00000000000b', 'b19a0000-0000-0000-0000-000000000003', 'owner', '{}'),
  ('b19b0000-0000-0000-0000-0000000000e1', 'b19a0000-0000-0000-0000-000000000001', 'owner', '{}'),
  ('b19b0000-0000-0000-0000-0000000000e2', 'b19a0000-0000-0000-0000-000000000004', 'owner', '{}'),
  ('b19b0000-0000-0000-0000-0000000000e3', 'b19a0000-0000-0000-0000-000000000005', 'owner', '{}'),
  ('b19b0000-0000-0000-0000-0000000000e4', 'b19a0000-0000-0000-0000-000000000006', 'owner', '{}'),
  ('b19b0000-0000-0000-0000-0000000000e5', 'b19a0000-0000-0000-0000-000000000007', 'owner', '{}'),
  ('b19b0000-0000-0000-0000-0000000000e6', 'b19a0000-0000-0000-0000-000000000008', 'owner', '{}'),
  ('b19b0000-0000-0000-0000-0000000000e7', 'b19a0000-0000-0000-0000-000000000009', 'owner', '{}');
insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total)
select ('b19c0000-0000-0000-0000-00000000000' || n)::uuid, 'b19b0000-0000-0000-0000-00000000000b', 'R19 request ' || n, 'awarded', 'invited_only', 100
  from generate_series(1, 7) n;
insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity, submitted_at)
select ('b19c1000-0000-0000-0000-00000000000' || n)::uuid, ('b19c0000-0000-0000-0000-00000000000' || n)::uuid,
       ('b19b0000-0000-0000-0000-0000000000e' || n)::uuid, 'accepted', 100, 1, now() from generate_series(1, 7) n;
insert into public.production_orders
  (id, rfq_id, quote_id, brand_org_id, factory_org_id, unit_price_cents, status, schedule_brand_agreed_at, schedule_brand_agreed_by,
   production_quantity, bulk_subtotal_cents, sample_subtotal_cents, order_total_cents, deposit_pct, balance_pct, order_number)
select ('b19d0000-0000-0000-0000-00000000000' || n)::uuid, ('b19c0000-0000-0000-0000-00000000000' || n)::uuid,
       ('b19c1000-0000-0000-0000-00000000000' || n)::uuid, 'b19b0000-0000-0000-0000-00000000000b',
       ('b19b0000-0000-0000-0000-0000000000e' || n)::uuid, 100000, 'active', now() - interval '60 days',
       'b19a0000-0000-0000-0000-000000000003', 1, 100000, 0, 100000, 50, 50, 'R19-' || n
  from generate_series(1, 7) n;

-- Payments pNK: factory N, step K. Milestones share the id's tail.
create temporary table r19_steps (n int, k int, kind text, title text, amount bigint, charged bigint, state text,
                                  approved boolean, pool boolean) on commit drop;
insert into r19_steps values
  (1, 1, 'payment_only',         'R19 deposit',      50000, 53500, 'confirmed',  true,  false),
  (2, 1, 'payment_only',         'R19 deposit',      50000, 53500, 'confirmed',  true,  false),
  (2, 2, 'approval_and_payment', 'R19 fit sample',   30000, 32100, 'confirmed',  true,  false),
  (3, 1, 'payment_only',         'R19 pool deposit', 50000, 53500, 'confirmed',  true,  true),
  (4, 1, 'payment_only',         'R19 pool deposit', 30000, 32100, 'confirmed',  true,  true),
  (5, 1, 'payment_only',         'R19 pool deposit', 30000, 32100, 'confirmed',  true,  true),
  (5, 2, 'payment_only',         'R19 deposit',      50000, 53500, 'confirmed',  true,  false),
  (6, 1, 'approval_and_payment', 'R19 trims',        10000, null,  'processing', false, false),
  (6, 2, 'approval_and_payment', 'R19 fit sample',   10000, 10700, 'confirmed',  false, false),
  (6, 3, 'approval_and_payment', 'R19 lab dip',      10000, null,  'processing', false, false),
  (7, 1, 'payment_only',         'R19 deposit',      50000, 53500, 'released',   true,  false);
insert into public.order_milestones (id, order_id, kind, title, amount_cents, state, sort, completed_at)
select ('b19e00' || n || k || '-0000-0000-0000-000000000000')::uuid, ('b19d0000-0000-0000-0000-00000000000' || n)::uuid,
       kind::public.milestone_type, title, amount, (case when approved then 'complete' else 'active' end)::public.milestone_state, k * 10,
       case when approved then now() - interval '9 days' end
  from r19_steps;
insert into public.order_payments
  (id, order_id, milestone_id, amount_cents, charged_cents, amount_received_cents, currency, state, confirmed_at, release_requested_at,
   withdrawal_pool, stripe_payment_intent_id, stripe_charge_id, funds_available_at, released_at, released_note, processing_at)
select ('b19f00' || n || k || '-0000-0000-0000-000000000000')::uuid, ('b19d0000-0000-0000-0000-00000000000' || n)::uuid,
       ('b19e00' || n || k || '-0000-0000-0000-000000000000')::uuid, amount, charged, charged, 'USD', state::public.payment_state,
       case when state <> 'processing' then now() - interval '20 days' end,
       case when approved then now() - interval '9 days' end,
       pool, 'pi_pgtap_r19_' || n || k, case when charged is not null then 'ch_pgtap_r19_' || n || k end,
       case when charged is not null then now() - interval '15 days' end,
       case when state = 'released' then now() - interval '8 days' end,
       case when state = 'released' then 'Paid by PayPal' end,
       case when state = 'processing' then now() - interval '1 hour' end
  from r19_steps;
-- Factory 7's deposit was paid out the old way, by a per-step PayPal payout.
insert into public.factory_payout_accounts (id, org_id, method, paypal_email, is_primary, details_changed_at)
select ('b1990000-0000-0000-0000-00000000000' || n)::uuid, ('b19b0000-0000-0000-0000-0000000000e' || n)::uuid, 'paypal',
       'pgtap-r19-f' || n || '@example.com', true, '2026-11-01'
  from generate_series(1, 7) n where n <> 3;
-- Factory 3 is paid by bank transfer (no provider reaches it).
insert into public.factory_payout_accounts
  (id, org_id, method, bank_name, account_name, account_number_last4, swift, bank_country, is_primary, details_changed_at, payee_changed_at)
values ('b1990000-0000-0000-0000-000000000003', 'b19b0000-0000-0000-0000-0000000000e3', 'bank', 'R19 Bank', 'R19 MILL LTD', '4417',
        'BOSHCNSH', 'CN', true, '2026-11-01', '2026-11-01');
insert into public.provider_payouts (id, payment_id, factory_org_id, account_id, provider, status, paid_to, amount_cents, currency, paid_at, created_at)
values ('b19a1000-0000-0000-0000-000000000071', 'b19f0071-0000-0000-0000-000000000000', 'b19b0000-0000-0000-0000-0000000000e7',
        'b1990000-0000-0000-0000-000000000007', 'paypal', 'paid', 'pgtap-r19-f7@example.com', 50000, 'USD', now() - interval '8 days', now() - interval '8 days');
insert into public.factory_payout_preferences (org_id, route)
select ('b19b0000-0000-0000-0000-0000000000e' || n)::uuid, 'manual' from generate_series(1, 7) n;
-- A Stripe withdrawal of factory 2's, claimed by the server, owed money not decided yet.
insert into public.stripe_connect_accounts (org_id, stripe_account_id, country, transfers_active, payouts_enabled, details_submitted)
values ('b19b0000-0000-0000-0000-0000000000e2', 'acct_pgtap_r19_2', 'US', true, true, true);
insert into public.stripe_withdrawals (id, org_id, stripe_account_id, request_key, request_id, amount_minor, currency, usd_cents, state)
values ('b1980000-0000-0000-0000-000000000002', 'b19b0000-0000-0000-0000-0000000000e2', 'acct_pgtap_r19_2', 'pgtap-r19-sw-2',
        gen_random_uuid(), 10000, 'USD', 10000, 'claimed');
set local session_replication_role = origin;

create function pg_temp.act_as(who text) returns void language sql as $f$
  select set_config('request.jwt.claims',
    json_build_object('sub', 'b19a0000-0000-0000-0000-' || lpad(who, 12, '0'), 'role', 'authenticated')::text, true);
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
  select ('b19b0000-0000-0000-0000-0000000000e' || n)::uuid;
$f$;
create function pg_temp.owner(n int) returns text language sql immutable as $f$
  select case n when 1 then '01' when 2 then '04' when 3 then '05' when 4 then '06' when 5 then '07' when 6 then '08' else '09' end;
$f$;
create function pg_temp.pay(nk int) returns uuid language sql immutable as $f$
  select ('b19f00' || nk || '-0000-0000-0000-000000000000')::uuid;
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
  perform pg_temp.as_server(format('select public.record_payment_refund_amount(%L, %L, %s)', pg_temp.pay(nk), 'pi_pgtap_r19_' || nk, total));
end;
$f$;
create function pg_temp.refund_failed(nk int, total bigint) returns void language plpgsql as $f$
begin
  perform pg_temp.as_server(format('select public.record_payment_refund_failed(%L, %L, %s)', pg_temp.pay(nk), 'pi_pgtap_r19_' || nk, total));
end;
$f$;
create function pg_temp.lost(nk int, amount bigint) returns void language plpgsql as $f$
begin
  perform pg_temp.as_server(format('select public.record_payment_dispute_lost(%L, %L, %s, 1500)', pg_temp.pay(nk), 'du_pgtap_r19_' || nk, amount));
end;
$f$;
create function pg_temp.req(n int, amount bigint) returns uuid language plpgsql as $f$
declare w uuid;
begin
  perform pg_temp.act_as(pg_temp.owner(n));
  set local role authenticated;
  w := (public.request_withdrawal(pg_temp.org(n), amount, ('b1990000-0000-0000-0000-00000000000' || n)::uuid)).id;
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
  perform pg_temp.as_server(format('select public.record_withdrawal(%L, ''paid'', ''PP-R19'', 0, %s, ''USD'', null)', w,
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
-- Staff decide the factory's open payment review: Pay factory (nothing taken).
create function pg_temp.pay_factory(n int) returns text language plpgsql as $f$
declare v uuid; d text;
begin
  select id into v from public.payment_reviews where factory_org_id = pg_temp.org(n) and decided_at is null;
  perform pg_temp.act_as('02');
  set local role authenticated;
  d := (public.decide_payment_review(v, 'pay_factory')).decision;
  reset role;
  return d;
end;
$f$;
create function pg_temp.told(org uuid, subject uuid) returns text language sql as $f$
  select string_agg(title || ' | ' || body, ' || ' order by created_at, title) from public.notifications where org_id = org and subject_id = subject;
$f$;

-- ===========================================================================
-- H1. An older copy of the charge never lowers the refund.
-- ===========================================================================
select lives_ok($$select pg_temp.refund(11, 8000)$$, 'Stripe says $80 refunded in all (the newer event)');
select lives_ok($$select pg_temp.refund(11, 5000)$$, 'then an older copy says $50');
select is((pg_temp.p(11)).refunded_cents, 8000::bigint, 'the refund stays $80: a smaller total never lowers it');
select is((select count(*)::int from public.payment_events where payment_id = pg_temp.pay(11) and note like 'A refund failed%'), 0,
  'and no refund is said to have failed');
select lives_ok($$select pg_temp.refund_failed(11, 5000)$$, 'Stripe says the $30 refund failed (read again): $50 in all');
select is((pg_temp.p(11)).refunded_cents, 5000::bigint, 'only then is it lowered');
select lives_ok($$select pg_temp.refund_failed(11, 8000)$$, 'a failure never raises it');
select is((pg_temp.p(11)).refunded_cents, 5000::bigint, 'still $50');
select is((select count(*)::int from public.payment_events where payment_id = pg_temp.pay(11) and note like 'A refund failed in Stripe: $50.00 refunded in all.%'), 1,
  'staff read the failed refund once');

-- ===========================================================================
-- M2 / M3. A debt nothing else covers: Stripe claims refused in the
-- database; the waiting withdrawal told what is owed.
-- ===========================================================================
select lives_ok($$select pg_temp.pay_out(pg_temp.req(2, 50000))$$, 'F2 withdrew its $500 deposit by PayPal, paid');
select set_config('tsc.r19_w2', pg_temp.req(2, 10000)::text, true);
select lives_ok($$select pg_temp.refund(21, 53500)$$, 'the deposit''s charge is refunded in full after it was withdrawn');
-- Paused payments: the refund after it withdrew opens a payment review; its
-- earning is unchanged and nothing is owed.
select is(row((pg_temp.bal(2) ->> 'owed_to_tsc_cents')::bigint, (pg_temp.bal(2) ->> 'available_cents')::bigint,
              public.factory_paused(pg_temp.org(2))),
          row(0::bigint, 20000::bigint, true),
  'F2 owes TSC nothing and keeps its $200 more earned: its withdrawals are paused for a review');
select is(row((select string_agg(title || ' | ' || body, ' || ') from public.notifications where org_id = pg_temp.org(2)
                 and subject_id = current_setting('tsc.r19_w2')::uuid and title like '% on hold'),
              (select public.withdrawal_blocker(w) from public.factory_withdrawals w where w.id = current_setting('tsc.r19_w2')::uuid)),
          row(null::text, 'payment_under_review'::text),
  'the waiting $100 withdrawal is paused by the review: no "you owe TSC" notice');
select is(row((pg_temp.staff_row(current_setting('tsc.r19_w2')::uuid) ->> 'owes_tsc_cents')::bigint,
              pg_temp.staff_row(current_setting('tsc.r19_w2')::uuid) ->> 'covered'),
          row(0::bigint, 'false'::text),
  'staff read no debt, and the withdrawal is not paid while the review is open');
select throws_ok($$select pg_temp.as_server(format('select public.claim_owed_steps(%L, 10000, ''stripe'', %L)', pg_temp.org(2),
  'b1980000-0000-0000-0000-000000000002'))$$, '22023', 'Withdrawals are paused while a payment is reviewed.',
  'a Stripe withdrawal of its other earnings is refused by the database while paused');
select is((select count(*)::int from public.payment_takes where stripe_withdrawal_id = 'b1980000-0000-0000-0000-000000000002'), 0, 'nothing was taken');
select is((select owed_cents from public.stripe_withdrawals where id = 'b1980000-0000-0000-0000-000000000002'), null::bigint, 'and nothing claimed');

-- ===========================================================================
-- L1. A bank transfer is recorded once the factory is no longer paused.
-- ===========================================================================
-- A bank withdrawal of the old pool, asked before bank requests stopped.
insert into public.factory_withdrawals (org_id, account_id, provider, amount_cents, pool_cents, currency, paid_to, paid_to_changed_at)
values (pg_temp.org(3), 'b1990000-0000-0000-0000-000000000003', 'bank', 50000, 50000, 'USD', 'R19 Bank ending 4417', '2026-11-01');
select set_config('tsc.r19_w3', (select id::text from public.factory_withdrawals where org_id = pg_temp.org(3)), true);
-- The old pool, turned into takes as the migration does (20261121350000):
-- this waiting withdrawal holds the deposit.
select is(public.convert_withdrawal_pool(), 3, 'the old-pool deposits are converted');
select lives_ok($$select pg_temp.refund(31, 53500)$$, 'the pool deposit is refunded in full while staff send the wire');
select is(row((pg_temp.bal(3) ->> 'owed_to_tsc_cents')::bigint, public.factory_paused(pg_temp.org(3))), row(0::bigint, true),
  'the refunded $500 is not owed to TSC: a payment review is open instead');
select is(pg_temp.recover(3), '[]'::jsonb, 'nothing on To recover');
-- Paused: no road pays the factory, a bank record included (20261124100100).
select pg_temp.act_as('02'); set local role authenticated;
select throws_ok($$select public.mark_withdrawal_paid_by_bank(current_setting('tsc.r19_w3')::uuid, 'WIRE-R19')$$,
  '22023', 'This factory''s withdrawals are paused while a payment is reviewed.',
  'staff can''t record the wire while the factory is paused');
reset role;
select is(pg_temp.pay_factory(3), 'pay_factory', 'staff decide: Pay factory');
select pg_temp.act_as('02'); set local role authenticated;
select lives_ok($$select public.mark_withdrawal_paid_by_bank(current_setting('tsc.r19_w3')::uuid, 'WIRE-R19')$$,
  'then the wire is recorded');
reset role;
select is((select status from public.factory_withdrawals where id = current_setting('tsc.r19_w3')::uuid), 'paid', 'recorded as paid');
select is((select count(*)::int from pg_proc where proname = 'guard_withdrawal_takes'
            and prosrc like '%tsc.bank_sent%'), 1, 'the guard steps aside only for that record');
select is(current_setting('tsc.bank_sent', true), 'off', 'and only inside it');

-- ===========================================================================
-- L2. Each withdrawal's own part decides (the old pool's rule, now its takes').
-- ===========================================================================
select set_config('tsc.r19_p1', pg_temp.req(4, 10000)::text, true);
set local session_replication_role = replica;
update public.factory_withdrawals set created_at = now() - interval '1 hour' where id = current_setting('tsc.r19_p1')::uuid;
-- and its part of the deposit with it (in one transaction both are "now").
update public.payment_takes set created_at = now() - interval '1 hour' where factory_withdrawal_id = current_setting('tsc.r19_p1')::uuid;
set local session_replication_role = origin;
select set_config('tsc.r19_p2', pg_temp.req(4, 15000)::text, true);
select lives_ok($$select pg_temp.refund(41, 10700)$$, '$107 of the pool deposit is refunded after approval: a payment review opens');
-- Paused payments: the refund takes nothing from either request; both wait
-- for the review, then both are covered.
select is(row(pg_temp.staff_row(current_setting('tsc.r19_p1')::uuid) ->> 'covered',
              pg_temp.staff_row(current_setting('tsc.r19_p2')::uuid) ->> 'covered'),
          row('false'::text, 'false'::text), 'while the review is open, neither request is paid');
select is(pg_temp.pay_factory(4), 'pay_factory', 'staff decide: Pay factory');
select is(row(pg_temp.staff_row(current_setting('tsc.r19_p1')::uuid) ->> 'covered',
              pg_temp.staff_row(current_setting('tsc.r19_p2')::uuid) ->> 'covered'),
          row('true'::text, 'true'::text), 'then both are covered: the refund took nothing from the pool deposit');
select lives_ok($$select pg_temp.pay_out(current_setting('tsc.r19_p1')::uuid)$$, 'staff pay the older one');

select lives_ok($$select pg_temp.pay_out(pg_temp.req(5, 30000))$$, 'F5 withdrew its $300 old-pool money, paid');
select lives_ok($$select pg_temp.refund(51, 10700)$$, '$107 of it is refunded after: the pool is $100 short of what it paid');
select is(row((pg_temp.bal(5) ->> 'owed_to_tsc_cents')::bigint, public.factory_paused(pg_temp.org(5))), row(0::bigint, true),
  'F5 owes TSC nothing: a payment review pauses it instead');
select throws_ok($$select pg_temp.req(5, 20000)$$, '22023', 'Withdrawals are paused while a payment is reviewed.',
  'a later withdrawal waits for the review');
select is(pg_temp.pay_factory(5), 'pay_factory', 'staff decide: Pay factory');
select set_config('tsc.r19_w5', pg_temp.req(5, 20000)::text, true);
select is(pg_temp.staff_row(current_setting('tsc.r19_w5')::uuid) ->> 'covered', 'true', 'a later $200 withdrawal is covered');
select lives_ok($$select pg_temp.pay_out(current_setting('tsc.r19_w5')::uuid)$$, 'and paid: the pool''s debt does not block it forever');

-- ===========================================================================
-- L3 / L4 / L5. Disputes and refunds around funding.
-- ===========================================================================
select lives_ok($$select pg_temp.lost(61, 10700)$$, 'a dispute is lost while the payment is still processing');
select is((pg_temp.p(61)).state::text, 'processing', 'only noted for staff');
set local session_replication_role = replica;
update public.order_payments set state = 'confirmed', confirmed_at = now(), charged_cents = 10700, amount_received_cents = 10700,
       stripe_charge_id = 'ch_pgtap_r19_61' where id = pg_temp.pay(61);
set local session_replication_role = origin;
select lives_ok($$select pg_temp.lost(61, 10700)$$, 'the payment is funded, and the loss read again');
select is((pg_temp.p(61)).state::text, 'failed', 'recorded now: the brand pays again');
select is((pg_temp.p(61)).failure_reason, 'Your bank reversed this payment.', 'in the bank''s words');

select lives_ok($$select pg_temp.lost(62, 5000)$$, '$50 of a $107 charge is lost before approval');
select is((pg_temp.p(62)).state::text, 'confirmed', 'the step stays funded with the rest');
select is((pg_temp.p(62)).dispute_lost_cents, 5000::bigint, 'the loss is recorded');
select ok((pg_temp.p(62)).factory_refund_cents between 4600 and 4700, 'the factory''s part goes down in proportion');
select is(pg_temp.told('b19b0000-0000-0000-0000-00000000000b', pg_temp.pay(62)),
  'Your bank reversed your payment for "R19 fit sample" | $50.00 went back to your card.', 'the brand is told what went back, not to pay again');

select lives_ok($$select pg_temp.refund(63, 10000)$$, 'a $100 refund before the $107 charge is recorded as funded');
select is(row((pg_temp.p(63)).state::text, (pg_temp.p(63)).refunded_cents), row('processing'::text, 0::bigint),
  'nothing is recorded yet, and it is not taken as a full refund');
set local session_replication_role = replica;
update public.order_payments set state = 'confirmed', confirmed_at = now(), charged_cents = 10700, amount_received_cents = 10700,
       stripe_charge_id = 'ch_pgtap_r19_63' where id = pg_temp.pay(63);
set local session_replication_role = origin;
select lives_ok($$select pg_temp.refund(63, 10000)$$, 'recorded once the payment is funded');
select is(row((pg_temp.p(63)).state::text, (pg_temp.p(63)).refunded_cents), row('confirmed'::text, 10000::bigint), 'at its amount, still funded');
select is(pg_temp.told('b19b0000-0000-0000-0000-00000000000b', pg_temp.pay(63)),
  'Your payment for "R19 lab dip" was refunded | $100.00 was refunded to your card.', 'and the brand is told');

-- ===========================================================================
-- L6. Where an old per-step payout went.
-- ===========================================================================
select lives_ok($$select pg_temp.refund(71, 53500)$$, 'a deposit paid out the old way by PayPal is refunded');
-- Paused payments: nothing to recover; the factory is paused for a review.
select is(row(pg_temp.recover(7), public.factory_paused(pg_temp.org(7))), row('[]'::jsonb, true),
  'nothing on To recover: a payment review is open instead');

-- ===========================================================================
-- Grants and shape.
-- ===========================================================================
select ok(not has_function_privilege('authenticated', 'public.record_payment_refund_failed(uuid, text, bigint)', 'execute')
      and not has_function_privilege('anon', 'public.record_payment_refund_failed(uuid, text, bigint)', 'execute')
      and has_function_privilege('service_role', 'public.record_payment_refund_failed(uuid, text, bigint)', 'execute'),
  'record_payment_refund_failed is the server''s');
select ok(not has_function_privilege('authenticated', 'public.claim_owed_steps(uuid, bigint, text, uuid)', 'execute'), 'claim_owed_steps stays the server''s');
select ok(has_function_privilege('authenticated', 'public.mark_withdrawal_paid_by_bank(uuid, text)', 'execute')
      and not has_function_privilege('anon', 'public.mark_withdrawal_paid_by_bank(uuid, text)', 'execute'), 'mark_withdrawal_paid_by_bank grants as before');
select is((select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and proname = f), 1, f || ': one function, no overloads')
  from unnest(array['record_payment_refund_amount', 'record_payment_refund_failed', 'record_payment_dispute_lost', 'claim_owed_steps',
                    'tell_withdrawal_refunded', 'guard_withdrawal_takes', 'claim_withdrawal', 'withdrawal_covered', 'admin_withdrawals',
                    'mark_withdrawal_paid_by_bank', 'admin_balance_attention']) f;

select * from finish();
rollback;
