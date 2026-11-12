-- PR #100 audits, Nov 8: paying twice, the route pin, who is told, what a
-- message may carry after it was checked, and a refund made outside Stripe.
begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

set local session_replication_role = replica;

insert into auth.users (id, email) values
  ('97a00000-0000-0000-0000-000000000001', 'p97-factory@example.com'),
  ('97a00000-0000-0000-0000-000000000002', 'p97-payoneer@example.com'),
  ('97a00000-0000-0000-0000-000000000003', 'p97-brand@example.com'),
  ('97a00000-0000-0000-0000-000000000004', 'p97-stranger@example.com'),
  ('97a00000-0000-0000-0000-000000000005', 'p97-staff@example.com'),
  ('97a00000-0000-0000-0000-000000000007', 'p97-staff-in-brand@example.com'),
  ('97a00000-0000-0000-0000-000000000008', 'p97-new-bank@example.com');

insert into public.platform_admins (user_id, note) values
  ('97a00000-0000-0000-0000-000000000005', 'pgtap97'),
  ('97a00000-0000-0000-0000-000000000007', 'pgtap97');

insert into public.orgs (id, type, name, slug) values
  ('97b00000-0000-0000-0000-00000000000b', 'brand',   'P97 Brand',    'pgtap97-brand'),
  ('97b00000-0000-0000-0000-0000000000f1', 'factory', 'P97 Mill',     'pgtap97-mill'),
  ('97b00000-0000-0000-0000-0000000000f2', 'factory', 'P97 Payoneer', 'pgtap97-payoneer'),
  ('97b00000-0000-0000-0000-0000000000f3', 'factory', 'P97 New Bank', 'pgtap97-new-bank');

insert into public.org_members (org_id, user_id, role, permissions) values
  ('97b00000-0000-0000-0000-0000000000f1', '97a00000-0000-0000-0000-000000000001', 'owner', '{}'),
  ('97b00000-0000-0000-0000-0000000000f2', '97a00000-0000-0000-0000-000000000002', 'owner', '{}'),
  ('97b00000-0000-0000-0000-0000000000f3', '97a00000-0000-0000-0000-000000000008', 'owner', '{}'),
  ('97b00000-0000-0000-0000-00000000000b', '97a00000-0000-0000-0000-000000000003', 'owner', '{}'),
  ('97b00000-0000-0000-0000-00000000000b', '97a00000-0000-0000-0000-000000000007', 'member', '{}');

insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total) values
  ('97c00000-0000-0000-0000-000000000001', '97b00000-0000-0000-0000-00000000000b', 'P97 request',  'awarded', 'invited_only', 100),
  ('97c00000-0000-0000-0000-000000000002', '97b00000-0000-0000-0000-00000000000b', 'P97 payoneer', 'awarded', 'invited_only', 100),
  ('97c00000-0000-0000-0000-000000000003', '97b00000-0000-0000-0000-00000000000b', 'P97 cancelled', 'awarded', 'invited_only', 100);
insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity, submitted_at) values
  ('97c10000-0000-0000-0000-000000000001', '97c00000-0000-0000-0000-000000000001', '97b00000-0000-0000-0000-0000000000f1', 'accepted', 100, 1, now()),
  ('97c10000-0000-0000-0000-000000000002', '97c00000-0000-0000-0000-000000000002', '97b00000-0000-0000-0000-0000000000f2', 'accepted', 100, 1, now()),
  ('97c10000-0000-0000-0000-000000000003', '97c00000-0000-0000-0000-000000000003', '97b00000-0000-0000-0000-0000000000f1', 'accepted', 100, 1, now());
insert into public.production_orders
  (id, rfq_id, quote_id, brand_org_id, factory_org_id, unit_price_cents,
   production_quantity, bulk_subtotal_cents, sample_subtotal_cents, order_total_cents, deposit_pct, balance_pct, order_number)
values
  ('97d00000-0000-0000-0000-000000000001', '97c00000-0000-0000-0000-000000000001', '97c10000-0000-0000-0000-000000000001',
   '97b00000-0000-0000-0000-00000000000b', '97b00000-0000-0000-0000-0000000000f1', 1000, 1, 1000, 0, 1000, 50, 50, 'P97-1'),
  ('97d00000-0000-0000-0000-000000000002', '97c00000-0000-0000-0000-000000000002', '97c10000-0000-0000-0000-000000000002',
   '97b00000-0000-0000-0000-00000000000b', '97b00000-0000-0000-0000-0000000000f2', 1000, 1, 1000, 0, 1000, 50, 50, 'P97-2'),
  ('97d00000-0000-0000-0000-000000000003', '97c00000-0000-0000-0000-000000000003', '97c10000-0000-0000-0000-000000000003',
   '97b00000-0000-0000-0000-00000000000b', '97b00000-0000-0000-0000-0000000000f1', 1000, 1, 1000, 0, 1000, 50, 50, 'P97-3');
