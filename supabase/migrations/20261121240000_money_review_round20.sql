-- One balance, fix round 20 (money re-review of rounds 18-19).
--
-- * Part of a charge lost in a dispute and the rest refunded, before
--   approval, is all of it: the brand pays again (record_payment_refund_amount),
--   and sending it back to pay clears the old charge's losses too
--   (record_payment_refunded).
-- * A refund lowered because it failed tells the brand, and the factory when
--   its earnings went back up (record_payment_refund_failed).
-- * The factory's refund notice says what the brand got back, then the
--   factory's part.
-- * A withdrawal on hold for a debt names the debt's own cause.
-- * A full refund before approval that later fails: the payment is funded
--   again when the brand has not paid again; otherwise staff refund the old
--   charge (payment_refund_failures, Needs checking).
--
-- Full latest bodies plus the change; grants re-applied exactly; no overloads.

-- A full refund before approval that Stripe later says failed, after the
-- brand had paid the step again: TSC holds two charges for one step. Staff
-- only (no grants); shown on Needs checking until the old charge is refunded.
create table public.payment_refund_failures (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.order_payments (id) on delete cascade,
  payment_intent text not null unique,
  charge_id text,
  amount_cents bigint not null check (amount_cents >= 0),
  currency char(3) not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
alter table public.payment_refund_failures enable row level security;
revoke all on table public.payment_refund_failures from public, anon, authenticated;

create or replace function public.record_payment_refund_amount(target_payment uuid, payment_intent text, refunded_cents bigint)
returns public.order_payments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
    return public.record_payment_refunded(p.id, payment_intent, 'The payment was refunded.');
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
                    then format(' You had already withdrawn %s of it.', public.format_money(now_debt - was_debt, p.currency))
                    else '' end);
  end if;
  return p;
end;
$$;
revoke all on function public.record_payment_refund_amount(uuid, text, bigint) from public, anon, authenticated;
grant execute on function public.record_payment_refund_amount(uuid, text, bigint) to service_role;

