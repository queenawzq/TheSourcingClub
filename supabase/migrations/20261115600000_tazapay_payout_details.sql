-- ============================================================================
-- Tazapay: the details a payout to a factory in mainland China or Hong Kong needs
-- ----------------------------------------------------------------------------
-- Tazapay pays CNY over CNAPS and HKD over CHATS, which Stripe Connect cannot
-- reach. Its payee needs more than a bank wire does:
--   China: the account holder's name in Chinese, as the bank has it, and the
--          company's unified social credit code (USCC). The CNAPS code is optional.
--   Hong Kong: the 3-digit bank code and the holder's address.
-- These are kept on the bank account they describe, next to its name, bank and
-- SWIFT. The full number stays in Vault, as before.
--
-- Which accounts Tazapay pays, and whether one has everything it needs, is
-- decided in src/shared/tazapay-payout.mjs. The checks here are the last word on
-- format: what no form, script or direct write may store.
--
-- tazapay_beneficiary_id is the payee Tazapay made from these details. Only the
-- server sets it (set_tazapay_beneficiary, service role), and the guard clears it
-- the moment anything it was made from changes, as it does Wise's recipient.
-- Changing these details also moves details_changed_at, so a payout pressed on
-- details that changed under the page is refused, and the company is told.
--
-- 'tazapay' joins the providers a payout attempt may be made with. Nothing can
-- start one yet: claim_provider_payout still refuses any provider but Wise and
-- PayPal until the payout path is built.
--
-- Safe with the live site while applied: columns and a constraint are only
-- added, both functions keep their signatures and behave as before for every
-- column the live site writes.
-- ============================================================================

alter table public.provider_payouts
  drop constraint provider_payouts_provider_check,
  add constraint provider_payouts_provider_check check (provider in ('wise', 'paypal', 'tazapay'));

alter table public.factory_payout_accounts
  -- The account holder's name as the bank has it, in Chinese characters.
  add column holder_name_local text,
  -- China: the USCC (18 characters). Hong Kong: the business registration number.
  add column registration_number text,
  -- Hong Kong: the 3-digit bank code. China: the 12-digit CNAPS code, if given.
  add column bank_code text,
  add column address_line1 text,
  add column address_city text,
  add column address_state text,
  add column address_postal_code text,
  add column tazapay_beneficiary_id text;

alter table public.factory_payout_accounts
  add constraint factory_payout_tazapay_bank_only check (
    method = 'bank' or (holder_name_local is null and registration_number is null and bank_code is null
      and address_line1 is null and address_city is null and address_state is null
      and address_postal_code is null and tazapay_beneficiary_id is null)
  ),
  add constraint factory_payout_holder_name_local check (
    holder_name_local is null or (
      holder_name_local = btrim(holder_name_local)
      and char_length(holder_name_local) between 2 and 140
      and holder_name_local ~ '[㐀-鿿]'
      and holder_name_local !~ '[[:cntrl:]]'
    )
  ),
  add constraint factory_payout_registration_number check (
    registration_number is null or (
      registration_number = public.normalise_registration_number(coalesce(bank_country::text, ''), registration_number)
      and public.registration_number_problem(coalesce(bank_country::text, ''), registration_number) is null
    )
  ),
  add constraint factory_payout_bank_code check (bank_code is null or bank_code ~ '^([0-9]{3}|[0-9]{12})$'),
  add constraint factory_payout_address check (
    (address_line1 is null or char_length(address_line1) between 1 and 140)
    and (address_city is null or char_length(address_city) between 1 and 80)
    and (address_state is null or char_length(address_state) between 1 and 80)
    and (address_postal_code is null or address_postal_code ~ '^[A-Za-z0-9 -]{1,16}$')
    and concat(address_line1, address_city, address_state, address_postal_code) !~ '[[:cntrl:]]'
  ),
  add constraint factory_payout_tazapay_beneficiary check (
    tazapay_beneficiary_id is null or tazapay_beneficiary_id ~ '^bnf_[a-z0-9]{8,64}$'
  );

-- ---------------------------------------------------------------------------
-- The guard (from 20261107100000). Changed: the new details are held to the
-- same no-number rule as every other field, count as a change of where the
-- company is paid, and only the server writes tazapay_beneficiary_id.
-- ---------------------------------------------------------------------------
create or replace function public.guard_payout_account_fields()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  stored public.payout_account_numbers;
  plain text;