update public.production_orders set status = 'cancelled' where id = '97d00000-0000-0000-0000-000000000003';
insert into public.order_milestones (id, order_id, kind, title, amount_cents) values
  ('97e00000-0000-0000-0000-000000000001', '97d00000-0000-0000-0000-000000000001', 'payment_only', 'P97 step 1', 100000),
  ('97e00000-0000-0000-0000-000000000002', '97d00000-0000-0000-0000-000000000002', 'payment_only', 'P97 step 2', 100000),
  ('97e00000-0000-0000-0000-000000000003', '97d00000-0000-0000-0000-000000000003', 'payment_only', 'P97 step 3', 100000);
insert into public.order_payments
  (id, order_id, milestone_id, amount_cents, currency, state, confirmed_at, release_requested_at, stripe_payment_intent_id, stripe_charge_id)
values
  ('97f00000-0000-0000-0000-000000000001', '97d00000-0000-0000-0000-000000000001', '97e00000-0000-0000-0000-000000000001', 100000, 'USD', 'confirmed', now(), now(), 'pi_p97_1', 'ch_p97_1'),
  ('97f00000-0000-0000-0000-000000000002', '97d00000-0000-0000-0000-000000000002', '97e00000-0000-0000-0000-000000000002', 100000, 'USD', 'confirmed', now(), now(), 'pi_p97_2', 'ch_p97_2'),
  ('97f00000-0000-0000-0000-000000000003', '97d00000-0000-0000-0000-000000000003', '97e00000-0000-0000-0000-000000000003', 100000, 'USD', 'confirmed', now(), null, null, null);

insert into public.factory_payout_accounts
  (id, org_id, method, bank_name, account_name, account_number_last4, swift, bank_country, is_primary,
   wise_recipient_type, wise_currency, wise_number_key, wise_details, details_changed_at, number_changed_at)
values ('97a10000-0000-0000-0000-000000000001', '97b00000-0000-0000-0000-0000000000f1', 'bank', 'P97 Bank', 'P97 MILL LTD', '1234', 'BOSHCNSH', 'GB', true,
        'sort_code', 'GBP', 'accountNumber', '{"sortCode":"231470"}', '2026-11-01 00:00:00+00', now());
insert into public.factory_payout_accounts (id, org_id, method, payoneer_email, is_primary, details_changed_at)
values ('97a10000-0000-0000-0000-000000000002', '97b00000-0000-0000-0000-0000000000f2', 'payoneer', 'p97@example.com', true, '2026-11-01 00:00:00+00');

insert into public.stripe_connect_accounts (org_id, stripe_account_id, country, transfers_active) values
  ('97b00000-0000-0000-0000-0000000000f1', 'acct_p97_1', 'GB', true),
  ('97b00000-0000-0000-0000-0000000000f2', 'acct_p97_2', 'GB', false),
  ('97b00000-0000-0000-0000-0000000000f3', 'acct_p97_3', 'US', true);

insert into public.message_threads (id, order_id, brand_org_id, factory_org_id) values ('97910000-0000-0000-0000-000000000001', '97d00000-0000-0000-0000-000000000001', '97b00000-0000-0000-0000-00000000000b', '97b00000-0000-0000-0000-0000000000f1');
insert into public.messages (id, thread_id, sender_org_id, sender_user_id, body, delivery, delivered_at) values
  ('97920000-0000-0000-0000-000000000001', '97910000-0000-0000-0000-000000000001', '97b00000-0000-0000-0000-0000000000f1', '97a00000-0000-0000-0000-000000000001', 'own delivered', 'delivered', now()),
  ('97920000-0000-0000-0000-000000000002', '97910000-0000-0000-0000-000000000001', '97b00000-0000-0000-0000-00000000000b', '97a00000-0000-0000-0000-000000000003', 'brand delivered', 'delivered', now()),
  ('97920000-0000-0000-0000-000000000003', '97910000-0000-0000-0000-000000000001', '97b00000-0000-0000-0000-0000000000f1', '97a00000-0000-0000-0000-000000000001', 'own checking', 'checking', null);
