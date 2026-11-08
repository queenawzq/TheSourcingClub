begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

set local session_replication_role = replica;

insert into auth.users (id, email) values
  ('99a00000-0000-0000-0000-000000000001', 'p99-factory@example.com'),
  ('99a00000-0000-0000-0000-000000000003', 'p99-brand@example.com'),
  ('99a00000-0000-0000-0000-000000000004', 'p99-stranger@example.com'),
  ('99a00000-0000-0000-0000-000000000005', 'p99-staff@example.com'),
  ('99a00000-0000-0000-0000-000000000006', 'p99-staff-in-factory@example.com'),
  ('99a00000-0000-0000-0000-000000000007', 'p99-staff-in-brand@example.com');

insert into public.platform_admins (user_id, note) values
  ('99a00000-0000-0000-0000-000000000005', 'pgtap99'),
  ('99a00000-0000-0000-0000-000000000006', 'pgtap99'),
  ('99a00000-0000-0000-0000-000000000007', 'pgtap99');

insert into public.orgs (id, type, name, slug) values
  ('99b00000-0000-0000-0000-00000000000b', 'brand',   'P99 Brand', 'pgtap99-brand'),
  ('99b00000-0000-0000-0000-0000000000f1', 'factory', 'P99 Mill',  'pgtap99-mill');

insert into public.org_members (org_id, user_id, role, permissions) values
  ('99b00000-0000-0000-0000-0000000000f1', '99a00000-0000-0000-0000-000000000001', 'owner', '{}'),
  ('99b00000-0000-0000-0000-0000000000f1', '99a00000-0000-0000-0000-000000000006', 'member', '{}'),
  ('99b00000-0000-0000-0000-00000000000b', '99a00000-0000-0000-0000-000000000003', 'owner', '{}'),
  ('99b00000-0000-0000-0000-00000000000b', '99a00000-0000-0000-0000-000000000007', 'member', '{}');

insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total)
values ('99c00000-0000-0000-0000-000000000001', '99b00000-0000-0000-0000-00000000000b', 'P99 request', 'awarded', 'invited_only', 100);
insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity, submitted_at)
values ('99c00000-0000-0000-0000-000000000002', '99c00000-0000-0000-0000-000000000001', '99b00000-0000-0000-0000-0000000000f1', 'accepted', 100, 1, now());
insert into public.production_orders
  (id, rfq_id, quote_id, brand_org_id, factory_org_id, unit_price_cents,
   production_quantity, bulk_subtotal_cents, sample_subtotal_cents, order_total_cents, deposit_pct, balance_pct, order_number)
values ('99d00000-0000-0000-0000-000000000001', '99c00000-0000-0000-0000-000000000001', '99c00000-0000-0000-0000-000000000002',
        '99b00000-0000-0000-0000-00000000000b', '99b00000-0000-0000-0000-0000000000f1', 1000, 1, 1000, 0, 1000, 50, 50, 'P99-1');
insert into public.order_milestones (id, order_id, kind, title, amount_cents)
select ('99e00000-0000-0000-0000-00000000000' || n)::uuid, '99d00000-0000-0000-0000-000000000001', 'payment_only', 'P99 step ' || n, 100000
  from generate_series(1, 4) n;
insert into public.order_payments (id, order_id, milestone_id, amount_cents, currency, state, confirmed_at, release_requested_at)
select ('99f00000-0000-0000-0000-00000000000' || n)::uuid, '99d00000-0000-0000-0000-000000000001',
       ('99e00000-0000-0000-0000-00000000000' || n)::uuid, 100000, 'USD', 'confirmed', now(),
       case when n = 4 then null else now() end
  from generate_series(1, 4) n;

insert into public.factory_payout_accounts
  (id, org_id, method, bank_name, account_name, account_number_last4, swift, bank_country, is_primary,
   wise_recipient_type, wise_currency, wise_number_key, wise_details, details_changed_at)
