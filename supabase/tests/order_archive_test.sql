-- ============================================================================
-- Order archive — a company puts its closed orders out of the way (068)
-- ----------------------------------------------------------------------------
-- Run with:  supabase test db
--
-- `pgtap12-` slugs and cc…/dc…/ec…/fc… ids, every count scoped to these
-- fixtures, as in every other suite: they all share one database.
--
-- What this protects: only a closed order can be archived; each company keeps
-- its own archive, which the other side neither sees nor changes; and an
-- order can only be archived by a company that is a party to it — even by
-- someone who also belongs to a second company.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(17);

-- ---------------------------------------------------------------------------
-- Fixtures: a brand with two members, the factory on its orders, a stranger,
-- and someone in the brand AND an unrelated factory. Two orders: one still
-- waiting on its steps, one cancelled by both sides.
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, raw_user_meta_data) values
  ('cc000000-0000-0000-0000-000000000001', 'p12-brandowner@example.com', '{"name":"Brand Owner"}'),
  ('cc000000-0000-0000-0000-000000000002', 'p12-teammate@example.com',   '{"name":"Teammate"}'),
  ('cc000000-0000-0000-0000-000000000003', 'p12-factory@example.com',    '{"name":"Factory Owner"}'),
  ('cc000000-0000-0000-0000-000000000004', 'p12-outsider@example.com',   '{"name":"Outsider"}'),
  ('cc000000-0000-0000-0000-000000000005', 'p12-both@example.com',       '{"name":"In Two Companies"}');

insert into public.orgs (id, type, name, slug) values
  ('dc000000-0000-0000-0000-00000000000b', 'brand',   'P12 Brand',         'pgtap12-brand'),
  ('dc000000-0000-0000-0000-0000000000f1', 'factory', 'P12 Factory',       'pgtap12-factory'),
  ('dc000000-0000-0000-0000-00000000000c', 'brand',   'P12 Outsider',      'pgtap12-outsider'),
  ('dc000000-0000-0000-0000-0000000000f2', 'factory', 'P12 Other Factory', 'pgtap12-other-factory');

insert into public.org_members (org_id, user_id, role) values
  ('dc000000-0000-0000-0000-00000000000b', 'cc000000-0000-0000-0000-000000000001', 'owner'),
  ('dc000000-0000-0000-0000-00000000000b', 'cc000000-0000-0000-0000-000000000002', 'member'),
  ('dc000000-0000-0000-0000-0000000000f1', 'cc000000-0000-0000-0000-000000000003', 'owner'),
  ('dc000000-0000-0000-0000-00000000000c', 'cc000000-0000-0000-0000-000000000004', 'owner'),
  ('dc000000-0000-0000-0000-00000000000b', 'cc000000-0000-0000-0000-000000000005', 'member'),
  ('dc000000-0000-0000-0000-0000000000f2', 'cc000000-0000-0000-0000-000000000005', 'owner');

insert into public.brand_profiles (org_id, hq_location) values
  ('dc000000-0000-0000-0000-00000000000b', 'London, UK'),
  ('dc000000-0000-0000-0000-00000000000c', 'Berlin, DE');

insert into public.factory_profiles (org_id, country_code, moq, published_at, verification_status) values
  ('dc000000-0000-0000-0000-0000000000f1', 'PT', 100, now(), 'verified');

insert into public.rfqs (id, brand_org_id, title, brief, status, visibility, quantity_total) values
  ('ec000000-0000-0000-0000-000000000001', 'dc000000-0000-0000-0000-00000000000b',
   'P12 shirts', 'One hundred linen shirts.', 'open', 'open_to_all', 100),
  ('ec000000-0000-0000-0000-000000000002', 'dc000000-0000-0000-0000-00000000000b',
   'P12 trousers', 'One hundred linen trousers.', 'open', 'open_to_all', 100);

insert into public.quotes
  (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity,
   bulk_lead_time_days, deposit_pct, balance_pct, valid_until, submitted_at)
values
  ('fc000000-0000-0000-0000-0000000000f1', 'ec000000-0000-0000-0000-000000000001',
   'dc000000-0000-0000-0000-0000000000f1', 'submitted', 2000, 100, 28, 30, 70,
   current_date + 30, now()),
  ('fc000000-0000-0000-0000-0000000000f2', 'ec000000-0000-0000-0000-000000000002',
   'dc000000-0000-0000-0000-0000000000f1', 'submitted', 2500, 100, 28, 30, 70,
   current_date + 30, now());

set local request.jwt.claims = '{"sub":"cc000000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select public.award_quote('fc000000-0000-0000-0000-0000000000f1');
select public.award_quote('fc000000-0000-0000-0000-0000000000f2');
reset role;

-- Ids every identity needs, read as the superuser.
create temporary table p12 (name text primary key, id uuid);
insert into p12
select 'open', id from public.production_orders where quote_id = 'fc000000-0000-0000-0000-0000000000f1';
insert into p12
select 'closed', id from public.production_orders where quote_id = 'fc000000-0000-0000-0000-0000000000f2';
grant select on p12 to public;

