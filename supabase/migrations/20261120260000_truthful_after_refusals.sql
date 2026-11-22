-- ============================================================================
-- One balance: truthful after a refused payout, a dispute, a refund, and a
-- method change
-- ----------------------------------------------------------------------------
-- 1. A Stripe withdrawal whose payout is refused after its owed parts were
--    transferred takes them back (the server reverses the transfers) and
--    returns the parts to the balance (return_sent_take), so the money is
--    reachable by any method again. A part that cannot be taken back stays
--    sent, and the row is listed for staff (refusal_cause reversal_failed).
-- 2. Approving a step whose charge is already disputed tells the factory the
--    money is on hold, not that it was added to its balance.
-- 3. A refund under a waiting PayPal / Wise withdrawal: the factory is told;
--    the withdrawal's held part stays in Pending until it ends; cancelling or
--    declining says what actually goes back.
-- 4. Adding, changing or removing a PayPal, Wise or bank method tells the
--    whole company, as a Stripe method change does.
-- 5. Staff see before pressing Pay that a withdrawal is no longer covered.
-- 6. A Stripe payout's arrival is kept as a day (payout_arrives_on).
-- Safe with the live site while applied: new columns, functions and
-- triggers; replaced functions keep their signatures.
-- ============================================================================

alter table public.payment_takes add column if not exists reversal_id text;
alter table public.stripe_withdrawals add column if not exists payout_arrives_on date;
comment on column public.stripe_withdrawals.payout_arrives_on is
  'The day Stripe says the payout arrives (its arrival_date, a calendar day: read it with dateFrom()).';

-- 1. ---------------------------------------------------------------------------
create or replace function public.return_sent_take(target_take uuid, lease timestamptz, reversal text)
returns public.payment_takes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  t public.payment_takes;
  s public.stripe_withdrawals;
  p public.order_payments;
begin
  select * into t from public.payment_takes where id = target_take;
  if not found or t.road <> 'stripe' then
    raise exception 'take not found' using errcode = 'P0002';
  end if;
  select * into s from public.stripe_withdrawals where id = t.stripe_withdrawal_id for update;
  if s.lease_until is not null and s.lease_until > now() and s.lease_until is distinct from lease then
    raise exception 'this withdrawal is being processed' using errcode = '22023', hint = 'withdrawal_busy';
  end if;
  if nullif(btrim(coalesce(reversal, '')), '') is null then
    raise exception 'a reversal id is needed' using errcode = '22023';
  end if;
  update public.payment_takes set status = 'returned', reversal_id = reversal, updated_at = now()
   where id = t.id and status = 'sent'
  returning * into t;
  if not found then
    select * into t from public.payment_takes where id = target_take;
    return t;
  end if;
  -- Released because this part was sent: owed again.
  select * into p from public.order_payments where id = t.payment_id for update;
  if p.state = 'released' and p.released_note = 'Withdrawn'
     and public.payment_taken_cents(p.id) < public.payment_factory_cents(p) then
    perform set_config('tsc.take_release', 'on', true);
    update public.order_payments
       set state = 'confirmed', released_at = null, released_by = null, released_note = null, stripe_transfer_id = null
     where id = p.id;
    insert into public.payment_events (payment_id, from_state, to_state, actor_kind)
    values (p.id, 'released', 'confirmed', 'system');
    perform set_config('tsc.take_release', '', true);
  end if;
  return t;
end;
$$;
revoke all on function public.return_sent_take(uuid, timestamptz, text) from public, anon, authenticated;
grant execute on function public.return_sent_take(uuid, timestamptz, text) to service_role;

