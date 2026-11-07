-- ============================================================================
-- Full bank account numbers (20261106600000, 20261106600100)
-- ----------------------------------------------------------------------------
-- Run with:  supabase test db
--
-- `pgtap66-` slugs and 66a…/66b… ids, every check scoped to these fixtures.
-- Every number here is fake and plainly so.
--
-- Written as the ways to get the number out, or to change where money goes
-- without anyone noticing. Almost entirely negative: a policy that grants
-- everything passes every positive test.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(128);

set local session_replication_role = replica;

insert into auth.users (id, email) values
  ('66a00000-0000-0000-0000-000000000001', 'p66-owner@example.com'),
  ('66a00000-0000-0000-0000-000000000002', 'p66-member@example.com'),
  ('66a00000-0000-0000-0000-000000000003', 'p66-brand@example.com'),
  ('66a00000-0000-0000-0000-000000000004', 'p66-other-owner@example.com'),
  ('66a00000-0000-0000-0000-000000000005', 'p66-staff@example.com'),
  ('66a00000-0000-0000-0000-000000000006', 'p66-staff-in-factory@example.com'),
  ('66a00000-0000-0000-0000-000000000007', 'p66-staff-in-brand@example.com'),
  ('66a00000-0000-0000-0000-000000000008', 'p66-stranger@example.com');

insert into public.platform_admins (user_id, note) values
  ('66a00000-0000-0000-0000-000000000005', 'pgtap66'),
  ('66a00000-0000-0000-0000-000000000006', 'pgtap66'),
  ('66a00000-0000-0000-0000-000000000007', 'pgtap66');

insert into public.orgs (id, type, name, slug) values
  ('66b00000-0000-0000-0000-00000000000b', 'brand',   'P66 Brand', 'pgtap66-brand'),
  ('66b00000-0000-0000-0000-0000000000f1', 'factory', 'P66 Mill',  'pgtap66-mill'),
  ('66b00000-0000-0000-0000-0000000000f2', 'factory', 'P66 Other', 'pgtap66-other'),
  ('66b00000-0000-0000-0000-0000000000f3', 'factory', 'P66 Stripe','pgtap66-stripe');

insert into public.org_members (org_id, user_id, role, permissions) values
  ('66b00000-0000-0000-0000-0000000000f1', '66a00000-0000-0000-0000-000000000001', 'owner',  '{primaryContact}'),
  ('66b00000-0000-0000-0000-0000000000f1', '66a00000-0000-0000-0000-000000000002', 'member', '{rfqFlow,addUpdate}'),
  ('66b00000-0000-0000-0000-0000000000f1', '66a00000-0000-0000-0000-000000000006', 'member', '{rfqFlow,addUpdate}'),
  ('66b00000-0000-0000-0000-00000000000b', '66a00000-0000-0000-0000-000000000003', 'owner',  '{primaryContact}'),
  ('66b00000-0000-0000-0000-00000000000b', '66a00000-0000-0000-0000-000000000007', 'member', '{rfqFlow}'),
  ('66b00000-0000-0000-0000-0000000000f2', '66a00000-0000-0000-0000-000000000004', 'owner',  '{primaryContact}'),
  ('66b00000-0000-0000-0000-0000000000f3', '66a00000-0000-0000-0000-000000000004', 'owner',  '{primaryContact}');

insert into public.stripe_connect_accounts (org_id, stripe_account_id, country, details_submitted, payouts_enabled, transfers_active) values
  ('66b00000-0000-0000-0000-0000000000f3', 'acct_p66stripe', 'GB', true, true, true);

insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total) values
  ('66d00000-0000-0000-0000-000000000001', '66b00000-0000-0000-0000-00000000000b', 'P66 mill', 'awarded', 'invited_only', 100),
  ('66d00000-0000-0000-0000-000000000003', '66b00000-0000-0000-0000-00000000000b', 'P66 stripe', 'awarded', 'invited_only', 100);
insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity, submitted_at) values
  ('66e00000-0000-0000-0000-000000000001', '66d00000-0000-0000-0000-000000000001', '66b00000-0000-0000-0000-0000000000f1', 'accepted', 100, 1, now()),
  ('66e00000-0000-0000-0000-000000000003', '66d00000-0000-0000-0000-000000000003', '66b00000-0000-0000-0000-0000000000f3', 'accepted', 100, 1, now());
insert into public.production_orders
  (id, rfq_id, quote_id, brand_org_id, factory_org_id, unit_price_cents,
   production_quantity, bulk_subtotal_cents, sample_subtotal_cents, order_total_cents, deposit_pct, balance_pct, order_number)
