-- ============================================================================
-- Cancelling a request, and the files attached to one
-- ----------------------------------------------------------------------------
-- Eighth suite, `pgtap8-` prefixed, every assertion scoped to its fixtures.
--
-- Cancelling used to be a plain update any brand member could make from any
-- status, and a request's files were unreadable to the vendors asked to quote
-- from them. Both are places where a policy that is too loose passes every
-- positive test, so most of what follows is refusals.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(20);

insert into auth.users (id, email) values
  ('c8000000-0000-0000-0000-000000000001', 'p8-owner@example.com'),
  ('c8000000-0000-0000-0000-000000000002', 'p8-invited@example.com'),
  ('c8000000-0000-0000-0000-000000000003', 'p8-stranger@example.com'),
  ('c8000000-0000-0000-0000-000000000004', 'p8-member@example.com');

insert into public.orgs (id, type, name, slug) values
  ('d8000000-0000-0000-0000-00000000000b', 'brand',   'P8 Brand',    'pgtap8-brand'),
  ('d8000000-0000-0000-0000-0000000000f1', 'factory', 'P8 Invited',  'pgtap8-invited'),
  ('d8000000-0000-0000-0000-0000000000f2', 'factory', 'P8 Stranger', 'pgtap8-stranger');

insert into public.org_members (org_id, user_id, role) values
  ('d8000000-0000-0000-0000-00000000000b', 'c8000000-0000-0000-0000-000000000001', 'owner'),
  ('d8000000-0000-0000-0000-00000000000b', 'c8000000-0000-0000-0000-000000000004', 'member'),
  ('d8000000-0000-0000-0000-0000000000f1', 'c8000000-0000-0000-0000-000000000002', 'owner'),
  ('d8000000-0000-0000-0000-0000000000f2', 'c8000000-0000-0000-0000-000000000003', 'owner');

insert into public.factory_profiles (org_id, country_code, moq, published_at, verification_status) values
  ('d8000000-0000-0000-0000-0000000000f1', 'PT', 100, now(), 'verified'),
  ('d8000000-0000-0000-0000-0000000000f2', 'PT', 100, now(), 'verified');

-- An invite-only open request with a sent quote, and one already awarded.
insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total, published_at) values
  ('e8000000-0000-0000-0000-000000000001', 'd8000000-0000-0000-0000-00000000000b',
   'P8 open request', 'open', 'invited_only', 300, now()),
  ('e8000000-0000-0000-0000-000000000002', 'd8000000-0000-0000-0000-00000000000b',
   'P8 awarded request', 'awarded', 'invited_only', 300, now()),
  -- Open to every vendor; the stranger quotes on it without an invitation.
  ('e8000000-0000-0000-0000-000000000003', 'd8000000-0000-0000-0000-00000000000b',
   'P8 public request', 'open', 'open_to_all', 300, now());

insert into public.rfq_invitations (rfq_id, factory_org_id) values
  ('e8000000-0000-0000-0000-000000000001', 'd8000000-0000-0000-0000-0000000000f1');

insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity, submitted_at)
values ('f8000000-0000-0000-0000-000000000001', 'e8000000-0000-0000-0000-000000000001',
        'd8000000-0000-0000-0000-0000000000f1', 'submitted', 2000, 300, now()),
       ('f8000000-0000-0000-0000-000000000002', 'e8000000-0000-0000-0000-000000000003',
        'd8000000-0000-0000-0000-0000000000f2', 'submitted', 2100, 300, now());

-- The brand's tech pack, filed under the request so storage can check it.
insert into public.documents (id, org_id, kind, bucket, storage_path, file_name, rfq_id) values
  ('a8000000-0000-0000-0000-000000000001', 'd8000000-0000-0000-0000-00000000000b', 'tech_pack', 'org-private',
   'd8000000-0000-0000-0000-00000000000b/tech_pack/e8000000-0000-0000-0000-000000000001/p8-techpack.pdf',
   'p8-techpack.pdf', 'e8000000-0000-0000-0000-000000000001');

insert into storage.objects (bucket_id, name) values
  ('org-private', 'd8000000-0000-0000-0000-00000000000b/tech_pack/e8000000-0000-0000-0000-000000000001/p8-techpack.pdf'),
  -- An older upload with no request in its path: the policy must not trip on it.
  ('org-private', 'd8000000-0000-0000-0000-00000000000b/tech_pack/p8-legacy.pdf');

-- The stranger factory's own file, which it will try to pin to the brand's request.
insert into public.documents (id, org_id, kind, bucket, storage_path, file_name) values
  ('a8000000-0000-0000-0000-000000000002', 'd8000000-0000-0000-0000-0000000000f2', 'tech_pack', 'org-private',
   'd8000000-0000-0000-0000-0000000000f2/tech_pack/p8-planted.pdf', 'p8-planted.pdf');

-- ---------------------------------------------------------------------------
-- Files attached to a request
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"c8000000-0000-0000-0000-000000000002","email":"p8-invited@example.com","role":"authenticated"}';
set local role authenticated;

select is(
  (select count(*)::int from public.documents where id = 'a8000000-0000-0000-0000-000000000001'),
  1,
  'an invited vendor can see the tech pack on the request it was asked to quote'
);

