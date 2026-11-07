-- ============================================================================
-- Pay with Wise, Pay with PayPal: pressing once pays once
-- ----------------------------------------------------------------------------
-- provider_payouts (20261107100000) is what the factory reads. This is what
-- staff and the server need behind it, and it is staff-only because it holds a
-- provider's words: which step an attempt reached, the key a retry must reuse,
-- what the provider last said.
--
-- The key is made here, before any provider call, and sent as Wise's
-- customerTransactionId and PayPal's sender_batch_id. Same key, same transfer:
-- a press after a timeout finds what the first press did instead of paying
-- again. A second attempt is a new row with a new key, and only exists once the
-- last one is known to have failed. So Stripe's rule holds: an old failure is
-- never replayed.
--
-- The lease stops two presses running side by side. It lapses by itself, so a
-- server that died mid-call can never freeze a payout. Same shape as
-- claim_payment_release.
--
-- Only the server records what a provider says (service_role): a member of
-- staff with a token cannot call a payment paid. Staff start, resume and cancel
-- an attempt; they cannot finish one.
--
-- Safe with the live site while applied: one table and new functions. The two
-- mark-paid functions and the Stripe claim only gain a refusal that cannot fire
-- until someone presses a button the live site does not have.
-- ============================================================================

create table public.provider_payout_attempts (
  payout_id uuid primary key references public.provider_payouts (id) on delete cascade,
  attempt_key uuid not null unique default gen_random_uuid(),
  -- claimed: pressed, the provider may or may not have it.
  -- awaiting_funding: Wise has a transfer nobody has paid for yet.
  -- sent: the provider has the money.
  -- done: finished, however it ended.
  stage text not null default 'claimed' check (stage in ('claimed', 'awaiting_funding', 'sent', 'done')),
  lease_until timestamptz,
  quote_id text,
  fee_minor bigint,
  provider_item_id text,
  -- The provider's own word for where it is, and the sentence staff read.
  provider_status text,
  staff_sentence text,
  -- Wise's "contract and invoice denominated in CNY" statement: who made it.
  cny_confirmed_by uuid references auth.users (id) on delete set null,
  cny_confirmed_at timestamptz,
  -- A factory told to check its details is told once per attempt.
  factory_told_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.provider_payout_attempts enable row level security;
revoke all on public.provider_payout_attempts from public, anon, authenticated;
grant select, insert, update on public.provider_payout_attempts to service_role;

-- ---------------------------------------------------------------------------
-- The staff tests every payout function shares, first statement in each.
-- ---------------------------------------------------------------------------
create or replace function public.payout_staff_check(target_org uuid)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if public.is_org_member(target_org) then
    raise exception 'you belong to this company, so someone else on the staff must pay it'
      using errcode = '42501', hint = 'payout_own_company';
  end if;
  if exists (
    select 1 from public.production_orders o
     where o.factory_org_id = target_org and public.is_org_member(o.brand_org_id)
  ) then
    raise exception 'your company has an order with this factory, so someone else on the staff must pay it'
      using errcode = '42501', hint = 'reveal_brand_side';
  end if;
end;
$$;

revoke all on function public.payout_staff_check(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Pressing the button. Runs as the staff member, so auth.uid() is who pressed.
-- `paid_to_changed_at` is what their page showed: details changed under their
-- tab are refused, new attempt or resumed one, since a resumed one would send
-- to where the old details pointed.
-- ---------------------------------------------------------------------------
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
     where s.org_id = o.factory_org_id and s.transfers_active
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

revoke all on function public.claim_provider_payout(uuid, text, timestamptz, boolean) from public, anon;
grant execute on function public.claim_provider_payout(uuid, text, timestamptz, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Taking an attempt to cancel it: same tests, no new attempt.
-- ---------------------------------------------------------------------------
create or replace function public.lease_provider_payout(target_payment uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  o public.production_orders;
  live public.provider_payouts;
  attempt public.provider_payout_attempts;
begin
  if not public.is_platform_admin() then
    raise exception 'paying a factory is limited to platform staff' using errcode = '42501';
  end if;
  select po.* into o from public.order_payments p
    join public.production_orders po on po.id = p.order_id
   where p.id = target_payment for update of p;
  if not found then
    raise exception 'payment not found' using errcode = 'P0002';
  end if;
  perform public.payout_staff_check(o.factory_org_id);

  select * into live from public.provider_payouts x
   where x.payment_id = target_payment and x.status = 'processing';
  if not found then
    raise exception 'nothing is under way for this payment' using errcode = '22023', hint = 'payout_not_processing';
  end if;
  select * into attempt from public.provider_payout_attempts a where a.payout_id = live.id for update;
  if attempt.lease_until is not null and attempt.lease_until > now() then
    raise exception 'this is already being paid' using errcode = '22023', hint = 'payout_in_progress';
  end if;
  update public.provider_payout_attempts a
     set lease_until = now() + interval '90 seconds', updated_at = now()
   where a.payout_id = live.id;

  return jsonb_build_object(
    'payout_id', live.id, 'provider', live.provider, 'stage', attempt.stage,
    'provider_ref', live.provider_ref, 'provider_item_id', attempt.provider_item_id
  );
end;
$$;

revoke all on function public.lease_provider_payout(uuid) from public, anon;
grant execute on function public.lease_provider_payout(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- What a provider said, on its way. Server only.
-- `tell_factory` is one sentence the factory acts on, sent once per attempt.
-- It is a payout_method_changed notice: always emailed, links to Payments.
-- ---------------------------------------------------------------------------
create or replace function public.record_provider_attempt(
  target_payout uuid,
  new_stage text default null,
  new_ref text default null,
  new_quote text default null,
  new_fee bigint default null,
  new_item text default null,
  new_status text default null,
  sentence text default null,
  received bigint default null,
  received_in text default null,
  keep_lease boolean default false,
  tell_factory text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  live public.provider_payouts;
  told timestamptz;
begin
  select * into live from public.provider_payouts where id = target_payout for update;
  if not found or live.status <> 'processing' then
    return;
  end if;

  update public.provider_payouts x
     set provider_ref = coalesce(new_ref, x.provider_ref),
         received_minor = coalesce(received, x.received_minor),
         received_currency = coalesce(received_in, x.received_currency),
         updated_at = now()
   where x.id = target_payout;

  update public.provider_payout_attempts a
     set stage = coalesce(new_stage, a.stage),
         quote_id = coalesce(new_quote, a.quote_id),
         fee_minor = coalesce(new_fee, a.fee_minor),
         provider_item_id = coalesce(new_item, a.provider_item_id),
         provider_status = coalesce(new_status, a.provider_status),
         staff_sentence = sentence,
         lease_until = case when keep_lease then a.lease_until end,
         updated_at = now()
   where a.payout_id = target_payout
  returning a.factory_told_at into told;

  if tell_factory is not null and told is null then
    insert into public.notifications (org_id, kind, subject_type, subject_id, order_id, title, body)
    select live.factory_org_id, 'payout_method_changed', 'payment', live.payment_id, p.order_id, tell_factory,
           format('Your payment of %s is waiting. %s', public.format_money(live.amount_cents, live.currency), tell_factory)
      from public.order_payments p where p.id = live.payment_id;
    update public.provider_payout_attempts a set factory_told_at = now() where a.payout_id = target_payout;
  end if;
end;
$$;

revoke all on function public.record_provider_attempt(uuid, text, text, text, bigint, text, text, text, bigint, text, boolean, text) from public, anon, authenticated;
grant execute on function public.record_provider_attempt(uuid, text, text, text, bigint, text, text, text, bigint, text, boolean, text) to service_role;

-- ---------------------------------------------------------------------------
-- How it ended. Server only. One transaction, as provider_payouts promises:
-- the row goes paid and the payment goes released, or the row goes failed and
-- the payment is owed again. A transfer that bounces after we said paid comes
-- back: the factory was told it was paid, so it is told otherwise.
-- ---------------------------------------------------------------------------
create or replace function public.finish_provider_payout(
  target_payout uuid,
  outcome text,
  failure text default null,
  raw_status text default null,
  sentence text default null,
  received bigint default null,
  received_in text default null,
  tell_factory text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  live public.provider_payouts;
  p public.order_payments;
  o public.production_orders;
begin
  select * into live from public.provider_payouts where id = target_payout;
  if not found then
    return;
  end if;
  select * into p from public.order_payments where id = live.payment_id for update;
  select * into live from public.provider_payouts where id = target_payout for update;
  select * into o from public.production_orders where id = p.order_id;

  if outcome = 'paid' then
    if live.status <> 'processing' then
      return;
    end if;
    update public.provider_payouts x
       set status = 'paid', paid_at = now(), updated_at = now(),
           received_minor = coalesce(received, x.received_minor),
           received_currency = coalesce(received_in, x.received_currency)
     where x.id = live.id;

    if p.state = 'confirmed' then
      update public.order_payments
         set state = 'released', released_by = live.requested_by, released_at = now(), released_note = null
       where id = p.id;
      insert into public.payment_events (payment_id, from_state, to_state, actor_user_id, actor_kind)
      values (p.id, 'confirmed', 'released', live.requested_by, 'admin');
      insert into public.notifications (org_id, kind, subject_type, subject_id, order_id, title, body)
      values (o.factory_org_id, 'funds_released', 'payment', p.id, o.id,
        format('%s released to you', public.format_money(p.amount_cents, p.currency)),
        format('Sent to %s against %s.', live.paid_to, o.order_number));
    end if;

  elsif outcome = 'failed' then
    if failure not in ('details_rejected', 'other') then
      raise exception 'a failure needs a code' using errcode = '22023';
    end if;
    if live.status = 'failed' then
      return;
    end if;
    update public.provider_payouts x
       set status = 'failed', failure_code = failure, paid_at = null, updated_at = now()
     where x.id = live.id;

    if live.status = 'paid' and p.state = 'released' then
      update public.order_payments
         set state = 'confirmed', released_by = null, released_at = null
       where id = p.id;
      insert into public.payment_events (payment_id, from_state, to_state, actor_user_id, actor_kind, note)
      values (p.id, 'released', 'confirmed', null, 'system', 'The transfer was returned after it was sent');
    end if;

    if tell_factory is not null then
      insert into public.notifications (org_id, kind, subject_type, subject_id, order_id, title, body)
      values (o.factory_org_id, 'payout_method_changed', 'payment', p.id, o.id, tell_factory,
        format('Your payment of %s is waiting. %s', public.format_money(p.amount_cents, p.currency), tell_factory));
    end if;
  else
    raise exception 'unknown outcome' using errcode = '22023';
  end if;

  update public.provider_payout_attempts a
     set stage = 'done',
         provider_status = coalesce(raw_status, a.provider_status),
         staff_sentence = sentence,
         lease_until = null,
         updated_at = now()
   where a.payout_id = target_payout;
end;
$$;

revoke all on function public.finish_provider_payout(uuid, text, text, text, text, bigint, text, text) from public, anon, authenticated;
grant execute on function public.finish_provider_payout(uuid, text, text, text, text, bigint, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- What the board draws beside each payout. Each payment's latest attempt, while
-- it can still change or if it ended badly. Staff only, first statement.
-- ---------------------------------------------------------------------------
create or replace function public.admin_provider_attempts()
returns table (
  payment_id uuid,
  payout_id uuid,
  provider text,
  status text,
  stage text,
  in_progress boolean,
  provider_ref text,
  provider_status text,
  staff_sentence text,
  failure_code text,
  fee_minor bigint,
  received_minor bigint,
  received_currency char(3),
  paid_to text,
  account_id uuid,
  requested_by_email text,
  updated_at timestamptz
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
  select distinct on (x.payment_id)
    x.payment_id, x.id, x.provider, x.status, a.stage,
    coalesce(a.lease_until > now(), false),
    x.provider_ref, a.provider_status, a.staff_sentence, x.failure_code, a.fee_minor,
    x.received_minor, x.received_currency, x.paid_to, x.account_id,
    (select u.email::text from auth.users u where u.id = x.requested_by),
    x.updated_at
  from public.provider_payouts x
  join public.provider_payout_attempts a on a.payout_id = x.id
  join public.order_payments p on p.id = x.payment_id
  where p.state = 'confirmed'
  order by x.payment_id, x.created_at desc;
end;
$$;

revoke all on function public.admin_provider_attempts() from public, anon;
grant execute on function public.admin_provider_attempts() to authenticated;

-- ---------------------------------------------------------------------------
-- Everything else that pays refuses while an attempt is under way, or the
-- money goes twice. Read from their latest definitions: 20261106600100,
-- 20261104300100, 20261102222927.
-- ---------------------------------------------------------------------------
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
     where s.org_id = o.factory_org_id and s.transfers_active
  ) then
    raise exception 'Stripe pays this factory: retry the payout instead'
      using errcode = '22023', hint = 'payout_stripe';
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


create or replace function public.claim_payment_release(target_payment uuid)
returns timestamptz language plpgsql security definer set search_path = public, pg_temp as $$
declare claimed timestamptz; target_org uuid;
begin
  select o.factory_org_id into target_org from public.order_payments p
    join public.production_orders o on o.id=p.order_id where p.id=target_payment;
  perform 1 from public.stripe_connect_accounts where org_id=target_org for update;
  if exists (select 1 from public.stripe_connect_upgrades where org_id=target_org and completed_at is null and new_account_id is not null) then
    return null;
  end if;
  if exists (select 1 from public.provider_payouts x where x.payment_id=target_payment and x.status='processing') then
    return null;
  end if;
  update public.order_payments set release_claimed_at=now()
    where id=target_payment and state='confirmed' and release_requested_at is not null
    and (release_claimed_at is null or release_claimed_at < now()-interval '10 minutes')
    returning release_claimed_at into claimed;
  return claimed;
end; $$;

