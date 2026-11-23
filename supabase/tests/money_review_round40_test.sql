-- One balance, fix round 40 (20261121388000), final tester F4.
--
-- A $500 paid step held until approval, its card charge disputed before the
-- payment is recorded as funded: the factory is told the money is on hold,
-- never "it is added to your balance when the brand approves it". Approving
-- it says the hold again (once); winning the dispute before approval lifts
-- it in words. A second step, funded first and disputed before approval, is
-- not told until approval (round 5's rule), so its win says nothing.
--
-- Fixtures: slugs pgtap-r40-*, ids b40?xxxx-...; every count is scoped to them.
begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

set local session_replication_role = replica;

insert into auth.users (id, email)
select ('b40a0000-0000-0000-0000-0000000000' || k)::uuid, 'pgtap-r40-' || k || '@example.com'
  from unnest(array['01','03']) k;
insert into public.orgs (id, type, name, slug) values
  ('b40b0000-0000-0000-0000-00000000000b', 'brand', 'R40 Brand', 'pgtap-r40-brand'),
  ('b40b0000-0000-0000-0000-0000000000e1', 'factory', 'R40 Factory 1', 'pgtap-r40-f1');
insert into public.org_members (org_id, user_id, role, permissions) values
  ('b40b0000-0000-0000-0000-00000000000b', 'b40a0000-0000-0000-0000-000000000003', 'owner', '{}'),
  ('b40b0000-0000-0000-0000-0000000000e1', 'b40a0000-0000-0000-0000-000000000001', 'owner', '{}');
insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total)
values ('b40c0000-0000-0000-0000-000000000001', 'b40b0000-0000-0000-0000-00000000000b', 'R40 request', 'awarded', 'invited_only', 100);
insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity, submitted_at)
values ('b40c1000-0000-0000-0000-000000000001', 'b40c0000-0000-0000-0000-000000000001', 'b40b0000-0000-0000-0000-0000000000e1', 'accepted', 100, 1, now());
insert into public.production_orders
  (id, rfq_id, quote_id, brand_org_id, factory_org_id, unit_price_cents, status, schedule_brand_agreed_at, schedule_brand_agreed_by,
   production_quantity, bulk_subtotal_cents, sample_subtotal_cents, order_total_cents, deposit_pct, balance_pct, order_number)
values ('b40d0000-0000-0000-0000-000000000001', 'b40c0000-0000-0000-0000-000000000001', 'b40c1000-0000-0000-0000-000000000001',
        'b40b0000-0000-0000-0000-00000000000b', 'b40b0000-0000-0000-0000-0000000000e1', 100000, 'active', now() - interval '60 days',
        'b40a0000-0000-0000-0000-000000000003', 1, 100000, 0, 100000, 50, 50, 'R40-1');
insert into public.order_milestones (id, order_id, kind, title, amount_cents, state, sort) values
  ('b40e0011-0000-0000-0000-000000000000', 'b40d0000-0000-0000-0000-000000000001', 'approval_and_payment', 'R40 fit sample', 50000, 'active', 10),
  ('b40e0012-0000-0000-0000-000000000000', 'b40d0000-0000-0000-0000-000000000001', 'approval_and_payment', 'R40 lab dip', 30000, 'active', 20);
insert into public.order_payments
  (id, order_id, milestone_id, amount_cents, charged_cents, currency, state, stripe_payment_intent_id, disputed_at)
values
  -- Disputed before it is recorded as funded.
  ('b40f0011-0000-0000-0000-000000000000', 'b40d0000-0000-0000-0000-000000000001', 'b40e0011-0000-0000-0000-000000000000',
   50000, 53500, 'USD', 'due', 'pi_pgtap_r40_11', now()),
  -- Funded first, disputed afterwards.
  ('b40f0012-0000-0000-0000-000000000000', 'b40d0000-0000-0000-0000-000000000001', 'b40e0012-0000-0000-0000-000000000000',
   30000, 32100, 'USD', 'due', 'pi_pgtap_r40_12', null);
set local session_replication_role = origin;

