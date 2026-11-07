-- ============================================================================
-- Pay with Wise, Pay with PayPal: who may press, and pressing once pays once
-- (20261107200000). `pgtap78-` slugs, 78a…/78b… ids, every number plainly fake.
-- Mostly refusals: the double press, the two hats, the forged "paid", and every
-- other way of paying the same money while an attempt is under way.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;

select plan(45);

set local session_replication_role = replica;

insert into auth.users (id, email) values
  ('78a00000-0000-0000-0000-000000000001', 'p78-factory@example.com'),
  ('78a00000-0000-0000-0000-000000000003', 'p78-brand@example.com'),
  ('78a00000-0000-0000-0000-000000000004', 'p78-stranger@example.com'),
  ('78a00000-0000-0000-0000-000000000005', 'p78-staff@example.com'),
  ('78a00000-0000-0000-0000-000000000006', 'p78-staff-in-factory@example.com'),
  ('78a00000-0000-0000-0000-000000000007', 'p78-staff-in-brand@example.com');

insert into public.platform_admins (user_id, note) values
  ('78a00000-0000-0000-0000-000000000005', 'pgtap78'),
  ('78a00000-0000-0000-0000-000000000006', 'pgtap78'),
  ('78a00000-0000-0000-0000-000000000007', 'pgtap78');

insert into public.orgs (id, type, name, slug) values
  ('78b00000-0000-0000-0000-00000000000b', 'brand',   'P78 Brand', 'pgtap78-brand'),
  ('78b00000-0000-0000-0000-0000000000f1', 'factory', 'P78 Mill',  'pgtap78-mill');

insert into public.org_members (org_id, user_id, role, permissions) values
  ('78b00000-0000-0000-0000-0000000000f1', '78a00000-0000-0000-0000-000000000001', 'owner', '{}'),
  ('78b00000-0000-0000-0000-0000000000f1', '78a00000-0000-0000-0000-000000000006', 'member', '{}'),
  ('78b00000-0000-0000-0000-00000000000b', '78a00000-0000-0000-0000-000000000003', 'owner', '{}'),
  ('78b00000-0000-0000-0000-00000000000b', '78a00000-0000-0000-0000-000000000007', 'member', '{}');

insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total)
values ('78c00000-0000-0000-0000-000000000001', '78b00000-0000-0000-0000-00000000000b', 'P78 request', 'awarded', 'invited_only', 100);
insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity, submitted_at)
values ('78c00000-0000-0000-0000-000000000002', '78c00000-0000-0000-0000-000000000001', '78b00000-0000-0000-0000-0000000000f1', 'accepted', 100, 1, now());
insert into public.production_orders
  (id, rfq_id, quote_id, brand_org_id, factory_org_id, unit_price_cents,
   production_quantity, bulk_subtotal_cents, sample_subtotal_cents, order_total_cents, deposit_pct, balance_pct, order_number)
values ('78d00000-0000-0000-0000-000000000001', '78c00000-0000-0000-0000-000000000001', '78c00000-0000-0000-0000-000000000002',
        '78b00000-0000-0000-0000-00000000000b', '78b00000-0000-0000-0000-0000000000f1', 1000, 1, 1000, 0, 1000, 50, 50, 'P78-1');
insert into public.order_milestones (id, order_id, kind, title, amount_cents)
select ('78e00000-0000-0000-0000-00000000000' || n)::uuid, '78d00000-0000-0000-0000-000000000001', 'payment_only', 'P78 step ' || n, 100000
  from generate_series(1, 4) n;
insert into public.order_payments (id, order_id, milestone_id, amount_cents, currency, state, confirmed_at, release_requested_at)
select ('78f00000-0000-0000-0000-00000000000' || n)::uuid, '78d00000-0000-0000-0000-000000000001',
       ('78e00000-0000-0000-0000-00000000000' || n)::uuid, 100000, 'USD', 'confirmed', now(),
       case when n = 4 then null else now() end
  from generate_series(1, 4) n;

insert into public.factory_payout_accounts
  (id, org_id, method, bank_name, account_name, account_number_last4, swift, bank_country, is_primary,
   wise_recipient_type, wise_currency, wise_number_key, wise_details, details_changed_at)
values ('78a10000-0000-0000-0000-000000000001', '78b00000-0000-0000-0000-0000000000f1', 'bank', 'Demo Bank', 'P78 MILL LTD', '1234', 'BOSHCNSH', 'CN', true,
        'chinese_local_business', 'CNY', 'accountNumber', '{"accountHolderName":"P78 MILL LTD"}', '2026-11-01 00:00:00+00');

set local session_replication_role = origin;

create function pg_temp.act_as(who int) returns void language sql as $f$
  select set_config('request.jwt.claims',
    json_build_object('sub', '78a00000-0000-0000-0000-' || lpad(who::text, 12, '0'), 'role', 'authenticated')::text, true);
