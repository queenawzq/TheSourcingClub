-- One balance, fix round 30 (20261121320000).
--
-- G1 (f1): a dispute recorded while a Stripe withdrawal still holds the step
--     is told ("on hold", the whole amount) once the withdrawal hands the
--     step back; the webhook recording it again, or any later call, writes
--     no second notice.
-- G7 (f2): removing the default bank while the PayPal takes over says the
--     bank was removed, beside the new default.
-- L2 (f1): a Stripe withdrawal still open an hour after it was asked for is
--     on the staff board even though it was tried a moment ago (updated_at
--     new, lease held); one asked a minute ago is not.
--
-- Fixtures: slugs pgtap-r30-*, ids b30?xxxx-...; every count is scoped to them.
begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

update public.payout_provider_settings set enabled = case
    when provider = 'paypal' and region in ('china', 'elsewhere') then true else false end;

set local session_replication_role = replica;

insert into auth.users (id, email)
select ('b30a0000-0000-0000-0000-0000000000' || k)::uuid, 'pgtap-r30-' || k || '@example.com'
  from unnest(array['01','02','03','04']) k;
-- 02 is staff; 03 owns the brand; 01 owns f1, 04 owns f2.
insert into public.platform_admins (user_id, note) values ('b30a0000-0000-0000-0000-000000000002', 'pgtap-r30');
insert into public.orgs (id, type, name, slug) values
  ('b30b0000-0000-0000-0000-00000000000b', 'brand', 'R30 Brand', 'pgtap-r30-brand'),
  ('b30b0000-0000-0000-0000-0000000000e1', 'factory', 'R30 Factory 1', 'pgtap-r30-f1'),
  ('b30b0000-0000-0000-0000-0000000000e2', 'factory', 'R30 Factory 2', 'pgtap-r30-f2');
insert into public.org_members (org_id, user_id, role, permissions) values
  ('b30b0000-0000-0000-0000-00000000000b', 'b30a0000-0000-0000-0000-000000000003', 'owner', '{}'),
  ('b30b0000-0000-0000-0000-0000000000e1', 'b30a0000-0000-0000-0000-000000000001', 'owner', '{}'),
  ('b30b0000-0000-0000-0000-0000000000e2', 'b30a0000-0000-0000-0000-000000000004', 'owner', '{}');
insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total)
values ('b30c0000-0000-0000-0000-000000000001', 'b30b0000-0000-0000-0000-00000000000b', 'R30 request', 'awarded', 'invited_only', 100);
insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity, submitted_at)
values ('b30c1000-0000-0000-0000-000000000001', 'b30c0000-0000-0000-0000-000000000001', 'b30b0000-0000-0000-0000-0000000000e1', 'accepted', 100, 1, now());
insert into public.production_orders
  (id, rfq_id, quote_id, brand_org_id, factory_org_id, unit_price_cents, status, schedule_brand_agreed_at, schedule_brand_agreed_by,
   production_quantity, bulk_subtotal_cents, sample_subtotal_cents, order_total_cents, deposit_pct, balance_pct, order_number)
values ('b30d0000-0000-0000-0000-000000000001', 'b30c0000-0000-0000-0000-000000000001', 'b30c1000-0000-0000-0000-000000000001',
        'b30b0000-0000-0000-0000-00000000000b', 'b30b0000-0000-0000-0000-0000000000e1', 100000, 'active', now() - interval '60 days',
        'b30a0000-0000-0000-0000-000000000003', 1, 100000, 0, 100000, 50, 50, 'R30-1');
insert into public.order_milestones (id, order_id, kind, title, amount_cents, state, sort, completed_at)
values ('b30e0011-0000-0000-0000-000000000000', 'b30d0000-0000-0000-0000-000000000001', 'approval_and_payment', 'R30 fit sample', 50000,
        'complete', 10, now() - interval '9 days');
insert into public.order_payments
  (id, order_id, milestone_id, amount_cents, charged_cents, amount_received_cents, currency, state, confirmed_at, release_requested_at,
   withdrawal_pool, stripe_payment_intent_id, stripe_charge_id, funds_available_at)
values ('b30f0011-0000-0000-0000-000000000000', 'b30d0000-0000-0000-0000-000000000001', 'b30e0011-0000-0000-0000-000000000000',
        50000, 53500, 53500, 'USD', 'confirmed', now() - interval '20 days', now() - interval '9 days',
        false, 'pi_pgtap_r30_11', 'ch_pgtap_r30_11', now() - interval '15 days');
