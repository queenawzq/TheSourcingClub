-- ============================================================================
-- Admin: AI help for reviewers, and clearing test data
-- ----------------------------------------------------------------------------
-- Two things staff asked for.
--
-- 1. Help reviewing a company. An AI model reads what the company submitted
--    and suggests what a reviewer might look at, and drafts the "needs more
--    information" note. Everything it says is text a person reads, labelled
--    as a suggestion: never a score, never a decision. Confidence scores were
--    deliberately not built (CLAUDE.md, Admin operations), because a number on
--    a reviewer's screen gets trusted, and the model has nothing behind a
--    number either. What the model reads is one function,
--    admin_review_assist_input(), so the server, the tests and the screen's
--    "what the AI read" list all show the same thing. It holds the company's
--    own details and the file list, never the files and never a person's name
--    or address.
--
-- 2. Test data. The test databases collect companies made by the e2e and
--    smoke runs ("Atelier E2E <stamp>", "Maison Rue <stamp>"...), and they
--    turn up in real features (a new request "matches" forty of them). What
--    counts as test data is decided in exactly one place,
--    test_data_candidates(), and only purge_test_data() deletes, only on the
--    server, and only what staff confirmed AND the rule still matches.
--
-- Plus privacy policy v4: OpenRouter now also screens messages and helps
-- staff review, and the policy names what every processor does.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- What the AI told a reviewer
-- ----------------------------------------------------------------------------
-- Staff-only, like org_reviews: these are notes about a customer. Kept so the
-- review page can show the last suggestions without asking the model again,
-- and so there is a record of what the reviewer was shown.

create table public.org_review_assists (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs (id) on delete cascade,
  kind        text not null check (kind in ('check', 'draft')),
  model       text,
  output      jsonb not null,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);

create index org_review_assists_org on public.org_review_assists (org_id, kind, created_at desc);

alter table public.org_review_assists enable row level security;
-- No policy and no grant: only the functions below read or write it.
revoke all on public.org_review_assists from public, anon, authenticated;
grant all on public.org_review_assists to service_role;

-- ----------------------------------------------------------------------------
-- admin_review_assist_input: exactly what the model reads
-- ----------------------------------------------------------------------------
-- The company's own details, its certification records, its file LIST (kind,
-- name, size, date, review status; never the file), and the evidence checks
-- TSC already runs, without their percentages so the model has no number to
-- repeat. Member emails appear only as domains, for the "contact domain"
-- comparison; no person's name or address leaves the database.

create or replace function public.admin_review_assist_input(target_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  org_row public.orgs;
  result  jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'review help is limited to platform staff' using errcode = '42501';
  end if;

  select * into org_row from public.orgs o where o.id = target_org;
  if org_row.id is null then
    raise exception 'org not found' using errcode = 'P0002';
  end if;

  select jsonb_build_object(
    'today', current_date,
    'company', jsonb_build_object('name', org_row.name, 'type', org_row.type),
    'profile', coalesce(
      (select jsonb_strip_nulls(to_jsonb(f) - array['org_id', 'created_at', 'updated_at', 'published_at',
                                                    'onboarding_completed_at', 'verification_status'])
         from public.factory_profiles f where f.org_id = target_org),
      (select jsonb_strip_nulls(to_jsonb(b) - array['org_id', 'created_at', 'updated_at',
                                                    'onboarding_completed_at', 'verification_status',
                                                    'business_email'])
                || jsonb_strip_nulls(jsonb_build_object(
                     'business_email_domain', nullif(split_part(lower(b.business_email), '@', 2), '')))
         from public.brand_profiles b where b.org_id = target_org),
      '{}'::jsonb),
    'member_email_domains', coalesce((
      select jsonb_agg(distinct split_part(lower(u.email), '@', 2))
        from public.org_members m
        join auth.users u on u.id = m.user_id
       where m.org_id = target_org and u.email like '%@%'), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_object_agg(kind, labels)
        from (select t.kind, jsonb_agg(t.label_en order by t.label_en) as labels
                from public.taxonomy_links l
                join public.taxonomy_terms t on t.id = l.term_id
               where l.subject_id = target_org
                 and l.subject_type in ('factory_profile', 'brand_profile')
               group by t.kind) k), '{}'::jsonb),
    'certifications', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', t.label_en,
               'status', c.status,
               'expires_on', c.expires_at,
               'expired', c.expires_at is not null and c.expires_at < current_date,
               'file_attached', c.document_id is not null) order by t.label_en)
        from public.factory_certifications c
        join public.taxonomy_terms t on t.id = c.term_id
       where c.org_id = target_org), '[]'::jsonb),
    'files', coalesce((
      select jsonb_agg(jsonb_build_object(
               'kind', d.kind,
               'file_name', d.file_name,
               'size_bytes', coalesce(d.size_bytes, 0),
               'uploaded_on', d.created_at::date,
               'review_status', d.status) order by d.kind, d.created_at)
        from public.documents d
       where d.org_id = target_org
         and d.rfq_id is null and d.quote_id is null and d.order_id is null
         and d.message_id is null and d.milestone_update_id is null), '[]'::jsonb),
    'existing_checks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'check', c ->> 'label', 'result', c ->> 'result', 'detail', c ->> 'detail'))
        from jsonb_array_elements(public.org_verification_checks(target_org)) c), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

