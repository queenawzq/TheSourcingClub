-- ============================================================================
-- The order interior — comments from either side, reminders, activity (065)
-- ----------------------------------------------------------------------------
-- Run with:  supabase test db
--
-- `pgtap10-` slugs and ca…/da…/ea…/fa… ids, every count scoped to these
-- fixtures, as in every other suite: they all share one database.
--
-- What this protects: a brand can now post against a step, so the question is
-- whether that opened anything beyond the brand's own comment. A stranger must
-- still see nothing, post nothing and remind nobody; a party must never attach
-- the other side's files; and the activity list must add no access of its own.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(28);

-- ---------------------------------------------------------------------------
-- Fixtures: an awarded order, agreed by both sides, so its first step is open
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, raw_user_meta_data) values
  ('ca000000-0000-0000-0000-000000000001', 'p10-brandowner@example.com', '{"name":"Brand Owner"}'),
  ('ca000000-0000-0000-0000-000000000002', 'p10-factory@example.com',    '{"name":"Factory Owner"}'),
  ('ca000000-0000-0000-0000-000000000003', 'p10-outsider@example.com',   '{"name":"Outsider"}'),
  ('ca000000-0000-0000-0000-000000000004', 'p10-brandmember@example.com', '{"name":"Brand Member"}');

insert into public.orgs (id, type, name, slug) values
  ('da000000-0000-0000-0000-00000000000b', 'brand',   'P10 Brand',    'pgtap10-brand'),
  ('da000000-0000-0000-0000-0000000000f1', 'factory', 'P10 Factory',  'pgtap10-factory'),
  ('da000000-0000-0000-0000-00000000000c', 'brand',   'P10 Outsider', 'pgtap10-outsider');

insert into public.org_members (org_id, user_id, role) values
  ('da000000-0000-0000-0000-00000000000b', 'ca000000-0000-0000-0000-000000000001', 'owner'),
  ('da000000-0000-0000-0000-0000000000f1', 'ca000000-0000-0000-0000-000000000002', 'owner'),
  ('da000000-0000-0000-0000-00000000000c', 'ca000000-0000-0000-0000-000000000003', 'owner'),
  ('da000000-0000-0000-0000-00000000000b', 'ca000000-0000-0000-0000-000000000004', 'member');

insert into public.brand_profiles (org_id, hq_location) values
  ('da000000-0000-0000-0000-00000000000b', 'London, UK'),
  ('da000000-0000-0000-0000-00000000000c', 'Berlin, DE');

insert into public.factory_profiles (org_id, country_code, moq, published_at, verification_status) values
  ('da000000-0000-0000-0000-0000000000f1', 'PT', 100, now(), 'verified');

insert into public.rfqs (id, brand_org_id, title, brief, status, visibility, quantity_total) values
  ('ea000000-0000-0000-0000-000000000001', 'da000000-0000-0000-0000-00000000000b',
   'P10 shirts', 'One hundred linen shirts.', 'open', 'open_to_all', 100);

insert into public.quotes
  (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity,
   bulk_lead_time_days, deposit_pct, balance_pct, valid_until, submitted_at)
values
  ('fa000000-0000-0000-0000-0000000000f1', 'ea000000-0000-0000-0000-000000000001',
   'da000000-0000-0000-0000-0000000000f1', 'submitted', 2000, 100, 28, 30, 70,
   current_date + 30, now());

insert into public.quote_sample_lines (quote_id, stage, cost_cents, sort) values
  ('fa000000-0000-0000-0000-0000000000f1', 'Fit sample', 5000, 1);

set local request.jwt.claims = '{"sub":"ca000000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select public.award_quote('fa000000-0000-0000-0000-0000000000f1');

reset role;
create temporary table p10 as
select o.id as order_id,
       (select id from public.order_milestones m where m.order_id = o.id order by sort limit 1) as first_step,
       (select id from public.order_milestones m where m.order_id = o.id order by sort desc limit 1) as last_step
from public.production_orders o
where o.quote_id = 'fa000000-0000-0000-0000-0000000000f1';
grant select on p10 to public;

set local request.jwt.claims = '{"sub":"ca000000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select public.agree_schedule((select order_id from p10), 1);
reset role;
set local request.jwt.claims = '{"sub":"ca000000-0000-0000-0000-000000000002","role":"authenticated"}';
set local role authenticated;
select public.agree_schedule((select order_id from p10), 1);
reset role;

