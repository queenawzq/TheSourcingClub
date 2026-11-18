-- ============================================================================
-- The country picked when a withdrawal method is added decides which provider
-- switch applies, not the company's country.
--
-- 20261117200000 put a company in one region (company country CN or HK is
-- 'china', anything else 'elsewhere') and offered PayPal and Wise by that
-- region whatever country the factory picked in the chooser. Now:
--
--   * factory_payout_accounts.payout_country is the country picked when the
--     method was added ('ZZ' for "Other / not listed", which is 'elsewhere').
--     Rows saved before this keep null and are read by the company's country,
--     exactly as before.
--   * payout_region_of(country) is the one region rule; payout_region(org)
--     now calls it with the company's country.
--   * The switch guard and request_withdrawal() check the account's own
--     region. The guard also runs when payout_country changes, so a method
--     added under a country that is on cannot be moved to one that is off.
--   * save_wise_payout_account() takes payout_country. Dropped and recreated
--     with the new argument last and defaulting to null, so the live site's
--     call without it still matches while this applies.
--   * payout_providers_for() keeps region, paypal and wise (the live site
--     reads them) and adds byRegion and chinaCountries, so the chooser maps a
--     picked country to its switches without owning the rule.
--
-- request_withdrawal() is 20261117500000's, with the switch read by account.
-- Withdrawals already asked for finish as before: nothing staff run reads the
-- switches.
--
-- Safe with the live site while applied: adds a nullable column, adds
-- functions, replaces functions with the same signatures, and recreates the
-- Wise save with one more defaulted argument.
-- ============================================================================

alter table public.factory_payout_accounts
  add column if not exists payout_country text
  check (payout_country ~ '^[A-Z]{2}$');

comment on column public.factory_payout_accounts.payout_country is
  'Country picked in the chooser when the method was added; ZZ = not listed. Null on rows saved before 20261118600000: the company''s country applies.';

-- The one region rule: CN or HK is 'china', anything else (or none) 'elsewhere'.
create or replace function public.payout_region_of(country text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case when upper(btrim(coalesce(country, ''))) in ('CN', 'HK') then 'china' else 'elsewhere' end;
$$;
revoke all on function public.payout_region_of(text) from public, anon, authenticated;

create or replace function public.payout_region(target_org uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.payout_region_of((select p.country_code from public.factory_profiles p where p.org_id = target_org));
$$;
revoke all on function public.payout_region(uuid) from public, anon, authenticated;

-- An account's region: the country picked for it, else the company's.
create or replace function public.payout_region_for_account(a public.factory_payout_accounts)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when a.payout_country is not null then public.payout_region_of(a.payout_country)
              else public.payout_region(a.org_id) end;
$$;
revoke all on function public.payout_region_for_account(public.factory_payout_accounts) from public, anon, authenticated;

-- Whether a provider is on for one account. A provider with no switch (bank) is on.
create or replace function public.payout_provider_enabled_for_account(a public.factory_payout_accounts, which text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select s.enabled from public.payout_provider_settings s
                    where s.provider = which and s.region = public.payout_region_for_account(a)), true);
$$;
revoke all on function public.payout_provider_enabled_for_account(public.factory_payout_accounts, text) from public, anon, authenticated;

-- What a company's own screens offer: its region and switches as before, plus
-- every region's switches and which countries are 'china'.
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
               'paypal', coalesce((select s.enabled from public.payout_provider_settings s where s.provider = 'paypal' and s.region = r.region), true),
               'wise',   coalesce((select s.enabled from public.payout_provider_settings s where s.provider = 'wise' and s.region = r.region), true)))
        from (values ('china'), ('elsewhere')) as r(region)),
    'chinaCountries', jsonb_build_array('CN', 'HK')
  );
end;
$$;
revoke all on function public.payout_providers_for(uuid) from public, anon, authenticated;
grant execute on function public.payout_providers_for(uuid) to authenticated;

-- A new PayPal or Wise method, or one moved to another country, while that
-- provider is off for the account's region.
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
  if tg_op = 'UPDATE'
     and public.withdrawal_provider_for(old) is not distinct from which
     and public.payout_region_for_account(old) is not distinct from public.payout_region_for_account(new) then
    return new;
  end if;
  if not public.payout_provider_enabled_for_account(new, which) then
    raise exception 'this withdrawal method is not available right now'
      using errcode = '22023', hint = 'payout_provider_off';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_payout_provider_switch() from public, anon, authenticated;

drop trigger if exists factory_payout_accounts_provider_switch on public.factory_payout_accounts;
create trigger factory_payout_accounts_provider_switch
  before insert or update of method, wise_recipient_type, payout_country on public.factory_payout_accounts
  for each row execute function public.guard_payout_provider_switch();

