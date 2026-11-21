-- One balance, fix round 6 (20261120260000): the tester's re-test.
--
-- A step disputed before the brand approves it: the factory is told it is on
-- hold, never "added to your balance". A step refunded while a waiting
-- withdrawal holds part of it: the factory is told, the part stays in a
-- figure (Pending) until the withdrawal ends, staff see it is not covered,
-- and cancelling says truthfully what comes back. A Stripe part whose
-- transfer was reversed goes back to the balance (and its step to owed) only
-- with that reversal, and only from the call holding the withdrawal. Every
-- PayPal / Wise / bank method added, changed or removed is told to the company.
--
-- Fixtures: slugs pgtap-r6-*, ids cd6?xxxx-...; every count is scoped to them.
begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

update public.payout_provider_settings set enabled = case
    when provider = 'paypal' and region in ('china', 'elsewhere') then true else false end;

set local session_replication_role = replica;

-- 01..05 owners of m1..m5, 06 staff, 07 brand owner.
insert into auth.users (id, email)
select ('cd6a0000-0000-0000-0000-0000000000' || k)::uuid, 'pgtap-r6-' || k || '@example.com'
  from unnest(array['01','02','03','04','05','06','07']) k;
insert into public.platform_admins (user_id, note) values ('cd6a0000-0000-0000-0000-000000000006', 'pgtap-r6');
insert into public.orgs (id, type, name, slug) values ('cd6b0000-0000-0000-0000-00000000000b', 'brand', 'R6 Brand', 'pgtap-r6-brand');
insert into public.orgs (id, type, name, slug)
select ('cd6b0000-0000-0000-0000-0000000000e' || n)::uuid, 'factory', 'R6 Factory ' || n, 'pgtap-r6-factory-' || n from generate_series(1, 5) n;
insert into public.org_members (org_id, user_id, role, permissions)
select ('cd6b0000-0000-0000-0000-0000000000e' || n)::uuid, ('cd6a0000-0000-0000-0000-00000000000' || n)::uuid, 'owner', '{}' from generate_series(1, 5) n;
insert into public.org_members (org_id, user_id, role, permissions) values
  ('cd6b0000-0000-0000-0000-00000000000b', 'cd6a0000-0000-0000-0000-000000000007', 'owner', '{}');

insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total)
select ('cd6c0000-0000-0000-0000-00000000000' || n)::uuid, 'cd6b0000-0000-0000-0000-00000000000b', 'R6 request ' || n, 'awarded', 'invited_only', 100
  from generate_series(1, 2) n;
insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity, submitted_at)
select ('cd6c1000-0000-0000-0000-00000000000' || n)::uuid, ('cd6c0000-0000-0000-0000-00000000000' || n)::uuid,
       ('cd6b0000-0000-0000-0000-0000000000e' || n)::uuid, 'accepted', 100, 1, now() from generate_series(1, 2) n;
insert into public.production_orders
  (id, rfq_id, quote_id, brand_org_id, factory_org_id, unit_price_cents, status, schedule_brand_agreed_at, schedule_brand_agreed_by,
   production_quantity, bulk_subtotal_cents, sample_subtotal_cents, order_total_cents, deposit_pct, balance_pct, order_number)
select ('cd6d0000-0000-0000-0000-00000000000' || n)::uuid, ('cd6c0000-0000-0000-0000-00000000000' || n)::uuid,
       ('cd6c1000-0000-0000-0000-00000000000' || n)::uuid, 'cd6b0000-0000-0000-0000-00000000000b',
       ('cd6b0000-0000-0000-0000-0000000000e' || n)::uuid, 100000, 'active', now() - interval '60 days',
       'cd6a0000-0000-0000-0000-000000000007', 1, 100000, 0, 100000, 50, 50, 'R6-' || n
  from generate_series(1, 2) n;

-- m1: s1 $100 funded, not approved, its charge already disputed; s2 $65 owed, cleared.
-- m2: s1 $100 owed, cleared (the Stripe road).
create temp table r6_steps (n int, s int, amount bigint, approved boolean) on commit drop;
insert into r6_steps values (1, 1, 10000, false), (1, 2, 6500, true), (2, 1, 10000, true);
insert into public.order_milestones (id, order_id, kind, title, amount_cents, state, sort, completed_at)
select ('cd6e000' || s || '-0000-0000-0000-00000000000' || n)::uuid, ('cd6d0000-0000-0000-0000-00000000000' || n)::uuid,
       'approval_and_payment', 'R6 step ' || s, amount, case when approved then 'complete' else 'active' end::milestone_state, s * 10,
       case when approved then now() - interval '5 days' end
  from r6_steps;
