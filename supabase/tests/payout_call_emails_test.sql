begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users (id, email) values
  ('ca110000-0000-0000-0000-000000000001', 'p19-brand@example.com'),
  ('ca110000-0000-0000-0000-000000000003', 'p19-factory@example.com'),
  ('ca110000-0000-0000-0000-000000000004', 'p19-outsider@example.com');

insert into public.orgs (id, type, name, slug) values
  ('ca120000-0000-0000-0000-00000000000b', 'brand',   'P19 Brand',    'pgtap19-brand'),
  ('ca120000-0000-0000-0000-0000000000f1', 'factory', 'P19 Factory',  'pgtap19-factory'),
  ('ca120000-0000-0000-0000-00000000000c', 'brand',   'P19 Outsider', 'pgtap19-outsider');

insert into public.org_members (org_id, user_id, role) values
  ('ca120000-0000-0000-0000-00000000000b', 'ca110000-0000-0000-0000-000000000001', 'owner'),
  ('ca120000-0000-0000-0000-0000000000f1', 'ca110000-0000-0000-0000-000000000003', 'owner'),
  ('ca120000-0000-0000-0000-00000000000c', 'ca110000-0000-0000-0000-000000000004', 'owner');

insert into public.factory_profiles (org_id, country_code, moq, published_at, verification_status) values
  ('ca120000-0000-0000-0000-0000000000f1', 'CN', 100, now(), 'verified');

insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total) values
  ('ca130000-0000-0000-0000-000000000001', 'ca120000-0000-0000-0000-00000000000b', 'P19 shirts', 'open', 'open_to_all', 100);

insert into public.message_threads (id, rfq_id, brand_org_id, factory_org_id) values
  ('ca140000-0000-0000-0000-000000000001', 'ca130000-0000-0000-0000-000000000001',
   'ca120000-0000-0000-0000-00000000000b', 'ca120000-0000-0000-0000-0000000000f1');


select is(public.notification_email_category('call_reminder'), 'calls', 'reminder has a separate calls setting');
select is(public.notification_email_category('milestone_submitted'), 'orders', 'milestones no longer use payment setting');
select is(public.notification_email_category('capacity_reminder'), 'capacity', 'capacity separate from RFQs');
select is(public.notification_email_category('payout_failed'), 'account', 'payout failures are mandatory');
select is(public.notification_email_category('payout_action_required'), 'account', 'required actions are mandatory');
select ok(not has_function_privilege('authenticated','public.queue_upcoming_call_reminders()','execute'), 'members cannot run scheduler');
select ok(not has_function_privilege('anon','public.notify_stripe_payout_failed(text,text,bigint,text)','execute'), 'anonymous cannot forge payout failures');

insert into public.calls (id,thread_id,title,starts_at,status,proposer_org_id,proposer_user_id)
select ('ca150000-0000-0000-0000-00000000000' || n)::uuid, 'ca140000-0000-0000-0000-000000000001',
  'Reminder test ' || n, now() + case n when 3 then interval '2 hours' when 4 then interval '-1 minute' else interval '55 minutes' end,
  case n when 2 then 'proposed'::public.call_status when 5 then 'cancelled'::public.call_status else 'accepted'::public.call_status end,
  'ca120000-0000-0000-0000-00000000000b','ca110000-0000-0000-0000-000000000001'
from generate_series(1,5) n;
select public.queue_upcoming_call_reminders();
select is((select count(*)::int from public.notifications where kind='call_reminder' and subject_id='ca140000-0000-0000-0000-000000000001'),2,'accepted upcoming call reminds both parties only');
select is((select count(*)::int from public.notification_email_outbox o join public.notifications n on n.id=o.notification_id where n.kind='call_reminder' and n.subject_id='ca140000-0000-0000-0000-000000000001'),2,'both companies get queued email');
select public.queue_upcoming_call_reminders();
select is((select count(*)::int from public.notifications where kind='call_reminder' and subject_id='ca140000-0000-0000-0000-000000000001'),2,'repeat job creates no duplicate');
update public.calls set status='cancelled' where id='ca150000-0000-0000-0000-000000000001';
select * from public.claim_notification_emails(100);
select is((select count(*)::int from public.notification_email_outbox o join public.notifications n on n.id=o.notification_id where n.kind='call_reminder' and n.subject_id='ca140000-0000-0000-0000-000000000001' and o.status='skipped'),2,'cancelled calls skipped at delivery');

