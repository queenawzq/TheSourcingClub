-- ============================================================================
-- Why a payout failed reaches the factory; a Stripe transfer is "added to your
-- balance" (20261116500000). `pgtap-e5-` slugs, e5… ids.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;

select plan(17);

set local session_replication_role = replica;

insert into auth.users (id, email) values
  ('e5a00000-0000-0000-0000-000000000001', 'pe5-factory@example.com'),
  ('e5a00000-0000-0000-0000-000000000003', 'pe5-brand@example.com'),
  ('e5a00000-0000-0000-0000-000000000004', 'pe5-other-factory@example.com');

insert into public.orgs (id, type, name, slug) values
  ('e5b00000-0000-0000-0000-00000000000b', 'brand',   'PE5 Brand', 'pgtap-e5-brand'),
  ('e5b00000-0000-0000-0000-0000000000f1', 'factory', 'PE5 Mill',  'pgtap-e5-mill'),
  ('e5b00000-0000-0000-0000-0000000000f2', 'factory', 'PE5 Other', 'pgtap-e5-other');

insert into public.org_members (org_id, user_id, role, permissions) values
  ('e5b00000-0000-0000-0000-0000000000f1', 'e5a00000-0000-0000-0000-000000000001', 'owner', '{}'),
  ('e5b00000-0000-0000-0000-00000000000b', 'e5a00000-0000-0000-0000-000000000003', 'owner', '{}'),
  ('e5b00000-0000-0000-0000-0000000000f2', 'e5a00000-0000-0000-0000-000000000004', 'owner', '{}');

insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total)
values ('e5c00000-0000-0000-0000-000000000001', 'e5b00000-0000-0000-0000-00000000000b', 'PE5 request', 'awarded', 'invited_only', 100);
insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity, submitted_at)
values ('e5c00000-0000-0000-0000-000000000002', 'e5c00000-0000-0000-0000-000000000001', 'e5b00000-0000-0000-0000-0000000000f1', 'accepted', 100, 1, now());
insert into public.production_orders
  (id, rfq_id, quote_id, brand_org_id, factory_org_id, unit_price_cents,
   production_quantity, bulk_subtotal_cents, sample_subtotal_cents, order_total_cents, deposit_pct, balance_pct, order_number)
values ('e5d00000-0000-0000-0000-000000000001', 'e5c00000-0000-0000-0000-000000000001', 'e5c00000-0000-0000-0000-000000000002',
        'e5b00000-0000-0000-0000-00000000000b', 'e5b00000-0000-0000-0000-0000000000f1', 1000, 1, 1000, 0, 1000, 50, 50, 'PE5-1');
insert into public.order_milestones (id, order_id, kind, title, amount_cents)
select ('e5e00000-0000-0000-0000-00000000000' || n)::uuid, 'e5d00000-0000-0000-0000-000000000001', 'payment_only', 'PE5 step ' || n, 25000
  from generate_series(1, 5) n;
insert into public.order_payments (id, order_id, milestone_id, amount_cents, currency, state, confirmed_at, release_requested_at)
select ('e5f00000-0000-0000-0000-00000000000' || n)::uuid, 'e5d00000-0000-0000-0000-000000000001',
       ('e5e00000-0000-0000-0000-00000000000' || n)::uuid, 25000, 'USD', 'confirmed', now(), now()
  from generate_series(1, 5) n;

-- 1: a Wise transfer that left; 2: PayPal, an unknown code; 3: never left TSC;
-- 4: staff asked the factory to check a detail (that bell already said so).
insert into public.provider_payouts (id, payment_id, factory_org_id, provider, status, paid_to, amount_cents, currency, money_left_at, asked_to_check)
values
  ('e5900000-0000-0000-0000-000000000001', 'e5f00000-0000-0000-0000-000000000001', 'e5b00000-0000-0000-0000-0000000000f1', 'wise', 'processing', 'Demo Bank ending 1234', 25000, 'USD', now(), null),
  ('e5900000-0000-0000-0000-000000000002', 'e5f00000-0000-0000-0000-000000000002', 'e5b00000-0000-0000-0000-0000000000f1', 'paypal', 'processing', 'pe5@example.com', 25000, 'USD', now(), null),
  ('e5900000-0000-0000-0000-000000000003', 'e5f00000-0000-0000-0000-000000000003', 'e5b00000-0000-0000-0000-0000000000f1', 'wise', 'processing', 'Demo Bank ending 1234', 25000, 'USD', null, null),
  ('e5900000-0000-0000-0000-000000000004', 'e5f00000-0000-0000-0000-000000000004', 'e5b00000-0000-0000-0000-0000000000f1', 'wise', 'processing', 'Demo Bank ending 1234', 25000, 'USD', now(), null);