insert into public.factory_payout_accounts (id, org_id, method, paypal_email, is_primary, details_changed_at)
values ('b3090000-0000-0000-0000-000000000001', 'b30b0000-0000-0000-0000-0000000000e1', 'paypal', 'pgtap-r30-f1@example.com', true, '2026-11-01');
insert into public.stripe_connect_accounts (org_id, stripe_account_id, country, transfers_active, payouts_enabled, details_submitted)
values ('b30b0000-0000-0000-0000-0000000000e1', 'acct_pgtap_r30_1', 'US', true, true, true);
-- sw1: the withdrawal that finds the dispute. sw2: asked an hour ago, tried
-- again just now (updated_at now, its lease held). sw3: asked a minute ago.
insert into public.stripe_withdrawals (id, org_id, stripe_account_id, request_key, request_id, amount_minor, currency, usd_cents, state,
                                       created_at, updated_at, lease_until)
values ('b3080000-0000-0000-0000-000000000001', 'b30b0000-0000-0000-0000-0000000000e1', 'acct_pgtap_r30_1', 'pgtap-r30-sw-1',
        gen_random_uuid(), 50000, 'USD', 50000, 'claimed', now(), now(), null),
       ('b3080000-0000-0000-0000-000000000002', 'b30b0000-0000-0000-0000-0000000000e1', 'acct_pgtap_r30_1', 'pgtap-r30-sw-2',
        gen_random_uuid(), 100, 'USD', 100, 'claimed', now() - interval '1 hour', now(), now() + interval '2 minutes'),
       ('b3080000-0000-0000-0000-000000000003', 'b30b0000-0000-0000-0000-0000000000e1', 'acct_pgtap_r30_1', 'pgtap-r30-sw-3',
        gen_random_uuid(), 100, 'USD', 100, 'fee_taken', now() - interval '1 minute', now(), null);
-- f2: a default bank (Wise, switched off) and a saved PayPal.
insert into public.factory_payout_accounts
  (id, org_id, method, bank_name, account_name, account_number_last4, swift, bank_country, is_primary,
   wise_recipient_type, wise_currency, wise_number_key, wise_details, details_changed_at, number_changed_at)
values ('b3090000-0000-0000-0000-0000000000a2', 'b30b0000-0000-0000-0000-0000000000e2', 'bank', 'R30 Bank', 'R30 MILL LTD', '4321', 'BOSHCNSH', 'CN', true,
        'chinese_local_business', 'CNY', 'accountNumber', '{"accountHolderName":"R30 MILL LTD"}', '2026-11-01', now());
insert into public.factory_payout_accounts (id, org_id, method, paypal_email, is_primary, details_changed_at)
values ('b3090000-0000-0000-0000-000000000002', 'b30b0000-0000-0000-0000-0000000000e2', 'paypal', 'pgtap-r30-f2@example.com', false, '2026-11-01');
insert into public.factory_payout_preferences (org_id, route) values ('b30b0000-0000-0000-0000-0000000000e2', 'manual');
set local session_replication_role = origin;

create function pg_temp.act_as(who text) returns void language sql as $f$
  select set_config('request.jwt.claims',
    json_build_object('sub', 'b30a0000-0000-0000-0000-' || lpad(who, 12, '0'), 'role', 'authenticated')::text, true);
