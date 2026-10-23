-- ============================================================================
-- Calls: the words on a call pass the server's contact-details check
-- ----------------------------------------------------------------------------
-- `pgtap20-` prefixed, ids `cb1…`, every count scoped to its own fixtures.
--
-- A call's title, description and reason reach the other side. The server
-- checks them (api/screen-call-text.js) and records what it passed; the
-- database refuses words from a person that it did not pass. These are the
-- ways round that: calling the functions directly, borrowing another
-- person's check, an old check, recording one's own.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(16);

insert into auth.users (id, email) values
  ('cb110000-0000-0000-0000-000000000001', 'p20-brand@example.com'),
  ('cb110000-0000-0000-0000-000000000003', 'p20-factory@example.com');

insert into public.orgs (id, type, name, slug) values
  ('cb120000-0000-0000-0000-00000000000b', 'brand',   'P20 Brand',   'pgtap20-brand'),
  ('cb120000-0000-0000-0000-0000000000f1', 'factory', 'P20 Factory', 'pgtap20-factory');

insert into public.org_members (org_id, user_id, role) values
  ('cb120000-0000-0000-0000-00000000000b', 'cb110000-0000-0000-0000-000000000001', 'owner'),
  ('cb120000-0000-0000-0000-0000000000f1', 'cb110000-0000-0000-0000-000000000003', 'owner');

insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total) values
  ('cb130000-0000-0000-0000-000000000001', 'cb120000-0000-0000-0000-00000000000b', 'P20 shirts', 'open', 'open_to_all', 100);

insert into public.message_threads (id, rfq_id, brand_org_id, factory_org_id) values
  ('cb140000-0000-0000-0000-000000000001', 'cb130000-0000-0000-0000-000000000001',
   'cb120000-0000-0000-0000-00000000000b', 'cb120000-0000-0000-0000-0000000000f1');

-- What the server passed: the brand's title and description, the factory's
-- reason. Blank entries are not words and are not recorded.
do $$
begin
  perform public.record_call_text_check('cb110000-0000-0000-0000-000000000001',
    array['P20 call', 'Lab dips and the price hold', 'P20 second', 'P20 third', '   ']);
  perform public.record_call_text_check('cb110000-0000-0000-0000-000000000003',
    array['Closed that week']);
end;
$$;

select is(
  (select count(*)::int from public.call_text_checks
    where user_id in ('cb110000-0000-0000-0000-000000000001', 'cb110000-0000-0000-0000-000000000003')),
  5,
  'the server records the words it passed, for each person, and no blanks'
);

-- ---------------------------------------------------------------------------
-- The brand proposes
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"cb110000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$select public.propose_call('cb140000-0000-0000-0000-000000000001', now() + interval '2 days', 30,
                               'WhatsApp me on +44 7700 900123', null, null)$$,
  '42501', null, 'a title the server never checked is refused (calling propose_call directly)'
);

select throws_ok(
  $$select public.propose_call('cb140000-0000-0000-0000-000000000001', now() + interval '2 days', 30,
                               'P20 call', 'Quick one, or just WhatsApp me on +44 7700 900123 instead.', null)$$,
  '42501', null, 'so is a checked title with a description that was not'
);

select lives_ok(
  $$select public.propose_call('cb140000-0000-0000-0000-000000000001', now() + interval '2 days', 30,
                               '  P20 call ', 'Lab dips and the price hold', null)$$,
  'checked words go through, trimmed as the check trimmed them'
);

select lives_ok(
  $$select public.propose_call('cb140000-0000-0000-0000-000000000001', now() + interval '3 days', 30,
                               'P20 second', null, null)$$,
  'a call with no description needs only its title checked'
);

select throws_ok(
  $$select public.cancel_call((select id from public.calls where title = 'P20 second'), 'Text me on +44 7700 900123')$$,
  '42501', null, 'a reason for withdrawing that was not checked is refused'
);

select lives_ok(
  $$select public.propose_call('cb140000-0000-0000-0000-000000000001', now() + interval '4 days', 30,
                               'P20 third', null, null)$$,
  'a third invite'
);

select throws_ok(
  $$select public.record_call_text_check('cb110000-0000-0000-0000-000000000001', array['call me on +44 7700 900123'])$$,
  '42501', null, 'a person CANNOT record a check of their own'
);

select throws_ok(
  $$select * from public.call_text_checks$$,
  '42501', null, 'nor read the record of checks'
);

select throws_ok(
  $$select public.call_text_checked('P20 call')$$,
  '42501', null, 'nor ask the trigger''s question directly'
);

-- ---------------------------------------------------------------------------
-- The factory answers
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"cb110000-0000-0000-0000-000000000003","role":"authenticated"}';

select throws_ok(
  $$select public.counter_call((select id from public.calls where title = 'P20 call'),
                               now() + interval '5 days', 30, 'P20 call', null, null)$$,
  '42501', null, 'another person''s check does not count: the brand''s words, sent by the factory, are refused'
);

select throws_ok(
  $$select public.decline_call((select id from public.calls where title = 'P20 call'), 'Add me on WeChat: tsc_p20_factory')$$,
  '42501', null, 'a reason for declining that was not checked is refused'
);

select lives_ok(
  $$select public.decline_call((select id from public.calls where title = 'P20 call'), 'Closed that week')$$,
  'a checked reason goes through'
);

select lives_ok(
  $$select public.decline_call((select id from public.calls where title = 'P20 second'), null)$$,
  'and declining without a reason needs no check'
);

-- An old check: moved back past the 10 minutes it lasts.
reset role;
update public.call_text_checks set checked_at = now() - interval '11 minutes'
 where user_id = 'cb110000-0000-0000-0000-000000000003';
set local role authenticated;

select throws_ok(
  $$select public.decline_call((select id from public.calls where title = 'P20 third'), 'Closed that week')$$,
  '42501', null, 'a check older than 10 minutes no longer counts'
);

-- ---------------------------------------------------------------------------
-- The server's own writes
-- ---------------------------------------------------------------------------

reset role;
set local request.jwt.claims = '{"role":"service_role"}';
set local role service_role;

select lives_ok(
  $$update public.calls set agenda = 'P20 moved by the server' where title = 'P20 third'$$,
  'the server''s own writes are not a person''s words and are not checked'
);

reset role;

select * from finish();
rollback;
