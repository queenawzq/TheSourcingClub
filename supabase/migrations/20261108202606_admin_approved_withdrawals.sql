-- A factory requests; staff approve only after the selected provider is funded.
alter table public.factory_withdrawals
  add column approved_at timestamptz,
  add column approval_grandfathered boolean not null default false;
-- Company users can read their requests, never TSC's business-account balances.
create table public.factory_withdrawal_approvals (
  withdrawal_id uuid primary key references public.factory_withdrawals(id) on delete cascade,
  approved_by uuid not null references auth.users(id),
  available_cents bigint not null,
  balance_as_of timestamptz not null,
  fee_allowance_cents bigint not null check(fee_allowance_cents>=0)
);
alter table public.factory_withdrawal_approvals enable row level security;
revoke all on public.factory_withdrawal_approvals from public,anon,authenticated;
grant all on public.factory_withdrawal_approvals to service_role;
-- Only already-started sends may continue without a newly recorded approval.
-- Never attribute an earlier automated send to a member of staff.
update public.factory_withdrawals w set approval_grandfathered=true
where w.status='paid' or exists(select 1 from public.factory_withdrawal_items i
  join public.order_payments p on p.id=i.payment_id where i.withdrawal_id=w.id and (
    p.stripe_release_started or exists(select 1 from public.provider_payouts x where x.payment_id=p.id and x.status in ('processing','paid'))));

create function public.withdrawal_is_approved(target uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.factory_withdrawals where id=target and (approved_at is not null or approval_grandfathered));
$$;
revoke all on function public.withdrawal_is_approved(uuid) from public,anon,authenticated;
grant execute on function public.withdrawal_is_approved(uuid) to service_role;

-- PayPal's report can lag. Reserve later approvals even if already sent;
-- otherwise the same old reported balance could fund several approvals.
create function public.withdrawal_funding_reserved(which text, in_currency text, balance_as_of timestamptz, except_request uuid)
returns bigint language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce(sum(w.amount_cents+a.fee_allowance_cents),0)::bigint from public.factory_withdrawals w
  join public.factory_withdrawal_approvals a on a.withdrawal_id=w.id
  where w.provider=$1 and w.currency=$2 and w.id<>$4 and w.approved_at is not null
    and (w.status<>'paid' or ($1='paypal' and w.approved_at>=$3));
$$;
revoke all on function public.withdrawal_funding_reserved(text,text,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.withdrawal_funding_reserved(text,text,timestamptz,uuid) to service_role;

-- Only the server calls this after checking the provider again. Neither an
-- owner nor staff can forge a balance through the public Data API.
create function public.approve_factory_withdrawal(target uuid, approver uuid, available_cents bigint,
  balance_as_of timestamptz, fee_allowance bigint default 0)
returns public.factory_withdrawals language plpgsql security definer set search_path=public,pg_temp as $$
declare w public.factory_withdrawals; reserved bigint;
begin
  if not exists(select 1 from public.platform_admins where user_id=approver) then
    raise exception 'Only platform staff can approve a withdrawal.' using errcode='42501';
  end if;
  select * into w from public.factory_withdrawals where id=target;
  if not found then raise exception 'Withdrawal not found.' using errcode='P0002'; end if;
  if exists(select 1 from public.org_members where user_id=approver and org_id=w.org_id)
    or exists(select 1 from public.production_orders o join public.org_members m on m.org_id=o.brand_org_id
      where o.factory_org_id=w.org_id and m.user_id=approver) then
    raise exception 'Another staff member must approve this company’s withdrawal.' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('withdrawal-funding-'||w.provider||'-'||w.currency,0));
  select * into w from public.factory_withdrawals where id=target for update;
  if w.approved_at is not null or w.approval_grandfathered or w.status='paid' then return w; end if;
  if available_cents is null or available_cents<0 or fee_allowance is null or fee_allowance<0
    or (w.provider<>'paypal' and fee_allowance<>0) or balance_as_of is null
    or balance_as_of>now()+interval '1 minute'
    or balance_as_of<now()-(case when w.provider='paypal' then interval '3 hours 15 minutes' else interval '2 minutes' end) then
    raise exception 'A recent provider balance check is required.' using errcode='22023';
  end if;
  reserved:=public.withdrawal_funding_reserved(w.provider,w.currency,balance_as_of,w.id);
  if available_cents-reserved < w.amount_cents+fee_allowance then
    raise exception 'Please fund the selected provider before approving this transfer.' using errcode='22023';
  end if;
  insert into public.factory_withdrawal_approvals(withdrawal_id,approved_by,available_cents,balance_as_of,fee_allowance_cents)
    values(w.id,approver,available_cents,balance_as_of,fee_allowance);
  update public.factory_withdrawals set approved_at=now(),status='processing'
    where id=target returning * into w;
  return w;
