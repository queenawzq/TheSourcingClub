-- ============================================================================
-- Photo checks (20261111200000) and copies across TSC (20261111210000, v3.1)
-- ----------------------------------------------------------------------------
-- `pgtap111p-` prefixed, every assertion scoped to its own fixtures.
-- Mostly negative: a factory, a brand and a signed-out visitor read nothing,
-- write nothing and cannot call the server's functions; staff see the other
-- company's name; a company's own photos never match themselves.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(36);

-- Fixtures --------------------------------------------------------------------
insert into auth.users (id, email) values
  ('c1110000-0000-0000-0000-000000000001', 'p111p-admin@example.com'),
  ('c1110000-0000-0000-0000-000000000002', 'p111p-factory@example.com'),
  ('c1110000-0000-0000-0000-000000000003', 'p111p-brand@example.com');
insert into public.platform_admins (user_id, note) values ('c1110000-0000-0000-0000-000000000001', 'pgtap111p fixture');
insert into public.orgs (id, type, name, slug) values
  ('d1110000-0000-0000-0000-0000000000f1', 'factory', 'P111P Factory', 'pgtap111p-factory'),
  ('d1110000-0000-0000-0000-0000000000f2', 'factory', 'P111P Copycat', 'pgtap111p-copycat'),
  ('d1110000-0000-0000-0000-0000000000f3', 'factory', 'P111P Other',   'pgtap111p-other'),
  ('d1110000-0000-0000-0000-0000000000b1', 'brand',   'P111P Brand',   'pgtap111p-brand');
insert into public.org_members (org_id, user_id, role) values
  ('d1110000-0000-0000-0000-0000000000f1', 'c1110000-0000-0000-0000-000000000002', 'owner'),
  ('d1110000-0000-0000-0000-0000000000b1', 'c1110000-0000-0000-0000-000000000003', 'owner');
insert into public.documents (id, org_id, kind, bucket, storage_path, file_name) values
  ('a1110000-0000-0000-0000-000000000001', 'd1110000-0000-0000-0000-0000000000f1', 'product_image', 'org-public', 'd1110000-0000-0000-0000-0000000000f1/floor.jpg',  'floor.jpg'),
  ('a1110000-0000-0000-0000-000000000002', 'd1110000-0000-0000-0000-0000000000f1', 'product_image', 'org-public', 'd1110000-0000-0000-0000-0000000000f1/line.jpg',   'line.jpg'),
  ('a1110000-0000-0000-0000-000000000003', 'd1110000-0000-0000-0000-0000000000f2', 'product_image', 'org-public', 'd1110000-0000-0000-0000-0000000000f2/copy.jpg',   'copy.jpg'),
  ('a1110000-0000-0000-0000-000000000004', 'd1110000-0000-0000-0000-0000000000f3', 'product_image', 'org-public', 'd1110000-0000-0000-0000-0000000000f3/resize.jpg', 'resize.jpg'),
  ('a1110000-0000-0000-0000-000000000005', 'd1110000-0000-0000-0000-0000000000f3', 'product_image', 'org-public', 'd1110000-0000-0000-0000-0000000000f3/far.jpg',    'far.jpg');
-- v3.1: upload times decide who copied (A8); licenses compared with licenses only (B2).
insert into public.documents (id, org_id, kind, bucket, storage_path, file_name, created_at) values
  ('a1110000-0000-0000-0000-000000000006', 'd1110000-0000-0000-0000-0000000000f1', 'factory_photo',         'org-private', 'd1110000-0000-0000-0000-0000000000f1/ws.jpg',   'ws.jpg',   '2026-01-01'),
  ('a1110000-0000-0000-0000-000000000007', 'd1110000-0000-0000-0000-0000000000f2', 'factory_photo',         'org-private', 'd1110000-0000-0000-0000-0000000000f2/ws.jpg',   'ws.jpg',   '2026-02-01'),
  ('a1110000-0000-0000-0000-000000000008', 'd1110000-0000-0000-0000-0000000000f1', 'business_registration', 'org-private', 'd1110000-0000-0000-0000-0000000000f1/lic.pdf',  'lic.pdf',  '2026-01-01'),
  ('a1110000-0000-0000-0000-000000000009', 'd1110000-0000-0000-0000-0000000000f2', 'authorisation',         'org-private', 'd1110000-0000-0000-0000-0000000000f2/auth.jpg', 'auth.jpg', '2026-03-01'),
  ('a1110000-0000-0000-0000-00000000000a', 'd1110000-0000-0000-0000-0000000000f3', 'business_registration', 'org-private', 'd1110000-0000-0000-0000-0000000000f3/lic.jpg',  'lic.jpg',  '2026-01-01'),
  ('a1110000-0000-0000-0000-00000000000b', 'd1110000-0000-0000-0000-0000000000f3', 'product_image',         'org-public',  'd1110000-0000-0000-0000-0000000000f3/lic.jpg',  'lic.jpg',  '2026-01-01'),
  ('a1110000-0000-0000-0000-00000000000c', 'd1110000-0000-0000-0000-0000000000f3', 'logo',                  'org-public',  'd1110000-0000-0000-0000-0000000000f3/logo.png', 'logo.png', '2026-01-01');