insert into public.documents (id, org_id, kind, bucket, storage_path, file_name) values
  ('97930000-0000-0000-0000-000000000001', '97b00000-0000-0000-0000-0000000000f1', 'message_attachment', 'org-private', 'p97/one.pdf', 'one.pdf'),
  ('97930000-0000-0000-0000-000000000002', '97b00000-0000-0000-0000-0000000000f1', 'message_attachment', 'org-private', 'p97/two.pdf', 'two.pdf');

set local session_replication_role = origin;

create function pg_temp.act_as(who int) returns void language sql as $f$
  select set_config('request.jwt.claims',
    json_build_object('sub', '97a00000-0000-0000-0000-' || lpad(who::text, 12, '0'), 'role', 'authenticated')::text, true);
$f$;
grant execute on function pg_temp.act_as(int) to authenticated, anon, service_role;

-- The first payment back to owed and untouched, and the route to one known state.
create function pg_temp.reset(manual boolean) returns void language plpgsql as $f$
begin
  update public.stripe_connect_accounts set transfers_active = true where org_id = '97b00000-0000-0000-0000-0000000000f1';
  delete from public.bank_payouts where payment_id = '97f00000-0000-0000-0000-000000000001';
  delete from public.provider_payouts where payment_id = '97f00000-0000-0000-0000-000000000001';
  delete from public.factory_payout_preferences where org_id = '97b00000-0000-0000-0000-0000000000f1';
  if manual then
    insert into public.factory_payout_preferences (org_id, route) values ('97b00000-0000-0000-0000-0000000000f1', 'manual');
  end if;
  update public.order_payments
     set state = 'confirmed', released_at = null, released_by = null, released_note = null,
         release_claimed_at = null, stripe_release_started = false, stripe_payment_intent_id = 'pi_p97_1'
   where id = '97f00000-0000-0000-0000-000000000001';
end;
$f$;

create function pg_temp.notices(org text) returns int language sql as $f$
  select count(*)::int from public.notifications
   where org_id = ('97b00000-0000-0000-0000-0000000000' || org)::uuid and kind = 'payout_method_changed';
$f$;

create function pg_temp.last_notice(org text) returns text language sql as $f$
  select body from public.notifications
   where org_id = ('97b00000-0000-0000-0000-0000000000' || org)::uuid and kind = 'payout_method_changed'
   order by created_at desc, id desc limit 1;
$f$;

-- ---------------------------------------------------------------------------
-- 1. Manual to Stripe while a manual payout is owed
-- ---------------------------------------------------------------------------
select pg_temp.reset(true);
select pg_temp.act_as(1); set local role authenticated;
select throws_ok($$select public.choose_payout_method('97b00000-0000-0000-0000-0000000000f1', null)$$, '22023', null,
  'a factory cannot move to Stripe while staff may be sending its payout by hand');
reset role;
select is((select route from public.factory_payout_preferences where org_id = '97b00000-0000-0000-0000-0000000000f1'), 'manual', 'and the route stays manual');
select is(public.claim_payment_release('97f00000-0000-0000-0000-000000000001'), null::timestamptz, 'so Stripe still cannot claim it');

update public.order_payments set state = 'released', released_at = now() where id = '97f00000-0000-0000-0000-000000000001';
select pg_temp.act_as(1); set local role authenticated;
select lives_ok($$select public.choose_payout_method('97b00000-0000-0000-0000-0000000000f1', null)$$, 'once nothing is owed the switch is allowed');
reset role;

select pg_temp.reset(false);
select pg_temp.act_as(1); set local role authenticated;
select lives_ok($$select public.choose_payout_method('97b00000-0000-0000-0000-0000000000f1', null)$$, 'already on Stripe: choosing Stripe again is no switch, even with money owed');
reset role;

-- ---------------------------------------------------------------------------
-- 2. Marking paid by bank
-- ---------------------------------------------------------------------------
select pg_temp.reset(false);
select pg_temp.act_as(5); set local role authenticated;
select throws_ok($$select public.release_payment_to_factory('97f00000-0000-0000-0000-000000000001', 'BANKREF-1', '2026-11-01 00:00:00+00')$$, '22023', null,
  'staff cannot mark paid by bank a payment Stripe pays');
reset role;

