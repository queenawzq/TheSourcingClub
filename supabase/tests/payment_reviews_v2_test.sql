-- Paused payments v2 (20261125100000): staff refunds in the app, the order
-- page's pause read, the order search, and no reminders to a paused brand.
--
-- Fixtures: slugs pgtap-pr25-*, ids c26?xxxx-...; every count is scoped to them.
--   F1 (owner 01) <- B1 (owner 03), order TSC-925001:
--      R1 approved deposit $200 (charged $214), R2 held fit sample $100 ($107),
--      R3 processing $50, R4 due bulk $300 (its step due tomorrow), R5 approved
--      $100 ($107) whose charge is disputed.
--   F1 <- B1, order TSC-925002, cancelled: R6 held $100 ($107).
--   F2 (owner 04): another factory.
--   Staff: 02 (plain), 06 (also a member of B1: two hats).
begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

set local session_replication_role = replica;

insert into auth.users (id, email)
select ('c26a0000-0000-0000-0000-0000000000' || k)::uuid, 'pgtap-pr25-' || k || '@example.com'
  from unnest(array['01','02','03','04','06','07']) k;
insert into public.platform_admins (user_id, note) values
  ('c26a0000-0000-0000-0000-000000000002', 'pgtap-pr25'), ('c26a0000-0000-0000-0000-000000000006', 'pgtap-pr25'),
  ('c26a0000-0000-0000-0000-000000000007', 'pgtap-pr25');
insert into public.orgs (id, type, name, slug) values
  ('c26b0000-0000-0000-0000-0000000000b1', 'brand', 'PR25 Brand One', 'pgtap-pr25-b1'),
  ('c26b0000-0000-0000-0000-0000000000e1', 'factory', 'PR25 Factory One', 'pgtap-pr25-f1'),
  ('c26b0000-0000-0000-0000-0000000000e2', 'factory', 'PR25 Factory Two', 'pgtap-pr25-f2');
insert into public.org_members (org_id, user_id, role, permissions) values
  ('c26b0000-0000-0000-0000-0000000000e1', 'c26a0000-0000-0000-0000-000000000001', 'owner', '{}'),
  ('c26b0000-0000-0000-0000-0000000000b1', 'c26a0000-0000-0000-0000-000000000003', 'owner', '{}'),
  ('c26b0000-0000-0000-0000-0000000000b1', 'c26a0000-0000-0000-0000-000000000006', 'member', '{}'),
  ('c26b0000-0000-0000-0000-0000000000e2', 'c26a0000-0000-0000-0000-000000000004', 'owner', '{}'),
  ('c26b0000-0000-0000-0000-0000000000e1', 'c26a0000-0000-0000-0000-000000000007', 'member', '{}');
insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total) values
  ('c26c0000-0000-0000-0000-000000000001', 'c26b0000-0000-0000-0000-0000000000b1', 'PR25 request 1', 'awarded', 'invited_only', 100),
  ('c26c0000-0000-0000-0000-000000000002', 'c26b0000-0000-0000-0000-0000000000b1', 'PR25 request 2', 'awarded', 'invited_only', 100);
insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity, submitted_at) values
  ('c26c1000-0000-0000-0000-000000000001', 'c26c0000-0000-0000-0000-000000000001', 'c26b0000-0000-0000-0000-0000000000e1', 'accepted', 100, 1, now()),
  ('c26c1000-0000-0000-0000-000000000002', 'c26c0000-0000-0000-0000-000000000002', 'c26b0000-0000-0000-0000-0000000000e1', 'accepted', 100, 1, now());