$f$;
grant execute on function pg_temp.act_as(text) to authenticated, service_role;
create function pg_temp.as_server(sql text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  set local role service_role;
  execute sql;
  reset role;
end;
$f$;
create function pg_temp.holds() returns text language sql as $f$
  select coalesce(string_agg(body, ' || ' order by created_at), '') from public.notifications
   where org_id = 'b30b0000-0000-0000-0000-0000000000e1' and kind = 'payment_disputed'
     and subject_id = 'b30f0011-0000-0000-0000-000000000000' and title like '% on hold';
$f$;
create function pg_temp.said(n int) returns text language sql as $f$
  select coalesce(string_agg(body, ' || ' order by body), '') from public.notifications
   where org_id = ('b30b0000-0000-0000-0000-0000000000e' || n)::uuid and kind = 'payout_method_changed';
$f$;

-- G1 --------------------------------------------------------------------------
select lives_ok($$select pg_temp.as_server('select public.claim_owed_steps(''b30b0000-0000-0000-0000-0000000000e1'', 50000, ''stripe'', ''b3080000-0000-0000-0000-000000000001'')')$$,
  'f1''s Stripe withdrawal claims the whole $500 step');
select is((select sum(amount_cents)::bigint from public.payment_takes where stripe_withdrawal_id = 'b3080000-0000-0000-0000-000000000001' and status = 'held'),
  50000::bigint, 'and holds it');
-- The withdraw call reads the charge: disputed. Recorded while its take still holds the step.
select lives_ok($$select pg_temp.as_server('select public.record_payment_disputed(''b30f0011-0000-0000-0000-000000000000'', true)')$$,
  'the withdraw call records the dispute');
set constraints all immediate;
set constraints all deferred;
select is(pg_temp.holds(), '', 'nothing is on hold yet: the withdrawal still holds the step');
-- Refused: its part goes back to the balance.
-- (the stripe_withdrawals_end_takes trigger returns its unattempted parts)
select lives_ok($$update public.stripe_withdrawals set state = 'refused', reason = 'refused' where id = 'b3080000-0000-0000-0000-000000000001'$$,
  'the refused withdrawal hands the step back');
set constraints all immediate;
set constraints all deferred;
select is(pg_temp.holds(), 'The brand disputed the charge. $500.00 is held until the dispute is settled.',
  'now the factory is told it is on hold, at the true amount');
-- The webhook comes later and finds it recorded; any other path telling it again.
select lives_ok($$select pg_temp.as_server('select public.record_payment_disputed(''b30f0011-0000-0000-0000-000000000000'', true)')$$,
  'the webhook records the same dispute');
select public.tell_payment_hold(p, true) from public.order_payments p where p.id = 'b30f0011-0000-0000-0000-000000000000';
set constraints all immediate;
set constraints all deferred;
select is(pg_temp.holds(), 'The brand disputed the charge. $500.00 is held until the dispute is settled.', 'told once');
-- Settled in TSC's favour, then disputed again: a new dispute is told again.
select lives_ok($$select pg_temp.as_server('select public.record_payment_disputed(''b30f0011-0000-0000-0000-000000000000'', false)')$$, 'won');
set local session_replication_role = replica;
-- (Told for a dispute a minute earlier: its time and its key, 20261121390000;
-- within this transaction now() would otherwise make both disputes one.)
update public.notifications set created_at = created_at - interval '1 minute',
       dedupe_key = format('payment_hold:%s:%s:%s', subject_id,
                           (extract(epoch from created_at - interval '1 minute') * 1000000)::bigint, data ->> 'held_cents')
 where org_id = 'b30b0000-0000-0000-0000-0000000000e1' and kind = 'payment_disputed';
set local session_replication_role = origin;
select lives_ok($$select pg_temp.as_server('select public.record_payment_disputed(''b30f0011-0000-0000-0000-000000000000'', true)')$$, 'disputed again');
select is((select count(*)::int from public.notifications where org_id = 'b30b0000-0000-0000-0000-0000000000e1'
             and kind = 'payment_disputed' and title like '% on hold'), 2, 'a new dispute is a new notice');

-- G7 --------------------------------------------------------------------------
select pg_temp.act_as('04'); set local role authenticated;
select lives_ok($$select public.remove_payout_account('b3090000-0000-0000-0000-0000000000a2', 'b3090000-0000-0000-0000-000000000002')$$,
  'f2 removes the default bank, the PayPal taking over');
reset role;
set constraints all immediate;
set constraints all deferred;
select ok(pg_temp.said(2) like '%Your bank account at R30 Bank ending 4321 was removed. If nobody at your company made this change, email operations@contact.sourcing-club.com now.%',
  'the company is told the bank was removed');
select ok(pg_temp.said(2) like '%PayPal account pgtap-r30-f2@example.com is now your default withdrawal method.%',
  'and which method is the default now');
select is((select count(*)::int from public.notifications where org_id = 'b30b0000-0000-0000-0000-0000000000e2'
             and kind = 'payout_method_changed' and body like '%was removed%'), 1, 'removed is said once');

-- L2 --------------------------------------------------------------------------
create function pg_temp.stuck() returns text language plpgsql as $f$
declare j jsonb;
begin
  perform pg_temp.act_as('02');
  set local role authenticated;
  j := public.admin_balance_attention();
  reset role;
  return coalesce((select string_agg(x ->> 'withdrawal_id', ',' order by x ->> 'withdrawal_id') from jsonb_array_elements(j -> 'stuck') x
                    where x ->> 'org_id' = 'b30b0000-0000-0000-0000-0000000000e1'), '');
end;
$f$;
select ok(pg_temp.stuck() like '%b3080000-0000-0000-0000-000000000002%',
  'open an hour, tried again a moment ago: on the staff board');
select ok(pg_temp.stuck() not like '%b3080000-0000-0000-0000-000000000003%', 'asked a minute ago: not yet');

-- Shape -----------------------------------------------------------------------
select is((select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and proname = f), 1, f || ': one function, no overloads')
  from unnest(array['tell_payment_hold', 'tell_hold_after_take_return', 'notify_default_bank_change', 'admin_balance_attention']) f;
select is((select proacl::text from pg_proc where oid = 'public.admin_balance_attention()'::regprocedure),
  '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}', 'admin_balance_attention: grants as before');
select is((select proacl::text from pg_proc where oid = 'public.tell_hold_after_take_return()'::regprocedure),
  '{postgres=X/postgres,service_role=X/postgres}', 'the new trigger function: nobody signed in runs it');
select is((select proacl::text from pg_proc where oid = 'public.tell_payment_hold(public.order_payments, boolean)'::regprocedure),
  '{postgres=X/postgres,service_role=X/postgres}', 'tell_payment_hold: grants as before');

select * from finish();
rollback;
