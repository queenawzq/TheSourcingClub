-- ============================================================================
-- Cancelling an order — propose, withdraw, keep the order, accept (035, 070)
-- ----------------------------------------------------------------------------
-- Run with:  supabase test db
--
-- `pgtap14-` slugs and ce…/de…/ee…/fe… ids, every count scoped to these
-- fixtures, as in every other suite: they all share one database.
--
-- What this protects: only the side that proposed a cancellation can take it
-- back, only the other side can keep the order or accept, nobody outside the
-- order can do any of it, and each step tells the other company. And what
-- accepting does to steps and payments, which the screens now describe.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(33);

-- ---------------------------------------------------------------------------
-- Fixtures: a brand with an owner and a member, the factory, a stranger, and
-- one order the brand awarded (waiting on its steps).
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, raw_user_meta_data) values
  ('ce000000-0000-0000-0000-000000000001', 'p14-brandowner@example.com', '{"name":"Brand Owner"}'),
  ('ce000000-0000-0000-0000-000000000002', 'p14-teammate@example.com',   '{"name":"Teammate"}'),
  ('ce000000-0000-0000-0000-000000000003', 'p14-factory@example.com',    '{"name":"Factory Owner"}'),
  ('ce000000-0000-0000-0000-000000000004', 'p14-outsider@example.com',   '{"name":"Outsider"}');

insert into public.orgs (id, type, name, slug) values
  ('de000000-0000-0000-0000-00000000000b', 'brand',   'P14 Brand',    'pgtap14-brand'),
  ('de000000-0000-0000-0000-0000000000f1', 'factory', 'P14 Factory',  'pgtap14-factory'),
  ('de000000-0000-0000-0000-00000000000c', 'brand',   'P14 Outsider', 'pgtap14-outsider');

insert into public.org_members (org_id, user_id, role) values
  ('de000000-0000-0000-0000-00000000000b', 'ce000000-0000-0000-0000-000000000001', 'owner'),
  ('de000000-0000-0000-0000-00000000000b', 'ce000000-0000-0000-0000-000000000002', 'member'),
  ('de000000-0000-0000-0000-0000000000f1', 'ce000000-0000-0000-0000-000000000003', 'owner'),
  ('de000000-0000-0000-0000-00000000000c', 'ce000000-0000-0000-0000-000000000004', 'owner');

insert into public.brand_profiles (org_id, hq_location) values
  ('de000000-0000-0000-0000-00000000000b', 'London, UK'),
  ('de000000-0000-0000-0000-00000000000c', 'Berlin, DE');

insert into public.factory_profiles (org_id, country_code, moq, published_at, verification_status) values
  ('de000000-0000-0000-0000-0000000000f1', 'PT', 100, now(), 'verified');

insert into public.rfqs (id, brand_org_id, title, brief, status, visibility, quantity_total) values
  ('ee000000-0000-0000-0000-000000000001', 'de000000-0000-0000-0000-00000000000b',
   'P14 shirts', 'One hundred linen shirts.', 'open', 'open_to_all', 100);

insert into public.quotes
  (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity,
   bulk_lead_time_days, deposit_pct, balance_pct, valid_until, submitted_at)
values
  ('fe000000-0000-0000-0000-0000000000f1', 'ee000000-0000-0000-0000-000000000001',
   'de000000-0000-0000-0000-0000000000f1', 'submitted', 2000, 100, 28, 30, 70,
   current_date + 30, now());

set local request.jwt.claims = '{"sub":"ce000000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select public.award_quote('fe000000-0000-0000-0000-0000000000f1');
reset role;

create temporary table p14 (name text primary key, id uuid);
insert into p14
select 'order', id from public.production_orders where quote_id = 'fe000000-0000-0000-0000-0000000000f1';
grant select on p14 to public;

-- How many notifications of one kind a company has about this order.
create function pg_temp.p14_notes(org uuid, note_kind text) returns bigint
language sql as $$
  select count(*) from public.notifications
   where org_id = org and kind = note_kind
     and order_id = (select id from p14 where name = 'order')
$$;

select is(
  (select status::text from public.production_orders where id = (select id from p14 where name = 'order')),
  'pending_schedule',
  'fixture: the order is waiting on its steps'
);

