-- ============================================================================
-- Reorder style — a brand repeats an order as a new draft request (069)
-- ----------------------------------------------------------------------------
-- Run with:  supabase test db
--
-- `pgtap13-` slugs and cd…/dd…/ed…/fd… ids, every count scoped to these
-- fixtures, as in every other suite: they all share one database.
--
-- What this protects: only the brand on an order can repeat it; the copy is
-- the request the brand wrote (its breakdown, questions and links included)
-- as a private draft that remembers its order; last run's dates are left
-- behind; and the original request is untouched.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(17);

-- ---------------------------------------------------------------------------
-- Fixtures: a brand with an owner and a member, its factory, a stranger. Two
-- orders: one running, one cancelled by both sides.
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, raw_user_meta_data) values
  ('cd000000-0000-0000-0000-000000000001', 'p13-brandowner@example.com', '{"name":"Brand Owner"}'),
  ('cd000000-0000-0000-0000-000000000002', 'p13-teammate@example.com',   '{"name":"Teammate"}'),
  ('cd000000-0000-0000-0000-000000000003', 'p13-factory@example.com',    '{"name":"Factory Owner"}'),
  ('cd000000-0000-0000-0000-000000000004', 'p13-outsider@example.com',   '{"name":"Outsider"}');

insert into public.orgs (id, type, name, slug) values
  ('dd000000-0000-0000-0000-00000000000b', 'brand',   'P13 Brand',    'pgtap13-brand'),
  ('dd000000-0000-0000-0000-0000000000f1', 'factory', 'P13 Factory',  'pgtap13-factory'),
  ('dd000000-0000-0000-0000-00000000000c', 'brand',   'P13 Outsider', 'pgtap13-outsider');

insert into public.org_members (org_id, user_id, role) values
  ('dd000000-0000-0000-0000-00000000000b', 'cd000000-0000-0000-0000-000000000001', 'owner'),
  ('dd000000-0000-0000-0000-00000000000b', 'cd000000-0000-0000-0000-000000000002', 'member'),
  ('dd000000-0000-0000-0000-0000000000f1', 'cd000000-0000-0000-0000-000000000003', 'owner'),
  ('dd000000-0000-0000-0000-00000000000c', 'cd000000-0000-0000-0000-000000000004', 'owner');

insert into public.brand_profiles (org_id, hq_location) values
  ('dd000000-0000-0000-0000-00000000000b', 'London, UK'),
  ('dd000000-0000-0000-0000-00000000000c', 'Berlin, DE');

insert into public.factory_profiles (org_id, country_code, moq, published_at, verification_status) values
  ('dd000000-0000-0000-0000-0000000000f1', 'PT', 100, now(), 'verified');

insert into public.rfqs
  (id, brand_org_id, title, brief, status, visibility, quantity_total, material_notes,
   sourcing_responsibility_term_id, target_delivery_month, requires_sample, sample_notes,
   target_unit_price_min_cents, target_unit_price_max_cents, quote_deadline, additional_details)
values
  ('ed000000-0000-0000-0000-000000000001', 'dd000000-0000-0000-0000-00000000000b',
   'P13 shirts', 'Two hundred linen shirts in two colours.', 'open', 'open_to_all', 200,
   'Washed linen, 160 gsm',
   (select id from public.taxonomy_terms where kind = 'sourcing_responsibility' and slug = 'mixed'),
   date_trunc('month', current_date)::date, true, 'Fit sample first',
   1800, 2400, now() + interval '7 days', 'Shell buttons, brand supplies labels'),
  ('ed000000-0000-0000-0000-000000000002', 'dd000000-0000-0000-0000-00000000000b',
   'P13 trousers', 'One hundred linen trousers.', 'open', 'open_to_all', 100,
   null, null, null, true, null, null, null, null, null);

insert into public.rfq_colour_splits (rfq_id, colour, quantity, sort) values
  ('ed000000-0000-0000-0000-000000000001', 'Sand', 100, 0),
  ('ed000000-0000-0000-0000-000000000001', 'Navy', 100, 1);

insert into public.rfq_questions (rfq_id, prompt, is_sensitive, sort) values
  ('ed000000-0000-0000-0000-000000000001', 'Can you garment-dye?', false, 0);

insert into public.taxonomy_links (subject_type, subject_id, term_id, org_id)
select 'rfq', 'ed000000-0000-0000-0000-000000000001', id, 'dd000000-0000-0000-0000-00000000000b'
  from public.taxonomy_terms
 where kind = 'certification' and slug in ('gots', 'oeko-tex-standard-100');

insert into public.quotes
  (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity,
   bulk_lead_time_days, deposit_pct, balance_pct, valid_until, submitted_at)
values
  ('fd000000-0000-0000-0000-0000000000f1', 'ed000000-0000-0000-0000-000000000001',
   'dd000000-0000-0000-0000-0000000000f1', 'submitted', 2000, 200, 28, 30, 70,
   current_date + 30, now()),
  ('fd000000-0000-0000-0000-0000000000f2', 'ed000000-0000-0000-0000-000000000002',
   'dd000000-0000-0000-0000-0000000000f1', 'submitted', 2500, 100, 28, 30, 70,
   current_date + 30, now());

set local request.jwt.claims = '{"sub":"cd000000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select public.award_quote('fd000000-0000-0000-0000-0000000000f1');
select public.award_quote('fd000000-0000-0000-0000-0000000000f2');
reset role;

-- Ids every identity needs, read and written as each of them.
create temporary table p13 (name text primary key, id uuid);
insert into p13
select 'running', id from public.production_orders where quote_id = 'fd000000-0000-0000-0000-0000000000f1';
insert into p13
select 'closed', id from public.production_orders where quote_id = 'fd000000-0000-0000-0000-0000000000f2';
grant select, insert on p13 to public;

