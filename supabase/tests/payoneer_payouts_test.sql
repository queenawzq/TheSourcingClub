-- ============================================================================
-- Payoneer as a manual payout method (20261104300100)
-- ----------------------------------------------------------------------------
-- Run with:  supabase test db
--
-- `pgtap31-` slugs and 31a…/31b… ids, every check scoped to these fixtures.
--
-- What this protects: a brand never reads a Payoneer email or payment ID, by
-- any route; only an owner changes the method; each method's details are
-- checked whatever the client sends; only staff who are not in the company
-- record a payout, to the address the factory has now, with an ID that cannot
-- be another factory's.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(97);

set local session_replication_role = replica;

insert into auth.users (id, email) values
  ('31a00000-0000-0000-0000-000000000001', 'p31-owner@example.com'),
  ('31a00000-0000-0000-0000-000000000002', 'p31-member@example.com'),
  ('31a00000-0000-0000-0000-000000000003', 'p31-brand@example.com'),
  ('31a00000-0000-0000-0000-000000000004', 'p31-other-owner@example.com'),
  ('31a00000-0000-0000-0000-000000000005', 'p31-staff@example.com'),
  ('31a00000-0000-0000-0000-000000000006', 'p31-staff-in-factory@example.com'),
  ('31a00000-0000-0000-0000-000000000007', 'p31-brand-and-staff@example.com');

insert into public.platform_admins (user_id, note) values
  ('31a00000-0000-0000-0000-000000000005', 'pgtap31'),
  ('31a00000-0000-0000-0000-000000000006', 'pgtap31');

insert into public.orgs (id, type, name, slug) values
  ('31b00000-0000-0000-0000-00000000000b', 'brand',   'P31 Brand',   'pgtap31-brand'),
  ('31b00000-0000-0000-0000-0000000000f1', 'factory', 'P31 Mill',    'pgtap31-mill'),
  ('31b00000-0000-0000-0000-0000000000f2', 'factory', 'P31 Other',   'pgtap31-other'),
  ('31b00000-0000-0000-0000-0000000000f3', 'factory', 'P31 Bank',    'pgtap31-bank'),
  ('31b00000-0000-0000-0000-0000000000f4', 'factory', 'P31 Stripe',  'pgtap31-stripe');

insert into public.org_members (org_id, user_id, role, permissions) values
  ('31b00000-0000-0000-0000-0000000000f1', '31a00000-0000-0000-0000-000000000001', 'owner',  '{primaryContact}'),
  ('31b00000-0000-0000-0000-0000000000f1', '31a00000-0000-0000-0000-000000000002', 'member', '{rfqFlow,addUpdate}'),
  ('31b00000-0000-0000-0000-0000000000f1', '31a00000-0000-0000-0000-000000000006', 'member', '{rfqFlow,addUpdate}'),
  ('31b00000-0000-0000-0000-00000000000b', '31a00000-0000-0000-0000-000000000003', 'owner',  '{primaryContact}'),
  ('31b00000-0000-0000-0000-0000000000f2', '31a00000-0000-0000-0000-000000000004', 'owner',  '{primaryContact}');

insert into public.stripe_connect_accounts (org_id, stripe_account_id, country, details_submitted, payouts_enabled, transfers_active) values
  ('31b00000-0000-0000-0000-0000000000f4', 'acct_p31stripe', 'GB', true, true, true);

insert into public.factory_payout_accounts (id, org_id, is_primary, method, bank_name, account_name, payoneer_email) values
  ('31c00000-0000-0000-0000-000000000002', '31b00000-0000-0000-0000-0000000000f2', true, 'payoneer', null, null, 'other@p31.example.com'),
  ('31c00000-0000-0000-0000-000000000003', '31b00000-0000-0000-0000-0000000000f3', true, 'bank', 'P31 Bank', 'P31 Bank Ltd', null),
  ('31c00000-0000-0000-0000-000000000004', '31b00000-0000-0000-0000-0000000000f4', true, 'payoneer', null, null, 'stripe@p31.example.com');

insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total) values
  ('31d00000-0000-0000-0000-000000000001', '31b00000-0000-0000-0000-00000000000b', 'P31 mill', 'awarded', 'invited_only', 100),
  ('31d00000-0000-0000-0000-000000000002', '31b00000-0000-0000-0000-00000000000b', 'P31 other', 'awarded', 'invited_only', 100),
  ('31d00000-0000-0000-0000-000000000003', '31b00000-0000-0000-0000-00000000000b', 'P31 bank', 'awarded', 'invited_only', 100),
  ('31d00000-0000-0000-0000-000000000004', '31b00000-0000-0000-0000-00000000000b', 'P31 stripe', 'awarded', 'invited_only', 100);
insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity, submitted_at) values
  ('31e00000-0000-0000-0000-000000000001', '31d00000-0000-0000-0000-000000000001', '31b00000-0000-0000-0000-0000000000f1', 'accepted', 100, 1, now()),
  ('31e00000-0000-0000-0000-000000000002', '31d00000-0000-0000-0000-000000000002', '31b00000-0000-0000-0000-0000000000f2', 'accepted', 100, 1, now()),
  ('31e00000-0000-0000-0000-000000000003', '31d00000-0000-0000-0000-000000000003', '31b00000-0000-0000-0000-0000000000f3', 'accepted', 100, 1, now()),
  ('31e00000-0000-0000-0000-000000000004', '31d00000-0000-0000-0000-000000000004', '31b00000-0000-0000-0000-0000000000f4', 'accepted', 100, 1, now());
insert into public.production_orders
  (id, rfq_id, quote_id, brand_org_id, factory_org_id, unit_price_cents,
   production_quantity, bulk_subtotal_cents, sample_subtotal_cents, order_total_cents, deposit_pct, balance_pct, order_number)
select ('31f00000-0000-0000-0000-00000000000' || n)::uuid, ('31d00000-0000-0000-0000-00000000000' || n)::uuid,
       ('31e00000-0000-0000-0000-00000000000' || n)::uuid, '31b00000-0000-0000-0000-00000000000b',
       ('31b00000-0000-0000-0000-0000000000f' || n)::uuid, 1000, 1, 1000, 0, 1000, 50, 50, 'P31-' || n
  from generate_series(1, 4) n;

insert into public.order_milestones (id, order_id, kind, title, amount_cents)
select ('31900000-0000-0000-0000-0000000000' || lpad(i::text, 2, '0'))::uuid,
       ('31f00000-0000-0000-0000-00000000000' || o)::uuid, 'payment_only', 'P31 step ' || i, 1000
  from (values (1,1),(2,1),(3,1),(4,1),(5,1),(6,2),(7,3),(8,4)) v(i, o);

-- 1-3 owed to the mill, 4 held on an unapproved Stripe charge, 5 still due.
-- 6 owed to the other factory, 7 to the bank-paid one, 8 to the one Stripe pays.
insert into public.order_payments (id, order_id, milestone_id, amount_cents, currency, state, confirmed_at, release_requested_at, stripe_charge_id, stripe_payment_intent_id)
select ('31800000-0000-0000-0000-0000000000' || lpad(i::text, 2, '0'))::uuid,
       ('31f00000-0000-0000-0000-00000000000' || o)::uuid,
       ('31900000-0000-0000-0000-0000000000' || lpad(i::text, 2, '0'))::uuid,
       1000, 'USD', st::public.payment_state, now(),
       case when approved then now() end, charge, intent
  from (values
    (1, 1, 'confirmed', true,  null, null),
    (2, 1, 'confirmed', true,  null, null),
    (3, 1, 'confirmed', true,  null, null),
    (4, 1, 'confirmed', false, 'ch_p31', 'pi_p31_4'),
    (5, 1, 'due',       false, null, null),
    (6, 2, 'confirmed', true,  null, null),
    (7, 3, 'confirmed', true,  null, null),
    (8, 4, 'confirmed', true,  'ch_p31_8', 'pi_p31_8')
  ) v(i, o, st, approved, charge, intent);

set local session_replication_role = origin;

create function pg_temp.act_as(who int) returns void language sql as $f$
  select set_config('request.jwt.claims',
    json_build_object('sub', '31a00000-0000-0000-0000-' || lpad(who::text, 12, '0'), 'role', 'authenticated')::text, true);
$f$;
grant execute on function pg_temp.act_as(int) to authenticated;

