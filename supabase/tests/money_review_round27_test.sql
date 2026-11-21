-- One balance, fix round 27 (20261121310000).
--
-- f1: Stripe active, PayPal the default (route manual), its last method:
--     removing it hands payouts back to Stripe, and the factory is told so.
-- f2: Stripe already the default, a saved PayPal removed: no such notice.
-- f3: no Stripe account, its only PayPal removed: no such notice.
-- f4: a default bank account that only stops being the default (the row
--     kept) is not said to be removed; deleting it is.
-- f5: a declined withdrawal keeps what came back (back_cents).
--
-- Fixtures: slugs pgtap-r27-*, ids b27?xxxx-...; every count is scoped to them.
begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

update public.payout_provider_settings set enabled = case
    when provider = 'paypal' and region in ('china', 'elsewhere') then true else false end;

set local session_replication_role = replica;

insert into auth.users (id, email)
select ('b27a0000-0000-0000-0000-0000000000' || k)::uuid, 'pgtap-r27-' || k || '@example.com'
  from unnest(array['01','02','03','04','05','06','07']) k;
-- 02 is staff; 03 owns the brand; factory n is owned by 01, 04, 05, 06, 07.
insert into public.platform_admins (user_id, note) values ('b27a0000-0000-0000-0000-000000000002', 'pgtap-r27');
insert into public.orgs (id, type, name, slug) values
  ('b27b0000-0000-0000-0000-00000000000b', 'brand', 'R27 Brand', 'pgtap-r27-brand');
insert into public.orgs (id, type, name, slug)
select ('b27b0000-0000-0000-0000-0000000000e' || n)::uuid, 'factory', 'R27 Factory ' || n, 'pgtap-r27-f' || n from generate_series(1, 5) n;
insert into public.org_members (org_id, user_id, role, permissions) values
  ('b27b0000-0000-0000-0000-00000000000b', 'b27a0000-0000-0000-0000-000000000003', 'owner', '{}'),
  ('b27b0000-0000-0000-0000-0000000000e1', 'b27a0000-0000-0000-0000-000000000001', 'owner', '{}'),
  ('b27b0000-0000-0000-0000-0000000000e2', 'b27a0000-0000-0000-0000-000000000004', 'owner', '{}'),
  ('b27b0000-0000-0000-0000-0000000000e3', 'b27a0000-0000-0000-0000-000000000005', 'owner', '{}'),
  ('b27b0000-0000-0000-0000-0000000000e4', 'b27a0000-0000-0000-0000-000000000006', 'owner', '{}'),
  ('b27b0000-0000-0000-0000-0000000000e5', 'b27a0000-0000-0000-0000-000000000007', 'owner', '{}');
-- f5 has a $500 approved step to withdraw from.
insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total)
values ('b27c0000-0000-0000-0000-000000000005', 'b27b0000-0000-0000-0000-00000000000b', 'R27 request 5', 'awarded', 'invited_only', 100);
insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity, submitted_at)
values ('b27c1000-0000-0000-0000-000000000005', 'b27c0000-0000-0000-0000-000000000005', 'b27b0000-0000-0000-0000-0000000000e5', 'accepted', 100, 1, now());
insert into public.production_orders
  (id, rfq_id, quote_id, brand_org_id, factory_org_id, unit_price_cents, status, schedule_brand_agreed_at, schedule_brand_agreed_by,
   production_quantity, bulk_subtotal_cents, sample_subtotal_cents, order_total_cents, deposit_pct, balance_pct, order_number)
values ('b27d0000-0000-0000-0000-000000000005', 'b27c0000-0000-0000-0000-000000000005', 'b27c1000-0000-0000-0000-000000000005',
        'b27b0000-0000-0000-0000-00000000000b', 'b27b0000-0000-0000-0000-0000000000e5', 100000, 'active', now() - interval '60 days',
        'b27a0000-0000-0000-0000-000000000003', 1, 100000, 0, 100000, 50, 50, 'R27-5');
