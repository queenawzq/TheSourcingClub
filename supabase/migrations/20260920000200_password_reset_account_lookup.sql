-- "Forgot password" now tells the person whether an account exists, instead of
-- the neutral "if an account exists…". John's call on 2026-09-20: a real user
-- who mistypes their address otherwise gets silence and no way to tell.
--
-- The tradeoff is explicit rather than overlooked. This makes the reset form
-- an account-enumeration oracle: anyone can ask, without signing in, whether a
-- given company or person is on the marketplace. Rate limiting below is the
-- mitigation, and it is the only one -- so it is part of the feature, not a
-- nice-to-have bolted on later.

-- auth.users is not readable from the browser and must not become so. The
-- lookup is a definer function the service role calls from the Vercel
-- endpoint; nothing holding the publishable key can reach it.
create or replace function public.email_has_account(addr text)
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from auth.users u
     where lower(u.email) = lower(btrim(addr))
  );
$$;

revoke all on function public.email_has_account(text) from public;
revoke all on function public.email_has_account(text) from anon, authenticated;
grant execute on function public.email_has_account(text) to service_role;

-- One row per client, holding a fixed window. Deliberately not per-email: the
-- attack is one client walking a list of addresses, so limiting per address
-- would not slow it down at all.
create table public.email_probe_attempts (
  client_ip    text primary key,
  window_start timestamptz not null default now(),
  attempts     integer not null default 0
);

alter table public.email_probe_attempts enable row level security;
grant select, insert, update, delete on public.email_probe_attempts to service_role;

/*
 * Count this probe and say whether it is allowed, in one statement.
 *
 * Read-then-write would let concurrent requests read the same count and every
 * one of them conclude it was under the limit -- which is exactly the shape of
 * traffic a limiter exists to stop.
 */
create or replace function public.claim_email_probe(
  -- Not "client_ip": a parameter sharing a column name makes `on conflict
  -- (client_ip)` ambiguous, and the function fails at runtime, not at
  -- creation time.
  probe_ip       text,
  max_attempts   integer default 10,
  window_seconds integer default 600
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  allowed boolean;
begin
  insert into public.email_probe_attempts as a (client_ip, window_start, attempts)
  values (probe_ip, now(), 1)
  on conflict (client_ip) do update
    -- Both branches test the OLD window_start, so the reset and the count
    -- cannot disagree about which window this probe belongs to.
    set window_start = case
          when now() - a.window_start > make_interval(secs => window_seconds)
          then now() else a.window_start end,
        attempts = case
          when now() - a.window_start > make_interval(secs => window_seconds)
          then 1 else a.attempts + 1 end
  returning a.attempts <= max_attempts into allowed;

  return coalesce(allowed, false);
end;
$$;

revoke all on function public.claim_email_probe(text, integer, integer) from public;
revoke all on function public.claim_email_probe(text, integer, integer) from anon, authenticated;
grant execute on function public.claim_email_probe(text, integer, integer) to service_role;
