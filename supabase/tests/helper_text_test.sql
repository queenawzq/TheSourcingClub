begin;
create extension if not exists pgtap with schema extensions;
select plan(13);
insert into auth.users (id, email, raw_user_meta_data) values
  ('ca800000-0000-0000-0000-000000000001', 'helper-brandowner@example.com',  '{"name":"Brand Owner"}'),
  ('ca800000-0000-0000-0000-000000000002', 'helper-brandmember@example.com', '{"name":"Brand Member"}'),
  ('ca800000-0000-0000-0000-000000000003', 'helper-f1@example.com',          '{"name":"Factory One"}'),
  ('ca800000-0000-0000-0000-000000000004', 'helper-f2@example.com',          '{"name":"Factory Two"}'),
  ('ca800000-0000-0000-0000-000000000005', 'helper-admin@example.com',       '{"name":"Staff"}'),
  ('ca800000-0000-0000-0000-000000000006', 'helper-outsider@example.com',    '{"name":"Outsider"}');

insert into public.platform_admins (user_id, note)
values ('ca800000-0000-0000-0000-000000000005', 'pgtap3 fixture');

insert into public.orgs (id, type, name, slug) values
  ('da800000-0000-0000-0000-00000000000b', 'brand',   'P3 Brand',     'pgtap-helper-brand'),
  ('da800000-0000-0000-0000-0000000000f1', 'factory', 'P3 Factory 1', 'pgtap-helper-factory-1'),
  ('da800000-0000-0000-0000-0000000000f2', 'factory', 'P3 Factory 2', 'pgtap-helper-factory-2'),
  ('da800000-0000-0000-0000-00000000000c', 'brand',   'P3 Outsider',  'pgtap-helper-outsider');

insert into public.org_members (org_id, user_id, role) values
  ('da800000-0000-0000-0000-00000000000b', 'ca800000-0000-0000-0000-000000000001', 'owner'),
  ('da800000-0000-0000-0000-00000000000b', 'ca800000-0000-0000-0000-000000000002', 'member'),
  ('da800000-0000-0000-0000-0000000000f1', 'ca800000-0000-0000-0000-000000000003', 'owner'),
  ('da800000-0000-0000-0000-0000000000f2', 'ca800000-0000-0000-0000-000000000004', 'owner'),
  ('da800000-0000-0000-0000-00000000000c', 'ca800000-0000-0000-0000-000000000006', 'owner');

insert into public.brand_profiles (org_id, hq_location) values
  ('da800000-0000-0000-0000-00000000000b', 'London, UK'),
  ('da800000-0000-0000-0000-00000000000c', 'Berlin, DE');

insert into public.factory_profiles (org_id, country_code, moq, published_at, verification_status) values
  ('da800000-0000-0000-0000-0000000000f1', 'PT', 100, now(), 'verified'),
  ('da800000-0000-0000-0000-0000000000f2', 'CN', 100, now(), 'verified');

insert into public.factory_payout_accounts (org_id, bank_name, account_number_last4, is_primary)
values ('da800000-0000-0000-0000-0000000000f1', 'Banco de Porto', '4417', true);

insert into public.rfqs (id, brand_org_id, title, brief, status, visibility, quantity_total) values
  ('ea800000-0000-0000-0000-000000000001', 'da800000-0000-0000-0000-00000000000b',
   'P3 shirts', 'Three hundred organic cotton shirts.', 'open', 'open_to_all', 100);

-- Two competing quotes. Unit price 100.01 x 1 unit is deliberate: a 50/50
-- split of 10001 cents cannot be halved evenly, which is what assertion 40
-- turns on.
insert into public.quotes
  (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity,
   bulk_lead_time_days, deposit_pct, balance_pct, valid_until, submitted_at)
values
  ('fa800000-0000-0000-0000-0000000000f1', 'ea800000-0000-0000-0000-000000000001',
   'da800000-0000-0000-0000-0000000000f1', 'submitted', 10001, 1, 28, 50, 50,
   current_date + 30, now()),
  ('fa800000-0000-0000-0000-0000000000f2', 'ea800000-0000-0000-0000-000000000001',
   'da800000-0000-0000-0000-0000000000f2', 'submitted', 9000, 1, 30, 30, 70,
   current_date + 30, now());

insert into public.quote_sample_lines (quote_id, stage, cost_cents, sort) values
  ('fa800000-0000-0000-0000-0000000000f1', 'Fit sample', 5000, 1),
  ('fa800000-0000-0000-0000-0000000000f1', 'PP sample',  7000, 2);

update public.quote_sample_lines set includes = 'Factory-authored sample scope' where quote_id = 'fa800000-0000-0000-0000-0000000000f1' and stage = 'PP sample';

-- Award it. This is the call that must create the order and its schedule.
reset role;
set local request.jwt.claims = '{"sub":"ca800000-0000-0000-0000-000000000001","email":"helper-brandowner@example.com","role":"authenticated"}';
set local role authenticated;
select public.award_quote('fa800000-0000-0000-0000-0000000000f1');