insert into public.order_milestones (id, order_id, kind, title, amount_cents, state, sort, completed_at)
values ('b27e0051-0000-0000-0000-000000000000', 'b27d0000-0000-0000-0000-000000000005', 'payment_only', 'R27 deposit', 50000, 'complete', 10,
        now() - interval '9 days');
insert into public.order_payments
  (id, order_id, milestone_id, amount_cents, charged_cents, amount_received_cents, currency, state, confirmed_at, release_requested_at,
   withdrawal_pool, stripe_payment_intent_id, stripe_charge_id, funds_available_at)
values ('b27f0051-0000-0000-0000-000000000000', 'b27d0000-0000-0000-0000-000000000005', 'b27e0051-0000-0000-0000-000000000000',
        50000, 53500, 53500, 'USD', 'confirmed', now() - interval '20 days', now() - interval '9 days',
        false, 'pi_pgtap_r27_51', 'ch_pgtap_r27_51', now() - interval '15 days');
-- PayPal accounts: the default for f1, f3, f5; saved but not the default for f2.
insert into public.factory_payout_accounts (id, org_id, method, paypal_email, is_primary, details_changed_at)
select ('b2790000-0000-0000-0000-00000000000' || n)::uuid, ('b27b0000-0000-0000-0000-0000000000e' || n)::uuid, 'paypal',
       'pgtap-r27-f' || n || '@example.com', n <> 2, '2026-11-01'
  from unnest(array[1, 2, 3, 5]) n;
-- f4: a default bank (Wise, switched off) and a saved PayPal.
insert into public.factory_payout_accounts
  (id, org_id, method, bank_name, account_name, account_number_last4, swift, bank_country, is_primary,
   wise_recipient_type, wise_currency, wise_number_key, wise_details, details_changed_at, number_changed_at)
values ('b2790000-0000-0000-0000-0000000000a4', 'b27b0000-0000-0000-0000-0000000000e4', 'bank', 'R27 Bank', 'R27 MILL LTD', '4321', 'BOSHCNSH', 'CN', true,
        'chinese_local_business', 'CNY', 'accountNumber', '{"accountHolderName":"R27 MILL LTD"}', '2026-11-01', now());
insert into public.factory_payout_accounts (id, org_id, method, paypal_email, is_primary, details_changed_at)
values ('b2790000-0000-0000-0000-000000000004', 'b27b0000-0000-0000-0000-0000000000e4', 'paypal', 'pgtap-r27-f4@example.com', false, '2026-11-01');
insert into public.factory_payout_preferences (org_id, route)
select ('b27b0000-0000-0000-0000-0000000000e' || n)::uuid, case when n = 2 then 'stripe' else 'manual' end from generate_series(1, 5) n;
insert into public.stripe_connect_accounts (org_id, stripe_account_id, country, transfers_active, payouts_enabled, details_submitted)
values ('b27b0000-0000-0000-0000-0000000000e1', 'acct_pgtap_r27_1', 'US', true, true, true),
       ('b27b0000-0000-0000-0000-0000000000e2', 'acct_pgtap_r27_2', 'US', true, true, true);
set local session_replication_role = origin;

create function pg_temp.act_as(who text) returns void language sql as $f$
  select set_config('request.jwt.claims',
    json_build_object('sub', 'b27a0000-0000-0000-0000-' || lpad(who, 12, '0'), 'role', 'authenticated')::text, true);
$f$;
grant execute on function pg_temp.act_as(text) to authenticated, service_role;
create function pg_temp.org(n int) returns uuid language sql immutable as $f$
  select ('b27b0000-0000-0000-0000-0000000000e' || n)::uuid;
$f$;
create function pg_temp.said(n int) returns text language sql as $f$
  select coalesce(string_agg(body, ' || ' order by body), '') from public.notifications
   where org_id = pg_temp.org(n) and kind = 'payout_method_changed';
$f$;
create function pg_temp.stripe_back(n int) returns int language sql as $f$
  select count(*)::int from public.notifications where org_id = pg_temp.org(n) and kind = 'payout_method_changed'
     and body = 'Your connected payout account is now your default withdrawal method. If nobody at your company made this change, email operations@contact.sourcing-club.com now.';
$f$;

