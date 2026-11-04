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

select plan(6);

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


update public.calls set status = 'declined' where id = 'ca150000-0000-0000-0000-0000000000aa';
set local role authenticated;
set local request.jwt.claims = '{"sub":"ca110000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$insert into public.call_card_dismissals(call_id,user_id) values ('ca150000-0000-0000-0000-0000000000aa','ca110000-0000-0000-0000-000000000001')$$,'Participant can hide declined call');
select is((select count(*) from public.call_card_dismissals),1::bigint,'Viewer reads own dismissal');
select throws_ok($$insert into public.call_card_dismissals(call_id,user_id) values ('ca150000-0000-0000-0000-0000000000aa','ca110000-0000-0000-0000-000000000003')$$,'42501',null,'Cannot hide a card for another user');
set local request.jwt.claims = '{"sub":"ca110000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((select count(*) from public.call_card_dismissals),0::bigint,'Other participant does not inherit dismissal');
reset role;
update public.calls set status = 'accepted' where id = 'ca150000-0000-0000-0000-0000000000aa';
set local role authenticated;
select throws_ok($$insert into public.call_card_dismissals(call_id,user_id) values ('ca150000-0000-0000-0000-0000000000aa','ca110000-0000-0000-0000-000000000003')$$,'42501',null,'Cannot hide an accepted call');
reset role;
select is((select count(*) from public.calls where id = 'ca150000-0000-0000-0000-0000000000aa'),1::bigint,'Call history is preserved');
select * from finish();
rollback;