create function pg_temp.as_server(sql text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  set local role service_role;
  execute sql;
  reset role;
end;
$f$;
create function pg_temp.told(payment uuid) returns text language sql as $f$
  select coalesce(string_agg(title || ': ' || body, ' || ' order by created_at, starts_with(body, 'The dispute is settled.'), id), '') from public.notifications
   where org_id = 'b40b0000-0000-0000-0000-0000000000e1' and subject_type = 'payment' and subject_id = payment;
$f$;

-- Disputed at funding.
select lives_ok($$select pg_temp.as_server('select public.record_payment_funded(''b40f0011-0000-0000-0000-000000000000'', ''ch_pgtap_r40_11'', ''card'', ''Visa ending in 0259'', 53500)')$$,
  'the disputed charge is recorded as funded');
select is(pg_temp.told('b40f0011-0000-0000-0000-000000000000'),
  'Payment for "R40 fit sample" on hold: The brand disputed the charge. $500.00 is held until the dispute is settled.',
  'the factory is told it is on hold, and nothing says it is added on approval');

-- Approval says the hold again, once.
update public.order_payments set release_requested_at = now() where id = 'b40f0011-0000-0000-0000-000000000000';
select lives_ok($$select public.tell_payment_hold(p, true) from public.order_payments p where p.id = 'b40f0011-0000-0000-0000-000000000000'$$, 'approving tells the hold');
select lives_ok($$select public.tell_payment_hold(p, true) from public.order_payments p where p.id = 'b40f0011-0000-0000-0000-000000000000'$$, 'twice');
select is((select count(*)::int from public.notifications where subject_id = 'b40f0011-0000-0000-0000-000000000000' and kind = 'payment_disputed'),
  2, 'once at funding, once on approval');

-- Won before approval: the hold told at funding is lifted in words.
update public.order_payments set release_requested_at = null where id = 'b40f0011-0000-0000-0000-000000000000';
delete from public.notifications where subject_id = 'b40f0011-0000-0000-0000-000000000000' and kind = 'payment_disputed'
   and (data ->> 'approved')::boolean;
select lives_ok($$select pg_temp.as_server('select public.record_payment_disputed(''b40f0011-0000-0000-0000-000000000000'', false)')$$, 'won before approval');
select is(pg_temp.told('b40f0011-0000-0000-0000-000000000000'),
  'Payment for "R40 fit sample" on hold: The brand disputed the charge. $500.00 is held until the dispute is settled.'
  || ' || Hold lifted on "R40 fit sample": The dispute is settled. $500.00 is no longer on hold.',
  'the hold is told when it starts and when it ends');

-- Funded first: the usual notice; a dispute before approval is not told
-- (round 5), so neither is its win.
select lives_ok($$select pg_temp.as_server('select public.record_payment_funded(''b40f0012-0000-0000-0000-000000000000'', ''ch_pgtap_r40_12'', ''card'', ''Visa ending in 0077'', 32100)')$$,
  'an undisputed charge is recorded as funded');
select is(pg_temp.told('b40f0012-0000-0000-0000-000000000000'),
  'Payment held for "R40 lab dip": R40 Brand funded $300.00 for R40 lab dip on R40 request. It will become available when R40 Brand approves this step.',
  'the usual notice');
select lives_ok($$select pg_temp.as_server('select public.record_payment_disputed(''b40f0012-0000-0000-0000-000000000000'', true)')$$, 'disputed before approval');
select lives_ok($$select pg_temp.as_server('select public.record_payment_disputed(''b40f0012-0000-0000-0000-000000000000'', false)')$$, 'and won');
select is((select count(*)::int from public.notifications where subject_id = 'b40f0012-0000-0000-0000-000000000000' and kind = 'payment_disputed'),
  0, 'neither told: no hold was told, so no lift');

-- Grants unchanged.
select ok(has_function_privilege('service_role', 'public.record_payment_funded(uuid, text, text, text, bigint)', 'execute')
  and not has_function_privilege('authenticated', 'public.record_payment_funded(uuid, text, text, text, bigint)', 'execute')
  and not has_function_privilege('anon', 'public.record_payment_funded(uuid, text, text, text, bigint)', 'execute')
  and not has_function_privilege('authenticated', 'public.tell_payment_hold(public.order_payments, boolean)', 'execute'),
  'server only');

select * from finish();
rollback;
