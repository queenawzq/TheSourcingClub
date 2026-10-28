-- Team & roles: per-member permissions, invitations, removing a member.
--
-- Mostly refusals. A rule that accidentally grants everything still passes
-- every positive test, so each permission is tried by someone on the right
-- team who does NOT hold it, and by the two-hat person who holds it in one
-- company and not the other.
--
-- Fixtures: slug prefix pgtap24-, ids a2400000-.
--   A  brand:   u1 owner; u2 member {rfqFlow}; u3 member {settingsAccess};
--               u6 member {rfqFlow,approve,releaseFunds}; u10 member, defaults
--   C  brand:   u8 owner; u6 member {} (the two-hat person)
--   F  factory: u4 owner; u5 member {addUpdate}; u9 member {rfqFlow}
--   u7 staff, u11 an invitee, u12 a stranger

begin;
create extension if not exists pgtap with schema extensions;

select plan(91);

insert into auth.users (id, email, raw_user_meta_data) values
  ('a2400000-0000-0000-0000-000000000001', 'p24-owner@example.com',     '{"name":"P24 Owner"}'),
  ('a2400000-0000-0000-0000-000000000002', 'p24-quoter@example.com',    '{"name":"P24 Quoter"}'),
  ('a2400000-0000-0000-0000-000000000003', 'p24-settings@example.com',  '{"name":"P24 Settings"}'),
  ('a2400000-0000-0000-0000-000000000004', 'p24-factory@example.com',   '{"name":"P24 Factory"}'),
  ('a2400000-0000-0000-0000-000000000005', 'p24-updater@example.com',   '{"name":"P24 Updater"}'),
  ('a2400000-0000-0000-0000-000000000006', 'p24-twohats@example.com',   '{"name":"P24 Two Hats"}'),
  ('a2400000-0000-0000-0000-000000000007', 'p24-staff@example.com',     '{"name":"P24 Staff"}'),
  ('a2400000-0000-0000-0000-000000000008', 'p24-other@example.com',     '{"name":"P24 Other Owner"}'),
  ('a2400000-0000-0000-0000-000000000009', 'p24-fquoter@example.com',   '{"name":"P24 Factory Quoter"}'),
  ('a2400000-0000-0000-0000-000000000010', 'p24-default@example.com',   '{"name":"P24 Default"}'),
  ('a2400000-0000-0000-0000-000000000011', 'p24-invitee@example.com',   '{"name":"P24 Invitee"}'),
  ('a2400000-0000-0000-0000-000000000012', 'p24-stranger@example.com',  '{"name":"P24 Stranger"}');

update public.user_profiles p set full_name = u.raw_user_meta_data ->> 'name'
  from auth.users u
 where u.id = p.id and u.id::text like 'a2400000-%';

insert into public.orgs (id, type, name, slug) values
  ('a2400000-0000-0000-0000-0000000000aa', 'brand',   'P24 Brand',   'pgtap24-brand'),
  ('a2400000-0000-0000-0000-0000000000cc', 'brand',   'P24 Other',   'pgtap24-other'),
  ('a2400000-0000-0000-0000-0000000000ff', 'factory', 'P24 Factory', 'pgtap24-factory');

insert into public.org_members (org_id, user_id, role, permissions) values
  ('a2400000-0000-0000-0000-0000000000aa', 'a2400000-0000-0000-0000-000000000001', 'owner',  null),
  ('a2400000-0000-0000-0000-0000000000aa', 'a2400000-0000-0000-0000-000000000002', 'member', '{rfqFlow}'),
  ('a2400000-0000-0000-0000-0000000000aa', 'a2400000-0000-0000-0000-000000000003', 'member', '{settingsAccess}'),
  ('a2400000-0000-0000-0000-0000000000aa', 'a2400000-0000-0000-0000-000000000006', 'member', '{rfqFlow,approve,releaseFunds}'),
  ('a2400000-0000-0000-0000-0000000000cc', 'a2400000-0000-0000-0000-000000000008', 'owner',  '{rfqFlow}'),
  ('a2400000-0000-0000-0000-0000000000cc', 'a2400000-0000-0000-0000-000000000006', 'member', '{}'),
  ('a2400000-0000-0000-0000-0000000000ff', 'a2400000-0000-0000-0000-000000000004', 'owner',  null),
  ('a2400000-0000-0000-0000-0000000000ff', 'a2400000-0000-0000-0000-000000000005', 'member', '{addUpdate}'),
  ('a2400000-0000-0000-0000-0000000000ff', 'a2400000-0000-0000-0000-000000000009', 'member', '{rfqFlow}');