$f$;
grant execute on function pg_temp.act_as(int) to authenticated, anon, service_role;

create function pg_temp.lapse() returns void language sql as $f$
  update public.provider_payout_attempts set lease_until = now() - interval '1 second'
   where payout_id in (select id from public.provider_payouts where factory_org_id = '78b00000-0000-0000-0000-0000000000f1');
$f$;

-- The one call everyone tries. Payment 1 unless named.
create function pg_temp.press(payment int default 1, which text default 'wise', changed text default '2026-11-01 00:00:00+00', cny boolean default true)
returns jsonb language sql as $f$
  select public.claim_provider_payout(('78f00000-0000-0000-0000-00000000000' || payment)::uuid, which, changed::timestamptz, cny);
$f$;
grant execute on function pg_temp.press(int, text, text, boolean) to authenticated, anon, service_role;

-- --- Who may press ---------------------------------------------------------
select pg_temp.act_as(1); set local role authenticated;
select throws_ok($$ select pg_temp.press() $$, '42501', null, 'the factory cannot pay itself');
select throws_ok($$ select public.admin_provider_attempts() $$, '42501', null, 'nor read the staff view');
select throws_ok($$ select * from public.provider_payout_attempts $$, '42501', null, 'nor read the attempts table');

reset role; select pg_temp.act_as(3); set local role authenticated;
select throws_ok($$ select pg_temp.press() $$, '42501', null, 'the brand cannot press');

reset role; select pg_temp.act_as(4); set local role authenticated;
select throws_ok($$ select pg_temp.press() $$, '42501', null, 'a stranger cannot press');
select throws_ok($$ select public.lease_provider_payout('78f00000-0000-0000-0000-000000000001') $$, '42501', null, 'nor take an attempt');

reset role; select pg_temp.act_as(6); set local role authenticated;
select throws_ok($$ select pg_temp.press() $$, '42501', 'you belong to this company, so someone else on the staff must pay it', 'staff in the factory cannot pay it');

reset role; select pg_temp.act_as(7); set local role authenticated;
select throws_ok($$ select pg_temp.press() $$, '42501', 'your company has an order with this factory, so someone else on the staff must pay it', 'staff in the brand on the order cannot either');

reset role; select set_config('request.jwt.claims', '', true); set local role anon;
select throws_ok($$ select pg_temp.press() $$, '42501', null, 'signed out is refused');

-- --- What may be paid ------------------------------------------------------
reset role; select pg_temp.act_as(5); set local role authenticated;
select throws_ok($$ select pg_temp.press(4) $$, '22023', 'that payment is not approved for payout', 'a held payment the brand has not approved');
select throws_ok($$ select public.claim_provider_payout('78000000-0000-0000-0000-000000000000', 'wise', now(), true) $$, 'P0002', null, 'a payment that does not exist');
select throws_ok($$ select pg_temp.press(1, 'wise', '2026-10-01 00:00:00+00') $$, '22023', 'this factory changed where it is paid', 'details changed under the tab');
select throws_ok($$ select public.claim_provider_payout('78f00000-0000-0000-0000-000000000001', 'wise', null, true) $$, '22023', 'this factory changed where it is paid', 'no date at all is refused the same');
select throws_ok($$ select pg_temp.press(1, 'wise', '2026-11-01 00:00:00+00', false) $$, '22023', 'confirm the contract and invoice statement first', 'CNY without the statement');
select throws_ok($$ select pg_temp.press(1, 'paypal') $$, '22023', 'this factory has no PayPal address', 'the wrong provider');
select throws_ok($$ select pg_temp.press(1, 'venmo') $$, '22023', null, 'an unknown provider');

-- --- The double press ------------------------------------------------------
select lives_ok($$ select pg_temp.press() $$, 'staff press');
select is((select count(*)::int from public.provider_payouts where payment_id = '78f00000-0000-0000-0000-000000000001'), 1, 'one attempt');
select is((select status from public.provider_payouts where payment_id = '78f00000-0000-0000-0000-000000000001'), 'processing', 'under way');
select is((select state::text from public.order_payments where id = '78f00000-0000-0000-0000-000000000001'), 'confirmed', 'the payment is still owed');
select is((select paid_to from public.provider_payouts where payment_id = '78f00000-0000-0000-0000-000000000001'), 'Demo Bank ending 1234', 'what the factory reads, and never the number');
select throws_ok($$ select pg_temp.press() $$, '22023', 'this is already being paid', 'a second press while it runs');
select throws_ok($$ select public.lease_provider_payout('78f00000-0000-0000-0000-000000000001') $$, '22023', 'this is already being paid', 'cancelling while it runs');

-- A lease that lapsed (a timeout, a dead server): the same key, never a new attempt.
reset role;
create temp table first_key on commit drop as
  select a.attempt_key from public.provider_payout_attempts a join public.provider_payouts x on x.id = a.payout_id
   where x.payment_id = '78f00000-0000-0000-0000-000000000001';
