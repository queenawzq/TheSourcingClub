-- Flow check (m3): the brand's refund notice says how much came back and for
-- which step. It said only "TSC-000463 was cancelled. You were refunded.",
-- while the order page says "$65.20 refunded to you." (report3-g R3g14).
-- The figure is the order page's: what the brand paid for the step, fees
-- included, less what already went back to it; with nothing left to give
-- back it keeps "You were refunded". Otherwise unchanged from
-- 20261121410000 (notify_once); the reason kept on the payment and its
-- event is the server's, as before.
CREATE OR REPLACE FUNCTION public.record_payment_refunded(target_payment uuid, payment_intent text, reason text, cause text DEFAULT NULL::text)
 RETURNS order_payments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  p public.order_payments;
  o public.production_orders;
  m public.order_milestones;
  was public.payment_state;
  next_state public.payment_state;
  why text := coalesce(nullif(btrim(coalesce(reason, '')), ''), 'The payment was refunded.');
  -- Staff open the intent in Stripe from this.
  ref text := format(' (Stripe %s)', payment_intent);
  -- What goes back to the brand, read before the reset clears the charge.
  back bigint;
  back_words text;
begin
  -- Without one, a payment with no intent at all (a bank wire) would match.
  if nullif(btrim(coalesce(payment_intent, '')), '') is null then
    raise exception 'a refund names the PaymentIntent it refunded' using errcode = '22023';
  end if;

  select * into o from public.production_orders
   where id = (select order_id from public.order_payments where id = target_payment)
   for update;
  -- The factory's balance, before the payment: the order withdrawals lock in.
  perform 1 from public.orgs where id = o.factory_org_id for no key update;
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
       where payment_id = p.id and stripe_ref = record_payment_refunded.payment_intent
    ) then
      insert into public.payment_events (payment_id, stripe_ref, from_state, to_state, actor_kind, note)
      values (p.id, record_payment_refunded.payment_intent, was, was, 'system', 'A payment that was not this step''s own was refunded: ' || why || ref);
    end if;
    return p;
  end if;

  -- After approval (paid out the old way, approved, or a funded payment-only
  -- step): the factory's already. The step stays done; the whole charge is
  -- recorded as refunded and only the factory's earning for it goes down.
  if was = 'released' or (was = 'confirmed' and p.release_requested_at is not null) then
    return public.record_payment_refund_amount(p.id, payment_intent, coalesce(p.charged_cents, p.amount_received_cents, p.amount_cents));
  end if;

  next_state := case
    when o.status = 'cancelled' then 'cancelled'::public.payment_state
    when was = 'not_due' then 'not_due'::public.payment_state
    else 'failed'::public.payment_state
  end;
  back := greatest(0, coalesce(p.charged_cents, p.amount_received_cents, p.amount_cents, 0) - coalesce(p.refunded_cents, 0));
  p := public.reset_refunded_payment(p.id, next_state, why);

  -- Why, as a code: 'stripe_refund' for a refund made in Stripe (which
  -- record_full_refund_failed may fund again if it fails), else TSC's own
  -- reason. Never read back from the note.
  insert into public.payment_events (payment_id, stripe_ref, from_state, to_state, actor_kind, note, cause)
  values (p.id, record_payment_refunded.payment_intent, was, next_state, 'system', why || ref, record_payment_refunded.cause);

  select * into m from public.order_milestones where id = p.milestone_id;
  -- '$86.82 for "Fit sample" was refunded to you', where it said 'You were refunded'.
  back_words := case when back > 0
    then format('%s for "%s" was refunded to you', public.format_money(back, p.currency), coalesce(m.title, o.order_number))
    else 'You were refunded' end;

  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  values (
    o.brand_org_id, 'payment_refunded', 'payment', p.id, o.id,
    format('Your payment for "%s" was refunded', m.title),
    case next_state
      when 'failed' then format('%s Pay again from the step''s payment page on %s.', replace(why, 'You were refunded', back_words), o.order_number)
      when 'cancelled' then format('%s was cancelled. %s.', o.order_number, back_words)
      else format('%s You will be asked to pay when the step opens on %s.', replace(why, 'You were refunded', back_words), o.order_number)
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
$function$;

revoke all on function public.record_payment_refunded(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.record_payment_refunded(uuid, text, text, text) to service_role;
