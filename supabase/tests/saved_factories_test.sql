-- ============================================================================
-- A brand's saved vendors
-- ----------------------------------------------------------------------------
-- Seventeenth suite, `pgtap17-` prefixed, every assertion scoped to its
-- fixtures.
--
-- saved_factories is the brand's own list. Most of what follows is the
-- refusals: an unpublished vendor, someone else's name, another brand's list,
-- the vendor itself, a factory saving, an edit, and nobody signed in.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(13);

insert into auth.users (id, email) values
  ('c1700000-0000-0000-0000-000000000001', 'p17-brand@example.com'),
  ('c1700000-0000-0000-0000-000000000002', 'p17-factory@example.com'),
  ('c1700000-0000-0000-0000-000000000003', 'p17-hidden@example.com'),
  ('c1700000-0000-0000-0000-000000000004', 'p17-otherbrand@example.com');

insert into public.orgs (id, type, name, slug) values
  ('d1700000-0000-0000-0000-00000000000a', 'brand',   'P17 Brand',          'pgtap17-brand'),
  ('d1700000-0000-0000-0000-00000000000b', 'brand',   'P17 Other Brand',    'pgtap17-otherbrand'),
  ('d1700000-0000-0000-0000-0000000000f1', 'factory', 'P17 Factory',        'pgtap17-factory'),
  ('d1700000-0000-0000-0000-0000000000f2', 'factory', 'P17 Hidden Factory', 'pgtap17-hidden');

insert into public.org_members (org_id, user_id, role) values
  ('d1700000-0000-0000-0000-00000000000a', 'c1700000-0000-0000-0000-000000000001', 'owner'),
  ('d1700000-0000-0000-0000-0000000000f1', 'c1700000-0000-0000-0000-000000000002', 'owner'),
  ('d1700000-0000-0000-0000-0000000000f2', 'c1700000-0000-0000-0000-000000000003', 'owner'),
  ('d1700000-0000-0000-0000-00000000000b', 'c1700000-0000-0000-0000-000000000004', 'owner');

-- One published vendor, one that never published its profile.
insert into public.factory_profiles (org_id, location, onboarding_completed_at, verification_status, published_at) values
  ('d1700000-0000-0000-0000-0000000000f1', 'Porto, Portugal', now(), 'verified', now()),
  ('d1700000-0000-0000-0000-0000000000f2', 'Leicester, UK', now(), 'pending', null);

-- ---------------------------------------------------------------------------
-- The brand
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"c1700000-0000-0000-0000-000000000001","email":"p17-brand@example.com","role":"authenticated"}';
set local role authenticated;

select lives_ok(
  $$ insert into public.saved_factories (org_id, factory_org_id, saved_by)
     values ('d1700000-0000-0000-0000-00000000000a', 'd1700000-0000-0000-0000-0000000000f1', 'c1700000-0000-0000-0000-000000000001') $$,
  'a brand saves a published vendor'
);

select is(
  (select count(*)::int from public.saved_factories where org_id = 'd1700000-0000-0000-0000-00000000000a'),
  1,
  'and reads it back on its own list'
);

select throws_ok(
  $$ insert into public.saved_factories (org_id, factory_org_id, saved_by)
     values ('d1700000-0000-0000-0000-00000000000a', 'd1700000-0000-0000-0000-0000000000f2', 'c1700000-0000-0000-0000-000000000001') $$,
  '42501', null,
  'but not a vendor whose profile is not published'
);

select throws_ok(
  $$ insert into public.saved_factories (org_id, factory_org_id, saved_by)
     values ('d1700000-0000-0000-0000-00000000000a', 'd1700000-0000-0000-0000-0000000000f1', 'c1700000-0000-0000-0000-000000000004') $$,
  '42501', null,
  'and not in someone else''s name'
);

select throws_ok(
  $$ insert into public.saved_factories (org_id, factory_org_id, saved_by)
     values ('d1700000-0000-0000-0000-00000000000b', 'd1700000-0000-0000-0000-0000000000f1', 'c1700000-0000-0000-0000-000000000001') $$,
  '42501', null,
  'nor onto another brand''s list'
);

select throws_ok(
  $$ update public.saved_factories set created_at = now() - interval '1 year'
     where org_id = 'd1700000-0000-0000-0000-00000000000a' $$,
  '42501', null,
  'a saved row is never edited'
);

-- ---------------------------------------------------------------------------
-- Another brand
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"c1700000-0000-0000-0000-000000000004","email":"p17-otherbrand@example.com","role":"authenticated"}';

select is(
  (select count(*)::int from public.saved_factories where org_id = 'd1700000-0000-0000-0000-00000000000a'),
  0,
  'another brand cannot read the first one''s saved vendors'
);

with removed as (
  delete from public.saved_factories where org_id = 'd1700000-0000-0000-0000-00000000000a' returning 1
)
select is((select count(*)::int from removed), 0, 'or remove them');

select throws_ok(
  $$ insert into public.saved_factories (org_id, factory_org_id, saved_by)
     values ('d1700000-0000-0000-0000-00000000000a', 'd1700000-0000-0000-0000-0000000000f1', 'c1700000-0000-0000-0000-000000000004') $$,
  '42501', null,
  'or add to them in its own name'
);

-- ---------------------------------------------------------------------------
-- The saved vendor
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"c1700000-0000-0000-0000-000000000002","email":"p17-factory@example.com","role":"authenticated"}';

select is(
  (select count(*)::int from public.saved_factories where factory_org_id = 'd1700000-0000-0000-0000-0000000000f1'),
  0,
  'the vendor is not told who saved it'
);

select throws_ok(
  $$ insert into public.saved_factories (org_id, factory_org_id, saved_by)
     values ('d1700000-0000-0000-0000-0000000000f1', 'd1700000-0000-0000-0000-0000000000f1', 'c1700000-0000-0000-0000-000000000002') $$,
  '42501', null,
  'and a factory cannot save vendors'
);

-- ---------------------------------------------------------------------------
-- The brand again, removing it
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"c1700000-0000-0000-0000-000000000001","email":"p17-brand@example.com","role":"authenticated"}';

with removed as (
  delete from public.saved_factories where org_id = 'd1700000-0000-0000-0000-00000000000a' returning 1
)
select is((select count(*)::int from removed), 1, 'the brand removes a vendor from its own list');

-- ---------------------------------------------------------------------------
-- Nobody signed in
-- ---------------------------------------------------------------------------

set local role anon;

select throws_ok(
  $$ select count(*) from public.saved_factories $$,
  '42501', null,
  'nobody signed in can read the table'
);

select * from finish();
rollback;