values
  ('66f00000-0000-0000-0000-000000000001', '66d00000-0000-0000-0000-000000000001', '66e00000-0000-0000-0000-000000000001',
   '66b00000-0000-0000-0000-00000000000b', '66b00000-0000-0000-0000-0000000000f1', 1000, 1, 1000, 0, 1000, 50, 50, 'P66-1'),
  ('66f00000-0000-0000-0000-000000000003', '66d00000-0000-0000-0000-000000000003', '66e00000-0000-0000-0000-000000000003',
   '66b00000-0000-0000-0000-00000000000b', '66b00000-0000-0000-0000-0000000000f3', 1000, 1, 1000, 0, 1000, 50, 50, 'P66-3');

insert into public.order_milestones (id, order_id, kind, title, amount_cents) values
  ('66900000-0000-0000-0000-000000000001', '66f00000-0000-0000-0000-000000000001', 'payment_only', 'P66 one', 1000),
  ('66900000-0000-0000-0000-000000000002', '66f00000-0000-0000-0000-000000000001', 'payment_only', 'P66 two', 1000),
  ('66900000-0000-0000-0000-000000000003', '66f00000-0000-0000-0000-000000000003', 'payment_only', 'P66 stripe', 1000);

insert into public.order_payments (id, order_id, milestone_id, amount_cents, currency, state, confirmed_at, release_requested_at, stripe_charge_id, stripe_payment_intent_id) values
  ('66800000-0000-0000-0000-000000000001', '66f00000-0000-0000-0000-000000000001', '66900000-0000-0000-0000-000000000001', 1000, 'USD', 'confirmed', now(), now(), null, null),
  ('66800000-0000-0000-0000-000000000002', '66f00000-0000-0000-0000-000000000001', '66900000-0000-0000-0000-000000000002', 1000, 'USD', 'confirmed', now(), now(), null, null),
  ('66800000-0000-0000-0000-000000000003', '66f00000-0000-0000-0000-000000000003', '66900000-0000-0000-0000-000000000003', 1000, 'USD', 'confirmed', now(), now(), 'ch_p66', 'pi_p66');

set local session_replication_role = origin;

create function pg_temp.act_as(who int) returns void language sql as $f$
  select set_config('request.jwt.claims',
    json_build_object('sub', '66a00000-0000-0000-0000-' || lpad(who::text, 12, '0'), 'role', 'authenticated')::text, true);
$f$;
grant execute on function pg_temp.act_as(int) to authenticated, anon, service_role;

-- A save with valid details: only the org, account and numbers vary.
create function pg_temp.save(org text, account text, n text, again text, instr text default null, holder text default 'P66 Mill Co Ltd', kind text default 'account')
returns public.factory_payout_accounts language sql as $f$
  select public.save_bank_payout_account(
    target_org => org::uuid, target_account => account::uuid, bank_name => 'P66 Bank', account_name => holder,
    bank_country => 'CN', swift => 'PSIXCNSH', branch => 'Ningbo branch', instructions => instr,
    account_number => n, account_number_again => again, number_kind => kind);
$f$;
grant execute on function pg_temp.save(text, text, text, text, text, text, text) to authenticated, anon, service_role;

-- Runs a statement and gives back what its failure tells the client (PostgREST
-- sends message, details and hint), for scanning.
create function pg_temp.error_text(statement text) returns text language plpgsql as $f$
declare m text; d text; h text;
begin
  execute statement;
  return 'no error';
exception when others then
  get stacked diagnostics m = message_text, d = pg_exception_detail, h = pg_exception_hint;
  return concat_ws(' | ', m, d, h);
end;
$f$;
grant execute on function pg_temp.error_text(text) to authenticated;

\set FAKE '''0000000000001234'''
\set SWAP '''0000000000771234'''

-- ---------------------- nobody reads it directly ---------------------------
select ok(not has_table_privilege('authenticated', 'public.payout_account_numbers', 'select,insert,update,delete'), 'a signed-in person holds no grant on the number table');
select ok(not has_table_privilege('anon', 'public.payout_account_numbers', 'select,insert,update,delete'), 'nor does a signed-out visitor');
select ok(not has_table_privilege('service_role', 'public.payout_account_numbers', 'select,insert,update,delete'), 'nor the server key, on our table');
select ok(not has_table_privilege('authenticated', 'public.payout_number_reveals', 'select,insert,update,delete'), 'nobody signed in touches the record of who looked');
select ok(not has_table_privilege('service_role', 'public.payout_number_reveals', 'insert,update,delete'), 'nor can the server key rewrite it');
select ok(not has_table_privilege('authenticated', 'vault.decrypted_secrets', 'select'), 'a signed-in person cannot read Vault');
select ok(not has_table_privilege('anon', 'vault.decrypted_secrets', 'select'), 'a signed-out visitor cannot read Vault');
select ok(not has_schema_privilege('authenticated', 'vault', 'usage'), 'a signed-in person cannot even reach the schema');
select ok(has_table_privilege('service_role', 'vault.decrypted_secrets', 'select'), 'KNOWN, for John: the server key reads Vault with no record');

