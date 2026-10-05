-- ============================================================================
-- Held messages
-- ----------------------------------------------------------------------------
-- `pgtap15-` prefixed, every count scoped to its own fixtures.
--
-- A held message exists to stop contact details reaching the other side, so
-- the assertions that matter are negative: while a message is held the
-- recipient must not see it in any form (the row, the thread preview, the
-- counts, a notification, the thread jumping up their list, its attachment),
-- the sender must not be able to deliver it themselves, and nobody but staff
-- may decide it. A positive test that a release delivers passes just as
-- happily when the hiding is broken.
--
-- Timestamps: everything in one transaction shares one now(), so the fixtures
-- move created_at and last_read_at back by hand where order matters.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(58);

insert into auth.users (id, email) values
  ('b1000000-0000-0000-0000-000000000001', 'p15-brand@example.com'),
  ('b1000000-0000-0000-0000-000000000002', 'p15-brand-colleague@example.com'),
  ('b1000000-0000-0000-0000-000000000003', 'p15-factory@example.com'),
  ('b1000000-0000-0000-0000-000000000004', 'p15-outsider@example.com'),
  ('b1000000-0000-0000-0000-000000000005', 'p15-admin@example.com');

insert into public.platform_admins (user_id, note)
values ('b1000000-0000-0000-0000-000000000005', 'pgtap15 fixture');

insert into public.orgs (id, type, name, slug) values
  ('b2000000-0000-0000-0000-00000000000b', 'brand',   'P15 Brand',    'pgtap15-brand'),
  ('b2000000-0000-0000-0000-0000000000f1', 'factory', 'P15 Factory',  'pgtap15-factory'),
  ('b2000000-0000-0000-0000-00000000000c', 'brand',   'P15 Outsider', 'pgtap15-outsider');

insert into public.org_members (org_id, user_id, role) values
  ('b2000000-0000-0000-0000-00000000000b', 'b1000000-0000-0000-0000-000000000001', 'owner'),
  ('b2000000-0000-0000-0000-00000000000b', 'b1000000-0000-0000-0000-000000000002', 'member'),
  ('b2000000-0000-0000-0000-0000000000f1', 'b1000000-0000-0000-0000-000000000003', 'owner'),
  ('b2000000-0000-0000-0000-00000000000c', 'b1000000-0000-0000-0000-000000000004', 'owner');

insert into public.brand_profiles (org_id, hq_location) values
  ('b2000000-0000-0000-0000-00000000000b', 'London, UK'),
  ('b2000000-0000-0000-0000-00000000000c', 'Berlin, DE');

insert into public.factory_profiles (org_id, country_code, moq, published_at, verification_status) values
  ('b2000000-0000-0000-0000-0000000000f1', 'CN', 100, now(), 'verified');

insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total) values
  ('b3000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-00000000000b', 'P15 plain',    'open', 'open_to_all', 100),
  ('b3000000-0000-0000-0000-000000000002', 'b2000000-0000-0000-0000-00000000000b', 'P15 held',     'open', 'open_to_all', 100),
  ('b3000000-0000-0000-0000-000000000003', 'b2000000-0000-0000-0000-00000000000b', 'P15 rejected', 'open', 'open_to_all', 100);

-- T1 holds an ordinary message, T2 one that gets held and released, T3 one
-- that gets rejected (and two still being checked).
insert into public.message_threads (id, rfq_id, brand_org_id, factory_org_id) values
  ('b4000000-0000-0000-0000-000000000001', 'b3000000-0000-0000-0000-000000000001',
   'b2000000-0000-0000-0000-00000000000b', 'b2000000-0000-0000-0000-0000000000f1'),
  ('b4000000-0000-0000-0000-000000000002', 'b3000000-0000-0000-0000-000000000002',
   'b2000000-0000-0000-0000-00000000000b', 'b2000000-0000-0000-0000-0000000000f1'),
  ('b4000000-0000-0000-0000-000000000003', 'b3000000-0000-0000-0000-000000000003',
   'b2000000-0000-0000-0000-00000000000b', 'b2000000-0000-0000-0000-0000000000f1');

