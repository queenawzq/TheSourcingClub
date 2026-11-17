begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

-- These rules are tested with Wise switched on (20261117200000 starts it off).
update public.payout_provider_settings set enabled = true where provider = 'wise';

set local session_replication_role = replica;

insert into auth.users (id, email) values
  ('16a00000-0000-0000-0000-000000000001', 'p116-owner@example.com'),
  ('16a00000-0000-0000-0000-000000000002', 'p116-member@example.com'),
  ('16a00000-0000-0000-0000-000000000003', 'p116-other-owner@example.com'),
  ('16a00000-0000-0000-0000-000000000004', 'p116-brand@example.com'),
  ('16a00000-0000-0000-0000-000000000005', 'p116-staff@example.com'),
  ('16a00000-0000-0000-0000-000000000006', 'p116-staff-in-factory@example.com');

insert into public.platform_admins (user_id, note) values
  ('16a00000-0000-0000-0000-000000000005', 'pgtap116'),
  ('16a00000-0000-0000-0000-000000000006', 'pgtap116');

insert into public.orgs (id, type, name, slug) values
  ('16b00000-0000-0000-0000-00000000000b', 'brand',   'P116 Brand', 'pgtap116-brand'),
  ('16b00000-0000-0000-0000-0000000000f1', 'factory', 'P116 Mill',  'pgtap116-mill'),
  ('16b00000-0000-0000-0000-0000000000f2', 'factory', 'P116 Other', 'pgtap116-other');

insert into public.org_members (org_id, user_id, role, permissions) values
  ('16b00000-0000-0000-0000-0000000000f1', '16a00000-0000-0000-0000-000000000001', 'owner', '{}'),
  ('16b00000-0000-0000-0000-0000000000f1', '16a00000-0000-0000-0000-000000000002', 'member', '{}'),
  ('16b00000-0000-0000-0000-0000000000f1', '16a00000-0000-0000-0000-000000000006', 'member', '{}'),
  ('16b00000-0000-0000-0000-0000000000f2', '16a00000-0000-0000-0000-000000000003', 'owner', '{}'),
  ('16b00000-0000-0000-0000-00000000000b', '16a00000-0000-0000-0000-000000000004', 'owner', '{}');

insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total)
values ('16c00000-0000-0000-0000-000000000001', '16b00000-0000-0000-0000-00000000000b', 'P116 request', 'awarded', 'invited_only', 100);
insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity, submitted_at)
values ('16c00000-0000-0000-0000-000000000002', '16c00000-0000-0000-0000-000000000001', '16b00000-0000-0000-0000-0000000000f1', 'accepted', 100, 1, now());
insert into public.production_orders
  (id, rfq_id, quote_id, brand_org_id, factory_org_id, unit_price_cents,
   production_quantity, bulk_subtotal_cents, sample_subtotal_cents, order_total_cents, deposit_pct, balance_pct, order_number)
values ('16d00000-0000-0000-0000-000000000001', '16c00000-0000-0000-0000-000000000001', '16c00000-0000-0000-0000-000000000002',
        '16b00000-0000-0000-0000-00000000000b', '16b00000-0000-0000-0000-0000000000f1', 1000, 1, 1000, 0, 1000, 50, 50, 'P116-1');
insert into public.order_milestones (id, order_id, kind, title, amount_cents)
select ('16e00000-0000-0000-0000-00000000000' || n)::uuid, '16d00000-0000-0000-0000-000000000001', 'payment_only', 'P116 step ' || n, 100000
  from generate_series(1, 4) n;
-- Three approved ($1,000 each) in the balance; the fourth is not approved yet.
insert into public.order_payments (id, order_id, milestone_id, amount_cents, currency, state, confirmed_at, release_requested_at, withdrawal_pool)
select ('16f00000-0000-0000-0000-00000000000' || n)::uuid, '16d00000-0000-0000-0000-000000000001',
       ('16e00000-0000-0000-0000-00000000000' || n)::uuid, 100000, 'USD', 'confirmed', now(),
       case when n = 4 then null else now() - (5 - n) * interval '1 hour' end, n < 4
  from generate_series(1, 4) n;

