-- ============================================================================
-- The company lock no longer blocks inserts that reference the company
-- ----------------------------------------------------------------------------
-- claim_owed_steps(), request_withdrawal(), claim_provider_payout() and
-- claim_withdrawal() serialise on the factory's orgs row. FOR UPDATE also
-- conflicts with the KEY SHARE lock a foreign key takes, so a notification
-- inserted for the company (choose_payout_method(), say) while staff press
-- "Pay again" could deadlock. FOR NO KEY UPDATE still serialises the four
-- against each other and lets those inserts through. Bodies otherwise as
-- they are (taken from the database); lock order unchanged; signatures and
-- grants unchanged.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.claim_owed_steps(target_org uuid, amount bigint, road text, withdrawal uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  sw public.stripe_withdrawals;
  fw public.factory_withdrawals;
  need bigint;
  got bigint := 0;
  take_amount bigint;
  left_cents bigint;
  still boolean;
  r record;
  t public.payment_takes;
  out_takes jsonb := '[]'::jsonb;
begin
  if not (coalesce(auth.role(), '') = 'service_role' or public.is_org_owner(target_org)) then
    raise exception 'Only a company owner can withdraw.' using errcode = '42501', hint = 'withdraw_owner_only';
  end if;
  if road is null or road not in ('stripe', 'pool') then
    raise exception 'unknown withdrawal road' using errcode = '22023', hint = 'withdrawal_not_waiting';
  end if;
  if amount is null or amount <= 0 then
    raise exception 'Enter an amount to withdraw.' using errcode = '22023', hint = 'withdrawal_amount';
  end if;
  perform 1 from public.orgs where id = target_org for no key update;

  if road = 'stripe' then
    select * into sw from public.stripe_withdrawals where id = withdrawal for update;
    if not found or sw.org_id <> target_org or sw.state <> 'claimed' then
      raise exception 'this withdrawal is not waiting' using errcode = '22023', hint = 'withdrawal_not_waiting';
    end if;
    -- Claimed already (a retry of the same withdrawal): what it holds.
    if sw.owed_cents is not null then
      return jsonb_build_object('claimed_cents', sw.owed_cents, 'takes', coalesce((
        select jsonb_agg(jsonb_build_object('take_id', k.id, 'payment_id', k.payment_id, 'amount_cents', k.amount_cents,
                 'charge_id', p.stripe_charge_id, 'order_id', p.order_id, 'order_number', o.order_number,
                 'status', k.status, 'stripe_transfer_id', k.stripe_transfer_id) order by k.created_at)
          from public.payment_takes k
          join public.order_payments p on p.id = k.payment_id
          join public.production_orders o on o.id = p.order_id
         where k.stripe_withdrawal_id = sw.id), '[]'::jsonb), 'resumed', true);
    end if;
    -- A Stripe account being replaced: nothing goes to either until it is done.
    if exists (select 1 from public.stripe_connect_upgrades u where u.org_id = target_org
                and u.completed_at is null and u.new_account_id is not null) then
      raise exception 'the payout account is being updated' using errcode = '22023', hint = 'payout_upgrading';
    end if;
  else
    select * into fw from public.factory_withdrawals where id = withdrawal for update;
    if not found or fw.org_id <> target_org or fw.status <> 'requested'
       or exists (select 1 from public.payment_takes k where k.factory_withdrawal_id = fw.id) then
      raise exception 'this withdrawal is not waiting' using errcode = '22023', hint = 'withdrawal_not_waiting';
    end if;
  end if;

  need := amount;
  for r in
    select p.id, p.order_id, p.stripe_charge_id, o.order_number
      from public.order_payments p
      join public.production_orders o on o.id = p.order_id
     where o.factory_org_id = target_org and public.payment_claimable(p)
       and (road = 'pool' or p.stripe_charge_id is not null)
     order by p.release_requested_at, p.id
  loop
    exit when need <= 0;
    -- Locked, then read again: a staff payout started on it since is seen.
    select public.payment_claimable(p), public.payment_factory_cents(p) - public.payment_taken_cents(p.id)
      into still, left_cents
      from public.order_payments p where p.id = r.id for update;
    continue when not coalesce(still, false) or left_cents <= 0;
    take_amount := least(left_cents, need);
    insert into public.payment_takes (payment_id, org_id, road, stripe_withdrawal_id, factory_withdrawal_id, amount_cents)
    values (r.id, target_org, road,
            case when road = 'stripe' then withdrawal end,
            case when road = 'pool' then withdrawal end,
            take_amount)
    returning * into t;
    need := need - take_amount;
    got := got + take_amount;
    out_takes := out_takes || jsonb_build_array(jsonb_build_object(
      'take_id', t.id, 'payment_id', r.id, 'amount_cents', take_amount, 'charge_id', r.stripe_charge_id,
      'order_id', r.order_id, 'order_number', r.order_number, 'status', 'held', 'stripe_transfer_id', null));
  end loop;
  if need > 0 then
    raise exception 'That is more than your balance.' using errcode = '22023', hint = 'withdrawal_over_balance';
  end if;
  if road = 'stripe' then
    update public.stripe_withdrawals set owed_cents = got, updated_at = now() where id = sw.id;
  end if;
  return jsonb_build_object('claimed_cents', got, 'takes', out_takes, 'resumed', false);
end;
$function$;

CREATE OR REPLACE FUNCTION public.request_withdrawal(target_org uuid, amount bigint, target_account uuid)
 RETURNS factory_withdrawals
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  a public.factory_payout_accounts;
  w public.factory_withdrawals;
  which text;
  pool_available bigint;
  owed_available bigint;
  from_pool bigint;
begin
  if not public.is_org_owner(target_org) then
    raise exception 'Only a company owner can withdraw.' using errcode = '42501', hint = 'withdraw_owner_only';
  end if;
  -- Two tabs, or a Stripe withdrawal at the same instant, are checked one
  -- after the other against the balance (claim_owed_steps takes the same lock).
  perform 1 from public.orgs where id = target_org for no key update;
  if amount is null or amount <= 0 then
    raise exception 'Enter an amount to withdraw.' using errcode = '22023', hint = 'withdrawal_amount';
  end if;
  -- Net of every request still open, so several requests can never add up to more.
  pool_available := greatest(public.factory_withdrawable(target_org), 0);
  owed_available := (public.owed_reachable(target_org) ->> 'any_cents')::bigint;
  if amount > pool_available + owed_available then
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
  if which = 'bank' or not public.payout_provider_enabled_for_account(a, which) then
    raise exception 'This withdrawal method is not available right now.' using errcode = '22023', hint = 'withdrawal_provider_off';
  end if;
  from_pool := least(amount, pool_available);
  insert into public.factory_withdrawals
    (org_id, account_id, provider, amount_cents, currency, paid_to, paid_to_changed_at, requested_by, pool_cents)
  values (target_org, a.id, which, amount, 'USD',
          case when a.method = 'paypal' then a.paypal_email
               else format('%s ending %s', coalesce(a.bank_name, 'Bank account'), a.account_number_last4) end,
          a.payee_changed_at, auth.uid(), from_pool)
  returning * into w;
  if amount > from_pool then
    perform public.claim_owed_steps(target_org, amount - from_pool, 'pool', w.id);
  end if;
  perform public.withdrawal_notice(w,
    format('Withdrawal of %s requested', public.format_money(w.amount_cents, w.currency)),
    format('To %s. TSC will send it after checking.', w.paid_to));
  return w;
end;
$function$;

CREATE OR REPLACE FUNCTION public.claim_provider_payout(target_payment uuid, which text, paid_to_changed_at timestamp with time zone, cny_confirmed boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  p public.order_payments;
  o public.production_orders;
  account public.factory_payout_accounts;
  live public.provider_payouts;
  attempt public.provider_payout_attempts;
  resumed boolean := false;
  paid_to text;
begin
  if not public.is_platform_admin() then
    raise exception 'paying a factory is limited to platform staff' using errcode = '42501';
  end if;

  -- The company first, the lock claim_owed_steps() takes: "Pay again" and a
  -- withdrawal taking the same step go one after the other.
  perform 1 from public.orgs where id = (
    select po.factory_org_id from public.order_payments op join public.production_orders po on po.id=op.order_id where op.id=target_payment
  ) for no key update;
  perform 1 from public.stripe_connect_accounts where org_id=(
    select po.factory_org_id from public.order_payments op join public.production_orders po on po.id=op.order_id where op.id=target_payment
  ) for update;
  select * into p from public.order_payments where id = target_payment for update;
  if not found then
    raise exception 'payment not found' using errcode = 'P0002';
  end if;
  select * into o from public.production_orders where id = p.order_id;
  perform public.payout_staff_check(o.factory_org_id);

  if p.state = 'released' then
    raise exception 'that payout was already paid' using errcode = '22023', hint = 'payout_already_released';
  end if;
  if p.state <> 'confirmed' or p.release_requested_at is null then
    raise exception 'that payment is not approved for payout' using errcode = '22023', hint = 'payout_not_owed';
  end if;
  if p.stripe_payment_intent_id is not null and exists (
    select 1 from public.stripe_connect_accounts s
     where s.org_id = o.factory_org_id and public.uses_stripe_payout(o.factory_org_id)
  ) then
    raise exception 'Stripe pays this factory: retry the payout instead' using errcode = '22023', hint = 'payout_stripe';
  end if;
  if p.release_claimed_at is not null and p.release_claimed_at > now() - interval '10 minutes' then
    raise exception 'a Stripe payout is being made for this payment' using errcode = '22023', hint = 'payout_in_progress';
  end if;

  select * into account from public.factory_payout_accounts a
   where a.org_id = o.factory_org_id and a.is_primary;
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
    -- New: only a payment already with this provider may carry on.
    if p.stripe_release_started then
      raise exception 'Stripe may already have paid this: press Retry payout, which checks with Stripe first'
        using errcode = '22023', hint = 'payout_stripe_started';
    end if;
    paid_to := case which
      when 'wise' then format('%s ending %s', account.bank_name, account.account_number_last4)
      else account.paypal_email
    end;
    insert into public.provider_payouts
      (payment_id, factory_org_id, account_id, provider, paid_to, amount_cents, currency, requested_by)
    values (p.id, o.factory_org_id, account.id, which, paid_to, p.amount_cents, p.currency, auth.uid())
    returning * into live;
    insert into public.provider_payout_attempts (payout_id) values (live.id);
    select * into attempt from public.provider_payout_attempts a where a.payout_id = live.id;
  end if;

  update public.provider_payout_attempts a
     set lease_until = now() + interval '90 seconds', updated_at = now(),
         cny_confirmed_by = case when coalesce(cny_confirmed, false) then auth.uid() else a.cny_confirmed_by end,
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
$function$;

CREATE OR REPLACE FUNCTION public.claim_withdrawal(target_withdrawal uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  perform 1 from public.orgs where id = w.org_id for no key update;
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
$function$;
