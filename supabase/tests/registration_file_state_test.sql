-- ============================================================================
-- The newest registration file's own state (20261124610200, flow check R2S7)
-- ----------------------------------------------------------------------------
-- Run with:  supabase test db
--
-- `pgtapd2-` slugs and d2a…/d2b… ids; every assertion is scoped to these
-- fixtures, as in every other suite: they all share one database.
--
-- What this protects: registration_file_state() is security definer with no
-- policy behind it, so the member test is the whole guard. Another company's
-- member, a made-up id and anon are refused; the answer is four booleans and
-- never names the other company; a copy counts only when the other company
-- uploaded it first and the two are not both demo companies; a file with no
-- fingerprint yet answers null.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(11);

insert into auth.users (id, email, raw_user_meta_data) values
  ('d2a00000-0000-0000-0000-000000000001', 'd2-copier@example.test',   '{"name":"Copier"}'),
  ('d2a00000-0000-0000-0000-000000000002', 'd2-first@example.test',    '{"name":"First"}'),
  ('d2a00000-0000-0000-0000-000000000003', 'd2-early@example.test',    '{"name":"Early"}'),
  ('d2a00000-0000-0000-0000-000000000004', 'd2-demo1@example.test',    '{"name":"Demo One"}'),
  ('d2a00000-0000-0000-0000-000000000005', 'd2-unprinted@example.test', '{"name":"Unprinted"}');

insert into public.orgs (id, type, name, slug, is_demo) values
  ('d2b00000-0000-0000-0000-0000000000f1', 'factory', 'D2 Copier',      'pgtapd2-copier',    false),
  ('d2b00000-0000-0000-0000-0000000000f2', 'factory', 'D2 First',       'pgtapd2-first',     false),
  ('d2b00000-0000-0000-0000-0000000000f3', 'factory', 'D2 Early',       'pgtapd2-early',     false),
  ('d2b00000-0000-0000-0000-0000000000f4', 'factory', 'D2 Later',       'pgtapd2-later',     false),
  ('d2b00000-0000-0000-0000-0000000000d1', 'factory', 'D2 Demo One',    'pgtapd2-demo1',     true),
  ('d2b00000-0000-0000-0000-0000000000d2', 'factory', 'D2 Demo Two',    'pgtapd2-demo2',     true),
  ('d2b00000-0000-0000-0000-0000000000f5', 'factory', 'D2 Unprinted',   'pgtapd2-unprinted', false);

insert into public.org_members (org_id, user_id, role) values
  ('d2b00000-0000-0000-0000-0000000000f1', 'd2a00000-0000-0000-0000-000000000001', 'owner'),
  ('d2b00000-0000-0000-0000-0000000000f2', 'd2a00000-0000-0000-0000-000000000002', 'owner'),
  ('d2b00000-0000-0000-0000-0000000000f3', 'd2a00000-0000-0000-0000-000000000003', 'owner'),
  ('d2b00000-0000-0000-0000-0000000000d1', 'd2a00000-0000-0000-0000-000000000004', 'owner'),
  ('d2b00000-0000-0000-0000-0000000000f5', 'd2a00000-0000-0000-0000-000000000005', 'owner');

-- Copier's licence is byte-identical to First's, uploaded an hour after it.
-- Early's licence is copied by Later an hour after Early: Early is not the copier.
-- Demo One copies Demo Two: both demo, not counted. Unprinted has no fingerprint yet.
insert into public.documents (id, org_id, kind, bucket, storage_path, file_name, mime_type, size_bytes, status, created_at) values
  ('d2c00000-0000-0000-0000-0000000000f1', 'd2b00000-0000-0000-0000-0000000000f1', 'business_registration', 'org-private', 'd2b00000-0000-0000-0000-0000000000f1/business_registration/a.jpg', 'a.jpg', 'image/jpeg', 10, 'pending', now()),
  ('d2c00000-0000-0000-0000-0000000000f2', 'd2b00000-0000-0000-0000-0000000000f2', 'business_registration', 'org-private', 'd2b00000-0000-0000-0000-0000000000f2/business_registration/a.jpg', 'a.jpg', 'image/jpeg', 10, 'pending', now() - interval '1 hour'),
  ('d2c00000-0000-0000-0000-0000000000f3', 'd2b00000-0000-0000-0000-0000000000f3', 'business_registration', 'org-private', 'd2b00000-0000-0000-0000-0000000000f3/business_registration/b.jpg', 'b.jpg', 'image/jpeg', 10, 'pending', now() - interval '1 hour'),
  ('d2c00000-0000-0000-0000-0000000000f4', 'd2b00000-0000-0000-0000-0000000000f4', 'business_registration', 'org-private', 'd2b00000-0000-0000-0000-0000000000f4/business_registration/b.jpg', 'b.jpg', 'image/jpeg', 10, 'pending', now()),
  ('d2c00000-0000-0000-0000-0000000000d1', 'd2b00000-0000-0000-0000-0000000000d1', 'business_registration', 'org-private', 'd2b00000-0000-0000-0000-0000000000d1/business_registration/c.jpg', 'c.jpg', 'image/jpeg', 10, 'pending', now()),
  ('d2c00000-0000-0000-0000-0000000000d2', 'd2b00000-0000-0000-0000-0000000000d2', 'business_registration', 'org-private', 'd2b00000-0000-0000-0000-0000000000d2/business_registration/c.jpg', 'c.jpg', 'image/jpeg', 10, 'pending', now() - interval '1 hour'),
  ('d2c00000-0000-0000-0000-0000000000f5', 'd2b00000-0000-0000-0000-0000000000f5', 'business_registration', 'org-private', 'd2b00000-0000-0000-0000-0000000000f5/business_registration/d.jpg', 'd.jpg', 'image/jpeg', 10, 'pending', now());

