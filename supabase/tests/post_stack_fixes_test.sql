-- ============================================================================
-- Fixes after the conversations / calls / notifications / admin / credits
-- stack (20261026000500, 20261026000600, 20261026000700)
-- ----------------------------------------------------------------------------
-- `pgtap-psb-` prefixed, every count scoped to its own fixtures.
--
-- Mostly negative, as the access suites are: a staff member who also belongs
-- to a company must NOT read the other side's held message through the
-- company's inbox, staff must NOT create a company, a repeated approval must
-- NOT tell the company twice.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

insert into auth.users (id, email) values
  ('f9a10000-0000-0000-0000-000000000001', 'psb-staff-brand@example.com'),
  ('f9a10000-0000-0000-0000-000000000002', 'psb-factory@example.com'),
  ('f9a10000-0000-0000-0000-000000000003', 'psb-staff@example.com');

-- 1: staff AND the brand's owner (John's production account). 3: staff only.
insert into public.platform_admins (user_id, note) values
  ('f9a10000-0000-0000-0000-000000000001', 'pgtap-psb fixture'),
  ('f9a10000-0000-0000-0000-000000000003', 'pgtap-psb fixture');

insert into public.orgs (id, type, name, slug) values
  ('f9a20000-0000-0000-0000-00000000000b', 'brand',   'PSB Brand',    'pgtap-psb-brand'),
  ('f9a20000-0000-0000-0000-0000000000f1', 'factory', 'PSB Factory',  'pgtap-psb-factory'),
  ('f9a20000-0000-0000-0000-0000000000f2', 'factory', 'PSB Verified', 'pgtap-psb-verified');

insert into public.org_members (org_id, user_id, role) values
  ('f9a20000-0000-0000-0000-00000000000b', 'f9a10000-0000-0000-0000-000000000001', 'owner'),
  ('f9a20000-0000-0000-0000-0000000000f1', 'f9a10000-0000-0000-0000-000000000002', 'owner');

insert into public.brand_profiles (org_id, hq_location) values
  ('f9a20000-0000-0000-0000-00000000000b', 'London, UK');

insert into public.factory_profiles (org_id, country_code, moq, published_at, verification_status, onboarding_completed_at) values
  ('f9a20000-0000-0000-0000-0000000000f1', 'CN', 100, now(), 'pending', now()),
  ('f9a20000-0000-0000-0000-0000000000f2', 'CN', 100, now(), 'verified', now());

insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total) values
  ('f9a30000-0000-0000-0000-000000000001', 'f9a20000-0000-0000-0000-00000000000b', 'PSB request', 'open', 'open_to_all', 100);

insert into public.message_threads (id, rfq_id, brand_org_id, factory_org_id) values
  ('f9a40000-0000-0000-0000-000000000001', 'f9a30000-0000-0000-0000-000000000001',
   'f9a20000-0000-0000-0000-00000000000b', 'f9a20000-0000-0000-0000-0000000000f1');

-- The factory writes twice: once in Chinese (translated to English), then
-- once with a phone number, which is held.
set local request.jwt.claims = '{"sub":"f9a10000-0000-0000-0000-000000000002","role":"authenticated"}';
set local role authenticated;
insert into public.messages (id, thread_id, sender_org_id, sender_user_id, body) values
  ('f9a50000-0000-0000-0000-000000000001', 'f9a40000-0000-0000-0000-000000000001',
   'f9a20000-0000-0000-0000-0000000000f1', 'f9a10000-0000-0000-0000-000000000002', '试身样两周内完成。'),
  ('f9a50000-0000-0000-0000-000000000002', 'f9a40000-0000-0000-0000-000000000001',
   'f9a20000-0000-0000-0000-0000000000f1', 'f9a10000-0000-0000-0000-000000000002', 'Call me on +44 7700 900123');
reset role;

-- What api/screen-message.js does: the translation first, then the verdict.
update public.messages
   set body_lang = 'zh', body_translated = 'The fit sample will be done within two weeks.', body_translated_lang = 'en',
       created_at = now() - interval '10 minutes'
 where id = 'f9a50000-0000-0000-0000-000000000001';
