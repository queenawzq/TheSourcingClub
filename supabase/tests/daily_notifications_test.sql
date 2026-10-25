-- ============================================================================
-- Daily notifications, new matches, dates as data
-- ----------------------------------------------------------------------------
-- `pgtap21-` prefixed, ids `e9…`, every count scoped to its own fixtures.
--
-- Nobody in a browser runs the daily job or reads which reminders went out;
-- a reminder goes out once however often the job runs; a new request reaches
-- the factories it fits and no others; an invited factory is emailed once;
-- a step reminds the side whose turn it is; a bell hears only its own rows.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(39);

insert into auth.users (id, email, raw_user_meta_data) values
  ('e9110000-0000-0000-0000-000000000001', 'p21-brand@example.com',       '{"name":"P21 Brand"}'),
  ('e9110000-0000-0000-0000-000000000002', 'p21-fits@example.com',        '{"name":"P21 Fits"}'),
  ('e9110000-0000-0000-0000-000000000003', 'p21-other-goods@example.com', '{"name":"P21 Other"}'),
  ('e9110000-0000-0000-0000-000000000004', 'p21-unverified@example.com',  '{"name":"P21 New"}'),
  ('e9110000-0000-0000-0000-000000000005', 'p21-invited@example.com',     '{"name":"P21 Invited"}');

insert into public.orgs (id, type, name, slug) values
  ('e9120000-0000-0000-0000-00000000000b', 'brand',   'P21 Brand',       'pgtap21-brand'),
  ('e9120000-0000-0000-0000-0000000000f1', 'factory', 'P21 Fits',        'pgtap21-fits'),
  ('e9120000-0000-0000-0000-0000000000f2', 'factory', 'P21 Other goods', 'pgtap21-other'),
  ('e9120000-0000-0000-0000-0000000000f3', 'factory', 'P21 Unverified',  'pgtap21-unverified'),
  ('e9120000-0000-0000-0000-0000000000f4', 'factory', 'P21 Invited',     'pgtap21-invited');

insert into public.org_members (org_id, user_id, role) values
  ('e9120000-0000-0000-0000-00000000000b', 'e9110000-0000-0000-0000-000000000001', 'owner'),
  ('e9120000-0000-0000-0000-0000000000f1', 'e9110000-0000-0000-0000-000000000002', 'owner'),
  ('e9120000-0000-0000-0000-0000000000f2', 'e9110000-0000-0000-0000-000000000003', 'owner'),
  ('e9120000-0000-0000-0000-0000000000f3', 'e9110000-0000-0000-0000-000000000004', 'owner'),
  ('e9120000-0000-0000-0000-0000000000f4', 'e9110000-0000-0000-0000-000000000005', 'owner');

insert into public.factory_profiles (org_id, country_code, moq, published_at, verification_status) values
  ('e9120000-0000-0000-0000-0000000000f1', 'PT', 100, now(), 'verified'),
  ('e9120000-0000-0000-0000-0000000000f2', 'PT', 100, now(), 'verified'),
  ('e9120000-0000-0000-0000-0000000000f3', 'PT', 100, now(), 'unverified'),
  ('e9120000-0000-0000-0000-0000000000f4', 'PT', 100, now(), 'verified');

-- Two product categories: the request asks for the first; "Other goods"
-- makes only the second.
create temporary table p21_terms as
select (select id from public.taxonomy_terms where kind = 'product_category' order by slug limit 1) as asked,
       (select id from public.taxonomy_terms where kind = 'product_category' order by slug desc limit 1) as other;
grant select on p21_terms to public;

insert into public.taxonomy_links (subject_type, subject_id, term_id, org_id)
select 'factory_profile', f.org_id, case when f.org_id = 'e9120000-0000-0000-0000-0000000000f2' then t.other else t.asked end, f.org_id
  from public.factory_profiles f, p21_terms t
 where f.org_id in ('e9120000-0000-0000-0000-0000000000f1', 'e9120000-0000-0000-0000-0000000000f2',
                    'e9120000-0000-0000-0000-0000000000f3', 'e9120000-0000-0000-0000-0000000000f4');

insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total, quote_deadline) values
  ('e9130000-0000-0000-0000-000000000001', 'e9120000-0000-0000-0000-00000000000b', 'P21 linen shirts',
   'draft', 'open_to_all', 100, '2026-11-20 20:00:00+00');

