-- Functions only other functions run. `revoke ... from public` leaves the grant
-- Supabase's default privileges give `authenticated`, so name them all here.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

select ok(not has_function_privilege('authenticated', p.oid, 'execute'),
          'a signed-in account cannot run ' || p.proname)
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in ('close_order', 'advance_order_chain', 'activate_order', 'create_order_from_award',
                    'org_profile_completion', 'org_profile_fields',
                    'org_verification_checks', 'org_verification_score', 'url_host')
order by p.proname;

insert into auth.users (id, email) values
  ('fe000000-0000-0000-0000-000000000001', 'pgtap-grants-stranger@example.com');

set local role authenticated;
set local request.jwt.claims = '{"sub":"fe000000-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok($$select public.close_order('fe000000-0000-0000-0000-0000000000aa', 'x')$$, '42501', null,
  'a stranger CANNOT cancel an order');
select throws_ok($$select public.advance_order_chain('fe000000-0000-0000-0000-0000000000aa')$$, '42501', null,
  'a stranger CANNOT move an order on');
select throws_ok($$select public.activate_order('fe000000-0000-0000-0000-0000000000aa')$$, '42501', null,
  'a stranger CANNOT start an order');
reset role;

-- The callers still reach them: they run as the owner.
select ok(has_function_privilege('postgres', 'public.close_order(uuid, text)', 'execute'),
  'accept_cancellation and admin_close_order, which run as the owner, still can');

select * from finish();
rollback;
