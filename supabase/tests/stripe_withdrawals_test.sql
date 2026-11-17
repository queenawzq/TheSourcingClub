-- Stripe withdrawals and the payout fee each one took (20261117400000).
-- Mostly negative: another company, the brand, a signed-out visitor and even
-- the factory's own members cannot write a row or call the claim functions;
-- only the factory's members and staff read its rows.
begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

set local session_replication_role = replica;

insert into auth.users (id, email) values
  ('6a000000-0000-0000-0000-000000000001', 'pgtap-sw2-owner@example.com'),
  ('6a000000-0000-0000-0000-000000000002', 'pgtap-sw2-member@example.com'),
  ('6a000000-0000-0000-0000-000000000003', 'pgtap-sw2-other@example.com'),
  ('6a000000-0000-0000-0000-000000000004', 'pgtap-sw2-brand@example.com'),
  ('6a000000-0000-0000-0000-000000000005', 'pgtap-sw2-staff@example.com');

insert into public.platform_admins (user_id, note) values ('6a000000-0000-0000-0000-000000000005', 'pgtap-sw2');

insert into public.orgs (id, type, name, slug) values
  ('6b000000-0000-0000-0000-0000000000f1', 'factory', 'SW2 Factory', 'pgtap-sw2-factory'),
  ('6b000000-0000-0000-0000-0000000000f2', 'factory', 'SW2 Other',   'pgtap-sw2-other'),
  ('6b000000-0000-0000-0000-0000000000b1', 'brand',   'SW2 Brand',   'pgtap-sw2-brand');

insert into public.org_members (org_id, user_id, role, permissions) values
  ('6b000000-0000-0000-0000-0000000000f1', '6a000000-0000-0000-0000-000000000001', 'owner', '{}'),
  ('6b000000-0000-0000-0000-0000000000f1', '6a000000-0000-0000-0000-000000000002', 'member', '{}'),
  ('6b000000-0000-0000-0000-0000000000f2', '6a000000-0000-0000-0000-000000000003', 'owner', '{}'),
  ('6b000000-0000-0000-0000-0000000000b1', '6a000000-0000-0000-0000-000000000004', 'owner', '{}');

insert into public.stripe_withdrawals (id, org_id, stripe_account_id, request_key, request_id, amount_minor, currency, fee_cents, fee_local_minor, payout_id, payout_minor, state)
values ('6c000000-0000-0000-0000-000000000001', '6b000000-0000-0000-0000-0000000000f1', 'acct_pgtap_sw2', 'pgtap-sw2-key-1',
        '6d000000-0000-0000-0000-000000000001', 100000, 'USD', 523, 523, 'po_pgtap_sw2', 99477, 'paid_out');
set local session_replication_role = origin;

create function pg_temp.act_as(who int) returns void language sql as $f$
  select set_config('request.jwt.claims',
    json_build_object('sub', '6a000000-0000-0000-0000-' || lpad(who::text, 12, '0'), 'role', 'authenticated')::text, true);
$f$;
grant execute on function pg_temp.act_as(int) to authenticated, anon, service_role;

-- The server claims a withdrawal once; a second call with the same key is told it is taken.
select is((public.claim_stripe_withdrawal('6b000000-0000-0000-0000-0000000000f1', 'acct_pgtap_sw2', 'pgtap-sw2-key-2',
  '6d000000-0000-0000-0000-000000000002', 5000, 'usd') ->> 'claimed')::boolean, true, 'the first call claims it');
select is((public.claim_stripe_withdrawal('6b000000-0000-0000-0000-0000000000f1', 'acct_pgtap_sw2', 'pgtap-sw2-key-2',
  '6d000000-0000-0000-0000-000000000002', 5000, 'usd') ->> 'claimed')::boolean, false, 'a second call while it works is not given it');
select is((select currency::text from public.stripe_withdrawals where request_key = 'pgtap-sw2-key-2'), 'USD', 'the currency is kept in capitals');
select is((public.claim_stripe_withdrawal('6b000000-0000-0000-0000-0000000000f1', 'acct_pgtap_sw2', 'pgtap-sw2-key-1',
  '6d000000-0000-0000-0000-000000000001', 100000, 'usd') -> 'row' ->> 'state'), 'paid_out', 'a finished one is returned as it is, unclaimed');
