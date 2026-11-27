-- ============================================================================
-- An invitation's email is claimed before it is sent, and counted
-- (20261127300000, security audit TSC-11). Prefix `pgtap-invsend-`, every
-- count scoped to these fixtures.
--
-- The attack: invite any address, then press Resend many times at once (all
-- read the same old stamp) or once every ten minutes for ever.
-- Pressing at the same moment needs two sessions: the smoke test does that
-- through the route.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(17);

insert into auth.users (id, email) values
  ('c9180000-0000-0000-0000-000000000001', 'invsend-owner@example.com'),
  ('c9180000-0000-0000-0000-000000000002', 'invsend-member@example.com');

insert into public.orgs (id, type, name, slug) values
  ('d9180000-0000-0000-0000-0000000000b1', 'brand', 'InvSend Brand', 'pgtap-invsend-brand');
insert into public.org_members (org_id, user_id, role, permissions) values
  ('d9180000-0000-0000-0000-0000000000b1', 'c9180000-0000-0000-0000-000000000001', 'owner', '{}'),
  ('d9180000-0000-0000-0000-0000000000b1', 'c9180000-0000-0000-0000-000000000002', 'member', '{rfqFlow}');

-- ---------------------------------------------------------------------------
-- What a signed-in user can reach
-- ---------------------------------------------------------------------------

select ok(
  not has_table_privilege('authenticated', 'public.org_invitation_sends', 'SELECT')
  and not has_table_privilege('authenticated', 'public.org_invitation_sends', 'INSERT')
  and not has_table_privilege('authenticated', 'public.org_invitation_sends', 'DELETE'),
  'signed-in users cannot read or write the record of sends'
);

select ok(
  not has_function_privilege('authenticated', 'public.release_invitation_email(uuid, timestamptz)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.release_invitation_email(uuid, timestamptz)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.invitation_emails_today(text)', 'EXECUTE'),
  'nor give a claim back, or count an address''s emails'
);

select ok(
  not has_column_privilege('authenticated', 'public.org_invitations', 'email_claimed_at', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.org_invitations', 'email_claimed_at', 'INSERT')
  and not has_column_privilege('authenticated', 'public.org_invitations', 'emailed_at', 'UPDATE'),
  'nor write the claim or the emailed stamp'
);

-- ---------------------------------------------------------------------------
-- One invitation
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"c9180000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;

insert into public.org_invitations (org_id, email, invited_name)
values ('d9180000-0000-0000-0000-0000000000b1', 'invsend-stranger@outside.example.net', 'Stranger');

select lives_ok(
  $$ select public.resend_invitation((select id from public.org_invitations where email = 'invsend-stranger@outside.example.net')) $$,
  'an invitation never emailed can be sent again'
);

select throws_ok(
  $$ select public.resend_invitation((select id from public.org_invitations where email = 'invsend-stranger@outside.example.net')) $$,
  '54000', 'This invitation was emailed a few minutes ago. Try again in 10 minutes.',
  'a second resend straight after is refused, before the server has stamped the email'
);

reset role;

select is(
  (select (email_claimed_at is not null)::text || ' / ' || (emailed_at is null)::text
     from public.org_invitations where email = 'invsend-stranger@outside.example.net'),
  'true / true',
  'the claim is what refused it: nothing has stamped emailed_at'
);

-- Ten minutes pass, twice: the second and third resends.
update public.org_invitation_sends set claimed_at = claimed_at - interval '11 minutes'
 where email = 'invsend-stranger@outside.example.net';
update public.org_invitations set email_claimed_at = email_claimed_at - interval '11 minutes'
 where email = 'invsend-stranger@outside.example.net';
set local role authenticated;
select lives_ok(
  $$ select public.resend_invitation((select id from public.org_invitations where email = 'invsend-stranger@outside.example.net')) $$,
  'ten minutes later it can be sent again'
);
reset role;

update public.org_invitation_sends set claimed_at = claimed_at - interval '11 minutes'
 where email = 'invsend-stranger@outside.example.net';
update public.org_invitations set email_claimed_at = email_claimed_at - interval '11 minutes'
 where email = 'invsend-stranger@outside.example.net';
set local role authenticated;
select lives_ok(
  $$ select public.resend_invitation((select id from public.org_invitations where email = 'invsend-stranger@outside.example.net')) $$,
  'and ten minutes after that'
);
reset role;

update public.org_invitation_sends set claimed_at = claimed_at - interval '11 minutes'
 where email = 'invsend-stranger@outside.example.net';
update public.org_invitations set email_claimed_at = email_claimed_at - interval '11 minutes'
 where email = 'invsend-stranger@outside.example.net';
set local role authenticated;
select throws_ok(
  $$ select public.resend_invitation((select id from public.org_invitations where email = 'invsend-stranger@outside.example.net')) $$,
  '54000', 'This invitation has already been sent again 3 times.',
  'but not a fourth time'
);
reset role;

-- ---------------------------------------------------------------------------
-- A claim given back
-- ---------------------------------------------------------------------------

set local role service_role;
select public.release_invitation_email(
  (select id from public.org_invitations where email = 'invsend-stranger@outside.example.net'),
  (select email_claimed_at from public.org_invitations where email = 'invsend-stranger@outside.example.net'));
reset role;

select is(
  (select count(*)::int from public.org_invitation_sends where email = 'invsend-stranger@outside.example.net')
    || ' / ' || (select (email_claimed_at is null)::text from public.org_invitations where email = 'invsend-stranger@outside.example.net'),
  '2 / true',
  'the server gives back a claim that sent nothing: it is not counted'
);

set local role authenticated;
select lives_ok(
  $$ select public.resend_invitation((select id from public.org_invitations where email = 'invsend-stranger@outside.example.net')) $$,
  'and Resend works again at once'
);
reset role;

-- ---------------------------------------------------------------------------
-- A member without Settings access
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"c9180000-0000-0000-0000-000000000002","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$ select public.resend_invitation((select id from public.org_invitations where org_id = 'd9180000-0000-0000-0000-0000000000b1' limit 1)) $$,
  '42501', null,
  'a member without Settings access cannot resend'
);
reset role;

