-- ============================================================================
-- Staff turn PayPal and Wise on and off, per region, with no code change.
--
-- Two providers (paypal, wise) by two regions: 'china' is a factory whose
-- company country (factory_profiles.country_code) is CN or HK, 'elsewhere' is
-- every other country, a missing one included. payout_region() is that rule,
-- in this one place; the screens ask payout_providers_for() rather than
-- deciding it themselves. It is the same country api/_withdrawals.js reads
-- for PayPal's fee.
--
-- Off means:
--   * a NEW method of that provider cannot be saved for a company in that
--     region (factory_payout_accounts_provider_switch, on insert, and on an
--     update that turns a row into that provider). A saved one stays.
--   * request_withdrawal() refuses a new withdrawal to it
--     (hint withdrawal_provider_off).
--   * withdrawals already requested or being paid finish as before: nothing
--     staff run (claim, record, mark paid) reads the switches.
-- Bank transfers paid by staff are not switched.
--
-- Only signed-in people are checked. The server's and the seed's own writes
-- (service role, no auth.uid()) are not, as with call text.
--
-- Starts with PayPal on in both regions and Wise off in both.
--
-- Safe with the live site while applied: adds a table and functions, adds a
-- trigger, and replaces request_withdrawal() with the same signature.
-- ============================================================================

create table if not exists public.payout_provider_settings (
  provider   text not null check (provider in ('paypal', 'wise')),
  region     text not null check (region in ('china', 'elsewhere')),
  enabled    boolean not null,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (provider, region)
);

insert into public.payout_provider_settings (provider, region, enabled) values
  ('paypal', 'china', true),
  ('paypal', 'elsewhere', true),
  ('wise', 'china', false),
  ('wise', 'elsewhere', false)
on conflict (provider, region) do nothing;

alter table public.payout_provider_settings enable row level security;

-- Signed-in companies may read the switches (the chooser needs them); nobody
-- writes through the API. anon gets nothing.
drop policy if exists payout_provider_settings_read on public.payout_provider_settings;
create policy payout_provider_settings_read on public.payout_provider_settings
  for select to authenticated using (true);
revoke all on public.payout_provider_settings from public, anon;
grant select on public.payout_provider_settings to authenticated;
revoke insert, update, delete, truncate on public.payout_provider_settings from authenticated;
-- A factory's open chooser or Withdraw dialog follows a switch as staff flip it.
alter publication supabase_realtime add table public.payout_provider_settings;

-- The one region rule: CN or HK is 'china', anything else (or none) 'elsewhere'.
create or replace function public.payout_region(target_org uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when (select upper(p.country_code) from public.factory_profiles p where p.org_id = target_org)
                   in ('CN', 'HK')
              then 'china' else 'elsewhere' end;
$$;
revoke all on function public.payout_region(uuid) from public, anon, authenticated;

-- Whether a provider is on for a company. A provider with no switch (bank) is on.
create or replace function public.payout_provider_enabled(target_org uuid, which text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select s.enabled from public.payout_provider_settings s
                    where s.provider = which and s.region = public.payout_region(target_org)), true);
$$;
revoke all on function public.payout_provider_enabled(uuid, text) from public, anon, authenticated;

-- What a company's own screens offer: its region and each switch for it.
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
    'wise', public.payout_provider_enabled(target_org, 'wise')
  );
end;
$$;
revoke all on function public.payout_providers_for(uuid) from public, anon, authenticated;
grant execute on function public.payout_providers_for(uuid) to authenticated;

-- Staff only. The admin test is the first statement.
create or replace function public.set_payout_provider(provider text, region text, enabled boolean)
returns public.payout_provider_settings
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  saved public.payout_provider_settings;
begin
  if not public.is_platform_admin() then
    raise exception 'only TSC staff can change payment providers' using errcode = '42501', hint = 'admin_only';
  end if;
  if enabled is null then
    raise exception 'say on or off' using errcode = '22023', hint = 'provider_switch_invalid';
  end if;
  update public.payout_provider_settings s
     set enabled = set_payout_provider.enabled, updated_by = auth.uid(), updated_at = now()
   where s.provider = set_payout_provider.provider and s.region = set_payout_provider.region
  returning * into saved;
  if not found then
    raise exception 'no such provider or region' using errcode = '22023', hint = 'provider_switch_invalid';
  end if;
  return saved;
