-- ---------------------------------------------------------------------------
-- A bank-paid factory cannot remove the bank account TSC is about to pay.
--
-- Where Stripe cannot pay out (mainland China, Hong Kong…), staff pay each
-- released earning by bank to the factory's primary factory_payout_accounts
-- row. Owners delete that row straight through RLS (factory_payout_delete),
-- so a factory could remove it while a payment it is owed waits on staff,
-- leaving staff with nowhere to send it. The screen says so before asking;
-- this is the guard, since a policy cannot see other tables' state.
--
-- Owed means: approved (release_requested_at) but still held (confirmed),
-- on an order where this company is the factory, and the company has no
-- Stripe account taking transfers (then Stripe pays it, not this row).
--
-- Only a signed-in person is refused. Server code (service_role: the demo
-- seed's reset, the test-data purge) deletes companies wholesale and is not
-- asking a factory's question.
--
-- The refusal carries the amount in `detail` (minor units and currency) and
-- `payout_owed` in `hint`, so the screen can say it in the reader's words.
-- ---------------------------------------------------------------------------

create or replace function public.guard_payout_account_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  owed_cents bigint;
  owed_currency text;
begin
  if coalesce(auth.role(), '') <> 'authenticated' or not old.is_primary then
    return old;
  end if;

  if exists (select 1 from public.stripe_connect_accounts s
              where s.org_id = old.org_id and s.transfers_active) then
    return old;
  end if;

  select sum(p.amount_cents), min(p.currency)
    into owed_cents, owed_currency
    from public.order_payments p
    join public.production_orders o on o.id = p.order_id
   where o.factory_org_id = old.org_id
     and p.state = 'confirmed'
     and p.release_requested_at is not null;

  if coalesce(owed_cents, 0) > 0 then
    raise exception 'TSC is about to pay this account, so it cannot be removed until that payment is sent'
      using errcode = 'P0001',
            hint = 'payout_owed',
            detail = owed_cents::text || ' ' || owed_currency;
  end if;

  return old;
end;
$$;

revoke all on function public.guard_payout_account_delete() from public, anon, authenticated;

create trigger factory_payout_accounts_remove_guard
  before delete on public.factory_payout_accounts
  for each row execute function public.guard_payout_account_delete();
