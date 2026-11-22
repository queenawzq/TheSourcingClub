-- Refunds and lost disputes under one balance, step 1: stop the harm and make
-- the figures true (notes/cards/2026-11-21-refund-dispute-design.md).
--
-- * A refund staff make in Stripe is recorded at the amount Stripe reports
--   (charge.amount_refunded, a running total), never made bigger: the server
--   no longer refunds the rest of the charge (api/_stripe.js). The factory's
--   share of a refund is in proportion to its step amount within what the
--   brand was charged; TSC's fee bears the rest.
-- * Refunded in full before approval: back to Due, the brand pays again, as
--   before. After approval (a payment-only step once funded, an approved
--   step, partly or wholly withdrawn): the step stays done and only the
--   factory's earning for it goes down.
-- * The reduction first takes money still with TSC on that step, then the
--   part a waiting withdrawal holds ("Refunded", out of Total), and only what
--   already left TSC becomes a debt: Owed to TSC, inside Available (which can
--   go below zero). Nothing new can be withdrawn while it is not covered.
--   Staff see it on Needs checking ("To recover"). Paid out never falls.
-- * A lost dispute is the same as a refund of the disputed amount: the hold
--   ends (disputed_at is cleared; dispute_lost_at keeps the record), and the
--   factory, the brand and staff are told. Stripe's dispute fee is recorded;
--   TSC bears it.
--
-- Full prior bodies (live stack at d86661eb) plus the change; grants
-- re-applied exactly; no overloads.

-- ---------------------------------------------------------------------------
-- Columns (additive).
-- ---------------------------------------------------------------------------
alter table public.order_payments
  add column if not exists refunded_cents bigint not null default 0,
  add column if not exists refund_amount_at timestamptz,
  add column if not exists dispute_lost_cents bigint not null default 0,
  add column if not exists dispute_lost_at timestamptz,
  add column if not exists dispute_fee_cents bigint;
alter table public.order_payments
  add constraint order_payments_refunded_cents_check check (refunded_cents >= 0),
  add constraint order_payments_dispute_lost_cents_check check (dispute_lost_cents >= 0),
  add constraint order_payments_dispute_fee_cents_check check (dispute_fee_cents is null or dispute_fee_cents >= 0);
-- The factory's part of what went back to the brand: in proportion to its
-- step amount within the charge (one side computed; TSC's fee is the rest),
-- never more than it earned on the step.
alter table public.order_payments
  add column if not exists factory_refund_cents bigint generated always as (
    least(
      greatest((case when charged_cents is not null then amount_cents
                     else coalesce(amount_received_cents, amount_cents) end
                - coalesce(payout_fee_cents, 0)), 0),
      coalesce(round((refunded_cents + dispute_lost_cents)::numeric * amount_cents
                     / nullif(coalesce(charged_cents, amount_received_cents, amount_cents), 0))::bigint, 0))
  ) stored;

-- ---------------------------------------------------------------------------
-- What the factory earned on a payment: before (base) and after refunds.
-- ---------------------------------------------------------------------------
create or replace function public.payment_factory_base_cents(p public.order_payments)
returns bigint
language sql
immutable
set search_path = public, pg_temp
as $$
  select (case when p.charged_cents is not null then p.amount_cents
               else coalesce(p.amount_received_cents, p.amount_cents) end
          - coalesce(p.payout_fee_cents, 0))::bigint;
$$;
revoke all on function public.payment_factory_base_cents(public.order_payments) from public, anon, authenticated;
grant execute on function public.payment_factory_base_cents(public.order_payments) to service_role;

create or replace function public.payment_factory_cents(p public.order_payments)
returns bigint
language sql
immutable
set search_path = public, pg_temp
as $$
  -- Less the factory's part of any refund or lost dispute (factory_refund_cents).
  select greatest((case when p.charged_cents is not null then p.amount_cents
                        else coalesce(p.amount_received_cents, p.amount_cents) end
                   - coalesce(p.payout_fee_cents, 0)) - coalesce(p.factory_refund_cents, 0), 0)::bigint;
$$;
revoke all on function public.payment_factory_cents(public.order_payments) from public, anon, authenticated;
grant execute on function public.payment_factory_cents(public.order_payments) to service_role;

-- What already left TSC for this payment beyond what the factory now earns on
-- it: a withdrawal sent (any road), or the whole step paid the old way.
create or replace function public.payment_debt_cents(p public.order_payments)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select greatest(0, s.sent - public.payment_factory_cents(p))::bigint
    from (select case
                   when p.state = 'released'
                        and not exists (select 1 from public.payment_takes t where t.payment_id = p.id and t.status in ('held', 'sent'))
                     then public.payment_factory_base_cents(p)
                   else coalesce((select sum(t.amount_cents) from public.payment_takes t
                                   where t.payment_id = p.id and t.status = 'sent'), 0)
                 end as sent) s
   where p.state in ('confirmed', 'released') and not p.withdrawal_pool and p.currency = 'USD';
$$;
revoke all on function public.payment_debt_cents(public.order_payments) from public, anon, authenticated;
grant execute on function public.payment_debt_cents(public.order_payments) to service_role;

-- Everything the factory owes TSC: steps refunded after their money left,
-- and old-pool withdrawals paid beyond what the pool now holds. A client's
-- view counts only that client's steps.
create or replace function public.factory_debt_cents(target_org uuid, target_client uuid default null)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select sum(public.payment_debt_cents(p))
      from public.order_payments p
      join public.production_orders o on o.id = p.order_id
     where o.factory_org_id = target_org and not p.withdrawal_pool and p.currency = 'USD'
       and p.state in ('confirmed', 'released') and p.factory_refund_cents > 0
       and (target_client is null or o.brand_org_id = target_client)
  ), 0)::bigint
  + case when target_client is not null then 0 else greatest(0,
      coalesce((select sum(coalesce(w.pool_cents, w.amount_cents)) from public.factory_withdrawals w
                 where w.org_id = target_org and w.currency = 'USD' and w.status = 'paid'), 0)
      - coalesce((select sum(greatest(p.amount_cents - p.factory_refund_cents, 0)) from public.order_payments p
                    join public.production_orders o on o.id = p.order_id
                   where o.factory_org_id = target_org and p.withdrawal_pool and p.currency = 'USD'
                     and p.state in ('confirmed', 'released')), 0))::bigint end;
