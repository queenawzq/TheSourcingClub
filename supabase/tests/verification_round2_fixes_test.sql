-- Verification, second round, the tester's findings (20261126100300 on):
-- one block per finding. Fixtures prefixed pgtap-r2f-; every count filters
-- on fixture ids.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users (id, email) values
  ('c2611261-0000-0000-0000-000000000001', 'pgtap-r2f-admin@example.com'),
  ('c2611261-0000-0000-0000-000000000002', 'pgtap-r2f-factory@example.com');
insert into public.platform_admins (user_id) values ('c2611261-0000-0000-0000-000000000001');
insert into public.orgs (id, type, name, slug) values
  ('d2611261-0000-0000-0000-0000000000f1', 'factory', 'R2F Mill', 'pgtap-r2f-mill'),
  ('d2611261-0000-0000-0000-0000000000f2', 'factory', 'R2F No Number', 'pgtap-r2f-no-number'),
  ('d2611261-0000-0000-0000-0000000000b1', 'brand', 'R2F Brand', 'pgtap-r2f-brand');
insert into public.org_members (org_id, user_id, role) values
  ('d2611261-0000-0000-0000-0000000000f1', 'c2611261-0000-0000-0000-000000000002', 'owner');
insert into public.factory_profiles (org_id, legal_name, country_code, location, onboarding_completed_at) values
  ('d2611261-0000-0000-0000-0000000000f1', 'R2F Mill Lda', 'PT', 'Porto, Portugal', now()),
  ('d2611261-0000-0000-0000-0000000000f2', null, 'PT', 'Braga, Portugal', now());
insert into public.brand_profiles (org_id, hq_location) values
  ('d2611261-0000-0000-0000-0000000000b1', 'London, United Kingdom');
insert into public.company_registrations (org_id, country_code, number) values
  ('d2611261-0000-0000-0000-0000000000f1', 'PT', '519211596');

set local request.jwt.claims = '{"sub":"c2611261-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;

-- C1: a registry number in the wrong format is refused, whether or not the company has one --
select throws_ok($$select public.admin_save_registry_check('d2611261-0000-0000-0000-0000000000f1', 'Published acts', 'site', 'found',
  '{"number":"51921159"}'::jsonb)$$,
  '22023', 'A Portuguese company number has 9 digits, e.g. 519211596: copy it again from the registry',
  'C1: a company with a number: an eight-digit registry number is refused');
select throws_ok($$select public.admin_save_registry_check('d2611261-0000-0000-0000-0000000000f2', 'Published acts', 'site', 'found',
  '{"number":"1234"}'::jsonb)$$,
  '22023', 'A Portuguese company number has 9 digits, e.g. 519211596: copy it again from the registry',
  'C1: and one with none, as before');
select lives_ok($$select public.admin_save_registry_check('d2611261-0000-0000-0000-0000000000f1', 'Published acts', 'site', 'found',
  '{"number":"NIF 519211596","name":"R2F Mill Lda"}'::jsonb)$$,
  'C1: a labelled number in the right format is saved');

reset role;
-- C2: the registry check's name is compared with the company's name now ----------
select ok(public.registry_approval_problem('d2611261-0000-0000-0000-0000000000f1') is distinct from 'name_differs',
  'C2: found under the company''s legal name: no name difference');
update public.factory_profiles set legal_name = 'Riverbend Knit Ltd' where org_id = 'd2611261-0000-0000-0000-0000000000f1';
select is(public.registry_approval_problem('d2611261-0000-0000-0000-0000000000f1'), 'name_differs',
  'C2: another legal name now: the registry''s name differs, at once');
select ok(not public.registry_check_holds('d2611261-0000-0000-0000-0000000000f1',
  (select c.details from public.current_registry_check('d2611261-0000-0000-0000-0000000000f1') c)), 'C2: and the check does not hold');
update public.factory_profiles set legal_name = 'R2F MILL, LDA.' where org_id = 'd2611261-0000-0000-0000-0000000000f1';
select ok(public.registry_approval_problem('d2611261-0000-0000-0000-0000000000f1') is distinct from 'name_differs',
  'C2: the same name written another way matches again, with no new check');
select ok(public.registry_check_holds('d2611261-0000-0000-0000-0000000000f1', '{"titleAtCheck":"R2F Mill Lda","nameAtCheck":"R2F Mill"}'::jsonb),
  'C2: with no registry name, the names it was checked under are compared the same way, not to the letter');
select ok(not exists (select 1 from pg_proc p where p.proname = 'registry_approval_problem'
  and pg_get_functiondef(p.oid) like '%''renamed''%'), 'C2: the approval rule has no renamed state');

-- M7: the overview's "awaiting review" is the queue's Active count ----------------
set local request.jwt.claims = '{"sub":"c2611261-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select is((select m.profiles_awaiting_review from public.admin_overview_metrics() m),
          (select count(*)::int from public.admin_verification_queue() q where q.state in ('ready_for_review', 'in_review')),
  'M7: the overview counts what the queue lists as Active');
select ok(exists (select 1 from public.admin_verification_queue() q where q.org_id = 'd2611261-0000-0000-0000-0000000000f2'),
  'M7: a finished signup is in the queue, and so in the count');
reset role;
select ok(not exists (select 1 from pg_proc p where p.proname = 'admin_overview_metrics'
  and pg_get_functiondef(p.oid) like '%needs_information%'), 'M7: a company asked for more information is not awaiting review');

select * from finish();
rollback;
