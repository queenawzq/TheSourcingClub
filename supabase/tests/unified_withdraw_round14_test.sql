-- One balance, fix round 14 (20261120340000) and the round 13 review's test
-- gaps (A2).
--
-- 1. factory_balance(): Pending is earnings not yet available (card payments
--    clearing, disputed steps); a withdrawal waiting for staff or being sent
--    is Processing. The reported state: $1,313 clearing and a $1,000 PayPal
--    withdrawal waiting read Pending $1,313 (was $2,313), Processing $1,000.
--    Owner and member read the same figures.
-- 2. Removing a withdrawal method: refused while a withdrawal to THAT account
--    is requested or being paid, or a per-step payout to it is processing;
--    allowed once the withdrawal is declined, failed, cancelled or paid, and
--    with approved balance money and nothing in flight. Every refusal is
--    pinned by sqlstate, hint, message and detail, so another refusal
--    (payout_primary, a permission error) cannot pass for it.
-- 3. request_withdrawal() to a removed account: the readable refusal, never a
--    foreign key error. (The two-session race is scripts/check-withdrawal-race.mjs.)
--
-- Fixtures: slugs pgtap-r14-*, ids d14?xxxx-...; every count is scoped to them.
begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

update public.payout_provider_settings set enabled = case
    when provider = 'paypal' and region in ('china', 'elsewhere') then true else false end;

set local session_replication_role = replica;

insert into auth.users (id, email)
select ('d14a0000-0000-0000-0000-0000000000' || k)::uuid, 'pgtap-r14-' || k || '@example.com' from unnest(array['01','02','03','04','05']) k;
insert into public.platform_admins (user_id, note) values ('d14a0000-0000-0000-0000-000000000002', 'pgtap-r14');
insert into public.orgs (id, type, name, slug) values
  ('d14b0000-0000-0000-0000-00000000000b', 'brand', 'R14 Brand', 'pgtap-r14-brand'),
  ('d14b0000-0000-0000-0000-0000000000e1', 'factory', 'R14 Factory', 'pgtap-r14-factory'),
  ('d14b0000-0000-0000-0000-0000000000e2', 'factory', 'R14 Remove', 'pgtap-r14-remove');
insert into public.org_members (org_id, user_id, role, permissions) values
  ('d14b0000-0000-0000-0000-0000000000e1', 'd14a0000-0000-0000-0000-000000000001', 'owner', '{}'),
  ('d14b0000-0000-0000-0000-0000000000e1', 'd14a0000-0000-0000-0000-000000000004', 'member', '{}'),
  ('d14b0000-0000-0000-0000-00000000000b', 'd14a0000-0000-0000-0000-000000000003', 'owner', '{}'),
  ('d14b0000-0000-0000-0000-0000000000e2', 'd14a0000-0000-0000-0000-000000000005', 'owner', '{}');
insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total) values
  ('d14c0000-0000-0000-0000-000000000001', 'd14b0000-0000-0000-0000-00000000000b', 'R14 request', 'awarded', 'invited_only', 100),
  ('d14c0000-0000-0000-0000-000000000002', 'd14b0000-0000-0000-0000-00000000000b', 'R14 remove request', 'awarded', 'invited_only', 100);
insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity, submitted_at) values
  ('d14c1000-0000-0000-0000-000000000001', 'd14c0000-0000-0000-0000-000000000001', 'd14b0000-0000-0000-0000-0000000000e1', 'accepted', 100, 1, now()),
  ('d14c1000-0000-0000-0000-000000000002', 'd14c0000-0000-0000-0000-000000000002', 'd14b0000-0000-0000-0000-0000000000e2', 'accepted', 100, 1, now());
insert into public.production_orders
  (id, rfq_id, quote_id, brand_org_id, factory_org_id, unit_price_cents, status, schedule_brand_agreed_at, schedule_brand_agreed_by,
   production_quantity, bulk_subtotal_cents, sample_subtotal_cents, order_total_cents, deposit_pct, balance_pct, order_number)