begin
  if tg_op = 'UPDATE' and new.org_id is distinct from old.org_id then
    raise exception 'a payout account stays with its company'
      using errcode = '42501', hint = 'payout_org_locked';
  end if;

  if new.iban is not null and btrim(new.iban) <> ''
     and (tg_op = 'INSERT' or new.iban is distinct from old.iban) then
    raise exception 'an IBAN belongs only in the account number field'
      using errcode = '22023', hint = 'number_in_field';
  end if;
  new.iban := null;

  select * into stored from public.payout_account_numbers where account_id = new.id;

  if stored.account_id is not null and new.method <> 'bank' then
    delete from public.payout_account_numbers where account_id = new.id;
    stored := null;
  end if;

  if stored.account_id is not null then
    plain := public.payout_number_plain(new.id);
    if new.account_number_last4 is distinct from right(regexp_replace(plain, '[^0-9]', '', 'g'), 4) then
      delete from public.payout_account_numbers where account_id = new.id;
      stored := null;
    end if;
  end if;

  if public.payout_text_holds_number(new.org_id, concat_ws(' ', new.label)) then
    raise exception 'an account number belongs only in the account number field'
      using errcode = '22023', hint = 'number_in_field';
  end if;
  if public.payout_text_holds_number(new.org_id, new.bank_name)
     or public.payout_text_holds_number(new.org_id, new.account_name)
     or public.payout_text_holds_number(new.org_id, new.branch)
     or public.payout_text_holds_number(new.org_id, new.swift)
     or public.payout_text_holds_number(new.org_id, new.instructions)
     or public.payout_text_holds_number(new.org_id, new.wise_details::text)
     or public.payout_text_holds_number(new.org_id, new.holder_name_local)
     or public.payout_text_holds_number(new.org_id, concat_ws(' ', new.address_line1, new.address_city,
                                                          new.address_state, new.address_postal_code)) then
    raise exception 'an account number belongs only in the account number field'
      using errcode = '22023', hint = 'number_in_field';
  end if;

  if new.wise_details is not null and exists (
    select 1 from jsonb_object_keys(new.wise_details) as k(name)
     where k.name ~* '(account.?number|iban|card.?number|clabe)'
        or k.name = new.wise_number_key
  ) then
    raise exception 'an account number belongs only in the account number field'
      using errcode = '22023', hint = 'number_in_field';
  end if;

  new.number_changed_at := stored.updated_at;

  if coalesce(auth.role(), '') = 'authenticated' then
    new.wise_recipient_id := case when tg_op = 'UPDATE' then old.wise_recipient_id end;
    new.tazapay_beneficiary_id := case when tg_op = 'UPDATE' then old.tazapay_beneficiary_id end;
  end if;

  if tg_op = 'INSERT' then
    new.details_changed_at := clock_timestamp();
  elsif (new.method, new.payoneer_email, new.paypal_email, new.bank_name, new.account_name, new.account_number_last4,
         new.swift, new.branch, new.instructions, new.bank_country, new.number_changed_at,
         new.wise_recipient_type, new.wise_currency, new.wise_number_key, new.wise_details,
         new.holder_name_local, new.registration_number, new.bank_code,
         new.address_line1, new.address_city, new.address_state, new.address_postal_code)
        is distinct from
        (old.method, old.payoneer_email, old.paypal_email, old.bank_name, old.account_name, old.account_number_last4,
         old.swift, old.branch, old.instructions, old.bank_country, old.number_changed_at,
         old.wise_recipient_type, old.wise_currency, old.wise_number_key, old.wise_details,
         old.holder_name_local, old.registration_number, old.bank_code,
         old.address_line1, old.address_city, old.address_state, old.address_postal_code) then
    new.details_changed_at := clock_timestamp();
    new.wise_recipient_id := null;
    new.tazapay_beneficiary_id := null;
  elsif new.is_primary and not old.is_primary then
    new.details_changed_at := clock_timestamp();
  else
    new.details_changed_at := old.details_changed_at;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_payout_account_fields() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The company is told when the bank account TSC pays changes (from
-- 20261109100000). Changed: the Chinese name, the registration number and the
-- bank code are part of it too, since a swap of any of them pays someone else.
-- ---------------------------------------------------------------------------
create or replace function public.notify_default_bank_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  org uuid := coalesce(new.org_id, old.org_id);
  what text;
  named text;
