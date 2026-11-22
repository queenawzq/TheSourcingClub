-- One balance, fix round 37.
--
-- M-1  Staff's To recover rows add up to what the factory's earnings do not
--      cover when it has several debts: the oldest debts are taken as covered
--      first, so the rows' shares add up to the uncovered amount, as the card
--      and the Withdrawals row say it.
-- M-2  The factory's "Withdrawal of $X on hold" notice and guard_withdrawal_takes'
--      detail say the uncovered amount too.
-- L-3  A withdrawal returned after it was paid: record_withdrawal_returned()
--      gives back what came back. The whole amount unless the provider states
--      less (Wise's refund_amount; a Swift bank may keep a part): the part it
--      kept stays sent (it left TSC) and counts like a fee, so the factory
--      bears it (it pays withdrawal fees; TSC absorbs none).
-- L-6  factory_withdrawals.read_back_at: when the board's sync last read a paid
--      withdrawal back, so each sync reads the ones read longest ago.
--
-- Additive: new columns and functions; CREATE OR REPLACE keeps every grant;
-- latest full bodies; no overloads.

alter table public.factory_withdrawals add column if not exists kept_cents bigint;
alter table public.factory_withdrawals add column if not exists read_back_at timestamptz;
alter table public.factory_withdrawals drop constraint if exists factory_withdrawals_kept_check;
alter table public.factory_withdrawals add constraint factory_withdrawals_kept_check
  check (kept_cents is null or (kept_cents >= 0 and kept_cents <= amount_cents and returned_at is not null));

-- L-3. A PayPal / Wise withdrawal the provider returned after it was recorded
-- paid (20261121380000's branch of record_withdrawal), giving back what came
-- back. came_back: what the provider returned to TSC, in the withdrawal's
-- currency; null when it does not say, taken as the whole amount (Wise refunds
-- its fee; only a Swift bank keeps a part, and Wise then states it). What it
-- kept stays sent (on the newest parts first) and counts like a fee
-- (factory_balance).
create or replace function public.record_withdrawal_returned(target_withdrawal uuid, came_back bigint default null, sentence text default null)
returns public.factory_withdrawals
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  w public.factory_withdrawals;
  t record;
  k record;
  kept bigint;
  kept_left bigint;
  back_amount bigint;
  told text;
  back_ids uuid[] := '{}';
  back_parts bigint[] := '{}';
  extra bigint;
  part bigint;
begin
  -- The company first, the lock every claim on its money takes.
  perform 1 from public.orgs where id = (select x.org_id from public.factory_withdrawals x where x.id = target_withdrawal)
    for no key update;
  select * into w from public.factory_withdrawals where id = target_withdrawal for update;
  if not found then
    raise exception 'withdrawal not found' using errcode = 'P0002';
  end if;
  -- Already recorded as come back whole, then the provider states it gave
  -- back less (Wise's transfers#refund arriving after its state change): what
  -- it kept leaves the parts handed back, newest first, as it would have the
  -- first time. Only while nothing has been claimed from the company's
  -- earnings since (otherwise staff see the return in Needs checking).
  if w.status = 'failed' and w.returned_at is not null and came_back is not null then
    extra := (w.amount_cents - least(w.amount_cents, greatest(0, came_back))) - coalesce(w.kept_cents, 0);
    if extra <= 0 or exists (select 1 from public.payment_takes x where x.org_id = w.org_id and x.created_at > w.returned_at) then
      return w;
    end if;
    kept_left := extra;
    for t in select x.* from public.payment_takes x
              where x.factory_withdrawal_id = w.id and x.status = 'returned'
              order by x.created_at desc, x.id desc for update
    loop
      exit when kept_left <= 0;
      part := least(kept_left, t.amount_cents);
      update public.payment_takes set status = 'sent', amount_cents = part, updated_at = now() where id = t.id;
      perform public.release_fully_taken(t.payment_id, null);
      kept_left := kept_left - part;
    end loop;
    update public.factory_withdrawals
       set kept_cents = coalesce(kept_cents, 0) + extra - kept_left,
           back_cents = greatest(0, coalesce(back_cents, 0) - (extra - kept_left)), updated_at = now()
     where id = w.id returning * into w;
    perform public.withdrawal_notice(w,
      format('Withdrawal of %s did not go through', public.format_money(w.amount_cents, w.currency)),
      format('%s kept %s of it.',
             case w.provider when 'paypal' then 'PayPal' when 'wise' then 'Wise' else 'The payout provider' end,
             public.format_money(extra - kept_left, w.currency)));
    return w;
  end if;
  -- Only a paid one comes back; a repeat finds it failed and does nothing.
  if w.status <> 'paid' then
    return w;
  end if;
  kept := w.amount_cents - least(w.amount_cents, greatest(0, coalesce(came_back, w.amount_cents)));
  kept_left := kept;
  -- What came back is not sent any more; what the provider kept is.
  for t in select x.* from public.payment_takes x
            where x.factory_withdrawal_id = w.id and x.status = 'sent'
            order by x.created_at desc, x.id desc for update
  loop
    if kept_left >= t.amount_cents then
      kept_left := kept_left - t.amount_cents;
    elsif kept_left > 0 then
      update public.payment_takes set amount_cents = kept_left, updated_at = now() where id = t.id;
      back_ids := back_ids || t.payment_id;
      back_parts := back_parts || (t.amount_cents - kept_left);
      kept_left := 0;
    else
      update public.payment_takes set status = 'returned', updated_at = now() where id = t.id;
      back_ids := back_ids || t.payment_id;
      back_parts := back_parts || t.amount_cents;
    end if;
  end loop;
  -- A step released because withdrawals took all of it is owed again.
  for k in select distinct x.payment_id from public.payment_takes x where x.factory_withdrawal_id = w.id loop
    perform public.reopen_untaken_step(k.payment_id);
  end loop;
  update public.factory_withdrawals
     -- paid_at is for a paid row only (factory_withdrawals_check); returned_at says when it came back.
     set status = 'failed', paid_at = null, lease_until = null, returned_at = now(), updated_at = now(), kept_cents = kept,
         staff_sentence = coalesce(sentence, staff_sentence),
         reason = coalesce(sentence, 'This withdrawal did not go through.')
   where id = w.id returning * into w;
  -- What came back to the balance: the parts handed back, as far as their
  -- steps are still the factory's (a part refunded to the brand since is not).
  back_amount := coalesce((
    select sum(least(r.part, greatest(0, public.payment_factory_cents(p) - public.payment_taken_cents(p.id))))
      from unnest(back_ids, back_parts) r(payment_id, part)
      join public.order_payments p on p.id = r.payment_id
     where p.state = 'confirmed'), 0)::bigint;
  told := case
            when back_amount >= w.amount_cents then 'The amount is back in your balance.'
            when back_amount > 0 then format('%s is back in your balance.', public.format_money(back_amount, w.currency))
            when kept >= w.amount_cents then ''
            -- Refunded or reversed to the brand (20261121260000).
            else 'This amount was returned to the brand.'
          end
          || case when kept > 0
                  then format(' %s kept %s of it.',
                              case w.provider when 'paypal' then 'PayPal' when 'wise' then 'Wise' else 'The payout provider' end,
                              public.format_money(kept, w.currency))
                  else '' end;
  update public.factory_withdrawals set back_cents = greatest(back_amount, 0)
   where id = w.id returning * into w;
  perform public.withdrawal_notice(w,
    format('Withdrawal of %s did not go through', public.format_money(w.amount_cents, w.currency)),
    btrim(told) || case when back_amount > 0 then ' Check your withdrawal method, then withdraw again.' else '' end);
  return w;
end;
$$;
revoke all on function public.record_withdrawal_returned(uuid, bigint, text) from public, anon, authenticated;
grant execute on function public.record_withdrawal_returned(uuid, bigint, text) to service_role;

-- L-3 ------------------------------------------------------------------------
-- 20261121380000's body; a return after Paid is record_withdrawal_returned's.
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
  back_amount bigint;
begin
  -- The company first, the lock every claim on its money takes (a returned
  -- withdrawal gives its parts back to the balance, below).
  perform 1 from public.orgs where id = (select x.org_id from public.factory_withdrawals x where x.id = target_withdrawal)
    for no key update;
  select * into w from public.factory_withdrawals where id = target_withdrawal for update;
  if not found then
    raise exception 'withdrawal not found' using errcode = 'P0002';
  end if;
  -- Returned by the provider after it was recorded paid (Wise bounced_back,
  -- funds_refunded, charged_back; PayPal RETURNED, REFUNDED, REVERSED): the
  -- money is back with TSC, so it is back in the factory's balance. What was
  -- sent of each step is not sent any more, a step released because
  -- withdrawals took all of it is owed again, and Paid out drops by it
  -- (20261121380000). Told in the failure's own words.
  -- Returned by the provider after it was recorded paid: what came back is
  -- not known here, so the whole amount is taken to have come back
  -- (record_withdrawal_returned, 20261121385000).
  if w.status = 'paid' and outcome = 'failed' then
    return public.record_withdrawal_returned(w.id, null, sentence);
  end if;
  if w.status in ('paid', 'failed', 'declined', 'cancelled') then
    return w;
  end if;
  -- Before anything moves (20261121290000): the part that went back to the
  -- brand while it was being sent, and what a failure gives back.
  gone := coalesce(public.withdrawal_refunded_cents(w), 0);
  back := public.withdrawal_back_sentence(w);
  back_amount := public.withdrawal_back_cents(w);
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
    -- Fully withdrawn steps are released by follow_withdrawal_takes().
    perform public.withdrawal_notice(w,
      format('%s paid out to you', public.format_money(coalesce(w.receives_minor, w.amount_cents), coalesce(w.receives_currency, w.currency))),
      case when w.fee_cents is not null and w.receives_minor is not null then
        format('Sent to %s. Payout fee %s is taken from this payment: you receive %s.', w.paid_to, public.format_money(w.fee_cents, w.currency),
               public.format_money(w.receives_minor, coalesce(w.receives_currency, w.currency)))
      else format('Sent to %s.', w.paid_to) end
      -- Part of it went back to the brand while it was being sent: that part
      -- is now owed to TSC (To recover) (20261121290000).
      || case when w.status = 'paid' and gone > 0
              then format(' You now owe TSC %s, the part returned to the brand after it was sent.', public.format_money(gone, w.currency))
              else '' end);
  elsif outcome = 'failed' then
    update public.factory_withdrawals
       set status = 'failed', lease_until = null, reason = coalesce(sentence, 'This withdrawal did not go through.'), updated_at = now(),
           -- What came back, kept as it was at this moment (20261121300000).
           back_cents = greatest(back_amount, 0)
     where id = w.id returning * into w;
    perform public.withdrawal_notice(w,
      format('Withdrawal of %s did not go through', public.format_money(w.amount_cents, w.currency)),
      -- What came back, never more: part or all of it may have gone back to
      -- the brand while it was being sent (20261121290000).
      case when back_amount > 0 then back || ' Check your withdrawal method, then withdraw again.' else back end);
  else
    raise exception 'unknown outcome' using errcode = '22023';
  end if;
  return w;
end;
$function$;


-- 20261121380000's body; a provider's kept part is a fee.
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
  fees bigint;
  rest bigint;
  out_rows jsonb := '[]'::jsonb;
  awaiting bigint := 0;
  owed_cleared bigint := 0;
  owed_clearing bigint := 0;
  owed_moving bigint := 0;
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

  -- What a provider kept of a withdrawal it returned after it was paid counts
  -- like a fee: the factory bears it (20261121385000).
  select coalesce(sum(w.fee_cents) filter (where w.status = 'paid'), 0)
         + coalesce(sum(w.kept_cents) filter (where w.status = 'failed' and w.returned_at is not null), 0)
    into fees
    from public.factory_withdrawals w
   where w.org_id = target_org and w.currency = 'USD';
  -- Stripe's payout fee, taken by reversal when the factory withdrew to its
  -- bank (api/_stripe-withdrawals.js), in US cents; a fee given back is not
  -- counted. The same rule the owner's card used to apply on its own.
  select coalesce(sum(s.fee_cents), 0) into stripe_fees
    from public.stripe_withdrawals s
   where s.org_id = target_org and s.state in ('fee_taken', 'paid_out') and s.fee_cents is not null;

  -- Payment by payment (the old pool was turned into takes, 20261121350000).
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
     where o.factory_org_id = target_org and p.currency = 'USD'
       and p.state in ('confirmed', 'released')
       and (target_client is null or o.brand_org_id = target_client)
       and not (p.state = 'confirmed' and p.release_requested_at is null and o.status = 'cancelled')
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
      -- (A step withdrawals released whose parts all came back sent nothing.)
      if r.held_stripe + r.held_pool + r.sent_stripe + r.sent_pool = 0
         and not ((r.p).released_note = 'Withdrawn'
                  and exists (select 1 from public.payment_takes t where t.payment_id = (r.p).id and t.status = 'returned')) then
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

  -- An old pool step refunded in full after a withdrawal took it, reset to be
  -- paid again (20261121350000): what was sent stays Paid out, and is owed to
  -- TSC (factory_debt_cents, below) until the brand pays the step again.
  for r in
    select p.id, p.refunded_at, sum(t.amount_cents)::bigint as sent
      from public.payment_takes t
      join public.order_payments p on p.id = t.payment_id
      join public.production_orders o on o.id = p.order_id
     where o.factory_org_id = target_org and p.currency = 'USD' and t.status = 'sent'
       and p.state not in ('confirmed', 'released')
       and (target_client is null or o.brand_org_id = target_client)
     group by p.id, p.refunded_at
  loop
    taken_paid := taken_paid + r.sent;
    refunded_total := refunded_total + r.sent;
    out_rows := out_rows || jsonb_build_array(
      jsonb_build_object('payment_id', r.id, 'figure', 'paid_out', 'amount_cents', r.sent, 'stripe', false, 'taken', true),
      jsonb_build_object('payment_id', r.id, 'figure', 'refunded', 'amount_cents', -r.sent, 'stripe', false,
                         'cause', 'refund', 'at', r.refunded_at));
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
        -- As kept when it failed (20261121300000), never recomputed.
        'back_cents', case when fw.status = 'failed' then fw.back_cents end,
        -- Returned after it was paid: what the provider kept (20261121385000).
        'kept_cents', case when fw.returned_at is not null then fw.kept_cents end,
        -- What sent its refunded part back to the brand: 'reversed' when the
        -- brand's bank took part of it (a lost dispute), else 'refunded'
        -- (20261121260000). Null when nothing went back.
        'refund_cause', case
          when fw.status not in ('requested', 'paying') or public.withdrawal_refunded_cents(fw) <= 0 then null
          when exists (select 1 from public.payment_takes k join public.order_payments p on p.id = k.payment_id
                        where k.factory_withdrawal_id = fw.id and k.status = 'held' and p.dispute_lost_cents > 0
                          and public.take_refunded_cents(k) > 0)
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

  available := owed_cleared - debt;
  -- Pending: earnings not yet available (card payments clearing, disputed
  -- steps). Processing: withdrawals asked for or being sent (and old
  -- step-by-step payouts under way): no longer earnings to wait for.
  pending := owed_clearing + disputed;
  processing := (owed_moving - disputed) + taken_open + stripe_on_way;
  paid_out := stripe_released + other_released + taken_paid - fees - stripe_fees - stripe_on_way;

  return jsonb_build_object(
    'currency', 'USD',
    'client', target_client,
    'awaiting_cents', awaiting,
    'available_cents', available,
    'pending_cents', pending,
    'processing_cents', processing,
    'paid_out_cents', paid_out,
    'owed_to_tsc_cents', debt,
    -- What its earnings do not cover: the card's "You owe TSC" line; gone
    -- once they do (20261121380000).
    'uncovered_debt_cents', case when target_client is null then public.factory_debt_uncovered_cents(target_org)
                                 else least(debt, public.factory_debt_uncovered_cents(target_org)) end,
    'refunded_cents', refunded_total,
    'total_cents', awaiting + available + pending + processing + paid_out,
    'has_method', public.factory_can_withdraw(target_org),
    -- The one rule for "Add a withdrawal method": the notices' own
    -- (factory_has_no_saved_method), read by the card and the order page
    -- (20261121380000).
    'no_saved_method', public.factory_has_no_saved_method(target_org),
    'next_cleared_at', next_at,
    'parts', jsonb_build_object(
      'owed_cleared_cents', owed_cleared,
      'owed_clearing_cents', owed_clearing,
      'owed_moving_cents', owed_moving,
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


-- M-1, L-1, L-7 -------------------------------------------------------------
-- 20261121380000's body.
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
       where p.state = 'confirmed' and p.release_requested_at is not null and p.disputed_at is not null), '[]'::jsonb),
    -- Refunded to the brand (or a dispute lost) after the factory had
    -- withdrawn it: TSC paid that money twice. Staff cannot be notified, so
    -- this list is the only prompt. Where it went, and what the factory's
    -- balance is now (Available, net of what it owes).
    'recover', coalesce((
      -- What earnings do not cover, split across the debts: the oldest debts
      -- are taken as covered first, so the rows add up to the uncovered amount,
      -- as the card and the Withdrawals row say it (20261121385000).
      select jsonb_agg(z.row || jsonb_build_object('amount_cents', z.share) order by z.at nulls last) from (
        select y.row, y.at,
               y.debt - least(y.debt, greatest(0, y.covered - y.before)) as share
          from (
            select x.row, x.at, x.debt,
                   coalesce(sum(x.debt) over (partition by x.org order by x.cover_at, x.pid
                                              rows between unbounded preceding and 1 preceding), 0) as before,
                   sum(x.debt) over (partition by x.org) - x.uncovered as covered
              from (
                select o.factory_org_id as org, p.id as pid,
                       coalesce(greatest(p.refund_amount_at, p.dispute_lost_at), p.refunded_at, p.created_at) as cover_at,
                       public.payment_debt_cents(p) as debt,
                       public.factory_debt_uncovered_cents(o.factory_org_id) as uncovered,
                       coalesce(greatest(p.refund_amount_at, p.dispute_lost_at), p.refunded_at) as at, jsonb_build_object(
                  'payment_id', p.id, 'org_id', o.factory_org_id, 'order_id', o.id, 'order_number', o.order_number,
                  'factory_name', f.name, 'brand_name', b.name, 'milestone_title', m.title, 'currency', p.currency,
                  'cause', case when p.dispute_lost_cents > 0 and p.refund_amount_at is null then 'dispute_lost'
                                when p.dispute_lost_cents > 0 and p.dispute_lost_at > p.refund_amount_at then 'dispute_lost'
                                else 'refund' end,
                  'at', coalesce(greatest(p.refund_amount_at, p.dispute_lost_at), p.refunded_at),
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
                 where p.currency = 'USD'
                   -- and an old pool step refunded in full after it was withdrawn (20261121350000)
                   and (p.factory_refund_cents > 0
                        or exists (select 1 from public.payment_takes t where t.payment_id = p.id and t.status = 'sent'))
                   and public.payment_debt_cents(p) > 0
                   -- Only while its earnings do not cover it: covered, it is netted
                   -- from Available and there is nothing to recover.
                   and public.factory_debt_uncovered_cents(o.factory_org_id) > 0
              ) x
          ) y
      ) z where z.share > 0), '[]'::jsonb),
    -- A PayPal / Wise withdrawal the provider returned after it was recorded
    -- paid: the amount is back in the factory's balance; staff check why with
    -- the provider and the factory. Until the factory withdraws again, for
    -- 14 days (20261121380000).
    'returned', coalesce((
      select jsonb_agg(jsonb_build_object(
        'withdrawal_id', w.id, 'org_id', w.org_id, 'factory_name', f.name, 'provider', w.provider,
        'amount_cents', w.amount_cents, 'currency', w.currency, 'back_cents', w.back_cents,
        'paid_to', w.paid_to, 'provider_ref', w.provider_ref, 'reason', w.reason,
        'at', w.returned_at) order by w.returned_at)
        from public.factory_withdrawals w
        join public.orgs f on f.id = w.org_id
       where w.returned_at is not null and w.returned_at > now() - interval '14 days'
         and not exists (select 1 from public.factory_withdrawals later
                          where later.org_id = w.org_id and later.created_at > w.returned_at)), '[]'::jsonb),
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
           -- Stopped half-way: still open 15 minutes after it was asked for
           -- (a withdrawal takes seconds). Not keyed on updated_at or the
           -- lease: every try to settle it bumps them, so a row that never
           -- settles stayed off the board (20261121320000).
           (s.state in ('claimed', 'fee_taken') and s.created_at < now() - interval '15 minutes')
           -- Parts still held by a withdrawal that ended or stalled.
           or exists (select 1 from public.payment_takes t where t.stripe_withdrawal_id = s.id and t.status = 'held'
                       and t.created_at < now() - interval '15 minutes')
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


-- M-2, L-2 ------------------------------------------------------------------
-- 20261121370000's body.
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
  gone bigint;
  owed text;
begin
  -- Converting the old pool changes no figure: nothing to tell (20261121350000).
  if current_setting('tsc.pool_convert', true) = 'on' then
    return null;
  end if;
  if not ((old.state = 'confirmed' and new.state <> 'confirmed')
          or (new.state in ('confirmed', 'released') and new.factory_refund_cents > old.factory_refund_cents)) then
    return null;
  end if;
  lost := new.dispute_lost_cents > old.dispute_lost_cents or (new.dispute_lost_at is not null and old.dispute_lost_at is null);
  select * into m from public.order_milestones where id = new.milestone_id;
  select * into o from public.production_orders where id = new.order_id;
  -- A debt with no lost dispute behind it is a refund: an old pool step
  -- refunded in full after it was withdrawn and reset to be paid again keeps
  -- no record of the refund on the payment (20261121370000).
  select coalesce(bool_or(x.refunded_cents > 0 or x.dispute_lost_cents = 0), false),
         coalesce(bool_or(x.dispute_lost_cents > 0), false)
    into debt_refund, debt_lost
    from public.order_payments x
    join public.production_orders xo on xo.id = x.order_id
   where xo.factory_org_id = o.factory_org_id
     and x.currency = 'USD'
     and public.payment_debt_cents(x) > 0;
  -- Each open withdrawal this leaves uncovered, told once: one holding part
  -- of this step, and any waiting one while the factory owes TSC more than
  -- its other earnings (20261121210000).
  for w in select f.* from public.factory_withdrawals f
            where f.status in ('requested', 'paying')
              and (exists (select 1 from public.payment_takes t
                            where t.factory_withdrawal_id = f.id and t.payment_id = new.id and t.status = 'held'
                              and (new.state <> 'confirmed' or public.take_refunded_cents(t) > 0))
                   or (f.org_id = o.factory_org_id and f.status = 'requested'
                       and public.factory_debt_uncovered_cents(o.factory_org_id) > 0))
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
      -- All that went back so far, told whenever it grows (20261121290000).
      gone := coalesce((select sum(public.take_refunded_cents(t)) from public.payment_takes t
                         where t.factory_withdrawal_id = w.id and t.status = 'held'), 0)::bigint;
      if gone > 0 and not exists (select 1 from public.notifications n
                                   where n.org_id = w.org_id and n.kind = 'withdrawal' and n.subject_id = w.id
                                     and n.title like '% being checked' and coalesce((n.data ->> 'gone_cents')::bigint, 0) >= gone) then
        insert into public.notifications (org_id, kind, subject_type, subject_id, title, body, data)
        values (w.org_id, 'withdrawal', 'withdrawal', w.id,
                format('Withdrawal of %s being checked', public.format_money(w.amount_cents, w.currency)),
                format('%s of it was returned to the brand after it was sent. TSC is checking this withdrawal.', public.format_money(gone, w.currency)),
                jsonb_build_object('amount_cents', w.amount_cents, 'currency', w.currency, 'gone_cents', gone));
      end if;
      continue;
    end if;
    -- On hold only because of the debt (nothing it holds was refunded): it
    -- says what is owed, and never to withdraw again (20261121230000).
    -- What its earnings do not cover: the card's line, To recover and the
    -- Withdrawals row say the same amount (20261121385000).
    owed := public.format_money(public.factory_debt_uncovered_cents(w.org_id), 'USD');
    owes := not exists (select 1 from public.payment_takes t
                         where t.factory_withdrawal_id = w.id and t.payment_id = new.id and t.status = 'held'
                           and (new.state <> 'confirmed' or public.take_refunded_cents(t) > 0));
    insert into public.notifications (org_id, kind, subject_type, subject_id, title, body, data)
    values (w.org_id, 'withdrawal', 'withdrawal', w.id,
            format('Withdrawal of %s on hold', public.format_money(w.amount_cents, w.currency)),
            -- The debt's own cause, from the payments that carry it: a
            -- refund, a lost dispute, or both (20261121240000).
            case when owes and not debt_refund
                 then format('You owe TSC %s for a payment the brand''s bank reversed after you withdrew it. This withdrawal is on hold until your earnings cover that amount.', owed)
                 when owes and not debt_lost
                 then format('You owe TSC %s for a payment refunded after you withdrew it. This withdrawal is on hold until your earnings cover that amount.', owed)
                 when owes
                 then format('You owe TSC %s for money returned to the brand after you withdrew it. This withdrawal is on hold until your earnings cover that amount.', owed)
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


-- 20261121230000's body.
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
    -- What its earnings do not cover, as claim_withdrawal says it (20261121385000).
    raise exception 'the factory owes TSC %', public.format_money(public.factory_debt_uncovered_cents(new.org_id), 'USD')
      using errcode = '22023', hint = 'withdrawal_owes_tsc', detail = public.format_money(public.factory_debt_uncovered_cents(new.org_id), 'USD');
  end if;
  return new;
end;
$function$;


-- CREATE OR REPLACE kept the grants of record_withdrawal, factory_balance,
-- admin_balance_attention, tell_withdrawal_refunded and guard_withdrawal_takes.