values ('99a10000-0000-0000-0000-000000000001', '99b00000-0000-0000-0000-0000000000f1', 'bank', 'Demo Bank', 'P99 MILL LTD', '1234', 'BOSHCNSH', 'CN', true,
        'chinese_local_business', 'CNY', 'accountNumber', '{"accountHolderName":"P99 MILL LTD"}', '2026-11-01 00:00:00+00');

update public.factory_payout_accounts set number_changed_at=now() where org_id='99b00000-0000-0000-0000-0000000000f1';
insert into public.stripe_connect_accounts(org_id,stripe_account_id,country,transfers_active) values('99b00000-0000-0000-0000-0000000000f1','acct_route_fake','US',true);
update public.order_payments set stripe_payment_intent_id='pi_route_fake_' || id::text where order_id='99d00000-0000-0000-0000-000000000001';
-- Legacy already-owed payments retain the pre-withdrawal reconciliation paths.


set local session_replication_role = origin;

create function pg_temp.act_as(who int) returns void language sql as $f$
  select set_config('request.jwt.claims',
    json_build_object('sub', '99a00000-0000-0000-0000-' || lpad(who::text, 12, '0'), 'role', 'authenticated')::text, true);
$f$;
grant execute on function pg_temp.act_as(int) to authenticated, anon, service_role;

create function pg_temp.lapse() returns void language sql as $f$
  update public.provider_payout_attempts set lease_until = now() - interval '1 second'
   where payout_id in (select id from public.provider_payouts where factory_org_id = '99b00000-0000-0000-0000-0000000000f1');
$f$;



update public.stripe_connect_accounts set payouts_enabled=true where org_id='99b00000-0000-0000-0000-0000000000f1';
set local session_replication_role=replica;
insert into public.factory_payout_accounts(id,org_id,method,paypal_email,is_primary,details_changed_at)
values('99a10000-0000-0000-0000-000000000002','99b00000-0000-0000-0000-0000000000f1','paypal','withdraw-test@example.com',false,'2026-11-02 00:00:00+00');
-- One approved and one unapproved earning. Other fixtures aren't eligible.
update public.order_payments set release_requested_at=null where id in ('99f00000-0000-0000-0000-000000000002','99f00000-0000-0000-0000-000000000003');
set local session_replication_role=origin;

-- Funding is provider-wide by design. Account for unrelated committed demo
-- withdrawals instead of assuming this shared database has an empty balance.
create temp table fixture_funding as select public.withdrawal_funding_reserved('paypal','USD',now()-interval '5 minutes','99000000-0000-0000-0000-000000000001') as reserved;
grant select on pg_temp.fixture_funding to service_role;
create function pg_temp.request_one() returns public.factory_withdrawals language sql as $f$
  select public.request_factory_withdrawal('99b00000-0000-0000-0000-0000000000f1','99000000-0000-0000-0000-000000000001','paypal','99a10000-0000-0000-0000-000000000002',null,false,100000);