-- A row written with no permissions gets what a member could do before
-- permissions existed.
insert into public.org_members (org_id, user_id, role) values
  ('a2400000-0000-0000-0000-0000000000aa', 'a2400000-0000-0000-0000-000000000010', 'member');

insert into public.platform_admins (user_id, note) values
  ('a2400000-0000-0000-0000-000000000007', 'pgtap24 staff');

insert into public.brand_profiles (org_id, hq_location) values
  ('a2400000-0000-0000-0000-0000000000aa', 'London, UK');
insert into public.factory_profiles (org_id, country_code, moq, published_at, verification_status) values
  ('a2400000-0000-0000-0000-0000000000ff', 'PT', 100, now(), 'verified');

insert into public.rfqs (id, brand_org_id, title, brief, status, visibility, quantity_total) values
  ('a2400000-0000-0000-0000-0000000001a1', 'a2400000-0000-0000-0000-0000000000aa', 'P24 One', 'A hundred shirts.', 'open', 'open_to_all', 100),
  ('a2400000-0000-0000-0000-0000000001a2', 'a2400000-0000-0000-0000-0000000000aa', 'P24 Two', 'A hundred coats.',  'open', 'open_to_all', 100);

insert into public.quotes
  (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity,
   bulk_lead_time_days, deposit_pct, balance_pct, valid_until, submitted_at)
values
  ('a2400000-0000-0000-0000-0000000002a1', 'a2400000-0000-0000-0000-0000000001a1',
   'a2400000-0000-0000-0000-0000000000ff', 'submitted', 2000, 100, 28, 30, 70, current_date + 30, now()),
  ('a2400000-0000-0000-0000-0000000002a2', 'a2400000-0000-0000-0000-0000000001a2',
   'a2400000-0000-0000-0000-0000000000ff', 'draft', 2000, 100, 28, 30, 70, current_date + 30, null);

-- ---------------------------------------------------------------------------
-- What a row holds
-- ---------------------------------------------------------------------------

select is(
  (select permissions from public.org_members
    where user_id = 'a2400000-0000-0000-0000-000000000010'),
  '{approve,rfqFlow}'::text[],
  'a brand member written with no permissions keeps what members could do before (Quote flow + Approve)');

select is(
  (select permissions from public.org_members
    where org_id = 'a2400000-0000-0000-0000-0000000000aa' and user_id = 'a2400000-0000-0000-0000-000000000001'),
  '{primaryContact}'::text[],
  'the first owner is the primary contact, and an owner stores no authorities');

select is(
  (select permissions from public.org_members
    where org_id = 'a2400000-0000-0000-0000-0000000000cc' and user_id = 'a2400000-0000-0000-0000-000000000008'),
  '{primaryContact}'::text[],
  'authorities written onto an owner row are dropped (an owner holds them all anyway)');

select throws_ok(
  $$insert into public.org_members (org_id, user_id, role, permissions)
    values ('a2400000-0000-0000-0000-0000000000aa', 'a2400000-0000-0000-0000-000000000012', 'member', '{addUpdate}')$$,
  '22023', null,
  'a brand cannot hold a factory-only permission');

-- ---------------------------------------------------------------------------
-- org_members cannot be written directly
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"a2400000-0000-0000-0000-000000000001","email":"p24-owner@example.com","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$update public.org_members set user_id = 'a2400000-0000-0000-0000-000000000012'
     where org_id = 'a2400000-0000-0000-0000-0000000000aa' and user_id = 'a2400000-0000-0000-0000-000000000002'$$,
  '42501', null,
  'an owner CANNOT re-point a membership at someone who was never invited');

select throws_ok(
  $$update public.org_members set permissions = '{rfqFlow,approve,releaseFunds,settingsAccess}'
     where user_id = 'a2400000-0000-0000-0000-000000000002'$$,
  '42501', null,
  'permissions cannot be changed by a direct update, even by an owner');

select throws_ok(
  $$insert into public.org_members (org_id, user_id, role)
    values ('a2400000-0000-0000-0000-0000000000aa', 'a2400000-0000-0000-0000-000000000012', 'member')$$,
  '42501', null,
  'an owner CANNOT add a member by a direct insert');

select throws_ok(
  $$delete from public.org_members where org_id = 'a2400000-0000-0000-0000-0000000000aa'
     and user_id = 'a2400000-0000-0000-0000-000000000001'$$,
  '42501', null,
  'the last owner CANNOT leave by deleting their own row');