-- ---------------------------------------------------------------------------
-- Sending
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"b1000000-0000-0000-0000-000000000001","email":"p15-brand@example.com","role":"authenticated"}';
set local role authenticated;

select lives_ok(
  $$insert into public.messages (id, thread_id, sender_org_id, sender_user_id, body)
    values ('b5000000-0000-0000-0000-000000000002', 'b4000000-0000-0000-0000-000000000001',
            'b2000000-0000-0000-0000-00000000000b', 'b1000000-0000-0000-0000-000000000001',
            'Hello, can you do 300 pieces?')$$,
  'an ordinary send still works exactly as before'
);

select is(
  (select delivery || ':' || (delivered_at is not null)::text
     from public.messages where id = 'b5000000-0000-0000-0000-000000000002'),
  'delivered:true',
  'and is delivered, with a delivery time'
);

select lives_ok(
  $$insert into public.messages (id, thread_id, sender_org_id, sender_user_id, body, delivery,
                                 delivered_at, review_note)
    values ('b5000000-0000-0000-0000-000000000001', 'b4000000-0000-0000-0000-000000000002',
            'b2000000-0000-0000-0000-00000000000b', 'b1000000-0000-0000-0000-000000000001',
            'Easier by email: buyer@p15-brand.example', 'checking', now(), 'self-approved')$$,
  'a sender may ask for its message to be checked first'
);

select is(
  (select (delivered_at is null and review_note is null)
     from public.messages where id = 'b5000000-0000-0000-0000-000000000001'),
  true,
  'a sender CANNOT write its own delivery time or review note (both are cleared)'
);

select throws_ok(
  $$insert into public.messages (thread_id, sender_org_id, sender_user_id, body, delivery)
    values ('b4000000-0000-0000-0000-000000000002', 'b2000000-0000-0000-0000-00000000000b',
            'b1000000-0000-0000-0000-000000000001', 'Straight to held', 'held')$$,
  '42501',
  null,
  'a sender CANNOT write a message straight into held'
);

select throws_ok(
  $$insert into public.messages (thread_id, sender_org_id, sender_user_id, body, delivery)
    values ('b4000000-0000-0000-0000-000000000002', 'b2000000-0000-0000-0000-00000000000b',
            'b1000000-0000-0000-0000-000000000001', 'Straight to rejected', 'rejected')$$,
  '42501',
  null,
  'or into rejected'
);

-- The rest of the fixtures: the message on T3 to be rejected, one stuck at
-- checking, and one just sent.
insert into public.messages (id, thread_id, sender_org_id, sender_user_id, body, delivery) values
  ('b5000000-0000-0000-0000-000000000003', 'b4000000-0000-0000-0000-000000000003',
   'b2000000-0000-0000-0000-00000000000b', 'b1000000-0000-0000-0000-000000000001',
   'Add me on WeChat: p15brand', 'checking'),
  ('b5000000-0000-0000-0000-000000000004', 'b4000000-0000-0000-0000-000000000003',
   'b2000000-0000-0000-0000-00000000000b', 'b1000000-0000-0000-0000-000000000001',
   'Stuck while being checked', 'checking'),
  ('b5000000-0000-0000-0000-000000000005', 'b4000000-0000-0000-0000-000000000003',
   'b2000000-0000-0000-0000-00000000000b', 'b1000000-0000-0000-0000-000000000001',
   'Just sent', 'checking');

reset role;