$$;
revoke all on function public.factory_debt_cents(uuid, uuid) from public, anon, authenticated;
grant execute on function public.factory_debt_cents(uuid, uuid) to service_role;

-- The part of a held take that is no longer the factory's: refunded since it
-- was taken. On a payment refunded the old way (back to Due, or before this
-- change), all of it. Otherwise what the reduction could not take from money
-- still with TSC on the step, newest take first.
create or replace function public.take_refunded_cents(t public.payment_takes)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when t.status <> 'held' then 0::bigint
    when p.state not in ('confirmed', 'released')
         or (p.refunded_at is not null and p.refunded_at > coalesce(p.confirmed_at, '-infinity'::timestamptz)) then t.amount_cents
    else greatest(0::bigint, least(t.amount_cents,
           greatest(0::bigint, s.held - greatest(0::bigint, public.payment_factory_cents(p) - s.sent)) - s.newer))
  end
  from public.order_payments p
  cross join lateral (
    select coalesce(sum(k.amount_cents) filter (where k.status = 'held'), 0)::bigint as held,
           coalesce(sum(k.amount_cents) filter (where k.status = 'sent'), 0)::bigint as sent,
           coalesce(sum(k.amount_cents) filter (where k.status = 'held' and (k.created_at, k.id) > (t.created_at, t.id)), 0)::bigint as newer
      from public.payment_takes k where k.payment_id = p.id) s
  where p.id = t.payment_id;
$$;
revoke all on function public.take_refunded_cents(public.payment_takes) from public, anon, authenticated;
grant execute on function public.take_refunded_cents(public.payment_takes) to service_role;

-- For the server, before it sends a withdrawal: how much of what it holds
-- was refunded since (a Stripe or a PayPal / Wise withdrawal).
create or replace function public.withdrawal_refunded_part(target_withdrawal uuid)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(public.take_refunded_cents(t)), 0)::bigint
    from public.payment_takes t
   where (t.stripe_withdrawal_id = target_withdrawal or t.factory_withdrawal_id = target_withdrawal)
     and t.status = 'held';
$$;
revoke all on function public.withdrawal_refunded_part(uuid) from public, anon, authenticated;
grant execute on function public.withdrawal_refunded_part(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- What can be withdrawn: the old pool at what it now holds, and owed steps
-- net of the debt. any_cents / stripe_cents can be below zero: the debt is
-- then more than the owed steps, and the pool's money covers it first (every
-- caller adds the two).
-- ---------------------------------------------------------------------------
create or replace function public.factory_withdrawable(target_org uuid)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select sum(greatest(p.amount_cents - p.factory_refund_cents, 0)) from public.order_payments p
      join public.production_orders o on o.id = p.order_id
     where o.factory_org_id = target_org and p.withdrawal_pool and p.currency = 'USD'
       and p.state in ('confirmed', 'released')
  ), 0)::bigint - coalesce((
    select sum(coalesce(w.pool_cents, w.amount_cents)) from public.factory_withdrawals w
     where w.org_id = target_org and w.currency = 'USD' and w.status in ('requested', 'paying', 'paid')
  ), 0)::bigint;
$$;
revoke all on function public.factory_withdrawable(uuid) from public, anon, authenticated;
grant execute on function public.factory_withdrawable(uuid) to service_role;

