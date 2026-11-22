-- ============================================================================
-- One rule per check
-- ----------------------------------------------------------------------------
-- 1. Whether a waiting PayPal / Wise withdrawal can go is decided in one
--    place: withdrawal_blocker(w) says why not (null: it can), and
--    check_withdrawal_can_go(w) raises it. withdrawal_covered (the word on
--    the Payments page), claim_withdrawal (staff approve) and the
--    guard_withdrawal_takes trigger (any move off 'requested') all read it,
--    so they can no longer disagree. A debt not covered is said first
--    everywhere, as claim_withdrawal already did; then a step under it that
--    is no longer the factory's.
-- 2. claim_owed_steps' Stripe-road debt test reads owed_reachable once: "a
--    debt not covered, or a debt and more than stripe_cents" is the second
--    half alone (a debt not covered puts stripe_cents below zero).
-- 3. What the factory earns from a step is payment_factory_base_cents, less
--    its refunded part (payment_factory_cents), everywhere: payment_factory_cents
--    no longer re-writes the base, and the approval notice and the "Payment
--    held" notice say payment_factory_cents instead of amount less refund
--    (the same unless the step has a payout fee or was a bank wire with a
--    different received amount, where they now say what the balance holds).
--    The generated column factory_refund_cents keeps its own copy of the
--    base as its cap: a generated column cannot call a function on its row.
--    Every "owes TSC" refusal names the debt the factory's other earnings
--    do not cover (factory_debt_uncovered_cents), as the card, To recover
--    and the Withdrawals row do: check_withdrawal_can_go (staff approve and
--    the guard trigger, as rounds 36 and 37 had them) and now the Stripe
--    road in claim_owed_steps, which named the whole debt. When there is no
--    uncovered debt and the Stripe road still asks for more than the debt
--    leaves, it is refused as over the balance (the server says "You can
--    withdraw up to X." for either).
-- On top of rounds 36-39 (20261121380000 ... 20261121387000): a debt is
-- netted from Available, never covered by takes.
-- Latest full bodies; grants unchanged on replaced functions; the two new
-- ones are internal. Safe with the live site while applied: only function
-- bodies change, with the same results.
-- ============================================================================

create or replace function public.withdrawal_blocker(w public.factory_withdrawals)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    -- Money refunded after the factory withdrew it, more than its other
    -- earnings cover: TSC recovers it before paying anything more (20261121210000).
    when public.factory_debt_uncovered_cents(w.org_id) > 0 then 'withdrawal_owes_tsc'
    -- A step under it no longer confirmed, disputed, or refunded in part since it was asked.
    when exists (select 1 from public.payment_takes k
                   join public.order_payments p on p.id = k.payment_id
                  where k.factory_withdrawal_id = w.id and k.status = 'held'
                    and (p.state <> 'confirmed' or p.disputed_at is not null
                         or public.take_refunded_cents(k) > 0)) then 'withdrawal_over_balance'
  end;
$$;
revoke all on function public.withdrawal_blocker(public.factory_withdrawals) from public, anon, authenticated;
grant execute on function public.withdrawal_blocker(public.factory_withdrawals) to service_role;

create or replace function public.check_withdrawal_can_go(w public.factory_withdrawals)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  why text := public.withdrawal_blocker(w);
begin
  if why = 'withdrawal_owes_tsc' then
    -- The amount travels in detail, for staff's sentence.
    -- What its earnings do not cover: the To recover row's amount (20261121380000).
    raise exception 'the factory owes TSC %', public.format_money(public.factory_debt_uncovered_cents(w.org_id), 'USD')
      using errcode = '22023', hint = 'withdrawal_owes_tsc', detail = public.format_money(public.factory_debt_uncovered_cents(w.org_id), 'USD');
  elsif why = 'withdrawal_over_balance' then
    raise exception 'the factory''s balance no longer covers this' using errcode = '22023', hint = 'withdrawal_over_balance';
  end if;
end;
$$;
revoke all on function public.check_withdrawal_can_go(public.factory_withdrawals) from public, anon, authenticated;
grant execute on function public.check_withdrawal_can_go(public.factory_withdrawals) to service_role;

CREATE OR REPLACE FUNCTION public.withdrawal_covered(w factory_withdrawals)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select public.withdrawal_blocker(w) is null;
$function$;

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
  if old.status = 'requested' and new.status in ('paying', 'paid') then
    perform public.check_withdrawal_can_go(new);
  end if;
  return new;
end;
$function$;

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
  -- Money refunded after the factory withdrew it, more than its other
  -- earnings cover: TSC recovers it before paying anything more
  -- (20261121210000). The uncovered amount travels in detail, for staff's
  -- sentence (20261121380000).
  if not resumed then
    perform public.check_withdrawal_can_go(w);
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
  reach jsonb;
  uncovered bigint;
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
    -- (One read: a debt not covered means stripe_cents is below zero, so the
    -- second test alone says it.) The amount named is what the other
    -- earnings do not cover, as everywhere else.
    reach := public.owed_reachable(target_org);
    if (reach ->> 'debt_cents')::bigint > 0 and amount > (reach ->> 'stripe_cents')::bigint then
      uncovered := public.factory_debt_uncovered_cents(target_org);
      if uncovered > 0 then
        raise exception 'the factory owes TSC %', public.format_money(uncovered, 'USD')
          using errcode = '22023', hint = 'withdrawal_owes_tsc', detail = public.format_money(uncovered, 'USD');
      end if;
      raise exception 'That is more than your balance.' using errcode = '22023', hint = 'withdrawal_over_balance';
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

CREATE OR REPLACE FUNCTION public.payment_factory_cents(p order_payments)
 RETURNS bigint
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- What the factory earns from the step (payment_factory_base_cents), less
  -- its part of any refund or lost dispute (factory_refund_cents).
  select greatest(public.payment_factory_base_cents(p) - coalesce(p.factory_refund_cents, 0), 0)::bigint;
$function$;

CREATE OR REPLACE FUNCTION public.approve_milestone(target_milestone uuid, note text DEFAULT NULL::text)
 RETURNS order_milestones
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  m public.order_milestones;
  o public.production_orders;
  p public.order_payments;
begin
  select * into o from public.production_orders
   where id = (select order_id from public.order_milestones where id = target_milestone)
   for update;
  if not found then
    raise exception 'milestone not found' using errcode = 'P0002';
  end if;

  select * into m from public.order_milestones where id = target_milestone for update;

  if o.status <> 'active' then
    raise exception 'this order is %', o.status using errcode = '22023';
  end if;

  if m.kind = 'payment_only' then
    raise exception 'there is nothing to approve on a payment step' using errcode = '22023';
  end if;

  -- Approving is Approve samples; a step that releases money also needs
  -- Release funds (both, so neither alone pays a factory).
  if not public.is_org_member(o.brand_org_id) then
    raise exception 'only the brand on this order approves its steps' using errcode = '42501';
  end if;
  perform public.require_org_permission(o.brand_org_id, 'approve');
  if m.kind = 'approval_and_payment' then
    perform public.require_org_permission(o.brand_org_id, 'releaseFunds');
  end if;

  -- Also the double-approve guard: a second concurrent call blocks on the row
  -- lock above, then reads the new state and lands here.
  if m.state not in ('active', 'submitted') then
    raise exception 'that step is %, so it is not waiting on you', m.state
      using errcode = '22023';
  end if;

  if m.kind = 'approval_and_payment' then
    select * into p from public.order_payments where milestone_id = m.id for update;

    -- Approving pays the factory, so there has to be money to pay it with.
    if not found or p.state <> 'confirmed' then
      raise exception 'Fund "%" before you approve it. When you approve, the payment goes to the factory''s balance.',
        m.title using errcode = '22023';
    end if;

    update public.order_milestones
       set state = 'complete', approved_by = auth.uid(), approved_at = now(),
           approval_note = nullif(btrim(coalesce(note, '')), ''), completed_at = now()
     where id = m.id
    returning * into m;

    update public.order_payments
       set release_requested_at = now()
     where id = p.id
    returning * into p;

    insert into public.notifications
      (org_id, kind, subject_type, subject_id, order_id, title, body)
    values (
      o.factory_org_id, 'milestone_approved', 'milestone', m.id, o.id,
      format('"%s" was approved', m.title),
      -- The amount always, then what the factory must do first when it has no
      -- way to withdraw, then the brand's note. Nothing is sent on approval:
      -- the money waits in the factory's balance until it withdraws.
      -- A charge already disputed: the money is on hold, not in the balance
      -- (the notice below says so); never "added to your balance".
      case when p.disputed_at is not null
        then format('The brand approved this step.%s',
                    coalesce(' Their note: ' || nullif(btrim(coalesce(note, '')), ''), ''))
        else format('The brand approved this step. %s added to your balance.%s%s',
             -- What is added: the step less the factory's part of any refund (20261121280000).
             public.format_money(public.payment_factory_cents(p), p.currency),
             case when public.factory_has_no_saved_method(o.factory_org_id)
                  then ' Add a withdrawal method to receive earnings.' else '' end,
             coalesce(' Their note: ' || nullif(btrim(coalesce(note, '')), ''), '')) end
    );
    if p.disputed_at is not null then
      perform public.tell_payment_hold(p, true);
    end if;

    -- The chain moves on the brand's approval, never on the payout: a
    -- transfer that fails must not freeze the order.
    perform public.advance_order_chain(o.id);
  else
    update public.order_milestones
       set state = 'complete', approved_by = auth.uid(), approved_at = now(),
           approval_note = nullif(btrim(coalesce(note, '')), ''), completed_at = now()
     where id = m.id
    returning * into m;

    insert into public.notifications
      (org_id, kind, subject_type, subject_id, order_id, title, body)
    values (
      o.factory_org_id, 'milestone_approved', 'milestone', m.id, o.id,
      format('"%s" was approved', m.title),
      coalesce(nullif(btrim(coalesce(note, '')), ''), 'You can carry on to the next step.')
    );

    perform public.advance_order_chain(o.id);
  end if;

  return m;
end;
$function$;

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
                   public.format_money(public.payment_factory_cents(p), p.currency), o.order_number));
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
$function$;