insert into public.production_orders
  (id, rfq_id, quote_id, brand_org_id, factory_org_id, unit_price_cents, status, schedule_brand_agreed_at, schedule_brand_agreed_by,
   production_quantity, bulk_subtotal_cents, sample_subtotal_cents, order_total_cents, deposit_pct, balance_pct, order_number) values
  ('c26d0000-0000-0000-0000-000000000001', 'c26c0000-0000-0000-0000-000000000001', 'c26c1000-0000-0000-0000-000000000001',
   'c26b0000-0000-0000-0000-0000000000b1', 'c26b0000-0000-0000-0000-0000000000e1', 100000, 'active', now() - interval '60 days',
   'c26a0000-0000-0000-0000-000000000003', 1, 100000, 0, 100000, 50, 50, 'TSC-925001'),
  ('c26d0000-0000-0000-0000-000000000002', 'c26c0000-0000-0000-0000-000000000002', 'c26c1000-0000-0000-0000-000000000002',
   'c26b0000-0000-0000-0000-0000000000b1', 'c26b0000-0000-0000-0000-0000000000e1', 100000, 'cancelled', now() - interval '60 days',
   'c26a0000-0000-0000-0000-000000000003', 1, 100000, 0, 100000, 50, 50, 'TSC-925002');
insert into public.order_milestones (id, order_id, kind, title, amount_cents, state, sort, completed_at, due_on) values
  ('c26e0001-0000-0000-0000-000000000001', 'c26d0000-0000-0000-0000-000000000001', 'payment_only', 'PR25 deposit', 20000, 'complete', 5, now() - interval '9 days', null),
  ('c26e0002-0000-0000-0000-000000000001', 'c26d0000-0000-0000-0000-000000000001', 'approval_and_payment', 'PR25 fit sample', 10000, 'active', 10, null, null),
  ('c26e0003-0000-0000-0000-000000000001', 'c26d0000-0000-0000-0000-000000000001', 'approval_and_payment', 'PR25 trims', 5000, 'pending', 15, null, null),
  ('c26e0004-0000-0000-0000-000000000001', 'c26d0000-0000-0000-0000-000000000001', 'approval_and_payment', 'PR25 bulk', 30000, 'active', 20, null, current_date + 1),
  ('c26e0005-0000-0000-0000-000000000001', 'c26d0000-0000-0000-0000-000000000001', 'approval_and_payment', 'PR25 lab dip', 10000, 'complete', 8, now() - interval '8 days', null),
  ('c26e0006-0000-0000-0000-000000000002', 'c26d0000-0000-0000-0000-000000000002', 'approval_and_payment', 'PR25 cancelled sample', 10000, 'cancelled', 10, null, null);
insert into public.order_payments
  (id, order_id, milestone_id, amount_cents, charged_cents, currency, state, confirmed_at, release_requested_at,
   stripe_payment_intent_id, stripe_charge_id, funds_available_at, disputed_at) values
  ('c26f0001-0000-0000-0000-000000000001', 'c26d0000-0000-0000-0000-000000000001', 'c26e0001-0000-0000-0000-000000000001', 20000, 21400, 'USD', 'confirmed',
   now() - interval '20 days', now() - interval '9 days', 'pi_pgtap_pr25_1', 'ch_pgtap_pr25_1', now() - interval '15 days', null),
  ('c26f0002-0000-0000-0000-000000000001', 'c26d0000-0000-0000-0000-000000000001', 'c26e0002-0000-0000-0000-000000000001', 10000, 10700, 'USD', 'confirmed',
   now() - interval '20 days', null, 'pi_pgtap_pr25_2', 'ch_pgtap_pr25_2', now() - interval '15 days', null),
  ('c26f0005-0000-0000-0000-000000000001', 'c26d0000-0000-0000-0000-000000000001', 'c26e0005-0000-0000-0000-000000000001', 10000, 10700, 'USD', 'confirmed',
   now() - interval '20 days', now() - interval '8 days', 'pi_pgtap_pr25_5', 'ch_pgtap_pr25_5', now() - interval '15 days', now() - interval '1 day'),
  ('c26f0006-0000-0000-0000-000000000002', 'c26d0000-0000-0000-0000-000000000002', 'c26e0006-0000-0000-0000-000000000002', 10000, 10700, 'USD', 'confirmed',
   now() - interval '20 days', null, 'pi_pgtap_pr25_6', 'ch_pgtap_pr25_6', now() - interval '15 days', null);
insert into public.order_payments (id, order_id, milestone_id, amount_cents, currency, state, stripe_payment_intent_id, processing_at) values
  ('c26f0003-0000-0000-0000-000000000001', 'c26d0000-0000-0000-0000-000000000001', 'c26e0003-0000-0000-0000-000000000001', 5000, 'USD', 'processing', 'pi_pgtap_pr25_3', now()),
  ('c26f0004-0000-0000-0000-000000000001', 'c26d0000-0000-0000-0000-000000000001', 'c26e0004-0000-0000-0000-000000000001', 30000, 'USD', 'due', null, null);
