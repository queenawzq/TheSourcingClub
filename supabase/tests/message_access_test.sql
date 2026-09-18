-- ============================================================================
-- Phase 4 access rule tests — conversations
-- ----------------------------------------------------------------------------
-- Fourth suite, `pgtap4-` prefixed, every count scoped to its own fixtures.
--
-- Messaging is the easiest place in this schema to leak something, because it
-- is the only table holding free text that two parties wrote in confidence.
-- The assertions are weighted accordingly: a factory must not read a rival's
-- conversation with the same brand about the same request, and must not be
-- able to start one on a request it was never shown.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(26);

insert into auth.users (id, email) values
  ('c4000000-0000-0000-0000-000000000001', 'p4-brand@example.com'),
  ('c4000000-0000-0000-0000-000000000002', 'p4-f1@example.com'),
  ('c4000000-0000-0000-0000-000000000003', 'p4-f2@example.com'),
  ('c4000000-0000-0000-0000-000000000004', 'p4-outsider@example.com');

insert into public.orgs (id, type, name, slug) values
  ('d4000000-0000-0000-0000-00000000000b', 'brand',   'P4 Brand',     'pgtap4-brand'),
  ('d4000000-0000-0000-0000-0000000000f1', 'factory', 'P4 Factory 1', 'pgtap4-factory-1'),
  ('d4000000-0000-0000-0000-0000000000f2', 'factory', 'P4 Factory 2', 'pgtap4-factory-2'),
  ('d4000000-0000-0000-0000-00000000000c', 'brand',   'P4 Outsider',  'pgtap4-outsider');

insert into public.org_members (org_id, user_id, role) values
  ('d4000000-0000-0000-0000-00000000000b', 'c4000000-0000-0000-0000-000000000001', 'owner'),
  ('d4000000-0000-0000-0000-0000000000f1', 'c4000000-0000-0000-0000-000000000002', 'owner'),
  ('d4000000-0000-0000-0000-0000000000f2', 'c4000000-0000-0000-0000-000000000003', 'owner'),
  ('d4000000-0000-0000-0000-00000000000c', 'c4000000-0000-0000-0000-000000000004', 'owner');

insert into public.brand_profiles (org_id, hq_location) values
  ('d4000000-0000-0000-0000-00000000000b', 'London, UK'),
  ('d4000000-0000-0000-0000-00000000000c', 'Berlin, DE');

insert into public.factory_profiles (org_id, country_code, moq, published_at, verification_status) values
  ('d4000000-0000-0000-0000-0000000000f1', 'PT', 100, now(), 'verified'),
  ('d4000000-0000-0000-0000-0000000000f2', 'CN', 100, now(), 'verified');

-- One open request everyone can see, and one invite-only request that only
-- Factory 1 was shown.
insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total) values
  ('e4000000-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-00000000000b',
   'P4 open request', 'open', 'open_to_all', 100),
  ('e4000000-0000-0000-0000-000000000002', 'd4000000-0000-0000-0000-00000000000b',
   'P4 private request', 'open', 'invited_only', 100);

insert into public.rfq_invitations (rfq_id, factory_org_id) values
  ('e4000000-0000-0000-0000-000000000002', 'd4000000-0000-0000-0000-0000000000f1');

-- ---------------------------------------------------------------------------
-- Opening a conversation
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"c4000000-0000-0000-0000-000000000002","email":"p4-f1@example.com","role":"authenticated"}';
set local role authenticated;

select lives_ok(
  $$select public.open_rfq_thread('e4000000-0000-0000-0000-000000000001',
                                  'd4000000-0000-0000-0000-0000000000f1')$$,
  'a factory can start a conversation about a request it can see'
);

select is(
  (select count(*)::int from public.message_threads
     where rfq_id = 'e4000000-0000-0000-0000-000000000001'),
  1,
  'opening the same conversation twice does not create a second one'
);

