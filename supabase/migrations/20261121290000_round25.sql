-- One balance, fix round 25 (money review of round 24).
--
-- * A payout that fails after part of it went back to the brand says what
--   came back, never "the amount is back" (record_withdrawal, the card).
-- * A payout that completes after part went back tells the factory it now
--   owes TSC that part.
-- * "Being checked" is told for each new amount that goes back while a
--   payout is being sent, also after an earlier "on hold".
-- * The old pool's part of a payout being sent is counted when it goes back.
-- * Removing the default never makes a switched-off PayPal / Wise method the
--   default.
--
-- Full latest bodies plus the change; grants re-applied exactly; one new
-- function (payout_account_usable); no overloads.

create or replace function public.withdrawal_pool_refunded_cents(w public.factory_withdrawals)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    -- Being sent too (20261121290000): its part the pool no longer holds went
    -- back to the brand while it was sent.
    when w.currency <> 'USD' or w.status not in ('requested', 'cancelled', 'paying') or coalesce(w.pool_cents, w.amount_cents) <= 0 then 0::bigint
    else greatest(0::bigint, coalesce(w.pool_cents, w.amount_cents) - greatest(0::bigint, x.held - x.ahead))
  end
  from (select
          coalesce((select sum(greatest(p.amount_cents - p.factory_refund_cents, 0)) from public.order_payments p
                      join public.production_orders o on o.id = p.order_id
                     where o.factory_org_id = w.org_id and p.withdrawal_pool and p.currency = 'USD'
                       and p.state in ('confirmed', 'released')), 0)
          - coalesce((select sum(coalesce(f.pool_cents, f.amount_cents)) from public.factory_withdrawals f
                       where f.org_id = w.org_id and f.currency = 'USD' and f.status = 'paid'), 0) as held,
          coalesce((select sum(coalesce(f.pool_cents, f.amount_cents)) from public.factory_withdrawals f
                     where f.org_id = w.org_id and f.currency = 'USD' and f.id <> w.id
                       -- One being sent goes first; among those being sent, the older.
                       and ((f.status = 'paying' and (w.status <> 'paying' or (f.created_at, f.id) < (w.created_at, w.id)))
                            or (f.status = 'requested' and w.status <> 'paying' and (f.created_at, f.id) < (w.created_at, w.id)))), 0) as ahead) x;