-- ---------------------------------------------------------------------------
-- Asking
-- ---------------------------------------------------------------------------

select ok(public.has_org_permission('a2400000-0000-0000-0000-0000000000aa', 'releaseFunds'),
  'an owner holds Release funds without it being stored');

reset role;
set local request.jwt.claims = '{"sub":"a2400000-0000-0000-0000-000000000002","email":"p24-quoter@example.com","role":"authenticated"}';
set local role authenticated;

select ok(public.has_org_permission('a2400000-0000-0000-0000-0000000000aa', 'rfqFlow'),
  'a member holds the permission given to them');
select ok(not public.has_org_permission('a2400000-0000-0000-0000-0000000000aa', 'approve'),
  'a member does not hold a permission they were not given');

reset role;
set local request.jwt.claims = '{"sub":"a2400000-0000-0000-0000-000000000006","email":"p24-twohats@example.com","role":"authenticated"}';
set local role authenticated;

select ok(not public.has_org_permission('a2400000-0000-0000-0000-0000000000cc', 'rfqFlow'),
  'the two-hat person does not carry a permission from one company into the other');

-- ---------------------------------------------------------------------------
-- A brand's Quote flow
-- ---------------------------------------------------------------------------

select throws_ok(
  $$insert into public.rfqs (brand_org_id, title, brief, status, visibility)
    values ('a2400000-0000-0000-0000-0000000000cc', 'P24 sneaked', 'x', 'draft', 'open_to_all')$$,
  '42501', null,
  'the two-hat person CANNOT write a request where they lack Quote flow');

select lives_ok(
  $$insert into public.rfqs (brand_org_id, title, brief, status, visibility)
    values ('a2400000-0000-0000-0000-0000000000aa', 'P24 allowed', 'x', 'draft', 'open_to_all')$$,
  '... and can where they hold it');

reset role;
set local request.jwt.claims = '{"sub":"a2400000-0000-0000-0000-000000000003","email":"p24-settings@example.com","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$insert into public.rfqs (brand_org_id, title, brief, status, visibility)
    values ('a2400000-0000-0000-0000-0000000000aa', 'P24 no flow', 'x', 'draft', 'open_to_all')$$,
  '42501', null,
  'a member without Quote flow CANNOT create a request');

select throws_ok(
  $$update public.rfqs set title = 'renamed' where id = 'a2400000-0000-0000-0000-0000000001a2'$$,
  '42501', null,
  'a member without Quote flow CANNOT edit a request');

select throws_ok(
  $$insert into public.rfq_questions (rfq_id, prompt, sort)
    values ('a2400000-0000-0000-0000-0000000001a2', 'Lead time?', 1)$$,
  '42501', null,
  'a member without Quote flow CANNOT add a question to a request');

select throws_ok(
  $$select public.award_quote('a2400000-0000-0000-0000-0000000002a1')$$,
  '42501', 'You need the Quote flow permission at P24 Brand to do this. An owner can give it to you in Settings.',
  'a member without Quote flow CANNOT choose a quote, and is told which permission');

select throws_ok(
  $$select public.cancel_rfq('a2400000-0000-0000-0000-0000000001a2', 'not needed')$$,
  '42501', null,
  'a member without Quote flow CANNOT cancel a request');

-- ---------------------------------------------------------------------------
-- A factory's RFQ flow
-- ---------------------------------------------------------------------------

reset role;
set local request.jwt.claims = '{"sub":"a2400000-0000-0000-0000-000000000005","email":"p24-updater@example.com","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$insert into public.quotes (rfq_id, factory_org_id, status)
    values ('a2400000-0000-0000-0000-0000000001a1', 'a2400000-0000-0000-0000-0000000000ff', 'draft')$$,
  '42501', null,
  'a factory member without RFQ flow CANNOT start a quote');

select throws_ok(
  $$update public.quotes set unit_price_cents = 1 where id = 'a2400000-0000-0000-0000-0000000002a2'$$,
  '42501', null,
  'a factory member without RFQ flow CANNOT edit a draft quote');

select throws_ok(
  $$insert into public.quote_sample_lines (quote_id, stage, cost_cents, sort)
    values ('a2400000-0000-0000-0000-0000000002a2', 'Fit sample', 100, 1)$$,
  '42501', null,
  'a factory member without RFQ flow CANNOT add a sample line');

