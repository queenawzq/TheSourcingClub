-- Paying a bank withdrawal by hand (the board's "Paid by bank…").
--
-- 1. Staff can read the full number of the account a withdrawal pays, whichever
--    of the company's accounts the factory chose. reveal_payout_account_number
--    gets the exception payout_wise_recipient already has (20261116200000):
--    an account with a withdrawal waiting on, or being paid by, staff is owed.
--    Everything else is unchanged: staff only, never staff in the company or in
--    a brand with an order there, a number on file, and every read recorded.
-- 2. mark_withdrawal_paid_by_bank refuses, as claim_withdrawal does, when the
--    account was removed or its details changed after the factory asked.

create or replace function public.reveal_payout_account_number(target_account uuid)
returns table (account_number text, number_kind text, changed_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  a public.factory_payout_accounts;
  kind text;
begin
  if not public.is_platform_admin() then
    raise exception 'this is limited to platform staff' using errcode = '42501';
  end if;

  select * into a from public.factory_payout_accounts x where x.id = target_account;
  if not found then
    raise exception 'that account does not exist' using errcode = 'P0002';
  end if;

  if public.is_org_member(a.org_id) then
    raise exception 'you belong to this company, so someone else on the staff must pay it'
      using errcode = '42501', hint = 'payout_own_company';
  end if;
  if exists (
    select 1 from public.production_orders o
     where o.factory_org_id = a.org_id and public.is_org_member(o.brand_org_id)
  ) then
    raise exception 'your company has an order with this factory, so someone else on the staff must pay it'
      using errcode = '42501', hint = 'reveal_brand_side';
  end if;
  -- New: a withdrawal waiting on, or being paid by, staff to this account is owed too, whichever
  -- of the company's accounts it is (as payout_wise_recipient, 20261116200000).
  if exists (select 1 from public.factory_withdrawals w where w.account_id = a.id and w.status in ('requested', 'paying')) then
    null;
  elsif not a.is_primary or not exists (
    select 1
      from public.order_payments p
      join public.production_orders o on o.id = p.order_id
      left join public.stripe_connect_accounts s on s.org_id = o.factory_org_id
     where o.factory_org_id = a.org_id
       and p.state = 'confirmed'
       and p.release_requested_at is not null
       and not (public.uses_stripe_payout(o.factory_org_id) and p.stripe_payment_intent_id is not null)
  ) then
    raise exception 'TSC does not owe this company a payout by hand, so its number stays hidden'
      using errcode = '22023', hint = 'reveal_not_owed';
  end if;

  select n.number_kind into kind from public.payout_account_numbers n where n.account_id = a.id;
  if kind is null then
    raise exception 'no full account number is on file'
      using errcode = '22023', hint = 'no_number';
  end if;

  insert into public.payout_number_reveals
    (account_id, org_id, org_name, bank_name, last4, staff_user_id, staff_email)
  select a.id, a.org_id, o.name, a.bank_name, a.account_number_last4, auth.uid(),
         (select u.email from auth.users u where u.id = auth.uid())
    from public.orgs o where o.id = a.org_id;

  return query select public.payout_number_plain(a.id), kind, a.details_changed_at;
end;
$$;
revoke all on function public.reveal_payout_account_number(uuid) from public, anon;
grant execute on function public.reveal_payout_account_number(uuid) to authenticated;

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
  -- New: claim_withdrawal's check. The account staff would send to is gone, or
  -- its details changed since the factory asked: decline, so it asks again.
  select * into a from public.factory_payout_accounts x where x.id = w.account_id;
  if not found or a.details_changed_at is distinct from w.paid_to_changed_at
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
