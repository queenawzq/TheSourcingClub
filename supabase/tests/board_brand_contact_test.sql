-- The Failed row for a refund Stripe refused: staff refund by hand, so the board
-- carries the brand's contact. Nobody but staff reads it.
begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

set local session_replication_role = replica;

insert into auth.users (id, email) values
  ('9b100000-0000-0000-0000-000000000001', 'pbc-brand-owner@example.com'),
  ('9b100000-0000-0000-0000-000000000002', 'pbc-brand-member@example.com'),
  ('9b100000-0000-0000-0000-000000000003', 'pbc-factory@example.com'),
  ('9b100000-0000-0000-0000-000000000004', 'pbc-staff@example.com');
insert into public.user_profiles (id, full_name) values ('9b100000-0000-0000-0000-000000000001', 'Pat Brandsworth')
  on conflict (id) do update set full_name = excluded.full_name;
insert into public.platform_admins (user_id, note) values ('9b100000-0000-0000-0000-000000000004', 'pgtap-brand-contact');
insert into public.orgs (id, type, name, slug) values
  ('9b200000-0000-0000-0000-00000000000b', 'brand',   'PBC Brand', 'pgtapbc-brand'),
  ('9b200000-0000-0000-0000-00000000000f', 'factory', 'PBC Mill',  'pgtapbc-mill');
insert into public.org_members (org_id, user_id, role, permissions) values
  ('9b200000-0000-0000-0000-00000000000b', '9b100000-0000-0000-0000-000000000002', 'member', '{}'),
  ('9b200000-0000-0000-0000-00000000000b', '9b100000-0000-0000-0000-000000000001', 'owner', '{}'),
  ('9b200000-0000-0000-0000-00000000000f', '9b100000-0000-0000-0000-000000000003', 'owner', '{}');
insert into public.company_contact_details (org_id, phone) values
  ('9b200000-0000-0000-0000-00000000000b', '+1 555 0100'),
  ('9b200000-0000-0000-0000-00000000000f', '+86 555 0199');
insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total) values
  ('9b300000-0000-0000-0000-000000000001', '9b200000-0000-0000-0000-00000000000b', 'PBC request', 'awarded', 'invited_only', 100);
insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity, submitted_at) values
  ('9b310000-0000-0000-0000-000000000001', '9b300000-0000-0000-0000-000000000001', '9b200000-0000-0000-0000-00000000000f', 'accepted', 100, 1, now());
insert into public.production_orders
  (id, rfq_id, quote_id, brand_org_id, factory_org_id, unit_price_cents,
   production_quantity, bulk_subtotal_cents, sample_subtotal_cents, order_total_cents, deposit_pct, balance_pct, order_number)
values
  ('9b400000-0000-0000-0000-000000000001', '9b300000-0000-0000-0000-000000000001', '9b310000-0000-0000-0000-000000000001',
   '9b200000-0000-0000-0000-00000000000b', '9b200000-0000-0000-0000-00000000000f', 1000, 1, 1000, 0, 1000, 50, 50, 'PBC-1');
update public.production_orders set status = 'cancelled' where id = '9b400000-0000-0000-0000-000000000001';
insert into public.order_milestones (id, order_id, kind, title, amount_cents) values
  ('9b500000-0000-0000-0000-000000000001', '9b400000-0000-0000-0000-000000000001', 'payment_only', 'PBC step', 100000);
insert into public.order_payments (id, order_id, milestone_id, amount_cents, currency, state, confirmed_at, refund_failed_at) values
  ('9b600000-0000-0000-0000-000000000001', '9b400000-0000-0000-0000-000000000001', '9b500000-0000-0000-0000-000000000001', 100000, 'USD', 'confirmed', now(), now());

set local session_replication_role = origin;

set local role authenticated;
set local request.jwt.claims = '{"sub":"9b100000-0000-0000-0000-000000000004","role":"authenticated"}';

select is((select brand_contact_email from public.admin_payment_board() where payment_id = '9b600000-0000-0000-0000-000000000001'),
  'pbc-brand-owner@example.com', 'staff get the brand''s owner, as the factory''s contact is chosen');
select is((select brand_contact_name from public.admin_payment_board() where payment_id = '9b600000-0000-0000-0000-000000000001'),
  'Pat Brandsworth', 'and that person''s name');
select is((select brand_contact_phone from public.admin_payment_board() where payment_id = '9b600000-0000-0000-0000-000000000001'),
  '+1 555 0100', 'and the brand''s phone, not the factory''s');
select is((select contact_email from public.admin_payment_board() where payment_id = '9b600000-0000-0000-0000-000000000001'),
  'pbc-factory@example.com', 'the factory''s contact is unchanged');
select ok((select refund_failed_at is not null from public.admin_payment_board() where payment_id = '9b600000-0000-0000-0000-000000000001'),
  'the columns from the latest definition are still there');

set local request.jwt.claims = '{"sub":"9b100000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok('select * from public.admin_payment_board()', '42501', null, 'the brand itself cannot read the board');

set local request.jwt.claims = '{"sub":"9b100000-0000-0000-0000-000000000003","role":"authenticated"}';
select throws_ok('select * from public.admin_payment_board()', '42501', null, 'neither can the factory, which would see the brand''s contact');

reset role;
set local role anon;
select throws_ok('select * from public.admin_payment_board()', '42501', null, 'nor a signed-out visitor');

select * from finish();
rollback;