select throws_ok(
  $$select public.submit_quote('a2400000-0000-0000-0000-0000000002a2')$$,
  '42501', 'You need the RFQ flow permission at P24 Factory to do this. An owner can give it to you in Settings.',
  'a factory member without RFQ flow CANNOT send a quote');

select throws_ok(
  $$select public.withdraw_quote('a2400000-0000-0000-0000-0000000002a1')$$,
  '42501', null,
  'a factory member without RFQ flow CANNOT withdraw a quote');

reset role;
set local request.jwt.claims = '{"sub":"a2400000-0000-0000-0000-000000000009","email":"p24-fquoter@example.com","role":"authenticated"}';
set local role authenticated;

select lives_ok(
  $$update public.quotes set bulk_lead_time_days = 30 where id = 'a2400000-0000-0000-0000-0000000002a2'$$,
  'a factory member with RFQ flow edits a draft quote');

-- ---------------------------------------------------------------------------
-- An order: Paid release "Fit sample", Approval only "Lab dip", the balance
-- ---------------------------------------------------------------------------

reset role;
set local request.jwt.claims = '{"sub":"a2400000-0000-0000-0000-000000000001","email":"p24-owner@example.com","role":"authenticated"}';
set local role authenticated;
select public.award_quote('a2400000-0000-0000-0000-0000000002a1');
reset role;

create temporary table p24 (id uuid);
insert into p24 select id from public.production_orders where quote_id = 'a2400000-0000-0000-0000-0000000002a1';
grant select on p24 to public;

set local request.jwt.claims = '{"sub":"a2400000-0000-0000-0000-000000000001","email":"p24-owner@example.com","role":"authenticated"}';
set local role authenticated;
select public.set_order_schedule((select id from p24),
  '[{"kind":"approval_and_payment","title":"Fit sample","amount_cents":50000,"sort":10},
    {"kind":"approval_only","title":"Lab dip","sort":20},
    {"kind":"payment_only","title":"Balance","amount_cents":150000,"sort":30}]'::jsonb);
select public.agree_schedule((select id from p24), (select schedule_revision from public.production_orders where id = (select id from p24)));
reset role;

create function pg_temp.p24_step(step text) returns uuid
language sql as $$
  select id from public.order_milestones where order_id = (select id from p24) and title = step
$$;

select is((select status::text from public.production_orders where id = (select id from p24)), 'active',
  'fixture: the order is under way');

set local request.jwt.claims = '{"sub":"a2400000-0000-0000-0000-000000000003","email":"p24-settings@example.com","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$select public.update_order_milestone_details((select id from p24), '[]'::jsonb)$$,
  '42501', null,
  'a member without Quote flow CANNOT change the production steps');

reset role;
set local request.jwt.claims = '{"sub":"a2400000-0000-0000-0000-000000000002","email":"p24-quoter@example.com","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$select public.approve_milestone(pg_temp.p24_step('Lab dip'), null)$$,
  '42501', 'You need the Approve samples permission at P24 Brand to do this. An owner can give it to you in Settings.',
  'a member without Approve samples CANNOT approve a step');

select throws_ok(
  $$select public.initiate_milestone_dispute(pg_temp.p24_step('Lab dip'), 'Wrong colour', '{}'::uuid[])$$,
  '42501', null,
  'a member without Approve samples CANNOT ask for changes on a step');

select throws_ok(
  $$select public.begin_payment_checkout((select p.id from public.order_payments p where p.milestone_id = pg_temp.p24_step('Fit sample')))$$,
  '42501', 'You need the Release funds permission at P24 Brand to do this. An owner can give it to you in Settings.',
  'a member without Release funds CANNOT pay for a step');

reset role;
set local request.jwt.claims = '{"sub":"a2400000-0000-0000-0000-000000000010","email":"p24-default@example.com","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$select public.approve_milestone(pg_temp.p24_step('Fit sample'), null)$$,
  '42501', 'You need the Release funds permission at P24 Brand to do this. An owner can give it to you in Settings.',
  'Approve samples alone CANNOT approve a step that releases money');

reset role;
set local request.jwt.claims = '{"sub":"a2400000-0000-0000-0000-000000000009","email":"p24-fquoter@example.com","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$select public.post_milestone_update(pg_temp.p24_step('Fit sample'), 'Cut and sewn', '{}'::uuid[])$$,
  '42501', 'You need the Add update permission at P24 Factory to do this. An owner can give it to you in Settings.',
  'a factory member without Add update CANNOT post a step update');