insert into public.factory_payout_accounts
  (id, org_id, method, bank_name, account_name, account_number_last4, swift, bank_country, is_primary,
   wise_recipient_type, wise_currency, wise_number_key, wise_details, details_changed_at, number_changed_at)
values ('16a10000-0000-0000-0000-000000000001', '16b00000-0000-0000-0000-0000000000f1', 'bank', 'Demo Bank', 'P116 MILL LTD', '1234', 'BOSHCNSH', 'CN', true,
        'chinese_local_business', 'CNY', 'accountNumber', '{"accountHolderName":"P116 MILL LTD"}', '2026-11-01 00:00:00+00', now());
insert into public.factory_payout_accounts (id, org_id, method, paypal_email, is_primary, details_changed_at)
values ('16a10000-0000-0000-0000-000000000002', '16b00000-0000-0000-0000-0000000000f1', 'paypal', 'p116@example.com', false, '2026-11-01 00:00:00+00'),
       ('16a10000-0000-0000-0000-000000000003', '16b00000-0000-0000-0000-0000000000f2', 'paypal', 'p116-other@example.com', true, '2026-11-01 00:00:00+00');
set local session_replication_role = origin;

create function pg_temp.act_as(who int) returns void language sql as $f$
  select set_config('request.jwt.claims',
    json_build_object('sub', '16a00000-0000-0000-0000-' || lpad(who::text, 12, '0'), 'role', 'authenticated')::text, true);
$f$;
grant execute on function pg_temp.act_as(int) to authenticated, anon, service_role;


select is(public.factory_withdrawable('16b00000-0000-0000-0000-0000000000f1'), 300000::bigint, 'balance is the approved pool earnings');

-- Nobody writes the table directly.
select pg_temp.act_as(1); set local role authenticated;
select throws_ok($$insert into public.factory_withdrawals (org_id, provider, amount_cents, paid_to) values ('16b00000-0000-0000-0000-0000000000f1', 'wise', 1, 'x')$$,
  '42501', null, 'owner cannot insert a withdrawal directly');
select throws_ok($$select public.factory_withdrawable('16b00000-0000-0000-0000-0000000000f1')$$, '42501', null, 'the internal balance is not callable');

-- Strangers and members.
reset role; select pg_temp.act_as(3); set local role authenticated;
select throws_ok($$select public.my_withdrawal_balance('16b00000-0000-0000-0000-0000000000f1')$$, '42501', null, 'another company cannot read the balance');
select throws_ok($$select public.request_withdrawal('16b00000-0000-0000-0000-0000000000f1', 1000, '16a10000-0000-0000-0000-000000000001')$$, '42501', null, 'another company cannot withdraw');
select throws_ok($$select public.request_withdrawal('16b00000-0000-0000-0000-0000000000f2', 1000, '16a10000-0000-0000-0000-000000000003')$$, '22023', null, 'nothing in the other company''s balance');
reset role; select pg_temp.act_as(2); set local role authenticated;
select is((public.my_withdrawal_balance('16b00000-0000-0000-0000-0000000000f1')->>'available_cents')::bigint, 300000::bigint, 'a member reads the balance');
select throws_ok($$select public.request_withdrawal('16b00000-0000-0000-0000-0000000000f1', 1000, '16a10000-0000-0000-0000-000000000001')$$, '42501', null, 'a member cannot withdraw');
-- Staff who belong to the company are a member there, not an owner.
reset role; select pg_temp.act_as(6); set local role authenticated;
select throws_ok($$select public.request_withdrawal('16b00000-0000-0000-0000-0000000000f1', 1000, '16a10000-0000-0000-0000-000000000001')$$, '42501', null, 'staff in the company cannot withdraw for it');

