-- ============================================================================
-- A company's own terms on its profile and requests (20261124608100, 608200)
-- ----------------------------------------------------------------------------
-- Run with:  supabase test db
--
-- `pgtapa2-` slugs and a2…/b2…/c2…/d2… ids; every count is scoped to these
-- fixtures, as in every other suite: they all share one database.
--
-- What this protects: linked_custom_terms() returns a company's custom terms
-- only where the link policies already show the link (a published profile,
-- one's own, a request one can see), only terms the linking company owns, and
-- never through a link planted on another company's subject; the read policy
-- on taxonomy_terms stays as it was. And the guard: a profile's tags are
-- written only by its own company, with its own custom terms.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(16);

-- ---------------------------------------------------------------------------
-- Fixtures: brand B1 (requests), brand B2 (a custom term on its profile),
-- vendors V1 (published), V2 (unpublished) and V3 (published).
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, raw_user_meta_data) values
  ('a2000000-0000-0000-0000-000000000001', 'a2-brand1@example.com',  '{"name":"Brand One"}'),
  ('a2000000-0000-0000-0000-000000000002', 'a2-vendor1@example.com', '{"name":"Vendor One"}'),
  ('a2000000-0000-0000-0000-000000000003', 'a2-vendor2@example.com', '{"name":"Vendor Two"}'),
  ('a2000000-0000-0000-0000-000000000004', 'a2-brand2@example.com',  '{"name":"Brand Two"}'),
  ('a2000000-0000-0000-0000-000000000005', 'a2-vendor3@example.com', '{"name":"Vendor Three"}');

insert into public.orgs (id, type, name, slug) values
  ('b2000000-0000-0000-0000-0000000000b1', 'brand',   'A2 Brand One',    'pgtapa2-brand1'),
  ('b2000000-0000-0000-0000-0000000000b2', 'brand',   'A2 Brand Two',    'pgtapa2-brand2'),
  ('b2000000-0000-0000-0000-0000000000f1', 'factory', 'A2 Vendor One',   'pgtapa2-vendor1'),
  ('b2000000-0000-0000-0000-0000000000f2', 'factory', 'A2 Vendor Two',   'pgtapa2-vendor2'),
  ('b2000000-0000-0000-0000-0000000000f3', 'factory', 'A2 Vendor Three', 'pgtapa2-vendor3');

insert into public.org_members (org_id, user_id, role) values
  ('b2000000-0000-0000-0000-0000000000b1', 'a2000000-0000-0000-0000-000000000001', 'owner'),
  ('b2000000-0000-0000-0000-0000000000f1', 'a2000000-0000-0000-0000-000000000002', 'owner'),
  ('b2000000-0000-0000-0000-0000000000f2', 'a2000000-0000-0000-0000-000000000003', 'owner'),
  ('b2000000-0000-0000-0000-0000000000b2', 'a2000000-0000-0000-0000-000000000004', 'owner'),
  ('b2000000-0000-0000-0000-0000000000f3', 'a2000000-0000-0000-0000-000000000005', 'owner');

insert into public.brand_profiles (org_id, hq_location) values
  ('b2000000-0000-0000-0000-0000000000b1', 'London, UK'),
  ('b2000000-0000-0000-0000-0000000000b2', 'Berlin, DE');

insert into public.factory_profiles (org_id, country_code, published_at, verification_status) values
  ('b2000000-0000-0000-0000-0000000000f1', 'CN', now(), 'verified'),
  ('b2000000-0000-0000-0000-0000000000f2', 'CN', null,  'unverified'),
  ('b2000000-0000-0000-0000-0000000000f3', 'CN', now(), 'verified');

-- Custom terms, each its company's own.
insert into public.taxonomy_terms (id, kind, slug, label_en, org_id) values
  ('c2000000-0000-0000-0000-000000000001', 'make', 'custom-a2-v1',        '羊绒开衫',          'b2000000-0000-0000-0000-0000000000f1'),
  ('c2000000-0000-0000-0000-000000000002', 'make', 'custom-a2-v1-unused', 'Unlinked style',    'b2000000-0000-0000-0000-0000000000f1'),
  ('c2000000-0000-0000-0000-000000000003', 'make', 'custom-a2-v2',        'Draft style',       'b2000000-0000-0000-0000-0000000000f2'),
  ('c2000000-0000-0000-0000-000000000004', 'product_category', 'custom-a2-b2', 'Brand two category', 'b2000000-0000-0000-0000-0000000000b2'),
  ('c2000000-0000-0000-0000-000000000005', 'product_category', 'custom-a2-draft', 'Draft request category', 'b2000000-0000-0000-0000-0000000000b1'),
  ('c2000000-0000-0000-0000-000000000006', 'product_category', 'custom-a2-other', 'Other invite category', 'b2000000-0000-0000-0000-0000000000b1'),
  ('c2000000-0000-0000-0000-000000000007', 'product_category', 'custom-a2-mine', 'My invite category', 'b2000000-0000-0000-0000-0000000000b1'),
  ('c2000000-0000-0000-0000-000000000008', 'make', 'custom-a2-v3',        'Contact us on WeChat', 'b2000000-0000-0000-0000-0000000000f3'),
  ('c2000000-0000-0000-0000-000000000009', 'make', 'custom-a2-v3-own',    'Vendor three style', 'b2000000-0000-0000-0000-0000000000f3');

