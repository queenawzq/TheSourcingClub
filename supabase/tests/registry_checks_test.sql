-- ============================================================================
-- Registration numbers and registry checks (20261108600000)
-- ----------------------------------------------------------------------------
-- `pgtap86-` prefixed, every assertion scoped to its own fixtures.
--
-- The number rules match src/shared/registration-number.mjs (same cases as
-- scripts/check-registration-number.mjs). The rest is mostly negative: a
-- brand never reads a number, nobody but staff records a check, nobody but
-- the server records an automatic one, a registration FILE no longer
-- verifies the company, and a member cannot review its own documents.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(34);

-- The rules -------------------------------------------------------------------
select is(public.registration_number_problem('CN', '91350100M000100Y43'), null, 'CN: published example passes');
select is(public.registration_number_problem('CN', '9135 0100 m000 100y 43'), null, 'CN: spaces and lower case are normalised');
select is(public.registration_number_problem('CN', '91350100M000100Y44'), 'check_digit', 'CN: wrong check character');
select is(public.registration_number_problem('CN', '91350100M000100I43'), 'format', 'CN: I is not in the alphabet');
select is(public.registration_number_problem('CN', '91440300MA5F00001A'), null, 'CN: a fake built with the check passes');
select is(public.registration_number_problem('PT', 'PT 501 964 843'), null, 'PT: published example with prefix passes');
select is(public.registration_number_problem('PT', '501964844'), 'check_digit', 'PT: wrong check digit');
select is(public.registration_number_problem('PT', '509999999'), null, 'PT: a fake built with the check passes');
select is(public.registration_number_problem('TR', '483 726 1591'), null, 'TR: a VKN passes its mod-10 check');
select is(public.registration_number_problem('TR', '4837261592'), 'check_digit', 'TR: wrong VKN check digit');
select is(public.registration_number_problem('TR', '0123456789000015'), 'format', 'TR: a MERSIS number is not a VKN');
select is(public.registration_number_problem('CN', '330100000012345'), 'old_number', 'CN: the old 15 digits');
select is(public.registration_number_problem(null, 'HRB 12345'), null, 'other: as written');
select is(public.registration_number_problem(null, ''), 'missing', 'other: blank is missing');

-- Fixtures --------------------------------------------------------------------
insert into auth.users (id, email) values
  ('c8600000-0000-0000-0000-000000000001', 'p86-admin@example.com'),
  ('c8600000-0000-0000-0000-000000000002', 'p86-factory@example.com'),
  ('c8600000-0000-0000-0000-000000000003', 'p86-brand@example.com');
insert into public.platform_admins (user_id, note) values ('c8600000-0000-0000-0000-000000000001', 'pgtap86 fixture');
insert into public.orgs (id, type, name, slug) values
  ('d8600000-0000-0000-0000-0000000000f1', 'factory', 'P86 Factory', 'pgtap86-factory'),
  ('d8600000-0000-0000-0000-0000000000b1', 'brand',   'P86 Brand',   'pgtap86-brand');
insert into public.org_members (org_id, user_id, role) values
  ('d8600000-0000-0000-0000-0000000000f1', 'c8600000-0000-0000-0000-000000000002', 'owner'),
  ('d8600000-0000-0000-0000-0000000000b1', 'c8600000-0000-0000-0000-000000000003', 'owner');
insert into public.factory_profiles (org_id, country_code, moq, onboarding_completed_at, published_at) values
  ('d8600000-0000-0000-0000-0000000000f1', 'PT', 100, now(), now());
insert into public.documents (id, org_id, kind, bucket, storage_path, file_name, status) values
  ('a8600000-0000-0000-0000-000000000001', 'd8600000-0000-0000-0000-0000000000f1', 'business_registration', 'org-private',
   'd8600000-0000-0000-0000-0000000000f1/registration.pdf', 'registration.pdf', 'pending');