select throws_ok(
  $$select public.submit_milestone(pg_temp.p24_step('Fit sample'))$$,
  '42501', null,
  'a factory member without Add update CANNOT send a step for approval');

reset role;
set local request.jwt.claims = '{"sub":"a2400000-0000-0000-0000-000000000010","email":"p24-default@example.com","role":"authenticated"}';
set local role authenticated;

select lives_ok(
  $$select public.post_milestone_update(pg_temp.p24_step('Fit sample'), 'Looks good so far', '{}'::uuid[])$$,
  'a brand member without Add update still comments on a step (conversation, not authority)');

-- ---------------------------------------------------------------------------
-- Settings access
-- ---------------------------------------------------------------------------

reset role;
set local request.jwt.claims = '{"sub":"a2400000-0000-0000-0000-000000000002","email":"p24-quoter@example.com","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$select public.set_notification_preference('a2400000-0000-0000-0000-0000000000aa', 'payments', false)$$,
  '42501', null,
  'a member without Settings access CANNOT change the email switches');

select throws_ok(
  $$select public.save_company_basics('a2400000-0000-0000-0000-0000000000aa', 'ops@example.com', '+44 20 0000 0000', 'Leeds, UK')$$,
  '42501', null,
  'a member without Settings access CANNOT change the company details');

reset role;
set local request.jwt.claims = '{"sub":"a2400000-0000-0000-0000-000000000003","email":"p24-settings@example.com","role":"authenticated"}';
set local role authenticated;

select lives_ok(
  $$select public.save_company_basics('a2400000-0000-0000-0000-0000000000aa', 'Ops@Example.com ', '+44 20 0000 0000', 'Leeds, UK')$$,
  'a member with Settings access saves the company details');

select is(
  (select email || ' / ' || phone from public.org_contact_details where org_id = 'a2400000-0000-0000-0000-0000000000aa'),
  'ops@example.com / +44 20 0000 0000',
  'the details read back as saved, the email lowercased');

select is((select hq_location from public.brand_profiles where org_id = 'a2400000-0000-0000-0000-0000000000aa'),
  'Leeds, UK', 'the location is the profile''s own');

reset role;
set local request.jwt.claims = '{"sub":"a2400000-0000-0000-0000-000000000004","email":"p24-factory@example.com","role":"authenticated"}';
set local role authenticated;

select is(
  (select count(*) from public.org_contact_details where org_id = 'a2400000-0000-0000-0000-0000000000aa'),
  0::bigint,
  'the factory on the order CANNOT read the brand''s contact details');

reset role;
select throws_ok(
  $$select public.create_credit_purchase('a2400000-0000-0000-0000-0000000000ff', 100, 'a2400000-0000-0000-0000-000000000005')$$,
  '42501', null,
  'a factory member without Settings access CANNOT buy credits');

-- ---------------------------------------------------------------------------
-- Invitations
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"a2400000-0000-0000-0000-000000000002","email":"p24-quoter@example.com","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$insert into public.org_invitations (org_id, email) values ('a2400000-0000-0000-0000-0000000000aa', 'p24-new1@example.com')$$,
  '42501', null,
  'a member without Settings access CANNOT invite');

reset role;
set local request.jwt.claims = '{"sub":"a2400000-0000-0000-0000-000000000003","email":"p24-settings@example.com","role":"authenticated"}';
set local role authenticated;

select lives_ok(
  $$insert into public.org_invitations (org_id, email, role, permissions, title, invited_name)
    values ('a2400000-0000-0000-0000-0000000000aa', '  P24-New2@Example.com ', 'owner', '{settingsAccess,primaryContact}', ' Finance ', 'New Two')$$,
  'a member with Settings access invites');

reset role;
select is(
  (select row(email, role::text, invited_by, permissions, title)::text from public.org_invitations
    where org_id = 'a2400000-0000-0000-0000-0000000000aa' and invited_name = 'New Two'),
  row('p24-new2@example.com', 'member', 'a2400000-0000-0000-0000-000000000003'::uuid, '{settingsAccess}'::text[], 'Finance')::text,
  'the invite is cleaned: lowercased, a member not an owner, sent by the caller, no primary contact');

set local request.jwt.claims = '{"sub":"a2400000-0000-0000-0000-000000000003","email":"p24-settings@example.com","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$insert into public.org_invitations (org_id, email, permissions)
    values ('a2400000-0000-0000-0000-0000000000aa', 'p24-alt@example.com', '{releaseFunds}')$$,
  '42501', 'You can only give permissions you have yourself (not Release funds)',
  'an inviter CANNOT give a permission they do not hold (a second address of their own)');