select is(
  (select array_agg(column_name::text order by column_name) from information_schema.columns
    where table_schema = 'public' and table_name = 'payout_account_numbers'),
  array['account_id', 'number_kind', 'updated_at', 'vault_secret_id'],
  'the number table holds no plaintext, hash or partial'
);
select is(
  (select count(*)::int from information_schema.view_table_usage
    where table_name in ('payout_account_numbers', 'payout_number_reveals', 'bank_payouts')
       or (table_schema = 'vault' and view_schema not in ('vault'))),
  0,
  'no view reads the number, the record or Vault'
);
select is(
  (select count(*)::int from pg_publication_tables
    where tablename in ('payout_account_numbers', 'payout_number_reveals', 'bank_payouts', 'factory_payout_accounts')),
  0,
  'none of it goes out through Realtime'
);
select is(
  (select array_agg(p.proname::text order by p.proname)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosrc ~ 'payout_number_plain|decrypted_secrets|vault\.'),
  array['guard_payout_account_fields', 'payout_number_forget_secret', 'payout_number_plain',
        'payout_text_holds_number', 'payout_wise_recipient', 'reveal_payout_account_number',
        'save_bank_payout_account', 'save_wise_payout_account'],
  'only these functions decrypt or touch Vault: a new one fails here'
);
select is(
  (select array_agg(p.proname::text order by p.proname)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosrc ~ 'payout_number_reveals'),
  array['admin_payment_board', 'payout_number_reveal_log', 'payout_wise_recipient', 'reveal_payout_account_number'],
  'only these read or write the record of who looked'
);
select ok(not has_function_privilege('authenticated', 'public.payout_number_plain(uuid)', 'execute'), 'nobody signed in may call the decrypting function');
select ok(not has_function_privilege('service_role', 'public.payout_number_plain(uuid)', 'execute'), 'nor the server key');
select ok(not has_function_privilege('authenticated', 'public.payout_text_holds_number(uuid, text)', 'execute'), 'nor ask whether a text holds a number, which would tell it digit by digit');
select ok(not has_function_privilege('anon', 'public.save_bank_payout_account(uuid, uuid, text, text, text, text, text, text, text, text, text)', 'execute'), 'a signed-out visitor cannot save one');
select ok(not has_function_privilege('anon', 'public.reveal_payout_account_number(uuid)', 'execute'), 'nor reveal one');

-- ---------------------- who may save one -----------------------------------
reset role; select pg_temp.act_as(2); set local role authenticated;
select throws_ok(
  $$ select pg_temp.save('66b00000-0000-0000-0000-0000000000f1', null, '0000000000001234', '0000000000001234') $$,
  '42501', null, 'a factory member cannot save a bank account');
reset role; select pg_temp.act_as(3); set local role authenticated;
select throws_ok(
  $$ select pg_temp.save('66b00000-0000-0000-0000-0000000000f1', null, '0000000000001234', '0000000000001234') $$,
  '42501', null, 'a brand cannot save one for a factory');
select throws_ok(
  $$ select pg_temp.save('66b00000-0000-0000-0000-00000000000b', null, '0000000000001234', '0000000000001234') $$,
  '42501', null, 'a brand cannot save one for itself');
reset role; select pg_temp.act_as(5); set local role authenticated;
select throws_ok(
  $$ select pg_temp.save('66b00000-0000-0000-0000-0000000000f1', null, '0000000000001234', '0000000000001234') $$,
  '42501', null, 'staff cannot save one for a factory');
reset role; select pg_temp.act_as(4); set local role authenticated;
select throws_ok(
  $$ select pg_temp.save('66b00000-0000-0000-0000-0000000000f1', null, '0000000000001234', '0000000000001234') $$,
  '42501', null, 'another factory''s owner cannot save one here');

-- ---------------------- what it refuses ------------------------------------
reset role; select pg_temp.act_as(1); set local role authenticated;
select throws_ok(
  $$ select pg_temp.save('66b00000-0000-0000-0000-0000000000f1', null, '0000000000001234', '0000000000001235') $$,
  '22023', 'the two account numbers do not match', 'two numbers that differ are refused');
select throws_ok(
  $$ select pg_temp.save('66b00000-0000-0000-0000-0000000000f1', null, null, null) $$,
  '22023', 'add the full account number so TSC can pay you', 'a new account needs a number');
select throws_ok(
  $$ select pg_temp.save('66b00000-0000-0000-0000-0000000000f1', null, '123', '123') $$,
  '22023', 'an account number is 5 to 34 letters and digits', 'too short is refused');
