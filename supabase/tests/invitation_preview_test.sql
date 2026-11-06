-- invitation_preview(): the one thing about an invitation a signed-out visitor
-- can ask, and only by its id. Fixtures: slug prefix pgtap25-, ids a2500000-.

begin;
create extension if not exists pgtap with schema extensions;

select plan(19);

insert into auth.users (id, email) values
  ('a2500000-0000-0000-0000-000000000001', 'p25-owner@example.com'),
  ('a2500000-0000-0000-0000-000000000002', 'p25-existing@example.net');
insert into public.orgs (id, type, name, slug) values
  ('a2500000-0000-0000-0000-0000000000aa', 'factory', 'P25 Factory', 'pgtap25-factory');

-- Written as the service role would: the guard stamps only signed-in inserts.
insert into public.org_invitations (id, org_id, email, status, expires_at, invited_name, title, permissions) values
  ('a2500000-0000-0000-0000-0000000000f1', 'a2500000-0000-0000-0000-0000000000aa', 'p25-new@example.net', 'pending', now() + interval '1 day', 'P25 Newcomer', 'Finance', '{addUpdate}'),
  ('a2500000-0000-0000-0000-0000000000f2', 'a2500000-0000-0000-0000-0000000000aa', 'p25-existing@example.net', 'pending', now() + interval '1 day', null, null, '{}'),
  ('a2500000-0000-0000-0000-0000000000f3', 'a2500000-0000-0000-0000-0000000000aa', 'p25-late@example.net', 'pending', now() - interval '1 minute', 'P25 Late', 'Late', '{}'),
  ('a2500000-0000-0000-0000-0000000000f4', 'a2500000-0000-0000-0000-0000000000aa', 'p25-gone@example.net', 'revoked', now() + interval '1 day', 'P25 Gone', 'Gone', '{}'),
  ('a2500000-0000-0000-0000-0000000000f5', 'a2500000-0000-0000-0000-0000000000aa', 'p25-done@example.net', 'accepted', now() + interval '1 day', 'P25 Done', 'Done', '{}');

set local request.jwt.claims = '{}';
set local role anon;

select is(
  (select state || '|' || company_name || '|' || company_kind || '|' || email || '|' || invited_name || '|' || title || '|' || has_account
     from public.invitation_preview('a2500000-0000-0000-0000-0000000000f1')),
  'open|P25 Factory|factory|p25-new@example.net|P25 Newcomer|Finance|false',
  'an open invitation says the company, kind, address, name, title, and that this address has no account');

select is(
  (select has_account from public.invitation_preview('a2500000-0000-0000-0000-0000000000f2')),
  true,
  'an address with an account is told apart, so the page opens on Log in');

select is(
  (select to_jsonb(p) from public.invitation_preview('a2500000-0000-0000-0000-0000000000f3') p),
  '{"state":"expired","company_name":"P25 Factory","company_kind":null,"email":null,"invited_name":null,"title":null,"has_account":null}'::jsonb,
  'an expired invitation gives its state and company only');
select is(
  (select to_jsonb(p) from public.invitation_preview('a2500000-0000-0000-0000-0000000000f4') p),
  '{"state":"withdrawn","company_name":"P25 Factory","company_kind":null,"email":null,"invited_name":null,"title":null,"has_account":null}'::jsonb,
  'a withdrawn invitation gives its state and company only');
select is(
  (select to_jsonb(p) from public.invitation_preview('a2500000-0000-0000-0000-0000000000f5') p),
  '{"state":"accepted","company_name":"P25 Factory","company_kind":null,"email":null,"invited_name":null,"title":null,"has_account":null}'::jsonb,
  'an accepted invitation gives its state and company only');

-- An id that exists, one that does not, and rubbish look the same from outside.
select lives_ok($$select * from public.invitation_preview('a2500000-0000-0000-0000-00000000ffff')$$, 'an unknown id raises nothing');
select is((select count(*) from public.invitation_preview('a2500000-0000-0000-0000-00000000ffff')), 0::bigint, '... and returns nothing');
select lives_ok($$select * from public.invitation_preview('not-a-uuid')$$, 'malformed input raises nothing');
select is((select count(*) from public.invitation_preview('not-a-uuid')), 0::bigint, '... and returns nothing');
select is((select count(*) from public.invitation_preview('')), 0::bigint, 'an empty id returns nothing');
select is((select count(*) from public.invitation_preview(null)), 0::bigint, 'a null id returns nothing');
select is((select count(*) from public.invitation_preview('%')), 0::bigint, 'a wildcard returns nothing');
select is((select count(*) from public.invitation_preview($$' or 1=1 --$$)), 0::bigint, 'an injection attempt returns nothing');
select is((select count(*) from public.invitation_preview('p25-new@example.net')), 0::bigint, 'an address is not an id');

-- The function is the door; the table stays shut.
select throws_ok($$select * from public.org_invitations$$, '42501', null, 'a signed-out visitor still cannot read invitations');
select throws_ok($$select * from public.orgs$$, '42501', null, 'nor companies');

-- The returned columns are pinned: no permissions, nothing about the inviter.
reset role;
select is(
  (select array_agg(name order by ord) from unnest(
     (select proargnames from pg_proc where proname = 'invitation_preview')) with ordinality as a(name, ord)
    where ord > 1),
  array['state','company_name','company_kind','email','invited_name','title','has_account'],
  'it returns exactly these columns');
select ok(has_function_privilege('anon', 'public.invitation_preview(text)', 'execute'), 'anon may call it');

-- Knowing what the invitation says does not get anyone in.
set local request.jwt.claims = '{"sub":"a2500000-0000-0000-0000-000000000002","email":"p25-existing@example.net","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$select public.accept_invitation('a2500000-0000-0000-0000-0000000000f1')$$,
  'P0002', null,
  'someone else''s address cannot accept an invitation they hold the link to');

select * from finish();
rollback;
