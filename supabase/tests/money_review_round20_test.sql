-- One balance, fix round 20 (20261121240000): the money re-review.
--
-- N1 (e1, p12): part of a charge lost before approval, then the rest
--     refunded: all of it went back, so the brand pays again, and the old
--     charge's loss is cleared with it.
-- N2/N3 (e1, p11): the factory's refund notice says what the brand got back;
--     a refund lowered because it failed tells the brand and the factory.
-- N4 (e2): a withdrawal on hold for a debt names the debt's cause, not the
--     event's.
-- Pre-existing (e3, p31 p32): a full refund before approval that fails later:
--     funded again if the brand has not paid again; else staff refund the old
--     charge (Needs checking).
--
-- Fixtures: slugs pgtap-r20-*, ids b20?xxxx-...; every count is scoped to them.
begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

update public.payout_provider_settings set enabled = case
    when provider = 'paypal' and region in ('china', 'elsewhere') then true else false end;

set local session_replication_role = replica;

insert into auth.users (id, email)
select ('b20a0000-0000-0000-0000-0000000000' || k)::uuid, 'pgtap-r20-' || k || '@example.com'
  from unnest(array['01','02','03','04','05','06','07','08','09']) k;
-- 02 is staff; 03 owns the brand; 0n+? owners: e1 01, e2 04, e3 05, e4 06, e5 07, e6 08, e7 09.
insert into public.platform_admins (user_id, note) values ('b20a0000-0000-0000-0000-000000000002', 'pgtap-r20');
insert into public.orgs (id, type, name, slug) values
  ('b20b0000-0000-0000-0000-00000000000b', 'brand', 'R20 Brand', 'pgtap-r20-brand');
insert into public.orgs (id, type, name, slug)
select ('b20b0000-0000-0000-0000-0000000000e' || n)::uuid, 'factory', 'R20 Factory ' || n, 'pgtap-r20-f' || n from generate_series(1, 7) n;
insert into public.org_members (org_id, user_id, role, permissions) values
  ('b20b0000-0000-0000-0000-00000000000b', 'b20a0000-0000-0000-0000-000000000003', 'owner', '{}'),
  ('b20b0000-0000-0000-0000-0000000000e1', 'b20a0000-0000-0000-0000-000000000001', 'owner', '{}'),
  ('b20b0000-0000-0000-0000-0000000000e2', 'b20a0000-0000-0000-0000-000000000004', 'owner', '{}'),
  ('b20b0000-0000-0000-0000-0000000000e3', 'b20a0000-0000-0000-0000-000000000005', 'owner', '{}'),
  ('b20b0000-0000-0000-0000-0000000000e4', 'b20a0000-0000-0000-0000-000000000006', 'owner', '{}'),
  ('b20b0000-0000-0000-0000-0000000000e5', 'b20a0000-0000-0000-0000-000000000007', 'owner', '{}'),
  ('b20b0000-0000-0000-0000-0000000000e6', 'b20a0000-0000-0000-0000-000000000008', 'owner', '{}'),
  ('b20b0000-0000-0000-0000-0000000000e7', 'b20a0000-0000-0000-0000-000000000009', 'owner', '{}');
insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total)
select ('b20c0000-0000-0000-0000-00000000000' || n)::uuid, 'b20b0000-0000-0000-0000-00000000000b', 'R20 request ' || n, 'awarded', 'invited_only', 100
  from generate_series(1, 7) n;
insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity, submitted_at)
select ('b20c1000-0000-0000-0000-00000000000' || n)::uuid, ('b20c0000-0000-0000-0000-00000000000' || n)::uuid,
       ('b20b0000-0000-0000-0000-0000000000e' || n)::uuid, 'accepted', 100, 1, now() from generate_series(1, 7) n;
insert into public.production_orders
  (id, rfq_id, quote_id, brand_org_id, factory_org_id, unit_price_cents, status, schedule_brand_agreed_at, schedule_brand_agreed_by,
   production_quantity, bulk_subtotal_cents, sample_subtotal_cents, order_total_cents, deposit_pct, balance_pct, order_number)
select ('b20d0000-0000-0000-0000-00000000000' || n)::uuid, ('b20c0000-0000-0000-0000-00000000000' || n)::uuid,
       ('b20c1000-0000-0000-0000-00000000000' || n)::uuid, 'b20b0000-0000-0000-0000-00000000000b',
       ('b20b0000-0000-0000-0000-0000000000e' || n)::uuid, 100000, 'active', now() - interval '60 days',
       'b20a0000-0000-0000-0000-000000000003', 1, 100000, 0, 100000, 50, 50, 'R20-' || n
  from generate_series(1, 7) n;

