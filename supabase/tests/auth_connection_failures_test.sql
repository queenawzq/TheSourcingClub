-- ============================================================================
-- auth_connection_failures is the server's alone (20261106500100).
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(6);

insert into public.auth_connection_failures (stage, kind, portal, language, country)
  values ('signup', 'network', 'factory', 'zh-CN', 'CN');

select throws_ok(
  $$insert into public.auth_connection_failures (stage, kind, portal) values ('anything', 'network', 'factory')$$,
  '23514', null, 'an unknown step is refused'
);
select throws_ok(
  $$insert into public.auth_connection_failures (stage, kind, portal, language) values ('signup', 'network', 'factory', 'a@b.example.com')$$,
  '23514', null, 'an email cannot pass for a language'
);

set local role anon;
select throws_ok($$select * from public.auth_connection_failures$$, '42501', null, 'a signed-out visitor CANNOT read it');
select throws_ok(
  $$insert into public.auth_connection_failures (stage, kind, portal) values ('signup', 'network', 'factory')$$,
  '42501', null, 'a signed-out visitor CANNOT write to it directly'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"fa010000-0000-0000-0000-000000000009","role":"authenticated"}';
select throws_ok($$select * from public.auth_connection_failures$$, '42501', null, 'a signed-in person CANNOT read it');
select throws_ok(
  $$insert into public.auth_connection_failures (stage, kind, portal) values ('signup', 'network', 'factory')$$,
  '42501', null, 'a signed-in person CANNOT write to it directly'
);
reset role;

select * from finish();
rollback;