insert into public.taxonomy_links (subject_type, subject_id, term_id, org_id)
select 'rfq', 'e9130000-0000-0000-0000-000000000001', asked, 'e9120000-0000-0000-0000-00000000000b' from p21_terms;

create temporary table p21_ids as
select array['e9120000-0000-0000-0000-0000000000f1', 'e9120000-0000-0000-0000-0000000000f2',
             'e9120000-0000-0000-0000-0000000000f3', 'e9120000-0000-0000-0000-0000000000f4',
             'e9120000-0000-0000-0000-00000000000b']::uuid[] as orgs;
grant select on p21_ids to public;

-- ---------------------------------------------------------------------------
-- Nobody in a browser runs the job or reads its record
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"e9110000-0000-0000-0000-000000000002","role":"authenticated"}';
set local role authenticated;

select throws_ok($$select public.run_daily_notifications()$$,
  '42501', null, 'a signed-in user cannot run the daily job');
select throws_ok($$select public.notify_rfq_matches('e9130000-0000-0000-0000-000000000001')$$,
  '42501', null, 'nor tell factories about a request');
select throws_ok($$select count(*) from public.notification_reminders$$,
  '42501', null, 'nor read which reminders went out');
select throws_ok(
  $$insert into public.notification_reminders (kind, subject_id, due_key, org_id)
    values ('capacity_reminder', 'e9120000-0000-0000-0000-0000000000f1', 'x', 'e9120000-0000-0000-0000-0000000000f1')$$,
  '42501', null, 'nor mark one as sent so it never comes');

reset role;
set local role anon;
select throws_ok($$select public.run_daily_notifications()$$,
  '42501', null, 'a signed-out visitor cannot run it either');
reset role;

-- ---------------------------------------------------------------------------
-- A request is published: the factories it fits hear about it
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"e9110000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select lives_ok(
  $$update public.rfqs set status = 'open', published_at = now() where id = 'e9130000-0000-0000-0000-000000000001'$$,
  'the brand publishes its request'
);
reset role;

select results_eq(
  $$select org_id::text from public.notifications
     where kind = 'rfq_matched' and subject_id = 'e9130000-0000-0000-0000-000000000001'
     order by org_id$$,
  $$values ('e9120000-0000-0000-0000-0000000000f1'), ('e9120000-0000-0000-0000-0000000000f4')$$,
  'only verified factories making what was asked are told, and never the brand'
);

select is(
  (select data ->> 'quote_deadline' is not null from public.notifications
    where kind = 'rfq_matched' and org_id = 'e9120000-0000-0000-0000-0000000000f1'),
  true, 'the quote deadline travels as data, for each reader''s time zone'
);

select is(
  (select count(*)::int from public.notification_email_outbox o
     join public.notifications n on n.id = o.notification_id
    where n.kind = 'rfq_matched' and o.org_id = 'e9120000-0000-0000-0000-0000000000f1' and o.status = 'pending'),
  1, 'the match is queued for email under the factory''s RFQ switch'
);

-- The brand invites one of them straight after publishing, as the composer does.
set local request.jwt.claims = '{"sub":"e9110000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select lives_ok(
  $$insert into public.rfq_invitations (rfq_id, factory_org_id)
    values ('e9130000-0000-0000-0000-000000000001', 'e9120000-0000-0000-0000-0000000000f4')$$,
  'the brand invites a factory that was also matched'
);
reset role;

select results_eq(
  $$select o.status, o.last_error from public.notification_email_outbox o
      join public.notifications n on n.id = o.notification_id
     where n.kind = 'rfq_matched' and o.org_id = 'e9120000-0000-0000-0000-0000000000f4'$$,
  $$values ('skipped'::text, 'invited to quote instead'::text)$$,
  'its "matches you" email is skipped: the invitation says more'
);

select is(
  (select count(*)::int from public.notification_email_outbox o
     join public.notifications n on n.id = o.notification_id
    where n.kind = 'rfq_invited' and o.org_id = 'e9120000-0000-0000-0000-0000000000f4' and o.status = 'pending'),
  1, 'so the invited factory gets one email, the invitation'
);

