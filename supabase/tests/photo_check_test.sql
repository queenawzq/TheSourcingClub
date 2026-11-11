-- ============================================================================
-- Photo checks (20261111200000)
-- ----------------------------------------------------------------------------
-- `pgtap111p-` prefixed, every assertion scoped to its own fixtures.
-- Mostly negative: a factory, a brand and a signed-out visitor read nothing,
-- write nothing and cannot call the server's functions; staff see the other
-- company's name; a company's own photos never match themselves.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(22);

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

-- A brand ------------------------------------------------------------------------
set local role postgres;
set local request.jwt.claims = '{"sub":"c1110000-0000-0000-0000-000000000003","role":"authenticated"}';
set local role authenticated;
select throws_ok($$select * from public.admin_photo_duplicates('d1110000-0000-0000-0000-0000000000f1')$$, '42501', null, 'brand cannot see duplicates');
select throws_ok($$select public.admin_photo_check_latest('d1110000-0000-0000-0000-0000000000f1')$$, '42501', null, 'brand cannot read a result');

-- Signed out ----------------------------------------------------------------------
set local role postgres;
set local request.jwt.claims = '{"role":"anon"}';
set local role anon;
select throws_ok($$select * from public.admin_photo_duplicates('d1110000-0000-0000-0000-0000000000f1')$$, '42501', null, 'anon cannot call it');
select throws_ok($$select * from public.photo_fingerprints$$, '42501', null, 'anon cannot read fingerprints');

-- Staff -------------------------------------------------------------------------
set local role postgres;
set local request.jwt.claims = '{"sub":"c1110000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select results_eq(
  $$select other_org_name, match, distance from public.admin_photo_duplicates('d1110000-0000-0000-0000-0000000000f1') order by distance, other_org_name$$,
  $$values ('P111P Copycat'::text, 'exact'::text, 0), ('P111P Other'::text, 'similar'::text, 3)$$,
  'staff see the same file and the resized copy, with the names; not the unrelated photo, not its own second photo'
);
select is(
  (select count(*)::int from public.admin_photo_duplicates('d1110000-0000-0000-0000-0000000000f1') where other_org_id = 'd1110000-0000-0000-0000-0000000000f1'),
  0, 'a company never matches itself'
);
select is(public.admin_photo_check_latest('d1110000-0000-0000-0000-0000000000f1') ->> 'level', 'low', 'staff read the latest result');
select throws_ok($$select * from public.photo_checks$$, '42501', null, 'staff read through the functions, not the table');

select * from finish();
rollback;
