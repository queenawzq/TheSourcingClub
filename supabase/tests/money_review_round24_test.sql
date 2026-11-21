-- One balance, fix round 24 (20261121280000): money that went back to the
-- brand while part of it was in a withdrawal staff had already sent.
--
-- F1 (e1): $500 deposit in a PayPal withdrawal being sent; the brand's whole
--   charge is refunded. The factory reads $0 still held and $500 gone back,
--   is told TSC is checking it (no "cancel"); staff see $500 at risk; the
--   payout completes: the factory owes TSC $500, on To recover.
-- F2 (e2): the same, and the payout fails: nothing comes back to the
--   balance (it went to the brand), no debt.
-- Also: approving a partly refunded step says the amount added (e6); the
-- default-method notices (e4, e5); Make default refused for a method whose
-- provider is off (e4).
--
-- Fixtures: slugs pgtap-r24-*, ids b24?xxxx-...; every count is scoped to them.
begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

update public.payout_provider_settings set enabled = case
    when provider = 'paypal' and region in ('china', 'elsewhere') then true else false end;

set local session_replication_role = replica;

insert into auth.users (id, email)
select ('b24a0000-0000-0000-0000-0000000000' || k)::uuid, 'pgtap-r24-' || k || '@example.com'
  from unnest(array['01','02','03','04','05','06','07','08','09']) k;
-- 02 is staff; 03 owns the brand; 0n+? owners: e1 01, e2 04, e3 05, e4 06, e5 07, e6 08, e7 09.
insert into public.platform_admins (user_id, note) values ('b24a0000-0000-0000-0000-000000000002', 'pgtap-r24');
insert into public.orgs (id, type, name, slug) values
  ('b24b0000-0000-0000-0000-00000000000b', 'brand', 'R24 Brand', 'pgtap-r24-brand');
insert into public.orgs (id, type, name, slug)
select ('b24b0000-0000-0000-0000-0000000000e' || n)::uuid, 'factory', 'R24 Factory ' || n, 'pgtap-r24-f' || n from generate_series(1, 7) n;
insert into public.org_members (org_id, user_id, role, permissions) values
  ('b24b0000-0000-0000-0000-00000000000b', 'b24a0000-0000-0000-0000-000000000003', 'owner', '{}'),
  ('b24b0000-0000-0000-0000-0000000000e1', 'b24a0000-0000-0000-0000-000000000001', 'owner', '{}'),
  ('b24b0000-0000-0000-0000-0000000000e2', 'b24a0000-0000-0000-0000-000000000004', 'owner', '{}'),
  ('b24b0000-0000-0000-0000-0000000000e3', 'b24a0000-0000-0000-0000-000000000005', 'owner', '{}'),
  ('b24b0000-0000-0000-0000-0000000000e4', 'b24a0000-0000-0000-0000-000000000006', 'owner', '{}'),
  ('b24b0000-0000-0000-0000-0000000000e5', 'b24a0000-0000-0000-0000-000000000007', 'owner', '{}'),
  ('b24b0000-0000-0000-0000-0000000000e6', 'b24a0000-0000-0000-0000-000000000008', 'owner', '{}'),
  ('b24b0000-0000-0000-0000-0000000000e7', 'b24a0000-0000-0000-0000-000000000009', 'owner', '{}');
insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total)
select ('b24c0000-0000-0000-0000-00000000000' || n)::uuid, 'b24b0000-0000-0000-0000-00000000000b', 'R24 request ' || n, 'awarded', 'invited_only', 100
  from generate_series(1, 7) n;
insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity, submitted_at)
select ('b24c1000-0000-0000-0000-00000000000' || n)::uuid, ('b24c0000-0000-0000-0000-00000000000' || n)::uuid,
       ('b24b0000-0000-0000-0000-0000000000e' || n)::uuid, 'accepted', 100, 1, now() from generate_series(1, 7) n;