select pg_temp.reset(true);
update public.order_payments set release_claimed_at = now() where id = '97f00000-0000-0000-0000-000000000001';
select pg_temp.act_as(5); set local role authenticated;
select throws_ok($$select public.release_payment_to_factory('97f00000-0000-0000-0000-000000000001', 'BANKREF-1', '2026-11-01 00:00:00+00')$$, '22023', null,
  'nor during a Stripe claim, whatever the route says');
reset role;

select pg_temp.reset(true);
update public.order_payments set stripe_release_started = true where id = '97f00000-0000-0000-0000-000000000001';
select pg_temp.act_as(5); set local role authenticated;
select throws_ok($$select public.release_payment_to_factory('97f00000-0000-0000-0000-000000000001', 'BANKREF-1', '2026-11-01 00:00:00+00')$$, '22023', null,
  'nor once Stripe has been started and not reconciled');
reset role;

select pg_temp.reset(true);
select pg_temp.act_as(5); set local role authenticated;
select lives_ok($$select public.release_payment_to_factory('97f00000-0000-0000-0000-000000000001', 'BANKREF-1', '2026-11-01 00:00:00+00')$$,
  'on the manual route, untouched by Stripe, it still works');
reset role;

select pg_temp.reset(false);
update public.order_payments set stripe_payment_intent_id = null where id = '97f00000-0000-0000-0000-000000000001';
select pg_temp.act_as(5); set local role authenticated;
select lives_ok($$select public.release_payment_to_factory('97f00000-0000-0000-0000-000000000001', 'BANKREF-1', '2026-11-01 00:00:00+00')$$,
  'and on a payment with no card charge, which Stripe cannot pay');
reset role;

-- ---------------------------------------------------------------------------
-- 3. The pin on the other rails
-- ---------------------------------------------------------------------------
select pg_temp.reset(false);
update public.order_payments set stripe_release_started = true, release_claimed_at = now() - interval '11 minutes' where id = '97f00000-0000-0000-0000-000000000001';
update public.stripe_connect_accounts set transfers_active = false where org_id = '97b00000-0000-0000-0000-0000000000f1';
select pg_temp.act_as(5); set local role authenticated;
select throws_ok($$select public.claim_provider_payout('97f00000-0000-0000-0000-000000000001', 'wise', '2026-11-01 00:00:00+00', false)$$, '22023', null,
  'a lost Stripe response cannot be paid again by Wise after Stripe goes inactive');
reset role;

update public.order_payments set stripe_release_started = true where id = '97f00000-0000-0000-0000-000000000002';
select pg_temp.act_as(5); set local role authenticated;
select throws_ok($$select public.release_payment_by_payoneer('97f00000-0000-0000-0000-000000000002', 'p97@example.com', 'PO-12345')$$, '22023', null,
  'nor recorded as paid by Payoneer');
reset role;
update public.order_payments set stripe_release_started = false where id = '97f00000-0000-0000-0000-000000000002';
select pg_temp.act_as(5); set local role authenticated;
select lives_ok($$select public.release_payment_by_payoneer('97f00000-0000-0000-0000-000000000002', 'p97@example.com', 'PO-12345')$$,
  'once reconciled, Payoneer can record it');
reset role;

select pg_temp.reset(true);
select pg_temp.act_as(5); set local role authenticated;
select lives_ok($$select public.claim_provider_payout('97f00000-0000-0000-0000-000000000001', 'wise', '2026-11-01 00:00:00+00', false)$$,
  'Wise claims a payment Stripe never started');
reset role;

-- ---------------------------------------------------------------------------
-- 4. Clearing the pin
-- ---------------------------------------------------------------------------
select ok(not has_function_privilege('authenticated', 'public.record_stripe_release_not_sent(uuid, timestamptz)', 'execute'),
  'a signed-in person cannot clear the pin');
select ok(not has_function_privilege('anon', 'public.record_stripe_release_not_sent(uuid, timestamptz)', 'execute'),
  'nor a signed-out one');

