-- ============================================================================
-- Credits granted by the database, invites, staff adjustments (20261017000100,
-- 20261024000501, 20261024000502, 20261025000500)
-- ----------------------------------------------------------------------------
-- `pgtap23-` fixtures; every count is scoped to them.
--
-- P23 Alpha (factory) invites P23 Beta (factory), which signs up and is
-- verified: Beta gets 500 for verification, Alpha 500 for the invite.
-- P23 Gamma (factory) invited Beta later, and gets nothing. P23 Brand invites
-- a brand that joins: recorded and linked, but no credits and no discount.
-- P23 Zeta (factory) asks about 21 addresses that have accounts: each counts
-- toward its 20 a day, and the 21st gets no answer. Its owner then creates
-- P23 Zeta Two: the 20 are the person's too, so the new company asks nothing
-- more that day, while Zeta Two's other member still invites.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(63);

insert into auth.users (id, email) values
  ('c2300000-0000-0000-0000-000000000001', 'p23-reviewer@tsc-staff.com'),
  ('c2300000-0000-0000-0000-000000000002', 'owner@p23-alpha.cn'),
  ('c2300000-0000-0000-0000-000000000003', 'alpha.sales@gmail.com'),
  ('c2300000-0000-0000-0000-000000000004', 'owner@p23-gamma.cn'),
  ('c2300000-0000-0000-0000-000000000005', 'owner@p23-brand.com'),
  ('c2300000-0000-0000-0000-000000000006', 'owner@p23-delta.cn'),
  ('c2300000-0000-0000-0000-000000000007', 'owner@p23-epsilon.cn'),
  ('c2300000-0000-0000-0000-000000000010', 'owner@p23-zeta.cn'),
  ('c2300000-0000-0000-0000-000000000011', 'sales@p23-zeta-two.cn');

-- Addresses that already have accounts, for Zeta to ask about.
insert into auth.users (id, email)
select gen_random_uuid(), format('p23-probed-%s@p23-probed.cn', n) from generate_series(1, 21) n;

insert into public.platform_admins (user_id, note)
values ('c2300000-0000-0000-0000-000000000001', 'pgtap23 fixture');

insert into public.orgs (id, type, name, slug) values
  ('d2300000-0000-0000-0000-00000000000a', 'factory', 'P23 Alpha',   'pgtap23-alpha'),
  ('d2300000-0000-0000-0000-00000000000c', 'factory', 'P23 Gamma',   'pgtap23-gamma'),
  ('d2300000-0000-0000-0000-00000000000b', 'brand',   'P23 Brand',   'pgtap23-brand'),
  ('d2300000-0000-0000-0000-00000000000d', 'factory', 'P23 Delta',   'pgtap23-delta'),
  ('d2300000-0000-0000-0000-00000000000e', 'factory', 'P23 Epsilon', 'pgtap23-epsilon'),
  ('d2300000-0000-0000-0000-00000000001a', 'factory', 'P23 Zeta',    'pgtap23-zeta'),
  ('d2300000-0000-0000-0000-00000000001b', 'factory', 'P23 Zeta Two', 'pgtap23-zeta-two');

insert into public.org_members (org_id, user_id, role) values
  ('d2300000-0000-0000-0000-00000000000a', 'c2300000-0000-0000-0000-000000000002', 'owner'),
  ('d2300000-0000-0000-0000-00000000000a', 'c2300000-0000-0000-0000-000000000003', 'member'),
  ('d2300000-0000-0000-0000-00000000000c', 'c2300000-0000-0000-0000-000000000004', 'owner'),
  ('d2300000-0000-0000-0000-00000000000b', 'c2300000-0000-0000-0000-000000000005', 'owner'),
  ('d2300000-0000-0000-0000-00000000000d', 'c2300000-0000-0000-0000-000000000006', 'owner'),
  ('d2300000-0000-0000-0000-00000000000e', 'c2300000-0000-0000-0000-000000000007', 'owner'),
  ('d2300000-0000-0000-0000-00000000001a', 'c2300000-0000-0000-0000-000000000010', 'owner'),
  ('d2300000-0000-0000-0000-00000000001b', 'c2300000-0000-0000-0000-000000000010', 'owner'),
  ('d2300000-0000-0000-0000-00000000001b', 'c2300000-0000-0000-0000-000000000011', 'member');

insert into public.factory_profiles (org_id) values
  ('d2300000-0000-0000-0000-00000000000a'),
  ('d2300000-0000-0000-0000-00000000000c'),
  ('d2300000-0000-0000-0000-00000000000d');
