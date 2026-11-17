-- ============================================================================
-- Pay with Tazapay: who may press, what the account must hold, and who may read
-- the number for Tazapay (20261115600100). `pgtap-b7-` slugs, b7a…/b7b… ids,
-- every number plainly fake. Mostly refusals: the two hats, the double press, an
-- account Tazapay can't or mustn't pay, a USCC that isn't the company's own.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;

select plan(25);

set local session_replication_role = replica;

insert into auth.users (id, email) values
  ('b7a00000-0000-0000-0000-000000000001', 'pb7-factory@example.com'),
  ('b7a00000-0000-0000-0000-000000000003', 'pb7-brand@example.com'),
  ('b7a00000-0000-0000-0000-000000000005', 'pb7-staff@example.com'),
  ('b7a00000-0000-0000-0000-000000000006', 'pb7-staff-in-factory@example.com'),
  ('b7a00000-0000-0000-0000-000000000007', 'pb7-staff-in-brand@example.com');

insert into public.platform_admins (user_id, note) values
  ('b7a00000-0000-0000-0000-000000000005', 'pgtap-b7'),
  ('b7a00000-0000-0000-0000-000000000006', 'pgtap-b7'),
  ('b7a00000-0000-0000-0000-000000000007', 'pgtap-b7');

insert into public.orgs (id, type, name, slug) values
  ('b7b00000-0000-0000-0000-00000000000b', 'brand',   'PB7 Brand', 'pgtap-b7-brand'),
  ('b7b00000-0000-0000-0000-0000000000f1', 'factory', '深圳市测试服装有限公司', 'pgtap-b7-mill'),
  ('b7b00000-0000-0000-0000-0000000000f2', 'factory', 'PB7 Owed Nothing', 'pgtap-b7-nothing');

insert into public.org_members (org_id, user_id, role, permissions) values
  ('b7b00000-0000-0000-0000-0000000000f1', 'b7a00000-0000-0000-0000-000000000001', 'owner', '{}'),
  ('b7b00000-0000-0000-0000-0000000000f1', 'b7a00000-0000-0000-0000-000000000006', 'member', '{}'),
  ('b7b00000-0000-0000-0000-00000000000b', 'b7a00000-0000-0000-0000-000000000003', 'owner', '{}'),
  ('b7b00000-0000-0000-0000-00000000000b', 'b7a00000-0000-0000-0000-000000000007', 'member', '{}');

insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total)
values ('b7c00000-0000-0000-0000-000000000001', 'b7b00000-0000-0000-0000-00000000000b', 'PB7 request', 'awarded', 'invited_only', 100);
insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity, submitted_at)
values ('b7c00000-0000-0000-0000-000000000002', 'b7c00000-0000-0000-0000-000000000001', 'b7b00000-0000-0000-0000-0000000000f1', 'accepted', 100, 1, now());
insert into public.production_orders
  (id, rfq_id, quote_id, brand_org_id, factory_org_id, unit_price_cents,
   production_quantity, bulk_subtotal_cents, sample_subtotal_cents, order_total_cents, deposit_pct, balance_pct, order_number)
values ('b7d00000-0000-0000-0000-000000000001', 'b7c00000-0000-0000-0000-000000000001', 'b7c00000-0000-0000-0000-000000000002',
        'b7b00000-0000-0000-0000-00000000000b', 'b7b00000-0000-0000-0000-0000000000f1', 1000, 1, 1000, 0, 1000, 50, 50, 'PB7-1');
insert into public.order_milestones (id, order_id, kind, title, amount_cents)
select ('b7e00000-0000-0000-0000-00000000000' || n)::uuid, 'b7d00000-0000-0000-0000-000000000001', 'payment_only', 'PB7 step ' || n, 100000
  from generate_series(1, 3) n;
insert into public.order_payments (id, order_id, milestone_id, amount_cents, currency, state, confirmed_at, release_requested_at)
select ('b7f00000-0000-0000-0000-00000000000' || n)::uuid, 'b7d00000-0000-0000-0000-000000000001',
       ('b7e00000-0000-0000-0000-00000000000' || n)::uuid, 100000, 'USD', 'confirmed', now(), now()
  from generate_series(1, 3) n;

-- A complete mainland account, its number in Vault, and the company's own USCC.
insert into public.factory_payout_accounts
  (id, org_id, method, bank_name, account_name, account_number_last4, bank_country, is_primary,
   holder_name_local, registration_number, address_line1, address_city, details_changed_at)
