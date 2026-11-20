-- ============================================================================
-- One balance, stage 1 fixes: owed money cannot be transferred on its own,
-- and a clearing date never outlives its charge
-- ----------------------------------------------------------------------------
-- 1. claim_payment_release() refuses (returns null) for an owed step unless a
--    Stripe release of it was already started by an earlier version (so it
--    can be settled), or the caller is a withdrawal claiming it (stage 2 sets
--    the transaction-local tsc.withdrawal_claim = 'on'). Approved money waits
--    in the factory's balance; an old deployment still running during the
--    deploy, or an old /api/stripe-release, can no longer transfer it.
-- 2. order_payments.funds_available_at describes one charge: it is cleared
--    when the charge changes or the payment leaves confirmed / released, so a
--    refunded and repaid step is Pending until its new charge's date is
--    recorded (the server retries recording it from the sync and webhook).
--
-- Safe with the live site while applied: one function replaced with its
-- signature unchanged, one new trigger.
-- ============================================================================

-- 1. ---------------------------------------------------------------------------
-- Body from 20261108163459, with the first check added.
create or replace function public.claim_payment_release(target_payment uuid)
returns timestamptz language plpgsql security definer set search_path = public, pg_temp as $$
declare claimed timestamptz; target_org uuid;
begin
  -- Nothing is transferred because a step was approved: only a withdrawal
  -- claims owed money, or an earlier version's started release is settled.
  if coalesce(current_setting('tsc.withdrawal_claim', true), '') <> 'on'
     and not exists (select 1 from public.order_payments p where p.id = target_payment and p.stripe_release_started) then
    return null;
  end if;
  select o.factory_org_id into target_org from public.order_payments p
    join public.production_orders o on o.id=p.order_id where p.id=target_payment;
  perform 1 from public.stripe_connect_accounts where org_id=target_org for update;
  if not public.uses_stripe_payout(target_org) then return null; end if;
  if exists (select 1 from public.stripe_connect_upgrades where org_id=target_org and completed_at is null and new_account_id is not null) then
    return null;
  end if;
  if exists (select 1 from public.provider_payouts x where x.payment_id=target_payment and x.status='processing') then
    return null;
  end if;
  update public.order_payments set release_claimed_at=now(), stripe_release_started=true
    where id=target_payment and state='confirmed' and release_requested_at is not null
    and (release_claimed_at is null or release_claimed_at < now()-interval '10 minutes')
    returning release_claimed_at into claimed;
  return claimed;
end; $$;

-- 2. ---------------------------------------------------------------------------
create or replace function public.forget_funds_available()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- A date the same statement writes is kept: it describes the new charge.
  if new.funds_available_at is not null
     and new.funds_available_at is not distinct from old.funds_available_at
     and (new.stripe_charge_id is distinct from old.stripe_charge_id
          or new.state not in ('confirmed', 'released')) then
    new.funds_available_at := null;
  end if;
  return new;
end;
$$;
revoke all on function public.forget_funds_available() from public, anon, authenticated;

drop trigger if exists order_payments_forget_funds_available on public.order_payments;
create trigger order_payments_forget_funds_available
  before update of stripe_charge_id, state on public.order_payments
  for each row execute function public.forget_funds_available();