-- Owner.
reset role; select pg_temp.act_as(1); set local role authenticated;
select throws_ok($$select public.request_withdrawal('16b00000-0000-0000-0000-0000000000f1', 300001, '16a10000-0000-0000-0000-000000000001')$$, '22023', 'That is more than your balance.', 'more than the balance is refused');
select throws_ok($$select public.request_withdrawal('16b00000-0000-0000-0000-0000000000f1', 0, '16a10000-0000-0000-0000-000000000001')$$, '22023', null, 'zero is refused');
select throws_ok($$select public.request_withdrawal('16b00000-0000-0000-0000-0000000000f1', 1000, '16a10000-0000-0000-0000-000000000003')$$, '22023', null, 'another company''s account is refused');
select is((public.request_withdrawal('16b00000-0000-0000-0000-0000000000f1', 300000, '16a10000-0000-0000-0000-000000000001')).provider, 'wise', 'owner withdraws everything; the database picks Wise from the account');
select throws_ok($$select public.request_withdrawal('16b00000-0000-0000-0000-0000000000f1', 1, '16a10000-0000-0000-0000-000000000002')$$, '22023', 'That is more than your balance.', 'a second request beyond what is left is refused');
select is((public.my_withdrawal_balance('16b00000-0000-0000-0000-0000000000f1')->>'available_cents')::bigint, 0::bigint, 'the request takes the balance');
select is((select count(*)::int from public.notifications where org_id = '16b00000-0000-0000-0000-0000000000f1' and kind = 'withdrawal'), 1, 'the company is told');
reset role;

-- A factory cannot approve or record.
select pg_temp.act_as(1); set local role authenticated;
select throws_ok($$select public.claim_withdrawal((select id from public.factory_withdrawals where org_id='16b00000-0000-0000-0000-0000000000f1' and status='requested'))$$, '42501', null, 'the factory cannot approve');
select throws_ok($$select public.record_withdrawal((select id from public.factory_withdrawals where org_id='16b00000-0000-0000-0000-0000000000f1' and status='requested'), 'paid')$$, '42501', null, 'the factory cannot record a payment');
select throws_ok($$select public.decline_withdrawal((select id from public.factory_withdrawals where org_id='16b00000-0000-0000-0000-0000000000f1' and status='requested'), 'nope')$$, '42501', null, 'the factory cannot decline');
-- Cancel restores.
select is((public.cancel_withdrawal((select id from public.factory_withdrawals where org_id = '16b00000-0000-0000-0000-0000000000f1' and status = 'requested'))).status, 'cancelled', 'owner cancels a waiting request');
select is((public.my_withdrawal_balance('16b00000-0000-0000-0000-0000000000f1')->>'available_cents')::bigint, 300000::bigint, 'cancelled: the balance is back');

-- Several open at once, each taking its amount; cancelling a chosen set, all or none.
select lives_ok($$select public.request_withdrawal('16b00000-0000-0000-0000-0000000000f1', 100000, '16a10000-0000-0000-0000-000000000002')$$, 'a first request, to the method that is not the default');
select lives_ok($$select public.request_withdrawal('16b00000-0000-0000-0000-0000000000f1', 150000, '16a10000-0000-0000-0000-000000000001')$$, 'a second while the first waits');
select lives_ok($$select public.request_withdrawal('16b00000-0000-0000-0000-0000000000f1', 50000, '16a10000-0000-0000-0000-000000000002')$$, 'a third takes what is left');
select is((select count(*)::int from public.factory_withdrawals where org_id = '16b00000-0000-0000-0000-0000000000f1' and status = 'requested'), 3, 'three are open');
select is((public.my_withdrawal_balance('16b00000-0000-0000-0000-0000000000f1')->>'available_cents')::bigint, 0::bigint, 'together they take the balance');
select throws_ok($$select public.request_withdrawal('16b00000-0000-0000-0000-0000000000f1', 1, '16a10000-0000-0000-0000-000000000001')$$, '22023', 'That is more than your balance.', 'nothing more once open requests take it all');
select is((select is_primary from public.factory_payout_accounts where id = '16a10000-0000-0000-0000-000000000001'), true, 'withdrawing to another method leaves the default where it was');
select is((select is_primary from public.factory_payout_accounts where id = '16a10000-0000-0000-0000-000000000002'), false, 'and does not make the chosen method the default');
select throws_ok($$select public.cancel_withdrawals('{}'::uuid[])$$, '22023', 'Choose at least one withdrawal to cancel.', 'cancelling none is refused');
reset role; select pg_temp.act_as(2); set local role authenticated;
select throws_ok($$select public.cancel_withdrawals(array(select id from public.factory_withdrawals where org_id='16b00000-0000-0000-0000-0000000000f1' and status='requested'))$$, '42501', null, 'a member cannot cancel several');
reset role; select pg_temp.act_as(1); set local role authenticated;
select is((select count(*)::int from public.cancel_withdrawals(array(select id from public.factory_withdrawals where org_id='16b00000-0000-0000-0000-0000000000f1' and status='requested' and amount_cents in (100000, 50000))) c where c.status = 'cancelled'), 2, 'the owner cancels the two chosen');
select is((select count(*)::int from public.factory_withdrawals where org_id = '16b00000-0000-0000-0000-0000000000f1' and status = 'requested'), 1, 'the one not chosen still waits');
select is((public.my_withdrawal_balance('16b00000-0000-0000-0000-0000000000f1')->>'available_cents')::bigint, 150000::bigint, 'the two cancelled are back in the balance');
-- All or none: one already being paid stops the whole set.
select lives_ok($$select public.request_withdrawal('16b00000-0000-0000-0000-0000000000f1', 10000, '16a10000-0000-0000-0000-000000000002')$$, 'another request');
reset role;
update public.factory_withdrawals set status = 'paying', lease_until = now() + interval '90 seconds'
 where org_id = '16b00000-0000-0000-0000-0000000000f1' and status = 'requested' and amount_cents = 150000;
