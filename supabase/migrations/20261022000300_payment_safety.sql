-- ============================================================================
-- Money that arrives when it should not, and money that leaves after it came
-- ----------------------------------------------------------------------------
-- 1. A PaymentIntent paid when its payment no longer wants it is refunded.
--    A brand can pay from a Fund page it opened earlier, with the intent it
--    was given then. Meanwhile the step's amount may have changed, the order
--    may have been cancelled, or the step may now be "Approval only" (its
--    payment row deleted). Before, the webhook recorded whatever arrived
--    (the old figure, or money on a cancelled payment) or, for a deleted row,
--    dropped it, and the money sat in TSC's balance untracked.
--    record_payment_succeeded checks, under the same order lock that editing
--    the steps and cancelling take, that the payment exists, is open for
--    payment, is on an active order, belongs to a paid step, is paying with
--    THIS intent, and that Stripe took exactly the step plus its fee. Only
--    then does it record the money (record_payment_funded, unchanged).
--    Otherwise it says why, the server refunds the intent in Stripe, and
--    record_payment_refunded writes it down: the payment's intent and charge
--    are cleared so the next checkout makes a new intent at the right
--    amount, and on an active order the brand is asked to pay again.
--
-- 2. A refund made in Stripe (by staff, or by us) is recorded. Held money
--    that was refunded goes back to failed (the brand pays again) or, on a
--    cancelled order, to cancelled; money already paid out to the factory
--    stays released with a line in its history, and shows on the staff board,
--    because TSC paid the factory money it no longer holds.
--
-- 3. Staff cannot mark a Stripe-funded payment paid out by bank before the
--    brand approved its step. That froze the step: approve_milestone then
--    found the money "released" and refused. The old bank-wire path (no
--    Stripe charge) is unchanged.
--
-- 4. A repeated decline updates the reason the brand reads.
--
-- Safe with the old site live: one nullable column; two new service-only
-- functions; release_payment_to_factory, record_payment_failed and
-- admin_payment_board keep their signatures, return types and grants (the
-- old site never calls the last two, and only staff call the first, for
-- bank-wire payments, which are unchanged). Re-runnable.
-- ============================================================================

-- When Stripe last refunded this payment's own charge. Kept after the brand
-- pays again, as a record that it happened.
alter table public.order_payments
  add column if not exists refunded_at timestamptz;

comment on column public.order_payments.refunded_at is
  'When Stripe last refunded this payment''s own charge (record_payment_refunded), including after it was paid out.';

-- ---------------------------------------------------------------------------
-- 1. Is this the money the payment is waiting for?
-- ---------------------------------------------------------------------------
-- Called by the server for every PaymentIntent that succeeded (the webhook,
-- /api/stripe-sync, and a checkout that finds its intent already paid).
-- Returns {funded: true, payment} once the money is recorded as held, or
-- {funded: false, problem, payment} when it must be refunded instead:
--
--   payment_gone    no such payment (its step became Approval only)
--   other_intent    the payment is paying with a different intent, or none
--                   (an old intent, or a second one), or is already paid
--   order_<status>  the order is cancelled (or no longer active)
--   not_payable     the payment is not due, failed or clearing
--   step_unpaid     its step no longer takes a payment
--   amount_changed  Stripe took something other than the step plus its fee
--
-- A repeat for an intent already recorded is {funded: true}, unchanged.
-- payment.order_id lets the server check the intent's metadata names the
-- same order before refunding anything.
-- ---------------------------------------------------------------------------

