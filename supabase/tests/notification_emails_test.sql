-- ============================================================================
-- Notification emails
-- ----------------------------------------------------------------------------
-- `pgtap20-` prefixed, ids `e8…`, every count scoped to its own fixtures.
--
-- Mostly negative: a company's email switches are its own, nobody in a browser
-- may read or write the email queue or call the sender's functions, and a
-- switch turned off really stops the email.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(34);

insert into auth.users (id, email) values
  ('e8110000-0000-0000-0000-000000000001', 'p20-brand-owner@example.com'),
  ('e8110000-0000-0000-0000-000000000002', 'p20-brand-member@example.com'),
  ('e8110000-0000-0000-0000-000000000003', 'p20-factory@example.com'),
  ('e8110000-0000-0000-0000-000000000004', 'p20-outsider@example.com');

insert into public.orgs (id, type, name, slug) values
  ('e8120000-0000-0000-0000-00000000000b', 'brand',   'P20 Brand',    'pgtap20-brand'),
  ('e8120000-0000-0000-0000-0000000000f1', 'factory', 'P20 Factory',  'pgtap20-factory'),
  ('e8120000-0000-0000-0000-00000000000c', 'brand',   'P20 Outsider', 'pgtap20-outsider');

insert into public.org_members (org_id, user_id, role, permissions) values
  ('e8120000-0000-0000-0000-00000000000b', 'e8110000-0000-0000-0000-000000000001', 'owner', null),
  -- Settings access: the email switches live in Settings.
  ('e8120000-0000-0000-0000-00000000000b', 'e8110000-0000-0000-0000-000000000002', 'member', '{approve,rfqFlow,settingsAccess}'),
  ('e8120000-0000-0000-0000-0000000000f1', 'e8110000-0000-0000-0000-000000000003', 'owner', null),
  ('e8120000-0000-0000-0000-00000000000c', 'e8110000-0000-0000-0000-000000000004', 'owner', null);

-- ---------------------------------------------------------------------------
-- Which switch a kind belongs to
-- ---------------------------------------------------------------------------

select is(public.notification_email_category('quote_received'), 'rfq', 'a quote received is quote activity');
select is(public.notification_email_category('payment_due'), 'payments', 'a payment due is a payment request');
select is(public.notification_email_category('call_proposed'), 'messages', 'a call invite is with messages');
select is(public.notification_email_category('verification_approved'), null, 'verification has its own email, so none here');
select is(public.notification_email_category('message_rejected'), null, 'a rejected message stays in the bell');

-- ---------------------------------------------------------------------------
-- The switches are the company's own
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"e8110000-0000-0000-0000-000000000002","role":"authenticated"}';
set local role authenticated;

select lives_ok(
  $$select public.set_notification_preference('e8120000-0000-0000-0000-00000000000b', 'payments', false)$$,
  'any member of the company turns a switch off'
);

select results_eq(
  $$select rfq_emails, payment_emails, message_emails from public.notification_preferences
     where org_id = 'e8120000-0000-0000-0000-00000000000b'$$,
  $$values (true, false, true)$$,
  'only that switch changed; the others keep the designed default'
);

select throws_ok(
  $$select public.set_notification_preference('e8120000-0000-0000-0000-00000000000b', 'everything', false)$$,
  '22023', null, 'an unknown switch is refused'
);

select throws_ok(
  $$insert into public.notification_preferences (org_id, rfq_emails) values ('e8120000-0000-0000-0000-00000000000b', false)$$,
  '42501', null, 'a member cannot write the table directly'
);

select throws_ok(
  $$update public.notification_preferences set rfq_emails = false where org_id = 'e8120000-0000-0000-0000-00000000000b'$$,
  '42501', null, 'nor update it directly'
);

set local request.jwt.claims = '{"sub":"e8110000-0000-0000-0000-000000000004","role":"authenticated"}';

select is(
  (select count(*)::int from public.notification_preferences where org_id = 'e8120000-0000-0000-0000-00000000000b'),
  0, 'another company cannot read them'
);

