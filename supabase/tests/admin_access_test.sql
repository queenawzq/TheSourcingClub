-- ============================================================================
-- Phase 6 access rule tests — admin operations
-- ----------------------------------------------------------------------------
-- Fifth suite, `pgtap5-` prefixed, every count scoped to its own fixtures.
--
-- This surface is the most dangerous one in the schema, because every
-- function in it is `security definer` and therefore has no policy behind it.
-- A missing is_platform_admin() check on any one of them hands a signed-in
-- stranger the whole marketplace: every brand's requests, every factory's
-- prices, and the ability to verify their own company.
--
-- So the assertions are overwhelmingly negative. A positive test that the
-- queue returns rows for an admin passes just as happily when the admin test
-- has been deleted.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(32);

insert into auth.users (id, email) values
  ('c5000000-0000-0000-0000-000000000001', 'p5-admin@example.com'),
  ('c5000000-0000-0000-0000-000000000002', 'p5-brand@example.com'),
  ('c5000000-0000-0000-0000-000000000003', 'p5-factory@example.com'),
  ('c5000000-0000-0000-0000-000000000004', 'p5-outsider@example.com');

insert into public.platform_admins (user_id, note)
values ('c5000000-0000-0000-0000-000000000001', 'pgtap5 fixture');

insert into public.orgs (id, type, name, slug) values
  ('d5000000-0000-0000-0000-00000000000b', 'brand',   'P5 Brand',    'pgtap5-brand'),
  ('d5000000-0000-0000-0000-0000000000f1', 'factory', 'P5 Factory',  'pgtap5-factory'),
  ('d5000000-0000-0000-0000-00000000000c', 'brand',   'P5 Outsider', 'pgtap5-outsider');

insert into public.org_members (org_id, user_id, role) values
  ('d5000000-0000-0000-0000-00000000000b', 'c5000000-0000-0000-0000-000000000002', 'owner'),
  ('d5000000-0000-0000-0000-0000000000f1', 'c5000000-0000-0000-0000-000000000003', 'owner'),
  ('d5000000-0000-0000-0000-00000000000c', 'c5000000-0000-0000-0000-000000000004', 'owner');

insert into public.brand_profiles (org_id, hq_location, onboarding_completed_at) values
  ('d5000000-0000-0000-0000-00000000000b', 'London, UK', now()),
  ('d5000000-0000-0000-0000-00000000000c', 'Berlin, DE', now());

insert into public.factory_profiles (org_id, country_code, moq, onboarding_completed_at) values
  ('d5000000-0000-0000-0000-0000000000f1', 'PT', 100, now());

insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total, published_at) values
  ('e5000000-0000-0000-0000-000000000001', 'd5000000-0000-0000-0000-00000000000b',
   'P5 request', 'open', 'open_to_all', 100, now());

insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity, submitted_at)
values ('f5000000-0000-0000-0000-000000000001', 'e5000000-0000-0000-0000-000000000001',
        'd5000000-0000-0000-0000-0000000000f1', 'submitted', 2000, 100, now());

-- ---------------------------------------------------------------------------
-- Nobody who is not an admin gets in. Six functions, six doors.
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"c5000000-0000-0000-0000-000000000004","email":"p5-outsider@example.com","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$select * from public.admin_verification_queue()$$, '42501',
  null, 'a signed-in stranger cannot read the verification queue'
);

select throws_ok(
  $$select * from public.admin_rfq_queue()$$, '42501',
  null, 'nor every brand''s requests'
);

select throws_ok(
  $$select * from public.admin_quote_queue()$$, '42501',
  null, 'nor every factory''s prices'
);

select throws_ok(
  $$select * from public.admin_overview_metrics()$$, '42501',
  null, 'nor the marketplace counts'
);

select throws_ok(
  $$select public.admin_claim_review('d5000000-0000-0000-0000-0000000000f1')$$, '42501',
  null, 'nor claim a review'
);