create or replace function public.record_payment_succeeded(
  target_payment uuid,
  payment_intent text,
  charge text,
  method_type text,
  method_label text,
  received bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p public.order_payments;
  o public.production_orders;
  m public.order_milestones;
  problem text;
begin
  -- The order first, like update_order_milestone_details and close_order:
  -- an edit or a cancellation either finished before this check or waits
  -- until the money is recorded, after which it refuses to touch it.
  select * into o from public.production_orders
   where id = (select order_id from public.order_payments where id = target_payment)
   for update;
  select * into p from public.order_payments where id = target_payment for update;
  if not found then
    return jsonb_build_object('funded', false, 'problem', 'payment_gone', 'payment', null);
  end if;

  if p.state in ('confirmed', 'released') and p.stripe_payment_intent_id = payment_intent then
    return jsonb_build_object('funded', true, 'payment', to_jsonb(p));
  end if;

  select * into m from public.order_milestones where id = p.milestone_id;

  problem := case
    when p.stripe_payment_intent_id is distinct from payment_intent then 'other_intent'
    when o.status <> 'active' then 'order_' || o.status::text
    when p.state not in ('due', 'failed', 'processing') then 'not_payable'
    when m.kind not in ('approval_and_payment', 'payment_only') then 'step_unpaid'
    -- The fee exactly as begin_payment_checkout charges it.
    when received is distinct from p.amount_cents + public.payment_fee_cents(p.id) then 'amount_changed'
  end;

  if problem is not null then
    return jsonb_build_object('funded', false, 'problem', problem, 'payment', to_jsonb(p));
  end if;

  p := public.record_payment_funded(target_payment, charge, method_type, method_label, received);
  return jsonb_build_object('funded', true, 'payment', to_jsonb(p));
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Stripe refunded a payment's money
-- ---------------------------------------------------------------------------
-- Called by the server after it refunded an intent (above), and when Stripe
-- says a charge was refunded (charge.refunded, or a payout that found the
-- charge refunded). `reason` is what the brand reads.
--
--   no payment            nothing to record against; returns null
--   another intent        the payment's own money is untouched: one line in
--                         its history, once per intent
--   paid out (released)   TSC already paid the factory: the payment stays
--                         released, refunded_at is set and a line is
--                         written; staff see it on the board
--   anything else         the intent and charge are cleared so the next
--                         checkout makes a new intent at the right amount
--                         (attach_payment_intent refuses a second one while
--                         one is set). A cancelled order's payment is
--                         cancelled; a step not open yet stays not due;
--                         otherwise it is failed with the reason, and the
--                         brand is asked to pay again. release_requested_at
--                         is kept: a step the brand already approved pays
--                         the factory as soon as it is funded again.
-- ---------------------------------------------------------------------------

create or replace function public.record_payment_refunded(
  target_payment uuid,
  payment_intent text,
  reason text
)
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
begin
  -- Without one, a payment with no intent at all (a bank wire) would match.
  if nullif(btrim(coalesce(payment_intent, '')), '') is null then
    raise exception 'a refund names the PaymentIntent it refunded' using errcode = '22023';
  end if;

  select * into o from public.production_orders
   where id = (select order_id from public.order_payments where id = target_payment)
   for update;
  select * into p from public.order_payments where id = target_payment for update;
  if not found then
    return null;
  end if;
  was := p.state;

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

  if was = 'released' then
    -- Once per payout (the intent that paid for it): the page's sync reads
    -- the same refunded charge again. The board finds the payment by this
    -- line.
    if not exists (
      select 1 from public.payment_events
       where payment_id = p.id and from_state = 'released' and to_state = 'released' and note like '%' || ref
    ) then
      update public.order_payments set refunded_at = now() where id = p.id returning * into p;
      insert into public.payment_events (payment_id, from_state, to_state, actor_kind, note)
      values (p.id, was, was, 'system',
              'Refunded to the brand after it was paid out to the factory: recover it by hand.' || ref);
    end if;
    return p;
  end if;

  next_state := case
    when o.status = 'cancelled' then 'cancelled'::public.payment_state
    when was = 'not_due' then 'not_due'::public.payment_state
    else 'failed'::public.payment_state
  end;

  update public.order_payments
     set state = next_state,
         failed_at = case when next_state = 'failed' then now() else failed_at end,
         failure_reason = case when next_state = 'failed' then why else failure_reason end,
         stripe_payment_intent_id = null,
         stripe_charge_id = null,
         charged_cents = null,
         amount_received_cents = null,
         -- No longer held, so no longer "funded".
         confirmed_at = null,
         confirmed_by = null,
         release_claimed_at = null,
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
      when 'cancelled' then format('%s Nothing is owed for it: %s was cancelled.', why, o.order_number)
      else format('%s You will be asked to pay when the step opens on %s.', why, o.order_number)
    end
  );

  -- The factory was told the money was held (or on its way): tell it that it
  -- is not, unless the order is over anyway.
  if was in ('confirmed', 'processing') and next_state = 'failed' then
    insert into public.notifications
      (org_id, kind, subject_type, subject_id, order_id, title, body)
    values (
      o.factory_org_id, 'payment_refunded', 'payment', p.id, o.id,
      format('The payment for "%s" was refunded', m.title),
      format('TSC no longer holds money for this step on %s. The brand has been asked to pay again; we will tell you when it is held.',
             o.order_number)
    );
  end if;

  return p;