-- Photos, one per side, uploaded but not yet attached. Their storage objects
-- sit at {org}/milestone_update/{order}/…, which is what uploadDocument writes.
insert into public.documents (id, org_id, kind, bucket, storage_path, file_name, mime_type)
select 'aa000000-0000-0000-0000-00000000000b', 'da000000-0000-0000-0000-00000000000b',
       'milestone_update', 'org-private',
       'da000000-0000-0000-0000-00000000000b/milestone_update/' || order_id || '/brand.jpg',
       'brand.jpg', 'image/jpeg'
from p10;
insert into public.documents (id, org_id, kind, bucket, storage_path, file_name, mime_type)
select 'aa000000-0000-0000-0000-0000000000f1', 'da000000-0000-0000-0000-0000000000f1',
       'milestone_update', 'org-private',
       'da000000-0000-0000-0000-0000000000f1/milestone_update/' || order_id || '/factory.jpg',
       'factory.jpg', 'image/jpeg'
from p10;
insert into storage.objects (bucket_id, name)
select 'org-private', 'da000000-0000-0000-0000-00000000000b/milestone_update/' || order_id || '/brand.jpg'
from p10;

select is(
  (select state::text from public.order_milestones where id = (select first_step from p10)),
  'active',
  'fixture: both sides agreed, so the first step is open'
);

-- ---------------------------------------------------------------------------
-- The brand comments on a step
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"ca000000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;

select lives_ok(
  $$select public.post_milestone_update((select first_step from p10),
      'The collar looks narrow in the photos — can you confirm the stand height?',
      array['aa000000-0000-0000-0000-00000000000b']::uuid[])$$,
  'a brand can comment on an open step, with its own photo'
);

select throws_ok(
  $$select public.post_milestone_update((select first_step from p10), 'Taking your photo',
      array['aa000000-0000-0000-0000-0000000000f1']::uuid[])$$,
  '42501', NULL,
  'a brand cannot attach the factory''s file to its comment'
);

select throws_ok(
  $$select public.post_milestone_update((select last_step from p10), 'Early thoughts', '{}')$$,
  '22023', NULL,
  'a step that has not opened yet takes no comment'
);

-- The brand approves from the factory's update; its own comment is not one.
select throws_ok(
  $$select public.approve_milestone((select first_step from p10), null)$$,
  '22023', NULL,
  'with only the brand''s own comment on it, an open step has nothing to approve yet'
);

reset role;

select is(
  (select author_org_id from public.milestone_updates
     where milestone_id = (select first_step from p10) and body like 'The collar%'),
  'da000000-0000-0000-0000-00000000000b'::uuid,
  'the comment is stored with the brand as its author'
);

select is(
  (select milestone_update_id is not null from public.documents
     where id = 'aa000000-0000-0000-0000-00000000000b'),
  true,
  'the brand''s photo is attached to its comment'
);

select is(
  (select count(*)::int from public.notifications
     where org_id = 'da000000-0000-0000-0000-0000000000f1'
       and kind = 'milestone_update'
       and subject_id = (select first_step from p10)
       and title like 'New comment on%'),
  1,
  'the factory is told about the brand''s comment'
);

-- ---------------------------------------------------------------------------
-- Who can see the brand's photo
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"ca000000-0000-0000-0000-000000000002","role":"authenticated"}';
set local role authenticated;

select is(
  (select count(*)::int from public.documents where id = 'aa000000-0000-0000-0000-00000000000b'),
  1,
  'the factory can read the brand''s photo record'
);

select is(
  (select count(*)::int from storage.objects
     where bucket_id = 'org-private'
       and name = 'da000000-0000-0000-0000-00000000000b/milestone_update/' || (select order_id from p10) || '/brand.jpg'),
  1,
  'the factory can read the brand''s photo object, so its signed URL works'
);

select is(
  (select count(*)::int from public.milestone_updates where milestone_id = (select first_step from p10)),
  1,
  'the factory reads the brand''s comment'
);

-- The factory still posts updates exactly as before.
select lives_ok(
  $$select public.post_milestone_update((select first_step from p10),
      'Stand is 3.5 cm as specified; photo attached.',
      array['aa000000-0000-0000-0000-0000000000f1']::uuid[])$$,
  'the factory still posts updates with its own photos'
);

reset role;