-- The one that matters most: verifying yourself is the gate on quoting.
select throws_ok(
  $$select public.admin_review_decision('d5000000-0000-0000-0000-00000000000c', 'approved')$$,
  '42501', null, 'and above all cannot approve their own company'
);

select is(
  (select verification_status::text from public.brand_profiles
    where org_id = 'd5000000-0000-0000-0000-00000000000c'),
  'unverified',
  'the refused approval changed nothing'
);

-- A member of the org under review is no more privileged than a stranger.
set local request.jwt.claims = '{"sub":"c5000000-0000-0000-0000-000000000003","email":"p5-factory@example.com","role":"authenticated"}';

select throws_ok(
  $$select public.admin_review_decision('d5000000-0000-0000-0000-0000000000f1', 'approved')$$,
  '42501', null, 'a factory owner cannot approve their own factory either'
);

-- org_reviews is staff-only: the internal note and the assigned reviewer are
-- notes about a customer, and the customer must not read them.
select is(
  (select count(*)::int from public.org_reviews
    where org_id = 'd5000000-0000-0000-0000-0000000000f1'),
  0,
  'and cannot see the review record about their own company'
);

-- Not "returns no rows": the table carries no grant to authenticated at all,
-- so a signed-in user is refused by the grant before RLS is ever consulted.
-- Asserting a count of 0 here instead read as a pass only because the error
-- aborted the whole suite on the statement before it.
select throws_ok(
  $$select count(*) from public.verification_approval_email_outbox$$,
  '42501', null, 'and cannot read the private review-email queue at all'
);

-- The new evidence surface is security definer with no policy behind it, so
-- the guard is the only thing between a signed-in stranger and every
-- company's submitted files.
select throws_ok(
  $$select * from public.admin_org_documents('d5000000-0000-0000-0000-0000000000f1')$$,
  '42501', null, 'nor read another company''s uploaded documents'
);

-- org_verification_checks and friends are NOT granted to authenticated at
-- all: they are definer, so a grant would let anyone score any company and
-- read back its profile gaps. Refused at the grant, before the function runs.
select throws_ok(
  $$select public.org_verification_checks('d5000000-0000-0000-0000-0000000000f1')$$,
  '42501', null, 'and cannot run the evidence checks directly'
);

select throws_ok(
  $$select public.org_verification_score('d5000000-0000-0000-0000-0000000000f1')$$,
  '42501', null, 'nor the score built from them'
);

-- ---------------------------------------------------------------------------
-- The admin path works
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"c5000000-0000-0000-0000-000000000001","email":"p5-admin@example.com","role":"authenticated"}';

select is(
  (select count(*)::int from public.admin_verification_queue() q
    where q.org_id in ('d5000000-0000-0000-0000-00000000000b',
                       'd5000000-0000-0000-0000-0000000000f1',
                       'd5000000-0000-0000-0000-00000000000c')),
  3,
  'every company that finished onboarding is in the queue'
);

select is(
  (select q.state::text from public.admin_verification_queue() q
    where q.org_id = 'd5000000-0000-0000-0000-0000000000f1'),
  'ready_for_review',
  'with no org_reviews row it still reports ready_for_review, not nothing'
);

select is(
  (select q.evidence_expected from public.admin_verification_queue() q
    where q.org_id = 'd5000000-0000-0000-0000-0000000000f1'),
  1,
  'a factory claiming no certifications is expected to produce one document'
);

select is(
  (select q.evidence_received from public.admin_verification_queue() q
    where q.org_id = 'd5000000-0000-0000-0000-0000000000f1'),
  0,
  'and has produced none of it'
);

select lives_ok(
  $$select public.admin_claim_review('d5000000-0000-0000-0000-0000000000f1')$$,
  'an admin can take a review'
);

select is(
  (select q.state::text from public.admin_verification_queue() q
    where q.org_id = 'd5000000-0000-0000-0000-0000000000f1'),
  'in_review',
  'and the queue reflects it'
);

