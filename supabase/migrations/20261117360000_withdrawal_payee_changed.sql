-- ============================================================================
-- A withdrawal is refused as "payout_changed" only when the account it pays
-- was removed, its payee details changed, or it is now paid another way;
-- never because it became, or stopped being, the company's default.
--
-- details_changed_at also moves when an account becomes the default, on
-- purpose: for per-step payouts that changes where TSC pays, and it drives
-- the board's 14-day "Verify before sending" warning. That is unchanged. A
-- withdrawal's destination is fixed by factory_withdrawals.account_id, so it
-- compares payee_changed_at instead: the same trigger stamps it on insert
-- and on a change to the payee fields, and not on a default switch.
--
-- Backfilled from details_changed_at, so a withdrawal already open (whose
-- paid_to_changed_at was copied from details_changed_at) compares as before.
--
-- Safe with the live site while applied: adds a column and replaces four
-- functions with the same signatures and grants.
-- ============================================================================

alter table public.factory_payout_accounts
  add column if not exists payee_changed_at timestamptz;

update public.factory_payout_accounts
   set payee_changed_at = details_changed_at
 where payee_changed_at is null;

-- ---------------------------------------------------------------------------
-- The guard (20261107100000). Changed: payee_changed_at, stamped with the same
-- time as details_changed_at on insert and on a payee change, and kept when
-- the account only becomes the default.
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
  stamp timestamptz := clock_timestamp();
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
     or public.payout_text_holds_number(new.org_id, new.wise_details::text) then
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
  end if;

  if tg_op = 'INSERT' then
    new.details_changed_at := stamp;
    new.payee_changed_at := stamp;
  elsif (new.method, new.payoneer_email, new.paypal_email, new.bank_name, new.account_name, new.account_number_last4,
         new.swift, new.branch, new.instructions, new.bank_country, new.number_changed_at,
         new.wise_recipient_type, new.wise_currency, new.wise_number_key, new.wise_details)
        is distinct from
        (old.method, old.payoneer_email, old.paypal_email, old.bank_name, old.account_name, old.account_number_last4,
         old.swift, old.branch, old.instructions, old.bank_country, old.number_changed_at,
         old.wise_recipient_type, old.wise_currency, old.wise_number_key, old.wise_details) then
    new.details_changed_at := stamp;
    new.payee_changed_at := stamp;
    new.wise_recipient_id := null;
  elsif new.is_primary and not old.is_primary then
    -- Where per-step payouts go changed; who the account pays did not.
    new.details_changed_at := stamp;
    new.payee_changed_at := old.payee_changed_at;
  else
    new.details_changed_at := old.details_changed_at;
    new.payee_changed_at := old.payee_changed_at;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_payout_account_fields() from public, anon, authenticated, service_role;

-- 20261117200000's request_withdrawal(). Changed: records payee_changed_at.
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

