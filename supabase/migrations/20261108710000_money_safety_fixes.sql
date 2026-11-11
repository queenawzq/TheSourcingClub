-- ============================================================================
-- Money safety after the PR #100 audits (Nov 8)
-- ----------------------------------------------------------------------------
-- Each function below is its latest definition with only the commented change.
--
-- 1. Choosing Stripe is refused while anything is owed on the manual route: a
--    wire staff are sending has no open state until it is marked.
-- 2. Marking paid by bank has the Stripe guard the other rails have.
-- 3. stripe_release_started pins a payout to Stripe on every rail, until
--    Stripe has been asked what happened (Retry payout).
-- 4. record_stripe_release_not_sent clears the pin when Stripe definitely made
--    no transfer, so one failure cannot lock a factory's route for good.
-- 5. Removing the last manual account removes the manual preference with it.
-- 6. A route change tells the company; Wise fields count as a bank change;
--    the bell no longer says TSC pays a bank when Stripe does.
-- 7. A file joins a message only while its sender's message is being checked.
-- 8. Staff record a refund made outside Stripe. Why a refund failed moves to a
--    staff-only table: both companies read order_payments and payment_events.
-- 9. Table grants the policies were relying on are revoked.
--
-- Safe with the current site live: one new column on the board's result, new
-- functions and a new table; refund_failure stays, empty, until a later
-- migration can drop it.
-- ============================================================================

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
  if exists (select 1 from public.order_payments p join public.production_orders o on o.id=p.order_id
      where o.factory_org_id=target_org and p.state='confirmed' and (p.release_claimed_at is not null or p.stripe_release_started))
    or exists (select 1 from public.provider_payouts x join public.order_payments p on p.id=x.payment_id
      join public.production_orders o on o.id=p.order_id where o.factory_org_id=target_org and x.status='processing') then
    raise exception 'Finish or reconcile the pending payout before changing the default.' using errcode='22023';
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
create or replace function public.guard_payout_account_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  owed_cents bigint;
  owed_currency text;
begin
  if coalesce(auth.role(), '') <> 'authenticated' or not old.is_primary then
    return old;
  end if;

  if exists (select 1 from public.factory_payout_accounts a
              where a.org_id = old.org_id and a.id <> old.id) then
    raise exception 'this is the account TSC pays: choose another account for TSC to pay before removing it'
      using errcode = 'P0001', hint = 'payout_primary';
  end if;

  if exists (select 1 from public.stripe_connect_accounts s
              where s.org_id = old.org_id and public.uses_stripe_payout(old.org_id)) then
    return old;
  end if;

  select sum(p.amount_cents), min(p.currency)
    into owed_cents, owed_currency
    from public.order_payments p
    join public.production_orders o on o.id = p.order_id
   where o.factory_org_id = old.org_id
     and p.state = 'confirmed'
     and p.release_requested_at is not null;

  if coalesce(owed_cents, 0) > 0 then
    raise exception 'TSC is about to pay this account, so it cannot be removed until that payment is sent'
      using errcode = 'P0001',
            hint = 'payout_owed',
            detail = owed_cents::text || ' ' || owed_currency;
  end if;

  -- New: the last manual account is going, so "manual" would mean nobody pays.
  delete from public.factory_payout_preferences where org_id = old.org_id and route = 'manual';

  return old;
end;
$$;
create or replace function public.release_payment_by_payoneer(
  target_payment uuid,
  paid_to text,
  payoneer_payment_id text,
  note text default null
)
returns public.order_payments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p public.order_payments;
  o public.production_orders;
  current_email text;
  reference text := btrim(coalesce(payoneer_payment_id, ''));
