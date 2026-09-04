-- ============================================================================
-- Phase 2 access rule tests — RFQs, quotes, and award
-- ----------------------------------------------------------------------------
-- Run with:  supabase test db
--
-- Separate file from access_rules_test.sql so the two suites stay independent.
-- Same discipline applies: slugs are prefixed, every count is scoped to these
-- fixtures, and the assertions are mostly NEGATIVE — a policy that
-- accidentally grants everything passes any number of positive tests.
--
-- The marketplace rules ARE these policies. There is no server tier to enforce
-- them a second time, so a mistake here is a competitor reading your pricing.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(35);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
-- One brand with an owner and a non-owner member (award is owner-only), and
-- three factories: two verified competitors and one unverified.
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, raw_user_meta_data) values
  ('c0000000-0000-0000-0000-000000000001', 'p2-brandowner@example.com',  '{"name":"Brand Owner"}'),
  ('c0000000-0000-0000-0000-000000000002', 'p2-brandmember@example.com', '{"name":"Brand Member"}'),
  ('c0000000-0000-0000-0000-000000000003', 'p2-f1@example.com',          '{"name":"Factory One"}'),
  ('c0000000-0000-0000-0000-000000000004', 'p2-f2@example.com',          '{"name":"Factory Two"}'),
  ('c0000000-0000-0000-0000-000000000005', 'p2-f3@example.com',          '{"name":"Factory Three"}');

insert into public.orgs (id, type, name, slug) values
  ('d0000000-0000-0000-0000-00000000000b', 'brand',   'P2 Brand',     'pgtap2-brand'),
  ('d0000000-0000-0000-0000-0000000000f1', 'factory', 'P2 Factory 1', 'pgtap2-factory-1'),
  ('d0000000-0000-0000-0000-0000000000f2', 'factory', 'P2 Factory 2', 'pgtap2-factory-2'),
  ('d0000000-0000-0000-0000-0000000000f3', 'factory', 'P2 Factory 3', 'pgtap2-factory-3');

insert into public.org_members (org_id, user_id, role) values
  ('d0000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-000000000001', 'owner'),
  ('d0000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-000000000002', 'member'),
  ('d0000000-0000-0000-0000-0000000000f1', 'c0000000-0000-0000-0000-000000000003', 'owner'),
  ('d0000000-0000-0000-0000-0000000000f2', 'c0000000-0000-0000-0000-000000000004', 'owner'),
  ('d0000000-0000-0000-0000-0000000000f3', 'c0000000-0000-0000-0000-000000000005', 'owner');

insert into public.brand_profiles (org_id, hq_location) values
  ('d0000000-0000-0000-0000-00000000000b', 'New York, USA');

insert into public.factory_profiles (org_id, country_code, moq, published_at, verification_status) values
  ('d0000000-0000-0000-0000-0000000000f1', 'PT', 100, now(), 'verified'),
  ('d0000000-0000-0000-0000-0000000000f2', 'CN', 100, now(), 'verified'),
  ('d0000000-0000-0000-0000-0000000000f3', 'CN', 100, now(), 'unverified');

-- Three requests covering every visibility case.
insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total) values
  ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-00000000000b',
   'Still a draft',      'draft', 'invited_only', 300),
  ('e0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-00000000000b',
   'Invite only',        'open',  'invited_only', 300),
  ('e0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-00000000000b',
   'Open to everyone',   'open',  'open_to_all',  300);

-- Factory 1 is invited to the invite-only request; Factory 2 is not.
insert into public.rfq_invitations (rfq_id, factory_org_id) values
  ('e0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-0000000000f1');

insert into public.rfq_questions (id, rfq_id, prompt, is_sensitive, sort) values
  ('e0000000-0000-0000-0000-0000000000a1', 'e0000000-0000-0000-0000-000000000003',
   'Can you split fit and PP sample cost?', false, 1),
  ('e0000000-0000-0000-0000-0000000000a2', 'e0000000-0000-0000-0000-000000000003',
   'What is your best price if we double the order?', true, 2);

-- ---------------------------------------------------------------------------
-- RFQ visibility
-- ---------------------------------------------------------------------------

reset role;
set local request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-000000000004","email":"p2-f2@example.com","role":"authenticated"}';
set local role authenticated;

