-- ============================================================================
-- Every email and its switch (20261115400000_email_category_map.sql)
-- ----------------------------------------------------------------------------
-- `pgtapb4-` prefixed, ids `b4…`, every count scoped to its own fixtures.
--
-- The written map is pinned kind by kind; each of the three switches, off,
-- queues no email while the bell still gets the notification; the anti-fraud
-- alert ignores the switches; the factory's update on a step the brand
-- approves is an approval request; and only someone with Settings access at
-- that company changes its switches (the two-hat member included).
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(34);

insert into auth.users (id, email) values
  ('b4110000-0000-0000-0000-000000000001', 'pb4-brand-owner@example.com'),
  ('b4110000-0000-0000-0000-000000000002', 'pb4-brand-member@example.com'),
  ('b4110000-0000-0000-0000-000000000003', 'pb4-factory@example.com'),
  ('b4110000-0000-0000-0000-000000000004', 'pb4-outsider@example.com'),
  ('b4110000-0000-0000-0000-000000000005', 'pb4-two-hats@example.com');

insert into public.orgs (id, type, name, slug) values
  ('b4120000-0000-0000-0000-00000000000b', 'brand',   'PB4 Brand',    'pgtapb4-brand'),
  ('b4120000-0000-0000-0000-0000000000f1', 'factory', 'PB4 Factory',  'pgtapb4-factory'),
  ('b4120000-0000-0000-0000-00000000000c', 'brand',   'PB4 Outsider', 'pgtapb4-outsider');

insert into public.org_members (org_id, user_id, role, permissions) values
  ('b4120000-0000-0000-0000-00000000000b', 'b4110000-0000-0000-0000-000000000001', 'owner', null),
  -- No Settings access: may approve and run requests, not change Settings.
  ('b4120000-0000-0000-0000-00000000000b', 'b4110000-0000-0000-0000-000000000002', 'member', '{approve,rfqFlow}'),
  ('b4120000-0000-0000-0000-0000000000f1', 'b4110000-0000-0000-0000-000000000003', 'owner', null),
  ('b4120000-0000-0000-0000-00000000000c', 'b4110000-0000-0000-0000-000000000004', 'owner', null),
  -- Two hats: owner of the outsider, a member without Settings access at the brand.
  ('b4120000-0000-0000-0000-00000000000c', 'b4110000-0000-0000-0000-000000000005', 'owner', null),
  ('b4120000-0000-0000-0000-00000000000b', 'b4110000-0000-0000-0000-000000000005', 'member', '{approve}');

insert into public.factory_profiles (org_id, country_code, moq, published_at, verification_status) values
  ('b4120000-0000-0000-0000-0000000000f1', 'PT', 100, now(), 'verified');

-- ---------------------------------------------------------------------------
-- The map, kind by kind
-- ---------------------------------------------------------------------------

select is_empty(
  $$select kind, expected, public.notification_email_category(kind)
      from (values
        ('rfq_invited', 'rfq'), ('rfq_matched', 'rfq'), ('rfq_cancelled', 'rfq'),
        ('capacity_reminder', 'rfq'), ('quote_accepted', 'rfq'), ('quote_declined', 'rfq'),
        ('quote_received', 'rfq'), ('quote_withdrawn', 'rfq'),
        ('payment_due', 'payments'), ('payment_failed', 'payments'), ('payment_refunded', 'payments'),
        ('payment_confirmed', 'payments'), ('payment_sent', 'payments'), ('payment_rejected', 'payments'),
        ('funds_released', 'payments'), ('milestone_submitted', 'payments'), ('milestone_approved', 'payments'),
        ('milestone_dispute', 'payments'), ('milestone_reminder', 'payments'), ('milestone_due_soon', 'payments'),
        ('schedule_updated', 'payments'), ('schedule_agreed', 'payments'),
        ('order_created', 'payments'), ('order_activated', 'payments'), ('order_completed', 'payments'),
        ('order_cancelled', 'payments'), ('cancellation_proposed', 'payments'),
        ('cancellation_withdrawn', 'payments'), ('cancellation_declined', 'payments'),
        ('message', 'messages'), ('call_proposed', 'messages'), ('call_accepted', 'messages'),
        ('call_declined', 'messages'), ('call_countered', 'messages'), ('call_cancelled', 'messages'),
        ('payout_method_changed', 'account')
      ) as map(kind, expected)
     where public.notification_email_category(kind) is distinct from expected$$,
  'every emailed kind has the switch the written map gives it'
);

