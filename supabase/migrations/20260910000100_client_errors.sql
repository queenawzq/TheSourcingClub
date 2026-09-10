-- ============================================================================
-- 041  Client error reports
-- ----------------------------------------------------------------------------
-- There is no error boundary, no window.onerror, no reporter and not one
-- console call in src/. An unhandled error in the React tree unmounts the root
-- and the person is left looking at a blank white page. Nobody finds out
-- unless they say so — which, in a supervised beta with a handful of invited
-- companies, means finding out by text message or not at all.
--
-- A third-party reporter would do this better, and should replace it before
-- there are more users than we can call. This is the version that needs no
-- account, costs nothing, and puts the failures in the same database the
-- admin queue is already watched in.
-- ============================================================================

create table public.client_errors (
  id uuid primary key default gen_random_uuid(),

  -- The id the person sees on screen, so a support message can be matched to
  -- a stack trace without asking them to describe what happened.
  reference text not null unique,

  message  text not null,
  stack    text,
  -- Which screen, and which component tree, so a report is actionable rather
  -- than just alarming.
  path     text,
  component_stack text,

  -- Null for a crash on the sign-in screen, which is exactly the crash most
  -- worth knowing about, so this is deliberately nullable.
  user_id uuid references auth.users (id) on delete set null,
  org_id  uuid references public.orgs (id) on delete set null,

  user_agent text,
  created_at timestamptz not null default now()
);

create index client_errors_recent_idx on public.client_errors (created_at desc);

alter table public.client_errors enable row level security;

-- Readable by platform staff only. A person's own error is of no use to them
-- and the stack may name other rows.
create policy client_errors_admin_read on public.client_errors
  for select to authenticated
  using (public.is_platform_admin());

-- No insert grant. Reports arrive through the function below, which is the
-- only thing that can bound them.
grant select on public.client_errors to authenticated;

-- ---------------------------------------------------------------------------
-- report_client_error
-- ---------------------------------------------------------------------------
-- Callable by anon as well as authenticated, because a crash before sign-in
-- still needs reporting. That makes it the only write path in this schema a
-- signed-out visitor can reach, so it is bounded three ways: the payload is
-- truncated, the reference is generated here rather than trusted, and the
-- whole table refuses more than 60 rows a minute.
--
-- The rate limit is deliberately global rather than per-user. A crash loop
-- fires from one browser as fast as React can re-render, and a per-user cap
-- would not stop one person filling the table.
-- ---------------------------------------------------------------------------

create or replace function public.report_client_error(
  message text,
  stack text default null,
  path text default null,
  component_stack text default null,
  user_agent text default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  recent integer;
  ref    text;
begin
  if length(btrim(coalesce(message, ''))) = 0 then
    raise exception 'an error report needs a message' using errcode = '22023';
  end if;

  select count(*) into recent
  from public.client_errors
  where created_at > now() - interval '1 minute';

  -- Dropped silently and on purpose. A reporter that raises inside an error
  -- boundary turns one broken screen into two.
  if recent >= 60 then
    return 'rate-limited';
  end if;

  -- From gen_random_uuid rather than pgcrypto's gen_random_bytes: the latter
  -- lives in the extensions schema and is not on this function's search_path.
  ref := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  insert into public.client_errors
    (reference, message, stack, path, component_stack, user_id, org_id, user_agent)
  values (
    ref,
    left(btrim(message), 500),
    left(stack, 6000),
    left(path, 500),
    left(component_stack, 6000),
    auth.uid(),
    (select org_id from public.org_members where user_id = auth.uid() limit 1),
    left(user_agent, 300)
  );

  return ref;
end;
$$;

revoke all on function public.report_client_error(text, text, text, text, text) from public;
grant execute on function public.report_client_error(text, text, text, text, text) to authenticated, anon;