-- ---------------------- who may add one, and what it holds ----------------
reset role; select pg_temp.act_as(2); set local role authenticated;
select throws_ok(
  $$ insert into public.factory_payout_accounts (org_id, method, payoneer_email) values ('31b00000-0000-0000-0000-0000000000f1', 'payoneer', 'x@p31.example.com') $$,
  '42501', null,
  'a member cannot add a payout method'
);
reset role; select pg_temp.act_as(1); set local role authenticated;
select lives_ok(
  $$ insert into public.factory_payout_accounts (org_id, is_primary, method, payoneer_email, bank_country) values ('31b00000-0000-0000-0000-0000000000f1', true, 'payoneer', 'mill@p31.example.com', 'CN') $$,
  'the owner adds a Payoneer account'
);
select is(
  (select count(*)::int from public.notifications where org_id = '31b00000-0000-0000-0000-0000000000f1' and kind = 'payout_method_changed' and body like 'Payoneer account mill@p31.example.com was added.%'),
  1,
  'and the whole company is told'
);
select throws_ok(
  $$ insert into public.factory_payout_accounts (org_id, method, payoneer_email) values ('31b00000-0000-0000-0000-0000000000f1', 'payoneer', 'Mill@p31.example.com') $$,
  '23514', null,
  'an email in capitals is refused'
);
select throws_ok(
  $$ insert into public.factory_payout_accounts (org_id, method, payoneer_email) values ('31b00000-0000-0000-0000-0000000000f1', 'payoneer', ' mill2@p31.example.com') $$,
  '23514', null,
  'an email with a space is refused'
);
select throws_ok(
  $$ insert into public.factory_payout_accounts (org_id, method, payoneer_email) values ('31b00000-0000-0000-0000-0000000000f1', 'payoneer', 'nobody') $$,
  '23514', null,
  'an address with no domain is refused'
);
select throws_ok(
  $$ insert into public.factory_payout_accounts (org_id, method, payoneer_email) values ('31b00000-0000-0000-0000-0000000000f1', 'payoneer', '') $$,
  '23514', null,
  'a blank email is refused'
);
select throws_ok(
  $$ insert into public.factory_payout_accounts (org_id, method, payoneer_email) values ('31b00000-0000-0000-0000-0000000000f1', 'payoneer', null) $$,
  '23514', null,
  'no email is refused'
);
select throws_ok(
  $$ insert into public.factory_payout_accounts (org_id, method, payoneer_email) values ('31b00000-0000-0000-0000-0000000000f1', 'payoneer', 'mill@p31.example.com') $$,
  '23505', null,
  'the same Payoneer account twice is refused'
);
select throws_ok(
  $$ insert into public.factory_payout_accounts (org_id, method, payoneer_email, bank_name) values ('31b00000-0000-0000-0000-0000000000f1', 'payoneer', 'b@p31.example.com', 'A bank') $$,
  '23514', null,
  'a Payoneer row cannot carry bank details'
);
select throws_ok(
  $$ insert into public.factory_payout_accounts (org_id, bank_name, payoneer_email) values ('31b00000-0000-0000-0000-0000000000f1', 'A bank', 'b@p31.example.com') $$,
  '23514', null,
  'a bank row cannot carry a Payoneer email'
);
select throws_ok(
  $$ insert into public.factory_payout_accounts (org_id, account_name) values ('31b00000-0000-0000-0000-0000000000f1', 'No bank named') $$,
  '23514', null,
  'a bank row still needs a bank name'
);
select throws_ok(
  $$ insert into public.factory_payout_accounts (org_id, method, payoneer_email) values ('31b00000-0000-0000-0000-0000000000f1', 'paypal', 'b@p31.example.com') $$,
  '23514', null,
  'an unknown method is refused'
);
select throws_ok(
  $$ update public.factory_payout_accounts set method = 'bank' where org_id = '31b00000-0000-0000-0000-0000000000f1' and method = 'payoneer' $$,
  '23514', null,
  'switching the method by API still has to satisfy the checks'
);

-- ---------------------- who may read it -----------------------------------
reset role; select pg_temp.act_as(3); set local role authenticated;
select is(
  (select count(*)::int from public.factory_payout_accounts where org_id = '31b00000-0000-0000-0000-0000000000f1'),
  0,
  'a brand with payments due reads no Payoneer row'
);
reset role; select pg_temp.act_as(4); set local role authenticated;
select is(
  (select count(*)::int from public.factory_payout_accounts where org_id = '31b00000-0000-0000-0000-0000000000f1'),
  0,
  'another factory reads no Payoneer row'
);
reset role; select pg_temp.act_as(2); set local role authenticated;
select is(
  (select count(*)::int from public.factory_payout_accounts where org_id = '31b00000-0000-0000-0000-0000000000f1'),
  1,
  'a member of the company reads it'
);