set local session_replication_role = origin;

create function pg_temp.act_as(who text) returns void language sql as $f$
  select set_config('request.jwt.claims',
    json_build_object('sub', 'c26a0000-0000-0000-0000-' || lpad(who, 12, '0'), 'role', 'authenticated')::text, true);
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
create function pg_temp.org(code text) returns uuid language sql immutable as $f$
  select ('c26b0000-0000-0000-0000-0000000000' || code)::uuid;
$f$;
create function pg_temp.pay(n int) returns uuid language sql immutable as $f$
  select ('c26f000' || n || '-0000-0000-0000-00000000000' || case when n = 6 then 2 else 1 end)::uuid;
$f$;
-- Staff 02 claims a refund; returns the claim (or raises).
create function pg_temp.claim(n int, cents bigint, payer text, note text) returns jsonb language plpgsql as $f$
declare j jsonb;
begin
  perform pg_temp.act_as('02');
  set local role authenticated;
  j := public.claim_staff_refund(pg_temp.pay(n), cents, payer, note);
  reset role;
  return j;
end;
$f$;
create function pg_temp.staff(sql text) returns jsonb language plpgsql as $f$
declare j jsonb;
begin
  perform pg_temp.act_as('02');
  set local role authenticated;
  execute sql into j;
  reset role;
  return j;
end;
$f$;
create function pg_temp.told(org uuid, title text) returns text language sql as $f$
  select string_agg(body, ' || ' order by created_at) from public.notifications where org_id = org and notifications.title = told.title
     and order_id in ('c26d0000-0000-0000-0000-000000000001', 'c26d0000-0000-0000-0000-000000000002');
$f$;
create function pg_temp.avail() returns bigint language plpgsql as $f$
declare b bigint;
begin
  perform pg_temp.act_as('01');
  set local role authenticated;
  b := (public.factory_balance(pg_temp.org('e1')) ->> 'available_cents')::bigint;
  reset role;
  return b;
end;
$f$;

-- ===========================================================================
-- 0. Negatives first.
-- ===========================================================================
select pg_temp.act_as('01');
set local role authenticated;
select throws_ok($$select public.claim_staff_refund('c26f0001-0000-0000-0000-000000000001', 100, 'tsc', 'x')$$, '42501', null,
  'a factory cannot refund');
select throws_ok($$select public.staff_refund_preview('c26f0001-0000-0000-0000-000000000001')$$, '42501', null, 'nor read the dialog''s figures');
select throws_ok($$select public.admin_order_payments('925001')$$, '42501', null, 'nor search orders');
select throws_ok($$select public.admin_refund_info(array['c26f0001-0000-0000-0000-000000000001'::uuid])$$, '42501', null, 'nor read refund facts');
select throws_ok($$select count(*) from public.staff_refunds$$, '42501', null, 'nor read staff refunds');
select throws_ok($$select public.record_staff_refund(gen_random_uuid(), 're_x', 'succeeded')$$, '42501', null, 'only the server records a refund');
select throws_ok($$select public.record_staff_refund_failed(gen_random_uuid(), 'x')$$, '42501', null, 'or its failure');
reset role;
select pg_temp.act_as('03');
set local role authenticated;
select throws_ok($$select public.claim_staff_refund('c26f0001-0000-0000-0000-000000000001', 100, 'tsc', 'x')$$, '42501', null,
  'a brand cannot refund itself');
select throws_ok($$select public.staff_refund_retry(gen_random_uuid())$$, '42501', null, 'nor retry one');
reset role;
select pg_temp.act_as('02');
set local role authenticated;
select throws_ok($$select public.record_staff_refund(gen_random_uuid(), 're_x', 'succeeded')$$, '42501', null, 'staff cannot record a refund either');
select throws_ok($$insert into public.staff_refunds (payment_id, order_id, factory_org_id, brand_org_id, amount_cents, note)
                   values ('c26f0001-0000-0000-0000-000000000001', 'c26d0000-0000-0000-0000-000000000001',
                           'c26b0000-0000-0000-0000-0000000000e1', 'c26b0000-0000-0000-0000-0000000000b1', 1, 'x')$$,
  '42501', null, 'nobody writes a staff refund directly');
