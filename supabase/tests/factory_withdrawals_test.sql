begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

set local session_replication_role = replica;

insert into auth.users (id, email) values
  ('97a00000-0000-0000-0000-000000000001', 'p97-factory@example.com'),
  ('97a00000-0000-0000-0000-000000000003', 'p97-brand@example.com'),
  ('97a00000-0000-0000-0000-000000000004', 'p97-stranger@example.com'),
  ('97a00000-0000-0000-0000-000000000005', 'p97-staff@example.com'),
  ('97a00000-0000-0000-0000-000000000006', 'p97-staff-in-factory@example.com'),
  ('97a00000-0000-0000-0000-000000000007', 'p97-staff-in-brand@example.com');

insert into public.platform_admins (user_id, note) values
  ('97a00000-0000-0000-0000-000000000005', 'pgtap97'),
  ('97a00000-0000-0000-0000-000000000006', 'pgtap97'),
  ('97a00000-0000-0000-0000-000000000007', 'pgtap97');

insert into public.orgs (id, type, name, slug) values
  ('97b00000-0000-0000-0000-00000000000b', 'brand',   'P97 Brand', 'pgtap97-brand'),
  ('97b00000-0000-0000-0000-0000000000f1', 'factory', 'P97 Mill',  'pgtap97-mill');

insert into public.org_members (org_id, user_id, role, permissions) values
  ('97b00000-0000-0000-0000-0000000000f1', '97a00000-0000-0000-0000-000000000001', 'owner', '{}'),
  ('97b00000-0000-0000-0000-0000000000f1', '97a00000-0000-0000-0000-000000000006', 'member', '{}'),
  ('97b00000-0000-0000-0000-00000000000b', '97a00000-0000-0000-0000-000000000003', 'owner', '{}'),
  ('97b00000-0000-0000-0000-00000000000b', '97a00000-0000-0000-0000-000000000007', 'member', '{}');

insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total)
values ('97c00000-0000-0000-0000-000000000001', '97b00000-0000-0000-0000-00000000000b', 'P97 request', 'awarded', 'invited_only', 100);
insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity, submitted_at)
values ('97c00000-0000-0000-0000-000000000002', '97c00000-0000-0000-0000-000000000001', '97b00000-0000-0000-0000-0000000000f1', 'accepted', 100, 1, now());
insert into public.production_orders
  (id, rfq_id, quote_id, brand_org_id, factory_org_id, unit_price_cents,
   production_quantity, bulk_subtotal_cents, sample_subtotal_cents, order_total_cents, deposit_pct, balance_pct, order_number)
values ('97d00000-0000-0000-0000-000000000001', '97c00000-0000-0000-0000-000000000001', '97c00000-0000-0000-0000-000000000002',
        '97b00000-0000-0000-0000-00000000000b', '97b00000-0000-0000-0000-0000000000f1', 1000, 1, 1000, 0, 1000, 50, 50, 'P97-1');
insert into public.order_milestones (id, order_id, kind, title, amount_cents)
select ('97e00000-0000-0000-0000-00000000000' || n)::uuid, '97d00000-0000-0000-0000-000000000001', 'payment_only', 'P97 step ' || n, 100000
  from generate_series(1, 4) n;
insert into public.order_payments (id, order_id, milestone_id, amount_cents, currency, state, confirmed_at, release_requested_at)
select ('97f00000-0000-0000-0000-00000000000' || n)::uuid, '97d00000-0000-0000-0000-000000000001',
       ('97e00000-0000-0000-0000-00000000000' || n)::uuid, 100000, 'USD', 'confirmed', now(),
       case when n = 4 then null else now() end
  from generate_series(1, 4) n;

insert into public.factory_payout_accounts
  (id, org_id, method, bank_name, account_name, account_number_last4, swift, bank_country, is_primary,
   wise_recipient_type, wise_currency, wise_number_key, wise_details, details_changed_at)
values ('97a10000-0000-0000-0000-000000000001', '97b00000-0000-0000-0000-0000000000f1', 'bank', 'Demo Bank', 'P97 MILL LTD', '1234', 'BOSHCNSH', 'CN', true,
        'chinese_local_business', 'CNY', 'accountNumber', '{"accountHolderName":"P97 MILL LTD"}', '2026-11-01 00:00:00+00');

update public.factory_payout_accounts set number_changed_at=now() where org_id='97b00000-0000-0000-0000-0000000000f1';
insert into public.stripe_connect_accounts(org_id,stripe_account_id,country,transfers_active) values('97b00000-0000-0000-0000-0000000000f1','acct_route_fake','US',true);
update public.order_payments set stripe_payment_intent_id='pi_route_fake_' || id::text where order_id='97d00000-0000-0000-0000-000000000001';
-- Legacy already-owed payments retain the pre-withdrawal reconciliation paths.


