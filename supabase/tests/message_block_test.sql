-- ============================================================================
-- Contact details: blocked before a contract, delivered after it
-- ----------------------------------------------------------------------------
-- 20261108100000. `pgtap-n8a-` prefixed, every count scoped to its fixtures.
--
-- A contract is an order between the two companies on what the thread is
-- about. The negative assertions matter most: a blocked message reaches the
-- recipient in no form, and a contract with ONE factory opens nothing for
-- another factory on the same request.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(17);

insert into auth.users (id, email) values
  ('c8100000-0000-0000-0000-000000000001', 'n8a-brand@example.com'),
  ('c8100000-0000-0000-0000-000000000002', 'n8a-factory@example.com'),
  ('c8100000-0000-0000-0000-000000000003', 'n8a-factory-two@example.com');

insert into public.orgs (id, type, name, slug) values
  ('c8200000-0000-0000-0000-00000000000b', 'brand',   'N8A Brand',       'pgtap-n8a-brand'),
  ('c8200000-0000-0000-0000-0000000000f1', 'factory', 'N8A Factory',     'pgtap-n8a-factory'),
  ('c8200000-0000-0000-0000-0000000000f2', 'factory', 'N8A Factory Two', 'pgtap-n8a-factory-two');

insert into public.org_members (org_id, user_id, role) values
  ('c8200000-0000-0000-0000-00000000000b', 'c8100000-0000-0000-0000-000000000001', 'owner'),
  ('c8200000-0000-0000-0000-0000000000f1', 'c8100000-0000-0000-0000-000000000002', 'owner'),
  ('c8200000-0000-0000-0000-0000000000f2', 'c8100000-0000-0000-0000-000000000003', 'owner');

insert into public.brand_profiles (org_id, hq_location) values
  ('c8200000-0000-0000-0000-00000000000b', 'London, UK');

insert into public.factory_profiles (org_id, country_code, moq, published_at, verification_status) values
  ('c8200000-0000-0000-0000-0000000000f1', 'CN', 100, now(), 'verified'),
  ('c8200000-0000-0000-0000-0000000000f2', 'CN', 100, now(), 'verified');

-- R1 has no order. R2 has an order with Factory One only.
insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total) values
  ('c8300000-0000-0000-0000-000000000001', 'c8200000-0000-0000-0000-00000000000b', 'N8A no contract', 'open', 'open_to_all', 100),
  ('c8300000-0000-0000-0000-000000000002', 'c8200000-0000-0000-0000-00000000000b', 'N8A contract',    'open', 'open_to_all', 100);

insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity, submitted_at) values
  ('c8400000-0000-0000-0000-000000000001', 'c8300000-0000-0000-0000-000000000002',
   'c8200000-0000-0000-0000-0000000000f1', 'accepted', 100, 1, now());

insert into public.production_orders
  (id, rfq_id, quote_id, brand_org_id, factory_org_id, unit_price_cents,
   production_quantity, bulk_subtotal_cents, sample_subtotal_cents, order_total_cents, deposit_pct, balance_pct)
values
  ('c8500000-0000-0000-0000-000000000001', 'c8300000-0000-0000-0000-000000000002', 'c8400000-0000-0000-0000-000000000001',
   'c8200000-0000-0000-0000-00000000000b', 'c8200000-0000-0000-0000-0000000000f1', 100, 1, 100, 0, 100, 50, 50);

