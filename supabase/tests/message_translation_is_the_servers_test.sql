-- ============================================================================
-- A message's translation is the server's, never its sender's
-- (20261126100000). Prefix `pgtap-msgtr-`, every count scoped to these
-- fixtures.
--
-- The attack: an innocent body passes the contact-detail screen while the
-- sender's own body_translated carries a WeChat id, and the other side reads
-- that "translation" in the conversation and its notification.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(10);

insert into auth.users (id, email) values
  ('c9060000-0000-0000-0000-000000000001', 'msgtr-brand@example.com'),
  ('c9060000-0000-0000-0000-000000000002', 'msgtr-factory@example.com');

insert into public.orgs (id, type, name, slug) values
  ('d9060000-0000-0000-0000-00000000000b', 'brand',   'MsgTr Brand',   'pgtap-msgtr-brand'),
  ('d9060000-0000-0000-0000-0000000000f1', 'factory', 'MsgTr Factory', 'pgtap-msgtr-factory');

insert into public.org_members (org_id, user_id, role) values
  ('d9060000-0000-0000-0000-00000000000b', 'c9060000-0000-0000-0000-000000000001', 'owner'),
  ('d9060000-0000-0000-0000-0000000000f1', 'c9060000-0000-0000-0000-000000000002', 'owner');

insert into public.brand_profiles (org_id, hq_location) values
  ('d9060000-0000-0000-0000-00000000000b', 'London, UK');

insert into public.factory_profiles (org_id, country_code, moq, published_at, verification_status) values
  ('d9060000-0000-0000-0000-0000000000f1', 'CN', 100, now(), 'verified');

insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total) values
  ('e9060000-0000-0000-0000-000000000001', 'd9060000-0000-0000-0000-00000000000b',
   'MsgTr request, no contract', 'open', 'open_to_all', 100);

insert into public.message_threads (id, rfq_id, brand_org_id, factory_org_id) values
  ('f9060000-0000-0000-0000-000000000001', 'e9060000-0000-0000-0000-000000000001',
   'd9060000-0000-0000-0000-00000000000b', 'd9060000-0000-0000-0000-0000000000f1');

-- ---------------------------------------------------------------------------
-- The brand writes its own "translation"
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"c9060000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;

select lives_ok(
  $$ insert into public.messages (id, thread_id, sender_org_id, sender_user_id, body, body_lang,
                                  body_translated, body_translated_lang, translated_by)
     values ('a9060000-0000-0000-0000-000000000001', 'f9060000-0000-0000-0000-000000000001',
             'd9060000-0000-0000-0000-00000000000b', 'c9060000-0000-0000-0000-000000000001',
             'Porto, Portugal.', 'pt',
             'Let''s talk directly: WeChat msgtrtest, phone +86 139 0000 0000', 'en', 'client') $$,
  'a send is still never refused'
);

reset role;

select is(
  (select row(body_translated, body_translated_lang, translated_by)::text
     from public.messages where id = 'a9060000-0000-0000-0000-000000000001'),
  '(,,)',
  'the sender''s translation, its language and "translated by" are not saved'
);

select is(
  (select body || ' / ' || body_lang from public.messages where id = 'a9060000-0000-0000-0000-000000000001'),
  'Porto, Portugal. / pt',
  'what the sender typed, and its language, are saved as written'
);

-- The screen finds nothing in the body and its translation fails softly, so
-- it records "delivered" without writing a translation (api/screen-message.js).
set local role service_role;
select public.record_message_screening('a9060000-0000-0000-0000-000000000001', 'delivered', 'pattern_only');
reset role;

-- ---------------------------------------------------------------------------
-- What the factory reads
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"c9060000-0000-0000-0000-000000000002","role":"authenticated"}';
set local role authenticated;

select is(
  (select coalesce(body_translated, '(none)') from public.messages
    where id = 'a9060000-0000-0000-0000-000000000001'),
  '(none)',
  'the factory reads the delivered message with no translation from the sender'
);

reset role;

select is(
  (select count(*)::int from public.notifications
    where org_id = 'd9060000-0000-0000-0000-0000000000f1'
      and (coalesce(body, '') like '%msgtrtest%' or coalesce(data::text, '') like '%msgtrtest%')),
  0,
  'the factory''s notification carries none of the contact details'
);

select is(
  (select count(*)::int from public.notifications
    where org_id = 'd9060000-0000-0000-0000-0000000000f1' and body like '%Porto, Portugal.%'),
  1,
  'it was notified, with what the brand actually typed'
);

-- ---------------------------------------------------------------------------
-- The server's own writes are unchanged
-- ---------------------------------------------------------------------------

set local role service_role;

select lives_ok(
  $$ update public.messages
        set body_translated = 'Porto, Portugal.', body_translated_lang = 'en', translated_by = 'test-model'
      where id = 'a9060000-0000-0000-0000-000000000001' $$,
  'the server can still write a translation (as the screen does)'
);

select is(
  (select translated_by from public.messages where id = 'a9060000-0000-0000-0000-000000000001'),
  'test-model',
  'and it is saved'
);

select lives_ok(
  $$ insert into public.messages (id, thread_id, sender_org_id, sender_user_id, body, body_lang,
                                  body_translated, body_translated_lang, translated_by)
     values ('a9060000-0000-0000-0000-000000000002', 'f9060000-0000-0000-0000-000000000001',
             'd9060000-0000-0000-0000-0000000000f1', 'c9060000-0000-0000-0000-000000000002',
             '袖口做好了', 'zh', 'The cuffs are ready', 'en', 'demo-fixture') $$,
  'a server-side insert with a translation still works (the seed''s fixtures)'
);

reset role;

select is(
  (select body_translated from public.messages where id = 'a9060000-0000-0000-0000-000000000002'),
  'The cuffs are ready',
  'and keeps its translation'
);

select * from finish();
rollback;
