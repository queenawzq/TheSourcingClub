-- ============================================================================
-- Balance reads ask Stripe at most once a minute per company; a payout's
-- status only moves forward
-- ----------------------------------------------------------------------------
-- 1. balance_stripe_reads: when the server last read a company's charges and
--    payouts from Stripe outside a webhook. claim_balance_stripe_read() takes
--    the next read atomically, at most once per 60 seconds, so owners and
--    members reloading cannot exhaust Stripe's rate limit. Service role only;
--    no client can set it.
-- 2. A Stripe payout's recorded status never goes back (pending → in_transit
--    → paid → failed / canceled): an older answer read after a newer one
--    (a balance read racing payout.paid) leaves the newer one.
-- Safe with the live site while applied: a new table, functions, a trigger.
-- ============================================================================

create table if not exists public.balance_stripe_reads (
  org_id uuid primary key references public.orgs (id) on delete cascade,
  read_at timestamptz not null default now()
);
alter table public.balance_stripe_reads enable row level security;
revoke all on public.balance_stripe_reads from public, anon, authenticated, service_role;

create or replace function public.claim_balance_stripe_read(target_org uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare took boolean;
begin
  insert into public.balance_stripe_reads (org_id, read_at) values (target_org, now())
  on conflict (org_id) do update set read_at = excluded.read_at
   where public.balance_stripe_reads.read_at < now() - interval '60 seconds'
  returning true into took;
  return coalesce(took, false);
end;
$$;
revoke all on function public.claim_balance_stripe_read(uuid) from public, anon, authenticated;
grant execute on function public.claim_balance_stripe_read(uuid) to service_role;

create or replace function public.payout_status_rank(status text)
returns integer
language sql
immutable
as $$
  select case status when 'pending' then 1 when 'in_transit' then 2 when 'paid' then 3
                     when 'failed' then 4 when 'canceled' then 4 else 0 end;
$$;
revoke all on function public.payout_status_rank(text) from public, anon, authenticated;

create or replace function public.keep_payout_status_forward()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if public.payout_status_rank(new.payout_status) < public.payout_status_rank(old.payout_status) then
    new.payout_status := old.payout_status;
  end if;
  return new;
end;
$$;
revoke all on function public.keep_payout_status_forward() from public, anon, authenticated;
drop trigger if exists stripe_withdrawals_payout_status_forward on public.stripe_withdrawals;
create trigger stripe_withdrawals_payout_status_forward
  before update of payout_status on public.stripe_withdrawals
  for each row execute function public.keep_payout_status_forward();