-- ---------------------------------------------------------------------------
-- Nothing to withdraw or decline yet
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"ce000000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$select public.withdraw_cancellation((select id from p14 where name = 'order'))$$,
  '22023', 'nobody has proposed cancelling this order',
  'withdrawing with no proposal open is refused'
);
reset role;

set local request.jwt.claims = '{"sub":"ce000000-0000-0000-0000-000000000003","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$select public.decline_cancellation((select id from p14 where name = 'order'))$$,
  '22023', 'nobody has proposed cancelling this order',
  'keeping the order with no proposal open is refused'
);
reset role;

-- ---------------------------------------------------------------------------
-- The brand proposes, then withdraws
-- ---------------------------------------------------------------------------

-- A member, not only an owner, may propose: the rule 035 has always had.
set local request.jwt.claims = '{"sub":"ce000000-0000-0000-0000-000000000002","role":"authenticated"}';
set local role authenticated;
select lives_ok(
  $$select public.propose_cancellation((select id from p14 where name = 'order'), 'Season dropped')$$,
  'a brand member proposes cancelling'
);
reset role;

select is(pg_temp.p14_notes('de000000-0000-0000-0000-0000000000f1', 'cancellation_proposed'), 1::bigint,
  'the factory is told of the proposal');

set local request.jwt.claims = '{"sub":"ce000000-0000-0000-0000-000000000003","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$select public.withdraw_cancellation((select id from p14 where name = 'order'))$$,
  '42501', NULL,
  'the factory cannot withdraw the brand''s proposal'
);
reset role;

set local request.jwt.claims = '{"sub":"ce000000-0000-0000-0000-000000000004","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$select public.withdraw_cancellation((select id from p14 where name = 'order'))$$,
  '42501', 'only a party to this order may withdraw a cancellation',
  'a stranger cannot withdraw it'
);
select throws_ok(
  $$select public.decline_cancellation((select id from p14 where name = 'order'))$$,
  '42501', 'only a party to this order may decline a cancellation',
  'a stranger cannot keep the order'
);
reset role;

set local request.jwt.claims = '{"sub":"ce000000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$select public.decline_cancellation((select id from p14 where name = 'order'))$$,
  '42501', NULL,
  'the brand cannot "keep the order" against its own proposal'
);
-- Another member of the proposing company may withdraw it: it is the
-- company's proposal, not the person's.
select lives_ok(
  $$select public.withdraw_cancellation((select id from p14 where name = 'order'))$$,
  'the brand owner withdraws the proposal its teammate made'
);
reset role;

select ok(
  (select cancel_proposed_by_org is null and cancel_proposed_at is null and cancel_reason is null
     from public.production_orders where id = (select id from p14 where name = 'order')),
  'withdrawing clears the proposal'
);
select is(
  (select status::text from public.production_orders where id = (select id from p14 where name = 'order')),
  'pending_schedule',
  'and the order carries on as it was'
);
select is(pg_temp.p14_notes('de000000-0000-0000-0000-0000000000f1', 'cancellation_withdrawn'), 1::bigint,
  'the factory is told it was withdrawn');
select ok(
  (select body like 'P14 Brand withdrew%' from public.notifications
    where org_id = 'de000000-0000-0000-0000-0000000000f1' and kind = 'cancellation_withdrawn'
      and order_id = (select id from p14 where name = 'order')),
  'and by whom'
);
select is(pg_temp.p14_notes('de000000-0000-0000-0000-00000000000b', 'cancellation_withdrawn'), 0::bigint,
  'the brand is not told of its own withdrawal');

-- ---------------------------------------------------------------------------
-- The factory proposes; the brand keeps the order
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"ce000000-0000-0000-0000-000000000003","role":"authenticated"}';
set local role authenticated;
select lives_ok(
  $$select public.propose_cancellation((select id from p14 where name = 'order'), 'Fabric unavailable')$$,
  'the factory proposes cancelling'
);
select throws_ok(
  $$select public.decline_cancellation((select id from p14 where name = 'order'))$$,
  '42501', NULL,
  'the factory cannot turn down its own proposal; it withdraws it instead'
);
reset role;

set local request.jwt.claims = '{"sub":"ce000000-0000-0000-0000-000000000002","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$select public.withdraw_cancellation((select id from p14 where name = 'order'))$$,
  '42501', NULL,
  'the brand cannot withdraw the factory''s proposal'
);
select lives_ok(
  $$select public.decline_cancellation((select id from p14 where name = 'order'))$$,
  'a brand member keeps the order'
);
reset role;

