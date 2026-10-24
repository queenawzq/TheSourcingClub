-- ============================================================================
-- Test data: a narrower rule, and nothing a real company shares is deleted
-- ----------------------------------------------------------------------------
-- Two things the first rule (20261016000100) got wrong, found by trying it.
--
-- 1. It deleted a real company's records. A test brand's request with a
--    conversation with Demo Factory went, and Demo Factory's messages with it
--    (they cascade from the thread). Only an ORDER with a real company kept a
--    test company. Now anything two companies share keeps it: an order, a
--    quote on a request, an invitation to quote, or a conversation (calls
--    belong to a conversation). As before this repeats, since a company kept
--    that way keeps its own partners in turn.
--
-- 2. Any ten digits counted as a run stamp. "Shenzhen Knit 13800138000" (a
--    phone number) with no members was listed. What the test scripts write
--    is Date.now(): thirteen digits, 17... to 19... for the years 2023 to
--    2033, and nothing else. A company with no members (the smoke run inserts
--    some directly) must ALSO carry that stamp in its name, as every one the
--    scripts make does ("Smoke Leftover <stamp>", "Atelier E2E <stamp>").
--
-- Same signatures. test_data_users() and purge_test_data() call
-- test_data_candidates(), so they follow without being redefined.
-- ============================================================================

create or replace function public.is_test_email(address text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(
    lower(address) ~ '^([^@]*[^0-9@])?1[7-9][0-9]{11}([^0-9@][^@]*)?@(([a-z0-9-]+\.)*example\.(com|net|org)|([a-z0-9-]+\.)+(test|example|invalid|localhost))$'
    and lower(address) not like 'demo-%',
    false);
$$;

revoke all on function public.is_test_email(text) from public, anon, authenticated;
grant execute on function public.is_test_email(text) to service_role;

create or replace function public.test_data_candidates()
returns table (org_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with recursive base as (
    select o.id
      from public.orgs o
     where o.is_demo = false
       and o.slug ~ '-1[7-9][0-9]{11}(-[0-9]+)?$'
       and o.created_at < now() - interval '1 hour'
       -- No members: the name carries the same stamp too.
       and (exists (select 1 from public.org_members m where m.org_id = o.id)
            or strpos(o.name, substring(o.slug from '-(1[7-9][0-9]{11})(?:-[0-9]+)?$')) > 0)
       and not exists (
         select 1
           from public.org_members m
           left join auth.users u on u.id = m.user_id
          where m.org_id = o.id
            and not (public.is_test_email(u.email) and u.created_at < now() - interval '1 hour'))
  ),
  -- Every pair of companies with something in common, either way round.
  shared (org_id, other_id) as (
    select p.brand_org_id, p.factory_org_id from public.production_orders p
    union select r.brand_org_id, q.factory_org_id
            from public.quotes q join public.rfqs r on r.id = q.rfq_id
    union select r.brand_org_id, i.factory_org_id
            from public.rfq_invitations i join public.rfqs r on r.id = i.rfq_id
    union select t.brand_org_id, t.factory_org_id from public.message_threads t
  ),
  pairs (org_id, other_id) as (
    select s.org_id, s.other_id from shared s where s.org_id in (select id from base)
    union select s.other_id, s.org_id from shared s where s.other_id in (select id from base)
  ),
  -- Peel off any company sharing something with a company that is not test
  -- data; repeat, since a company kept that way keeps its partners in turn.
  kept (id) as (
    select p.org_id from pairs p where p.other_id not in (select id from base)
    union
    select p.org_id from pairs p join kept k on k.id = p.other_id
  )
  select b.id from base b where b.id not in (select id from kept);
$$;

revoke all on function public.test_data_candidates() from public, anon, authenticated;
grant execute on function public.test_data_candidates() to service_role;

create or replace function public.admin_test_data_preview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'clearing test data is limited to platform staff' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'rule', 'Companies whose web address ends in a test run''s number, more than an hour old, where every member signed up with a test address (example.com and other reserved test domains, with a run number) and none is a demo login, or with no members and the run number in the name too; and those test users. A company that shares an order, a quote, an invitation or a conversation with a real company is kept.',
    'companies', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', o.id,
               'name', o.name,
               'type', o.type,
               'slug', o.slug,
               'createdAt', o.created_at,
               'members', coalesce((
                  select jsonb_agg(u.email order by u.email)
                    from public.org_members m join auth.users u on u.id = m.user_id
                   where m.org_id = o.id), '[]'::jsonb),
               'requests', (select count(*) from public.rfqs r where r.brand_org_id = o.id),
               'quotes', (select count(*) from public.quotes q where q.factory_org_id = o.id),
               'orders', (select count(*) from public.production_orders p where o.id in (p.brand_org_id, p.factory_org_id)),
               'files', (select count(*) from public.documents d where d.org_id = o.id))
             order by o.created_at)
        from public.orgs o
       where o.id in (select c.org_id from public.test_data_candidates() c)), '[]'::jsonb),
    'users', coalesce((
      select jsonb_agg(jsonb_build_object('id', u.id, 'email', u.email, 'createdAt', u.created_at)
                       order by u.created_at)
        from auth.users u
       where u.id in (select t.user_id from public.test_data_users() t)), '[]'::jsonb));
end;
$$;

revoke all on function public.admin_test_data_preview() from public, anon;
grant execute on function public.admin_test_data_preview() to authenticated;