-- ---------------------- who may record a payout ---------------------------
reset role; select pg_temp.act_as(1); set local role authenticated;
select throws_ok(
  $$ select public.release_payment_by_payoneer('31800000-0000-0000-0000-000000000001', 'mill@p31.example.com', 'PO-1001', null) $$,
  '42501', null,
  'the factory cannot record its own payout'
);
reset role; select pg_temp.act_as(3); set local role authenticated;
select throws_ok(
  $$ select public.release_payment_by_payoneer('31800000-0000-0000-0000-000000000001', 'mill@p31.example.com', 'PO-1001', null) $$,
  '42501', null,
  'the brand cannot record a payout'
);
select throws_ok(
  $$ select public.release_payment_by_payoneer('31800000-0000-0000-0000-000000000099', 'x@y.co', 'PO-1') $$,
  '42501', null,
  'a stranger gets 42501 for a payment that does not exist, so nothing leaks'
);
select throws_ok(
  $$ insert into public.payoneer_payouts (payment_id, factory_org_id, paid_to_email, payoneer_payment_id) values ('31800000-0000-0000-0000-000000000001', '31b00000-0000-0000-0000-0000000000f1', 'x@y.co', 'PO-1') $$,
  '42501', null,
  'nobody inserts a record directly'
);
reset role; select pg_temp.act_as(6); set local role authenticated;
select throws_ok(
  $$ select public.release_payment_by_payoneer('31800000-0000-0000-0000-000000000001', 'mill@p31.example.com', 'PO-1001', null) $$,
  '42501', 'you belong to this company, so someone else on the staff must record its payout',
  'staff who belong to the factory cannot record its payout'
);
reset role; select pg_temp.act_as(5); set local role authenticated;
select throws_ok(
  $$ insert into public.payoneer_payouts (payment_id, factory_org_id, paid_to_email, payoneer_payment_id) values ('31800000-0000-0000-0000-000000000001', '31b00000-0000-0000-0000-0000000000f1', 'x@y.co', 'PO-1') $$,
  '42501', null,
  'staff do not insert a record directly either'
);
select throws_ok(
  $$ select public.release_payment_by_payoneer('31800000-0000-0000-0000-000000000099', 'x@y.co', 'PO-1') $$,
  'P0002', null,
  'staff are told the payment does not exist'
);
select throws_ok(
  $$ select public.release_payment_by_payoneer('31800000-0000-0000-0000-000000000001', 'mill@p31.example.com', '', null) $$,
  '22023', null,
  'a blank payment ID is refused'
);
select throws_ok(
  $$ select public.release_payment_by_payoneer('31800000-0000-0000-0000-000000000001', 'mill@p31.example.com', '   ', null) $$,
  '22023', null,
  'a payment ID of spaces is refused'
);
select throws_ok(
  $$ select public.release_payment_by_payoneer('31800000-0000-0000-0000-000000000001', 'mill@p31.example.com', 'ab', null) $$,
  '22023', null,
  'a two-character ID is refused'
);
select throws_ok(
  $$ select public.release_payment_by_payoneer('31800000-0000-0000-0000-000000000001', 'mill@p31.example.com', 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', null) $$,
  '22023', null,
  'a 500-character ID is refused'
);
select throws_ok(
  $$ select public.release_payment_by_payoneer('31800000-0000-0000-0000-000000000001', 'mill@p31.example.com', '<script>', null) $$,
  '22023', null,
  'markup in the ID is refused'
);
select throws_ok(
  $$ select public.release_payment_by_payoneer('31800000-0000-0000-0000-000000000001', 'old@p31.example.com', 'PO-1001', null) $$,
  '22023', 'this factory changed where it is paid',
  'an email the factory no longer uses is refused'
);
select throws_ok(
  $$ select public.release_payment_by_payoneer('31800000-0000-0000-0000-000000000001', 'other@p31.example.com', 'PO-1001', null) $$,
  '22023', 'this factory changed where it is paid',
  'another factory''s email is refused'
);
select throws_ok(
  $$ select public.release_payment_by_payoneer('31800000-0000-0000-0000-000000000004', 'mill@p31.example.com', 'PO-1001', null) $$,
  '22023', null,
  'a Stripe charge the brand has not approved is refused'
);
select throws_ok(
  $$ select public.release_payment_by_payoneer('31800000-0000-0000-0000-000000000005', 'mill@p31.example.com', 'PO-1001', null) $$,
  '22023', null,
  'a payment not funded yet is refused'
);
select throws_ok(
  $$ select public.release_payment_by_payoneer('31800000-0000-0000-0000-000000000007', 'mill@p31.example.com', 'PO-1001', null) $$,
  '22023', 'this factory changed where it is paid',
  'a bank-paid factory is not paid by Payoneer'
);
select throws_ok(
  $$ select public.release_payment_by_payoneer('31800000-0000-0000-0000-000000000008', 'stripe@p31.example.com', 'PO-1001', null) $$,
  '22023', 'Stripe pays this factory: retry the payout instead',
  'a factory Stripe pays is retried, not marked'
);

-- ---------------------- marking it by bank instead ------------------------
select throws_ok(
  $$ select public.release_payment_to_factory('31800000-0000-0000-0000-000000000003') $$,
  '22023', null,
  'marking a Payoneer factory paid by bank needs a note'
);
select throws_ok(
  $$ select public.release_payment_to_factory('31800000-0000-0000-0000-000000000003', '   ') $$,
  '22023', null,
  'a note of spaces is no note'
);
select lives_ok(
  $$ select public.release_payment_to_factory('31800000-0000-0000-0000-000000000003', 'Paid by bank: their Payoneer was closed') $$,
  'with a note it goes'
);
select is(
  (select count(*)::int from public.payoneer_payouts where payment_id = '31800000-0000-0000-0000-000000000003'),
  0,
  'and no Payoneer payout is recorded for it'
);
select lives_ok(
  $$ select public.release_payment_to_factory('31800000-0000-0000-0000-000000000007', 'BANK-REF-7') $$,
  'a bank-paid factory is marked with its reference'
);
select throws_ok(
  $$ select public.release_payment_to_factory('31800000-0000-0000-0000-000000000007', 'from a stale tab') $$,
  '22023', 'that payout was already marked as paid',
  'a stale tab marking it by bank again is told it was already paid'
);

-- ---------------------- recording it ------------------------------------
select lives_ok(
  $$ select public.release_payment_by_payoneer('31800000-0000-0000-0000-000000000001', 'MILL@p31.example.com ', ' PO-1001 ', 'Paid from the USD balance') $$,
  'staff record a payout, whatever the case of the email'
);
select is(
  (select state::text from public.order_payments where id = '31800000-0000-0000-0000-000000000001'),
  'released',
  'the payment is released'
);
select is(
  (select paid_to_email || ' ' || payoneer_payment_id from public.payoneer_payouts where payment_id = '31800000-0000-0000-0000-000000000001'),
  'mill@p31.example.com PO-1001',
  'the email and ID are kept, trimmed'
);
select is(
  (select released_note from public.order_payments where id = '31800000-0000-0000-0000-000000000001'),
  null,
  'nothing of it lands on the row the brand can read'
);
select throws_ok(
  $$ select public.release_payment_by_payoneer('31800000-0000-0000-0000-000000000001', 'mill@p31.example.com', 'PO-1002', null) $$,
  '22023', 'that payout was already marked as paid',
  'a payout already marked is refused'
);
select lives_ok(
  $$ select public.release_payment_by_payoneer('31800000-0000-0000-0000-000000000002', 'mill@p31.example.com', 'po-1001', null) $$,
  'one Payoneer payment may cover two steps of one factory'
);
select throws_ok(
  $$ select public.release_payment_by_payoneer('31800000-0000-0000-0000-000000000006', 'other@p31.example.com', 'PO-1001', null) $$,
  '22023', 'that Payoneer payment ID is recorded for another factory',
  'the same ID for another factory is refused, in any case'
);

-- ---------------------- who reads the record ------------------------------
reset role; select pg_temp.act_as(3); set local role authenticated;
select is(
  (select count(*)::int from public.payoneer_payouts where factory_org_id = '31b00000-0000-0000-0000-0000000000f1'),
  0,
  'the brand reads no record'
);
select is(
  (select count(*)::int from public.order_payments where id = '31800000-0000-0000-0000-000000000001' and to_jsonb(order_payments)::text like '%PO-1001%'),
  0,
  'and its payment row carries no ID'
);
select is(
  (select count(*)::int from public.notifications where body like '%PO-1001%'),
  0,
  'and no notification of its own mentions it'
);
reset role; select pg_temp.act_as(4); set local role authenticated;
select is(
  (select count(*)::int from public.payoneer_payouts where factory_org_id = '31b00000-0000-0000-0000-0000000000f1'),
  0,
  'another factory reads no record'
);
reset role; select pg_temp.act_as(2); set local role authenticated;
select is(
  (select count(*)::int from public.payoneer_payouts where factory_org_id = '31b00000-0000-0000-0000-0000000000f1'),
  2,
  'a member of the factory reads its own'
);
select is(
  (select count(*)::int from public.notifications where order_id = '31f00000-0000-0000-0000-000000000001' and kind = 'funds_released' and body like '%PO-1001%'),
  1,
  'and the factory is told, with the reference'
);

-- ---------------------- changing and removing ----------------------------
reset role; select pg_temp.act_as(1); set local role authenticated;
select lives_ok(
  $$ update public.factory_payout_accounts set payoneer_email = 'new@p31.example.com' where org_id = '31b00000-0000-0000-0000-0000000000f1' and method = 'payoneer' $$,
  'the owner changes the email'
);
select is(
  (select paid_to_email from public.payoneer_payouts where payment_id = '31800000-0000-0000-0000-000000000001'),
  'mill@p31.example.com',
  'and what was paid does not change with it'
);
select is(
  (select count(*)::int from public.notifications where org_id = '31b00000-0000-0000-0000-0000000000f1' and kind = 'payout_method_changed' and body like 'The Payoneer account changed from mill@p31.example.com to new@p31.example.com.%'),
  1,
  'the company is told of the change'
);
reset role; select pg_temp.act_as(2); set local role authenticated;
select lives_ok(
  $$ update public.factory_payout_accounts set payoneer_email = 'member@p31.example.com' where org_id = '31b00000-0000-0000-0000-0000000000f1' $$,
  'a member updating it changes nothing, and is not told otherwise by the database'
);
select is(
  (select payoneer_email from public.factory_payout_accounts where org_id = '31b00000-0000-0000-0000-0000000000f1' and method = 'payoneer'),
  'new@p31.example.com',
  'so the email is still the owner''s'
);
reset role; select pg_temp.act_as(5); set local role authenticated;
select is(
  (select payout_summary || ' ' || payout_method from public.admin_payment_board() where payment_id = '31800000-0000-0000-0000-000000000006'),
  'Payoneer: other@p31.example.com payoneer',
  'the board names the Payoneer account'
);
select is(
  (select payout_summary from public.admin_payment_board() where payment_id = '31800000-0000-0000-0000-000000000004'),
  'Payoneer: new@p31.example.com',
  'the board reads the current default'
);
reset role; select pg_temp.act_as(4); set local role authenticated;
select throws_ok(
  $$ select public.remove_payout_account('31c00000-0000-0000-0000-000000000002') $$,
  'P0001', 'TSC is about to pay this account, so it cannot be removed until that payment is sent',
  'the only Payoneer account cannot be removed while a payout is owed'
);
select lives_ok(
  $$ insert into public.factory_payout_accounts (org_id, is_primary, bank_name, account_name) values ('31b00000-0000-0000-0000-0000000000f2', false, 'P31 B', 'P31 Other Ltd') $$,
  'the factory adds a bank account beside it'
);
select is(
  (select public.remove_payout_account('31c00000-0000-0000-0000-000000000002') is not null),
  true,
  'with another account, removal moves the default and goes through'
);
select is(
  (select method from public.factory_payout_accounts where org_id = '31b00000-0000-0000-0000-0000000000f2' and is_primary),
  'bank',
  'and the bank account is now the one TSC pays'
);
select is(
  (select count(*)::int from public.notifications where org_id = '31b00000-0000-0000-0000-0000000000f2' and body like 'Payoneer account other@p31.example.com was removed.%'),
  1,
  'the company is told it was removed'
);
-- notify_left_payoneer runs at the end of the transaction, and these tests
-- never commit: asking for it immediately runs what is waiting, then it goes
-- back to waiting so the next change is seen as a real one would be.
set constraints public.factory_payout_accounts_left_payoneer, public.factory_payout_accounts_default_bank_notice immediate;
set constraints public.factory_payout_accounts_left_payoneer, public.factory_payout_accounts_default_bank_notice deferred;
select is(
  (select count(*)::int from public.notifications where org_id = '31b00000-0000-0000-0000-0000000000f2' and kind = 'payout_method_changed' and body like 'TSC now pays your bank account at P31 B, instead of Payoneer account other@p31.example.com.%'),
  1,
  'removing the default Payoneer account says which bank account TSC now pays'
);
select lives_ok(
  $$ insert into public.factory_payout_accounts (org_id, method, payoneer_email) values ('31b00000-0000-0000-0000-0000000000f2', 'payoneer', 'back@p31.example.com') $$,
  'a second Payoneer account can be added'
);
select lives_ok(
  $$ select public.set_primary_payout_account((select id from public.factory_payout_accounts where payoneer_email = 'back@p31.example.com')) $$,
  'and made the default'
);
select is(
  (select count(*)::int from public.notifications where org_id = '31b00000-0000-0000-0000-0000000000f2' and body like 'TSC now pays Payoneer account back@p31.example.com.%'),
  1,
  'the company is told who TSC now pays'
);
select lives_ok(
  $$ insert into public.factory_payout_accounts (org_id, is_primary, bank_name, account_name, account_number_last4) values ('31b00000-0000-0000-0000-0000000000f2', false, 'P31 C', 'P31 Other Ltd', '1234') $$,
  'a second bank account is added'
);
select lives_ok(
  $$ select public.set_primary_payout_account((select id from public.factory_payout_accounts where bank_name = 'P31 C')) $$,
  'and the default moves from Payoneer to it'
);
set constraints public.factory_payout_accounts_left_payoneer, public.factory_payout_accounts_default_bank_notice immediate;
set constraints public.factory_payout_accounts_left_payoneer, public.factory_payout_accounts_default_bank_notice deferred;
select is(
  (select count(*)::int from public.notifications where org_id = '31b00000-0000-0000-0000-0000000000f2' and kind = 'payout_method_changed' and body like 'TSC now pays your bank account at P31 C ending 1234, instead of Payoneer account back@p31.example.com. If nobody at your company made this change,%'),
  1,
  'moving the default from Payoneer to a bank account tells the company where earnings now go'
);
select is(
  (select count(*)::int from public.notifications where org_id = '31b00000-0000-0000-0000-0000000000f2' and kind = 'payout_method_changed' and body like 'TSC now pays your bank account at P31 C%'),
  1,
  'and says it once: the bank notice does not repeat it'
);
select lives_ok(
  $$ insert into public.factory_payout_accounts (org_id, is_primary, bank_name, account_name, account_number_last4) values ('31b00000-0000-0000-0000-0000000000f2', false, 'P31 D', 'P31 Other Ltd', '5678') $$,
  'a third bank account is added'
);
set constraints public.factory_payout_accounts_left_payoneer, public.factory_payout_accounts_default_bank_notice immediate;
set constraints public.factory_payout_accounts_left_payoneer, public.factory_payout_accounts_default_bank_notice deferred;
select is(
  (select count(*)::int from public.notifications where org_id = '31b00000-0000-0000-0000-0000000000f2' and kind = 'payout_method_changed' and body like '%P31 D%'),
  0,
  'adding a bank account that is not the default says nothing'
);
select lives_ok(
  $$ select public.set_primary_payout_account((select id from public.factory_payout_accounts where bank_name = 'P31 D')) $$,
  'moving the default from one bank account to another'
);
set constraints public.factory_payout_accounts_left_payoneer, public.factory_payout_accounts_default_bank_notice immediate;
set constraints public.factory_payout_accounts_left_payoneer, public.factory_payout_accounts_default_bank_notice deferred;
select is(
  (select count(*)::int from public.notifications where org_id = '31b00000-0000-0000-0000-0000000000f2' and kind = 'payout_method_changed' and body = 'TSC now pays your bank account at P31 D ending 5678. If nobody at your company made this change, email operations@contact.sourcing-club.com now.'),
  1,
  'bank to bank tells the company, once, by bank and last four'
);
select is(
  (select public.notification_email_category(kind) from public.notifications where org_id = '31b00000-0000-0000-0000-0000000000f2' and body like 'TSC now pays your bank account at P31 D%'),
  'account',
  'and it is the kind that is always emailed'
);
select lives_ok(
  $$ select public.set_primary_payout_account((select id from public.factory_payout_accounts where bank_name = 'P31 D')) $$,
  'choosing the account that is already the default'
);
set constraints public.factory_payout_accounts_left_payoneer, public.factory_payout_accounts_default_bank_notice immediate;
set constraints public.factory_payout_accounts_left_payoneer, public.factory_payout_accounts_default_bank_notice deferred;
select is(
  (select count(*)::int from public.notifications where org_id = '31b00000-0000-0000-0000-0000000000f2' and body like 'TSC now pays your bank account at P31 D%'),
  1,
  'changes nothing and says nothing'
);
update public.factory_payout_accounts set account_number_last4 = '9999' where bank_name = 'P31 D';
set constraints public.factory_payout_accounts_left_payoneer, public.factory_payout_accounts_default_bank_notice immediate;
set constraints public.factory_payout_accounts_left_payoneer, public.factory_payout_accounts_default_bank_notice deferred;
select is(
  (select count(*)::int from public.notifications where org_id = '31b00000-0000-0000-0000-0000000000f2' and kind = 'payout_method_changed' and body like 'The bank account TSC pays changed: it is now P31 D ending 9999, in the name of P31 Other Ltd.%'),
  1,
  'editing the default bank account in place is the same swap, and is said'
);
update public.factory_payout_accounts set swift = 'P31XUS33' where bank_name = 'P31 D';
set constraints public.factory_payout_accounts_left_payoneer, public.factory_payout_accounts_default_bank_notice immediate;
set constraints public.factory_payout_accounts_left_payoneer, public.factory_payout_accounts_default_bank_notice deferred;
select is(
  (select count(*)::int from public.notifications where org_id = '31b00000-0000-0000-0000-0000000000f2' and body like 'The bank account TSC pays changed: it is now P31 D ending 9999,%'),
  2,
  'so is changing only its SWIFT code, which is where the money goes too'
);
update public.factory_payout_accounts set account_number_last4 = '1111' where bank_name = 'P31 C';
set constraints public.factory_payout_accounts_left_payoneer, public.factory_payout_accounts_default_bank_notice immediate;
set constraints public.factory_payout_accounts_left_payoneer, public.factory_payout_accounts_default_bank_notice deferred;
select is(
  (select count(*)::int from public.notifications where org_id = '31b00000-0000-0000-0000-0000000000f2' and body like '%ending 1111%'),
  0,
  'editing one that is not the default says nothing'
);
update public.factory_payout_accounts set is_primary = false where bank_name = 'P31 D';
set constraints public.factory_payout_accounts_left_payoneer, public.factory_payout_accounts_default_bank_notice immediate;
set constraints public.factory_payout_accounts_left_payoneer, public.factory_payout_accounts_default_bank_notice deferred;
select is(
  (select count(*)::int from public.notifications where org_id = '31b00000-0000-0000-0000-0000000000f2' and kind = 'payout_method_changed' and body like 'TSC no longer pays your bank account at P31 D ending 9999, and you have no default payout method.%'),
  1,
  'clearing a default bank account is said, so a two-step swap cannot pass unnoticed'
);
update public.factory_payout_accounts set is_primary = true where bank_name = 'P31 C';
set constraints public.factory_payout_accounts_left_payoneer, public.factory_payout_accounts_default_bank_notice immediate;
set constraints public.factory_payout_accounts_left_payoneer, public.factory_payout_accounts_default_bank_notice deferred;
select is(
  (select count(*)::int from public.notifications where org_id = '31b00000-0000-0000-0000-0000000000f2' and kind = 'payout_method_changed' and body like 'TSC now pays your bank account at P31 C ending 1111.%'),
  1,
  'and so is the next one taking it'
);
select lives_ok(
  $$ select public.set_primary_payout_account((select id from public.factory_payout_accounts where payoneer_email = 'back@p31.example.com')) $$,
  'back on Payoneer'
);
update public.factory_payout_accounts set is_primary = false where payoneer_email = 'back@p31.example.com';
set constraints public.factory_payout_accounts_left_payoneer, public.factory_payout_accounts_default_bank_notice immediate;
set constraints public.factory_payout_accounts_left_payoneer, public.factory_payout_accounts_default_bank_notice deferred;
select is(
  (select count(*)::int from public.notifications where org_id = '31b00000-0000-0000-0000-0000000000f2' and kind = 'payout_method_changed' and body like 'TSC no longer pays Payoneer account back@p31.example.com, and you have no default payout method.%'),
  1,
  'clearing the default by a direct update is said too'
);
reset role;

-- ---------------------- staff's bank note reaches the factory --------------
select is(
  (select body from public.notifications where subject_id = '31800000-0000-0000-0000-000000000003' and kind = 'funds_released'),
  (select format('Sent by bank transfer against P31 mill (%s). TSC''s note: Paid by bank: their Payoneer was closed', o.order_number)
     from public.order_payments p join public.production_orders o on o.id = p.order_id
    where p.id = '31800000-0000-0000-0000-000000000003'),
  'the bell and the email carry the note staff typed'
);
select ok(
  (select body like '%BANK-REF-7%' from public.notifications where subject_id = '31800000-0000-0000-0000-000000000007' and kind = 'funds_released'),
  'and the factory reads it'
);

-- ---------------------- the payout alert is always emailed -----------------
insert into public.user_profiles (id, email) values
  ('31a00000-0000-0000-0000-000000000004', 'p31-other-owner@example.com')
on conflict (id) do update set email = excluded.email;
insert into public.notification_preferences (org_id, rfq_emails, payment_emails, message_emails)
values ('31b00000-0000-0000-0000-0000000000f2', false, false, false)
on conflict (org_id) do update set rfq_emails = false, payment_emails = false, message_emails = false;

select is(public.notification_email_category('payout_method_changed'), 'account', 'a payout change has a category of its own');
select ok(public.notification_email_enabled('31b00000-0000-0000-0000-0000000000f2', 'account'), 'every switch off, and it is still on');
select ok(not public.notification_email_enabled('31b00000-0000-0000-0000-0000000000f2', 'payments'), 'the switches still work for the rest');

insert into public.notifications (org_id, kind, title, body)
values ('31b00000-0000-0000-0000-0000000000f2', 'payout_method_changed', 'P31 alert', 'P31 alert body');
select is(
  (select count(*)::int from public.notification_email_outbox o join public.notifications n on n.id = o.notification_id
    where n.org_id = '31b00000-0000-0000-0000-0000000000f2' and n.title = 'P31 alert'
      and o.category = 'account' and o.status = 'pending' and o.recipient_user_id = '31a00000-0000-0000-0000-000000000004'),
  1,
  'it is queued for the member with every switch off'
);
select lives_ok($$ select count(*) from public.claim_notification_emails(100) $$, 'claiming the queue');
select is(
  (select count(*)::int from public.notification_email_outbox o join public.notifications n on n.id = o.notification_id
    where n.title = 'P31 alert' and o.status = 'skipped'),
  0,
  'and the sender does not skip it as switched off'
);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"31a00000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok(
  $$ select public.set_notification_preference('31b00000-0000-0000-0000-0000000000f2', 'account', false) $$,
  '22023', 'unknown email setting',
  'a company cannot turn it off'
);
reset role;

select * from finish();
rollback;