select throws_ok(
  $$select public.set_notification_preference('e8120000-0000-0000-0000-00000000000b', 'rfq', false)$$,
  '42501', null, 'nor change them'
);

-- ---------------------------------------------------------------------------
-- Nobody in a browser touches the queue or the sender's functions
-- ---------------------------------------------------------------------------

select throws_ok($$select count(*) from public.notification_email_outbox$$,
  '42501', null, 'a signed-in user cannot read the email queue');
select throws_ok($$select * from public.claim_notification_emails(5)$$,
  '42501', null, 'nor claim emails to send');
select throws_ok($$select public.finish_notification_email('e8150000-0000-0000-0000-000000000001', true)$$,
  '42501', null, 'nor mark one sent');
select throws_ok($$select public.notification_email_enabled('e8120000-0000-0000-0000-00000000000b', 'rfq')$$,
  '42501', null, 'nor ask another company''s switches through the helper');
select throws_ok($$select * from public.queue_notification_emails()$$,
  null, null, 'nor call the trigger function');

reset role;
set local role anon;
select throws_ok($$select count(*) from public.notification_preferences$$,
  '42501', null, 'a signed-out visitor reads no switches');
reset role;

-- ---------------------------------------------------------------------------
-- What is queued
-- ---------------------------------------------------------------------------

insert into public.notifications (id, org_id, kind, subject_type, subject_id, title) values
  ('e8140000-0000-0000-0000-000000000001', 'e8120000-0000-0000-0000-00000000000b', 'quote_received', 'rfq', 'e8130000-0000-0000-0000-000000000001', 'P20 quote'),
  ('e8140000-0000-0000-0000-000000000002', 'e8120000-0000-0000-0000-00000000000b', 'payment_due', 'milestone', 'e8130000-0000-0000-0000-000000000002', 'P20 due'),
  ('e8140000-0000-0000-0000-000000000003', 'e8120000-0000-0000-0000-00000000000b', 'message_rejected', 'thread', 'e8130000-0000-0000-0000-000000000003', 'P20 rejected');

select is(
  (select count(*)::int from public.notification_email_outbox where notification_id = 'e8140000-0000-0000-0000-000000000001'),
  2, 'a quote received is queued once for each member of the company'
);
select is(
  (select count(*)::int from public.notification_email_outbox where notification_id = 'e8140000-0000-0000-0000-000000000002'),
  0, 'with payment emails off, a payment due is not queued'
);
select is(
  (select count(*)::int from public.notification_email_outbox where notification_id = 'e8140000-0000-0000-0000-000000000003'),
  0, 'an in-app-only kind is not queued'
);

-- At most one message email per person per conversation every 6 hours.
insert into public.notifications (id, org_id, kind, subject_type, subject_id, title) values
  ('e8140000-0000-0000-0000-000000000011', 'e8120000-0000-0000-0000-0000000000f1', 'message', 'thread', 'e8130000-0000-0000-0000-0000000000a1', 'P20 m1');
insert into public.notifications (id, org_id, kind, subject_type, subject_id, title) values
  ('e8140000-0000-0000-0000-000000000012', 'e8120000-0000-0000-0000-0000000000f1', 'message', 'thread', 'e8130000-0000-0000-0000-0000000000a1', 'P20 m2'),
  ('e8140000-0000-0000-0000-000000000013', 'e8120000-0000-0000-0000-0000000000f1', 'message', 'thread', 'e8130000-0000-0000-0000-0000000000a2', 'P20 m3');

select is(
  (select count(*)::int from public.notification_email_outbox
    where notification_id in ('e8140000-0000-0000-0000-000000000011', 'e8140000-0000-0000-0000-000000000012')),
  1, 'a second message in the same conversation is not emailed again'
);
select is(
  (select count(*)::int from public.notification_email_outbox where notification_id = 'e8140000-0000-0000-0000-000000000013'),
  1, 'a message in another conversation is'
);

-- ---------------------------------------------------------------------------
-- The sender (service role)
-- ---------------------------------------------------------------------------

