-- ============================================================================
-- Review decision emails (20261104200000)
-- ----------------------------------------------------------------------------
-- `pgtap-rev-` prefixed, every assertion scoped to its own fixtures.
--
-- Who is emailed when staff decide a review, that the same request is never
-- emailed twice, that an approval does not quote the earlier request, what the
-- sender is handed (current decision only, retries capped), what staff can
-- read and resend, and the email to staff when a company sends its profile
-- back. Most of the access part is negative: a company owner is refused every
-- staff function and both queues.
--
-- Everything here runs in one transaction, so now() does not move between
-- decisions. `age_outbox()` pushes the rows already queued an hour back, the
-- way a later decision would find them.
-- ============================================================================

begin;

-- These fixtures approve factories that have no registration number; the
-- registry guard (20261108600000) is tested in registry_checks_test.sql.
set local tsc.skip_registry_guard = 'on';

create extension if not exists pgtap with schema extensions;

select plan(45);

create function pg_temp.age_outbox() returns void language sql as $$
  update public.verification_approval_email_outbox
     set review_updated_at = review_updated_at - interval '1 hour'
   where org_id in ('d5800000-0000-0000-0000-0000000000f1', 'd5800000-0000-0000-0000-0000000000b1');
$$;

insert into auth.users (id, email) values
  ('c5800000-0000-0000-0000-000000000001', 'prev-admin@example.com'),
  ('c5800000-0000-0000-0000-000000000002', 'prev-owner@example.com'),
  ('c5800000-0000-0000-0000-000000000003', 'prev-member@example.com'),
  ('c5800000-0000-0000-0000-000000000004', 'prev-noemail@example.com'),
  ('c5800000-0000-0000-0000-000000000005', 'prev-brand@example.com');

-- A member whose profile has no address: never queued, and counted for staff.
update public.user_profiles set email = ''
 where id = 'c5800000-0000-0000-0000-000000000004';

insert into public.platform_admins (user_id, note)
values ('c5800000-0000-0000-0000-000000000001', 'pgtap-rev fixture');

insert into public.orgs (id, type, name, slug) values
  ('d5800000-0000-0000-0000-0000000000f1', 'factory', 'Rev Factory', 'pgtap-rev-factory'),
  ('d5800000-0000-0000-0000-0000000000b1', 'brand',   'Rev Brand',   'pgtap-rev-brand');

insert into public.org_members (org_id, user_id, role) values
  ('d5800000-0000-0000-0000-0000000000f1', 'c5800000-0000-0000-0000-000000000002', 'owner'),
  ('d5800000-0000-0000-0000-0000000000f1', 'c5800000-0000-0000-0000-000000000003', 'member'),
  ('d5800000-0000-0000-0000-0000000000f1', 'c5800000-0000-0000-0000-000000000004', 'member'),
  ('d5800000-0000-0000-0000-0000000000b1', 'c5800000-0000-0000-0000-000000000005', 'owner');

insert into public.factory_profiles (org_id, country_code, moq, onboarding_completed_at) values
  ('d5800000-0000-0000-0000-0000000000f1', 'PT', 100, now());

-- ---------------------------------------------------------------------------
-- Staff ask for more information: every member with an address is emailed.
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"c5800000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;

select lives_ok(
  $$select public.admin_review_decision('d5800000-0000-0000-0000-0000000000f1', 'needs_information', E'Please upload your licence.\n\nAnd your OEKO-TEX certificate.')$$,
  'staff ask the factory for more information'
);

reset role;

select is(
  (select array_agg(recipient_email order by recipient_email)
     from public.verification_approval_email_outbox
    where org_id = 'd5800000-0000-0000-0000-0000000000f1' and decision = 'needs_information'),
  array['prev-member@example.com', 'prev-owner@example.com'],
  'the owner AND the member are emailed, not only the owner'
);
select is(
  (select count(*)::int from public.verification_approval_email_outbox
    where org_id = 'd5800000-0000-0000-0000-0000000000f1'
      and recipient_user_id = 'c5800000-0000-0000-0000-000000000004'),
  0,
  'a member with no address is not queued'
);
select is(
  (select note from public.verification_approval_email_outbox
    where org_id = 'd5800000-0000-0000-0000-0000000000f1' and decision = 'needs_information' limit 1),
  E'Please upload your licence.\n\nAnd your OEKO-TEX certificate.',
  'the note is queued exactly as typed, line breaks included'
);

