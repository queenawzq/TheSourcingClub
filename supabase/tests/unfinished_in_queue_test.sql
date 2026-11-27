-- A company that has not finished signup but sent its registration document is
-- in the queue again, under "Signup not finished" (20261127200000). Fixtures
-- prefixed pgtap-u27-; every count filters on fixture ids.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

insert into auth.users (id, email) values
  ('c2711270-0000-0000-0000-000000000001', 'pgtap-u27-admin@example.com'),
  ('c2711270-0000-0000-0000-000000000002', 'pgtap-u27-factory@example.com'),
  ('c2711270-0000-0000-0000-000000000003', 'pgtap-u27-brand@example.com'),
  ('c2711270-0000-0000-0000-000000000004', 'pgtap-u27-stranger@example.com');
insert into public.platform_admins (user_id) values ('c2711270-0000-0000-0000-000000000001');
insert into public.orgs (id, type, name, slug, is_demo) values
  ('d2711270-0000-0000-0000-0000000000f1', 'factory', 'U27 Unsigned Mill', 'pgtap-u27-unsigned', false),
  ('d2711270-0000-0000-0000-0000000000f2', 'factory', 'U27 Account Only', 'pgtap-u27-account-only', false),
  ('d2711270-0000-0000-0000-0000000000f3', 'factory', 'U27 Certificate Only', 'pgtap-u27-cert-only', false),
  ('d2711270-0000-0000-0000-0000000000f4', 'factory', 'U27 Demo Unsigned', 'pgtap-u27-demo', true),
  ('d2711270-0000-0000-0000-0000000000f5', 'factory', 'U27 To Decline', 'pgtap-u27-decline', false),
  ('d2711270-0000-0000-0000-0000000000b1', 'brand', 'U27 Unsigned Brand', 'pgtap-u27-brand', false);
insert into public.org_members (org_id, user_id, role) values
  ('d2711270-0000-0000-0000-0000000000f1', 'c2711270-0000-0000-0000-000000000002', 'owner'),
  ('d2711270-0000-0000-0000-0000000000b1', 'c2711270-0000-0000-0000-000000000003', 'owner');
insert into public.factory_profiles (org_id, country_code, location, onboarding_completed_at) values
  ('d2711270-0000-0000-0000-0000000000f1', 'PT', 'Barcelos, Portugal', null),
  ('d2711270-0000-0000-0000-0000000000f2', 'PT', 'Porto, Portugal', null),
  ('d2711270-0000-0000-0000-0000000000f3', 'PT', 'Braga, Portugal', null),
  ('d2711270-0000-0000-0000-0000000000f4', 'PT', 'Braga, Portugal', null),
  ('d2711270-0000-0000-0000-0000000000f5', 'PT', 'Guimarães, Portugal', null);
insert into public.brand_profiles (org_id, hq_location, onboarding_completed_at) values
  ('d2711270-0000-0000-0000-0000000000b1', 'Porto, Portugal', null);
insert into public.documents (org_id, kind, bucket, storage_path, file_name, mime_type)
select o, k, 'org-private', o || '/' || k || '/doc.pdf', 'doc.pdf', 'application/pdf'
  from (values
    ('d2711270-0000-0000-0000-0000000000f1'::uuid, 'business_registration'::public.document_kind),
    ('d2711270-0000-0000-0000-0000000000f3', 'certificate'),
    ('d2711270-0000-0000-0000-0000000000f4', 'business_registration'),
    ('d2711270-0000-0000-0000-0000000000f5', 'business_registration'),
    ('d2711270-0000-0000-0000-0000000000b1', 'business_registration')
  ) v(o, k);

-- Who may read it --------------------------------------------------------------
set local request.jwt.claims = '{"sub":"c2711270-0000-0000-0000-000000000004","role":"authenticated"}';
set local role authenticated;
select throws_ok($$select * from public.admin_verification_queue_all()$$, '42501',
  'this queue is limited to platform staff', 'someone who is not staff cannot read the full queue');
select throws_ok($$select * from public.verification_queue_rows()$$, '42501', null,
  'nobody signed in can call the inner rows function');
reset role;
select is((select count(*)::int from pg_proc where proname = 'admin_verification_queue_all'), 1, 'one admin_verification_queue_all, no overloads');
select is((select count(*)::int from pg_proc where proname = 'admin_verification_queue'), 1, 'one admin_verification_queue, no overloads');

