-- ============================================================================
-- Wise and PayPal as payout methods (20261107100000)
-- ----------------------------------------------------------------------------
-- `pgtap77-` slugs and 77a…/77b… ids. Every number is fake and plainly so.
-- Mostly the ways to put the number in the open, to pay the wrong account, or
-- to let the brand read where the money went.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;

select plan(33);

set local session_replication_role = replica;

insert into auth.users (id, email) values
  ('77a00000-0000-0000-0000-000000000001', 'p77-owner@example.com'),
  ('77a00000-0000-0000-0000-000000000002', 'p77-member@example.com'),
  ('77a00000-0000-0000-0000-000000000003', 'p77-brand@example.com'),
  ('77a00000-0000-0000-0000-000000000005', 'p77-staff@example.com'),
  ('77a00000-0000-0000-0000-000000000006', 'p77-staff-in-factory@example.com');

insert into public.platform_admins (user_id, note) values
  ('77a00000-0000-0000-0000-000000000005', 'pgtap77'),
  ('77a00000-0000-0000-0000-000000000006', 'pgtap77');

insert into public.orgs (id, type, name, slug) values
  ('77b00000-0000-0000-0000-00000000000b', 'brand',   'P77 Brand', 'pgtap77-brand'),
  ('77b00000-0000-0000-0000-0000000000f1', 'factory', 'P77 Mill',  'pgtap77-mill');

insert into public.org_members (org_id, user_id, role, permissions) values
  ('77b00000-0000-0000-0000-0000000000f1', '77a00000-0000-0000-0000-000000000001', 'owner', '{}'),
  ('77b00000-0000-0000-0000-0000000000f1', '77a00000-0000-0000-0000-000000000002', 'member', '{}'),
  ('77b00000-0000-0000-0000-0000000000f1', '77a00000-0000-0000-0000-000000000006', 'member', '{}'),
  ('77b00000-0000-0000-0000-00000000000b', '77a00000-0000-0000-0000-000000000003', 'owner', '{}');

set local session_replication_role = origin;