select throws_ok(
  $$insert into public.org_invitations (org_id, email) values ('a2400000-0000-0000-0000-0000000000aa', 'p24-quoter@example.com')$$,
  '23505', null,
  'someone already on the team cannot be invited again');

select throws_ok(
  $$insert into public.org_invitations (org_id, email) values ('a2400000-0000-0000-0000-0000000000aa', 'P24-STAFF@example.com')$$,
  '42501', null,
  'a staff address cannot be invited');

select throws_ok(
  $$insert into public.org_invitations (org_id, email) values ('a2400000-0000-0000-0000-0000000000cc', 'p24-new3@example.com')$$,
  '42501', null,
  'an inviter CANNOT invite into a company where they lack Settings access');

select lives_ok(
  $$insert into public.org_invitations (org_id, email) values ('a2400000-0000-0000-0000-0000000000aa', 'p24-new4@example.com')$$,
  'an invite with no permissions named is accepted');

reset role;
select is(
  (select permissions from public.org_invitations where email = 'p24-new4@example.com'),
  '{}'::text[],
  '... and starts with the drawn default only where the inviter holds it (Settings access holds no Approve)');

set local request.jwt.claims = '{"sub":"a2400000-0000-0000-0000-000000000003","email":"p24-settings@example.com","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$update public.org_invitations set email = 'p24-elsewhere@example.com' where email = 'p24-new4@example.com'$$,
  '42501', null,
  'an invitation''s address cannot be rewritten');

select lives_ok(
  $$select public.revoke_invitation((select id from public.org_invitations where email = 'p24-new4@example.com'))$$,
  'Settings access withdraws an invitation');

select throws_ok(
  $$select public.revoke_invitation((select id from public.org_invitations where email = 'p24-new4@example.com'))$$,
  '22023', null,
  'a withdrawn invitation cannot be withdrawn again');

select lives_ok(
  $$select public.resend_invitation((select id from public.org_invitations where email = 'p24-new2@example.com'))$$,
  'a pending invitation can be sent again');

reset role;
update public.org_invitations set emailed_at = now() where email = 'p24-new2@example.com';
set local request.jwt.claims = '{"sub":"a2400000-0000-0000-0000-000000000003","email":"p24-settings@example.com","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$select public.resend_invitation((select id from public.org_invitations where email = 'p24-new2@example.com'))$$,
  '54000', null,
  '... but not again within ten minutes of the last email');

reset role;
set local request.jwt.claims = '{"sub":"a2400000-0000-0000-0000-000000000002","email":"p24-quoter@example.com","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$select public.revoke_invitation((select id from public.org_invitations where email = 'p24-new2@example.com'))$$,
  '42501', null,
  'a member without Settings access CANNOT withdraw an invitation');

select is(
  (select count(*) from public.org_invitations where org_id = 'a2400000-0000-0000-0000-0000000000aa'),
  0::bigint,
  'a member without Settings access does not see the company''s invitations');

-- Twenty a day, per person, whichever company they invite into.
reset role;
set local request.jwt.claims = '{"sub":"a2400000-0000-0000-0000-000000000003","email":"p24-settings@example.com","role":"authenticated"}';
set local role authenticated;
do $$
begin
  for i in 1..18 loop
    insert into public.org_invitations (org_id, email)
    values ('a2400000-0000-0000-0000-0000000000aa', format('p24-bulk%s@example.com', i));
  end loop;
end;
$$;

select throws_ok(
  $$insert into public.org_invitations (org_id, email) values ('a2400000-0000-0000-0000-0000000000aa', 'p24-bulk21@example.com')$$,
  '54000', null,
  'the 21st invitation in a day is refused');

-- Accepting. Written as the server would, with nobody's claims.
reset role;
set local request.jwt.claims = '{}';
insert into public.org_invitations (org_id, email, permissions, title, invited_name, expires_at) values
  ('a2400000-0000-0000-0000-0000000000aa', 'p24-invitee@example.com', '{approve}', 'Finance', 'P24 Invitee', now() + interval '1 day'),
  ('a2400000-0000-0000-0000-0000000000ff', 'p24-invitee@example.com', '{addUpdate}', null, null, now() - interval '1 day'),
  ('a2400000-0000-0000-0000-0000000000aa', 'p24-staff@example.com', '{}', null, null, now() + interval '1 day');