select lives_ok(
  $$select public.open_rfq_thread('e4000000-0000-0000-0000-000000000001',
                                  'd4000000-0000-0000-0000-0000000000f1')$$,
  'opening it again is not an error'
);

select is(
  (select count(*)::int from public.message_threads
     where rfq_id = 'e4000000-0000-0000-0000-000000000001'),
  1,
  'and still only one conversation exists'
);

-- Factory 2 was never shown the private request.
reset role;
set local request.jwt.claims = '{"sub":"c4000000-0000-0000-0000-000000000003","email":"p4-f2@example.com","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$select public.open_rfq_thread('e4000000-0000-0000-0000-000000000002',
                                  'd4000000-0000-0000-0000-0000000000f2')$$,
  '42501',
  null,
  'a factory CANNOT start a conversation about a request it was never shown'
);

select throws_ok(
  $$select public.open_rfq_thread('e4000000-0000-0000-0000-000000000001',
                                  'd4000000-0000-0000-0000-0000000000f1')$$,
  '42501',
  null,
  'a factory CANNOT open a conversation on a rival factory''s behalf'
);

reset role;
set local request.jwt.claims = '{"sub":"c4000000-0000-0000-0000-000000000004","email":"p4-outsider@example.com","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$select public.open_rfq_thread('e4000000-0000-0000-0000-000000000001',
                                  'd4000000-0000-0000-0000-0000000000f1')$$,
  '42501',
  null,
  'an unrelated brand CANNOT insert itself into someone else''s conversation'
);

-- The brand starts its own conversation with the second factory, so there are
-- two rival threads on one request — which is the case that matters.
reset role;
set local request.jwt.claims = '{"sub":"c4000000-0000-0000-0000-000000000001","email":"p4-brand@example.com","role":"authenticated"}';
set local role authenticated;

select lives_ok(
  $$select public.open_rfq_thread('e4000000-0000-0000-0000-000000000001',
                                  'd4000000-0000-0000-0000-0000000000f2')$$,
  'the brand can start a conversation with a second factory about the same request'
);

select is(
  (select count(*)::int from public.message_threads
     where rfq_id = 'e4000000-0000-0000-0000-000000000001'),
  2,
  'asking two factories is two conversations, not one'
);

-- ---------------------------------------------------------------------------
-- Sending
-- ---------------------------------------------------------------------------

reset role;
create temporary table p4 as
select
  (select id from public.message_threads
    where rfq_id = 'e4000000-0000-0000-0000-000000000001'
      and factory_org_id = 'd4000000-0000-0000-0000-0000000000f1') as t1,
  (select id from public.message_threads
    where rfq_id = 'e4000000-0000-0000-0000-000000000001'
      and factory_org_id = 'd4000000-0000-0000-0000-0000000000f2') as t2;
grant select on p4 to public;

set local request.jwt.claims = '{"sub":"c4000000-0000-0000-0000-000000000001","email":"p4-brand@example.com","role":"authenticated"}';
set local role authenticated;

select lives_ok(
  $$insert into public.messages (thread_id, sender_org_id, sender_user_id, body)
    values ((select t1 from p4), 'd4000000-0000-0000-0000-00000000000b',
            'c4000000-0000-0000-0000-000000000001', 'Can you split the sample cost?')$$,
  'the brand can send a message in its own conversation'
);

select throws_ok(
  $$insert into public.messages (thread_id, sender_org_id, sender_user_id, body)
    values ((select t1 from p4), 'd4000000-0000-0000-0000-0000000000f1',
            'c4000000-0000-0000-0000-000000000001', 'Pretending to be the factory')$$,
  '42501',
  null,
  'nobody can send a message as though they were the other party'
);

select throws_ok(
  $$insert into public.messages (thread_id, sender_org_id, sender_user_id, body)
    values ((select t1 from p4), 'd4000000-0000-0000-0000-00000000000b',
            'c4000000-0000-0000-0000-000000000002', 'Signed as someone else')$$,
  '42501',
  null,
  'a message cannot be attributed to another user'
);