-- Attachments: one on the ordinary message, one on the message to be held.
insert into public.documents (id, org_id, kind, bucket, storage_path, file_name, message_id) values
  ('b6000000-0000-0000-0000-000000000002', 'b2000000-0000-0000-0000-00000000000b', 'message_attachment',
   'org-private', 'b2000000-0000-0000-0000-00000000000b/message_attachment/b4000000-0000-0000-0000-000000000001/plain.pdf',
   'plain.pdf', 'b5000000-0000-0000-0000-000000000002'),
  ('b6000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-00000000000b', 'message_attachment',
   'org-private', 'b2000000-0000-0000-0000-00000000000b/message_attachment/b4000000-0000-0000-0000-000000000002/card.pdf',
   'card.pdf', 'b5000000-0000-0000-0000-000000000001');

insert into storage.objects (bucket_id, name) values
  ('org-private', 'b2000000-0000-0000-0000-00000000000b/message_attachment/b4000000-0000-0000-0000-000000000001/plain.pdf'),
  ('org-private', 'b2000000-0000-0000-0000-00000000000b/message_attachment/b4000000-0000-0000-0000-000000000002/card.pdf');

-- Order in time: the held message was written an hour ago, the ordinary one
-- 45 minutes ago, and the factory last opened both threads 30 minutes ago.
-- One message was stuck at checking ten minutes ago.
update public.messages set created_at = now() - interval '1 hour'
 where id = 'b5000000-0000-0000-0000-000000000001';
update public.messages set created_at = now() - interval '45 minutes',
                           delivered_at = now() - interval '45 minutes'
 where id = 'b5000000-0000-0000-0000-000000000002';
update public.messages set created_at = now() - interval '10 minutes'
 where id in ('b5000000-0000-0000-0000-000000000003', 'b5000000-0000-0000-0000-000000000004');

insert into public.message_reads (thread_id, user_id, last_read_at) values
  ('b4000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000003', now() - interval '50 minutes'),
  ('b4000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000003', now() - interval '30 minutes');

-- ---------------------------------------------------------------------------
-- The screen's verdict is the server's alone
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"b1000000-0000-0000-0000-000000000001","email":"p15-brand@example.com","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$select public.record_message_screening('b5000000-0000-0000-0000-000000000001', 'delivered', 'ai')$$,
  '42501',
  null,
  'a sender CANNOT deliver its own message by recording a verdict'
);

select throws_ok(
  $$select public.announce_message('b5000000-0000-0000-0000-000000000001')$$,
  '42501',
  null,
  'or by announcing it'
);

do $$
begin
  update public.messages set delivery = 'delivered', delivered_at = now()
   where id = 'b5000000-0000-0000-0000-000000000001';
exception when insufficient_privilege then null;
end $$;

reset role;

select is(
  (select delivery from public.messages where id = 'b5000000-0000-0000-0000-000000000001'),
  'checking',
  'a sender CANNOT update its message out of checking'
);

set local role service_role;

select lives_ok(
  $$select public.record_message_screening('b5000000-0000-0000-0000-000000000001', 'held',
                                           'pattern', 'email address', null)$$,
  'the server records the verdict'
);

select lives_ok(
  $$select public.record_message_screening('b5000000-0000-0000-0000-000000000003', 'held',
                                           'ai', 'asks to move to WeChat', 'test-model')$$,
  'for each message it checks'
);

reset role;

select is(
  (select delivery from public.messages where id = 'b5000000-0000-0000-0000-000000000001'),
  'held',
  'and the message is held'
);

-- ---------------------------------------------------------------------------
-- While it is held, the recipient sees nothing of it
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"b1000000-0000-0000-0000-000000000003","email":"p15-factory@example.com","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$select public.record_message_screening('b5000000-0000-0000-0000-000000000001', 'delivered', 'ai')$$,
  '42501',
  null,
  'the recipient CANNOT record a verdict either'
);

select is(
  (select count(*)::int from public.messages
    where id in ('b5000000-0000-0000-0000-000000000001', 'b5000000-0000-0000-0000-000000000003',
                 'b5000000-0000-0000-0000-000000000004', 'b5000000-0000-0000-0000-000000000005')),
  0,
  'the recipient CANNOT read a held message, or one still being checked'
);