set local request.jwt.claims = '{"sub":"a2400000-0000-0000-0000-000000000007","email":"p24-staff@example.com","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$select public.accept_invitation((select id from public.org_invitations where email = 'p24-staff@example.com'))$$,
  '42501', null,
  'staff CANNOT join a company, even with an invitation');

reset role;
set local request.jwt.claims = '{"sub":"a2400000-0000-0000-0000-000000000011","email":"p24-invitee@example.com","role":"authenticated"}';
set local role authenticated;

select is(
  (select array_agg(org_name order by org_name) from public.my_invitation_companies()),
  array['P24 Brand'],
  'the invitee sees the name of the company inviting them, and not the expired one');

select throws_ok(
  $$select public.accept_invitation((select id from public.org_invitations
     where email = 'p24-invitee@example.com' and org_id = 'a2400000-0000-0000-0000-0000000000ff'))$$,
  'P0002', null,
  'an expired invitation cannot be accepted');

select lives_ok(
  $$select public.accept_invitation((select id from public.org_invitations
     where email = 'p24-invitee@example.com' and org_id = 'a2400000-0000-0000-0000-0000000000aa'))$$,
  'the invitee accepts');

reset role;
select is(
  (select row(role::text, permissions, title)::text from public.org_members
    where org_id = 'a2400000-0000-0000-0000-0000000000aa' and user_id = 'a2400000-0000-0000-0000-000000000011'),
  row('member', '{approve}'::text[], 'Finance')::text,
  'they join with exactly what the invitation said');

select is(
  (select title from public.notifications
    where org_id = 'a2400000-0000-0000-0000-0000000000aa' and kind = 'team_member_joined'),
  'P24 Invitee joined P24 Brand',
  'the team is told who joined');

-- ---------------------------------------------------------------------------
-- Changing the team
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"a2400000-0000-0000-0000-000000000003","email":"p24-settings@example.com","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$select public.set_member_access('a2400000-0000-0000-0000-0000000000aa', 'a2400000-0000-0000-0000-000000000003', '{rfqFlow,approve,releaseFunds,settingsAccess}', null)$$,
  '42501', null,
  'Settings access CANNOT change permissions, its own included');

select throws_ok(
  $$select public.remove_member('a2400000-0000-0000-0000-0000000000aa', 'a2400000-0000-0000-0000-000000000002')$$,
  '42501', null,
  'Settings access CANNOT remove someone');

reset role;
set local request.jwt.claims = '{"sub":"a2400000-0000-0000-0000-000000000008","email":"p24-other@example.com","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$select public.set_member_access('a2400000-0000-0000-0000-0000000000aa', 'a2400000-0000-0000-0000-000000000002', '{}', null)$$,
  '42501', null,
  'an owner of another company CANNOT change this team');

select throws_ok(
  $$select public.remove_member('a2400000-0000-0000-0000-0000000000aa', 'a2400000-0000-0000-0000-000000000002')$$,
  '42501', null,
  'an owner of another company CANNOT remove someone from this team');

reset role;
set local request.jwt.claims = '{"sub":"a2400000-0000-0000-0000-000000000001","email":"p24-owner@example.com","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$select public.set_member_access('a2400000-0000-0000-0000-0000000000aa', 'a2400000-0000-0000-0000-000000000002', '{addUpdate}', null)$$,
  '22023', null,
  'an unknown permission is refused by name');

select lives_ok(
  $$select public.set_member_access('a2400000-0000-0000-0000-0000000000aa', 'a2400000-0000-0000-0000-000000000002', '{rfqFlow,primaryContact}', 'Sourcing lead')$$,
  'an owner changes what a member may do');

reset role;
select is(
  (select array_agg(user_id order by user_id) from public.org_members
    where org_id = 'a2400000-0000-0000-0000-0000000000aa' and 'primaryContact' = any (permissions)),
  array['a2400000-0000-0000-0000-000000000002'::uuid],
  'choosing a primary contact takes it from whoever held it');

set local request.jwt.claims = '{"sub":"a2400000-0000-0000-0000-000000000001","email":"p24-owner@example.com","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$select public.set_member_role('a2400000-0000-0000-0000-0000000000aa', 'a2400000-0000-0000-0000-000000000001', 'member')$$,
  '23514', null,
  'the last owner CANNOT demote themself');

select throws_ok(
  $$select public.remove_member('a2400000-0000-0000-0000-0000000000aa', 'a2400000-0000-0000-0000-000000000001')$$,
  '23514', null,
  'the last owner CANNOT leave');

