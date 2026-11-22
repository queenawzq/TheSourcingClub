-- One balance, fix round 32: the same money rules on every road.
--
-- 1. Old per-step staff payouts (claim_provider_payout: Wise / PayPal "Pay
--    again"; release_payment_to_factory: "Mark paid out by bank") follow the
--    withdrawal rules: nothing is paid while the factory owes TSC more than its
--    other earnings, while the brand's charge is disputed or still clearing,
--    or on a step part of which went back to the brand (the factory withdraws
--    the rest from its balance). What is sent is the factory's money for the
--    step (payment_factory_base_cents, before a payout fee), never more.
--    A payout already under way is still finished (resumed), as before.
-- 2. A payment sent back to pay (a full refund, or a dispute lost, before
--    approval) is reset by one function, reset_refunded_payment(), which also
--    clears disputed_at: the old charge's dispute is not the new one's.
-- 3. Why a payment went back is kept as a code (payment_events.cause), never
--    read back from the note: 'stripe_refund' for a refund made in Stripe,
--    TSC's own refund reason (amount_changed, cancelled_order, ...) otherwise,
--    'dispute_lost' for a lost dispute. record_full_refund_failed and the
--    once-only check for a lost dispute read the code; notes are display text.
--    Existing rows are given their code once, below. record_payment_refund_amount
--    (a full refund before approval) passes 'stripe_refund'.
--
-- Full latest bodies plus the change; grants exact; no overloads.

alter table public.payment_events add column if not exists cause text;
comment on column public.payment_events.cause is
  'Why the money moved, as a code (never read from note): stripe_refund, dispute_lost, or TSC''s own refund reason.';

-- Once, for rows written before the code existed.
update public.payment_events set cause = 'stripe_refund'
 where cause is null and note ~ '^The payment was refunded\. \(Stripe [^)]*\)$';
update public.payment_events set cause = 'dispute_lost'
 where cause is null and note like 'Dispute lost%';

create or replace function public.reset_refunded_payment(target_payment uuid, next_state public.payment_state, why text,
                                                         lost bigint default null, lost_fee bigint default null)
returns public.order_payments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p public.order_payments;
  -- The order is over: nobody pays again, so the record of what went back
  -- stays on the payment.
  keep boolean := next_state = 'cancelled';
begin
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
         -- Paid again from nothing: the next charge's refunds and losses start at zero.
         refunded_cents = case when keep then refunded_cents else 0 end,
         refund_amount_at = case when keep then refund_amount_at end,
         dispute_lost_cents = case when not keep then 0 when lost is not null then lost else dispute_lost_cents end,
         dispute_lost_at = case when not keep then null when lost is not null then now() else dispute_lost_at end,
         dispute_fee_cents = case when not keep then null when lost is not null then lost_fee else dispute_fee_cents end,
         -- and its dispute: a hold on the old charge is not the new one's.
         disputed_at = null,
         release_claimed_at = null,
         refund_claimed_at = null,
         refund_failed_at = null,
         refund_failure = null,
         refunded_at = now()
   where id = target_payment
  returning * into p;
  return p;
end;
$$;
revoke all on function public.reset_refunded_payment(uuid, public.payment_state, text, bigint, bigint) from public, anon, authenticated;

drop function public.record_payment_refunded(uuid, text, text);
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
       where payment_id = p.id and note like '%' || ref
    ) then
      insert into public.payment_events (payment_id, from_state, to_state, actor_kind, note)
      values (p.id, was, was, 'system', 'A payment that was not this step''s own was refunded: ' || why || ref);
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
  p := public.reset_refunded_payment(p.id, next_state, why);

  -- Why, as a code: 'stripe_refund' for a refund made in Stripe (which
  -- record_full_refund_failed may fund again if it fails), else TSC's own
  -- reason. Never read back from the note.
  insert into public.payment_events (payment_id, from_state, to_state, actor_kind, note, cause)
  values (p.id, was, next_state, 'system', why || ref, record_payment_refunded.cause);

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
$function$

