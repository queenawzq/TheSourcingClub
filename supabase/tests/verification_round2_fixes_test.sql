-- Verification, second round, the tester's findings (20261126100300 on):
-- one block per finding. Fixtures prefixed pgtap-r2f-; every count filters
-- on fixture ids.
begin;
create extension if not exists pgtap with schema extensions;
select plan(37);

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
insert into public.factory_certifications (id, org_id, term_id)
select 'e2611261-0000-0000-0000-000000000001', 'd2611261-0000-0000-0000-0000000000f1', t.id
  from public.taxonomy_terms t where t.kind = 'certification' order by t.slug limit 1;

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

-- M1: a website looks like one, and is saved with https:// -----------------------------
select is(public.normalise_web_address('example.com'), 'https://example.com', 'M1: a domain is given https://');
select is(public.normalise_web_address(' http://a.pt/x?y=1 '), 'http://a.pt/x?y=1', 'M1: a URL is kept');
select is(public.normalise_web_address('  '), null, 'M1: blank is nothing');
select throws_ok($$select public.normalise_web_address('Rua Nova 1, Porto')$$, '22023', 'Enter a web address, e.g. example.com', 'M1: words are refused');
set local request.jwt.claims = '{"sub":"c2611261-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select throws_ok($$select public.admin_update_company_profile('d2611261-0000-0000-0000-0000000000b1', website => 'not a url')$$,
  '22023', 'Enter a web address, e.g. example.com', 'M1: staff cannot save "not a url" as a website');
select lives_ok($$select public.admin_update_company_profile('d2611261-0000-0000-0000-0000000000b1', website => 'r2f-brand.example')$$,
  'M1: a domain is saved');
select lives_ok($$select public.admin_update_company_profile('d2611261-0000-0000-0000-0000000000b1', website => '')$$,
  'M1: an empty website still clears it');
reset role;
select is((select details ->> 'to' from public.org_review_changes where org_id = 'd2611261-0000-0000-0000-0000000000b1' and kind = 'website'
            and details ? 'to'), 'https://r2f-brand.example', 'M1: saved, and written to the history, with https://');
set local request.jwt.claims = '{"sub":"c2611261-0000-0000-0000-000000000002","role":"authenticated"}';
set local role authenticated;
select throws_ok($$select public.admin_update_company_profile('d2611261-0000-0000-0000-0000000000b1', website => 'not a url')$$,
  '42501', null, 'M1: a company is refused as staff only, before the address is looked at');
reset role;

-- M3: a check's link is a web address when given ------------------------------------
set local request.jwt.claims = '{"sub":"c2611261-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select throws_ok($$select public.admin_save_registry_check('d2611261-0000-0000-0000-0000000000f2', 'Published acts', 'site', 'not_found',
  '{}'::jsonb, 'Not listed', 'Rua Nova 1, Porto')$$, '22023', 'Enter a web address, e.g. example.com', 'M3: an address typed as the link is refused');
select is((public.admin_save_registry_check('d2611261-0000-0000-0000-0000000000f2', 'Published acts', 'site', 'not_found',
  '{}'::jsonb, 'Not listed', 'publicacoes.mj.pt/pesquisa')).details ->> 'reference', 'https://publicacoes.mj.pt/pesquisa',
  'M3: a link without a scheme is saved with https://');
select is((public.admin_save_registry_check('d2611261-0000-0000-0000-0000000000f2', 'Published acts', 'site', 'not_found',
  '{}'::jsonb, 'Not listed', '')).details ->> 'reference', null, 'M3: no link is fine');
select throws_ok($$select public.admin_save_certificate_check('d2611261-0000-0000-0000-0000000000f1', 'e2611261-0000-0000-0000-000000000001', 'GOTS', 'found',
  '{}'::jsonb, null, 'not a link')$$, '22023', 'Enter a web address, e.g. example.com', 'M3: a certificate check refuses one too');
reset role;

-- M8: the Country edit takes exactly the countries signup offers, for every kind --
select is((select count(*)::int from public.signup_countries()), 255, 'M8: signup offers 255 countries');
select ok(not exists (select 1 from public.signup_countries() c where c.code in ('EU', 'UN', 'XK', 'ZZ')),
  'M8: groupings and reserved codes are not countries');
set local request.jwt.claims = '{"sub":"c2611261-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select lives_ok($$select public.admin_update_company_profile('d2611261-0000-0000-0000-0000000000b1', country => 'IE')$$,
  'M8: a brand moves to Ireland, which signup offers and the country terms never had');
select throws_ok($$select public.admin_update_company_profile('d2611261-0000-0000-0000-0000000000f2', country => 'EU')$$,
  '22023', 'Choose a country from the list', 'M8: a factory is refused a code signup does not offer');
select lives_ok($$select public.admin_update_company_profile('d2611261-0000-0000-0000-0000000000f2', country => 'Côte d’Ivoire')$$,
  'M8: a factory may be moved to any country signup offers, by name');
reset role;
select is((select hq_location from public.brand_profiles where org_id = 'd2611261-0000-0000-0000-0000000000b1'),
  'London, Ireland', 'M8: the brand''s location now names Ireland');
select is((select country_code || ' ' || location from public.factory_profiles where org_id = 'd2611261-0000-0000-0000-0000000000f2'),
  'CI Braga, Côte d’Ivoire', 'M8: the factory''s code and location are both written');

-- T8: a staff profile edit is a Company profile notice that says the new value ----
select is((select body from public.notifications where org_id = 'd2611261-0000-0000-0000-0000000000b1' and kind = 'profile_updated'
            and body like '%Ireland%'), 'We updated your country to Ireland.', 'T8: the notice names the new country');
select is((select body from public.notifications where org_id = 'd2611261-0000-0000-0000-0000000000b1' and kind = 'profile_updated'
            and body like '%website%' order by created_at desc limit 1), 'We updated your website to https://r2f-brand.example.', 'T8: and the new website');
select is(public.notification_email_category('profile_updated'), 'profile', 'T8: emailed under Company profile, not Account security');
select is(public.notification_email_category('payout_method_changed'), 'account', 'T8: the payout alert keeps Account security');
select ok(public.notification_email_enabled('d2611261-0000-0000-0000-0000000000b1', 'profile'), 'T8: sent to everyone, whatever the email settings');

select * from finish();
rollback;