-- 20261116200000's claim_withdrawal(). Changed: compares payee_changed_at.
create or replace function public.claim_withdrawal(target_withdrawal uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  w public.factory_withdrawals;
  a public.factory_payout_accounts;
  resumed boolean := false;
begin
  if not public.is_platform_admin() then
    raise exception 'paying a factory is limited to platform staff' using errcode = '42501';
  end if;
  select * into w from public.factory_withdrawals where id = target_withdrawal;
  if not found then
    raise exception 'withdrawal not found' using errcode = 'P0002';
  end if;
  perform public.payout_staff_check(w.org_id);
  perform 1 from public.orgs where id = w.org_id for update;
  select * into w from public.factory_withdrawals where id = target_withdrawal for update;
  if w.status = 'paying' then
    if w.lease_until is not null and w.lease_until > now() then
      raise exception 'this is already being paid' using errcode = '22023', hint = 'payout_in_progress';
    end if;
    resumed := true;
  elsif w.status <> 'requested' then
    raise exception 'this withdrawal is %', w.status using errcode = '22023', hint = 'withdrawal_not_waiting';
  end if;
  -- This request is counted in the balance, so what is left must not be negative.
  if public.factory_withdrawable(w.org_id) < 0 then
    raise exception 'the factory''s balance no longer covers this' using errcode = '22023', hint = 'withdrawal_over_balance';
  end if;
  select * into a from public.factory_payout_accounts x where x.id = w.account_id;
  if not found or a.payee_changed_at is distinct from w.paid_to_changed_at
     or public.withdrawal_provider_for(a) is distinct from w.provider then
    raise exception 'this factory changed where it is paid' using errcode = '22023', hint = 'payout_changed';
  end if;
  update public.factory_withdrawals
     set status = 'paying', lease_until = now() + interval '90 seconds', updated_at = now(),
         decided_by = coalesce(decided_by, auth.uid()), decided_at = coalesce(decided_at, now())
   where id = w.id returning * into w;
  return jsonb_build_object(
    'withdrawal_id', w.id, 'key', w.attempt_key, 'resumed', resumed, 'provider', w.provider,
    'provider_ref', w.provider_ref, 'amount_cents', w.amount_cents, 'currency', w.currency,
    'org_id', w.org_id, 'account_id', a.id, 'paypal_email', a.paypal_email,
    'wise_recipient_id', a.wise_recipient_id, 'wise_currency', a.wise_currency
  );
end;
$$;
revoke all on function public.claim_withdrawal(uuid) from public, anon;
grant execute on function public.claim_withdrawal(uuid) to authenticated;

-- 20261117350000's mark_withdrawal_paid_by_bank(). Changed: compares payee_changed_at.
create or replace function public.mark_withdrawal_paid_by_bank(target_withdrawal uuid, reference text)
returns public.factory_withdrawals
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  w public.factory_withdrawals;
  said text := nullif(btrim(coalesce(reference, '')), '');
  a public.factory_payout_accounts;
begin
  if not public.is_platform_admin() then
    raise exception 'paying a factory is limited to platform staff' using errcode = '42501';
  end if;
  select * into w from public.factory_withdrawals where id = target_withdrawal for update;
  if not found then
    raise exception 'withdrawal not found' using errcode = 'P0002';
  end if;
  perform public.payout_staff_check(w.org_id);
  if w.status <> 'requested' then
    raise exception 'only a waiting withdrawal can be marked paid' using errcode = '22023', hint = 'withdrawal_not_waiting';
  end if;
  if w.provider <> 'bank' then
    raise exception 'this withdrawal is paid through its provider' using errcode = '22023', hint = 'withdrawal_provider';
  end if;
  -- claim_withdrawal's check. The account staff would send to is gone, or
  -- its payee details changed since the factory asked: decline, so it asks again.
  select * into a from public.factory_payout_accounts x where x.id = w.account_id;
  if not found or a.payee_changed_at is distinct from w.paid_to_changed_at
     or public.withdrawal_provider_for(a) is distinct from w.provider then
    raise exception 'this factory changed where it is paid' using errcode = '22023', hint = 'payout_changed';
  end if;
  if said is null or length(said) < 3 or length(said) > 200 or said !~ '[[:alnum:]]' then
    raise exception 'enter the bank''s reference for this transfer' using errcode = '22023', hint = 'reference_required';
  end if;
  if public.payout_text_holds_number(w.org_id, said) then
    raise exception 'the factory can read this, so it cannot hold the account number' using errcode = '22023', hint = 'reference_holds_number';
  end if;
  -- The wire fee the factory pays, fixed (bank_payout_fee_cents()).
  if w.amount_cents <= public.bank_payout_fee_cents() then
    raise exception 'this withdrawal is not more than the bank transfer fee, so nothing would arrive'
      using errcode = '22023', hint = 'fee_too_large';
  end if;
  if public.factory_withdrawable(w.org_id) < 0 then
    raise exception 'the factory''s balance no longer covers this' using errcode = '22023', hint = 'withdrawal_over_balance';
  end if;
  update public.factory_withdrawals
     set status = 'paid', paid_at = now(), provider_ref = said, fee_cents = public.bank_payout_fee_cents(),
         receives_minor = w.amount_cents - public.bank_payout_fee_cents(), receives_currency = w.currency,
         decided_by = auth.uid(), decided_at = now(), updated_at = now()
   where id = w.id returning * into w;
  perform public.release_withdrawn_payments(w.org_id, auth.uid());
  perform public.withdrawal_notice(w,
    format('%s paid out to you', public.format_money(w.amount_cents, w.currency)),
    format('Sent by bank transfer to %s. Payout fee %s is taken from this payment: you receive %s. Reference: %s',
           w.paid_to, public.format_money(w.fee_cents, w.currency), public.format_money(w.receives_minor, w.currency), said));
  return w;
end;
$$;
revoke all on function public.mark_withdrawal_paid_by_bank(uuid, text) from public, anon;
grant execute on function public.mark_withdrawal_paid_by_bank(uuid, text) to authenticated;
