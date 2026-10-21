-- ============================================================================
-- Quote fixes (20261022000400)
-- ----------------------------------------------------------------------------
-- Run with:  supabase test db
--
-- `pgtap44-` slugs and 44a…/44b…/44c…/44d… ids, every count scoped to these
-- fixtures, as in every other suite: they all share one database.
--
-- What this protects: materials a factory marked not included reach the
-- order the brand funds (the same total the brand compared, see
-- scripts in notes/tools/s44-queena for the JavaScript side); an expired
-- quote is refused before it is charged for; approving a factory without
-- naming a tier keeps its tier; a factory's upsert may repeat its own tier
-- but never change it.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(18);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, raw_user_meta_data) values
  ('44a00000-0000-0000-0000-000000000001', 'p44-brand@example.com',     '{"name":"Brand Owner"}'),
  ('44a00000-0000-0000-0000-000000000002', 'p44-factory@example.com',   '{"name":"Factory Owner"}'),
  ('44a00000-0000-0000-0000-000000000003', 'p44-admin@example.com',     '{"name":"Staff"}'),
  ('44a00000-0000-0000-0000-000000000004', 'p44-verified@example.com',  '{"name":"Verified Owner"}'),
  ('44a00000-0000-0000-0000-000000000005', 'p44-newcomer@example.com',  '{"name":"Newcomer Owner"}');

insert into public.orgs (id, type, name, slug) values
  ('44b00000-0000-0000-0000-00000000000b', 'brand',   'P44 Brand',    'pgtap44-brand'),
  ('44b00000-0000-0000-0000-0000000000f1', 'factory', 'P44 Factory',  'pgtap44-factory'),
  ('44b00000-0000-0000-0000-0000000000f2', 'factory', 'P44 Verified', 'pgtap44-verified'),
  ('44b00000-0000-0000-0000-0000000000f3', 'factory', 'P44 Newcomer', 'pgtap44-newcomer');

insert into public.org_members (org_id, user_id, role) values
  ('44b00000-0000-0000-0000-00000000000b', '44a00000-0000-0000-0000-000000000001', 'owner'),
  ('44b00000-0000-0000-0000-0000000000f1', '44a00000-0000-0000-0000-000000000002', 'owner'),
  ('44b00000-0000-0000-0000-0000000000f2', '44a00000-0000-0000-0000-000000000004', 'owner'),
  ('44b00000-0000-0000-0000-0000000000f3', '44a00000-0000-0000-0000-000000000005', 'owner');

insert into public.platform_admins (user_id, note) values
  ('44a00000-0000-0000-0000-000000000003', 'pgtap44 staff');

insert into public.brand_profiles (org_id, hq_location) values
  ('44b00000-0000-0000-0000-00000000000b', 'London, UK');

-- Written as the test's own role (not a browser), so the tier is taken as given.
insert into public.factory_profiles (org_id, country_code, moq, published_at, verification_status, trust_tier) values
  ('44b00000-0000-0000-0000-0000000000f1', 'PT', 100, now(), 'verified', 'basic'),
  ('44b00000-0000-0000-0000-0000000000f2', 'PT', 100, now(), 'verified', 'verified');

insert into public.rfqs (id, brand_org_id, title, brief, status, visibility, quantity_total) values
  ('44c00000-0000-0000-0000-00000000000a', '44b00000-0000-0000-0000-00000000000b', 'P44 award',   'Three hundred shirts.', 'open', 'open_to_all', 300),
  ('44c00000-0000-0000-0000-00000000000b', '44b00000-0000-0000-0000-00000000000b', 'P44 expired', 'Three hundred shirts.', 'open', 'open_to_all', 300),
  ('44c00000-0000-0000-0000-00000000000c', '44b00000-0000-0000-0000-00000000000b', 'P44 today',   'Three hundred shirts.', 'open', 'open_to_all', 300);