-- 2. ---------------------------------------------------------------------------
-- The factory's notice that an approved step's money is on hold, or back.
create or replace function public.tell_payment_hold(p public.order_payments, held boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  o public.production_orders;
  m public.order_milestones;
  amount_cents bigint;
begin
  if p.state <> 'confirmed' or p.release_requested_at is null then
    return;
  end if;
  amount_cents := public.payment_factory_cents(p) - public.payment_taken_cents(p.id);
  if amount_cents <= 0 then
    return;
  end if;
  select * into o from public.production_orders where id = p.order_id;
  select * into m from public.order_milestones where id = p.milestone_id;
  insert into public.notifications (org_id, kind, subject_type, subject_id, order_id, title, body)
  values (o.factory_org_id, 'payment_disputed', 'payment', p.id, o.id,
          case when held then format('Payment for "%s" on hold', coalesce(m.title, o.order_number))
               else format('Hold lifted on "%s"', coalesce(m.title, o.order_number)) end,
          case when held
               then format('The brand disputed the charge. %s is held until the dispute is settled.',
                           public.format_money(amount_cents, p.currency))
               else format('The dispute is settled. %s is back in your balance.',
                           public.format_money(amount_cents, p.currency)) end);
end;
$$;
revoke all on function public.tell_payment_hold(public.order_payments, boolean) from public, anon, authenticated;

-- 20261120240000's, through tell_payment_hold(). A dispute raised before the
-- step was approved is told at approval (approve_milestone, below).
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
  returning * into p;
  if found then
    perform public.tell_payment_hold(p, disputed);
  end if;
end;
$$;
revoke all on function public.record_payment_disputed(uuid, boolean) from public, anon, authenticated;
grant execute on function public.record_payment_disputed(uuid, boolean) to service_role;

-- 3. ---------------------------------------------------------------------------
-- What ending a withdrawal gives back: its pool part, and the parts whose
-- steps are still the factory's (a refunded step's part is not).
create or replace function public.withdrawal_back_cents(w public.factory_withdrawals)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(w.pool_cents, w.amount_cents - coalesce((select sum(t.amount_cents) from public.payment_takes t
                                                             where t.factory_withdrawal_id = w.id), 0))
       + coalesce((select sum(t.amount_cents) from public.payment_takes t
                     join public.order_payments p on p.id = t.payment_id
                    where t.factory_withdrawal_id = w.id
                      and p.state = 'confirmed'
                      and not (p.refunded_at is not null and p.refunded_at > coalesce(p.confirmed_at, '-infinity'::timestamptz))), 0);
$$;
revoke all on function public.withdrawal_back_cents(public.factory_withdrawals) from public, anon, authenticated;

create or replace function public.withdrawal_back_sentence(w public.factory_withdrawals)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when public.withdrawal_back_cents(w) >= w.amount_cents then 'The amount is back in your balance.'
    when public.withdrawal_back_cents(w) > 0
      then format('%s is back in your balance.', public.format_money(public.withdrawal_back_cents(w), w.currency))
    else 'Nothing goes back to your balance: the brand''s payment was refunded.'
  end;
$$;
revoke all on function public.withdrawal_back_sentence(public.factory_withdrawals) from public, anon, authenticated;

-- Whether approving it would go through (claim_withdrawal and the takes guard).
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
                             or (p.refunded_at is not null and p.refunded_at > coalesce(p.confirmed_at, '-infinity'::timestamptz))));
$$;
revoke all on function public.withdrawal_covered(public.factory_withdrawals) from public, anon, authenticated;

-- A step refunded while a waiting withdrawal holds part of it: the factory is
-- told, once per withdrawal.
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
begin
  if old.state <> 'confirmed' or new.state = 'confirmed' then
    return null;
  end if;
  select * into m from public.order_milestones where id = new.milestone_id;
  select * into o from public.production_orders where id = new.order_id;
  for w in select distinct f.* from public.factory_withdrawals f
             join public.payment_takes t on t.factory_withdrawal_id = f.id
            where t.payment_id = new.id and t.status = 'held' and f.status in ('requested', 'paying')
  loop
    insert into public.notifications (org_id, kind, subject_type, subject_id, title, body, data)
    values (w.org_id, 'withdrawal', 'withdrawal', w.id,
            format('Withdrawal of %s on hold', public.format_money(w.amount_cents, w.currency)),
            format('The brand''s payment for "%s" was refunded. Cancel this withdrawal and withdraw again.',
                   coalesce(m.title, o.order_number)),
            jsonb_build_object('amount_cents', w.amount_cents, 'currency', w.currency));
  end loop;
  return null;
end;
$$;
revoke all on function public.tell_withdrawal_refunded() from public, anon, authenticated;
drop trigger if exists order_payments_tell_withdrawal_refunded on public.order_payments;
create trigger order_payments_tell_withdrawal_refunded
  after update of state on public.order_payments
  for each row execute function public.tell_withdrawal_refunded();

-- 4. ---------------------------------------------------------------------------
-- Where a company's money can go is told to the whole company whenever it
-- changes (as for a Stripe method, api/stripe-connect.js): a PayPal, Wise or
-- bank method added, its payee details changed, or removed. Changes the
-- server makes are not the company's own and are left to their own notices.
create or replace function public.notify_withdrawal_method_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  a public.factory_payout_accounts;
  named text;
  said text;