select pg_temp.reset(false);
update public.order_payments set stripe_release_started = true, release_claimed_at = '2026-11-08 10:00:00+00' where id = '97f00000-0000-0000-0000-000000000001';
select is(public.record_stripe_release_not_sent('97f00000-0000-0000-0000-000000000001', '2026-11-08 09:00:00+00'), false, 'another claim''s time clears nothing');
select ok((select stripe_release_started from public.order_payments where id = '97f00000-0000-0000-0000-000000000001'), 'so a newer claim stays pinned');
select is(public.record_stripe_release_not_sent('97f00000-0000-0000-0000-000000000001', '2026-11-08 10:00:00+00'), true, 'the claim itself clears it');
select ok((select not stripe_release_started and release_claimed_at is null from public.order_payments where id = '97f00000-0000-0000-0000-000000000001'), 'pin and claim both gone');
select pg_temp.act_as(1); set local role authenticated;
select lives_ok($$select public.choose_payout_method('97b00000-0000-0000-0000-0000000000f1', '97a10000-0000-0000-0000-000000000001')$$,
  'so the failure no longer locks the route');
reset role;

-- ---------------------------------------------------------------------------
-- 6. Who is told
-- ---------------------------------------------------------------------------
select pg_temp.reset(false);
update public.order_payments set state = 'released', released_at = now() where id = '97f00000-0000-0000-0000-000000000001';
create temp table n97 on commit drop as select pg_temp.notices('f1') as was;
grant all on n97 to authenticated;
select pg_temp.act_as(1); set local role authenticated;
select public.choose_payout_method('97b00000-0000-0000-0000-0000000000f1', '97a10000-0000-0000-0000-000000000001');
set constraints all immediate;
set constraints all deferred;
reset role;
select is(pg_temp.notices('f1'), (select was + 1 from n97), 'Stripe to manual on the bank already primary tells the company');
-- Every notice in this transaction has the same created_at, so "last" cannot pick one here.
select ok(exists(select 1 from public.notifications n where n.org_id = '97b00000-0000-0000-0000-0000000000f1' and n.kind = 'payout_method_changed' and n.body like 'TSC now pays your bank account at P97 Bank ending 1234.%'), 'and says which');
update n97 set was = pg_temp.notices('f1');

select pg_temp.act_as(1); set local role authenticated;
select public.choose_payout_method('97b00000-0000-0000-0000-0000000000f1', null);
set constraints all immediate;
set constraints all deferred;
reset role;
select is(pg_temp.notices('f1'), (select was + 1 from n97), 'manual to Stripe tells the company');
update n97 set was = pg_temp.notices('f1');

select pg_temp.act_as(1); set local role authenticated;
select public.choose_payout_method('97b00000-0000-0000-0000-0000000000f1', null);
set constraints all immediate;
set constraints all deferred;
reset role;
select is(pg_temp.notices('f1'), (select was from n97), 'pressing the same route again says nothing');

select pg_temp.reset(true);
update public.order_payments set state = 'released', released_at = now() where id = '97f00000-0000-0000-0000-000000000001';
update n97 set was = pg_temp.notices('f1');
select pg_temp.act_as(1); set local role authenticated;
update public.factory_payout_accounts set wise_details = '{"sortCode":"999999"}' where id = '97a10000-0000-0000-0000-000000000001';
set constraints all immediate;
set constraints all deferred;
reset role;
select is(pg_temp.notices('f1'), (select was + 1 from n97), 'a new sort code on the account TSC pays tells the company');
update n97 set was = pg_temp.notices('f1');

select pg_temp.act_as(1); set local role authenticated;
update public.factory_payout_accounts set wise_number_key = 'iban' where id = '97a10000-0000-0000-0000-000000000001';
set constraints all immediate;
set constraints all deferred;
reset role;
select is(pg_temp.notices('f1'), (select was + 1 from n97), 'so does which number Wise uses');

select pg_temp.act_as(8); set local role authenticated;
insert into public.factory_payout_accounts (id, org_id, method, bank_name, account_name, account_number_last4, swift, bank_country, is_primary)
values ('97a10000-0000-0000-0000-000000000008', '97b00000-0000-0000-0000-0000000000f3', 'bank', 'Fresh Bank', 'P97 NEW', '7777', 'BOSHCNSH', 'US', true);
set constraints all immediate;
set constraints all deferred;
reset role;
select is(pg_temp.notices('f3'), 1, 'a Stripe-paid factory adding its first bank is told');
select ok(pg_temp.last_notice('f3') not like 'TSC now pays%', 'but not that TSC now pays it');

