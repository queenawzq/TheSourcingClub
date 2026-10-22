-- ---------------------------------------------------------------------------
-- What the brand pays, per step and per order: the service fee included.
-- ---------------------------------------------------------------------------
-- production_order_summary counts step amounts, which is what the factory is
-- paid. The brand pays each step with the fee on top (fee_bps, fixed per
-- order), and its Payments page and Fund screen show that figure, so its
-- order page showed one payment at two prices. These two views give the
-- brand's order page the charged figures, summed here rather than in
-- JavaScript.
--
-- A step's charge is worked out exactly as chargedCents() in
-- src/lib/domain/payment.js and begin_payment_checkout do it:
--   charged by Stripe (processing, held, paid out)  charged_cents as recorded
--   anything else                                   amount + floor(amount * fee_bps / 10000)
-- A paying step with no payment yet (steps not agreed) is charged at the
-- rate its payment will get: an existing payment's fee_bps, else 500 bps on
-- orders of $5,000 and over and 700 under (order_payment_fee_bps()).
--
-- New views only: nothing the live site reads changes. Both are
-- security_invoker, so the caller's own access to orders, steps and
-- payments decides what they return.
-- ---------------------------------------------------------------------------

create view public.order_step_charges
with (security_invoker = true) as
select
  c.milestone_id,
  c.order_id,
  c.payment_id,
  c.sort,
  c.state,
  c.amount_cents,
  c.fee_bps,
  (c.charged_cents - c.amount_cents)::bigint as fee_cents,
  c.charged_cents
from (
  select
    m.id                                    as milestone_id,
    m.order_id,
    p.id                                    as payment_id,
    m.sort,
    p.state,
    coalesce(p.amount_cents, m.amount_cents)::bigint as amount_cents,
    r.fee_bps,
    case
      when p.charged_cents is not null and p.state not in ('not_due', 'due', 'failed')
        then p.charged_cents
      else coalesce(p.amount_cents, m.amount_cents)
           + (coalesce(p.amount_cents, m.amount_cents) * r.fee_bps) / 10000
    end::bigint                             as charged_cents
  from public.order_milestones m
  join public.production_orders o on o.id = m.order_id
  left join public.order_payments p on p.milestone_id = m.id
  left join lateral (
    select coalesce(
      p.fee_bps,
      (select s.fee_bps from public.order_payments s
        where s.order_id = m.order_id
        order by s.created_at
        limit 1),
      case when coalesce(o.order_total_cents, 0) >= 500000 then 500 else 700 end
    ) as fee_bps
  ) r on true
  where coalesce(p.amount_cents, m.amount_cents, 0) > 0
) c;

-- The order page's four figures, on the same footing as
-- production_order_summary's total / paid / outstanding / next payment.
create view public.production_order_charges
with (security_invoker = true) as
select
  o.id                                   as order_id,
  coalesce(tot.total, 0)::bigint         as total_charged_cents,
  coalesce(tot.paid, 0)::bigint          as paid_charged_cents,
  (coalesce(tot.total, 0) - coalesce(tot.paid, 0))::bigint as outstanding_charged_cents,
  nx.charged_cents                       as next_payment_charged_cents,
  nx.fee_cents                           as next_payment_fee_cents
from public.production_orders o
left join lateral (
  select
    sum(c.charged_cents) as total,
    -- Held or paid out, as the summary's paid_cents.
    sum(c.charged_cents) filter (where c.state in ('confirmed', 'released')) as paid
  from public.order_step_charges c
  where c.order_id = o.id
) tot on true
left join lateral (
  -- The summary's next payment: the first unpaid one by step order.
  select c.charged_cents, c.fee_cents
  from public.order_step_charges c
  where c.order_id = o.id and c.state in ('not_due', 'due', 'sent', 'processing', 'failed')
  order by c.sort
  limit 1
) nx on true;

revoke all on public.order_step_charges from anon, authenticated;
revoke all on public.production_order_charges from anon, authenticated;
grant select on public.order_step_charges to authenticated;
grant select on public.production_order_charges to authenticated;