insert into public.brand_profiles (org_id) values ('d2300000-0000-0000-0000-00000000000b');

-- Delta already had its grant written by hand (the old seed and fixtures did).
insert into public.credit_ledger (org_id, delta, reason, note)
values ('d2300000-0000-0000-0000-00000000000d', 500, 'onboarding_grant', 'p23 hand grant');

-- Gamma's business registration, for the file-level path.
insert into public.documents (id, org_id, kind, bucket, storage_path, file_name) values
  ('a2300000-0000-0000-0000-000000000001', 'd2300000-0000-0000-0000-00000000000c', 'business_registration', 'org-private',
   'd2300000-0000-0000-0000-00000000000c/business_registration/p23-reg.pdf', 'p23-reg.pdf');

-- ---------------------------------------------------------------------------
-- 1. Only staff change verification
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"c2300000-0000-0000-0000-000000000002","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$ update public.factory_profiles set verification_status = 'verified'
      where org_id = 'd2300000-0000-0000-0000-00000000000a' $$,
  '42501', null,
  'a factory cannot verify itself'
);

select lives_ok(
  $$ update public.factory_profiles set intro = 'P23 knitwear'
      where org_id = 'd2300000-0000-0000-0000-00000000000a' $$,
  'a factory can still edit the rest of its profile'
);

set local request.jwt.claims = '{"sub":"c2300000-0000-0000-0000-000000000005","role":"authenticated"}';

select throws_ok(
  $$ update public.brand_profiles set verification_status = 'verified'
      where org_id = 'd2300000-0000-0000-0000-00000000000b' $$,
  '42501', null,
  'a brand cannot verify itself'
);

set local request.jwt.claims = '{"sub":"c2300000-0000-0000-0000-000000000007","role":"authenticated"}';

insert into public.factory_profiles (org_id, verification_status)
values ('d2300000-0000-0000-0000-00000000000e', 'verified');

reset role;
set local request.jwt.claims = '{"role":"service_role"}';

select is(
  (select verification_status::text from public.factory_profiles where org_id = 'd2300000-0000-0000-0000-00000000000e'),
  'unverified',
  'a profile a member creates starts unverified, whatever it asked for'
);

select is(
  (select count(*)::int from public.credit_ledger where org_id = 'd2300000-0000-0000-0000-00000000000a'),
  0,
  'no credits before verification'
);

-- ---------------------------------------------------------------------------
-- 4. Invites
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"c2300000-0000-0000-0000-000000000002","role":"authenticated"}';
set local role authenticated;

select lives_ok(
  $$ insert into public.referrals (referrer_org_id, email, message)
     values ('d2300000-0000-0000-0000-00000000000a', ' New@P23-Beta.cn ', 'Join us') $$,
  'a factory invites another factory by email'
);

select lives_ok(
  $$ insert into public.referrals (referrer_org_id, email)
     values ('d2300000-0000-0000-0000-00000000000a', 'someone.else@gmail.com') $$,
  'a public mail domain is not "your own domain", even with a member on it'
);

select throws_ok(
  $$ insert into public.referrals (referrer_org_id, email)
     values ('d2300000-0000-0000-0000-00000000000a', 'cousin@p23-alpha.cn') $$,
  '22023', null,
  'an address on the company''s own domain is refused'
);

-- Kept and stamped rather than raised, so that it counts (20261024000502).
select lives_ok(
  $$ insert into public.referrals (referrer_org_id, email)
     values ('d2300000-0000-0000-0000-00000000000a', 'owner@p23-brand.com') $$,
  'an invite to an address that already has an account is kept, to count'
);

select ok(
  (select refused_at is not null from public.referrals
    where referrer_org_id = 'd2300000-0000-0000-0000-00000000000a' and email = 'owner@p23-brand.com'),
  'and is marked refused: the address already has an account'
);

select throws_ok(
  $$ insert into public.referrals (referrer_org_id, email)
     values ('d2300000-0000-0000-0000-00000000000a', 'owner@p23-brand.com') $$,
  '23505', 'this address already has a Sourcing Club account',
  'asking about it again gets the same answer, and no second row'
);

select throws_ok(
  $$ insert into public.referrals (referrer_org_id, email)
     values ('d2300000-0000-0000-0000-00000000000a', 'new@p23-beta.cn') $$,
  '23505', null,
  'the same pending invite twice is refused'
);