select is(
  (select count(*)::int from public.notifications
     where org_id = 'da000000-0000-0000-0000-00000000000b'
       and kind = 'milestone_update'
       and subject_id = (select first_step from p10)
       and title like 'New update on%'),
  1,
  'the brand is told about the factory''s update, with the update wording'
);

set local request.jwt.claims = '{"sub":"ca000000-0000-0000-0000-000000000003","role":"authenticated"}';
set local role authenticated;

select is(
  (select count(*)::int from public.documents
     where id in ('aa000000-0000-0000-0000-00000000000b', 'aa000000-0000-0000-0000-0000000000f1')),
  0,
  'a stranger cannot read either side''s photo record'
);

select is(
  (select count(*)::int from storage.objects
     where name like 'da000000-0000-0000-0000-00000000000b/milestone_update/%'),
  0,
  'a stranger cannot read the photo object'
);

select throws_ok(
  $$select public.post_milestone_update((select first_step from p10), 'Hello', '{}')$$,
  '42501', NULL,
  'a stranger cannot post on the order''s steps'
);

-- ---------------------------------------------------------------------------
-- Reminders
-- ---------------------------------------------------------------------------

select throws_ok(
  $$select public.remind_milestone((select first_step from p10))$$,
  '42501', NULL,
  'a stranger cannot send a reminder'
);

select throws_ok(
  $$select public.remind_milestone('00000000-0000-0000-0000-000000000000')$$,
  '42501', NULL,
  'a step that does not exist fails the same way, so existence does not leak'
);

reset role;
set local request.jwt.claims = '{"sub":"ca000000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;

select lives_ok(
  $$select public.remind_milestone((select first_step from p10))$$,
  'the brand can remind the factory about an open step'
);

select throws_ok(
  $$select public.remind_milestone((select first_step from p10))$$,
  '22023', NULL,
  'a second reminder about the same step on the same day is refused'
);

select throws_ok(
  $$select public.remind_milestone((select last_step from p10))$$,
  '22023', NULL,
  'a step that is not waiting on anyone takes no reminder'
);

reset role;

select is(
  (select count(*)::int from public.notifications
     where org_id = 'da000000-0000-0000-0000-0000000000f1'
       and kind = 'milestone_reminder'
       and subject_id = (select first_step from p10)
       and order_id = (select order_id from p10)),
  1,
  'exactly one reminder reached the factory, carrying the order so its link opens'
);

-- ---------------------------------------------------------------------------
-- Activity
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"ca000000-0000-0000-0000-000000000002","role":"authenticated"}';
set local role authenticated;

select is(
  (select count(*)::int from public.order_activity((select order_id from p10))
     where kind = 'update_posted' and actor_org_id = 'da000000-0000-0000-0000-00000000000b'),
  1,
  'the factory''s activity list shows the brand''s comment, credited to the brand'
);

select is(
  (select count(*)::int from public.order_activity((select order_id from p10))
     where kind = 'schedule_agreed'),
  2,
  'the activity list shows each side agreeing the schedule'
);

reset role;
set local request.jwt.claims = '{"sub":"ca000000-0000-0000-0000-000000000003","role":"authenticated"}';
set local role authenticated;

select is(
  (select count(*)::int from public.order_activity((select order_id from p10))),
  0,
  'a stranger''s activity list for the order is empty: the function adds no access of its own'
);

reset role;

-- ---------------------------------------------------------------------------
-- Approving from the update, with no "send for approval" in between
-- ---------------------------------------------------------------------------
-- The first step is a paying sample, still ACTIVE, and the factory has posted
-- on it (above).

set local request.jwt.claims = '{"sub":"ca000000-0000-0000-0000-000000000004","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$select public.approve_milestone((select first_step from p10), null)$$,
  '42501', NULL,
  'a brand member still cannot approve a paying step: that takes an owner'
);

reset role;
set local request.jwt.claims = '{"sub":"ca000000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;

select lives_ok(
  $$select public.approve_milestone((select first_step from p10), 'Collar confirmed, go ahead.')$$,
  'the brand owner approves an open step from the factory''s update'
);

reset role;

select is(
  (select state::text || '/' || p.state::text
     from public.order_milestones m join public.order_payments p on p.milestone_id = m.id
    where m.id = (select first_step from p10)),
  'approved/due',
  'the step is approved and its payment falls due, exactly as after "send for approval"'
);

select * from finish();
rollback;