end; $$;
revoke all on function public.approve_factory_withdrawal(uuid,uuid,bigint,timestamptz,bigint) from public,anon,authenticated;
grant execute on function public.approve_factory_withdrawal(uuid,uuid,bigint,timestamptz,bigint) to service_role;

create or replace function public.payment_uses_stripe_payout(target_payment uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.order_payments p where p.id=target_payment and (
    (not p.withdrawal_required and exists(select 1 from public.production_orders o where o.id=p.order_id and public.uses_stripe_payout(o.factory_org_id)))
    or exists(select 1 from public.factory_withdrawal_items i join public.factory_withdrawals w on w.id=i.withdrawal_id
      where i.payment_id=p.id and w.provider='stripe' and public.withdrawal_is_approved(w.id))));
$$;

create or replace function public.claim_provider_payout(
  target_payment uuid,
  which text,
  paid_to_changed_at timestamptz,
  cny_confirmed boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p public.order_payments;
  o public.production_orders;
  account public.factory_payout_accounts;
  live public.provider_payouts;
  attempt public.provider_payout_attempts;
  resumed boolean := false;
  paid_to text;
  chosen public.factory_withdrawals;
  server_request boolean := false;
begin
  if not public.is_platform_admin() and coalesce(auth.role(),'')<>'service_role' then
    raise exception 'paying a factory is limited to platform staff' using errcode = '42501';
  end if;

  perform 1 from public.stripe_connect_accounts where org_id=(
    select po.factory_org_id from public.order_payments op join public.production_orders po on po.id=op.order_id where op.id=target_payment
  ) for update;
  select * into p from public.order_payments where id = target_payment for update;
  if not found then
    raise exception 'payment not found' using errcode = 'P0002';
  end if;
  select * into o from public.production_orders where id = p.order_id;
  select w.* into chosen from public.factory_withdrawal_items i join public.factory_withdrawals w on w.id=i.withdrawal_id where i.payment_id=p.id;
  if chosen.id is not null and not public.withdrawal_is_approved(chosen.id) then
    raise exception 'This withdrawal is awaiting admin approval.' using errcode='22023';
  end if;
  server_request := coalesce(auth.role(),'')='service_role' and chosen.id is not null and chosen.provider=which;
  if not public.is_platform_admin() and not server_request then raise exception 'Owner withdrawal required.' using errcode='42501'; end if;
  if not server_request then perform public.payout_staff_check(o.factory_org_id); end if;
  if p.withdrawal_required and chosen.id is null then raise exception 'The factory must request a withdrawal first.' using errcode='22023'; end if;
  if chosen.id is not null and chosen.provider<>which then raise exception 'Use the requested withdrawal provider.' using errcode='22023'; end if;

  if p.state = 'released' then
    raise exception 'that payout was already paid' using errcode = '22023', hint = 'payout_already_released';
  end if;
  if p.state <> 'confirmed' or p.release_requested_at is null then
    raise exception 'that payment is not approved for payout' using errcode = '22023', hint = 'payout_not_owed';
  end if;
  if p.stripe_payment_intent_id is not null and exists (
    select 1 from public.stripe_connect_accounts s
     where s.org_id = o.factory_org_id and public.payment_uses_stripe_payout(p.id)
  ) then
    raise exception 'Stripe pays this factory: retry the payout instead' using errcode = '22023', hint = 'payout_stripe';
  end if;
  if p.release_claimed_at is not null and p.release_claimed_at > now() - interval '10 minutes' then
    raise exception 'a Stripe payout is being made for this payment' using errcode = '22023', hint = 'payout_in_progress';
  end if;

  select * into account from public.factory_payout_accounts a
   where a.org_id = o.factory_org_id and ((chosen.id is not null and a.id=chosen.account_id) or (chosen.id is null and a.is_primary));
  if which = 'wise' and (account.id is null or account.method <> 'bank' or account.wise_recipient_type is null) then
    raise exception 'this factory has no bank account Wise can pay' using errcode = '22023', hint = 'wise_not_set_up';
  end if;
  if which = 'paypal' and (account.id is null or account.method <> 'paypal') then
    raise exception 'this factory has no PayPal address' using errcode = '22023', hint = 'paypal_not_set_up';
  end if;
  if which not in ('wise', 'paypal') then
    raise exception 'unknown payment provider' using errcode = '22023';
  end if;
  if paid_to_changed_at is null or account.details_changed_at is distinct from paid_to_changed_at then
    raise exception 'this factory changed where it is paid' using errcode = '22023', hint = 'payout_changed';
  end if;
  if which = 'wise' and account.wise_currency = 'CNY' and not coalesce(cny_confirmed, false) then
    raise exception 'confirm the contract and invoice statement first' using errcode = '22023', hint = 'cny_statement';
  end if;

  select * into live from public.provider_payouts x
   where x.payment_id = p.id and x.status = 'processing';
  if found then
    if live.provider <> which then
      raise exception 'another payment is under way for this' using errcode = '22023', hint = 'payout_in_progress';
    end if;
    select * into attempt from public.provider_payout_attempts a where a.payout_id = live.id for update;
    if attempt.lease_until is not null and attempt.lease_until > now() then
      raise exception 'this is already being paid' using errcode = '22023', hint = 'payout_in_progress';
    end if;
    resumed := true;
  else
    paid_to := case which
      when 'wise' then format('%s ending %s', account.bank_name, account.account_number_last4)
      else account.paypal_email
    end;
    insert into public.provider_payouts
      (payment_id, factory_org_id, account_id, provider, paid_to, amount_cents, currency, requested_by)
    values (p.id, o.factory_org_id, account.id, which, paid_to, p.amount_cents, p.currency, coalesce(auth.uid(),chosen.requested_by))
    returning * into live;
    insert into public.provider_payout_attempts (payout_id) values (live.id);
    select * into attempt from public.provider_payout_attempts a where a.payout_id = live.id;
  end if;

  update public.provider_payout_attempts a
     set lease_until = now() + interval '90 seconds', updated_at = now(),
         cny_confirmed_by = case when coalesce(cny_confirmed, false) then coalesce(auth.uid(),chosen.requested_by) else a.cny_confirmed_by end,
         cny_confirmed_at = case when coalesce(cny_confirmed, false) then now() else a.cny_confirmed_at end
   where a.payout_id = live.id
  returning * into attempt;

  return jsonb_build_object(
    'payout_id', live.id,
    'key', attempt.attempt_key,
    'stage', attempt.stage,
    'resumed', resumed,
    'provider_ref', live.provider_ref,
    'quote_id', attempt.quote_id,
    'amount_cents', p.amount_cents,
    'currency', p.currency,
    'order_number', o.order_number,
    'account_id', account.id,
    'paypal_email', account.paypal_email,
    'wise_recipient_id', account.wise_recipient_id
  );
end;
$$;

create or replace function public.payout_wise_recipient(target_account uuid)
returns table (
  recipient_type text,
  currency text,
  number_key text,
  account_number text,
  details jsonb,
  changed_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  a public.factory_payout_accounts;
  owner_request public.factory_withdrawals;
begin
  if not public.is_platform_admin() and coalesce(auth.role(),'')<>'service_role' then
    raise exception 'this is limited to platform staff' using errcode = '42501';
  end if;

  select * into a from public.factory_payout_accounts x where x.id = target_account;
  if not found then
    raise exception 'that account does not exist' using errcode = 'P0002';
  end if;

  select * into owner_request from public.factory_withdrawals w where w.account_id=a.id and w.provider='wise' and w.status<>'paid' and public.withdrawal_is_approved(w.id) order by w.created_at limit 1;
  if coalesce(auth.role(),'')='service_role' and owner_request.id is null then raise exception 'Owner withdrawal required.' using errcode='42501'; end if;
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
  if owner_request.id is null and (not a.is_primary or not exists (
    select 1
      from public.order_payments p
      join public.production_orders o on o.id = p.order_id
      left join public.stripe_connect_accounts s on s.org_id = o.factory_org_id
     where o.factory_org_id = a.org_id
       and p.state = 'confirmed'
       and p.release_requested_at is not null
       and not (public.payment_uses_stripe_payout(p.id) and p.stripe_payment_intent_id is not null)
  )) then
    raise exception 'TSC does not owe this company a payout by hand, so its number stays hidden'
      using errcode = '22023', hint = 'reveal_not_owed';
  end if;
  if a.wise_recipient_type is null then
    raise exception 'this bank account was not set up for Wise'
      using errcode = '22023', hint = 'wise_not_set_up';
  end if;
  if not exists (select 1 from public.payout_account_numbers n where n.account_id = a.id) then
    raise exception 'no full account number is on file'
      using errcode = '22023', hint = 'no_number';
  end if;

  insert into public.payout_number_reveals
    (account_id, org_id, org_name, bank_name, last4, staff_user_id, staff_email, how)
  select a.id, a.org_id, o.name, a.bank_name, a.account_number_last4, coalesce(auth.uid(),owner_request.requested_by),
         (select u.email from auth.users u where u.id = auth.uid()), 'sent_to_wise'
    from public.orgs o where o.id = a.org_id;

  return query select a.wise_recipient_type, a.wise_currency::text, a.wise_number_key,
    public.payout_number_plain(a.id), a.wise_details, a.details_changed_at;
end;
$$;