-- ---------------------------------------------------------------------------
-- The same request again: no bell, and now no email either.
-- ---------------------------------------------------------------------------
select pg_temp.age_outbox();
set local role authenticated;
select lives_ok(
  $$select public.admin_review_decision('d5800000-0000-0000-0000-0000000000f1', 'needs_information', E'Please upload your licence.\n\nAnd your OEKO-TEX certificate.')$$,
  'staff send the same request again'
);
select lives_ok(
  $$select public.admin_review_decision('d5800000-0000-0000-0000-0000000000f1', 'needs_information', E'  Please upload your licence.\n\nAnd your OEKO-TEX certificate.  ')$$,
  'and again with spaces around it'
);
reset role;

select is(
  (select count(*)::int from public.verification_approval_email_outbox
    where org_id = 'd5800000-0000-0000-0000-0000000000f1' and decision = 'needs_information'),
  2,
  'a repeated request queues no second email'
);
select is(
  (select count(*)::int from public.notifications
    where org_id = 'd5800000-0000-0000-0000-0000000000f1' and kind = 'verification_needs_information'),
  1,
  'and writes no second bell: the two agree'
);

-- A different request is news.
select pg_temp.age_outbox();
set local role authenticated;
select lives_ok(
  $$select public.admin_review_decision('d5800000-0000-0000-0000-0000000000f1', 'needs_information', 'The licence photo cannot be read.')$$,
  'staff send a different request'
);
reset role;
select is(
  (select count(*)::int from public.verification_approval_email_outbox
    where org_id = 'd5800000-0000-0000-0000-0000000000f1' and decision = 'needs_information'),
  4,
  'a different request is emailed to both again'
);

-- ---------------------------------------------------------------------------
-- Approving afterwards does not quote the request.
-- ---------------------------------------------------------------------------
select pg_temp.age_outbox();
set local role authenticated;
select lives_ok(
  $$select public.admin_review_decision('d5800000-0000-0000-0000-0000000000f1', 'approved', null)$$,
  'staff approve with no note'
);
reset role;
select is(
  (select note from public.org_reviews where org_id = 'd5800000-0000-0000-0000-0000000000f1'),
  null,
  'the review no longer carries the request'
);
select is(
  (select count(*)::int from public.verification_approval_email_outbox
    where org_id = 'd5800000-0000-0000-0000-0000000000f1' and decision = 'approved' and note is null),
  2,
  'and both approval emails go without the old request'
);

-- ---------------------------------------------------------------------------
-- The sender: current decision only, removed members skipped, retries capped.
-- ---------------------------------------------------------------------------
-- The member leaves before anything is sent.
delete from public.org_members
 where org_id = 'd5800000-0000-0000-0000-0000000000f1'
   and user_id = 'c5800000-0000-0000-0000-000000000003';

set local role service_role;
select is(
  (select array_agg(recipient_email || ':' || decision)
     from public.claim_review_decision_emails('d5800000-0000-0000-0000-0000000000f1')),
  array['prev-owner@example.com:approved'],
  'the sender is handed only the current decision, for current members'
);
reset role;

select is(
  (select count(*)::int from public.verification_approval_email_outbox
    where org_id = 'd5800000-0000-0000-0000-0000000000f1' and decision = 'needs_information'
      and status = 'skipped' and last_error = 'a later step in the review replaced this email'),
  4,
  'the requests never sent are skipped, so they cannot go out with the approval'
);
select is(
  (select last_error from public.verification_approval_email_outbox
    where org_id = 'd5800000-0000-0000-0000-0000000000f1' and decision = 'approved'
      and recipient_user_id = 'c5800000-0000-0000-0000-000000000003'),
  'no longer a member of the company',
  'a person removed from the company is skipped, with the reason'
);

set local role service_role;
select lives_ok(
  $$select public.finish_review_decision_email('d5800000-0000-0000-0000-0000000000f1', 'c5800000-0000-0000-0000-000000000002', 'approved',
      (select review_updated_at from public.verification_approval_email_outbox
        where org_id = 'd5800000-0000-0000-0000-0000000000f1' and decision = 'approved' limit 1),
      'failed', null, 'the email service did not accept it', true)$$,
  'the provider refuses the send'
);
select is(
  (select count(*)::int from public.claim_review_decision_emails('d5800000-0000-0000-0000-0000000000f1')),
  1,
  'a failed email is handed to the sender again'
);
reset role;
update public.verification_approval_email_outbox set status = 'failed', attempts = 5
 where org_id = 'd5800000-0000-0000-0000-0000000000f1' and decision = 'approved'
   and recipient_user_id = 'c5800000-0000-0000-0000-000000000002';