select is(
  (select data ->> 'quote_deadline' is not null from public.notifications
    where kind = 'rfq_invited' and org_id = 'e9120000-0000-0000-0000-0000000000f4'),
  true, 'the invitation carries the deadline as data too'
);

-- Back to draft and out again: nobody is told twice.
update public.rfqs set status = 'draft' where id = 'e9130000-0000-0000-0000-000000000001';
update public.rfqs set status = 'open' where id = 'e9130000-0000-0000-0000-000000000001';
select is(
  (select count(*)::int from public.notifications
    where kind = 'rfq_matched' and subject_id = 'e9130000-0000-0000-0000-000000000001'),
  2, 'publishing again tells nobody a second time'
);

insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total) values
  ('e9130000-0000-0000-0000-000000000002', 'e9120000-0000-0000-0000-00000000000b', 'P21 invite only',
   'open', 'invited_only', 100);
insert into public.taxonomy_links (subject_type, subject_id, term_id, org_id)
select 'rfq', 'e9130000-0000-0000-0000-000000000002', asked, 'e9120000-0000-0000-0000-00000000000b' from p21_terms;
select is(
  public.notify_rfq_matches('e9130000-0000-0000-0000-000000000002'),
  0, 'an invite-only request is never offered to anyone else'
);

-- ---------------------------------------------------------------------------
-- Capacity reminders
-- ---------------------------------------------------------------------------

-- A trading company has no capacity card; an unpublished profile is not
-- shown to brands; a manufacturer that never set capacity is asked to.
insert into public.orgs (id, type, name, slug) values
  ('e9120000-0000-0000-0000-0000000000f5', 'factory', 'P21 Trading',     'pgtap21-trading'),
  ('e9120000-0000-0000-0000-0000000000f6', 'factory', 'P21 Never set',   'pgtap21-never-set'),
  ('e9120000-0000-0000-0000-0000000000f7', 'factory', 'P21 Unpublished', 'pgtap21-unpublished');
insert into public.factory_profiles (org_id, country_code, moq, vendor_kind, published_at, verification_status, created_at) values
  ('e9120000-0000-0000-0000-0000000000f5', 'HK', 100, 'trading_company', now(), 'verified', now() - interval '40 days'),
  ('e9120000-0000-0000-0000-0000000000f6', 'PT', 100, 'manufacturer',    now(), 'verified', now() - interval '40 days'),
  ('e9120000-0000-0000-0000-0000000000f7', 'PT', 100, 'manufacturer',    null,  'verified', now() - interval '40 days');
update p21_ids set orgs = orgs || array['e9120000-0000-0000-0000-0000000000f5', 'e9120000-0000-0000-0000-0000000000f6',
                                        'e9120000-0000-0000-0000-0000000000f7']::uuid[];

insert into public.factory_capacity (org_id, input_mode, monthly_units, updated_at) values
  ('e9120000-0000-0000-0000-0000000000f1', 'units', 3000, now() - interval '31 days'),
  ('e9120000-0000-0000-0000-0000000000f2', 'units', 3000, now() - interval '3 days'),
  ('e9120000-0000-0000-0000-0000000000f3', 'units', 3000, now() - interval '90 days'),
  ('e9120000-0000-0000-0000-0000000000f5', 'units', 3000, now() - interval '40 days'),
  ('e9120000-0000-0000-0000-0000000000f7', 'units', 3000, now() - interval '40 days');

select lives_ok($$select public.run_daily_notifications()$$, 'the daily job runs');

select results_eq(
  $$select org_id::text from public.notifications
     where kind = 'capacity_reminder' and org_id = any ((select orgs from p21_ids)::uuid[])
     order by org_id$$,
  $$values ('e9120000-0000-0000-0000-0000000000f1'), ('e9120000-0000-0000-0000-0000000000f6')$$,
  'only verified, published manufacturers whose capacity is a month old (or was never set) are reminded'
);

select results_eq(
  $$select title, body from public.notifications
     where kind = 'capacity_reminder' and org_id = 'e9120000-0000-0000-0000-0000000000f6'$$,
  $$values ('Set your open capacity'::text,
            'You haven''t set your open capacity yet. Brands see it when they choose who to invite, so add it from your dashboard.'::text)$$,
  'a factory that never set its capacity is asked to set it, not told when it last did'
);

