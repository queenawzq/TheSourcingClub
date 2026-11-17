-- Adding a withdrawal method never changes the default. The first method a
-- factory saves is its default (save_bank_payout_account, save_wise_payout_account
-- and the PayPal insert already mark a row is_primary only when none is); every
-- later one is just added, and the factory chooses with Make default
-- (choose_payout_method).
--
-- One path still moved the default without anyone choosing: the route. With no
-- factory_payout_preferences row, uses_stripe_payout() follows Stripe the moment
-- its transfers become active. A factory whose first method was PayPal or a bank
-- (Stripe not active) that later added a Stripe bank was moved to Stripe by
-- that alone. So a saved method that becomes the default while Stripe cannot
-- pay records the route it already is ('manual'), and adding Stripe later
-- leaves it there. Where Stripe is active, Stripe was there first and stays
-- the default: nothing is written.

create or replace function public.keep_manual_route_on_method()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.is_primary and new.method in ('bank', 'paypal')
     and not exists (select 1 from public.stripe_connect_accounts s
                      where s.org_id = new.org_id and s.transfers_active) then
    insert into public.factory_payout_preferences (org_id, route)
    values (new.org_id, 'manual')
    on conflict (org_id) do nothing;
  end if;
  return null;
end;
$$;
revoke all on function public.keep_manual_route_on_method() from public, anon, authenticated;

create trigger factory_payout_accounts_keep_manual_route
  after insert or update of is_primary, method on public.factory_payout_accounts
  for each row execute function public.keep_manual_route_on_method();

-- Factories already paid by a saved method with Stripe not active: the same.
insert into public.factory_payout_preferences (org_id, route)
select distinct a.org_id, 'manual'
  from public.factory_payout_accounts a
 where a.is_primary and a.method in ('bank', 'paypal')
   and not exists (select 1 from public.stripe_connect_accounts s where s.org_id = a.org_id and s.transfers_active)
on conflict (org_id) do nothing;