select pg_temp.act_as(1); set local role authenticated;
select throws_ok($$select public.cancel_withdrawals(array(select id from public.factory_withdrawals where org_id='16b00000-0000-0000-0000-0000000000f1' and status in ('requested','paying')))$$, '22023', 'TSC has already started sending this, so it can no longer be cancelled.', 'one being paid: nothing is cancelled');
select is((select count(*)::int from public.factory_withdrawals where org_id = '16b00000-0000-0000-0000-0000000000f1' and status = 'requested' and amount_cents = 10000), 1, 'the waiting one is still open after the refusal');
reset role;
update public.factory_withdrawals set status = 'cancelled', lease_until = null
 where org_id = '16b00000-0000-0000-0000-0000000000f1' and status in ('requested', 'paying');
select pg_temp.act_as(1); set local role authenticated;
select is((public.my_withdrawal_balance('16b00000-0000-0000-0000-0000000000f1')->>'available_cents')::bigint, 300000::bigint, 'back to the whole balance for the steps below');

-- Part, then staff. Staff cannot be notified, so the overview's payments card
-- is their prompt: it counts an open withdrawal.
reset role; select pg_temp.act_as(5); set local role authenticated;
select set_config('tsc.test_owed_before', (select payments_awaiting_confirmation::text from public.admin_overview_metrics()), true);
reset role; select pg_temp.act_as(1); set local role authenticated;
select is((public.request_withdrawal('16b00000-0000-0000-0000-0000000000f1', 120000, '16a10000-0000-0000-0000-000000000002')).provider, 'paypal', 'owner withdraws part to PayPal');
reset role; select pg_temp.act_as(2); set local role authenticated;
select throws_ok($$select public.cancel_withdrawal((select id from public.factory_withdrawals where org_id='16b00000-0000-0000-0000-0000000000f1' and status='requested'))$$, '42501', null, 'a member cannot cancel');
reset role; select pg_temp.act_as(6); set local role authenticated;
select throws_ok($$select public.claim_withdrawal((select id from public.factory_withdrawals where org_id='16b00000-0000-0000-0000-0000000000f1' and status='requested'))$$, '42501', null, 'staff in the company cannot approve its withdrawal');
reset role; select pg_temp.act_as(5); set local role authenticated;
select is((select payments_awaiting_confirmation from public.admin_overview_metrics()), current_setting('tsc.test_owed_before')::int + 1, 'the overview counts a withdrawal waiting on staff');
select throws_ok($$select public.decline_withdrawal((select id from public.factory_withdrawals where org_id='16b00000-0000-0000-0000-0000000000f1' and status='requested'), ' ')$$, '22023', null, 'a decline needs a reason');
select is((public.claim_withdrawal((select id from public.factory_withdrawals where org_id = '16b00000-0000-0000-0000-0000000000f1' and status = 'requested')))->>'provider', 'paypal', 'staff claim it');
select throws_ok($$select public.claim_withdrawal((select id from public.factory_withdrawals where org_id='16b00000-0000-0000-0000-0000000000f1' and status='paying'))$$, '22023', 'this is already being paid', 'a second approve while the first runs is refused');
select throws_ok($$select public.record_withdrawal((select id from public.factory_withdrawals where org_id='16b00000-0000-0000-0000-0000000000f1' and status='paying'), 'paid')$$, '42501', null, 'staff cannot record a payment either');
reset role; select pg_temp.act_as(1); set local role authenticated;
select throws_ok($$select public.cancel_withdrawal((select id from public.factory_withdrawals where org_id='16b00000-0000-0000-0000-0000000000f1' and status='paying'))$$, '22023', null, 'too late to cancel once it is being paid');
reset role;
select is((public.record_withdrawal((select id from public.factory_withdrawals where org_id = '16b00000-0000-0000-0000-0000000000f1' and status = 'paying'), 'requeue', sentence => 'short')).status, 'requested', 'nothing sent: back to waiting');
select pg_temp.act_as(5);
select lives_ok($$select public.claim_withdrawal((select id from public.factory_withdrawals where org_id='16b00000-0000-0000-0000-0000000000f1' and status='requested'))$$, 'staff claim again');
select is((public.record_withdrawal((select id from public.factory_withdrawals where org_id = '16b00000-0000-0000-0000-0000000000f1' and status = 'paying'), 'paid', 'BATCH1', 0, 120000, 'USD')).status, 'paid', 'the server records it paid');
select is(public.factory_withdrawable('16b00000-0000-0000-0000-0000000000f1'), 180000::bigint, 'the remainder stays');
select is((select state::text from public.order_payments where id = '16f00000-0000-0000-0000-000000000001'), 'released', 'the oldest step covered in full is released');
select is((select state::text from public.order_payments where id = '16f00000-0000-0000-0000-000000000002'), 'confirmed', 'a step covered in part is not');
select is((public.my_withdrawal_balance('16b00000-0000-0000-0000-0000000000f1')->'withdrawn'->>'16f00000-0000-0000-0000-000000000002')::bigint, 20000::bigint, 'the page reads the part withdrawals took from it');