end;
$$;

revoke all on function public.record_payment_succeeded(uuid, text, text, text, text, bigint) from public, anon, authenticated;
revoke all on function public.record_payment_refunded(uuid, text, text)                      from public, anon, authenticated;
grant execute on function public.record_payment_succeeded(uuid, text, text, text, text, bigint) to service_role;
grant execute on function public.record_payment_refunded(uuid, text, text)                      to service_role;

-- ---------------------------------------------------------------------------
-- 3. release_payment_to_factory (from 20260905000900), unchanged apart from:
--    a payment the brand paid through Stripe is paid out only once the brand
--    approved its step (release_requested_at). Marking it paid out before
--    that put it in "released", and approve_milestone, which needs the money
--    held, then refused the step for good. A bank-wire payment from the old
--    site (no Stripe charge) is released as before.
-- ---------------------------------------------------------------------------

create or replace function public.release_payment_to_factory(
  target_payment uuid,
  note text default null
)
returns public.order_payments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p public.order_payments;
  o public.production_orders;
begin
  if not public.is_platform_admin() then
    raise exception 'releasing funds is limited to platform staff' using errcode = '42501';
  end if;

  select * into p from public.order_payments where id = target_payment for update;
  if not found then
    raise exception 'payment not found' using errcode = 'P0002';
  end if;
  if p.state <> 'confirmed' then
    raise exception 'that payment is %; only a confirmed one can be released', p.state
      using errcode = '22023';
  end if;
  if p.stripe_charge_id is not null and p.release_requested_at is null then
    raise exception 'the brand has not approved this step yet: money paid through Stripe is paid out once the brand approves it'
      using errcode = '22023';
  end if;

  select * into o from public.production_orders where id = p.order_id;

  update public.order_payments
     set state = 'released', released_by = auth.uid(), released_at = now(),
         released_note = nullif(btrim(coalesce(note, '')), '')
   where id = p.id
  returning * into p;

  insert into public.payment_events (payment_id, from_state, to_state, actor_user_id, actor_kind)
  values (p.id, 'confirmed', 'released', auth.uid(), 'admin');

  -- Deliberately no milestone or chain effect. The work already opened when
  -- the payment was confirmed.
  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  values (
    o.factory_org_id, 'funds_released', 'payment', p.id, o.id,
    format('%s released to you', public.format_money(p.amount_cents, p.currency)),
    format('Paid out against %s.', o.order_number)
  );

  return p;
end;
$$;

