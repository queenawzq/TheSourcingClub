-- Paused payments, tester fixes round 2 (20261125100000, section 15).
--   #2b a payment a refund sent back to pay still shows what was charged and refunded
--   #4b a step not approved whose charge the bank is deciding is Disputed, not Awaiting approval
--   #10 closing a failed staff refund tells the brand, with the note
--   (#9b, the disputed card never offered again, is in scripts/check-staff-refunds.mjs)
--
-- Fixtures: slugs pgtap-pr30-*, ids c30?xxxx-...; every count is scoped to them.
--   F1 (owner 01) <- B1 (owner 03), order TSC-930001: P1, P5 held $100 ($107); P2-P4 due. Staff: 02.
begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

set local session_replication_role = replica;

insert into auth.users (id, email)
select ('c30a0000-0000-0000-0000-0000000000' || k)::uuid, 'pgtap-pr30-' || k || '@example.com'
  from unnest(array['01','02','03','04']) k;
insert into public.platform_admins (user_id, note) values ('c30a0000-0000-0000-0000-000000000002', 'pgtap-pr30');
insert into public.orgs (id, type, name, slug) values
  ('c30b0000-0000-0000-0000-0000000000b1', 'brand', 'PR30 Brand One', 'pgtap-pr30-b1'),
  ('c30b0000-0000-0000-0000-0000000000e1', 'factory', 'PR30 Factory One', 'pgtap-pr30-f1'),
  ('c30b0000-0000-0000-0000-0000000000e2', 'factory', 'PR30 Factory Two', 'pgtap-pr30-f2');
insert into public.org_members (org_id, user_id, role, permissions) values
  ('c30b0000-0000-0000-0000-0000000000e1', 'c30a0000-0000-0000-0000-000000000001', 'owner', '{}'),
  ('c30b0000-0000-0000-0000-0000000000b1', 'c30a0000-0000-0000-0000-000000000003', 'owner', '{}'),
  ('c30b0000-0000-0000-0000-0000000000e2', 'c30a0000-0000-0000-0000-000000000004', 'owner', '{}');
insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total) values
  ('c30c0000-0000-0000-0000-000000000001', 'c30b0000-0000-0000-0000-0000000000b1', 'PR30 request', 'awarded', 'invited_only', 100);
insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity, submitted_at) values
  ('c30c1000-0000-0000-0000-000000000001', 'c30c0000-0000-0000-0000-000000000001', 'c30b0000-0000-0000-0000-0000000000e1', 'accepted', 100, 1, now());
insert into public.production_orders
  (id, rfq_id, quote_id, brand_org_id, factory_org_id, unit_price_cents, status, schedule_brand_agreed_at, schedule_brand_agreed_by,
   production_quantity, bulk_subtotal_cents, sample_subtotal_cents, order_total_cents, deposit_pct, balance_pct, order_number) values
  ('c30d0000-0000-0000-0000-000000000001', 'c30c0000-0000-0000-0000-000000000001', 'c30c1000-0000-0000-0000-000000000001',
   'c30b0000-0000-0000-0000-0000000000b1', 'c30b0000-0000-0000-0000-0000000000e1', 100000, 'active', now() - interval '60 days',
   'c30a0000-0000-0000-0000-000000000003', 1, 100000, 0, 100000, 50, 50, 'TSC-930001');
insert into public.order_milestones (id, order_id, kind, title, amount_cents, state, sort) values
  ('c30e0001-0000-0000-0000-000000000001', 'c30d0000-0000-0000-0000-000000000001', 'approval_and_payment', 'PR30 fit sample', 10000, 'active', 10),
  ('c30e0002-0000-0000-0000-000000000001', 'c30d0000-0000-0000-0000-000000000001', 'approval_and_payment', 'PR30 lab dip', 10000, 'active', 11),
  ('c30e0003-0000-0000-0000-000000000001', 'c30d0000-0000-0000-0000-000000000001', 'approval_and_payment', 'PR30 trims', 10000, 'active', 12),
  ('c30e0004-0000-0000-0000-000000000001', 'c30d0000-0000-0000-0000-000000000001', 'approval_and_payment', 'PR30 bulk', 10000, 'active', 13),
  ('c30e0005-0000-0000-0000-000000000001', 'c30d0000-0000-0000-0000-000000000001', 'approval_and_payment', 'PR30 labels', 10000, 'active', 14);
