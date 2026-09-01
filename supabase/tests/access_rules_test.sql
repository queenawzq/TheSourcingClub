-- ============================================================================
-- Access rule tests
-- ----------------------------------------------------------------------------
-- Run with:  supabase test db
--
-- There is no server tier in this architecture, so these policies ARE the
-- authorisation layer and a mistake in one is a data breach rather than a bug.
-- Most of the assertions below are therefore NEGATIVE: they check what an org
-- cannot see. A policy that accidentally grants everything still passes every
-- positive test ever written, which is why those alone are not enough.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(25);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
-- Two competing brands and two competing factories, so every cross-org
-- assertion has a real counterparty rather than a hypothetical one.
--
-- Slugs are prefixed and every count is scoped to these fixture ids. A bare
-- count(*) silently depends on whatever else is in the database, which is how
-- this suite broke the first time `npm run smoke` ran before it.
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, raw_user_meta_data)
values
  ('11111111-1111-1111-1111-111111111111', 'maison@example.com',  '{"name":"Maison Rue"}'),
  ('22222222-2222-2222-2222-222222222222', 'elara@example.com',   '{"name":"Elara Studio"}'),
  ('33333333-3333-3333-3333-333333333333', 'minho@example.com',   '{"name":"Atelier Minho"}'),
  ('44444444-4444-4444-4444-444444444444', 'hanshu@example.com',  '{"name":"Hanshu Studio"}'),
  ('55555555-5555-5555-5555-555555555555', 'admin@example.com',   '{"name":"Platform Admin"}');

insert into public.orgs (id, type, name, slug) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'brand',   'Maison Rue',    'pgtap-maison-rue'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'brand',   'Elara Studio',  'pgtap-elara-studio'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'factory', 'Atelier Minho', 'pgtap-atelier-minho'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'factory', 'Hanshu Studio', 'pgtap-hanshu-studio');

insert into public.org_members (org_id, user_id, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'owner'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'owner'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'owner'),
  ('bbbbbbbb-0000-0000-0000-000000000002', '44444444-4444-4444-4444-444444444444', 'owner');

insert into public.platform_admins (user_id)
values ('55555555-5555-5555-5555-555555555555');

insert into public.brand_profiles (org_id, intro) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Maison Rue private notes'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'Elara Studio private notes');

-- Minho is published and visible in browse; Hanshu is still onboarding.
insert into public.factory_profiles (org_id, intro, country_code, moq, published_at) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'Atelier Minho', 'PT', 150, now()),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'Hanshu Studio', 'CN', 300, null);

insert into public.documents (org_id, kind, bucket, storage_path, file_name) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'business_registration', 'org-private',
   'bbbbbbbb-0000-0000-0000-000000000001/reg.pdf', 'reg.pdf');

-- Acting as a user is done inline below rather than through a helper: once
-- SET ROLE authenticated is in effect that role cannot reach a helper schema,
-- so every switch resets to the session role first.

-- ---------------------------------------------------------------------------
-- Brand isolation
-- ---------------------------------------------------------------------------

reset role;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","email":"maison@example.com","role":"authenticated"}';
set local role authenticated;

