-- ============================================================================
-- Wise and PayPal webhooks: each delivery handled once
-- ----------------------------------------------------------------------------
-- A Wise or PayPal payout started by staff turned Paid only while someone kept
-- the payments board open. api/wise-webhook.js and api/paypal-webhook.js now
-- read a payout back when its provider says it moved, and the daily job sweeps
-- whatever is still open (api/payout-sync.js).
--
-- provider_events is stripe_events for them, with the same claim: a delivery is
-- handled when it is new, or when an earlier attempt claimed it more than 5
-- minutes ago and never finished. Ids are prefixed by provider ("wise:<delivery
-- id>", "paypal:<event id>"), so the two can never collide.
--
-- Server only: no grants to anon or authenticated. Safe with the live site:
-- one new table and one new function nothing on it calls.
-- ============================================================================

create table public.provider_events (
  id           text primary key,
  type         text not null,
  received_at  timestamptz not null default now(),
  claimed_at   timestamptz not null default now(),
  processed_at timestamptz
);

alter table public.provider_events enable row level security;
revoke all on public.provider_events from public, anon, authenticated;
grant select, insert, update, delete on public.provider_events to service_role;

create or replace function public.claim_provider_event(event_id text, event_type text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.provider_events (id, type) values (event_id, event_type)
  on conflict (id) do nothing;
  if found then
    return true;
  end if;

  update public.provider_events
     set claimed_at = now()
   where id = event_id
     and processed_at is null
     and claimed_at < now() - interval '5 minutes';
  return found;
end;
$$;

revoke all on function public.claim_provider_event(text, text) from public, anon, authenticated;
grant execute on function public.claim_provider_event(text, text) to service_role;