select set_config('request.jwt.claims','{"sub":"ca110000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.set_notification_preference('ca120000-0000-0000-0000-00000000000b','calls',false)$$,'brand may switch off call email');
select lives_ok($$select public.set_notification_preference('ca120000-0000-0000-0000-00000000000b','orders',false)$$,'brand may switch off order email');
select throws_ok($$select public.set_notification_preference('ca120000-0000-0000-0000-00000000000b','account',false)$$,'22023',null,'mandatory emails cannot be disabled');
reset role;
select ok(not public.notification_email_enabled('ca120000-0000-0000-0000-00000000000b','calls'),'brand call setting off');
select ok(public.notification_email_enabled('ca120000-0000-0000-0000-00000000000b','messages'),'message setting independent');
select ok(public.notification_email_enabled('ca120000-0000-0000-0000-00000000000b','payments'),'payment setting independent of orders');
select ok(public.notification_email_enabled('ca120000-0000-0000-0000-00000000000b','account'),'mandatory email always enabled');
select set_config('request.jwt.claims','{"sub":"ca110000-0000-0000-0000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.set_notification_preference('ca120000-0000-0000-0000-0000000000f1','capacity',false)$$,'factory can disable capacity emails separately');
select lives_ok($$select public.set_notification_preference('ca120000-0000-0000-0000-0000000000f1','calls',false)$$,'factory can disable calls');
reset role;
update public.calls set status='accepted', starts_at=now()+interval '40 minutes' where id='ca150000-0000-0000-0000-000000000003';
select public.queue_upcoming_call_reminders();
select is((select count(*)::int from public.notification_email_outbox o join public.notifications n on n.id=o.notification_id where n.kind='call_reminder' and n.data->>'call_id'='ca150000-0000-0000-0000-000000000003'),0,'both switches suppress email');
select is((select count(*)::int from public.notifications where kind='call_reminder' and data->>'call_id'='ca150000-0000-0000-0000-000000000003'),2,'in-app notifications remain on');

insert into public.stripe_connect_accounts(org_id,stripe_account_id,country) values ('ca120000-0000-0000-0000-0000000000f1','acct_email_test','US');
select public.notify_stripe_payout_failed('acct_email_test','po_email_test',10000,'USD');
select public.notify_stripe_payout_failed('acct_email_test','po_email_test',10000,'USD');
select is((select count(*)::int from public.notifications where data->>'stripe_payout_id'='po_email_test'),1,'duplicate Stripe failure deduplicated');
select is((select count(*)::int from public.notification_email_outbox o join public.notifications n on n.id=o.notification_id where n.data->>'stripe_payout_id'='po_email_test'),1,'mandatory payout failure queued despite settings');
select public.notify_stripe_payout_failed('acct_unknown','po_unknown',10000,'USD');
select is((select count(*)::int from public.notifications where data->>'stripe_payout_id'='po_unknown'),0,'unknown Stripe account gets no notice');
set local session_replication_role = replica;

insert into auth.users (id, email) values
  ('78a00000-0000-0000-0000-000000000001', 'p78-factory@example.com'),
  ('78a00000-0000-0000-0000-000000000003', 'p78-brand@example.com'),
  ('78a00000-0000-0000-0000-000000000004', 'p78-stranger@example.com'),
  ('78a00000-0000-0000-0000-000000000005', 'p78-staff@example.com'),
  ('78a00000-0000-0000-0000-000000000006', 'p78-staff-in-factory@example.com'),
  ('78a00000-0000-0000-0000-000000000007', 'p78-staff-in-brand@example.com');

insert into public.platform_admins (user_id, note) values
  ('78a00000-0000-0000-0000-000000000005', 'pgtap78'),
  ('78a00000-0000-0000-0000-000000000006', 'pgtap78'),
  ('78a00000-0000-0000-0000-000000000007', 'pgtap78');

insert into public.orgs (id, type, name, slug) values
  ('78b00000-0000-0000-0000-00000000000b', 'brand',   'P78 Brand', 'pgtap78-brand'),
  ('78b00000-0000-0000-0000-0000000000f1', 'factory', 'P78 Mill',  'pgtap78-mill');

insert into public.org_members (org_id, user_id, role, permissions) values
  ('78b00000-0000-0000-0000-0000000000f1', '78a00000-0000-0000-0000-000000000001', 'owner', '{}'),
  ('78b00000-0000-0000-0000-0000000000f1', '78a00000-0000-0000-0000-000000000006', 'member', '{}'),
  ('78b00000-0000-0000-0000-00000000000b', '78a00000-0000-0000-0000-000000000003', 'owner', '{}'),
  ('78b00000-0000-0000-0000-00000000000b', '78a00000-0000-0000-0000-000000000007', 'member', '{}');

insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total)
values ('78c00000-0000-0000-0000-000000000001', '78b00000-0000-0000-0000-00000000000b', 'P78 request', 'awarded', 'invited_only', 100);
insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity, submitted_at)
values ('78c00000-0000-0000-0000-000000000002', '78c00000-0000-0000-0000-000000000001', '78b00000-0000-0000-0000-0000000000f1', 'accepted', 100, 1, now());
insert into public.production_orders
  (id, rfq_id, quote_id, brand_org_id, factory_org_id, unit_price_cents,
   production_quantity, bulk_subtotal_cents, sample_subtotal_cents, order_total_cents, deposit_pct, balance_pct, order_number)
