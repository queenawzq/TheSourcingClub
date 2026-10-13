-- ============================================================================
-- Calls
-- ----------------------------------------------------------------------------
-- `pgtap19-` prefixed, ids `ca1…`, every count scoped to its own fixtures.
--
-- Mostly negative: a company outside the conversation must not see or touch
-- its calls, the proposing side must not answer its own invite, nobody may
-- write a call except through the functions, and the video meeting's number
-- and passcode must be unreachable from the browser. A positive test that an
-- accept works passes just as happily when any of those is broken.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(53);

insert into auth.users (id, email) values
  ('ca110000-0000-0000-0000-000000000001', 'p19-brand@example.com'),
  ('ca110000-0000-0000-0000-000000000003', 'p19-factory@example.com'),
  ('ca110000-0000-0000-0000-000000000004', 'p19-outsider@example.com');

insert into public.orgs (id, type, name, slug) values
  ('ca120000-0000-0000-0000-00000000000b', 'brand',   'P19 Brand',    'pgtap19-brand'),
  ('ca120000-0000-0000-0000-0000000000f1', 'factory', 'P19 Factory',  'pgtap19-factory'),
  ('ca120000-0000-0000-0000-00000000000c', 'brand',   'P19 Outsider', 'pgtap19-outsider');

insert into public.org_members (org_id, user_id, role) values
  ('ca120000-0000-0000-0000-00000000000b', 'ca110000-0000-0000-0000-000000000001', 'owner'),
  ('ca120000-0000-0000-0000-0000000000f1', 'ca110000-0000-0000-0000-000000000003', 'owner'),
  ('ca120000-0000-0000-0000-00000000000c', 'ca110000-0000-0000-0000-000000000004', 'owner');

insert into public.factory_profiles (org_id, country_code, moq, published_at, verification_status) values
  ('ca120000-0000-0000-0000-0000000000f1', 'CN', 100, now(), 'verified');

insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total) values
  ('ca130000-0000-0000-0000-000000000001', 'ca120000-0000-0000-0000-00000000000b', 'P19 shirts', 'open', 'open_to_all', 100);

insert into public.message_threads (id, rfq_id, brand_org_id, factory_org_id) values
  ('ca140000-0000-0000-0000-000000000001', 'ca130000-0000-0000-0000-000000000001',
   'ca120000-0000-0000-0000-00000000000b', 'ca120000-0000-0000-0000-0000000000f1');

-- A proposal whose time has already passed, for the "too late to accept" case.
insert into public.calls (id, thread_id, title, starts_at, proposer_org_id, proposer_user_id)
values ('ca150000-0000-0000-0000-0000000000aa', 'ca140000-0000-0000-0000-000000000001',
        'P19 passed', now() - interval '1 hour',
        'ca120000-0000-0000-0000-00000000000b', 'ca110000-0000-0000-0000-000000000001');

-- ---------------------------------------------------------------------------
-- The brand proposes
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"ca110000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;

select lives_ok(
  $$select public.propose_call('ca140000-0000-0000-0000-000000000001', now() + interval '2 days', 30,
                               'P19 first', 'Review the fit sample', 'Europe/London')$$,
  'a party proposes a call'
);

select is(
  (select status::text || ':' || proposer_time_zone || ':' || duration_minutes
     from public.calls where title = 'P19 first'),
  'proposed:Europe/London:30',
  'it is saved as proposed, with the proposer''s time zone'
);

select throws_ok(
  $$select public.propose_call('ca140000-0000-0000-0000-000000000001', now() - interval '1 day', 30, 'P19 x', null, null)$$,
  '22023', null, 'a time in the past is refused'
);

select throws_ok(
  $$select public.propose_call('ca140000-0000-0000-0000-000000000001', now() + interval '5 minutes', 30, 'P19 x', null, null)$$,
  '22023', null, 'a time less than 15 minutes away is refused'
);

select throws_ok(
  $$select public.propose_call('ca140000-0000-0000-0000-000000000001', now() + interval '2 years', 30, 'P19 x', null, null)$$,
  '22023', null, 'a time more than a year away is refused'
);

select throws_ok(
  $$select public.propose_call('ca140000-0000-0000-0000-000000000001', now() + interval '2 days', 30, '   ', null, null)$$,
  '22023', null, 'a call needs a title'
);

select throws_ok(
  $$select public.propose_call('ca140000-0000-0000-0000-000000000001', now() + interval '2 days', 300, 'P19 x', null, null)$$,
  '22023', null, 'a five-hour call is refused'
);

select throws_ok(
  $$select public.propose_call('ca140000-0000-0000-0000-000000000001', now() + interval '2 days', 30, 'P19 x', null, 'Mars/Olympus')$$,
  '22023', null, 'an unknown time zone is refused'
);

select throws_ok(
  $$select public.accept_call((select id from public.calls where title = 'P19 first'), null)$$,
  '42501', null, 'the proposing side CANNOT accept its own invite'
);