-- ---------------------------------------------------------------------------
-- 5. The last manual account (uses the factory above)
-- ---------------------------------------------------------------------------
insert into public.factory_payout_preferences (org_id, route) values ('97b00000-0000-0000-0000-0000000000f3', 'manual');
select ok(not public.uses_stripe_payout('97b00000-0000-0000-0000-0000000000f3'), 'on manual, Stripe does not pay');
select pg_temp.act_as(8); set local role authenticated;
select lives_ok($$select public.remove_payout_account('97a10000-0000-0000-0000-000000000008', null)$$, 'the last manual account can be removed');
reset role;
select is((select count(*)::int from public.factory_payout_preferences where org_id = '97b00000-0000-0000-0000-0000000000f3'), 0, 'and the manual preference goes with it');
select ok(public.uses_stripe_payout('97b00000-0000-0000-0000-0000000000f3'), 'so Stripe pays again');
select ok(not public.factory_has_no_payout_method('97b00000-0000-0000-0000-0000000000f3'), 'and the factory is not left with nothing');

select pg_temp.reset(true);
select pg_temp.act_as(1); set local role authenticated;
select throws_ok($$select public.remove_payout_account('97a10000-0000-0000-0000-000000000001', null)$$, 'P0001', null, 'with money owed the account cannot go');
reset role;
select is((select route from public.factory_payout_preferences where org_id = '97b00000-0000-0000-0000-0000000000f1'), 'manual', 'and the preference stays');

-- ---------------------------------------------------------------------------
-- 7. What can join a message
-- ---------------------------------------------------------------------------
select pg_temp.act_as(1); set local role authenticated;
select throws_ok($$update public.documents set message_id = '97920000-0000-0000-0000-000000000001' where id = '97930000-0000-0000-0000-000000000001'$$, '42501', null,
  'a file cannot join a message already delivered');
select throws_ok($$update public.documents set message_id = '97920000-0000-0000-0000-000000000002' where id = '97930000-0000-0000-0000-000000000001'$$, '42501', null,
  'nor someone else''s message');
select throws_ok($$insert into public.documents (org_id, kind, bucket, storage_path, file_name, message_id)
  values ('97b00000-0000-0000-0000-0000000000f1', 'message_attachment', 'org-private', 'p97/three.pdf', 'wechat abc.pdf', '97920000-0000-0000-0000-000000000001')$$, '42501', null,
  'nor be created on a delivered one');
select lives_ok($$update public.documents set message_id = '97920000-0000-0000-0000-000000000003' where id = '97930000-0000-0000-0000-000000000002'$$,
  'the sender attaches a file while its message is being checked');
reset role;
update public.messages set delivery = 'delivered', delivered_at = now() where id = '97920000-0000-0000-0000-000000000003';
select pg_temp.act_as(1); set local role authenticated;
select throws_ok($$update public.documents set file_name = 'wechat abc.pdf' where id = '97930000-0000-0000-0000-000000000002'$$, '42501', null,
  'and cannot rename it once the message has been delivered');
reset role;
select is((select file_name from public.documents where id = '97930000-0000-0000-0000-000000000002'), 'two.pdf', 'the name is unchanged');

-- ---------------------------------------------------------------------------
-- 9/10. Grants the policies were relying on
-- ---------------------------------------------------------------------------
select ok(not has_table_privilege('authenticated', 'public.legal_documents', 'truncate'), 'legal documents: no truncate');
select ok(not has_table_privilege('authenticated', 'public.legal_documents', 'update'), 'legal documents: no update');
select ok(not has_table_privilege('authenticated', 'public.terms_acceptances', 'update'), 'signatures: no update');
select ok(not has_table_privilege('authenticated', 'public.terms_acceptances', 'truncate'), 'signatures: no truncate');
select ok(has_table_privilege('authenticated', 'public.terms_acceptances', 'insert'), 'signatures: signing still works');
select ok(not has_table_privilege('authenticated', 'public.messages', 'update'), 'messages: no update');
select ok(not has_table_privilege('authenticated', 'public.messages', 'delete'), 'messages: no delete');
select ok(has_table_privilege('authenticated', 'public.messages', 'insert'), 'messages: sending still works');

-- ---------------------------------------------------------------------------
-- 8. A refund made outside Stripe, and who reads why one failed
-- ---------------------------------------------------------------------------
select public.claim_cancellation_refund('97f00000-0000-0000-0000-000000000003');
select ok((select refund_failed_at is not null and refund_failure is null from public.order_payments where id = '97f00000-0000-0000-0000-000000000003'),
  'the refund failed, and the sentence is not on the row both companies read');
