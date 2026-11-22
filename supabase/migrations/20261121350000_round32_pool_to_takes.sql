-- One balance, fix round 32: the old withdrawal pool becomes takes.
--
-- Stage 1 stopped adding money to the pool (order_payments.withdrawal_pool),
-- but every read still shared the pool out to withdrawals on the fly, first
-- in, first out, in four different ways. Here each pool payment is turned
-- into the payment_takes model once, and the pool's own code goes:
--
--   * Paid withdrawals take the pool payments in the order factory_balance()
--     used (released first, then by approval), each payment at what it was
--     worth to the pool (amount less the factory's part of any refund): those
--     takes are 'sent'. Open withdrawals (being sent first, then waiting,
--     oldest first) take what is left: 'held'. A withdrawal the pool did not
--     cover (refunded since) takes the refunded room of a payment, so the
--     takes model reads that part as owed to TSC (paid) or as refunded
--     (waiting), as the pool did. What no withdrawal took stays on its payment
--     as ordinary owed money in the balance.
--   * A pool step the brand was refunded in full (or lost a dispute on)
--     after a withdrawal took it was reset to be paid again (failed, or
--     cancelled with its order). The pool counted it as nothing, so what was
--     withdrawn from it is owed to TSC: those takes go on that step, and
--     payment_debt_cents() reads every 'sent' take on a step that holds no
--     money as owed, until the brand pays the step again and it covers them,
--     as the pool did. Anything beyond every step goes on the last one, so the
--     debt stays what the pool said.
--   * A payment fully withdrawn is released (release_fully_taken).
--   * withdrawal_pool becomes false and factory_withdrawals.pool_cents 0 on
--     every row. Both columns stay (the live site selects withdrawal_pool
--     while this deploys) and are deprecated: nothing reads them any more.
--   * Every company's figures are read before and after, by the functions
--     of each moment. Compared: Total, Awaiting approval, Processing, Paid
--     out, owed to TSC, and Available and Pending together. Not the split
--     between those two: the pool called every step Available, the balance
--     calls a step still clearing or disputed Pending (funds_available_at and
--     disputed_at are new here). The migration stops only if one of those
--     differs, which no state of the pool can cause.
--
-- Then the pool branches leave the latest bodies (factory_balance, the
-- withdrawal rules, the staff lists, the notices), with the dead code the
-- review named: withdrawn_by_payment() and my_withdrawal_balance().pool_cents
-- (.pool and .withdrawn stay one deploy, deprecated, for the live site's
-- Withdraw button), return_take() (no caller), return_stripe_takes()
-- (the stripe_withdrawals_end_takes trigger does the same on the update that
-- always follows), the always-zero pool term, and the refunded_at >
-- confirmed_at tests (no writer leaves such a row confirmed). Dropped:
-- withdrawal_pool_refunded_cents, factory_withdrawable,
-- release_withdrawn_payments, withdrawn_by_payment, return_take,
-- return_stripe_takes, join_withdrawal_pool, guard_withdrawal_pool and
-- guard_provider_payout_pool with their triggers. Kept for one deploy because
-- the live site calls them: join_owed_to_pool() (already does nothing) and
-- mark_withdrawal_paid_by_bank() (production has no bank withdrawal waiting;
-- this site no longer offers it). stripe_withdrawals.fee_currency is never
-- read or written: deprecated.
--
-- Full latest bodies plus the change; CREATE OR REPLACE keeps each grant;
-- no overloads.

-- ---------------------------------------------------------------------------
-- 1. Figures before, read by the old functions.
-- ---------------------------------------------------------------------------
create function pg_temp.r32_figures(org uuid, client uuid) returns jsonb
language plpgsql as $$
declare who uuid; j jsonb;
begin
  select user_id into who from public.platform_admins order by created_at limit 1;
  if who is null then
    select user_id into who from public.org_members where org_id = org limit 1;
  end if;
  if who is null then
    raise exception 'round 32: nobody can read the balance of %', org;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, false);
  j := public.factory_balance(org, client);
  perform set_config('request.jwt.claims', '', false);
  return jsonb_build_object('awaiting', j -> 'awaiting_cents', 'available', j -> 'available_cents',
    'pending', j -> 'pending_cents', 'processing', j -> 'processing_cents', 'paid_out', j -> 'paid_out_cents',
    'owed_to_tsc', j -> 'owed_to_tsc_cents', 'total', j -> 'total_cents');
end;
$$;

create temporary table r32_orgs on commit drop as
  select distinct o.factory_org_id as org_id
    from public.order_payments p join public.production_orders o on o.id = p.order_id
   where p.withdrawal_pool;
