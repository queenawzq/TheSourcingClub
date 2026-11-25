-- Approve waits for the signed terms (20261124310000). Fixtures prefixed
-- pgtap2431-; every count filters on its own ids.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

-- The registry guard is tested in registry_checks_test.sql.
set local tsc.skip_registry_guard = 'on';

insert into auth.users (id, email) values
  ('c2431000-0000-0000-0000-000000000001', 'p2431-admin@example.com'),
  ('c2431000-0000-0000-0000-000000000002', 'p2431-factory@example.com'),
  ('c2431000-0000-0000-0000-000000000003', 'p2431-brand@example.com'),
  ('c2431000-0000-0000-0000-000000000004', 'p2431-trader@example.com');
insert into public.platform_admins (user_id) values ('c2431000-0000-0000-0000-000000000001');
insert into public.orgs (id, type, name, slug) values
  ('d2431000-0000-0000-0000-0000000000f1', 'factory', 'P2431 Factory', 'pgtap2431-factory'),
  ('d2431000-0000-0000-0000-0000000000f2', 'factory', 'P2431 Trader',  'pgtap2431-trader'),
  ('d2431000-0000-0000-0000-0000000000b1', 'brand',   'P2431 Brand',   'pgtap2431-brand');
insert into public.org_members (org_id, user_id, role) values
  ('d2431000-0000-0000-0000-0000000000f1', 'c2431000-0000-0000-0000-000000000002', 'owner'),
  ('d2431000-0000-0000-0000-0000000000f2', 'c2431000-0000-0000-0000-000000000004', 'owner'),
  ('d2431000-0000-0000-0000-0000000000b1', 'c2431000-0000-0000-0000-000000000003', 'owner');
insert into public.factory_profiles (org_id, country_code) values
  ('d2431000-0000-0000-0000-0000000000f1', 'PT'),
  ('d2431000-0000-0000-0000-0000000000f2', 'PT');
insert into public.brand_profiles (org_id) values ('d2431000-0000-0000-0000-0000000000b1');

-- Only staff read it --------------------------------------------------------------
set local role anon;
select throws_ok($$select public.admin_terms_signed('d2431000-0000-0000-0000-0000000000f1')$$, '42501', null, 'signed out: refused');
reset role;
set local request.jwt.claims = '{"sub":"c2431000-0000-0000-0000-000000000002","role":"authenticated"}';
set local role authenticated;
select throws_ok($$select public.admin_terms_signed('d2431000-0000-0000-0000-0000000000f1')$$, '42501', null, 'the company itself: refused');
select throws_ok($$select public.org_signed_current_terms('d2431000-0000-0000-0000-0000000000f1')$$, '42501', null, 'the inner check is not callable');
reset role;

-- Not signed: refused -------------------------------------------------------------
set local request.jwt.claims = '{"sub":"c2431000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select is(public.admin_terms_signed('d2431000-0000-0000-0000-0000000000f1'), false, 'staff read: not signed');
select throws_ok($$select public.admin_review_decision('d2431000-0000-0000-0000-0000000000f1', 'approved')$$, '22023',
  'the company has not signed the current terms: it signs them at the end of onboarding', 'Approve is refused without terms');
select lives_ok($$select public.admin_review_decision('d2431000-0000-0000-0000-0000000000f1', 'needs_information', 'Please sign the terms')$$,
  'other decisions are not held up');
reset role;
select is((select verification_status::text from public.factory_profiles where org_id = 'd2431000-0000-0000-0000-0000000000f1'), 'pending',
  'the factory is not verified');

-- The brand signed a vendor's terms: still not its own ---------------------------
insert into public.terms_acceptances (org_id, terms_version, signature, accepted_by, legal_document_id)
select 'd2431000-0000-0000-0000-0000000000b1', 'terms_factory v1', 'P2431 Brand', 'c2431000-0000-0000-0000-000000000003', d.id
  from public.legal_documents d where d.kind = 'terms_factory' order by d.version desc limit 1;
set local role authenticated;
select throws_ok($$select public.admin_review_decision('d2431000-0000-0000-0000-0000000000b1', 'approved')$$, '22023', null,
  'a brand needs the brand terms');
reset role;

-- Signed: allowed -----------------------------------------------------------------
insert into public.terms_acceptances (org_id, terms_version, signature, accepted_by, legal_document_id)
select 'd2431000-0000-0000-0000-0000000000f1', 'terms_factory v1', 'P2431 Factory', 'c2431000-0000-0000-0000-000000000002', d.id
  from public.legal_documents d where d.kind = 'terms_factory' order by d.version desc limit 1;
set local role authenticated;
select is(public.admin_terms_signed('d2431000-0000-0000-0000-0000000000f1'), true, 'staff read: signed');
select lives_ok($$select public.admin_review_decision('d2431000-0000-0000-0000-0000000000f1', 'approved')$$, 'Approve goes through once signed');
reset role;
select is((select verification_status::text from public.factory_profiles where org_id = 'd2431000-0000-0000-0000-0000000000f1'), 'verified',
  'the factory is verified');

-- A trading company's terms count for a vendor (staff may change its type) ---------
insert into public.terms_acceptances (org_id, terms_version, signature, accepted_by, legal_document_id)
select 'd2431000-0000-0000-0000-0000000000f2', 'terms_trading v1', 'P2431 Trader', 'c2431000-0000-0000-0000-000000000004', d.id
  from public.legal_documents d where d.kind = 'terms_trading' order by d.version desc limit 1;
select is(public.org_signed_current_terms('d2431000-0000-0000-0000-0000000000f2'), true, 'a vendor that signed the trading terms has signed');

-- A signature from before documents had ids counts for version 1 only --------------
insert into public.terms_acceptances (org_id, terms_version, signature, accepted_by)
values ('d2431000-0000-0000-0000-0000000000b1', '1', 'P2431 Brand', 'c2431000-0000-0000-0000-000000000003');
set local role authenticated;
select lives_ok($$select public.admin_review_decision('d2431000-0000-0000-0000-0000000000b1', 'approved')$$,
  'a brand that signed v1 before documents had ids can be approved');
reset role;

-- A new version needs a new signature --------------------------------------------
insert into public.legal_documents (kind, version, onboarding_en, full_en)
values ('terms_factory', 99, 'P2431 summary', 'P2431 full text');
insert into public.legal_documents (kind, version, onboarding_en, full_en)
values ('terms_trading', 99, 'P2431 summary', 'P2431 full text');
select is(public.org_signed_current_terms('d2431000-0000-0000-0000-0000000000f2'), false, 'after a new version the old signature no longer counts');
select throws_ok($$insert into public.org_reviews (org_id, state) values ('d2431000-0000-0000-0000-0000000000f2', 'approved')$$, '22023', null,
  'and approval is refused again, on any write');
select lives_ok($$update public.org_reviews set note = 'kept' where org_id = 'd2431000-0000-0000-0000-0000000000f1'$$,
  'a company already approved is not held up by a later version');

select * from finish();
rollback;