select pg_temp.act_as(3); set local role authenticated;
select is((select count(*)::int from public.order_payments where id = '97f00000-0000-0000-0000-000000000003' and refund_failure is null), 1, 'the brand reads no reason');
select throws_ok($$select count(*) from public.payment_refund_staff_notes$$, '42501', null, 'and cannot read the staff table');
select throws_ok($$select public.record_refund_outside_stripe('97f00000-0000-0000-0000-000000000003', 'WIRE-1')$$, '42501', null, 'the brand cannot record its own refund');
reset role;
select pg_temp.act_as(4); set local role authenticated;
select throws_ok($$select public.record_refund_outside_stripe('97f00000-0000-0000-0000-000000000003', 'WIRE-1')$$, '42501', null, 'nor can a stranger');
reset role;
select pg_temp.act_as(7); set local role authenticated;
select throws_ok($$select public.record_refund_outside_stripe('97f00000-0000-0000-0000-000000000003', 'WIRE-1')$$, '42501', null, 'nor staff who belong to a company on the order');
reset role;
select pg_temp.act_as(5); set local role authenticated;
select throws_ok($$select public.record_refund_outside_stripe('97f00000-0000-0000-0000-000000000099', 'WIRE-1')$$, 'P0002', null, 'an unknown payment is named as such');
select throws_ok($$select public.record_refund_outside_stripe('97f00000-0000-0000-0000-000000000001', 'WIRE-1')$$, '22023', null, 'a payment with no failed refund is refused');
select throws_ok($$select public.record_refund_outside_stripe('97f00000-0000-0000-0000-000000000003', ' ')$$, '22023', null, 'a reference is required');
select is((select refund_failure from public.admin_payment_board() where payment_id = '97f00000-0000-0000-0000-000000000003'),
  'Held with no Stripe charge to refund (an old bank transfer): refund the brand by bank.', 'staff still read why it failed');
select lives_ok($$select public.record_refund_outside_stripe('97f00000-0000-0000-0000-000000000003', 'WIRE-123')$$, 'staff record the refund');
select is((select count(*)::int from public.admin_payment_board() where payment_id = '97f00000-0000-0000-0000-000000000003'), 0, 'and it leaves the board');
select throws_ok($$select public.record_refund_outside_stripe('97f00000-0000-0000-0000-000000000003', 'WIRE-123')$$, '22023', null, 'and cannot be recorded twice');
reset role;
select is((select state::text from public.order_payments where id = '97f00000-0000-0000-0000-000000000003'), 'cancelled', 'the payment is closed');
select ok((select refunded_at is not null and refund_failed_at is null from public.order_payments where id = '97f00000-0000-0000-0000-000000000003'), 'as refunded');
select is((select count(*)::int from public.notifications where subject_id = '97f00000-0000-0000-0000-000000000003' and kind = 'payment_refunded'), 2, 'both companies are told');
select is((select outside_reference from public.payment_refund_staff_notes where payment_id = '97f00000-0000-0000-0000-000000000003'), 'WIRE-123', 'the reference is kept for staff');
select is((select count(*)::int from public.payment_events where payment_id = '97f00000-0000-0000-0000-000000000003' and note like '%WIRE%'), 0, 'and not where the companies can read it');

-- Invisible characters, as registration-number.mjs drops them.
select is(public.normalise_registration_number('CN', U&'9133\200B0100\00ADMA27\FEFF'), '91330100MA27', 'a number pasted with invisible characters reads the same as without');
select is(public.normalise_registration_number('PT', U&'\200BPT 501\2060 964 843'), '501964843', 'and the Portuguese prefix is still found');
select is(public.normalise_registration_number('CN', 'AB-12.3/4'), 'AB1234', 'ordinary separators still go');
select is(public.normalise_registration_number('CN', 'ÉA'), 'ÉA', 'and visible characters stay');

-- Pinned rows reach the board, which then offers only Retry.
select pg_temp.reset(false);
update public.order_payments set stripe_release_started = true where id = '97f00000-0000-0000-0000-000000000001';
update public.stripe_connect_accounts set transfers_active = false where org_id = '97b00000-0000-0000-0000-0000000000f1';
select pg_temp.act_as(5); set local role authenticated;
select ok((select stripe_release_started and not factory_stripe_ready from public.admin_payment_board() where payment_id = '97f00000-0000-0000-0000-000000000001'),
  'the board knows a payout is pinned even when Stripe is no longer ready');
reset role;