create temporary table r32_before on commit drop as
  select org_id, null::uuid as client, pg_temp.r32_figures(org_id, null) as figures from r32_orgs
  union all
  select distinct x.org_id, o.brand_org_id, pg_temp.r32_figures(x.org_id, o.brand_org_id)
    from r32_orgs x join public.production_orders o on o.factory_org_id = x.org_id;

-- ---------------------------------------------------------------------------
-- 2. The pool becomes takes.
-- ---------------------------------------------------------------------------
drop trigger if exists order_payments_guard_withdrawal_pool on public.order_payments;
drop trigger if exists provider_payouts_guard_pool on public.provider_payouts;

-- Every pool payment, every company: what is converted, in the pool's own
-- order. Nothing is told (no figure changes). Returns the payments converted.
-- Kept after this migration (it then finds nothing) so the conversion can be
-- tested on fixtures.
create or replace function public.convert_withdrawal_pool()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  f record;
  w record;
  ids uuid[];
  net bigint[];
  room bigint[];
  gone uuid[];
  gone_room bigint[];
  converted uuid[] := '{}';
  n int;
  g int;
  i_net int;
  i_room int;
  i_gone int;
  last_step uuid;
  need bigint;
  take bigint;
  last_at timestamptz;
  at timestamptz;
begin
  -- Recorded as they stand (the take guard asks that a new take be claimable
  -- now), and nothing new is told.
  perform set_config('tsc.pool_convert', 'on', true);
  for f in select distinct o.factory_org_id as org_id
             from public.order_payments p join public.production_orders o on o.id = p.order_id
            where p.withdrawal_pool loop
    perform 1 from public.orgs where id = f.org_id for no key update;
    select coalesce(array_agg(x.id order by x.released desc, x.release_requested_at, x.id), '{}'),
           coalesce(array_agg(x.net order by x.released desc, x.release_requested_at, x.id), '{}'),
           coalesce(array_agg(x.room order by x.released desc, x.release_requested_at, x.id), '{}')
      into ids, net, room
      from (select p.id, p.state = 'released' as released, p.release_requested_at,
                   greatest(p.amount_cents - p.factory_refund_cents, 0) as net,
                   greatest(public.payment_factory_base_cents(p) - greatest(p.amount_cents - p.factory_refund_cents, 0), 0) as room
              from public.order_payments p join public.production_orders o on o.id = p.order_id
             where o.factory_org_id = f.org_id and p.withdrawal_pool and p.currency = 'USD'
               and p.state in ('confirmed', 'released')) x;
    n := coalesce(array_length(ids, 1), 0);
    converted := converted || ids;
    -- Pool steps that hold no money now (refunded in full or a dispute lost,
    -- then reset to be paid again, or cancelled with the order): the pool
    -- counted them as nothing, so a withdrawal beyond the steps above was
    -- owed to TSC. Room: the step's amount, what paying it again covers.
    select coalesce(array_agg(p.id order by p.release_requested_at nulls last, p.id), '{}'),
           coalesce(array_agg(greatest(p.amount_cents, 0) order by p.release_requested_at nulls last, p.id), '{}')
      into gone, gone_room
      from public.order_payments p join public.production_orders o on o.id = p.order_id
     where o.factory_org_id = f.org_id and p.withdrawal_pool and p.currency = 'USD'
       and p.state not in ('confirmed', 'released');
    g := coalesce(array_length(gone, 1), 0);
    last_step := coalesce(gone[g], ids[n]);
    i_net := 1;
    i_room := 1;
    i_gone := 1;
    last_at := '-infinity';
    for w in
      select x.id, x.status, coalesce(x.pool_cents, x.amount_cents) as part, x.created_at
        from public.factory_withdrawals x
       where x.org_id = f.org_id and x.currency = 'USD' and x.status in ('paid', 'paying', 'requested')
         and coalesce(x.pool_cents, x.amount_cents) > 0
       -- Paid first, then being sent, then waiting: the order the pool used.
       order by case x.status when 'paid' then 0 when 'paying' then 1 else 2 end, x.created_at, x.id
    loop
      need := w.part;
      -- In that order too, for take_refunded_cents (newest held part first).
      at := greatest(w.created_at, last_at + interval '1 microsecond');
      last_at := at;
      -- What the pool held for it; then, beyond that, what was refunded since
      -- (owed to TSC when paid, refunded when not), as the pool read it.
      while need > 0 and i_net <= n loop
        take := least(need, net[i_net]);
        if take > 0 then
          insert into public.payment_takes as k (payment_id, org_id, road, factory_withdrawal_id, amount_cents, status, created_at, updated_at)
          values (ids[i_net], f.org_id, 'pool', w.id, take, case when w.status = 'paid' then 'sent' else 'held' end, at, now())
          on conflict (payment_id, factory_withdrawal_id) where factory_withdrawal_id is not null
          do update set amount_cents = k.amount_cents + excluded.amount_cents;
          net[i_net] := net[i_net] - take;
          need := need - take;
        end if;
        if net[i_net] = 0 then
          i_net := i_net + 1;
        end if;
      end loop;
      while need > 0 and i_room <= n loop
        take := least(need, room[i_room]);
        if take > 0 then
          insert into public.payment_takes as k (payment_id, org_id, road, factory_withdrawal_id, amount_cents, status, created_at, updated_at)
          values (ids[i_room], f.org_id, 'pool', w.id, take, case when w.status = 'paid' then 'sent' else 'held' end, at, now())
          on conflict (payment_id, factory_withdrawal_id) where factory_withdrawal_id is not null
          do update set amount_cents = k.amount_cents + excluded.amount_cents;
          room[i_room] := room[i_room] - take;
          need := need - take;
        end if;
        if room[i_room] = 0 then
          i_room := i_room + 1;
        end if;
      end loop;
      while need > 0 and i_gone <= g loop
        take := least(need, gone_room[i_gone]);
        if take > 0 then
          insert into public.payment_takes as k (payment_id, org_id, road, factory_withdrawal_id, amount_cents, status, created_at, updated_at)
          values (gone[i_gone], f.org_id, 'pool', w.id, take, case when w.status = 'paid' then 'sent' else 'held' end, at, now())
          on conflict (payment_id, factory_withdrawal_id) where factory_withdrawal_id is not null
          do update set amount_cents = k.amount_cents + excluded.amount_cents;
          gone_room[i_gone] := gone_room[i_gone] - take;
          need := need - take;
        end if;
        if gone_room[i_gone] = 0 then
          i_gone := i_gone + 1;
        end if;
      end loop;
      -- More than every step was ever worth (a step's amount lowered since,
      -- say): the rest on the last step, beyond its worth, so it reads as
      -- owed to TSC (paid) or refunded (waiting), as the pool read it.
      if need > 0 then
        if last_step is null then
          raise exception 'round 32: withdrawal % of company % draws % on the old withdrawal pool, but the company has no US dollar pool step to draw it from', w.id, f.org_id, need
            using hint = 'Nothing was changed. Check order_payments where withdrawal_pool for that company (currency and state) against its factory_withdrawals (status paid, paying or requested; pool_cents).';
        end if;
        insert into public.payment_takes as k (payment_id, org_id, road, factory_withdrawal_id, amount_cents, status, created_at, updated_at)
        values (last_step, f.org_id, 'pool', w.id, need, case when w.status = 'paid' then 'sent' else 'held' end, at, now())
        on conflict (payment_id, factory_withdrawal_id) where factory_withdrawal_id is not null
        do update set amount_cents = k.amount_cents + excluded.amount_cents;
        need := 0;
      end if;
    end loop;
    update public.factory_withdrawals set pool_cents = 0 where org_id = f.org_id and pool_cents is distinct from 0;
  end loop;
  update public.order_payments set withdrawal_pool = false where withdrawal_pool;
  -- A step fully withdrawn is released, as every withdrawal does now.
  for idx in 1..coalesce(array_length(converted, 1), 0) loop
    perform public.release_fully_taken(converted[idx], null);
  end loop;
  perform set_config('tsc.pool_convert', '', true);
  return coalesce(array_length(converted, 1), 0);
