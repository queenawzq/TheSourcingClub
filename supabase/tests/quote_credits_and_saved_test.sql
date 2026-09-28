-- ============================================================================
-- Quote credits, saved requests, and who looked
-- ----------------------------------------------------------------------------
-- Seventh suite, `pgtap7-` prefixed, every assertion scoped to its fixtures.
--
-- Three things arrived together because one screen needed all three: sending a
-- quote costs credits, a vendor can save a request for later, and a vendor is
-- told when the brand last looked. Each is a place where a client could either
-- spend someone else's money or read someone else's business, so the
-- assertions here are mostly about the refusals.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(15);

insert into auth.users (id, email) values
  ('c7000000-0000-0000-0000-000000000001', 'p7-brand@example.com'),
  ('c7000000-0000-0000-0000-000000000002', 'p7-factory@example.com'),
  ('c7000000-0000-0000-0000-000000000003', 'p7-other@example.com');

insert into public.orgs (id, type, name, slug) values
  ('d7000000-0000-0000-0000-00000000000b', 'brand',   'P7 Brand',   'pgtap7-brand'),
  ('d7000000-0000-0000-0000-0000000000f1', 'factory', 'P7 Factory', 'pgtap7-factory'),
  ('d7000000-0000-0000-0000-0000000000f2', 'factory', 'P7 Other',   'pgtap7-other');

insert into public.org_members (org_id, user_id, role) values
  ('d7000000-0000-0000-0000-00000000000b', 'c7000000-0000-0000-0000-000000000001', 'owner'),
  ('d7000000-0000-0000-0000-0000000000f1', 'c7000000-0000-0000-0000-000000000002', 'owner'),
  ('d7000000-0000-0000-0000-0000000000f2', 'c7000000-0000-0000-0000-000000000003', 'owner');

insert into public.brand_profiles (org_id, hq_location, onboarding_completed_at, verification_status)
values ('d7000000-0000-0000-0000-00000000000b', 'London, UK', now(), 'verified');

insert into public.factory_profiles (org_id, country_code, moq, published_at, verification_status) values
  ('d7000000-0000-0000-0000-0000000000f1', 'PT', 100, now(), 'verified'),
  ('d7000000-0000-0000-0000-0000000000f2', 'PT', 100, now(), 'verified');

insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total, published_at)
values ('e7000000-0000-0000-0000-000000000001', 'd7000000-0000-0000-0000-00000000000b',
        'P7 request', 'open', 'open_to_all', 300, now());

-- A complete quote, so the only thing left to refuse it is the balance.
insert into public.quotes (
  id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity,
  bulk_lead_time_days, payment_term_id, incoterm_id, valid_until
) values (
  'f7000000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-000000000001',
  'd7000000-0000-0000-0000-0000000000f1', 'draft', 1900, 300, 30,
  (select id from public.taxonomy_terms where kind = 'payment_term' and slug = 'deposit-30-70'),
  (select id from public.taxonomy_terms where kind = 'incoterm' and slug = 'fob'),
  (now() + interval '30 days')::date
);

-- ---------------------------------------------------------------------------
-- Credits
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"c7000000-0000-0000-0000-000000000002","email":"p7-factory@example.com","role":"authenticated"}';
set local role authenticated;

select is(
  (select public.quote_credit_cost()),
  25,
  'a quote costs 25 credits, from the database rather than the screen'
);

select throws_ok(
  $$select public.submit_quote('f7000000-0000-0000-0000-000000000001')$$, '22023',
  null, 'a factory with no credits cannot send a quote'
);

select is(
  (select status::text from public.quotes where id = 'f7000000-0000-0000-0000-000000000001'),
  'draft',
  'and the refused quote is still a draft'
);

select throws_ok(
  $$insert into public.credit_ledger (org_id, delta, reason)
    values ('d7000000-0000-0000-0000-0000000000f1', 500, 'onboarding_grant')$$, '42501',
  null, 'a factory cannot write itself credits'
);