-- ---------------------------------------------------------------------------
-- Per person and per address, a day
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"c9180000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
insert into public.org_invitations (org_id, email)
values ('d9180000-0000-0000-0000-0000000000b1', 'invsend-second@outside.example.net');
reset role;

-- This person has resent 20 invitations elsewhere today.
insert into public.org_invitation_sends (invitation_id, email, claimed_by)
select (select id from public.org_invitations where email = 'invsend-stranger@outside.example.net'), 'invsend-elsewhere-' || n || '@outside.example.net', 'c9180000-0000-0000-0000-000000000001'
  from generate_series(1, 17) n;

set local role authenticated;
select throws_ok(
  $$ select public.resend_invitation((select id from public.org_invitations where email = 'invsend-second@outside.example.net')) $$,
  '54000', 'You can resend up to 20 invitations a day. Try again tomorrow.',
  'one person resends at most 20 invitations a day'
);
reset role;

-- Another address has had 10 invitation emails today, from other companies.
insert into public.org_invitation_sends (invitation_id, email, claimed_by)
select (select id from public.org_invitations where email = 'invsend-stranger@outside.example.net'), 'invsend-flooded@outside.example.net', null
  from generate_series(1, 10);

set local role authenticated;
select throws_ok(
  $$ insert into public.org_invitations (org_id, email)
     values ('d9180000-0000-0000-0000-0000000000b1', 'invsend-flooded@outside.example.net') $$,
  '54000', 'That address has been sent too many invitations today. Try again tomorrow.',
  'an address that had 10 invitation emails today is not invited again'
);
reset role;

-- An invitation to it made before, by the server: resending is refused too.
set local request.jwt.claims = '{}';
insert into public.org_invitations (org_id, email)
values ('d9180000-0000-0000-0000-0000000000b1', 'invsend-flooded@outside.example.net');
delete from public.org_invitation_sends where claimed_by = 'c9180000-0000-0000-0000-000000000001'
   and email like 'invsend-elsewhere-%';

set local request.jwt.claims = '{"sub":"c9180000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$ select public.resend_invitation((select id from public.org_invitations where email = 'invsend-flooded@outside.example.net')) $$,
  '54000', 'That address has been sent too many invitations today. Try again tomorrow.',
  'nor emailed again'
);
select lives_ok(
  $$ select public.resend_invitation((select id from public.org_invitations where email = 'invsend-second@outside.example.net')) $$,
  'another address is unaffected'
);
reset role;

delete from public.org_invitations where org_id = 'd9180000-0000-0000-0000-0000000000b1';
select is(
  (select count(*)::int from public.org_invitation_sends where email like 'invsend-%'),
  0,
  'deleting an invitation (its company deleted) removes its sends'
);

select * from finish();
rollback;