insert into public.rfqs (id, brand_org_id, title, brief, status, visibility, quantity_total) values
  ('d2000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-0000000000b1', 'A2 draft', 'Draft.', 'draft', 'invited_only', 100),
  ('d2000000-0000-0000-0000-000000000002', 'b2000000-0000-0000-0000-0000000000b1', 'A2 others', 'Others.', 'open', 'invited_only', 100),
  ('d2000000-0000-0000-0000-000000000003', 'b2000000-0000-0000-0000-0000000000b1', 'A2 mine', 'Mine.', 'open', 'invited_only', 100);

insert into public.rfq_invitations (rfq_id, factory_org_id) values
  ('d2000000-0000-0000-0000-000000000002', 'b2000000-0000-0000-0000-0000000000f3'),
  ('d2000000-0000-0000-0000-000000000003', 'b2000000-0000-0000-0000-0000000000f1');

insert into public.taxonomy_links (subject_type, subject_id, term_id, org_id) values
  ('factory_profile', 'b2000000-0000-0000-0000-0000000000f1', 'c2000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-0000000000f1'),
  ('factory_profile', 'b2000000-0000-0000-0000-0000000000f2', 'c2000000-0000-0000-0000-000000000003', 'b2000000-0000-0000-0000-0000000000f2'),
  ('brand_profile',   'b2000000-0000-0000-0000-0000000000b2', 'c2000000-0000-0000-0000-000000000004', 'b2000000-0000-0000-0000-0000000000b2'),
  ('rfq', 'd2000000-0000-0000-0000-000000000001', 'c2000000-0000-0000-0000-000000000005', 'b2000000-0000-0000-0000-0000000000b1'),
  ('rfq', 'd2000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000006', 'b2000000-0000-0000-0000-0000000000b1'),
  ('rfq', 'd2000000-0000-0000-0000-000000000003', 'c2000000-0000-0000-0000-000000000007', 'b2000000-0000-0000-0000-0000000000b1');

-- Links written before the guard existed: V3's term planted on V1's profile,
-- and V2's private term linked to V1's. The guard refuses both now, so they
-- are written with it off, as old rows would be.
alter table public.taxonomy_links disable trigger taxonomy_links_owner;
insert into public.taxonomy_links (subject_type, subject_id, term_id, org_id) values
  ('factory_profile', 'b2000000-0000-0000-0000-0000000000f1', 'c2000000-0000-0000-0000-000000000008', 'b2000000-0000-0000-0000-0000000000f3'),
  ('factory_profile', 'b2000000-0000-0000-0000-0000000000f1', 'c2000000-0000-0000-0000-000000000003', 'b2000000-0000-0000-0000-0000000000f1');
alter table public.taxonomy_links enable trigger taxonomy_links_owner;

-- ---------------------------------------------------------------------------
-- 1. Signed out: refused.
-- ---------------------------------------------------------------------------
set local role anon;
select throws_ok(
  $$ select * from public.linked_custom_terms('factory_profile', array['b2000000-0000-0000-0000-0000000000f1']::uuid[]) $$,
  '42501', null, 'a signed-out visitor cannot run it'
);
reset role;

-- ---------------------------------------------------------------------------
-- A brand reading vendors.
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"a2000000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;

-- 2. A published vendor's linked term, once, in its own words.
select results_eq(
  $$ select id, label_en, label_zh from public.linked_custom_terms('factory_profile', array['b2000000-0000-0000-0000-0000000000f1']::uuid[]) $$,
  $$ values ('c2000000-0000-0000-0000-000000000001'::uuid, '羊绒开衫'::text, null::text) $$,
  'a brand reads a published vendor''s own term once, as typed, and nothing planted on that profile'
);

-- 3. An unpublished vendor's: nothing.
select is(
  (select count(*) from public.linked_custom_terms('factory_profile', array['b2000000-0000-0000-0000-0000000000f2']::uuid[])),
  0::bigint, 'nothing from an unpublished vendor'
);