-- Payments pNK: factory N, step K. Milestones share the id's tail.
create temporary table r20_steps (n int, k int, kind text, title text, amount bigint, charged bigint, state text,
                                  approved boolean, pool boolean) on commit drop;
insert into r20_steps values
  (1, 1, 'payment_only',         'R20 deposit',      50000, 53500, 'confirmed',  true,  false),
  (1, 2, 'approval_and_payment', 'R20 fit sample',   10000, 10700, 'confirmed',  false, false),
  (2, 1, 'payment_only',         'R20 deposit',      50000, 53500, 'confirmed',  true,  false),
  (2, 2, 'approval_and_payment', 'R20 fit sample',   30000, 32100, 'confirmed',  true,  false),
  (2, 3, 'approval_and_payment', 'R20 lab dip',      30000, 32100, 'confirmed',  true,  false),
  (3, 1, 'approval_and_payment', 'R20 trims',        10000, 10700, 'confirmed',  false, false),
  (3, 2, 'approval_and_payment', 'R20 labels',       10000, 10700, 'confirmed',  false, false);
insert into public.order_milestones (id, order_id, kind, title, amount_cents, state, sort, completed_at)
select ('b20e00' || n || k || '-0000-0000-0000-000000000000')::uuid, ('b20d0000-0000-0000-0000-00000000000' || n)::uuid,
       kind::public.milestone_type, title, amount, (case when approved then 'complete' else 'active' end)::public.milestone_state, k * 10,
       case when approved then now() - interval '9 days' end
  from r20_steps;
insert into public.order_payments
  (id, order_id, milestone_id, amount_cents, charged_cents, amount_received_cents, currency, state, confirmed_at, release_requested_at,
   withdrawal_pool, stripe_payment_intent_id, stripe_charge_id, funds_available_at, released_at, released_note, processing_at)
select ('b20f00' || n || k || '-0000-0000-0000-000000000000')::uuid, ('b20d0000-0000-0000-0000-00000000000' || n)::uuid,
       ('b20e00' || n || k || '-0000-0000-0000-000000000000')::uuid, amount, charged, charged, 'USD', state::public.payment_state,
       case when state <> 'processing' then now() - interval '20 days' end,
       case when approved then now() - interval '9 days' end,
       pool, 'pi_pgtap_r20_' || n || k, case when charged is not null then 'ch_pgtap_r20_' || n || k end,
       case when charged is not null then now() - interval '15 days' end,
       case when state = 'released' then now() - interval '8 days' end,
       case when state = 'released' then 'Paid by PayPal' end,
       case when state = 'processing' then now() - interval '1 hour' end
  from r20_steps;
insert into public.factory_payout_accounts (id, org_id, method, paypal_email, is_primary, details_changed_at)
select ('b2090000-0000-0000-0000-00000000000' || n)::uuid, ('b20b0000-0000-0000-0000-0000000000e' || n)::uuid, 'paypal',
       'pgtap-r20-f' || n || '@example.com', true, '2026-11-01'
  from generate_series(1, 7) n;
insert into public.factory_payout_preferences (org_id, route)
select ('b20b0000-0000-0000-0000-0000000000e' || n)::uuid, 'manual' from generate_series(1, 7) n;
set local session_replication_role = origin;

create function pg_temp.act_as(who text) returns void language sql as $f$
  select set_config('request.jwt.claims',
    json_build_object('sub', 'b20a0000-0000-0000-0000-' || lpad(who, 12, '0'), 'role', 'authenticated')::text, true);
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
  select ('b20b0000-0000-0000-0000-0000000000e' || n)::uuid;
$f$;
create function pg_temp.owner(n int) returns text language sql immutable as $f$
  select case n when 1 then '01' when 2 then '04' when 3 then '05' when 4 then '06' when 5 then '07' when 6 then '08' else '09' end;
$f$;
create function pg_temp.pay(nk int) returns uuid language sql immutable as $f$
  select ('b20f00' || nk || '-0000-0000-0000-000000000000')::uuid;
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
  perform pg_temp.as_server(format('select public.record_payment_refund_amount(%L, %L, %s)', pg_temp.pay(nk), 'pi_pgtap_r20_' || nk, total));
end;
$f$;
create function pg_temp.refund_failed(nk int, total bigint) returns void language plpgsql as $f$
begin
  perform pg_temp.as_server(format('select public.record_payment_refund_failed(%L, %L, %s)', pg_temp.pay(nk), 'pi_pgtap_r20_' || nk, total));
