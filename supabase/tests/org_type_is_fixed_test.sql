-- ============================================================================
-- A company's type is fixed; only staff approval decides a factory is real
-- (20261127100000). Prefix `pgtap-orgtype-`, every count scoped to these fixtures.
--
-- The attack: a factory's owner sets its type to brand, is approved with no
-- registry check (verified, 500 credits), then sets it back to factory.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

insert into auth.users (id, email) values
  ('c9170000-0000-0000-0000-000000000001', 'orgtype-admin@example.com'),
  ('c9170000-0000-0000-0000-000000000002', 'orgtype-factory@example.com'),
  ('c9170000-0000-0000-0000-000000000003', 'orgtype-brand@example.com'),
  ('c9170000-0000-0000-0000-000000000004', 'orgtype-brand2@example.com');
insert into public.platform_admins (user_id) values ('c9170000-0000-0000-0000-000000000001');

insert into public.orgs (id, type, name, slug) values
  ('d9170000-0000-0000-0000-0000000000f1', 'factory', 'OrgType Factory', 'pgtap-orgtype-factory'),
  ('d9170000-0000-0000-0000-0000000000b1', 'brand',   'OrgType Brand',   'pgtap-orgtype-brand'),
  ('d9170000-0000-0000-0000-0000000000b2', 'brand',   'OrgType Plain',   'pgtap-orgtype-plain');
insert into public.org_members (org_id, user_id, role) values
  ('d9170000-0000-0000-0000-0000000000f1', 'c9170000-0000-0000-0000-000000000002', 'owner'),
  ('d9170000-0000-0000-0000-0000000000b1', 'c9170000-0000-0000-0000-000000000003', 'owner'),
  ('d9170000-0000-0000-0000-0000000000b2', 'c9170000-0000-0000-0000-000000000004', 'owner');
insert into public.factory_profiles (org_id, legal_name) values
  ('d9170000-0000-0000-0000-0000000000f1', 'OrgType Factory Ltd');

-- These checks are about the registry guard, not the terms one.
set local tsc.skip_terms_guard = 'on';

-- ---------------------------------------------------------------------------
-- The grant
-- ---------------------------------------------------------------------------

select ok(
  not has_table_privilege('authenticated', 'public.orgs', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.orgs', 'type', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.orgs', 'name', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.orgs', 'slug', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.orgs', 'is_demo', 'UPDATE'),
  'signed-in users hold no UPDATE on a company''s row'
);

-- ---------------------------------------------------------------------------
-- The factory's owner
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"c9170000-0000-0000-0000-000000000002","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$ update public.orgs set type = 'brand' where id = 'd9170000-0000-0000-0000-0000000000f1' $$,
  '42501', null,
  'a factory''s owner CANNOT change its company to a brand'
);

select throws_ok(
  $$ update public.orgs set is_demo = true where id = 'd9170000-0000-0000-0000-0000000000f1' $$,
  '42501', null,
  'nor mark it a demo company'
);

select lives_ok(
  $$ select public.rename_factory('d9170000-0000-0000-0000-0000000000f1', 'OrgType Factory Renamed') $$,
  'the owner CAN still rename the company, the way the app does'
);

reset role;

select is(
  (select type::text || ' / ' || name from public.orgs where id = 'd9170000-0000-0000-0000-0000000000f1'),
  'factory / OrgType Factory Renamed',
  'still a factory, under its new name'
);

-- ---------------------------------------------------------------------------
-- A brand that adds a factory profile is checked like a factory
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"c9170000-0000-0000-0000-000000000003","role":"authenticated"}';
set local role authenticated;

select lives_ok(
  $$ insert into public.factory_profiles (org_id, legal_name)
     values ('d9170000-0000-0000-0000-0000000000b1', 'OrgType Brand Ltd') $$,
  'a brand''s member can write a factory profile for it (the guard below is what matters)'
);

reset role;
set local request.jwt.claims = '{"sub":"c9170000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$ select public.admin_review_decision('d9170000-0000-0000-0000-0000000000f1', 'approved') $$,
  '22023', null,
  'staff still cannot approve the factory without a registry check'
);

select throws_ok(
  $$ select public.admin_review_decision('d9170000-0000-0000-0000-0000000000b1', 'approved') $$,
  '22023', null,
  'nor a brand with a factory profile: it is checked like a factory'
);

select lives_ok(
  $$ select public.admin_review_decision('d9170000-0000-0000-0000-0000000000b2', 'approved') $$,
  'a plain brand is approved as before'
);

reset role;

select is(
  (select count(*)::int from public.factory_profiles
    where org_id in ('d9170000-0000-0000-0000-0000000000f1', 'd9170000-0000-0000-0000-0000000000b1')
      and verification_status = 'verified'),
  0,
  'neither factory profile is verified'
);

select is(
  (select coalesce(sum(delta), 0)::int from public.credit_ledger
    where org_id in ('d9170000-0000-0000-0000-0000000000f1', 'd9170000-0000-0000-0000-0000000000b1')),
  0,
  'and no credits were granted'
);

select is(
  (select state::text from public.org_reviews where org_id = 'd9170000-0000-0000-0000-0000000000b2'),
  'approved',
  'the plain brand''s review is approved'
);

select * from finish();
rollback;