revoke all on function public.admin_review_assist_input(uuid) from public, anon;
grant execute on function public.admin_review_assist_input(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Saving and reading suggestions
-- ----------------------------------------------------------------------------

create or replace function public.record_review_assist(
  target_org  uuid,
  assist_kind text,
  model_name  text,
  assist      jsonb,
  acting_user uuid
)
returns public.org_review_assists
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  saved public.org_review_assists;
begin
  -- The server calls this with the service key, on behalf of a signed-in
  -- person it has already identified; it must still be staff.
  if acting_user is null or not exists (select 1 from public.platform_admins a where a.user_id = acting_user) then
    raise exception 'only platform staff ask for review help' using errcode = '42501';
  end if;

  insert into public.org_review_assists (org_id, kind, model, output, created_by)
  values (target_org, assist_kind, model_name, assist, acting_user)
  returning * into saved;
  return saved;
end;
$$;

revoke all on function public.record_review_assist(uuid, text, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.record_review_assist(uuid, text, text, jsonb, uuid) to service_role;

create or replace function public.admin_review_assists(target_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'review help is limited to platform staff' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'check', (select jsonb_build_object('output', a.output, 'model', a.model, 'createdAt', a.created_at)
                from public.org_review_assists a
               where a.org_id = target_org and a.kind = 'check'
               order by a.created_at desc limit 1));
end;
$$;

revoke all on function public.admin_review_assists(uuid) from public, anon;
grant execute on function public.admin_review_assists(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- What counts as test data: the one rule
-- ----------------------------------------------------------------------------
-- A TEST USER has an address on a domain reserved for testing (RFC 2606 and
-- 6761: example.com/.net/.org and anything under .test, .example, .invalid,
-- .localhost), a run stamp of ten or more digits in the part before the @
-- (every test script stamps with Date.now()), is not a demo login (demo-...),
-- and is more than an hour old, so a run in progress is never touched.
--
-- A TEST COMPANY is not marked is_demo, has a slug ending in such a stamp,
-- is more than an hour old, and every member is a test user (a company with
-- no members at all also qualifies: the smoke run inserts some directly). And
-- it shares no order with a company that is not test data, since deleting an
-- order would delete the other side's record of it.
--
-- A real company fails twice over: a real slug does not end in a 13-digit
-- number, and a real member's address is not at example.com.

create or replace function public.is_test_email(address text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(
    lower(address) ~ '^[^@]*[0-9]{10,}[^@]*@(([a-z0-9-]+\.)*example\.(com|net|org)|([a-z0-9-]+\.)+(test|example|invalid|localhost))$'
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
       and o.slug ~ '-[0-9]{10,}(-[0-9]+)?$'
       and o.created_at < now() - interval '1 hour'
       and not exists (
         select 1
           from public.org_members m
           left join auth.users u on u.id = m.user_id
          where m.org_id = o.id
            and not (public.is_test_email(u.email) and u.created_at < now() - interval '1 hour'))
  ),
  -- Peel off any company with an order on the far side of which is a company
  -- that is not test data; repeat, since a company kept that way keeps its
  -- own trading partners in turn.
  kept (id) as (
    select b.id
      from base b
      join public.production_orders p on b.id in (p.brand_org_id, p.factory_org_id)
     where (case when p.brand_org_id = b.id then p.factory_org_id else p.brand_org_id end)
           not in (select id from base)
    union
    select b.id
      from base b
      join public.production_orders p on b.id in (p.brand_org_id, p.factory_org_id)
      join kept k on k.id = (case when p.brand_org_id = b.id then p.factory_org_id else p.brand_org_id end)
  )
  select b.id from base b where b.id not in (select id from kept);
$$;

revoke all on function public.test_data_candidates() from public, anon, authenticated;
grant execute on function public.test_data_candidates() to service_role;

create or replace function public.test_data_users()
returns table (user_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.id
    from auth.users u
   where public.is_test_email(u.email)
     and u.created_at < now() - interval '1 hour'
     -- Member of nothing that will survive the cleanup.
     and not exists (
       select 1 from public.org_members m
        where m.user_id = u.id
          and m.org_id not in (select c.org_id from public.test_data_candidates() c));
$$;

revoke all on function public.test_data_users() from public, anon, authenticated;
grant execute on function public.test_data_users() to service_role;

-- ----------------------------------------------------------------------------
-- admin_test_data_preview: what a cleanup would delete, before it does
-- ----------------------------------------------------------------------------

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
    'rule', 'Companies whose web address ends in a test run''s number, more than an hour old, where every member signed up with a test address (example.com and other reserved test domains, with a run number) and none is a demo login; and those test users. A company that has an order with a real company is kept.',
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

-- ----------------------------------------------------------------------------
-- purge_test_data: the only thing that deletes
-- ----------------------------------------------------------------------------
-- Server only (/api/admin-test-data refuses the production project and
-- removes the files first: storage.objects cannot be deleted from SQL). It
-- deletes the INTERSECTION of the ids staff confirmed and what the rule
-- matches now, so a stale or edited list can only ever delete less.

create or replace function public.purge_test_data(org_ids uuid[], user_ids uuid[], acting_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_orgs  uuid[];
  target_users uuid[];
  subject_ids  uuid[];
  one_user     uuid;
  orders_gone  integer := 0;
  orgs_gone    integer := 0;
  users_gone   integer := 0;
  kept_users   jsonb := '[]'::jsonb;
begin
  if acting_user is null or not exists (select 1 from public.platform_admins a where a.user_id = acting_user) then
    raise exception 'clearing test data is limited to platform staff' using errcode = '42501';
  end if;

  select coalesce(array_agg(c.org_id), '{}') into target_orgs
    from public.test_data_candidates() c where c.org_id = any(coalesce(org_ids, '{}'));
  select coalesce(array_agg(t.user_id), '{}') into target_users
    from public.test_data_users() t where t.user_id = any(coalesce(user_ids, '{}'));

  -- Notifications other companies hold about the requests, quotes and
  -- conversations being deleted ("a new request matches you"). Those about
  -- an order go with the order (foreign key).
  select coalesce(array_agg(id), '{}') into subject_ids from (
    select r.id from public.rfqs r where r.brand_org_id = any(target_orgs)
    union all select q.id from public.quotes q where q.factory_org_id = any(target_orgs)
    union all select t.id from public.message_threads t
               where t.brand_org_id = any(target_orgs) or t.factory_org_id = any(target_orgs)
  ) s;
  delete from public.notifications n
   where n.subject_type in ('rfq', 'quote', 'thread') and n.subject_id = any(subject_ids);

  -- Orders keep both companies from being deleted (a restricting key), so
  -- they go first, as in scripts/seed-demo.mjs.
  delete from public.production_orders p
   where p.brand_org_id = any(target_orgs) or p.factory_org_id = any(target_orgs);
  get diagnostics orders_gone = row_count;

  delete from public.orgs o where o.id = any(target_orgs);
  get diagnostics orgs_gone = row_count;

  -- One at a time: a user something else still points at is kept and named,
  -- rather than failing the whole cleanup.
  foreach one_user in array target_users loop
    begin
      delete from auth.users u where u.id = one_user;
      users_gone := users_gone + 1;
    exception when foreign_key_violation then
      kept_users := kept_users || jsonb_build_object(
        'id', one_user, 'reason', 'still referenced by other records');
    end;
  end loop;

  return jsonb_build_object(
    'companies', orgs_gone,
    'orders', orders_gone,
    'users', users_gone,
    'keptUsers', kept_users,
    'skipped', coalesce(array_length(org_ids, 1), 0) - coalesce(array_length(target_orgs, 1), 0));
end;
$$;

revoke all on function public.purge_test_data(uuid[], uuid[], uuid) from public, anon, authenticated;
grant execute on function public.purge_test_data(uuid[], uuid[], uuid) to service_role;

-- ----------------------------------------------------------------------------
-- Privacy policy, next version (4, or 5 after the payments change's card-only
-- version): what OpenRouter does
-- ----------------------------------------------------------------------------
-- v3 said OpenRouter is used for "translation and drafting". It also screens
-- messages for contact details (since message screening) and, from this
-- change, helps staff review a company's submission. Section 6 and the
-- OpenRouter line in section 9 change; every other word is v3's. A new row,
-- v3 untouched; nobody signs anything new.

do $$
declare
  v3_version integer;
  v3 text;
  v4 text;
  old_6 constant text := $t$6. Translation and drafting features
Messages may be automatically translated between English and Chinese, and a sourcing brief may be drafted from your description. To do this, the relevant text is sent to an AI model provider through OpenRouter. The original message is always kept, and a translation is provided for convenience only.$t$;
  new_6 constant text := $t$6. AI features
We use an AI model provider, through OpenRouter, for four things. Messages may be automatically translated between English and Chinese; the original message is always kept, and a translation is provided for convenience only. A sourcing brief may be drafted from your description. Messages are checked for contact details or arrangements to deal outside the platform before they are delivered, and a message held for this reason is reviewed by our staff. And when our staff review a company's profile, the details the company submitted (its profile, its certification records and the names of the files it uploaded, but not the files themselves and not anyone's name or email address) may be sent to the model to suggest what to check or ask for. These suggestions are only an aid: a person at The Sourcing Club makes every review decision. For each of these, the relevant text is sent to the model provider.$t$;
  old_9 constant text := 'OpenRouter for translation and drafting;';
  new_9 constant text := 'OpenRouter for translation, drafting, message screening and help with profile reviews;';
begin
  -- The current version, whichever number it has: the payments change
  -- publishes a privacy version too, and merge order decides the numbers.
  select d.version, d.full_en into v3_version, v3
    from public.legal_documents d
   where d.kind = 'privacy'
   order by d.version desc
   limit 1;
  if v3 is null then
    raise exception 'privacy policy is missing';
  end if;
  if position(old_6 in v3) = 0 or position(old_9 in v3) = 0 then
    raise exception 'privacy policy v% does not read as expected; write the next version by hand', v3_version;
  end if;
  v4 := replace(replace(v3, old_6, new_6), old_9, new_9);

  insert into public.legal_documents (kind, version, onboarding_en, onboarding_zh, full_en, full_zh)
  values ('privacy', v3_version + 1, null, null, v4, null);
end;
$$;