select pg_temp.lapse();
grant select on first_key to authenticated;
select pg_temp.act_as(5); set local role authenticated;
select is((pg_temp.press() ->> 'key')::uuid, (select attempt_key from first_key), 'pressing after a timeout reuses the key');
select is((select count(*)::int from public.provider_payouts where payment_id = '78f00000-0000-0000-0000-000000000001'), 1, 'still one attempt');

-- --- Every other way of paying it is shut while it runs -----------------------
select throws_ok($$ select public.release_payment_to_factory('78f00000-0000-0000-0000-000000000001', 'BANKREF1', '2026-11-01 00:00:00+00') $$, '22023', null, 'Mark paid by bank refuses');
select throws_ok($$ select public.release_payment_by_payoneer('78f00000-0000-0000-0000-000000000001', 'x@example.com', 'PAYID1', null) $$, '22023', null, 'Mark paid by Payoneer refuses');

-- --- Staff cannot say it went --------------------------------------------------
select throws_ok($$ select public.finish_provider_payout((select id from public.provider_payouts where payment_id = '78f00000-0000-0000-0000-000000000001'), 'paid') $$, '42501', null, 'staff cannot call a payout paid');
select throws_ok($$ select public.record_provider_attempt((select id from public.provider_payouts where payment_id = '78f00000-0000-0000-0000-000000000001'), 'sent') $$, '42501', null, 'nor move it on');
select throws_ok($$ update public.provider_payouts set status = 'paid', paid_at = now() $$, '42501', null, 'nor write the row');
select throws_ok($$ insert into public.provider_payout_attempts (payout_id) values ('78000000-0000-0000-0000-000000000000') $$, '42501', null, 'nor the attempts');

-- --- The server records it ---------------------------------------------------
reset role; set local role service_role;
select is(public.claim_payment_release('78f00000-0000-0000-0000-000000000001'), null, 'Stripe''s claim refuses too');
select lives_ok($$ select public.finish_provider_payout((select id from public.provider_payouts where payment_id = '78f00000-0000-0000-0000-000000000001'), 'paid', null, 'outgoing_payment_sent', null, 660000, 'CNY') $$, 'the provider says it went');
select is((select state::text from public.order_payments where id = '78f00000-0000-0000-0000-000000000001'), 'released', 'paid and released are one step');
select is((select body from public.notifications where subject_id = '78f00000-0000-0000-0000-000000000001' and kind = 'funds_released'), 'Sent to Demo Bank ending 1234 against P78-1.', 'the factory is told, no provider named');
select lives_ok($$ select public.finish_provider_payout((select id from public.provider_payouts where payment_id = '78f00000-0000-0000-0000-000000000001'), 'paid') $$, 'said twice');
select is((select count(*)::int from public.notifications where subject_id = '78f00000-0000-0000-0000-000000000001' and kind = 'funds_released'), 1, 'told once');

-- It came back after it went: owed again, and the factory is told otherwise.
select lives_ok($$ select public.finish_provider_payout((select id from public.provider_payouts where payment_id = '78f00000-0000-0000-0000-000000000001'), 'failed', 'details_rejected', 'bounced_back', 'returned', null, null, 'Check your bank details') $$, 'the transfer bounces');
select is((select state::text from public.order_payments where id = '78f00000-0000-0000-0000-000000000001'), 'confirmed', 'owed again');

-- After a certain failure, a new attempt has a new key.
reset role; select pg_temp.act_as(5); set local role authenticated;
select isnt((pg_temp.press() ->> 'key')::uuid, (select attempt_key from first_key), 'a new attempt never replays the old key');

-- An attempt that never reached a provider is staff's: the factory doesn't read it.
reset role; set local role service_role;
select lives_ok($$ select public.finish_provider_payout((select id from public.provider_payouts where payment_id = '78f00000-0000-0000-0000-000000000001' and status = 'processing'), 'cancelled', null, 'short_balance', 'short') $$, 'cancelled before any provider call');
select is((select state::text from public.order_payments where id = '78f00000-0000-0000-0000-000000000001'), 'confirmed', 'still owed');
reset role; select pg_temp.act_as(1); set local role authenticated;
select is((select count(*)::int from public.provider_payouts where status = 'cancelled' and factory_org_id = '78b00000-0000-0000-0000-0000000000f1'), 0, 'the factory reads no cancelled attempt');
reset role; select pg_temp.act_as(5); set local role authenticated;
select is((select count(*)::int from public.provider_payouts where status = 'cancelled' and factory_org_id = '78b00000-0000-0000-0000-0000000000f1'), 1, 'staff do');

-- --- The brand reads none of it ------------------------------------------------
reset role; select pg_temp.act_as(3); set local role authenticated;
select is((select count(*)::int from public.provider_payouts where factory_org_id = '78b00000-0000-0000-0000-0000000000f1'), 0, 'the brand reads no attempt');

select * from finish();
rollback;