end;
$$;
revoke all on function public.convert_withdrawal_pool() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The latest bodies, without the pool.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payment_claimable(p order_payments)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select p.state = 'confirmed' and p.release_requested_at is not null
     and p.currency = 'USD'
     and p.disputed_at is null
     and not p.stripe_release_started and p.release_claimed_at is null
     and public.payment_cleared(p)
     and coalesce((select x.status from public.provider_payouts x where x.payment_id = p.id
                     order by x.created_at desc limit 1), '') not in ('processing', 'paid');
$function$;

CREATE OR REPLACE FUNCTION public.take_refunded_cents(t payment_takes)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select case
    when t.status <> 'held' then 0::bigint
    when p.state not in ('confirmed', 'released') then t.amount_cents
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
$function$;

CREATE OR REPLACE FUNCTION public.payment_debt_cents(p order_payments)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- What withdrawals sent from a step beyond what it now holds for the
  -- factory. A step that holds no money (an old pool step refunded in full
  -- after it was withdrawn, reset to be paid again: 20261121350000): all of
  -- it, until the brand pays it again.
  select greatest(0, s.sent - case when p.state in ('confirmed', 'released') then public.payment_factory_cents(p) else 0 end)::bigint
    from (select case
                   when p.state = 'released'
                        and not exists (select 1 from public.payment_takes t where t.payment_id = p.id and t.status in ('held', 'sent'))
                     then public.payment_factory_base_cents(p)
                   else coalesce((select sum(t.amount_cents) from public.payment_takes t
                                   where t.payment_id = p.id and t.status = 'sent'), 0)
                 end as sent) s
   where p.currency = 'USD';