insert into public.production_orders
  (id, rfq_id, quote_id, brand_org_id, factory_org_id, unit_price_cents, status, schedule_brand_agreed_at, schedule_brand_agreed_by,
   production_quantity, bulk_subtotal_cents, sample_subtotal_cents, order_total_cents, deposit_pct, balance_pct, order_number)
select ('b24d0000-0000-0000-0000-00000000000' || n)::uuid, ('b24c0000-0000-0000-0000-00000000000' || n)::uuid,
       ('b24c1000-0000-0000-0000-00000000000' || n)::uuid, 'b24b0000-0000-0000-0000-00000000000b',
       ('b24b0000-0000-0000-0000-0000000000e' || n)::uuid, 100000, 'active', now() - interval '60 days',
       'b24a0000-0000-0000-0000-000000000003', 1, 100000, 0, 100000, 50, 50, 'R24-' || n
  from generate_series(1, 7) n;

-- Payments pNK: factory N, step K. Milestones share the id's tail.
create temporary table r24_steps (n int, k int, kind text, title text, amount bigint, charged bigint, state text,
                                  approved boolean, pool boolean) on commit drop;
insert into r24_steps values
  (1, 1, 'payment_only',         'R24 deposit',    50000, 53500, 'confirmed', true,  false),
  (2, 1, 'payment_only',         'R24 deposit',    50000, 53500, 'confirmed', true,  false),
  (6, 1, 'approval_and_payment', 'R24 fit sample',  6500,  7060, 'confirmed', false, false);
insert into public.order_milestones (id, order_id, kind, title, amount_cents, state, sort, completed_at)
select ('b24e00' || n || k || '-0000-0000-0000-000000000000')::uuid, ('b24d0000-0000-0000-0000-00000000000' || n)::uuid,
       kind::public.milestone_type, title, amount, (case when approved then 'complete' else 'active' end)::public.milestone_state, k * 10,
       case when approved then now() - interval '9 days' end
  from r24_steps;
insert into public.order_payments
  (id, order_id, milestone_id, amount_cents, charged_cents, amount_received_cents, currency, state, confirmed_at, release_requested_at,
   withdrawal_pool, stripe_payment_intent_id, stripe_charge_id, funds_available_at, released_at, released_note, processing_at)
select ('b24f00' || n || k || '-0000-0000-0000-000000000000')::uuid, ('b24d0000-0000-0000-0000-00000000000' || n)::uuid,
       ('b24e00' || n || k || '-0000-0000-0000-000000000000')::uuid, amount, charged, charged, 'USD', state::public.payment_state,
       case when state <> 'processing' then now() - interval '20 days' end,
       case when approved then now() - interval '9 days' end,
       pool, 'pi_pgtap_r24_' || n || k, case when charged is not null then 'ch_pgtap_r24_' || n || k end,
       case when charged is not null then now() - interval '15 days' end,
       case when state = 'released' then now() - interval '8 days' end,
       case when state = 'released' then 'Paid by PayPal' end,
       case when state = 'processing' then now() - interval '1 hour' end
  from r24_steps;
insert into public.factory_payout_accounts (id, org_id, method, paypal_email, is_primary, details_changed_at)
select ('b2490000-0000-0000-0000-00000000000' || n)::uuid, ('b24b0000-0000-0000-0000-0000000000e' || n)::uuid, 'paypal',
       'pgtap-r24-f' || n || '@example.com', true, '2026-11-01'
  from generate_series(1, 7) n where n <> 4;
insert into public.factory_payout_accounts (id, org_id, method, paypal_email, is_primary, details_changed_at)
values ('b2490000-0000-0000-0000-000000000004', 'b24b0000-0000-0000-0000-0000000000e4', 'paypal', 'pgtap-r24-f4@example.com', true, '2026-11-01');
insert into public.factory_payout_accounts
  (id, org_id, method, bank_name, account_name, account_number_last4, swift, bank_country, is_primary,
   wise_recipient_type, wise_currency, wise_number_key, wise_details, details_changed_at, number_changed_at)