update public.stripe_withdrawals set lease_until = now() - interval '1 minute' where request_key = 'pgtap-sw2-key-2';
select is((select (public.claim_abandoned_stripe_withdrawal(id)).id from public.stripe_withdrawals where request_key = 'pgtap-sw2-key-2'),
  (select id from public.stripe_withdrawals where request_key = 'pgtap-sw2-key-2'), 'a lapsed one can be claimed to settle it');
select is((public.claim_abandoned_stripe_withdrawal('6c000000-0000-0000-0000-000000000001')).id, null, 'a finished one is never re-claimed');

-- Signed out: nothing at all.
set local role anon;
select throws_ok($$select * from public.stripe_withdrawals$$, '42501', null, 'anon cannot read withdrawals');
select throws_ok($$select public.claim_stripe_withdrawal('6b000000-0000-0000-0000-0000000000f1', 'acct_x', 'k', '6d000000-0000-0000-0000-000000000009', 1, 'usd')$$, '42501', null, 'anon cannot claim');

-- The factory's owner reads its own row, and writes nothing.
reset role; select pg_temp.act_as(1); set local role authenticated;
select is((select count(*)::int from public.stripe_withdrawals where org_id = '6b000000-0000-0000-0000-0000000000f1'), 2, 'the owner reads its company''s withdrawals');
select is((select fee_cents from public.stripe_withdrawals where id = '6c000000-0000-0000-0000-000000000001'), 523::bigint, 'with the fee it took');
select throws_ok($$update public.stripe_withdrawals set fee_cents = 0$$, '42501', null, 'the owner cannot change a fee');
select throws_ok($$insert into public.stripe_withdrawals (org_id, stripe_account_id, request_key, request_id, amount_minor, currency)
  values ('6b000000-0000-0000-0000-0000000000f1', 'acct_x', 'pgtap-sw2-forged', '6d000000-0000-0000-0000-000000000003', 1, 'USD')$$, '42501', null, 'the owner cannot insert one');
select throws_ok($$delete from public.stripe_withdrawals$$, '42501', null, 'the owner cannot delete one');
select throws_ok($$select public.claim_stripe_withdrawal('6b000000-0000-0000-0000-0000000000f1', 'acct_x', 'k', '6d000000-0000-0000-0000-000000000009', 1, 'usd')$$, '42501', null, 'the owner cannot claim');
select throws_ok($$select public.claim_abandoned_stripe_withdrawal('6c000000-0000-0000-0000-000000000001')$$, '42501', null, 'the owner cannot claim an abandoned one');

-- A member of the same factory reads it too (the Paid out figure is net of it).
reset role; select pg_temp.act_as(2); set local role authenticated;
select is((select count(*)::int from public.stripe_withdrawals where org_id = '6b000000-0000-0000-0000-0000000000f1'), 2, 'a member reads them');

-- Another factory and the brand read nothing.
reset role; select pg_temp.act_as(3); set local role authenticated;
select is((select count(*)::int from public.stripe_withdrawals where org_id = '6b000000-0000-0000-0000-0000000000f1'), 0, 'another factory reads none');
select throws_ok($$update public.stripe_withdrawals set state = 'fee_returned'$$, '42501', null, 'another factory cannot write');
reset role; select pg_temp.act_as(4); set local role authenticated;
select is((select count(*)::int from public.stripe_withdrawals where org_id = '6b000000-0000-0000-0000-0000000000f1'), 0, 'the brand reads none');

-- Staff read every row.
reset role; select pg_temp.act_as(5); set local role authenticated;
select is((select count(*)::int from public.stripe_withdrawals where org_id = '6b000000-0000-0000-0000-0000000000f1'), 2, 'staff read them');
select throws_ok($$update public.stripe_withdrawals set fee_cents = 0$$, '42501', null, 'staff cannot change a fee through the API either');

reset role;
select * from finish();
rollback;