select is(
  (select count(*)::int from public.rfqs where id = 'e0000000-0000-0000-0000-000000000001'),
  0,
  'a factory CANNOT read an rfq while it is still a draft'
);

select is(
  (select count(*)::int from public.rfqs where id = 'e0000000-0000-0000-0000-000000000002'),
  0,
  'a factory that was not invited CANNOT read an invite-only rfq'
);

select is(
  (select count(*)::int from public.rfqs where id = 'e0000000-0000-0000-0000-000000000003'),
  1,
  'any signed-in factory CAN read an open, open-to-all rfq'
);

reset role;
set local request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-000000000003","email":"p2-f1@example.com","role":"authenticated"}';
set local role authenticated;

select is(
  (select count(*)::int from public.rfqs where id = 'e0000000-0000-0000-0000-000000000002'),
  1,
  'an invited factory CAN read the invite-only rfq'
);

select is(
  (select count(*)::int from public.rfq_invitations
     where rfq_id = 'e0000000-0000-0000-0000-000000000002'
       and factory_org_id <> 'd0000000-0000-0000-0000-0000000000f1'),
  0,
  'a factory CANNOT enumerate which competitors were also invited'
);

-- ---------------------------------------------------------------------------
-- The verification gate
-- ---------------------------------------------------------------------------

reset role;
set local request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-000000000005","email":"p2-f3@example.com","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$insert into public.quotes (rfq_id, factory_org_id)
    values ('e0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-0000000000f3')$$,
  '42501',
  null,
  'an UNVERIFIED factory CANNOT insert a quote, even on an open-to-all rfq'
);

reset role;
set local request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-000000000004","email":"p2-f2@example.com","role":"authenticated"}';
set local role authenticated;

select lives_ok(
  $$insert into public.quotes (id, rfq_id, factory_org_id, unit_price_cents, production_quantity, bulk_lead_time_days, valid_until)
    values ('f0000000-0000-0000-0000-0000000000f2', 'e0000000-0000-0000-0000-000000000003',
            'd0000000-0000-0000-0000-0000000000f2', 1840, 300, 28, current_date + 30)$$,
  'a VERIFIED factory CAN quote an open-to-all rfq without an invitation'
);

reset role;
set local request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-000000000003","email":"p2-f1@example.com","role":"authenticated"}';
set local role authenticated;

insert into public.quotes (id, rfq_id, factory_org_id, unit_price_cents, production_quantity, bulk_lead_time_days, valid_until)
values ('f0000000-0000-0000-0000-0000000000f1', 'e0000000-0000-0000-0000-000000000003',
        'd0000000-0000-0000-0000-0000000000f1', 1710, 300, 26, current_date + 30);

insert into public.quote_sample_lines (quote_id, stage, cost_cents, timing_days)
values ('f0000000-0000-0000-0000-0000000000f1', 'Fit sample', 9500, 10);

select is(
  public.quote_sample_subtotal('f0000000-0000-0000-0000-0000000000f1'),
  9500,
  'sample subtotal is summed from the lines, never stored'
);

-- ---------------------------------------------------------------------------
-- Competitor isolation — the most damaging thing to get wrong
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from public.quotes
     where factory_org_id = 'd0000000-0000-0000-0000-0000000000f2'),
  0,
  'a factory CANNOT read a competing factory''s quote'
);

select is(
  (select count(*)::int from public.quote_sample_lines
     where quote_id = 'f0000000-0000-0000-0000-0000000000f2'),
  0,
  'a factory CANNOT read a competing factory''s sample lines'
);

select is(
  (select count(*)::int from public.quotes
     where id = 'f0000000-0000-0000-0000-0000000000f1'),
  1,
  'a factory CAN read its own quote'
);

-- ---------------------------------------------------------------------------
-- Draft quotes are invisible to the brand
-- ---------------------------------------------------------------------------

reset role;
set local request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-000000000001","email":"p2-brandowner@example.com","role":"authenticated"}';
set local role authenticated;

select is(
  (select count(*)::int from public.quotes where rfq_id = 'e0000000-0000-0000-0000-000000000003'),
  0,
  'a brand CANNOT see quotes while they are still drafts'
);

select throws_ok(
  $$update public.rfqs set status = 'awarded'
     where id = 'e0000000-0000-0000-0000-000000000003'$$,
  '42501',
  null,
  'a brand CANNOT set an rfq to awarded with a direct update'
);