values ('b2490000-0000-0000-0000-0000000000a4', 'b24b0000-0000-0000-0000-0000000000e4', 'bank', 'R24 Bank', 'R24 MILL LTD', '1234', 'BOSHCNSH', 'CN', false,
        'chinese_local_business', 'CNY', 'accountNumber', '{"accountHolderName":"R24 MILL LTD"}', '2026-11-01', now()),
       ('b2490000-0000-0000-0000-0000000000a5', 'b24b0000-0000-0000-0000-0000000000e5', 'bank', 'R24 Bank', 'R24 MILL LTD', '5678', 'BOSHCNSH', 'CN', false,
        null, null, null, null, '2026-11-01', now());
insert into public.factory_payout_preferences (org_id, route)
select ('b24b0000-0000-0000-0000-0000000000e' || n)::uuid, 'manual' from generate_series(1, 7) n;
set local session_replication_role = origin;

create function pg_temp.act_as(who text) returns void language sql as $f$
  select set_config('request.jwt.claims',
    json_build_object('sub', 'b24a0000-0000-0000-0000-' || lpad(who, 12, '0'), 'role', 'authenticated')::text, true);
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
create function pg_temp.org(n int) returns uuid language sql immutable as $f$
  select ('b24b0000-0000-0000-0000-0000000000e' || n)::uuid;
$f$;
create function pg_temp.owner(n int) returns text language sql immutable as $f$
  select case n when 1 then '01' when 2 then '04' when 3 then '05' when 4 then '06' when 5 then '07' when 6 then '08' else '09' end;
$f$;
create function pg_temp.pay(nk int) returns uuid language sql immutable as $f$
  select ('b24f00' || nk || '-0000-0000-0000-000000000000')::uuid;
$f$;
create function pg_temp.p(nk int) returns public.order_payments language sql as $f$
  select * from public.order_payments where id = pg_temp.pay(nk);
$f$;
create function pg_temp.bal(n int) returns jsonb language plpgsql as $f$
declare j jsonb;
begin
  perform pg_temp.act_as(pg_temp.owner(n));
  set local role authenticated;
  j := public.factory_balance(pg_temp.org(n));
  reset role;
  return j;
end;
$f$;
create function pg_temp.refund(nk int, total bigint) returns void language plpgsql as $f$
begin
  perform pg_temp.as_server(format('select public.record_payment_refund_amount(%L, %L, %s)', pg_temp.pay(nk), 'pi_pgtap_r24_' || nk, total));
end;
$f$;
create function pg_temp.refund_failed(nk int, total bigint) returns void language plpgsql as $f$
begin
  perform pg_temp.as_server(format('select public.record_payment_refund_failed(%L, %L, %s)', pg_temp.pay(nk), 'pi_pgtap_r24_' || nk, total));
end;
$f$;
create function pg_temp.lost(nk int, amount bigint) returns void language plpgsql as $f$
begin
  perform pg_temp.as_server(format('select public.record_payment_dispute_lost(%L, %L, %s, 1500)', pg_temp.pay(nk), 'du_pgtap_r24_' || nk, amount));
end;
$f$;
create function pg_temp.req(n int, amount bigint) returns uuid language plpgsql as $f$
declare w uuid;
begin
  perform pg_temp.act_as(pg_temp.owner(n));
  set local role authenticated;
  w := (public.request_withdrawal(pg_temp.org(n), amount, ('b2490000-0000-0000-0000-00000000000' || n)::uuid)).id;
  reset role;
  return w;
end;
$f$;
create function pg_temp.claim(w uuid) returns void language plpgsql as $f$
begin
  perform pg_temp.act_as('02');
  set local role authenticated;
  perform public.claim_withdrawal(w);
  reset role;