insert into public.provider_payout_attempts (payout_id, stage)
select ('e5900000-0000-0000-0000-00000000000' || n)::uuid, 'sent' from generate_series(1, 4) n;

set local session_replication_role = origin;

create function pg_temp.bells(pattern text) returns int language sql as $f$
  select count(*)::int from public.notifications
   where org_id = 'e5b00000-0000-0000-0000-0000000000f1' and body like pattern;
$f$;

-- --- A known code: the row keeps it, and the bell says why --------------------
select lives_ok($$ select public.finish_provider_payout('e5900000-0000-0000-0000-000000000001', 'failed', 'other', 'bounced_back', 'returned') $$, 'Wise says the bank returned it');
select is((select failure_detail from public.provider_payouts where id = 'e5900000-0000-0000-0000-000000000001'), 'bounced_back', 'the row keeps the code');
select is(pg_temp.bells('Your payment of $250.00 did not go through. Your bank returned the payment. Check your bank details: TSC pays again once they are right.'), 1, 'the bell says why, in the factory''s words');
select is((select title from public.notifications where org_id = 'e5b00000-0000-0000-0000-0000000000f1' and body like 'Your payment of $250.00 did not go through. Your bank%'), 'A payment to you did not go through', 'under a plain title');

-- Said once: the attempt touched again changes nothing.
update public.provider_payout_attempts set updated_at = now() where payout_id = 'e5900000-0000-0000-0000-000000000001';
select is(pg_temp.bells('Your payment of $250.00 did not go through. Your bank%'), 1, 'said once');

-- --- An unknown code: the plain sentence -------------------------------------
select lives_ok($$ select public.finish_provider_payout('e5900000-0000-0000-0000-000000000002', 'failed', 'other', 'SOMETHING_NEW', 'odd') $$, 'PayPal says something new');
select is(pg_temp.bells('%The payment did not go through. Check your payout details or contact TSC operations.'), 1, 'an unknown code gets the plain sentence');

-- --- Money that never left: staff's business, no bell --------------------------
select lives_ok($$ select public.finish_provider_payout('e5900000-0000-0000-0000-000000000003', 'failed', 'other', 'refused', 'refused before sending') $$, 'refused before any money moved');
select is((select failure_detail from public.provider_payouts where id = 'e5900000-0000-0000-0000-000000000003'), 'refused', 'the row still keeps the code');
select is((select count(*)::int from public.notifications where org_id = 'e5b00000-0000-0000-0000-0000000000f1' and kind = 'payout_method_changed'), 2, 'and the factory is not told about money that never left');

-- --- Already asked to check a detail: that bell is the one -------------------
select lives_ok($$ select public.finish_provider_payout('e5900000-0000-0000-0000-000000000004', 'failed', 'details_rejected', 'bounced_back', 'returned', null, null, 'Check your bank details') $$, 'staff asked for a correction');
select is((select count(*)::int from public.notifications where org_id = 'e5b00000-0000-0000-0000-0000000000f1' and kind = 'payout_method_changed'), 3, 'one bell for it, the existing one');

-- --- A Stripe transfer is in the factory's balance, not its bank --------------
select lives_ok($$ select public.record_payment_released('e5f00000-0000-0000-0000-000000000005', 'tr_pe5') $$, 'the transfer reaches the Stripe balance');
select is((select title from public.notifications where org_id = 'e5b00000-0000-0000-0000-0000000000f1' and kind = 'funds_released'), '$250.00 added to your balance', 'and the bell says so');

-- --- Who reads it ---------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', 'e5a00000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select failure_detail from public.provider_payouts where id = 'e5900000-0000-0000-0000-000000000001'), 'bounced_back', 'the factory reads its own code');
select throws_ok($$ update public.provider_payouts set failure_detail = 'paid' where id = 'e5900000-0000-0000-0000-000000000001' $$, '42501', null, 'and cannot write it');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', 'e5a00000-0000-0000-0000-000000000004', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from public.provider_payouts where factory_org_id = 'e5b00000-0000-0000-0000-0000000000f1'), 0, 'another factory reads none of it');
reset role;

select * from finish();
rollback;
