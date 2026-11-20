-- ============================================================================
-- One balance for every factory, stage 2: withdrawing from it
-- ----------------------------------------------------------------------------
-- Stage 1 made an approved step owed: it waits with TSC, in the factory's one
-- balance. Here the factory takes it out, by one road per withdrawal:
--
--   Stripe     one click, no staff: the owed money is transferred to the
--              factory's Stripe account (source_transaction = the brand's
--              charge) and paid out with the money already there
--              (api/_stripe-withdrawals.js)
--   pool       PayPal, Wise (and bank, for old requests): request_withdrawal,
--              then staff approve and the provider pays, as before
--
-- A withdrawal moves exactly the amount asked. Owed steps are used oldest
-- first and may be used in part: the rest of a step stays owed, withdrawable
-- later by either road. Money already in the pool (P3) stays PayPal / Wise /
-- bank money, and is used first on that road.
--
--   1. payment_takes: the one record of what each owed step has given up, by
--      which withdrawal, on either road. Left on a step = its amount less its
--      held and sent takes. A step is released once sent takes cover it.
--   2. claim_owed_steps(): the one claim, for both roads. Locks the orgs row
--      (the lock request_withdrawal() takes), claims the oldest cleared owed
--      steps for exactly the amount, refuses more than the road can reach.
--   3. Pool takes follow their withdrawal (paid: sent; declined, cancelled,
--      failed: returned). factory_withdrawals.pool_cents says how much of a
--      withdrawal came from the pool; the pool's own figures count only that.
--   4. Per-step staff payouts and the old Stripe claim refuse a step any
--      withdrawal has taken. A step whose latest Wise / PayPal attempt failed
--      (nothing was sent) is Available again, and still on the staff board
--      until a withdrawal takes it.
--   5. The payment-only step's funded notice says the money was added to the
--      balance (the step-approved wording of stage 1).
--
-- Safe with the live site while applied: new columns (nullable), a new table,
-- new functions, new triggers that refuse only paths for steps a withdrawal
-- took (none exist before this deploy), and replaced functions with their
-- signatures and return types unchanged.
-- ============================================================================

-- 0. ---------------------------------------------------------------------------
alter table public.order_payments add column if not exists disputed_at timestamptz;
comment on column public.order_payments.disputed_at is
  'When Stripe said the brand''s charge is disputed (recorded by the server). A disputed owed step is never withdrawn.';

alter table public.factory_withdrawals add column if not exists pool_cents bigint
  check (pool_cents is null or (pool_cents >= 0 and pool_cents <= amount_cents));
comment on column public.factory_withdrawals.pool_cents is
  'The part of this withdrawal taken from pool money (withdrawal_pool payments). Null: all of it (every withdrawal made before owed steps could be taken). The rest is in payment_takes.';

alter table public.stripe_withdrawals add column if not exists usd_cents bigint check (usd_cents is null or usd_cents > 0);
alter table public.stripe_withdrawals add column if not exists owed_cents bigint check (owed_cents is null or owed_cents >= 0);
alter table public.stripe_withdrawals add column if not exists d1_minor bigint;
alter table public.stripe_withdrawals add column if not exists landed_minor bigint;
alter table public.stripe_withdrawals add column if not exists transfers_done_at timestamptz;
comment on column public.stripe_withdrawals.usd_cents is
  'The amount the factory asked for, in US cents, from its one balance. Null: a withdrawal of its Stripe money only (the old way).';
comment on column public.stripe_withdrawals.owed_cents is
  'Owed money claimed for this withdrawal (payment_takes). Null until the claim is made.';

-- 1. ---------------------------------------------------------------------------
-- The factory's amount on a step: what factory_balance() counts.
create or replace function public.payment_factory_cents(p public.order_payments)
returns bigint
language sql
immutable
set search_path = public, pg_temp
as $$
  select (case when p.charged_cents is not null then p.amount_cents
               else coalesce(p.amount_received_cents, p.amount_cents) end
          - coalesce(p.payout_fee_cents, 0))::bigint;