-- The second order is cancelled the real way: the brand proposes, the
-- factory accepts.
set local request.jwt.claims = '{"sub":"cd000000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select public.propose_cancellation((select id from p13 where name = 'closed'), 'Season dropped');
reset role;
set local request.jwt.claims = '{"sub":"cd000000-0000-0000-0000-000000000003","role":"authenticated"}';
set local role authenticated;
select public.accept_cancellation((select id from p13 where name = 'closed'));
reset role;

-- ---------------------------------------------------------------------------
-- The brand reorders: a member, not only an owner, the same as starting any
-- new request.
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"cd000000-0000-0000-0000-000000000002","role":"authenticated"}';
set local role authenticated;

select lives_ok(
  $$insert into p13 select 'copy', public.duplicate_rfq_from_order((select id from p13 where name = 'running'))$$,
  'a brand member reorders a running order'
);

select is(
  (select row(status::text, visibility::text, title, reorder_of_order_id, created_by)::text
     from public.rfqs where id = (select id from p13 where name = 'copy')),
  row('draft', 'invited_only', 'P13 shirts (reorder)',
      (select id from p13 where name = 'running'),
      'cd000000-0000-0000-0000-000000000002'::uuid)::text,
  'the copy is a private draft, named as a reorder, that remembers its order and who made it'
);

select is(
  (select row(brief, quantity_total, material_notes, sourcing_responsibility_term_id, requires_sample,
              sample_notes, target_unit_price_min_cents, target_unit_price_max_cents, currency,
              additional_details)::text
     from public.rfqs where id = (select id from p13 where name = 'copy')),
  (select row(brief, quantity_total, material_notes, sourcing_responsibility_term_id, requires_sample,
              sample_notes, target_unit_price_min_cents, target_unit_price_max_cents, currency,
              additional_details)::text
     from public.rfqs where id = 'ed000000-0000-0000-0000-000000000001'),
  'what the brand asked for is copied as it was'
);

select is(
  (select row(target_delivery_month, quote_deadline, published_at, awarded_at, awarded_quote_id)::text
     from public.rfqs where id = (select id from p13 where name = 'copy')),
  row(null::date, null::timestamptz, null::timestamptz, null::timestamptz, null::uuid)::text,
  'last run''s delivery month and deadline, and every stamp, are left behind'
);

select results_eq(
  $$select colour, quantity, sort from public.rfq_colour_splits
     where rfq_id = (select id from p13 where name = 'copy') order by sort$$,
  $$values ('Sand'::text, 100, 0), ('Navy'::text, 100, 1)$$,
  'the colour breakdown is copied'
);

select results_eq(
  $$select prompt, is_sensitive from public.rfq_questions
     where rfq_id = (select id from p13 where name = 'copy')$$,
  $$values ('Can you garment-dye?'::text, false)$$,
  'the brand''s questions are copied'
);

select is(
  (select array_agg(t.slug order by t.slug)
     from public.taxonomy_links l join public.taxonomy_terms t on t.id = l.term_id
    where l.subject_type = 'rfq' and l.subject_id = (select id from p13 where name = 'copy')),
  array['gots', 'oeko-tex-standard-100']::text[],
  'the certification links are copied'
);

select is(
  (select count(*)::int from public.rfq_invitations
    where rfq_id = (select id from p13 where name = 'copy')),
  0,
  'nobody is invited yet: the composer invites when the brand sends it'
);

select lives_ok(
  $$insert into p13 select 'copy-closed', public.duplicate_rfq_from_order((select id from p13 where name = 'closed'))$$,
  'a cancelled order can be reordered too'
);

select is(
  (select title from public.rfqs where id = (select id from p13 where name = 'copy-closed')),
  'P13 trousers (reorder)',
  'and its copy is its own request'
);

reset role;

select is(
  (select row(status::text, title, quote_deadline is not null)::text
     from public.rfqs where id = 'ed000000-0000-0000-0000-000000000001'),
  row('awarded', 'P13 shirts', true)::text,
  'the original request is untouched'
);

select is(
  (select count(*)::int from public.rfq_colour_splits where rfq_id = 'ed000000-0000-0000-0000-000000000001'),
  2,
  'and keeps its own breakdown'
);

-- ---------------------------------------------------------------------------
-- Nobody else
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"cd000000-0000-0000-0000-000000000003","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$select public.duplicate_rfq_from_order((select id from p13 where name = 'running'))$$,
  '42501', 'only the brand on this order can reorder it',
  'the factory on the order cannot reorder it: the request is the brand''s'
);
reset role;

set local request.jwt.claims = '{"sub":"cd000000-0000-0000-0000-000000000004","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$select public.duplicate_rfq_from_order((select id from p13 where name = 'running'))$$,
  '42501', 'only the brand on this order can reorder it',
  'a stranger cannot reorder the brand''s order'
);
select throws_ok(
  $$select public.duplicate_rfq_from_order('00000000-0000-0000-0000-000000000000')$$,
  '42501', 'only the brand on this order can reorder it',
  'an unknown order gets the same answer, so the error says nothing about which orders exist'
);
reset role;

select is(
  (select count(*)::int from public.rfqs where brand_org_id = 'dd000000-0000-0000-0000-00000000000c'),
  0,
  'and nothing was made for the stranger'
);

select ok(
  not has_function_privilege('anon', 'public.duplicate_rfq_from_order(uuid)', 'execute'),
  'a signed-out caller cannot run it at all'
);

select * from finish();
rollback;
