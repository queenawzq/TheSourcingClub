-- ============================================================================
-- A factory creates a quote as a draft; only Send makes it submitted
-- (20261125700000). Prefix `pgtap-quotedraft-`, every count scoped to these
-- fixtures.
--
-- The attack: a factory inserts a quote already 'submitted' (or 'accepted'),
-- so the brand sees a sent quote that submit_quote() never checked or charged.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(13);

insert into auth.users (id, email) values
  ('c5050000-0000-0000-0000-000000000001', 'quotedraft-brand@example.com'),
  ('c5050000-0000-0000-0000-000000000002', 'quotedraft-factory@example.com');

insert into public.orgs (id, type, name, slug) values
  ('d5050000-0000-0000-0000-00000000000b', 'brand',   'QuoteDraft Brand',   'pgtap-quotedraft-brand'),
  ('d5050000-0000-0000-0000-0000000000f1', 'factory', 'QuoteDraft Factory', 'pgtap-quotedraft-factory');

insert into public.org_members (org_id, user_id, role) values
  ('d5050000-0000-0000-0000-00000000000b', 'c5050000-0000-0000-0000-000000000001', 'owner'),
  ('d5050000-0000-0000-0000-0000000000f1', 'c5050000-0000-0000-0000-000000000002', 'owner');

insert into public.brand_profiles (org_id, hq_location, onboarding_completed_at, verification_status)
values ('d5050000-0000-0000-0000-00000000000b', 'London, UK', now(), 'verified');

insert into public.factory_profiles (org_id, country_code, moq, published_at, verification_status)
values ('d5050000-0000-0000-0000-0000000000f1', 'PT', 100, now(), 'verified');

insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total, published_at)
values ('e5050000-0000-0000-0000-000000000001', 'd5050000-0000-0000-0000-00000000000b',
        'QuoteDraft request', 'open', 'open_to_all', 300, now()),
       ('e5050000-0000-0000-0000-000000000002', 'd5050000-0000-0000-0000-00000000000b',
        'QuoteDraft request, withdrawn from', 'open', 'open_to_all', 300, now());

-- A quote the factory withdrew, for the "posing as a revision" attempt: a
-- withdrawn quote is final, and a revision skips that check.
insert into public.quotes (id, rfq_id, factory_org_id, status, submitted_at)
values ('f5050000-0000-0000-0000-000000000001', 'e5050000-0000-0000-0000-000000000002',
        'd5050000-0000-0000-0000-0000000000f1', 'withdrawn', now());

insert into public.credit_ledger (org_id, delta, reason, note)
values ('d5050000-0000-0000-0000-0000000000f1', 50, 'admin_adjustment', 'pgtap-quotedraft');

set local request.jwt.claims = '{"sub":"c5050000-0000-0000-0000-000000000002","email":"quotedraft-factory@example.com","role":"authenticated"}';
set local role authenticated;

-- ---------------------------------------------------------------------------
-- What a factory cannot create
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ insert into public.quotes (rfq_id, factory_org_id, status, submitted_at, unit_price_cents)
     values ('e5050000-0000-0000-0000-000000000001', 'd5050000-0000-0000-0000-0000000000f1',
             'submitted', now(), 100) $$,
  '42501', null,
  'a factory CANNOT create a quote already submitted'
);

select throws_ok(
  $$ insert into public.quotes (rfq_id, factory_org_id, status)
     values ('e5050000-0000-0000-0000-000000000001', 'd5050000-0000-0000-0000-0000000000f1', 'accepted') $$,
  '42501', null,
  'a factory CANNOT create a quote already accepted'
);

select throws_ok(
  $$ insert into public.quotes (rfq_id, factory_org_id, submitted_at)
     values ('e5050000-0000-0000-0000-000000000001', 'd5050000-0000-0000-0000-0000000000f1', now()) $$,
  '42501', null,
  'a factory CANNOT create a draft stamped as sent'
);

select throws_ok(
  $$ insert into public.quotes (rfq_id, factory_org_id, decided_at)
     values ('e5050000-0000-0000-0000-000000000001', 'd5050000-0000-0000-0000-0000000000f1', now()) $$,
  '42501', null,
  'a factory CANNOT create a draft stamped as decided'
);

select throws_ok(
  $$ insert into public.quotes (rfq_id, factory_org_id, supersedes_quote_id, version)
     values ('e5050000-0000-0000-0000-000000000002', 'd5050000-0000-0000-0000-0000000000f1',
             'f5050000-0000-0000-0000-000000000001', 2) $$,
  '42501', null,
  'a factory CANNOT create a revision of its withdrawn quote by hand'
);

select throws_ok(
  $$ insert into public.quotes (rfq_id, factory_org_id, version)
     values ('e5050000-0000-0000-0000-000000000001', 'd5050000-0000-0000-0000-0000000000f1', 5) $$,
  '42501', null,
  'a factory CANNOT create a quote with a made-up version'
);

select is(
  (select count(*)::int from public.quotes
    where rfq_id in ('e5050000-0000-0000-0000-000000000001', 'e5050000-0000-0000-0000-000000000002')
      and id <> 'f5050000-0000-0000-0000-000000000001'),
  0,
  'none of the attempts left a quote behind'
);

-- ---------------------------------------------------------------------------
-- What still works
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ insert into public.quotes (id, rfq_id, factory_org_id, unit_price_cents, production_quantity,
                                bulk_lead_time_days, payment_term_id, incoterm_id, valid_until)
     values ('f5050000-0000-0000-0000-000000000002', 'e5050000-0000-0000-0000-000000000001',
             'd5050000-0000-0000-0000-0000000000f1', 1900, 300, 30,
             (select id from public.taxonomy_terms where kind = 'payment_term' and slug = 'deposit-30-70'),
             (select id from public.taxonomy_terms where kind = 'incoterm' and slug = 'fob'),
             (now() + interval '30 days')::date) $$,
  'a factory CAN still create a draft'
);

select is(
  (select status::text from public.quotes where id = 'f5050000-0000-0000-0000-000000000002'),
  'draft',
  'and it is a draft'
);

select lives_ok(
  $$ select public.submit_quote('f5050000-0000-0000-0000-000000000002') $$,
  'Send still sends it'
);

select is(
  (select status::text from public.quotes where id = 'f5050000-0000-0000-0000-000000000002'),
  'submitted',
  'and only then is it submitted'
);

select is(
  (select public.credit_balance('d5050000-0000-0000-0000-0000000000f1')),
  25,
  'Send charged its 25 credits'
);

select lives_ok(
  $$ select public.revise_quote('f5050000-0000-0000-0000-000000000002') $$,
  'revising a sent quote still works (it runs as the database, not the factory)'
);

select * from finish();
rollback;