;
revoke all on function public.record_payment_refunded(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.record_payment_refunded(uuid, text, text, text) to service_role;

CREATE OR REPLACE FUNCTION public.record_payment_dispute_lost(target_payment uuid, dispute_id text, lost_cents bigint, fee_cents bigint)
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
  charged bigint;
  lost bigint;
  was_share bigint;
  was_debt bigint;
  now_debt bigint;
  ref text := format(' (Stripe %s)', dispute_id);
  why constant text := 'Your bank reversed this payment.';
begin
  if nullif(btrim(coalesce(dispute_id, '')), '') is null then
    raise exception 'a lost dispute names its dispute' using errcode = '22023';
  end if;
  if (lost_cents is not null and lost_cents < 0) or (fee_cents is not null and fee_cents < 0) then
    raise exception 'a lost dispute''s amounts are zero or more' using errcode = '22023';
  end if;

  select * into o from public.production_orders
   where id = (select order_id from public.order_payments where id = target_payment)
   for update;
  if not found then
    return null;
  end if;
  perform 1 from public.orgs where id = o.factory_org_id for no key update;
  select * into p from public.order_payments where id = target_payment for update;
  was := p.state;

  -- Once: recorded already (here, or before approval, where the payment
  -- went back to Due and keeps only this line).
  if p.dispute_lost_at is not null
     -- Only a recording counts: the line kept for staff while the payment
     -- was not funded yet (from = to) does not (20261121230000).
     or exists (select 1 from public.payment_events e where e.payment_id = p.id and e.cause = 'dispute_lost'
                  and e.note like '%' || ref and e.from_state is distinct from e.to_state) then
    return p;
  end if;
  charged := coalesce(p.charged_cents, p.amount_received_cents, p.amount_cents);
  lost := least(coalesce(lost_cents, charged, 0), greatest(coalesce(charged, 0) - p.refunded_cents, 0));
  select * into m from public.order_milestones where id = p.milestone_id;

  -- Before approval, all that was left of the charge lost: as a full refund,
  -- the brand pays again. Part of it lost: the step stays funded with the
  -- rest, as after a partial refund (below), so nothing is left in TSC's
  -- Stripe balance unrecorded (20261121230000).
  if was = 'confirmed' and p.release_requested_at is null and lost >= coalesce(charged, 0) - p.refunded_cents then
    next_state := case when o.status = 'cancelled' then 'cancelled'::public.payment_state else 'failed'::public.payment_state end;
    -- One reset with the refund's (20261121340000), keeping this loss on a
    -- cancelled order.
    p := public.reset_refunded_payment(p.id, next_state, why, lost, fee_cents);
    insert into public.payment_events (payment_id, from_state, to_state, actor_kind, note, cause)
    values (p.id, was, next_state, 'system',
            format('Dispute lost: %s went back to the brand. Stripe''s dispute fee %s is TSC''s.',
                   public.format_money(lost, p.currency), public.format_money(coalesce(fee_cents, 0), p.currency)) || ref, 'dispute_lost');
    insert into public.notifications (org_id, kind, subject_type, subject_id, order_id, title, body)
    values (o.brand_org_id, 'payment_refunded', 'payment', p.id, o.id,
            format('Your bank reversed your payment for "%s"', coalesce(m.title, o.order_number)),
            format('%s went back to your card.', public.format_money(lost, p.currency))
            || case when next_state = 'failed' then format(' Pay again from the step''s payment page on %s.', o.order_number) else '' end);
    insert into public.notifications (org_id, kind, subject_type, subject_id, order_id, title, body)
    values (o.factory_org_id, 'payment_refunded', 'payment', p.id, o.id,
            format('Payment for "%s" reversed', coalesce(m.title, o.order_number)),
            case when next_state = 'failed'
                 then format('TSC no longer holds money for this step on %s. The brand has been asked to pay again; we will tell you when it is held.',
                             o.order_number)
                 else format('%s was cancelled.', o.order_number) end);
    return p;
  end if;

  if was not in ('confirmed', 'released') then
    -- Not funded here (yet, or any more): the line is kept for staff.
    insert into public.payment_events (payment_id, from_state, to_state, actor_kind, note, cause)
    values (p.id, was, was, 'system',
            format('Dispute lost: %s went back to the brand. Stripe''s dispute fee %s is TSC''s.',
                   public.format_money(coalesce(lost, 0), p.currency), public.format_money(coalesce(fee_cents, 0), p.currency)) || ref, 'dispute_lost');
    return p;
  end if;

  -- After approval (or part of it before): the step stays as it is; its
  -- earning goes down by the factory's part, and what had already left is
  -- owed to TSC.
  was_share := p.factory_refund_cents;
  was_debt := coalesce(public.payment_debt_cents(p), 0);
  update public.order_payments
     set dispute_lost_cents = lost, dispute_lost_at = now(), dispute_fee_cents = fee_cents, disputed_at = null
   where id = p.id
  returning * into p;
  now_debt := coalesce(public.payment_debt_cents(p), 0);
  insert into public.payment_events (payment_id, from_state, to_state, actor_kind, note, cause)
  values (p.id, was, was, 'system',
          format('Dispute lost: %s went back to the brand. Stripe''s dispute fee %s is TSC''s.',
                 public.format_money(lost, p.currency), public.format_money(coalesce(fee_cents, 0), p.currency))
          || case when now_debt > was_debt
                  then format(' %s of it had already been withdrawn: TSC is owed it.', public.format_money(now_debt - was_debt, p.currency))
                  else '' end
          || ref, 'dispute_lost');
  insert into public.notifications (org_id, kind, subject_type, subject_id, order_id, title, body)
  values (o.brand_org_id, 'payment_refunded', 'payment', p.id, o.id,
          format('Your bank reversed your payment for "%s"', coalesce(m.title, o.order_number)),
          format('%s went back to your card.', public.format_money(lost, p.currency)));
  if p.factory_refund_cents > was_share then
    insert into public.notifications (org_id, kind, subject_type, subject_id, order_id, title, body)
    values (o.factory_org_id, 'payment_refunded', 'payment', p.id, o.id,
            format('Payment for "%s" reversed', coalesce(m.title, o.order_number)),
            format('The brand''s bank reversed the payment. Your earnings from %s went down by %s.', o.order_number,
                   public.format_money(p.factory_refund_cents - was_share, p.currency))
            || case when now_debt > was_debt
                    then format(' You''d already withdrawn %s of that, so you now owe TSC %s.',
                                public.format_money(now_debt - was_debt, p.currency), public.format_money(now_debt - was_debt, p.currency))
                    else '' end);
  end if;
  return p;
end;
$function$

;

CREATE OR REPLACE FUNCTION public.record_full_refund_failed(target_payment uuid, payment_intent text, charge text, charged bigint, refunded_now bigint, failed_cents bigint, lost_cents bigint, fee_cents bigint)
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
  why text;
  r public.payment_refund_failures;
  ref text := format(' (Stripe %s)', payment_intent);
begin
  if nullif(btrim(coalesce(payment_intent, '')), '') is null or charged is null or charged <= 0
     or failed_cents is null or failed_cents <= 0 then
    raise exception 'a failed refund names its PaymentIntent, its charge and its amount' using errcode = '22023';
  end if;
  select * into o from public.production_orders
   where id = (select order_id from public.order_payments where id = target_payment)
   for update;
  if not found then
    return null;
  end if;
  perform 1 from public.orgs where id = o.factory_org_id for no key update;
  select * into p from public.order_payments where id = target_payment for update;
  was := p.state;
  select * into m from public.order_milestones where id = p.milestone_id;

  if was = 'cancelled' and p.stripe_payment_intent_id = payment_intent and p.refunded_at is not null then
    why := 'cancelled';
  elsif not exists (select 1 from public.payment_events e where e.payment_id = p.id and e.note like '%' || ref) then
    -- Nothing recorded about this charge on this payment.
    return p;
  elsif not exists (select 1 from public.payment_events e where e.payment_id = p.id and e.from_state in ('confirmed', 'processing')
                      and e.to_state = 'failed' and e.cause = 'stripe_refund' and e.note like '%' || ref) then
    -- Not a payment sent back to pay by a refund made in Stripe: TSC's own
    -- refund of an extra payment (the amount changed, the step was paid
    -- another way, …). Its amount is not the step's, so it is never funded
    -- again with it: staff refund it again (20261121260000).
    why := 'stray';
  elsif p.stripe_payment_intent_id = payment_intent then
    -- Funded again with it already.
    return p;
  elsif was in ('due', 'failed') and o.status <> 'cancelled' then
    update public.order_payments
       set state = 'confirmed', confirmed_at = now(), confirmed_by = null,
           stripe_payment_intent_id = payment_intent, stripe_charge_id = charge,
           charged_cents = charged, amount_received_cents = charged,
           -- What Stripe still counts on this charge, recorded as it is, quietly:
           -- each was told when it happened.
           refunded_cents = least(greatest(coalesce(refunded_now, 0), 0), charged),
           refund_amount_at = case when coalesce(refunded_now, 0) > 0 then now() end,
           dispute_lost_cents = least(greatest(coalesce(lost_cents, 0), 0), charged),
           dispute_lost_at = case when coalesce(lost_cents, 0) > 0 then now() end,
           dispute_fee_cents = case when coalesce(lost_cents, 0) > 0 then fee_cents end,
           failure_reason = null, refunded_at = null
     where id = p.id
    returning * into p;
    insert into public.payment_events (payment_id, from_state, to_state, actor_kind, note)
    values (p.id, was, 'confirmed', 'system',
            format('A %s refund failed in Stripe: TSC holds the payment again.', public.format_money(failed_cents, p.currency)) || ref);
    insert into public.notifications (org_id, kind, subject_type, subject_id, order_id, title, body)
    values (o.brand_org_id, 'payment_refunded', 'payment', p.id, o.id,
            format('Refund for "%s" didn''t go through', coalesce(m.title, o.order_number)),
            format('Your %s refund didn''t go through, so TSC still holds your payment for this step. You don''t need to pay again.',
                   public.format_money(failed_cents, p.currency)));
    insert into public.notifications (org_id, kind, subject_type, subject_id, order_id, title, body)
    values (o.factory_org_id, 'payment_confirmed', 'payment', p.id, o.id,
            format('Payment held for "%s"', coalesce(m.title, o.order_number)),
            format('TSC holds %s for this step on %s. You can start this work; it is added to your balance when the brand approves it.',
                   public.format_money(greatest(p.amount_cents - p.factory_refund_cents, 0), p.currency), o.order_number));
    return p;
  else
    why := case when o.status = 'cancelled' then 'cancelled' else 'paid_again' end;
  end if;

  -- For staff: open, or open again after a resolved one.
  select * into r from public.payment_refund_failures x where x.payment_intent = record_full_refund_failed.payment_intent for update;
  if found and r.resolved_at is null then
    return p;
  end if;
  if found then
    update public.payment_refund_failures
       set resolved_at = null, amount_cents = failed_cents, cause = why, failed_at = now(), charge_id = coalesce(charge, charge_id)
     where id = r.id;
  else
    insert into public.payment_refund_failures (payment_id, payment_intent, charge_id, amount_cents, currency, cause)
    values (p.id, payment_intent, charge, failed_cents, p.currency, why);
  end if;
  insert into public.payment_events (payment_id, from_state, to_state, actor_kind, note)
  values (p.id, was, was, 'system',
          format('A %s refund failed in Stripe: %s', public.format_money(failed_cents, p.currency),
                 case when why = 'cancelled' then 'refund the brand again.'
                      when why = 'stray' then 'an extra payment, refund it again.'
                      else 'the brand paid again, refund the first payment.' end) || ref);
  -- The brand was told it was refunded; on a cancelled order nothing else
  -- tells it otherwise.
  if why = 'cancelled' then
    insert into public.notifications (org_id, kind, subject_type, subject_id, order_id, title, body)
    values (o.brand_org_id, 'payment_refunded', 'payment', p.id, o.id,
            format('Refund for "%s" didn''t go through', coalesce(m.title, o.order_number)),
            format('Your %s refund didn''t go through. TSC will send it again.', public.format_money(failed_cents, p.currency)));
  end if;
  return p;
end;
$function$

;

CREATE OR REPLACE FUNCTION public.record_payment_refund_amount(target_payment uuid, payment_intent text, refunded_cents bigint)
 RETURNS order_payments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  p public.order_payments;
  o public.production_orders;
  m public.order_milestones;
  charged bigint;
  total bigint;
  was_total bigint;
  was_share bigint;
  was_debt bigint;
  now_debt bigint;
  ref text := format(' (Stripe %s)', payment_intent);
begin
  if nullif(btrim(coalesce(payment_intent, '')), '') is null then
    raise exception 'a refund names the PaymentIntent it refunded' using errcode = '22023';
  end if;
  if refunded_cents is null or refunded_cents < 0 then
    raise exception 'a refunded amount is zero or more' using errcode = '22023';
  end if;

  select * into o from public.production_orders
   where id = (select order_id from public.order_payments where id = target_payment)
   for update;
  if not found then
    return null;
  end if;
  perform 1 from public.orgs where id = o.factory_org_id for no key update;
  select * into p from public.order_payments where id = target_payment for update;

  if p.stripe_payment_intent_id is distinct from payment_intent then
    if not exists (select 1 from public.payment_events where payment_id = p.id and note like '%' || ref) then
      insert into public.payment_events (payment_id, from_state, to_state, actor_kind, note)
      values (p.id, p.state, p.state, 'system', 'A payment that was not this step''s own was refunded.' || ref);
    end if;
    return p;
  end if;

  -- Not funded here yet (processing, due): nothing is recorded. Once the
  -- payment is recorded as funded, the server records the refund at its
  -- amount and everyone is told (20261121230000). A full refund before
  -- that is the server's record_payment_refunded.
  if p.state not in ('confirmed', 'released') then
    return p;
  end if;
  charged := coalesce(p.charged_cents, p.amount_received_cents, p.amount_cents);
  if charged is null or charged <= 0 then
    return p;
  end if;
  total := least(refunded_cents, charged);

  -- Refunded in full before approval: as before, back to Due and the brand
  -- pays again (cancelled on a cancelled order). Part lost in a dispute and
  -- the rest refunded is all of it too (20261121240000).
  if total + p.dispute_lost_cents >= charged and p.state <> 'released'
     and not (p.state = 'confirmed' and p.release_requested_at is not null) then
    -- A refund made in Stripe (20261121340000: the code, not the words).
    return public.record_payment_refunded(p.id, payment_intent, 'The payment was refunded.', 'stripe_refund');
  end if;

  -- Never lower: a smaller total is an older copy of the charge (Stripe's
  -- events arrive in any order). Only a refund Stripe says failed lowers it
  -- (record_payment_refund_failed, 20261121230000).
  if total <= p.refunded_cents then
    return p;
  end if;
  was_total := p.refunded_cents;
  was_share := p.factory_refund_cents;
  was_debt := coalesce(public.payment_debt_cents(p), 0);

  update public.order_payments
     set refunded_cents = total, refund_amount_at = now()
   where id = p.id
  returning * into p;
  now_debt := coalesce(public.payment_debt_cents(p), 0);

  insert into public.payment_events (payment_id, from_state, to_state, actor_kind, note)
  values (p.id, p.state, p.state, 'system',
          case when total > was_total
               then format('Refunded %s to the brand in Stripe (%s in all).',
                           public.format_money(total - was_total, p.currency), public.format_money(total, p.currency))
               else format('A refund failed in Stripe: %s refunded in all.', public.format_money(total, p.currency)) end
          || case when now_debt > was_debt
                  then format(' %s of it had already been withdrawn: TSC is owed it.', public.format_money(now_debt - was_debt, p.currency))
                  else '' end
          || ref);

  -- Told only when more went back; not for a payment the brand has not paid yet.
  if total <= was_total or p.state not in ('confirmed', 'released') then
    return p;
  end if;
  select * into m from public.order_milestones where id = p.milestone_id;

  insert into public.notifications (org_id, kind, subject_type, subject_id, order_id, title, body)
  values (o.brand_org_id, 'payment_refunded', 'payment', p.id, o.id,
          format('Your payment for "%s" was refunded', coalesce(m.title, o.order_number)),
          format('%s was refunded to your card.', public.format_money(total - was_total, p.currency)));

  if p.factory_refund_cents > was_share then
    insert into public.notifications (org_id, kind, subject_type, subject_id, order_id, title, body)
    values (o.factory_org_id, 'payment_refunded', 'payment', p.id, o.id,
            format('Payment for "%s" refunded', coalesce(m.title, o.order_number)),
            -- What the brand got back (fee part included), then the factory's part (20261121240000).
            format('The brand was refunded %s. Your earnings from %s went down by %s.',
                   public.format_money(total - was_total, p.currency), o.order_number,
                   public.format_money(p.factory_refund_cents - was_share, p.currency))
            || case when now_debt > was_debt
                    then format(' You''d already withdrawn %s of that, so you now owe TSC %s.',
                                public.format_money(now_debt - was_debt, p.currency), public.format_money(now_debt - was_debt, p.currency))
                    else '' end);
  end if;
  return p;
end;
$function$;

create or replace function public.per_step_payout_check(p public.order_payments, factory uuid)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  -- Under the company lock its callers take, like claim_owed_steps().
  if public.factory_debt_uncovered_cents(factory) > 0 then
    raise exception 'the factory owes TSC %', public.format_money(public.factory_debt_cents(factory), 'USD')
      using errcode = '22023', hint = 'payout_owes_tsc', detail = public.format_money(public.factory_debt_cents(factory), 'USD');
  end if;
  if p.disputed_at is not null then
    raise exception 'the brand disputed this payment' using errcode = '22023', hint = 'payout_disputed';
  end if;
  -- Part of it went back to the brand: the factory withdraws the rest from
  -- its balance (a per-step payout pays the whole step).
  if p.factory_refund_cents > 0 then
    raise exception 'part of this payment went back to the brand' using errcode = '22023', hint = 'payout_refunded';
  end if;
  if not public.payment_cleared(p) then
    raise exception 'the brand''s payment has not cleared yet' using errcode = '22023', hint = 'payout_not_cleared';
  end if;
end;
$$;
revoke all on function public.per_step_payout_check(public.order_payments, uuid) from public, anon, authenticated;

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
    -- The rules every withdrawal follows (20261121340000).
    perform public.per_step_payout_check(p, o.factory_org_id);
    paid_to := case which
      when 'wise' then format('%s ending %s', account.bank_name, account.account_number_last4)
      else account.paypal_email
    end;
    insert into public.provider_payouts
      (payment_id, factory_org_id, account_id, provider, paid_to, amount_cents, currency, requested_by)
    -- The factory's money for the step, before the provider's fee.
    values (p.id, o.factory_org_id, account.id, which, paid_to, public.payment_factory_base_cents(p) + coalesce(p.payout_fee_cents, 0), p.currency, auth.uid())
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
    'amount_cents', live.amount_cents,
    'currency', p.currency,
    'order_number', o.order_number,
    'account_id', account.id,
    'paypal_email', account.paypal_email,
    'wise_recipient_id', account.wise_recipient_id
  );
end;
$function$

;

CREATE OR REPLACE FUNCTION public.release_payment_to_factory(target_payment uuid, note text DEFAULT NULL::text, paid_to_changed_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS order_payments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  p public.order_payments;
  o public.production_orders;
  account public.factory_payout_accounts;
  said text := nullif(btrim(coalesce(note, '')), '');
begin
  if not public.is_platform_admin() then
    raise exception 'releasing funds is limited to platform staff' using errcode = '42501';
  end if;

  -- The company first, the lock withdrawals and refunds take (20261121340000).
  perform 1 from public.orgs where id = (
    select po.factory_org_id from public.order_payments op join public.production_orders po on po.id = op.order_id where op.id = target_payment
  ) for no key update;
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

  -- The rules every withdrawal follows (20261121340000).
  perform public.per_step_payout_check(p, o.factory_org_id);

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
  if public.payment_factory_base_cents(p) <= public.bank_payout_fee_cents() then
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
    format('%s released to you', public.format_money(public.payment_factory_base_cents(p) + coalesce(p.payout_fee_cents, 0), p.currency)),
    format('Sent by bank transfer against %s.%s TSC''s note: %s', o.order_number, public.payout_fee_sentence(p), said)
  );

  return p;
end;
$function$

;