select throws_ok(
  $$ insert into public.referrals (referrer_org_id, email)
     values ('d2300000-0000-0000-0000-00000000000c', 'x@p23-other.cn') $$,
  '42501', null,
  'nobody sends invites for a company they are not in'
);

select throws_ok(
  $$ insert into public.referrals (referrer_org_id, email, referred_org_id)
     values ('d2300000-0000-0000-0000-00000000000a', 'y@p23-other.cn', 'd2300000-0000-0000-0000-00000000000d') $$,
  '42501', null,
  'a client cannot say who an invite turned into'
);

select throws_ok(
  $$ update public.referrals set referred_org_id = 'd2300000-0000-0000-0000-00000000000d'
      where referrer_org_id = 'd2300000-0000-0000-0000-00000000000a' $$,
  '42501', null,
  'a client cannot link an invite to a company'
);

select is(
  (select created_by from public.referrals where email = 'new@p23-beta.cn' and referrer_org_id = 'd2300000-0000-0000-0000-00000000000a'),
  'c2300000-0000-0000-0000-000000000002'::uuid,
  'the invite records who sent it, with the address in lower case'
);

-- Gamma invites the same factory; P23 Brand invites it too, and a brand.
set local request.jwt.claims = '{"sub":"c2300000-0000-0000-0000-000000000004","role":"authenticated"}';
insert into public.referrals (referrer_org_id, email) values ('d2300000-0000-0000-0000-00000000000c', 'new@p23-beta.cn');
set local request.jwt.claims = '{"sub":"c2300000-0000-0000-0000-000000000005","role":"authenticated"}';
insert into public.referrals (referrer_org_id, email) values ('d2300000-0000-0000-0000-00000000000b', 'new@p23-beta.cn');
insert into public.referrals (referrer_org_id, email) values ('d2300000-0000-0000-0000-00000000000b', 'owner@p23-newbrand.com');

reset role;
set local request.jwt.claims = '{"role":"service_role"}';
-- Order the three invites to Beta: the brand's first, then Alpha's, then Gamma's.
update public.referrals set created_at = now() - interval '3 hours'
 where email = 'new@p23-beta.cn' and referrer_org_id = 'd2300000-0000-0000-0000-00000000000b';
update public.referrals set created_at = now() - interval '2 hours'
 where email = 'new@p23-beta.cn' and referrer_org_id = 'd2300000-0000-0000-0000-00000000000a';
update public.referrals set created_at = now() - interval '1 hour'
 where email = 'new@p23-beta.cn' and referrer_org_id = 'd2300000-0000-0000-0000-00000000000c';

-- Twenty a day: Delta has sent 20 already.
insert into public.referrals (referrer_org_id, email)
select 'd2300000-0000-0000-0000-00000000000d', format('p23-bulk-%s@p23-bulk.cn', n) from generate_series(1, 20) n;

set local request.jwt.claims = '{"sub":"c2300000-0000-0000-0000-000000000006","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$ insert into public.referrals (referrer_org_id, email)
     values ('d2300000-0000-0000-0000-00000000000d', 'one-more@p23-bulk.cn') $$,
  '54000', null,
  'more than 20 invites in a day is refused'
);
reset role;
set local request.jwt.claims = '{"role":"service_role"}';

-- Asking about addresses that have accounts counts toward the 20 too.
set local request.jwt.claims = '{"sub":"c2300000-0000-0000-0000-000000000010","role":"authenticated"}';
set local role authenticated;
do $$
begin
  for n in 1..20 loop
    insert into public.referrals (referrer_org_id, email)
    values ('d2300000-0000-0000-0000-00000000001a', format('p23-probed-%s@p23-probed.cn', n));
  end loop;
end $$;
select throws_ok(
  $$ insert into public.referrals (referrer_org_id, email)
     values ('d2300000-0000-0000-0000-00000000001a', 'p23-probed-21@p23-probed.cn') $$,
  '54000', null,
  'the 21st question in a day about an address with an account is refused for the limit'
);
select throws_ok(
  $$ insert into public.referrals (referrer_org_id, email)
     values ('d2300000-0000-0000-0000-00000000001a', 'nobody-yet@p23-fresh.cn') $$,
  '54000', null,
  'and so is an ordinary invite that day'
);
reset role;
set local request.jwt.claims = '{"role":"service_role"}';

select is(
  (select count(*)::int from public.referrals
    where referrer_org_id = 'd2300000-0000-0000-0000-00000000001a' and refused_at is not null),
  20,
  'the twenty refused questions are on record'
);