set local session_replication_role = origin;

create function pg_temp.act_as(who int) returns void language sql as $f$
  select set_config('request.jwt.claims',
    json_build_object('sub', '97a00000-0000-0000-0000-' || lpad(who::text, 12, '0'), 'role', 'authenticated')::text, true);
$f$;
grant execute on function pg_temp.act_as(int) to authenticated, anon, service_role;

create function pg_temp.lapse() returns void language sql as $f$
  update public.provider_payout_attempts set lease_until = now() - interval '1 second'
   where payout_id in (select id from public.provider_payouts where factory_org_id = '97b00000-0000-0000-0000-0000000000f1');
$f$;



update public.stripe_connect_accounts set payouts_enabled=true where org_id='97b00000-0000-0000-0000-0000000000f1';
set local session_replication_role=replica;
insert into public.factory_payout_accounts(id,org_id,method,paypal_email,is_primary,details_changed_at)
values('97a10000-0000-0000-0000-000000000002','97b00000-0000-0000-0000-0000000000f1','paypal','withdraw-test@example.com',false,'2026-11-02 00:00:00+00');
-- One approved and one unapproved earning. Other fixtures aren't eligible.
update public.order_payments set release_requested_at=null where id in ('97f00000-0000-0000-0000-000000000002','97f00000-0000-0000-0000-000000000003');
set local session_replication_role=origin;
select ok(not public.payment_uses_stripe_payout('97f00000-0000-0000-0000-000000000001'),'approval never automatically selects Stripe');
select is(public.claim_payment_release('97f00000-0000-0000-0000-000000000001'),null::timestamptz,'automatic Stripe claim refuses new approved earnings');
create function pg_temp.request_paypal() returns public.factory_withdrawals language sql as $f$
select public.request_factory_withdrawal('97b00000-0000-0000-0000-0000000000f1','97000000-0000-0000-0000-000000000001','paypal','97a10000-0000-0000-0000-000000000002',null,false,100000);
$f$;
grant execute on function pg_temp.request_paypal() to authenticated,anon;
set local role anon;
select throws_ok($$select pg_temp.request_paypal()$$,'42501',null,'signed out cannot request a withdrawal');
reset role;select pg_temp.act_as(4);set local role authenticated;
select throws_ok($$select pg_temp.request_paypal()$$,'42501',null,'stranger cannot withdraw');
reset role;select pg_temp.act_as(3);set local role authenticated;
select throws_ok($$select pg_temp.request_paypal()$$,'42501',null,'brand cannot withdraw factory funds');
reset role;select pg_temp.act_as(6);set local role authenticated;
select throws_ok($$select pg_temp.request_paypal()$$,'42501',null,'non-owner factory member cannot withdraw');
reset role;select pg_temp.act_as(1);set local role authenticated;
select throws_ok($$insert into public.factory_withdrawals(id,org_id,requested_by,provider,amount_cents,stripe_method_id) values(gen_random_uuid(),'97b00000-0000-0000-0000-0000000000f1','97a00000-0000-0000-0000-000000000001','stripe',1,'ba_fake')$$,'42501',null,'owner cannot forge withdrawal amounts');
select throws_ok($$select public.request_factory_withdrawal('97b00000-0000-0000-0000-0000000000f1',gen_random_uuid(),'paypal','97000000-0000-0000-0000-000000000000')$$,'22023',null,'unknown or other-company destination refused');
select throws_ok($$select public.request_factory_withdrawal('97b00000-0000-0000-0000-0000000000f1',gen_random_uuid(),'paypal','97a10000-0000-0000-0000-000000000002',null,false,1)$$,'22023',null,'stale or forged displayed amount is refused');
select lives_ok($$select pg_temp.request_paypal()$$,'owner requests PayPal even when Stripe is default');
select is((select amount_cents from public.factory_withdrawals where id='97000000-0000-0000-0000-000000000001'),100000::bigint,'database computes approved total, excludes unapproved money');
select is((select count(*)::int from public.factory_withdrawal_items),1,'only the approved earning is reserved');
select lives_ok($$select pg_temp.request_paypal()$$,'double click returns the same request');
select throws_ok($$select public.request_factory_withdrawal('97b00000-0000-0000-0000-0000000000f1','97000000-0000-0000-0000-000000000001','stripe',null,'ba_other')$$,'22023',null,'retry cannot change destination');
select throws_ok($$select public.request_factory_withdrawal('97b00000-0000-0000-0000-0000000000f1',gen_random_uuid(),'paypal','97a10000-0000-0000-0000-000000000002')$$,'22023',null,'new key cannot reserve the same money twice');
select throws_ok($$update public.factory_payout_accounts set paypal_email='other@example.com' where id='97a10000-0000-0000-0000-000000000002'$$,'22023',null,'selected destination cannot change while sending');
select throws_ok($$select public.claim_provider_payout('97f00000-0000-0000-0000-000000000001','paypal','2026-11-02',false)$$,'42501',null,'owner cannot forge a provider execution');
reset role;select pg_temp.act_as(4);set local role authenticated;
select is((select count(*)::int from public.factory_withdrawals),0,'stranger cannot read a real request');
select is((select count(*)::int from public.factory_withdrawal_items),0,'stranger cannot read its earnings');
reset role;
select is(public.claim_payment_release('97f00000-0000-0000-0000-000000000001'),null::timestamptz,'PayPal request never falls back to Stripe');
select set_config('request.jwt.claims','{"role":"service_role"}',true);set local role service_role;
select lives_ok($$select public.claim_provider_payout('97f00000-0000-0000-0000-000000000001','paypal','2026-11-02',false)$$,'server executes explicitly requested non-primary PayPal destination');
select is((select account_id from public.provider_payouts where payment_id='97f00000-0000-0000-0000-000000000001'),'97a10000-0000-0000-0000-000000000002'::uuid,'provider claim uses selected account, not global default');
select throws_ok($$select public.claim_provider_payout('97f00000-0000-0000-0000-000000000002','paypal','2026-11-02',false)$$,'42501',null,'service cannot pay an unrequested earning through this entry point');
select throws_ok($$update public.order_payments set state='released' where id='97f00000-0000-0000-0000-000000000001'$$,'22023',null,'manual mark-paid cannot bypass selected provider confirmation');
select lives_ok($$select public.finish_provider_payout((select id from public.provider_payouts where payment_id='97f00000-0000-0000-0000-000000000001'),'paid')$$,'provider confirmation completes an owner-requested withdrawal');
select is((select state::text from public.order_payments where id='97f00000-0000-0000-0000-000000000001'),'released','only confirmed provider outcome releases the earning');
reset role;