values ('78d00000-0000-0000-0000-000000000001', '78c00000-0000-0000-0000-000000000001', '78c00000-0000-0000-0000-000000000002',
        '78b00000-0000-0000-0000-00000000000b', '78b00000-0000-0000-0000-0000000000f1', 1000, 1, 1000, 0, 1000, 50, 50, 'P78-1');
insert into public.order_milestones (id, order_id, kind, title, amount_cents)
select ('78e00000-0000-0000-0000-00000000000' || n)::uuid, '78d00000-0000-0000-0000-000000000001', 'payment_only', 'P78 step ' || n, 100000
  from generate_series(1, 4) n;
insert into public.order_payments (id, order_id, milestone_id, amount_cents, currency, state, confirmed_at, release_requested_at)
select ('78f00000-0000-0000-0000-00000000000' || n)::uuid, '78d00000-0000-0000-0000-000000000001',
       ('78e00000-0000-0000-0000-00000000000' || n)::uuid, 100000, 'USD', 'confirmed', now(),
       case when n = 4 then null else now() end
  from generate_series(1, 4) n;

insert into public.factory_payout_accounts
  (id, org_id, method, bank_name, account_name, account_number_last4, swift, bank_country, is_primary,
   wise_recipient_type, wise_currency, wise_number_key, wise_details, details_changed_at)
values ('78a10000-0000-0000-0000-000000000001', '78b00000-0000-0000-0000-0000000000f1', 'bank', 'Demo Bank', 'P78 MILL LTD', '1234', 'BOSHCNSH', 'CN', true,
        'chinese_local_business', 'CNY', 'accountNumber', '{"accountHolderName":"P78 MILL LTD"}', '2026-11-01 00:00:00+00');

set local session_replication_role = origin;


-- Populate mail recipients (the payout fixture intentionally skipped signup triggers).
insert into public.user_profiles(id,email) values ('78a00000-0000-0000-0000-000000000001','p78-factory@example.com') on conflict do nothing;
insert into public.provider_payouts(id,payment_id,factory_org_id,provider,paid_to,amount_cents,currency)
values ('78a20000-0000-0000-0000-000000000001','78f00000-0000-0000-0000-000000000001','78b00000-0000-0000-0000-0000000000f1','wise','Demo Bank ending 1234',100000,'USD');
insert into public.provider_payout_attempts(payout_id) values ('78a20000-0000-0000-0000-000000000001');
select public.record_provider_attempt('78a20000-0000-0000-0000-000000000001',tell_factory=>'Check your bank details');
select public.record_provider_attempt('78a20000-0000-0000-0000-000000000001',tell_factory=>'Check your bank details');
select is((select count(*)::int from public.notifications where org_id='78b00000-0000-0000-0000-0000000000f1' and kind='payout_action_required'),1,'details action emailed once per attempt');
select public.finish_provider_payout('78a20000-0000-0000-0000-000000000001','failed',failure=>'other');
select public.finish_provider_payout('78a20000-0000-0000-0000-000000000001','failed',failure=>'other');
select is((select count(*)::int from public.notifications where org_id='78b00000-0000-0000-0000-0000000000f1' and kind='payout_failed'),1,'generic failure sends once without a details fix');
select is((select count(*)::int from public.notification_email_outbox o join public.notifications n on n.id=o.notification_id where n.org_id='78b00000-0000-0000-0000-0000000000f1' and n.kind in ('payout_failed','payout_action_required')),2,'both provider notices queued');
select * from finish();
rollback;