-- 20261117500000's request_withdrawal(), with the switch read by the account.
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
  -- A bank account staff would pay by hand is not a way to withdraw, and
  -- staff may have switched this provider off for the account's region.
  if which = 'bank' or not public.payout_provider_enabled_for_account(a, which) then
    raise exception 'This withdrawal method is not available right now.' using errcode = '22023', hint = 'withdrawal_provider_off';
  end if;
  insert into public.factory_withdrawals
    (org_id, account_id, provider, amount_cents, currency, paid_to, paid_to_changed_at, requested_by)
  values (target_org, a.id, which, amount, 'USD',
          case when a.method = 'paypal' then a.paypal_email
               else format('%s ending %s', coalesce(a.bank_name, 'Bank account'), a.account_number_last4) end,
          a.payee_changed_at, auth.uid())
  returning * into w;
  perform public.withdrawal_notice(w,
    format('Withdrawal of %s requested', public.format_money(w.amount_cents, w.currency)),
    format('To %s. TSC will send it after checking.', w.paid_to));
  return w;
end;
$$;
revoke all on function public.request_withdrawal(uuid, bigint, uuid) from public, anon;
grant execute on function public.request_withdrawal(uuid, bigint, uuid) to authenticated;

-- 20261107100000's Wise save, with the picked country. Replaced, not
-- overloaded: the live site calls it through the API with nine named
-- arguments, which this one (its tenth defaulting to null) still takes, so the
-- old code keeps working while the deploy runs. A second, nine-argument
-- version kept beside it would make that same call ambiguous: the API then
-- refuses it ("Could not choose the best candidate function", PGRST203), as
-- tried on a local stack. payout_methods_test.sql pins that there is one.
drop function if exists public.save_wise_payout_account(uuid, uuid, text, text, text, jsonb, text, text, text);

create or replace function public.save_wise_payout_account(
  target_org uuid,
  target_account uuid default null,
  bank_name text default null,
  recipient_type text default null,
  currency text default null,
  details jsonb default null,
  number_key text default null,
  account_number text default null,
  account_number_again text default null,
  payout_country text default null
)
returns public.factory_payout_accounts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  existing public.factory_payout_accounts;
  stored public.payout_account_numbers;
  saved public.factory_payout_accounts;
  the_id uuid := coalesce(target_account, gen_random_uuid());
  typed text := public.payout_number_normal(account_number);
  again text := public.payout_number_normal(account_number_again);
  kind text := case when number_key ilike 'iban' then 'iban' else 'account' end;
  bank text := nullif(btrim(coalesce(bank_name, '')), '');
  form jsonb := coalesce(details, '{}'::jsonb) - 'isContractDenotedInCny';
  holder text;
  code text;
  country text;
  last_four text;
  org_kind text;
  plain text;
  picked text := nullif(upper(btrim(coalesce(payout_country, ''))), '');