insert into public.order_payments
  (id, order_id, milestone_id, amount_cents, charged_cents, currency, state, confirmed_at, stripe_payment_intent_id, stripe_charge_id, funds_available_at) values
  ('c30f0001-0000-0000-0000-000000000001', 'c30d0000-0000-0000-0000-000000000001', 'c30e0001-0000-0000-0000-000000000001', 10000, 10700, 'USD', 'confirmed',
   now() - interval '5 days', 'pi_pgtap_pr30_1', 'ch_pgtap_pr30_1', now() - interval '2 days'),
  ('c30f0005-0000-0000-0000-000000000001', 'c30d0000-0000-0000-0000-000000000001', 'c30e0005-0000-0000-0000-000000000001', 10000, 10700, 'USD', 'confirmed',
   now() - interval '5 days', 'pi_pgtap_pr30_5', 'ch_pgtap_pr30_5', now() - interval '2 days');
insert into public.order_payments (id, order_id, milestone_id, amount_cents, charged_cents, currency, state, stripe_payment_intent_id) values
  ('c30f0002-0000-0000-0000-000000000001', 'c30d0000-0000-0000-0000-000000000001', 'c30e0002-0000-0000-0000-000000000001', 10000, 10700, 'USD', 'due', 'pi_pgtap_pr30_2'),
  ('c30f0003-0000-0000-0000-000000000001', 'c30d0000-0000-0000-0000-000000000001', 'c30e0003-0000-0000-0000-000000000001', 10000, 10700, 'USD', 'due', 'pi_pgtap_pr30_3'),
  ('c30f0004-0000-0000-0000-000000000001', 'c30d0000-0000-0000-0000-000000000001', 'c30e0004-0000-0000-0000-000000000001', 10000, 10700, 'USD', 'due', 'pi_pgtap_pr30_4');
set local session_replication_role = origin;

create function pg_temp.act_as(who text) returns void language sql as $f$
  select set_config('request.jwt.claims',
    json_build_object('sub', 'c30a0000-0000-0000-0000-' || lpad(who, 12, '0'), 'role', 'authenticated')::text, true);
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
create function pg_temp.pay(n int) returns uuid language sql immutable as $f$
  select ('c30f000' || n || '-0000-0000-0000-000000000001')::uuid;
$f$;
create function pg_temp.staff_json(sql text) returns jsonb language plpgsql as $f$
declare j jsonb;
begin
  perform pg_temp.act_as('02');
  set local role authenticated;
  execute sql into j;
  reset role;
  return j;
end;
$f$;
create function pg_temp.close(r uuid, note text) returns void language plpgsql as $f$
begin
  perform pg_temp.act_as('02');
  set local role authenticated;
  perform public.close_staff_refund_failure(r, note, 0);
  reset role;
end;
$f$;
create function pg_temp.told(org_code text, t text) returns int language sql as $f$
  select count(*)::int from public.notifications
   where org_id = ('c30b0000-0000-0000-0000-0000000000' || org_code)::uuid and title like t
     and order_id = 'c30d0000-0000-0000-0000-000000000001';
$f$;
create function pg_temp.fund(n int) returns void language plpgsql as $f$
begin
  perform pg_temp.as_server(format('select public.record_payment_funded(%L, %L, ''card'', ''Visa'', 10700)', pg_temp.pay(n), 'ch_pgtap_pr30_' || n));
end;
$f$;

-- ===========================================================================

-- ===========================================================================
-- #2b. Refunded in full before approval: Due, and still "Charged $107 · Refunded $107".
-- ===========================================================================
select set_config('tsc.r1', (pg_temp.staff_json($$select public.claim_staff_refund('c30f0001-0000-0000-0000-000000000001', 10700, null, 'Order changed.')$$) ->> 'staff_refund_id'), true);
select lives_ok($$select pg_temp.as_server(format('select public.record_staff_refund(%L, ''re_pgtap_pr30_1'', ''succeeded'')', current_setting('tsc.r1')))$$, 'refunded in full');
select is((select state::text from public.order_payments where id = pg_temp.pay(1)), 'due', 'back to Due');
select is((select concat_ws(' | ', x ->> 'state', x ->> 'charged_cents', x ->> 'refunded_cents')
             from (select pg_temp.staff_json($$select public.staff_refund_preview('c30f0001-0000-0000-0000-000000000001')$$) x) q),
  'due | 10700 | 10700', 'staff still read what was charged and refunded');
select is((select concat_ws(' | ', x ->> 'charged_cents', x ->> 'refunded_cents')
             from jsonb_array_elements(pg_temp.staff_json($$select public.admin_order_payments('TSC-930001')$$) -> 'payments') x
            where x ->> 'payment_id' = 'c30f0001-0000-0000-0000-000000000001'),
  '10700 | 10700', 'on the order search too');