$function$;

CREATE OR REPLACE FUNCTION public.factory_debt_cents(target_org uuid, target_client uuid DEFAULT NULL::uuid)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce((
    select sum(public.payment_debt_cents(p))
      from public.order_payments p
      join public.production_orders o on o.id = p.order_id
     where o.factory_org_id = target_org and p.currency = 'USD'
       -- Refunded since, or sent beyond what the step holds (an old pool step
       -- refunded in full after it was withdrawn, or a withdrawal beyond every
       -- pool step: 20261121350000).
       and (p.factory_refund_cents > 0
            or exists (select 1 from public.payment_takes t where t.payment_id = p.id and t.status = 'sent'))
       and (target_client is null or o.brand_org_id = target_client)
  ), 0)::bigint;
$function$;

CREATE OR REPLACE FUNCTION public.owed_reachable(target_org uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- Net of everything the company owes TSC (factory_debt_cents: refunded
  -- steps whose money had left).
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
$function$;

CREATE OR REPLACE FUNCTION public.factory_debt_uncovered_cents(target_org uuid)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select greatest(0::bigint, -(public.owed_reachable(target_org) ->> 'any_cents')::bigint);
$function$;

CREATE OR REPLACE FUNCTION public.withdrawal_covered(w factory_withdrawals)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- A debt to TSC the factory's other earnings cannot cover (20261121210000).
  select public.factory_debt_uncovered_cents(w.org_id) = 0
     and not exists (select 1 from public.payment_takes k
                       join public.order_payments p on p.id = k.payment_id
                      where k.factory_withdrawal_id = w.id and k.status = 'held'
                        and (p.state <> 'confirmed' or p.disputed_at is not null
                             or public.take_refunded_cents(k) > 0));
$function$;

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
   where k.factory_withdrawal_id = w.id and k.status = 'held');
$function$;

CREATE OR REPLACE FUNCTION public.withdrawal_refunded_cents(w factory_withdrawals)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- The part of withdrawal_on_hold_cents() on a step whose charge went back
  -- to the brand (refunded, or a dispute lost): not the factory's any more.
  select coalesce((select sum(public.take_refunded_cents(k)) from public.payment_takes k
                     where k.factory_withdrawal_id = w.id and k.status = 'held'), 0)::bigint;
$function$;

CREATE OR REPLACE FUNCTION public.withdrawal_back_cents(w factory_withdrawals)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- Every withdrawal draws from steps through its takes (the old pool was
  -- turned into takes, 20261121350000). A part still held: less what was
  -- refunded since. A part already handed back (the withdrawal just ended):
  -- what of it the step still has for the factory.
  select coalesce((select sum(case when t.status = 'held' then t.amount_cents - public.take_refunded_cents(t)
                                   when t.status = 'returned'
                                     then least(t.amount_cents, greatest(0, public.payment_factory_cents(p) - public.payment_taken_cents(p.id)))
                                   else t.amount_cents end)
                     from public.payment_takes t
                     join public.order_payments p on p.id = t.payment_id
                    where t.factory_withdrawal_id = w.id
                      and p.state = 'confirmed'), 0)::bigint;
$function$;

CREATE OR REPLACE FUNCTION public.guard_payment_take()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare p public.order_payments;
begin
  -- The old pool turned into takes as it stood (convert_withdrawal_pool, 20261121350000).
  if current_setting('tsc.pool_convert', true) = 'on' then
    return new;
  end if;
  select * into p from public.order_payments where id = new.payment_id for update;
  if not found or p.state <> 'confirmed' or p.release_requested_at is null then
    raise exception 'this payment is not owed to the factory' using errcode = '22023', hint = 'withdrawal_over_balance';
  end if;
  -- A statement of its own, so it reads what committed while this waited for
  -- the lock (a per-step payout started on the step, say).
  if not public.payment_claimable(p) then
    raise exception 'That is more than your balance.' using errcode = '22023', hint = 'withdrawal_over_balance';
  end if;
  if public.payment_taken_cents(p.id) + new.amount_cents > public.payment_factory_cents(p) then
    raise exception 'That is more than your balance.' using errcode = '22023', hint = 'withdrawal_over_balance';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.guard_taken_payment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if ((new.state = 'released' and old.state <> 'released'
       and coalesce(current_setting('tsc.take_release', true), '') <> 'on')
      or (new.release_claimed_at is not null and old.release_claimed_at is null)
      or (new.stripe_release_started and not old.stripe_release_started))
     and exists (select 1 from public.payment_takes t where t.payment_id = new.id and t.status in ('held', 'sent')) then
    raise exception 'this payment is in the factory''s balance: it is paid when the factory withdraws'
      using errcode = '22023', hint = 'withdrawal_pool';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.guard_route_with_balance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.route = 'stripe'
     and exists (select 1 from public.factory_withdrawals w where w.org_id = new.org_id and w.status in ('requested', 'paying')) then
    raise exception 'Withdraw your balance first, then switch to Stripe.' using errcode = '22023', hint = 'withdrawal_balance_left';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.request_withdrawal(target_org uuid, amount bigint, target_account uuid)
 RETURNS factory_withdrawals
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  a public.factory_payout_accounts;
  w public.factory_withdrawals;
  which text;
  owed_available bigint;
