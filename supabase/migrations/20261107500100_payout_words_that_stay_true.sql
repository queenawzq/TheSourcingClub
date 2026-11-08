-- ============================================================================
-- What the factory reads about a payout stays true
-- ----------------------------------------------------------------------------
-- provider_payouts is what the factory's page reads, and "processing" there
-- covered a Wise transfer nobody has funded: the page said "on its way" while
-- no money had moved. `money_left_at` is the moment the provider first said the
-- money went. It holds a time, no provider's words.
--
-- `asked_to_check` is what the bell asked this factory to check, our words, so
-- the row and the card can name the same detail ("Check your SWIFT code").
--
-- A factory never reads "Stripe": record_payment_released's email said "Sent to
-- your Stripe account". Notifications already written stay as they are: the
-- table is immutable by design. Same signatures and grants throughout.
-- ============================================================================

alter table public.provider_payouts
  add column money_left_at timestamptz,
  add column asked_to_check text;

update public.provider_payouts x
   set money_left_at = x.updated_at
  from public.provider_payout_attempts a
 where a.payout_id = x.id and a.stage = 'sent' and x.status = 'processing';

-- From 20261107500000.
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
         money_left_at = case when new_stage = 'sent' then coalesce(x.money_left_at, now()) else x.money_left_at end,
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
           format('Your payment of %s is waiting. %s.', public.format_money(live.amount_cents, live.currency), tell_factory)
      from public.order_payments p where p.id = live.payment_id;
    update public.provider_payout_attempts a set factory_told_at = now() where a.payout_id = target_payout;
    update public.provider_payouts x set details_asked_at = now(), asked_to_check = tell_factory where x.id = target_payout;
  end if;
end;
$$;

revoke all on function public.record_provider_attempt(uuid, text, text, text, bigint, text, text, text, bigint, text, boolean, text) from public, anon, authenticated;
grant execute on function public.record_provider_attempt(uuid, text, text, text, bigint, text, text, text, bigint, text, boolean, text) to service_role;

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

-- From 20261013000200. Revokes and grants as they were.
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
    format('Sent against %s.', o.order_number)
  );

  return p;
end;
$$;