values ('b7a10000-0000-0000-0000-000000000001', 'b7b00000-0000-0000-0000-0000000000f1', 'bank', 'Bank of China', 'PB7 GARMENT CO LTD', '0001', 'CN', true,
        '深圳市测试服装有限公司', '91440300MA5G8X2Q73', '1 Test Road', 'Shenzhen', '2026-11-01 00:00:00+00'),
       ('b7a10000-0000-0000-0000-000000000002', 'b7b00000-0000-0000-0000-0000000000f2', 'bank', 'HSBC', 'PB7 NOTHING LTD', '0002', 'HK', true,
        null, null, '1 Test Road', 'Kwun Tong', '2026-11-01 00:00:00+00');
update public.factory_payout_accounts set address_state = 'Kowloon', bank_code = '004', swift = 'HSBCHKHH'
 where id = 'b7a10000-0000-0000-0000-000000000002';
insert into public.payout_account_numbers (account_id, vault_secret_id, number_kind)
values ('b7a10000-0000-0000-0000-000000000001', vault.create_secret('0000000000b70001', 'payout-number-b7-1'), 'account'),
       ('b7a10000-0000-0000-0000-000000000002', vault.create_secret('0000000000b70002', 'payout-number-b7-2'), 'account');
insert into public.company_registrations (org_id, country_code, number)
values ('b7b00000-0000-0000-0000-0000000000f1', 'CN', '91440300MA5G8X2Q73');

set local session_replication_role = origin;

create function pg_temp.act_as(who int) returns void language sql as $f$
  select set_config('request.jwt.claims',
    json_build_object('sub', 'b7a00000-0000-0000-0000-' || lpad(who::text, 12, '0'), 'role', 'authenticated')::text, true);
$f$;
grant execute on function pg_temp.act_as(int) to authenticated, anon, service_role;

create function pg_temp.press(payment int default 1, which text default 'tazapay')
returns jsonb language sql as $f$
  select public.claim_provider_payout(('b7f00000-0000-0000-0000-00000000000' || payment)::uuid, which,
    (select details_changed_at from public.factory_payout_accounts where id = 'b7a10000-0000-0000-0000-000000000001'), false);
$f$;
grant execute on function pg_temp.press(int, text) to authenticated, anon, service_role;

-- As the database owner (the guard sees no signed-in person), so details_changed_at stays put.
create function pg_temp.set_account(patch text) returns void language plpgsql as $f$
begin
  execute format('update public.factory_payout_accounts set %s where id = %L', patch, 'b7a10000-0000-0000-0000-000000000001');
  update public.factory_payout_accounts set details_changed_at = '2026-11-01 00:00:00+00' where id = 'b7a10000-0000-0000-0000-000000000001';
end $f$;

-- --- The two hats, and everyone who isn't staff --------------------------------
select pg_temp.act_as(1); set local role authenticated;
select throws_ok($$ select pg_temp.press() $$, '42501', null, 'the factory cannot pay itself through Tazapay');
select throws_ok($$ select * from public.payout_tazapay_beneficiary('b7a10000-0000-0000-0000-000000000001') $$, '42501', null, 'nor read its number for Tazapay');

reset role; select pg_temp.act_as(3); set local role authenticated;
select throws_ok($$ select * from public.payout_tazapay_beneficiary('b7a10000-0000-0000-0000-000000000001') $$, '42501', null, 'the brand cannot read it');

reset role; select pg_temp.act_as(6); set local role authenticated;
select throws_ok($$ select pg_temp.press() $$, '42501', 'you belong to this company, so someone else on the staff must pay it', 'staff in the factory cannot pay it');
select throws_ok($$ select * from public.payout_tazapay_beneficiary('b7a10000-0000-0000-0000-000000000001') $$, '42501', null, 'nor read its number');

reset role; select pg_temp.act_as(7); set local role authenticated;
select throws_ok($$ select pg_temp.press() $$, '42501', 'your company has an order with this factory, so someone else on the staff must pay it', 'staff in the brand on the order cannot');
select throws_ok($$ select * from public.payout_tazapay_beneficiary('b7a10000-0000-0000-0000-000000000001') $$, '42501', null, 'nor read the number');

reset role; select set_config('request.jwt.claims', '', true); set local role anon;
select throws_ok($$ select pg_temp.press() $$, '42501', null, 'signed out is refused');

