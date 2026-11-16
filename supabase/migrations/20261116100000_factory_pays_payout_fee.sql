-- The factory pays the provider's payout fee; TSC pays none.
--
-- src/shared/withdrawal-fees.mjs decides the fee (a provider's quote where it
-- gives one, else its published formula, rounded up). The server records it
-- here, on the payment, before any money moves: one figure that the staff
-- board, the factory's payments row and its notification all read. TSC's
-- balance goes down by the payment's amount; the factory receives
-- amount - fee.

alter table public.order_payments
  add column if not exists payout_fee_cents bigint
    check (payout_fee_cents is null or (payout_fee_cents >= 0 and payout_fee_cents < amount_cents));

comment on column public.order_payments.payout_fee_cents is
  'The provider''s payout fee the factory paid on this payment (minor units, payment currency). The factory received amount_cents - payout_fee_cents.';

-- Server only: what the provider will charge, before the money moves. A
-- payout that is already paid keeps its figure.
create or replace function public.record_payout_fee(target_payment uuid, fee bigint)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p public.order_payments;
begin
  select * into p from public.order_payments where id = target_payment for update;
  if not found then
    raise exception 'payment not found' using errcode = 'P0002';
  end if;
  if fee is null or fee < 0 or fee >= p.amount_cents then
    raise exception 'the fee must be less than the payment' using errcode = '22023';
  end if;
  if p.state = 'released' then
    return;
  end if;
  update public.order_payments set payout_fee_cents = fee where id = p.id;
end;
$$;

revoke all on function public.record_payout_fee(uuid, bigint) from public, anon, authenticated;
grant execute on function public.record_payout_fee(uuid, bigint) to service_role;

-- The sentence a paid notification adds when a fee was taken.
create or replace function public.payout_fee_sentence(p public.order_payments)
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select case when coalesce(p.payout_fee_cents, 0) > 0
    then format(' Fee %s, taken from it: you receive %s.',
      public.format_money(p.payout_fee_cents, p.currency),
      public.format_money(p.amount_cents - p.payout_fee_cents, p.currency))
    else '' end;
$$;

revoke all on function public.payout_fee_sentence(public.order_payments) from public, anon, authenticated;

-- From 20261107500100, with the fee in the paid notification. Revokes and grants as they were.
-- From 20261107200000.
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
        format('Sent to %s against %s.', live.paid_to, o.order_number) || public.payout_fee_sentence(p));
    end if;

  elsif outcome = 'failed' then
    if failure not in ('details_rejected', 'other') then
      raise exception 'a failure needs a code' using errcode = '22023';
    end if;
    if live.status = 'failed' then
      return;
    end if;
    update public.provider_payouts x
       set status = 'failed', failure_code = failure, paid_at = null, asked_to_check = tell_factory, updated_at = now()
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
        format('Your payment of %s is waiting. %s.', public.format_money(p.amount_cents, p.currency), tell_factory));
    end if;
  elsif outcome = 'cancelled' then
    if live.status <> 'processing' then
      return;
    end if;
    update public.provider_payouts x set status = 'cancelled', updated_at = now() where x.id = live.id;
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

-- From 20261107500100 (first 20261013000200), with the fee. Revokes and grants as they were.
create or replace function public.record_payment_released(target_payment uuid, transfer text)
returns public.order_payments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p public.order_payments;
  o public.production_orders;
begin
  select * into p from public.order_payments where id = target_payment for update;
  if not found then
    raise exception 'payment not found' using errcode = 'P0002';
  end if;
  if p.state <> 'confirmed' then
    return p;
  end if;

  select * into o from public.production_orders where id = p.order_id;

  update public.order_payments
     set state = 'released', released_at = now(), released_by = null,
         stripe_transfer_id = transfer,
         released_note = null
   where id = p.id
  returning * into p;

  insert into public.payment_events (payment_id, from_state, to_state, actor_kind)
  values (p.id, 'confirmed', 'released', 'system');

  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  values (
    o.factory_org_id, 'funds_released', 'payment', p.id, o.id,
    format('%s paid out to you', public.format_money(p.amount_cents, p.currency)),
    format('Sent against %s.', o.order_number) || public.payout_fee_sentence(p)
  );

  return p;
end;
$$;
