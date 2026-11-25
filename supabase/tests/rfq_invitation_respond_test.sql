-- ============================================================================
-- A factory answers its own request invitation and cannot move it
-- (20261125600000). Prefix `pgtap-rfqinv-`, every count scoped to these
-- fixtures.
--
-- The attack: a factory invited once sets rfq_id on its invitation to another
-- brand's invite-only request and is then treated as invited there.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(15);

insert into auth.users (id, email) values
  ('c7000000-0000-0000-0000-000000000001', 'rfqinv-brand-a@example.com'),
  ('c7000000-0000-0000-0000-000000000002', 'rfqinv-brand-b@example.com'),
  ('c7000000-0000-0000-0000-000000000003', 'rfqinv-factory@example.com');

insert into public.orgs (id, type, name, slug) values
  ('d7000000-0000-0000-0000-00000000000a', 'brand',   'RfqInv Brand A', 'pgtap-rfqinv-brand-a'),
  ('d7000000-0000-0000-0000-00000000000b', 'brand',   'RfqInv Brand B', 'pgtap-rfqinv-brand-b'),
  ('d7000000-0000-0000-0000-0000000000f1', 'factory', 'RfqInv Factory', 'pgtap-rfqinv-factory');

insert into public.org_members (org_id, user_id, role, permissions) values
  ('d7000000-0000-0000-0000-00000000000a', 'c7000000-0000-0000-0000-000000000001', 'owner', null),
  ('d7000000-0000-0000-0000-00000000000b', 'c7000000-0000-0000-0000-000000000002', 'owner', null),
  ('d7000000-0000-0000-0000-0000000000f1', 'c7000000-0000-0000-0000-000000000003', 'owner', null);

insert into public.factory_profiles (org_id, country_code, moq, published_at, verification_status) values
  ('d7000000-0000-0000-0000-0000000000f1', 'PT', 100, now(), 'verified');

insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total) values
  ('e7000000-0000-0000-0000-000000000001', 'd7000000-0000-0000-0000-00000000000a',
   'Brand A, factory invited', 'open',  'invited_only', 300),
  ('e7000000-0000-0000-0000-000000000002', 'd7000000-0000-0000-0000-00000000000b',
   'Brand B, invite only',     'open',  'invited_only', 300),
  ('e7000000-0000-0000-0000-000000000003', 'd7000000-0000-0000-0000-00000000000b',
   'Brand B, draft',           'draft', 'invited_only', 300);

insert into public.rfq_invitations (id, rfq_id, factory_org_id) values
  ('f7000000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-000000000001',
   'd7000000-0000-0000-0000-0000000000f1');

-- ---------------------------------------------------------------------------
-- The grant itself
-- ---------------------------------------------------------------------------

select ok(
  not has_column_privilege('authenticated', 'public.rfq_invitations', 'rfq_id', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.rfq_invitations', 'factory_org_id', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.rfq_invitations', 'matching_acknowledged', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.rfq_invitations', 'invited_by', 'UPDATE'),
  'signed-in users hold no UPDATE on which request, which factory, who invited or the matching acknowledgement'
);

select ok(
  has_column_privilege('authenticated', 'public.rfq_invitations', 'status', 'UPDATE')
  and has_column_privilege('authenticated', 'public.rfq_invitations', 'viewed_at', 'UPDATE'),
  'signed-in users may still update status and viewed_at'
);

-- ---------------------------------------------------------------------------
-- The factory
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"c7000000-0000-0000-0000-000000000003","email":"rfqinv-factory@example.com","role":"authenticated"}';
set local role authenticated;

select is(
  (select count(*)::int from public.rfqs where id = 'e7000000-0000-0000-0000-000000000002'),
  0,
  'before: the factory cannot read Brand B''s invite-only request'
);

select throws_ok(
  $$ update public.rfq_invitations set rfq_id = 'e7000000-0000-0000-0000-000000000002'
      where id = 'f7000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'a factory CANNOT move its invitation onto another brand''s request'
);

select throws_ok(
  $$ update public.rfq_invitations set rfq_id = 'e7000000-0000-0000-0000-000000000003'
      where id = 'f7000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'a factory CANNOT move its invitation onto another brand''s draft'
);

select throws_ok(
  $$ update public.rfq_invitations set factory_org_id = 'd7000000-0000-0000-0000-0000000000f1'
      where id = 'f7000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'a factory CANNOT write which factory the invitation is for'
);

select throws_ok(
  $$ update public.rfq_invitations set matching_acknowledged = true
      where id = 'f7000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'a factory CANNOT write the brand''s matching acknowledgement'
);

select is(
  (select count(*)::int from public.rfqs
    where id in ('e7000000-0000-0000-0000-000000000002', 'e7000000-0000-0000-0000-000000000003')),
  0,
  'after the attempts: Brand B''s invite-only request and draft stay unreadable'
);

select is(
  (select rfq_id from public.rfq_invitations where id = 'f7000000-0000-0000-0000-000000000001'),
  'e7000000-0000-0000-0000-000000000001'::uuid,
  'the invitation is still on Brand A''s request'
);

select lives_ok(
  $$ update public.rfq_invitations set status = 'viewed', viewed_at = now()
      where id = 'f7000000-0000-0000-0000-000000000001' $$,
  'a factory CAN still mark its invitation viewed'
);

select lives_ok(
  $$ update public.rfq_invitations set status = 'declined'
      where id = 'f7000000-0000-0000-0000-000000000001' $$,
  'a factory CAN still decline its invitation'
);

select is(
  (select status::text from public.rfq_invitations where id = 'f7000000-0000-0000-0000-000000000001'),
  'declined',
  'the factory''s answer is saved'
);

-- ---------------------------------------------------------------------------
-- The brand's own writes are unchanged
-- ---------------------------------------------------------------------------

reset role;
set local request.jwt.claims = '{"sub":"c7000000-0000-0000-0000-000000000002","email":"rfqinv-brand-b@example.com","role":"authenticated"}';
set local role authenticated;

select lives_ok(
  $$ insert into public.rfq_invitations (rfq_id, factory_org_id)
     values ('e7000000-0000-0000-0000-000000000002', 'd7000000-0000-0000-0000-0000000000f1') $$,
  'a brand CAN still invite a factory'
);

select lives_ok(
  $$ insert into public.rfq_invitations (rfq_id, factory_org_id)
     values ('e7000000-0000-0000-0000-000000000002', 'd7000000-0000-0000-0000-0000000000f1')
     on conflict (rfq_id, factory_org_id) do nothing $$,
  'a brand''s repeat invite (upsert ignoring duplicates) still works'
);

select lives_ok(
  $$ delete from public.rfq_invitations
      where rfq_id = 'e7000000-0000-0000-0000-000000000002'
        and factory_org_id = 'd7000000-0000-0000-0000-0000000000f1' $$,
  'a brand CAN still withdraw an invitation'
);

select * from finish();
rollback;
