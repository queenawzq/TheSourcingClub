-- ============================================================================
-- Start a call now (20261118520000)
-- ----------------------------------------------------------------------------
-- `pgtapic-` prefixed, ids `c1c0…`, every count scoped to its own fixtures.
--
-- Mostly negative: a company outside the conversation must not start, read,
-- answer or join a call; the calling side must not answer its own call, a
-- person in both companies included; a call nobody answered in 15 minutes is
-- over; and scheduled calls keep every rule they had.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(37);

insert into auth.users (id, email) values
  ('c1c01000-0000-0000-0000-000000000001', 'pic-brand@example.com'),
  ('c1c01000-0000-0000-0000-000000000003', 'pic-factory@example.com'),
  ('c1c01000-0000-0000-0000-000000000004', 'pic-outsider@example.com'),
  ('c1c01000-0000-0000-0000-000000000005', 'pic-both@example.com'),
  ('c1c01000-0000-0000-0000-000000000006', 'pic-factory-two@example.com');

insert into public.orgs (id, type, name, slug) values
  ('c1c02000-0000-0000-0000-00000000000b', 'brand',   'PIC Brand',       'pgtapic-brand'),
  ('c1c02000-0000-0000-0000-0000000000f1', 'factory', 'PIC Factory',     'pgtapic-factory'),
  ('c1c02000-0000-0000-0000-0000000000f2', 'factory', 'PIC Factory Two', 'pgtapic-factory-two'),
  ('c1c02000-0000-0000-0000-00000000000c', 'brand',   'PIC Outsider',    'pgtapic-outsider');

insert into public.org_members (org_id, user_id, role) values
  ('c1c02000-0000-0000-0000-00000000000b', 'c1c01000-0000-0000-0000-000000000001', 'owner'),
  ('c1c02000-0000-0000-0000-0000000000f1', 'c1c01000-0000-0000-0000-000000000003', 'owner'),
  ('c1c02000-0000-0000-0000-0000000000f2', 'c1c01000-0000-0000-0000-000000000006', 'owner'),
  ('c1c02000-0000-0000-0000-00000000000c', 'c1c01000-0000-0000-0000-000000000004', 'owner'),
  -- One person in the brand and its factory.
  ('c1c02000-0000-0000-0000-00000000000b', 'c1c01000-0000-0000-0000-000000000005', 'member'),
  ('c1c02000-0000-0000-0000-0000000000f1', 'c1c01000-0000-0000-0000-000000000005', 'member');

insert into public.factory_profiles (org_id, country_code, moq, published_at, verification_status) values
  ('c1c02000-0000-0000-0000-0000000000f1', 'CN', 100, now(), 'verified'),
  ('c1c02000-0000-0000-0000-0000000000f2', 'CN', 100, now(), 'verified');

insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total) values
  ('c1c03000-0000-0000-0000-000000000001', 'c1c02000-0000-0000-0000-00000000000b', 'PIC shirts', 'open', 'open_to_all', 100);

insert into public.message_threads (id, rfq_id, brand_org_id, factory_org_id) values
  ('c1c04000-0000-0000-0000-000000000001', 'c1c03000-0000-0000-0000-000000000001',
   'c1c02000-0000-0000-0000-00000000000b', 'c1c02000-0000-0000-0000-0000000000f1'),
  ('c1c04000-0000-0000-0000-000000000002', 'c1c03000-0000-0000-0000-000000000001',
   'c1c02000-0000-0000-0000-00000000000b', 'c1c02000-0000-0000-0000-0000000000f2');

-- A call the brand started 20 minutes ago that nobody answered: missed.
insert into public.calls (id, thread_id, title, starts_at, instant, proposer_org_id, proposer_user_id)
values ('c1c05000-0000-0000-0000-0000000000aa', 'c1c04000-0000-0000-0000-000000000002',
        'Video call', now() - interval '20 minutes', true,
        'c1c02000-0000-0000-0000-00000000000b', 'c1c01000-0000-0000-0000-000000000001');

-- ---------------------------------------------------------------------------
-- Who may start one
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"c1c01000-0000-0000-0000-000000000004","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$select public.start_call_now('c1c04000-0000-0000-0000-000000000001', null)$$,
  '42501', null, 'a company outside the conversation CANNOT start a call in it'
);

select throws_ok(
  $$select public.start_call_now('c1c04000-0000-0000-0000-0000000000ff', null)$$,
  '42501', null, 'nor in a conversation that does not exist (same answer)'
);