-- The old per-step paths are closed for pool payments.
select throws_ok($$select public.release_payment_to_factory('16f00000-0000-0000-0000-000000000002', 'REF 12345')$$, '22023', null, 'mark paid by bank refuses a pool payment');
select throws_ok($$select public.claim_provider_payout('16f00000-0000-0000-0000-000000000002', 'paypal', '2026-11-01 00:00:00+00', false)$$, '22023', null, 'Pay with PayPal per step refuses a pool payment');

-- Declined: reason read by the factory, balance back.
select pg_temp.act_as(1); set local role authenticated;
select lives_ok($$select public.request_withdrawal('16b00000-0000-0000-0000-0000000000f1', 180000, '16a10000-0000-0000-0000-000000000001')$$, 'owner withdraws the rest');
reset role; select pg_temp.act_as(5); set local role authenticated;
select is((public.decline_withdrawal((select id from public.factory_withdrawals where org_id = '16b00000-0000-0000-0000-0000000000f1' and status = 'requested'), 'Your bank name does not match.')).status, 'declined', 'staff decline with a reason');
reset role; select pg_temp.act_as(1); set local role authenticated;
select is((select reason from public.factory_withdrawals where org_id = '16b00000-0000-0000-0000-0000000000f1' and status = 'declined'), 'Your bank name does not match.', 'the factory reads the reason');
select is((public.my_withdrawal_balance('16b00000-0000-0000-0000-0000000000f1')->>'available_cents')::bigint, 180000::bigint, 'declined: the balance is back');
reset role; select pg_temp.act_as(3); set local role authenticated;
select is((select count(*)::int from public.factory_withdrawals where org_id = '16b00000-0000-0000-0000-0000000000f1'), 0, 'another company reads none of these');
reset role; select pg_temp.act_as(4); set local role authenticated;
select is((select count(*)::int from public.factory_withdrawals where org_id = '16b00000-0000-0000-0000-0000000000f1'), 0, 'the brand reads none of these');
select throws_ok($$select public.admin_withdrawals()$$, '42501', null, 'the board is staff only');

