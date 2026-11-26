-- ============================================================================
-- The profile's email is the sign-in email (20261126200000). Prefix
-- `pgtap-profmail-`, every count scoped to these fixtures.
--
-- The attack: a member sets their own profile email to a stranger's address,
-- and TSC's notification emails for the company go there.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

insert into auth.users (id, email) values
  ('c9160000-0000-0000-0000-000000000001', 'profmail-member@example.com'),
  ('c9160000-0000-0000-0000-000000000002', 'profmail-other@example.com');

insert into public.orgs (id, type, name, slug) values
  ('d9160000-0000-0000-0000-0000000000f1', 'factory', 'ProfMail Factory', 'pgtap-profmail-factory');

insert into public.org_members (org_id, user_id, role) values
  ('d9160000-0000-0000-0000-0000000000f1', 'c9160000-0000-0000-0000-000000000001', 'owner');

-- ---------------------------------------------------------------------------
-- The grant
-- ---------------------------------------------------------------------------

select ok(
  not has_column_privilege('authenticated', 'public.user_profiles', 'email', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.user_profiles', 'id', 'UPDATE'),
  'signed-in users hold no UPDATE on their profile''s email or id'
);

select ok(
  has_column_privilege('authenticated', 'public.user_profiles', 'locale', 'UPDATE')
  and has_column_privilege('authenticated', 'public.user_profiles', 'full_name', 'UPDATE')
  and has_column_privilege('authenticated', 'public.user_profiles', 'avatar_url', 'UPDATE'),
  'signed-in users may still update their language, name and picture'
);

-- ---------------------------------------------------------------------------
-- The member
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"c9160000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$ update public.user_profiles set email = 'stranger@victim.example.org'
      where id = 'c9160000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'a member CANNOT point their profile email at another address'
);

select lives_ok(
  $$ update public.user_profiles set locale = 'zh'
      where id = 'c9160000-0000-0000-0000-000000000001' $$,
  'a member CAN still change their language (what the app writes)'
);

select lives_ok(
  $$ update public.user_profiles set full_name = 'ProfMail Member'
      where id = 'c9160000-0000-0000-0000-000000000001' $$,
  'a member CAN still change their name'
);

select lives_ok(
  $$ select public.set_my_time_zone('Asia/Shanghai') $$,
  'a member CAN still save their time zone'
);

reset role;

select is(
  (select email || ' / ' || locale || ' / ' || time_zone from public.user_profiles
    where id = 'c9160000-0000-0000-0000-000000000001'),
  'profmail-member@example.com / zh / Asia/Shanghai',
  'the email is still the sign-in email; language and time zone are saved'
);

-- ---------------------------------------------------------------------------
-- Following the sign-in email
-- ---------------------------------------------------------------------------

update auth.users set email = 'profmail-member-new@example.com'
 where id = 'c9160000-0000-0000-0000-000000000001';

select is(
  (select email from public.user_profiles where id = 'c9160000-0000-0000-0000-000000000001'),
  'profmail-member-new@example.com',
  'a confirmed change of the sign-in email is copied to the profile'
);

select is(
  (select email from public.user_profiles where id = 'c9160000-0000-0000-0000-000000000002'),
  'profmail-other@example.com',
  'and touches nobody else''s profile'
);

-- ---------------------------------------------------------------------------
-- What gets mailed
-- ---------------------------------------------------------------------------

insert into public.notifications (org_id, kind, subject_type, subject_id, title, body)
values ('d9160000-0000-0000-0000-0000000000f1', 'payout_method_changed', 'org',
        'd9160000-0000-0000-0000-0000000000f1', 'ProfMail notice', 'pgtap');

select is(
  (select count(*)::int from public.notification_email_outbox
    where org_id = 'd9160000-0000-0000-0000-0000000000f1'
      and recipient_email = 'stranger@victim.example.org'),
  0,
  'no email for the company is queued to the address the member tried to set'
);

select is(
  (select string_agg(recipient_email, ',') from public.notification_email_outbox
    where org_id = 'd9160000-0000-0000-0000-0000000000f1'),
  'profmail-member-new@example.com',
  'the company''s email is queued once, to the member''s sign-in address'
);

-- ---------------------------------------------------------------------------
-- The record of realigned addresses
-- ---------------------------------------------------------------------------

select ok(
  not has_table_privilege('authenticated', 'public.profile_email_realignments', 'SELECT')
  and not has_table_privilege('anon', 'public.profile_email_realignments', 'SELECT'),
  'nobody signed in can read the record of realigned addresses'
);

select * from finish();
rollback;