reset role;
set local request.jwt.claims = '{"sub":"c1c01000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$select public.start_call_now('c1c04000-0000-0000-0000-000000000001', 'Mars/Olympus')$$,
  '22023', null, 'an unknown time zone is refused'
);

select lives_ok(
  $$select public.start_call_now('c1c04000-0000-0000-0000-000000000001', 'Europe/London')$$,
  'a party starts a call now'
);

select is(
  (select instant::text || ':' || status::text || ':' || title || ':' || duration_minutes || ':' ||
          (starts_at between now() - interval '1 minute' and now() + interval '1 minute')::text
     from public.calls where thread_id = 'c1c04000-0000-0000-0000-000000000001'),
  'true:proposed:Video call:30:true',
  'it starts now, rings as proposed, 30 minutes, with the fixed title'
);

select throws_ok(
  $$select public.start_call_now('c1c04000-0000-0000-0000-000000000001', null)$$,
  '22023', null, 'a second press while it rings is refused'
);

select throws_ok(
  $$select public.propose_call('c1c04000-0000-0000-0000-000000000001', now() + interval '5 minutes', 30, 'P x', null, null)$$,
  '22023', null, 'a scheduled call still needs a time at least 15 minutes away'
);

select throws_ok(
  $$select public.propose_call('c1c04000-0000-0000-0000-000000000001', now() + interval '2 days', 30, 'Video call', null, null)$$,
  '42501', null, 'the fixed title passes unchecked only on a call started now'
);

select throws_ok(
  $$insert into public.calls (thread_id, title, starts_at, instant, proposer_org_id)
    values ('c1c04000-0000-0000-0000-000000000001', 'Video call', now(), true,
            'c1c02000-0000-0000-0000-00000000000b')$$,
  '42501', null, 'a call started now CANNOT be inserted directly'
);

select throws_ok(
  $$select public.accept_call((select id from public.calls where thread_id = 'c1c04000-0000-0000-0000-000000000001'), null)$$,
  '42501', null, 'the calling side CANNOT answer its own call'
);

reset role;

select is(
  (select count(*)::int from public.notifications
    where org_id = 'c1c02000-0000-0000-0000-0000000000f1' and kind = 'call_started'
      and title = 'PIC Brand started a call about PIC shirts' and subject_type = 'thread'
      and subject_id = 'c1c04000-0000-0000-0000-000000000001'),
  1, 'the other company is told, and the notice opens the conversation'
);

select is(
  (select count(*)::int from public.notifications
    where org_id = 'c1c02000-0000-0000-0000-00000000000b' and kind = 'call_started'),
  0, 'the calling company is not told of its own call'
);

select is(
  public.notification_email_category('call_started'), 'messages',
  'it is emailed under the messages switch'
);

select is(
  (select count(*)::int from public.notification_email_outbox x
     join public.notifications n on n.id = x.notification_id
    where n.org_id = 'c1c02000-0000-0000-0000-0000000000f1' and n.kind = 'call_started'),
  2, 'and an email is queued for each of the other company''s two members'
);

-- ---------------------------------------------------------------------------
-- Who may read and answer it
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"c1c01000-0000-0000-0000-000000000004","role":"authenticated"}';
set local role authenticated;

select is(
  (select count(*)::int from public.calls where thread_id = 'c1c04000-0000-0000-0000-000000000001'),
  0, 'an outsider CANNOT see the call'
);

select throws_ok(
  $$select public.accept_call((select id from public.calls where proposer_user_id = 'c1c01000-0000-0000-0000-000000000001' and thread_id = 'c1c04000-0000-0000-0000-000000000001' limit 1), null)$$,
  'P0002', null, 'nor answer it'
);

reset role;
-- The id, read as the owner, for the outsider's direct attempts.
create temporary table ringing as
  select id from public.calls where thread_id = 'c1c04000-0000-0000-0000-000000000001';
grant select on ringing to authenticated;

set local request.jwt.claims = '{"sub":"c1c01000-0000-0000-0000-000000000004","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$select public.accept_call((select id from ringing), null)$$,
  'P0002', null, 'an outsider CANNOT accept the call by its id'
);

select throws_ok(
  $$select public.decline_call((select id from ringing), null)$$,
  'P0002', null, 'nor decline it'
);

select throws_ok(
  $$select public.cancel_call((select id from ringing), null)$$,
  'P0002', null, 'nor end it'
);

select throws_ok(
  $$select * from public.call_join_context((select id from ringing), 'c1c01000-0000-0000-0000-000000000004')$$,
  '42501', null, 'the join context is the server''s, not a signed-in person''s'
);