select is(
  (select count(*)::int from storage.objects
    where name = 'd8000000-0000-0000-0000-00000000000b/tech_pack/e8000000-0000-0000-0000-000000000001/p8-techpack.pdf'),
  1,
  'and can open the file itself, not just its row'
);

select is(
  (select count(*)::int from storage.objects where name = 'd8000000-0000-0000-0000-00000000000b/tech_pack/p8-legacy.pdf'),
  0,
  'a file not filed under a request stays private, and does not break the policy'
);

set local request.jwt.claims = '{"sub":"c8000000-0000-0000-0000-000000000003","email":"p8-stranger@example.com","role":"authenticated"}';

select is(
  (select count(*)::int from public.documents where id = 'a8000000-0000-0000-0000-000000000001'),
  0,
  'a vendor that was NOT invited cannot see the tech pack'
);

select is(
  (select count(*)::int from storage.objects
    where name = 'd8000000-0000-0000-0000-00000000000b/tech_pack/e8000000-0000-0000-0000-000000000001/p8-techpack.pdf'),
  0,
  'nor open the file'
);

select throws_ok(
  $$update public.documents set rfq_id = 'e8000000-0000-0000-0000-000000000001'
     where id = 'a8000000-0000-0000-0000-000000000002'$$, '42501',
  null, 'a vendor cannot pin its own file onto a brand''s request'
);

select throws_ok(
  $$insert into public.documents (org_id, kind, bucket, storage_path, file_name, rfq_id)
    values ('d8000000-0000-0000-0000-0000000000f2', 'tech_pack', 'org-private',
            'd8000000-0000-0000-0000-0000000000f2/tech_pack/p8-planted-2.pdf', 'p8-planted-2.pdf',
            'e8000000-0000-0000-0000-000000000001')$$, '42501',
  null, 'not on insert either'
);

-- ---------------------------------------------------------------------------
-- Cancelling
-- ---------------------------------------------------------------------------

select throws_ok(
  $$select public.cancel_rfq('e8000000-0000-0000-0000-000000000001')$$, '42501',
  null, 'a vendor cannot cancel a brand''s request'
);

-- A brand MEMBER, not an owner.
set local request.jwt.claims = '{"sub":"c8000000-0000-0000-0000-000000000004","email":"p8-member@example.com","role":"authenticated"}';

select throws_ok(
  $$select public.cancel_rfq('e8000000-0000-0000-0000-000000000001')$$, '42501',
  null, 'a brand member who is not an owner cannot cancel'
);

select throws_ok(
  $$update public.rfqs set status = 'cancelled' where id = 'e8000000-0000-0000-0000-000000000001'$$, '42501',
  null, 'nor cancel it with a direct update (the policy no longer allows it)'
);

select throws_ok(
  $$select public.cancel_rfq('e8000000-0000-0000-0000-0000000000ff')$$, '42501',
  null, 'an unknown request is refused exactly like someone else''s'
);

set local request.jwt.claims = '{"sub":"c8000000-0000-0000-0000-000000000001","email":"p8-owner@example.com","role":"authenticated"}';

select throws_ok(
  $$update public.rfqs set status = 'cancelled' where id = 'e8000000-0000-0000-0000-000000000001'$$, '42501',
  null, 'even the owner cannot cancel with a direct update'
);

select throws_ok(
  $$select public.cancel_rfq('e8000000-0000-0000-0000-000000000002')$$, '22023',
  null, 'an awarded request cannot be cancelled here — its order has its own cancellation'
);

select lives_ok(
  $$select public.cancel_rfq('e8000000-0000-0000-0000-000000000001', 'Style dropped from the line')$$,
  'the owner cancels an open request'
);

select lives_ok(
  $$select public.cancel_rfq('e8000000-0000-0000-0000-000000000003')$$,
  'and a public one'
);

-- The vendor that quoted on the public request, uninvited.
set local request.jwt.claims = '{"sub":"c8000000-0000-0000-0000-000000000003","email":"p8-stranger@example.com","role":"authenticated"}';

select is(
  (select status::text from public.rfqs where id = 'e8000000-0000-0000-0000-000000000003'),
  'cancelled',
  'a vendor that quoted on a public request can still read it once cancelled, and sees why its quote closed'
);

reset role;

select is(
  (select status::text from public.rfqs where id = 'e8000000-0000-0000-0000-000000000001'),
  'cancelled',
  'the request is cancelled'
);

select is(
  (select status::text from public.quotes where id = 'f8000000-0000-0000-0000-000000000001'),
  'declined',
  'and the quote sent on it is closed, not left looking live'
);

select is(
  (select count(*)::int from public.notifications
    where subject_id = 'e8000000-0000-0000-0000-000000000001' and kind = 'rfq_cancelled'
      and org_id = 'd8000000-0000-0000-0000-0000000000f1' and body = 'Style dropped from the line'),
  1,
  'the invited vendor is told, once, with the brand''s reason'
);

select is(
  (select count(*)::int from public.notifications
    where subject_id = 'e8000000-0000-0000-0000-000000000001' and kind = 'rfq_cancelled'
      and org_id = 'd8000000-0000-0000-0000-0000000000f2'),
  0,
  'a vendor that was never involved is not'
);

select * from finish();
rollback;