set local role service_role;
select is(
  (select count(*)::int from public.claim_review_decision_emails('d5800000-0000-0000-0000-0000000000f1')),
  0,
  'but not after five attempts'
);
reset role;

-- A refusal moves the provider key on; a timeout ("unconfirmed") keeps it
-- and is retried like a failure.
select is(
  (select key_generation from public.verification_approval_email_outbox
    where org_id = 'd5800000-0000-0000-0000-0000000000f1' and decision = 'approved'
      and recipient_user_id = 'c5800000-0000-0000-0000-000000000002'),
  1,
  'a refusal moves the provider key on'
);
-- (Back under the five-attempt cap the test above set it to.)
update public.verification_approval_email_outbox set attempts = 1
 where org_id = 'd5800000-0000-0000-0000-0000000000f1' and decision = 'approved'
   and recipient_user_id = 'c5800000-0000-0000-0000-000000000002';
set local role service_role;
select lives_ok(
  $$select public.finish_review_decision_email('d5800000-0000-0000-0000-0000000000f1', 'c5800000-0000-0000-0000-000000000002', 'approved',
      (select review_updated_at from public.verification_approval_email_outbox
        where org_id = 'd5800000-0000-0000-0000-0000000000f1' and decision = 'approved' limit 1),
      'unconfirmed', null, 'the email service did not confirm it in time, so it may still arrive')$$,
  'a send that timed out is recorded as unconfirmed'
);
select is(
  (select count(*)::int from public.claim_review_decision_emails('d5800000-0000-0000-0000-0000000000f1')),
  1,
  'and is handed to the sender again'
);
reset role;
select is(
  (select key_generation from public.verification_approval_email_outbox
    where org_id = 'd5800000-0000-0000-0000-0000000000f1' and decision = 'approved'
      and recipient_user_id = 'c5800000-0000-0000-0000-000000000002'),
  1,
  'under the same key: a timeout never moves it'
);

-- A sender that died mid-send: due again after 10 minutes, not before.
set local session_replication_role = replica;
update public.verification_approval_email_outbox set status = 'sending', attempts = 1, updated_at = now() - interval '11 minutes'
 where org_id = 'd5800000-0000-0000-0000-0000000000f1' and decision = 'approved'
   and recipient_user_id = 'c5800000-0000-0000-0000-000000000002';
set local session_replication_role = origin;
set local role service_role;
select is(
  (select count(*)::int from public.claim_review_decision_emails('d5800000-0000-0000-0000-0000000000f1')),
  1,
  'an email stuck sending for 10 minutes is due again'
);
select is(
  (select count(*)::int from public.claim_review_decision_emails('d5800000-0000-0000-0000-0000000000f1')),
  0,
  'and one just claimed is not handed out twice'
);
select lives_ok(
  $$select public.finish_review_decision_email('d5800000-0000-0000-0000-0000000000f1', 'c5800000-0000-0000-0000-000000000002', 'approved',
      (select review_updated_at from public.verification_approval_email_outbox
        where org_id = 'd5800000-0000-0000-0000-0000000000f1' and decision = 'approved' limit 1),
      'failed', null, 'email provider returned 500')$$,
  'it fails again'
);
reset role;

-- An email nobody has touched for over a week is stale: the daily job leaves
-- it, and staff's "Resend email" brings it back (below).
set local session_replication_role = replica;
update public.verification_approval_email_outbox set status = 'failed', attempts = 1, updated_at = now() - interval '8 days'
 where org_id = 'd5800000-0000-0000-0000-0000000000f1' and decision = 'approved'
   and recipient_user_id = 'c5800000-0000-0000-0000-000000000002';
set local session_replication_role = origin;
set local role service_role;
select is(
  (select count(*)::int from public.claim_review_decision_emails(null)
    where org_id = 'd5800000-0000-0000-0000-0000000000f1'),
  0,
  'an email untouched for over a week is not sent by itself'
);
reset role;
set local session_replication_role = replica;
update public.verification_approval_email_outbox set updated_at = now()
 where org_id = 'd5800000-0000-0000-0000-0000000000f1' and decision = 'approved'
   and recipient_user_id = 'c5800000-0000-0000-0000-000000000002';
set local session_replication_role = origin;

