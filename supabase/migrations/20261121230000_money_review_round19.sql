-- One balance, fix round 19 (money review of rounds 14-17b).
--
-- * A refund is never lowered by an older copy of its charge: a smaller
--   total is ignored; only a refund Stripe says failed lowers it
--   (record_payment_refund_failed, after the server reads both again).
-- * Nothing is recorded for a refund before the payment is funded here; the
--   server records it at its amount once funded, and everyone is told.
-- * Stripe withdrawals of owed steps are refused in the database, under the
--   company lock, while the factory owes TSC (claim_owed_steps).
-- * A withdrawal on hold only because of a debt says what is owed, and
--   never to withdraw again; staff read the whole debt.
-- * Staff's record of a bank transfer that already went is never refused
--   for the balance; what is no longer the factory's becomes a debt.
-- * A withdrawal's own old-pool part decides whether it is covered, not
--   the pool as a whole.
-- * A dispute lost before the payment was recorded as funded is recorded
--   once it is; part of a charge lost before approval keeps the step funded
--   with the rest.
-- * Staff's To recover row names where an old per-step payout went.
--
-- Full latest bodies plus the change; grants re-applied exactly; one new
-- function (service role only); no overloads.

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
  -- pays again (cancelled on a cancelled order).
  if total >= charged and p.state <> 'released'
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
            format('The brand was refunded %s. Your earnings from %s went down by %s.',
                   public.format_money(p.factory_refund_cents - was_share, p.currency), o.order_number,
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

-- A refund that failed after Stripe accepted it: the server read the refund
-- and the charge again from Stripe, and the charge's total (lower) is
-- recorded. Only ever lowers; a larger total is record_payment_refund_amount's.
create or replace function public.record_payment_refund_failed(target_payment uuid, payment_intent text, refunded_cents bigint)
returns public.order_payments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p public.order_payments;
  o public.production_orders;
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
  update public.order_payments
     set refunded_cents = total, refund_amount_at = now()
   where id = p.id
  returning * into p;
  insert into public.payment_events (payment_id, from_state, to_state, actor_kind, note)
  values (p.id, p.state, p.state, 'system',
          format('A refund failed in Stripe: %s refunded in all.', public.format_money(total, p.currency)) || ref);
  return p;
end;
$$;
revoke all on function public.record_payment_refund_failed(uuid, text, bigint) from public, anon, authenticated;
grant execute on function public.record_payment_refund_failed(uuid, text, bigint) to service_role;

create or replace function public.record_payment_dispute_lost(target_payment uuid, dispute_id text, lost_cents bigint, fee_cents bigint)
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
  keep boolean;
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
     or exists (select 1 from public.payment_events e where e.payment_id = p.id and e.note like 'Dispute lost%' || ref
                  and e.from_state is distinct from e.to_state) then
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
           refunded_cents = case when keep then refunded_cents else 0 end,
           refund_amount_at = case when keep then refund_amount_at end,
           dispute_lost_cents = case when keep then lost else 0 end,
           dispute_lost_at = case when keep then now() end,
           dispute_fee_cents = case when keep then fee_cents end,
           disputed_at = null,
           release_claimed_at = null,
           refund_claimed_at = null,
           refund_failed_at = null,
           refund_failure = null,
           refunded_at = now()
     where id = p.id
    returning * into p;
    insert into public.payment_events (payment_id, from_state, to_state, actor_kind, note)
    values (p.id, was, next_state, 'system',
            format('Dispute lost: %s went back to the brand. Stripe''s dispute fee %s is TSC''s.',
                   public.format_money(lost, p.currency), public.format_money(coalesce(fee_cents, 0), p.currency)) || ref);
    insert into public.notifications (org_id, kind, subject_type, subject_id, order_id, title, body)
    values (o.brand_org_id, 'payment_refunded', 'payment', p.id, o.id,
            format('Your bank reversed your payment for "%s"', coalesce(m.title, o.order_number)),
            format('%s went back to your card.', public.format_money(lost, p.currency))
            || case when next_state = 'failed' then format(' Pay again from the step''s payment page on %s.', o.order_number) else '' end);
    insert into public.notifications (org_id, kind, subject_type, subject_id, order_id, title, body)
    values (o.factory_org_id, 'payment_refunded', 'payment', p.id, o.id,
            format('Dispute lost on "%s"', coalesce(m.title, o.order_number)),
            case when next_state = 'failed'
                 then format('TSC no longer holds money for this step on %s. The brand has been asked to pay again; we will tell you when it is held.',
                             o.order_number)
                 else format('%s was cancelled.', o.order_number) end);
    return p;
  end if;

  if was not in ('confirmed', 'released') then
    -- Not funded here (yet, or any more): the line is kept for staff.
    insert into public.payment_events (payment_id, from_state, to_state, actor_kind, note)
    values (p.id, was, was, 'system',
            format('Dispute lost: %s went back to the brand. Stripe''s dispute fee %s is TSC''s.',
                   public.format_money(coalesce(lost, 0), p.currency), public.format_money(coalesce(fee_cents, 0), p.currency)) || ref);
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
  insert into public.payment_events (payment_id, from_state, to_state, actor_kind, note)
  values (p.id, was, was, 'system',
          format('Dispute lost: %s went back to the brand. Stripe''s dispute fee %s is TSC''s.',
                 public.format_money(lost, p.currency), public.format_money(coalesce(fee_cents, 0), p.currency))
          || case when now_debt > was_debt
                  then format(' %s of it had already been withdrawn: TSC is owed it.', public.format_money(now_debt - was_debt, p.currency))
                  else '' end
          || ref);
  insert into public.notifications (org_id, kind, subject_type, subject_id, order_id, title, body)
  values (o.brand_org_id, 'payment_refunded', 'payment', p.id, o.id,
          format('Your bank reversed your payment for "%s"', coalesce(m.title, o.order_number)),
          format('%s went back to your card.', public.format_money(lost, p.currency)));
  if p.factory_refund_cents > was_share then
    insert into public.notifications (org_id, kind, subject_type, subject_id, order_id, title, body)
    values (o.factory_org_id, 'payment_refunded', 'payment', p.id, o.id,
            format('Dispute lost on "%s"', coalesce(m.title, o.order_number)),
            format('%s went back to the brand and is no longer in your earnings.', public.format_money(p.factory_refund_cents - was_share, p.currency))
            || case when now_debt > was_debt
                    then format(' You had already withdrawn %s of it.', public.format_money(now_debt - was_debt, p.currency))
                    else '' end);
  end if;
  return p;
end;
$$;
revoke all on function public.record_payment_dispute_lost(uuid, text, bigint, bigint) from public, anon, authenticated;
grant execute on function public.record_payment_dispute_lost(uuid, text, bigint, bigint) to service_role;

CREATE OR REPLACE FUNCTION public.claim_owed_steps(target_org uuid, amount bigint, road text, withdrawal uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  sw public.stripe_withdrawals;
  fw public.factory_withdrawals;
  need bigint;
  got bigint := 0;
  take_amount bigint;
  left_cents bigint;
  still boolean;
  r record;
  t public.payment_takes;
  out_takes jsonb := '[]'::jsonb;
begin
  if not (coalesce(auth.role(), '') = 'service_role' or public.is_org_owner(target_org)) then
    raise exception 'Only a company owner can withdraw.' using errcode = '42501', hint = 'withdraw_owner_only';
  end if;
  if road is null or road not in ('stripe', 'pool') then
    raise exception 'unknown withdrawal road' using errcode = '22023', hint = 'withdrawal_not_waiting';
  end if;
  if amount is null or amount <= 0 then
    raise exception 'Enter an amount to withdraw.' using errcode = '22023', hint = 'withdrawal_amount';
  end if;
  perform 1 from public.orgs where id = target_org for no key update;

  if road = 'stripe' then
    select * into sw from public.stripe_withdrawals where id = withdrawal for update;
    if not found or sw.org_id <> target_org or sw.state <> 'claimed' then
      raise exception 'this withdrawal is not waiting' using errcode = '22023', hint = 'withdrawal_not_waiting';
    end if;
    -- Claimed already (a retry of the same withdrawal): what it holds.
    if sw.owed_cents is not null then
      return jsonb_build_object('claimed_cents', sw.owed_cents, 'takes', coalesce((
        select jsonb_agg(jsonb_build_object('take_id', k.id, 'payment_id', k.payment_id, 'amount_cents', k.amount_cents,
                 'charge_id', p.stripe_charge_id, 'order_id', p.order_id, 'order_number', o.order_number,
                 'status', k.status, 'stripe_transfer_id', k.stripe_transfer_id) order by k.created_at)
          from public.payment_takes k
          join public.order_payments p on p.id = k.payment_id
          join public.production_orders o on o.id = p.order_id
         where k.stripe_withdrawal_id = sw.id), '[]'::jsonb), 'resumed', true);
    end if;
    -- A Stripe account being replaced: nothing goes to either until it is done.
    if exists (select 1 from public.stripe_connect_upgrades u where u.org_id = target_org
                and u.completed_at is null and u.new_account_id is not null) then
      raise exception 'the payout account is being updated' using errcode = '22023', hint = 'payout_upgrading';
    end if;
    -- Money refunded after the factory withdrew it: nothing more of its owed
    -- steps leaves while it owes TSC more than its other earnings, or more
    -- than what is left after the debt (20261121230000; under the lock).
    if public.factory_debt_uncovered_cents(target_org) > 0
       or ((public.owed_reachable(target_org) ->> 'debt_cents')::bigint > 0
           and amount > (public.owed_reachable(target_org) ->> 'stripe_cents')::bigint) then
      raise exception 'the factory owes TSC %', public.format_money(public.factory_debt_cents(target_org), 'USD')
        using errcode = '22023', hint = 'withdrawal_owes_tsc', detail = public.format_money(public.factory_debt_cents(target_org), 'USD');
    end if;
  else
    select * into fw from public.factory_withdrawals where id = withdrawal for update;
    if not found or fw.org_id <> target_org or fw.status <> 'requested'
       or exists (select 1 from public.payment_takes k where k.factory_withdrawal_id = fw.id) then
      raise exception 'this withdrawal is not waiting' using errcode = '22023', hint = 'withdrawal_not_waiting';
    end if;
  end if;

  need := amount;
  for r in
    select p.id, p.order_id, p.stripe_charge_id, o.order_number
      from public.order_payments p
      join public.production_orders o on o.id = p.order_id
     where o.factory_org_id = target_org and public.payment_claimable(p)
       and (road = 'pool' or p.stripe_charge_id is not null)
     order by p.release_requested_at, p.id
  loop
    exit when need <= 0;
    -- Locked, then read again: a staff payout started on it since is seen.
    select public.payment_claimable(p), public.payment_factory_cents(p) - public.payment_taken_cents(p.id)
      into still, left_cents
      from public.order_payments p where p.id = r.id for update;
    continue when not coalesce(still, false) or left_cents <= 0;
    take_amount := least(left_cents, need);
    insert into public.payment_takes (payment_id, org_id, road, stripe_withdrawal_id, factory_withdrawal_id, amount_cents)
    values (r.id, target_org, road,
            case when road = 'stripe' then withdrawal end,
            case when road = 'pool' then withdrawal end,
            take_amount)
    returning * into t;
    need := need - take_amount;
    got := got + take_amount;
    out_takes := out_takes || jsonb_build_array(jsonb_build_object(
      'take_id', t.id, 'payment_id', r.id, 'amount_cents', take_amount, 'charge_id', r.stripe_charge_id,
      'order_id', r.order_id, 'order_number', r.order_number, 'status', 'held', 'stripe_transfer_id', null));
  end loop;
  if need > 0 then
    raise exception 'That is more than your balance.' using errcode = '22023', hint = 'withdrawal_over_balance';
  end if;
  if road = 'stripe' then
    update public.stripe_withdrawals set owed_cents = got, updated_at = now() where id = sw.id;
  end if;
  return jsonb_build_object('claimed_cents', got, 'takes', out_takes, 'resumed', false);
end;
$function$;
revoke all on function public.claim_owed_steps(uuid, bigint, text, uuid) from public, anon, authenticated;
grant execute on function public.claim_owed_steps(uuid, bigint, text, uuid) to service_role;

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
begin
  if not ((old.state = 'confirmed' and new.state <> 'confirmed')
          or (new.state in ('confirmed', 'released') and new.factory_refund_cents > old.factory_refund_cents)) then
    return null;
  end if;
  lost := new.dispute_lost_cents > old.dispute_lost_cents or (new.dispute_lost_at is not null and old.dispute_lost_at is null);
  select * into m from public.order_milestones where id = new.milestone_id;
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
            case when owes and lost
                 then format('You owe TSC %s. The brand''s bank reversed a payment after you withdrew it.',
                             public.format_money(public.factory_debt_cents(w.org_id), 'USD'))
                 when owes
                 then format('You owe TSC %s. A payment was refunded after you withdrew it.',
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

CREATE OR REPLACE FUNCTION public.guard_withdrawal_takes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  -- Staff record a bank transfer that already went (mark_withdrawal_paid_by_bank):
  -- recorded as it is; a part no longer the factory's becomes a debt to TSC
  -- (20261121230000).
  if current_setting('tsc.bank_sent', true) = 'on' then
    return new;
  end if;
  if old.status = 'requested' and new.status in ('paying', 'paid')
     and exists (select 1 from public.payment_takes k
                   join public.order_payments p on p.id = k.payment_id
                  where k.factory_withdrawal_id = new.id and k.status = 'held'
                    and (p.state <> 'confirmed' or p.disputed_at is not null
                         or public.take_refunded_cents(k) > 0)) then
    raise exception 'the factory''s balance no longer covers this' using errcode = '22023', hint = 'withdrawal_over_balance';
  end if;
  -- Nothing is paid while the factory owes TSC more than its other earnings (20261121210000).
  if old.status = 'requested' and new.status in ('paying', 'paid') and public.factory_debt_uncovered_cents(new.org_id) > 0 then
    raise exception 'the factory owes TSC %', public.format_money(public.factory_debt_cents(new.org_id), 'USD')
      using errcode = '22023', hint = 'withdrawal_owes_tsc', detail = public.format_money(public.factory_debt_cents(new.org_id), 'USD');
  end if;
  return new;
end;
$function$;
revoke all on function public.guard_withdrawal_takes() from public, anon, authenticated;
grant execute on function public.guard_withdrawal_takes() to service_role;

CREATE OR REPLACE FUNCTION public.claim_withdrawal(target_withdrawal uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  w public.factory_withdrawals;
  a public.factory_payout_accounts;
  resumed boolean := false;
begin
  if not public.is_platform_admin() then
    raise exception 'paying a factory is limited to platform staff' using errcode = '42501';
  end if;
  select * into w from public.factory_withdrawals where id = target_withdrawal;
  if not found then
    raise exception 'withdrawal not found' using errcode = 'P0002';
  end if;
  perform public.payout_staff_check(w.org_id);
  perform 1 from public.orgs where id = w.org_id for no key update;
  select * into w from public.factory_withdrawals where id = target_withdrawal for update;
  if w.status = 'paying' then
    if w.lease_until is not null and w.lease_until > now() then
      raise exception 'this is already being paid' using errcode = '22023', hint = 'payout_in_progress';
    end if;
    resumed := true;
  elsif w.status <> 'requested' then
    raise exception 'this withdrawal is %', w.status using errcode = '22023', hint = 'withdrawal_not_waiting';
  end if;
  -- Its own old-pool part must still be in the pool (open withdrawals take
  -- the pool in order; a newer one short, or the pool paid beyond what it
  -- holds, never stops this one: 20261121230000).
  if not resumed and public.withdrawal_pool_refunded_cents(w) > 0 then
    raise exception 'the factory''s balance no longer covers this' using errcode = '22023', hint = 'withdrawal_over_balance';
  end if;
  -- Money refunded after the factory withdrew it, more than its other
  -- earnings cover: TSC recovers it before paying anything more
  -- (20261121210000). The amount travels in detail, for staff's sentence.
  if not resumed and public.factory_debt_uncovered_cents(w.org_id) > 0 then
    raise exception 'the factory owes TSC %', public.format_money(public.factory_debt_cents(w.org_id), 'USD')
      using errcode = '22023', hint = 'withdrawal_owes_tsc', detail = public.format_money(public.factory_debt_cents(w.org_id), 'USD');
  end if;
  select * into a from public.factory_payout_accounts x where x.id = w.account_id;
  if not found or a.payee_changed_at is distinct from w.paid_to_changed_at
     or public.withdrawal_provider_for(a) is distinct from w.provider then
    raise exception 'this factory changed where it is paid' using errcode = '22023', hint = 'payout_changed';
  end if;
  update public.factory_withdrawals
     set status = 'paying', lease_until = now() + interval '90 seconds', updated_at = now(),
         decided_by = coalesce(decided_by, auth.uid()), decided_at = coalesce(decided_at, now())
   where id = w.id returning * into w;
  return jsonb_build_object(
    'withdrawal_id', w.id, 'key', w.attempt_key, 'resumed', resumed, 'provider', w.provider,
    'provider_ref', w.provider_ref, 'amount_cents', w.amount_cents, 'currency', w.currency,
    'org_id', w.org_id, 'account_id', a.id, 'paypal_email', a.paypal_email,
    'wise_recipient_id', a.wise_recipient_id, 'wise_currency', a.wise_currency
  );
end;
$function$;
revoke all on function public.claim_withdrawal(uuid) from public, anon;
grant execute on function public.claim_withdrawal(uuid) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.withdrawal_covered(w factory_withdrawals)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- Its own old-pool part still in the pool (20261121230000).
  select public.withdrawal_pool_refunded_cents(w) = 0
     -- A debt to TSC the factory's other earnings cannot cover (20261121210000).
     and public.factory_debt_uncovered_cents(w.org_id) = 0
     and not exists (select 1 from public.payment_takes k
                       join public.order_payments p on p.id = k.payment_id
                      where k.factory_withdrawal_id = w.id and k.status = 'held'
                        and (p.state <> 'confirmed' or p.disputed_at is not null
                             or public.take_refunded_cents(k) > 0));
$function$;
revoke all on function public.withdrawal_covered(public.factory_withdrawals) from public, anon, authenticated;
grant execute on function public.withdrawal_covered(public.factory_withdrawals) to service_role;

CREATE OR REPLACE FUNCTION public.admin_withdrawals()
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
    'withdrawals', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', w.id, 'org_id', w.org_id, 'factory_name', g.name, 'provider', w.provider, 'status', w.status,
        'amount_cents', w.amount_cents, 'currency', w.currency, 'paid_to', w.paid_to,
        'fee_cents', w.fee_cents, 'receives_minor', w.receives_minor, 'receives_currency', w.receives_currency,
        'provider_ref', w.provider_ref, 'reason', w.reason, 'staff_sentence', w.staff_sentence,
        'created_at', w.created_at, 'paid_at', w.paid_at, 'wise_currency', a.wise_currency,
        -- The factory's one balance left (what it could still withdraw by any
        -- road from TSC), not only what PayPal / Wise reach.
        'balance_after_cents', (public.factory_balance(w.org_id) ->> 'available_cents')::bigint,
        -- Whether approving would be refused (the same checks as
        -- claim_withdrawal and the takes guard), so the row says so first.
        'covered', w.status not in ('requested', 'paying') or public.withdrawal_covered(w),
        -- What the factory owes TSC beyond its other earnings (its row in
        -- Needs checking, "To recover"): Pay is refused while above zero.
        -- (all it owes, 20261121230000)
        'owes_tsc_cents', case when w.status = 'requested' and public.factory_debt_uncovered_cents(w.org_id) > 0
                               then public.factory_debt_cents(w.org_id) else 0 end
      ) order by w.created_at desc)
      from public.factory_withdrawals w
      join public.orgs g on g.id = w.org_id
      left join public.factory_payout_accounts a on a.id = w.account_id
     where w.status in ('requested', 'paying') or w.updated_at > now() - interval '30 days'
    ), '[]'::jsonb),
    'pool_payment_ids', coalesce((
      select jsonb_agg(p.id) from public.order_payments p
       where p.state = 'confirmed'
         and (p.withdrawal_pool
              or exists (select 1 from public.payment_takes t where t.payment_id = p.id and t.status in ('held', 'sent')))
    ), '[]'::jsonb)
  );