-- 4. A term the vendor made but did not link: nothing.
select is(
  (select count(*) from public.linked_custom_terms('factory_profile', array['b2000000-0000-0000-0000-0000000000f1']::uuid[])
    where id = 'c2000000-0000-0000-0000-000000000002'),
  0::bigint, 'nothing the vendor did not link'
);

-- 5. Another brand's profile term: nothing.
select is(
  (select count(*) from public.linked_custom_terms('brand_profile', array['b2000000-0000-0000-0000-0000000000b2']::uuid[])),
  0::bigint, 'nothing from another brand''s profile'
);

-- 8. The planted links: neither V3's term nor V2's private one.
select is(
  (select count(*) from public.linked_custom_terms('factory_profile', array['b2000000-0000-0000-0000-0000000000f1']::uuid[])
    where id in ('c2000000-0000-0000-0000-000000000008', 'c2000000-0000-0000-0000-000000000003')),
  0::bigint, 'a link to another company''s term, or made by another company, shows nothing'
);

-- 9. The read policy is unchanged.
select is(
  (select count(*) from public.taxonomy_terms where org_id = 'b2000000-0000-0000-0000-0000000000f1'),
  0::bigint, 'the brand still cannot read the vendor''s terms directly'
);
reset role;

-- ---------------------------------------------------------------------------
-- 6. Vendor V1 reading requests.
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"a2000000-0000-0000-0000-000000000002","role":"authenticated"}';
set local role authenticated;

select is(
  (select count(*) from public.linked_custom_terms('rfq', array['d2000000-0000-0000-0000-000000000001']::uuid[])),
  0::bigint, 'nothing from a draft request'
);
select is(
  (select count(*) from public.linked_custom_terms('rfq', array['d2000000-0000-0000-0000-000000000002']::uuid[])),
  0::bigint, 'nothing from an invite-only request it was not invited to'
);
select is(
  (select count(*) from public.linked_custom_terms('rfq', array['d2000000-0000-0000-0000-000000000003']::uuid[])),
  1::bigint, 'the brand''s term on a request it was invited to'
);
reset role;

-- ---------------------------------------------------------------------------
-- 7. Vendor V2, its own unpublished profile.
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"a2000000-0000-0000-0000-000000000003","role":"authenticated"}';
set local role authenticated;
select is(
  (select array_agg(id) from public.linked_custom_terms('factory_profile', array['b2000000-0000-0000-0000-0000000000f2']::uuid[])),
  array['c2000000-0000-0000-0000-000000000003'::uuid], 'a vendor reads its own term on its unpublished profile'
);
reset role;

-- 10. Definer, with a fixed search path.
select ok(
  (select prosecdef and proconfig @> array['search_path=public, pg_temp']
     from pg_proc where proname = 'linked_custom_terms' and pronamespace = 'public'::regnamespace),
  'linked_custom_terms is security definer with a fixed search_path'
);

-- ---------------------------------------------------------------------------
-- The guard on taxonomy_links (608200), as V3's owner.
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"a2000000-0000-0000-0000-000000000005","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$ insert into public.taxonomy_links (subject_type, subject_id, term_id, org_id)
     values ('factory_profile', 'b2000000-0000-0000-0000-0000000000f1',
             (select id from public.taxonomy_terms where org_id is null and kind = 'make' order by id limit 1),
             'b2000000-0000-0000-0000-0000000000f3') $$,
  '42501', null, 'a company cannot tag another company''s profile'
);
select throws_ok(
  $$ insert into public.taxonomy_links (subject_type, subject_id, term_id, org_id)
     values ('factory_profile', 'b2000000-0000-0000-0000-0000000000f3',
             'c2000000-0000-0000-0000-000000000003', 'b2000000-0000-0000-0000-0000000000f3') $$,
  '42501', null, 'a company cannot link another company''s custom term'
);
select lives_ok(
  $$ insert into public.taxonomy_links (subject_type, subject_id, term_id, org_id)
     values ('factory_profile', 'b2000000-0000-0000-0000-0000000000f3',
             'c2000000-0000-0000-0000-000000000009', 'b2000000-0000-0000-0000-0000000000f3') $$,
  'a company tags its own profile with its own term'
);
reset role;

-- As the superuser (authenticated has no UPDATE grant), so the trigger is what refuses.
select throws_ok(
  $$ update public.taxonomy_links set subject_id = 'b2000000-0000-0000-0000-0000000000f1'
      where subject_type = 'factory_profile' and subject_id = 'b2000000-0000-0000-0000-0000000000f3'
        and term_id = 'c2000000-0000-0000-0000-000000000009' $$,
  '42501', null, 'a company cannot move its tag onto another company''s profile'
);

select * from finish();
rollback;