select is(
  (select subject_type from public.notifications
    where kind = 'capacity_reminder' and org_id = 'e9120000-0000-0000-0000-0000000000f1'),
  'capacity', 'the reminder opens the factory''s dashboard, where capacity is updated'
);

select public.run_daily_notifications();
select is(
  (select count(*)::int from public.notifications
    where kind = 'capacity_reminder' and org_id = 'e9120000-0000-0000-0000-0000000000f1'),
  1, 'running again the same day reminds nobody twice'
);

update public.factory_capacity set monthly_units = 3200 where org_id = 'e9120000-0000-0000-0000-0000000000f1';
select public.run_daily_notifications();
select is(
  (select count(*)::int from public.notifications
    where kind = 'capacity_reminder' and org_id = 'e9120000-0000-0000-0000-0000000000f1'),
  1, 'a factory that has just updated is not reminded'
);

-- ---------------------------------------------------------------------------
-- Steps due soon
-- ---------------------------------------------------------------------------

insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total) values
  ('e9130000-0000-0000-0000-000000000003', 'e9120000-0000-0000-0000-00000000000b', 'P21 order',
   'open', 'invited_only', 100);
insert into public.quotes
  (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity,
   bulk_lead_time_days, deposit_pct, balance_pct, valid_until, submitted_at)
values
  ('e9140000-0000-0000-0000-000000000001', 'e9130000-0000-0000-0000-000000000003',
   'e9120000-0000-0000-0000-0000000000f1', 'submitted', 2000, 100, 28, 30, 70, current_date + 30, now());

set local request.jwt.claims = '{"sub":"e9110000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select public.award_quote('e9140000-0000-0000-0000-000000000001');
reset role;

create temporary table p21_order as
select o.id as order_id,
       (select id from public.order_milestones m where m.order_id = o.id order by sort limit 1) as first_step,
       (select id from public.order_milestones m where m.order_id = o.id order by sort desc limit 1) as last_step
  from public.production_orders o
 where o.quote_id = 'e9140000-0000-0000-0000-000000000001';
grant select on p21_order to public;

set local request.jwt.claims = '{"sub":"e9110000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select public.agree_schedule((select order_id from p21_order), 1);
reset role;

-- The first step stands in for a paid step with work ("Fit sample"): open,
-- with its payment due. Until the brand funds it, it is the brand's turn.
update public.order_milestones set kind = 'approval_and_payment', due_on = current_date + 3
 where id = (select first_step from p21_order);
update public.order_milestones set due_on = current_date + 10 where id = (select last_step from p21_order);

select results_eq(
  $$select steps_awaiting_you, steps_you_are_working_on
      from public.dashboard_snapshot('e9120000-0000-0000-0000-0000000000f1')$$,
  $$values (0, 0)$$,
  'an unfunded step is not on the factory''s "needs an update" count'
);
select results_eq(
  $$select steps_you_are_working_on, payments_due_cents > 0
      from public.dashboard_snapshot('e9120000-0000-0000-0000-00000000000b')$$,
  $$values (0, true)$$,
  'nor the brand''s "the factory is working on it": the brand owes it'
);

select public.run_daily_notifications();

select results_eq(
  $$select org_id::text, subject_type, subject_id from public.notifications where kind = 'milestone_due_soon'
     and order_id = (select order_id from p21_order)$$,
  $$select 'e9120000-0000-0000-0000-00000000000b', 'payment',
           (select id from public.order_payments where milestone_id = first_step) from p21_order$$,
  'three days before, the brand is reminded to fund it, linked to its payment page, and only about that step'
);

select is(
  (select count(*)::int from public.notifications where kind = 'milestone_due_soon'
     and org_id = 'e9120000-0000-0000-0000-0000000000f1'),
  0, 'the factory hears nothing about a step it cannot start'
);

select is(
  (select data ->> 'due_on' from public.notifications where kind = 'milestone_due_soon'
     and order_id = (select order_id from p21_order)),
  (current_date + 3)::text, 'the due date travels as data'
);

select public.run_daily_notifications();
select is(
  (select count(*)::int from public.notifications where kind = 'milestone_due_soon'
     and order_id = (select order_id from p21_order)),
  1, 'running again the same day sends nothing new'
);