-- The factory saves its number ------------------------------------------------
set local request.jwt.claims = '{"sub":"c8600000-0000-0000-0000-000000000002","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$select public.save_company_registration('d8600000-0000-0000-0000-0000000000f1', 'PT', '501964844')$$,
  '22023', null, 'a wrong check digit is refused unless confirmed'
);
select lives_ok(
  $$select public.save_company_registration('d8600000-0000-0000-0000-0000000000f1', 'PT', '501964844', null, null, true)$$,
  'and saved, flagged, when the factory confirms it'
);
select lives_ok(
  $$select public.save_company_registration('d8600000-0000-0000-0000-0000000000f1', 'PT', 'PT509999999', '123456789012')$$,
  'a member saves a Portuguese number and access code'
);
select is(
  (select number || ' ' || access_code || ' ' || check_digit_confirmed from public.company_registrations where org_id = 'd8600000-0000-0000-0000-0000000000f1'),
  '509999999 1234-5678-9012 false', 'stored normalised, and a passing number is no longer flagged'
);
select throws_ok(
  $$insert into public.company_registrations (org_id, number) values ('d8600000-0000-0000-0000-0000000000f1', 'x')$$,
  '42501', null, 'no direct write'
);
select throws_ok(
  $$select public.admin_record_registry_check('d8600000-0000-0000-0000-0000000000f1', 'vies', 'found')$$,
  '42501', null, 'the factory cannot record its own check'
);
select throws_ok(
  $$select public.record_registry_check('d8600000-0000-0000-0000-0000000000f1', '509999999', 'vies', 'found')$$,
  '42501', null, 'nor the server''s automatic one'
);
select throws_ok(
  $$update public.documents set status = 'verified' where id = 'a8600000-0000-0000-0000-000000000001'$$,
  '42501', null, 'a member cannot mark its own document verified'
);
select is(
  (select public.can_request_registry_check('d8600000-0000-0000-0000-0000000000f1')), true,
  'a member may ask for a VIES check of its own company'
);

-- A brand reads nothing ---------------------------------------------------------
reset role;
set local request.jwt.claims = '{"sub":"c8600000-0000-0000-0000-000000000003","role":"authenticated"}';
set local role authenticated;

select is((select count(*)::int from public.company_registrations where org_id = 'd8600000-0000-0000-0000-0000000000f1'), 0, 'a brand never reads the number');
select throws_ok($$select public.admin_registry_detail('d8600000-0000-0000-0000-0000000000f1')$$, '42501', null, 'nor the checks');
select is((select public.can_request_registry_check('d8600000-0000-0000-0000-0000000000f1')), false, 'nor asks for one');

-- Staff -------------------------------------------------------------------------
reset role;
set local request.jwt.claims = '{"sub":"c8600000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$select public.admin_record_registry_check('d8600000-0000-0000-0000-0000000000f1', 'certidao', 'mismatch')$$,
  '22023', null, 'a mismatch needs a note'
);
select lives_ok(
  $$select public.admin_record_registry_check('d8600000-0000-0000-0000-0000000000f1', 'certidao', 'found', 'Name and address match')$$,
  'staff record a found check'
);
select is(
  (select (public.admin_registry_detail('d8600000-0000-0000-0000-0000000000f1') -> 'checks' -> 0 ->> 'checkedBy')),
  'p86-admin@example.com', 'the check says who'
);
select lives_ok(
  $$select public.review_document('a8600000-0000-0000-0000-000000000001', 'verified')$$,
  'staff verify the registration FILE'
);
select is(
  (select verification_status::text from public.factory_profiles where org_id = 'd8600000-0000-0000-0000-0000000000f1'),
  'unverified', 'which no longer verifies the company'
);

-- What a brand learns, once the company is approved ---------------------------------
reset role;
set local request.jwt.claims = '{"sub":"c8600000-0000-0000-0000-000000000003","role":"authenticated"}';
set local role authenticated;
select is(public.factory_registry_fact('d8600000-0000-0000-0000-0000000000f1'), null, 'nothing while the company is not verified');

reset role;
set local request.jwt.claims = '{"sub":"c8600000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select lives_ok(
  $$select public.admin_review_decision('d8600000-0000-0000-0000-0000000000f1', 'approved')$$,
  'staff approve the company'
);

reset role;
set local request.jwt.claims = '{"sub":"c8600000-0000-0000-0000-000000000003","role":"authenticated"}';
set local role authenticated;
select isnt(public.factory_registry_fact('d8600000-0000-0000-0000-0000000000f1'), null, 'then a brand learns when the registry was checked');

reset role;
select * from finish();
rollback;
