-- ============================================================================
-- The default withdrawal method can always be changed; PayPal can be turned
-- on only where Stripe can't pay out.
-- ----------------------------------------------------------------------------
-- 1. choose_payout_method() no longer refuses while money is owed or a payout
--    is under way. Everything already moving records where it goes:
--      * a withdrawal (factory_withdrawals.account_id, paid_to);
--      * a Wise or PayPal payout (provider_payouts.account_id, paid_to), and
--        claim_payment_release() still refuses a payment while one runs;
--      * a Stripe transfer, once claimed, goes to the connected account;
--        a release that stops because the default changed now lands in the
--        balance (api/_stripe.js calls join_owed_to_pool()).
--    Approved money in the balance (withdrawal_pool) was the usual reason for
--    the old refusal, and Stripe can never claim it (guard_withdrawal_pool).
--    The one case left: money owed outside the balance while the default is a
--    saved method, which staff pay by hand. Choosing Stripe first moves it
--    into the balance (join_owed_to_pool, still on the saved method at that
--    moment), so Stripe never pays it. The balance trigger that refused
--    Stripe while money sat in the balance goes too: the balance stays
--    withdrawable to the saved methods (request_withdrawal reads no default).
-- 2. A third PayPal switch, region 'no_stripe' ("Where Stripe isn't
--    available"), off. PayPal is on for a method when its region's switch is
--    on, or when this one is on and the method's country (payout_country, else
--    the company's) is not one Stripe pays out to. stripe_pays_out_to() holds
--    the same list as src/shared/stripe-payout-countries.mjs; the build's
--    check:payout-routing fails if they differ.
--
-- Safe with the live site while applied: replaces functions with the same
-- signatures, widens a check constraint, adds one row and two functions.
-- ============================================================================

-- 1. ---------------------------------------------------------------------------
create or replace function public.choose_payout_method(target_org uuid, target_account uuid default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  a public.factory_payout_accounts;
  was_stripe boolean;
  new_primary boolean := false;
  what text;
begin
  if not public.is_org_owner(target_org) then
    raise exception 'Only a company owner can change the default withdrawal method.' using errcode='42501';
  end if;
  -- This is the same row lock acquired by both provider claims.
  perform 1 from public.stripe_connect_accounts where org_id=target_org for update;
  was_stripe := public.uses_stripe_payout(target_org);
  if target_account is null then
    if not exists (select 1 from public.stripe_connect_accounts s where s.org_id=target_org and s.transfers_active) then
      raise exception 'Finish bank-account verification before choosing it as the default.' using errcode='22023';
    end if;
    -- New: what is owed on the saved method stays there, in the balance,
    -- instead of being paid a second time through Stripe.
    if not was_stripe then
      perform public.join_owed_to_pool(target_org);
    end if;
  else
    select * into a from public.factory_payout_accounts where id=target_account and org_id=target_org;
    if not found or a.method not in ('bank','paypal') then
      raise exception 'Choose a saved bank transfer or PayPal account for this company.' using errcode='22023';
    end if;
    if (a.method='bank' and (nullif(btrim(a.account_name),'') is null or nullif(btrim(a.bank_name),'') is null or a.number_changed_at is null))
       or (a.method='paypal' and nullif(btrim(a.paypal_email),'') is null) then
      raise exception 'Complete the withdrawal details before choosing this method.' using errcode='22023';
    end if;
    new_primary := not a.is_primary;
    if new_primary then perform public.set_primary_payout_account(target_account); end if;
  end if;
  insert into public.factory_payout_preferences(org_id,route) values(target_org,case when target_account is null then 'stripe' else 'manual' end)
    on conflict(org_id) do update set route=excluded.route, changed_at=now();
  if was_stripe is distinct from (target_account is null) and not new_primary then
    what := case
      when target_account is null then 'TSC now pays your connected payout account.'
      when a.method = 'paypal' then format('TSC now pays PayPal account %s.', a.paypal_email)
      else format('TSC now pays your bank account at %s%s.', a.bank_name,
        case when a.account_number_last4 is not null then format(' ending %s', a.account_number_last4) else '' end)
    end;
    insert into public.notifications (org_id, kind, title, body)
    values (target_org, 'payout_method_changed', 'Your payout methods changed',
      what || ' If nobody at your company made this change, email operations@contact.sourcing-club.com now.');
  end if;
end; $$;
revoke all on function public.choose_payout_method(uuid, uuid) from public, anon;
grant execute on function public.choose_payout_method(uuid, uuid) to authenticated;

-- The trigger from 20261116200000 refused Stripe while the factory had money
-- in its balance or a withdrawal open. Neither is moving through the default:
-- a withdrawal carries its account, and request_withdrawal() takes any saved
-- method whatever the default, so the balance is still withdrawn the way it
-- was earned. The function stays, unused, for the site live during the deploy.
drop trigger if exists factory_payout_preferences_guard_balance on public.factory_payout_preferences;

-- The server key calls this when a Stripe release stops because the factory
-- chose another default (api/_stripe.js).
grant execute on function public.join_owed_to_pool(uuid) to service_role;

-- 2. ---------------------------------------------------------------------------
alter table public.payout_provider_settings drop constraint if exists payout_provider_settings_region_check;
alter table public.payout_provider_settings add constraint payout_provider_settings_region_check
  check (region in ('china', 'elsewhere', 'no_stripe'));

insert into public.payout_provider_settings (provider, region, enabled) values ('paypal', 'no_stripe', false)
on conflict (provider, region) do nothing;

-- Where a US platform's Connect transfers reach. Same list as
-- src/shared/stripe-payout-countries.mjs (check:payout-routing compares them).
create or replace function public.stripe_pays_out_to(country text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select upper(btrim(coalesce(country, ''))) = any (array[
    'US', 'CA', 'GB', 'CH',
    'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT',
    'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO'
  ]);
$$;
revoke all on function public.stripe_pays_out_to(text) from public, anon, authenticated;

-- A switch's value, on when it has no row (bank).
create or replace function public.payout_switch(which text, which_region text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select s.enabled from public.payout_provider_settings s
                    where s.provider = which and s.region = which_region),
                  which_region <> 'no_stripe');
$$;
revoke all on function public.payout_switch(text, text) from public, anon, authenticated;

-- The one rule, for a country: its region's switch, or (PayPal) the
-- "where Stripe isn't available" switch for a country Stripe can't pay.
create or replace function public.payout_provider_enabled_in(country text, which text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.payout_switch(which, public.payout_region_of(country))
      or (which = 'paypal' and public.payout_switch('paypal', 'no_stripe') and not public.stripe_pays_out_to(country));
$$;
revoke all on function public.payout_provider_enabled_in(text, text) from public, anon, authenticated;

create or replace function public.payout_provider_enabled(target_org uuid, which text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.payout_provider_enabled_in((select p.country_code from public.factory_profiles p where p.org_id = target_org), which);
$$;
revoke all on function public.payout_provider_enabled(uuid, text) from public, anon, authenticated;

create or replace function public.payout_provider_enabled_for_account(a public.factory_payout_accounts, which text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.payout_provider_enabled_in(
    coalesce(a.payout_country, (select p.country_code from public.factory_profiles p where p.org_id = a.org_id)), which);
$$;
revoke all on function public.payout_provider_enabled_for_account(public.factory_payout_accounts, text) from public, anon, authenticated;

-- The chooser maps a picked country with the same rule: it gets the new
-- switch and the country list, and still owns neither.
create or replace function public.payout_providers_for(target_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not (public.is_org_member(target_org) or public.is_platform_admin()) then
    raise exception 'not a member of this company' using errcode = '42501', hint = 'payout_owner_only';
  end if;
  return jsonb_build_object(
    'region', public.payout_region(target_org),
    'paypal', public.payout_provider_enabled(target_org, 'paypal'),
    'wise', public.payout_provider_enabled(target_org, 'wise'),
    'byRegion', (
      select jsonb_object_agg(r.region, jsonb_build_object(
               'paypal', public.payout_switch('paypal', r.region),
               'wise',   public.payout_switch('wise', r.region)))
        from (values ('china'), ('elsewhere')) as r(region)),
    'chinaCountries', jsonb_build_array('CN', 'HK'),
    'paypalWhereNoStripe', public.payout_switch('paypal', 'no_stripe'),
    'stripeCountries', to_jsonb(array[
      'US', 'CA', 'GB', 'CH',
      'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT',
      'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO'])
  );
end;
$$;
revoke all on function public.payout_providers_for(uuid) from public, anon, authenticated;
grant execute on function public.payout_providers_for(uuid) to authenticated;