select is(
  (select count(*)::int from public.messages where id = 'b5000000-0000-0000-0000-000000000002'),
  1,
  'while it reads the ordinary one'
);

select is(
  (select coalesce(last_body, '(none)') || '|' || message_count || '|' || unread_count
     from public.message_thread_summary where id = 'b4000000-0000-0000-0000-000000000002'),
  '(none)|0|0',
  'the held thread shows the recipient no preview, no messages and nothing unread'
);

select is(
  (select last_body || '|' || message_count || '|' || unread_count
     from public.message_thread_summary where id = 'b4000000-0000-0000-0000-000000000001'),
  'Hello, can you do 300 pieces?|1|1',
  'while the ordinary thread shows its message, counted and unread'
);

select is(
  (select count(*)::int from public.notifications
    where org_id = 'b2000000-0000-0000-0000-0000000000f1'
      and subject_id in ('b4000000-0000-0000-0000-000000000002', 'b4000000-0000-0000-0000-000000000003')),
  0,
  'the recipient is NOT notified of a held message'
);

select is(
  (select count(*)::int from public.notifications
    where org_id = 'b2000000-0000-0000-0000-0000000000f1'
      and subject_id = 'b4000000-0000-0000-0000-000000000001' and kind = 'message'),
  1,
  'while the ordinary message notified it as before'
);

select is(
  (select last_message_at from public.message_threads where id = 'b4000000-0000-0000-0000-000000000002'),
  null,
  'a held message does NOT move the thread up the recipient''s list'
);

select is(
  (select count(*)::int from public.documents where id = 'b6000000-0000-0000-0000-000000000001'),
  0,
  'the recipient CANNOT see a held message''s attachment'
);

select is(
  (select count(*)::int from storage.objects
    where name = 'b2000000-0000-0000-0000-00000000000b/message_attachment/b4000000-0000-0000-0000-000000000002/card.pdf'),
  0,
  'or read the file itself from storage'
);

select is(
  (select count(*)::int from storage.objects
    where name = 'b2000000-0000-0000-0000-00000000000b/message_attachment/b4000000-0000-0000-0000-000000000001/plain.pdf'),
  1,
  'while the ordinary message''s file is readable as before'
);

select throws_ok(
  $$select count(*) from public.message_screenings$$,
  '42501',
  null,
  'nobody outside staff can read what the screen found'
);

-- ---------------------------------------------------------------------------
-- The sender's company sees its own
-- ---------------------------------------------------------------------------

reset role;
set local request.jwt.claims = '{"sub":"b1000000-0000-0000-0000-000000000001","email":"p15-brand@example.com","role":"authenticated"}';
set local role authenticated;

select is(
  (select delivery from public.messages where id = 'b5000000-0000-0000-0000-000000000001'),
  'held',
  'the sender sees its message, and that it is held'
);

select is(
  (select last_body from public.message_thread_summary where id = 'b4000000-0000-0000-0000-000000000002'),
  'Easier by email: buyer@p15-brand.example',
  'and as its own last message in the thread'
);

select throws_ok(
  $$select count(*) from public.message_screenings$$,
  '42501',
  null,
  'but not what the screen found'
);

reset role;
set local request.jwt.claims = '{"sub":"b1000000-0000-0000-0000-000000000002","email":"p15-brand-colleague@example.com","role":"authenticated"}';
set local role authenticated;

select is(
  (select count(*)::int from public.messages
    where id in ('b5000000-0000-0000-0000-000000000001', 'b5000000-0000-0000-0000-000000000003')),
  2,
  'a colleague at the sender sees the held messages too'
);

select is(
  (select unread_count from public.message_thread_summary where id = 'b4000000-0000-0000-0000-000000000002'),
  0,
  'without them counting as unread'
);

reset role;
set local request.jwt.claims = '{"sub":"b1000000-0000-0000-0000-000000000004","email":"p15-outsider@example.com","role":"authenticated"}';
set local role authenticated;