reset role;
select pg_temp.act_as('06');
set local role authenticated;
select throws_ok($$select public.claim_staff_refund('c26f0001-0000-0000-0000-000000000001', 100, 'tsc', 'x')$$, '42501',
  null, 'staff in the brand leave it to someone else');
reset role;
select pg_temp.act_as('04');
set local role authenticated;
select throws_ok($$select public.order_pause('c26d0000-0000-0000-0000-000000000001')$$, '42501', null, 'another company cannot read an order''s pause');
reset role;

-- Refusals, each by its hint.
select throws_ok($$select pg_temp.claim(3, 1000, null, 'x')$$, '22023', 'staff_refund_processing', 'still processing');
select throws_ok($$select pg_temp.claim(4, 1000, null, 'x')$$, '22023', 'staff_refund_not_charged', 'not charged');
select throws_ok($$select pg_temp.claim(5, 1000, 'tsc', 'x')$$, '22023', 'staff_refund_disputed', 'the bank is deciding it');
select throws_ok($$select pg_temp.claim(6, 1000, null, 'x')$$, '22023', 'staff_refund_cancelled_order', 'a cancelled order refunds itself');
select throws_ok($$select pg_temp.claim(1, 0, 'tsc', 'x')$$, '22023', 'enter an amount above 0', 'a positive amount');
select throws_ok($$select pg_temp.claim(1, -5, 'tsc', 'x')$$, '22023', 'enter an amount above 0', 'never negative');
select throws_ok($$select pg_temp.claim(1, 21401, 'tsc', 'x')$$, '22023', 'You can refund up to $214.00.', 'never more than the charge');
select throws_ok($$select pg_temp.claim(1, 1000, null, 'x')$$, '22023', 'choose who pays for this refund', 'an approved step needs who pays');
select throws_ok($$select pg_temp.claim(1, 1000, 'brand', 'x')$$, '22023', 'choose who pays for this refund', 'only factory or TSC');
select throws_ok($$select pg_temp.claim(2, 1000, 'factory', 'x')$$, '22023', 'this step isn''t approved', 'a held step has no factory share');
select throws_ok($$select pg_temp.claim(1, 1000, 'tsc', '   ')$$, '22023', 'add a reason for the brand', 'a reason is required');
select is((select count(*)::int from public.staff_refunds where order_id = 'c26d0000-0000-0000-0000-000000000001'), 0, 'nothing claimed by any refusal');

-- ===========================================================================
-- 1. The dialog's figures and the order search.
-- ===========================================================================
create temp table pv on commit drop as select pg_temp.staff($$select public.staff_refund_preview('c26f0001-0000-0000-0000-000000000001')$$) as j;
select is((select (j ->> 'refundable_cents')::bigint from pv), 21400::bigint, 'up to the whole charge, fee included');
select is((select (j ->> 'factory_max_cents')::bigint from pv), 20000::bigint, 'the factory could bear up to its $200 part');
select is((select (j ->> 'approved_step')::boolean from pv), true, 'an approved step: the dialog asks who pays');
select is((select j ->> 'refund_refusal' from pv), null, 'nothing refuses it');
select is(pg_temp.staff($$select public.admin_order_payments('tsc-925001') -> 'order_number'$$ ), to_jsonb('TSC-925001'::text), 'found by its number, any case');
select is(pg_temp.staff($$select public.admin_order_payments('925001') -> 'order_number'$$ ), to_jsonb('TSC-925001'::text), 'or without TSC-');
select is(pg_temp.staff($$select to_jsonb((select count(*) from jsonb_array_elements(public.admin_order_payments('925001') -> 'payments')))$$), '5'::jsonb,
  'with each of its payments');
select is(pg_temp.staff($$select (select x -> 'refund_refusal' from jsonb_array_elements(public.admin_order_payments('925001') -> 'payments') x
                                    where x ->> 'payment_id' = 'c26f0005-0000-0000-0000-000000000001')$$), '"staff_refund_disputed"'::jsonb,
  'and why Refund… is refused on one');