values
  ('d14d0000-0000-0000-0000-000000000001', 'd14c0000-0000-0000-0000-000000000001', 'd14c1000-0000-0000-0000-000000000001',
   'd14b0000-0000-0000-0000-00000000000b', 'd14b0000-0000-0000-0000-0000000000e1', 300000, 'active', now() - interval '60 days',
   'd14a0000-0000-0000-0000-000000000003', 1, 300000, 0, 300000, 50, 50, 'R14-1'),
  ('d14d0000-0000-0000-0000-000000000002', 'd14c0000-0000-0000-0000-000000000002', 'd14c1000-0000-0000-0000-000000000002',
   'd14b0000-0000-0000-0000-00000000000b', 'd14b0000-0000-0000-0000-0000000000e2', 50000, 'active', now() - interval '60 days',
   'd14a0000-0000-0000-0000-000000000003', 1, 50000, 0, 50000, 50, 50, 'R14-2');
-- Factory 1: s1 $1,000 approved and cleared; s2 $1,313 approved, still
-- clearing (its money is available on Stripe in 3 days).
insert into public.order_milestones (id, order_id, kind, title, amount_cents, state, sort, completed_at) values
  ('d14e0001-0000-0000-0000-000000000001', 'd14d0000-0000-0000-0000-000000000001', 'approval_and_payment', 'R14 cleared', 100000, 'complete', 10, now() - interval '5 days'),
  ('d14e0002-0000-0000-0000-000000000001', 'd14d0000-0000-0000-0000-000000000001', 'approval_and_payment', 'R14 clearing', 131300, 'complete', 20, now() - interval '1 day'),
  ('d14e0001-0000-0000-0000-000000000002', 'd14d0000-0000-0000-0000-000000000002', 'approval_and_payment', 'R14 remove step', 50000, 'complete', 10, now() - interval '5 days');
insert into public.order_payments
  (id, order_id, milestone_id, amount_cents, currency, state, confirmed_at, release_requested_at,
   stripe_payment_intent_id, stripe_charge_id, funds_available_at) values
  ('d14f0001-0000-0000-0000-000000000001', 'd14d0000-0000-0000-0000-000000000001', 'd14e0001-0000-0000-0000-000000000001', 100000, 'USD', 'confirmed',
   now() - interval '30 days', now() - interval '5 days', 'pi_pgtap_r14_1', 'ch_pgtap_r14_1', now() - interval '20 days'),
  ('d14f0002-0000-0000-0000-000000000001', 'd14d0000-0000-0000-0000-000000000001', 'd14e0002-0000-0000-0000-000000000001', 131300, 'USD', 'confirmed',
   now() - interval '1 day', now() - interval '1 day', 'pi_pgtap_r14_2', 'ch_pgtap_r14_2', now() + interval '3 days'),
  ('d14f0001-0000-0000-0000-000000000002', 'd14d0000-0000-0000-0000-000000000002', 'd14e0001-0000-0000-0000-000000000002', 50000, 'USD', 'confirmed',
   now() - interval '30 days', now() - interval '5 days', 'pi_pgtap_r14_r1', 'ch_pgtap_r14_r1', now() - interval '20 days');
insert into public.factory_payout_accounts (id, org_id, method, paypal_email, is_primary, details_changed_at) values
  ('d1490000-0000-0000-0000-000000000011', 'd14b0000-0000-0000-0000-0000000000e1', 'paypal', 'pgtap-r14@example.com', true, '2026-11-01'),
  -- Factory 2: A, the default; B, another.
  ('d1490000-0000-0000-0000-000000000021', 'd14b0000-0000-0000-0000-0000000000e2', 'paypal', 'pgtap-r14-a@example.com', true, '2026-11-01'),
  ('d1490000-0000-0000-0000-000000000022', 'd14b0000-0000-0000-0000-0000000000e2', 'paypal', 'pgtap-r14-b@example.com', false, '2026-11-01');
set local session_replication_role = origin;