$$;
revoke all on function public.withdrawal_pool_refunded_cents(public.factory_withdrawals) from public, anon, authenticated;
grant execute on function public.withdrawal_pool_refunded_cents(public.factory_withdrawals) to service_role;

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
    -- Open requests beyond what the pool still holds (its payments refunded
    -- since): that part is Refunded, in no figure (20261121210000).
    pool_open := pool_open + greatest(0, open_left - coalesce((select sum(public.withdrawal_pool_refunded_cents(f))
                   from public.factory_withdrawals f where f.org_id = target_org and f.status in ('requested', 'paying')), 0));
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
        -- A failed one: what came back to the balance (the rest went to the
        -- brand), for the card's line (20261121290000).
        'back_cents', case when fw.status = 'failed' then public.withdrawal_back_cents(fw) end,
        -- What sent its refunded part back to the brand: 'reversed' when the
        -- brand's bank took part of it (a lost dispute), else 'refunded'
        -- (20261121260000). Null when nothing went back.
        'refund_cause', case
          when fw.status not in ('requested', 'paying') or public.withdrawal_refunded_cents(fw) <= 0 then null
          when exists (select 1 from public.payment_takes k join public.order_payments p on p.id = k.payment_id
                        where k.factory_withdrawal_id = fw.id and k.status = 'held' and p.dispute_lost_cents > 0
                          and public.take_refunded_cents(k) > 0)
            or (public.withdrawal_pool_refunded_cents(fw) > 0
                and exists (select 1 from public.order_payments p join public.production_orders o on o.id = p.order_id
                             where o.factory_org_id = fw.org_id and p.withdrawal_pool and p.dispute_lost_cents > 0))
            then 'reversed'
          else 'refunded' end,
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
          -- Being sent, part of which went back to the brand since (a refund or
          -- a lost dispute): what it still holds, and that part (20261121280000).
          when fw.status = 'paying' and public.withdrawal_refunded_cents(fw) > 0 then
            (case when fw.amount_cents - public.withdrawal_refunded_cents(fw) > 0
                  then jsonb_build_array(jsonb_build_object('word', 'on_its_way', 'amount_cents', fw.amount_cents - public.withdrawal_refunded_cents(fw)))
                  else '[]'::jsonb end)
            || jsonb_build_array(jsonb_build_object('word', 'refunded', 'amount_cents', public.withdrawal_refunded_cents(fw)))
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
  gone bigint;
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
                   or (f.org_id = o.factory_org_id and f.status = 'paying' and public.withdrawal_pool_refunded_cents(f) > 0)
                   or (f.org_id = o.factory_org_id and f.status = 'requested'
                       and (public.withdrawal_pool_refunded_cents(f) > 0 or public.factory_debt_uncovered_cents(o.factory_org_id) > 0)))
              -- Waiting: told once that it is on hold. Being sent: told again
              -- for each new amount that goes back (below).
              and (f.status = 'paying'
                   or not exists (select 1 from public.notifications n
                                   where n.org_id = f.org_id and n.kind = 'withdrawal' and n.subject_id = f.id
                                     and (n.title like '% on hold' or n.title like '% being checked')))
  loop
    -- Already sent to the provider: the factory cannot cancel it. Said as it
    -- is: part of it went back to the brand, and TSC is checking it (staff see
    -- the amount at risk on its row) (20261121280000).
    if w.status = 'paying' then
      -- All that went back so far (its steps' parts and its old-pool part),
      -- told whenever it grows (20261121290000).
      gone := coalesce((select sum(public.take_refunded_cents(t)) from public.payment_takes t
                         where t.factory_withdrawal_id = w.id and t.status = 'held'), 0)::bigint + w.pool_short_cents;
      if gone > 0 and not exists (select 1 from public.notifications n
                                   where n.org_id = w.org_id and n.kind = 'withdrawal' and n.subject_id = w.id
                                     and n.title like '% being checked' and coalesce((n.data ->> 'gone_cents')::bigint, 0) >= gone) then
        insert into public.notifications (org_id, kind, subject_type, subject_id, title, body, data)
        values (w.org_id, 'withdrawal', 'withdrawal', w.id,
                format('Withdrawal of %s being checked', public.format_money(w.amount_cents, w.currency)),
                format('%s of it went back to the brand after it was sent. TSC is checking this withdrawal.', public.format_money(gone, w.currency)),
                jsonb_build_object('amount_cents', w.amount_cents, 'currency', w.currency, 'gone_cents', gone));
      end if;
      continue;
    end if;
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
                 then format('You owe TSC %s for a payment the brand''s bank reversed after you withdrew it. This withdrawal is on hold until your earnings cover that amount.',
                             public.format_money(public.factory_debt_cents(w.org_id), 'USD'))
                 when owes and not debt_lost
                 then format('You owe TSC %s for a payment refunded after you withdrew it. This withdrawal is on hold until your earnings cover that amount.',
                             public.format_money(public.factory_debt_cents(w.org_id), 'USD'))
                 when owes
                 then format('You owe TSC %s for money returned to the brand after you withdrew it. This withdrawal is on hold until your earnings cover that amount.',
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

CREATE OR REPLACE FUNCTION public.record_withdrawal(target_withdrawal uuid, outcome text, ref text DEFAULT NULL::text, fee bigint DEFAULT NULL::bigint, receives bigint DEFAULT NULL::bigint, receives_in character DEFAULT NULL::bpchar, sentence text DEFAULT NULL::text)
 RETURNS factory_withdrawals
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  w public.factory_withdrawals;
  gone bigint := 0;
  back text;
  back_cents bigint;
begin
  select * into w from public.factory_withdrawals where id = target_withdrawal for update;
  if not found then
    raise exception 'withdrawal not found' using errcode = 'P0002';
  end if;
  if w.status in ('paid', 'failed', 'declined', 'cancelled') then
    return w;
  end if;
  -- Before anything moves (20261121290000): the part that went back to the
  -- brand while it was being sent, and what a failure gives back.
  gone := coalesce(public.withdrawal_refunded_cents(w), 0);
  back := public.withdrawal_back_sentence(w);
  back_cents := public.withdrawal_back_cents(w);
  update public.factory_withdrawals
     set provider_ref = coalesce(ref, provider_ref),
         fee_cents = coalesce(fee, fee_cents),
         receives_minor = coalesce(receives, receives_minor),
         receives_currency = coalesce(receives_in, receives_currency),
         staff_sentence = coalesce(sentence, staff_sentence),
         updated_at = now()
   where id = w.id returning * into w;
  if outcome = 'sent' then
    -- The provider has it: pressing again only reads it back, so it need not wait.
    if w.provider_ref is not null then
      update public.factory_withdrawals set lease_until = null where id = w.id returning * into w;
    end if;
    return w;
  elsif outcome = 'requeue' then
    if w.provider_ref is not null then
      raise exception 'the provider has this one: it cannot go back to waiting' using errcode = '22023';
    end if;
    -- A new key: the next press must not be answered with this attempt's refusal.
    update public.factory_withdrawals
       set status = 'requested', lease_until = null, attempt_key = gen_random_uuid(), updated_at = now()
     where id = w.id returning * into w;
  elsif outcome = 'paid' then
    update public.factory_withdrawals set status = 'paid', paid_at = now(), lease_until = null, updated_at = now()
     where id = w.id returning * into w;
    perform public.release_withdrawn_payments(w.org_id, w.decided_by);
    perform public.withdrawal_notice(w,
      format('%s paid out to you', public.format_money(coalesce(w.receives_minor, w.amount_cents), coalesce(w.receives_currency, w.currency))),
      case when w.fee_cents is not null and w.receives_minor is not null then
        format('Sent to %s. Payout fee %s is taken from this payment: you receive %s.', w.paid_to, public.format_money(w.fee_cents, w.currency),
               public.format_money(w.receives_minor, coalesce(w.receives_currency, w.currency)))
      else format('Sent to %s.', w.paid_to) end
      -- Part of it went back to the brand while it was being sent: that part
      -- is now owed to TSC (To recover) (20261121290000).
      || case when w.status = 'paid' and gone > 0
              then format(' You now owe TSC %s, the part that went back to the brand after it was sent.', public.format_money(gone, w.currency))
              else '' end);
  elsif outcome = 'failed' then
    update public.factory_withdrawals
       set status = 'failed', lease_until = null, reason = coalesce(sentence, 'This withdrawal did not go through.'), updated_at = now()
     where id = w.id returning * into w;
    perform public.withdrawal_notice(w,
      format('Withdrawal of %s did not go through', public.format_money(w.amount_cents, w.currency)),
      -- What came back, never more: part or all of it may have gone back to
      -- the brand while it was being sent (20261121290000).
      case when back_cents > 0 then back || ' Check your withdrawal method, then withdraw again.' else back end);
  else
    raise exception 'unknown outcome' using errcode = '22023';
  end if;
  return w;
end;
$function$;
revoke all on function public.record_withdrawal(uuid, text, text, bigint, bigint, char, text) from public, anon, authenticated;
grant execute on function public.record_withdrawal(uuid, text, text, bigint, bigint, char, text) to service_role;

-- Whether a saved method can be withdrawn to: its provider (PayPal, Wise) is
-- switched on for the factory's country. A plain bank account is usable.
-- For remove_payout_account, which runs as the caller; it answers only for
-- the caller's own company's methods (20261121290000).
create or replace function public.payout_account_usable(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select public.withdrawal_provider_for(a) is null
        or public.withdrawal_provider_for(a) not in ('paypal', 'wise')
        or public.payout_provider_enabled_for_account(a, public.withdrawal_provider_for(a))
      from public.factory_payout_accounts a
     where a.id = target and (public.is_org_member(a.org_id) or coalesce(auth.role(), '') = 'service_role')), false);
$$;
revoke all on function public.payout_account_usable(uuid) from public, anon;
grant execute on function public.payout_account_usable(uuid) to authenticated, service_role;

create or replace function public.remove_payout_account(target uuid, promote uuid default null)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  owner_org uuid;
  was_primary boolean;
  next_primary uuid;
begin
  select org_id, is_primary into owner_org, was_primary
    from public.factory_payout_accounts where id = target;
  if owner_org is null then
    raise exception 'that bank account does not exist' using errcode = 'P0002';
  end if;
  if not public.is_org_owner(owner_org) then
    raise exception 'only an owner removes a payout account' using errcode = '42501';
  end if;

  if was_primary then
    -- The one chosen, else the most recently added of the others; never one
    -- whose provider is switched off (20261121290000).
    select a.id into next_primary
      from public.factory_payout_accounts a
     where a.org_id = owner_org and a.id <> target and public.payout_account_usable(a.id)
     order by (a.id = promote) desc, a.created_at desc
     limit 1;
    if next_primary is not null then
      update public.factory_payout_accounts set is_primary = false where id = target;
      update public.factory_payout_accounts set is_primary = true where id = next_primary;
    elsif exists (select 1 from public.factory_payout_accounts a where a.org_id = owner_org and a.id <> target) then
      -- Only switched-off methods are left: none becomes the default, and
      -- earnings wait in the balance until a usable one is added or chosen.
      -- (The last method going is unchanged: the delete guard tidies up.)
      update public.factory_payout_accounts set is_primary = false where id = target;
    end if;
  end if;

  delete from public.factory_payout_accounts where id = target;
  return next_primary;
end;
$$;
revoke all on function public.remove_payout_account(uuid, uuid) from public, anon;
grant execute on function public.remove_payout_account(uuid, uuid) to authenticated;
