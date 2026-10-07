-- ============================================================================
-- A brand's profile as a factory sees it, and the factory's saved brands
-- ----------------------------------------------------------------------------
-- Sixteenth suite, `pgtap16-` prefixed, every assertion scoped to its fixtures.
--
-- brand_profiles holds a brand's revenue, email and website, so it stays
-- locked to its own company; a factory reads the safe part through
-- brand_profile_for_factory(), and only for a brand whose request it can see.
-- Most of what follows is the refusals: the wrong factory, another brand,
-- nobody signed in, and the columns that must never come back.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(18);

insert into auth.users (id, email) values
  ('c1600000-0000-0000-0000-000000000001', 'p16-brand@example.com'),
  ('c1600000-0000-0000-0000-000000000002', 'p16-factory@example.com'),
  ('c1600000-0000-0000-0000-000000000003', 'p16-outsider@example.com'),
  ('c1600000-0000-0000-0000-000000000004', 'p16-otherbrand@example.com'),
  ('c1600000-0000-0000-0000-000000000005', 'p16-invited@example.com'),
  ('c1600000-0000-0000-0000-000000000006', 'p16-quiet@example.com');

insert into public.orgs (id, type, name, slug) values
  ('d1600000-0000-0000-0000-00000000000a', 'brand',   'P16 Brand',       'pgtap16-brand'),
  ('d1600000-0000-0000-0000-00000000000b', 'brand',   'P16 Other Brand', 'pgtap16-otherbrand'),
  ('d1600000-0000-0000-0000-00000000000c', 'brand',   'P16 Quiet Brand', 'pgtap16-quiet'),
  ('d1600000-0000-0000-0000-0000000000f1', 'factory', 'P16 Factory',     'pgtap16-factory'),
  ('d1600000-0000-0000-0000-0000000000f2', 'factory', 'P16 Outsider',    'pgtap16-outsider'),
  ('d1600000-0000-0000-0000-0000000000f3', 'factory', 'P16 Invited',     'pgtap16-invited');

insert into public.org_members (org_id, user_id, role) values
  ('d1600000-0000-0000-0000-00000000000a', 'c1600000-0000-0000-0000-000000000001', 'owner'),
  ('d1600000-0000-0000-0000-0000000000f1', 'c1600000-0000-0000-0000-000000000002', 'owner'),
  ('d1600000-0000-0000-0000-0000000000f2', 'c1600000-0000-0000-0000-000000000003', 'owner'),
  ('d1600000-0000-0000-0000-00000000000b', 'c1600000-0000-0000-0000-000000000004', 'owner'),
  ('d1600000-0000-0000-0000-0000000000f3', 'c1600000-0000-0000-0000-000000000005', 'owner'),
  ('d1600000-0000-0000-0000-00000000000c', 'c1600000-0000-0000-0000-000000000006', 'owner');

-- Everything a brand gives in onboarding, the private parts included, so the
-- test can show they don't come back.
insert into public.brand_profiles (
  org_id, legal_name, business_email, website_url, hq_location, intro,
  annual_revenue_band, order_size_band, onboarding_completed_at, verification_status
) values (
  'd1600000-0000-0000-0000-00000000000a', 'P16 Brand Ltd', 'owner@p16.example.com', 'https://p16.example.com',
  'London, UK', 'Organic cotton shirts, small batches.', '1m_5m', '300-1,000 pieces per style', now(), 'verified'
), (
  'd1600000-0000-0000-0000-00000000000c', null, null, null, 'Lisbon, Portugal', 'Knitwear.', null, null, now(), 'verified'
);

insert into public.taxonomy_links (subject_type, subject_id, term_id, org_id) values (
  'brand_profile', 'd1600000-0000-0000-0000-00000000000a',
  (select id from public.taxonomy_terms where kind = 'product_category' order by slug limit 1),
  'd1600000-0000-0000-0000-00000000000a'
);

-- One public product image, one private business registration.
insert into public.documents (id, org_id, kind, bucket, storage_path, file_name, title) values
  ('a1600000-0000-0000-0000-000000000001', 'd1600000-0000-0000-0000-00000000000a', 'product_image', 'org-public',
   'd1600000-0000-0000-0000-00000000000a/product_image/p16-shirt.jpg', 'p16-shirt.jpg', 'Poplin shirt'),
  ('a1600000-0000-0000-0000-000000000002', 'd1600000-0000-0000-0000-00000000000a', 'business_registration', 'org-private',
   'd1600000-0000-0000-0000-00000000000a/business_registration/p16-reg.pdf', 'p16-reg.pdf', null);

-- P16 Brand: one request open to every vendor.
-- P16 Quiet Brand: a draft, and an open request only P16 Invited was asked to.
insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total, published_at) values
  ('e1600000-0000-0000-0000-000000000001', 'd1600000-0000-0000-0000-00000000000a', 'P16 open request', 'open', 'open_to_all', 300, now()),
  ('e1600000-0000-0000-0000-000000000002', 'd1600000-0000-0000-0000-00000000000c', 'P16 draft', 'draft', 'open_to_all', 100, null),
  ('e1600000-0000-0000-0000-000000000003', 'd1600000-0000-0000-0000-00000000000c', 'P16 invite only', 'open', 'invited_only', 100, now());

insert into public.rfq_invitations (rfq_id, factory_org_id)
values ('e1600000-0000-0000-0000-000000000003', 'd1600000-0000-0000-0000-0000000000f3');