-- Staff marked the first factory's workshop photo: found elsewhere, then own.
insert into public.verification_signals (org_id, kind, subject_id, result, checked_at) values
  ('d1110000-0000-0000-0000-0000000000f1', 'photo', 'a1110000-0000-0000-0000-000000000006', 'found_elsewhere', '2026-04-01'),
  ('d1110000-0000-0000-0000-0000000000f1', 'photo', 'a1110000-0000-0000-0000-000000000006', 'own',             '2026-04-02');

-- The server key records (as service_role) -----------------------------------
set local role service_role;
select lives_ok($$select public.record_photo_fingerprint('a1110000-0000-0000-0000-000000000001', repeat('a', 64), '00ff00ff00ff00ff')$$, 'server records a fingerprint');
select lives_ok($$select public.record_photo_fingerprint('a1110000-0000-0000-0000-000000000002', repeat('b', 64), 'ffffffffffffffff')$$, 'server records a second one');
-- the same file on the copycat
select lives_ok($$select public.record_photo_fingerprint('a1110000-0000-0000-0000-000000000003', repeat('a', 64), '00ff00ff00ff00ff')$$, 'same file on another company');
-- the same picture resized: 3 bits apart
select lives_ok($$select public.record_photo_fingerprint('a1110000-0000-0000-0000-000000000004', repeat('c', 64), '00ff00ff00ff00f8')$$, 'a resized copy');
-- an unrelated picture: 32 bits apart from the first, 32 from the second
select lives_ok($$select public.record_photo_fingerprint('a1110000-0000-0000-0000-000000000005', repeat('d', 64), 'ff00ff00ff00ff00')$$, 'an unrelated photo');
select throws_ok($$select public.record_photo_fingerprint('a1110000-0000-0000-0000-000000000005', 'not-a-hash', null)$$, '23514', null, 'a malformed hash is refused');
select lives_ok($$select public.record_photo_check('d1110000-0000-0000-0000-0000000000f1', '{"key":"photos","level":"low"}'::jsonb, null)$$, 'server records a check');
select lives_ok($$
  select public.record_photo_fingerprint('a1110000-0000-0000-0000-000000000006', repeat('e', 64), '0f0f0f0f0f0f0f0f'),
         public.record_photo_fingerprint('a1110000-0000-0000-0000-000000000007', repeat('e', 64), '0f0f0f0f0f0f0f0f'),
         -- a PDF license: no picture hash
         public.record_photo_fingerprint('a1110000-0000-0000-0000-000000000008', repeat('1', 64), null),
         public.record_photo_fingerprint('a1110000-0000-0000-0000-000000000009', repeat('1', 64), '0000000000000000'),
         -- another license on the same template: one bit from the authorisation photo
         public.record_photo_fingerprint('a1110000-0000-0000-0000-00000000000a', repeat('2', 64), '0000000000000001'),
         -- the license file posted as a product image elsewhere: another group
         public.record_photo_fingerprint('a1110000-0000-0000-0000-00000000000b', repeat('1', 64), '0000000000000000'),
         public.record_photo_fingerprint('a1110000-0000-0000-0000-00000000000c', repeat('e', 64), '0f0f0f0f0f0f0f0f')
$$, 'server fingerprints workshop photos, licenses and an authorisation');

-- v3.1: only the later uploader is flagged (A8)
select results_eq(
  $$select other_document_id, match, mine_later from public.photo_copies('d1110000-0000-0000-0000-0000000000f1') where document_id = 'a1110000-0000-0000-0000-000000000006'$$,
  $$values ('a1110000-0000-0000-0000-000000000007'::uuid, 'exact'::text, false)$$,
  'the first uploader sees the copy, not flagged; a logo with the same file is never compared'
);
select results_eq(
  $$select other_document_id, mine_later from public.photo_copies('d1110000-0000-0000-0000-0000000000f2') where document_id = 'a1110000-0000-0000-0000-000000000007'$$,
  $$values ('a1110000-0000-0000-0000-000000000006'::uuid, true)$$,
  'the later uploader is the one flagged'
);
-- B2: licenses, exact copies only, never against photos
select results_eq(
  $$select document_id, other_document_id, match, mine_later from public.photo_copies('d1110000-0000-0000-0000-0000000000f1') where copy_group = 'license'$$,
  $$values ('a1110000-0000-0000-0000-000000000008'::uuid, 'a1110000-0000-0000-0000-000000000009'::uuid, 'exact'::text, false)$$,
  'the same license file at another company, uploaded later there'
);
select results_eq(
  $$select document_id, other_document_id, mine_later from public.photo_copies('d1110000-0000-0000-0000-0000000000f2') where copy_group = 'license'$$,
  $$values ('a1110000-0000-0000-0000-000000000009'::uuid, 'a1110000-0000-0000-0000-000000000008'::uuid, true)$$,
  'the later license uploader is flagged; a license one bit apart on the same template is not a copy'
);
select is(
  (select count(*)::int from public.photo_copies('d1110000-0000-0000-0000-0000000000f3') where document_id in ('a1110000-0000-0000-0000-00000000000a', 'a1110000-0000-0000-0000-00000000000b', 'a1110000-0000-0000-0000-00000000000c')),
  0, 'a photo never matches a license file, and a logo is never compared'
);
select is(
  (select result from public.photo_staff_marks('d1110000-0000-0000-0000-0000000000f1') where document_id = 'a1110000-0000-0000-0000-000000000006'),
  'own', 'the latest staff mark on a photo wins'
);