create function pg_temp.act_as(who text) returns void language sql as $f$
  select set_config('request.jwt.claims',
    json_build_object('sub', 'd14a0000-0000-0000-0000-' || lpad(who, 12, '0'), 'role', 'authenticated')::text, true);
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
-- factory_balance() of factory 1, read by the owner ('01') or the member ('04').
create function pg_temp.bal(who text default '01') returns jsonb language plpgsql as $f$
declare j jsonb;
begin
  perform pg_temp.act_as(who);
  set local role authenticated;
  j := public.factory_balance('d14b0000-0000-0000-0000-0000000000e1');
  reset role;
  return j;
end;
$f$;
create function pg_temp.fig(j jsonb, k text) returns bigint language sql immutable as $f$
  select (j ->> k)::bigint;
$f$;
create function pg_temp.sum_of(j jsonb) returns bigint language sql immutable as $f$
  select (j ->> 'awaiting_cents')::bigint + (j ->> 'available_cents')::bigint + (j ->> 'pending_cents')::bigint
       + (j ->> 'processing_cents')::bigint + (j ->> 'paid_out_cents')::bigint;
$f$;
-- The five figures and the total, as one comparable line.
create function pg_temp.line(j jsonb) returns text language sql immutable as $f$
  select format('awaiting %s, available %s, pending %s, processing %s, paid out %s, total %s',
    j ->> 'awaiting_cents', j ->> 'available_cents', j ->> 'pending_cents', j ->> 'processing_cents', j ->> 'paid_out_cents', j ->> 'total_cents');
$f$;

-- ===========================================================================
-- 1. The reported state: $1,313 clearing, a $1,000 PayPal withdrawal waiting.
-- ===========================================================================
select is(pg_temp.line(pg_temp.bal()),
  'awaiting 0, available 100000, pending 131300, processing 0, paid out 0, total 231300',
  'before any withdrawal: $1,000 available, $1,313 pending');

select pg_temp.act_as('01'); set local role authenticated;
select lives_ok($$select set_config('tsc.r14_w',
  (public.request_withdrawal('d14b0000-0000-0000-0000-0000000000e1', 100000, 'd1490000-0000-0000-0000-000000000011')).id::text, true)$$,
  'the owner asks to withdraw the $1,000 by PayPal');
reset role;

select is(pg_temp.fig(pg_temp.bal(), 'pending_cents'), 131300::bigint,
  'waiting for staff: Pending is exactly the $1,313 clearing (was $2,313 with the withdrawal in it)');
select is(pg_temp.fig(pg_temp.bal(), 'processing_cents'), 100000::bigint, 'the $1,000 waiting for staff is Processing');
select is(pg_temp.fig(pg_temp.bal(), 'available_cents'), 0::bigint, 'nothing is left Available');
select is(pg_temp.fig(pg_temp.bal(), 'total_cents'), 231300::bigint, 'Total is unchanged by asking');
select is(pg_temp.fig(pg_temp.bal(), 'total_cents'), pg_temp.sum_of(pg_temp.bal()),
  'Total = awaiting + available + pending + processing + paid out');
select is(pg_temp.line(pg_temp.bal('04')), pg_temp.line(pg_temp.bal('01')), 'waiting: the member reads the owner''s figures');
select is((select x ->> 'word' from jsonb_array_elements(pg_temp.bal() -> 'withdrawals') x
            where (x ->> 'id')::uuid = current_setting('tsc.r14_w')::uuid), 'waiting', 'the withdrawal''s word is waiting');

-- Staff start paying it.
select pg_temp.act_as('02'); set local role authenticated;
select lives_ok($$select public.claim_withdrawal(current_setting('tsc.r14_w')::uuid)$$, 'staff start paying the $1,000');
reset role;
select is((select status from public.factory_withdrawals where id = current_setting('tsc.r14_w')::uuid), 'paying', 'it is being paid');
select is(pg_temp.line(pg_temp.bal()),
  'awaiting 0, available 0, pending 131300, processing 100000, paid out 0, total 231300',
  'being paid: Pending $1,313, Processing $1,000, Total $2,313');