begin
  if not public.is_platform_admin() then
    raise exception 'recording a payout is limited to platform staff' using errcode = '42501';
  end if;

  select * into p from public.order_payments where id = target_payment for update;
  if not found then
    raise exception 'payment not found' using errcode = 'P0002';
  end if;

  select * into o from public.production_orders where id = p.order_id;

  if public.is_org_member(o.factory_org_id) then
    raise exception 'you belong to this company, so someone else on the staff must record its payout'
      using errcode = '42501', hint = 'payout_own_company';
  end if;
  if exists (select 1 from public.provider_payouts x where x.payment_id = p.id and x.status = 'processing') then
    raise exception 'a Wise or PayPal payment is under way for this: cancel it first, or it could be paid twice'
      using errcode = '22023', hint = 'payout_in_progress';
  end if;
  if p.state = 'released' then
    raise exception 'that payout was already marked as paid'
      using errcode = '22023', hint = 'payout_already_released';
  end if;
  if p.state <> 'confirmed' then
    raise exception 'that payment is %; only a confirmed one can be released', p.state
      using errcode = '22023';
  end if;
  if p.stripe_charge_id is not null and p.release_requested_at is null then
    raise exception 'the brand has not approved this step yet: money paid through Stripe is paid out once the brand approves it'
      using errcode = '22023';
  end if;
  if p.stripe_payment_intent_id is not null and exists (
    select 1 from public.stripe_connect_accounts s
     where s.org_id = o.factory_org_id and public.uses_stripe_payout(o.factory_org_id)
  ) then
    raise exception 'Stripe pays this factory: retry the payout instead'
      using errcode = '22023', hint = 'payout_stripe';
  end if;
  -- New: a Stripe transfer may exist whatever the route says now.
  if p.release_claimed_at is not null or p.stripe_release_started then
    raise exception 'Stripe may already have paid this: press Retry payout, which checks with Stripe first'
      using errcode = '22023', hint = 'payout_stripe_started';
  end if;

  select a.payoneer_email into current_email
    from public.factory_payout_accounts a
   where a.org_id = o.factory_org_id and a.is_primary and a.method = 'payoneer';
  if current_email is null or current_email <> lower(btrim(coalesce(paid_to, ''))) then
    raise exception 'this factory changed where it is paid'
      using errcode = '22023', hint = 'payout_changed';
  end if;

  if reference !~ '^[A-Za-z0-9._/-]{3,64}$' then
    raise exception 'the Payoneer payment ID is 3 to 64 letters, numbers or - _ . /'
      using errcode = '22023', hint = 'payoneer_id_format';
  end if;
  if exists (
    select 1 from public.payoneer_payouts x
     where lower(x.payoneer_payment_id) = lower(reference)
       and x.factory_org_id <> o.factory_org_id
  ) then
    raise exception 'that Payoneer payment ID is recorded for another factory'
      using errcode = '22023', hint = 'payoneer_id_used';
  end if;

  update public.order_payments
     set state = 'released', released_by = auth.uid(), released_at = now()
   where id = p.id
  returning * into p;

  insert into public.payoneer_payouts
    (payment_id, factory_org_id, paid_to_email, payoneer_payment_id, note, recorded_by)
  values
    (p.id, o.factory_org_id, current_email, reference, nullif(btrim(coalesce(note, '')), ''), auth.uid());

  insert into public.payment_events (payment_id, from_state, to_state, actor_user_id, actor_kind)
  values (p.id, 'confirmed', 'released', auth.uid(), 'admin');

  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  values (
    o.factory_org_id, 'funds_released', 'payment', p.id, o.id,
    format('%s released to you', public.format_money(p.amount_cents, p.currency)),
    format('Sent by Payoneer against %s. Payoneer payment ID %s.', o.order_number, reference)
  );

  return p;
end;
$$;
create or replace function public.release_payment_to_factory(
  target_payment uuid,
  note text default null,
  paid_to_changed_at timestamptz default null
)
returns public.order_payments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p public.order_payments;
  o public.production_orders;
  account public.factory_payout_accounts;
  said text := nullif(btrim(coalesce(note, '')), '');
