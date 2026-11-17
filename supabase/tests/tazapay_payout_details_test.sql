-- ============================================================================
-- Tazapay's payout details on a factory's bank account (20261115600000)
-- ----------------------------------------------------------------------------
-- `pgtap-b6-` slugs and b6a…/b6b… ids. Every number is fake and plainly so.
-- Mostly refusals: a malformed Chinese name or USCC stored, a payee id forged
-- by a person, a stale payee kept after the details change, the number pasted
-- into the address, the details read or changed by anyone but the company.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;

select plan(37);

set local session_replication_role = replica;

insert into auth.users (id, email) values
  ('b6a00000-0000-0000-0000-000000000001', 'pb6-owner@example.com'),
  ('b6a00000-0000-0000-0000-000000000002', 'pb6-member@example.com'),
  ('b6a00000-0000-0000-0000-000000000003', 'pb6-brand@example.com'),
  ('b6a00000-0000-0000-0000-000000000004', 'pb6-other-factory@example.com'),
  ('b6a00000-0000-0000-0000-000000000005', 'pb6-staff@example.com');

insert into public.platform_admins (user_id, note) values ('b6a00000-0000-0000-0000-000000000005', 'pgtap-b6');

insert into public.orgs (id, type, name, slug) values
  ('b6b00000-0000-0000-0000-00000000000b', 'brand',   'PB6 Brand',       'pgtap-b6-brand'),
  ('b6b00000-0000-0000-0000-0000000000f1', 'factory', 'PB6 Garment Mill', 'pgtap-b6-mill'),
  ('b6b00000-0000-0000-0000-0000000000f2', 'factory', 'PB6 Other Mill',  'pgtap-b6-other');

insert into public.org_members (org_id, user_id, role, permissions) values
  ('b6b00000-0000-0000-0000-0000000000f1', 'b6a00000-0000-0000-0000-000000000001', 'owner', '{}'),
  ('b6b00000-0000-0000-0000-0000000000f1', 'b6a00000-0000-0000-0000-000000000002', 'member', '{}'),
  ('b6b00000-0000-0000-0000-00000000000b', 'b6a00000-0000-0000-0000-000000000003', 'owner', '{}'),
  ('b6b00000-0000-0000-0000-0000000000f2', 'b6a00000-0000-0000-0000-000000000004', 'owner', '{}');

-- 'tazapay' is a provider a payout attempt may name; nothing else new is.
-- (Foreign keys are off in replica mode, so only the check is being asked.)
insert into public.provider_payouts (payment_id, factory_org_id, provider, paid_to, amount_cents, currency)
values (gen_random_uuid(), 'b6b00000-0000-0000-0000-0000000000f1', 'tazapay', 'BANK OF CHINA ending 0001', 100, 'USD');
select is((select count(*)::int from public.provider_payouts where factory_org_id = 'b6b00000-0000-0000-0000-0000000000f1' and provider = 'tazapay'), 1,
  'a payout attempt may be made with Tazapay');
select throws_ok($$ insert into public.provider_payouts (payment_id, factory_org_id, provider, paid_to, amount_cents, currency)
    values (gen_random_uuid(), 'b6b00000-0000-0000-0000-0000000000f1', 'airwallex', 'x', 100, 'USD') $$,
  '23514', null, 'but not with a provider nobody built');
delete from public.provider_payouts where factory_org_id = 'b6b00000-0000-0000-0000-0000000000f1';

set local session_replication_role = origin;