select is(pg_temp.line(pg_temp.bal('04')), pg_temp.line(pg_temp.bal('01')), 'being paid: the member reads the owner''s figures');

-- A disputed step: earnings not yet available, so Pending (not Processing).
set local session_replication_role = replica;
insert into public.order_milestones (id, order_id, kind, title, amount_cents, state, sort, completed_at) values
  ('d14e0003-0000-0000-0000-000000000001', 'd14d0000-0000-0000-0000-000000000001', 'approval_and_payment', 'R14 disputed', 20000, 'complete', 30, now() - interval '4 days');
insert into public.order_payments
  (id, order_id, milestone_id, amount_cents, currency, state, confirmed_at, release_requested_at,
   stripe_payment_intent_id, stripe_charge_id, funds_available_at, disputed_at) values
  ('d14f0003-0000-0000-0000-000000000001', 'd14d0000-0000-0000-0000-000000000001', 'd14e0003-0000-0000-0000-000000000001', 20000, 'USD', 'confirmed',
   now() - interval '30 days', now() - interval '4 days', 'pi_pgtap_r14_3', 'ch_pgtap_r14_3', now() - interval '20 days', now() - interval '1 day');
set local session_replication_role = origin;
select is(pg_temp.fig(pg_temp.bal(), 'pending_cents'), 151300::bigint, 'with a $200 disputed step: Pending is $1,313 clearing + $200 disputed');
select is(pg_temp.fig(pg_temp.bal(), 'processing_cents'), 100000::bigint, 'the disputed part is not Processing');
select is((pg_temp.bal() -> 'parts' ->> 'disputed_cents')::bigint, 20000::bigint, 'parts.disputed_cents names it');
select is(pg_temp.fig(pg_temp.bal(), 'total_cents'), pg_temp.sum_of(pg_temp.bal()), 'with a dispute, Total is still the five added up');
select is(pg_temp.fig(pg_temp.bal(), 'total_cents'), 251300::bigint, 'and is $2,513');
select is(pg_temp.line(pg_temp.bal('04')), pg_temp.line(pg_temp.bal('01')), 'with a dispute: the member reads the owner''s figures');

-- Paid (PayPal took a $0.40 fee): the withdrawal leaves Processing for Paid out.
select lives_ok(format($$select pg_temp.as_server(%L)$$,
  format('select public.record_withdrawal(%L, ''paid'', ''PP-R14'', 40, 99960, ''USD'', null)', current_setting('tsc.r14_w'))),
  'the $1,000 is paid');
select is(pg_temp.line(pg_temp.bal()),
  'awaiting 0, available 0, pending 151300, processing 0, paid out 99960, total 251260',
  'paid: Processing 0, Paid out $999.60 (less the fee), Pending unchanged');
select is(pg_temp.fig(pg_temp.bal(), 'total_cents'), pg_temp.sum_of(pg_temp.bal()), 'paid: Total is the five added up');

-- ===========================================================================
-- 2. Removing a withdrawal method (factory 2: A the default, B another,
--    $500 approved and cleared in its balance).
-- ===========================================================================
-- Removal attempted as the owner and always rolled back: 'removed' when it
-- went through, else "sqlstate | hint | message | detail".
create function pg_temp.try_remove(acct uuid) returns text language plpgsql as $f$
declare st text; msg text; h text; d text;
begin
  begin
    perform pg_temp.act_as('05');
    set local role authenticated;
    perform public.remove_payout_account(acct, null);
    reset role;
    raise exception 'removed' using errcode = 'ZZ014';
  exception when others then
    get stacked diagnostics st = returned_sqlstate, msg = message_text, h = pg_exception_hint, d = pg_exception_detail;
    reset role;
    if st = 'ZZ014' then return 'removed'; end if;
    return concat_ws(' | ', st, nullif(h, ''), msg, nullif(d, ''));
  end;
