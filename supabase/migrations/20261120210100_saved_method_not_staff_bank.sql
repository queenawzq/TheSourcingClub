-- ============================================================================
-- "Add a withdrawal method": a bank account staff pay by hand is not one
-- ----------------------------------------------------------------------------
-- request_withdrawal() refuses a staff-paid bank account (20261117500000), so
-- for the factory it is no way to withdraw: a factory whose only saved account
-- is one is still asked to add a withdrawal method. A Wise or PayPal account,
-- or a Stripe account, counts as saved even while incomplete, switched off or
-- being verified. (A Payoneer account is not withdrawable either and is
-- treated the same way.) Signature unchanged.
-- ============================================================================
create or replace function public.factory_has_no_saved_method(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select not exists (select 1 from public.factory_payout_accounts a
                      where a.org_id = target_org
                        and public.withdrawal_provider_for(a) in ('wise', 'paypal'))
     and not exists (select 1 from public.stripe_connect_accounts s where s.org_id = target_org);
$$;
revoke all on function public.factory_has_no_saved_method(uuid) from public, anon, authenticated;
