-- ============================================================================
-- A request's or a profile's tags belong to the company that owns it
-- (20261123100000)
-- ----------------------------------------------------------------------------
-- Run with:  supabase test db
--
-- `pgtap-tagown-` slugs and c8…/d8…/e8… ids, every count scoped to these
-- fixtures: all suites share one database.
--
-- What this protects: another company cannot attach categories,
-- certifications or regions to a brand's request or a factory's profile (or
-- move its own tag onto them, or add matching requirements to them); the
-- owner still adds and removes its own.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(11);

insert into auth.users (id, email) values
  ('c8000000-0000-0000-0000-000000000001', 'tagown-brand@example.com'),
  ('c8000000-0000-0000-0000-000000000002', 'tagown-attacker@example.com'),
  ('c8000000-0000-0000-0000-000000000003', 'tagown-competitor@example.com');

insert into public.orgs (id, type, name, slug) values
  ('d8000000-0000-0000-0000-00000000000b', 'brand',   'Tagown Brand',      'pgtap-tagown-brand'),
  ('d8000000-0000-0000-0000-0000000000f1', 'factory', 'Tagown Attacker',   'pgtap-tagown-attacker'),
  ('d8000000-0000-0000-0000-0000000000f2', 'factory', 'Tagown Competitor', 'pgtap-tagown-competitor');

insert into public.org_members (org_id, user_id, role) values
  ('d8000000-0000-0000-0000-00000000000b', 'c8000000-0000-0000-0000-000000000001', 'owner'),
  ('d8000000-0000-0000-0000-0000000000f1', 'c8000000-0000-0000-0000-000000000002', 'owner'),
  ('d8000000-0000-0000-0000-0000000000f2', 'c8000000-0000-0000-0000-000000000003', 'owner');

insert into public.rfqs (id, brand_org_id, title, brief, status, visibility, quantity_total) values
  ('e8000000-0000-0000-0000-000000000001', 'd8000000-0000-0000-0000-00000000000b',
   'Tagown shirts', 'Three hundred shirts.', 'open', 'open_to_all', 300);

-- The brand tags its own request: still allowed.
set local role authenticated;
set local request.jwt.claims = '{"sub":"c8000000-0000-0000-0000-000000000001","role":"authenticated"}';

select lives_ok(
  $$insert into public.taxonomy_links (subject_type, subject_id, term_id, org_id)
    select 'rfq', 'e8000000-0000-0000-0000-000000000001', id, 'd8000000-0000-0000-0000-00000000000b'
      from public.taxonomy_terms where kind = 'product_category' and slug = 'tops'$$,
  'the brand can tag its own request');

-- Another company, with its own id on the row (the attack).
set local request.jwt.claims = '{"sub":"c8000000-0000-0000-0000-000000000002","role":"authenticated"}';

select throws_ok(
  $$insert into public.taxonomy_links (subject_type, subject_id, term_id, org_id)
    select 'rfq', 'e8000000-0000-0000-0000-000000000001', id, 'd8000000-0000-0000-0000-0000000000f1'
      from public.taxonomy_terms where kind = 'product_category' and slug = 'bottoms'$$,
  '42501', 'only the company that owns this request or profile can change its tags',
  'another company cannot tag a brand''s request with its own id on the row');

select throws_ok(
  $$insert into public.taxonomy_links (subject_type, subject_id, term_id, org_id)
    select 'rfq', 'e8000000-0000-0000-0000-000000000001', id, 'd8000000-0000-0000-0000-00000000000b'
      from public.taxonomy_terms where kind = 'product_category' and slug = 'bottoms'$$,
  '42501', null,
  'another company cannot tag it with the brand''s id on the row either');

select throws_ok(
  $$insert into public.taxonomy_links (subject_type, subject_id, term_id, org_id)
    select 'factory_profile', 'd8000000-0000-0000-0000-0000000000f2', id, 'd8000000-0000-0000-0000-0000000000f1'
      from public.taxonomy_terms where kind = 'product_category' and slug = 'bottoms'$$,
  '42501', 'only the company that owns this request or profile can change its tags',
  'a factory cannot tag a competitor''s profile');

select lives_ok(
  $$insert into public.taxonomy_links (subject_type, subject_id, term_id, org_id)
    select 'factory_profile', 'd8000000-0000-0000-0000-0000000000f1', id, 'd8000000-0000-0000-0000-0000000000f1'
      from public.taxonomy_terms where kind = 'product_category' and slug = 'bottoms'$$,
  'a factory can tag its own profile');

select throws_ok(
  $$update public.taxonomy_links set subject_id = 'd8000000-0000-0000-0000-0000000000f2'
     where subject_type = 'factory_profile' and subject_id = 'd8000000-0000-0000-0000-0000000000f1'$$,
  '42501', 'only the company that owns this request or profile can change its tags',
  'a factory cannot move its own tag onto a competitor''s profile');

-- Already refused by validate_matching_requirements; kept so it stays that way.
select throws_ok(
  $$insert into public.matching_requirements (subject_type, subject_id, org_id)
    values ('rfq', 'e8000000-0000-0000-0000-000000000001', 'd8000000-0000-0000-0000-0000000000f1')$$,
  '42501', null,
  'another company cannot set matching requirements on a brand''s request');

-- What the owners see, and the owner can still remove its own.
set local request.jwt.claims = '{"sub":"c8000000-0000-0000-0000-000000000001","role":"authenticated"}';

select is(
  (select count(*) from public.taxonomy_links
    where subject_type = 'rfq' and subject_id = 'e8000000-0000-0000-0000-000000000001'),
  1::bigint, 'the brand''s request carries only the brand''s own tag');

select lives_ok(
  $$delete from public.taxonomy_links
     where subject_type = 'rfq' and subject_id = 'e8000000-0000-0000-0000-000000000001'$$,
  'the brand can remove its own tag');

reset role;

select is(
  (select count(*) from public.taxonomy_links
    where subject_type = 'factory_profile' and subject_id = 'd8000000-0000-0000-0000-0000000000f2'),
  0::bigint, 'the competitor''s profile carries no tag from another company');

-- Nowhere, after the migration's clean-up: a tag written by a company that
-- does not own its request or profile.
select is(
  (select count(*) from public.taxonomy_links l
    where l.org_id is distinct from public.taxonomy_subject_owner(l.subject_type, l.subject_id)),
  0::bigint, 'no tag anywhere belongs to a company other than its subject''s owner');

select * from finish();
rollback;