create function pg_temp.as_user(id uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', id, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
grant execute on function pg_temp.as_user(uuid) to authenticated;

-- The server: the secret key's claims say service_role, which is what the guard reads.
create function pg_temp.as_server() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  set local role service_role;
end $$;

-- ---------------------------------------------------------------------------
-- The factory's owner saves its mainland account, with the full number in Vault.
-- ---------------------------------------------------------------------------
select pg_temp.as_user('b6a00000-0000-0000-0000-000000000001');

create temp table b6 on commit drop as select (public.save_bank_payout_account(
  'b6b00000-0000-0000-0000-0000000000f1', null, 'Bank of China', 'PB6 Garment Mill Co Ltd', 'CN', 'BKCHCNBJ', null, null,
  '0000000000b60001', '0000000000b60001')).id;
grant select on b6 to authenticated, service_role;
create function pg_temp.acct() returns public.factory_payout_accounts language sql stable as $$
  select * from public.factory_payout_accounts where id = (select id from b6) $$;
grant execute on function pg_temp.acct() to authenticated, service_role;

update public.factory_payout_accounts
   set holder_name_local = '深圳市测试服装有限公司', registration_number = '91440300MA5G8X2Q73',
       bank_code = '104100000004', address_line1 = '1 Test Road', address_city = 'Shenzhen', address_state = 'Guangdong',
       address_postal_code = '518000'
 where id = (select id from b6);
select is((pg_temp.acct()).holder_name_local, '深圳市测试服装有限公司', 'the owner saves the Chinese name');
select is((pg_temp.acct()).registration_number, '91440300MA5G8X2Q73', 'and the USCC');
select is((pg_temp.acct()).bank_code, '104100000004', 'and the CNAPS code');

-- What no write may store.
select throws_ok($$ update public.factory_payout_accounts set holder_name_local = 'Shenzhen Test Garment' where id = (select id from b6) $$,
  '23514', null, 'a Chinese name with no Chinese in it is refused');
select throws_ok($$ update public.factory_payout_accounts set holder_name_local = ' 深圳市测试服装有限公司' where id = (select id from b6) $$,
  '23514', null, 'so is one with spaces around it, which would not match the bank');
select throws_ok($$ update public.factory_payout_accounts set registration_number = '91440300MA5G8X2Q70' where id = (select id from b6) $$,
  '23514', null, 'a USCC whose check character is wrong is refused: it names another company');
select throws_ok($$ update public.factory_payout_accounts set registration_number = '91440300ma5g8x2q73' where id = (select id from b6) $$,
  '23514', null, 'a USCC is stored as Tazapay reads it, upper case');
select throws_ok($$ update public.factory_payout_accounts set registration_number = '440301103425421' where id = (select id from b6) $$,
  '23514', null, 'the pre-2017 15-digit number is refused');
select throws_ok($$ update public.factory_payout_accounts set bank_code = '1041' where id = (select id from b6) $$,
  '23514', null, 'a bank code is 3 digits (HK) or 12 (CNAPS)');
select throws_ok($$ update public.factory_payout_accounts set address_postal_code = '518000; drop' where id = (select id from b6) $$,
  '23514', null, 'a postcode is a postcode');
select throws_ok($$ update public.factory_payout_accounts set address_line1 = 'Account 0000 0000 00b6 0001' where id = (select id from b6) $$,
  '22023', null, 'the full number pasted into the address is refused');
select throws_ok($$ update public.factory_payout_accounts set holder_name_local = '深圳0000000000b60001' where id = (select id from b6) $$,
  '22023', null, 'and into the Chinese name');
select throws_ok($$ insert into public.factory_payout_accounts (org_id, method, paypal_email, holder_name_local, is_primary)
    values ('b6b00000-0000-0000-0000-0000000000f1', 'paypal', 'pb6@example.com', '深圳市测试服装有限公司', false) $$,
  '23514', null, 'these details belong to a bank account only');

-- The payee Tazapay made is the server's to set.
update public.factory_payout_accounts set tazapay_beneficiary_id = 'bnf_forgedbyowner01' where id = (select id from b6);
select is((pg_temp.acct()).tazapay_beneficiary_id, null, 'a person cannot set the Tazapay payee');
select throws_ok($$ select public.set_tazapay_beneficiary((select id from b6), 'bnf_forgedbyowner01', now()) $$,
  '42501', null, 'nor call the server''s function');

-- ---------------------------------------------------------------------------
-- The server keeps a payee; a change of details drops it.
-- ---------------------------------------------------------------------------
reset role;
create temp table b6_before on commit drop as select details_changed_at as at from public.factory_payout_accounts where id = (select id from b6);
grant select on b6_before to authenticated, service_role;
select pg_temp.as_server();
select ok(public.set_tazapay_beneficiary((select id from b6), 'bnf_dbsrn2l4hlofopvv0810', (select at from b6_before)),
  'the server keeps the payee made from the details it read');
select is((pg_temp.acct()).tazapay_beneficiary_id, 'bnf_dbsrn2l4hlofopvv0810', 'and it is on the account');
select throws_ok($$ select public.set_tazapay_beneficiary((select id from b6), 'not-a-payee', (select at from b6_before)) $$,
  '23514', null, 'a payee id is Tazapay''s shape');
select ok(not public.set_tazapay_beneficiary((select id from b6), 'bnf_stalepayee000001', now() - interval '1 day'),
  'a payee made from details that have since changed is not kept');
select is((pg_temp.acct()).tazapay_beneficiary_id, 'bnf_dbsrn2l4hlofopvv0810', 'and the kept one is untouched');
reset role;

select pg_temp.as_user('b6a00000-0000-0000-0000-000000000001');
update public.factory_payout_accounts set holder_name_local = '深圳市另一家服装有限公司' where id = (select id from b6);
select is((pg_temp.acct()).tazapay_beneficiary_id, null, 'changing the Chinese name drops the payee made from the old one');
select ok((pg_temp.acct()).details_changed_at > (select at from b6_before), 'and moves details_changed_at, so a payout pressed on the old details is refused');
reset role;
set constraints all immediate;
select is((select count(*)::int from public.notifications where org_id = 'b6b00000-0000-0000-0000-0000000000f1'
    and body like 'The bank account TSC pays changed%'), 2, 'and the company is told each time these details change (the first save, and this)');

select pg_temp.as_user('b6a00000-0000-0000-0000-000000000001');
update public.factory_payout_accounts set address_city = 'Dongguan' where id = (select id from b6);
select ok((pg_temp.acct()).details_changed_at > (select at from b6_before), 'an address change is a change of details too');

-- ---------------------------------------------------------------------------
-- Everyone else.
-- ---------------------------------------------------------------------------
select pg_temp.as_user('b6a00000-0000-0000-0000-000000000002');
update public.factory_payout_accounts set registration_number = null, holder_name_local = null where id = (select id from b6);
reset role;
select is((select registration_number from public.factory_payout_accounts where id = (select id from b6)), '91440300MA5G8X2Q73',
  'a member who is not the owner cannot change them');
select pg_temp.as_user('b6a00000-0000-0000-0000-000000000002');
select is((select holder_name_local from public.factory_payout_accounts where id = (select id from b6)), '深圳市另一家服装有限公司',
  'but can read them, like the rest of the account');

select pg_temp.as_user('b6a00000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.factory_payout_accounts where org_id = 'b6b00000-0000-0000-0000-0000000000f1'), 0,
  'a brand reads none of it');
update public.factory_payout_accounts set holder_name_local = '品牌改的名字' where id = (select id from b6);

select pg_temp.as_user('b6a00000-0000-0000-0000-000000000004');
select is((select count(*)::int from public.factory_payout_accounts where org_id = 'b6b00000-0000-0000-0000-0000000000f1'), 0,
  'another factory reads none of it');
update public.factory_payout_accounts set registration_number = '91330200MA2AB1234Y' where id = (select id from b6);
select throws_ok($$ insert into public.factory_payout_accounts (org_id, method, bank_name, account_name, bank_country, holder_name_local, is_primary)
    values ('b6b00000-0000-0000-0000-0000000000f1', 'bank', 'Bank of China', 'Planted Co', 'CN', '深圳市植入有限公司', false) $$,
  '42501', null, 'nor plants an account in its name');
reset role;
select is((select holder_name_local || ' ' || registration_number from public.factory_payout_accounts where id = (select id from b6)),
  '深圳市另一家服装有限公司 91440300MA5G8X2Q73', 'neither the brand nor another factory changed anything');

select pg_temp.as_user('b6a00000-0000-0000-0000-000000000005');
select is((select bank_code from public.factory_payout_accounts where id = (select id from b6)), '104100000004', 'staff read them, to pay the account');
select throws_ok($$ select public.set_tazapay_beneficiary((select id from b6), 'bnf_forgedbystaff001', now()) $$,
  '42501', null, 'staff cannot set the payee either: only the server, from Tazapay''s answer');

reset role;
select ok(not has_table_privilege('anon', 'public.factory_payout_accounts', 'select'), 'a signed-out visitor reads nothing');
select ok(not has_function_privilege('anon', 'public.set_tazapay_beneficiary(uuid, text, timestamptz)', 'execute'), 'nor calls the server''s function');
select ok(has_function_privilege('service_role', 'public.set_tazapay_beneficiary(uuid, text, timestamptz)', 'execute'), 'the server can call it');

select * from finish();
rollback;
