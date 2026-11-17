-- ============================================================================
-- Stripe withdrawals: the factory pays exactly what Stripe charges, once per
-- withdrawal
-- ----------------------------------------------------------------------------
-- Stripe bills TSC nothing per transfer and its payout fee per payout to the
-- bank (src/shared/withdrawal-fees.mjs). So an approved step now reaches the
-- factory's Stripe balance in full, and the fee is taken when the factory
-- withdraws: a partial reversal of its transfers (newest first) gives TSC the
-- fee, then the rest is paid out (api/_stripe-withdrawals.js).
--
-- One row per withdrawal, claimed before Stripe is asked anything, so a crash
-- between the reversal and the payout is finished (or the fee given back) on
-- the next call, never charged twice. Every Stripe call carries an
-- idempotency key derived from the row, and a retry looks for what an earlier
-- call made (reversals and payouts carry the row id in metadata) before
-- making anything.
--
-- States: claimed -> fee_taken -> paid_out ; claimed -> refused (nothing
-- taken) ; fee_taken | paid_out -> fee_returned (the payout was refused or
-- failed: the fee went back to the factory's balance).
--
-- The factory's members read their own rows (the Paid out figure is net of
-- these fees); staff read all. Only the server writes: grant select and
-- nothing else to authenticated, and revoke the stack's default privileges.
--
-- Safe with the live site while applied: a new table and a new function.
-- ============================================================================

create table public.stripe_withdrawals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  stripe_account_id text not null,
  -- The request as the browser made it: one withdrawal per key.
  request_key text not null unique,
  request_id uuid not null,
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null,
  destination text,
  -- What TSC takes back, in US$ (the transfers' currency), and what that took
  -- from the factory's balance in its own currency.
  fee_cents bigint check (fee_cents is null or fee_cents >= 0),
  fee_currency char(3) not null default 'USD',
  fee_local_minor bigint check (fee_local_minor is null or fee_local_minor >= 0),
  -- [{ transfer, amount, reversal, local }], decided before the first reversal.
  reversals jsonb not null default '[]'::jsonb,
  payout_id text,
  payout_minor bigint,
  fee_return_transfer_id text,
  state text not null default 'claimed'
    check (state in ('claimed', 'fee_taken', 'paid_out', 'refused', 'fee_returned')),
  reason text,
  lease_until timestamptz,
  requested_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index stripe_withdrawals_org_idx on public.stripe_withdrawals (org_id, created_at desc);
create index stripe_withdrawals_open_idx on public.stripe_withdrawals (stripe_account_id)
  where state in ('claimed', 'fee_taken');
create unique index stripe_withdrawals_payout_idx on public.stripe_withdrawals (payout_id)
  where payout_id is not null;

alter table public.stripe_withdrawals enable row level security;
create policy stripe_withdrawals_read on public.stripe_withdrawals
  for select to authenticated
  using (public.is_org_member(org_id) or public.is_platform_admin());
revoke all on public.stripe_withdrawals from public, anon, authenticated;
grant select on public.stripe_withdrawals to authenticated;
grant select, insert, update on public.stripe_withdrawals to service_role;
alter publication supabase_realtime add table public.stripe_withdrawals;

comment on table public.stripe_withdrawals is
  'A factory''s withdrawal from its Stripe balance: the payout fee taken back by transfer reversal, then the payout. Written by the server only.';

-- ---------------------------------------------------------------------------
-- Claim a withdrawal for one call. Returns the row and whether this call holds
-- it: a row another call is working on (its lease not lapsed) is returned
-- unclaimed, and so is a finished one, so the caller answers as it did.
-- ---------------------------------------------------------------------------
create or replace function public.claim_stripe_withdrawal(
  target_org uuid,
  account text,
  key text,
  request uuid,
  amount bigint,
  in_currency text,
  to_destination text default null,
  by_user uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  w public.stripe_withdrawals;
begin
  insert into public.stripe_withdrawals (org_id, stripe_account_id, request_key, request_id, amount_minor, currency, destination, requested_by)
  values (target_org, account, key, request, amount, upper(in_currency), to_destination, by_user)
  on conflict (request_key) do nothing;

  update public.stripe_withdrawals s
     set lease_until = now() + interval '2 minutes', updated_at = now()
   where s.request_key = key
     and s.state in ('claimed', 'fee_taken')
     and (s.lease_until is null or s.lease_until < now())
  returning * into w;
  if found then
    return jsonb_build_object('claimed', true, 'row', to_jsonb(w));
  end if;
  select * into w from public.stripe_withdrawals s where s.request_key = key;
  return jsonb_build_object('claimed', false, 'row', to_jsonb(w));
end;
$$;

revoke all on function public.claim_stripe_withdrawal(uuid, text, text, uuid, bigint, text, text, uuid) from public, anon, authenticated;
grant execute on function public.claim_stripe_withdrawal(uuid, text, text, uuid, bigint, text, text, uuid) to service_role;

-- Claim an abandoned one (its lease lapsed) to settle it: finish what Stripe
-- already did, or give the fee back.
create or replace function public.claim_abandoned_stripe_withdrawal(target uuid)
returns public.stripe_withdrawals
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.stripe_withdrawals s
     set lease_until = now() + interval '2 minutes', updated_at = now()
   where s.id = target
     and s.state in ('claimed', 'fee_taken')
     and (s.lease_until is null or s.lease_until < now())
  returning *;
$$;

revoke all on function public.claim_abandoned_stripe_withdrawal(uuid) from public, anon, authenticated;
grant execute on function public.claim_abandoned_stripe_withdrawal(uuid) to service_role;