end;
$f$;
create function pg_temp.lost(nk int, amount bigint) returns void language plpgsql as $f$
begin
  perform pg_temp.as_server(format('select public.record_payment_dispute_lost(%L, %L, %s, 1500)', pg_temp.pay(nk), 'du_pgtap_r20_' || nk, amount));
end;
$f$;
create function pg_temp.req(n int, amount bigint) returns uuid language plpgsql as $f$
declare w uuid;
begin
  perform pg_temp.act_as(pg_temp.owner(n));
  set local role authenticated;
  w := (public.request_withdrawal(pg_temp.org(n), amount, ('b2090000-0000-0000-0000-00000000000' || n)::uuid)).id;
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
  perform pg_temp.as_server(format('select public.record_withdrawal(%L, ''paid'', ''PP-R20'', 0, %s, ''USD'', null)', w,
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

-- ===========================================================================
-- N3 / N2. What the brand got back; a refund that failed is said.
-- ===========================================================================
select lives_ok($$select pg_temp.refund(11, 5000)$$, '$50 of the $535 deposit charge is refunded after it was funded');
select is((select body from public.notifications where org_id = pg_temp.org(1) and subject_id = pg_temp.pay(11) and title = 'Payment for "R20 deposit" refunded'),
  'The brand was refunded $50.00. Your earnings from R20 request 1 (R20-1) went down by $46.73.', 'the factory reads what the brand got, then its own part');
select lives_ok($$select pg_temp.refund_failed(11, 2000)$$, 'Stripe says $30 of it failed: $20 in all');
select is((select title || ' | ' || body from public.notifications where org_id = 'b20b0000-0000-0000-0000-00000000000b' and subject_id = pg_temp.pay(11)
            and title like 'Refund for%'), 'Refund for "R20 deposit" didn''t go through | The $30.00 refund to your card failed, so the payment stays on this order.', 'the brand is told');
select is((select title || ' | ' || body from public.notifications where org_id = pg_temp.org(1) and subject_id = pg_temp.pay(11)
            and title like 'Refund for%'), 'Refund for "R20 deposit" didn''t go through | The refund to the brand failed. Your earnings from R20 request 1 (R20-1) went back up by $28.04.',
  'and the factory, whose earnings went back up');

-- ===========================================================================
-- N1. Part lost, the rest refunded, before approval: all of it went back.
-- ===========================================================================
select lives_ok($$select pg_temp.lost(12, 5000)$$, '$50 of the $107 fit sample charge is lost in a dispute before approval');
select is((pg_temp.p(12)).state::text, 'confirmed', 'the step stays funded with the rest');
select lives_ok($$select pg_temp.refund(12, 5700)$$, 'staff refund the other $57');
select is((pg_temp.p(12)).state::text, 'failed', 'everything went back: the brand pays again');
select is(row((pg_temp.p(12)).dispute_lost_cents, (pg_temp.p(12)).dispute_lost_at, (pg_temp.p(12)).dispute_fee_cents, (pg_temp.p(12)).refunded_cents, (pg_temp.p(12)).factory_refund_cents),
  row(0::bigint, null::timestamptz, null::bigint, 0::bigint, 0::bigint), 'and the old charge''s loss is cleared with its refund');
select ok(exists (select 1 from public.notifications where org_id = 'b20b0000-0000-0000-0000-00000000000b' and subject_id = pg_temp.pay(12)
                    and body like '%Pay again from the step''s payment page%'), 'the brand is asked to pay again');

-- ===========================================================================
-- N4. The debt's own cause.
-- ===========================================================================
select lives_ok($$select pg_temp.pay_out(pg_temp.req(2, 50000))$$, 'F2 withdrew its $500 deposit, paid');
select set_config('tsc.r20_w2', pg_temp.req(2, 10000)::text, true);
select lives_ok($$select pg_temp.refund(21, 42800)$$, '$428 of the deposit is refunded after it was withdrawn: F2 owes $400, covered by its other earnings');
select is((select count(*)::int from public.notifications where subject_id = current_setting('tsc.r20_w2')::uuid and title like '% on hold'), 0, 'not on hold yet');
select lives_ok($$select pg_temp.lost(23, 32100)$$, 'then the lab dip (never withdrawn) is lost in a dispute after approval');
select is((select body from public.notifications where subject_id = current_setting('tsc.r20_w2')::uuid and title like '% on hold'),
  'You owe TSC $400.00. A payment was refunded after you withdrew it.', 'the waiting withdrawal is told the debt''s cause: a refund, not the dispute');

-- ===========================================================================
-- Pre-existing: a full refund before approval that fails later.
-- ===========================================================================
select lives_ok($$select pg_temp.refund(31, 10700)$$, 'the trims charge is refunded in full before approval');
select is((pg_temp.p(31)).state::text, 'failed', 'the brand is sent back to pay');
select lives_ok($$select pg_temp.as_server('select public.record_full_refund_failed(''b20f0031-0000-0000-0000-000000000000'', ''pi_pgtap_r20_31'', ''ch_pgtap_r20_31'', 10700, 0, 10700, 0, null)')$$,
  'Stripe says that refund failed, before the brand paid again');
select is(row((pg_temp.p(31)).state::text, (pg_temp.p(31)).stripe_payment_intent_id, (pg_temp.p(31)).charged_cents),
  row('confirmed'::text, 'pi_pgtap_r20_31'::text, 10700::bigint), 'funded again with the charge TSC still holds');
select is((select title || ' | ' || body from public.notifications where org_id = 'b20b0000-0000-0000-0000-00000000000b' and subject_id = pg_temp.pay(31)
            and title like 'Refund for%'), 'Refund for "R20 trims" didn''t go through | The $107.00 refund to your card failed, so TSC still holds your payment for this step. You don''t need to pay again.',
  'the brand is told not to pay again');
select ok(exists (select 1 from public.notifications where org_id = pg_temp.org(3) and subject_id = pg_temp.pay(31) and title = 'Payment held for "R20 trims"'),
  'and the factory that the money is held again');
select lives_ok($$select pg_temp.as_server('select public.record_full_refund_failed(''b20f0031-0000-0000-0000-000000000000'', ''pi_pgtap_r20_31'', ''ch_pgtap_r20_31'', 10700, 0, 10700, 0, null)')$$, 'told again');
select is((select count(*)::int from public.notifications where subject_id = pg_temp.pay(31) and title like 'Refund for%'), 1, 'nothing changes the second time');

select lives_ok($$select pg_temp.refund(32, 10700)$$, 'the labels charge is refunded in full before approval');
-- The brand pays again (a new charge).
set local session_replication_role = replica;
update public.order_payments set state = 'confirmed', confirmed_at = now(), stripe_payment_intent_id = 'pi_pgtap_r20_32b', stripe_charge_id = 'ch_pgtap_r20_32b',
       charged_cents = 10700, amount_received_cents = 10700, refunded_at = null where id = pg_temp.pay(32);
set local session_replication_role = origin;
select lives_ok($$select pg_temp.as_server('select public.record_full_refund_failed(''b20f0032-0000-0000-0000-000000000000'', ''pi_pgtap_r20_32'', ''ch_pgtap_r20_32'', 10700, 0, 10700, 0, null)')$$,
  'then Stripe says the first refund failed');
select is((pg_temp.p(32)).stripe_payment_intent_id, 'pi_pgtap_r20_32b', 'the new payment stays as it is');
create function pg_temp.refund_failed_rows() returns jsonb language plpgsql as $f$
declare j jsonb;
begin
  perform pg_temp.act_as('02');
  set local role authenticated;
  select coalesce(jsonb_agg(x), '[]'::jsonb) into j from jsonb_array_elements(public.admin_balance_attention() -> 'refund_failed') x
   where x ->> 'payment_id' = pg_temp.pay(32)::text;
  reset role;
  return j;
end;
$f$;
select is((pg_temp.refund_failed_rows() -> 0 ->> 'amount_cents')::bigint, 10700::bigint, 'staff see the old $107 charge to refund, on Needs checking');
select lives_ok($$select pg_temp.as_server('select public.record_refund_failure_resolved(''pi_pgtap_r20_32'')')$$, 'staff refund it in Stripe');
select is(jsonb_array_length(pg_temp.refund_failed_rows()), 0, 'the row goes');

-- ===========================================================================
-- Grants and shape.
-- ===========================================================================
select ok(not has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute')
      and has_function_privilege('service_role', f, 'execute'), f || ' is the server''s')
  from unnest(array['public.record_full_refund_failed(uuid, text, text, bigint, bigint, bigint, bigint, bigint)', 'public.record_refund_failure_resolved(text)']) f;
select ok(not has_table_privilege('authenticated', 'public.payment_refund_failures', 'select')
      and not has_table_privilege('anon', 'public.payment_refund_failures', 'select'), 'payment_refund_failures is staff''s, through the board only');
select is((select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and proname = f), 1, f || ': one function, no overloads')
  from unnest(array['record_payment_refund_amount', 'record_payment_refunded', 'record_payment_refund_failed', 'tell_withdrawal_refunded',
                    'record_full_refund_failed', 'record_refund_failure_resolved', 'admin_balance_attention', 'admin_overview_metrics']) f;

select * from finish();
rollback;
