-- The number staff type in a Found check counts; Couldn't check + note counts
-- for a Chinese company with no number; a matching automatic VIES answer
-- counts (20261124320000). Fixtures prefixed pgtap2432-; every count filters
-- on its own ids.
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

set local tsc.skip_terms_guard = 'on';

insert into auth.users (id, email) values
  ('c2432000-0000-0000-0000-000000000001', 'p2432-admin@example.com'),
  ('c2432000-0000-0000-0000-000000000002', 'p2432-owner@example.com');
insert into public.platform_admins (user_id) values ('c2432000-0000-0000-0000-000000000001');
insert into public.orgs (id, type, name, slug) values
  ('d2432000-0000-0000-0000-0000000000c1', 'factory', 'P2432 China One',   'pgtap2432-cn1'),
  ('d2432000-0000-0000-0000-0000000000c2', 'factory', 'P2432 China Two',   'pgtap2432-cn2'),
  ('d2432000-0000-0000-0000-0000000000c3', 'factory', 'P2432 China Three', 'pgtap2432-cn3'),
  ('d2432000-0000-0000-0000-0000000000a1', 'factory', 'P2432 Texteis',     'pgtap2432-pt1'),
  ('d2432000-0000-0000-0000-0000000000a2', 'factory', 'P2432 Other PT',    'pgtap2432-pt2');
insert into public.org_members (org_id, user_id, role) values
  ('d2432000-0000-0000-0000-0000000000c1', 'c2432000-0000-0000-0000-000000000002', 'owner');
insert into public.factory_profiles (org_id, country_code, legal_name) values
  ('d2432000-0000-0000-0000-0000000000c1', 'CN', null),
  ('d2432000-0000-0000-0000-0000000000c2', 'CN', null),
  ('d2432000-0000-0000-0000-0000000000c3', 'CN', null),
  ('d2432000-0000-0000-0000-0000000000a1', 'PT', 'P2432 Texteis Lda'),
  ('d2432000-0000-0000-0000-0000000000a2', 'PT', 'P2432 Other Lda');
-- Saved before any licence was read: a Chinese company with no number.
insert into public.company_registrations (org_id, country_code, number) values
  ('d2432000-0000-0000-0000-0000000000c1', 'CN', null),
  ('d2432000-0000-0000-0000-0000000000c2', 'CN', null),
  ('d2432000-0000-0000-0000-0000000000c3', 'CN', '91330109MA2P24321Q'),
  ('d2432000-0000-0000-0000-0000000000a1', 'PT', '519243200'),
  ('d2432000-0000-0000-0000-0000000000a2', 'PT', '509243215');

select is(public.registry_approval_problem('d2432000-0000-0000-0000-0000000000c1'), 'number_unread',
  'no licence, no number: Approve waits for the number');

set local request.jwt.claims = '{"sub":"c2432000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;

-- A number that fails its check digit is refused, and nothing is saved.
select throws_ok($$select public.admin_save_registry_check('d2432000-0000-0000-0000-0000000000c1', 'GSXT', 'gsxt', 'found',
  '{"name":"P2432 China One","number":"91330109MA2P24320X"}'::jsonb)$$, '22023',
  'the registration number fails its check digit: copy it again from the registry', 'a mistyped credit code is refused');

-- Found, with the number read off the registry.
select lives_ok($$select public.admin_save_registry_check('d2432000-0000-0000-0000-0000000000c1', 'GSXT', 'gsxt', 'found',
  '{"name":"P2432 China One","number":"91330109MA2P24320M"}'::jsonb)$$, 'Found with a number saves');
reset role;
select is((select number from public.company_registrations where org_id = 'd2432000-0000-0000-0000-0000000000c1'), '91330109MA2P24320M',
  'the typed number is now the company''s');
select is((select number_source from public.company_registrations where org_id = 'd2432000-0000-0000-0000-0000000000c1'), 'staff',
  'recorded as staff''s');
select is((select count(*)::int from public.registration_number_entries where org_id = 'd2432000-0000-0000-0000-0000000000c1'), 1,
  'and who typed it is kept');
select is((select c.number_checked from public.current_registry_check('d2432000-0000-0000-0000-0000000000c1') c), '91330109MA2P24320M',
  'the check is on that number, so the page shows it');
select is(public.registry_approval_problem('d2432000-0000-0000-0000-0000000000c1'), null, 'Approve no longer waits');
select is((select count(*)::int from public.registry_checks where org_id = 'd2432000-0000-0000-0000-0000000000c1'), 1,
  'the refused save left no check behind');

-- Couldn't check, with a note: staff's judgement, also with no number.
set local role authenticated;
select lives_ok($$select public.admin_save_registry_check('d2432000-0000-0000-0000-0000000000c2', 'GSXT', 'gsxt', 'could_not_check',
  '{}'::jsonb, 'GSXT needs a mainland connection; the licence photo is clear')$$, 'Couldn''t check with a note saves');
reset role;
select is((select c.result from public.current_registry_check('d2432000-0000-0000-0000-0000000000c2') c), 'could_not_check',
  'it is the current check');
select is(public.registry_approval_problem('d2432000-0000-0000-0000-0000000000c2'), null, 'and Approve no longer waits for a number');
select is((select number from public.company_registrations where org_id = 'd2432000-0000-0000-0000-0000000000c2'), null,
  'no number is invented');

-- A company that has a number keeps it: a different one typed is a difference the page shows.
set local role authenticated;
select lives_ok($$select public.admin_save_registry_check('d2432000-0000-0000-0000-0000000000c3', 'GSXT', 'gsxt', 'found',
  '{"number":"91440111MA59C2RY8C"}'::jsonb)$$, 'Found with another number saves');
reset role;
select is((select number from public.company_registrations where org_id = 'd2432000-0000-0000-0000-0000000000c3'), '91330109MA2P24321Q',
  'the company''s own number is not replaced');

-- An automatic VIES answer: counts when it names the company, not otherwise.
insert into public.registry_checks (org_id, country_code, number_checked, source, result, automatic, details) values
  ('d2432000-0000-0000-0000-0000000000a1', 'PT', '519243200', 'vies', 'registered', true, '{"name":"P2432 Texteis Lda"}'),
  ('d2432000-0000-0000-0000-0000000000a2', 'PT', '509243215', 'vies', 'registered', true, '{"name":"Somebody Else SA"}');
select is(public.registry_approval_problem('d2432000-0000-0000-0000-0000000000a1'), null, 'VIES naming the company counts');
select is(public.registry_approval_problem('d2432000-0000-0000-0000-0000000000a2'), 'no_check', 'VIES with another name does not');

select * from finish();
rollback;
