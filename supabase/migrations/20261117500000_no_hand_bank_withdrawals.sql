-- ============================================================================
-- No more withdrawals to a bank account staff pay by hand.
--
-- A bank account is now always paid by a provider: Stripe's own, or one set
-- up on Wise's form (method 'bank' with wise_recipient_type). A bank row with
-- no wise_recipient_type was the old staff-paid setup; the chooser has not
-- offered it since 20261117200000 and production holds none.
--
-- request_withdrawal() (from 20261117200000) now refuses such a row with the
-- existing "not available" refusal, and loses the bank wire-fee check that
-- only it reached.
--
-- Kept on purpose:
--   * public.bank_payout_fee_cents(): release_payment_to_factory() ("Mark paid
--     out by bank" on the per-step board) charges it, and that is the fallback
--     staff use for a Wise bank account and for a factory Stripe cannot pay.
--     mark_withdrawal_paid_by_bank() also reads it.
--   * mark_withdrawal_paid_by_bank(), withdrawal_provider_for() and
--     save_bank_payout_account(): unchanged. A withdrawal already asked for by
--     bank can still be marked paid, and the live site keeps working while
--     this applies.
--
-- Safe with the live site while applied: replaces one function with the same
-- signature.
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
  -- New: a bank account staff would pay by hand is no longer a way to withdraw.
  -- Staff switched this provider off for the company's region.
  if which = 'bank' or not public.payout_provider_enabled(target_org, which) then
    raise exception 'This withdrawal method is not available right now.' using errcode = '22023', hint = 'withdrawal_provider_off';
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