end;
$f$;
create function pg_temp.pay_out(w uuid) returns void language plpgsql as $f$
begin
  perform pg_temp.claim(w);
  perform pg_temp.as_server(format('select public.record_withdrawal(%L, ''paid'', ''PP-R24'', 0, %s, ''USD'', null)', w,
    (select amount_cents from public.factory_withdrawals where id = w)));
end;
$f$;
create function pg_temp.staff_row(w uuid) returns jsonb language plpgsql as $f$
declare j jsonb;
begin
  perform pg_temp.act_as('02');
  set local role authenticated;
  select x into j from jsonb_array_elements(public.admin_withdrawals() -> 'withdrawals') x where x ->> 'id' = w::text;
  reset role;
  return j;
end;
$f$;
create function pg_temp.recover(n int) returns jsonb language plpgsql as $f$
declare j jsonb;
begin
  perform pg_temp.act_as('02');
  set local role authenticated;
  select coalesce(jsonb_agg(x), '[]'::jsonb) into j from jsonb_array_elements(public.admin_balance_attention() -> 'recover') x
   where (x ->> 'org_id')::uuid = pg_temp.org(n);
  reset role;
  return j;
end;
$f$;
create function pg_temp.told(org uuid, subject uuid) returns text language sql as $f$
  select string_agg(title || ' | ' || body, ' || ' order by created_at, title) from public.notifications where org_id = org and subject_id = subject;
$f$;


-- ===========================================================================
-- F1. Refunded while the PayPal payout is being sent; it completes.
-- ===========================================================================
select set_config('tsc.r24_w1', pg_temp.req(1, 50000)::text, true);
select lives_ok($$select pg_temp.claim(current_setting('tsc.r24_w1')::uuid)$$, 'staff send it (Sending)');
select lives_ok($$select pg_temp.refund(11, 53500)$$, 'the brand''s whole charge is refunded while it is being sent');
select is((select title || ' | ' || body from public.notifications where subject_id = current_setting('tsc.r24_w1')::uuid and kind = 'withdrawal'
            and title like 'Withdrawal of $500.00 %' and title not like '%requested'),
  'Withdrawal of $500.00 being checked | $500.00 of it went back to the brand after it was sent. TSC is checking this withdrawal.',
  'the factory is told the truth: no cancel offered for a withdrawal being sent');
select is((select x -> 'parts' from jsonb_array_elements(pg_temp.bal(1) -> 'withdrawals') x where x ->> 'id' = current_setting('tsc.r24_w1')),
  '[{"word": "refunded", "amount_cents": 50000}]'::jsonb, 'its block: nothing still held, $500 gone back');
select is((pg_temp.staff_row(current_setting('tsc.r24_w1')::uuid) ->> 'refunded_cents')::bigint, 50000::bigint, 'staff see the $500 at risk on the Sending row');
select is((pg_temp.bal(1) ->> 'total_cents')::bigint, (pg_temp.bal(1) ->> 'awaiting_cents')::bigint + (pg_temp.bal(1) ->> 'available_cents')::bigint
  + (pg_temp.bal(1) ->> 'pending_cents')::bigint + (pg_temp.bal(1) ->> 'processing_cents')::bigint + (pg_temp.bal(1) ->> 'paid_out_cents')::bigint, 'Total adds up');
select lives_ok($$select pg_temp.as_server(format('select public.record_withdrawal(%L, ''paid'', ''PP-R24'', 0, 50000, ''USD'', null)', current_setting('tsc.r24_w1')))$$,
  'then PayPal says it was paid');
select is((pg_temp.bal(1) ->> 'owed_to_tsc_cents')::bigint, 50000::bigint, 'the factory owes TSC $500');
select ok(exists (select 1 from jsonb_array_elements(pg_temp.recover(1)) x where (x ->> 'amount_cents')::bigint = 50000), 'on To recover');