end;
$f$;
create function pg_temp.withdrawal_to(acct uuid, st text) returns void language plpgsql as $f$
begin
  set local session_replication_role = replica;
  delete from public.factory_withdrawals where org_id = 'd14b0000-0000-0000-0000-0000000000e2';
  insert into public.factory_withdrawals (org_id, account_id, provider, status, amount_cents, currency, paid_to, reason, paid_at)
  values ('d14b0000-0000-0000-0000-0000000000e2', acct, 'paypal', st, 1000, 'USD', 'pgtap-r14@example.com',
          case when st in ('declined', 'failed') then 'R14 reason' end,
          case when st = 'paid' then now() end);
  set local session_replication_role = origin;
end;
$f$;

select is(pg_temp.try_remove('d1490000-0000-0000-0000-000000000022'), 'removed',
  'B, with $500 approved in the balance and nothing in flight, can be removed');
select is(pg_temp.try_remove('d1490000-0000-0000-0000-000000000021'), 'removed',
  'A, the default, can be removed too (B becomes the default)');

select pg_temp.withdrawal_to('d1490000-0000-0000-0000-000000000022', 'requested');
select is(pg_temp.try_remove('d1490000-0000-0000-0000-000000000022'),
  'P0001 | payout_owed | TSC is about to pay this account, so it cannot be removed until that payment is sent | 1000 USD',
  'a withdrawal to B waiting for staff: B is refused (payout_owed, the message, the amount)');
select pg_temp.withdrawal_to('d1490000-0000-0000-0000-000000000022', 'paying');
select is(pg_temp.try_remove('d1490000-0000-0000-0000-000000000022'),
  'P0001 | payout_owed | TSC is about to pay this account, so it cannot be removed until that payment is sent | 1000 USD',
  'a withdrawal to B being paid: B is refused');
-- Money in flight to B keeps only B: A, the default, still goes (B is
-- chosen in its place).
select is(pg_temp.try_remove('d1490000-0000-0000-0000-000000000021'), 'removed',
  'a withdrawal to B does not keep A');
select pg_temp.withdrawal_to('d1490000-0000-0000-0000-000000000022', 'declined');
select is(pg_temp.try_remove('d1490000-0000-0000-0000-000000000022'), 'removed', 'once that withdrawal is declined, B can be removed');
select pg_temp.withdrawal_to('d1490000-0000-0000-0000-000000000022', 'failed');
select is(pg_temp.try_remove('d1490000-0000-0000-0000-000000000022'), 'removed', 'once it failed, B can be removed');
select pg_temp.withdrawal_to('d1490000-0000-0000-0000-000000000022', 'cancelled');
select is(pg_temp.try_remove('d1490000-0000-0000-0000-000000000022'), 'removed', 'once it is cancelled, B can be removed');
select pg_temp.withdrawal_to('d1490000-0000-0000-0000-000000000022', 'paid');
select is(pg_temp.try_remove('d1490000-0000-0000-0000-000000000022'), 'removed', 'once it is paid, B can be removed');

-- A per-step payout (the old road) to B under way.
set local session_replication_role = replica;
delete from public.factory_withdrawals where org_id = 'd14b0000-0000-0000-0000-0000000000e2';
insert into public.provider_payouts (id, payment_id, factory_org_id, account_id, provider, status, paid_to, amount_cents, currency) values
  ('d1480000-0000-0000-0000-000000000001', 'd14f0001-0000-0000-0000-000000000002', 'd14b0000-0000-0000-0000-0000000000e2',
   'd1490000-0000-0000-0000-000000000022', 'paypal', 'processing', 'pgtap-r14-b@example.com', 50000, 'USD');
set local session_replication_role = origin;
select is(pg_temp.try_remove('d1490000-0000-0000-0000-000000000022'),
  'P0001 | payout_owed | TSC is about to pay this account, so it cannot be removed until that payment is sent | 50000 USD',
  'a per-step PayPal payout to B processing: B is refused');
set local session_replication_role = replica;
update public.provider_payouts set status = 'failed', failure_code = 'other' where id = 'd1480000-0000-0000-0000-000000000001';
set local session_replication_role = origin;
select is(pg_temp.try_remove('d1490000-0000-0000-0000-000000000022'), 'removed', 'once that payout failed, B can be removed');
set local session_replication_role = replica;
update public.provider_payouts set status = 'paid', failure_code = null, paid_at = now() where id = 'd1480000-0000-0000-0000-000000000001';
set local session_replication_role = origin;
select is(pg_temp.try_remove('d1490000-0000-0000-0000-000000000022'), 'removed', 'once it was paid, B can be removed');