begin
  if not public.is_platform_admin() then
    raise exception 'releasing funds is limited to platform staff' using errcode = '42501';
  end if;

  select * into p from public.order_payments where id = target_payment for update;
  if not found then
    raise exception 'payment not found' using errcode = 'P0002';
  end if;

  select * into o from public.production_orders where id = p.order_id;

  if public.is_org_member(o.factory_org_id) then
    raise exception 'you belong to this company, so someone else on the staff must record its payout'
      using errcode = '42501', hint = 'payout_own_company';
  end if;
  if exists (select 1 from public.provider_payouts x where x.payment_id = p.id and x.status = 'processing') then
    raise exception 'a Wise or PayPal payment is under way for this: cancel it first, or it could be paid twice'
      using errcode = '22023', hint = 'payout_in_progress';
  end if;
  if p.state = 'released' then
    raise exception 'that payout was already marked as paid'
      using errcode = '22023', hint = 'payout_already_released';
  end if;
  if p.state <> 'confirmed' then
    raise exception 'that payment is %; only a confirmed one can be released', p.state
      using errcode = '22023';
  end if;
  if p.stripe_charge_id is not null and p.release_requested_at is null then
    raise exception 'the brand has not approved this step yet: money paid through Stripe is paid out once the brand approves it'
      using errcode = '22023';
  end if;
  -- New: the guard release_payment_by_payoneer has, and the pin.
  if p.stripe_payment_intent_id is not null and public.uses_stripe_payout(o.factory_org_id) then
    raise exception 'Stripe pays this factory: retry the payout instead'
      using errcode = '22023', hint = 'payout_stripe';
  end if;
  if p.release_claimed_at is not null or p.stripe_release_started then
    raise exception 'Stripe may already have paid this: press Retry payout, which checks with Stripe first'
      using errcode = '22023', hint = 'payout_stripe_started';
  end if;

  select * into account from public.factory_payout_accounts a
   where a.org_id = o.factory_org_id and a.is_primary;

  if said is null and account.method = 'payoneer' then
    raise exception 'this factory is paid by Payoneer: record the payment ID, or say why it was paid by bank'
      using errcode = '22023', hint = 'payoneer_default';
  end if;
  if said is null or length(said) < 3 or length(said) > 200 or said !~ '[[:alnum:]]' then
    raise exception 'enter the bank''s reference for this transfer'
      using errcode = '22023', hint = 'reference_required';
  end if;
  if public.payout_text_holds_number(o.factory_org_id, said) then
    raise exception 'the factory and the brand can read this, so it cannot hold the account number'
      using errcode = '22023', hint = 'reference_holds_number';
  end if;
  if paid_to_changed_at is not null
     and account.details_changed_at is distinct from paid_to_changed_at then
    raise exception 'this factory changed where it is paid'
      using errcode = '22023', hint = 'payout_changed';
  end if;

  update public.order_payments
     set state = 'released', released_by = auth.uid(), released_at = now(),
         released_note = said
   where id = p.id
  returning * into p;

  insert into public.bank_payouts
    (payment_id, factory_org_id, account_id, paid_to_holder, paid_to_bank, paid_to_last4, reference, recorded_by)
  values
    (p.id, o.factory_org_id, account.id,
     case when account.method = 'bank' then account.account_name end,
     case when account.method = 'bank' then account.bank_name end,
     case when account.method = 'bank' then account.account_number_last4 end,
     said, auth.uid());

  insert into public.payment_events (payment_id, from_state, to_state, actor_user_id, actor_kind)
  values (p.id, 'confirmed', 'released', auth.uid(), 'admin');

  -- Deliberately no milestone or chain effect. The work already opened when
  -- the payment was confirmed.
  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  values (
    o.factory_org_id, 'funds_released', 'payment', p.id, o.id,
    format('%s released to you', public.format_money(p.amount_cents, p.currency)),
    format('Sent by bank transfer against %s. TSC''s note: %s', o.order_number, said)
  );

  return p;
end;
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
-- Stripe answered that it made no transfer, or a list of the order's transfers
-- found none after every claim had ended. The time must be the claim the
-- caller checked, so a newer claim is never cleared.
create function public.record_stripe_release_not_sent(target_payment uuid, claimed timestamptz)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.order_payments
     set stripe_release_started = false, release_claimed_at = null
   where id = target_payment and state = 'confirmed' and stripe_release_started
     and release_claimed_at is not distinct from claimed;
  return found;