select is(pg_temp.staff($$select to_jsonb(public.admin_order_payments('999999') is null)$$), 'true'::jsonb, 'nothing found: null');
select is(pg_temp.staff($$select public.admin_refund_info(array['c26f0002-0000-0000-0000-000000000001'::uuid]) -> 'c26f0002-0000-0000-0000-000000000001' -> 'refundable_cents'$$),
  '10700'::jsonb, 'the Held tab''s rows get the same facts');

-- ===========================================================================
-- 2. An approved step, the factory's balance pays: taken at the claim, made,
--    recorded without a review.
-- ===========================================================================
create temp table pr25_before on commit drop as select pg_temp.avail() as a;
create temp table c1 on commit drop as select pg_temp.claim(1, 10700, 'factory', 'Late sample, agreed with the factory.') as j;
select is((select (j ->> 'factory_cents')::bigint from c1), 10000::bigint, 'the factory''s part of $107 is $100');
select ok((select j ->> 'key' like 'staff-refund-%-%' from c1), 'a key that carries the claim''s time');
select is((select taken_back_cents from public.order_payments where id = pg_temp.pay(1)), 10000::bigint, 'taken from the balance at the claim');
select is(pg_temp.avail(), (select a from pr25_before) - 10000, 'so no withdrawal can race it');
select throws_ok($$select pg_temp.claim(1, 100, 'tsc', 'again')$$, '22023', 'staff_refund_claimed', 'one claim at a time');
select is(pg_temp.staff(format($$select public.staff_refund_retry(%L) -> 'key'$$, (select j ->> 'staff_refund_id' from c1))), (select j -> 'key' from c1),
  'Check again gets the same claim and key');
select lives_ok(format($$select pg_temp.as_server(%L)$$, format('select public.record_staff_refund(%L, ''re_pgtap_pr25_1'', ''succeeded'')', (select j ->> 'staff_refund_id' from c1))),
  'Stripe made it');
select ok((select refunded_cents = 10700 and review_kept_cents = 10700 and taken_back_cents = 10000 from public.order_payments where id = pg_temp.pay(1)),
  'recorded: the brand got $107 back, the factory bore $100');
select is((select count(*)::int from public.payment_reviews where payment_id = pg_temp.pay(1)), 0, 'no review: staff already decided who pays');
select is(public.factory_paused(pg_temp.org('e1')), false, 'nobody paused');
select is(pg_temp.told(pg_temp.org('b1'), 'Your payment for "PR25 deposit" was refunded'),
  '$107.00 was refunded to your card. Note from our team: Late sample, agreed with the factory.', 'the brand is told, with the reason');
select is(pg_temp.told(pg_temp.org('e1'), 'Refund for "PR25 deposit"'),
  '$100.00 was taken from your balance for the brand''s refund of "PR25 deposit" on PR25 request 1 (TSC-925001). Note from our team: Late sample, agreed with the factory.',
  'the factory is told what left its balance');
select lives_ok(format($$select pg_temp.as_server(%L)$$, format('select public.record_staff_refund(%L, ''re_pgtap_pr25_1'', ''succeeded'')', (select j ->> 'staff_refund_id' from c1))),
  'the webhook says it again');
select is((select count(*)::int from public.notifications where dedupe_key = 'staff_refund:' || (select j ->> 'staff_refund_id' from c1)), 2, 'told once each');
select lives_ok($$select pg_temp.as_server('select public.record_payment_refund_amount(''c26f0001-0000-0000-0000-000000000001'', ''pi_pgtap_pr25_1'', 10700)')$$,
  'the charge''s refund total read back from Stripe');
select is((select count(*)::int from public.payment_reviews where payment_id = pg_temp.pay(1)), 0, 'still no review: it is ours');

-- TSC pays: nothing leaves the factory, and it is told nothing.
create temp table c2 on commit drop as select pg_temp.claim(1, 2140, 'tsc', 'Goodwill.') as j;
select is((select (j ->> 'factory_cents')::bigint from c2), 0::bigint, 'nothing from the factory');
select lives_ok(format($$select pg_temp.as_server(%L)$$, format('select public.record_staff_refund(%L, ''re_pgtap_pr25_2'', ''pending'')', (select j ->> 'staff_refund_id' from c2))),
  'Stripe: pending');
