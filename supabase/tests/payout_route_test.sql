begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

set local session_replication_role = replica;

insert into auth.users (id, email) values
  ('96a00000-0000-0000-0000-000000000001', 'p96-factory@example.com'),
  ('96a00000-0000-0000-0000-000000000003', 'p96-brand@example.com'),
  ('96a00000-0000-0000-0000-000000000004', 'p96-stranger@example.com'),
  ('96a00000-0000-0000-0000-000000000005', 'p96-staff@example.com'),
  ('96a00000-0000-0000-0000-000000000006', 'p96-staff-in-factory@example.com'),
  ('96a00000-0000-0000-0000-000000000007', 'p96-staff-in-brand@example.com');

insert into public.platform_admins (user_id, note) values
  ('96a00000-0000-0000-0000-000000000005', 'pgtap96'),
  ('96a00000-0000-0000-0000-000000000006', 'pgtap96'),
  ('96a00000-0000-0000-0000-000000000007', 'pgtap96');

insert into public.orgs (id, type, name, slug) values
  ('96b00000-0000-0000-0000-00000000000b', 'brand',   'P96 Brand', 'pgtap96-brand'),
  ('96b00000-0000-0000-0000-0000000000f1', 'factory', 'P96 Mill',  'pgtap96-mill');

insert into public.org_members (org_id, user_id, role, permissions) values
  ('96b00000-0000-0000-0000-0000000000f1', '96a00000-0000-0000-0000-000000000001', 'owner', '{}'),
  ('96b00000-0000-0000-0000-0000000000f1', '96a00000-0000-0000-0000-000000000006', 'member', '{}'),
  ('96b00000-0000-0000-0000-00000000000b', '96a00000-0000-0000-0000-000000000003', 'owner', '{}'),
  ('96b00000-0000-0000-0000-00000000000b', '96a00000-0000-0000-0000-000000000007', 'member', '{}');

insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total)
values ('96c00000-0000-0000-0000-000000000001', '96b00000-0000-0000-0000-00000000000b', 'P96 request', 'awarded', 'invited_only', 100);
insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity, submitted_at)
values ('96c00000-0000-0000-0000-000000000002', '96c00000-0000-0000-0000-000000000001', '96b00000-0000-0000-0000-0000000000f1', 'accepted', 100, 1, now());
insert into public.production_orders
  (id, rfq_id, quote_id, brand_org_id, factory_org_id, unit_price_cents,
   production_quantity, bulk_subtotal_cents, sample_subtotal_cents, order_total_cents, deposit_pct, balance_pct, order_number)
values ('96d00000-0000-0000-0000-000000000001', '96c00000-0000-0000-0000-000000000001', '96c00000-0000-0000-0000-000000000002',
        '96b00000-0000-0000-0000-00000000000b', '96b00000-0000-0000-0000-0000000000f1', 1000, 1, 1000, 0, 1000, 50, 50, 'P96-1');
insert into public.order_milestones (id, order_id, kind, title, amount_cents)
select ('96e00000-0000-0000-0000-00000000000' || n)::uuid, '96d00000-0000-0000-0000-000000000001', 'payment_only', 'P96 step ' || n, 100000
  from generate_series(1, 4) n;
insert into public.order_payments (id, order_id, milestone_id, amount_cents, currency, state, confirmed_at, release_requested_at)
select ('96f00000-0000-0000-0000-00000000000' || n)::uuid, '96d00000-0000-0000-0000-000000000001',
       ('96e00000-0000-0000-0000-00000000000' || n)::uuid, 100000, 'USD', 'confirmed', now(),
       case when n = 4 then null else now() end
  from generate_series(1, 4) n;

insert into public.factory_payout_accounts
  (id, org_id, method, bank_name, account_name, account_number_last4, swift, bank_country, is_primary,
   wise_recipient_type, wise_currency, wise_number_key, wise_details, details_changed_at)
