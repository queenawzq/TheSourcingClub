-- ============================================================================
-- Staff add a company's business registration (20261117530000)
-- ----------------------------------------------------------------------------
-- `pgtap-c4-` prefixed, every count filtered on its own fixture ids.
--
-- Mostly negative: nobody but staff writes through it, a non-admin learns
-- nothing about whether a company exists, a note is required, and a number
-- the company's own save would refuse is refused here too. Then staff add a
-- number, the company is told with the note, and the company reads it.
--
-- Whether Tazapay then accepts the payout account is decided in JavaScript
-- (tazapayDetailsProblems, src/shared/tazapay-payout.mjs), not in SQL; it
-- needs the company's number on file in the account's country, which is what
-- the last assertions pin.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(37);

-- Fixtures --------------------------------------------------------------------
insert into auth.users (id, email) values
  ('c4c40000-0000-0000-0000-000000000001', 'pc4-admin@example.com'),
  ('c4c40000-0000-0000-0000-000000000002', 'pc4-factory@example.com'),
  ('c4c40000-0000-0000-0000-000000000003', 'pc4-other-factory@example.com'),
  ('c4c40000-0000-0000-0000-000000000004', 'pc4-brand@example.com'),
  ('c4c40000-0000-0000-0000-000000000005', 'pc4-staff-member@example.com');
insert into public.platform_admins (user_id, note) values
  ('c4c40000-0000-0000-0000-000000000001', 'pgtap-c4 fixture'),
  ('c4c40000-0000-0000-0000-000000000005', 'pgtap-c4 fixture: staff who is also a member');
insert into public.orgs (id, type, name, slug) values
  ('d4c40000-0000-0000-0000-0000000000f1', 'factory', 'PC4 Ningbo Knit',  'pgtap-c4-factory'),
  ('d4c40000-0000-0000-0000-0000000000f2', 'factory', 'PC4 Istanbul Knit', 'pgtap-c4-other-factory'),
  ('d4c40000-0000-0000-0000-0000000000b1', 'brand',   'PC4 Brand',        'pgtap-c4-brand');
insert into public.org_members (org_id, user_id, role) values
  ('d4c40000-0000-0000-0000-0000000000f1', 'c4c40000-0000-0000-0000-000000000002', 'owner'),
  ('d4c40000-0000-0000-0000-0000000000f2', 'c4c40000-0000-0000-0000-000000000003', 'owner'),
  ('d4c40000-0000-0000-0000-0000000000b1', 'c4c40000-0000-0000-0000-000000000004', 'owner'),
  ('d4c40000-0000-0000-0000-0000000000f2', 'c4c40000-0000-0000-0000-000000000005', 'member');
insert into public.factory_profiles (org_id, country_code) values
  ('d4c40000-0000-0000-0000-0000000000f1', 'CN'),
  ('d4c40000-0000-0000-0000-0000000000f2', 'TR');

-- Signed out: no execute at all ------------------------------------------------
set local role anon;
select throws_ok(
  $$select public.admin_save_company_registration('d4c40000-0000-0000-0000-0000000000f1', 'CN', '91350100M000100Y43', 'From the licence')$$,
  '42501', null, 'signed out: refused'
);
reset role;

-- The company's own owner ------------------------------------------------------
set local request.jwt.claims = '{"sub":"c4c40000-0000-0000-0000-000000000002","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$select public.admin_save_company_registration('d4c40000-0000-0000-0000-0000000000f1', 'CN', '91350100M000100Y43', 'From the licence')$$,
  '42501', null, 'a member of the company cannot use the staff entry'
);
select throws_ok(
  $$select public.admin_save_company_registration('d4c40000-0000-0000-0000-0000000000f2', 'TR', '4837261591', 'From the tax plate')$$,
  '42501', null, 'nor on another factory'
);
select throws_ok(
  $$select public.admin_save_company_registration('d4c40000-0000-0000-0000-00000000dead', 'CN', '91350100M000100Y43', 'From the licence')$$,
  '42501', null, 'an unknown company is 42501 too: refused before anything is read'
);
reset role;

-- Another factory's owner ------------------------------------------------------
set local request.jwt.claims = '{"sub":"c4c40000-0000-0000-0000-000000000003","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$select public.admin_save_company_registration('d4c40000-0000-0000-0000-0000000000f1', 'CN', '91350100M000100Y43', 'From the licence')$$,
  '42501', null, 'the owner of another factory is refused'
);
reset role;