-- A: $10.00 x 300, a $95 sample, and materials: $5.00 included, $0.35 and
-- $0.15 charged separately, and one separate line with no cost yet.
-- Order = 300,000 + 300 x 50 + 9,500 = 324,500.
insert into public.quotes
  (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity,
   bulk_lead_time_days, deposit_pct, balance_pct, valid_until, submitted_at)
values
  ('44d00000-0000-0000-0000-00000000000a', '44c00000-0000-0000-0000-00000000000a',
   '44b00000-0000-0000-0000-0000000000f1', 'submitted', 1000, 300, 28, 30, 70, current_date + 30, now());

insert into public.quote_sample_lines (quote_id, stage, cost_cents, sort) values
  ('44d00000-0000-0000-0000-00000000000a', 'Fit sample', 9500, 0);

insert into public.quote_material_lines (quote_id, material, cost_cents, included, sort) values
  ('44d00000-0000-0000-0000-00000000000a', 'Cotton poplin',  500,  true,  0),
  ('44d00000-0000-0000-0000-00000000000a', 'Woven labels',   35,   false, 1),
  ('44d00000-0000-0000-0000-00000000000a', 'Hang tags',      15,   false, 2),
  ('44d00000-0000-0000-0000-00000000000a', 'Gift box (TBC)', null, false, 3);

-- B: complete, but its valid_until was yesterday. C: valid until today.
insert into public.quotes (
  id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity,
  bulk_lead_time_days, payment_term_id, incoterm_id, valid_until
) values
  ('44d00000-0000-0000-0000-00000000000b', '44c00000-0000-0000-0000-00000000000b',
   '44b00000-0000-0000-0000-0000000000f1', 'draft', 1900, 300, 30,
   (select id from public.taxonomy_terms where kind = 'payment_term' and slug = 'deposit-30-70'),
   (select id from public.taxonomy_terms where kind = 'incoterm' and slug = 'fob'),
   current_date - 1),
  ('44d00000-0000-0000-0000-00000000000c', '44c00000-0000-0000-0000-00000000000c',
   '44b00000-0000-0000-0000-0000000000f1', 'draft', 1900, 300, 30,
   (select id from public.taxonomy_terms where kind = 'payment_term' and slug = 'deposit-30-70'),
   (select id from public.taxonomy_terms where kind = 'incoterm' and slug = 'fob'),
   current_date);

insert into public.credit_ledger (org_id, delta, reason, note)
values ('44b00000-0000-0000-0000-0000000000f1', 25, 'admin_adjustment', 'pgtap44');

-- ---------------------------------------------------------------------------
-- 1. Materials charged separately reach the order
-- ---------------------------------------------------------------------------

select is(
  public.quote_additional_material_per_unit('44d00000-0000-0000-0000-00000000000a'),
  50::bigint,
  'per unit, the materials charged separately are the lines not included (a line with no cost adds nothing)'
);

set local request.jwt.claims = '{"sub":"44a00000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select public.award_quote_with_incoterm(
  '44d00000-0000-0000-0000-00000000000a',
  (select id from public.taxonomy_terms where kind = 'incoterm' and slug = 'fob')
);
reset role;

select is(
  (select order_total_cents from public.production_orders where quote_id = '44d00000-0000-0000-0000-00000000000a'),
  324500::bigint,
  'the order total is production + materials charged separately + samples, the total the brand compared'
);

select is(
  (select bulk_subtotal_cents from public.production_orders where quote_id = '44d00000-0000-0000-0000-00000000000a'),
  315000::bigint,
  'the materials are in the bulk subtotal'
);

select is(
  (select unit_price_cents from public.production_orders where quote_id = '44d00000-0000-0000-0000-00000000000a'),
  1000::bigint,
  'and the unit price stays the price the factory quoted'
);

select is(
  (select m.amount_cents from public.order_milestones m
     join public.production_orders o on o.id = m.order_id
    where o.quote_id = '44d00000-0000-0000-0000-00000000000a' and m.title = 'Bulk deposit'),
  94500::bigint,
  'the deposit is 30% of the bulk subtotal, materials included'
);