begin
  if target_account is not null then
    select * into existing from public.factory_payout_accounts a where a.id = target_account;
  end if;
  -- One refusal for "not yours" and "does not exist".
  if (target_account is not null and (existing.id is null or existing.org_id <> target_org))
     or not public.is_org_owner(target_org) then
    raise exception 'only a company owner can change payout methods'
      using errcode = '42501', hint = 'payout_owner_only';
  end if;

  select o.type::text into org_kind from public.orgs o where o.id = target_org;
  if org_kind = 'brand' then
    raise exception 'only a company owner can change payout methods'
      using errcode = '42501', hint = 'payout_owner_only';
  end if;

  if existing.id is not null and existing.method <> 'bank' then
    raise exception 'that payout method is not a bank account'
      using errcode = '22023', hint = 'payout_not_bank';
  end if;

  if recipient_type is null or recipient_type !~ '^[a-z0-9_]{2,64}$'
     or currency is null or upper(currency) !~ '^[A-Z]{3}$'
     or number_key is null or number_key !~ '^[A-Za-z][A-Za-z.]{0,63}$'
     or jsonb_typeof(form) <> 'object' then
    raise exception 'that is not a form we can pay'
      using errcode = '22023', hint = 'wise_form_invalid';
  end if;
  if exists (
    select 1 from jsonb_each(form) as f(key, value)
     where f.key !~ '^[A-Za-z][A-Za-z.]{0,63}$' or jsonb_typeof(f.value) <> 'string' or length(f.value #>> '{}') > 255
  ) then
    raise exception 'that is not a form we can pay'
      using errcode = '22023', hint = 'wise_form_invalid';
  end if;

  holder := nullif(btrim(coalesce(form ->> 'accountHolderName', '')), '');
  if bank is null or holder is null then
    raise exception 'add the bank and the name on the account'
      using errcode = '22023', hint = 'bank_details_missing';
  end if;
  if not public.payout_name_is_latin(holder) then
    raise exception 'the name on the account must be in English letters'
      using errcode = '22023', hint = 'name_not_latin';
  end if;

  code := nullif(upper(regexp_replace(coalesce(form ->> 'swiftCode', ''), '\s', '', 'g')), '');
  if code is not null and code !~ '^[A-Z0-9]{8}([A-Z0-9]{3})?$' then
    raise exception 'a SWIFT / BIC is 8 or 11 letters and digits'
      using errcode = '22023', hint = 'swift_format';
  end if;
  country := nullif(upper(btrim(coalesce(form ->> 'address.country', ''))), '');
  if country is not null and country !~ '^[A-Z]{2}$' then
    raise exception 'that is not a country code'
      using errcode = '22023', hint = 'country_format';
  end if;

  -- The country picked in the chooser; it decides which switch applies.
  if picked is not null and picked !~ '^[A-Z]{2}$' then
    raise exception 'that is not a country code'
      using errcode = '22023', hint = 'country_format';
  end if;

  select * into stored from public.payout_account_numbers n where n.account_id = the_id;

  if typed = '' and again = '' then
    if stored.account_id is null then
      raise exception 'add the full account number so TSC can pay you'
        using errcode = '22023', hint = 'number_required';
    end if;
    kind := stored.number_kind;
    typed := public.payout_number_normal(public.payout_number_plain(the_id));
  else
    if typed <> again then
      raise exception 'the two account numbers do not match'
        using errcode = '22023', hint = 'number_mismatch';
    end if;
    if typed !~ '^[A-Z0-9]{5,34}$' or length(regexp_replace(typed, '[^0-9]', '', 'g')) < 4 then
      raise exception 'an account number is 5 to 34 letters and digits'
        using errcode = '22023', hint = 'number_format';
    end if;
    if kind = 'iban' and not public.payout_iban_valid(typed) then
      raise exception 'that IBAN does not check out'
        using errcode = '22023', hint = 'iban_invalid';
    end if;
  end if;

  if form ? number_key
     or position(typed in public.payout_number_normal(concat_ws(' ', bank, form::text))) > 0 then
    raise exception 'an account number belongs only in the account number field'
      using errcode = '22023', hint = 'number_in_field';
  end if;

  last_four := right(regexp_replace(typed, '[^0-9]', '', 'g'), 4);

  -- Written before the row: the guard reads it, so one save is one notice.
  if stored.account_id is null then
    insert into public.payout_account_numbers (account_id, vault_secret_id, number_kind)
    values (the_id, vault.create_secret(typed, 'payout-number-' || the_id::text), kind);
  else
    plain := public.payout_number_normal(public.payout_number_plain(the_id));
    if plain <> typed then
      perform vault.update_secret(stored.vault_secret_id, typed);
      update public.payout_account_numbers n set number_kind = kind, updated_at = clock_timestamp()
       where n.account_id = the_id;
    elsif stored.number_kind <> kind then
      update public.payout_account_numbers n set number_kind = kind where n.account_id = the_id;
    end if;
  end if;

  if existing.id is null then
    insert into public.factory_payout_accounts as a
      (id, org_id, bank_name, account_name, account_number_last4, swift, bank_country, is_primary,
       wise_recipient_type, wise_currency, wise_number_key, wise_details, payout_country)
    values
      (the_id, target_org, bank, holder, last_four, code, country,
       not exists (select 1 from public.factory_payout_accounts x where x.org_id = target_org and x.is_primary),
       recipient_type, upper(currency), number_key, form, picked)
    returning * into saved;
  else
    update public.factory_payout_accounts as a
       set bank_name = bank, account_name = holder, account_number_last4 = last_four, swift = code,
           bank_country = country, branch = null, instructions = null,
           wise_recipient_type = recipient_type, wise_currency = upper(currency),
           wise_number_key = number_key, wise_details = form,
           payout_country = coalesce(picked, a.payout_country)
     where a.id = the_id
    returning * into saved;
  end if;

  return saved;
end;
$$;

revoke all on function public.save_wise_payout_account(uuid, uuid, text, text, text, jsonb, text, text, text, text) from public, anon;
grant execute on function public.save_wise_payout_account(uuid, uuid, text, text, text, jsonb, text, text, text, text) to authenticated;

