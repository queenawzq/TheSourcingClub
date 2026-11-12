-- The Nov 11 call's demo accounts (demo-call-…@example.com) each upload real,
-- distinct documents, and scenario D1 must show a copy of A's licence. They
-- are therefore not "demo" for copy matching: only the seed's own shared
-- placeholder files are ignored.
create or replace function public.org_is_demo(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select o.is_demo from public.orgs o where o.id = target_org), false)
      or coalesce((
           select u.email ~* '^demo-[^@]*@example\.(com|net)$'
              and u.email !~* '^demo-call-'
           from public.org_members m
           join auth.users u on u.id = m.user_id
           where m.org_id = target_org
           order by m.created_at, m.user_id
           limit 1), false);
$$;
