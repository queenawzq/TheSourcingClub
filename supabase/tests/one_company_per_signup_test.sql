-- ============================================================================
-- create_org gives back the company a person just made, and nobody else's
-- (20261106500000). `pgtap-occ-` fixtures, every count scoped to them.
-- Mostly negative: the guard must NOT hand over a stranger's company, must NOT
-- stop a person making a genuinely different one.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(13);

insert into auth.users (id, email) values
  ('fa010000-0000-0000-0000-000000000001', 'occ-one@example.com'),
  ('fa010000-0000-0000-0000-000000000002', 'occ-two@example.com'),
  ('fa010000-0000-0000-0000-000000000003', 'occ-member@example.com');

-- A company someone else owns, which person 3 is only a member of.
insert into public.orgs (id, type, name, slug) values
  ('fa020000-0000-0000-0000-000000000001', 'factory', 'OCC Member Mill', 'pgtap-occ-member-mill');
insert into public.org_members (org_id, user_id, role) values
  ('fa020000-0000-0000-0000-000000000001', 'fa010000-0000-0000-0000-000000000002', 'owner'),
  ('fa020000-0000-0000-0000-000000000001', 'fa010000-0000-0000-0000-000000000003', 'member');

set local role authenticated;
set local request.jwt.claims = '{"sub":"fa010000-0000-0000-0000-000000000001","role":"authenticated"}';

create temporary table occ_first on commit drop as
  select * from public.create_org('OCC 湖南春天', 'factory');
grant select on occ_first to authenticated;

select is(
  (public.create_org('OCC 湖南春天', 'factory')).id,
  (select id from occ_first),
  'the same person, name and kind gets the same company back'
);
select is(
  (public.create_org('occ 湖南春天', 'factory')).id,
  (select id from occ_first),
  'capitals do not make a second company'
);
select is(
  (public.create_org(E'  OCC 湖南春天　', 'factory')).id,
  (select id from occ_first),
  'spaces around it, ideographic ones too, do not make a second company'
);
select is(
  (select count(*) from public.org_members m join public.orgs o on o.id = m.org_id
    where m.user_id = 'fa010000-0000-0000-0000-000000000001' and o.name like '%湖南春天%'),
  1::bigint,
  'after all that, one company'
);
select isnt(
  (public.create_org('OCC 湖南春天', 'brand')).id,
  (select id from occ_first),
  'the other kind is a different company'
);
select isnt(
  (public.create_org('OCC Second Mill', 'factory')).id,
  (select id from occ_first),
  'a different name is a different company'
);

-- Someone else asking for the same name.
set local request.jwt.claims = '{"sub":"fa010000-0000-0000-0000-000000000002","role":"authenticated"}';
select isnt(
  (public.create_org('OCC 湖南春天', 'factory')).id,
  (select id from occ_first),
  'another person NEVER gets someone else''s company back'
);
select ok(
  (select not exists (
    select 1 from public.org_members m
    where m.org_id = (select id from occ_first)
      and m.user_id = 'fa010000-0000-0000-0000-000000000002')),
  'and is NOT made a member of it'
);

-- A member of a company with that name, starting their own.
set local request.jwt.claims = '{"sub":"fa010000-0000-0000-0000-000000000003","role":"authenticated"}';
select isnt(
  (public.create_org('OCC Member Mill', 'factory')).id,
  'fa020000-0000-0000-0000-000000000001'::uuid,
  'being a member of a company does not count as owning it'
);

reset role;

-- Person 1 removed from the company, then asking again: they start afresh.
set local session_replication_role = replica;
delete from public.org_members
  where org_id = (select id from occ_first) and user_id = 'fa010000-0000-0000-0000-000000000001';
set local session_replication_role = origin;

set local role authenticated;
set local request.jwt.claims = '{"sub":"fa010000-0000-0000-0000-000000000001","role":"authenticated"}';
select isnt(
  (public.create_org('OCC 湖南春天', 'factory')).id,
  (select id from occ_first),
  'someone who is no longer in the company does NOT get it back'
);
reset role;

-- Eleven minutes later a second one of that name is on purpose.
update public.orgs set created_at = now() - interval '11 minutes'
  where name = 'OCC Second Mill';
set local role authenticated;
select is(
  (select count(*) from (select public.create_org('OCC Second Mill', 'factory')) made),
  1::bigint,
  'after the 10 minutes a call makes a company'
);
select is(
  (select count(*) from public.org_members m join public.orgs o on o.id = m.org_id
    where m.user_id = 'fa010000-0000-0000-0000-000000000001' and o.name = 'OCC Second Mill'),
  2::bigint,
  'so two exist, the second deliberately'
);

-- Signed out, and the refusals before the lookup, are as they were.
reset role;
set local role anon;
select throws_ok(
  $$select public.create_org('OCC Anon', 'factory')$$,
  '42501',
  null,
  'a signed-out visitor CANNOT create a company'
);
reset role;

select * from finish();
rollback;