-- ---------------------------------------------------------------------------
-- What staff read, and "Resend email".
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"c5800000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select is(
  (select public.admin_review_email_status('d5800000-0000-0000-0000-0000000000f1') ->> 'decision'),
  'approved',
  'staff read which decision the emails are for'
);
select is(
  (select jsonb_path_query_array(public.admin_review_email_status('d5800000-0000-0000-0000-0000000000f1'), '$.recipients[*].status')),
  '["skipped", "failed"]'::jsonb,
  'who was emailed and how it went, one line per person'
);
select is(
  (select (public.admin_review_email_status('d5800000-0000-0000-0000-0000000000f1') ->> 'members_without_email')::int),
  1,
  'and how many members have no address at all'
);
select is(
  public.admin_requeue_review_emails('d5800000-0000-0000-0000-0000000000f1'),
  1,
  '"Resend email" puts the failed email back in the queue'
);
reset role;
select is(
  (select status || ':' || attempts from public.verification_approval_email_outbox
    where org_id = 'd5800000-0000-0000-0000-0000000000f1' and decision = 'approved'
      and recipient_user_id = 'c5800000-0000-0000-0000-000000000002'),
  'pending:0',
  'with a fresh allowance of attempts; the skipped one stays skipped'
);
select is(
  (select status from public.verification_approval_email_outbox
    where org_id = 'd5800000-0000-0000-0000-0000000000f1' and decision = 'approved'
      and recipient_user_id = 'c5800000-0000-0000-0000-000000000003'),
  'skipped',
  'and a person no longer in the company is not brought back'
);

-- ---------------------------------------------------------------------------
-- A company owner is refused every staff function and both queues.
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"c5800000-0000-0000-0000-000000000002","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$select public.admin_review_email_status('d5800000-0000-0000-0000-0000000000f1')$$, '42501',
  null, 'the company cannot read its own review emails'
);
select throws_ok(
  $$select public.admin_requeue_review_emails('d5800000-0000-0000-0000-0000000000f1')$$, '42501',
  null, 'nor resend them'
);
select throws_ok(
  $$select * from public.claim_review_decision_emails(null)$$, '42501',
  null, 'nor claim them as the sender'
);
select throws_ok(
  $$select count(*) from public.review_resubmission_email_outbox$$, '42501',
  null, 'nor read the staff alerts'
);
reset role;

-- ---------------------------------------------------------------------------
-- A company sends its profile back: staff are emailed, once per round.
-- ---------------------------------------------------------------------------
-- The brand this time: brands are reviewed the same way.
set local request.jwt.claims = '{"sub":"c5800000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select lives_ok(
  $$select public.admin_review_decision('d5800000-0000-0000-0000-0000000000b1', 'needs_information', 'Please add your website.')$$,
  'staff ask the brand for more information'
);
reset role;
select is(
  (select count(*)::int from public.verification_approval_email_outbox
    where org_id = 'd5800000-0000-0000-0000-0000000000b1' and recipient_email = 'prev-brand@example.com'),
  1,
  'the brand is emailed too'
);

set local request.jwt.claims = '{"sub":"c5800000-0000-0000-0000-000000000005","role":"authenticated"}';
set local role authenticated;
select lives_ok(
  $$select public.resubmit_for_review('d5800000-0000-0000-0000-0000000000b1')$$,
  'the brand sends its profile back'
);
select throws_ok(
  $$select public.resubmit_for_review('d5800000-0000-0000-0000-0000000000b1')$$, '22023',
  null, 'and cannot send it twice'
);
reset role;

set local role service_role;
select is(
  (select org_name || ' / ' || org_type || ' / ' || note
     from public.claim_review_resubmission_emails('d5800000-0000-0000-0000-0000000000b1')),
  'Rev Brand / brand / Please add your website.',
  'one email to staff, naming the company and the request it answered'
);
reset role;

-- A decline needs a reason (20261106200000).
set local request.jwt.claims = '{"sub":"c5800000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$select public.admin_review_decision('d5800000-0000-0000-0000-0000000000f1', 'declined', null)$$,
  '22023', null, 'a decline with no reason is refused'
);
select throws_ok(
  $$select public.admin_review_decision_with_tier('d5800000-0000-0000-0000-0000000000f1', 'declined', '   ', null, null)$$,
  '22023', null, 'and one of spaces, through the path the screen uses'
);
reset role;
select is(
  (select count(*)::int from public.org_reviews
    where org_id = 'd5800000-0000-0000-0000-0000000000f1' and state = 'declined' and coalesce(btrim(note), '') = ''),
  0,
  'a refused decline records nothing'
);

select * from finish();
rollback;