select ok(
  (select cancel_proposed_by_org is null and cancel_reason is null
     from public.production_orders where id = (select id from p14 where name = 'order')),
  'keeping the order clears the proposal'
);
select is(pg_temp.p14_notes('de000000-0000-0000-0000-0000000000f1', 'cancellation_declined'), 1::bigint,
  'the factory is told the brand kept the order');
select ok(
  (select title like '%P14 Brand wants to keep the order' and body = 'Fabric unavailable'
     from public.notifications
    where org_id = 'de000000-0000-0000-0000-0000000000f1' and kind = 'cancellation_declined'
      and order_id = (select id from p14 where name = 'order')),
  'with who kept it, and its own reason read back'
);

-- ---------------------------------------------------------------------------
-- Accepting: what happens to steps and payments (035, unchanged)
-- ---------------------------------------------------------------------------

-- The brand confirms the steps, which starts the order and opens its
-- payments. Then two of them in the states that matter, set directly: one the
-- brand marked sent, one TSC confirmed.
set local request.jwt.claims = '{"sub":"ce000000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select public.agree_schedule((select id from p14 where name = 'order'), 1);
reset role;

update public.order_payments
   set state = 'sent', sent_at = now(), sent_by = 'ce000000-0000-0000-0000-000000000001'
 where id = (select id from public.order_payments
              where order_id = (select id from p14 where name = 'order')
              order by created_at, id limit 1);
update public.order_payments
   set state = 'confirmed', sent_at = now(), sent_by = 'ce000000-0000-0000-0000-000000000001',
       confirmed_at = now(), confirmed_by = 'ce000000-0000-0000-0000-000000000001'
 where id = (select id from public.order_payments
              where order_id = (select id from p14 where name = 'order') and state <> 'sent'
              order by created_at, id limit 1);

select is(
  (select string_agg(state::text, ',' order by state::text) from public.order_payments
    where order_id = (select id from p14 where name = 'order') and state in ('sent', 'confirmed')),
  'confirmed,sent',
  'fixture: the order is running, with one payment confirmed and one marked sent'
);

set local request.jwt.claims = '{"sub":"ce000000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select lives_ok(
  $$select public.propose_cancellation((select id from p14 where name = 'order'), 'Season dropped, again')$$,
  'the brand proposes again'
);
reset role;

set local request.jwt.claims = '{"sub":"ce000000-0000-0000-0000-000000000003","role":"authenticated"}';
set local role authenticated;
select lives_ok(
  $$select public.accept_cancellation((select id from p14 where name = 'order'))$$,
  'the factory accepts'
);
reset role;

select is(
  (select status::text from public.production_orders where id = (select id from p14 where name = 'order')),
  'cancelled',
  'accepting cancels the order'
);
select is(
  (select count(*) from public.order_milestones
    where order_id = (select id from p14 where name = 'order') and state not in ('complete', 'cancelled')),
  0::bigint,
  'every step not done is cancelled'
);
select is(
  (select count(*) from public.order_payments
    where order_id = (select id from p14 where name = 'order') and state in ('not_due', 'due', 'sent')),
  0::bigint,
  'every payment TSC has not confirmed is cancelled, the one marked sent included'
);
select is(
  (select count(*) from public.order_payments
    where order_id = (select id from p14 where name = 'order') and state = 'confirmed'),
  1::bigint,
  'a confirmed payment stays on the record'
);

-- ---------------------------------------------------------------------------
-- After the order is closed
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"ce000000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$select public.withdraw_cancellation((select id from p14 where name = 'order'))$$,
  '22023', 'this order is cancelled already',
  'a cancellation cannot be withdrawn once accepted'
);
reset role;

set local request.jwt.claims = '{"sub":"ce000000-0000-0000-0000-000000000003","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$select public.decline_cancellation((select id from p14 where name = 'order'))$$,
  '22023', 'this order is cancelled already',
  'nor turned down'
);
reset role;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

select ok(
  has_function_privilege('authenticated', 'public.withdraw_cancellation(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.decline_cancellation(uuid)', 'execute'),
  'signed-in users may call both'
);
select ok(
  not has_function_privilege('anon', 'public.withdraw_cancellation(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.decline_cancellation(uuid)', 'execute'),
  'a signed-out visitor may call neither'
);

select * from finish();
rollback;