select is((select taken_back_cents from public.order_payments where id = pg_temp.pay(1)), 10000::bigint, 'the factory''s balance unchanged');
select is((select count(*)::int from public.notifications where org_id = pg_temp.org('e1') and dedupe_key = 'staff_refund:' || (select j ->> 'staff_refund_id' from c2)), 0,
  'the factory is told nothing');

-- Refused by Stripe: what was taken goes back, nothing else changes.
create temp table c3 on commit drop as select pg_temp.claim(1, 1070, 'factory', 'Refused one.') as j;
select is((select taken_back_cents from public.order_payments where id = pg_temp.pay(1)), 11000::bigint, 'its $10 part taken at the claim');
select lives_ok(format($$select pg_temp.as_server(%L)$$, format('select public.record_staff_refund_failed(%L, ''TSC''''s Stripe balance is too low.'')', (select j ->> 'staff_refund_id' from c3))),
  'Stripe refuses it');
select is((select taken_back_cents from public.order_payments where id = pg_temp.pay(1)), 10000::bigint, 'given back exactly');
select is((select status || ' | ' || failure from public.staff_refunds where id = (select (j ->> 'staff_refund_id')::uuid from c3)), 'failed | TSC''s Stripe balance is too low.',
  'the row says why');
select is((select count(*)::int from public.notifications where dedupe_key like 'staff_refund%' || (select j ->> 'staff_refund_id' from c3)), 0, 'nobody is told');

-- Made, then failed later: undone, both sides told.
create temp table c4 on commit drop as select pg_temp.claim(1, 1070, 'factory', 'Later failure.') as j;
select lives_ok(format($$select pg_temp.as_server(%L)$$, format('select public.record_staff_refund(%L, ''re_pgtap_pr25_4'', ''succeeded'')', (select j ->> 'staff_refund_id' from c4))),
  'made');
select lives_ok(format($$select pg_temp.as_server(%L)$$, format('select public.record_staff_refund(%L, ''re_pgtap_pr25_4'', ''failed'')', (select j ->> 'staff_refund_id' from c4))),
  'then Stripe says it failed');
select ok((select refunded_cents = 12840 and review_kept_cents = 12840 and taken_back_cents = 10000 from public.order_payments where id = pg_temp.pay(1)),
  'its refund and its take are undone');
select is(pg_temp.told(pg_temp.org('b1'), 'Refund for "PR25 deposit" didn''t go through'),
  'Your $10.70 refund didn''t go through. That amount stays on this order.', 'the brand is told');
select is(pg_temp.told(pg_temp.org('e1'), 'Refund for "PR25 deposit" didn''t go through'),
  'The refund to the brand didn''t go through. Your earnings from PR25 request 1 (TSC-925001) went back up by $10.00.', 'and the factory');

-- ===========================================================================
-- 3. A held step: no factory question; partly, then all of the rest.
-- ===========================================================================
create temp table c5 on commit drop as select pg_temp.claim(2, 1070, null, 'Part of the sample was missing.') as j;
select lives_ok(format($$select pg_temp.as_server(%L)$$, format('select public.record_staff_refund(%L, ''re_pgtap_pr25_5'', ''succeeded'')', (select j ->> 'staff_refund_id' from c5))),
  'made');
select ok((select refunded_cents = 1070 and factory_refund_cents = 1000 and state = 'confirmed' from public.order_payments where id = pg_temp.pay(2)),
  'the step stays funded with the rest');
select is((select count(*)::int from public.payment_reviews where payment_id = pg_temp.pay(2)), 0, 'no review');
create temp table c6 on commit drop as select pg_temp.claim(2, 9630, null, 'Sample cancelled.') as j;
select lives_ok(format($$select pg_temp.as_server(%L)$$, format('select public.record_staff_refund(%L, ''re_pgtap_pr25_6'', ''succeeded'')', (select j ->> 'staff_refund_id' from c6))),
  'all the rest');
select is((select state::text from public.order_payments where id = pg_temp.pay(2)), 'due', 'the step waits for the brand''s payment again (Due)');
select is((select reset_payment from public.staff_refunds where id = (select (j ->> 'staff_refund_id')::uuid from c6)), true, 'marked as a full refund');

-- ===========================================================================
-- 4. The order page's pause, the reminders, and the paused brand.
-- ===========================================================================
select pg_temp.act_as('01');
set local role authenticated;
select is(public.order_pause('c26d0000-0000-0000-0000-000000000001') ->> 'on_hold', 'false', 'the factory reads: not on hold');
reset role;
savepoint pr25_remind;
select lives_ok($$select pg_temp.as_server('select public.run_daily_notifications()')$$, 'the daily job, before any pause');
select is((select count(*)::int from public.notifications where org_id = pg_temp.org('b1') and kind = 'milestone_due_soon'
            and order_id = 'c26d0000-0000-0000-0000-000000000001'), 1, 'the brand is reminded to fund the bulk');
rollback to savepoint pr25_remind;
select lives_ok($$select pg_temp.as_server('select public.record_payment_review_dispute(''c26f0005-0000-0000-0000-000000000001'', ''dp_pgtap_pr25_5'', ''needs_response'', 10700, now() + interval ''7 days'', 1500)')$$,
  'a chargeback on the lab dip');
select pg_temp.act_as('01');
set local role authenticated;
select is(public.order_pause('c26d0000-0000-0000-0000-000000000001') ->> 'on_hold', 'true', 'the factory reads: on hold');
reset role;
select pg_temp.act_as('03');
set local role authenticated;
select is(public.order_pause('c26d0000-0000-0000-0000-000000000001') ->> 'brand_paused', 'true', 'so does the brand');
reset role;
select lives_ok($$select pg_temp.as_server('select public.run_daily_notifications()')$$, 'the daily job, while paused');
select is((select count(*)::int from public.notifications where org_id = pg_temp.org('b1') and kind = 'milestone_due_soon'
            and order_id = 'c26d0000-0000-0000-0000-000000000001'), 0, 'no reminder to fund while paused');
select throws_ok($$select pg_temp.claim(5, 1000, 'tsc', 'x')$$, '22023', 'staff_refund_disputed', 'no refund while the bank decides');
select pg_temp.act_as('07');
set local role authenticated;
select throws_ok($$select public.unpause_brand_org('c26b0000-0000-0000-0000-0000000000b1')$$, '42501',
  'your company has orders with this brand, so someone else on the staff must decide', 'staff in a factory it orders from leave it to someone else');
reset role;
select pg_temp.act_as('06');
set local role authenticated;
select throws_ok($$select public.unpause_brand_org('c26b0000-0000-0000-0000-0000000000b1')$$, '42501',
  'you belong to this brand, so someone else on the staff must decide', 'staff in the brand too');
reset role;
select throws_ok($$select pg_temp.staff('select to_jsonb(public.unpause_brand_org(''c26b0000-0000-0000-0000-0000000000e1''))')$$, 'P0002', null,
  'a factory is not a brand to unpause');

-- ===========================================================================
-- 5. A refund made in Stripe's dashboard still opens a review (fallback).
-- ===========================================================================
select lives_ok($$select pg_temp.as_server('select public.record_payment_refund_amount(''c26f0001-0000-0000-0000-000000000001'', ''pi_pgtap_pr25_1'', 14140)')$$,
  'staff refund $13 more in Stripe''s dashboard');
select is((select state || ' ' || amount_cents from public.payment_reviews where payment_id = pg_temp.pay(1) and cause = 'refund'), 'decide 1300',
  'only that part is reviewed');

-- ===========================================================================
-- 6. New functions are staff's or the server's: grants.
-- ===========================================================================
select ok(not has_function_privilege('anon', 'public.claim_staff_refund(uuid, bigint, text, text, bigint)', 'execute'), 'anon cannot claim');
select ok(not has_function_privilege('authenticated', 'public.record_staff_refund(uuid, text, text)', 'execute'), 'only the server records');
select ok(not has_function_privilege('authenticated', 'public.hand_payout_revealed(public.order_payments, uuid, timestamptz)', 'execute'), 'internal helper');
select ok(not has_function_privilege('authenticated', 'public.give_back_staff_refund_takes(public.staff_refunds)', 'execute'), 'internal helper');

select * from finish();
rollback;