create or replace function public.record_payment_refunded(target_payment uuid, payment_intent text, reason text)
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
         -- Paid again from nothing: the next charge's refunds start at zero.
         refunded_cents = case when keep then refunded_cents else 0 end,
         refund_amount_at = case when keep then refund_amount_at end,
         -- and its losses: a dispute on the old charge is not the new one's (20261121240000)
         dispute_lost_cents = case when keep then dispute_lost_cents else 0 end,
         dispute_lost_at = case when keep then dispute_lost_at end,
         dispute_fee_cents = case when keep then dispute_fee_cents end,
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
revoke all on function public.record_payment_refunded(uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_payment_refunded(uuid, text, text) to service_role;

create or replace function public.record_payment_refund_failed(target_payment uuid, payment_intent text, refunded_cents bigint)
returns public.order_payments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p public.order_payments;
  o public.production_orders;
  m public.order_milestones;
  was_total bigint;
  was_share bigint;
  total bigint := $3;
  ref text := format(' (Stripe %s)', payment_intent);
begin
  if nullif(btrim(coalesce(payment_intent, '')), '') is null then
    raise exception 'a refund names the PaymentIntent it refunded' using errcode = '22023';
  end if;
  if total is null or total < 0 then
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
  if p.stripe_payment_intent_id is distinct from payment_intent or p.state not in ('confirmed', 'released')
     or total >= p.refunded_cents then
    return p;
  end if;
  was_total := p.refunded_cents;
  was_share := p.factory_refund_cents;
  update public.order_payments
     set refunded_cents = total, refund_amount_at = now()
   where id = p.id
  returning * into p;
  insert into public.payment_events (payment_id, from_state, to_state, actor_kind, note)
  values (p.id, p.state, p.state, 'system',
          format('A refund failed in Stripe: %s refunded in all.', public.format_money(total, p.currency)) || ref);
  -- Each side was told of the refund: told it did not go through (20261121240000).
  select * into m from public.order_milestones where id = p.milestone_id;
  insert into public.notifications (org_id, kind, subject_type, subject_id, order_id, title, body)
  values (o.brand_org_id, 'payment_refunded', 'payment', p.id, o.id,
          format('Refund for "%s" didn''t go through', coalesce(m.title, o.order_number)),
          format('The %s refund to your card failed, so the payment stays on this order.', public.format_money(was_total - total, p.currency)));
  if p.factory_refund_cents < was_share then
    insert into public.notifications (org_id, kind, subject_type, subject_id, order_id, title, body)
    values (o.factory_org_id, 'payment_refunded', 'payment', p.id, o.id,
            format('Refund for "%s" didn''t go through', coalesce(m.title, o.order_number)),
            format('The refund to the brand failed. Your earnings from %s went back up by %s.', o.order_number,
                   public.format_money(was_share - p.factory_refund_cents, p.currency)));
  end if;
  return p;
end;
$$;
revoke all on function public.record_payment_refund_failed(uuid, text, bigint) from public, anon, authenticated;
grant execute on function public.record_payment_refund_failed(uuid, text, bigint) to service_role;

CREATE OR REPLACE FUNCTION public.tell_withdrawal_refunded()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  w record;
  m public.order_milestones;
  o public.production_orders;
  lost boolean;
  owes boolean;
  debt_refund boolean;
  debt_lost boolean;
  pool_debt bigint;
begin
  if not ((old.state = 'confirmed' and new.state <> 'confirmed')
          or (new.state in ('confirmed', 'released') and new.factory_refund_cents > old.factory_refund_cents)) then
    return null;
  end if;
  lost := new.dispute_lost_cents > old.dispute_lost_cents or (new.dispute_lost_at is not null and old.dispute_lost_at is null);
  select * into m from public.order_milestones where id = new.milestone_id;
  select * into o from public.production_orders where id = new.order_id;
  -- The old pool's part of the debt (paid beyond what it now holds).
  pool_debt := public.factory_debt_cents(o.factory_org_id)
               - coalesce((select sum(public.payment_debt_cents(x)) from public.order_payments x
                             join public.production_orders xo on xo.id = x.order_id
                            where xo.factory_org_id = o.factory_org_id and not x.withdrawal_pool and x.currency = 'USD'
                              and x.state in ('confirmed', 'released') and x.factory_refund_cents > 0), 0);
  select coalesce(bool_or(x.refunded_cents > 0), false), coalesce(bool_or(x.dispute_lost_cents > 0), false)
    into debt_refund, debt_lost
    from public.order_payments x
    join public.production_orders xo on xo.id = x.order_id
   where xo.factory_org_id = o.factory_org_id
     and x.currency = 'USD' and x.state in ('confirmed', 'released')
     and ((not x.withdrawal_pool and public.payment_debt_cents(x) > 0)
          or (x.withdrawal_pool and x.factory_refund_cents > 0 and pool_debt > 0));
  select * into o from public.production_orders where id = new.order_id;
  -- Each open withdrawal this leaves uncovered, told once: one holding part
  -- of this step, one whose old-pool money the pool no longer holds, and any
  -- waiting one while the factory owes TSC more than its other earnings
  -- (20261121210000).
  for w in select f.*, public.withdrawal_pool_refunded_cents(f) as pool_short_cents from public.factory_withdrawals f
            where f.status in ('requested', 'paying')
              and (exists (select 1 from public.payment_takes t
                            where t.factory_withdrawal_id = f.id and t.payment_id = new.id and t.status = 'held'
                              and (new.state <> 'confirmed' or public.take_refunded_cents(t) > 0))
                   or (f.org_id = o.factory_org_id and f.status = 'requested'
                       and (public.withdrawal_pool_refunded_cents(f) > 0 or public.factory_debt_uncovered_cents(o.factory_org_id) > 0)))
              and not exists (select 1 from public.notifications n
                               where n.org_id = f.org_id and n.kind = 'withdrawal' and n.subject_id = f.id and n.title like '% on hold')
  loop
    -- On hold only because of the debt (nothing it holds was refunded): it
    -- says what is owed, and never to withdraw again (20261121230000).
    owes := not exists (select 1 from public.payment_takes t
                         where t.factory_withdrawal_id = w.id and t.payment_id = new.id and t.status = 'held'
                           and (new.state <> 'confirmed' or public.take_refunded_cents(t) > 0))
            and w.pool_short_cents = 0;
    insert into public.notifications (org_id, kind, subject_type, subject_id, title, body, data)
    values (w.org_id, 'withdrawal', 'withdrawal', w.id,
            format('Withdrawal of %s on hold', public.format_money(w.amount_cents, w.currency)),
            -- The debt's own cause, from the payments that carry it (and the
            -- old pool's, when the pool was paid beyond what it holds): a
            -- refund, a lost dispute, or both (20261121240000).
            case when owes and not debt_refund
                 then format('You owe TSC %s. The brand''s bank reversed a payment after you withdrew it.',
                             public.format_money(public.factory_debt_cents(w.org_id), 'USD'))
                 when owes and not debt_lost
                 then format('You owe TSC %s. A payment was refunded after you withdrew it.',
                             public.format_money(public.factory_debt_cents(w.org_id), 'USD'))
                 when owes
                 then format('You owe TSC %s. Money went back to the brand after you withdrew it.',
                             public.format_money(public.factory_debt_cents(w.org_id), 'USD'))
                 when lost
                 then format('The brand''s bank reversed the payment for "%s". Cancel this withdrawal and withdraw again.',
                             coalesce(m.title, o.order_number))
                 else format('The brand''s payment for "%s" was refunded. Cancel this withdrawal and withdraw again.',
                             coalesce(m.title, o.order_number)) end,
            jsonb_build_object('amount_cents', w.amount_cents, 'currency', w.currency));
  end loop;
  return null;
end;
$function$;
revoke all on function public.tell_withdrawal_refunded() from public, anon, authenticated;
grant execute on function public.tell_withdrawal_refunded() to service_role;

-- A full refund before approval (the brand was sent back to pay) that
-- Stripe later says failed: TSC still holds that charge. Not paid again yet:
-- the payment is funded again with it, and both sides are told. Paid again
-- already: staff refund the old charge (Needs checking). Only for the charge
-- this payment was sent back to pay for.
create or replace function public.record_full_refund_failed(target_payment uuid, payment_intent text, charge text, charged bigint)
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
  ref text := format(' (Stripe %s)', payment_intent);
begin
  if nullif(btrim(coalesce(payment_intent, '')), '') is null or charged is null or charged <= 0 then
    raise exception 'a failed refund names its PaymentIntent and charge' using errcode = '22023';
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
  -- Sent back to pay for this charge (record_payment_refunded, before approval).
  if not exists (select 1 from public.payment_events e where e.payment_id = p.id and e.from_state = 'confirmed'
                   and e.to_state = 'failed' and e.note like '%' || ref) then
    return p;
  end if;
  -- Handled already.
  if p.stripe_payment_intent_id = payment_intent
     or exists (select 1 from public.payment_refund_failures r where r.payment_intent = record_full_refund_failed.payment_intent) then
    return p;
  end if;
  select * into m from public.order_milestones where id = p.milestone_id;

  if was in ('due', 'failed') and o.status <> 'cancelled' then
    update public.order_payments
       set state = 'confirmed', confirmed_at = now(), confirmed_by = null,
           stripe_payment_intent_id = payment_intent, stripe_charge_id = charge,
           charged_cents = charged, amount_received_cents = charged,
           failure_reason = null, refunded_at = null
     where id = p.id
    returning * into p;
    insert into public.payment_events (payment_id, from_state, to_state, actor_kind, note)
    values (p.id, was, 'confirmed', 'system', 'The refund failed in Stripe: TSC holds the payment again.' || ref);
    insert into public.notifications (org_id, kind, subject_type, subject_id, order_id, title, body)
    values (o.brand_org_id, 'payment_refunded', 'payment', p.id, o.id,
            format('Refund for "%s" didn''t go through', coalesce(m.title, o.order_number)),
            format('The %s refund to your card failed, so TSC still holds your payment for this step. You don''t need to pay again.',
                   public.format_money(charged, p.currency)));
    insert into public.notifications (org_id, kind, subject_type, subject_id, order_id, title, body)
    values (o.factory_org_id, 'payment_confirmed', 'payment', p.id, o.id,
            format('Payment held for "%s"', coalesce(m.title, o.order_number)),
            format('TSC holds %s for this step on %s. You can start this work; it is added to your balance when the brand approves it.',
                   public.format_money(p.amount_cents, p.currency), o.order_number));
    return p;
  end if;

  insert into public.payment_refund_failures (payment_id, payment_intent, charge_id, amount_cents, currency)
  values (p.id, payment_intent, charge, charged, p.currency);
  insert into public.payment_events (payment_id, from_state, to_state, actor_kind, note)
  values (p.id, was, was, 'system', 'The refund failed in Stripe after the brand paid again: refund the old charge.' || ref);
  return p;
end;
$$;
revoke all on function public.record_full_refund_failed(uuid, text, text, bigint) from public, anon, authenticated;
grant execute on function public.record_full_refund_failed(uuid, text, text, bigint) to service_role;

-- Staff refunded the old charge in Stripe: the Needs checking row goes.
create or replace function public.record_refund_failure_resolved(payment_intent text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.payment_refund_failures r set resolved_at = now()
   where r.payment_intent = record_refund_failure_resolved.payment_intent and r.resolved_at is null;
$$;
revoke all on function public.record_refund_failure_resolved(text) from public, anon, authenticated;
grant execute on function public.record_refund_failure_resolved(text) to service_role;

CREATE OR REPLACE FUNCTION public.admin_balance_attention()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not public.is_platform_admin() then
    raise exception 'limited to platform staff' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'disputed', coalesce((
      select jsonb_agg(jsonb_build_object(
        'payment_id', p.id, 'order_id', o.id, 'order_number', o.order_number, 'factory_name', f.name,
        'brand_name', b.name, 'milestone_title', m.title, 'amount_cents', public.payment_factory_cents(p),
        'currency', p.currency, 'disputed_at', p.disputed_at, 'stripe_charge_id', p.stripe_charge_id,
        'stripe_payment_intent_id', p.stripe_payment_intent_id,
        -- What of it a withdrawal had already taken and is sending or has
        -- paid (a PayPal / Wise payout under way or paid, a Stripe transfer):
        -- that part has left the factory's balance.
        'in_withdrawal_cents', coalesce((
          select sum(t.amount_cents) from public.payment_takes t
            left join public.factory_withdrawals w on w.id = t.factory_withdrawal_id
           where t.payment_id = p.id
             and (t.status = 'sent' or (t.status = 'held' and (t.road = 'stripe' or w.status in ('paying', 'paid'))))), 0)
        ) order by p.disputed_at)
        from public.order_payments p
        join public.production_orders o on o.id = p.order_id
        join public.orgs f on f.id = o.factory_org_id
        join public.orgs b on b.id = o.brand_org_id
        left join public.order_milestones m on m.id = p.milestone_id
       where p.state = 'confirmed' and p.release_requested_at is not null and p.disputed_at is not null
         and not p.withdrawal_pool), '[]'::jsonb),
    -- Refunded to the brand (or a dispute lost) after the factory had
    -- withdrawn it: TSC paid that money twice. Staff cannot be notified, so
    -- this list is the only prompt. Where it went, and what the factory's
    -- balance is now (Available, net of what it owes).
    'recover', coalesce((
      select jsonb_agg(x.row order by x.at nulls last) from (
        select greatest(p.refund_amount_at, p.dispute_lost_at) as at, jsonb_build_object(
          'payment_id', p.id, 'org_id', o.factory_org_id, 'order_id', o.id, 'order_number', o.order_number,
          'factory_name', f.name, 'brand_name', b.name, 'milestone_title', m.title,
          'amount_cents', public.payment_debt_cents(p), 'currency', p.currency,
          'cause', case when p.dispute_lost_cents > 0 and p.refund_amount_at is null then 'dispute_lost'
                        when p.dispute_lost_cents > 0 and p.dispute_lost_at > p.refund_amount_at then 'dispute_lost'
                        else 'refund' end,
          'at', greatest(p.refund_amount_at, p.dispute_lost_at),
          'withdrawn_cents', case when exists (select 1 from public.payment_takes t where t.payment_id = p.id and t.status = 'sent')
                                  then (select sum(t.amount_cents) from public.payment_takes t where t.payment_id = p.id and t.status = 'sent')
                                  else public.payment_factory_base_cents(p) end,
          'withdrawn_by', coalesce((
            select jsonb_agg(distinct case when t.road = 'stripe' then 'stripe' else coalesce(w.provider, 'bank') end)
              from public.payment_takes t
              left join public.factory_withdrawals w on w.id = t.factory_withdrawal_id
             where t.payment_id = p.id and t.status = 'sent'),
            jsonb_build_array(case when p.stripe_transfer_id is not null then 'stripe'
                                   -- an old per-step PayPal / Wise payout (20261121230000)
                                   else coalesce((select pp.provider from public.provider_payouts pp
                                                   where pp.payment_id = p.id and pp.status = 'paid'
                                                   order by pp.paid_at desc limit 1), 'bank') end)),
          'dispute_fee_cents', p.dispute_fee_cents,
          'balance_cents', (public.factory_balance(o.factory_org_id) ->> 'available_cents')::bigint,
          'stripe_payment_intent_id', p.stripe_payment_intent_id) as row
          from public.order_payments p
          join public.production_orders o on o.id = p.order_id
          join public.orgs f on f.id = o.factory_org_id
          join public.orgs b on b.id = o.brand_org_id
          left join public.order_milestones m on m.id = p.milestone_id
         where p.state in ('confirmed', 'released') and not p.withdrawal_pool and p.currency = 'USD'
           and p.factory_refund_cents > 0 and public.payment_debt_cents(p) > 0
        union all
        -- The old pool paid out beyond what its refunded payments now hold.
        select null, jsonb_build_object(
          'payment_id', null, 'org_id', f.id, 'order_id', null, 'order_number', null,
          'factory_name', f.name, 'brand_name', null, 'milestone_title', null,
          'amount_cents', d.pool_debt, 'currency', 'USD', 'cause', 'refund', 'at', null,
          'withdrawn_cents', null, 'withdrawn_by', '[]'::jsonb, 'dispute_fee_cents', null,
          'balance_cents', (public.factory_balance(f.id) ->> 'available_cents')::bigint,
          'stripe_payment_intent_id', null)
          from public.orgs f
          cross join lateral (select public.factory_debt_cents(f.id)
                                     - coalesce((select sum(public.payment_debt_cents(p)) from public.order_payments p
                                                   join public.production_orders o on o.id = p.order_id
                                                  where o.factory_org_id = f.id and not p.withdrawal_pool and p.currency = 'USD'
                                                    and p.state in ('confirmed', 'released') and p.factory_refund_cents > 0), 0) as pool_debt) d
         where f.type = 'factory' and exists (select 1 from public.factory_withdrawals w where w.org_id = f.id and w.status = 'paid')
           and d.pool_debt > 0
      ) x), '[]'::jsonb),
    -- A full refund before approval that failed in Stripe after the brand
    -- had paid again: TSC holds two charges for one step. Staff refund the
    -- old one in Stripe (20261121240000).
    'refund_failed', coalesce((
      select jsonb_agg(jsonb_build_object(
        'payment_id', p.id, 'order_id', o.id, 'order_number', o.order_number, 'factory_name', f.name,
        'brand_name', b.name, 'milestone_title', m.title, 'amount_cents', r.amount_cents, 'currency', r.currency,
        'stripe_payment_intent_id', r.payment_intent, 'at', r.created_at) order by r.created_at)
        from public.payment_refund_failures r
        join public.order_payments p on p.id = r.payment_id
        join public.production_orders o on o.id = p.order_id
        join public.orgs f on f.id = o.factory_org_id
        join public.orgs b on b.id = o.brand_org_id
        left join public.order_milestones m on m.id = p.milestone_id
       where r.resolved_at is null), '[]'::jsonb),
    'stuck', coalesce((
      select jsonb_agg(jsonb_build_object(
        'withdrawal_id', s.id, 'org_id', s.org_id, 'factory_name', f.name, 'state', s.state,
        'usd_cents', s.usd_cents, 'owed_cents', s.owed_cents, 'stripe_account_id', s.stripe_account_id,
        'refusal_cause', s.refusal_cause, 'created_at', s.created_at, 'updated_at', s.updated_at,
        'held_cents', (select coalesce(sum(t.amount_cents), 0) from public.payment_takes t
                        where t.stripe_withdrawal_id = s.id and t.status = 'held'),
        -- Who asked: each attempt is one person's, so two rows for one
        -- balance read as two attempts, not twice the money.
        'requested_by_name', coalesce(nullif(btrim(u.full_name), ''), u.email)) order by s.created_at)
        from public.stripe_withdrawals s
        join public.orgs f on f.id = s.org_id
        left join public.user_profiles u on u.id = s.requested_by
       where s.usd_cents is not null
         and (
           -- Stopped half-way: nobody holds it and nothing has moved for 15 minutes.
           (s.state in ('claimed', 'fee_taken') and s.updated_at < now() - interval '15 minutes'
            and (s.lease_until is null or s.lease_until < now()))
           -- Parts still held by a withdrawal that ended or stalled.
           or exists (select 1 from public.payment_takes t where t.stripe_withdrawal_id = s.id and t.status = 'held'
                       and t.updated_at < now() - interval '15 minutes')
           -- TSC's Stripe balance was short, and the factory has not withdrawn since.
           -- Money sent to its Stripe account that could not be taken back after
           -- the payout was refused.
           or (s.refusal_cause = 'reversal_failed' and exists (select 1 from public.payment_takes t
                where t.stripe_withdrawal_id = s.id and t.status = 'sent'))
           or (s.state = 'refused' and s.refusal_cause = 'platform_short' and s.created_at > now() - interval '7 days'
               and not exists (select 1 from public.stripe_withdrawals later where later.org_id = s.org_id
                                 and later.state = 'paid_out' and later.created_at > s.created_at)))), '[]'::jsonb)
  );
end;
$function$;
revoke all on function public.admin_balance_attention() from public, anon;
grant execute on function public.admin_balance_attention() to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_overview_metrics()
 RETURNS TABLE(profiles_awaiting_review integer, rfqs_submitted_today integer, quotes_submitted_today integer, payments_awaiting_confirmation integer, profiles_submitted_today integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare attention jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'these metrics are limited to platform staff' using errcode = '42501';
  end if;
  attention := public.admin_balance_attention();

  return query
  select
    (select count(*)::integer from public.admin_verification_queue() q
      where q.state in ('ready_for_review', 'in_review', 'needs_information')),
    (select count(*)::integer from public.rfqs r
      where r.published_at >= date_trunc('day', now())),
    (select count(*)::integer from public.quotes q
      where q.submitted_at >= date_trunc('day', now())),
    (select count(*)::integer from public.order_payments p
      join public.production_orders o on o.id = p.order_id
      where (p.state = 'confirmed' and p.release_requested_at is not null and not p.withdrawal_pool
             and not exists (select 1 from public.payment_takes t where t.payment_id = p.id and t.status in ('held', 'sent'))
             and (p.stripe_release_started
                  or (select x.status from public.provider_payouts x where x.payment_id = p.id
                       order by x.created_at desc limit 1) in ('processing', 'failed')))
         or (p.state in ('confirmed', 'processing') and o.status = 'cancelled'
             and p.refund_failed_at is not null))
     + (select count(*)::integer from public.factory_withdrawals w where w.status in ('requested', 'paying'))
     + jsonb_array_length(attention -> 'disputed') + jsonb_array_length(attention -> 'stuck')
     + jsonb_array_length(attention -> 'recover')
     + jsonb_array_length(attention -> 'refund_failed'),
    (select count(*)::integer from public.admin_verification_queue() q
      where q.submitted_at >= date_trunc('day', now()));
end;
$function$;
revoke all on function public.admin_overview_metrics() from public, anon;
grant execute on function public.admin_overview_metrics() to authenticated, service_role;