$$;
revoke all on function public.payment_factory_cents(public.order_payments) from public, anon, authenticated;

create table public.payment_takes (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.order_payments (id) on delete cascade,
  org_id uuid not null references public.orgs (id) on delete cascade,
  road text not null check (road in ('stripe', 'pool')),
  stripe_withdrawal_id uuid references public.stripe_withdrawals (id) on delete cascade,
  factory_withdrawal_id uuid references public.factory_withdrawals (id) on delete cascade,
  amount_cents bigint not null check (amount_cents > 0),
  status text not null default 'held' check (status in ('held', 'sent', 'returned')),
  stripe_transfer_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((road = 'stripe') = (stripe_withdrawal_id is not null)),
  check ((road = 'pool') = (factory_withdrawal_id is not null)),
  check (stripe_transfer_id is null or road = 'stripe')
);
create unique index payment_takes_stripe_once on public.payment_takes (payment_id, stripe_withdrawal_id) where stripe_withdrawal_id is not null;
create unique index payment_takes_pool_once on public.payment_takes (payment_id, factory_withdrawal_id) where factory_withdrawal_id is not null;
create index payment_takes_payment_idx on public.payment_takes (payment_id) where status in ('held', 'sent');
create index payment_takes_org_idx on public.payment_takes (org_id, created_at);
create index payment_takes_stripe_idx on public.payment_takes (stripe_withdrawal_id) where stripe_withdrawal_id is not null;
create index payment_takes_pool_idx on public.payment_takes (factory_withdrawal_id) where factory_withdrawal_id is not null;

alter table public.payment_takes enable row level security;
create policy payment_takes_read on public.payment_takes
  for select to authenticated
  using (public.is_org_member(org_id) or public.is_platform_admin());
revoke all on public.payment_takes from public, anon, authenticated, service_role;
grant select on public.payment_takes to authenticated, service_role;
alter publication supabase_realtime add table public.payment_takes;
comment on table public.payment_takes is
  'What each owed step has given up, by which withdrawal (Stripe or PayPal/Wise/bank). held: claimed, not sent; sent: transferred or paid; returned: back in the balance. Written only by functions.';

-- What a step has given up so far (held or sent).
create or replace function public.payment_taken_cents(target_payment uuid)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(t.amount_cents), 0)::bigint from public.payment_takes t
   where t.payment_id = target_payment and t.status in ('held', 'sent');
$$;
revoke all on function public.payment_taken_cents(uuid) from public, anon, authenticated;

-- A take never makes a step give up more than it has.
create or replace function public.guard_payment_take()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare p public.order_payments;
begin
  select * into p from public.order_payments where id = new.payment_id for update;
  if not found or p.state <> 'confirmed' or p.withdrawal_pool or p.release_requested_at is null then
    raise exception 'this payment is not owed to the factory' using errcode = '22023', hint = 'withdrawal_over_balance';
  end if;
  if public.payment_taken_cents(p.id) + new.amount_cents > public.payment_factory_cents(p) then
    raise exception 'That is more than your balance.' using errcode = '22023', hint = 'withdrawal_over_balance';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_payment_take() from public, anon, authenticated;
create trigger payment_takes_guard
  before insert on public.payment_takes
  for each row execute function public.guard_payment_take();

-- 2. ---------------------------------------------------------------------------
-- An owed step a withdrawal may take (either road). R1: a Wise / PayPal attempt
-- that failed sent nothing, so the step is available again.
create or replace function public.payment_claimable(p public.order_payments)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.state = 'confirmed' and p.release_requested_at is not null and not p.withdrawal_pool
     and p.currency = 'USD'
     and not (p.refunded_at is not null and p.refunded_at > coalesce(p.confirmed_at, '-infinity'::timestamptz))
     and p.disputed_at is null
     and not p.stripe_release_started and p.release_claimed_at is null
     and public.payment_cleared(p)
     and coalesce((select x.status from public.provider_payouts x where x.payment_id = p.id
                     order by x.created_at desc limit 1), '') not in ('processing', 'paid');