-- ===========================================================================
-- F2. The same; the payout fails.
-- ===========================================================================
select set_config('tsc.r24_w2', pg_temp.req(2, 50000)::text, true);
select lives_ok($$select pg_temp.claim(current_setting('tsc.r24_w2')::uuid)$$, 'staff send it');
select lives_ok($$select pg_temp.refund(21, 53500)$$, 'refunded while being sent');
select lives_ok($$select pg_temp.as_server(format('select public.record_withdrawal(%L, ''failed'', sentence => ''unclaimed'')', current_setting('tsc.r24_w2')))$$,
  'the payout fails (unclaimed)');
select is(row((pg_temp.bal(2) ->> 'available_cents')::bigint, (pg_temp.bal(2) ->> 'owed_to_tsc_cents')::bigint, (pg_temp.bal(2) ->> 'total_cents')::bigint),
  row(0::bigint, 0::bigint, 0::bigint), 'nothing comes back (it went to the brand), and no debt');

-- ===========================================================================
-- Approve after a partial refund: the amount actually added.
-- ===========================================================================
select lives_ok($$select pg_temp.refund(61, 500)$$, '$5 of the $70.60 fit sample charge is refunded before approval');
set local session_replication_role = replica;
insert into public.milestone_updates (milestone_id, order_id, author_org_id, body, created_by)
values ('b24e0061-0000-0000-0000-000000000000', 'b24d0000-0000-0000-0000-000000000006', pg_temp.org(6), 'Done',
        'b24a0000-0000-0000-0000-000000000008');
set local session_replication_role = origin;
select pg_temp.act_as('03'); set local role authenticated;
select lives_ok($$select public.approve_milestone('b24e0061-0000-0000-0000-000000000000')$$, 'the brand approves');
reset role;
select is((select body from public.notifications where org_id = pg_temp.org(6) and kind = 'milestone_approved'),
  'The brand approved this step. $60.40 added to your balance.', 'the factory reads the $60.40 actually added');

-- ===========================================================================
-- Default method notices and a provider that is off.
-- ===========================================================================
select pg_temp.act_as('06'); set local role authenticated;
select throws_ok($$select public.choose_payout_method(pg_temp.org(4), 'b2490000-0000-0000-0000-0000000000a4')$$, '22023',
  'This withdrawal method isn''t available right now.', 'a Wise account cannot be the default while Wise is off');
reset role;
-- The bank notice is a deferred trigger (it reads the route at commit): run it now.
set constraints all immediate;
select pg_temp.act_as('07'); set local role authenticated;
select lives_ok($$select public.choose_payout_method(pg_temp.org(5), 'b2490000-0000-0000-0000-0000000000a5')$$, 'F5 makes its bank account the default');
reset role;
select is((select string_agg(body, ' || ') from public.notifications where org_id = pg_temp.org(5) and kind = 'payout_method_changed'),
  'Your bank account at R24 Bank ending 5678 is now your default withdrawal method. If nobody at your company made this change, email operations@contact.sourcing-club.com now.', 'in the approved words');
select pg_temp.act_as('07'); set local role authenticated;
select lives_ok($$select public.choose_payout_method(pg_temp.org(5), 'b2490000-0000-0000-0000-000000000005')$$, 'and its PayPal back');
reset role;
select ok(exists (select 1 from public.notifications where org_id = pg_temp.org(5) and kind = 'payout_method_changed'
                    and body like 'PayPal account pgtap-r24-f5@example.com is now your default withdrawal method.%'), 'in the approved words too');
select is((select count(*)::int from public.notifications where org_id in (pg_temp.org(4), pg_temp.org(5)) and body like 'TSC now pays%'), 0, 'never "TSC now pays"');

select is((select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and proname = f), 1, f || ': one function, no overloads')
  from unnest(array['factory_balance', 'tell_withdrawal_refunded', 'admin_withdrawals', 'approve_milestone', 'notify_paypal_change',
                    'notify_default_bank_change', 'choose_payout_method']) f;

select * from finish();
rollback;