-- What is listed ---------------------------------------------------------------
set local request.jwt.claims = '{"sub":"c2711270-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select is((select q.signup_finished from public.admin_verification_queue_all() q where q.org_id = 'd2711270-0000-0000-0000-0000000000f1'), false,
  'an unfinished factory that sent its licence is listed, as not finished');
select is((select q.signup_finished from public.admin_verification_queue_all() q where q.org_id = 'd2711270-0000-0000-0000-0000000000b1'), false,
  'so is an unfinished brand that sent its registration');
select ok(not exists (select 1 from public.admin_verification_queue_all() q where q.org_id = 'd2711270-0000-0000-0000-0000000000f2'),
  'an account with no document is not listed');
select ok(not exists (select 1 from public.admin_verification_queue_all() q where q.org_id = 'd2711270-0000-0000-0000-0000000000f3'),
  'a certificate alone does not list it');
select ok(not exists (select 1 from public.admin_verification_queue_all() q where q.org_id = 'd2711270-0000-0000-0000-0000000000f4'),
  'a demo company is not listed');
select ok(not exists (select 1 from public.admin_verification_queue() q where q.org_id::text like 'd2711270-%'),
  'admin_verification_queue (Active, the overview) lists none of them');

-- The overview's figures leave them out -----------------------------------------
select is((select m.profiles_awaiting_review from public.admin_overview_metrics() m),
          (select count(*)::int from public.admin_verification_queue_all() q
            where q.signup_finished and q.state in ('ready_for_review', 'in_review')),
  'awaiting review counts only companies that finished signup');
select is((select m.profiles_submitted_today from public.admin_overview_metrics() m),
          (select count(*)::int from public.admin_verification_queue_all() q
            where q.signup_finished and q.submitted_at >= date_trunc('day', now())),
  'submitted today counts only companies that finished signup');

-- Staff may ask for more or decline; Approve waits for the terms ------------------
select lives_ok($$select public.admin_review_decision('d2711270-0000-0000-0000-0000000000f1', 'needs_information',
  'Please upload a clearer copy of your licence.', null)$$, 'staff can ask an unfinished company for more information');
select is((select q.state::text from public.admin_verification_queue_all() q where q.org_id = 'd2711270-0000-0000-0000-0000000000f1'),
  'needs_information', 'and the row says so');
select lives_ok($$select public.admin_review_decision('d2711270-0000-0000-0000-0000000000f5', 'declined',
  'We could not confirm this company.', null)$$, 'staff can decline an unfinished company');
select throws_like($$select public.admin_review_decision('d2711270-0000-0000-0000-0000000000b1', 'approved', null, null)$$,
  '%has not signed the current terms%', 'approving a company that has not signed is refused');
reset role;
select is((select count(*)::int from public.notifications where org_id = 'd2711270-0000-0000-0000-0000000000f1'
            and kind = 'verification_needs_information'), 1, 'the unfinished company is told, with a bell notice');

-- It signs and finishes: Active again ---------------------------------------------
insert into public.terms_acceptances (org_id, terms_version, signature, accepted_by, legal_document_id)
select 'd2711270-0000-0000-0000-0000000000f1', 'terms_factory v1', 'U27 Mill', 'c2711270-0000-0000-0000-000000000002', d.id
  from public.legal_documents d where d.kind = 'terms_factory' order by d.version desc limit 1;
set local request.jwt.claims = '{"sub":"c2711270-0000-0000-0000-000000000002","role":"authenticated"}';
set local role authenticated;
select lives_ok($$update public.factory_profiles set onboarding_completed_at = now() where org_id = 'd2711270-0000-0000-0000-0000000000f1'$$,
  'having signed, it finishes signup');
select lives_ok($$select public.resubmit_for_review('d2711270-0000-0000-0000-0000000000f1')$$, 'and sends its profile back');
set local request.jwt.claims = '{"sub":"c2711270-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select q.state::text from public.admin_verification_queue() q where q.org_id = 'd2711270-0000-0000-0000-0000000000f1'),
  'ready_for_review', 'it is in Active, ready for review');
reset role;

select * from finish();
rollback;
