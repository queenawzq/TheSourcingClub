-- ============================================================================
-- Tazapay withdrawals compare payee_changed_at, as #115 does (20261117360000)
-- ----------------------------------------------------------------------------
-- 20261117510000 recreated request_withdrawal() and
-- mark_withdrawal_paid_by_bank() for Tazapay from their versions before
-- 20261117360000, which moved both from details_changed_at to
-- payee_changed_at. Run after 360000, it put details_changed_at back, and with
-- it the bug 360000 fixed: making an account the default after the factory
-- asked blocked paying it. This recreates both with 510000's Tazapay rules and
-- 360000's payee_changed_at. Nothing else changes.
--
-- Safe with the live site while applied: replaces two functions' bodies with
-- the same signatures.
-- ============================================================================

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
  -- What Tazapay needs on the account (the same check as paying it).
  if which = 'tazapay' then
    begin
      perform public.tazapay_account_check(a);
    exception when sqlstate '22023' then
      raise exception 'Complete this withdrawal method first.' using errcode = '22023', hint = 'withdrawal_method';
    end;
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
  -- A 'bank' withdrawal asked before 20261117510000 to an account Tazapay now
  -- pays is still sent by hand: the account did not change, the rule did.
  if not found or a.payee_changed_at is distinct from w.paid_to_changed_at
     or (public.withdrawal_provider_for(a) is distinct from w.provider
         and not (w.provider = 'bank' and public.tazapay_pays_account(a))) then
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
