-- ============================================================================
-- Withdrawals: several open requests at once, and cancelling a chosen set.
--
-- A factory may ask for a withdrawal while another is still waiting. Each one
-- takes its amount from the balance as it is asked (factory_withdrawable()
-- already counts every 'requested' and 'paying' row), so the balance check is
-- the only limit. The company row is still locked first, so two tabs asking at
-- once are checked one after the other and cannot both spend the same money.
--
-- cancel_withdrawals() cancels the requests the owner ticked, all or none:
-- if one has started sending, nothing is cancelled and the refusal says so.
--
-- Withdrawing never changes which method is the default: request_withdrawal()
-- reads the chosen account and writes only factory_withdrawals.
--
-- Safe with the live site while applied: drops an index nothing reads, and
-- replaces one function with the same signature.
-- ============================================================================

drop index if exists public.factory_withdrawals_one_open;
create index if not exists factory_withdrawals_open_idx on public.factory_withdrawals (org_id)
  where status in ('requested', 'paying');

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

-- Cancel the ticked requests, all or none. Each is checked by cancel_withdrawal()
-- (owner of that withdrawal's company, still waiting), so the rules are the same
-- as cancelling one; the first refusal undoes the others.
create or replace function public.cancel_withdrawals(target_withdrawals uuid[])
returns setof public.factory_withdrawals
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  one uuid;
begin
  if target_withdrawals is null or cardinality(target_withdrawals) = 0 then
    raise exception 'Choose at least one withdrawal to cancel.' using errcode = '22023', hint = 'withdrawal_none_chosen';
  end if;
  foreach one in array (select array_agg(distinct x) from unnest(target_withdrawals) sel(x)) loop
    return next public.cancel_withdrawal(one);
  end loop;
end;
$$;
revoke all on function public.cancel_withdrawals(uuid[]) from public, anon;
grant execute on function public.cancel_withdrawals(uuid[]) to authenticated;
