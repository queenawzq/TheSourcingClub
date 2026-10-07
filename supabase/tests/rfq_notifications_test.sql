-- ============================================================================
-- Telling each side what the other did on a request
-- ----------------------------------------------------------------------------
-- Ninth suite, `pgtap9-` prefixed, every assertion scoped to its fixtures.
--
-- An invitation, a quote sent and a quote withdrawn each notify the other
-- side, inside the same transaction. What matters as much as the notification
-- arriving is where it does NOT arrive: a third vendor must never learn that a
-- competitor quoted. Also pinned: the credit charge is exactly what it was, and
-- a vendor that withdrew a sent quote cannot come back with a new one.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(19);

insert into auth.users (id, email) values
  ('c9000000-0000-0000-0000-000000000001', 'p9-brand@example.com'),
  ('c9000000-0000-0000-0000-000000000002', 'p9-factory-a@example.com'),
  ('c9000000-0000-0000-0000-000000000003', 'p9-factory-b@example.com');

insert into public.orgs (id, type, name, slug) values
  ('d9000000-0000-0000-0000-00000000000b', 'brand',   'P9 Brand',     'pgtap9-brand'),
  ('d9000000-0000-0000-0000-0000000000f1', 'factory', 'P9 Factory A', 'pgtap9-factory-a'),
  ('d9000000-0000-0000-0000-0000000000f2', 'factory', 'P9 Factory B', 'pgtap9-factory-b');

insert into public.org_members (org_id, user_id, role) values
  ('d9000000-0000-0000-0000-00000000000b', 'c9000000-0000-0000-0000-000000000001', 'owner'),
  ('d9000000-0000-0000-0000-0000000000f1', 'c9000000-0000-0000-0000-000000000002', 'owner'),
  ('d9000000-0000-0000-0000-0000000000f2', 'c9000000-0000-0000-0000-000000000003', 'owner');

insert into public.factory_profiles (org_id, country_code, moq, published_at, verification_status) values
  ('d9000000-0000-0000-0000-0000000000f1', 'PT', 100, now(), 'verified'),
  ('d9000000-0000-0000-0000-0000000000f2', 'PT', 100, now(), 'verified');

insert into public.credit_ledger (org_id, delta, reason, note) values
  ('d9000000-0000-0000-0000-0000000000f1', 100, 'admin_adjustment', 'pgtap9'),
  ('d9000000-0000-0000-0000-0000000000f2', 100, 'admin_adjustment', 'pgtap9');

insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total, published_at, quote_deadline) values
  ('e9000000-0000-0000-0000-000000000001', 'd9000000-0000-0000-0000-00000000000b',
   'P9 invite-only request', 'open', 'invited_only', 300, now(), now() + interval '10 days'),
  ('e9000000-0000-0000-0000-000000000002', 'd9000000-0000-0000-0000-00000000000b',
   'P9 public request', 'open', 'open_to_all', 300, now(), null);

-- Complete drafts, so the only thing under test is what sending them writes.
insert into public.quotes (
  id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity,
  bulk_lead_time_days, payment_term_id, incoterm_id, valid_until
)
select v.id, v.rfq_id, v.factory_org_id, 'draft', 1900, 300, 30,
       (select id from public.taxonomy_terms where kind = 'payment_term' and slug = 'deposit-30-70'),
       (select id from public.taxonomy_terms where kind = 'incoterm' and slug = 'fob'),
       (now() + interval '30 days')::date
  from (values
    ('f9000000-0000-0000-0000-000000000001'::uuid, 'e9000000-0000-0000-0000-000000000001'::uuid, 'd9000000-0000-0000-0000-0000000000f1'::uuid),
    ('f9000000-0000-0000-0000-000000000002'::uuid, 'e9000000-0000-0000-0000-000000000002'::uuid, 'd9000000-0000-0000-0000-0000000000f2'::uuid),
    ('f9000000-0000-0000-0000-000000000003'::uuid, 'e9000000-0000-0000-0000-000000000002'::uuid, 'd9000000-0000-0000-0000-0000000000f1'::uuid)
  ) as v(id, rfq_id, factory_org_id);

-- ---------------------------------------------------------------------------
-- Invited
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"c9000000-0000-0000-0000-000000000001","email":"p9-brand@example.com","role":"authenticated"}';
set local role authenticated;

select lives_ok(
  $$insert into public.rfq_invitations (rfq_id, factory_org_id)
    values ('e9000000-0000-0000-0000-000000000001', 'd9000000-0000-0000-0000-0000000000f1')$$,
  'the brand invites a vendor through the ordinary insert'
);

reset role;

select is(
  (select title from public.notifications
    where org_id = 'd9000000-0000-0000-0000-0000000000f1' and kind = 'rfq_invited'
      and subject_id = 'e9000000-0000-0000-0000-000000000001'),
  'P9 Brand invited you to quote on "P9 invite-only request"',
  'the invited vendor is told, by name of brand and request'
);

