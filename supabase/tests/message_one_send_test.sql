-- ============================================================================
-- One send is one message (20261107580000)
-- ----------------------------------------------------------------------------
-- `pgtap107-` prefixed, every count scoped to its own fixtures.
--
-- Chromium resends a POST by itself when a connection closes before the
-- reply, and messages can never be deleted by their sender, so a resend must
-- be refused by the database rather than cleaned up afterwards. The same
-- request twice is the repeat; everything else (another person, another send,
-- the live site's sends with no name) must still save.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

insert into auth.users (id, email) values
  ('1a100000-0000-0000-0000-000000000001', 'p107-brand@example.com'),
  ('1a100000-0000-0000-0000-000000000002', 'p107-brand-colleague@example.com'),
  ('1a100000-0000-0000-0000-000000000003', 'p107-factory@example.com');

insert into public.orgs (id, type, name, slug) values
  ('1a200000-0000-0000-0000-00000000000b', 'brand',   'P107 Brand',   'pgtap107-brand'),
  ('1a200000-0000-0000-0000-0000000000f1', 'factory', 'P107 Factory', 'pgtap107-factory');

insert into public.org_members (org_id, user_id, role) values
  ('1a200000-0000-0000-0000-00000000000b', '1a100000-0000-0000-0000-000000000001', 'owner'),
  ('1a200000-0000-0000-0000-00000000000b', '1a100000-0000-0000-0000-000000000002', 'member'),
  ('1a200000-0000-0000-0000-0000000000f1', '1a100000-0000-0000-0000-000000000003', 'owner');

insert into public.factory_profiles (org_id, country_code, moq, published_at, verification_status) values
  ('1a200000-0000-0000-0000-0000000000f1', 'CN', 100, now(), 'verified');

insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total) values
  ('1a300000-0000-0000-0000-000000000001', '1a200000-0000-0000-0000-00000000000b', 'P107 request', 'open', 'open_to_all', 100);

insert into public.message_threads (id, rfq_id, brand_org_id, factory_org_id) values
  ('1a400000-0000-0000-0000-000000000001', '1a300000-0000-0000-0000-000000000001',
   '1a200000-0000-0000-0000-00000000000b', '1a200000-0000-0000-0000-0000000000f1');

set local request.jwt.claims = '{"sub":"1a100000-0000-0000-0000-000000000001","email":"p107-brand@example.com","role":"authenticated"}';
set local role authenticated;

select lives_ok(
  $$insert into public.messages (thread_id, sender_org_id, sender_user_id, body, client_id)
    values ('1a400000-0000-0000-0000-000000000001', '1a200000-0000-0000-0000-00000000000b',
            '1a100000-0000-0000-0000-000000000001', 'Can you do 300 pieces?',
            '1a500000-0000-0000-0000-000000000001')$$,
  'a send named by the browser saves'
);

select throws_ok(
  $$insert into public.messages (thread_id, sender_org_id, sender_user_id, body, client_id)
    values ('1a400000-0000-0000-0000-000000000001', '1a200000-0000-0000-0000-00000000000b',
            '1a100000-0000-0000-0000-000000000001', 'Can you do 300 pieces?',
            '1a500000-0000-0000-0000-000000000001')$$,
  '23505', null,
  'the same request reaching the database again is refused'
);

select is(
  (select count(*)::int from public.messages
    where thread_id = '1a400000-0000-0000-0000-000000000001'
      and client_id = '1a500000-0000-0000-0000-000000000001'),
  1,
  'so the send is one message'
);

select is(
  (select count(*)::int from public.messages
    where sender_user_id = '1a100000-0000-0000-0000-000000000001'
      and client_id = '1a500000-0000-0000-0000-000000000001'),
  1,
  'and the sender reads it back by the name it gave the send'
);

select lives_ok(
  $$insert into public.messages (thread_id, sender_org_id, sender_user_id, body, client_id)
    values ('1a400000-0000-0000-0000-000000000001', '1a200000-0000-0000-0000-00000000000b',
            '1a100000-0000-0000-0000-000000000001', 'Can you do 300 pieces?',
            '1a500000-0000-0000-0000-000000000002')$$,
  'the same words sent again on purpose are a new message'
);

select lives_ok(
  $$insert into public.messages (thread_id, sender_org_id, sender_user_id, body)
    values ('1a400000-0000-0000-0000-000000000001', '1a200000-0000-0000-0000-00000000000b',
            '1a100000-0000-0000-0000-000000000001', 'From the live site, no name');
    insert into public.messages (thread_id, sender_org_id, sender_user_id, body)
    values ('1a400000-0000-0000-0000-000000000001', '1a200000-0000-0000-0000-00000000000b',
            '1a100000-0000-0000-0000-000000000001', 'From the live site, no name')$$,
  'sends with no name (the site live while this deploys) are never refused'
);

-- Keyed per person: another person's name for a send cannot block yours, or
-- tell you that it exists.
set local request.jwt.claims = '{"sub":"1a100000-0000-0000-0000-000000000002","email":"p107-brand-colleague@example.com","role":"authenticated"}';

select lives_ok(
  $$insert into public.messages (thread_id, sender_org_id, sender_user_id, body, client_id)
    values ('1a400000-0000-0000-0000-000000000001', '1a200000-0000-0000-0000-00000000000b',
            '1a100000-0000-0000-0000-000000000002', 'Same name, another person',
            '1a500000-0000-0000-0000-000000000001')$$,
  'a colleague whose send has the same name still sends'
);

set local request.jwt.claims = '{"sub":"1a100000-0000-0000-0000-000000000003","email":"p107-factory@example.com","role":"authenticated"}';

select lives_ok(
  $$insert into public.messages (thread_id, sender_org_id, sender_user_id, body, client_id)
    values ('1a400000-0000-0000-0000-000000000001', '1a200000-0000-0000-0000-0000000000f1',
            '1a100000-0000-0000-0000-000000000003', 'Same name, the other side',
            '1a500000-0000-0000-0000-000000000001')$$,
  'and so does the other side'
);

select * from finish();
rollback;