select is(
  (select m.amount_cents from public.order_milestones m
     join public.production_orders o on o.id = m.order_id
    where o.quote_id = '44d00000-0000-0000-0000-00000000000a' and m.title = 'Final balance'),
  220500::bigint,
  'the balance is the bulk subtotal less the deposit'
);

select is(
  (select sum(m.amount_cents)::bigint from public.order_milestones m
     join public.production_orders o on o.id = m.order_id
    where o.quote_id = '44d00000-0000-0000-0000-00000000000a'),
  324500::bigint,
  'and the generated steps total the order'
);

-- ---------------------------------------------------------------------------
-- 2. An expired quote is refused before it is charged
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"44a00000-0000-0000-0000-000000000002","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$select public.submit_quote('44d00000-0000-0000-0000-00000000000b')$$, '22023',
  null, 'a quote whose valid-until date has passed is not sent'
);

select is(
  (select status::text from public.quotes where id = '44d00000-0000-0000-0000-00000000000b'),
  'draft',
  'it stays a draft'
);

select is(
  public.credit_balance('44b00000-0000-0000-0000-0000000000f1'),
  25,
  'and no credits were charged for it'
);

select lives_ok(
  $$select public.submit_quote('44d00000-0000-0000-0000-00000000000c')$$,
  'a quote valid until today still sends, as award_quote would still accept it'
);

reset role;

-- ---------------------------------------------------------------------------
-- 3. Approving without a tier keeps the factory's tier
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"44a00000-0000-0000-0000-000000000003","role":"authenticated"}';
set local role authenticated;

select lives_ok(
  $$select public.admin_review_decision_with_tier(
      '44b00000-0000-0000-0000-0000000000f2', 'approved', null, null, null)$$,
  'staff approve a Verified factory without naming a tier'
);

reset role;

select is(
  (select trust_tier::text from public.factory_profiles where org_id = '44b00000-0000-0000-0000-0000000000f2'),
  'verified',
  'and it is still Verified, not reset to basic'
);

-- ---------------------------------------------------------------------------
-- 4. A factory's upsert may repeat its tier, never change it
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"44a00000-0000-0000-0000-000000000004","role":"authenticated"}';
set local role authenticated;

select lives_ok(
  $$insert into public.factory_profiles (org_id, country_code, intro, trust_tier)
    values ('44b00000-0000-0000-0000-0000000000f2', 'PT', 'pgtap44 upsert', 'verified')
    on conflict (org_id) do update
      set country_code = excluded.country_code, intro = excluded.intro, trust_tier = excluded.trust_tier$$,
  'a Verified factory saves its profile by upsert, repeating the tier it has'
);

select is(
  (select trust_tier::text || '/' || intro from public.factory_profiles
    where org_id = '44b00000-0000-0000-0000-0000000000f2'),
  'verified/pgtap44 upsert',
  'the save went through and the tier is unchanged'
);

select throws_ok(
  $$insert into public.factory_profiles (org_id, country_code, trust_tier)
    values ('44b00000-0000-0000-0000-0000000000f2', 'PT', 'trusted')
    on conflict (org_id) do update set trust_tier = excluded.trust_tier$$, '42501',
  null, 'an upsert that changes the tier is refused'
);

select throws_ok(
  $$update public.factory_profiles set trust_tier = 'basic'
     where org_id = '44b00000-0000-0000-0000-0000000000f2'$$, '42501',
  null, 'so is an update that changes it'
);

-- A new row from the browser starts at basic whatever it asks for.
set local request.jwt.claims = '{"sub":"44a00000-0000-0000-0000-000000000005","role":"authenticated"}';

insert into public.factory_profiles (org_id, country_code, trust_tier)
values ('44b00000-0000-0000-0000-0000000000f3', 'PT', 'trusted');

reset role;

select is(
  (select trust_tier::text from public.factory_profiles where org_id = '44b00000-0000-0000-0000-0000000000f3'),
  'basic',
  'a factory inserting its own profile as Trusted is given basic'
);

select * from finish();
rollback;