end;
$$;
revoke all on function public.set_payout_provider(text, text, boolean) from public, anon, authenticated;
grant execute on function public.set_payout_provider(text, text, boolean) to authenticated;

-- A new PayPal or Wise method, while that provider is off for the company's region.
create or replace function public.guard_payout_provider_switch()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  which text := public.withdrawal_provider_for(new);
begin
  if auth.uid() is null or which is null or which = 'bank' then
    return new;
  end if;
  if tg_op = 'UPDATE' and public.withdrawal_provider_for(old) is not distinct from which then
    return new;
  end if;
  if not public.payout_provider_enabled(new.org_id, which) then
    raise exception 'this withdrawal method is not available right now'
      using errcode = '22023', hint = 'payout_provider_off';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_payout_provider_switch() from public, anon, authenticated;

drop trigger if exists factory_payout_accounts_provider_switch on public.factory_payout_accounts;
create trigger factory_payout_accounts_provider_switch
  before insert or update of method, wise_recipient_type on public.factory_payout_accounts
  for each row execute function public.guard_payout_provider_switch();

-- 20261117100000's request_withdrawal(), with the switch checked after the method.
create or replace function public.request_withdrawal(target_org uuid, amount bigint, target_account uuid)
returns public.factory_withdrawals
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  a public.factory_payout_accounts;
  w public.factory_withdrawals;
  which text;
  available bigint;
begin
  if not public.is_org_owner(target_org) then
    raise exception 'Only a company owner can withdraw.' using errcode = '42501', hint = 'withdraw_owner_only';
  end if;
  -- Two tabs asking at once are checked one after the other against the balance.
  perform 1 from public.orgs where id = target_org for update;
  if amount is null or amount <= 0 then
    raise exception 'Enter an amount to withdraw.' using errcode = '22023', hint = 'withdrawal_amount';
  end if;
  -- Net of every request still open, so several requests can never add up to more.
  available := public.factory_withdrawable(target_org);
  if amount > available then
    raise exception 'That is more than your balance.' using errcode = '22023', hint = 'withdrawal_over_balance';
  end if;
  select * into a from public.factory_payout_accounts x where x.id = target_account and x.org_id = target_org;
  if not found then
    raise exception 'Choose one of your saved withdrawal methods.' using errcode = '22023', hint = 'withdrawal_method';
  end if;
  which := public.withdrawal_provider_for(a);
  if which is null
     or (a.method = 'bank' and (nullif(btrim(a.account_name), '') is null or a.number_changed_at is null))
     or (a.method = 'paypal' and nullif(btrim(a.paypal_email), '') is null) then
    raise exception 'Complete this withdrawal method first.' using errcode = '22023', hint = 'withdrawal_method';
  end if;
  -- Staff switched this provider off for the company's region.
  if not public.payout_provider_enabled(target_org, which) then
    raise exception 'This withdrawal method is not available right now.' using errcode = '22023', hint = 'withdrawal_provider_off';
  end if;
  if which = 'bank' and amount <= public.bank_payout_fee_cents() then
    raise exception 'this withdrawal is not more than the bank transfer fee, so nothing would arrive'
      using errcode = '22023', hint = 'fee_too_large';
  end if;
  insert into public.factory_withdrawals
    (org_id, account_id, provider, amount_cents, currency, paid_to, paid_to_changed_at, requested_by)
  values (target_org, a.id, which, amount, 'USD',
          case when a.method = 'paypal' then a.paypal_email
               else format('%s ending %s', coalesce(a.bank_name, 'Bank account'), a.account_number_last4) end,
          a.details_changed_at, auth.uid())
  returning * into w;
  perform public.withdrawal_notice(w,
    format('Withdrawal of %s requested', public.format_money(w.amount_cents, w.currency)),
    format('To %s. TSC will send it after checking.', w.paid_to));
  return w;
end;
$$;
revoke all on function public.request_withdrawal(uuid, bigint, uuid) from public, anon;
grant execute on function public.request_withdrawal(uuid, bigint, uuid) to authenticated;