-- 24 credits: one short, which is the boundary worth pinning.
reset role;
insert into public.credit_ledger (org_id, delta, reason, note)
values ('d7000000-0000-0000-0000-0000000000f1', 24, 'admin_adjustment', 'pgtap7');

set local request.jwt.claims = '{"sub":"c7000000-0000-0000-0000-000000000002","email":"p7-factory@example.com","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$select public.submit_quote('f7000000-0000-0000-0000-000000000001')$$, '22023',
  null, 'one credit short is still short'
);

reset role;
insert into public.credit_ledger (org_id, delta, reason, note)
values ('d7000000-0000-0000-0000-0000000000f1', 1, 'admin_adjustment', 'pgtap7 top-up');

set local request.jwt.claims = '{"sub":"c7000000-0000-0000-0000-000000000002","email":"p7-factory@example.com","role":"authenticated"}';
set local role authenticated;

select lives_ok(
  $$select public.submit_quote('f7000000-0000-0000-0000-000000000001')$$,
  'with exactly the price, the quote sends'
);

select is(
  (select public.credit_balance('d7000000-0000-0000-0000-0000000000f1')),
  0,
  'and the credits are gone — 25 charged against 25'
);

select is(
  (select count(*)::int from public.credit_ledger
    where org_id = 'd7000000-0000-0000-0000-0000000000f1' and reason = 'quote_submission'),
  1,
  'exactly one charge, tied to the quote it paid for'
);

-- ---------------------------------------------------------------------------
-- Saved requests
-- ---------------------------------------------------------------------------

select lives_ok(
  $$insert into public.saved_rfqs (org_id, rfq_id, saved_by)
    values ('d7000000-0000-0000-0000-0000000000f1', 'e7000000-0000-0000-0000-000000000001',
            'c7000000-0000-0000-0000-000000000002')$$,
  'a vendor saves a request for later'
);

select throws_ok(
  $$insert into public.saved_rfqs (org_id, rfq_id, saved_by)
    values ('d7000000-0000-0000-0000-0000000000f2', 'e7000000-0000-0000-0000-000000000001',
            'c7000000-0000-0000-0000-000000000002')$$, '42501',
  null, 'but not into another vendor''s list'
);

-- The other vendor, and the brand whose request it is, see nothing.
set local request.jwt.claims = '{"sub":"c7000000-0000-0000-0000-000000000003","email":"p7-other@example.com","role":"authenticated"}';

select is(
  (select count(*)::int from public.saved_rfqs
    where rfq_id = 'e7000000-0000-0000-0000-000000000001'),
  0,
  'another vendor cannot see who saved a request'
);

set local request.jwt.claims = '{"sub":"c7000000-0000-0000-0000-000000000001","email":"p7-brand@example.com","role":"authenticated"}';

select is(
  (select count(*)::int from public.saved_rfqs
    where rfq_id = 'e7000000-0000-0000-0000-000000000001'),
  0,
  'and neither can the brand that posted it'
);

-- ---------------------------------------------------------------------------
-- Who looked
-- ---------------------------------------------------------------------------
-- Still the brand here: recording a view is the brand opening its own request.

select lives_ok(
  $$select public.record_rfq_view('e7000000-0000-0000-0000-000000000001')$$,
  'the brand opening its own request records a view'
);

set local request.jwt.claims = '{"sub":"c7000000-0000-0000-0000-000000000003","email":"p7-other@example.com","role":"authenticated"}';

select isnt(
  (select public.rfq_last_brand_view('e7000000-0000-0000-0000-000000000001')),
  null,
  'a vendor that can see the request learns when the brand last looked'
);

select is(
  (select count(*)::int from public.rfq_views
    where rfq_id = 'e7000000-0000-0000-0000-000000000001'),
  0,
  'but reads no rows from the table itself — a time, not a trail'
);

select * from finish();

rollback;