-- A second company is not a second 20: the limit is the person's too
-- (20261025000500).
set local request.jwt.claims = '{"sub":"c2300000-0000-0000-0000-000000000010","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$ insert into public.referrals (referrer_org_id, email)
     values ('d2300000-0000-0000-0000-00000000001b', 'p23-probed-21@p23-probed.cn') $$,
  '54000', null,
  'the same person asking from a second company is refused for the limit'
);
select throws_ok(
  $$ insert into public.referrals (referrer_org_id, email)
     values ('d2300000-0000-0000-0000-00000000001b', 'nobody-yet@p23-fresh.cn') $$,
  '54000', null,
  'and so is an ordinary invite from it'
);

set local request.jwt.claims = '{"sub":"c2300000-0000-0000-0000-000000000011","role":"authenticated"}';
select lives_ok(
  $$ insert into public.referrals (referrer_org_id, email)
     values ('d2300000-0000-0000-0000-00000000001b', 'nobody-yet@p23-fresh.cn') $$,
  'another member of that company still invites: its own 20 are untouched'
);
reset role;
set local request.jwt.claims = '{"role":"service_role"}';

select is(
  (select count(*)::int from public.referrals
    where referrer_org_id = 'd2300000-0000-0000-0000-00000000001b'
      and created_by = 'c2300000-0000-0000-0000-000000000010'),
  0,
  'and the refused attempts left no row behind'
);

-- ---------------------------------------------------------------------------
-- 5. Linking at sign-up
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('c2300000-0000-0000-0000-000000000008', 'new@p23-beta.cn'),
  ('c2300000-0000-0000-0000-000000000009', 'owner@p23-newbrand.com');

set local request.jwt.claims = '{"sub":"c2300000-0000-0000-0000-000000000008","role":"authenticated"}';
set local role authenticated;
select lives_ok($$ select public.create_org('P23 Beta', 'factory') $$, 'the invited factory signs up');

-- The brand owner Alpha asked about starts a factory: a refused invite is
-- never linked.
set local request.jwt.claims = '{"sub":"c2300000-0000-0000-0000-000000000005","role":"authenticated"}';
select lives_ok($$ select public.create_org('P23 Brand Mill', 'factory') $$, 'an existing account starts a factory');
set local request.jwt.claims = '{"sub":"c2300000-0000-0000-0000-000000000009","role":"authenticated"}';
select lives_ok($$ select public.create_org('P23 New Brand', 'brand') $$, 'the invited brand signs up');
reset role;
set local request.jwt.claims = '{"role":"service_role"}';

create temporary table p23 as
select (select id from public.orgs where name = 'P23 Beta')      as beta,
       (select id from public.orgs where name = 'P23 New Brand') as newbrand;
grant select on p23 to authenticated;

select is(
  (select referrer_org_id from public.referrals where referred_org_id = (select beta from p23)),
  'd2300000-0000-0000-0000-00000000000a'::uuid,
  'the factory is linked to the earliest FACTORY invite (the brand''s earlier one is another kind)'
);

select is(
  (select count(*)::int from public.referrals
    where email = 'new@p23-beta.cn' and referred_org_id is null),
  2,
  'the later factory invite and the brand''s invite stay unlinked'
);

select ok(
  (select accepted_at is not null from public.referrals where referred_org_id = (select beta from p23)),
  'the linked invite is marked accepted'
);

select is(
  (select count(*)::int from public.notifications
    where org_id = 'd2300000-0000-0000-0000-00000000000a' and kind = 'referral_joined'),
  1,
  'the inviter is told the factory joined'
);

select is(
  (select referrer_org_id from public.referrals where referred_org_id = (select newbrand from p23)),
  'd2300000-0000-0000-0000-00000000000b'::uuid,
  'a brand invite is linked too'
);

select is(
  (select referred_org_id from public.referrals
    where referrer_org_id = 'd2300000-0000-0000-0000-00000000000a' and email = 'owner@p23-brand.com'),
  null,
  'a refused invite is never linked, even when that account starts a factory'
);

-- A second member joining Beta later is not a sign-up.
insert into public.org_members (org_id, user_id, role)
values ((select beta from p23), 'c2300000-0000-0000-0000-000000000004', 'member');
select is(
  (select count(*)::int from public.referrals where referrer_org_id = 'd2300000-0000-0000-0000-00000000000c' and referred_org_id is not null),
  0,
  'joining an existing company links nothing'
);
delete from public.org_members where org_id = (select beta from p23) and user_id = 'c2300000-0000-0000-0000-000000000004';

