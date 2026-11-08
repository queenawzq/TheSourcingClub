-- ============================================================================
-- A cancelled order's held money goes back to the brand (20261108300000)
-- ----------------------------------------------------------------------------
-- `pgtap81-` slugs and 8c…/8d…/8e…/8f… ids, every count scoped to these
-- fixtures: all suites share one database.
--
-- What this protects: only held money the brand has not released is refunded,
-- a refund is claimed once at a time, a refusal is recorded for staff and the
-- payment stays held, a refund is recorded once (the webhook follows our own),
-- the brand's row keeps its figure, both companies are told, and nobody signed
-- in can call any of it.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(25);

insert into auth.users (id, email, raw_user_meta_data) values
  ('8c000000-0000-0000-0000-000000000001', 'p81-brand@example.com',   '{"name":"Brand Owner"}'),
  ('8c000000-0000-0000-0000-000000000003', 'p81-factory@example.com', '{"name":"Factory Owner"}');

insert into public.orgs (id, type, name, slug) values
  ('8d000000-0000-0000-0000-00000000000b', 'brand',   'P81 Brand',   'pgtap81-brand'),
  ('8d000000-0000-0000-0000-0000000000f1', 'factory', 'P81 Factory', 'pgtap81-factory');

insert into public.org_members (org_id, user_id, role) values
  ('8d000000-0000-0000-0000-00000000000b', '8c000000-0000-0000-0000-000000000001', 'owner'),
  ('8d000000-0000-0000-0000-0000000000f1', '8c000000-0000-0000-0000-000000000003', 'owner');

insert into public.brand_profiles (org_id, hq_location) values
  ('8d000000-0000-0000-0000-00000000000b', 'London, UK');
insert into public.factory_profiles (org_id, country_code, moq, published_at, verification_status) values
  ('8d000000-0000-0000-0000-0000000000f1', 'PT', 100, now(), 'verified');

insert into public.rfqs (id, brand_org_id, title, brief, status, visibility, quantity_total) values
  ('8e000000-0000-0000-0000-000000000001', '8d000000-0000-0000-0000-00000000000b',
   'P81 shirts', 'One hundred linen shirts.', 'open', 'open_to_all', 100);

insert into public.quotes
  (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity,
   bulk_lead_time_days, deposit_pct, balance_pct, valid_until, submitted_at)
values
  ('8f000000-0000-0000-0000-0000000000f1', '8e000000-0000-0000-0000-000000000001',
   '8d000000-0000-0000-0000-0000000000f1', 'submitted', 2000, 100, 28, 30, 70,
   current_date + 30, now());

set local request.jwt.claims = '{"sub":"8c000000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select public.award_quote('8f000000-0000-0000-0000-0000000000f1');
reset role;

create temporary table p81 (name text primary key, id uuid);
insert into p81
select 'order', id from public.production_orders where quote_id = '8f000000-0000-0000-0000-0000000000f1';
grant select on p81 to public;

set local request.jwt.claims = '{"sub":"8c000000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select public.agree_schedule((select id from p81 where name = 'order'), 1);
reset role;

