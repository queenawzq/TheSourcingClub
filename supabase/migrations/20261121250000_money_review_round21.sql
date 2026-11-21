-- One balance, fix round 21 (money review of round 20): a refund that
-- failed after it was recorded as full always reaches someone.
--
-- * On a cancelled order (the payment keeps its charge): staff see it on
--   Needs checking, and the brand is told the refund failed.
-- * A second failure on the same old charge opens its staff row again.
-- * A payment funded again states the failed refund's own amount, keeps
--   what Stripe still counts as refunded or lost on that charge, and tells
--   the factory what TSC holds for it.
-- * Staff read why TSC still holds it, and what is left to refund.
-- * A full refund recorded while the payment was processing counts too.
--
-- record_full_refund_failed is replaced (one more argument each for what
-- Stripe still counts and the failed refund's amount): the old signature is
-- dropped in the same migration, so there is one function, no overload. It
-- is service-role only and called only by this deploy's server.

alter table public.payment_refund_failures
  add column cause text not null default 'paid_again' check (cause in ('paid_again', 'cancelled')),
  add column failed_at timestamptz not null default now();
comment on column public.payment_refund_failures.amount_cents is 'What is left to refund: the failed refund''s own amount (from 20261121250000).';

drop function public.record_full_refund_failed(uuid, text, text, bigint);

-- A refund recorded as full that Stripe later says failed: TSC still holds
-- that money.
--   cancelled order (the payment kept its charge)   staff refund it again;
--                                                   the brand is told
--   sent back to pay, not paid again                funded again with that
--                                                   charge; both sides told
--   sent back to pay, paid again (or cancelled)     staff refund the first
--                                                   payment
-- A row already resolved is opened again for a second failure.
create or replace function public.record_full_refund_failed(
  target_payment uuid, payment_intent text, charge text, charged bigint,
  refunded_now bigint, failed_cents bigint, lost_cents bigint, fee_cents bigint)
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
  elsif not exists (select 1 from public.payment_events e where e.payment_id = p.id and e.from_state in ('confirmed', 'processing')
                      and e.to_state = 'failed' and e.note like '%' || ref) then
    -- Not a payment sent back to pay for this charge.
    return p;
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
            format('The %s refund to your card failed, so TSC still holds your payment for this step. You don''t need to pay again.',
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
                 case when why = 'cancelled' then 'refund the brand again.' else 'the brand paid again, refund the first payment.' end) || ref);
  -- The brand was told it was refunded; on a cancelled order nothing else
  -- tells it otherwise.
  if why = 'cancelled' then
    insert into public.notifications (org_id, kind, subject_type, subject_id, order_id, title, body)
    values (o.brand_org_id, 'payment_refunded', 'payment', p.id, o.id,
            format('Refund for "%s" didn''t go through', coalesce(m.title, o.order_number)),
            format('The %s refund to your card failed. TSC will send it again.', public.format_money(failed_cents, p.currency)));
  end if;
  return p;
end;
$$;
revoke all on function public.record_full_refund_failed(uuid, text, text, bigint, bigint, bigint, bigint, bigint) from public, anon, authenticated;
grant execute on function public.record_full_refund_failed(uuid, text, text, bigint, bigint, bigint, bigint, bigint) to service_role;

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
        -- why TSC still holds it: the brand paid again, or the order is cancelled (20261121250000)
        'cause', r.cause,
        'stripe_payment_intent_id', r.payment_intent, 'at', r.failed_at) order by r.failed_at)
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