begin
  if not public.is_org_owner(target_org) then
    raise exception 'Only a company owner can withdraw.' using errcode = '42501', hint = 'withdraw_owner_only';
  end if;
  -- Two tabs, or a Stripe withdrawal at the same instant, are checked one
  -- after the other against the balance (claim_owed_steps takes the same lock).
  perform 1 from public.orgs where id = target_org for no key update;
  if amount is null or amount <= 0 then
    raise exception 'Enter an amount to withdraw.' using errcode = '22023', hint = 'withdrawal_amount';
  end if;
  -- Net of every request still open, so several requests can never add up to more.
  owed_available := (public.owed_reachable(target_org) ->> 'any_cents')::bigint;
  if amount > owed_available then
    raise exception 'That is more than your balance.' using errcode = '22023', hint = 'withdrawal_over_balance';
  end if;
  -- Locked against a removal in the same instant: the removal then waits,
  -- and its guard sees this withdrawal and refuses (never a raw key error).
  select * into a from public.factory_payout_accounts x where x.id = target_account and x.org_id = target_org
    for share;
  if not found then
    raise exception 'Choose one of your saved withdrawal methods.' using errcode = '22023', hint = 'withdrawal_method';
  end if;
  which := public.withdrawal_provider_for(a);
  if which is null
     or (a.method = 'bank' and (nullif(btrim(a.account_name), '') is null or a.number_changed_at is null))
     or (a.method = 'paypal' and nullif(btrim(a.paypal_email), '') is null) then
    raise exception 'Complete this withdrawal method first.' using errcode = '22023', hint = 'withdrawal_method';
  end if;
  if which = 'bank' or not public.payout_provider_enabled_for_account(a, which) then
    raise exception 'This withdrawal method is not available right now.' using errcode = '22023', hint = 'withdrawal_provider_off';
  end if;
  insert into public.factory_withdrawals
    (org_id, account_id, provider, amount_cents, currency, paid_to, paid_to_changed_at, requested_by)
  values (target_org, a.id, which, amount, 'USD',
          case when a.method = 'paypal' then a.paypal_email
               else format('%s ending %s', coalesce(a.bank_name, 'Bank account'), a.account_number_last4) end,
          a.payee_changed_at, auth.uid())
  returning * into w;
  -- All of it from the steps, through takes (road 'pool': PayPal / Wise).
  perform public.claim_owed_steps(target_org, amount, 'pool', w.id);
  perform public.withdrawal_notice(w,
    format('Withdrawal of %s requested', public.format_money(w.amount_cents, w.currency)),
    format('To %s. TSC will send it after checking.', w.paid_to));
  return w;
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
              then format(' You now owe TSC %s, the part that went back to the brand after it was sent.', public.format_money(gone, w.currency))
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
  perform public.withdrawal_notice(w,
    format('%s paid out to you', public.format_money(coalesce(w.receives_minor, w.amount_cents), coalesce(w.receives_currency, w.currency))),
    format('Sent by bank transfer to %s. Payout fee %s is taken from this payment: you receive %s. Reference: %s',
           w.paid_to, public.format_money(w.fee_cents, w.currency), public.format_money(w.receives_minor, w.currency), said));
  return w;
end;
$function$;