select is(
  (select count(*)::int from public.messages
    where id in ('b5000000-0000-0000-0000-000000000001', 'b5000000-0000-0000-0000-000000000002')),
  0,
  'an outsider sees neither'
);

-- ---------------------------------------------------------------------------
-- Only staff decide
-- ---------------------------------------------------------------------------

select throws_ok(
  $$select public.admin_message_queue()$$,
  '42501',
  null,
  'an outsider CANNOT open the queue'
);

reset role;
set local request.jwt.claims = '{"sub":"b1000000-0000-0000-0000-000000000001","email":"p15-brand@example.com","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$select public.release_held_message('b5000000-0000-0000-0000-000000000001')$$,
  '42501',
  null,
  'the sender CANNOT release its own held message'
);

select throws_ok(
  $$select public.admin_message_queue()$$,
  '42501',
  null,
  'or open the queue'
);

reset role;
set local request.jwt.claims = '{"sub":"b1000000-0000-0000-0000-000000000003","email":"p15-factory@example.com","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$select public.release_held_message('b5000000-0000-0000-0000-000000000001')$$,
  '42501',
  null,
  'the recipient CANNOT release it to itself'
);

select throws_ok(
  $$select public.reject_held_message('b5000000-0000-0000-0000-000000000001', 'no')$$,
  '42501',
  null,
  'or reject it'
);

select throws_ok(
  $$select public.release_held_message('b5000000-0000-0000-0000-0000000000ff')$$,
  '42501',
  null,
  'and a made-up id is refused the same way (no hint that it does not exist)'
);

-- ---------------------------------------------------------------------------
-- Staff
-- ---------------------------------------------------------------------------

reset role;
set local request.jwt.claims = '{"sub":"b1000000-0000-0000-0000-000000000005","email":"p15-admin@example.com","role":"authenticated"}';
set local role authenticated;

select is(
  (select array_agg(message_id order by sent_at)::text from public.admin_message_queue()
    where message_id::text like 'b5000000-%'),
  '{b5000000-0000-0000-0000-000000000001,b5000000-0000-0000-0000-000000000003,b5000000-0000-0000-0000-000000000004}',
  'the queue holds the held messages and the one stuck at checking, oldest first; not the ordinary one, or one just sent'
);

select is(
  (select sender_side || '|' || sender_name || '|' || subject_title || '|' || method || '|' || reason || '|' || file_names::text
     from public.admin_message_queue() where message_id = 'b5000000-0000-0000-0000-000000000001'),
  'brand|P15 Brand|P15 held|pattern|email address|{card.pdf}',
  'and says who sent it, about what, why it was held, and which files travel with it'
);

select is(
  (select delivery || '|' || coalesce(method, '(not checked)')
     from public.admin_message_queue() where message_id = 'b5000000-0000-0000-0000-000000000004'),
  'checking|(not checked)',
  'a message stuck at checking shows as not checked'
);

select throws_ok(
  $$select public.reject_held_message('b5000000-0000-0000-0000-000000000003', '  ')$$,
  '22023',
  null,
  'a reject needs a reason, because the sender sees it'
);

select throws_ok(
  $$select public.release_held_message('b5000000-0000-0000-0000-000000000002')$$,
  '22023',
  null,
  'an ordinary, delivered message cannot be "released"'
);

select throws_ok(
  $$select public.release_held_message('b5000000-0000-0000-0000-000000000005')$$,
  '22023',
  null,
  'nor one the screen is still checking'
);

select lives_ok(
  $$select public.release_held_message('b5000000-0000-0000-0000-000000000001', 'supplier email shared by mistake, fine')$$,
  'staff release a held message'
);

select lives_ok(
  $$select public.reject_held_message('b5000000-0000-0000-0000-000000000003', 'Please keep contact details on the platform.')$$,
  'and reject another'
);