end;
$function$;
revoke all on function public.admin_withdrawals() from public, anon;
grant execute on function public.admin_withdrawals() to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mark_withdrawal_paid_by_bank(target_withdrawal uuid, reference text)
 RETURNS factory_withdrawals
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  w public.factory_withdrawals;
  said text := nullif(btrim(coalesce(reference, '')), '');
  a public.factory_payout_accounts;
begin
  if not public.is_platform_admin() then
    raise exception 'paying a factory is limited to platform staff' using errcode = '42501';
  end if;
  select * into w from public.factory_withdrawals where id = target_withdrawal;
  if not found then
    raise exception 'withdrawal not found' using errcode = 'P0002';
  end if;
  perform public.payout_staff_check(w.org_id);
  -- The company first, then the withdrawal, as claim_withdrawal locks them
  -- (20261121230000).
  perform 1 from public.orgs where id = w.org_id for no key update;
  select * into w from public.factory_withdrawals where id = target_withdrawal for update;
  if w.status <> 'requested' then
    raise exception 'only a waiting withdrawal can be marked paid' using errcode = '22023', hint = 'withdrawal_not_waiting';
  end if;
  if w.provider <> 'bank' then
    raise exception 'this withdrawal is paid through its provider' using errcode = '22023', hint = 'withdrawal_provider';
  end if;
  -- claim_withdrawal's check. The account staff would send to is gone, or
  -- its payee details changed since the factory asked: decline, so it asks again.
  select * into a from public.factory_payout_accounts x where x.id = w.account_id;
  if not found or a.payee_changed_at is distinct from w.paid_to_changed_at
     or public.withdrawal_provider_for(a) is distinct from w.provider then
    raise exception 'this factory changed where it is paid' using errcode = '22023', hint = 'payout_changed';
  end if;
  if said is null or length(said) < 3 or length(said) > 200 or said !~ '[[:alnum:]]' then
    raise exception 'enter the bank''s reference for this transfer' using errcode = '22023', hint = 'reference_required';
  end if;
  if public.payout_text_holds_number(w.org_id, said) then
    raise exception 'the factory can read this, so it cannot hold the account number' using errcode = '22023', hint = 'reference_holds_number';
  end if;
  -- The wire fee the factory pays, fixed (bank_payout_fee_cents()).
  if w.amount_cents <= public.bank_payout_fee_cents() then
    raise exception 'this withdrawal is not more than the bank transfer fee, so nothing would arrive'
      using errcode = '22023', hint = 'fee_too_large';
  end if;
  -- The bank transfer already went: recorded as it is, never refused for
  -- the balance. A part refunded since becomes a debt to TSC, which staff
  -- see in To recover (20261121230000).
  perform set_config('tsc.bank_sent', 'on', true);
  update public.factory_withdrawals
     set status = 'paid', paid_at = now(), provider_ref = said, fee_cents = public.bank_payout_fee_cents(),
         receives_minor = w.amount_cents - public.bank_payout_fee_cents(), receives_currency = w.currency,
         decided_by = auth.uid(), decided_at = now(), updated_at = now()
   where id = w.id returning * into w;
  perform set_config('tsc.bank_sent', 'off', true);
  perform public.release_withdrawn_payments(w.org_id, auth.uid());
  perform public.withdrawal_notice(w,
    format('%s paid out to you', public.format_money(coalesce(w.receives_minor, w.amount_cents), coalesce(w.receives_currency, w.currency))),
    format('Sent by bank transfer to %s. Payout fee %s is taken from this payment: you receive %s. Reference: %s',
           w.paid_to, public.format_money(w.fee_cents, w.currency), public.format_money(w.receives_minor, w.currency), said));
  return w;
end;
$function$;
revoke all on function public.mark_withdrawal_paid_by_bank(uuid, text) from public, anon;
grant execute on function public.mark_withdrawal_paid_by_bank(uuid, text) to authenticated;

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