select lives_ok(
  $$select public.set_member_role('a2400000-0000-0000-0000-0000000000aa', 'a2400000-0000-0000-0000-000000000003', 'owner')$$,
  'an owner makes someone else an owner');

reset role;
set local request.jwt.claims = '{"sub":"a2400000-0000-0000-0000-000000000003","email":"p24-settings@example.com","role":"authenticated"}';
set local role authenticated;

select lives_ok(
  $$select public.set_member_role('a2400000-0000-0000-0000-0000000000aa', 'a2400000-0000-0000-0000-000000000001', 'member')$$,
  'with two owners, one may demote the other');

select throws_ok(
  $$select public.set_member_role('a2400000-0000-0000-0000-0000000000aa', 'a2400000-0000-0000-0000-000000000003', 'member')$$,
  '23514', null,
  '... and the one left is the last owner again');

reset role;
set local request.jwt.claims = '{"sub":"a2400000-0000-0000-0000-000000000001","email":"p24-owner@example.com","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$select public.remove_member('a2400000-0000-0000-0000-0000000000aa', 'a2400000-0000-0000-0000-000000000010')$$,
  '42501', null,
  'a demoted owner CANNOT remove anyone');

select ok(not public.has_org_permission('a2400000-0000-0000-0000-0000000000aa', 'releaseFunds'),
  'a demoted owner no longer holds Release funds');

reset role;
set local request.jwt.claims = '{"sub":"a2400000-0000-0000-0000-000000000002","email":"p24-quoter@example.com","role":"authenticated"}';
set local role authenticated;

select lives_ok(
  $$select public.remove_member('a2400000-0000-0000-0000-0000000000aa', 'a2400000-0000-0000-0000-000000000002')$$,
  'a member leaves');

reset role;
select is(
  (select array_agg(user_id order by user_id) from public.org_members
    where org_id = 'a2400000-0000-0000-0000-0000000000aa' and 'primaryContact' = any (permissions)),
  array['a2400000-0000-0000-0000-000000000003'::uuid],
  'the primary contact who left is replaced by the earliest owner');

select is(
  (select title from public.notifications
    where org_id = 'a2400000-0000-0000-0000-0000000000aa' and kind = 'team_member_left'),
  'P24 Quoter left P24 Brand',
  'the team is told who left');

set local request.jwt.claims = '{"sub":"a2400000-0000-0000-0000-000000000003","email":"p24-settings@example.com","role":"authenticated"}';
set local role authenticated;

select lives_ok(
  $$select public.remove_member('a2400000-0000-0000-0000-0000000000aa', 'a2400000-0000-0000-0000-000000000010')$$,
  'an owner removes a member');

reset role;
select is(
  (select title from public.notifications
    where org_id = 'a2400000-0000-0000-0000-0000000000aa' and kind = 'team_member_removed'),
  'P24 Default no longer has access to P24 Brand',
  'the team is told who was removed');

select is(
  (select count(*) from public.rfqs where brand_org_id = 'a2400000-0000-0000-0000-0000000000aa'),
  3::bigint,
  'what the people who left started stays with the company');

set local request.jwt.claims = '{"sub":"a2400000-0000-0000-0000-000000000010","email":"p24-default@example.com","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$select public.approve_milestone(pg_temp.p24_step('Lab dip'), null)$$,
  'P0002', null,
  'a removed member is refused at once (the order is not theirs to see any more)');

select is(
  (select count(*) from public.org_members where org_id = 'a2400000-0000-0000-0000-0000000000aa'),
  0::bigint,
  '... and no longer reads the team');

-- ---------------------------------------------------------------------------
-- Grants and Realtime
-- ---------------------------------------------------------------------------

reset role;
select ok(not has_function_privilege('authenticated', 'public.require_org_permission(uuid, text)', 'execute'),
  'require_org_permission is internal');
select ok(not has_function_privilege('authenticated', 'public.member_has_permission(uuid, uuid, text)', 'execute'),
  'member_has_permission (any person''s permissions) is server-only');
select ok(not has_function_privilege('anon', 'public.has_org_permission(uuid, text)', 'execute'),
  'a signed-out visitor cannot ask about permissions');
select ok(not has_table_privilege('authenticated', 'public.org_contact_details', 'insert')
          and not has_table_privilege('authenticated', 'public.org_contact_details', 'update'),
  'contact details are written only through save_company_basics');
select ok(exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'org_members'),
  'a change to the team reaches open screens');

select * from finish();
rollback;