select is_empty(
  $$select kind from (values
        ('payment_processing'), ('message_rejected'), ('milestone_update'),
        ('verification_approved'), ('verification_declined'), ('verification_needs_information'),
        ('verification_reopened'), ('credits_granted'), ('credits_adjusted'),
        ('referral_joined'), ('referral_rewarded'),
        ('team_member_joined'), ('team_member_left'), ('team_member_removed'),
        ('matching_evidence_approved'), ('matching_evidence_rejected'),
        ('matching_evidence_needs_information')
      ) as map(kind)
     where public.notification_email_category(kind) is not null$$,
  'the bell-only kinds have no switch, so no email'
);

-- ---------------------------------------------------------------------------
-- Who changes the switches
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"b4110000-0000-0000-0000-000000000002","role":"authenticated"}';
set local role authenticated;

select is(
  (select count(*)::int from public.notification_preferences where org_id = 'b4120000-0000-0000-0000-00000000000b'),
  0, 'a member reads the company''s switches (none saved yet: all on)'
);
select throws_ok(
  $$select public.set_notification_preference('b4120000-0000-0000-0000-00000000000b', 'messages', false)$$,
  '42501', null, 'a member without Settings access cannot change them'
);

set local request.jwt.claims = '{"sub":"b4110000-0000-0000-0000-000000000005","role":"authenticated"}';

select throws_ok(
  $$select public.set_notification_preference('b4120000-0000-0000-0000-00000000000b', 'messages', false)$$,
  '42501', null, 'nor can someone who owns another company and has no Settings access here'
);
select lives_ok(
  $$select public.set_notification_preference('b4120000-0000-0000-0000-00000000000c', 'messages', false)$$,
  'who still changes their own company''s'
);

set local request.jwt.claims = '{"sub":"b4110000-0000-0000-0000-000000000003","role":"authenticated"}';

select throws_ok(
  $$select public.set_notification_preference('b4120000-0000-0000-0000-00000000000b', 'rfq', false)$$,
  '42501', null, 'the factory on the brand''s order cannot change the brand''s switches'
);
select throws_ok(
  $$select public.set_notification_preference('b4120000-0000-0000-0000-00000000000b', 'account', false)$$,
  '42501', null, 'nor the always-sent one'
);

set local request.jwt.claims = '{"sub":"b4110000-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok(
  $$select public.set_notification_preference('b4120000-0000-0000-0000-00000000000b', 'account', false)$$,
  '22023', null, 'the owner cannot switch off the always-sent emails: there is no such switch'
);
select lives_ok(
  $$select public.set_notification_preference('b4120000-0000-0000-0000-00000000000b', 'rfq', false)$$,
  'the owner turns quote emails off'
);
select lives_ok(
  $$select public.set_notification_preference('b4120000-0000-0000-0000-00000000000b', 'payments', false)$$,
  'and payment emails'
);
select lives_ok(
  $$select public.set_notification_preference('b4120000-0000-0000-0000-00000000000b', 'messages', false)$$,
  'and message emails'
);
select results_eq(
  $$select rfq_emails, payment_emails, message_emails from public.notification_preferences
     where org_id = 'b4120000-0000-0000-0000-00000000000b'$$,
  $$values (false, false, false)$$,
  'all three are saved off'
);
reset role;

select results_eq(
  $$select rfq_emails, payment_emails, message_emails from public.notification_preferences
     where org_id = 'b4120000-0000-0000-0000-00000000000c'$$,
  $$values (true, true, false)$$,
  'and the other company keeps its own'
);

-- ---------------------------------------------------------------------------
-- Off: the bell, no email. On: the email.
-- ---------------------------------------------------------------------------

insert into public.notifications (id, org_id, kind, subject_type, subject_id, title) values
  ('b4140000-0000-0000-0000-000000000001', 'b4120000-0000-0000-0000-00000000000b', 'quote_received', 'rfq', 'b4130000-0000-0000-0000-0000000000a1', 'PB4 quote'),
  ('b4140000-0000-0000-0000-000000000002', 'b4120000-0000-0000-0000-00000000000b', 'payment_due', 'payment', 'b4130000-0000-0000-0000-0000000000a2', 'PB4 fund'),
  ('b4140000-0000-0000-0000-000000000003', 'b4120000-0000-0000-0000-00000000000b', 'message', 'thread', 'b4130000-0000-0000-0000-0000000000a3', 'PB4 message'),
  ('b4140000-0000-0000-0000-000000000004', 'b4120000-0000-0000-0000-00000000000b', 'call_proposed', 'thread', 'b4130000-0000-0000-0000-0000000000a3', 'PB4 call'),
  ('b4140000-0000-0000-0000-000000000005', 'b4120000-0000-0000-0000-00000000000b', 'payout_method_changed', null, null, 'PB4 payout');