-- The legacy payout row goes (a step with one is not withdrawable), so the
-- $500 is in reach again for section 3.
set local session_replication_role = replica;
delete from public.provider_payouts where id = 'd1480000-0000-0000-0000-000000000001';
set local session_replication_role = origin;

-- Really removed now: B first; a withdrawal to it is then refused in words.
select pg_temp.act_as('05'); set local role authenticated;
select lives_ok($$select public.remove_payout_account('d1490000-0000-0000-0000-000000000022', null)$$, 'B is removed');

-- ===========================================================================
-- 3. A withdrawal to a removed account: the readable refusal.
-- ===========================================================================
select throws_ok($$select public.request_withdrawal('d14b0000-0000-0000-0000-0000000000e2', 50000, 'd1490000-0000-0000-0000-000000000022')$$,
  '22023', 'Choose one of your saved withdrawal methods.', 'a withdrawal to the removed account is refused in words');
select throws_ok($$select public.request_withdrawal('d14b0000-0000-0000-0000-0000000000e2', 50000, 'd1490000-0000-0000-0000-000000000011')$$,
  '22023', 'Choose one of your saved withdrawal methods.', 'and so is one to another company''s account');
reset role;
select is((select count(*)::int from public.factory_withdrawals where org_id = 'd14b0000-0000-0000-0000-0000000000e2'), 0, 'no withdrawal was recorded');

-- Then A, the last method, with $500 approved in the balance and nothing on its way.
select pg_temp.act_as('05'); set local role authenticated;
select lives_ok($$select public.remove_payout_account('d1490000-0000-0000-0000-000000000021', null)$$,
  'A, the last method, is removed with approved money in the balance and no withdrawal open');
reset role;
select is((select count(*)::int from public.factory_payout_accounts where org_id = 'd14b0000-0000-0000-0000-0000000000e2'), 0, 'factory 2 has no method left');
select ok((select state = 'confirmed' and release_requested_at is not null from public.order_payments where id = 'd14f0001-0000-0000-0000-000000000002'),
  'its $500 is still owed, in its balance');

-- ===========================================================================
-- 4. (A2) An approval step already approved before it is funded pays out on
--    funding, so its notice is titled as added to the balance too.
-- ===========================================================================
set local session_replication_role = replica;
insert into public.order_milestones (id, order_id, kind, title, amount_cents, state, sort) values
  ('d14e0002-0000-0000-0000-000000000002', 'd14d0000-0000-0000-0000-000000000002', 'approval_and_payment', 'R14 approved first', 7000, 'approved', 20);
insert into public.order_payments (id, order_id, milestone_id, amount_cents, currency, state, stripe_payment_intent_id) values
  ('d14f0002-0000-0000-0000-000000000002', 'd14d0000-0000-0000-0000-000000000002', 'd14e0002-0000-0000-0000-000000000002', 7000, 'USD', 'due', 'pi_pgtap_r14_r2');
set local session_replication_role = origin;
select lives_ok($$select pg_temp.as_server('select public.record_payment_funded(''d14f0002-0000-0000-0000-000000000002'', ''ch_pgtap_r14_r2'', ''card'', ''Visa'', 7000)')$$,
  'an approval step approved before funding is funded');
select is((select title from public.notifications where org_id = 'd14b0000-0000-0000-0000-0000000000e2' and subject_id = 'd14f0002-0000-0000-0000-000000000002'
            and kind = 'payment_confirmed'), '$70.00 added to your balance', 'its notice is titled "$70.00 added to your balance"');
select ok((select release_requested_at is not null from public.order_payments where id = 'd14f0002-0000-0000-0000-000000000002'),
  'and its money is in the balance (release asked for at funding)');

select * from finish();
rollback;
