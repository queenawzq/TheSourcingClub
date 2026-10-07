-- ============================================================================
-- Order tabs — a company's own groupings of its production orders (066)
-- ----------------------------------------------------------------------------
-- Run with:  supabase test db
--
-- `pgtap11-` slugs and cb…/db…/eb…/fb… ids, every count scoped to these
-- fixtures, as in every other suite: they all share one database.
--
-- What this protects: a company's tabs, and which orders it filed where, are
-- its own business. The other side of an order sees none of it; a stranger
-- changes none of it; and an order can only be filed by a company that is a
-- party to it — even by someone who also belongs to a second company.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(32);

-- ---------------------------------------------------------------------------
-- Fixtures: a brand with two members, the factory on its order, a stranger,
-- and someone in the brand AND an unrelated factory
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, raw_user_meta_data) values
  ('cb000000-0000-0000-0000-000000000001', 'p11-brandowner@example.com', '{"name":"Brand Owner"}'),
  ('cb000000-0000-0000-0000-000000000002', 'p11-teammate@example.com',   '{"name":"Teammate"}'),
  ('cb000000-0000-0000-0000-000000000003', 'p11-factory@example.com',    '{"name":"Factory Owner"}'),
  ('cb000000-0000-0000-0000-000000000004', 'p11-outsider@example.com',   '{"name":"Outsider"}'),
  ('cb000000-0000-0000-0000-000000000005', 'p11-both@example.com',       '{"name":"In Two Companies"}');

insert into public.orgs (id, type, name, slug) values
  ('db000000-0000-0000-0000-00000000000b', 'brand',   'P11 Brand',         'pgtap11-brand'),
  ('db000000-0000-0000-0000-0000000000f1', 'factory', 'P11 Factory',       'pgtap11-factory'),
  ('db000000-0000-0000-0000-00000000000c', 'brand',   'P11 Outsider',      'pgtap11-outsider'),
  ('db000000-0000-0000-0000-0000000000f2', 'factory', 'P11 Other Factory', 'pgtap11-other-factory');

insert into public.org_members (org_id, user_id, role) values
  ('db000000-0000-0000-0000-00000000000b', 'cb000000-0000-0000-0000-000000000001', 'owner'),
  ('db000000-0000-0000-0000-00000000000b', 'cb000000-0000-0000-0000-000000000002', 'member'),
  ('db000000-0000-0000-0000-0000000000f1', 'cb000000-0000-0000-0000-000000000003', 'owner'),
  ('db000000-0000-0000-0000-00000000000c', 'cb000000-0000-0000-0000-000000000004', 'owner'),
  ('db000000-0000-0000-0000-00000000000b', 'cb000000-0000-0000-0000-000000000005', 'member'),
  ('db000000-0000-0000-0000-0000000000f2', 'cb000000-0000-0000-0000-000000000005', 'owner');

insert into public.brand_profiles (org_id, hq_location) values
  ('db000000-0000-0000-0000-00000000000b', 'London, UK'),
  ('db000000-0000-0000-0000-00000000000c', 'Berlin, DE');

insert into public.factory_profiles (org_id, country_code, moq, published_at, verification_status) values
  ('db000000-0000-0000-0000-0000000000f1', 'PT', 100, now(), 'verified');

insert into public.rfqs (id, brand_org_id, title, brief, status, visibility, quantity_total) values
  ('eb000000-0000-0000-0000-000000000001', 'db000000-0000-0000-0000-00000000000b',
   'P11 shirts', 'One hundred linen shirts.', 'open', 'open_to_all', 100);

insert into public.quotes
  (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity,
   bulk_lead_time_days, deposit_pct, balance_pct, valid_until, submitted_at)
values
  ('fb000000-0000-0000-0000-0000000000f1', 'eb000000-0000-0000-0000-000000000001',
   'db000000-0000-0000-0000-0000000000f1', 'submitted', 2000, 100, 28, 30, 70,
   current_date + 30, now());

set local request.jwt.claims = '{"sub":"cb000000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select public.award_quote('fb000000-0000-0000-0000-0000000000f1');
reset role;

-- Ids every identity needs, read as the superuser so a party that cannot see
-- a tab still gets its id into the statement under test.
create temporary table p11 (name text primary key, id uuid);
insert into p11
select 'order', id from public.production_orders where quote_id = 'fb000000-0000-0000-0000-0000000000f1';
grant select on p11 to public;

-- ---------------------------------------------------------------------------
-- Adding a tab
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"cb000000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;

select lives_ok(
  $$select public.add_order_tab('db000000-0000-0000-0000-00000000000b', '  Spring 27 ')$$,
  'a brand member can add a tab'
);

select is(
  (select string_agg(kind || ':' || label, ', ' order by sort) from public.order_tabs
     where org_id = 'db000000-0000-0000-0000-00000000000b'),
  'active:Active orders, closed:Closed, custom:Spring 27',
  'the first add writes Active and Closed too, and trims the new name'
);