revoke all on function public.release_payment_to_factory(uuid, text) from public;
grant execute on function public.release_payment_to_factory(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. record_payment_failed (from 20261022000200), unchanged apart from a
--    payment that has already failed. The brand tries another card on the
--    same Fund page and it is declined too: the row now carries the latest
--    reason (what the page shows when it is opened again), and the history
--    gets one line per distinct reason. No second notification: the page
--    showed Stripe's answer as it happened, and the first one already asked
--    the brand to pay again.
-- ---------------------------------------------------------------------------

create or replace function public.record_payment_failed(target_payment uuid, reason text)
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
  why text := coalesce(nullif(btrim(coalesce(reason, '')), ''), 'The payment did not go through.');
begin
  select * into o from public.production_orders
   where id = (select order_id from public.order_payments where id = target_payment)
   for update;
  select * into p from public.order_payments where id = target_payment for update;
  if not found then
    raise exception 'payment not found' using errcode = 'P0002';
  end if;

  if p.state = 'failed' then
    if p.failure_reason is distinct from why then
      update public.order_payments
         set failed_at = now(), failure_reason = why
       where id = p.id
      returning * into p;

      insert into public.payment_events (payment_id, from_state, to_state, actor_kind, note)
      values (p.id, 'failed', 'failed', 'system', why);
    end if;
    return p;
  end if;

  if p.state not in ('due', 'processing') then
    return p;
  end if;
  was := p.state;

  update public.order_payments
     set state = 'failed', failed_at = now(), failure_reason = why
   where id = p.id
  returning * into p;

  insert into public.payment_events (payment_id, from_state, to_state, actor_kind, note)
  values (p.id, was, 'failed', 'system', why);

  select * into m from public.order_milestones where id = p.milestone_id;

  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  values (
    o.brand_org_id, 'payment_failed', 'payment', p.id, o.id,
    format('Your payment for "%s" did not go through', m.title),
    format('%s Pay again from the step''s payment page on %s.', why, o.order_number)
  );

  -- The factory was told a payment was on its way; tell it that it is not.
  if was = 'processing' then
    insert into public.notifications
      (org_id, kind, subject_type, subject_id, order_id, title, body)
    values (
      o.factory_org_id, 'payment_failed', 'payment', p.id, o.id,
      format('The payment for "%s" did not go through', m.title),
      format('Nothing is held for this step on %s yet. The brand has been asked to pay again.', o.order_number)
    );
  end if;

  return p;
end;
$$;

-- ---------------------------------------------------------------------------
-- admin_payment_board (from 20261013000200), same columns. Changed: a
-- payment refunded in Stripe after it was paid out is listed too (state
-- released, with the line record_payment_refunded wrote naming the intent
-- that paid for the payout), right after the payouts owed, with that line
-- as its failure_reason. TSC paid the factory money it no longer holds, and
-- staff cannot be notified, so the board is the only place to say so.
-- ---------------------------------------------------------------------------

create or replace function public.admin_payment_board()
returns table (
  payment_id               uuid,
  state                    public.payment_state,
  amount_cents             bigint,
  fee_cents                bigint,
  charged_cents            bigint,
  currency                 char(3),
  order_id                 uuid,
  order_number             text,
  order_status             text,
  brand_name               text,
  factory_name             text,
  milestone_title          text,
  milestone_state          text,
  brand_reference          text,
  payment_method_label     text,
  failure_reason           text,
  stripe_payment_intent_id text,
  stripe_transfer_id       text,
  sent_at                  timestamptz,
  processing_at            timestamptz,
  failed_at                timestamptz,
  confirmed_at             timestamptz,
  release_requested_at     timestamptz,
  factory_stripe_ready     boolean,
  payout_summary           text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
    coalesce(sca.transfers_active, false),
    coalesce(a.bank_name || ' ····' || coalesce(a.account_number_last4, ''), 'no bank details on file')
  from public.order_payments p
  join public.production_orders o on o.id = p.order_id
  join public.order_milestones m  on m.id = p.milestone_id
  join public.orgs b on b.id = o.brand_org_id
  join public.orgs f on f.id = o.factory_org_id
  left join public.stripe_connect_accounts sca on sca.org_id = o.factory_org_id
  left join public.factory_payout_accounts a
    on a.org_id = o.factory_org_id and a.is_primary
  left join lateral (
    select e.note from public.payment_events e
     where p.state = 'released'
       and e.payment_id = p.id and e.from_state = 'released' and e.to_state = 'released'
       and e.note like '%' || format(' (Stripe %s)', p.stripe_payment_intent_id)
     order by e.created_at desc
     limit 1
  ) refund on true
  where p.state in ('sent', 'processing', 'failed', 'confirmed')
     or (p.state = 'released' and refund.note is not null)
  order by
    case p.state
      when 'sent' then 0
      when 'confirmed' then case when p.release_requested_at is not null then 1 else 3 end
      when 'released' then 1
      when 'failed' then 2
      else 4
    end,
    coalesce(p.release_requested_at, p.sent_at, p.failed_at, p.processing_at, p.confirmed_at);
end;
$$;

revoke all on function public.admin_payment_board() from public;
grant execute on function public.admin_payment_board() to authenticated;
