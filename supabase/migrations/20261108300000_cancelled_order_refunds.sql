-- ============================================================================
-- A cancelled order's held money goes back to the brand by itself
-- ----------------------------------------------------------------------------
-- John, call of Nov 7: "just make it automatic". Until now money TSC held on
-- a cancelled order waited on the staff board until someone refunded it in
-- Stripe by hand.
--
-- Which money: a payment held by TSC (confirmed) on a cancelled order that the
-- brand has not released to the factory (release_requested_at is null). Money
-- the brand released (an approved step, or a deposit, which asks for its
-- payout as soon as it is funded) is the factory's and is paid out as before.
-- Paid out stays paid out. A payment still clearing when the order was
-- cancelled is refunded when it lands, as since 20261022000300.
--
-- How: the server claims each payment (claim_cancellation_refund, a 90 s
-- lease whose time goes into Stripe's idempotency key, so a refusal is never
-- replayed), refunds the whole charge, fee included, and records it with
-- record_payment_refunded. A refusal is recorded with our own sentence
-- (record_cancellation_refund_failed) and shows on the staff board, where
-- staff refund it in Stripe (the webhook then records it). The daily job
-- retries what never reached Stripe (an outage, a closed page).
--
-- record_payment_refunded, on a cancelled order, now keeps the charged figure,
-- intent and charge (the brand's row shows what went back), does nothing the
-- second time (the webhook follows our own refund), and tells the factory.
--
-- Safe with the old site live: three nullable columns, three new service-only
-- functions, record_payment_refunded keeps its signature and grants.
-- ============================================================================

alter table public.order_payments
  add column if not exists refund_claimed_at timestamptz,
  add column if not exists refund_failed_at  timestamptz,
  add column if not exists refund_failure    text;

comment on column public.order_payments.refund_claimed_at is
  'The server is refunding this held payment to the brand because its order was cancelled (claim_cancellation_refund).';
comment on column public.order_payments.refund_failed_at is
  'The last refund of this payment on a cancelled order failed; staff see it on the board. Cleared once refunded.';
comment on column public.order_payments.refund_failure is
  'Why the refund failed, in our words (never Stripe''s message).';

-- ---------------------------------------------------------------------------
-- What is still to refund. An order id narrows it to one order.
-- ---------------------------------------------------------------------------
create or replace function public.cancellation_refunds_due(target_order uuid default null)
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id
    from public.order_payments p
    join public.production_orders o on o.id = p.order_id
   where o.status = 'cancelled'
     and p.state = 'confirmed'
     and p.release_requested_at is null
     and (target_order is null or o.id = target_order)
     -- A refusal is for staff (refund it in Stripe; charge.refunded then
     -- records it). Retrying it daily would take it off their list each day.
     and p.refund_failed_at is null
     and (p.refund_claimed_at is null or p.refund_claimed_at < now() - interval '90 seconds')
   order by p.confirmed_at
$$;

-- ---------------------------------------------------------------------------
-- Claim one payment to refund. Returns {payment_id, order_id, intent, charge,
-- key} or {refused: why}:
--   not_refundable    not held, released by the brand, or the order is not
--                     cancelled (nothing to do)
--   claimed           another request is refunding it now
--   no_stripe_charge  held without a Stripe charge (a bank wire from the old
--                     site): recorded as failed here, for staff
-- ---------------------------------------------------------------------------
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
      update public.order_payments
         set refund_failed_at = now(),
             refund_failure = 'Held with no Stripe charge to refund (an old bank transfer): refund the brand by bank.'
       where id = p.id;
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

-- ---------------------------------------------------------------------------
-- Stripe refused the refund (or later said it failed). The money is still
-- held; staff see the reason on the board and refund it in Stripe.
-- ---------------------------------------------------------------------------
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
         refund_failed_at = now(),
         refund_failure = why
   where id = p.id
  returning * into p;

  insert into public.payment_events (payment_id, from_state, to_state, actor_kind, note)
  values (p.id, was, p.state, 'system', 'Refund to the brand failed: ' || why);
  return p;
end;
$$;

-- ---------------------------------------------------------------------------
-- record_payment_refunded (from 20261022000300), unchanged apart from:
--   * a payment already refunded on a cancelled order is left as it is (our
--     own refund is followed by Stripe's charge.refunded);
--   * on a cancelled order the charged figure, intent and charge are kept,
--     so the brand's row says what went back, and the factory is told.
-- ---------------------------------------------------------------------------
create or replace function public.record_payment_refunded(
  target_payment uuid,
  payment_intent text,
  reason text
)
returns public.order_payments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p public.order_payments;
  o public.production_orders;
  m public.order_milestones;
  was public.payment_state;
  next_state public.payment_state;
  why text := coalesce(nullif(btrim(coalesce(reason, '')), ''), 'The payment was refunded.');
  -- Staff open the intent in Stripe from this.
  ref text := format(' (Stripe %s)', payment_intent);
  keep boolean;
begin
  -- Without one, a payment with no intent at all (a bank wire) would match.
  if nullif(btrim(coalesce(payment_intent, '')), '') is null then
    raise exception 'a refund names the PaymentIntent it refunded' using errcode = '22023';
  end if;

  select * into o from public.production_orders
   where id = (select order_id from public.order_payments where id = target_payment)
   for update;
  select * into p from public.order_payments where id = target_payment for update;
  if not found then
    return null;
  end if;
  was := p.state;

  -- Already recorded: the webhook after our own refund, or the page's sync.
  if was = 'cancelled' and p.refunded_at is not null and p.stripe_payment_intent_id = payment_intent then
    return p;
  end if;

  if p.stripe_payment_intent_id is distinct from payment_intent then
    if not exists (
      select 1 from public.payment_events
       where payment_id = p.id and note like '%' || ref
    ) then
      insert into public.payment_events (payment_id, from_state, to_state, actor_kind, note)
      values (p.id, was, was, 'system', 'A payment that was not this step''s own was refunded: ' || why || ref);
    end if;
    return p;
  end if;

  if was = 'released' then
    if not exists (
      select 1 from public.payment_events
       where payment_id = p.id and from_state = 'released' and to_state = 'released' and note like '%' || ref
    ) then
      update public.order_payments set refunded_at = now() where id = p.id returning * into p;
      insert into public.payment_events (payment_id, from_state, to_state, actor_kind, note)
      values (p.id, was, was, 'system',
              'Refunded to the brand after it was paid out to the factory: recover it by hand.' || ref);
    end if;
    return p;
  end if;

  next_state := case
    when o.status = 'cancelled' then 'cancelled'::public.payment_state
    when was = 'not_due' then 'not_due'::public.payment_state
    else 'failed'::public.payment_state
  end;
  -- The order is over: nobody pays again, so the record of what went back
  -- stays on the payment.
  keep := next_state = 'cancelled';

  update public.order_payments
     set state = next_state,
         failed_at = case when next_state = 'failed' then now() else failed_at end,
         failure_reason = case when next_state = 'failed' then why else failure_reason end,
         stripe_payment_intent_id = case when keep then stripe_payment_intent_id end,
         stripe_charge_id = case when keep then stripe_charge_id end,
         charged_cents = case when keep then coalesce(charged_cents, amount_received_cents) end,
         amount_received_cents = case when keep then amount_received_cents end,
         confirmed_at = case when keep then confirmed_at end,
         confirmed_by = case when keep then confirmed_by end,
         release_claimed_at = null,
         refund_claimed_at = null,
         refund_failed_at = null,
         refund_failure = null,
         refunded_at = now()
   where id = p.id
  returning * into p;

  insert into public.payment_events (payment_id, from_state, to_state, actor_kind, note)
  values (p.id, was, next_state, 'system', why || ref);

  select * into m from public.order_milestones where id = p.milestone_id;

  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  values (
    o.brand_org_id, 'payment_refunded', 'payment', p.id, o.id,
    format('Your payment for "%s" was refunded', m.title),
    case next_state
      when 'failed' then format('%s Pay again from the step''s payment page on %s.', why, o.order_number)
      when 'cancelled' then format('%s was cancelled. You were refunded.', o.order_number)
      else format('%s You will be asked to pay when the step opens on %s.', why, o.order_number)
    end
  );

  if was in ('confirmed', 'processing') and next_state = 'failed' then
    insert into public.notifications
      (org_id, kind, subject_type, subject_id, order_id, title, body)
    values (
      o.factory_org_id, 'payment_refunded', 'payment', p.id, o.id,
      format('The payment for "%s" was refunded', m.title),
      format('TSC no longer holds money for this step on %s. The brand has been asked to pay again; we will tell you when it is held.',
             o.order_number)
    );
  elsif was = 'confirmed' and next_state = 'cancelled' then
    -- The factory was told this money was held for it.
    insert into public.notifications
      (org_id, kind, subject_type, subject_id, order_id, title, body)
    values (
      o.factory_org_id, 'payment_refunded', 'payment', p.id, o.id,
      format('The payment for "%s" went back to the brand', m.title),
      format('%s was cancelled.', o.order_number)
    );
  end if;

  return p;
end;
$$;

revoke all on function public.cancellation_refunds_due(uuid)                  from public, anon, authenticated;
revoke all on function public.claim_cancellation_refund(uuid)                 from public, anon, authenticated;
revoke all on function public.record_cancellation_refund_failed(uuid, text)   from public, anon, authenticated;
revoke all on function public.record_payment_refunded(uuid, text, text)       from public, anon, authenticated;
grant execute on function public.cancellation_refunds_due(uuid)                to service_role;
grant execute on function public.claim_cancellation_refund(uuid)               to service_role;
grant execute on function public.record_cancellation_refund_failed(uuid, text) to service_role;
grant execute on function public.record_payment_refunded(uuid, text, text)     to service_role;