-- Joining the pool on approval.
reset role;
update public.order_payments set release_requested_at = now() where id = '16f00000-0000-0000-0000-000000000004';
select ok((select withdrawal_pool from public.order_payments where id = '16f00000-0000-0000-0000-000000000004'), 'an approved step joins the balance');
select is(public.factory_withdrawable('16b00000-0000-0000-0000-0000000000f1'), 280000::bigint, 'and adds to it');
select throws_ok($$update public.order_payments set withdrawal_pool = false where id = '16f00000-0000-0000-0000-000000000004'$$, '22023', null, 'it stays in the balance');

-- A bank transfer staff send carries the fixed wire fee (bank_payout_fee_cents()).
set local session_replication_role = replica;
insert into public.factory_payout_accounts (id, org_id, method, bank_name, account_name, account_number_last4, swift, bank_country, is_primary, details_changed_at, number_changed_at)
values ('16a10000-0000-0000-0000-000000000004', '16b00000-0000-0000-0000-0000000000f1', 'bank', 'Porto Bank', 'P116 MILL LTD', '4417', 'BCOMPTPL', 'PT', false, '2026-11-01 00:00:00+00', now());
set local session_replication_role = origin;
select pg_temp.act_as(1); set local role authenticated;
select throws_ok($$select public.request_withdrawal('16b00000-0000-0000-0000-0000000000f1', 5000, '16a10000-0000-0000-0000-000000000004')$$,
  '22023', 'this withdrawal is not more than the bank transfer fee, so nothing would arrive', 'a bank withdrawal no bigger than the wire fee is refused');
select is((public.request_withdrawal('16b00000-0000-0000-0000-0000000000f1', 20000, '16a10000-0000-0000-0000-000000000004')).provider, 'bank', 'a bank Wise cannot pay is a bank withdrawal');
reset role; select pg_temp.act_as(5); set local role authenticated;
select is((public.mark_withdrawal_paid_by_bank((select id from public.factory_withdrawals where org_id = '16b00000-0000-0000-0000-0000000000f1' and status = 'requested'), 'WIRE-116')).receives_minor, 15000::bigint,
  'staff mark it paid: the factory receives the amount less the US$50 wire fee');
reset role;
select is((select fee_cents from public.factory_withdrawals where org_id = '16b00000-0000-0000-0000-0000000000f1' and provider_ref = 'WIRE-116'), public.bank_payout_fee_cents(), 'the fee recorded is the one source');

-- Money in the balance cannot be stranded by moving to Stripe.
select throws_ok($$insert into public.factory_payout_preferences (org_id, route) values ('16b00000-0000-0000-0000-0000000000f1', 'stripe')$$,
  '22023', 'Withdraw your balance first, then switch to Stripe.', 'no switch to Stripe while a balance is left');

-- Paying a bank withdrawal by hand (20261117350000): staff read the number of the
-- account the withdrawal pays, even one that is not the default, and only while
-- it waits; and "mark paid by bank" refuses once the factory changed that account.
-- In Taiwan: a CN or HK bank with no Wise recipient is Tazapay's (20261117510000).
select pg_temp.act_as(1); set local role authenticated;
select set_config('tsc.test_other_bank', (public.save_bank_payout_account(
  target_org => '16b00000-0000-0000-0000-0000000000f1', bank_name => 'Bank of Taiwan', account_name => 'P116 MILL LTD',
  bank_country => 'TW', swift => 'BKTWTWTP', account_number => '0000000000003456', account_number_again => '0000000000003456')).id::text, true);
select is((select is_primary from public.factory_payout_accounts where id = current_setting('tsc.test_other_bank')::uuid), false, 'a second bank account is not the default');
reset role; select pg_temp.act_as(5); set local role authenticated;
select throws_ok($$select * from public.reveal_payout_account_number(current_setting('tsc.test_other_bank')::uuid)$$,
  '22023', null, 'no withdrawal to it: staff cannot read a non-default number');