insert into public.factory_profiles (org_id) select beta from p23;
insert into public.brand_profiles (org_id) select newbrand from p23;

-- ---------------------------------------------------------------------------
-- 2 + 6. Granted on verification, once
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"c2300000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;

select lives_ok(
  $$ select public.admin_review_decision('d2300000-0000-0000-0000-00000000000a', 'approved') $$,
  'staff approve Alpha'
);

reset role;
set local request.jwt.claims = '{"role":"service_role"}';

select is(
  (select coalesce(sum(delta), 0)::int from public.credit_ledger
    where org_id = 'd2300000-0000-0000-0000-00000000000a' and reason = 'onboarding_grant'),
  500,
  'verification grants 500 credits'
);

select is(
  (select ref_id from public.credit_ledger
    where org_id = 'd2300000-0000-0000-0000-00000000000a' and reason = 'onboarding_grant'),
  'd2300000-0000-0000-0000-00000000000a'::uuid,
  'the grant points at the company'
);

select is(
  (select count(*)::int from public.notifications
    where org_id = 'd2300000-0000-0000-0000-00000000000a' and kind = 'credits_granted' and subject_type = 'credits'),
  1,
  'the factory is notified of its credits'
);

set local request.jwt.claims = '{"sub":"c2300000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
do $$ begin perform public.admin_review_decision('d2300000-0000-0000-0000-00000000000a', 'declined', 'p23 test'); end $$;
do $$ begin perform public.admin_review_decision('d2300000-0000-0000-0000-00000000000a', 'approved'); end $$;
reset role;
set local request.jwt.claims = '{"role":"service_role"}';

select is(
  (select coalesce(sum(delta), 0)::int from public.credit_ledger where org_id = 'd2300000-0000-0000-0000-00000000000a'),
  500,
  'declined then verified again: still one grant'
);

set local request.jwt.claims = '{"sub":"c2300000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select lives_ok(
  $$ select public.review_document('a2300000-0000-0000-0000-000000000001', 'verified', null) $$,
  'staff verify Gamma''s business registration'
);
do $$ begin perform public.admin_review_decision('d2300000-0000-0000-0000-00000000000d', 'approved'); end $$;
do $$ begin perform public.admin_review_decision('d2300000-0000-0000-0000-00000000000b', 'approved'); end $$;
reset role;
set local request.jwt.claims = '{"role":"service_role"}';

select is(
  (select coalesce(sum(delta), 0)::int from public.credit_ledger where org_id = 'd2300000-0000-0000-0000-00000000000c'),
  500,
  'verifying the business registration grants the 500 too'
);

select is(
  (select coalesce(sum(delta), 0)::int from public.credit_ledger where org_id = 'd2300000-0000-0000-0000-00000000000d'),
  500,
  'a company that already had its grant written by hand gets no second one'
);

select is(
  (select count(*)::int from public.credit_ledger where org_id = 'd2300000-0000-0000-0000-00000000000b'),
  0,
  'a verified brand gets no credits'
);

-- Beta, the invited factory, is verified.
set local request.jwt.claims = '{"sub":"c2300000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
do $$ begin perform public.admin_review_decision((select beta from p23), 'approved'); end $$;
reset role;
set local request.jwt.claims = '{"role":"service_role"}';

select is(
  (select coalesce(sum(delta), 0)::int from public.credit_ledger where org_id = (select beta from p23)),
  500,
  'the invited factory gets its 500 for verification'
);

select is(
  (select coalesce(sum(delta), 0)::int from public.credit_ledger
    where org_id = 'd2300000-0000-0000-0000-00000000000a' and reason = 'referral_grant' and ref_id = (select beta from p23)),
  500,
  'the factory that invited it earns 500'
);

select ok(
  (select rewarded_at is not null from public.referrals where referred_org_id = (select beta from p23)),
  'the invite is marked rewarded'
);

select is(
  (select count(*)::int from public.notifications
    where org_id = 'd2300000-0000-0000-0000-00000000000a' and kind = 'referral_rewarded'),
  1,
  'the inviter is told it earned the credits'
);

select is(
  (select count(*)::int from public.credit_ledger where org_id = 'd2300000-0000-0000-0000-00000000000c' and reason = 'referral_grant'),
  0,
  'the later inviter earns nothing'
);