reset role;
set local request.jwt.claims = '{"sub":"c1c01000-0000-0000-0000-000000000005","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$select public.accept_call((select id from ringing), null)$$,
  '42501', null, 'a person in both companies CANNOT answer the call for the other side'
);

reset role;

-- What /api/call-join reads, with the secret key.
select is(
  (select is_party::text || ':' || is_caller::text || ':' || instant::text || ':' ||
          (rings_until = starts_at + interval '15 minutes')::text
     from public.call_join_context((select id from ringing), 'c1c01000-0000-0000-0000-000000000001')),
  'true:true:true:true',
  'the caller may join while it rings, for 15 minutes'
);

select is(
  (select is_party::text || ':' || is_caller::text
     from public.call_join_context((select id from ringing), 'c1c01000-0000-0000-0000-000000000003')),
  'true:false',
  'the other side is a party but not the caller: it joins by accepting'
);

select is(
  (select is_party::text || ':' || is_caller::text
     from public.call_join_context((select id from ringing), 'c1c01000-0000-0000-0000-000000000004')),
  'false:false',
  'an outsider is neither, so the route refuses it'
);

set local request.jwt.claims = '{"sub":"c1c01000-0000-0000-0000-000000000003","role":"authenticated"}';
set local role authenticated;

select lives_ok(
  $$select public.accept_call((select id from ringing), 'Asia/Shanghai')$$,
  'the other side answers (joins) while it rings'
);

select is(
  (select status::text from public.calls where id = (select id from ringing)),
  'accepted', 'and the call is accepted'
);

select throws_ok(
  $$select public.start_call_now('c1c04000-0000-0000-0000-000000000001', null)$$,
  '22023', null, 'nobody starts another while this one is on'
);

reset role;

select is(
  (select count(*)::int from public.notifications
    where org_id = 'c1c02000-0000-0000-0000-00000000000b' and kind = 'call_accepted'),
  1, 'the caller is told it was answered'
);

-- ---------------------------------------------------------------------------
-- Missed: nobody answered in 15 minutes
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"c1c01000-0000-0000-0000-000000000006","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$select public.accept_call('c1c05000-0000-0000-0000-0000000000aa', null)$$,
  '22023', null, 'a missed call CANNOT be answered'
);

select throws_ok(
  $$select public.decline_call('c1c05000-0000-0000-0000-0000000000aa', null)$$,
  '22023', null, 'nor declined'
);

reset role;
set local request.jwt.claims = '{"sub":"c1c01000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$select public.cancel_call('c1c05000-0000-0000-0000-0000000000aa', null)$$,
  '22023', null, 'nor ended by the caller: it stays missed'
);

select lives_ok(
  $$select public.start_call_now('c1c04000-0000-0000-0000-000000000002', null)$$,
  'a missed call does not stop the caller starting another'
);

-- ---------------------------------------------------------------------------
-- The caller ends a call that rings
-- ---------------------------------------------------------------------------

select lives_ok(
  $$select public.cancel_call((select id from public.calls
      where thread_id = 'c1c04000-0000-0000-0000-000000000002' and status = 'proposed'
        and id <> 'c1c05000-0000-0000-0000-0000000000aa'), null)$$,
  'the caller ends its call while it rings'
);

reset role;

select is(
  (select count(*)::int from public.notifications
    where org_id = 'c1c02000-0000-0000-0000-0000000000f2' and kind = 'call_cancelled'
      and title = 'PIC Brand ended the call about PIC shirts'),
  1, 'and the other side is told the call ended'
);

set local request.jwt.claims = '{"sub":"c1c01000-0000-0000-0000-000000000006","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$select public.cancel_call((select id from public.calls
      where thread_id = 'c1c04000-0000-0000-0000-000000000002' and status = 'proposed'
        and id <> 'c1c05000-0000-0000-0000-0000000000aa' limit 1), null)$$,
  'P0002', null, 'nothing left ringing to end'
);

reset role;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

set local role anon;
select throws_ok(
  $$select public.start_call_now('c1c04000-0000-0000-0000-000000000001', null)$$,
  '42501', null, 'a signed-out visitor CANNOT start a call'
);
reset role;

set local request.jwt.claims = '{"sub":"c1c01000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$select public.instant_call_rings_until(c) from public.calls c limit 1$$,
  '42501', null, 'the ring window helper is internal'
);
reset role;

select * from finish();
rollback;
