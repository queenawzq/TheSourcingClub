begin;
create extension if not exists pgtap with schema extensions;
select plan(8);
set local session_replication_role = replica;

insert into auth.users (id, email) values
  ('33a00000-0000-0000-0000-000000000001', 'p33-owner@example.com'),
  ('33a00000-0000-0000-0000-000000000002', 'p33-member@example.com'),
  ('33a00000-0000-0000-0000-000000000003', 'p33-owed-owner@example.com');

insert into public.orgs (id, type, name, slug) values
  ('33b00000-0000-0000-0000-00000000000b', 'brand',   'P33 Brand',     'pgtap33-brand'),
  ('33b00000-0000-0000-0000-0000000000f1', 'factory', 'P33 Mill',      'pgtap33-mill'),
  ('33b00000-0000-0000-0000-0000000000f2', 'factory', 'P33 Owed Mill', 'pgtap33-owed-mill');

insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total) values
  ('33d00000-0000-0000-0000-000000000001', '33b00000-0000-0000-0000-00000000000b', 'P33 order', 'awarded', 'invited_only', 100);
insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity, submitted_at) values
  ('33e00000-0000-0000-0000-000000000001', '33d00000-0000-0000-0000-000000000001', '33b00000-0000-0000-0000-0000000000f2', 'accepted', 100, 1, now());
insert into public.production_orders
  (id, rfq_id, quote_id, brand_org_id, factory_org_id, unit_price_cents,
   production_quantity, bulk_subtotal_cents, sample_subtotal_cents, order_total_cents, deposit_pct, balance_pct)
values
  ('33f00000-0000-0000-0000-000000000001', '33d00000-0000-0000-0000-000000000001', '33e00000-0000-0000-0000-000000000001',
   '33b00000-0000-0000-0000-00000000000b', '33b00000-0000-0000-0000-0000000000f2', 50000, 1, 50000, 0, 50000, 50, 50);
insert into public.order_milestones (id, order_id, kind, title, amount_cents) values
  ('33900000-0000-0000-0000-000000000001', '33f00000-0000-0000-0000-000000000001', 'payment_only', 'P33 deposit', 50000);
insert into public.order_payments (id, order_id, milestone_id, amount_cents, currency, state, confirmed_at, release_requested_at) values
  ('33800000-0000-0000-0000-000000000001', '33f00000-0000-0000-0000-000000000001', '33900000-0000-0000-0000-000000000001', 50000, 'USD', 'confirmed', now(), now());

set local session_replication_role = origin;

insert into public.stripe_connect_accounts(org_id,stripe_account_id,country) values ('33b00000-0000-0000-0000-0000000000f2','acct_recovery_old','PT');
select public.begin_connect_upgrade('33b00000-0000-0000-0000-0000000000f2','acct_recovery_old');
select ok(public.claim_payment_release('33800000-0000-0000-0000-000000000001') is not null,'creation in progress does not freeze releases');
update public.order_payments set release_claimed_at=null where id='33800000-0000-0000-0000-000000000001';
select public.record_connect_upgrade_creation('33b00000-0000-0000-0000-0000000000f2',(select started_at from public.stripe_connect_upgrades where org_id='33b00000-0000-0000-0000-0000000000f2'),null);
select ok(public.claim_payment_release('33800000-0000-0000-0000-000000000001') is not null,'creation failure keeps releases available');
update public.order_payments set release_claimed_at=null where id='33800000-0000-0000-0000-000000000001';
select public.begin_connect_upgrade('33b00000-0000-0000-0000-0000000000f2','acct_recovery_old');
select public.record_connect_upgrade_creation('33b00000-0000-0000-0000-0000000000f2',(select started_at from public.stripe_connect_upgrades where org_id='33b00000-0000-0000-0000-0000000000f2'),'acct_recovery_new');
select ok(public.claim_payment_release('33800000-0000-0000-0000-000000000001') is null,'persisted replacement pauses future releases');
select public.record_connect_upgrade_creation('33b00000-0000-0000-0000-0000000000f2',(select started_at from public.stripe_connect_upgrades where org_id='33b00000-0000-0000-0000-0000000000f2'),null);
select is((select new_account_id from public.stripe_connect_upgrades where org_id='33b00000-0000-0000-0000-0000000000f2'),'acct_recovery_new','late failure cannot erase successful creation');
select ok(public.claim_payment_release('33800000-0000-0000-0000-000000000001') is null,'late failure cannot unpause migration');
update public.order_payments set release_claimed_at=now() where id='33800000-0000-0000-0000-000000000001';
select throws_ok($$select public.finish_connect_upgrade('33b00000-0000-0000-0000-0000000000f2','acct_recovery_new','PT',true,true,true,'{}')$$,'P0001','A transfer is being reconciled. Check again once it finishes.','unresolved old transfer blocks cutover');
update public.order_payments set release_claimed_at=null where id='33800000-0000-0000-0000-000000000001';
select public.finish_connect_upgrade('33b00000-0000-0000-0000-0000000000f2','acct_recovery_new','PT',true,true,true,'{}');
select ok(public.claim_payment_release('33800000-0000-0000-0000-000000000001') is not null,'completed upgrade resumes releases');
set local role authenticated;
select throws_ok($$select public.record_connect_upgrade_creation('33b00000-0000-0000-0000-0000000000f2',now(),null)$$,'42501',null,'browser cannot alter recovery state');
reset role;
select * from finish();
rollback;
