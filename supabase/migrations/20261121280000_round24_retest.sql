-- One balance, fix round 24 (re-test of 5e30cb5a).
--
-- * Part of a withdrawal staff already sent (paying) went back to the brand
--   (a refund or a lost dispute): the factory reads what it still holds and
--   that part, and is told TSC is checking it (it cannot cancel it); staff
--   see the amount at risk on its row. If the payout completes, the sent part
--   becomes a debt (To recover); if it comes back, what returns is what it
--   still holds.
-- * Approving a partly refunded step says the amount actually added.
-- * "Make default" notices in the approved words.
-- * A method whose provider is switched off cannot be made the default.
--
-- Full latest bodies plus the change; grants re-applied exactly; no overloads.

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
                   from public.factory_withdrawals f where f.org_id = target_org and f.status = 'requested'), 0));
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
                               where n.org_id = f.org_id and n.kind = 'withdrawal' and n.subject_id = f.id
                                 and (n.title like '% on hold' or n.title like '% being checked'))
  loop
    -- Already sent to the provider: the factory cannot cancel it. Said as it
    -- is: part of it went back to the brand, and TSC is checking it (staff see
    -- the amount at risk on its row) (20261121280000).
    if w.status = 'paying' then
      insert into public.notifications (org_id, kind, subject_type, subject_id, title, body, data)
      values (w.org_id, 'withdrawal', 'withdrawal', w.id,
              format('Withdrawal of %s being checked', public.format_money(w.amount_cents, w.currency)),
              format('%s of it went back to the brand after it was sent. TSC is checking this withdrawal.',
                     public.format_money(coalesce((select sum(public.take_refunded_cents(t)) from public.payment_takes t
                                                    where t.factory_withdrawal_id = w.id and t.status = 'held'), 0)::bigint, w.currency)),
              jsonb_build_object('amount_cents', w.amount_cents, 'currency', w.currency));
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
        -- The part that went back to the brand since it was asked (a refund or
        -- a lost dispute): the row shows what it still holds, and while it is
        -- being sent, the amount at risk (20261121280000).
        'refunded_cents', case when w.status in ('requested', 'paying') then public.withdrawal_refunded_cents(w) else 0 end,
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
             public.format_money(greatest(p.amount_cents - p.factory_refund_cents, 0), p.currency),
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

create or replace function public.notify_paypal_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  org uuid := coalesce(new.org_id, old.org_id);
  what text;
begin
  if coalesce(auth.role(), '') <> 'authenticated' then
    return null;
  end if;

  if tg_op = 'INSERT' and new.method = 'paypal' then
    what := format('PayPal account %s was added.', new.paypal_email);
  elsif tg_op = 'DELETE' and old.method = 'paypal' then
    what := format('PayPal account %s was removed.', old.paypal_email);
  elsif tg_op = 'UPDATE' and new.method = 'paypal' then
    if new.paypal_email is distinct from old.paypal_email then
      what := format('The PayPal account changed from %s to %s.', coalesce(old.paypal_email, 'none'), new.paypal_email);
    elsif new.is_primary and not old.is_primary then
      what := format('PayPal account %s is now your default withdrawal method.', new.paypal_email);
    end if;
  end if;

  if what is not null and exists (select 1 from public.orgs where id = org) then
    insert into public.notifications (org_id, kind, title, body)
    values (org, 'payout_method_changed', 'Your payout methods changed',
      what || ' If nobody at your company made this change, email operations@contact.sourcing-club.com now.');
  end if;
  return null;
end;
$$;

revoke all on function public.notify_paypal_change() from public, anon, authenticated;

create or replace function public.notify_default_bank_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  org uuid := coalesce(new.org_id, old.org_id);
  what text;
  named text;
begin
  if coalesce(auth.role(), '') <> 'authenticated' then
    return null;
  end if;
  if not exists (select 1 from public.orgs where id = org) then
    return null;
  end if;

  if tg_op <> 'DELETE' and new.method = 'bank' and new.is_primary
     and (tg_op = 'INSERT' or not old.is_primary or old.method <> 'bank') then
    -- It may have lost the default again before the transaction ended.
    if not exists (
      select 1 from public.factory_payout_accounts where id = new.id and is_primary
    ) then
      return null;
    end if;
    named := new.bank_name || case when new.account_number_last4 is not null
      then format(' ending %s', new.account_number_last4) else '' end;
    if exists (
      select 1 from public.notifications n
       where n.org_id = org and n.kind = 'payout_method_changed' and n.created_at = now()
         and starts_with(n.body, format('TSC now pays your bank account at %s, instead of Payoneer account', named))
    ) then
      return null;
    end if;
    -- New: while Stripe pays, this bank is only saved. (The route is read at
    -- commit, so choose_payout_method's own change counts.)
    what := case when public.uses_stripe_payout(org)
      then format('Your bank account at %s was saved.', named)
      else format('Your bank account at %s is now your default withdrawal method.', named) end;

  elsif tg_op = 'UPDATE' and new.method = 'bank' and new.is_primary and old.is_primary and old.method = 'bank'
        and (new.bank_name, new.account_name, new.account_number_last4, new.swift, new.branch,
             new.bank_country, new.instructions, new.number_changed_at,
             new.wise_details, new.wise_number_key, new.wise_currency, new.wise_recipient_type)
            is distinct from
            (old.bank_name, old.account_name, old.account_number_last4, old.swift, old.branch,
             old.bank_country, old.instructions, old.number_changed_at,
             old.wise_details, old.wise_number_key, old.wise_currency, old.wise_recipient_type) then
    named := new.bank_name || case when new.account_number_last4 is not null
      then format(' ending %s', new.account_number_last4) else '' end;
    what := format(case when public.uses_stripe_payout(org)
      then 'Your saved bank account changed: it is now %s, in the name of %s.'
      else 'The bank account TSC pays changed: it is now %s, in the name of %s.' end, named, new.account_name);

  -- New: a row that was another method and is now a bank, default or not.
  elsif tg_op = 'UPDATE' and new.method = 'bank' and old.method <> 'bank' then
    named := new.bank_name || case when new.account_number_last4 is not null
      then format(' ending %s', new.account_number_last4) else '' end;
    what := format('Your bank account at %s replaced a withdrawal method.', named);

  elsif old.method = 'bank' and old.is_primary
        and (tg_op = 'DELETE' or not new.is_primary or new.method <> 'bank')
        and not exists (select 1 from public.factory_payout_accounts where org_id = org and is_primary) then
    named := old.bank_name || case when old.account_number_last4 is not null
      then format(' ending %s', old.account_number_last4) else '' end;
    what := case when public.uses_stripe_payout(org)
      then format('Your bank account at %s was removed.', named)
      else format('TSC no longer pays your bank account at %s, and you have no default payout method.', named) end;
  end if;

  if what is not null then
    insert into public.notifications (org_id, kind, title, body)
    values (org, 'payout_method_changed', 'Your payout methods changed',
      what || ' If nobody at your company made this change, email operations@contact.sourcing-club.com now.');
  end if;
  return null;
end;
$$;
revoke all on function public.notify_default_bank_change() from public, anon, authenticated;

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
    -- Its provider is switched off for the factory's country: not a default
    -- anyone could withdraw to (20261121280000).
    if public.withdrawal_provider_for(a) in ('paypal', 'wise')
       and not public.payout_provider_enabled_for_account(a, public.withdrawal_provider_for(a)) then
      raise exception 'This withdrawal method isn''t available right now.' using errcode='22023', hint='withdrawal_provider_off';
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