begin
  if coalesce(auth.role(), '') <> 'authenticated' then
    return null;
  end if;
  a := case when tg_op = 'DELETE' then old else new end;
  if a.method not in ('paypal', 'bank') then
    return null;
  end if;
  if not exists (select 1 from public.orgs where id = a.org_id) then
    return null;
  end if;
  named := case when a.method = 'paypal' then format('PayPal %s', a.paypal_email)
                else format('Bank account%s', coalesce(' ending in ' || nullif(btrim(a.account_number_last4), ''), '')) end;
  if tg_op = 'INSERT' then
    said := format('%s was added as a withdrawal method.', named);
  elsif tg_op = 'DELETE' then
    said := format('%s was removed from your withdrawal methods.', named);
  elsif new.method is distinct from old.method or new.paypal_email is distinct from old.paypal_email
        or new.account_number_last4 is distinct from old.account_number_last4
        or new.payee_changed_at is distinct from old.payee_changed_at
        or new.wise_recipient_id is distinct from old.wise_recipient_id then
    said := format('The details of %s were changed.', named);
  else
    return null;
  end if;
  -- One save, one notice: a change another notice already told this company
  -- about in this transaction (the default bank, PayPal, Payoneer) is not
  -- told twice. This trigger is named to run after theirs.
  if exists (select 1 from public.notifications n
              where n.org_id = a.org_id and n.kind = 'payout_method_changed' and n.created_at = now()) then
    return null;
  end if;
  insert into public.notifications (org_id, kind, title, body)
  values (a.org_id, 'payout_method_changed', 'Your payout methods changed',
          said || ' If nobody at your company made this change, email operations@contact.sourcing-club.com now.');
  return null;
end;
$$;
revoke all on function public.notify_withdrawal_method_change() from public, anon, authenticated;
drop trigger if exists factory_payout_accounts_method_notice on public.factory_payout_accounts;
drop trigger if exists factory_payout_accounts_zz_method_notice on public.factory_payout_accounts;
-- Deferred, like the default-bank notice it must follow (names fire in order).
create constraint trigger factory_payout_accounts_zz_method_notice
  after insert or update or delete on public.factory_payout_accounts
  deferrable initially deferred
  for each row execute function public.notify_withdrawal_method_change();