select throws_ok(
  $$ select pg_temp.save('66b00000-0000-0000-0000-0000000000f1', null, 'ABCDEFGH', 'ABCDEFGH') $$,
  '22023', 'an account number is 5 to 34 letters and digits', 'no digits is refused');
select throws_ok(
  $$ select pg_temp.save('66b00000-0000-0000-0000-0000000000f1', null, 'GB82WEST12345698765433', 'GB82WEST12345698765433', null, 'P66 Mill Co Ltd', 'iban') $$,
  '22023', 'that IBAN does not check out', 'an IBAN with a typo is refused');
select throws_ok(
  $$ select public.save_bank_payout_account(target_org => '66b00000-0000-0000-0000-0000000000f1', bank_name => 'B', account_name => 'H', bank_country => 'CN', swift => 'nope', account_number => '0000000000001234', account_number_again => '0000000000001234') $$,
  '22023', 'a SWIFT / BIC is 8 or 11 letters and digits', 'a bad SWIFT is refused');
select throws_ok(
  $$ select public.save_bank_payout_account(target_org => '66b00000-0000-0000-0000-0000000000f1', bank_name => 'B', account_name => 'H', swift => 'PSIXCNSH', account_number => '0000000000001234', account_number_again => '0000000000001234') $$,
  '22023', 'name your bank''s country in the instructions', 'no country and no instructions is refused');
select throws_ok(
  $$ select pg_temp.save('66b00000-0000-0000-0000-0000000000f1', null, '0000000000001234', '0000000000001234', 'Account 0000 0000 0000 1234 please') $$,
  '22023', 'an account number belongs only in the account number field', 'the number in the instructions, spaced, is refused');
select throws_ok(
  $$ select pg_temp.save('66b00000-0000-0000-0000-0000000000f1', null, '0000000000001234', '0000000000001234', '００００００００００００１２３４') $$,
  '22023', 'an account number belongs only in the account number field', 'in full-width digits too');
select throws_ok(
  $$ select pg_temp.save('66b00000-0000-0000-0000-0000000000f1', null, '0000000000001234', '0000000000001234', null, 'Mill 0000-0000-0000-1234') $$,
  '22023', 'an account number belongs only in the account number field', 'and in the holder''s name');
select is(
  (select count(*)::int from public.factory_payout_accounts where org_id = '66b00000-0000-0000-0000-0000000000f1'),
  0, 'no refused save left anything behind');

-- Nothing a failure says carries the number.
select ok(position('1234' in pg_temp.error_text($$ select pg_temp.save('66b00000-0000-0000-0000-0000000000f1', null, '0000000000001234', '0000000000001235') $$)) = 0, 'a mismatch says neither number');
select ok(position('0000000000' in pg_temp.error_text($$ select pg_temp.save('66b00000-0000-0000-0000-0000000000f1', null, '0000000000001234', '0000000000001234', '0000000000001234') $$)) = 0, 'a number in the wrong field is not repeated');
select ok(position('@@@' in pg_temp.error_text($$ select pg_temp.save('66b00000-0000-0000-0000-0000000000f1', null, '@@@', '@@@') $$)) = 0, 'a badly formed number is not repeated');

-- ---------------------- saving ---------------------------------------------
select is(
  (select account_number_last4 from pg_temp.save('66b00000-0000-0000-0000-0000000000f1', null, '0000 0000 0000 1234', '0000-0000-0000-1234')),
  '1234', 'the owner saves it, however it is spaced, and gets back the last four');
select ok(
  (select to_jsonb(a)::text not like '%000000000000%' from public.factory_payout_accounts a where org_id = '66b00000-0000-0000-0000-0000000000f1'),
  'the row holds no number');
create temp table p66 on commit drop as select id from public.factory_payout_accounts where org_id = '66b00000-0000-0000-0000-0000000000f1';
grant select on p66 to authenticated, anon, service_role;

select throws_ok($$ select * from public.payout_account_numbers $$, '42501', null, 'the owner cannot read the number table');
select throws_ok($$ select * from vault.decrypted_secrets $$, '42501', null, 'the owner cannot read Vault');
select throws_ok($$ select public.payout_number_plain((select id from p66)) $$, '42501', null, 'nor call the decrypting function');
select throws_ok($$ select * from public.reveal_payout_account_number((select id from p66)) $$, '42501', 'this is limited to platform staff', 'the owner cannot reveal its own number: it reads the last four');
select throws_ok($$ select * from public.payout_number_reveal_log() $$, '42501', null, 'the owner cannot read the record');

reset role;
set constraints all immediate; set constraints all deferred;
select is(
  (select count(*)::int from public.notifications where org_id = '66b00000-0000-0000-0000-0000000000f1' and kind = 'payout_method_changed'),
  1, 'one save is one notice to the company');