do $$ begin
  perform public.record_message_screening('f9a50000-0000-0000-0000-000000000001', 'delivered', 'pattern_only');
  perform public.record_message_screening('f9a50000-0000-0000-0000-000000000002', 'held', 'pattern_only', 'a phone number', null, 'contact_details');
end $$;

-- ---------------------------------------------------------------------------
-- The bell, in the reader's language (20261026000600)
-- ---------------------------------------------------------------------------

select is(
  (select body from public.notifications
    where org_id = 'f9a20000-0000-0000-0000-00000000000b' and kind = 'message'),
  'The fit sample will be done within two weeks.',
  'the brand''s bell says the factory''s Chinese message in English, as the conversation does'
);

select is(
  (select data -> 'message_text' ->> 'zh' from public.notifications
    where org_id = 'f9a20000-0000-0000-0000-00000000000b' and kind = 'message'),
  '试身样两周内完成。',
  'and keeps the original for a reader whose email is in Chinese'
);

-- ---------------------------------------------------------------------------
-- A staff member's own company's inbox (20261026000500)
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"f9a10000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;

select is(
  (select last_body from public.message_thread_summary where id = 'f9a40000-0000-0000-0000-000000000001'),
  '试身样两周内完成。',
  'staff in the brand: the conversation''s last line is NOT the factory''s held message'
);

select is(
  (select message_count from public.message_thread_summary where id = 'f9a40000-0000-0000-0000-000000000001'),
  1,
  'staff in the brand: the held message is NOT counted'
);

select is(
  (select unread_count from public.message_thread_summary where id = 'f9a40000-0000-0000-0000-000000000001'),
  1,
  'and unread counts only what was delivered'
);

-- What listMessages asks for: delivered, or the reader's company's own.
select is(
  (select count(*)::integer from public.messages
    where thread_id = 'f9a40000-0000-0000-0000-000000000001'
      and (delivery = 'delivered' or sender_org_id = 'f9a20000-0000-0000-0000-00000000000b')),
  1,
  'the inbox query reads one message: the delivered one'
);

select throws_ok(
  $$select public.create_org('PSB Staff Side Company', 'brand')$$,
  '42501',
  'platform staff work in the admin console and do not create companies',
  'staff CANNOT create a company'
);

reset role;

-- The factory still sees its own held message (the sender's view is unchanged).
set local request.jwt.claims = '{"sub":"f9a10000-0000-0000-0000-000000000002","role":"authenticated"}';
set local role authenticated;
select is(
  (select message_count from public.message_thread_summary where id = 'f9a40000-0000-0000-0000-000000000001'),
  2,
  'the sender''s company still counts its own held message'
);
reset role;

-- ---------------------------------------------------------------------------
-- Admin review (20261026000700)
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"f9a10000-0000-0000-0000-000000000003","role":"authenticated"}';
set local role authenticated;

select is(
  (select state::text from public.admin_verification_queue() where org_id = 'f9a20000-0000-0000-0000-0000000000f2'),
  'approved',
  'a verified company with no review row reads approved, not ready for review'
);

select is(
  (select state::text from public.admin_verification_queue() where org_id = 'f9a20000-0000-0000-0000-0000000000f1'),
  'ready_for_review',
  'a pending company with no review row is still ready for review'
);

select public.admin_review_decision('f9a20000-0000-0000-0000-0000000000f1', 'approved');
select public.admin_review_decision('f9a20000-0000-0000-0000-0000000000f1', 'approved');

reset role;

select is(
  (select count(*)::integer from public.notifications
    where org_id = 'f9a20000-0000-0000-0000-0000000000f1' and kind = 'verification_approved'),
  1,
  'approving twice tells the company once'
);

set local request.jwt.claims = '{"sub":"f9a10000-0000-0000-0000-000000000003","role":"authenticated"}';
set local role authenticated;
select public.admin_review_decision('f9a20000-0000-0000-0000-0000000000f1', 'needs_information', 'Upload the licence.');
reset role;

select is(
  (select count(*)::integer from public.notifications
    where org_id = 'f9a20000-0000-0000-0000-0000000000f1' and kind = 'verification_needs_information'),
  1,
  'a different decision is still told'
);

select * from finish();
rollback;