-- ---------------------------------------------------------------------------
-- Submission
-- ---------------------------------------------------------------------------

reset role;
set local request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-000000000003","email":"p2-f1@example.com","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$select public.submit_quote('f0000000-0000-0000-0000-0000000000f1')$$,
  '22023',
  null,
  'submit_quote refuses a quote with missing required terms, naming them'
);

reset role;
update public.quotes
   set payment_term_id = (select id from public.taxonomy_terms where kind='payment_term' and slug='deposit-30-70'),
       incoterm_id     = (select id from public.taxonomy_terms where kind='incoterm' and slug='fob')
 where id in ('f0000000-0000-0000-0000-0000000000f1', 'f0000000-0000-0000-0000-0000000000f2');

set local request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-000000000003","email":"p2-f1@example.com","role":"authenticated"}';
set local role authenticated;

select lives_ok(
  $$select public.submit_quote('f0000000-0000-0000-0000-0000000000f1')$$,
  'submit_quote accepts a complete quote from a verified factory'
);

reset role;
set local request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-000000000004","email":"p2-f2@example.com","role":"authenticated"}';
set local role authenticated;

-- Factory 2 answers both questions while its own quote is still a draft.
insert into public.quote_question_answers (quote_id, question_id, answer_text) values
  ('f0000000-0000-0000-0000-0000000000f2', 'e0000000-0000-0000-0000-0000000000a1', 'Yes, we can split them.'),
  ('f0000000-0000-0000-0000-0000000000f2', 'e0000000-0000-0000-0000-0000000000a2', 'We would go to $16.10 at double.');

select lives_ok(
  $$select public.submit_quote('f0000000-0000-0000-0000-0000000000f2')$$,
  'a second factory can submit its own quote on the same rfq'
);

-- ---------------------------------------------------------------------------
-- Question answers: public by default, sensitive stays private
-- ---------------------------------------------------------------------------

reset role;
set local request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-000000000003","email":"p2-f1@example.com","role":"authenticated"}';
set local role authenticated;

select is(
  (select count(*)::int from public.quote_question_answers
     where question_id = 'e0000000-0000-0000-0000-0000000000a1'
       and quote_id = 'f0000000-0000-0000-0000-0000000000f2'),
  1,
  'a competing factory CAN read a non-sensitive answer once the quote is live'
);

select is(
  (select count(*)::int from public.quote_question_answers
     where question_id = 'e0000000-0000-0000-0000-0000000000a2'),
  0,
  'a competing factory CANNOT read an answer to a SENSITIVE question'
);

-- The anonymity guarantee is emergent: the answer row is readable, but joining
-- it back to a factory goes through `quotes`, which gives a competitor nothing.
-- If this ever fails, someone loosened quotes_read.
select is(
  (select count(*)::int
     from public.quote_question_answers a
     join public.quotes q on q.id = a.quote_id
    where a.question_id = 'e0000000-0000-0000-0000-0000000000a1'
      and q.factory_org_id <> 'd0000000-0000-0000-0000-0000000000f1'),
  0,
  'a competitor CANNOT join a public answer back to the factory that wrote it'
);

-- ---------------------------------------------------------------------------
-- Award
-- ---------------------------------------------------------------------------

reset role;
set local request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-000000000002","email":"p2-brandmember@example.com","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$select public.award_quote('f0000000-0000-0000-0000-0000000000f1')$$,
  '42501',
  null,
  'a non-owner brand member CANNOT award a quote'
);

reset role;
set local request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-000000000001","email":"p2-brandowner@example.com","role":"authenticated"}';
set local role authenticated;

select is(
  (select count(*)::int from public.quotes where rfq_id = 'e0000000-0000-0000-0000-000000000003'),
  2,
  'the brand CAN see both quotes once they are submitted'
);

select throws_ok(
  $$select public.award_quote('f0000000-0000-0000-0000-000000000099')$$,
  'P0002',
  null,
  'award_quote rejects a quote that does not exist'
);

select lives_ok(
  $$select public.award_quote('f0000000-0000-0000-0000-0000000000f1')$$,
  'the brand owner CAN award a submitted quote'
);

select is(
  (select status::text from public.quotes where id = 'f0000000-0000-0000-0000-0000000000f2'),
  'declined',
  'awarding one quote auto-declines the other, in the same transaction'
);