-- The second order is cancelled the real way: the brand proposes, the
-- factory accepts.
set local request.jwt.claims = '{"sub":"cc000000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select public.propose_cancellation((select id from p12 where name = 'closed'), 'Season dropped');
reset role;
set local request.jwt.claims = '{"sub":"cc000000-0000-0000-0000-000000000003","role":"authenticated"}';
set local role authenticated;
select public.accept_cancellation((select id from p12 where name = 'closed'));
reset role;

select is(
  (select status::text from public.production_orders where id = (select id from p12 where name = 'closed')),
  'cancelled',
  'fixture: the second order is cancelled'
);

-- ---------------------------------------------------------------------------
-- Archiving
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"cc000000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$insert into public.order_archives (org_id, order_id)
    values ('dc000000-0000-0000-0000-00000000000b', (select id from p12 where name = 'open'))$$,
  '42501', NULL,
  'an order that is still open cannot be archived'
);

select lives_ok(
  $$insert into public.order_archives (org_id, order_id)
    values ('dc000000-0000-0000-0000-00000000000b', (select id from p12 where name = 'closed'))$$,
  'a brand member archives a cancelled order'
);

select is(
  (select archived_by from public.order_archives
     where org_id = 'dc000000-0000-0000-0000-00000000000b'),
  'cc000000-0000-0000-0000-000000000001'::uuid,
  'the archive records who put the order away'
);

select throws_ok(
  $$insert into public.order_archives (org_id, order_id)
    values ('dc000000-0000-0000-0000-00000000000b', (select id from p12 where name = 'closed'))$$,
  '23505', NULL,
  'an order is archived once per company'
);

select throws_ok(
  $$update public.order_archives set archived_at = now() - interval '1 day'
     where org_id = 'dc000000-0000-0000-0000-00000000000b'$$,
  '42501', NULL,
  'an archive row cannot be edited'
);

reset role;

-- ---------------------------------------------------------------------------
-- Each company's own
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"cc000000-0000-0000-0000-000000000002","role":"authenticated"}';
set local role authenticated;
select is(
  (select count(*)::int from public.order_archives where org_id = 'dc000000-0000-0000-0000-00000000000b'),
  1,
  'a teammate sees the same archive'
);
select throws_ok(
  $$insert into public.order_archives (org_id, order_id, archived_by)
    values ('dc000000-0000-0000-0000-00000000000b', (select id from p12 where name = 'closed'),
            'cc000000-0000-0000-0000-000000000001')$$,
  '42501', NULL,
  'nobody archives in someone else''s name'
);
reset role;

set local request.jwt.claims = '{"sub":"cc000000-0000-0000-0000-000000000003","role":"authenticated"}';
set local role authenticated;
select is(
  (select count(*)::int from public.order_archives where org_id = 'dc000000-0000-0000-0000-00000000000b'),
  0,
  'the factory does not see the brand''s archive'
);
select lives_ok(
  $$insert into public.order_archives (org_id, order_id)
    values ('dc000000-0000-0000-0000-0000000000f1', (select id from p12 where name = 'closed'))$$,
  'the factory archives the same order for itself'
);
select lives_ok(
  $$delete from public.order_archives where org_id = 'dc000000-0000-0000-0000-00000000000b'$$,
  'the factory''s delete on the brand''s archive runs...'
);
reset role;

select is(
  (select count(*)::int from public.order_archives where org_id = 'dc000000-0000-0000-0000-00000000000b'),
  1,
  '...and removes nothing'
);

-- ---------------------------------------------------------------------------
-- Strangers, and someone in two companies
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"cc000000-0000-0000-0000-000000000004","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$insert into public.order_archives (org_id, order_id)
    values ('dc000000-0000-0000-0000-00000000000c', (select id from p12 where name = 'closed'))$$,
  '42501', NULL,
  'a company that is not a party cannot archive the order'
);
select throws_ok(
  $$insert into public.order_archives (org_id, order_id)
    values ('dc000000-0000-0000-0000-00000000000b', (select id from p12 where name = 'closed'))$$,
  '42501', NULL,
  'a stranger cannot archive under the brand'
);
reset role;

set local request.jwt.claims = '{"sub":"cc000000-0000-0000-0000-000000000005","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$insert into public.order_archives (org_id, order_id)
    values ('dc000000-0000-0000-0000-0000000000f2', (select id from p12 where name = 'closed'))$$,
  '42501', NULL,
  'someone in the brand cannot archive the order under their other, unrelated company'
);
reset role;

-- ---------------------------------------------------------------------------
-- Unarchiving
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"cc000000-0000-0000-0000-000000000002","role":"authenticated"}';
set local role authenticated;
delete from public.order_archives where org_id = 'dc000000-0000-0000-0000-00000000000b';
reset role;

select is(
  (select count(*)::int from public.order_archives where org_id = 'dc000000-0000-0000-0000-00000000000b'),
  0,
  'a teammate unarchives the order'
);

select is(
  (select count(*)::int from public.order_archives where org_id = 'dc000000-0000-0000-0000-0000000000f1'),
  1,
  'and the factory''s own archive is untouched'
);

select * from finish();
rollback;