-- A known transfer keeps its destination while another payment follows a new default.
select pg_temp.reset(true);
insert into public.factory_payout_accounts (id, org_id, method, paypal_email, is_primary)
values ('97a10000-0000-0000-0000-000000000009', '97b00000-0000-0000-0000-0000000000f1', 'paypal', 'p97-new@example.com', false);
insert into public.provider_payouts (id,payment_id,factory_org_id,account_id,provider,paid_to,amount_cents,currency,provider_ref)
values ('97a20000-0000-0000-0000-000000000009','97f00000-0000-0000-0000-000000000001',
'97b00000-0000-0000-0000-0000000000f1','97a10000-0000-0000-0000-000000000001','wise','P97 Bank ending 1234',100000,'USD','p97-wise-transfer');
select pg_temp.act_as(1); set local role authenticated;
select lives_ok($$select public.choose_payout_method('97b00000-0000-0000-0000-0000000000f1','97a10000-0000-0000-0000-000000000009')$$,
  'a known Wise transfer does not block choosing PayPal for future payouts');
select throws_ok($$update public.factory_payout_accounts set bank_name='Changed' where id='97a10000-0000-0000-0000-000000000001'$$,
  '22023', null, 'the former default cannot be edited while its transfer runs');
select throws_ok($$select public.remove_payout_account('97a10000-0000-0000-0000-000000000001',null)$$,
  '22023', null, 'the former default cannot be deleted while its transfer runs');
select throws_ok($$select public.choose_payout_method('97b00000-0000-0000-0000-0000000000f1',null)$$,
  '22023', null, 'switching to Stripe remains blocked while a manual payment is owed');
reset role;
select throws_ok($$insert into public.payout_account_numbers(account_id,vault_secret_id)
 values ('97a10000-0000-0000-0000-000000000001','97a30000-0000-0000-0000-000000000009')$$,
 '22023', null, 'even a privileged write cannot replace the active destination number');
select is((select account_id from public.provider_payouts where id='97a20000-0000-0000-0000-000000000009'),
 '97a10000-0000-0000-0000-000000000001'::uuid,'the active transfer retains the original bank account');
select is((select paid_to from public.provider_payouts where id='97a20000-0000-0000-0000-000000000009'),
 'P97 Bank ending 1234','its displayed recipient stays pinned');
select ok((select is_primary from public.factory_payout_accounts where id='97a10000-0000-0000-0000-000000000009'),
 'new payments use the chosen PayPal destination');
set local session_replication_role = replica;
insert into public.order_milestones (id,order_id,kind,title,amount_cents)
values ('97e00000-0000-0000-0000-000000000009','97d00000-0000-0000-0000-000000000001','payment_only','P97 next payout',60);
insert into public.order_payments (id,order_id,milestone_id,amount_cents,currency,state,confirmed_at,release_requested_at)
values ('97f00000-0000-0000-0000-000000000009','97d00000-0000-0000-0000-000000000001',
'97e00000-0000-0000-0000-000000000009',60,'USD','confirmed',now(),now());
set local session_replication_role = origin;
select pg_temp.act_as(5); set local role authenticated;
select lives_ok($$select public.claim_provider_payout('97f00000-0000-0000-0000-000000000009','paypal',
 (select details_changed_at from public.factory_payout_accounts where id='97a10000-0000-0000-0000-000000000009'),false)$$,
 'staff can claim a different payment with PayPal while Wise is processing');
reset role;
select is((select account_id from public.provider_payouts where payment_id='97f00000-0000-0000-0000-000000000009'),
 '97a10000-0000-0000-0000-000000000009'::uuid,'the second payout uses the new destination');
-- End this fixture before checking the original request's uncertain outcome.
update public.provider_payouts set status='failed',failure_code='other' where payment_id='97f00000-0000-0000-0000-000000000009';
update public.provider_payouts set provider_ref=null where id='97a20000-0000-0000-0000-000000000009';
select pg_temp.act_as(1); set local role authenticated;
select throws_ok($$select public.choose_payout_method('97b00000-0000-0000-0000-0000000000f1','97a10000-0000-0000-0000-000000000001')$$,
 '22023', null, 'an uncertain provider request still locks the default');
reset role;
update public.provider_payouts set status='failed',failure_code='other' where id='97a20000-0000-0000-0000-000000000009';
select pg_temp.act_as(1); set local role authenticated;
select lives_ok($$update public.factory_payout_accounts set bank_name='P97 Updated Bank' where id='97a10000-0000-0000-0000-000000000001'$$,
 'the account can be edited after the transfer ends');
reset role;

select * from finish();
rollback;