select is(
  (select status::text from public.rfqs where id = 'e0000000-0000-0000-0000-000000000003'),
  'awarded',
  'awarding closes the rfq'
);

select throws_ok(
  $$select public.award_quote('f0000000-0000-0000-0000-0000000000f2')$$,
  '22023',
  null,
  'award_quote refuses a second award on an rfq that is already decided'
);

-- Both factories learn the outcome. Silence is the thing this prevents.
reset role;
select is(
  (select count(*)::int from public.notifications
     where subject_id = 'e0000000-0000-0000-0000-000000000003'),
  2,
  'every factory that quoted is notified, winner and loser alike'
);

set local request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-000000000004","email":"p2-f2@example.com","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$insert into public.notifications (org_id, kind, title)
    values ('d0000000-0000-0000-0000-0000000000f2', 'fake', 'You won')$$,
  '42501',
  null,
  'a factory CANNOT write itself a notification'
);

select throws_ok(
  $$select public.revise_quote('f0000000-0000-0000-0000-0000000000f2')$$,
  '22023',
  null,
  'a losing factory CANNOT revise its quote after the rfq is awarded'
);

-- ---------------------------------------------------------------------------
-- Counterparty org names (migration 023)
-- ---------------------------------------------------------------------------

reset role;
set local request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-000000000003","email":"p2-f1@example.com","role":"authenticated"}';
set local role authenticated;

select is(
  (select count(*)::int from public.orgs where id = 'd0000000-0000-0000-0000-00000000000b'),
  1,
  'a factory CAN read the name of a brand whose open request it can see'
);

select is(
  (select count(*)::int from public.orgs where id = 'd0000000-0000-0000-0000-0000000000f2'),
  0,
  'a factory still CANNOT read a competing factory''s org row'
);

-- ---------------------------------------------------------------------------
-- The helper fix from migration 014
-- ---------------------------------------------------------------------------
-- Before it, both helpers filtered org_id, so two RFQs from one brand shared
-- their requirements and scored identically. This is the assertion that would
-- have caught it.
-- ---------------------------------------------------------------------------

reset role;

insert into public.taxonomy_links (subject_type, subject_id, term_id, org_id)
select 'rfq', 'e0000000-0000-0000-0000-000000000002', t.id, 'd0000000-0000-0000-0000-00000000000b'
from public.taxonomy_terms t where t.kind = 'product_category' and t.slug = 'tops';

insert into public.taxonomy_links (subject_type, subject_id, term_id, org_id)
select 'rfq', 'e0000000-0000-0000-0000-000000000003', t.id, 'd0000000-0000-0000-0000-00000000000b'
from public.taxonomy_terms t where t.kind = 'product_category' and t.slug = 'swimwear';

insert into public.taxonomy_links (subject_type, subject_id, term_id, org_id)
select 'factory_profile', 'd0000000-0000-0000-0000-0000000000f1', t.id, 'd0000000-0000-0000-0000-0000000000f1'
from public.taxonomy_terms t where t.kind = 'product_category' and t.slug = 'tops';

select isnt(
  public.match_score_rfq('e0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-0000000000f1'),
  public.match_score_rfq('e0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-0000000000f1'),
  'two rfqs from the same brand score the same factory DIFFERENTLY'
);

select is(
  public.match_score_rfq('e0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-0000000000f1'),
  1.0000::numeric,
  'a factory that makes exactly what one rfq asks for scores it 100%'
);

-- ---------------------------------------------------------------------------
-- Admin allowlist (migration 024)
-- ---------------------------------------------------------------------------

reset role;

insert into auth.users (id, email) values
  ('c0000000-0000-0000-0000-0000000000a1', 'john@hexagontechnologies.io');

select is(
  (select count(*)::int from public.platform_admins
     where user_id = 'c0000000-0000-0000-0000-0000000000a1'),
  1,
  'an allowlisted address becomes a platform admin on first sign-in'
);

insert into auth.users (id, email) values
  ('c0000000-0000-0000-0000-0000000000a2', 'someone-else@example.com');

select is(
  (select count(*)::int from public.platform_admins
     where user_id = 'c0000000-0000-0000-0000-0000000000a2'),
  0,
  'an address NOT on the allowlist does not become an admin'
);

select * from finish();
rollback;