select is(
  (select count(*)::int from public.notifications where id::text like 'b4140000-0000-0000-0000-00000000000_'),
  5, 'the bell has every notification, whatever the switches say'
);
select is(
  (select count(*)::int from public.notification_email_outbox where notification_id = 'b4140000-0000-0000-0000-000000000001'),
  0, 'quote emails off: a quote received is not emailed'
);
select is(
  (select count(*)::int from public.notification_email_outbox where notification_id = 'b4140000-0000-0000-0000-000000000002'),
  0, 'payment emails off: a payment due is not emailed'
);
select is(
  (select count(*)::int from public.notification_email_outbox where notification_id = 'b4140000-0000-0000-0000-000000000003'),
  0, 'message emails off: a message is not emailed'
);
select is(
  (select count(*)::int from public.notification_email_outbox where notification_id = 'b4140000-0000-0000-0000-000000000004'),
  0, 'nor a call invite'
);
select is(
  (select count(*)::int from public.notification_email_outbox where notification_id = 'b4140000-0000-0000-0000-000000000005'),
  3, 'a payout change reaches every member, all switches off'
);

-- The factory never touched its switches: all on.
insert into public.notifications (id, org_id, kind, subject_type, subject_id, title) values
  ('b4140000-0000-0000-0000-000000000011', 'b4120000-0000-0000-0000-0000000000f1', 'rfq_invited', 'rfq', 'b4130000-0000-0000-0000-0000000000b1', 'PB4 invited'),
  ('b4140000-0000-0000-0000-000000000012', 'b4120000-0000-0000-0000-0000000000f1', 'quote_declined', 'rfq', 'b4130000-0000-0000-0000-0000000000b2', 'PB4 not selected'),
  ('b4140000-0000-0000-0000-000000000013', 'b4120000-0000-0000-0000-0000000000f1', 'funds_released', 'payment', 'b4130000-0000-0000-0000-0000000000b3', 'PB4 released'),
  ('b4140000-0000-0000-0000-000000000014', 'b4120000-0000-0000-0000-0000000000f1', 'call_accepted', 'thread', 'b4130000-0000-0000-0000-0000000000b4', 'PB4 call'),
  ('b4140000-0000-0000-0000-000000000015', 'b4120000-0000-0000-0000-0000000000f1', 'credits_granted', 'credits', null, 'PB4 credits');

select results_eq(
  $$select n.kind, o.category from public.notification_email_outbox o
      join public.notifications n on n.id = o.notification_id
     where o.org_id = 'b4120000-0000-0000-0000-0000000000f1'
     order by n.kind$$,
  $$values ('call_accepted'::text, 'messages'::text), ('funds_released', 'payments'),
           ('quote_declined', 'rfq'), ('rfq_invited', 'rfq')$$,
  'with every switch on, each kind is emailed under its switch, and a bell-only kind is not'
);

-- A switch turned off after the email was queued still stops it.
set local request.jwt.claims = '{"sub":"b4110000-0000-0000-0000-000000000003","role":"authenticated"}';
set local role authenticated;
select lives_ok(
  $$select public.set_notification_preference('b4120000-0000-0000-0000-0000000000f1', 'rfq', false)$$,
  'the factory turns request emails off'
);
reset role;

update public.notification_email_outbox
   set next_attempt_at = now() + interval '1 day'
 where org_id <> 'b4120000-0000-0000-0000-0000000000f1' and status = 'pending';

set local role service_role;
create temporary table pb4_claimed on commit drop as
  select * from public.claim_notification_emails(100);
reset role;

select results_eq(
  $$select kind from pb4_claimed where org_id = 'b4120000-0000-0000-0000-0000000000f1' order by kind$$,
  $$values ('call_accepted'::text), ('funds_released')$$,
  'the sender sends what is still switched on'
);
select is(
  (select count(*)::int from public.notification_email_outbox
    where org_id = 'b4120000-0000-0000-0000-0000000000f1' and category = 'rfq' and status = 'skipped'),
  2, 'and skips the request emails switched off since'
);

-- ---------------------------------------------------------------------------
-- An update on a step: an approval request only when it asks for one
-- ---------------------------------------------------------------------------

insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total) values
  ('b4130000-0000-0000-0000-000000000001', 'b4120000-0000-0000-0000-00000000000b', 'PB4 order',
   'open', 'invited_only', 100);
insert into public.quotes
  (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity,
   bulk_lead_time_days, deposit_pct, balance_pct, valid_until, submitted_at)
values
  ('b4150000-0000-0000-0000-000000000001', 'b4130000-0000-0000-0000-000000000001',
   'b4120000-0000-0000-0000-0000000000f1', 'submitted', 2000, 100, 28, 30, 70, current_date + 30, now());