-- Two held payments, paid by card: one the brand has not released (refunded
-- on cancel), one it released to the factory (stays the factory's).
insert into p81
select 'held', id from public.order_payments
 where order_id = (select id from p81 where name = 'order') order by created_at, id limit 1;
insert into p81
select 'released', id from public.order_payments
 where order_id = (select id from p81 where name = 'order') and id <> (select id from p81 where name = 'held')
 order by created_at, id limit 1;

update public.order_payments
   set state = 'confirmed', confirmed_at = now(),
       stripe_payment_intent_id = 'pi_p81_held', stripe_charge_id = 'ch_p81_held', charged_cents = 64200
 where id = (select id from p81 where name = 'held');
update public.order_payments
   set state = 'confirmed', confirmed_at = now(), release_requested_at = now(),
       stripe_payment_intent_id = 'pi_p81_rel', stripe_charge_id = 'ch_p81_rel', charged_cents = 149800
 where id = (select id from p81 where name = 'released');

create function pg_temp.p81_notes(org uuid) returns bigint
language sql as $$
  select count(*) from public.notifications
   where org_id = org and kind = 'payment_refunded'
     and order_id = (select id from p81 where name = 'order')
$$;
grant execute on function pg_temp.p81_notes(uuid) to public;

-- ---------------------------------------------------------------------------
-- Nothing is refunded on an order that is still running
-- ---------------------------------------------------------------------------
select is(
  (select count(*) from public.cancellation_refunds_due((select id from p81 where name = 'order'))),
  0::bigint,
  'an active order has nothing to refund'
);
select is(
  public.claim_cancellation_refund((select id from p81 where name = 'held')) ->> 'refused',
  'not_refundable',
  'held money on an active order cannot be claimed for a refund'
);

-- Both sides agree to cancel.
set local request.jwt.claims = '{"sub":"8c000000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select public.propose_cancellation((select id from p81 where name = 'order'), 'Season dropped');
reset role;
set local request.jwt.claims = '{"sub":"8c000000-0000-0000-0000-000000000003","role":"authenticated"}';
set local role authenticated;
select public.accept_cancellation((select id from p81 where name = 'order'));
reset role;

-- ---------------------------------------------------------------------------
-- What is due, and the claim
-- ---------------------------------------------------------------------------
select results_eq(
  $$select * from public.cancellation_refunds_due((select id from p81 where name = 'order'))$$,
  $$select id from p81 where name = 'held'$$,
  'only the held payment the brand did not release is due a refund'
);

select is(
  public.claim_cancellation_refund((select id from p81 where name = 'held')) ->> 'intent',
  'pi_p81_held',
  'the claim names the PaymentIntent to refund'
);
select ok(
  (select refund_claimed_at is not null from public.order_payments where id = (select id from p81 where name = 'held')),
  'the claim is recorded on the payment'
);
select is(
  public.claim_cancellation_refund((select id from p81 where name = 'held')) ->> 'refused',
  'claimed',
  'a second claim while the first is running is refused'
);
select is(
  (select count(*) from public.cancellation_refunds_due((select id from p81 where name = 'order'))),
  0::bigint,
  'a claimed payment is not due again while its lease runs'
);
select is(
  public.claim_cancellation_refund((select id from p81 where name = 'released')) ->> 'refused',
  'not_refundable',
  'money the brand released to the factory is never refunded'
);

-- ---------------------------------------------------------------------------
-- Stripe refuses: recorded for staff, still held, due again
-- ---------------------------------------------------------------------------
select is(
  (public.record_cancellation_refund_failed((select id from p81 where name = 'held'), 'Stripe refused the refund.')).state::text,
  'confirmed',
  'a refused refund leaves the money held'
);
select ok(
  (select refund_failed_at is not null and refund_failure = 'Stripe refused the refund.' and refund_claimed_at is null
     from public.order_payments where id = (select id from p81 where name = 'held')),
  'the refusal and its reason are recorded, and the claim is let go'
);
select is(
  (select count(*) from public.cancellation_refunds_due((select id from p81 where name = 'order'))),
  0::bigint,
  'a refused refund waits for staff, not the daily job (it would leave their list every day)'
);
insert into p81 (name, id)
select 'reclaim:' || (public.claim_cancellation_refund((select id from p81 where name = 'held')) ->> 'key'), null;
select ok(
  (select name from p81 where name like 'reclaim:%')
    = 'reclaim:' || format('cancel-refund-%s-%s', (select id from p81 where name = 'held'),
             (select extract(epoch from refund_claimed_at)::bigint from public.order_payments
               where id = (select id from p81 where name = 'held'))),
  'the next claim''s key carries its own claim time, so Stripe never replays the refusal'
);

-- ---------------------------------------------------------------------------
-- Stripe refunds: recorded once, figure kept, both told
-- ---------------------------------------------------------------------------
select is(
  (public.record_payment_refunded((select id from p81 where name = 'held'), 'pi_p81_held', 'The order was cancelled. You were refunded.')).state::text,
  'cancelled',
  'a refunded payment on a cancelled order is cancelled'
);
select ok(
  (select refunded_at is not null and charged_cents = 64200 and stripe_payment_intent_id = 'pi_p81_held'
          and refund_failed_at is null and refund_failure is null and refund_claimed_at is null
     from public.order_payments where id = (select id from p81 where name = 'held')),
  'it keeps what was charged and its intent, and the failure is cleared'
);
select is(pg_temp.p81_notes('8d000000-0000-0000-0000-00000000000b'), 1::bigint, 'the brand is told it was refunded');
select is(pg_temp.p81_notes('8d000000-0000-0000-0000-0000000000f1'), 1::bigint, 'the factory is told the money went back');
select is(
  (select title from public.notifications
    where org_id = '8d000000-0000-0000-0000-0000000000f1' and kind = 'payment_refunded'
      and order_id = (select id from p81 where name = 'order')),
  (select format('The payment for "%s" went back to the brand', m.title)
     from public.order_payments p join public.order_milestones m on m.id = p.milestone_id
    where p.id = (select id from p81 where name = 'held')),
  'the factory reads which step''s money went back'
);

-- The webhook's charge.refunded after our own refund.
select lives_ok(
  $$select public.record_payment_refunded((select id from p81 where name = 'held'), 'pi_p81_held', 'The payment was refunded.')$$,
  'recording the same refund again is accepted'
);
select is(pg_temp.p81_notes('8d000000-0000-0000-0000-00000000000b'), 1::bigint, 'and tells the brand nothing twice');
select is(
  (select count(*) from public.cancellation_refunds_due((select id from p81 where name = 'order'))),
  0::bigint,
  'nothing is left to refund'
);

set local request.jwt.claims = '{"sub":"8c000000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select is(
  (select count(*) from public.order_activity((select id from p81 where name = 'order')) where kind = 'payment_refunded'),
  1::bigint,
  'the order''s activity shows the refund once'
);
reset role;

-- ---------------------------------------------------------------------------
-- Held without a Stripe charge (an old bank wire): for staff, not Stripe
-- ---------------------------------------------------------------------------
update public.order_payments
   set release_requested_at = null, stripe_payment_intent_id = null, stripe_charge_id = null
 where id = (select id from p81 where name = 'released');
select is(
  public.claim_cancellation_refund((select id from p81 where name = 'released')) ->> 'refused',
  'no_stripe_charge',
  'held money with no Stripe charge is not sent to Stripe'
);
select ok(
  (select refund_failed_at is not null and refund_failure like 'Held with no Stripe charge%'
     from public.order_payments where id = (select id from p81 where name = 'released')),
  'and is recorded as failed, so staff see it'
);

-- ---------------------------------------------------------------------------
-- Grants: the server only
-- ---------------------------------------------------------------------------
select ok(
  not has_function_privilege('authenticated', 'public.claim_cancellation_refund(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.record_cancellation_refund_failed(uuid, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.cancellation_refunds_due(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.claim_cancellation_refund(uuid)', 'execute'),
  'nobody signed in (or out) can claim, fail or list refunds'
);
select ok(
  has_function_privilege('service_role', 'public.claim_cancellation_refund(uuid)', 'execute')
  and has_function_privilege('service_role', 'public.record_cancellation_refund_failed(uuid, text)', 'execute')
  and has_function_privilege('service_role', 'public.cancellation_refunds_due(uuid)', 'execute'),
  'the server can'
);

select * from finish();
rollback;