select is(
  (select count(*)::int from public.brand_profiles where org_id in ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000002')),
  1,
  'a brand sees exactly one brand profile: its own'
);

select is(
  (select count(*)::int from public.brand_profiles
   where org_id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  0,
  'a brand CANNOT read a competing brand profile'
);

select is(
  (select count(*)::int from public.orgs where id in ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002')),
  1,
  'a brand sees only the org it belongs to'
);

select is(
  (select count(*)::int from public.org_members
   where org_id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  0,
  'a brand CANNOT enumerate another org''s members'
);

-- ---------------------------------------------------------------------------
-- Factory visibility in browse
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from public.factory_profiles where org_id in ('bbbbbbbb-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002')),
  1,
  'a brand browsing sees only PUBLISHED factory profiles'
);

select is(
  (select count(*)::int from public.factory_profiles
   where org_id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  0,
  'a brand CANNOT see a factory that has not published'
);

-- ---------------------------------------------------------------------------
-- Private documents
-- ---------------------------------------------------------------------------
-- The single most damaging thing to get wrong: business registrations are
-- commercially sensitive and cannot be un-leaked.
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from public.documents where org_id in ('bbbbbbbb-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002')),
  0,
  'a brand CANNOT read a factory''s private documents, published or not'
);

reset role;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","email":"hanshu@example.com","role":"authenticated"}';
set local role authenticated;

select is(
  (select count(*)::int from public.documents where org_id in ('bbbbbbbb-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002')),
  0,
  'a factory CANNOT read a COMPETING factory''s private documents'
);

select is(
  (select count(*)::int from public.factory_profiles
   where org_id = 'bbbbbbbb-0000-0000-0000-000000000001'),
  1,
  'a factory can still see a published competitor in the directory'
);

-- ---------------------------------------------------------------------------
-- Owner reads its own private material
-- ---------------------------------------------------------------------------

reset role;
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","email":"minho@example.com","role":"authenticated"}';
set local role authenticated;

select is(
  (select count(*)::int from public.documents where org_id in ('bbbbbbbb-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002')),
  1,
  'a factory reads its own private documents'
);

select is(
  (select count(*)::int from public.brand_profiles where org_id in ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000002')),
  0,
  'a factory CANNOT browse brand profiles at all'
);

-- ---------------------------------------------------------------------------
-- Platform admin
-- ---------------------------------------------------------------------------

reset role;
set local request.jwt.claims = '{"sub":"55555555-5555-5555-5555-555555555555","email":"admin@example.com","role":"authenticated"}';
set local role authenticated;

select is(
  (select count(*)::int from public.documents where org_id in ('bbbbbbbb-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002')),
  1,
  'a platform admin reads documents for review'
);

select is(
  (select count(*)::int from public.factory_profiles where org_id in ('bbbbbbbb-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002')),
  2,
  'a platform admin sees unpublished factories too'
);

select is(
  (select count(*)::int from public.brand_profiles where org_id in ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000002')),
  2,
  'a platform admin sees every brand profile'
);

-- ---------------------------------------------------------------------------
-- Anonymous
-- ---------------------------------------------------------------------------

reset role;
set local request.jwt.claims = '';
set local role anon;

-- anon holds no table grant at all, so it is refused before RLS is even
-- consulted. That is a stronger guarantee than an empty result set.
select throws_ok(
  'select count(*) from public.factory_profiles',
  '42501',
  null,
  'an anonymous visitor is refused factory profiles outright'
);

select throws_ok(
  'select count(*) from public.taxonomy_terms',
  '42501',
  null,
  'an anonymous visitor is refused the taxonomy outright'
);

reset role;

-- ---------------------------------------------------------------------------
-- Ledger is append-only from a client's point of view
-- ---------------------------------------------------------------------------

reset role;
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","email":"minho@example.com","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$insert into public.credit_ledger (org_id, delta, reason)
    values ('bbbbbbbb-0000-0000-0000-000000000001', 500, 'onboarding_grant')$$,
  '42501',
  null,
  'a client CANNOT write its own credit ledger line'
);

reset role;

-- ---------------------------------------------------------------------------
-- Capacity maths — the bug the prototypes ship today
-- ---------------------------------------------------------------------------
-- The dashboard assumes 18 minutes per piece for every category. A sweater
-- factory is really 42, so 2,400 hours became 8,000 pieces on screen when the
-- true figure is 3,429 — 2.3x overstated.
-- ---------------------------------------------------------------------------

insert into public.factory_capacity (org_id, category_term_id, input_mode, line_hours)
select 'bbbbbbbb-0000-0000-0000-000000000001', t.id, 'hours', 2400
from public.taxonomy_terms t where t.kind = 'capacity_category' and t.slug = 'sweaters';

select is(
  public.capacity_minutes_per_piece(
    (select id from public.taxonomy_terms
      where kind = 'capacity_category' and slug = 'sweaters')),
  42::numeric,
  'a sweater reference style is 42 min/piece, not the hardcoded 18'
);

select is(
  public.capacity_monthly_units('bbbbbbbb-0000-0000-0000-000000000001'),
  3429,
  '2,400 hours of sweater capacity is 3,429 pieces (the UI shows 8,000)'
);

insert into public.factory_capacity_months (org_id, month, level)
values ('bbbbbbbb-0000-0000-0000-000000000001', date_trunc('month', now())::date, 'open');

select is(
  (select min_pieces from public.capacity_available_range(
     'bbbbbbbb-0000-0000-0000-000000000001', now()::date)),
  2057,
  'a mostly-open month offers at least 60% of monthly capacity'
);

-- ---------------------------------------------------------------------------
-- Match score
-- ---------------------------------------------------------------------------

-- Brand wants wovens; Minho makes wovens. Region and everything else unstated.
insert into public.taxonomy_links (subject_type, subject_id, term_id, org_id)
select 'brand_profile', 'aaaaaaaa-0000-0000-0000-000000000001', t.id,
       'aaaaaaaa-0000-0000-0000-000000000001'
from public.taxonomy_terms t where t.kind = 'production_type' and t.slug = 'wovens';

insert into public.taxonomy_links (subject_type, subject_id, term_id, org_id)
select 'factory_profile', 'bbbbbbbb-0000-0000-0000-000000000001', t.id,
       'bbbbbbbb-0000-0000-0000-000000000001'
from public.taxonomy_terms t where t.kind = 'production_type' and t.slug = 'wovens';

select is(
  public.match_score(
    'aaaaaaaa-0000-0000-0000-000000000001',
    'bbbbbbbb-0000-0000-0000-000000000001'),
  1.0000::numeric,
  'unspecified factors are excluded, not scored — a single matched factor is 100%'
);

select is(
  public.match_score(
    'aaaaaaaa-0000-0000-0000-000000000001',
    'bbbbbbbb-0000-0000-0000-000000000002'),
  0.0000::numeric,
  'a factory making nothing the brand asked for scores zero'
);

-- Certification must be a SUBSET test: holding many irrelevant certificates
-- must not beat holding the required one.
insert into public.taxonomy_links (subject_type, subject_id, term_id, org_id)
select 'brand_profile', 'aaaaaaaa-0000-0000-0000-000000000001', t.id,
       'aaaaaaaa-0000-0000-0000-000000000001'
from public.taxonomy_terms t where t.kind = 'certification' and t.slug = 'gots';

-- Minho holds GOTS but it has not been verified yet.
insert into public.factory_certifications (org_id, term_id, status)
select 'bbbbbbbb-0000-0000-0000-000000000001', t.id, 'pending'
from public.taxonomy_terms t where t.kind = 'certification' and t.slug = 'gots';

select cmp_ok(
  public.match_score(
    'aaaaaaaa-0000-0000-0000-000000000001',
    'bbbbbbbb-0000-0000-0000-000000000001'),
  '<',
  1.0000::numeric,
  'an UNVERIFIED certification does not count toward coverage'
);

update public.factory_certifications set status = 'verified'
where org_id = 'bbbbbbbb-0000-0000-0000-000000000001';

select is(
  public.match_score(
    'aaaaaaaa-0000-0000-0000-000000000001',
    'bbbbbbbb-0000-0000-0000-000000000001'),
  1.0000::numeric,
  'once verified, the required certification counts'
);

select is(
  public.match_tier(0.92::numeric),
  'strong'::public.match_tier,
  'tier thresholds follow TSC_DESIGN_SYSTEM.md'
);

select * from finish();
rollback;