-- f1 --------------------------------------------------------------------------
select is(public.uses_stripe_payout(pg_temp.org(1)), false, 'f1 pays by its PayPal default (route manual)');
select pg_temp.act_as('01'); set local role authenticated;
select lives_ok($$select public.remove_payout_account('b2790000-0000-0000-0000-000000000001')$$, 'f1 removes its last method, the PayPal default');
reset role;
select is(public.uses_stripe_payout(pg_temp.org(1)), true, 'Stripe pays again');
select is(pg_temp.stripe_back(1), 1, 'and the factory is told, in the approved words');
select ok(pg_temp.said(1) like '%PayPal account pgtap-r27-f1@example.com was removed.%', 'alongside "was removed"');

-- f2 --------------------------------------------------------------------------
select pg_temp.act_as('04'); set local role authenticated;
select lives_ok($$select public.remove_payout_account('b2790000-0000-0000-0000-000000000002')$$, 'f2 (Stripe already the default) removes its saved PayPal');
reset role;
select is(pg_temp.stripe_back(2), 0, 'nothing says Stripe became the default: it already was');

-- f3 --------------------------------------------------------------------------
select pg_temp.act_as('05'); set local role authenticated;
select lives_ok($$select public.remove_payout_account('b2790000-0000-0000-0000-000000000003')$$, 'f3 (no Stripe) removes its only PayPal');
reset role;
select is(pg_temp.stripe_back(3), 0, 'no Stripe account: nothing says it is the default');
select is(public.factory_has_no_payout_method(pg_temp.org(3)), true, 'f3 has no method');

-- f4 --------------------------------------------------------------------------
select pg_temp.act_as('06'); set local role authenticated;
update public.factory_payout_accounts set is_primary = false where id = 'b2790000-0000-0000-0000-0000000000a4';
reset role;
set constraints all immediate;
set constraints all deferred;
select is(pg_temp.said(4),
  'Your bank account at R27 Bank ending 4321 is no longer your default withdrawal method. If nobody at your company made this change, email operations@contact.sourcing-club.com now.',
  'a default bank cleared but kept: "no longer your default", never "removed"');
select pg_temp.act_as('06'); set local role authenticated;
update public.factory_payout_accounts set is_primary = true where id = 'b2790000-0000-0000-0000-0000000000a4';
reset role;
set constraints all immediate;
set constraints all deferred;
delete from public.notifications where org_id = pg_temp.org(4);
select pg_temp.act_as('06'); set local role authenticated;
select lives_ok($$select public.remove_payout_account('b2790000-0000-0000-0000-0000000000a4', 'b2790000-0000-0000-0000-000000000004')$$,
  'f4 removes the default bank, the PayPal taking over');
reset role;
set constraints all immediate;
set constraints all deferred;
select ok(pg_temp.said(4) not like '%no longer your default%', 'removed: never "no longer your default"');

-- f5 --------------------------------------------------------------------------
select pg_temp.act_as('07'); set local role authenticated;
select set_config('tsc.r27_w', (public.request_withdrawal(pg_temp.org(5), 20000, 'b2790000-0000-0000-0000-000000000005')).id::text, true);
reset role;
select pg_temp.act_as('02'); set local role authenticated;
select lives_ok($$select public.decline_withdrawal(current_setting('tsc.r27_w')::uuid, 'Please confirm your PayPal address first.')$$, 'staff decline it');
reset role;
select is((select back_cents from public.factory_withdrawals where id = current_setting('tsc.r27_w')::uuid), 20000::bigint,
  'a declined withdrawal keeps what came back, like a failed or cancelled one');

select is((select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and proname = f), 1, f || ': one function, no overloads')
  from unnest(array['guard_payout_account_delete', 'notify_default_bank_change', 'decline_withdrawal']) f;
select is((select proacl::text from pg_proc where oid = 'public.decline_withdrawal(uuid, text)'::regprocedure),
  '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}', 'decline_withdrawal: grants as before');
select is((select proacl::text from pg_proc where oid = 'public.guard_payout_account_delete()'::regprocedure),
  '{postgres=X/postgres,service_role=X/postgres}', 'the guard: grants as before');

select * from finish();
rollback;