insert into public.photo_fingerprints (document_id, org_id, sha256, dhash) values
  ('d2c00000-0000-0000-0000-0000000000f1', 'd2b00000-0000-0000-0000-0000000000f1', lpad('d20a', 64, 'd2'), null),
  ('d2c00000-0000-0000-0000-0000000000f2', 'd2b00000-0000-0000-0000-0000000000f2', lpad('d20a', 64, 'd2'), null),
  ('d2c00000-0000-0000-0000-0000000000f3', 'd2b00000-0000-0000-0000-0000000000f3', lpad('d20b', 64, 'd2'), null),
  ('d2c00000-0000-0000-0000-0000000000f4', 'd2b00000-0000-0000-0000-0000000000f4', lpad('d20b', 64, 'd2'), null),
  ('d2c00000-0000-0000-0000-0000000000d1', 'd2b00000-0000-0000-0000-0000000000d1', lpad('d20c', 64, 'd2'), null),
  ('d2c00000-0000-0000-0000-0000000000d2', 'd2b00000-0000-0000-0000-0000000000d2', lpad('d20c', 64, 'd2'), null);

-- ---------------------------------------------------------------- refusals
set local request.jwt.claims = '{"sub":"d2a00000-0000-0000-0000-000000000002","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$select public.registration_file_state('d2b00000-0000-0000-0000-0000000000f1')$$,
  '42501', NULL,
  'another company''s member is refused'
);
select throws_ok(
  $$select public.registration_file_state('d2b00000-0000-0000-0000-00000000ffff')$$,
  '42501', NULL,
  'a made-up company is refused the same way (no existence leak)'
);
reset role;

set local request.jwt.claims = '{"role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$select public.registration_file_state('d2b00000-0000-0000-0000-0000000000f1')$$,
  '42501', NULL,
  'a caller with no user is refused'
);
reset role;

set local role anon;
select throws_ok(
  $$select public.registration_file_state('d2b00000-0000-0000-0000-0000000000f1')$$,
  '42501', NULL,
  'anon cannot run it at all'
);
reset role;

-- ---------------------------------------------------------------- answers
set local request.jwt.claims = '{"sub":"d2a00000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
create temp table d2_copier as select public.registration_file_state('d2b00000-0000-0000-0000-0000000000f1') as s;
reset role;
select is((select (s ->> 'copy')::boolean from d2_copier), true,
  'a file another company uploaded first is a copy');
select is((select array_agg(k order by k) from d2_copier, jsonb_object_keys(s) k), array['copy', 'file', 'numberRead', 'read'],
  'the answer is four booleans: no org id, name or number');
select is((select (s ->> 'read')::boolean from d2_copier), false,
  'a file with no reading yet is not read');

set local request.jwt.claims = '{"sub":"d2a00000-0000-0000-0000-000000000003","role":"authenticated"}';
set local role authenticated;
select is((public.registration_file_state('d2b00000-0000-0000-0000-0000000000f3') ->> 'copy')::boolean, false,
  'the company that uploaded first is not the copier');
reset role;

set local request.jwt.claims = '{"sub":"d2a00000-0000-0000-0000-000000000004","role":"authenticated"}';
set local role authenticated;
select is((public.registration_file_state('d2b00000-0000-0000-0000-0000000000d1') ->> 'copy')::boolean, false,
  'two demo companies sharing a file are not a copy');
reset role;

set local request.jwt.claims = '{"sub":"d2a00000-0000-0000-0000-000000000005","role":"authenticated"}';
set local role authenticated;
select ok(public.registration_file_state('d2b00000-0000-0000-0000-0000000000f5') -> 'copy' = 'null'::jsonb,
  'a file with no fingerprint yet answers null');
select is((public.registration_file_state('d2b00000-0000-0000-0000-0000000000f5') ->> 'file')::boolean, true,
  'and it is a file');
reset role;

select * from finish();
rollback;