$$;
revoke all on function public.payment_claimable(public.order_payments) from public, anon, authenticated;

-- Owed money a withdrawal could take now: by any road, and by Stripe (which
-- needs the brand's charge to transfer from).
create or replace function public.owed_reachable(target_org uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'any_cents', coalesce(sum(x.left_cents), 0)::bigint,
    'stripe_cents', coalesce(sum(x.left_cents) filter (where x.charge is not null), 0)::bigint)
    from (select p.stripe_charge_id as charge,
                 public.payment_factory_cents(p) - public.payment_taken_cents(p.id) as left_cents
            from public.order_payments p
            join public.production_orders o on o.id = p.order_id
           where o.factory_org_id = target_org and public.payment_claimable(p)) x
   where x.left_cents > 0;
$$;
revoke all on function public.owed_reachable(uuid) from public, anon, authenticated;
-- The server reads it to say how much the Stripe road can reach.
grant execute on function public.owed_reachable(uuid) to service_role;

-- The one claim. Both roads lock the company's orgs row first, so a Stripe
-- withdrawal and a PayPal request at the same instant are counted one after
-- the other against the same steps.
create or replace function public.claim_owed_steps(target_org uuid, amount bigint, road text, withdrawal uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
  perform 1 from public.orgs where id = target_org for update;

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
$$;
revoke all on function public.claim_owed_steps(uuid, bigint, text, uuid) from public, anon, authenticated;
grant execute on function public.claim_owed_steps(uuid, bigint, text, uuid) to service_role;

-- A step whose sent takes cover it in full is released: "Paid" on the order.
-- stripe_transfer_id is set only when Stripe carried all of it, so it still
-- means "paid by Stripe transfer" wherever it is read.
create or replace function public.release_fully_taken(target_payment uuid, by_user uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p public.order_payments;
  sent bigint;
  all_stripe boolean;
  last_transfer text;
begin
  select * into p from public.order_payments where id = target_payment for update;
  if not found or p.state <> 'confirmed' then
    return;
  end if;
  select coalesce(sum(t.amount_cents), 0), bool_and(t.road = 'stripe')
    into sent, all_stripe
    from public.payment_takes t where t.payment_id = p.id and t.status = 'sent';
  if sent < public.payment_factory_cents(p)
     or exists (select 1 from public.payment_takes t where t.payment_id = p.id and t.status = 'held') then
    return;
  end if;
  select t.stripe_transfer_id into last_transfer from public.payment_takes t
   where t.payment_id = p.id and t.status = 'sent' and t.road = 'stripe'
   order by t.updated_at desc, t.created_at desc limit 1;
  perform set_config('tsc.take_release', 'on', true);
  update public.order_payments
     set state = 'released', released_at = now(), released_by = by_user, released_note = 'Withdrawn',
         stripe_transfer_id = case when all_stripe then last_transfer else stripe_transfer_id end
   where id = p.id;
  insert into public.payment_events (payment_id, from_state, to_state, actor_user_id, actor_kind)
  values (p.id, 'confirmed', 'released', by_user, case when by_user is null then 'system' else 'admin' end);
  perform set_config('tsc.take_release', '', true);
end;
$$;
revoke all on function public.release_fully_taken(uuid, uuid) from public, anon, authenticated;

-- The server: a Stripe take's transfer went.
create or replace function public.record_take_sent(target_take uuid, transfer text)
returns public.payment_takes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare t public.payment_takes;
begin
  if nullif(btrim(coalesce(transfer, '')), '') is null then
    raise exception 'a transfer id is needed' using errcode = '22023';
  end if;
  select * into t from public.payment_takes where id = target_take for update;
  if not found or t.road <> 'stripe' then
    raise exception 'take not found' using errcode = 'P0002';
  end if;
  if t.status = 'sent' then
    return t;
  end if;
  -- Returned means it was given back to the balance; a transfer found for it
  -- afterwards is a contradiction to look at, not to paper over.
  if t.status <> 'held' then
    raise exception 'this take was returned to the balance' using errcode = '22023', hint = 'take_returned';
  end if;
  update public.payment_takes set status = 'sent', stripe_transfer_id = transfer, updated_at = now()
   where id = t.id returning * into t;
  perform public.release_fully_taken(t.payment_id, null);
  return t;
end;
$$;
revoke all on function public.record_take_sent(uuid, text) from public, anon, authenticated;
grant execute on function public.record_take_sent(uuid, text) to service_role;

-- The server: a Stripe take that was not sent goes back to the balance.
create or replace function public.return_take(target_take uuid)
returns public.payment_takes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare t public.payment_takes;
begin
  update public.payment_takes set status = 'returned', updated_at = now()
   where id = target_take and road = 'stripe' and status = 'held'
  returning * into t;
  if not found then
    select * into t from public.payment_takes where id = target_take;
  end if;
  return t;
end;
$$;
revoke all on function public.return_take(uuid) from public, anon, authenticated;
grant execute on function public.return_take(uuid) to service_role;

create or replace function public.return_stripe_takes(target_withdrawal uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare n integer;
begin
  update public.payment_takes set status = 'returned', updated_at = now()
   where stripe_withdrawal_id = target_withdrawal and status = 'held';
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.return_stripe_takes(uuid) from public, anon, authenticated;
grant execute on function public.return_stripe_takes(uuid) to service_role;

-- The server: Stripe says the brand's charge is (or is no longer) disputed.
create or replace function public.record_payment_disputed(target_payment uuid, disputed boolean)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.order_payments
     set disputed_at = case when disputed then coalesce(disputed_at, now()) end
   where id = target_payment
     and (disputed_at is null) = disputed;
$$;
revoke all on function public.record_payment_disputed(uuid, boolean) from public, anon, authenticated;
grant execute on function public.record_payment_disputed(uuid, boolean) to service_role;

-- 3. ---------------------------------------------------------------------------
-- Pool takes follow their withdrawal. Approving or paying one whose steps were
-- refunded or disputed since it was asked is refused: TSC would pay money it
-- no longer holds.
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
                         or (p.refunded_at is not null and p.refunded_at > coalesce(p.confirmed_at, '-infinity'::timestamptz)))) then
    raise exception 'the factory''s balance no longer covers this' using errcode = '22023', hint = 'withdrawal_over_balance';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_withdrawal_takes() from public, anon, authenticated;
create trigger factory_withdrawals_guard_takes
  before update of status on public.factory_withdrawals
  for each row execute function public.guard_withdrawal_takes();

create or replace function public.follow_withdrawal_takes()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare k record;
begin
  if new.status = old.status then
    return null;
  end if;
  if new.status = 'paid' then
    update public.payment_takes set status = 'sent', updated_at = now()
     where factory_withdrawal_id = new.id and status = 'held';
    for k in select distinct payment_id from public.payment_takes where factory_withdrawal_id = new.id loop
      perform public.release_fully_taken(k.payment_id, new.decided_by);
    end loop;
  elsif new.status in ('declined', 'cancelled', 'failed') then
    update public.payment_takes set status = 'returned', updated_at = now()
     where factory_withdrawal_id = new.id and status = 'held';
  end if;
  return null;
end;
$$;
revoke all on function public.follow_withdrawal_takes() from public, anon, authenticated;
create trigger factory_withdrawals_follow_takes
  after update of status on public.factory_withdrawals
  for each row execute function public.follow_withdrawal_takes();

-- The pool's own money: what is left of withdrawal_pool payments. Only the
-- part of a withdrawal taken from the pool counts here (pool_cents).
create or replace function public.factory_withdrawable(target_org uuid)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select sum(p.amount_cents) from public.order_payments p
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

create or replace function public.withdrawn_by_payment(target_org uuid)
returns table (payment_id uuid, withdrawn_cents bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  left_over bigint;
  r record;
begin
  select coalesce(sum(coalesce(pool_cents, amount_cents)), 0) into left_over from public.factory_withdrawals
   where org_id = target_org and status = 'paid' and currency = 'USD';
  for r in select p.id, p.amount_cents from public.order_payments p
             join public.production_orders o on o.id = p.order_id
            where o.factory_org_id = target_org and p.withdrawal_pool and p.currency = 'USD'
              and p.state in ('confirmed', 'released')
            order by p.release_requested_at, p.id
  loop
    exit when left_over <= 0;
    payment_id := r.id;
    withdrawn_cents := least(r.amount_cents, left_over);
    left_over := left_over - withdrawn_cents;
    return next;
  end loop;
end;
$$;
revoke all on function public.withdrawn_by_payment(uuid) from public, anon, authenticated;

create or replace function public.release_withdrawn_payments(target_org uuid, by_user uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  paid bigint;
  covered bigint := 0;
  r record;
begin
  select coalesce(sum(coalesce(pool_cents, amount_cents)), 0) into paid from public.factory_withdrawals
   where org_id = target_org and status = 'paid' and currency = 'USD';
  perform set_config('tsc.withdrawal_release', 'on', true);
  for r in select p.id, p.amount_cents, p.state from public.order_payments p
             join public.production_orders o on o.id = p.order_id
            where o.factory_org_id = target_org and p.withdrawal_pool and p.currency = 'USD'
              and p.state in ('confirmed', 'released')
            order by p.release_requested_at, p.id
  loop
    covered := covered + r.amount_cents;
    exit when covered > paid;
    if r.state = 'confirmed' then
      update public.order_payments set state = 'released', released_at = now(), released_by = by_user,
             released_note = 'Withdrawn'
       where id = r.id;
      insert into public.payment_events (payment_id, from_state, to_state, actor_user_id, actor_kind)
      values (r.id, 'confirmed', 'released', by_user, 'admin');
    end if;
  end loop;
  perform set_config('tsc.withdrawal_release', '', true);
end;
$$;
revoke all on function public.release_withdrawn_payments(uuid, uuid) from public, anon, authenticated;

-- 4. ---------------------------------------------------------------------------
-- A step a withdrawal has taken (in whole or part) is paid only by
-- withdrawals: the old per-step paths refuse it, in the words they already use
-- for pool payments.
create or replace function public.guard_taken_payment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if ((new.state = 'released' and old.state <> 'released'
       and coalesce(current_setting('tsc.take_release', true), '') <> 'on')
      or (new.release_claimed_at is not null and old.release_claimed_at is null)
      or (new.stripe_release_started and not old.stripe_release_started)
      or (new.withdrawal_pool and not old.withdrawal_pool))
     and exists (select 1 from public.payment_takes t where t.payment_id = new.id and t.status in ('held', 'sent')) then
    raise exception 'this payment is in the factory''s balance: it is paid when the factory withdraws'
      using errcode = '22023', hint = 'withdrawal_pool';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_taken_payment() from public, anon, authenticated;
create trigger order_payments_guard_taken
  before update on public.order_payments
  for each row execute function public.guard_taken_payment();

-- A Wise / PayPal payout per step (a first try or "Pay again"). The payment
-- row is locked first, so this and a withdrawal's claim go one after the
-- other: whichever is second sees the first.
create or replace function public.guard_provider_payout_taken()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform 1 from public.order_payments where id = new.payment_id for update;
  if exists (select 1 from public.payment_takes t where t.payment_id = new.payment_id and t.status in ('held', 'sent')) then
    raise exception 'this payment is in the factory''s balance: it is paid when the factory withdraws'
      using errcode = '22023', hint = 'withdrawal_pool';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_provider_payout_taken() from public, anon, authenticated;
create trigger provider_payouts_guard_taken
  before insert on public.provider_payouts
  for each row execute function public.guard_provider_payout_taken();

-- 5. ---------------------------------------------------------------------------
-- PayPal / Wise: the pool's money first, then owed steps, in one transaction.
-- 20261118600000's request_withdrawal() otherwise unchanged.
create or replace function public.request_withdrawal(target_org uuid, amount bigint, target_account uuid)
returns public.factory_withdrawals
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  a public.factory_payout_accounts;
  w public.factory_withdrawals;
  which text;
  pool_available bigint;
  owed_available bigint;
  from_pool bigint;
begin
  if not public.is_org_owner(target_org) then
    raise exception 'Only a company owner can withdraw.' using errcode = '42501', hint = 'withdraw_owner_only';
  end if;
  -- Two tabs, or a Stripe withdrawal at the same instant, are checked one
  -- after the other against the balance (claim_owed_steps takes the same lock).
  perform 1 from public.orgs where id = target_org for update;
  if amount is null or amount <= 0 then
    raise exception 'Enter an amount to withdraw.' using errcode = '22023', hint = 'withdrawal_amount';
  end if;
  -- Net of every request still open, so several requests can never add up to more.
  pool_available := greatest(public.factory_withdrawable(target_org), 0);
  owed_available := (public.owed_reachable(target_org) ->> 'any_cents')::bigint;
  if amount > pool_available + owed_available then
    raise exception 'That is more than your balance.' using errcode = '22023', hint = 'withdrawal_over_balance';
  end if;
  select * into a from public.factory_payout_accounts x where x.id = target_account and x.org_id = target_org;
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
  from_pool := least(amount, pool_available);
  insert into public.factory_withdrawals
    (org_id, account_id, provider, amount_cents, currency, paid_to, paid_to_changed_at, requested_by, pool_cents)
  values (target_org, a.id, which, amount, 'USD',
          case when a.method = 'paypal' then a.paypal_email
               else format('%s ending %s', coalesce(a.bank_name, 'Bank account'), a.account_number_last4) end,
          a.payee_changed_at, auth.uid(), from_pool)
  returning * into w;
  if amount > from_pool then
    perform public.claim_owed_steps(target_org, amount - from_pool, 'pool', w.id);
  end if;
  perform public.withdrawal_notice(w,
    format('Withdrawal of %s requested', public.format_money(w.amount_cents, w.currency)),
    format('To %s. TSC will send it after checking.', w.paid_to));
  return w;
end;
$$;
revoke all on function public.request_withdrawal(uuid, bigint, uuid) from public, anon;
grant execute on function public.request_withdrawal(uuid, bigint, uuid) to authenticated;

-- What the Withdraw dialog reads. available_cents is what PayPal / Wise can
-- reach (the pool's money and owed steps); stripe_owed_cents is the owed part
-- Stripe can reach (the server adds what is already in the Stripe account).
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
    'available_cents', pool + (reach ->> 'any_cents')::bigint,
    'pool_cents', pool,
    'owed_cents', (reach ->> 'any_cents')::bigint,
    'stripe_owed_cents', (reach ->> 'stripe_cents')::bigint,
    'currency', 'USD',
    'pool', exists (select 1 from public.order_payments p join public.production_orders o on o.id = p.order_id
                     where o.factory_org_id = target_org and p.withdrawal_pool),
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
grant execute on function public.my_withdrawal_balance(uuid) to authenticated;

-- 6. ---------------------------------------------------------------------------
-- The one balance (stage 1's), now reading what withdrawals took:
--   a held take is Pending (on its way), a sent Stripe take is Paid out here
--   (the server swaps that for what is in the Stripe account, live), a sent
--   pool take is Paid out (less its withdrawal's fee, as before); the rest of
--   a step follows the old rules. A failed Wise / PayPal attempt no longer
--   holds a step in Pending (R1); a disputed one is Pending.
create or replace function public.factory_balance(target_org uuid, target_client uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
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
  next_at timestamptz;
  available bigint;
  pending bigint;
  paid_out bigint;
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

  -- Pool money (P3: it stays pool money), split across every client first.
  for r in
    select p.id, p.amount_cents, o.brand_org_id
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
      out_rows := out_rows || jsonb_build_array(jsonb_build_object('payment_id', r.id, 'figure', 'pending', 'amount_cents', take_open, 'stripe', false));
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
           (select x.status from public.provider_payouts x where x.payment_id = p.id
             order by x.created_at desc limit 1) as attempt_status,
           coalesce((select sum(t.amount_cents) from public.payment_takes t
                      where t.payment_id = p.id and t.status = 'held' and t.road = 'stripe'), 0)::bigint as held_stripe,
           coalesce((select sum(t.amount_cents) from public.payment_takes t
                      where t.payment_id = p.id and t.status = 'held' and t.road = 'pool'), 0)::bigint as held_pool,
           coalesce((select sum(t.amount_cents) from public.payment_takes t
                      where t.payment_id = p.id and t.status = 'sent' and t.road = 'stripe'), 0)::bigint as sent_stripe,
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
    -- What withdrawals took.
    if r.held_stripe > 0 then
      taken_open := taken_open + r.held_stripe;
      out_rows := out_rows || jsonb_build_array(jsonb_build_object('payment_id', (r.p).id, 'figure', 'pending',
        'amount_cents', r.held_stripe, 'stripe', true, 'taken', true));
    end if;
    if r.held_pool > 0 then
      taken_open := taken_open + r.held_pool;
      out_rows := out_rows || jsonb_build_array(jsonb_build_object('payment_id', (r.p).id, 'figure', 'pending',
        'amount_cents', r.held_pool, 'stripe', false, 'taken', true));
    end if;
    if r.sent_stripe > 0 then
      stripe_released := stripe_released + r.sent_stripe;
      out_rows := out_rows || jsonb_build_array(jsonb_build_object('payment_id', (r.p).id, 'figure', 'paid_out',
        'amount_cents', r.sent_stripe, 'stripe', true, 'taken', true));
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
        if (r.p).stripe_transfer_id is not null then
          stripe_released := stripe_released + r.factory_cents;
        else
          other_released := other_released + r.factory_cents;
        end if;
        out_rows := out_rows || jsonb_build_array(jsonb_build_object('payment_id', (r.p).id, 'figure', 'paid_out',
          'amount_cents', r.factory_cents, 'stripe', (r.p).stripe_transfer_id is not null));
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
      out_rows := out_rows || jsonb_build_array(jsonb_build_object('payment_id', (r.p).id, 'figure', 'pending',
        'amount_cents', rest, 'stripe', false));
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

  if target_client is not null then
    fees := 0;
  end if;
  available := owed_cleared + pool_available;
  pending := owed_clearing + owed_moving + pool_open + taken_open;
  paid_out := stripe_released + other_released + pool_paid + taken_paid - fees;

  return jsonb_build_object(
    'currency', 'USD',
    'client', target_client,
    'awaiting_cents', awaiting,
    'available_cents', available,
    'pending_cents', pending,
    'paid_out_cents', paid_out,
    'total_cents', awaiting + available + pending + paid_out,
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
      'stripe_released_cents', stripe_released,
      'other_released_cents', other_released),
    'rows', out_rows
  );
end;
$$;
revoke all on function public.factory_balance(uuid, uuid) from public, anon;
grant execute on function public.factory_balance(uuid, uuid) to authenticated, service_role;

-- 7. ---------------------------------------------------------------------------
-- Staff: a step a withdrawal took is not theirs to pay per step. The board
-- leaves out the ids admin_withdrawals() lists (pool payments, and now taken
-- steps), and the overview counts the same way. balance_after_cents is what
-- the factory could still withdraw by PayPal / Wise.
create or replace function public.admin_withdrawals()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
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
        'balance_after_cents', public.factory_withdrawable(w.org_id)
                               + (public.owed_reachable(w.org_id) ->> 'any_cents')::bigint
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
$$;
revoke all on function public.admin_withdrawals() from public, anon;
grant execute on function public.admin_withdrawals() to authenticated;

create or replace function public.admin_overview_metrics()
returns table (
  profiles_awaiting_review integer,
  rfqs_submitted_today     integer,
  quotes_submitted_today   integer,
  payments_awaiting_confirmation integer,
  profiles_submitted_today integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'these metrics are limited to platform staff' using errcode = '42501';
  end if;

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
     + (select count(*)::integer from public.factory_withdrawals w where w.status in ('requested', 'paying')),
    (select count(*)::integer from public.admin_verification_queue() q
      where q.submitted_at >= date_trunc('day', now()));
end;
$$;

-- 8. ---------------------------------------------------------------------------
-- record_payment_funded (20261107570000): only the factory's notice for a
-- payment-only step changes. Nothing is sent: the money is added to its
-- balance (the step-approved wording), with the same ask for a withdrawal
-- method when it has none.
CREATE OR REPLACE FUNCTION public.record_payment_funded(target_payment uuid, charge text, method_type text, method_label text, received bigint)
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
  pays_out boolean := false;
begin
  select * into o from public.production_orders
   where id = (select order_id from public.order_payments where id = target_payment)
   for update;
  select * into p from public.order_payments where id = target_payment for update;
  if not found then
    raise exception 'payment not found' using errcode = 'P0002';
  end if;

  if p.state in ('confirmed', 'released') then
    return p;
  end if;
  was := p.state;

  select * into m from public.order_milestones where id = p.milestone_id for update;

  pays_out := o.status = 'active'
    and (m.kind = 'payment_only' or m.state = 'approved');

  update public.order_payments
     set state = 'confirmed', confirmed_at = now(), confirmed_by = null,
         amount_received_cents = coalesce(received, p.charged_cents, p.amount_cents),
         stripe_charge_id = coalesce(charge, stripe_charge_id),
         payment_method_type = coalesce(method_type, payment_method_type),
         payment_method_label = coalesce(method_label, payment_method_label),
         failure_reason = null,
         release_requested_at = case when pays_out then now() else release_requested_at end
   where id = p.id
  returning * into p;

  insert into public.payment_events (payment_id, from_state, to_state, actor_kind)
  values (p.id, was, 'confirmed', 'system');

  if pays_out then
    update public.order_milestones
       set state = 'complete', completed_at = now()
     where id = m.id and state in ('active', 'approved');
    perform public.advance_order_chain(o.id);
  end if;

  if o.status = 'active' then
    insert into public.notifications
      (org_id, kind, subject_type, subject_id, order_id, title, body)
    values (
      o.factory_org_id, 'payment_confirmed', 'payment', p.id, o.id,
      format('Payment held for "%s"', m.title),
      case when pays_out
        then format('%s added to your balance.%s',
                    public.format_money(p.amount_cents, p.currency),
                    case when not public.factory_can_withdraw(o.factory_org_id)
                         then ' Add a withdrawal method to receive earnings.' else '' end)
        else format('TSC holds %s for this step on %s. You can start this work; it is paid to you when the brand approves it.',
                    public.format_money(p.amount_cents, p.currency), o.order_number)
      end
    );

    insert into public.notifications
      (org_id, kind, subject_type, subject_id, order_id, title, body)
    values (
      o.brand_org_id, 'payment_confirmed', 'payment', p.id, o.id,
      format('Your payment for "%s" is funded', m.title),
      case when pays_out
        then format('%s received on %s. TSC will pay the factory.',
                    public.format_money(p.charged_cents, p.currency), o.order_number)
        else format('%s received on %s. TSC holds it and pays the factory when you approve this step.',
                    public.format_money(coalesce(p.charged_cents, p.amount_cents), p.currency), o.order_number)
      end
    );
  end if;

  return p;
end;
$function$
;
