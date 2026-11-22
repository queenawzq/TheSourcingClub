-- One balance, fix round 31 (20261121330000), money review r30 L1.
--
-- A Stripe withdrawal holds $200 of a $500 step; the dispute is recorded and
-- the factory told "$300.00 is held". The withdrawal is refused and its part
-- comes back: the bell now says "$500.00 is held", once. Telling it again,
-- at the same or a smaller amount, writes nothing.
--
-- Fixtures: slugs pgtap-r31-*, ids b31?xxxx-...; every count is scoped to them.
begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

set local session_replication_role = replica;

insert into auth.users (id, email)
select ('b31a0000-0000-0000-0000-0000000000' || k)::uuid, 'pgtap-r31-' || k || '@example.com'
  from unnest(array['01','03']) k;
insert into public.orgs (id, type, name, slug) values
  ('b31b0000-0000-0000-0000-00000000000b', 'brand', 'R31 Brand', 'pgtap-r31-brand'),
  ('b31b0000-0000-0000-0000-0000000000e1', 'factory', 'R31 Factory 1', 'pgtap-r31-f1');
insert into public.org_members (org_id, user_id, role, permissions) values
  ('b31b0000-0000-0000-0000-00000000000b', 'b31a0000-0000-0000-0000-000000000003', 'owner', '{}'),
  ('b31b0000-0000-0000-0000-0000000000e1', 'b31a0000-0000-0000-0000-000000000001', 'owner', '{}');
insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total)
values ('b31c0000-0000-0000-0000-000000000001', 'b31b0000-0000-0000-0000-00000000000b', 'R31 request', 'awarded', 'invited_only', 100);
insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity, submitted_at)
values ('b31c1000-0000-0000-0000-000000000001', 'b31c0000-0000-0000-0000-000000000001', 'b31b0000-0000-0000-0000-0000000000e1', 'accepted', 100, 1, now());
insert into public.production_orders
  (id, rfq_id, quote_id, brand_org_id, factory_org_id, unit_price_cents, status, schedule_brand_agreed_at, schedule_brand_agreed_by,
   production_quantity, bulk_subtotal_cents, sample_subtotal_cents, order_total_cents, deposit_pct, balance_pct, order_number)
values ('b31d0000-0000-0000-0000-000000000001', 'b31c0000-0000-0000-0000-000000000001', 'b31c1000-0000-0000-0000-000000000001',
        'b31b0000-0000-0000-0000-00000000000b', 'b31b0000-0000-0000-0000-0000000000e1', 100000, 'active', now() - interval '60 days',
        'b31a0000-0000-0000-0000-000000000003', 1, 100000, 0, 100000, 50, 50, 'R31-1');
insert into public.order_milestones (id, order_id, kind, title, amount_cents, state, sort, completed_at)
values ('b31e0011-0000-0000-0000-000000000000', 'b31d0000-0000-0000-0000-000000000001', 'approval_and_payment', 'R31 fit sample', 50000,
        'complete', 10, now() - interval '9 days');
insert into public.order_payments
  (id, order_id, milestone_id, amount_cents, charged_cents, amount_received_cents, currency, state, confirmed_at, release_requested_at,
   withdrawal_pool, stripe_payment_intent_id, stripe_charge_id, funds_available_at)
values ('b31f0011-0000-0000-0000-000000000000', 'b31d0000-0000-0000-0000-000000000001', 'b31e0011-0000-0000-0000-000000000000',
        50000, 53500, 53500, 'USD', 'confirmed', now() - interval '20 days', now() - interval '9 days',
        false, 'pi_pgtap_r31_11', 'ch_pgtap_r31_11', now() - interval '15 days');
insert into public.stripe_connect_accounts (org_id, stripe_account_id, country, transfers_active, payouts_enabled, details_submitted)
values ('b31b0000-0000-0000-0000-0000000000e1', 'acct_pgtap_r31_1', 'US', true, true, true);
insert into public.stripe_withdrawals (id, org_id, stripe_account_id, request_key, request_id, amount_minor, currency, usd_cents, state,
                                       created_at, updated_at, lease_until)
values ('b3180000-0000-0000-0000-000000000001', 'b31b0000-0000-0000-0000-0000000000e1', 'acct_pgtap_r31_1', 'pgtap-r31-sw-1',
        gen_random_uuid(), 20000, 'USD', 20000, 'claimed', now(), now(), null);
set local session_replication_role = origin;

create function pg_temp.as_server(sql text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  set local role service_role;
  execute sql;
  reset role;
end;
$f$;
create function pg_temp.holds() returns text language sql as $f$
  select coalesce(string_agg(body, ' || ' order by created_at, body), '') from public.notifications
   where org_id = 'b31b0000-0000-0000-0000-0000000000e1' and kind = 'payment_disputed'
     and subject_id = 'b31f0011-0000-0000-0000-000000000000' and title like '% on hold';
$f$;

select lives_ok($$select pg_temp.as_server('select public.claim_owed_steps(''b31b0000-0000-0000-0000-0000000000e1'', 20000, ''stripe'', ''b3180000-0000-0000-0000-000000000001'')')$$,
  'a Stripe withdrawal claims $200 of the $500 step');
select is((select sum(amount_cents)::bigint from public.payment_takes where stripe_withdrawal_id = 'b3180000-0000-0000-0000-000000000001' and status = 'held'),
  20000::bigint, 'and holds that part');
select lives_ok($$select pg_temp.as_server('select public.record_payment_disputed(''b31f0011-0000-0000-0000-000000000000'', true)')$$,
  'the dispute is recorded while the withdrawal holds part of the step');
set constraints all immediate;
set constraints all deferred;
select is(pg_temp.holds(), 'The brand disputed the charge. $300.00 is held until the dispute is settled.',
  'the factory is told the part left is held');
-- (the stripe_withdrawals_end_takes trigger returns its unattempted parts)
select lives_ok($$update public.stripe_withdrawals set state = 'refused', reason = 'refused' where id = 'b3180000-0000-0000-0000-000000000001'$$,
  'the refused withdrawal hands its $200 back');
set constraints all immediate;
set constraints all deferred;
select is(pg_temp.holds(),
  'The brand disputed the charge. $300.00 is held until the dispute is settled. || The brand disputed the charge. $500.00 is held until the dispute is settled.',
  'the factory is told the full $500.00 is now held');
-- The webhook records it again; any other path tells it again: nothing new.
select lives_ok($$select pg_temp.as_server('select public.record_payment_disputed(''b31f0011-0000-0000-0000-000000000000'', true)')$$,
  'the webhook records the same dispute');
select public.tell_payment_hold(p, true) from public.order_payments p where p.id = 'b31f0011-0000-0000-0000-000000000000';
set constraints all immediate;
set constraints all deferred;
select is((select count(*)::int from public.notifications where org_id = 'b31b0000-0000-0000-0000-0000000000e1'
             and kind = 'payment_disputed' and title like '% on hold'), 2, 'the same amount is not told twice');
select is((select (data ->> 'held_cents')::bigint from public.notifications where org_id = 'b31b0000-0000-0000-0000-0000000000e1'
             and kind = 'payment_disputed' and body like '%$500.00%'), 50000::bigint, 'the notice keeps the amount it told');

-- Shape -----------------------------------------------------------------------
select is((select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and proname = 'tell_payment_hold'), 1,
  'tell_payment_hold: one function, no overloads');
select is((select proacl::text from pg_proc where oid = 'public.tell_payment_hold(public.order_payments, boolean)'::regprocedure),
  '{postgres=X/postgres,service_role=X/postgres}', 'tell_payment_hold: grants as before');

select * from finish();
rollback;