select is((select concat_ws(' | ', x ->> 'charged_cents', x ->> 'refunded_cents')
             from (select pg_temp.staff_json($$select public.staff_refund_preview('c30f0003-0000-0000-0000-000000000001')$$) x) q),
  '10700 | 0', 'a step not charged yet: as before');
select pg_temp.fund(1);
select is((select concat_ws(' | ', x ->> 'state', x ->> 'charged_cents', x ->> 'refunded_cents')
             from (select pg_temp.staff_json($$select public.staff_refund_preview('c30f0001-0000-0000-0000-000000000001')$$) x) q),
  'confirmed | 10700 | 0', 'paid again: the new charge, nothing refunded on it');

-- ===========================================================================
-- #4b. A held step not approved, its charge disputed: Disputed, in Total.
-- ===========================================================================
update public.order_payments set disputed_at = now() where id = pg_temp.pay(5);
create function pg_temp.balance() returns jsonb language plpgsql as $f$
declare j jsonb;
begin
  perform pg_temp.act_as('01');
  set local role authenticated;
  j := public.factory_balance('c30b0000-0000-0000-0000-0000000000e1');
  reset role;
  return j;
end;
$f$;
create temp table bal on commit drop as select pg_temp.balance() as j;
select is((select (j ->> 'disputed_cents')::int from bal), 10000, 'Disputed: the step''s $100');
select is((select string_agg(x ->> 'figure', ',') from bal, jsonb_array_elements(j -> 'rows') x
            where x ->> 'payment_id' = 'c30f0005-0000-0000-0000-000000000001'), 'disputed', 'its row: Disputed, not Awaiting approval');
select is((select (j ->> 'awaiting_cents')::bigint from bal),
          (select coalesce(sum((x ->> 'amount_cents')::bigint), 0)::bigint from bal, jsonb_array_elements(j -> 'rows') x where x ->> 'figure' = 'awaiting'),
  'Awaiting approval: only its own rows');
select is((select (j ->> 'total_cents')::bigint from bal),
          (select (j ->> 'awaiting_cents')::bigint + (j ->> 'disputed_cents')::bigint + (j ->> 'available_cents')::bigint
                  + (j ->> 'pending_cents')::bigint + (j ->> 'processing_cents')::bigint + (j ->> 'paid_out_cents')::bigint from bal),
  'in Total');
update public.order_payments set disputed_at = null where id = pg_temp.pay(5);
select is((pg_temp.balance() ->> 'disputed_cents')::int, 0, 'settled: back to Awaiting approval');

-- ===========================================================================
-- #10. Closing a failed staff refund tells the brand, with the note.
-- ===========================================================================
select pg_temp.fund(2);
select set_config('tsc.r2', (pg_temp.staff_json($$select public.claim_staff_refund('c30f0002-0000-0000-0000-000000000001', 1070, null, 'Short delivery.')$$) ->> 'staff_refund_id'), true);
select lives_ok($$select pg_temp.as_server(format('select public.record_staff_refund(%L, ''re_pgtap_pr30_2'', ''succeeded'')', current_setting('tsc.r2')))$$, 'made');
select lives_ok($$select pg_temp.as_server(format('select public.record_staff_refund_failed(%L, ''Stripe refused the refund.'')', current_setting('tsc.r2')))$$, 'then failed');
select lives_ok($$select pg_temp.close(current_setting('tsc.r2')::uuid, 'Paid back by bank transfer, reference 4471.')$$, 'staff close it');
select is((select concat_ws(' | ', kind, title, body) from public.notifications
            where org_id = 'c30b0000-0000-0000-0000-0000000000b1' and dedupe_key = 'staff_refund_closed:' || current_setting('tsc.r2')),
  'payment_refunded | Refund for "PR30 lab dip" | Update on your $10.70 refund. Note from our team: Paid back by bank transfer, reference 4471.',
  'the brand is told, with the note');
select is((select concat_ws(' | ', x ->> 'status', x ->> 'close_note', (x ->> 'closed_at') is not null)
             from jsonb_array_elements(pg_temp.staff_json($$select public.staff_refund_preview('c30f0002-0000-0000-0000-000000000001')$$) -> 'staff_refunds') x
            where x ->> 'id' = current_setting('tsc.r2')),
  'failed | Paid back by bank transfer, reference 4471. | t', 'the order search row has the close');
select is((select count(*)::int from public.notifications
            where org_id = 'c30b0000-0000-0000-0000-0000000000e1' and dedupe_key = 'staff_refund_closed:' || current_setting('tsc.r2')), 0,
  'the factory is not');

select * from finish();
rollback;