CREATE OR REPLACE FUNCTION public.my_withdrawal_balance(target_org uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  reach jsonb;
begin
  if not (public.is_org_member(target_org) or public.is_platform_admin()) then
    raise exception 'not a member of this company' using errcode = '42501';
  end if;
  reach := public.owed_reachable(target_org);
  return jsonb_build_object(
    -- Net of what the company owes TSC: never below zero here.
    'available_cents', greatest((reach ->> 'any_cents')::bigint, 0),
    'owed_cents', greatest((reach ->> 'any_cents')::bigint, 0),
    'stripe_owed_cents', greatest((reach ->> 'stripe_cents')::bigint, 0),
    'currency', 'USD',
    -- What cancelling each open withdrawal would give back.
    'returnable', coalesce((select jsonb_object_agg(f.id, public.withdrawal_back_cents(f))
                              from public.factory_withdrawals f
                             where f.org_id = target_org and f.status in ('requested', 'paying')), '{}'::jsonb),
    'taken', coalesce((select jsonb_object_agg(x.payment_id, jsonb_build_object('held', x.held, 'sent', x.sent))
                         from (select t.payment_id,
                                      coalesce(sum(t.amount_cents) filter (where t.status = 'held'), 0) as held,
                                      coalesce(sum(t.amount_cents) filter (where t.status = 'sent'), 0) as sent
                                 from public.payment_takes t
                                where t.org_id = target_org and t.status in ('held', 'sent')
                                group by t.payment_id) x), '{}'::jsonb),
    -- Deprecated (20261121350000), for one deploy: the live site's Withdraw
    -- shows its button while 'pool' is true and reads 'withdrawn'. True for a
    -- company that withdraws from TSC (not Stripe) and has money or
    -- withdrawals there, as the pool said; nothing on this site reads them.
    'pool', not public.uses_stripe_payout(target_org)
            and ((reach ->> 'any_cents')::bigint > 0
                 or exists (select 1 from public.payment_takes t where t.org_id = target_org and t.road = 'pool')),
    'withdrawn', '{}'::jsonb
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_payment_board()
 RETURNS TABLE(payment_id uuid, state payment_state, amount_cents bigint, fee_cents bigint, charged_cents bigint, currency character, order_id uuid, order_number text, order_status text, brand_name text, factory_name text, milestone_title text, milestone_state text, brand_reference text, payment_method_label text, failure_reason text, stripe_payment_intent_id text, stripe_transfer_id text, sent_at timestamp with time zone, processing_at timestamp with time zone, failed_at timestamp with time zone, confirmed_at timestamp with time zone, release_requested_at timestamp with time zone, factory_stripe_ready boolean, payout_summary text, payout_method text, payoneer_email text, payoneer_payment_id text, payout_account_id uuid, payout_holder text, payout_bank text, payout_branch text, payout_country text, payout_swift text, payout_instructions text, payout_last4 text, payout_has_number boolean, payout_number_kind text, payout_changed_at timestamp with time zone, payout_changed_recently boolean, contact_name text, contact_email text, contact_phone text, last_viewed_by text, last_viewed_at timestamp with time zone, paypal_email text, wise_recipient_type text, wise_currency text, wise_recipient_id text, wise_details jsonb, provider text, provider_status text, provider_ref text, provider_failure_code text, provider_at timestamp with time zone, refund_failed_at timestamp with time zone, refund_failure text, stripe_release_started boolean, brand_contact_name text, brand_contact_email text, brand_contact_phone text, processing_fee_cents bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not public.is_platform_admin() then
    raise exception 'this board is limited to platform staff' using errcode = '42501';
  end if;

  return query
  select
    p.id, p.state, p.amount_cents, public.payment_fee_cents(p.id), p.charged_cents, p.currency,
    o.id, o.order_number, o.status::text,
    b.name, f.name,
    m.title, m.state::text,
    p.brand_reference, p.payment_method_label,
    case when p.state = 'released' then refund.note else p.failure_reason end,
    p.stripe_payment_intent_id, p.stripe_transfer_id,
    p.sent_at, p.processing_at, p.failed_at, p.confirmed_at, p.release_requested_at,
    (p.stripe_transfer_id is not null or (p.state <> 'released' and public.uses_stripe_payout(o.factory_org_id))),
    case when a.method = 'payoneer' then 'Payoneer: ' || a.payoneer_email
         when a.method = 'paypal' then 'PayPal: ' || a.paypal_email else
    coalesce(nullif(concat_ws(' · ',
      nullif(btrim(a.account_name), ''),
      nullif(btrim(a.bank_name), ''),
      nullif(btrim(a.bank_country), ''),
      '····' || nullif(btrim(a.account_number_last4), ''),
      'SWIFT ' || nullif(btrim(a.swift), '')
    ), ''), 'no bank details on file') end,
    a.method, a.payoneer_email, sent.payoneer_payment_id,
    a.id, a.account_name, a.bank_name, a.branch, a.bank_country::text, a.swift, a.instructions,
    a.account_number_last4,
    a.number_changed_at is not null,
    num.number_kind,
    a.details_changed_at,
    coalesce(a.details_changed_at > now() - interval '14 days', false),
    contact.full_name, contact.email, phone.phone,
    viewed.staff_email, viewed.revealed_at,
    a.paypal_email, a.wise_recipient_type, a.wise_currency::text, a.wise_recipient_id, a.wise_details,
    attempt.provider, attempt.status, attempt.provider_ref, attempt.failure_code, attempt.updated_at,
    p.refund_failed_at, case when p.refund_failed_at is not null then staff_note.failure end,
    p.stripe_release_started,
    brand_contact.full_name, brand_contact.email, brand_phone.phone,
    public.processing_fee_cents(p)
  from public.order_payments p
  join public.production_orders o on o.id = p.order_id
  join public.order_milestones m  on m.id = p.milestone_id
  join public.orgs b on b.id = o.brand_org_id
  join public.orgs f on f.id = o.factory_org_id
  left join public.stripe_connect_accounts sca on sca.org_id = o.factory_org_id
  left join public.factory_payout_accounts a
    on a.org_id = o.factory_org_id and a.is_primary
  left join public.payout_account_numbers num on num.account_id = a.id
  left join public.payment_refund_staff_notes staff_note on staff_note.payment_id = p.id
  left join public.payoneer_payouts sent on sent.payment_id = p.id
  left join public.company_contact_details phone on phone.org_id = o.factory_org_id
  left join lateral (
    select coalesce(up.full_name, '') as full_name, u.email::text as email
      from public.org_members om
      join auth.users u on u.id = om.user_id
      left join public.user_profiles up on up.id = om.user_id
     where om.org_id = o.factory_org_id
     order by ('primaryContact' = any(om.permissions)) desc, (om.role = 'owner') desc, om.created_at
     limit 1
  ) contact on true
  left join public.company_contact_details brand_phone on brand_phone.org_id = o.brand_org_id
  left join lateral (
    select coalesce(up.full_name, '') as full_name, u.email::text as email
      from public.org_members om
      join auth.users u on u.id = om.user_id
      left join public.user_profiles up on up.id = om.user_id
     where om.org_id = o.brand_org_id
     order by ('primaryContact' = any(om.permissions)) desc, (om.role = 'owner') desc, om.created_at
     limit 1
  ) brand_contact on true
  left join lateral (
    select r.staff_email, r.revealed_at from public.payout_number_reveals r
     where r.account_id = a.id
     order by r.revealed_at desc
     limit 1
  ) viewed on true
  left join lateral (
    select e.note from public.payment_events e
     where p.state = 'released'
       and e.payment_id = p.id and e.from_state = 'released' and e.to_state = 'released'
       and e.note like '%' || format(' (Stripe %s)', p.stripe_payment_intent_id)
     order by e.created_at desc
     limit 1
  ) refund on true
  left join lateral (
    select x.provider, x.status, x.provider_ref, x.failure_code, x.updated_at
      from public.provider_payouts x
     where x.payment_id = p.id
     order by x.created_at desc
     limit 1
  ) attempt on true
  where p.state in ('sent', 'processing', 'failed', 'confirmed')
     or (p.state = 'released' and refund.note is not null)
  order by
    case p.state
      when 'sent' then 0
      -- Owed money waits in the factory's balance until it withdraws: staff
      -- act only on a payout an earlier release or provider started.
      when 'confirmed' then case when p.release_requested_at is not null
                                  and (p.stripe_release_started or attempt.status in ('processing', 'failed'))
                             then 1 else 3 end
      when 'released' then 1
      when 'failed' then 2
      else 4
    end,
    coalesce(p.release_requested_at, p.sent_at, p.failed_at, p.processing_at, p.confirmed_at);
end;
$function$;

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
      where (p.state = 'confirmed' and p.release_requested_at is not null
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
         and exists (select 1 from public.payment_takes t where t.payment_id = p.id and t.status in ('held', 'sent'))
    ), '[]'::jsonb)
  );
end;
$function$;

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
      select jsonb_agg(x.row order by x.at nulls last) from (
        select coalesce(greatest(p.refund_amount_at, p.dispute_lost_at), p.refunded_at) as at, jsonb_build_object(
          'payment_id', p.id, 'org_id', o.factory_org_id, 'order_id', o.id, 'order_number', o.order_number,
          'factory_name', f.name, 'brand_name', b.name, 'milestone_title', m.title,
          'amount_cents', public.payment_debt_cents(p), 'currency', p.currency,
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
  select coalesce(bool_or(x.refunded_cents > 0), false), coalesce(bool_or(x.dispute_lost_cents > 0), false)
    into debt_refund, debt_lost
    from public.order_payments x
    join public.production_orders xo on xo.id = x.order_id
   where xo.factory_org_id = o.factory_org_id
     and x.currency = 'USD' and x.state in ('confirmed', 'released')
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
                format('%s of it went back to the brand after it was sent. TSC is checking this withdrawal.', public.format_money(gone, w.currency)),
                jsonb_build_object('amount_cents', w.amount_cents, 'currency', w.currency, 'gone_cents', gone));
      end if;
      continue;
    end if;
    -- On hold only because of the debt (nothing it holds was refunded): it
    -- says what is owed, and never to withdraw again (20261121230000).
    owes := not exists (select 1 from public.payment_takes t
                         where t.factory_withdrawal_id = w.id and t.payment_id = new.id and t.status = 'held'
                           and (new.state <> 'confirmed' or public.take_refunded_cents(t) > 0));
    insert into public.notifications (org_id, kind, subject_type, subject_id, title, body, data)
    values (w.org_id, 'withdrawal', 'withdrawal', w.id,
            format('Withdrawal of %s on hold', public.format_money(w.amount_cents, w.currency)),
            -- The debt's own cause, from the payments that carry it: a
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

  select coalesce(sum(w.fee_cents) filter (where w.status = 'paid'), 0)
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
    'refunded_cents', refunded_total,
    'total_cents', awaiting + available + pending + processing + paid_out,
    'has_method', public.factory_can_withdraw(target_org),
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

-- ---------------------------------------------------------------------------
-- 4. Convert (after the new bodies: the take guard and the refund notice
--    know tsc.pool_convert).
-- ---------------------------------------------------------------------------
select public.convert_withdrawal_pool();

-- ---------------------------------------------------------------------------
-- 5. Figures after, read by the new functions: the same, or nothing changes.
-- ---------------------------------------------------------------------------
create function pg_temp.r32_kept(j jsonb) returns jsonb
language sql immutable as $$
  -- What must not change. Available and Pending together: a pool step still
  -- clearing or disputed moves from one to the other (20261121350000).
  select (j - 'available' - 'pending')
         || jsonb_build_object('available_and_pending', coalesce((j ->> 'available')::bigint, 0) + coalesce((j ->> 'pending')::bigint, 0));
$$;
do $$
declare
  r record;
  pool_debt boolean;
begin
  for r in select b.org_id, b.client, pg_temp.r32_kept(b.figures) as before,
                  pg_temp.r32_kept(pg_temp.r32_figures(b.org_id, b.client)) as after
             from r32_before b loop
    -- A client's view never counted the old pool's debt (it was the
    -- company's); per payment, it is now that client's. Checked only where
    -- the company owed nothing.
    pool_debt := coalesce(((select x.figures from r32_before x where x.org_id = r.org_id and x.client is null) ->> 'owed_to_tsc')::bigint, 0) > 0;
    continue when r.client is not null and pool_debt;
    if r.before is distinct from r.after then
      raise exception 'round 32: converting the withdrawal pool would change the balance of company % (client %) from % to %', r.org_id, r.client, r.before, r.after
        using hint = 'Nothing was changed. Compare that company''s order_payments where withdrawal_pool (state, amount, refunds) and its factory_withdrawals (paid, paying, requested; pool_cents) with factory_balance() before this migration.';
    end if;
  end loop;
end;
$$;
drop function pg_temp.r32_kept(jsonb);
drop function pg_temp.r32_figures(uuid, uuid);

-- ---------------------------------------------------------------------------
-- 6. The pool's own code, and code nothing calls.
-- ---------------------------------------------------------------------------
drop function if exists public.withdrawal_pool_refunded_cents(public.factory_withdrawals);
drop function if exists public.factory_withdrawable(uuid);
drop function if exists public.release_withdrawn_payments(uuid, uuid);
drop function if exists public.withdrawn_by_payment(uuid);
drop function if exists public.return_take(uuid);
drop function if exists public.return_stripe_takes(uuid);
drop function if exists public.join_withdrawal_pool();
drop function if exists public.guard_withdrawal_pool();
drop function if exists public.guard_provider_payout_pool();

comment on column public.order_payments.withdrawal_pool is
  'Deprecated (20261121350000): always false; the old pool was turned into payment_takes. Kept while the live site selects it.';
comment on column public.factory_withdrawals.pool_cents is
  'Deprecated (20261121350000): always 0 or null; every withdrawal draws from steps through payment_takes.';
comment on column public.stripe_withdrawals.fee_currency is
  'Deprecated (20261121350000): never written or read; fee_cents is in US cents.';
comment on function public.join_owed_to_pool(uuid) is
  'Deprecated (20261121350000): does nothing; kept one deploy because the live site calls it.';
comment on function public.mark_withdrawal_paid_by_bank(uuid, text) is
  'Deprecated (20261121350000): bank withdrawals have been refused since 20261117500000; kept one deploy because the live site calls it.';