-- Park everything that is not ours, so the claim below sees only fixtures.
update public.notification_email_outbox
   set next_attempt_at = now() + interval '1 day'
 where org_id not in ('e8120000-0000-0000-0000-00000000000b', 'e8120000-0000-0000-0000-0000000000f1')
   and status = 'pending';

-- The factory turns message emails off after they were queued.
set local request.jwt.claims = '{"sub":"e8110000-0000-0000-0000-000000000003","role":"authenticated"}';
set local role authenticated;
select lives_ok(
  $$select public.set_notification_preference('e8120000-0000-0000-0000-0000000000f1', 'messages', false)$$,
  'the factory turns message emails off'
);
reset role;

set local role service_role;

create temporary table p20_claimed on commit drop as
  select * from public.claim_notification_emails(100);

select is(
  (select count(*)::int from p20_claimed where org_id = 'e8120000-0000-0000-0000-00000000000b'),
  2, 'the sender claims both quote emails'
);
select ok(
  (select bool_and(title = 'P20 quote' and kind = 'quote_received' and org_name = 'P20 Brand' and attempts = 1)
     from p20_claimed where org_id = 'e8120000-0000-0000-0000-00000000000b'),
  'with what it needs to write them, counted as a first attempt'
);
select is(
  (select count(*)::int from p20_claimed where org_id = 'e8120000-0000-0000-0000-0000000000f1'),
  0, 'a switch turned off after queueing stops the email'
);
select is(
  (select count(*)::int from public.notification_email_outbox
    where org_id = 'e8120000-0000-0000-0000-0000000000f1' and status = 'skipped'),
  2, 'and those emails are marked skipped, not left waiting'
);
select is(
  (select count(*)::int from public.claim_notification_emails(100) where org_id = 'e8120000-0000-0000-0000-00000000000b'),
  0, 'a claimed email is not handed out twice'
);

select public.finish_notification_email(
  (select id from p20_claimed where org_id = 'e8120000-0000-0000-0000-00000000000b' order by id limit 1), false, null, 'P20 provider down');
select public.finish_notification_email(
  (select id from p20_claimed where org_id = 'e8120000-0000-0000-0000-00000000000b' order by id desc limit 1), true, 'p20-provider-id', null);

select results_eq(
  $$select status, last_error, next_attempt_at > now() from public.notification_email_outbox
     where id = (select id from p20_claimed where org_id = 'e8120000-0000-0000-0000-00000000000b' order by id limit 1)$$,
  $$values ('pending'::text, 'P20 provider down'::text, true)$$,
  'a failed send waits and tries again later'
);
select results_eq(
  $$select status, provider_id, sent_at is not null from public.notification_email_outbox
     where id = (select id from p20_claimed where org_id = 'e8120000-0000-0000-0000-00000000000b' order by id desc limit 1)$$,
  $$values ('sent'::text, 'p20-provider-id'::text, true)$$,
  'a delivered one is marked sent with the provider''s id'
);

update public.notification_email_outbox set attempts = 5, status = 'sending'
 where id = (select id from p20_claimed where org_id = 'e8120000-0000-0000-0000-00000000000b' order by id limit 1);
select public.finish_notification_email(
  (select id from p20_claimed where org_id = 'e8120000-0000-0000-0000-00000000000b' order by id limit 1), false, null, 'P20 still down');
select is(
  (select status from public.notification_email_outbox
    where id = (select id from p20_claimed where org_id = 'e8120000-0000-0000-0000-00000000000b' order by id limit 1)),
  'failed', 'after the fifth try it gives up'
);

reset role;

-- A notification whose queueing fails must still be written.
select lives_ok(
  $$insert into public.notifications (org_id, kind, title) values ('e8120000-0000-0000-0000-00000000000c', 'quote_received', 'P20 never blocks')$$,
  'the action that notifies never waits on email'
);

select is(
  (select count(*)::int from public.notification_email_outbox o
     join public.notifications n on n.id = o.notification_id
    where n.title = 'P20 never blocks'),
  1, 'and the outsider''s own quote email is queued for its member'
);

select * from finish();

rollback;