select throws_ok(
  $$select public.decline_call((select id from public.calls where title = 'P19 first'), null)$$,
  '42501', null, 'nor decline it'
);

select throws_ok(
  $$select public.counter_call((select id from public.calls where title = 'P19 first'),
                               now() + interval '3 days', 30, 'P19 x', null, null)$$,
  '42501', null, 'nor propose another time to itself'
);

select throws_ok(
  $$insert into public.calls (thread_id, title, starts_at, proposer_org_id)
    values ('ca140000-0000-0000-0000-000000000001', 'P19 direct', now() + interval '1 day',
            'ca120000-0000-0000-0000-00000000000b')$$,
  '42501', null, 'a call CANNOT be inserted directly'
);

select throws_ok(
  $$update public.calls set status = 'accepted' where title = 'P19 first'$$,
  '42501', null, 'nor updated directly (accepting its own invite that way)'
);

select throws_ok(
  $$delete from public.calls where title = 'P19 first'$$,
  '42501', null, 'nor deleted'
);

select throws_ok(
  $$select * from public.call_meetings$$,
  '42501', null, 'the video meetings table is unreadable from the browser'
);

select throws_ok(
  $$select * from public.claim_call_meeting((select id from public.calls where title = 'P19 first'))$$,
  '42501', null, 'claim_call_meeting is the server''s'
);

select throws_ok(
  $$select public.record_call_meeting((select id from public.calls where title = 'P19 first'), '1', '2', 'x')$$,
  '42501', null, 'record_call_meeting is the server''s'
);

select throws_ok(
  $$select * from public.call_join_context((select id from public.calls where title = 'P19 first'),
                                           'ca110000-0000-0000-0000-000000000001')$$,
  '42501', null, 'call_join_context is the server''s'
);

select throws_ok(
  $$select public.notify_call((select c from public.calls c where title = 'P19 first'),
                              'ca120000-0000-0000-0000-00000000000c', 'call_proposed', 'spam', null)$$,
  '42501', null, 'a client CANNOT send call notifications of its own'
);

-- ---------------------------------------------------------------------------
-- A company outside the conversation
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"ca110000-0000-0000-0000-000000000004","role":"authenticated"}';

select is(
  (select count(*)::int from public.calls where thread_id = 'ca140000-0000-0000-0000-000000000001'),
  0,
  'an outsider CANNOT see the conversation''s calls'
);

select throws_ok(
  $$select public.propose_call('ca140000-0000-0000-0000-000000000001', now() + interval '2 days', 30, 'P19 x', null, null)$$,
  '42501', null, 'nor propose one there'
);

select throws_ok(
  $$select public.accept_call((select id from public.calls where title = 'P19 first'), null)$$,
  'P0002', null, 'nor accept one (it does not exist, as far as it can tell)'
);

select throws_ok(
  $$select public.accept_call('ca150000-0000-0000-0000-0000000000aa', null)$$,
  'P0002', null, 'even by id'
);

select throws_ok(
  $$select public.cancel_call('ca150000-0000-0000-0000-0000000000aa', null)$$,
  'P0002', null, 'nor cancel one'
);

select throws_ok(
  $$select public.thread_counterparty_time_zone('ca140000-0000-0000-0000-000000000001')$$,
  '42501', null, 'nor read either side''s time zone'
);

-- ---------------------------------------------------------------------------
-- The factory answers with another time
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"ca110000-0000-0000-0000-000000000003","role":"authenticated"}';

select lives_ok(
  $$select public.set_my_time_zone('Asia/Shanghai')$$,
  'a person saves their own time zone'
);

select throws_ok(
  $$select public.set_my_time_zone('Mars/Olympus')$$,
  '22023', null, 'an unknown one is refused'
);

select is(
  (select count(*)::int from public.calls where title = 'P19 first'),
  1,
  'the other side sees the invite'
);

select is(
  (select count(*)::int from public.notifications
    where org_id = 'ca120000-0000-0000-0000-0000000000f1' and kind = 'call_proposed'
      and subject_type = 'thread' and subject_id = 'ca140000-0000-0000-0000-000000000001'),
  1,
  'and was notified of it, pointing at the conversation'
);

select throws_ok(
  $$select public.cancel_call((select id from public.calls where title = 'P19 first'), null)$$,
  '42501', null, 'the other side CANNOT withdraw an invite it did not send (it declines instead)'
);

select throws_ok(
  $$select public.accept_call('ca150000-0000-0000-0000-0000000000aa', null)$$,
  '22023', null, 'an invite whose time has passed CANNOT be accepted'
);

select lives_ok(
  $$select public.counter_call((select id from public.calls where title = 'P19 first'),
                               now() + interval '3 days', 45, 'P19 counter', 'Earlier is better for us', 'Asia/Shanghai')$$,
  'the other side proposes another time'
);

select is(
  (select status::text from public.calls where title = 'P19 first'),
  'countered',
  'the first proposal is marked countered'
);