select ok(
  (select body like '%ending 1234%' and body not like '%000000000000%' from public.notifications where org_id = '66b00000-0000-0000-0000-0000000000f1' and kind = 'payout_method_changed'),
  'and it names the last four, never the number');

-- ---------------------- a member, and a brand ------------------------------
select pg_temp.act_as(2); set local role authenticated;
select is((select account_number_last4 from public.factory_payout_accounts where id = (select id from p66)), '1234', 'a member reads the last four');
select ok((select number_changed_at is not null from public.factory_payout_accounts where id = (select id from p66)), 'and that a full number is on file');
select throws_ok($$ select * from public.reveal_payout_account_number((select id from p66)) $$, '42501', null, 'but cannot reveal it');
select throws_ok($$ select * from public.payout_account_numbers $$, '42501', null, 'nor read the table');

reset role; select pg_temp.act_as(3); set local role authenticated;
select is((select count(*)::int from public.factory_payout_accounts where org_id = '66b00000-0000-0000-0000-0000000000f1'), 0, 'a brand with money owed reads no account');
select throws_ok($$ select * from public.reveal_payout_account_number((select id from p66)) $$, '42501', 'this is limited to platform staff', 'and cannot reveal one');
select throws_ok($$ select * from public.admin_payment_board() $$, '42501', null, 'nor read the board');

reset role; select pg_temp.act_as(8); set local role authenticated;
select throws_ok($$ select * from public.reveal_payout_account_number((select id from p66)) $$, '42501', 'this is limited to platform staff', 'a stranger gets the same refusal for a real account');
select throws_ok($$ select * from public.reveal_payout_account_number('66000000-0000-0000-0000-000000000000') $$, '42501', 'this is limited to platform staff', 'as for an invented one: nothing says which exists');

reset role; set local role anon;
select throws_ok($$ select * from public.reveal_payout_account_number((select id from p66)) $$, '42501', null, 'signed out is refused before anything runs');
select throws_ok($$ select * from public.factory_payout_accounts $$, '42501', null, 'and reads no account');

-- ---------------------- two hats --------------------------------------------
reset role; select pg_temp.act_as(6); set local role authenticated;
select throws_ok($$ select * from public.reveal_payout_account_number((select id from p66)) $$, '42501', 'you belong to this company, so someone else on the staff must pay it', 'staff in the factory cannot reveal its number');
select throws_ok($$ select public.release_payment_to_factory('66800000-0000-0000-0000-000000000001', 'WIRE-REF-1') $$, '42501', 'you belong to this company, so someone else on the staff must record its payout', 'nor mark it paid');
reset role; select pg_temp.act_as(7); set local role authenticated;
select throws_ok($$ select * from public.reveal_payout_account_number((select id from p66)) $$, '42501', 'your company has an order with this factory, so someone else on the staff must pay it', 'staff in the brand on the order cannot reveal it');

-- ---------------------- staff ------------------------------------------------
reset role; select pg_temp.act_as(5); set local role authenticated;
select throws_ok($$ select * from public.payout_account_numbers $$, '42501', null, 'staff cannot read the number table');
select throws_ok($$ select * from public.payout_number_reveals $$, '42501', null, 'nor the record directly');
select throws_ok($$ select * from vault.decrypted_secrets $$, '42501', null, 'nor Vault');
select throws_ok($$ select * from public.reveal_payout_account_number('66000000-0000-0000-0000-000000000000') $$, 'P0002', null, 'an account that does not exist is said to staff');
select is((select count(*)::int from public.payout_number_reveal_log() where org_name = 'P66 Mill'), 0, 'refused attempts saw nothing and left no record');
select is((select account_number from public.reveal_payout_account_number((select id from p66))), '0000000000001234', 'staff read the number while a payout is owed');
select is((select staff_email || ' ' || last4 from public.payout_number_reveal_log() where org_name = 'P66 Mill'), 'p66-staff@example.com 1234', 'and it says who, and which account');
select is((select count(*)::int from public.payout_number_reveal_log() where org_name = 'P66 Mill'), 1, 'one read, one record');
select is((select last_viewed_by from public.admin_payment_board() where payment_id = '66800000-0000-0000-0000-000000000001'), 'p66-staff@example.com', 'the row says who looked last');
select throws_ok($$ update public.payout_number_reveals set staff_email = 'x' $$, '42501', null, 'staff cannot rewrite the record');
select throws_ok($$ delete from public.payout_number_reveals $$, '42501', null, 'nor delete it');

-- What the board carries, and does not.
select is(
  (select payout_holder || ' / ' || payout_bank || ' / ' || payout_branch || ' / ' || payout_country || ' / ' || payout_swift || ' / ' || payout_last4
     from public.admin_payment_board() where payment_id = '66800000-0000-0000-0000-000000000001'),
  'P66 Mill Co Ltd / P66 Bank / Ningbo branch / CN / PSIXCNSH / 1234',
  'the row has what a bank asks for');