select is(
  (select count(*)::int from public.notifications
    where org_id = 'd9000000-0000-0000-0000-0000000000f2' and kind = 'rfq_invited'),
  0,
  'a vendor that was not invited hears nothing'
);

-- ---------------------------------------------------------------------------
-- Sent
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"c9000000-0000-0000-0000-000000000002","email":"p9-factory-a@example.com","role":"authenticated"}';
set local role authenticated;

select lives_ok(
  $$select public.submit_quote('f9000000-0000-0000-0000-000000000001')$$,
  'factory A sends its quote'
);

select is(
  (select count(*)::int from public.notifications where org_id = 'd9000000-0000-0000-0000-00000000000b'),
  0,
  'a vendor cannot read the brand''s notifications'
);

reset role;

select is(
  (select title from public.notifications
    where org_id = 'd9000000-0000-0000-0000-00000000000b' and kind = 'quote_received'),
  'P9 Factory A sent a quote on "P9 invite-only request"',
  'the brand is told a quote arrived'
);

select is(
  (select count(*)::int from public.notifications
    where org_id in ('d9000000-0000-0000-0000-0000000000f1', 'd9000000-0000-0000-0000-0000000000f2')
      and kind = 'quote_received'),
  0,
  'and no vendor is — least of all a competitor'
);

select is(
  (select sum(delta)::int from public.credit_ledger
    where org_id = 'd9000000-0000-0000-0000-0000000000f1' and reason = 'quote_submission'),
  -25,
  'sending still costs exactly 25 credits'
);

-- ---------------------------------------------------------------------------
-- Revised and sent again
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"c9000000-0000-0000-0000-000000000002","email":"p9-factory-a@example.com","role":"authenticated"}';
set local role authenticated;

select lives_ok(
  $$select public.revise_quote('f9000000-0000-0000-0000-000000000001')$$,
  'factory A reopens its sent quote as version 2'
);

select lives_ok(
  $$select public.submit_quote((select id from public.quotes
                                 where supersedes_quote_id = 'f9000000-0000-0000-0000-000000000001'))$$,
  'and sends it again'
);

reset role;

select is(
  (select sum(delta)::int from public.credit_ledger
    where org_id = 'd9000000-0000-0000-0000-0000000000f1' and reason = 'quote_submission'),
  -50,
  'a revision sent again is a second charge'
);

select is(
  (select count(*)::int from public.notifications
    where org_id = 'd9000000-0000-0000-0000-00000000000b' and kind = 'quote_received'
      and title = 'P9 Factory A sent a revised quote on "P9 invite-only request"'),
  1,
  'and the brand is told it is a revision'
);

-- ---------------------------------------------------------------------------
-- Withdrawn
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"c9000000-0000-0000-0000-000000000003","email":"p9-factory-b@example.com","role":"authenticated"}';
set local role authenticated;

select lives_ok(
  $$select public.submit_quote('f9000000-0000-0000-0000-000000000002')$$,
  'factory B sends a quote on the public request'
);

select lives_ok(
  $$select public.withdraw_quote('f9000000-0000-0000-0000-000000000002')$$,
  'and withdraws it'
);

select throws_ok(
  $$insert into public.quotes (rfq_id, factory_org_id)
    values ('e9000000-0000-0000-0000-000000000002', 'd9000000-0000-0000-0000-0000000000f2')$$,
  '22023', null,
  'a withdrawal is final: no new quote on the same request'
);

reset role;

select is(
  (select title from public.notifications
    where org_id = 'd9000000-0000-0000-0000-00000000000b' and kind = 'quote_withdrawn'),
  'P9 Factory B withdrew its quote on "P9 public request"',
  'the brand is told a quote it could see was withdrawn'
);

set local request.jwt.claims = '{"sub":"c9000000-0000-0000-0000-000000000002","email":"p9-factory-a@example.com","role":"authenticated"}';
set local role authenticated;

select lives_ok(
  $$select public.withdraw_quote('f9000000-0000-0000-0000-000000000003')$$,
  'factory A abandons a draft the brand never saw'
);

select lives_ok(
  $$insert into public.quotes (rfq_id, factory_org_id)
    values ('e9000000-0000-0000-0000-000000000002', 'd9000000-0000-0000-0000-0000000000f1')$$,
  'an abandoned draft does not close the door — only a sent quote withdrawn does'
);

reset role;

select is(
  (select count(*)::int from public.notifications
    where org_id = 'd9000000-0000-0000-0000-00000000000b' and kind = 'quote_withdrawn'),
  1,
  'and the brand hears nothing about a draft it never saw'
);

select * from finish();

rollback;