select is(
  (select c.counter_of = f.id and c.proposer_org_id = 'ca120000-0000-0000-0000-0000000000f1'
     from public.calls c, public.calls f
    where c.title = 'P19 counter' and f.title = 'P19 first'),
  true,
  'the new time points at the one it answers, proposed by the factory'
);

select throws_ok(
  $$select public.accept_call((select id from public.calls where title = 'P19 counter'), null)$$,
  '42501', null, 'the factory CANNOT accept its own new time'
);

select throws_ok(
  $$select public.accept_call((select id from public.calls where title = 'P19 first'), null)$$,
  '22023', null, 'nor the proposal it already answered'
);

-- ---------------------------------------------------------------------------
-- The brand accepts, proposes again, cancels
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"ca110000-0000-0000-0000-000000000001","role":"authenticated"}';

select is(
  public.thread_counterparty_time_zone('ca140000-0000-0000-0000-000000000001'),
  'Asia/Shanghai',
  'each side can read the other side''s time zone'
);

select throws_ok(
  $$select public.accept_call((select id from public.calls where title = 'P19 first'), null)$$,
  '42501', null, 'a countered proposal CANNOT be accepted by its proposer'
);

select lives_ok(
  $$select public.accept_call((select id from public.calls where title = 'P19 counter'), 'Europe/London')$$,
  'the brand accepts the new time'
);

select is(
  (select status::text || ':' || (responded_by = 'ca110000-0000-0000-0000-000000000001')::text
     from public.calls where title = 'P19 counter'),
  'accepted:true',
  'it is accepted, by the brand'
);

select throws_ok(
  $$select public.accept_call((select id from public.calls where title = 'P19 counter'), null)$$,
  '22023', null, 'accepting twice is refused'
);

select lives_ok(
  $$select public.propose_call('ca140000-0000-0000-0000-000000000001', now() + interval '4 days', 30,
                               'P19 second', null, 'Europe/London')$$,
  'a second proposal on the same conversation'
);

select lives_ok(
  $$select public.cancel_call((select id from public.calls where title = 'P19 counter'), 'Our designer is out')$$,
  'either side cancels an accepted call before it starts'
);

select throws_ok(
  $$select public.cancel_call((select id from public.calls where title = 'P19 counter'), null)$$,
  '22023', null, 'cancelling twice is refused'
);

-- ---------------------------------------------------------------------------
-- The factory declines
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"ca110000-0000-0000-0000-000000000003","role":"authenticated"}';

select lives_ok(
  $$select public.decline_call((select id from public.calls where title = 'P19 second'), 'Factory closed that week')$$,
  'the other side declines'
);

select throws_ok(
  $$select public.counter_call((select id from public.calls where title = 'P19 second'),
                               now() + interval '5 days', 30, 'P19 late', null, null)$$,
  '22023', null, 'a declined invite CANNOT be answered again'
);

reset role;

select is(
  (select string_agg(kind || '>' || o.name, ', ' order by n.kind)
     from public.notifications n join public.orgs o on o.id = n.org_id
    where n.org_id in ('ca120000-0000-0000-0000-00000000000b', 'ca120000-0000-0000-0000-0000000000f1')
      and n.kind like 'call_%'),
  'call_accepted>P19 Factory, call_cancelled>P19 Factory, call_countered>P19 Brand, call_declined>P19 Brand, call_proposed>P19 Factory, call_proposed>P19 Factory',
  'every step notified the other side, and only the other side'
);

select is(
  (select count(*)::int from public.notifications
    where org_id = 'ca120000-0000-0000-0000-00000000000c' and kind like 'call_%'),
  0,
  'the outsider was told nothing'
);

-- ---------------------------------------------------------------------------
-- The server's join helpers
-- ---------------------------------------------------------------------------

set local role service_role;

select is(
  (select should_create from public.claim_call_meeting((select id from public.calls where title = 'P19 counter'))),
  true,
  'the first Join creates the meeting'
);

select is(
  (select should_create::text || ':' || coalesce(meeting_number, 'none')
     from public.claim_call_meeting((select id from public.calls where title = 'P19 counter'))),
  'false:none',
  'a second Join at the same moment waits instead of creating another'
);

select lives_ok(
  $$select public.record_call_meeting((select id from public.calls where title = 'P19 counter'),
                                      '81234567890', 'p19code', 'https://zoom.example/j/81234567890')$$,
  'the server records the meeting'
);

select is(
  (select should_create::text || ':' || meeting_number
     from public.claim_call_meeting((select id from public.calls where title = 'P19 counter'))),
  'false:81234567890',
  'later Joins reuse it'
);

select is(
  (select string_agg(is_party::text, ',' order by u)
     from (values ('ca110000-0000-0000-0000-000000000003'::uuid), ('ca110000-0000-0000-0000-000000000004'::uuid)) as v(u),
          lateral public.call_join_context((select id from public.calls where title = 'P19 counter'), v.u)),
  'true,false',
  'the join check knows a party from an outsider'
);

select * from finish();
rollback;