-- A later approved earning can choose a different rail without changing defaults.
reset role;set local session_replication_role=replica;
update public.order_payments set release_requested_at=now() where id='97f00000-0000-0000-0000-000000000002';
set local session_replication_role=origin;
select pg_temp.act_as(1);set local role authenticated;
select lives_ok($$select public.request_factory_withdrawal('97b00000-0000-0000-0000-0000000000f1','97000000-0000-0000-0000-000000000002','stripe',null,'ba_ownerselected',false,100000)$$,'owner can select a specific Stripe bank for a later earning');
reset role;
select ok(public.payment_uses_stripe_payout('97f00000-0000-0000-0000-000000000002'),'only the explicitly requested earning is Stripe-payable');
select ok(public.claim_payment_release('97f00000-0000-0000-0000-000000000002') is not null,'Stripe can atomically claim the requested earning');
select set_config('request.jwt.claims','{"role":"service_role"}',true);set local role service_role;
select throws_ok($$select public.claim_provider_payout('97f00000-0000-0000-0000-000000000002','paypal','2026-11-02',false)$$,'42501',null,'cannot send requested Stripe money through PayPal');
reset role;set local session_replication_role=replica;
update public.order_payments set release_requested_at=now() where id='97f00000-0000-0000-0000-000000000003';
set local session_replication_role=origin;
select pg_temp.act_as(1);set local role authenticated;
select throws_ok($$select public.request_factory_withdrawal('97b00000-0000-0000-0000-0000000000f1','97000000-0000-0000-0000-000000000003','wise','97a10000-0000-0000-0000-000000000001',null,false)$$,'22023',null,'CNY route requires owner confirmation');
select lives_ok($$select public.request_factory_withdrawal('97b00000-0000-0000-0000-0000000000f1','97000000-0000-0000-0000-000000000003','wise','97a10000-0000-0000-0000-000000000001',null,true,100000)$$,'owner can explicitly choose Wise');
reset role;select set_config('request.jwt.claims','{"role":"service_role"}',true);set local role service_role;
select lives_ok($$select public.claim_provider_payout('97f00000-0000-0000-0000-000000000003','wise','2026-11-01',true)$$,'server can claim the chosen Wise route');
reset role;
select is(public.claim_payment_release('97f00000-0000-0000-0000-000000000003'),null::timestamptz,'Wise request cannot enter Stripe');
select * from finish();
rollback;