values ('96a10000-0000-0000-0000-000000000001', '96b00000-0000-0000-0000-0000000000f1', 'bank', 'Demo Bank', 'P96 MILL LTD', '1234', 'BOSHCNSH', 'CN', true,
        'chinese_local_business', 'CNY', 'accountNumber', '{"accountHolderName":"P96 MILL LTD"}', '2026-11-01 00:00:00+00');

update public.factory_payout_accounts set number_changed_at=now() where org_id='96b00000-0000-0000-0000-0000000000f1';
insert into public.stripe_connect_accounts(org_id,stripe_account_id,country,transfers_active) values('96b00000-0000-0000-0000-0000000000f1','acct_route_fake','US',true);
update public.order_payments set stripe_payment_intent_id='pi_route_fake_' || id::text where order_id='96d00000-0000-0000-0000-000000000001';
-- Legacy already-owed payments retain the pre-withdrawal reconciliation paths.
update public.order_payments set withdrawal_required=false where id::text like '96f00000-%';

set local session_replication_role = origin;

create function pg_temp.act_as(who int) returns void language sql as $f$
  select set_config('request.jwt.claims',
    json_build_object('sub', '96a00000-0000-0000-0000-' || lpad(who::text, 12, '0'), 'role', 'authenticated')::text, true);
$f$;
grant execute on function pg_temp.act_as(int) to authenticated, anon, service_role;

create function pg_temp.lapse() returns void language sql as $f$
  update public.provider_payout_attempts set lease_until = now() - interval '1 second'
   where payout_id in (select id from public.provider_payouts where factory_org_id = '96b00000-0000-0000-0000-0000000000f1');
$f$;


select ok(public.uses_stripe_payout('96b00000-0000-0000-0000-0000000000f1'), 'existing accounts retain Stripe by default');
set local role anon;
select throws_ok($$select public.choose_payout_method('96b00000-0000-0000-0000-0000000000f1',null)$$,'42501',null,'signed out cannot switch');
reset role; select pg_temp.act_as(4); set local role authenticated;
select is((select count(*)::int from public.factory_payout_preferences),0,'stranger cannot read preferences');
select throws_ok($$select public.choose_payout_method('96b00000-0000-0000-0000-0000000000f1',null)$$,'42501',null,'stranger cannot switch');
reset role; select pg_temp.act_as(6); set local role authenticated;
select throws_ok($$select public.choose_payout_method('96b00000-0000-0000-0000-0000000000f1',null)$$,'42501',null,'member cannot switch even if staff');
reset role; select pg_temp.act_as(1); set local role authenticated;
select throws_ok($$insert into public.factory_payout_preferences(org_id,route) values('96b00000-0000-0000-0000-0000000000f1','manual')$$,'42501',null,'owner cannot bypass RPC');
select throws_ok($$select public.choose_payout_method('96b00000-0000-0000-0000-0000000000f1','96000000-0000-0000-0000-000000000000')$$,'22023',null,'unknown or other-company account refused');
select lives_ok($$select public.choose_payout_method('96b00000-0000-0000-0000-0000000000f1','96a10000-0000-0000-0000-000000000001')$$,'owner selects saved bank transfer');
select is((select route from public.factory_payout_preferences where org_id='96b00000-0000-0000-0000-0000000000f1'),'manual','selection persisted');
reset role;
select ok(not public.uses_stripe_payout('96b00000-0000-0000-0000-0000000000f1'),'manual default overrides ready Stripe account');
select is(public.claim_payment_release('96f00000-0000-0000-0000-000000000001'),null::timestamptz,'Stripe cannot claim manual payout');
select pg_temp.act_as(5); set local role authenticated;
select lives_ok($$select public.claim_provider_payout('96f00000-0000-0000-0000-000000000001','wise','2026-11-01 00:00:00+00',true)$$,'staff can pay Wise despite active Stripe');
select is((select factory_stripe_ready from public.admin_payment_board() where payment_id='96f00000-0000-0000-0000-000000000001'),false,'staff board routes to selected provider');
reset role; select pg_temp.act_as(1); set local role authenticated;
select throws_ok($$select public.choose_payout_method('96b00000-0000-0000-0000-0000000000f1',null)$$,'22023',null,'cannot switch while provider owns payout');
reset role;
update public.provider_payouts set status='cancelled' where payment_id='96f00000-0000-0000-0000-000000000001';
select pg_temp.act_as(1); set local role authenticated;
select lives_ok($$select public.choose_payout_method('96b00000-0000-0000-0000-0000000000f1',null)$$,'can switch back to Stripe after attempt ends');
reset role;
select ok(public.claim_payment_release('96f00000-0000-0000-0000-000000000002') is not null,'Stripe can claim after switching back');
select pg_temp.act_as(1); set local role authenticated;
select throws_ok($$select public.choose_payout_method('96b00000-0000-0000-0000-0000000000f1','96a10000-0000-0000-0000-000000000001')$$,'22023',null,'cannot switch while Stripe owns payout');
reset role;
update public.order_payments set release_claimed_at=null where id='96f00000-0000-0000-0000-000000000002';
select pg_temp.act_as(1); set local role authenticated;
select throws_ok($$select public.choose_payout_method('96b00000-0000-0000-0000-0000000000f1','96a10000-0000-0000-0000-000000000001')$$,'22023',null,'lost Stripe response stays pinned even after lease clears');
reset role;

