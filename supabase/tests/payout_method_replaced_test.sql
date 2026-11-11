-- A row that was another withdrawal method and is now a bank tells the company
-- (20261109100000), default or not, once.
begin;

create extension if not exists pgtap with schema extensions;

select plan(6);

set local session_replication_role = replica;

insert into auth.users (id, email) values
  ('98a00000-0000-0000-0000-000000000001', 'p98-factory@example.com');
insert into public.orgs (id, type, name, slug) values
  ('98b00000-0000-0000-0000-0000000000f1', 'factory', 'P98 Mill', 'pgtap98-mill');
insert into public.org_members (org_id, user_id, role, permissions) values
  ('98b00000-0000-0000-0000-0000000000f1', '98a00000-0000-0000-0000-000000000001', 'owner', '{}');
insert into public.factory_payout_accounts (id, org_id, method, paypal_email, is_primary, details_changed_at) values
  ('98c00000-0000-0000-0000-000000000001', '98b00000-0000-0000-0000-0000000000f1', 'paypal', 'p98-default@example.com', true, now()),
  ('98c00000-0000-0000-0000-000000000002', '98b00000-0000-0000-0000-0000000000f1', 'paypal', 'p98-paypal@example.com', false, now());
insert into public.factory_payout_accounts (id, org_id, method, payoneer_email, is_primary, details_changed_at) values
  ('98c00000-0000-0000-0000-000000000003', '98b00000-0000-0000-0000-0000000000f1', 'payoneer', 'p98-payoneer@example.com', false, now());

set local session_replication_role = origin;
select set_config('request.jwt.claims',
  json_build_object('sub', '98a00000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);

create function pg_temp.bells(pattern text) returns int language sql as $f$
  select count(*)::int from public.notifications
   where org_id = '98b00000-0000-0000-0000-0000000000f1' and kind = 'payout_method_changed' and body like pattern;
$f$;
grant execute on function pg_temp.bells(text) to authenticated, service_role;

set local role authenticated;
update public.factory_payout_accounts
   set method = 'bank', paypal_email = null, bank_name = 'P98 One', account_name = 'P98', account_number_last4 = '7777'
 where id = '98c00000-0000-0000-0000-000000000002';
reset role;
set constraints all immediate;
set constraints all deferred;
select is(pg_temp.bells('Your bank account at P98 One ending 7777 replaced a withdrawal method.%'), 1, 'PayPal to bank on a row that is not the default tells the company');
select is(pg_temp.bells('%P98 One%email operations@contact.sourcing-club.com now.'), 1, 'and says who to tell if nobody made it');

set local role authenticated;
update public.factory_payout_accounts
   set method = 'bank', payoneer_email = null, bank_name = 'P98 Two', account_name = 'P98', account_number_last4 = '8888'
 where id = '98c00000-0000-0000-0000-000000000003';
reset role;
set constraints all immediate;
set constraints all deferred;
select is(pg_temp.bells('Your bank account at P98 Two ending 8888 replaced a withdrawal method.%'), 1, 'so does Payoneer to bank');

set local role authenticated;
update public.factory_payout_accounts set account_name = 'P98 Renamed' where id = '98c00000-0000-0000-0000-000000000002';
reset role;
set constraints all immediate;
set constraints all deferred;
select is(pg_temp.bells('%P98 One%'), 1, 'editing a bank that is not the default still says nothing');

set local role authenticated;
update public.factory_payout_accounts
   set method = 'bank', paypal_email = null, bank_name = 'P98 Three', account_name = 'P98', account_number_last4 = '9999'
 where id = '98c00000-0000-0000-0000-000000000001';
reset role;
set constraints all immediate;
set constraints all deferred;
select is(pg_temp.bells('%P98 Three%replaced a withdrawal method.%'), 0, 'the default turning into a bank keeps the sentence it always had');
select cmp_ok(pg_temp.bells('%P98 Three%'), '>=', 1, 'and is still said');

select * from finish();
rollback;