select throws_ok(
  $$update public.messages set body = 'something else'
      where thread_id = (select t1 from p4)$$,
  '42501',
  null,
  'a message CANNOT be edited after the fact — the record of what was said stands'
);

select throws_ok(
  $$delete from public.messages where thread_id = (select t1 from p4)$$,
  '42501',
  null,
  'and it cannot be deleted either'
);

-- ---------------------------------------------------------------------------
-- The leak that matters: one factory reading its rival's conversation
-- ---------------------------------------------------------------------------

reset role;
set local request.jwt.claims = '{"sub":"c4000000-0000-0000-0000-000000000003","email":"p4-f2@example.com","role":"authenticated"}';
set local role authenticated;

select is(
  (select count(*)::int from public.messages where thread_id = (select t1 from p4)),
  0,
  'a factory CANNOT read a rival''s conversation with the same brand about the same request'
);

select is(
  (select count(*)::int from public.message_threads where id = (select t1 from p4)),
  0,
  'and cannot even see that the rival conversation exists'
);

select throws_ok(
  $$insert into public.messages (thread_id, sender_org_id, sender_user_id, body)
    values ((select t1 from p4), 'd4000000-0000-0000-0000-0000000000f2',
            'c4000000-0000-0000-0000-000000000003', 'Butting in')$$,
  '42501',
  null,
  'a factory CANNOT post into a conversation it is not part of'
);

select throws_ok(
  $$select public.mark_thread_read((select t1 from p4))$$,
  '42501',
  null,
  'and cannot mark a stranger''s conversation read'
);

reset role;
set local request.jwt.claims = '{"sub":"c4000000-0000-0000-0000-000000000004","email":"p4-outsider@example.com","role":"authenticated"}';
set local role authenticated;

select is(
  (select count(*)::int from public.message_thread_summary
     where rfq_id = 'e4000000-0000-0000-0000-000000000001'),
  0,
  'an unrelated org sees none of it through the summary view either'
);

-- ---------------------------------------------------------------------------
-- Unread
-- ---------------------------------------------------------------------------

reset role;
set local request.jwt.claims = '{"sub":"c4000000-0000-0000-0000-000000000002","email":"p4-f1@example.com","role":"authenticated"}';
set local role authenticated;

select is(
  (select unread_count from public.message_thread_summary where id = (select t1 from p4)),
  1,
  'the factory has one unread message'
);

select lives_ok(
  $$select public.mark_thread_read((select t1 from p4))$$,
  'and can mark the conversation read'
);

select is(
  (select unread_count from public.message_thread_summary where id = (select t1 from p4)),
  0,
  'after which nothing is unread — the count is derived, so it cannot get stuck'
);

reset role;
set local request.jwt.claims = '{"sub":"c4000000-0000-0000-0000-000000000001","email":"p4-brand@example.com","role":"authenticated"}';
set local role authenticated;

select is(
  (select unread_count from public.message_thread_summary where id = (select t1 from p4)),
  0,
  'your own message is never unread to you'
);

-- Counted as superuser: a notification addressed to the factory is not
-- readable by the brand, which is itself the point, and checking it from
-- either party's session would only be measuring that.
reset role;

select is(
  (select count(*)::int from public.notifications
     where subject_type = 'thread' and subject_id = (select t1 from p4)
       and org_id = 'd4000000-0000-0000-0000-0000000000f1'),
  1,
  'sending notified the other side'
);

select is(
  (select count(*)::int from public.notifications
     where subject_type = 'thread' and subject_id = (select t1 from p4)
       and org_id = 'd4000000-0000-0000-0000-00000000000b'),
  0,
  'and did not notify the sender about their own message'
);

select is(
  (select count(*)::int from public.message_reads
     where thread_id = (select t1 from p4)
       and user_id = 'c4000000-0000-0000-0000-000000000001'),
  1,
  'the sender is recorded as having read what they just wrote'
);

select * from finish();
rollback;