select throws_ok(
  $$select public.add_order_tab('db000000-0000-0000-0000-00000000000b', 'SPRING 27')$$,
  '22023', NULL,
  'two tabs cannot share a name, whatever the case'
);

select throws_ok(
  $$select public.add_order_tab('db000000-0000-0000-0000-00000000000b', '   ')$$,
  '22023', NULL,
  'a tab needs a name'
);

select throws_ok(
  $$select public.add_order_tab('db000000-0000-0000-0000-00000000000b', repeat('x', 41))$$,
  '22023', NULL,
  'a tab name is at most 40 characters'
);

reset role;
insert into p11 select 'spring', id from public.order_tabs
  where org_id = 'db000000-0000-0000-0000-00000000000b' and label = 'Spring 27';
insert into p11 select 'brand-active', id from public.order_tabs
  where org_id = 'db000000-0000-0000-0000-00000000000b' and kind = 'active';
insert into p11 select 'brand-closed', id from public.order_tabs
  where org_id = 'db000000-0000-0000-0000-00000000000b' and kind = 'closed';

-- ---------------------------------------------------------------------------
-- Who sees them
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"cb000000-0000-0000-0000-000000000002","role":"authenticated"}';
set local role authenticated;
select is(
  (select count(*)::int from public.order_tabs where org_id = 'db000000-0000-0000-0000-00000000000b'),
  3,
  'a teammate sees the same tabs'
);
reset role;

set local request.jwt.claims = '{"sub":"cb000000-0000-0000-0000-000000000003","role":"authenticated"}';
set local role authenticated;
select is(
  (select count(*)::int from public.order_tabs where org_id = 'db000000-0000-0000-0000-00000000000b'),
  0,
  'the factory on the order cannot see how the brand files it'
);
select throws_ok(
  $$select public.add_order_tab('db000000-0000-0000-0000-00000000000b', 'Mine now')$$,
  '42501', NULL,
  'the factory cannot add a tab for the brand'
);
select lives_ok(
  $$select public.add_order_tab('db000000-0000-0000-0000-0000000000f1', 'Linen')$$,
  'the factory can add a tab of its own'
);
reset role;
insert into p11 select 'factory-linen', id from public.order_tabs
  where org_id = 'db000000-0000-0000-0000-0000000000f1' and label = 'Linen';

set local request.jwt.claims = '{"sub":"cb000000-0000-0000-0000-000000000004","role":"authenticated"}';
set local role authenticated;
select is(
  (select count(*)::int from public.order_tabs
     where org_id in ('db000000-0000-0000-0000-00000000000b', 'db000000-0000-0000-0000-0000000000f1')),
  0,
  'a stranger sees neither side''s tabs'
);
select throws_ok(
  $$select public.save_order_tabs('db000000-0000-0000-0000-00000000000b',
      '[{"kind":"active","label":"A"},{"kind":"closed","label":"C"}]')$$,
  '42501', NULL,
  'a stranger cannot save another company''s tabs'
);
select throws_ok(
  $$select public.add_order_tab('db000000-0000-0000-0000-0000000000ff', 'Nowhere')$$,
  '42501', NULL,
  'a company that does not exist is refused the same way as one you are not in'
);
reset role;

-- ---------------------------------------------------------------------------
-- Writes go through the functions only
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"cb000000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$insert into public.order_tabs (org_id, kind, label, sort)
      values ('db000000-0000-0000-0000-00000000000b', 'custom', 'Direct', 99)$$,
  '42501', NULL,
  'a member cannot insert a tab directly'
);
select throws_ok(
  $$update public.order_tabs set label = 'Renamed' where id = (select id from p11 where name = 'spring')$$,
  '42501', NULL,
  'a member cannot rename a tab directly'
);
select throws_ok(
  $$delete from public.order_tabs where id = (select id from p11 where name = 'brand-active')$$,
  '42501', NULL,
  'a member cannot delete a tab directly, so Active cannot be removed that way'
);

-- ---------------------------------------------------------------------------
-- Filing an order
-- ---------------------------------------------------------------------------

select lives_ok(
  $$insert into public.order_tab_orders (tab_id, order_id, added_by)
      values ((select id from p11 where name = 'spring'), (select id from p11 where name = 'order'), auth.uid())$$,
  'a brand member can put its order in its tab'
);
select throws_ok(
  $$insert into public.order_tab_orders (tab_id, order_id, added_by)
      values ((select id from p11 where name = 'brand-active'), (select id from p11 where name = 'order'),
              'cb000000-0000-0000-0000-000000000002')$$,
  '42501', NULL,
  'nobody can file an order in a teammate''s name'
);
select throws_ok(
  $$update public.order_tab_orders set created_at = now()$$,
  '42501', NULL,
  'a filing cannot be edited, only added or removed'
);
reset role;