-- Assignment is restricted to admins: a review parked on an ordinary user id
-- would show an owner who cannot open it.
select throws_ok(
  $$select public.admin_claim_review('d5000000-0000-0000-0000-0000000000f1',
                                     'c5000000-0000-0000-0000-000000000003')$$,
  '22023', null, 'a review cannot be assigned to someone who is not an admin'
);

-- Returning a review without saying what is missing is the failure mode that
-- leaves a factory staring at "Needs information" with no idea what to send.
select throws_ok(
  $$select public.admin_review_decision('d5000000-0000-0000-0000-0000000000f1',
                                        'needs_information')$$,
  '22023', null, 'returning a review requires a note'
);

select lives_ok(
  $$select public.admin_review_decision('d5000000-0000-0000-0000-0000000000f1',
                                        'needs_information',
                                        'Please upload your business registration.')$$,
  'with a note it goes back'
);

-- Platform staff have no org, so notifications_read excludes them from their
-- own output. Worth pinning: it is the same absence that makes
-- admin_payment_queue() a required step rather than a convenience.
select is(
  (select count(*)::int from public.notifications
    where org_id = 'd5000000-0000-0000-0000-0000000000f1'
      and kind = 'verification_needs_information'),
  0,
  'the admin cannot read the notification they just caused'
);

set local request.jwt.claims = '{"sub":"c5000000-0000-0000-0000-000000000003","email":"p5-factory@example.com","role":"authenticated"}';

select is(
  (select count(*)::int from public.notifications
    where org_id = 'd5000000-0000-0000-0000-0000000000f1'
      and kind = 'verification_needs_information'),
  1,
  'but the factory is told, because a sentence cannot be read off a file'
);

set local request.jwt.claims = '{"sub":"c5000000-0000-0000-0000-000000000001","email":"p5-admin@example.com","role":"authenticated"}';

select lives_ok(
  $$select public.admin_review_decision('d5000000-0000-0000-0000-0000000000f1',
                                        'approved', 'Registration checked.', 'low')$$,
  'and can then be approved'
);

-- The whole point: this is the same column review_document() writes, so the
-- company-level verdict and the file-level one cannot disagree.
select is(
  (select verification_status::text from public.factory_profiles
    where org_id = 'd5000000-0000-0000-0000-0000000000f1'),
  'verified',
  'approval verifies the profile, which is the gate on quoting'
);

set local role postgres;

select is(
  (select count(*)::int from public.verification_approval_email_outbox
    where org_id = 'd5000000-0000-0000-0000-0000000000f1'
      and recipient_email = 'p5-factory@example.com'
      and decision = 'approved'
      and status = 'pending'),
  1,
  'approval queues one email for the company owner'
);

-- The decision that asks the company to DO something is the one that most
-- needs to leave the app. An in-app notification alone is only seen by
-- someone already looking.
select is(
  (select count(*)::int from public.verification_approval_email_outbox
    where org_id = 'd5000000-0000-0000-0000-0000000000f1'
      and recipient_email = 'p5-factory@example.com'
      and decision = 'needs_information'
      and status = 'pending'),
  1,
  'and returning a review queues its own email, separately from the approval'
);

select is(
  (select note from public.verification_approval_email_outbox
    where org_id = 'd5000000-0000-0000-0000-0000000000f1'
      and decision = 'needs_information'),
  'Please upload your business registration.',
  'carrying the note, which on this decision is the whole actionable content'
);

set local role authenticated;

select isnt(
  (select decided_at from public.org_reviews
    where org_id = 'd5000000-0000-0000-0000-0000000000f1'),
  null,
  'a final decision is stamped'
);

select is(
  (select count(*)::int from public.admin_quote_queue() q
    where q.rfq_id = 'e5000000-0000-0000-0000-000000000001'),
  1,
  'the quote queue sees across the marketplace'
);

-- Production plus samples, in bigint, matching quoteTotalCents().
select is(
  (select q.total_cents from public.admin_quote_queue() q
    where q.quote_id = 'f5000000-0000-0000-0000-000000000001'),
  200000::bigint,
  'and totals the quote the same way the app does'
);

select * from finish();

rollback;