reset role; select pg_temp.act_as(1); set local role authenticated;
select is((public.request_withdrawal('16b00000-0000-0000-0000-0000000000f1', 20000, current_setting('tsc.test_other_bank')::uuid)).provider, 'bank', 'owner withdraws to the non-default bank account');
reset role; select pg_temp.act_as(5); set local role authenticated;
select is((select account_number from public.reveal_payout_account_number(current_setting('tsc.test_other_bank')::uuid)), '0000000000003456', 'staff read the number of the account a waiting withdrawal pays');
reset role;
select is((select count(*)::int from public.payout_number_reveals where account_id = current_setting('tsc.test_other_bank')::uuid), 1, 'and the read is recorded');
select pg_temp.act_as(2); set local role authenticated;
select throws_ok($$select * from public.reveal_payout_account_number(current_setting('tsc.test_other_bank')::uuid)$$, '42501', null, 'a factory member still cannot read it');
reset role; select pg_temp.act_as(4); set local role authenticated;
select throws_ok($$select * from public.reveal_payout_account_number(current_setting('tsc.test_other_bank')::uuid)$$, '42501', null, 'nor the brand');
reset role; select pg_temp.act_as(6); set local role authenticated;
select throws_ok($$select * from public.reveal_payout_account_number(current_setting('tsc.test_other_bank')::uuid)$$, '42501', null, 'nor staff who belong to the factory');
-- Cancelled: nothing owed to it any more.
reset role; select pg_temp.act_as(1); set local role authenticated;
select lives_ok($$select public.cancel_withdrawal((select id from public.factory_withdrawals where account_id = current_setting('tsc.test_other_bank')::uuid and status = 'requested'))$$, 'owner cancels it');
reset role; select pg_temp.act_as(5); set local role authenticated;
select throws_ok($$select * from public.reveal_payout_account_number(current_setting('tsc.test_other_bank')::uuid)$$, '22023', null, 'cancelled: staff cannot read it');
-- Paid: the same.
reset role; select pg_temp.act_as(1); set local role authenticated;
select lives_ok($$select public.request_withdrawal('16b00000-0000-0000-0000-0000000000f1', 20000, current_setting('tsc.test_other_bank')::uuid)$$, 'owner asks again');
reset role; select pg_temp.act_as(5); set local role authenticated;
select is((public.mark_withdrawal_paid_by_bank((select id from public.factory_withdrawals where account_id = current_setting('tsc.test_other_bank')::uuid and status = 'requested'), 'WIRE-117')).status, 'paid', 'staff mark it paid by bank');
select throws_ok($$select * from public.reveal_payout_account_number(current_setting('tsc.test_other_bank')::uuid)$$, '22023', null, 'paid: staff cannot read it');
-- Changed after asking: refused, as Approve is.
reset role; select pg_temp.act_as(1); set local role authenticated;
select lives_ok($$select public.request_withdrawal('16b00000-0000-0000-0000-0000000000f1', 20000, current_setting('tsc.test_other_bank')::uuid)$$, 'owner asks once more');
select lives_ok($$select public.save_bank_payout_account(
  target_org => '16b00000-0000-0000-0000-0000000000f1', target_account => current_setting('tsc.test_other_bank')::uuid, bank_name => 'Bank of Taiwan',
  account_name => 'P116 MILL LTD', bank_country => 'TW', swift => 'BKTWTWTP', branch => 'Taipei branch')$$, 'then changes that account');
reset role; select pg_temp.act_as(5); set local role authenticated;
select throws_ok($$select public.mark_withdrawal_paid_by_bank((select id from public.factory_withdrawals where account_id = current_setting('tsc.test_other_bank')::uuid and status = 'requested'), 'WIRE-118')$$,
  '22023', 'this factory changed where it is paid', 'changed since it asked: mark paid by bank is refused');
reset role;
select is((select count(*)::int from public.factory_withdrawals where account_id = current_setting('tsc.test_other_bank')::uuid and status = 'requested'), 1, 'and it still waits, for staff to decline');

select * from finish();
rollback;