select pg_temp.act_as(5); set local role authenticated;
select throws_ok($$select public.claim_provider_payout('96f00000-0000-0000-0000-000000000002','wise','2026-11-01 00:00:00+00',true)$$,'22023',null,'Wise cannot claim a Stripe-routed payout');
reset role;

select pg_temp.act_as(4); set local role authenticated;
select is((select count(*)::int from public.factory_payout_preferences where org_id='96b00000-0000-0000-0000-0000000000f1'),0,'stranger cannot read existing preference');
select throws_ok($$update public.factory_payout_preferences set route='manual' where org_id='96b00000-0000-0000-0000-0000000000f1'$$,'42501',null,'direct preference update refused');
reset role;
set local session_replication_role=replica;
insert into public.factory_payout_accounts(id,org_id,method,paypal_email,is_primary,details_changed_at) values('96a10000-0000-0000-0000-000000000002','96b00000-0000-0000-0000-0000000000f1','paypal','payout-route@example.com',false,'2026-11-01 00:00:00+00');
update public.order_payments set state='released',released_at=now(),stripe_transfer_id='tr_existing_route_test' where id='96f00000-0000-0000-0000-000000000003';
update public.order_payments set state='released',released_at=now(),stripe_transfer_id='tr_completed_route_test' where id='96f00000-0000-0000-0000-000000000002';
set local session_replication_role=origin;
select pg_temp.act_as(1); set local role authenticated;
select lives_ok($$select public.choose_payout_method('96b00000-0000-0000-0000-0000000000f1','96a10000-0000-0000-0000-000000000002')$$,'owner switches active Stripe factory to PayPal');
reset role;
select is((select stripe_transfer_id from public.order_payments where id='96f00000-0000-0000-0000-000000000003'),'tr_existing_route_test','existing Stripe transfer is not rewritten');
select is(public.claim_payment_release('96f00000-0000-0000-0000-000000000001'),null::timestamptz,'Stripe cannot claim PayPal default');
select pg_temp.act_as(5); set local role authenticated;
select lives_ok($$select public.claim_provider_payout('96f00000-0000-0000-0000-000000000001','paypal',(select details_changed_at from public.factory_payout_accounts where id='96a10000-0000-0000-0000-000000000002'),false)$$,'staff can claim PayPal payout for active Stripe factory');
reset role;
select * from finish();
rollback;