select is((select contact_email from public.admin_payment_board() where payment_id = '66800000-0000-0000-0000-000000000001'), 'p66-owner@example.com', 'and who to ask');
select ok((select payout_has_number and payout_changed_recently from public.admin_payment_board() where payment_id = '66800000-0000-0000-0000-000000000001'), 'and that a number is on file and is new');
select ok(
  (select bool_and(to_jsonb(b)::text not like '%000000000000%') from public.admin_payment_board() b),
  'no number anywhere on the board');

-- Nothing owed, or Stripe pays it, or not the one TSC pays: stays hidden.
reset role; select pg_temp.act_as(4); set local role authenticated;
create temp table p66_other on commit drop as select id from pg_temp.save('66b00000-0000-0000-0000-0000000000f2', null, '0000000000005555', '0000000000005555', null, 'P66 Other Co');
create temp table p66_stripe on commit drop as select id from pg_temp.save('66b00000-0000-0000-0000-0000000000f3', null, '0000000000006666', '0000000000006666', null, 'P66 Stripe Co');
grant select on p66_other, p66_stripe to authenticated;
reset role; select pg_temp.act_as(1); set local role authenticated;
create temp table p66_second on commit drop as select id from pg_temp.save('66b00000-0000-0000-0000-0000000000f1', null, '0000000000007777', '0000000000007777');
grant select on p66_second to authenticated;
reset role; select pg_temp.act_as(5); set local role authenticated;
select throws_ok($$ select * from public.reveal_payout_account_number((select id from p66_other)) $$, '22023', 'TSC does not owe this company a payout by hand, so its number stays hidden', 'a factory owed nothing stays hidden');
select throws_ok($$ select * from public.reveal_payout_account_number((select id from p66_stripe)) $$, '22023', 'TSC does not owe this company a payout by hand, so its number stays hidden', 'a payout Stripe makes stays hidden');
select throws_ok($$ select * from public.reveal_payout_account_number((select id from p66_second)) $$, '22023', 'TSC does not owe this company a payout by hand, so its number stays hidden', 'an account TSC does not pay stays hidden');

-- ---------------------- changing where the money goes ----------------------
reset role;
set constraints all immediate; set constraints all deferred;
create temp table p66_before on commit drop as
  select number_changed_at, details_changed_at,
         (select count(*) from public.notifications where org_id = '66b00000-0000-0000-0000-0000000000f1' and kind = 'payout_method_changed') as notices
    from public.factory_payout_accounts where id = (select id from p66);
grant select on p66_before to authenticated;

select pg_temp.act_as(1); set local role authenticated;
select is((select account_number_last4 from pg_temp.save('66b00000-0000-0000-0000-0000000000f1', (select id::text from p66), '0000000000771234', '0000000000771234')), '1234', 'a new number with the same last four saves');
reset role;
set constraints all immediate; set constraints all deferred;
select is(
  (select count(*) from public.notifications where org_id = '66b00000-0000-0000-0000-0000000000f1' and kind = 'payout_method_changed') - (select notices from p66_before),
  1::bigint, 'and the company is told: the last four alone would have hidden it');
select ok((select a.details_changed_at > b.details_changed_at from public.factory_payout_accounts a, p66_before b where a.id = (select id from p66)), 'and the board sees the change');
select is(public.payout_number_plain((select id from p66)), '0000000000771234', 'the old number is gone');

-- Saving the same details again is no change.
create temp table p66_again on commit drop as select details_changed_at from public.factory_payout_accounts where id = (select id from p66);
grant select on p66_again to authenticated;
select pg_temp.act_as(1); set local role authenticated;
select lives_ok($$ select pg_temp.save('66b00000-0000-0000-0000-0000000000f1', (select id::text from p66), null, null) $$, 'blank keeps the stored number');
reset role;
select is(public.payout_number_plain((select id from p66)), '0000000000771234', 'it is still there');
select is((select a.details_changed_at from public.factory_payout_accounts a where a.id = (select id from p66)), (select details_changed_at from p66_again), 'and nothing is said to have changed');

-- A stale board.
select pg_temp.act_as(5); set local role authenticated;
select throws_ok(
  $$ select public.release_payment_to_factory('66800000-0000-0000-0000-000000000001', 'WIRE-REF-1', (select details_changed_at from p66_before)) $$,
  '22023', 'this factory changed where it is paid', 'a tab showing the old account cannot mark it paid');

