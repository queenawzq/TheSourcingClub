-- ============================================================================
-- Paying a factory once, webhook events that are never lost, and a trust
-- tier only staff can set
-- ----------------------------------------------------------------------------
-- 1. A payout is claimed before it is sent. The webhook, the brand's page
--    after an approval, the factory's "refresh" and staff's "Retry payout"
--    can all ask for the same payout at the same moment. The transfer's
--    idempotency key used to carry the Connect row's updated_at, which every
--    account.updated webhook bumps, so two of those callers could each get a
--    different key, both find no transfer yet, and both pay. Now the first
--    caller claims the payment in one statement and the others are told it
--    is already being paid. A claim older than 10 minutes is treated as
--    abandoned (a function that timed out mid-payout), and the server
--    lists the order's transfers before paying again, so a transfer that
--    did go is recorded rather than repeated.
--
-- 2. A webhook event is marked processed only once it was handled. Before,
--    its id was stored first and removed if handling failed; a function that
--    timed out removed nothing, and every retry from Stripe was then dropped
--    as a repeat. An event claimed more than 5 minutes ago and never
--    finished is now run again.
--
-- 3. A factory cannot give itself a trust tier. factory_profiles_write lets
--    a factory's members update any column of their own row, trust_tier
--    (20261021000100) included. A trigger refuses that change from anyone
--    but staff and server code; staff set the tier through
--    admin_review_decision_with_tier, which runs as its owner.
--
-- Safe with the old site live: two columns on order_payments and
-- stripe_events and three new functions, none of which the old site reads
-- or calls; the trigger only refuses a change to trust_tier, which the old
-- site does not know about. Re-runnable.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Claiming a payout
-- ---------------------------------------------------------------------------

alter table public.order_payments
  add column if not exists release_claimed_at timestamptz;

comment on column public.order_payments.release_claimed_at is
  'When server code started sending this payout to Stripe; null when no one is. Cleared on failure, ignored after 10 minutes.';

-- The claim time, or null when the payment is not owed yet or someone else
-- is paying it right now. One UPDATE, so two callers at the same moment
-- cannot both win: the second waits for the first's row lock, then finds the
-- claim fresh and matches nothing.
create or replace function public.claim_payment_release(target_payment uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  claimed timestamptz;
begin
  update public.order_payments
     set release_claimed_at = now()
   where id = target_payment
     and state = 'confirmed'
     and release_requested_at is not null
     and (release_claimed_at is null or release_claimed_at < now() - interval '10 minutes')
  returning release_claimed_at into claimed;
  return claimed;
end;
$$;

-- Give the claim back after a payout that did not go, so a retry need not
-- wait 10 minutes. Only the caller's own claim: a newer one is left alone.
create or replace function public.release_payment_claim(target_payment uuid, claimed timestamptz)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.order_payments
     set release_claimed_at = null
   where id = target_payment
     and release_claimed_at = claimed;
end;
$$;

revoke all on function public.claim_payment_release(uuid)                 from public, anon, authenticated;
revoke all on function public.release_payment_claim(uuid, timestamptz)    from public, anon, authenticated;
grant execute on function public.claim_payment_release(uuid)              to service_role;
grant execute on function public.release_payment_claim(uuid, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Webhook events: claimed, then processed
-- ---------------------------------------------------------------------------
-- Rows stored before this migration were all handled (a failure deleted its
-- row), so they are marked processed when the column first appears. Done
-- only then: running this file again must not mark an event in flight as
-- done.

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'stripe_events' and column_name = 'processed_at'
  ) then
    alter table public.stripe_events
      add column processed_at timestamptz,
      add column claimed_at   timestamptz not null default now();
    update public.stripe_events set processed_at = received_at, claimed_at = received_at;
  end if;
end;
$$;

-- True when the caller should handle the event: it is new, or an earlier
-- attempt claimed it more than 5 minutes ago and never finished (a timeout).
-- False for an event already handled or being handled right now.
create or replace function public.claim_stripe_event(event_id text, event_type text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.stripe_events (id, type) values (event_id, event_type)
  on conflict (id) do nothing;
  if found then
    return true;
  end if;

  update public.stripe_events
     set claimed_at = now()
   where id = event_id
     and processed_at is null
     and claimed_at < now() - interval '5 minutes';
  return found;
end;
$$;

revoke all on function public.claim_stripe_event(text, text) from public, anon, authenticated;
grant execute on function public.claim_stripe_event(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Only staff and server code set a factory's trust tier
-- ---------------------------------------------------------------------------
-- The same test as the verification guard on this table: anyone but the two
-- browser roles is server code or a definer function running as its owner
-- (admin_review_decision_with_tier), and staff are let through by name. A
-- new profile from the browser starts at basic whatever it sends.

create or replace function public.guard_factory_trust_tier()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user not in ('authenticated', 'anon') or public.is_platform_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.trust_tier := 'basic';
  elsif new.trust_tier is distinct from old.trust_tier then
    raise exception 'only TSC staff can change a factory''s trust tier'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_factory_trust_tier() from public, anon, authenticated;

drop trigger if exists factory_profiles_guard_trust_tier on public.factory_profiles;
create trigger factory_profiles_guard_trust_tier
  before insert or update of trust_tier on public.factory_profiles
  for each row execute function public.guard_factory_trust_tier();

notify pgrst, 'reload schema';