begin
  if coalesce(auth.role(), '') <> 'authenticated' then
    return null;
  end if;
  if not exists (select 1 from public.orgs where id = org) then
    return null;
  end if;

  if tg_op <> 'DELETE' and new.method = 'bank' and new.is_primary
     and (tg_op = 'INSERT' or not old.is_primary or old.method <> 'bank') then
    -- It may have lost the default again before the transaction ended.
    if not exists (
      select 1 from public.factory_payout_accounts where id = new.id and is_primary
    ) then
      return null;
    end if;
    named := new.bank_name || case when new.account_number_last4 is not null
      then format(' ending %s', new.account_number_last4) else '' end;
    if exists (
      select 1 from public.notifications n
       where n.org_id = org and n.kind = 'payout_method_changed' and n.created_at = now()
         and starts_with(n.body, format('TSC now pays your bank account at %s, instead of Payoneer account', named))
    ) then
      return null;
    end if;
    -- New: while Stripe pays, this bank is only saved. (The route is read at
    -- commit, so choose_payout_method's own change counts.)
    what := case when public.uses_stripe_payout(org)
      then format('Your bank account at %s was saved.', named)
      else format('TSC now pays your bank account at %s.', named) end;

  elsif tg_op = 'UPDATE' and new.method = 'bank' and new.is_primary and old.is_primary and old.method = 'bank'
        and (new.bank_name, new.account_name, new.account_number_last4, new.swift, new.branch,
             new.bank_country, new.instructions, new.number_changed_at,
             new.wise_details, new.wise_number_key, new.wise_currency, new.wise_recipient_type,
             new.holder_name_local, new.registration_number, new.bank_code)
            is distinct from
            (old.bank_name, old.account_name, old.account_number_last4, old.swift, old.branch,
             old.bank_country, old.instructions, old.number_changed_at,
             old.wise_details, old.wise_number_key, old.wise_currency, old.wise_recipient_type,
             old.holder_name_local, old.registration_number, old.bank_code) then
    named := new.bank_name || case when new.account_number_last4 is not null
      then format(' ending %s', new.account_number_last4) else '' end;
    what := format(case when public.uses_stripe_payout(org)
      then 'Your saved bank account changed: it is now %s, in the name of %s.'
      else 'The bank account TSC pays changed: it is now %s, in the name of %s.' end, named, new.account_name);

  -- New: a row that was another method and is now a bank, default or not.
  elsif tg_op = 'UPDATE' and new.method = 'bank' and old.method <> 'bank' then
    named := new.bank_name || case when new.account_number_last4 is not null
      then format(' ending %s', new.account_number_last4) else '' end;
    what := format('Your bank account at %s replaced a withdrawal method.', named);

  elsif old.method = 'bank' and old.is_primary
        and (tg_op = 'DELETE' or not new.is_primary or new.method <> 'bank')
        and not exists (select 1 from public.factory_payout_accounts where org_id = org and is_primary) then
    named := old.bank_name || case when old.account_number_last4 is not null
      then format(' ending %s', old.account_number_last4) else '' end;
    what := case when public.uses_stripe_payout(org)
      then format('Your bank account at %s was removed.', named)
      else format('TSC no longer pays your bank account at %s, and you have no default payout method.', named) end;
  end if;

  if what is not null then
    insert into public.notifications (org_id, kind, title, body)
    values (org, 'payout_method_changed', 'Your payout methods changed',
      what || ' If nobody at your company made this change, email operations@contact.sourcing-club.com now.');
  end if;
  return null;
end;
$$;

revoke all on function public.notify_default_bank_change() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The server keeps the payee Tazapay made. False when the details changed
-- while Tazapay was answering: that payee describes an account no longer there.
-- ---------------------------------------------------------------------------
create or replace function public.set_tazapay_beneficiary(target_account uuid, beneficiary_id text, made_from timestamptz)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.factory_payout_accounts
     set tazapay_beneficiary_id = beneficiary_id
   where id = target_account and method = 'bank' and details_changed_at = made_from;
  return found;
end;
$$;
revoke all on function public.set_tazapay_beneficiary(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.set_tazapay_beneficiary(uuid, text, timestamptz) to service_role;