end;
$$;
revoke all on function public.record_stripe_release_not_sent(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.record_stripe_release_not_sent(uuid, timestamptz) to service_role;

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
             new.wise_details, new.wise_number_key, new.wise_currency, new.wise_recipient_type)
            is distinct from
            (old.bank_name, old.account_name, old.account_number_last4, old.swift, old.branch,
             old.bank_country, old.instructions, old.number_changed_at,
             old.wise_details, old.wise_number_key, old.wise_currency, old.wise_recipient_type) then
    named := new.bank_name || case when new.account_number_last4 is not null
      then format(' ending %s', new.account_number_last4) else '' end;
    what := format(case when public.uses_stripe_payout(org)
      then 'Your saved bank account changed: it is now %s, in the name of %s.'
      else 'The bank account TSC pays changed: it is now %s, in the name of %s.' end, named, new.account_name);

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
create or replace function public.documents_link_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.milestone_update_id is not null
     and new.milestone_update_id is distinct from old.milestone_update_id
     and not public.is_order_party(public.milestone_update_order(new.milestone_update_id))
  then
    raise exception 'you cannot attach a file to an order you are not part of'
      using errcode = '42501';
  end if;

  if new.order_id is not null
     and new.order_id is distinct from old.order_id
     and not public.is_order_party(new.order_id)
  then
    raise exception 'you cannot attach a file to an order you are not part of'
      using errcode = '42501';
  end if;

  -- New: a request's files are the brand's own.
  if new.rfq_id is not null
     and new.rfq_id is distinct from old.rfq_id
     and new.org_id is distinct from public.rfq_brand_org(new.rfq_id)
  then
    raise exception 'you can only attach your own files to your own request'
      using errcode = '42501';
  end if;

  -- New: screening reads a message's file names once, so nothing may join a
  -- message, or be renamed on one, after that. The sender's own, while checking.
  if new.message_id is not null
     and coalesce(auth.role(), '') = 'authenticated'
     and (new.message_id is distinct from old.message_id
          or new.file_name is distinct from old.file_name
          or new.storage_path is distinct from old.storage_path)
     and not exists (
       select 1 from public.messages m
        where m.id = new.message_id and m.sender_user_id = auth.uid() and m.delivery = 'checking')
  then
    raise exception 'a file can only be added to your own message as it is sent'
      using errcode = '42501';
  end if;

  return new;
end;
$$;
drop trigger documents_link_guard_insert on public.documents;
create trigger documents_link_guard_insert
  before insert on public.documents
  for each row
  when (new.milestone_update_id is not null or new.order_id is not null or new.rfq_id is not null
        or new.message_id is not null)
  execute function public.documents_link_guard();

-- Staff only: why a refund failed, and the reference of one made by hand.
create table public.payment_refund_staff_notes (
  payment_id uuid primary key references public.order_payments(id) on delete cascade,
  failure text,
  outside_reference text,
  recorded_by uuid,
  updated_at timestamptz not null default now()
);
alter table public.payment_refund_staff_notes enable row level security;
revoke all on public.payment_refund_staff_notes from public, anon, authenticated;
grant all on public.payment_refund_staff_notes to service_role;

insert into public.payment_refund_staff_notes (payment_id, failure)
select id, refund_failure from public.order_payments where refund_failure is not null;
update public.order_payments set refund_failure = null where refund_failure is not null;
update public.payment_events set note = 'Refund to the brand failed.'
 where note like 'Refund to the brand failed: %';
comment on column public.order_payments.refund_failure is
  'Unused: moved to payment_refund_staff_notes, which the companies cannot read.';

