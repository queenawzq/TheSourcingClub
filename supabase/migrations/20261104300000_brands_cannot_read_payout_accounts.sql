-- ---------------------------------------------------------------------------
-- A brand never reads a factory's payout accounts.
--
-- 030 let a brand read them while a payment was due, because a brand then
-- paid the factory by bank wire and needed somewhere to read the details
-- from. Brands have paid TSC through Stripe since 20261013000200, and no
-- screen has read these rows as a brand since: the factory's Payments page
-- already says "Brands never see these bank details", while any brand with a
-- payment due could read them through the API.
--
-- Safe with the current site live: nothing it runs as a brand reads this table.
-- ---------------------------------------------------------------------------

drop policy factory_payout_read on public.factory_payout_accounts;

create policy factory_payout_read on public.factory_payout_accounts
  for select to authenticated
  using (public.is_org_member(org_id) or public.is_platform_admin());

drop function public.caller_may_see_payout_account(uuid);