-- T1: R1 with Factory One (no contract). T2: R2 with Factory One (contract on
-- the request). T3: R2 with Factory Two (no contract: the order is another
-- factory's). T4: the order's own thread.
insert into public.message_threads (id, rfq_id, order_id, brand_org_id, factory_org_id) values
  ('c8600000-0000-0000-0000-000000000001', 'c8300000-0000-0000-0000-000000000001', null,
   'c8200000-0000-0000-0000-00000000000b', 'c8200000-0000-0000-0000-0000000000f1'),
  ('c8600000-0000-0000-0000-000000000002', 'c8300000-0000-0000-0000-000000000002', null,
   'c8200000-0000-0000-0000-00000000000b', 'c8200000-0000-0000-0000-0000000000f1'),
  ('c8600000-0000-0000-0000-000000000003', 'c8300000-0000-0000-0000-000000000002', null,
   'c8200000-0000-0000-0000-00000000000b', 'c8200000-0000-0000-0000-0000000000f2');
insert into public.message_threads (id, rfq_id, order_id, brand_org_id, factory_org_id) values
  ('c8600000-0000-0000-0000-000000000004', null, 'c8500000-0000-0000-0000-000000000001',
   'c8200000-0000-0000-0000-00000000000b', 'c8200000-0000-0000-0000-0000000000f1')
on conflict do nothing;

-- The factory writes the same contact line on every thread.
set local request.jwt.claims = '{"sub":"c8100000-0000-0000-0000-000000000002","role":"authenticated"}';
set local role authenticated;

insert into public.messages (id, thread_id, sender_org_id, sender_user_id, body) values
  ('c8700000-0000-0000-0000-000000000001', 'c8600000-0000-0000-0000-000000000001',
   'c8200000-0000-0000-0000-0000000000f1', 'c8100000-0000-0000-0000-000000000002', 'Add me on WeChat: n8afactory'),
  ('c8700000-0000-0000-0000-000000000002', 'c8600000-0000-0000-0000-000000000002',
   'c8200000-0000-0000-0000-0000000000f1', 'c8100000-0000-0000-0000-000000000002', 'Add me on WeChat: n8afactory'),
  ('c8700000-0000-0000-0000-000000000005', 'c8600000-0000-0000-0000-000000000001',
   'c8200000-0000-0000-0000-0000000000f1', 'c8100000-0000-0000-0000-000000000002', 'We can do 300 pieces.');

select lives_ok(
  $$insert into public.messages (id, thread_id, sender_org_id, sender_user_id, body, delivery)
    values ('c8700000-0000-0000-0000-000000000006', 'c8600000-0000-0000-0000-000000000001',
            'c8200000-0000-0000-0000-0000000000f1', 'c8100000-0000-0000-0000-000000000002',
            'Self-blocked', 'blocked')$$,
  'a send is never refused, whatever state it asks for'
);

select is(
  (select delivery from public.messages where id = 'c8700000-0000-0000-0000-000000000006'),
  'checking',
  'but a sender CANNOT write its message as blocked (or anything but checking)'
);

select throws_ok(
  $$select public.thread_has_contract('c8600000-0000-0000-0000-000000000001')$$,
  '42501',
  null,
  'a signed-in person CANNOT ask whether a thread has a contract'
);

reset role;

set local request.jwt.claims = '{"sub":"c8100000-0000-0000-0000-000000000003","role":"authenticated"}';
set local role authenticated;
insert into public.messages (id, thread_id, sender_org_id, sender_user_id, body) values
  ('c8700000-0000-0000-0000-000000000003', 'c8600000-0000-0000-0000-000000000003',
   'c8200000-0000-0000-0000-0000000000f2', 'c8100000-0000-0000-0000-000000000003', 'Add me on WeChat: n8atwo');
reset role;

insert into public.messages (id, thread_id, sender_org_id, sender_user_id, body, delivery)
select 'c8700000-0000-0000-0000-000000000004', id,
       'c8200000-0000-0000-0000-0000000000f1', 'c8100000-0000-0000-0000-000000000002',
       'Add me on WeChat: n8afactory', 'checking'
from public.message_threads where order_id = 'c8500000-0000-0000-0000-000000000001';

-- The server's verdicts, as api/screen-message.js records them.
set local role service_role;
select public.record_message_screening(id, 'held', 'pattern', 'wechat id', null, 'contact_details')
from public.messages
where id in ('c8700000-0000-0000-0000-000000000001', 'c8700000-0000-0000-0000-000000000002',
             'c8700000-0000-0000-0000-000000000003', 'c8700000-0000-0000-0000-000000000004');
select public.record_message_screening('c8700000-0000-0000-0000-000000000005', 'delivered', 'pattern_only');
reset role;

select is(
  (select delivery || ':' || coalesce(held_for, '-') || ':' || (delivered_at is null)::text
     from public.messages where id = 'c8700000-0000-0000-0000-000000000001'),
  'blocked:-:true',
  'before a contract, contact details are blocked: never delivered'
);

select is(
  (select delivery from public.messages where id = 'c8700000-0000-0000-0000-000000000005'),
  'delivered',
  'an ordinary message on the same thread is delivered'
);

select is(
  (select delivery from public.messages where id = 'c8700000-0000-0000-0000-000000000002'),
  'delivered',
  'on a request thread whose factory holds an order on it, contact details are delivered'
);

select is(
  (select delivery from public.messages where id = 'c8700000-0000-0000-0000-000000000004'),
  'delivered',
  'and on the order''s own thread'
);

select is(
  (select delivery from public.messages where id = 'c8700000-0000-0000-0000-000000000003'),
  'blocked',
  'another factory on the same request is still blocked: the contract is between two companies'
);

select is(
  (select outcome || ':' || method from public.message_screenings where message_id = 'c8700000-0000-0000-0000-000000000002'),
  'held:pattern',
  'what the screen found is kept, also when the contract let it through'
);

select is(
  (select count(*)::int from public.notifications
    where org_id = 'c8200000-0000-0000-0000-00000000000b'
      and subject_id in ('c8600000-0000-0000-0000-000000000001', 'c8600000-0000-0000-0000-000000000003')
      and body like 'Add me on WeChat%'),
  0,
  'the brand is NOT notified of a blocked message'
);

select is(
  (select count(*)::int from public.notifications
    where org_id = 'c8200000-0000-0000-0000-00000000000b'
      and subject_id = 'c8600000-0000-0000-0000-000000000002' and kind = 'message'),
  1,
  'but is notified of one delivered after a contract'
);

-- What each side reads.
set local request.jwt.claims = '{"sub":"c8100000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;

select is(
  (select count(*)::int from public.messages
    where id in ('c8700000-0000-0000-0000-000000000001', 'c8700000-0000-0000-0000-000000000003')),
  0,
  'the recipient CANNOT read a blocked message'
);

select is(
  (select coalesce(last_body, '(none)') from public.message_thread_summary
    where id = 'c8600000-0000-0000-0000-000000000003'),
  '(none)',
  'or see it as the thread''s preview'
);

select is(
  (select count(*)::int from public.messages
    where id in ('c8700000-0000-0000-0000-000000000002', 'c8700000-0000-0000-0000-000000000005')),
  2,
  'while it reads what was delivered'
);

reset role;
set local request.jwt.claims = '{"sub":"c8100000-0000-0000-0000-000000000002","role":"authenticated"}';
set local role authenticated;

select is(
  (select delivery from public.messages where id = 'c8700000-0000-0000-0000-000000000001'),
  'blocked',
  'the sender sees its message, and that it was blocked'
);

reset role;

-- A verdict is final: asking again changes nothing.
set local role service_role;
select is(
  (select (public.record_message_screening('c8700000-0000-0000-0000-000000000001', 'delivered', 'ai')).delivery),
  'blocked',
  'a repeated screen CANNOT deliver a blocked message'
);
reset role;

select is(
  (select count(*)::int from public.messages m
    join public.message_threads t on t.id = m.thread_id
   where t.brand_org_id = 'c8200000-0000-0000-0000-00000000000b' and m.delivery = 'held'),
  0,
  'nothing is held for staff any more'
);

select * from finish();
rollback;