insert into public.order_payments
  (id, order_id, milestone_id, amount_cents, currency, state, confirmed_at, release_requested_at,
   stripe_payment_intent_id, stripe_charge_id, funds_available_at)
select ('cd6f000' || s || '-0000-0000-0000-00000000000' || n)::uuid, ('cd6d0000-0000-0000-0000-00000000000' || n)::uuid,
       ('cd6e000' || s || '-0000-0000-0000-00000000000' || n)::uuid, amount, 'USD', 'confirmed', now() - interval '30 days',
       case when approved then now() - interval '5 days' end, 'pi_pgtap_r6_' || n || '_' || s, 'ch_pgtap_r6_' || n || '_' || s,
       now() - interval '20 days'
  from r6_steps;
update public.order_payments set disputed_at = now() - interval '1 day' where id = 'cd6f0001-0000-0000-0000-000000000001';

insert into public.factory_payout_accounts (id, org_id, method, paypal_email, is_primary, details_changed_at) values
  ('cd690000-0000-0000-0000-000000000001', 'cd6b0000-0000-0000-0000-0000000000e1', 'paypal', 'pgtap-r6-1@example.com', true, '2026-11-01'),
  ('cd690000-0000-0000-0000-000000000005', 'cd6b0000-0000-0000-0000-0000000000e5', 'paypal', 'pgtap-r6-5@example.com', true, '2026-11-01');
insert into public.factory_payout_accounts
  (id, org_id, method, bank_name, account_name, account_number_last4, swift, bank_country, is_primary,
   wise_recipient_type, wise_currency, wise_number_key, wise_details, details_changed_at, number_changed_at, payee_changed_at)
values ('cd690000-0000-0000-0000-000000000004', 'cd6b0000-0000-0000-0000-0000000000e4', 'bank', 'R6 Bank', 'R6 MILL LDA', '0154', 'BCOMPTPL', 'PT', true,
        'iban', 'EUR', 'IBAN', '{}', '2026-11-01', '2026-11-01', '2026-11-01');
insert into public.stripe_connect_accounts (org_id, stripe_account_id, country, transfers_active, payouts_enabled, details_submitted)
values ('cd6b0000-0000-0000-0000-0000000000e2', 'acct_pgtap_r6', 'US', true, true, true);
insert into public.stripe_withdrawals (id, org_id, stripe_account_id, request_key, request_id, amount_minor, currency, usd_cents, state)
values ('cd680000-0000-0000-0000-000000000001', 'cd6b0000-0000-0000-0000-0000000000e2', 'acct_pgtap_r6', 'pgtap-r6-sw-1', gen_random_uuid(), 10000, 'USD', 10000, 'claimed');
set local session_replication_role = origin;

create function pg_temp.act_as(who text) returns void language sql as $f$
  select set_config('request.jwt.claims',
    json_build_object('sub', 'cd6a0000-0000-0000-0000-' || lpad(who, 12, '0'), 'role', 'authenticated')::text, true);
$f$;
create function pg_temp.org(n int) returns uuid language sql immutable as $f$
  select ('cd6b0000-0000-0000-0000-0000000000e' || n)::uuid;
$f$;
create function pg_temp.pay(n int, s int) returns uuid language sql immutable as $f$
  select ('cd6f000' || s || '-0000-0000-0000-00000000000' || n)::uuid;
$f$;
create function pg_temp.step(n int, s int) returns uuid language sql immutable as $f$
  select ('cd6e000' || s || '-0000-0000-0000-00000000000' || n)::uuid;