set local request.jwt.claims = '{"sub":"cb000000-0000-0000-0000-000000000002","role":"authenticated"}';
set local role authenticated;
select is(
  (select count(*)::int from public.order_tab_orders where tab_id = (select id from p11 where name = 'spring')),
  1,
  'a teammate sees the order in the tab'
);
reset role;

set local request.jwt.claims = '{"sub":"cb000000-0000-0000-0000-000000000003","role":"authenticated"}';
set local role authenticated;
select is(
  (select count(*)::int from public.order_tab_orders where order_id = (select id from p11 where name = 'order')),
  0,
  'the factory cannot see where the brand filed their order'
);
select throws_ok(
  $$insert into public.order_tab_orders (tab_id, order_id, added_by)
      values ((select id from p11 where name = 'spring'), (select id from p11 where name = 'order'), auth.uid())$$,
  '42501', NULL,
  'the factory cannot file into the brand''s tab'
);
select lives_ok(
  $$insert into public.order_tab_orders (tab_id, order_id, added_by)
      values ((select id from p11 where name = 'factory-linen'), (select id from p11 where name = 'order'), auth.uid())$$,
  'the factory can file the same order in its own tab'
);
reset role;

set local request.jwt.claims = '{"sub":"cb000000-0000-0000-0000-000000000005","role":"authenticated"}';
set local role authenticated;
select lives_ok(
  $$select public.add_order_tab('db000000-0000-0000-0000-0000000000f2', 'Not our order')$$,
  'someone in two companies can add a tab to the second one'
);
select throws_ok(
  $$insert into public.order_tab_orders (tab_id, order_id, added_by)
      values ((select id from public.order_tabs
                 where org_id = 'db000000-0000-0000-0000-0000000000f2' and label = 'Not our order'),
              (select id from p11 where name = 'order'), auth.uid())$$,
  '42501', NULL,
  'an order can only be filed by a company that is a party to it, even by someone who is in both'
);
reset role;

-- ---------------------------------------------------------------------------
-- Manage tabs: rename, reorder, delete, in one save
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"cb000000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$select public.save_order_tabs('db000000-0000-0000-0000-00000000000b',
      '[{"kind":"active","label":"Active orders"}]')$$,
  '22023', NULL,
  'Closed cannot be deleted'
);
select throws_ok(
  $$select public.save_order_tabs('db000000-0000-0000-0000-00000000000b',
      '[{"kind":"active","label":"A"},{"kind":"active","label":"B"},{"kind":"closed","label":"C"}]')$$,
  '22023', NULL,
  'there is only one Active tab'
);
select throws_ok(
  format($$select public.save_order_tabs('db000000-0000-0000-0000-00000000000b',
      '[{"kind":"active","label":"A"},{"kind":"closed","label":"C"},{"id":"%s","kind":"custom","label":"Taken"}]')$$,
    (select id from p11 where name = 'factory-linen')),
  '22023', NULL,
  'a save cannot reach another company''s tab by its id'
);

select lives_ok(
  format($$select public.save_order_tabs('db000000-0000-0000-0000-00000000000b',
      '[{"id":"%s","kind":"custom","label":"Closed"},
        {"kind":"closed","label":"Spring 27"},
        {"kind":"active","label":"Running"},
        {"kind":"custom","label":"Resort"}]')$$,
    (select id from p11 where name = 'spring')),
  'one save renames, swaps two names, reorders and adds'
);
select is(
  (select string_agg(kind || ':' || label, ', ' order by sort) from public.order_tabs
     where org_id = 'db000000-0000-0000-0000-00000000000b'),
  'custom:Closed, closed:Spring 27, active:Running, custom:Resort',
  'the saved list is the list that was sent, in its order'
);

select lives_ok(
  $$select public.save_order_tabs('db000000-0000-0000-0000-00000000000b',
      '[{"kind":"active","label":"Running"},{"kind":"closed","label":"Done"},{"kind":"custom","label":"Resort"}]')$$,
  'a save that leaves a custom tab out deletes it'
);
reset role;

select is(
  (select count(*)::int from public.order_tab_orders where tab_id = (select id from p11 where name = 'spring')),
  0,
  'the orders filed in a deleted tab leave with it'
);

set local request.jwt.claims = '{"sub":"cb000000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$select public.save_order_tabs('db000000-0000-0000-0000-00000000000b',
      (select jsonb_agg(t) from (
         select jsonb_build_object('kind', 'active', 'label', 'A') as t
         union all select jsonb_build_object('kind', 'closed', 'label', 'C')
         union all select jsonb_build_object('kind', 'custom', 'label', 'Tab ' || n) from generate_series(1, 21) n
       ) s))$$,
  '22023', NULL,
  'a company has at most 20 custom tabs'
);
reset role;

select * from finish();
rollback;
