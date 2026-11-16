-- The staff-paid bank transfer ("Mark paid out by bank") costs the factory a
-- fixed wire fee, like every other route's payout fee: TSC's bank charges TSC
-- for an outgoing international wire, so staff send the amount less the fee
-- and TSC pays the amount, no more.
--
-- The figure is FEE_FORMULAS.bank in src/shared/withdrawal-fees.mjs, copied
-- here because SQL cannot import it; check:withdrawal-fees fails if the two
-- differ. US$50: the highest common outgoing international wire fee of a US
-- business bank, used until TSC's own bank's figure is confirmed.

create or replace function public.bank_payout_fee_cents()
returns bigint
language sql
immutable
as $$ select 5000::bigint $$;

revoke all on function public.bank_payout_fee_cents() from public, anon;
grant execute on function public.bank_payout_fee_cents() to authenticated, service_role;

-- From 20261108710000, with the wire fee recorded and said. Revokes and grants as they were.
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

  -- The factory pays the wire fee: a payment no bigger than it is refused.
  if p.amount_cents <= public.bank_payout_fee_cents() then
    raise exception 'this payment is not more than the bank transfer fee, so nothing would arrive'
      using errcode = '22023', hint = 'fee_too_large';
  end if;

  update public.order_payments
     set state = 'released', released_by = auth.uid(), released_at = now(),
         released_note = said, payout_fee_cents = public.bank_payout_fee_cents()
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
    format('Sent by bank transfer against %s.%s TSC''s note: %s', o.order_number, public.payout_fee_sentence(p), said)
  );

  return p;
end;
$$;