-- ---------------------------------------------------------------------------
-- A factory that can see the brand's request
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"c1600000-0000-0000-0000-000000000002","email":"p16-factory@example.com","role":"authenticated"}';
set local role authenticated;

select is(
  public.brand_profile_for_factory('d1600000-0000-0000-0000-00000000000a') ->> 'intro',
  'Organic cotton shirts, small batches.',
  'a factory that can see one of the brand''s requests reads its profile'
);

select is(
  jsonb_array_length(public.brand_profile_for_factory('d1600000-0000-0000-0000-00000000000a') -> 'term_ids'),
  1,
  'with the brand''s tags'
);

select is(
  public.brand_profile_for_factory('d1600000-0000-0000-0000-00000000000a') -> 'assets' -> 0 ->> 'title',
  'Poplin shirt',
  'and its public product image'
);

select is(
  jsonb_array_length(public.brand_profile_for_factory('d1600000-0000-0000-0000-00000000000a') -> 'assets'),
  1,
  'but not its business registration'
);

select ok(
  not (public.brand_profile_for_factory('d1600000-0000-0000-0000-00000000000a')
       ?| array['annual_revenue_band', 'business_email', 'website_url', 'legal_name']),
  'revenue, business email, website and legal name never come back'
);

select is(
  (select count(*)::int from public.brand_profiles where org_id = 'd1600000-0000-0000-0000-00000000000a'),
  0,
  'the brand_profiles table itself stays closed to the factory'
);

select is(
  (select count(*)::int from public.taxonomy_links
    where subject_type = 'brand_profile' and subject_id = 'd1600000-0000-0000-0000-00000000000a'),
  0,
  'and so do the brand''s tag rows'
);

select lives_ok(
  $$ insert into public.saved_brands (org_id, brand_org_id, saved_by)
     values ('d1600000-0000-0000-0000-0000000000f1', 'd1600000-0000-0000-0000-00000000000a', 'c1600000-0000-0000-0000-000000000002') $$,
  'the factory saves a brand it can see'
);

select throws_ok(
  $$ insert into public.saved_brands (org_id, brand_org_id, saved_by)
     values ('d1600000-0000-0000-0000-0000000000f1', 'd1600000-0000-0000-0000-00000000000c', 'c1600000-0000-0000-0000-000000000002') $$,
  '42501', null,
  'but not a brand whose requests it cannot see'
);

select throws_ok(
  $$ insert into public.saved_brands (org_id, brand_org_id, saved_by)
     values ('d1600000-0000-0000-0000-0000000000f1', 'd1600000-0000-0000-0000-00000000000a', 'c1600000-0000-0000-0000-000000000003') $$,
  '42501', null,
  'and not in someone else''s name'
);

-- ---------------------------------------------------------------------------
-- A factory that cannot see any of the brand's requests
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"c1600000-0000-0000-0000-000000000003","email":"p16-outsider@example.com","role":"authenticated"}';

select throws_ok(
  $$ select public.brand_profile_for_factory('d1600000-0000-0000-0000-00000000000c') $$,
  '42501', null,
  'a factory sees nothing of a brand whose only requests are a draft and another factory''s invitation'
);

select is(
  (select count(*)::int from public.saved_brands where org_id = 'd1600000-0000-0000-0000-0000000000f1'),
  0,
  'another factory cannot read the first one''s saved brands'
);

with removed as (
  delete from public.saved_brands where org_id = 'd1600000-0000-0000-0000-0000000000f1' returning 1
)
select is((select count(*)::int from removed), 0, 'or remove them');

-- ---------------------------------------------------------------------------
-- The invited factory
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"c1600000-0000-0000-0000-000000000005","email":"p16-invited@example.com","role":"authenticated"}';

select is(
  public.brand_profile_for_factory('d1600000-0000-0000-0000-00000000000c') ->> 'name',
  'P16 Quiet Brand',
  'a factory invited to a request reads that brand''s profile'
);

-- ---------------------------------------------------------------------------
-- Brands
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"c1600000-0000-0000-0000-000000000004","email":"p16-otherbrand@example.com","role":"authenticated"}';

select throws_ok(
  $$ select public.brand_profile_for_factory('d1600000-0000-0000-0000-00000000000a') $$,
  '42501', null,
  'another brand cannot read a brand''s profile, even one whose request it can see'
);

select throws_ok(
  $$ insert into public.saved_brands (org_id, brand_org_id, saved_by)
     values ('d1600000-0000-0000-0000-00000000000b', 'd1600000-0000-0000-0000-00000000000a', 'c1600000-0000-0000-0000-000000000004') $$,
  '42501', null,
  'and a brand cannot save brands'
);

set local request.jwt.claims = '{"sub":"c1600000-0000-0000-0000-000000000001","email":"p16-brand@example.com","role":"authenticated"}';

select is(
  (select count(*)::int from public.saved_brands where brand_org_id = 'd1600000-0000-0000-0000-00000000000a'),
  0,
  'the brand is not told who saved it'
);

-- ---------------------------------------------------------------------------
-- Nobody signed in
-- ---------------------------------------------------------------------------

set local role anon;

select throws_ok(
  $$ select public.brand_profile_for_factory('d1600000-0000-0000-0000-00000000000a') $$,
  '42501', null,
  'nobody signed in can call it'
);

select * from finish();
rollback;