$f$;
grant execute on function pg_temp.request_one() to authenticated;
select pg_temp.act_as(1);set local role authenticated;
select lives_ok($$select pg_temp.request_one()$$,'owner queues withdrawal without sending');
select throws_ok($$select public.approve_factory_withdrawal('99000000-0000-0000-0000-000000000001','99a00000-0000-0000-0000-000000000005',999999,now(),0)$$,'42501',null,'factory cannot forge an admin balance check');
select throws_ok($$select * from public.factory_withdrawal_approvals$$,'42501',null,'factory cannot read company provider balances');
select throws_ok($$update public.factory_withdrawals set approved_at=now() where id='99000000-0000-0000-0000-000000000001'$$,'42501',null,'factory cannot mark its own request approved');
reset role;select pg_temp.act_as(5);set local role authenticated;
select throws_ok($$select public.approve_factory_withdrawal('99000000-0000-0000-0000-000000000001','99a00000-0000-0000-0000-000000000005',999999,now(),0)$$,'42501',null,'staff cannot bypass server funding verification through the Data API');
reset role;select set_config('request.jwt.claims','{"role":"service_role"}',true);set local role service_role;
select throws_ok($$select public.approve_factory_withdrawal('99000000-0000-0000-0000-000000000001','99a00000-0000-0000-0000-000000000001',999999,now(),0)$$,'42501',null,'approval records must name real platform staff');
select throws_ok($$select public.approve_factory_withdrawal('99000000-0000-0000-0000-000000000001','99a00000-0000-0000-0000-000000000006',999999,now(),0)$$,'42501',null,'staff in the factory cannot approve its funds');
select throws_ok($$select public.approve_factory_withdrawal('99000000-0000-0000-0000-000000000001','99a00000-0000-0000-0000-000000000007',999999,now(),0)$$,'42501',null,'staff in the paying brand cannot approve the payout');
select throws_ok($$select public.approve_factory_withdrawal('99000000-0000-0000-0000-000000000001','99a00000-0000-0000-0000-000000000005',100000,now(),1000)$$,'22023',null,'balance must cover PayPal payout plus fee allowance');
select throws_ok($$select public.approve_factory_withdrawal('99000000-0000-0000-0000-000000000001','99a00000-0000-0000-0000-000000000005',999999,now()-interval '4 hours',1000)$$,'22023',null,'stale balance cannot authorize payment');
select is((select approved_at from public.factory_withdrawals where id='99000000-0000-0000-0000-000000000001'),null::timestamptz,'failed checks leave request unapproved');
select lives_ok($$select public.approve_factory_withdrawal('99000000-0000-0000-0000-000000000001','99a00000-0000-0000-0000-000000000005',110000+(select reserved from pg_temp.fixture_funding),now()-interval '5 minutes',1000)$$,'funded request becomes approved');
select is((select approved_by from public.factory_withdrawal_approvals where withdrawal_id='99000000-0000-0000-0000-000000000001'),'99a00000-0000-0000-0000-000000000005'::uuid,'approval records the actual staff member');
select is(public.withdrawal_funding_reserved('paypal','USD',now()-interval '5 minutes','99000000-0000-0000-0000-000000000002'),101000::bigint+(select reserved from pg_temp.fixture_funding),'approved payout and fee reserve reduce later available funds');
select lives_ok($$select public.approve_factory_withdrawal('99000000-0000-0000-0000-000000000001','99a00000-0000-0000-0000-000000000005',0,now(),0)$$,'retrying approval is idempotent');
reset role;set local session_replication_role=replica;
update public.order_payments set release_requested_at=now() where id='99f00000-0000-0000-0000-000000000002';
set local session_replication_role=origin;
select pg_temp.act_as(1);set local role authenticated;
select lives_ok($$select public.request_factory_withdrawal('99b00000-0000-0000-0000-0000000000f1','99000000-0000-0000-0000-000000000002','paypal','99a10000-0000-0000-0000-000000000002',null,false,100000)$$,'later earning queues a separate request');
reset role;select set_config('request.jwt.claims','{"role":"service_role"}',true);set local role service_role;
select throws_ok($$select public.approve_factory_withdrawal('99000000-0000-0000-0000-000000000002','99a00000-0000-0000-0000-000000000005',110000+(select reserved from pg_temp.fixture_funding),now()-interval '5 minutes',1000)$$,'22023',null,'same reported balance cannot fund another approval');
update public.factory_withdrawals set status='paid' where id='99000000-0000-0000-0000-000000000001';
select throws_ok($$select public.approve_factory_withdrawal('99000000-0000-0000-0000-000000000002','99a00000-0000-0000-0000-000000000005',110000+(select reserved from pg_temp.fixture_funding),now()-interval '5 minutes',1000)$$,'22023',null,'stale PayPal report cannot reuse money already sent');
select lives_ok($$select public.approve_factory_withdrawal('99000000-0000-0000-0000-000000000002','99a00000-0000-0000-0000-000000000005',110000,now()+interval '1 second',1000)$$,'new funded snapshot permits the next approval');
reset role;
select * from finish();rollback;