reset role;
create temporary table helper_order as
select id as order_id from public.production_orders
where quote_id = 'fa800000-0000-0000-0000-0000000000f1';
grant select on helper_order to public;

select is((select description from public.order_milestones where order_id = (select order_id from helper_order) and title = 'Fit sample'), 'Factory prepares this sample and posts photos for approval.', 'new sample gets its process explanation');
select is((select description from public.order_milestones where order_id = (select order_id from helper_order) and title = 'PP sample'), 'Factory-authored sample scope', 'factory-authored sample scope is preserved');
select matches((select description from public.order_milestones where order_id = (select order_id from helper_order) and title = 'Bulk deposit'), 'paid before bulk materials are bought[.]$', 'deposit explains why it is funded');
select is((select description from public.order_milestones where order_id = (select order_id from helper_order) and title = 'Bulk production'), 'Cutting and sewing. The factory quoted 28 days from approval.', 'production uses the quoted lead time');
select is((select description from public.order_milestones where order_id = (select order_id from helper_order) and title = 'QC photos'), 'The brand approves finished-goods photos before the balance falls due.', 'QC explains its approval consequence');
select is((select description from public.order_milestones where order_id = (select order_id from helper_order) and title = 'Final balance'), 'The remainder of the production total, once QC photos are approved.', 'balance explains its place in the schedule');
select is((select sum(amount_cents) from public.order_milestones where order_id = (select order_id from helper_order)), (select order_total_cents::numeric from public.production_orders where id = (select order_id from helper_order)), 'guidance does not change schedule amounts');
select ok(not has_function_privilege('authenticated', 'public.create_order_from_award(uuid)', 'execute'), 'the internal order generator remains inaccessible to authenticated callers');

-- The backfill of 20261108200527_restore_production_step_guidance.sql, run a
-- second time against legacy blank rows. Copied here because `supabase test db`
-- doesn't mount supabase/migrations, so \ir stopped this file after 8 of 13.
-- Keep it the same as that migration's last statement.
update public.order_milestones set description = null where order_id = (select order_id from helper_order) and title in ('Fit sample', 'Bulk deposit');
update public.order_milestones set description = 'Brand-authored production instructions' where order_id = (select order_id from helper_order) and title = 'Bulk production';
update public.order_milestones set title = 'Custom QC', description = null where order_id = (select order_id from helper_order) and title = 'QC photos';
update public.order_milestones set description = '' where order_id = (select order_id from helper_order) and title = 'Final balance';
update public.order_milestones m
   set description = case
     when m.source_sample_line_id is not null and m.kind = 'approval_and_payment'
       then 'Factory prepares this sample and posts photos for approval.'
     when m.sort = 1000 and m.kind = 'payment_only' and m.title = 'Bulk deposit'
       then format('%s%% of the production total, paid before bulk materials are bought.', o.deposit_pct)
     when m.sort = 1100 and m.kind = 'progress_only' and m.title = 'Bulk production'
       then case when o.bulk_lead_time_days is null then 'Cutting and sewing. Confirm the production lead time with the factory.'
                 else format('Cutting and sewing. The factory quoted %s days from approval.', o.bulk_lead_time_days) end
     when m.sort = 1200 and m.kind = 'approval_only' and m.title = 'QC photos'
       then 'The brand approves finished-goods photos before the balance falls due.'
     when m.sort = 1300 and m.kind = 'payment_only' and m.title = 'Final balance'
       then 'The remainder of the production total, once QC photos are approved.'
   end
  from public.production_orders o
 where o.id = m.order_id and m.description is null
   and (
     (m.source_sample_line_id is not null and m.kind = 'approval_and_payment')
     or (m.sort = 1000 and m.kind = 'payment_only' and m.title = 'Bulk deposit')
     or (m.sort = 1100 and m.kind = 'progress_only' and m.title = 'Bulk production')
     or (m.sort = 1200 and m.kind = 'approval_only' and m.title = 'QC photos')
     or (m.sort = 1300 and m.kind = 'payment_only' and m.title = 'Final balance')
   );
select is((select description from public.order_milestones where order_id = (select order_id from helper_order) and title = 'Fit sample'), 'Factory prepares this sample and posts photos for approval.', 'legacy blank generated sample is restored');
select matches((select description from public.order_milestones where order_id = (select order_id from helper_order) and title = 'Bulk deposit'), 'paid before bulk materials are bought[.]$', 'legacy blank generated deposit is restored');
select is((select description from public.order_milestones where order_id = (select order_id from helper_order) and title = 'Bulk production'), 'Brand-authored production instructions', 'backfill never overwrites brand instructions');
select is((select description from public.order_milestones where order_id = (select order_id from helper_order) and title = 'Custom QC'), null::text, 'backfill leaves renamed custom steps alone');
select is((select description from public.order_milestones where order_id = (select order_id from helper_order) and title = 'Final balance'), '', 'backfill preserves explicitly empty descriptions');

select * from finish();
rollback;