-- --- Staff press -----------------------------------------------------------
reset role; select pg_temp.act_as(5); set local role authenticated;
create temp table b7 on commit drop as select pg_temp.press() as claim;
grant select on b7 to authenticated, service_role;
select ok((select claim ->> 'key' from b7) is not null, 'staff claim a Tazapay payout, and its key is made before Tazapay is called');
select is((select claim ->> 'milestone_title' from b7), 'PB7 step 1', 'the claim says which step, for the invoice');
select ok((select claim ->> 'attempt_started_at' from b7) is not null, 'and when the attempt began, for Tazapay''s 24-hour memory of the key');
select is((select provider || ' ' || paid_to from public.provider_payouts where id = (select (claim ->> 'payout_id')::uuid from b7)),
  'tazapay Bank of China ending 0001', 'the factory reads where the money went');
select throws_ok($$ select pg_temp.press() $$, '22023', 'this is already being paid', 'a second press while the first runs is refused');
select throws_ok($$ select pg_temp.press(1, 'airwallex') $$, '22023', null, 'a provider nobody built is refused');

select is((select account_number from public.payout_tazapay_beneficiary('b7a10000-0000-0000-0000-000000000001')), '0000000000b70001',
  'staff read the number for Tazapay through the one function');
reset role;
select is((select how from public.payout_number_reveals where account_id = 'b7a10000-0000-0000-0000-000000000001' order by revealed_at desc limit 1),
  'sent_to_tazapay', 'and it is recorded as sent to Tazapay');
select throws_ok($$ insert into public.payout_number_reveals (account_id, org_id, org_name, bank_name, last4, staff_user_id, staff_email, how)
    values ('b7a10000-0000-0000-0000-000000000001', 'b7b00000-0000-0000-0000-0000000000f1', 'x', 'x', '0001', 'b7a00000-0000-0000-0000-000000000005', 'x', 'sent_elsewhere') $$,
  '23514', null, 'a reveal says one of the known ways');

-- --- Accounts Tazapay can't or mustn't pay --------------------------------------
select pg_temp.set_account('holder_name_local = null');
select pg_temp.act_as(5); set local role authenticated;
select throws_ok($$ select pg_temp.press(2) $$, '22023', 'this bank account is missing details Tazapay needs', 'a mainland account with no Chinese name');
reset role;
select pg_temp.set_account($$holder_name_local = '深圳市测试服装有限公司', registration_number = '91330200MA2AB1234Y'$$);
select pg_temp.act_as(5); set local role authenticated;
select throws_ok($$ select pg_temp.press(2) $$, '22023', 'the account''s registration number is not the company''s', 'a USCC other than the company''s own');
reset role;
select pg_temp.set_account($$registration_number = '91440300MA5G8X2Q73'$$);
delete from public.company_registrations where org_id = 'b7b00000-0000-0000-0000-0000000000f1';
select pg_temp.act_as(5); set local role authenticated;
select throws_ok($$ select pg_temp.press(2) $$, '22023', 'the account''s registration number is not the company''s', 'or any USCC, while the company has none on file');
reset role;
insert into public.company_registrations (org_id, country_code, number) values ('b7b00000-0000-0000-0000-0000000000f1', 'CN', '91440300MA5G8X2Q73');
select pg_temp.set_account($$bank_country = 'TW', registration_number = null, holder_name_local = null$$);
select pg_temp.act_as(5); set local role authenticated;
select throws_ok($$ select pg_temp.press(2) $$, '22023', 'Tazapay pays bank accounts in mainland China and Hong Kong only', 'a Taiwan account');
reset role;
select pg_temp.set_account($$bank_country = 'CN', holder_name_local = '深圳市测试服装有限公司', registration_number = '91440300MA5G8X2Q73'$$);
select pg_temp.act_as(5); set local role authenticated;
select ok((select pg_temp.press(2) ->> 'key') is not null, 'put right, the same account can be paid');

select throws_ok($$ select * from public.payout_tazapay_beneficiary('b7a10000-0000-0000-0000-000000000002') $$, '22023',
  'TSC does not owe this company a payout by hand, so its number stays hidden', 'a number nobody is about to pay stays hidden');

reset role;
select ok(not has_function_privilege('authenticated', 'public.tazapay_account_check(public.factory_payout_accounts)', 'execute'), 'the check is the database''s own');
select ok(not has_function_privilege('anon', 'public.payout_tazapay_beneficiary(uuid)', 'execute'), 'a signed-out visitor cannot ask for the number');

select * from finish();
rollback;