-- Hiding the change.
reset role; select pg_temp.act_as(1); set local role authenticated;
update public.factory_payout_accounts set details_changed_at = '2020-01-01', number_changed_at = '2020-01-01' where id = (select id from p66);
select is((select details_changed_at from public.factory_payout_accounts where id = (select id from p66)), (select details_changed_at from p66_again), 'the owner cannot set the change back');
select ok((select number_changed_at > '2021-01-01' from public.factory_payout_accounts where id = (select id from p66)), 'nor the number''s date');
select throws_ok($$ update public.factory_payout_accounts set org_id = '66b00000-0000-0000-0000-0000000000f2' where id = (select id from p66) $$, '42501', null, 'a row cannot be moved to another company, number and all');
select throws_ok($$ update public.factory_payout_accounts set instructions = 'ref 0000 0000 0077 1234' where id = (select id from p66) $$, '22023', 'an account number belongs only in the account number field', 'a direct write cannot paste the number either');
select throws_ok($$ update public.factory_payout_accounts set label = '0000000000771234' where id = (select id from p66) $$, '22023', null, 'nor as a label');
select throws_ok($$ update public.factory_payout_accounts set iban = 'GB82WEST12345698765432' where id = (select id from p66) $$, '22023', null, 'an IBAN cannot go in the open column');
select throws_ok($$ insert into public.factory_payout_accounts (org_id, bank_name, iban) values ('66b00000-0000-0000-0000-0000000000f1', 'B', 'GB82WEST12345698765432') $$, '22023', null, 'on a new row either');

-- A member cannot change a thing.
reset role; select pg_temp.act_as(2); set local role authenticated;
update public.factory_payout_accounts set bank_name = 'Hacked' where id = (select id from p66);
select is((select bank_name from public.factory_payout_accounts where id = (select id from p66)), 'P66 Bank', 'a member''s direct update changes nothing');

-- A direct last four that disagrees drops the number, instead of a mismatch.
reset role; select pg_temp.act_as(4); set local role authenticated;
update public.factory_payout_accounts set account_number_last4 = '9999' where id = (select id from p66_other);
reset role;
select is((select number_changed_at from public.factory_payout_accounts where id = (select id from p66_other)), null, 'a last four that disagrees makes it last-four-only');
select is((select count(*)::int from vault.secrets where name = 'payout-number-' || (select id from p66_other)::text), 0, 'and the secret goes');

-- Becoming Payoneer removes the number.
select pg_temp.act_as(4); set local role authenticated;
update public.factory_payout_accounts set method = 'payoneer', payoneer_email = 'p66@example.com', bank_name = null, account_name = null, account_number_last4 = null, swift = null, branch = null
 where id = (select id from p66_stripe);
reset role;
select is((select count(*)::int from vault.secrets where name = 'payout-number-' || (select id from p66_stripe)::text), 0, 'a row turned into Payoneer keeps no number');

-- IBANs.
select pg_temp.act_as(1); set local role authenticated;
create temp table p66_iban on commit drop as select id, iban, account_number_last4 from pg_temp.save('66b00000-0000-0000-0000-0000000000f1', null, 'GB82 WEST 1234 5698 7654 32', 'GB82WEST12345698765432', null, 'P66 Mill Co Ltd', 'iban');
reset role;
select is((select iban from p66_iban), null, 'an IBAN is not on the row');
select is(public.payout_number_plain((select id from p66_iban)), 'GB82WEST12345698765432', 'it is with the numbers');
select is((select account_number_last4 from p66_iban), '5432', 'with its last four on the row');

-- ---------------------- marking it paid -------------------------------------
select pg_temp.act_as(5); set local role authenticated;
select throws_ok($$ select public.release_payment_to_factory('66800000-0000-0000-0000-000000000001') $$, '22023', 'enter the bank''s reference for this transfer', 'no reference, no mark');
select throws_ok($$ select public.release_payment_to_factory('66800000-0000-0000-0000-000000000001', '    ') $$, '22023', 'enter the bank''s reference for this transfer', 'spaces are not a reference');
select throws_ok($$ select public.release_payment_to_factory('66800000-0000-0000-0000-000000000001', '---') $$, '22023', 'enter the bank''s reference for this transfer', 'nor is punctuation');
select throws_ok($$ select public.release_payment_to_factory('66800000-0000-0000-0000-000000000001', 'Paid to 0000 0000 0077 1234') $$, '22023', 'the factory and the brand can read this, so it cannot hold the account number', 'the number as the reference is refused: the brand can read it');
select lives_ok($$ select public.release_payment_to_factory('66800000-0000-0000-0000-000000000001', 'WIRE-REF-1', (select details_changed_at from public.factory_payout_accounts where id = (select id from p66))) $$, 'with a reference, from a current board, it goes');
select throws_ok($$ select public.release_payment_to_factory('66800000-0000-0000-0000-000000000001', 'WIRE-REF-1') $$, '22023', 'that payout was already marked as paid', 'once');