-- A brand ----------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"c4c40000-0000-0000-0000-000000000004","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$select public.admin_save_company_registration('d4c40000-0000-0000-0000-0000000000f1', 'CN', '91350100M000100Y43', 'From the licence')$$,
  '42501', null, 'a brand member is refused'
);
reset role;

-- Staff who belong to the company ----------------------------------------------
set local request.jwt.claims = '{"sub":"c4c40000-0000-0000-0000-000000000005","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$select public.admin_save_company_registration('d4c40000-0000-0000-0000-0000000000f2', 'TR', '4837261591', 'From the tax plate')$$,
  '42501', null, 'staff cannot change the registration of a company they belong to'
);
reset role;

select is((select count(*)::int from public.company_registrations
            where org_id in ('d4c40000-0000-0000-0000-0000000000f1', 'd4c40000-0000-0000-0000-0000000000f2')), 0,
  'nothing was written by a refused call');
select is((select count(*)::int from public.notifications
            where org_id in ('d4c40000-0000-0000-0000-0000000000f1', 'd4c40000-0000-0000-0000-0000000000f2')), 0,
  'and nobody was notified');

-- Staff: what is refused ---------------------------------------------------------
set local request.jwt.claims = '{"sub":"c4c40000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$select public.admin_save_company_registration('d4c40000-0000-0000-0000-00000000dead', 'CN', '91350100M000100Y43', 'From the licence')$$,
  'P0002', null, 'staff: an unknown company is not found'
);
select throws_ok(
  $$select public.admin_save_company_registration('d4c40000-0000-0000-0000-0000000000b1', 'CN', '91350100M000100Y43', 'From the licence')$$,
  'P0002', null, 'a brand has no registration to add'
);
select throws_ok(
  $$select public.admin_save_company_registration('d4c40000-0000-0000-0000-0000000000f1', 'CN', '91350100M000100Y43', null)$$,
  '22023', null, 'refused without a note'
);
select throws_ok(
  $$select public.admin_save_company_registration('d4c40000-0000-0000-0000-0000000000f1', 'CN', '91350100M000100Y43', '   ')$$,
  '22023', null, 'a blank note is no note'
);
select throws_ok(
  $$select public.admin_save_company_registration('d4c40000-0000-0000-0000-0000000000f1', 'China', '91350100M000100Y43', 'From the licence')$$,
  '22023', null, 'the country is a two-letter code'
);
select throws_ok(
  $$select public.admin_save_company_registration('d4c40000-0000-0000-0000-0000000000f1', 'CN', '', 'From the licence')$$,
  '22023', 'registration number: missing', 'a number is required'
);
select throws_ok(
  $$select public.admin_save_company_registration('d4c40000-0000-0000-0000-0000000000f1', 'CN', '91350100M000100I43', 'From the licence')$$,
  '22023', 'registration number: format', 'a bad format is refused, as for the company'
);
select throws_ok(
  $$select public.admin_save_company_registration('d4c40000-0000-0000-0000-0000000000f1', 'CN', '330100000012345', 'From the licence')$$,
  '22023', 'registration number: old_number', 'China''s old 15 digits are refused, as for the company'
);
select throws_ok(
  $$select public.admin_save_company_registration('d4c40000-0000-0000-0000-0000000000f1', 'CN', '91350100M000100Y44', 'From the licence', true)$$,
  '22023', 'registration number: check_digit', 'a Chinese check digit that fails is refused even when confirmed'
);
select throws_ok(
  $$select public.admin_save_company_registration('d4c40000-0000-0000-0000-0000000000f2', 'TR', '4837261592', 'From the tax plate')$$,
  '22023', 'registration number: check_digit', 'elsewhere a failing check digit is refused unless confirmed'
);

-- Staff: added -----------------------------------------------------------------
select lives_ok(
  $$select public.admin_save_company_registration('d4c40000-0000-0000-0000-0000000000f1', 'cn', '9135 0100 m000 100y 43', 'Taken from the business licence uploaded on Nov 12.')$$,
  'staff add a Chinese number with a note'
);
select lives_ok(
  $$select public.admin_save_company_registration('d4c40000-0000-0000-0000-0000000000f2', 'TR', '4837261592', 'Checked against the tax plate.', true)$$,
  'and a Turkish number whose check digit staff confirmed'
);
reset role;