-- Stripe is still confirming the payment: nobody can move the step.
update public.order_payments set state = 'processing', processing_at = now()
 where milestone_id = (select first_step from p21_order);
update public.order_milestones set due_on = current_date + 1 where id = (select first_step from p21_order);
select public.run_daily_notifications();
select is(
  (select count(*)::int from public.notifications where kind = 'milestone_due_soon'
     and order_id = (select order_id from p21_order)),
  1, 'a payment Stripe is still confirming reminds nobody'
);

-- Funded: now it is the factory's work.
update public.order_payments set state = 'confirmed', confirmed_at = now()
 where milestone_id = (select first_step from p21_order);
select results_eq(
  $$select steps_awaiting_you from public.dashboard_snapshot('e9120000-0000-0000-0000-0000000000f1')
    union all
    select steps_you_are_working_on from public.dashboard_snapshot('e9120000-0000-0000-0000-00000000000b')$$,
  $$values (1), (1)$$,
  'once funded, the step needs the factory''s update, on both dashboards'
);
select public.run_daily_notifications();
select results_eq(
  $$select subject_type, subject_id, body like '%needs an update%' from public.notifications
     where kind = 'milestone_due_soon' and org_id = 'e9120000-0000-0000-0000-0000000000f1'$$,
  $$select 'milestone', first_step, true from p21_order$$,
  'the day before, the factory hears about the funded step it is working on'
);

update public.order_milestones set state = 'submitted', due_on = current_date + 2
 where id = (select first_step from p21_order);
select public.run_daily_notifications();
select is(
  (select count(*)::int from public.notifications where kind = 'milestone_due_soon'
     and order_id = (select order_id from p21_order) and org_id = 'e9120000-0000-0000-0000-00000000000b'
     and subject_type = 'milestone'),
  1, 'a step waiting for approval reminds the brand, the side that acts'
);

select is(
  (select count(*)::int from public.notification_email_outbox o
     join public.notifications n on n.id = o.notification_id
    where n.kind = 'milestone_due_soon' and n.order_id = (select order_id from p21_order)),
  3, 'each is queued for email under the payment and approval switch'
);

select is(
  (select count(*)::int from public.notification_reminders
    where org_id = any ((select orgs from p21_ids)::uuid[])),
  7, 'every reminder that went out is recorded once (two matches, two capacity, three due-soon)'
);

-- A refund asks the brand to pay again; it is emailed like a failed payment.
select is(public.notification_email_category('payment_refunded'), 'payments',
  'a refund is emailed under the payment and approval switch');

-- ---------------------------------------------------------------------------
-- The bell updates live, and only with the reader's own rows
-- ---------------------------------------------------------------------------
-- Realtime sends a change only to a subscriber who could SELECT the row, so
-- the read policy is what keeps one company's bell out of another's.

select ok(
  exists (select 1 from pg_publication_tables
           where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'),
  'notifications are published to Realtime'
);

set local request.jwt.claims = '{"sub":"e9110000-0000-0000-0000-000000000003","role":"authenticated"}';
set local role authenticated;
select is(
  (select count(*)::int from public.notifications
    where org_id in ('e9120000-0000-0000-0000-0000000000f1', 'e9120000-0000-0000-0000-00000000000b')),
  0, 'another company CANNOT read a factory''s or a brand''s notifications, so Realtime never sends them'
);
reset role;

set local request.jwt.claims = '{"sub":"e9110000-0000-0000-0000-000000000002","role":"authenticated"}';
set local role authenticated;
select is(
  (select count(*)::int from public.notifications where org_id <> 'e9120000-0000-0000-0000-0000000000f1'),
  0, 'and a member reads its own company''s rows only'
);
reset role;

-- ---------------------------------------------------------------------------
-- The sender and the bell read the data
-- ---------------------------------------------------------------------------

select ok(
  (select 'data' = any (proargnames) from pg_proc where proname = 'claim_notification_emails'),
  'the sender is handed each notification''s data'
);

select ok(
  (select pg_get_functiondef(p.oid) like '%starts_at%' from pg_proc p where proname = 'notify_call'),
  'call notifications carry the call''s start time'
);

select * from finish();
rollback;
