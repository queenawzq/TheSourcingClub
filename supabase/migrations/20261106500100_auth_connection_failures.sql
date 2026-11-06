-- ============================================================================
-- Sign-ins and sign-ups that got no answer
-- ----------------------------------------------------------------------------
-- A request that never reaches the database leaves no trace in anything we
-- own, so "how many vendors failed and never told us?" had no answer. The
-- browser reports the failure to our own host (api/auth-failure.js), which can
-- be reachable when the database's is not.
--
-- No email, name, address or IP: when, at which step, what kind, the browser's
-- language and the country Vercel saw. Staff read it by SQL. It sees only
-- people who loaded the page.
-- ============================================================================

create table public.auth_connection_failures (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  stage       text not null check (stage in ('signup', 'login', 'reset', 'code', 'company')),
  kind        text not null check (kind in ('network', 'timeout')),
  portal      text not null check (portal in ('brand', 'factory')),
  language    text check (language ~ '^[A-Za-z-]{2,16}$'),
  country     text check (country ~ '^[A-Z]{2}$')
);

alter table public.auth_connection_failures enable row level security;
revoke all on public.auth_connection_failures from public, anon, authenticated;
grant select, insert on public.auth_connection_failures to service_role;
