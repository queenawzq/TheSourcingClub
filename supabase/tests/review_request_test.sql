-- ============================================================================
-- What a company sees of its own review (20261025000401)
-- ----------------------------------------------------------------------------
-- `pgtap54-` prefixed, every assertion scoped to its own fixtures.
--
-- A company staff asked for more information was shown "awaiting
-- verification" and nothing else. my_review_status() is how it now reads the
-- request; resubmit_for_review() is how it answers. Both are security
-- definer over the staff-only org_reviews table, so most of this is negative:
-- strangers are refused, and the reviewer's own note never comes back.
-- ============================================================================

begin;

-- These fixtures approve factories that have no registration number; the
-- registry guard (20261108600000) is tested in registry_checks_test.sql.
set local tsc.skip_registry_guard = 'on';

create extension if not exists pgtap with schema extensions;

select plan(23);

insert into auth.users (id, email) values
  ('c5400000-0000-0000-0000-000000000001', 'p54-admin@example.com'),
  ('c5400000-0000-0000-0000-000000000002', 'p54-factory@example.com'),
  ('c5400000-0000-0000-0000-000000000003', 'p54-outsider@example.com');

insert into public.platform_admins (user_id, note)
values ('c5400000-0000-0000-0000-000000000001', 'pgtap54 fixture');

insert into public.orgs (id, type, name, slug) values
  ('d5400000-0000-0000-0000-0000000000f1', 'factory', 'P54 Factory',  'pgtap54-factory'),
  ('d5400000-0000-0000-0000-00000000000c', 'brand',   'P54 Outsider', 'pgtap54-outsider');

insert into public.org_members (org_id, user_id, role) values
  ('d5400000-0000-0000-0000-0000000000f1', 'c5400000-0000-0000-0000-000000000002', 'owner'),
  ('d5400000-0000-0000-0000-00000000000c', 'c5400000-0000-0000-0000-000000000003', 'owner');

insert into public.factory_profiles (org_id, country_code, moq, onboarding_completed_at) values
  ('d5400000-0000-0000-0000-0000000000f1', 'PT', 100, now());

-- The queue's "Submitted" (20261119100000): the first completion, until a
-- profile sent back for more information is resubmitted. A transaction's
-- now() never moves, so the completions are set in the past.
update public.factory_profiles set onboarding_completed_at = now() - interval '20 days'
 where org_id = 'd5400000-0000-0000-0000-0000000000f1';
insert into public.orgs (id, type, name, slug) values
  ('d5400000-0000-0000-0000-0000000000f2', 'factory', 'P54 Factory Two', 'pgtap54-factory-two');
insert into public.factory_profiles (org_id, country_code, moq, onboarding_completed_at) values
  ('d5400000-0000-0000-0000-0000000000f2', 'PT', 100, now() - interval '10 days');

-- ---------------------------------------------------------------------------
-- Before staff touch it: a member reads "ready", with nothing to show.
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"c5400000-0000-0000-0000-000000000002","role":"authenticated"}';
set local role authenticated;

select is(
  (select state::text from public.my_review_status('d5400000-0000-0000-0000-0000000000f1')),
  'ready_for_review',
  'a company nobody has reviewed reads as ready for review'
);
select is(
  (select message from public.my_review_status('d5400000-0000-0000-0000-0000000000f1')),
  null,
  'and carries no message'
);
select throws_ok(
  $$select public.resubmit_for_review('d5400000-0000-0000-0000-0000000000f1')$$, '22023',
  null, 'a profile nobody returned cannot be sent back'
);

-- ---------------------------------------------------------------------------
-- Staff ask for more information.
-- ---------------------------------------------------------------------------
reset role;
set local request.jwt.claims = '{"sub":"c5400000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;

select lives_ok(
  $$select public.admin_review_decision('d5400000-0000-0000-0000-0000000000f1', 'needs_information', 'Please upload your business licence.')$$,
  'staff return the profile with a note'
);
select is(
  (select submitted_at from public.admin_verification_queue() q where q.org_id = 'd5400000-0000-0000-0000-0000000000f1'),
  now() - interval '20 days',
  'before it is sent back, the queue says it was submitted when onboarding finished'
);
-- The reviewer's private working note, written after the request went out.
reset role;
update public.org_reviews set note = 'internal: looked odd on the call'
 where org_id = 'd5400000-0000-0000-0000-0000000000f1';


-- ---------------------------------------------------------------------------
-- The company reads the request it was sent, and only that.
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"c5400000-0000-0000-0000-000000000002","role":"authenticated"}';
set local role authenticated;