set local request.jwt.claims = '{"sub":"b4110000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select public.award_quote('b4150000-0000-0000-0000-000000000001');
reset role;

create temporary table pb4_step as
select (select id from public.order_milestones m where m.order_id = o.id order by sort limit 1) as step,
       o.id as order_id
  from public.production_orders o
 where o.quote_id = 'b4150000-0000-0000-0000-000000000001';

update public.order_milestones set kind = 'approval_and_payment', state = 'active'
 where id = (select step from pb4_step);

insert into public.notifications (id, org_id, kind, subject_type, subject_id, order_id, title)
select ids.id, ids.org, 'milestone_update', 'milestone', s.step, s.order_id, 'PB4 update'
  from pb4_step s,
       (values ('b4140000-0000-0000-0000-000000000021'::uuid, 'b4120000-0000-0000-0000-00000000000b'::uuid),
               ('b4140000-0000-0000-0000-000000000022'::uuid, 'b4120000-0000-0000-0000-0000000000f1'::uuid)) ids(id, org);

set local role service_role;
select is(
  (select public.notification_email_category_for(n) from public.notifications n where id = 'b4140000-0000-0000-0000-000000000021'),
  'payments', 'the factory''s update on a step the brand approves asks the brand to approve it'
);
select is(
  (select public.notification_email_category_for(n) from public.notifications n where id = 'b4140000-0000-0000-0000-000000000022'),
  null, 'the brand''s comment to the factory stays in the bell'
);
reset role;
select is(
  (select count(*)::int from public.notification_email_outbox where notification_id = 'b4140000-0000-0000-0000-000000000021'),
  0, 'and with the brand''s payment emails off, it is not emailed'
);

set local request.jwt.claims = '{"sub":"b4110000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select public.set_notification_preference('b4120000-0000-0000-0000-00000000000b', 'payments', true);
reset role;

insert into public.notifications (id, org_id, kind, subject_type, subject_id, order_id, title)
select 'b4140000-0000-0000-0000-000000000023', 'b4120000-0000-0000-0000-00000000000b', 'milestone_update', 'milestone', step, order_id, 'PB4 update 2'
  from pb4_step;
select results_eq(
  $$select category, count(*)::int from public.notification_email_outbox
     where notification_id = 'b4140000-0000-0000-0000-000000000023' group by category$$,
  $$values ('payments'::text, 3)$$,
  'switched back on, the approval request is emailed to every member'
);

update public.order_milestones set kind = 'payment_only' where id = (select step from pb4_step);
insert into public.notifications (id, org_id, kind, subject_type, subject_id, order_id, title)
select 'b4140000-0000-0000-0000-000000000024', 'b4120000-0000-0000-0000-00000000000b', 'milestone_update', 'milestone', step, order_id, 'PB4 update 3'
  from pb4_step;
select is(
  (select count(*)::int from public.notification_email_outbox where notification_id = 'b4140000-0000-0000-0000-000000000024'),
  0, 'an update on a step with nothing to approve stays in the bell'
);

update public.order_milestones set kind = 'approval_and_payment', state = 'complete', completed_at = now() where id = (select step from pb4_step);
insert into public.notifications (id, org_id, kind, subject_type, subject_id, order_id, title)
select 'b4140000-0000-0000-0000-000000000025', 'b4120000-0000-0000-0000-00000000000b', 'milestone_update', 'milestone', step, order_id, 'PB4 update 4'
  from pb4_step;
select is(
  (select count(*)::int from public.notification_email_outbox where notification_id = 'b4140000-0000-0000-0000-000000000025'),
  0, 'nor one on a step already approved'
);

-- ---------------------------------------------------------------------------
-- Nobody in a browser decides a category
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"b4110000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$select public.notification_email_category_for(n) from public.notifications n limit 1$$,
  '42501', null, 'a signed-in user cannot run the category lookup, which reads orders'
);
select throws_ok(
  $$select count(*) from public.notification_email_outbox$$,
  '42501', null, 'nor read the queue'
);
reset role;
set local role anon;
select throws_ok(
  $$select public.set_notification_preference('b4120000-0000-0000-0000-00000000000b', 'rfq', true)$$,
  '42501', null, 'a signed-out visitor changes nothing'
);
reset role;

-- A queueing failure never stops the notification.
select lives_ok(
  $$insert into public.notifications (org_id, kind, subject_type, subject_id, title)
    values ('b4120000-0000-0000-0000-00000000000b', 'milestone_update', 'milestone', 'b4130000-0000-0000-0000-0000000000ff', 'PB4 missing step')$$,
  'an update about a step that does not exist is still written'
);

select * from finish();

rollback;
