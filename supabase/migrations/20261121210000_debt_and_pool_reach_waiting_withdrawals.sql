-- One balance, fix round 17b: a debt to TSC and a shrunken old pool also
-- reach the withdrawals already waiting.
--
-- * A PayPal / Wise withdrawal already waiting when a debt appears (money
--   refunded after the factory withdrew it, 20261121200000) is not paid while
--   the debt is more than the factory's other earnings can cover:
--   claim_withdrawal refuses it with the amount (hint withdrawal_owes_tsc), the
--   staff board says so before Pay, and the factory's withdrawal reads On
--   hold, told once, as for any withdrawal its balance no longer covers.
-- * An old-pool payment refunded while a pool withdrawal waits: the part of
--   the withdrawal the pool no longer holds reads Refunded and leaves
--   Processing and Total, as a refunded owed step's part does. Open
--   withdrawals keep the pool in order (being paid first, then oldest first);
--   the newest is the one short.
--
-- Full prior bodies (live stack at 880978ad) plus the change; grants
-- re-applied exactly; no overloads.

-- What the factory owes TSC beyond everything else it could still withdraw
-- (other owed steps cleared, and the old pool's own money): while above zero,
-- no withdrawal is paid.
create or replace function public.factory_debt_uncovered_cents(target_org uuid)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select greatest(0::bigint, -(greatest(public.factory_withdrawable(target_org), 0)
                               + (public.owed_reachable(target_org) ->> 'any_cents')::bigint));
$$;
revoke all on function public.factory_debt_uncovered_cents(uuid) from public, anon, authenticated;
grant execute on function public.factory_debt_uncovered_cents(uuid) to service_role;

-- The part of a waiting withdrawal's old-pool money that the pool no longer
-- holds (its payments refunded since). Pool money left after what was paid
-- goes to open withdrawals in order: being paid first, then oldest first.
-- Also read for one just cancelled (what goes back), as if still waiting.
create or replace function public.withdrawal_pool_refunded_cents(w public.factory_withdrawals)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when w.currency <> 'USD' or w.status not in ('requested', 'cancelled') or coalesce(w.pool_cents, w.amount_cents) <= 0 then 0::bigint
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
                       and (f.status = 'paying'
                            or (f.status = 'requested' and (f.created_at, f.id) < (w.created_at, w.id)))), 0) as ahead) x;
$$;
revoke all on function public.withdrawal_pool_refunded_cents(public.factory_withdrawals) from public, anon, authenticated;
grant execute on function public.withdrawal_pool_refunded_cents(public.factory_withdrawals) to service_role;

CREATE OR REPLACE FUNCTION public.withdrawal_refunded_cents(w factory_withdrawals)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- The part of withdrawal_on_hold_cents() on a step whose charge went back
  -- to the brand (refunded, or a dispute lost): not the factory's any more.
  select coalesce((select sum(public.take_refunded_cents(k)) from public.payment_takes k
                     where k.factory_withdrawal_id = w.id and k.status = 'held'), 0)::bigint
       -- and the old pool's part the pool no longer holds (20261121210000)
       + public.withdrawal_pool_refunded_cents(w);
$function$;
revoke all on function public.withdrawal_refunded_cents(public.factory_withdrawals) from public, anon, authenticated;
grant execute on function public.withdrawal_refunded_cents(public.factory_withdrawals) to service_role;

CREATE OR REPLACE FUNCTION public.withdrawal_on_hold_cents(w factory_withdrawals)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select (select coalesce(sum(case when p.state <> 'confirmed' or p.disputed_at is not null then k.amount_cents
                           else public.take_refunded_cents(k) end), 0)::bigint
    from public.payment_takes k
    join public.order_payments p on p.id = k.payment_id
   where k.factory_withdrawal_id = w.id and k.status = 'held')
       + public.withdrawal_pool_refunded_cents(w);
$function$;
revoke all on function public.withdrawal_on_hold_cents(public.factory_withdrawals) from public, anon, authenticated;
grant execute on function public.withdrawal_on_hold_cents(public.factory_withdrawals) to service_role;

CREATE OR REPLACE FUNCTION public.withdrawal_back_cents(w factory_withdrawals)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(w.pool_cents, w.amount_cents - coalesce((select sum(t.amount_cents) from public.payment_takes t
                                                             where t.factory_withdrawal_id = w.id), 0))
       -- less the old pool's part it no longer holds (20261121210000)
       - public.withdrawal_pool_refunded_cents(w)
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
$function$;
revoke all on function public.withdrawal_back_cents(public.factory_withdrawals) from public, anon, authenticated;
grant execute on function public.withdrawal_back_cents(public.factory_withdrawals) to service_role;

CREATE OR REPLACE FUNCTION public.withdrawal_covered(w factory_withdrawals)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select public.factory_withdrawable(w.org_id) >= 0
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

CREATE OR REPLACE FUNCTION public.guard_withdrawal_takes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
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
    raise exception 'the factory owes TSC %', public.format_money(public.factory_debt_uncovered_cents(new.org_id), 'USD')
      using errcode = '22023', hint = 'withdrawal_owes_tsc', detail = public.format_money(public.factory_debt_uncovered_cents(new.org_id), 'USD');
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
  -- This request is counted in the balance, so what is left must not be negative.
  if public.factory_withdrawable(w.org_id) < 0 then
    raise exception 'the factory''s balance no longer covers this' using errcode = '22023', hint = 'withdrawal_over_balance';
  end if;
  -- Money refunded after the factory withdrew it, more than its other
  -- earnings cover: TSC recovers it before paying anything more
  -- (20261121210000). The amount travels in detail, for staff's sentence.
  if not resumed and public.factory_debt_uncovered_cents(w.org_id) > 0 then
    raise exception 'the factory owes TSC %', public.format_money(public.factory_debt_uncovered_cents(w.org_id), 'USD')
      using errcode = '22023', hint = 'withdrawal_owes_tsc', detail = public.format_money(public.factory_debt_uncovered_cents(w.org_id), 'USD');
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
        'owes_tsc_cents', case when w.status = 'requested' then public.factory_debt_uncovered_cents(w.org_id) else 0 end
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
  for w in select f.* from public.factory_withdrawals f
            where f.status in ('requested', 'paying')
              and (exists (select 1 from public.payment_takes t
                            where t.factory_withdrawal_id = f.id and t.payment_id = new.id and t.status = 'held'
                              and (new.state <> 'confirmed' or public.take_refunded_cents(t) > 0))
                   or (f.org_id = o.factory_org_id and f.status = 'requested'
                       and (public.withdrawal_pool_refunded_cents(f) > 0 or public.factory_debt_uncovered_cents(o.factory_org_id) > 0)))
              and not exists (select 1 from public.notifications n
                               where n.org_id = f.org_id and n.kind = 'withdrawal' and n.subject_id = f.id and n.title like '% on hold')
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
$function$;
revoke all on function public.tell_withdrawal_refunded() from public, anon, authenticated;
grant execute on function public.tell_withdrawal_refunded() to service_role;

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