select is(
  (select state::text from public.my_review_status('d5400000-0000-0000-0000-0000000000f1')),
  'needs_information',
  'the company sees that staff need more information'
);
select is(
  (select message from public.my_review_status('d5400000-0000-0000-0000-0000000000f1')),
  'Please upload your business licence.',
  'and the message it was sent'
);
select is(
  (select title from public.my_review_status('d5400000-0000-0000-0000-0000000000f1')),
  'We need a little more information',
  'with the notification''s title'
);
select ok(
  not exists (select 1 from public.my_review_status('d5400000-0000-0000-0000-0000000000f1') s
               where s.message like 'internal:%'),
  'never the reviewer''s own note from org_reviews'
);
select is(
  (select count(*)::integer from public.org_reviews where org_id = 'd5400000-0000-0000-0000-0000000000f1'),
  0,
  'org_reviews itself stays unreadable to the company'
);

-- ---------------------------------------------------------------------------
-- Nobody else can read it or answer it.
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"c5400000-0000-0000-0000-000000000003","role":"authenticated"}';

select throws_ok(
  $$select * from public.my_review_status('d5400000-0000-0000-0000-0000000000f1')$$, '42501',
  null, 'a member of another company cannot read this review'
);
select throws_ok(
  $$select public.resubmit_for_review('d5400000-0000-0000-0000-0000000000f1')$$, '42501',
  null, 'nor send it back'
);

reset role;
set local request.jwt.claims = '{}';
set local role anon;
select throws_ok(
  $$select * from public.my_review_status('d5400000-0000-0000-0000-0000000000f1')$$, '42501',
  null, 'a signed-out visitor cannot call it at all'
);

-- ---------------------------------------------------------------------------
-- The company answers: back to the top of staff's queue, once.
-- ---------------------------------------------------------------------------
reset role;
set local request.jwt.claims = '{"sub":"c5400000-0000-0000-0000-000000000002","role":"authenticated"}';
set local role authenticated;

select is(
  public.resubmit_for_review('d5400000-0000-0000-0000-0000000000f1')::text,
  'ready_for_review',
  'a member sends the returned profile back'
);
select throws_ok(
  $$select public.resubmit_for_review('d5400000-0000-0000-0000-0000000000f1')$$, '22023',
  null, 'and cannot do it twice'
);
-- The admin test comes first: a member of the company is refused the queue.
select throws_ok(
  $$select * from public.admin_verification_queue()$$, '42501',
  null, 'a company member cannot read the staff queue'
);

reset role;
set local request.jwt.claims = '{}';
set local role anon;
select throws_ok(
  $$select * from public.admin_verification_queue()$$, '42501',
  null, 'nor can a signed-out visitor'
);

reset role;
set local request.jwt.claims = '{"sub":"c5400000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select is(
  (select submitted_at from public.admin_verification_queue() q where q.org_id = 'd5400000-0000-0000-0000-0000000000f1'),
  now(),
  'once sent back, the queue says it was submitted then'
);
select is(
  (select submitted_at from public.admin_verification_queue() q where q.org_id = 'd5400000-0000-0000-0000-0000000000f2'),
  now() - interval '10 days',
  'a company never sent back keeps its completion time'
);

-- ---------------------------------------------------------------------------
-- Staff approve. The queue row is what the review screen shows, so it must
-- carry the new status and the decision date (the summary went stale on
-- screen while the database was right; this pins the database side).
-- ---------------------------------------------------------------------------
reset role;
set local request.jwt.claims = '{"sub":"c5400000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;

select lives_ok(
  $$select public.admin_review_decision('d5400000-0000-0000-0000-0000000000f1', 'approved')$$,
  'staff approve'
);
select is(
  (select verification_status::text || ' ' || (decided_at is not null)::text
     from public.admin_verification_queue() q
    where q.org_id = 'd5400000-0000-0000-0000-0000000000f1'),
  'verified true',
  'the queue row reads verified, with the decision date'
);

-- Declined is final: the company reads why, and cannot send it back.
select lives_ok(
  $$select public.admin_review_decision('d5400000-0000-0000-0000-0000000000f1', 'declined', 'The licence has expired.')$$,
  'staff decline'
);

reset role;
set local request.jwt.claims = '{"sub":"c5400000-0000-0000-0000-000000000002","role":"authenticated"}';
set local role authenticated;

select results_eq(
  $$select state::text, message from public.my_review_status('d5400000-0000-0000-0000-0000000000f1')$$,
  $$values ('declined', 'The licence has expired.')$$,
  'a declined company reads the reason it was sent'
);

select * from finish();
rollback;