$f$;
grant execute on function pg_temp.act_as(text), pg_temp.org(int), pg_temp.pay(int, int), pg_temp.step(int, int) to authenticated, anon, service_role;
create function pg_temp.as_server(sql text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  set local role service_role;
  execute sql;
  reset role;
end;
$f$;
create function pg_temp.bal_as(who text, n int) returns jsonb language plpgsql as $f$
declare j jsonb;
begin
  perform pg_temp.act_as(who);
  set local role authenticated;
  j := public.factory_balance(pg_temp.org(n));
  reset role;
  return j;
end;
$f$;
create function pg_temp.sum4(j jsonb) returns bigint language sql as $f$
  select (j ->> 'awaiting_cents')::bigint + (j ->> 'available_cents')::bigint + (j ->> 'pending_cents')::bigint + (j ->> 'processing_cents')::bigint + (j ->> 'paid_out_cents')::bigint;
$f$;
create function pg_temp.told(n int, k text) returns text language sql as $f$
  select string_agg(title || ' | ' || body, ' || ' order by title) from public.notifications where org_id = pg_temp.org(n) and kind = k;
$f$;

-- ===========================================================================
-- 1. A step disputed before approval: on approval the factory is told it is
--    on hold, never that it was added to its balance.
-- ===========================================================================
select pg_temp.act_as('07'); set local role authenticated;
select lives_ok($$select public.approve_milestone(pg_temp.step(1, 1), null)$$, 'the brand approves a step whose charge is already disputed');
reset role;
select is((select body from public.notifications where org_id = pg_temp.org(1) and kind = 'milestone_approved' and subject_id = pg_temp.step(1, 1)),
  'The brand approved this step.', 'the approval notice says only that it was approved');
select ok(coalesce(pg_temp.told(1, 'milestone_approved'), '') not like '%added to your balance%', 'never "added to your balance"');
select is(pg_temp.told(1, 'payment_disputed'),
  'Payment for "R6 step 1" on hold | The brand disputed the charge. $100.00 is held until the dispute is settled.',
  'and it is told the money is on hold');
select is((select string_agg(distinct r ->> 'figure', ',') from jsonb_array_elements(pg_temp.bal_as('01', 1) -> 'rows') r
            where (r ->> 'payment_id')::uuid = pg_temp.pay(1, 1)), 'pending', 'it is held in Pending, not Available');
select lives_ok(format($$select pg_temp.as_server(%L)$$, format('select public.record_payment_disputed(%L, false)', pg_temp.pay(1, 1))),
  'the dispute is won');
select ok(pg_temp.told(1, 'payment_disputed') like '%Hold lifted on "R6 step 1"%', 'the hold it was told about is lifted');

-- ===========================================================================
-- 2. A step refunded while a waiting PayPal withdrawal holds part of it.
-- ===========================================================================
select set_config('tsc.r6_w', (select (public.request_withdrawal(pg_temp.org(1), 4500, 'cd690000-0000-0000-0000-000000000001')).id::text
  from (select pg_temp.act_as('01')) a), true);
reset role;
select is((select sum(amount_cents)::bigint from public.payment_takes where factory_withdrawal_id = current_setting('tsc.r6_w')::uuid and payment_id = pg_temp.pay(1, 2)),
  4500::bigint, 'the withdrawal holds $45 of the $65 step');
select lives_ok(format($$select pg_temp.as_server(%L)$$,
  format('select public.record_payment_refunded(%L, %L, %L)', pg_temp.pay(1, 2), 'pi_pgtap_r6_1_2', 'The payment was refunded.')),
  'the brand''s payment for that step is refunded');
select is((select title || ' | ' || body from public.notifications where org_id = pg_temp.org(1) and kind = 'withdrawal'
            and subject_id = current_setting('tsc.r6_w')::uuid and title like '%on hold'),
  'Withdrawal of $45.00 on hold | The brand''s payment for "R6 step 2" was refunded. Cancel this withdrawal and withdraw again.',
  'the factory is told its withdrawal is on hold, and what to do');
select is((select count(*)::int from public.notifications where org_id = pg_temp.org(1) and kind = 'withdrawal' and title like '%on hold'), 1, 'once');
select ok(exists (select 1 from jsonb_array_elements(pg_temp.bal_as('01', 1) -> 'rows') r
                   where (r ->> 'payment_id')::uuid = pg_temp.pay(1, 2) and r ->> 'figure' = 'refunded' and (r ->> 'refunded')::boolean
                     and (r ->> 'amount_cents')::bigint = 4500),
  'the held part went back to the brand: in no figure (round 16), marked refunded, while its withdrawal waits');
select is((pg_temp.bal_as('01', 1) ->> 'total_cents')::bigint, pg_temp.sum4(pg_temp.bal_as('01', 1)), 'Total is the sum of the four');
select ok(not exists (select 1 from jsonb_array_elements(pg_temp.bal_as('01', 1) -> 'rows') r
                       where (r ->> 'payment_id')::uuid = pg_temp.pay(1, 2) and r ->> 'figure' = 'available'),
  'the rest of the refunded step is not Available');
select is(((select public.my_withdrawal_balance(pg_temp.org(1)) from (select pg_temp.act_as('01')) a) -> 'returnable' ->> current_setting('tsc.r6_w'))::bigint,
  0::bigint, 'cancelling would give back nothing: its money was refunded');
reset role;
select pg_temp.act_as('06'); set local role authenticated;
select is((select (w ->> 'covered')::boolean from jsonb_array_elements(public.admin_withdrawals() -> 'withdrawals') w
            where w ->> 'id' = current_setting('tsc.r6_w')), false, 'staff see it is no longer covered, before pressing Pay');
select throws_ok($$select public.claim_withdrawal(current_setting('tsc.r6_w')::uuid)$$, '22023', null, 'and cannot pay it');
reset role;
select pg_temp.act_as('01'); set local role authenticated;
select lives_ok($$select public.cancel_withdrawal(current_setting('tsc.r6_w')::uuid)$$, 'the owner cancels it');
reset role;
select is((select body from public.notifications where org_id = pg_temp.org(1) and kind = 'withdrawal'
            and subject_id = current_setting('tsc.r6_w')::uuid and title like '%cancelled'),
  'This amount was returned to the brand.', 'and is told truthfully that nothing comes back');
select is((pg_temp.bal_as('01', 1) ->> 'total_cents')::bigint, pg_temp.sum4(pg_temp.bal_as('01', 1)), 'Total is still the sum of the four');
select ok(not exists (select 1 from jsonb_array_elements(pg_temp.bal_as('01', 1) -> 'rows') r where (r ->> 'payment_id')::uuid = pg_temp.pay(1, 2)
                       and (r ->> 'amount_cents')::bigint > 0),
  'once the withdrawal ended, the refunded step is in no figure (only its Refunded line, below zero: 20261121200000)');

-- ===========================================================================
-- 3. A Stripe part taken back by reversal returns to the balance, and its
--    step to owed, only with the reversal and only from the lease holder.
-- ===========================================================================
select lives_ok($$select pg_temp.as_server('select public.claim_owed_steps(''cd6b0000-0000-0000-0000-0000000000e2'', 10000, ''stripe'', ''cd680000-0000-0000-0000-000000000001'')')$$,
  'Stripe claims the whole $100 step');
select set_config('tsc.r6_take', (select id::text from public.payment_takes where stripe_withdrawal_id = 'cd680000-0000-0000-0000-000000000001'), true);
select lives_ok(format($$select pg_temp.as_server(%L)$$, format('select public.record_take_sent(%L, %L)', current_setting('tsc.r6_take'), 'tr_pgtap_r6')),
  'its transfer goes');
select ok((select state = 'released' and stripe_transfer_id = 'tr_pgtap_r6' from public.order_payments where id = pg_temp.pay(2, 1)), 'the step is released');
select throws_ok(format($$select pg_temp.as_server(%L)$$, format('select public.return_sent_take(%L, null, %L)', current_setting('tsc.r6_take'), '')),
  '22023', null, 'a sent part goes back only with the reversal that took it back');
set local session_replication_role = replica;
update public.stripe_withdrawals set lease_until = '2999-01-01 00:00:00+00' where id = 'cd680000-0000-0000-0000-000000000001';
set local session_replication_role = origin;
select throws_ok(format($$select pg_temp.as_server(%L)$$, format('select public.return_sent_take(%L, null, %L)', current_setting('tsc.r6_take'), 'trr_pgtap_r6')),
  '22023', 'this withdrawal is being processed', 'and not while another call holds the withdrawal (withdrawal_busy)');
select ok((select state = 'released' from public.order_payments where id = pg_temp.pay(2, 1)), 'the step is still released while it waits');
select is((select status from public.payment_takes where id = current_setting('tsc.r6_take')::uuid), 'sent', 'it stays sent');
select lives_ok(format($$select pg_temp.as_server(%L)$$,
  format('select public.return_sent_take(%L, %L, %L)', current_setting('tsc.r6_take'), '2999-01-01 00:00:00+00', 'trr_pgtap_r6')),
  'the call holding the lease returns it with the reversal');
select ok((select status = 'returned' and reversal_id = 'trr_pgtap_r6' from public.payment_takes where id = current_setting('tsc.r6_take')::uuid),
  'the part is returned, with its reversal');
select ok((select state = 'confirmed' and released_at is null and stripe_transfer_id is null from public.order_payments where id = pg_temp.pay(2, 1)),
  'the step is owed again: nothing reads Paid');
select is((select string_agg(distinct r ->> 'figure', ',') from jsonb_array_elements(pg_temp.bal_as('02', 2) -> 'rows') r
            where (r ->> 'payment_id')::uuid = pg_temp.pay(2, 1)), 'available', 'and Available again');
select ok(not has_function_privilege('authenticated', 'public.return_sent_take(uuid, timestamptz, text)', 'execute')
      and not has_function_privilege('anon', 'public.return_sent_take(uuid, timestamptz, text)', 'execute'), 'return_sent_take is the server''s');

-- ===========================================================================
-- 4. Every PayPal / Wise / bank method added, changed or removed is told.
--    (The notice is a deferred trigger: made immediate here, since this
--    transaction is rolled back, never committed.)
-- ===========================================================================
set constraints public.factory_payout_accounts_zz_method_notice immediate;
select pg_temp.act_as('03');
insert into public.factory_payout_accounts (id, org_id, method, paypal_email, is_primary, details_changed_at)
values ('cd690000-0000-0000-0000-000000000003', pg_temp.org(3), 'paypal', 'pgtap-r6-3@example.com', true, now());
-- PayPal already had its own notices (kept, so the new trigger stays silent):
-- one notice naming the address either way.
select ok(pg_temp.told(3, 'payout_method_changed') ~ '^Your payout methods changed \| PayPal (account )?pgtap-r6-3@example\.com was added.*If nobody at your company made this change',
  'adding PayPal is told to the company, once');
select pg_temp.act_as('04');
update public.factory_payout_accounts set account_number_last4 = '0148', payee_changed_at = now(), details_changed_at = now(), number_changed_at = now()
 where id = 'cd690000-0000-0000-0000-000000000004';
select ok(pg_temp.told(4, 'payout_method_changed') like '%The details of Bank account ending in 0148 were changed.%If nobody at your company made this change%',
  'changing a Wise bank account''s number is told');
select pg_temp.act_as('05');
delete from public.factory_payout_accounts where id = 'cd690000-0000-0000-0000-000000000005';
select ok(pg_temp.told(5, 'payout_method_changed') ~ 'PayPal (account )?pgtap-r6-5@example\.com was removed',
  'removing PayPal is told');
update public.payout_provider_settings set enabled = true where provider = 'wise';
select pg_temp.act_as('02');
insert into public.factory_payout_accounts
  (id, org_id, method, bank_name, account_name, account_number_last4, swift, bank_country, is_primary,
   wise_recipient_type, wise_currency, wise_number_key, wise_details, details_changed_at, number_changed_at, payee_changed_at)
values ('cd690000-0000-0000-0000-000000000002', pg_temp.org(2), 'bank', 'R6 Bank Two', 'R6 TWO LDA', '0777', 'BCOMPTPL', 'PT', false,
        'iban', 'EUR', 'IBAN', '{}', now(), now(), now());
select ok(pg_temp.told(2, 'payout_method_changed') like '%Bank account ending in 0777 was added%If nobody at your company made this change%',
  'adding a Wise bank account is told');
select is((select count(*)::int from public.notifications
            where org_id in (pg_temp.org(2), pg_temp.org(3), pg_temp.org(4), pg_temp.org(5)) and kind = 'payout_method_changed'), 4,
  'one notice per change');
-- The server's own change (not a signed-in person) is left to its own notices.
select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
update public.factory_payout_accounts set paypal_email = 'pgtap-r6-3b@example.com' where id = 'cd690000-0000-0000-0000-000000000003';
select is((select count(*)::int from public.notifications where org_id = pg_temp.org(3) and kind = 'payout_method_changed'), 1,
  'a change the server makes is not told as the company''s');

select * from finish();
rollback;