select lives_ok(
  $$select public.release_held_message('b5000000-0000-0000-0000-000000000004')$$,
  'and can release one stuck at checking'
);

select throws_ok(
  $$select public.reject_held_message('b5000000-0000-0000-0000-000000000003', 'again')$$,
  '22023',
  null,
  'a decided message cannot be decided again'
);

-- ---------------------------------------------------------------------------
-- After a release, the recipient has it as a new message
-- ---------------------------------------------------------------------------

reset role;
set local request.jwt.claims = '{"sub":"b1000000-0000-0000-0000-000000000003","email":"p15-factory@example.com","role":"authenticated"}';
set local role authenticated;

select is(
  (select count(*)::int from public.messages where id = 'b5000000-0000-0000-0000-000000000001'),
  1,
  'the recipient now reads the released message'
);

select is(
  (select unread_count from public.message_thread_summary where id = 'b4000000-0000-0000-0000-000000000002'),
  1,
  'as unread, although it was written before the recipient last opened the thread'
);

select is(
  (select count(*)::int from public.notifications
    where org_id = 'b2000000-0000-0000-0000-0000000000f1'
      and subject_id = 'b4000000-0000-0000-0000-000000000002' and kind = 'message'),
  1,
  'and is notified of it, as for any message'
);

select is(
  (select count(*)::int from storage.objects
    where name = 'b2000000-0000-0000-0000-00000000000b/message_attachment/b4000000-0000-0000-0000-000000000002/card.pdf'),
  1,
  'its file is released with it'
);

select isnt(
  (select last_message_at from public.message_threads where id = 'b4000000-0000-0000-0000-000000000002'),
  null,
  'and the thread moves up the recipient''s list'
);

select is(
  (select count(*)::int from public.messages where id = 'b5000000-0000-0000-0000-000000000003'),
  0,
  'a rejected message is never shown to the recipient'
);

select is(
  (select count(*)::int from public.notifications
    where org_id = 'b2000000-0000-0000-0000-0000000000f1'
      and subject_id = 'b4000000-0000-0000-0000-000000000003' and kind = 'message'),
  1,
  'which was notified of the stuck message staff released, and of nothing else on that thread'
);

-- ---------------------------------------------------------------------------
-- And the sender is told about a reject, not about a release
-- ---------------------------------------------------------------------------

reset role;
set local request.jwt.claims = '{"sub":"b1000000-0000-0000-0000-000000000001","email":"p15-brand@example.com","role":"authenticated"}';
set local role authenticated;

select is(
  (select delivery || '|' || review_note from public.messages where id = 'b5000000-0000-0000-0000-000000000003'),
  'rejected|Please keep contact details on the platform.',
  'the sender sees its rejected message with the reason'
);

select is(
  (select title || '|' || body from public.notifications
    where org_id = 'b2000000-0000-0000-0000-00000000000b' and kind = 'message_rejected'
      and subject_id = 'b4000000-0000-0000-0000-000000000003'),
  'Your message to P15 Factory about P15 rejected was not delivered|Please keep contact details on the platform.',
  'and its company is notified, with the reason'
);

select is(
  (select count(*)::int from public.notifications
    where org_id = 'b2000000-0000-0000-0000-00000000000b'
      and subject_id = 'b4000000-0000-0000-0000-000000000002'),
  0,
  'a release sends the sender nothing'
);

reset role;
set local role service_role;

select is(
  (select delivery from public.record_message_screening('b5000000-0000-0000-0000-000000000003', 'delivered', 'ai')),
  'rejected',
  'a late or repeated verdict changes nothing once staff have decided'
);

reset role;

select is(
  (select decision || '|' || (decided_by = 'b1000000-0000-0000-0000-000000000005')::text || '|' || method
     from public.message_screenings where message_id = 'b5000000-0000-0000-0000-000000000003'),
  'rejected|true|ai',
  'the decision is recorded beside the verdict, with who made it'
);

select * from finish();
rollback;
