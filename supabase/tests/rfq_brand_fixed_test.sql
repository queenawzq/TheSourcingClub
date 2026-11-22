-- ============================================================================
-- A request stays with the brand that wrote it (20261122100000)
-- ----------------------------------------------------------------------------
-- Run with:  supabase test db
--
-- `pgtap-rfqfix-` slugs and c7…/d7…/e7… ids, every check scoped to these
-- fixtures: all suites share one database.
--
-- What this protects: a person in two brands cannot move a request (and the
-- quotes on it) from one to the other, with or without Quote flow in the
-- first; ordinary edits by the owning brand still work.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(7);

insert into auth.users (id, email) values
  ('c7000000-0000-0000-0000-000000000001', 'rfqfix-both@example.com'),
  ('c7000000-0000-0000-0000-000000000002', 'rfqfix-other-owner@example.com'),
  ('c7000000-0000-0000-0000-000000000003', 'rfqfix-factory@example.com');

insert into public.orgs (id, type, name, slug) values
  ('d7000000-0000-0000-0000-00000000000a', 'brand',   'Rfqfix Brand A', 'pgtap-rfqfix-brand-a'),
  ('d7000000-0000-0000-0000-00000000000b', 'brand',   'Rfqfix Brand B', 'pgtap-rfqfix-brand-b'),
  ('d7000000-0000-0000-0000-0000000000f1', 'factory', 'Rfqfix Factory', 'pgtap-rfqfix-factory');

-- The person in both brands is a member of A (default permissions, so Quote
-- flow) and of B; B's owner is not in A.
insert into public.org_members (org_id, user_id, role) values
  ('d7000000-0000-0000-0000-00000000000a', 'c7000000-0000-0000-0000-000000000001', 'member'),
  ('d7000000-0000-0000-0000-00000000000b', 'c7000000-0000-0000-0000-000000000001', 'member'),
  ('d7000000-0000-0000-0000-00000000000b', 'c7000000-0000-0000-0000-000000000002', 'owner'),
  ('d7000000-0000-0000-0000-0000000000f1', 'c7000000-0000-0000-0000-000000000003', 'owner');

insert into public.factory_profiles (org_id, country_code, verification_status) values
  ('d7000000-0000-0000-0000-0000000000f1', 'PT', 'verified');

insert into public.rfqs (id, brand_org_id, title, brief, status, visibility, quantity_total) values
  ('e7000000-0000-0000-0000-000000000001', 'd7000000-0000-0000-0000-00000000000a',
   'Rfqfix shirts', 'Two hundred shirts.', 'open', 'open_to_all', 200);

insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity, submitted_at) values
  ('e7000000-0000-0000-0000-0000000000a1', 'e7000000-0000-0000-0000-000000000001',
   'd7000000-0000-0000-0000-0000000000f1', 'submitted', 1500, 200, now());

set local role authenticated;
set local request.jwt.claims = '{"sub":"c7000000-0000-0000-0000-000000000001","role":"authenticated"}';

select lives_ok(
  $$update public.rfqs set title = 'Rfqfix shirts, washed' where id = 'e7000000-0000-0000-0000-000000000001'$$,
  'the owning brand''s member can still edit the request');

select throws_ok(
  $$update public.rfqs set brand_org_id = 'd7000000-0000-0000-0000-00000000000b' where id = 'e7000000-0000-0000-0000-000000000001'$$,
  '42501', 'a request stays with the company that wrote it',
  'a person in two brands cannot move a request to their other brand');

-- Without Quote flow in brand A: the edit is refused by guard_rfq_permission,
-- and the move must be refused too (it used to pass, checked on B only).
reset role;
update public.org_members set permissions = array['approve']
 where org_id = 'd7000000-0000-0000-0000-00000000000a' and user_id = 'c7000000-0000-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"c7000000-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok(
  $$update public.rfqs set title = 'Rfqfix no flow' where id = 'e7000000-0000-0000-0000-000000000001'$$,
  '42501', null,
  'without Quote flow in the owning brand, an edit is refused');

select throws_ok(
  $$update public.rfqs set brand_org_id = 'd7000000-0000-0000-0000-00000000000b' where id = 'e7000000-0000-0000-0000-000000000001'$$,
  '42501', null,
  'without Quote flow in the owning brand, the move is refused too');

-- The other brand's owner still cannot see the request's quote.
set local request.jwt.claims = '{"sub":"c7000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is(
  (select count(*) from public.quotes where id = 'e7000000-0000-0000-0000-0000000000a1'),
  0::bigint, 'the other brand''s owner cannot read the quote');

reset role;
select is(
  (select brand_org_id from public.rfqs where id = 'e7000000-0000-0000-0000-000000000001'),
  'd7000000-0000-0000-0000-00000000000a'::uuid, 'the request still belongs to brand A');

-- No caller is exempt: nothing in the product moves a request between companies.
select throws_ok(
  $$update public.rfqs set brand_org_id = 'd7000000-0000-0000-0000-00000000000b' where id = 'e7000000-0000-0000-0000-000000000001'$$,
  '42501', 'a request stays with the company that wrote it',
  'the server cannot move a request either');

select * from finish();
rollback;
