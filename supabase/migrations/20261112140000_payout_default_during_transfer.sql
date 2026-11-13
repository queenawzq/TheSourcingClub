-- A known Wise/PayPal transfer retains account_id, paid_to and provider_ref.
-- Only future payouts follow the new default. An uncertain request and the
-- existing manual-to-Stripe guard remain locked: never risk paying twice.
create or replace function public.choose_payout_method(target_org uuid, target_account uuid default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  a public.factory_payout_accounts;
  was_stripe boolean;
  new_primary boolean := false;
  what text;
begin
  if not public.is_org_owner(target_org) then
    raise exception 'Only a company owner can change the default withdrawal method.' using errcode='42501';
  end if;
  -- This is the same row lock acquired by both provider claims below.
  perform 1 from public.stripe_connect_accounts where org_id=target_org for update;
  perform 1 from public.orgs where id=target_org for update;
  if exists (select 1 from public.order_payments p join public.production_orders o on o.id=p.order_id
      where o.factory_org_id=target_org and p.state='confirmed' and (p.release_claimed_at is not null or p.stripe_release_started))
    or exists (select 1 from public.provider_payouts x join public.order_payments p on p.id=x.payment_id
      join public.production_orders o on o.id=p.order_id where o.factory_org_id=target_org and x.status='processing' and nullif(btrim(x.provider_ref), '') is null) then
    raise exception 'Reconcile the pending payout request before changing the default.' using errcode='22023';
  end if;
  was_stripe := public.uses_stripe_payout(target_org);
  if target_account is null then
    if not exists (select 1 from public.stripe_connect_accounts s where s.org_id=target_org and s.transfers_active) then
      raise exception 'Finish bank-account verification before choosing it as the default.' using errcode='22023';
    end if;
    -- New: staff may be sending this by hand already, and nothing records that
    -- until they mark it. Stripe would pay it a second time.
    if not was_stripe and exists (select 1 from public.order_payments p join public.production_orders o on o.id=p.order_id
        where o.factory_org_id=target_org and p.state='confirmed' and p.release_requested_at is not null) then
      raise exception 'TSC is sending a payout to your current default. You can change it once that payout is sent.'
        using errcode='22023', hint='payout_owed_manual';
    end if;
  else
    select * into a from public.factory_payout_accounts where id=target_account and org_id=target_org;
    if not found or a.method not in ('bank','paypal') then
      raise exception 'Choose a saved bank transfer or PayPal account for this company.' using errcode='22023';
    end if;
    if (a.method='bank' and (nullif(btrim(a.account_name),'') is null or nullif(btrim(a.bank_name),'') is null or a.number_changed_at is null))
       or (a.method='paypal' and nullif(btrim(a.paypal_email),'') is null) then
      raise exception 'Complete the withdrawal details before choosing this method.' using errcode='22023';
    end if;
    new_primary := not a.is_primary;
    if new_primary then perform public.set_primary_payout_account(target_account); end if;
  end if;
  insert into public.factory_payout_preferences(org_id,route) values(target_org,case when target_account is null then 'stripe' else 'manual' end)
    on conflict(org_id) do update set route=excluded.route, changed_at=now();
  -- New: who pays changed. A new primary is announced by the account triggers.
  if was_stripe is distinct from (target_account is null) and not new_primary then
    what := case
      when target_account is null then 'TSC now pays your connected payout account.'
      when a.method = 'paypal' then format('TSC now pays PayPal account %s.', a.paypal_email)
      else format('TSC now pays your bank account at %s%s.', a.bank_name,
        case when a.account_number_last4 is not null then format(' ending %s', a.account_number_last4) else '' end)
    end;
    insert into public.notifications (org_id, kind, title, body)
    values (target_org, 'payout_method_changed', 'Your payout methods changed',
      what || ' If nobody at your company made this change, email operations@contact.sourcing-club.com now.');
  end if;
end; $$;

-- Keep a processing transfer's destination intact even after it stops being
-- primary. Serialize against claims using the same connected-account lock.
create function public.guard_active_payout_destination()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  target uuid;
  owner_org uuid;
begin
  if tg_table_name = 'payout_account_numbers' then
    if tg_op = 'INSERT' then target := new.account_id; else target := old.account_id; end if;
  else target := old.id; end if;
  select org_id into owner_org from public.factory_payout_accounts where id = target;
  perform 1 from public.stripe_connect_accounts where org_id = owner_org for update;
  perform 1 from public.orgs where id = owner_org for update;
  if tg_op = 'UPDATE' and tg_table_name = 'factory_payout_accounts' then
    -- Switching the default and updating provider-managed metadata do not
    -- rewrite a recipient. All destination fields stay immutable while active.
    if (to_jsonb(new) - array['is_primary','updated_at','details_changed_at','wise_recipient_id'])
       = (to_jsonb(old) - array['is_primary','updated_at','details_changed_at','wise_recipient_id']) then
      return new;
    end if;
  end if;
  if exists (select 1 from public.provider_payouts where account_id = target and status = 'processing') then
    raise exception 'This account has a payout in progress. You can change the default, but edit or remove this account once the payout finishes.'
      using errcode = '22023', hint = 'payout_destination_in_use';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.guard_active_payout_destination() from public, anon, authenticated, service_role;
create trigger aa_guard_active_payout_destination
before update or delete on public.factory_payout_accounts
for each row execute function public.guard_active_payout_destination();
create trigger aa_guard_active_payout_number
before insert or update or delete on public.payout_account_numbers
for each row execute function public.guard_active_payout_destination();

-- Claims share the organisation lock even for factories with no connected account.
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
begin
  if not public.is_platform_admin() then
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
  perform 1 from public.orgs where id = o.factory_org_id for update;
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
$$;