create or replace function public.claim_cancellation_refund(target_payment uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  o public.production_orders;
  p public.order_payments;
begin
  -- The order first, as close_order and record_payment_succeeded take it.
  select * into o from public.production_orders
   where id = (select order_id from public.order_payments where id = target_payment)
   for update;
  select * into p from public.order_payments where id = target_payment for update;

  if not found or o.status <> 'cancelled' or p.state <> 'confirmed' or p.release_requested_at is not null then
    return jsonb_build_object('refused', 'not_refundable');
  end if;
  if p.refund_claimed_at is not null and p.refund_claimed_at >= now() - interval '90 seconds' then
    return jsonb_build_object('refused', 'claimed');
  end if;
  if p.stripe_payment_intent_id is null then
    if p.refund_failed_at is null then
      update public.order_payments set refund_failed_at = now() where id = p.id;
      insert into public.payment_refund_staff_notes (payment_id, failure)
      values (p.id, 'Held with no Stripe charge to refund (an old bank transfer): refund the brand by bank.')
      on conflict (payment_id) do update set failure = excluded.failure, updated_at = now();
    end if;
    return jsonb_build_object('refused', 'no_stripe_charge');
  end if;

  update public.order_payments set refund_claimed_at = now() where id = p.id returning * into p;

  return jsonb_build_object(
    'payment_id', p.id,
    'order_id', p.order_id,
    'intent', p.stripe_payment_intent_id,
    'charge', p.stripe_charge_id,
    'key', format('cancel-refund-%s-%s', p.id, extract(epoch from p.refund_claimed_at)::bigint)
  );
end;
$$;
create or replace function public.record_cancellation_refund_failed(target_payment uuid, reason text)
returns public.order_payments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p public.order_payments;
  was public.payment_state;
  why text := coalesce(nullif(btrim(coalesce(reason, '')), ''), 'The refund to the brand did not go through.');
begin
  select * into p from public.order_payments where id = target_payment for update;
  if not found then
    return null;
  end if;
  was := p.state;

  -- Already recorded (refund.failed and charge.refund.updated both say it).
  if was = 'confirmed' and p.refund_failed_at is not null and p.refund_claimed_at is null
     and (select n.failure from public.payment_refund_staff_notes n where n.payment_id = p.id) is not distinct from why then
    return p;
  end if;

  -- A refund that Stripe later says failed puts the money back as held.
  if was = 'cancelled' and p.refunded_at is not null and p.stripe_payment_intent_id is not null then
    update public.order_payments
       set state = 'confirmed', refunded_at = null
     where id = p.id;
  elsif was <> 'confirmed' then
    return p;
  end if;

  update public.order_payments
     set refund_claimed_at = null,
         refund_failed_at = now()
   where id = p.id
  returning * into p;

  insert into public.payment_events (payment_id, from_state, to_state, actor_kind, note)
  values (p.id, was, p.state, 'system', 'Refund to the brand failed.');
  insert into public.payment_refund_staff_notes (payment_id, failure) values (p.id, why)
  on conflict (payment_id) do update set failure = excluded.failure, updated_at = now();
  return p;
end;
$$;
-- Staff refunded the brand some other way (no Stripe charge, a charge too old
-- to refund, a dispute). Closes it as record_payment_refunded does, with the
-- same words to each company.
create function public.record_refund_outside_stripe(target_payment uuid, reference text)
returns public.order_payments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  o public.production_orders;
  p public.order_payments;
  m public.order_milestones;
  said text := nullif(btrim(coalesce(reference, '')), '');
begin
  if not public.is_platform_admin() then
    raise exception 'recording a refund is limited to platform staff' using errcode = '42501';
  end if;

  select * into o from public.production_orders
   where id = (select order_id from public.order_payments where id = target_payment)
   for update;
  select * into p from public.order_payments where id = target_payment for update;
  if not found then
    raise exception 'payment not found' using errcode = 'P0002';
  end if;

  if public.is_org_member(o.brand_org_id) or public.is_org_member(o.factory_org_id) then
    raise exception 'you belong to a company on this order, so someone else on the staff must record it'
      using errcode = '42501', hint = 'payout_own_company';
  end if;
  if o.status <> 'cancelled' or p.state <> 'confirmed' or p.release_requested_at is not null or p.refund_failed_at is null then
    raise exception 'only a refund that failed on a cancelled order can be recorded this way'
      using errcode = '22023', hint = 'refund_not_failed';
  end if;
  if p.refund_claimed_at is not null and p.refund_claimed_at >= now() - interval '90 seconds' then
    raise exception 'this refund is being tried now: wait a moment'
      using errcode = '22023', hint = 'refund_in_progress';
  end if;
  if said is null or length(said) < 3 or length(said) > 200 or said !~ '[[:alnum:]]' then
    raise exception 'enter the reference for this refund'
      using errcode = '22023', hint = 'reference_required';
  end if;

  update public.order_payments
     set state = 'cancelled',
         charged_cents = coalesce(charged_cents, amount_received_cents),
         refund_claimed_at = null,
         refund_failed_at = null,
         refunded_at = now()
   where id = p.id
  returning * into p;

  insert into public.payment_refund_staff_notes (payment_id, outside_reference, recorded_by)
  values (p.id, said, auth.uid())
  on conflict (payment_id) do update
    set outside_reference = excluded.outside_reference, recorded_by = excluded.recorded_by, updated_at = now();

  insert into public.payment_events (payment_id, from_state, to_state, actor_user_id, actor_kind, note)
  values (p.id, 'confirmed', 'cancelled', auth.uid(), 'admin', 'Refunded to the brand outside Stripe.');

  select * into m from public.order_milestones where id = p.milestone_id;

  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  values
    (o.brand_org_id, 'payment_refunded', 'payment', p.id, o.id,
     format('Your payment for "%s" was refunded', m.title),
     format('%s was cancelled. You were refunded.', o.order_number)),
    (o.factory_org_id, 'payment_refunded', 'payment', p.id, o.id,
     format('The payment for "%s" went back to the brand', m.title),
     format('%s was cancelled.', o.order_number));

  return p;
end;
$$;
revoke all on function public.record_refund_outside_stripe(uuid, text) from public, anon;
grant execute on function public.record_refund_outside_stripe(uuid, text) to authenticated;

-- The board (from 20261108309000): why a refund failed comes from the staff
-- table, and it says which payouts are pinned to Stripe.
drop function public.admin_payment_board();

create function public.admin_payment_board()
returns table (
  payment_id               uuid,
  state                    public.payment_state,
  amount_cents             bigint,
  fee_cents                bigint,
  charged_cents            bigint,
  currency                 char(3),
  order_id                 uuid,
  order_number             text,
  order_status             text,
  brand_name               text,
  factory_name             text,
  milestone_title          text,
  milestone_state          text,
  brand_reference          text,
  payment_method_label     text,
  failure_reason           text,
  stripe_payment_intent_id text,
  stripe_transfer_id       text,
  sent_at                  timestamptz,
  processing_at            timestamptz,
  failed_at                timestamptz,
  confirmed_at             timestamptz,
  release_requested_at     timestamptz,
  factory_stripe_ready     boolean,
  payout_summary           text,
  payout_method            text,
  payoneer_email           text,
  payoneer_payment_id      text,
  payout_account_id        uuid,
  payout_holder            text,
  payout_bank              text,
  payout_branch            text,
  payout_country           text,
  payout_swift             text,
  payout_instructions      text,
  payout_last4             text,
  payout_has_number        boolean,
  payout_number_kind       text,
  payout_changed_at        timestamptz,
  payout_changed_recently  boolean,
  contact_name             text,
  contact_email            text,
  contact_phone            text,
  last_viewed_by           text,
  last_viewed_at           timestamptz,
  paypal_email             text,
  wise_recipient_type      text,
  wise_currency            text,
  wise_recipient_id        text,
  wise_details             jsonb,
  provider                 text,
  provider_status          text,
  provider_ref             text,
  provider_failure_code    text,
  provider_at              timestamptz,
  refund_failed_at         timestamptz,
  refund_failure           text,
  stripe_release_started   boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'this board is limited to platform staff' using errcode = '42501';
  end if;

  return query
  select
    p.id, p.state, p.amount_cents, public.payment_fee_cents(p.id), p.charged_cents, p.currency,
    o.id, o.order_number, o.status::text,
    b.name, f.name,
    m.title, m.state::text,
    p.brand_reference, p.payment_method_label,
    case when p.state = 'released' then refund.note else p.failure_reason end,
    p.stripe_payment_intent_id, p.stripe_transfer_id,
    p.sent_at, p.processing_at, p.failed_at, p.confirmed_at, p.release_requested_at,
    (p.stripe_transfer_id is not null or (p.state <> 'released' and public.uses_stripe_payout(o.factory_org_id))),
    case when a.method = 'payoneer' then 'Payoneer: ' || a.payoneer_email
         when a.method = 'paypal' then 'PayPal: ' || a.paypal_email else
    coalesce(nullif(concat_ws(' · ',
      nullif(btrim(a.account_name), ''),
      nullif(btrim(a.bank_name), ''),
      nullif(btrim(a.bank_country), ''),
      '····' || nullif(btrim(a.account_number_last4), ''),
      'SWIFT ' || nullif(btrim(a.swift), '')
    ), ''), 'no bank details on file') end,
    a.method, a.payoneer_email, sent.payoneer_payment_id,
    a.id, a.account_name, a.bank_name, a.branch, a.bank_country::text, a.swift, a.instructions,
    a.account_number_last4,
    a.number_changed_at is not null,
    num.number_kind,
    a.details_changed_at,
    coalesce(a.details_changed_at > now() - interval '14 days', false),
    contact.full_name, contact.email, phone.phone,
    viewed.staff_email, viewed.revealed_at,
    a.paypal_email, a.wise_recipient_type, a.wise_currency::text, a.wise_recipient_id, a.wise_details,
    attempt.provider, attempt.status, attempt.provider_ref, attempt.failure_code, attempt.updated_at,
    p.refund_failed_at, case when p.refund_failed_at is not null then staff_note.failure end,
    p.stripe_release_started
  from public.order_payments p
  join public.production_orders o on o.id = p.order_id
  join public.order_milestones m  on m.id = p.milestone_id
  join public.orgs b on b.id = o.brand_org_id
  join public.orgs f on f.id = o.factory_org_id
  left join public.stripe_connect_accounts sca on sca.org_id = o.factory_org_id
  left join public.factory_payout_accounts a
    on a.org_id = o.factory_org_id and a.is_primary
  left join public.payout_account_numbers num on num.account_id = a.id
  left join public.payment_refund_staff_notes staff_note on staff_note.payment_id = p.id
  left join public.payoneer_payouts sent on sent.payment_id = p.id
  left join public.company_contact_details phone on phone.org_id = o.factory_org_id
  left join lateral (
    select coalesce(up.full_name, '') as full_name, u.email::text as email
      from public.org_members om
      join auth.users u on u.id = om.user_id
      left join public.user_profiles up on up.id = om.user_id
     where om.org_id = o.factory_org_id
     order by ('primaryContact' = any(om.permissions)) desc, (om.role = 'owner') desc, om.created_at
     limit 1
  ) contact on true
  left join lateral (
    select r.staff_email, r.revealed_at from public.payout_number_reveals r
     where r.account_id = a.id
     order by r.revealed_at desc
     limit 1
  ) viewed on true
  left join lateral (
    select e.note from public.payment_events e
     where p.state = 'released'
       and e.payment_id = p.id and e.from_state = 'released' and e.to_state = 'released'
       and e.note like '%' || format(' (Stripe %s)', p.stripe_payment_intent_id)
     order by e.created_at desc
     limit 1
  ) refund on true
  left join lateral (
    select x.provider, x.status, x.provider_ref, x.failure_code, x.updated_at
      from public.provider_payouts x
     where x.payment_id = p.id
     order by x.created_at desc
     limit 1
  ) attempt on true
  where p.state in ('sent', 'processing', 'failed', 'confirmed')
     or (p.state = 'released' and refund.note is not null)
  order by
    case p.state
      when 'sent' then 0
      when 'confirmed' then case when p.release_requested_at is not null then 1 else 3 end
      when 'released' then 1
      when 'failed' then 2
      else 4
    end,
    coalesce(p.release_requested_at, p.sent_at, p.failed_at, p.processing_at, p.confirmed_at);
end;
$$;

revoke all on function public.admin_payment_board() from public;
grant execute on function public.admin_payment_board() to authenticated;

-- Supabase's default privileges granted these; only the policies stood between
-- a signed-in person and rewriting a legal record or a message.
revoke insert, update, delete, truncate on public.legal_documents from authenticated;
revoke update, delete, truncate on public.terms_acceptances from authenticated;
revoke update, delete, truncate on public.messages from authenticated;

-- A number pasted with U+200B must read the same here as on the screen.
create or replace function public.normalise_registration_number(country text, raw text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  -- A Chinese keyboard types full-width digits and letters (１２３, ＡＢＣ):
  -- they are the same characters to us.
  -- New: invisible characters too (Unicode's Cf, listed because Postgres has no
  -- \p{Cf}). Must match normaliseRegistrationNumber in registration-number.mjs.
  with t as (
    select regexp_replace(upper(translate(coalesce(raw, ''),
      '０１２３４５６７８９ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ－．／　',
      '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-./ ')), '[\s./\u00AD\u0600-\u0605\u061C\u06DD\u070F\u0890-\u0891\u08E2\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB\U000110BD\U000110CD\U00013430-\U0001343F\U0001BCA0-\U0001BCA3\U0001D173-\U0001D17A\U000E0001\U000E0020-\U000E007F-]', '', 'g') as v
  )
  select case when country = 'PT' and v ~ '^PT\d{9}$' then substr(v, 3) else v end from t
$$;