create or replace function public.owed_reachable(target_org uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- Net of everything the company owes TSC (factory_debt_cents: refunded
  -- steps whose money had left, and the old pool paid beyond what it holds).
  select jsonb_build_object(
    'any_cents', coalesce(sum(x.left_cents), 0)::bigint - d.debt,
    'stripe_cents', coalesce(sum(x.left_cents) filter (where x.charge is not null), 0)::bigint - d.debt,
    'debt_cents', d.debt)
    from (select public.factory_debt_cents(target_org) as debt) d
    left join (select p.stripe_charge_id as charge,
                      public.payment_factory_cents(p) - public.payment_taken_cents(p.id) as left_cents
                 from public.order_payments p
                 join public.production_orders o on o.id = p.order_id
                where o.factory_org_id = target_org and public.payment_claimable(p)) x
      on x.left_cents > 0
   group by d.debt;
$$;
revoke all on function public.owed_reachable(uuid) from public, anon, authenticated;
grant execute on function public.owed_reachable(uuid) to service_role;

create or replace function public.my_withdrawal_balance(target_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  reach jsonb;
  pool bigint;
begin
  if not (public.is_org_member(target_org) or public.is_platform_admin()) then
    raise exception 'not a member of this company' using errcode = '42501';
  end if;
  reach := public.owed_reachable(target_org);
  pool := greatest(public.factory_withdrawable(target_org), 0);
  return jsonb_build_object(
    -- Net of what the company owes TSC: never below zero here.
    'available_cents', greatest(pool + (reach ->> 'any_cents')::bigint, 0),
    'pool_cents', pool,
    'owed_cents', greatest((reach ->> 'any_cents')::bigint, 0),
    'stripe_owed_cents', greatest((reach ->> 'stripe_cents')::bigint, 0),
    'currency', 'USD',
    'pool', exists (select 1 from public.order_payments p join public.production_orders o on o.id = p.order_id
                     where o.factory_org_id = target_org and p.withdrawal_pool),
    -- What cancelling each open withdrawal would give back.
    'returnable', coalesce((select jsonb_object_agg(f.id, public.withdrawal_back_cents(f))
                              from public.factory_withdrawals f
                             where f.org_id = target_org and f.status in ('requested', 'paying')), '{}'::jsonb),
    'withdrawn', coalesce((select jsonb_object_agg(w.payment_id, w.withdrawn_cents)
                             from public.withdrawn_by_payment(target_org) w), '{}'::jsonb),
    'taken', coalesce((select jsonb_object_agg(x.payment_id, jsonb_build_object('held', x.held, 'sent', x.sent))
                         from (select t.payment_id,
                                      coalesce(sum(t.amount_cents) filter (where t.status = 'held'), 0) as held,
                                      coalesce(sum(t.amount_cents) filter (where t.status = 'sent'), 0) as sent
                                 from public.payment_takes t
                                where t.org_id = target_org and t.status in ('held', 'sent')
                                group by t.payment_id) x), '{}'::jsonb)
  );
end;
$$;
revoke all on function public.my_withdrawal_balance(uuid) from public, anon;
grant execute on function public.my_withdrawal_balance(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- A waiting withdrawal on a step refunded since: that part is Refunded (out
-- of every figure), the withdrawal is on hold, and cancelling gives back only
-- the rest.
-- ---------------------------------------------------------------------------
create or replace function public.withdrawal_refunded_cents(w public.factory_withdrawals)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- The part of withdrawal_on_hold_cents() on a step whose charge went back
  -- to the brand (refunded, or a dispute lost): not the factory's any more.
  select coalesce(sum(public.take_refunded_cents(k)), 0)::bigint
    from public.payment_takes k
   where k.factory_withdrawal_id = w.id and k.status = 'held';
$$;
revoke all on function public.withdrawal_refunded_cents(public.factory_withdrawals) from public, anon, authenticated;
grant execute on function public.withdrawal_refunded_cents(public.factory_withdrawals) to service_role;

create or replace function public.withdrawal_on_hold_cents(w public.factory_withdrawals)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(case when p.state <> 'confirmed' or p.disputed_at is not null then k.amount_cents
                           else public.take_refunded_cents(k) end), 0)::bigint
    from public.payment_takes k
    join public.order_payments p on p.id = k.payment_id
   where k.factory_withdrawal_id = w.id and k.status = 'held';
$$;
revoke all on function public.withdrawal_on_hold_cents(public.factory_withdrawals) from public, anon, authenticated;
grant execute on function public.withdrawal_on_hold_cents(public.factory_withdrawals) to service_role;

create or replace function public.withdrawal_covered(w public.factory_withdrawals)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.factory_withdrawable(w.org_id) >= 0
     and not exists (select 1 from public.payment_takes k
                       join public.order_payments p on p.id = k.payment_id
                      where k.factory_withdrawal_id = w.id and k.status = 'held'
                        and (p.state <> 'confirmed' or p.disputed_at is not null
                             or public.take_refunded_cents(k) > 0));
$$;
revoke all on function public.withdrawal_covered(public.factory_withdrawals) from public, anon, authenticated;
grant execute on function public.withdrawal_covered(public.factory_withdrawals) to service_role;

create or replace function public.withdrawal_back_cents(w public.factory_withdrawals)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(w.pool_cents, w.amount_cents - coalesce((select sum(t.amount_cents) from public.payment_takes t
                                                             where t.factory_withdrawal_id = w.id), 0))
       -- A part still held: less what was refunded since. A part already
       -- handed back (the withdrawal just ended): what of it the step still
       -- has for the factory.
       + coalesce((select sum(case when t.status = 'held' then t.amount_cents - public.take_refunded_cents(t)
                                   when t.status = 'returned'
                                     then least(t.amount_cents, greatest(0, public.payment_factory_cents(p) - public.payment_taken_cents(p.id)))
                                   else t.amount_cents end)
                     from public.payment_takes t
                     join public.order_payments p on p.id = t.payment_id
                    where t.factory_withdrawal_id = w.id
                      and p.state = 'confirmed'
                      and not (p.refunded_at is not null and p.refunded_at > coalesce(p.confirmed_at, '-infinity'::timestamptz))), 0);
$$;
revoke all on function public.withdrawal_back_cents(public.factory_withdrawals) from public, anon, authenticated;
grant execute on function public.withdrawal_back_cents(public.factory_withdrawals) to service_role;

create or replace function public.guard_withdrawal_takes()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.status = 'requested' and new.status in ('paying', 'paid')
     and exists (select 1 from public.payment_takes k
                   join public.order_payments p on p.id = k.payment_id
                  where k.factory_withdrawal_id = new.id and k.status = 'held'
                    and (p.state <> 'confirmed' or p.disputed_at is not null
                         or public.take_refunded_cents(k) > 0)) then
    raise exception 'the factory''s balance no longer covers this' using errcode = '22023', hint = 'withdrawal_over_balance';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_withdrawal_takes() from public, anon, authenticated;
grant execute on function public.guard_withdrawal_takes() to service_role;

-- Told once per refund or lost dispute that reaches a waiting withdrawal.
create or replace function public.tell_withdrawal_refunded()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  w record;
  m public.order_milestones;
  o public.production_orders;
  lost boolean;
begin
  if not ((old.state = 'confirmed' and new.state <> 'confirmed')
          or (new.state in ('confirmed', 'released') and new.factory_refund_cents > old.factory_refund_cents)) then
    return null;
  end if;
  lost := new.dispute_lost_cents > old.dispute_lost_cents or (new.dispute_lost_at is not null and old.dispute_lost_at is null);
  select * into m from public.order_milestones where id = new.milestone_id;
  select * into o from public.production_orders where id = new.order_id;
  for w in select distinct f.* from public.factory_withdrawals f
             join public.payment_takes t on t.factory_withdrawal_id = f.id
            where t.payment_id = new.id and t.status = 'held' and f.status in ('requested', 'paying')
              and (new.state <> 'confirmed' or public.take_refunded_cents(t) > 0)
  loop
    insert into public.notifications (org_id, kind, subject_type, subject_id, title, body, data)
    values (w.org_id, 'withdrawal', 'withdrawal', w.id,
            format('Withdrawal of %s on hold', public.format_money(w.amount_cents, w.currency)),
            case when lost
                 then format('The brand''s bank reversed the payment for "%s". Cancel this withdrawal and withdraw again.',
                             coalesce(m.title, o.order_number))
                 else format('The brand''s payment for "%s" was refunded. Cancel this withdrawal and withdraw again.',
                             coalesce(m.title, o.order_number)) end,
            jsonb_build_object('amount_cents', w.amount_cents, 'currency', w.currency));
  end loop;
  return null;
end;
$$;
revoke all on function public.tell_withdrawal_refunded() from public, anon, authenticated;
grant execute on function public.tell_withdrawal_refunded() to service_role;

drop trigger if exists order_payments_tell_withdrawal_refunded on public.order_payments;
create trigger order_payments_tell_withdrawal_refunded
  after update of state, refunded_cents, dispute_lost_cents on public.order_payments
  for each row execute function public.tell_withdrawal_refunded();

-- ---------------------------------------------------------------------------
-- The factory's figures: owed to TSC inside Available; Paid out never falls.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.factory_balance(target_org uuid, target_client uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  r record;
  stripe_on_way bigint := 0;
  fw public.factory_withdrawals;
  out_withdrawals jsonb := '[]'::jsonb;
  paid_left bigint;
  open_left bigint;
  fees bigint;
  amt bigint;
  take_paid bigint;
  take_open bigint;
  rest bigint;
  mine boolean;
  out_rows jsonb := '[]'::jsonb;
  awaiting bigint := 0;
  owed_cleared bigint := 0;
  owed_clearing bigint := 0;
  owed_moving bigint := 0;
  pool_available bigint := 0;
  pool_open bigint := 0;
  pool_paid bigint := 0;
  stripe_released bigint := 0;
  other_released bigint := 0;
  taken_open bigint := 0;
  taken_paid bigint := 0;
  stripe_fees bigint := 0;
  disputed bigint := 0;
  next_at timestamptz;
  available bigint;
  pending bigint;
  processing bigint;
  paid_out bigint;
  debt bigint := 0;
  refunded_total bigint := 0;
  refund_part bigint;
begin
  if not (public.is_org_member(target_org) or public.is_platform_admin()) then
    raise exception 'not a member of this company' using errcode = '42501';
  end if;

  select coalesce(sum(coalesce(w.pool_cents, w.amount_cents)) filter (where w.status = 'paid'), 0),
         coalesce(sum(coalesce(w.pool_cents, w.amount_cents)) filter (where w.status in ('requested', 'paying')), 0),
         coalesce(sum(w.fee_cents) filter (where w.status = 'paid'), 0)
    into paid_left, open_left, fees
    from public.factory_withdrawals w
   where w.org_id = target_org and w.currency = 'USD';
  -- Stripe's payout fee, taken by reversal when the factory withdrew to its
  -- bank (api/_stripe-withdrawals.js), in US cents; a fee given back is not
  -- counted. The same rule the owner's card used to apply on its own.
  select coalesce(sum(s.fee_cents), 0) into stripe_fees
    from public.stripe_withdrawals s
   where s.org_id = target_org and s.state in ('fee_taken', 'paid_out') and s.fee_cents is not null;

  -- Pool money (P3: it stays pool money), split across every client first.
  for r in
    select p.id, greatest(p.amount_cents - p.factory_refund_cents, 0) as amount_cents, o.brand_org_id
      from public.order_payments p
      join public.production_orders o on o.id = p.order_id
     where o.factory_org_id = target_org and p.withdrawal_pool and p.currency = 'USD'
       and p.state in ('confirmed', 'released')
     order by (p.state = 'released') desc, p.release_requested_at, p.id
  loop
    amt := r.amount_cents;
    take_paid := least(amt, paid_left);
    paid_left := paid_left - take_paid;
    take_open := least(amt - take_paid, open_left);
    open_left := open_left - take_open;
    mine := target_client is null or r.brand_org_id = target_client;
    continue when not mine;
    pool_paid := pool_paid + take_paid;
    pool_open := pool_open + take_open;
    pool_available := pool_available + (amt - take_paid - take_open);
    if take_paid > 0 then
      out_rows := out_rows || jsonb_build_array(jsonb_build_object('payment_id', r.id, 'figure', 'paid_out', 'amount_cents', take_paid, 'stripe', false));
    end if;
    if take_open > 0 then
      out_rows := out_rows || jsonb_build_array(jsonb_build_object('payment_id', r.id, 'figure', 'processing', 'amount_cents', take_open, 'stripe', false));
    end if;
    if amt - take_paid - take_open > 0 then
      out_rows := out_rows || jsonb_build_array(jsonb_build_object('payment_id', r.id, 'figure', 'available', 'amount_cents', amt - take_paid - take_open, 'stripe', false));
    end if;
  end loop;
  if target_client is null then
    pool_paid := pool_paid + paid_left;
    pool_open := pool_open + open_left;
  end if;

  -- Everything else, payment by payment.
  for r in
    select p, o.status as order_status,
           public.payment_factory_cents(p) as factory_cents,
           public.payment_factory_base_cents(p) as base_cents,
           (select x.status from public.provider_payouts x where x.payment_id = p.id
             order by x.created_at desc limit 1) as attempt_status,
           -- Held by a withdrawal, less any part refunded since (that part is
           -- in no figure: its row reads Refunded, below).
           coalesce((select sum(t.amount_cents - public.take_refunded_cents(t)) from public.payment_takes t
                      where t.payment_id = p.id and t.status = 'held' and t.road = 'stripe'), 0)::bigint as held_stripe,
           coalesce((select sum(t.amount_cents - public.take_refunded_cents(t)) from public.payment_takes t
                      where t.payment_id = p.id and t.status = 'held' and t.road = 'pool'), 0)::bigint as held_pool,
           coalesce((select sum(t.amount_cents) from public.payment_takes t
                      where t.payment_id = p.id and t.status = 'sent' and t.road = 'stripe'), 0)::bigint as sent_stripe,
           -- The part of that whose Stripe payout is still on its way to the
           -- bank (the same test as the withdrawals' 'on_its_way' below).
           coalesce((select sum(t.amount_cents) from public.payment_takes t
                       join public.stripe_withdrawals s on s.id = t.stripe_withdrawal_id
                      where t.payment_id = p.id and t.status = 'sent' and t.road = 'stripe'
                        and s.state = 'paid_out' and coalesce(s.payout_status, 'pending') not in ('failed', 'canceled')
                        and (s.payout_arrives_on > (now() at time zone 'utc')::date
                             or (s.payout_arrives_on is null and coalesce(s.payout_status, 'pending') in ('pending', 'in_transit')))), 0)::bigint as sent_stripe_on_way,
           coalesce((select sum(t.amount_cents) from public.payment_takes t
                      where t.payment_id = p.id and t.status = 'sent' and t.road = 'pool'), 0)::bigint as sent_pool
      from public.order_payments p
      join public.production_orders o on o.id = p.order_id
     where o.factory_org_id = target_org and not p.withdrawal_pool and p.currency = 'USD'
       and p.state in ('confirmed', 'released')
       and (target_client is null or o.brand_org_id = target_client)
       and not (p.state = 'confirmed' and p.release_requested_at is null and o.status = 'cancelled')
       and not (p.state = 'confirmed' and p.refunded_at is not null
                and p.refunded_at > coalesce(p.confirmed_at, '-infinity'::timestamptz))
  loop
    -- Refunded to the brand, or a dispute lost, since it was funded: dated
    -- rows of their own, below zero; the step's own row is left as it was.
    -- The figures already count the step at what the factory now earns.
    if r.base_cents > r.factory_cents then
      refund_part := least(r.base_cents, coalesce(round(((r.p).refunded_cents)::numeric * (r.p).amount_cents
                       / nullif(coalesce((r.p).charged_cents, (r.p).amount_received_cents, (r.p).amount_cents), 0))::bigint, 0));
      refund_part := least(refund_part, r.base_cents - r.factory_cents);
      refunded_total := refunded_total + (r.base_cents - r.factory_cents);
      if refund_part > 0 then
        out_rows := out_rows || jsonb_build_array(jsonb_build_object('payment_id', (r.p).id, 'figure', 'refunded',
          'amount_cents', -refund_part, 'stripe', false, 'cause', 'refund', 'at', (r.p).refund_amount_at));
      end if;
      if r.base_cents - r.factory_cents - refund_part > 0 then
        out_rows := out_rows || jsonb_build_array(jsonb_build_object('payment_id', (r.p).id, 'figure', 'refunded',
          'amount_cents', -(r.base_cents - r.factory_cents - refund_part), 'stripe', false, 'cause', 'dispute_lost',
          'at', (r.p).dispute_lost_at));
      end if;
    end if;
    -- What withdrawals took.
    if r.held_stripe > 0 then
      taken_open := taken_open + r.held_stripe;
      out_rows := out_rows || jsonb_build_array(jsonb_build_object('payment_id', (r.p).id, 'figure', 'processing',
        'amount_cents', r.held_stripe, 'stripe', true, 'taken', true));
    end if;
    if r.held_pool > 0 then
      taken_open := taken_open + r.held_pool;
      out_rows := out_rows || jsonb_build_array(jsonb_build_object('payment_id', (r.p).id, 'figure', 'processing',
        'amount_cents', r.held_pool, 'stripe', false, 'taken', true));
    end if;
    if r.sent_stripe > 0 then
      stripe_released := stripe_released + r.sent_stripe;
      -- Still on its way to the bank: the row says so (its row word "On its
      -- way"); the figures are unchanged (Processing counts the payout below).
      if r.sent_stripe - r.sent_stripe_on_way > 0 then
        out_rows := out_rows || jsonb_build_array(jsonb_build_object('payment_id', (r.p).id, 'figure', 'paid_out',
          'amount_cents', r.sent_stripe - r.sent_stripe_on_way, 'stripe', true, 'taken', true));
      end if;
      if r.sent_stripe_on_way > 0 then
        out_rows := out_rows || jsonb_build_array(jsonb_build_object('payment_id', (r.p).id, 'figure', 'on_its_way',
          'amount_cents', r.sent_stripe_on_way, 'stripe', true, 'taken', true));
      end if;
    end if;
    if r.sent_pool > 0 then
      taken_paid := taken_paid + r.sent_pool;
      out_rows := out_rows || jsonb_build_array(jsonb_build_object('payment_id', (r.p).id, 'figure', 'paid_out',
        'amount_cents', r.sent_pool, 'stripe', false, 'taken', true));
    end if;
    rest := r.factory_cents - r.held_stripe - r.held_pool - r.sent_stripe - r.sent_pool;

    if (r.p).state = 'released' then
      -- Released by withdrawals: their takes said it all. Released the old
      -- way (a transfer or a payout per step): the whole step.
      if r.held_stripe + r.held_pool + r.sent_stripe + r.sent_pool = 0 then
        -- What was sent then: Paid out never falls when it is refunded later
        -- (that part is owed to TSC, below).
        if (r.p).stripe_transfer_id is not null then
          stripe_released := stripe_released + r.base_cents;
        else
          other_released := other_released + r.base_cents;
        end if;
        out_rows := out_rows || jsonb_build_array(jsonb_build_object('payment_id', (r.p).id, 'figure', 'paid_out',
          'amount_cents', r.base_cents, 'stripe', (r.p).stripe_transfer_id is not null));
      end if;
    elsif (r.p).release_requested_at is null then
      awaiting := awaiting + r.factory_cents;
      out_rows := out_rows || jsonb_build_array(jsonb_build_object('payment_id', (r.p).id, 'figure', 'awaiting',
        'amount_cents', r.factory_cents, 'stripe', false));
    elsif rest <= 0 then
      null;
    -- Moving, or staff's to settle: an earlier version's Stripe release, a
    -- claim, a Wise / PayPal payout per step under way, or a disputed charge.
    elsif (r.p).stripe_release_started or (r.p).release_claimed_at is not null
          or r.attempt_status = 'processing' or (r.p).disputed_at is not null then
      owed_moving := owed_moving + rest;
      -- A disputed charge's step is held: never "available on" any date.
      if (r.p).disputed_at is not null then
        disputed := disputed + rest;
      end if;
      out_rows := out_rows || jsonb_build_array(jsonb_build_object('payment_id', (r.p).id, 'figure', case when (r.p).disputed_at is not null then 'pending' else 'processing' end,
        'amount_cents', rest, 'stripe', false, 'held', (r.p).disputed_at is not null,
        'held_reason', case when (r.p).disputed_at is not null then 'disputed' end));
    elsif public.payment_cleared(r.p) then
      owed_cleared := owed_cleared + rest;
      out_rows := out_rows || jsonb_build_array(jsonb_build_object('payment_id', (r.p).id, 'figure', 'available',
        'amount_cents', rest, 'stripe', false));
    else
      owed_clearing := owed_clearing + rest;
      next_at := least(coalesce(next_at, public.payment_clears_at(r.p)), public.payment_clears_at(r.p));
      out_rows := out_rows || jsonb_build_array(jsonb_build_object('payment_id', (r.p).id, 'figure', 'pending',
        'amount_cents', rest, 'stripe', false, 'clears_at', public.payment_clears_at(r.p)));
    end if;
  end loop;

  -- A part a waiting withdrawal holds on a step refunded since (in full the
  -- old way, or in part: take_refunded_cents): that money went back to the
  -- brand, so it is in no figure (not earnings, never "on hold"); its row
  -- reads Refunded. Cancelling or declining the withdrawal gives back only
  -- the rest.
  for r in
    select t.payment_id, public.take_refunded_cents(t) as amount_cents, t.road
      from public.payment_takes t
      join public.order_payments p on p.id = t.payment_id
      join public.production_orders o on o.id = p.order_id
     where t.org_id = target_org and t.status = 'held' and p.currency = 'USD'
       and (target_client is null or o.brand_org_id = target_client)
  loop
    continue when r.amount_cents <= 0;
    out_rows := out_rows || jsonb_build_array(jsonb_build_object('payment_id', r.payment_id, 'figure', 'refunded',
      'amount_cents', r.amount_cents, 'stripe', r.road = 'stripe', 'taken', true, 'refunded', true));
  end loop;

  -- Money that had already left TSC when it was refunded: owed to TSC,
  -- taken off Available (which can go below zero). Paid out is unchanged.
  debt := public.factory_debt_cents(target_org, target_client);

  if target_client is not null then
    fees := 0;
    stripe_fees := 0;
  end if;
  -- Every withdrawal, as the factory's list shows it, in the US dollars it
  -- took from the balance (a Stripe one: the amount asked less its fee, never
  -- a re-conversion of the payout). A Stripe payout is on its way (Pending)
  -- until its arrival day, then Paid out; withdrawals span clients, so a
  -- client's view has none.
  if target_client is null then
    for r in
      select s.id, s.state, s.payout_status, s.payout_arrives_on, s.destination_label, s.created_at, s.fee_cents,
             case when s.usd_cents is not null then s.usd_cents - coalesce(s.fee_cents, 0)
                  when upper(s.currency) = 'USD' then s.amount_minor - coalesce(s.fee_cents, 0) end as net_cents,
             s.payout_minor, s.currency
        from public.stripe_withdrawals s
       where s.org_id = target_org and s.state in ('paid_out', 'refused', 'fee_returned')
    loop
      out_withdrawals := out_withdrawals || jsonb_build_array(jsonb_build_object(
        'id', r.id, 'road', 'stripe', 'created_at', r.created_at, 'to', r.destination_label,
        'amount_cents', r.net_cents, 'fee_cents', r.fee_cents,
        'receives_minor', r.payout_minor, 'receives_currency', upper(r.currency),
        'arrives_on', r.payout_arrives_on,
        'word', case
          when r.state <> 'paid_out' or r.payout_status in ('failed', 'canceled') then 'returned'
          when r.payout_arrives_on > (now() at time zone 'utc')::date
               or (r.payout_arrives_on is null and coalesce(r.payout_status, 'pending') in ('pending', 'in_transit'))
            then 'on_its_way'
          else 'paid' end));
      if r.state = 'paid_out' and coalesce(r.payout_status, 'pending') not in ('failed', 'canceled')
         and (r.payout_arrives_on > (now() at time zone 'utc')::date
              or (r.payout_arrives_on is null and coalesce(r.payout_status, 'pending') in ('pending', 'in_transit'))) then
        stripe_on_way := stripe_on_way + coalesce(r.net_cents, 0);
      end if;
    end loop;
    for fw in
      select w.* from public.factory_withdrawals w where w.org_id = target_org and w.currency = 'USD'
    loop
      out_withdrawals := out_withdrawals || jsonb_build_array(jsonb_build_object(
        'id', fw.id, 'road', 'pool', 'provider', fw.provider, 'created_at', fw.created_at, 'to', fw.paid_to,
        'amount_cents', fw.amount_cents, 'fee_cents', fw.fee_cents,
        'receives_minor', fw.receives_minor, 'receives_currency', fw.receives_currency,
        'word', case
          when fw.status = 'requested' then case when public.withdrawal_covered(fw) then 'waiting' else 'on_hold' end
          when fw.status = 'paying' then 'on_its_way'
          when fw.status = 'paid' then 'paid'
          else 'returned' end,
        -- A waiting request part of which is on a step disputed since: that
        -- part is on hold; on a step refunded since: that part is refunded
        -- (gone back to the brand, in no figure); the rest still waiting.
        -- Other states: one part, the whole amount.
        'parts', case
          when fw.status = 'requested' and public.withdrawal_on_hold_cents(fw) > 0 then
            (case when fw.amount_cents - public.withdrawal_on_hold_cents(fw) > 0
                  then jsonb_build_array(jsonb_build_object('word', 'waiting', 'amount_cents', fw.amount_cents - public.withdrawal_on_hold_cents(fw)))
                  else '[]'::jsonb end)
            || (case when public.withdrawal_on_hold_cents(fw) - public.withdrawal_refunded_cents(fw) > 0
                  then jsonb_build_array(jsonb_build_object('word', 'on_hold', 'amount_cents', public.withdrawal_on_hold_cents(fw) - public.withdrawal_refunded_cents(fw)))
                  else '[]'::jsonb end)
            || (case when public.withdrawal_refunded_cents(fw) > 0
                  then jsonb_build_array(jsonb_build_object('word', 'refunded', 'amount_cents', public.withdrawal_refunded_cents(fw)))
                  else '[]'::jsonb end)
          else jsonb_build_array(jsonb_build_object('word', case
            when fw.status = 'requested' then case when public.withdrawal_covered(fw) then 'waiting' else 'on_hold' end
            when fw.status = 'paying' then 'on_its_way'
            when fw.status = 'paid' then 'paid'
            else 'returned' end, 'amount_cents', fw.amount_cents)) end));
    end loop;
  end if;

  available := owed_cleared + pool_available - debt;
  -- Pending: earnings not yet available (card payments clearing, disputed
  -- steps). Processing: withdrawals asked for or being sent (and old
  -- step-by-step payouts under way): no longer earnings to wait for.
  pending := owed_clearing + disputed;
  processing := (owed_moving - disputed) + pool_open + taken_open + stripe_on_way;
  paid_out := stripe_released + other_released + pool_paid + taken_paid - fees - stripe_fees - stripe_on_way;

  return jsonb_build_object(
    'currency', 'USD',
    'client', target_client,
    'awaiting_cents', awaiting,
    'available_cents', available,
    'pending_cents', pending,
    'processing_cents', processing,
    'paid_out_cents', paid_out,
    'owed_to_tsc_cents', debt,
    'refunded_cents', refunded_total,
    'total_cents', awaiting + available + pending + processing + paid_out,
    'has_method', public.factory_can_withdraw(target_org),
    'next_cleared_at', next_at,
    'parts', jsonb_build_object(
      'owed_cleared_cents', owed_cleared,
      'owed_clearing_cents', owed_clearing,
      'owed_moving_cents', owed_moving,
      'pool_available_cents', pool_available,
      'pool_open_cents', pool_open,
      'pool_paid_cents', pool_paid,
      'taken_open_cents', taken_open,
      'taken_paid_cents', taken_paid,
      'withdrawal_fees_cents', fees,
      'stripe_withdrawal_fees_cents', stripe_fees,
      'disputed_cents', disputed,
      'stripe_on_way_cents', stripe_on_way,
      'stripe_released_cents', stripe_released,
      'other_released_cents', other_released,
      'owed_to_tsc_cents', debt),
    'rows', out_rows,
    'withdrawals', out_withdrawals
  );
end;
$function$;
revoke all on function public.factory_balance(uuid, uuid) from public, anon;
grant execute on function public.factory_balance(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Recording refunds. A refund TSC itself made in full (a stray intent, a
-- cancelled order's held money) and any full refund before approval keep
-- their path: back to Due (the brand pays again), or cancelled on a
-- cancelled order. Anything after approval is an amount
-- (record_payment_refund_amount): the step stays done.
-- ---------------------------------------------------------------------------
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

-- What Stripe says was refunded on the payment's charge, in all
-- (charge.amount_refunded). Never refunds anything itself. The same total
-- again changes nothing; a larger one is recorded and told; a smaller one (a
-- refund that failed) is recorded quietly.
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

  if total = p.refunded_cents then
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
            format('Refund to the brand on "%s"', coalesce(m.title, o.order_number)),
            format('%s less in your earnings from %s.', public.format_money(p.factory_refund_cents - was_share, p.currency), o.order_number)
            || case when now_debt > was_debt
                    then format(' You had already withdrawn %s of it.', public.format_money(now_debt - was_debt, p.currency))
                    else '' end);
  end if;
  return p;
end;
$$;
revoke all on function public.record_payment_refund_amount(uuid, text, bigint) from public, anon, authenticated;
grant execute on function public.record_payment_refund_amount(uuid, text, bigint) to service_role;

-- A dispute the brand's bank decided against TSC: the disputed amount went
-- back to the brand, as a refund would. Before approval the brand pays
-- again; after, the step stays done and the factory's earning goes down.
-- Stripe's dispute fee is TSC's. Once per payment.
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
     or exists (select 1 from public.payment_events e where e.payment_id = p.id and e.note like 'Dispute lost%' || ref) then
    return p;
  end if;
  charged := coalesce(p.charged_cents, p.amount_received_cents, p.amount_cents);
  lost := least(coalesce(lost_cents, charged, 0), greatest(coalesce(charged, 0) - p.refunded_cents, 0));
  select * into m from public.order_milestones where id = p.milestone_id;

  if was = 'confirmed' and p.release_requested_at is null then
    -- Before approval: as a full refund. The brand pays again.
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

  -- After approval: the step stays done; its earning goes down by the
  -- factory's part, and what had already left is owed to TSC.
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

-- A lost dispute is never on hold again (a later read of the charge still
-- says "disputed").
create or replace function public.record_payment_disputed(target_payment uuid, disputed boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare p public.order_payments;
begin
  update public.order_payments
     set disputed_at = case when disputed then coalesce(disputed_at, now()) end
   where id = target_payment
     and (disputed_at is null) = disputed
     and dispute_lost_at is null
  returning * into p;
  if found then
    perform public.tell_payment_hold(p, disputed);
  end if;
end;
$$;
revoke all on function public.record_payment_disputed(uuid, boolean) from public, anon, authenticated;
grant execute on function public.record_payment_disputed(uuid, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- Staff: a debt to recover is on Needs checking, and counted on the overview.
-- ---------------------------------------------------------------------------
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
            jsonb_build_array(case when p.stripe_transfer_id is not null then 'stripe' else 'bank' end)),
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
     + jsonb_array_length(attention -> 'recover'),
    (select count(*)::integer from public.admin_verification_queue() q
      where q.submitted_at >= date_trunc('day', now()));
end;
$function$;
revoke all on function public.admin_overview_metrics() from public, anon;
grant execute on function public.admin_overview_metrics() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Words this PR made untrue under one balance.
-- ---------------------------------------------------------------------------
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
      raise exception 'fund "%" first: the step amount is added to the factory''s balance when you approve',
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
             public.format_money(p.amount_cents, p.currency),
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
$function$
;
revoke all on function public.approve_milestone(uuid, text) from public, anon;
grant execute on function public.approve_milestone(uuid, text) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.choose_payout_method(target_org uuid, target_account uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  a public.factory_payout_accounts;
  was_stripe boolean;
  new_primary boolean := false;
  what text;
begin
  if not public.is_org_owner(target_org) then
    raise exception 'Only a company owner can change the default withdrawal method.' using errcode='42501';
  end if;
  -- This is the same row lock acquired by both provider claims.
  perform 1 from public.stripe_connect_accounts where org_id=target_org for update;
  was_stripe := public.uses_stripe_payout(target_org);
  if target_account is null then
    if not exists (select 1 from public.stripe_connect_accounts s where s.org_id=target_org and s.transfers_active) then
      raise exception 'Finish bank-account verification before choosing it as the default.' using errcode='22023';
    end if;
    -- New: what is owed on the saved method stays there, in the balance,
    -- instead of being paid a second time through Stripe.
    if not was_stripe then
      perform public.join_owed_to_pool(target_org);
    end if;
  else
    select * into a from public.factory_payout_accounts where id=target_account and org_id=target_org;
    if not found or a.method not in ('bank','paypal') then
      raise exception 'Choose a saved bank transfer or PayPal account for this company.' using errcode='22023';
    end if;
    if (a.method='bank' and (nullif(btrim(a.account_name),'') is null or nullif(btrim(a.bank_name),'') is null or a.number_changed_at is null))
       or (a.method='paypal' and nullif(btrim(a.paypal_email),'') is null) then
      raise exception 'Complete the withdrawal details before choosing this method.' using errcode='22023';
    end if;
    new_primary := not a.is_primary;
    if new_primary then perform public.set_primary_payout_account(target_account); end if;
  end if;
  insert into public.factory_payout_preferences(org_id,route) values(target_org,case when target_account is null then 'stripe' else 'manual' end)
    on conflict(org_id) do update set route=excluded.route, changed_at=now();
  if was_stripe is distinct from (target_account is null) and not new_primary then
    what := case
      when target_account is null then 'Your connected payout account is now your default withdrawal method.'
      when a.method = 'paypal' then format('PayPal account %s is now your default withdrawal method.', a.paypal_email)
      else format('Your bank account at %s%s is now your default withdrawal method.', a.bank_name,
        case when a.account_number_last4 is not null then format(' ending %s', a.account_number_last4) else '' end)
    end;
    insert into public.notifications (org_id, kind, title, body)
    values (target_org, 'payout_method_changed', 'Your payout methods changed',
      what || ' If nobody at your company made this change, email operations@contact.sourcing-club.com now.');
  end if;
end; $function$
;
revoke all on function public.choose_payout_method(uuid, uuid) from public, anon;
grant execute on function public.choose_payout_method(uuid, uuid) to authenticated, service_role;