set local request.jwt.claims = '{"sub":"c2300000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
do $$ begin perform public.admin_review_decision((select beta from p23), 'declined', 'p23 test'); end $$;
do $$ begin perform public.admin_review_decision((select beta from p23), 'approved'); end $$;
do $$ begin perform public.admin_review_decision((select newbrand from p23), 'approved'); end $$;
reset role;
set local request.jwt.claims = '{"role":"service_role"}';

select is(
  (select count(*)::int from public.credit_ledger
    where org_id = 'd2300000-0000-0000-0000-00000000000a' and reason = 'referral_grant'),
  1,
  'verified again: the inviter is still paid once'
);

select is(
  (select count(*)::int from public.credit_ledger where org_id = 'd2300000-0000-0000-0000-00000000000b')
  + (select count(*)::int from public.discount_codes where owner_org_id = 'd2300000-0000-0000-0000-00000000000b'),
  0,
  'a brand whose invited brand is verified earns nothing yet: no credits, no discount'
);

-- ---------------------------------------------------------------------------
-- 7. Staff adjustment
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"c2300000-0000-0000-0000-000000000002","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$ select public.admin_adjust_credits('d2300000-0000-0000-0000-00000000000a', 100, 'I would like more') $$,
  '42501', null,
  'a factory cannot adjust its own credits'
);

set local request.jwt.claims = '{"sub":"c2300000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok(
  $$ select public.admin_adjust_credits('d2300000-0000-0000-0000-00000000000a', 100, '  ') $$,
  '22023', null,
  'an adjustment needs a reason'
);
select throws_ok(
  $$ select public.admin_adjust_credits('d2300000-0000-0000-0000-00000000000a', 0, 'Nothing at all') $$,
  '22023', null,
  'an adjustment of 0 is refused'
);
select throws_ok(
  $$ select public.admin_adjust_credits('d2300000-0000-0000-0000-00000000000b', 100, 'Goodwill for a brand') $$,
  '22023', null,
  'credits are adjusted for factories only'
);
select throws_ok(
  $$ select public.admin_adjust_credits('d2300000-0000-0000-0000-00000000000a', -1001, 'Remove too many') $$,
  '22023', null,
  'staff cannot take a balance below zero'
);
select is(
  public.admin_adjust_credits('d2300000-0000-0000-0000-00000000000a', 50, 'Goodwill for a slow review'),
  1050,
  'staff add 50 credits and get the new balance'
);
select is(
  public.admin_adjust_credits('d2300000-0000-0000-0000-00000000000a', -1050, 'Closing the test account'),
  0,
  'staff remove credits down to zero'
);
reset role;
set local request.jwt.claims = '{"role":"service_role"}';

-- Epsilon spent credits it then had refunded: it stands at -300.
insert into public.credit_ledger (org_id, delta, reason, note)
values ('d2300000-0000-0000-0000-00000000000e',
        -300 - public.credit_balance('d2300000-0000-0000-0000-00000000000e'), 'refund', 'p23 refund after spending');

set local request.jwt.claims = '{"sub":"c2300000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select is(
  public.admin_adjust_credits('d2300000-0000-0000-0000-00000000000e', 100, 'Goodwill top-up'),
  -200,
  'staff add credits to a company below zero (20261024000501)'
);
select throws_ok(
  $$ select public.admin_adjust_credits('d2300000-0000-0000-0000-00000000000e', -1, 'Remove one more') $$,
  '22023', null,
  'but cannot remove any from a company below zero'
);
reset role;
set local request.jwt.claims = '{"role":"service_role"}';

select is(
  (select created_by from public.credit_ledger
    where org_id = 'd2300000-0000-0000-0000-00000000000a' and reason = 'admin_adjustment' and delta = 50),
  'c2300000-0000-0000-0000-000000000001'::uuid,
  'the ledger records which staff member adjusted it'
);
select is(
  (select body from public.notifications
    where org_id = 'd2300000-0000-0000-0000-00000000000a' and kind = 'credits_adjusted' and title = 'TSC added 50 credits'),
  'Goodwill for a slow review',
  'the factory is told, with the reason'
);

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
select ok(
  not has_function_privilege('anon', 'public.admin_adjust_credits(uuid, integer, text)', 'execute'),
  'anon cannot call the adjustment'
);
select ok(
  not has_function_privilege('authenticated', 'public.grant_verification_credits()', 'execute')
  and not has_function_privilege('authenticated', 'public.link_referral_on_signup()', 'execute')
  and not has_function_privilege('authenticated', 'public.guard_referral_insert()', 'execute'),
  'the trigger functions are not callable by clients'
);

select * from finish();
rollback;