create function pg_temp.as_user(id uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', id, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
grant execute on function pg_temp.as_user(uuid) to authenticated;

create function pg_temp.save(holder text, number text, again text, extra jsonb default '{}', account uuid default null)
returns public.factory_payout_accounts language sql as $$
  select public.save_wise_payout_account(
    '77b00000-0000-0000-0000-0000000000f1', account, 'Demo Bank', 'chinese_local_business', 'CNY',
    jsonb_build_object('legalType', 'BUSINESS', 'accountHolderName', holder, 'swiftCode', 'BOSHCNSH',
      'address.country', 'CN', 'address.city', 'Ningbo', 'address.firstLine', '1 Test Road') || extra,
    'accountNumber', number, again)
$$;
grant execute on function pg_temp.save(text, text, text, jsonb, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The factory's owner fills in the form.
-- ---------------------------------------------------------------------------
select pg_temp.as_user('77a00000-0000-0000-0000-000000000001');

select throws_ok($$ select pg_temp.save('宁波织造有限公司', '0000000000770001', '0000000000770001') $$,
  '22023', null, 'a Chinese-only name is refused');
select throws_ok($$ select pg_temp.save('Ningbo 织造', '0000000000770001', '0000000000770001') $$,
  '22023', null, 'so is a name that is only partly Latin');
select throws_ok($$ select pg_temp.save('ＮＩＮＧＢＯ', '0000000000770001', '0000000000770001') $$,
  '22023', null, 'and full-width letters, which only look Latin');
select throws_ok($$ select pg_temp.save('Ningbo Mill', '0000000000770001', '0000000000770002') $$,
  '22023', null, 'two numbers that differ are refused');
select throws_ok($$ select pg_temp.save('Ningbo Mill', '0000000000770001', '0000000000770001', '{"accountNumber":"0000000000770001"}') $$,
  '22023', null, 'the number under its own key in the open form is refused');
select throws_ok($$ select pg_temp.save('Ningbo Mill', '0000000000770001', '0000000000770001', '{"address.firstLine":"0000 0000 0077 0001"}') $$,
  '22023', null, 'the number pasted in another field, spaced, is refused');
select throws_ok($$ select pg_temp.save('Ningbo Mill', '0000000000770001', '0000000000770001', '{"ibanCopy":"x"}') $$,
  '22023', null, 'a key that names a number is refused in the open form');
select throws_ok($$ select public.save_wise_payout_account('77b00000-0000-0000-0000-0000000000f1', null, 'Demo Bank',
    'chinese_local_business', 'CNY', '{"accountHolderName":"Ningbo Mill"}', '../x', '0000000000770001', '0000000000770001') $$,
  '22023', null, 'a number key that is not a plain key is refused');

create temp table p77 on commit drop as select (pg_temp.save('Ningbo Mill Co Ltd', '0000 0000 0077 0001', '0000000000770001', '{"isContractDenotedInCny":"true"}')).id;
grant select on p77 to authenticated;
select ok((select id from p77) is not null, 'a Latin name saves');
select is((select account_name from public.factory_payout_accounts where id = (select id from p77)), 'Ningbo Mill Co Ltd', 'the holder is on the usual column, for Mark paid by bank');
select is((select swift from public.factory_payout_accounts where id = (select id from p77)), 'BOSHCNSH', 'so is the SWIFT');
select is((select account_number_last4 from public.factory_payout_accounts where id = (select id from p77)), '0001', 'the row holds the last four');
select ok(not (select wise_details::text ~ '770001' from public.factory_payout_accounts where id = (select id from p77)), 'Wise''s form on the row has no number');
select ok(not (select wise_details ? 'isContractDenotedInCny' from public.factory_payout_accounts where id = (select id from p77)), 'the CNY declaration is not the factory''s to make');

-- A direct write cannot do what the function refuses.
select throws_ok($$ update public.factory_payout_accounts set wise_details = wise_details || '{"address.firstLine":"0000000000770001"}' where id = (select id from p77) $$,
  '22023', null, 'a direct write cannot put the number in the form');
select throws_ok($$ update public.factory_payout_accounts set wise_details = wise_details || '{"accountNumber":"1"}' where id = (select id from p77) $$,
  '22023', null, 'nor under the number''s key');
update public.factory_payout_accounts set wise_recipient_id = 'forged' where id = (select id from p77);
select is((select wise_recipient_id from public.factory_payout_accounts where id = (select id from p77)), null, 'a person cannot set Wise''s recipient');
select throws_ok($$ select public.set_wise_recipient((select id from p77), 'forged', now()) $$, '42501', null, 'nor call the server''s function');
select throws_ok($$ insert into public.provider_payouts (payment_id, factory_org_id, provider, paid_to, amount_cents, currency)
    values (gen_random_uuid(), '77b00000-0000-0000-0000-0000000000f1', 'wise', 'x', 1, 'USD') $$, '42501', null, 'the factory cannot write its own withdrawal');

-- PayPal, written by the owner under RLS, with its own notice.
insert into public.factory_payout_accounts (org_id, method, paypal_email, is_primary)
values ('77b00000-0000-0000-0000-0000000000f1', 'paypal', 'mill@example.com', false);
select is((select count(*)::int from public.notifications where org_id = '77b00000-0000-0000-0000-0000000000f1' and body like 'PayPal account mill@example.com was added.%'), 1, 'adding PayPal tells the company');
select throws_ok($$ insert into public.factory_payout_accounts (org_id, method, paypal_email, is_primary)
    values ('77b00000-0000-0000-0000-0000000000f1', 'paypal', 'mill@example.com', false) $$, '23505', null, 'the same address twice is refused');
select throws_ok($$ insert into public.factory_payout_accounts (org_id, method, paypal_email, is_primary)
    values ('77b00000-0000-0000-0000-0000000000f1', 'paypal', 'not an address', false) $$, '23514', null, 'something that is not an address is refused');

-- ---------------------------------------------------------------------------
-- Everyone else.
-- ---------------------------------------------------------------------------
select pg_temp.as_user('77a00000-0000-0000-0000-000000000002');
select throws_ok($$ select pg_temp.save('Ningbo Mill', '0000000000770009', '0000000000770009') $$, '42501', null, 'a member cannot save one');
select throws_ok($$ select * from public.payout_wise_recipient((select id from p77)) $$, '42501', null, 'nor read the number for Wise');

select pg_temp.as_user('77a00000-0000-0000-0000-000000000003');
select throws_ok($$ select pg_temp.save('Ningbo Mill', '0000000000770009', '0000000000770009') $$, '42501', null, 'a stranger cannot save one');
select is((select count(*)::int from public.factory_payout_accounts where org_id = '77b00000-0000-0000-0000-0000000000f1'), 0, 'a brand reads no payout account');
select is((select count(*)::int from public.provider_payouts), 0, 'a brand reads no withdrawal');

select pg_temp.as_user('77a00000-0000-0000-0000-000000000006');
select throws_ok($$ select * from public.payout_wise_recipient((select id from p77)) $$, '42501', null, 'staff in the company cannot read the number for Wise');

select pg_temp.as_user('77a00000-0000-0000-0000-000000000005');
select throws_ok($$ select * from public.payout_wise_recipient((select id from p77)) $$, '22023', null, 'staff cannot read it while nothing is owed');

reset role;
select ok(not has_function_privilege('anon', 'public.save_wise_payout_account(uuid, uuid, text, text, text, jsonb, text, text, text)', 'execute'), 'a signed-out visitor cannot save one');
select ok(not has_function_privilege('authenticated', 'public.set_wise_recipient(uuid, text, timestamptz)', 'execute'), 'set_wise_recipient is the server''s');
select ok(not has_table_privilege('authenticated', 'public.provider_payouts', 'insert,update,delete'), 'provider_payouts is select-only');
select ok(has_function_privilege('service_role', 'public.set_wise_recipient(uuid, text, timestamptz)', 'execute'), 'the server can call it');

select * from finish();
rollback;