-- my_withdrawal_balance (20261120200000) with what cancelling gives back.
CREATE OR REPLACE FUNCTION public.my_withdrawal_balance(target_org uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;

-- Replaced with the changes above (bodies from the database).
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
      raise exception 'fund "%" first: TSC pays the factory from the money it holds when you approve',
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
$function$;

CREATE OR REPLACE FUNCTION public.cancel_withdrawal(target_withdrawal uuid)
 RETURNS factory_withdrawals
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare w public.factory_withdrawals;
begin
  select * into w from public.factory_withdrawals where id = target_withdrawal for update;
  if not found or not public.is_org_owner(w.org_id) then
    raise exception 'Only a company owner can cancel a withdrawal.' using errcode = '42501', hint = 'withdraw_owner_only';
  end if;
  if w.status <> 'requested' then
    raise exception 'TSC has already started sending this, so it can no longer be cancelled.'
      using errcode = '22023', hint = 'withdrawal_not_waiting';
  end if;
  update public.factory_withdrawals set status = 'cancelled', decided_at = now(), updated_at = now()
   where id = w.id returning * into w;
  perform public.withdrawal_notice(w,
    format('Withdrawal of %s cancelled', public.format_money(w.amount_cents, w.currency)),
    public.withdrawal_back_sentence(w));
  return w;
end;
$function$;

CREATE OR REPLACE FUNCTION public.decline_withdrawal(target_withdrawal uuid, why text)
 RETURNS factory_withdrawals
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  w public.factory_withdrawals;
  said text := nullif(btrim(coalesce(why, '')), '');
begin
  if not public.is_platform_admin() then
    raise exception 'deciding a withdrawal is limited to platform staff' using errcode = '42501';
  end if;
  select * into w from public.factory_withdrawals where id = target_withdrawal for update;
  if not found then
    raise exception 'withdrawal not found' using errcode = 'P0002';
  end if;
  perform public.payout_staff_check(w.org_id);
  if w.status <> 'requested' then
    raise exception 'only a waiting withdrawal can be declined' using errcode = '22023', hint = 'withdrawal_not_waiting';
  end if;
  if said is null or length(said) < 3 or length(said) > 300 then
    raise exception 'say why, in a sentence the factory will read' using errcode = '22023', hint = 'withdrawal_reason';
  end if;
  update public.factory_withdrawals
     set status = 'declined', reason = said, decided_by = auth.uid(), decided_at = now(), updated_at = now()
   where id = w.id returning * into w;
  perform public.withdrawal_notice(w,
    format('Withdrawal of %s declined', public.format_money(w.amount_cents, w.currency)),
    format('%s TSC''s reason: %s', public.withdrawal_back_sentence(w), said));
  return w;
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
  -- Stripe's payout fee, taken by reversal when the factory withdrew to its
  -- bank (api/_stripe-withdrawals.js), in US cents; a fee given back is not
  -- counted. The same rule the owner's card used to apply on its own.
  select coalesce(sum(s.fee_cents), 0) into stripe_fees
    from public.stripe_withdrawals s
   where s.org_id = target_org and s.state in ('fee_taken', 'paid_out') and s.fee_cents is not null;

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
      -- A disputed charge's step is held: never "available on" any date.
      if (r.p).disputed_at is not null then
        disputed := disputed + rest;
      end if;
      out_rows := out_rows || jsonb_build_array(jsonb_build_object('payment_id', (r.p).id, 'figure', 'pending',
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

  -- A part a waiting withdrawal holds on a step refunded since: the request
  -- still asks for it, so it stays in Pending (with the withdrawal's row)
  -- until the withdrawal is cancelled or declined.
  for r in
    select t.payment_id, t.amount_cents, t.road
      from public.payment_takes t
      join public.order_payments p on p.id = t.payment_id
      join public.production_orders o on o.id = p.order_id
     where t.org_id = target_org and t.status = 'held' and p.currency = 'USD'
       and (target_client is null or o.brand_org_id = target_client)
       and not (p.state in ('confirmed', 'released')
                and not (p.state = 'confirmed' and p.refunded_at is not null
                         and p.refunded_at > coalesce(p.confirmed_at, '-infinity'::timestamptz)))
  loop
    taken_open := taken_open + r.amount_cents;
    out_rows := out_rows || jsonb_build_array(jsonb_build_object('payment_id', r.payment_id, 'figure', 'pending',
      'amount_cents', r.amount_cents, 'stripe', r.road = 'stripe', 'taken', true, 'refunded', true));
  end loop;

  if target_client is not null then
    fees := 0;
    stripe_fees := 0;
  end if;
  available := owed_cleared + pool_available;
  pending := owed_clearing + owed_moving + pool_open + taken_open;
  paid_out := stripe_released + other_released + pool_paid + taken_paid - fees - stripe_fees;

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
      'stripe_withdrawal_fees_cents', stripe_fees,
      'disputed_cents', disputed,
      'stripe_released_cents', stripe_released,
      'other_released_cents', other_released),
    'rows', out_rows
  );
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
        'balance_after_cents', public.factory_withdrawable(w.org_id)
                               + (public.owed_reachable(w.org_id) ->> 'any_cents')::bigint,
        -- Whether approving would be refused (the same checks as
        -- claim_withdrawal and the takes guard), so the row says so first.
        'covered', w.status not in ('requested', 'paying') or public.withdrawal_covered(w)
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
        'stripe_payment_intent_id', p.stripe_payment_intent_id) order by p.disputed_at)
        from public.order_payments p
        join public.production_orders o on o.id = p.order_id
        join public.orgs f on f.id = o.factory_org_id
        join public.orgs b on b.id = o.brand_org_id
        left join public.order_milestones m on m.id = p.milestone_id
       where p.state = 'confirmed' and p.release_requested_at is not null and p.disputed_at is not null
         and not p.withdrawal_pool), '[]'::jsonb),
    'stuck', coalesce((
      select jsonb_agg(jsonb_build_object(
        'withdrawal_id', s.id, 'org_id', s.org_id, 'factory_name', f.name, 'state', s.state,
        'usd_cents', s.usd_cents, 'owed_cents', s.owed_cents, 'stripe_account_id', s.stripe_account_id,
        'refusal_cause', s.refusal_cause, 'created_at', s.created_at, 'updated_at', s.updated_at,
        'held_cents', (select coalesce(sum(t.amount_cents), 0) from public.payment_takes t
                        where t.stripe_withdrawal_id = s.id and t.status = 'held')) order by s.created_at)
        from public.stripe_withdrawals s
        join public.orgs f on f.id = s.org_id
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