reset role;
select is((select body from public.notifications where subject_id = '66800000-0000-0000-0000-000000000001' and kind = 'funds_released'), 'Sent by bank transfer against P66-1. TSC''s note: WIRE-REF-1', 'the factory reads the reference');
select is((select paid_to_holder || ' ' || paid_to_bank || ' ' || paid_to_last4 || ' ' || reference from public.bank_payouts where payment_id = '66800000-0000-0000-0000-000000000001'), 'P66 Mill Co Ltd P66 Bank 1234 WIRE-REF-1', 'and the record says where it went');

select pg_temp.act_as(3); set local role authenticated;
select is((select count(*)::int from public.bank_payouts where payment_id = '66800000-0000-0000-0000-000000000001'), 0, 'a brand does not read where it went');
reset role; select pg_temp.act_as(2); set local role authenticated;
select is((select count(*)::int from public.bank_payouts where payment_id = '66800000-0000-0000-0000-000000000001'), 1, 'a factory member does');
select throws_ok($$ insert into public.bank_payouts (payment_id, factory_org_id, reference) values ('66800000-0000-0000-0000-000000000002', '66b00000-0000-0000-0000-0000000000f1', 'x') $$, '42501', null, 'and nobody writes it directly');

-- ---------------------- the number lands nowhere else -----------------------
reset role;
create function pg_temp.scan(sql_text text) returns boolean language plpgsql as $f$
declare hit boolean;
begin
  execute format($q$ select coalesce(bool_or(t::text ~ '0{10}[0-9]{4}|0{8}77|GB82WEST|0000000000001234'), false) from (%s) t $q$, sql_text) into hit;
  return hit;
end;
$f$;
select ok(not pg_temp.scan($$ select * from public.notifications where org_id in ('66b00000-0000-0000-0000-0000000000f1', '66b00000-0000-0000-0000-0000000000f2', '66b00000-0000-0000-0000-0000000000f3') $$), 'not in notifications');
select ok(not pg_temp.scan($$ select * from public.notification_email_outbox $$), 'nor the email outbox');
select ok(not pg_temp.scan($$ select * from public.payment_events where payment_id::text like '668%' $$), 'nor payment events');
select ok(not pg_temp.scan($$ select * from public.order_payments where id::text like '668%' $$), 'nor the payment row the brand reads');
select ok(not pg_temp.scan($$ select * from public.bank_payouts where payment_id::text like '668%' $$), 'nor the payout record');
select ok(not pg_temp.scan($$ select * from public.payout_number_reveals where org_name like 'P66%' $$), 'nor the record of who looked');
select ok(not pg_temp.scan($$ select * from public.factory_payout_accounts where org_id::text like '66b%' $$), 'nor any payout row');
select ok(not pg_temp.scan($$ select n.account_id, n.vault_secret_id, n.number_kind from public.payout_account_numbers n join public.factory_payout_accounts a on a.id = n.account_id where a.org_id::text like '66b%' $$), 'nor the number table');
select ok(not pg_temp.scan($$ select s.id, s.name, s.description, s.secret from vault.secrets s where s.name like 'payout-number-%' $$), 'and Vault itself holds it encrypted, with no number in its name');
select pg_temp.act_as(5);
select ok(not pg_temp.scan($$ select public.admin_review_assist_input('66b00000-0000-0000-0000-0000000000f1') $$), 'nor what the review assistant sends a model');

-- ---------------------- deleting ---------------------------------------------
reset role;
select is((select count(*)::int from vault.secrets where name = 'payout-number-' || (select id from p66_second)::text), 1, 'a stored number has its secret');
select pg_temp.act_as(1); set local role authenticated;
delete from public.factory_payout_accounts where id = (select id from p66_second);
reset role;
select is((select count(*)::int from vault.secrets where name = 'payout-number-' || (select id from p66_second)::text), 0, 'removing the account removes the secret');
create temp table p66_gone on commit drop as select id from public.factory_payout_accounts where org_id = '66b00000-0000-0000-0000-0000000000f1';
select is((select count(*)::int from public.payout_number_reveals where org_name = 'P66 Mill'), 1, 'a record exists before the company goes');
delete from public.production_orders where factory_org_id = '66b00000-0000-0000-0000-0000000000f1';
-- With no signed-in person, as the seed and the server delete: the delete guard
-- refuses staff when the company has two accounts (an older bug, reported).
select set_config('request.jwt.claims', '', true);
select lives_ok($$ delete from public.orgs where id = '66b00000-0000-0000-0000-0000000000f1' $$, 'the company is deleted');
select is((select count(*)::int from vault.secrets s join p66_gone g on s.name = 'payout-number-' || g.id::text), 0, 'and takes its secrets with it');
select is((select count(*)::int from public.payout_number_reveals where org_name = 'P66 Mill'), 1, 'but the record of who looked stays');

select * from finish();
rollback;