-- The factory ------------------------------------------------------------------
set local role postgres;
set local request.jwt.claims = '{"sub":"c1110000-0000-0000-0000-000000000002","role":"authenticated"}';
set local role authenticated;
select throws_ok($$select * from public.photo_fingerprints$$, '42501', null, 'factory cannot read fingerprints');
select throws_ok($$select * from public.photo_checks$$, '42501', null, 'factory cannot read checks');
select throws_ok($$select * from public.admin_photo_duplicates('d1110000-0000-0000-0000-0000000000f1')$$, '42501', null, 'factory cannot see who shares its photo');
select throws_ok($$select public.admin_photo_check_latest('d1110000-0000-0000-0000-0000000000f1')$$, '42501', null, 'factory cannot read its own result');
select throws_ok($$select public.record_photo_fingerprint('a1110000-0000-0000-0000-000000000001', repeat('e', 64), null)$$, '42501', null, 'factory cannot record a fingerprint');
select throws_ok($$select public.record_photo_check('d1110000-0000-0000-0000-0000000000f1', '{"level":"high"}'::jsonb, null)$$, '42501', null, 'factory cannot record a result');
select throws_ok($$insert into public.photo_checks (org_id, result) values ('d1110000-0000-0000-0000-0000000000f1', '{"level":"high"}')$$, '42501', null, 'factory cannot insert a result');
select throws_ok($$select * from public.photo_copies('d1110000-0000-0000-0000-0000000000f1')$$, '42501', null, 'factory cannot see who shares its photo or license');
select throws_ok($$select * from public.photo_staff_marks('d1110000-0000-0000-0000-0000000000f1')$$, '42501', null, 'factory cannot read staff marks');

-- A brand ------------------------------------------------------------------------
set local role postgres;
set local request.jwt.claims = '{"sub":"c1110000-0000-0000-0000-000000000003","role":"authenticated"}';
set local role authenticated;
select throws_ok($$select * from public.admin_photo_duplicates('d1110000-0000-0000-0000-0000000000f1')$$, '42501', null, 'brand cannot see duplicates');
select throws_ok($$select public.admin_photo_check_latest('d1110000-0000-0000-0000-0000000000f1')$$, '42501', null, 'brand cannot read a result');
select throws_ok($$select * from public.photo_copies('d1110000-0000-0000-0000-0000000000f2')$$, '42501', null, 'brand cannot see copies');

-- Signed out ----------------------------------------------------------------------
set local role postgres;
set local request.jwt.claims = '{"role":"anon"}';
set local role anon;
select throws_ok($$select * from public.admin_photo_duplicates('d1110000-0000-0000-0000-0000000000f1')$$, '42501', null, 'anon cannot call it');
select throws_ok($$select * from public.photo_fingerprints$$, '42501', null, 'anon cannot read fingerprints');
select throws_ok($$select * from public.photo_copies('d1110000-0000-0000-0000-0000000000f1')$$, '42501', null, 'anon cannot call photo_copies');
select throws_ok($$select * from public.photo_staff_marks('d1110000-0000-0000-0000-0000000000f1')$$, '42501', null, 'anon cannot call photo_staff_marks');

-- Staff -------------------------------------------------------------------------
set local role postgres;
set local request.jwt.claims = '{"sub":"c1110000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select results_eq(
  $$select other_org_name, match, distance from public.admin_photo_duplicates('d1110000-0000-0000-0000-0000000000f1') where document_id in ('a1110000-0000-0000-0000-000000000001', 'a1110000-0000-0000-0000-000000000002') order by distance, other_org_name$$,
  $$values ('P111P Copycat'::text, 'exact'::text, 0), ('P111P Other'::text, 'similar'::text, 3)$$,
  'staff see the same file and the resized copy, with the names; not the unrelated photo, not its own second photo'
);
select is(
  (select count(*)::int from public.admin_photo_duplicates('d1110000-0000-0000-0000-0000000000f1') where other_org_id = 'd1110000-0000-0000-0000-0000000000f1'),
  0, 'a company never matches itself'
);
select is(public.admin_photo_check_latest('d1110000-0000-0000-0000-0000000000f1') ->> 'level', 'low', 'staff read the latest result');
select throws_ok($$select * from public.photo_checks$$, '42501', null, 'staff read through the functions, not the table');
select throws_ok($$select * from public.photo_copies('d1110000-0000-0000-0000-0000000000f1')$$, '42501', null, 'photo_copies is the server key''s only, staff too');
select throws_ok($$select public.copy_group('factory_photo')$$, '42501', null, 'copy_group is the server key''s only');

select * from finish();
rollback;