select is(
  (select country_code || ' ' || number || ' ' || number_source from public.company_registrations
    where org_id = 'd4c40000-0000-0000-0000-0000000000f1'),
  'CN 91350100M000100Y43 staff', 'stored normalised, from staff');
select is(
  (select updated_by from public.company_registrations where org_id = 'd4c40000-0000-0000-0000-0000000000f1'),
  'c4c40000-0000-0000-0000-000000000001'::uuid, 'updated_by is the staff member');
select is(
  (select check_digit_confirmed from public.company_registrations where org_id = 'd4c40000-0000-0000-0000-0000000000f2'),
  true, 'a confirmed check digit is flagged');
select is(
  (select count(*)::int from public.registration_number_entries
    where org_id = 'd4c40000-0000-0000-0000-0000000000f1'
      and entered_by = 'c4c40000-0000-0000-0000-000000000001'
      and note = 'Taken from the business licence uploaded on Nov 12.'), 1,
  'who entered it and why is kept for staff');
select is(
  (select title || ' | ' || body from public.notifications
    where org_id = 'd4c40000-0000-0000-0000-0000000000f1' and kind = 'registration_number_set'),
  'TSC added your registration number | Taken from the business licence uploaded on Nov 12.',
  'the company is told, with the note');

-- Staff: changed ---------------------------------------------------------------
set local request.jwt.claims = '{"sub":"c4c40000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select lives_ok(
  $$select public.admin_save_company_registration('d4c40000-0000-0000-0000-0000000000f1', 'CN', '91440300MA5F00001A', 'Corrected from the renewed licence.')$$,
  'staff change the number'
);
reset role;
select is(
  (select count(*)::int from public.notifications
    where org_id = 'd4c40000-0000-0000-0000-0000000000f1' and kind = 'registration_number_set'
      and title = 'TSC changed your registration number' and body = 'Corrected from the renewed licence.'), 1,
  'a change is said as a change');
select is(
  (select count(*)::int from public.registration_number_entries where org_id = 'd4c40000-0000-0000-0000-0000000000f1'), 2,
  'each entry is kept');

-- Who reads it -------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"c4c40000-0000-0000-0000-000000000002","role":"authenticated"}';
set local role authenticated;
select is(
  (select number from public.company_registrations where org_id = 'd4c40000-0000-0000-0000-0000000000f1'),
  '91440300MA5F00001A', 'the company reads the number staff added');
select is(
  (select count(*)::int from public.notifications
    where org_id = 'd4c40000-0000-0000-0000-0000000000f1' and kind = 'registration_number_set'), 2,
  'and both notifications');
select throws_ok(
  $$select count(*) from public.registration_number_entries where org_id = 'd4c40000-0000-0000-0000-0000000000f1'$$,
  '42501', null, 'but not the staff record');
reset role;

set local request.jwt.claims = '{"sub":"c4c40000-0000-0000-0000-000000000003","role":"authenticated"}';
set local role authenticated;
select is(
  (select count(*)::int from public.company_registrations where org_id = 'd4c40000-0000-0000-0000-0000000000f1'), 0,
  'another factory never reads it');
select is(
  (select count(*)::int from public.notifications where org_id = 'd4c40000-0000-0000-0000-0000000000f1'), 0,
  'nor the notifications');
reset role;

set local request.jwt.claims = '{"sub":"c4c40000-0000-0000-0000-000000000004","role":"authenticated"}';
set local role authenticated;
select is(
  (select count(*)::int from public.company_registrations where org_id = 'd4c40000-0000-0000-0000-0000000000f1'), 0,
  'a brand never reads it');
reset role;

-- What Tazapay's check reads (api/_provider-payouts.js): the number in the
-- account's country.
select is(
  (select public.registration_number_problem(country_code, number) from public.company_registrations
    where org_id = 'd4c40000-0000-0000-0000-0000000000f1' and country_code = 'CN'),
  null, 'the company now has a valid Chinese number on file for a CN payout account');
select is(
  (select count(*)::int from public.factory_profiles
    where org_id = 'd4c40000-0000-0000-0000-0000000000f1' and verification_status = 'verified'), 0,
  'adding a number does not verify the company');

select * from finish();
rollback;
