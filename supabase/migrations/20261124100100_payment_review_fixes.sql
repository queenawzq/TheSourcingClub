-- Payment reviews, fixes (20261124100000 follow-up). Additive; recreates only
-- functions from their bodies in 20261124100000.
--
--  1. Staff can't pay a paused factory by any road: a hand payout (bank or
--     Payoneer), a Stripe per-step payout's claim, or a waiting withdrawal
--     marked paid by bank (guards on order_payments and factory_withdrawals).
--  2. A dispute on a step not approved yet pauses the brand only: that money
--     was never in the factory's balance (pauses_factory). If the bank later
--     decides for the brand on an approved step, the factory is paused then.
--     Unpausing the brand closes such a review (decision 'brand_unpaused').
--  3. A refund that fails after Refund brand gives the amount back to the
--     factory and reopens the review (refund_failed_at), so staff decide again.
--  4. A dispute lost before approval no longer tells a paused brand to pay again.
--  5. What staff need for the counts and rows: open = needs a decision or a
--     brand to unpause; decided disputes waiting for the bank are decided.

-- ---------------------------------------------------------------------------
-- Columns.
-- ---------------------------------------------------------------------------
alter table public.payment_reviews add column if not exists pauses_factory boolean not null default true;
-- Where Refund brand took the money from ([{payment_id, cents}]), to give it back exactly.
alter table public.payment_reviews add column if not exists takes jsonb not null default '[]'::jsonb;
alter table public.payment_reviews add column if not exists refund_failed_at timestamptz;
alter table public.payment_reviews add column if not exists refund_failed_cents bigint not null default 0 check (refund_failed_cents >= 0);
alter table public.payment_reviews drop constraint if exists payment_reviews_decision_check;
alter table public.payment_reviews add constraint payment_reviews_decision_check
  check (decision in ('pay_factory', 'refund_brand', 'brand_unpaused'));
comment on column public.payment_reviews.pauses_factory is
  'False for a dispute on a step not approved yet: the brand is paused, the factory is not (20261124100100).';

-- Open reviews on a step not approved yet stop pausing the factory now.
update public.payment_reviews v
   set pauses_factory = false, updated_at = now()
  from public.order_payments p
 where p.id = v.payment_id and v.cause = 'dispute' and v.decided_at is null
   and not (p.state = 'released' or p.release_requested_at is not null);

-- ---------------------------------------------------------------------------
-- Who is paused, and what counts as open.
-- ---------------------------------------------------------------------------
create or replace function public.factory_paused(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.payment_reviews v
                  where v.factory_org_id = target_org and v.decided_at is null and v.pauses_factory);
$$;

-- What a factory's card says: the step and order of its oldest open review.
create or replace function public.factory_review_summary(target_org uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when count(*) = 0 then null else jsonb_build_object(
           'paused', true,
           'step_title', (array_agg(coalesce(m.title, o.order_number) order by v.created_at))[1],
           'order_number', (array_agg(o.order_number order by v.created_at))[1],
           'since', min(v.created_at),
           'count', count(*)) end
    from public.payment_reviews v
    join public.production_orders o on o.id = v.order_id
    join public.order_payments p on p.id = v.payment_id
    left join public.order_milestones m on m.id = p.milestone_id
   where v.factory_org_id = target_org and v.decided_at is null and v.pauses_factory;
$$;

-- Open: waiting for a decision, or a brand still paused. A decided dispute
-- the bank hasn't settled is decided: its row still shows Stripe's status.
create or replace function public.payment_review_needs_staff(v public.payment_reviews)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select v.decided_at is null
      or (v.cause = 'dispute' and v.brand_unpaused_at is null);
$$;

-- ---------------------------------------------------------------------------
-- Opening a review: the factory is paused only for money in its balance.
-- ---------------------------------------------------------------------------
-- The factory's "Withdrawals paused" notice, once per review (the words of 20261124100000).
create or replace function public.tell_factory_paused(v public.payment_reviews, step text, order_number text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.notifications (org_id, kind, subject_type, subject_id, order_id, title, body, data, dedupe_key)
  values (v.factory_org_id, 'payment_disputed', 'payment', v.payment_id, v.order_id,
          'Withdrawals paused',
          format('A brand requested a refund for "%s" on %s, so our team is reviewing the payment. Withdrawals are paused until the review is done.',
                 step, order_number),
          jsonb_build_object('review_id', v.id),
          'payment_review:' || v.id)
  on conflict (org_id, dedupe_key) do nothing;
end;
$$;
revoke all on function public.tell_factory_paused(public.payment_reviews, text, text) from public, anon, authenticated;

create or replace function public.open_payment_review(p public.order_payments, o public.production_orders, why text,
                                                      amount bigint, ref text, status text, due_by timestamptz, fee bigint)
returns public.payment_reviews
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v public.payment_reviews;
  m public.order_milestones;
  step text;
begin
  select * into v from public.payment_reviews
   where payment_id = p.id and cause = why and decided_at is null
   for update;
  if found then
    -- Still open: a further refund adds to it; a dispute's own news updates it.
    update public.payment_reviews
       set amount_cents = case when why = 'refund' then amount_cents + greatest(coalesce(amount, 0), 0)
                               else coalesce(amount, amount_cents) end,
           stripe_ref = coalesce(ref, stripe_ref),
           dispute_status = coalesce(status, dispute_status),
           dispute_due_by = coalesce(due_by, dispute_due_by),
           dispute_fee_cents = coalesce(fee, dispute_fee_cents),
           updated_at = now()
     where id = v.id
    returning * into v;
    return v;
  end if;

  insert into public.payment_reviews (payment_id, order_id, factory_org_id, brand_org_id, cause, amount_cents, currency,
                                      stripe_ref, dispute_status, dispute_due_by, dispute_fee_cents, pauses_factory)
  values (p.id, o.id, o.factory_org_id, o.brand_org_id, why, greatest(coalesce(amount, 0), 0), p.currency,
          ref, status, due_by, fee,
          -- Before approval the money was never in the factory's balance:
          -- only the brand is paused (20261124100100).
          p.state = 'released' or p.release_requested_at is not null)
  returning * into v;

  select * into m from public.order_milestones where id = p.milestone_id;
  step := coalesce(m.title, o.order_number);
  -- Only a refund or a dispute pauses today, so "requested a refund" is true
  -- of both, and never says the factory did anything wrong.
  if v.pauses_factory then
    perform public.tell_factory_paused(v, step, o.order_number);
  end if;
  if why = 'dispute' then
    insert into public.notifications (org_id, kind, subject_type, subject_id, order_id, title, body, data, dedupe_key)
    values (o.brand_org_id, 'payment_disputed', 'payment', p.id, o.id,
            'Account under review',
            format('A payment for "%s" on %s was disputed with your bank. Until our review is done, you can only message vendors.',
                   step, o.order_number),
            jsonb_build_object('review_id', v.id),
            'payment_review_brand:' || v.id)
    on conflict (org_id, dedupe_key) do nothing;
  end if;
  return v;
end;
$$;
revoke all on function public.open_payment_review(public.order_payments, public.production_orders, text, bigint, text, text, timestamptz, bigint) from public, anon, authenticated;
grant execute on function public.open_payment_review(public.order_payments, public.production_orders, text, bigint, text, text, timestamptz, bigint) to service_role;

create or replace function public.record_payment_review_dispute(target_payment uuid, dispute_id text, status text,
                                                                 amount_cents bigint, due_by timestamptz, fee_cents bigint)
returns public.payment_reviews
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p public.order_payments;
  o public.production_orders;
  v public.payment_reviews;
  was_status text;
begin
  if nullif(btrim(coalesce(dispute_id, '')), '') is null then
    raise exception 'a dispute names its id' using errcode = '22023';
  end if;
  select * into o from public.production_orders
   where id = (select order_id from public.order_payments where id = target_payment)
   for update;
  if not found then
    return null;
  end if;
  perform 1 from public.orgs where id = o.factory_org_id for no key update;
  select * into p from public.order_payments where id = target_payment for update;

  -- Already reviewed for this dispute (open or decided): keep Stripe's news on it.
  select * into v from public.payment_reviews
   where payment_id = p.id and cause = 'dispute' and stripe_ref = dispute_id
   order by created_at desc limit 1
   for update;
  if found then
    was_status := v.dispute_status;
    update public.payment_reviews
       set dispute_status = coalesce(status, dispute_status),
           dispute_due_by = coalesce(due_by, dispute_due_by),
           dispute_fee_cents = coalesce(fee_cents, dispute_fee_cents),
           amount_cents = coalesce(record_payment_review_dispute.amount_cents, payment_reviews.amount_cents),
           updated_at = now()
     where id = v.id
    returning * into v;
    -- A dispute that paused only the brand (the step wasn't approved then)
    -- decided for the brand once the step is approved: that money is in the
    -- factory's balance now, so the factory is paused and staff decide
    -- (20261124100100). Reopened if unpausing the brand had closed it.
    if not v.pauses_factory and status = 'lost'
       and (p.state = 'released' or p.release_requested_at is not null)
       and not exists (select 1 from public.payment_reviews x where x.payment_id = v.payment_id and x.cause = 'dispute'
                         and x.decided_at is null and x.id <> v.id) then
      update public.payment_reviews
         set pauses_factory = true, decision = null, decided_at = null, decided_by = null, updated_at = now()
       where id = v.id
      returning * into v;
      perform public.tell_factory_paused(v, (select coalesce(m.title, o.order_number) from public.order_milestones m right join (select 1) one on m.id = p.milestone_id),
                                         o.order_number);
    end if;
    -- Staff already let the factory withdraw, and the bank has now decided:
    -- the step's hold lifts (record_payment_disputed / _dispute_lost, next),
    -- so the factory is told, once, on an approved step.
    if v.decided_at is not null and v.decision = 'pay_factory'
       and status in ('won', 'lost', 'warning_closed') and was_status is distinct from status
       and (p.state = 'released' or p.release_requested_at is not null) and p.disputed_at is not null then
      insert into public.notifications (org_id, kind, subject_type, subject_id, order_id, title, body, dedupe_key)
      select o.factory_org_id, 'payment_disputed', 'payment', p.id, o.id,
             format('Hold lifted on "%s"', coalesce(m.title, o.order_number)),
             format('%s is no longer on hold.', public.format_money(public.payment_factory_cents(p), p.currency)),
             'payment_review_settled:' || v.id
        from public.order_milestones m right join (select 1) one on m.id = p.milestone_id
      on conflict (org_id, dedupe_key) do nothing;
    end if;
    return v;
  end if;
  -- First heard of once it was already settled in TSC's favour: nothing to review.
  if status in ('won', 'warning_closed') then
    return null;
  end if;
  return public.open_payment_review(p, o, 'dispute', record_payment_review_dispute.amount_cents, dispute_id, status, due_by, fee_cents);
end;
$$;
revoke all on function public.record_payment_review_dispute(uuid, text, text, bigint, timestamptz, bigint) from public, anon, authenticated;
grant execute on function public.record_payment_review_dispute(uuid, text, text, bigint, timestamptz, bigint) to service_role;

-- ---------------------------------------------------------------------------
-- Staff decide.
-- ---------------------------------------------------------------------------
create or replace function public.decide_payment_review(target_review uuid, decision text, amount_cents bigint default null,
                                                        note text default null)
returns public.payment_reviews
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v public.payment_reviews;
  p public.order_payments;
  o public.production_orders;
  m public.order_milestones;
  part record;
  cap bigint;
  left_to_take bigint;
  take bigint;
  step text;
  said_note text := nullif(btrim(coalesce(note, '')), '');
  still_paused boolean;
  taken jsonb := '[]'::jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'deciding a payment review is limited to platform staff' using errcode = '42501';
  end if;
  if decision not in ('pay_factory', 'refund_brand') then
    raise exception 'choose Pay factory or Refund brand' using errcode = '22023', hint = 'review_decision';
  end if;
  select * into v from public.payment_reviews where id = target_review;
  if not found then
    raise exception 'payment review not found' using errcode = 'P0002';
  end if;
  -- Staff in the factory, or in a brand that orders from it, leave it to someone else.
  perform public.payout_staff_check(v.factory_org_id);
  if public.is_org_member(v.brand_org_id) then
    raise exception 'you belong to this brand, so someone else on the staff must decide'
      using errcode = '42501', hint = 'review_own_company';
  end if;

  -- The order, then the factory: the same order as a withdrawal's claim, so
  -- a withdrawal racing this sees what is left.
  select * into o from public.production_orders where id = v.order_id for update;
  perform 1 from public.orgs where id = v.factory_org_id for no key update;
  select * into v from public.payment_reviews where id = target_review for update;
  if v.decided_at is not null then
    raise exception 'this review was already decided' using errcode = '22023', hint = 'review_decided';
  end if;
  -- A dispute on a step not approved yet pauses only the brand (20261124100100).
  if not v.pauses_factory then
    raise exception 'This step isn''t approved, so the factory isn''t paused. Use Unpause brand.'
      using errcode = '22023', hint = 'review_brand_only';
  end if;
  select * into p from public.order_payments where id = v.payment_id;
  select * into m from public.order_milestones where id = p.milestone_id;
  step := coalesce(m.title, o.order_number);

  if decision = 'refund_brand' then
    -- Only money that reached the factory's balance through this step: before
    -- approval the brand's money goes back through Stripe (a lost dispute
    -- sends it to pay again), so taking from the balance would take it twice.
    if not (p.state = 'released' or p.release_requested_at is not null) then
      raise exception 'This step isn''t approved, so its money isn''t in the factory''s balance. Choose Pay factory.'
        using errcode = '22023', hint = 'review_not_approved';
    end if;
    -- A dispute: only once the bank decided for the brand (lost). Until then
    -- the brand has not had its money back; Pay factory or wait for the bank.
    if v.cause = 'dispute' and coalesce(v.dispute_status, '') <> 'lost' then
      raise exception 'The bank hasn''t decided this dispute yet. Refund brand is available once the brand has its money back.'
        using errcode = '22023', hint = 'review_dispute_open';
    end if;
    if amount_cents is null or amount_cents <= 0 then
      raise exception 'Enter an amount to refund.' using errcode = '22023', hint = 'review_amount';
    end if;
    if said_note is null then
      raise exception 'Add a note for the factory.' using errcode = '22023', hint = 'review_note';
    end if;
    -- Never more than the factory's part of what the brand got back.
    if amount_cents > public.payment_review_factory_part(v) then
      raise exception 'You can take up to %, the factory''s part of what the brand got back.', public.format_money(public.payment_review_factory_part(v), 'USD')
        using errcode = '22023', hint = 'review_over_part', detail = public.format_money(public.payment_review_factory_part(v), 'USD');
    end if;
    cap := public.review_returnable_cents(v.factory_org_id);
    if amount_cents > cap then
      raise exception 'You can take up to %, the factory''s balance now.', public.format_money(cap, 'USD')
        using errcode = '22023', hint = 'review_over_balance', detail = public.format_money(cap, 'USD');
    end if;
    left_to_take := amount_cents;
    for part in select * from public.review_returnable_parts(v.factory_org_id, v.payment_id) loop
      exit when left_to_take <= 0;
      take := least(part.room_cents, left_to_take);
      continue when take <= 0;
      update public.order_payments set taken_back_cents = taken_back_cents + take where id = part.payment_id;
      -- Kept on the review, so a refund that fails later gives back exactly this.
      taken := taken || jsonb_build_array(jsonb_build_object('payment_id', part.payment_id, 'cents', take));
      insert into public.payment_events (payment_id, from_state, to_state, actor_kind, actor_user_id, note)
      select x.id, x.state, x.state, 'admin', auth.uid(),
             format('Returned %s to the brand from the factory''s balance (payment review).', public.format_money(take, 'USD'))
        from public.order_payments x where x.id = part.payment_id;
      left_to_take := left_to_take - take;
    end loop;
    if left_to_take > 0 then
      -- The cap said it fits; anything else is a bug, not a debt.
      raise exception 'the factory''s balance changed: try again' using errcode = '40001', hint = 'review_over_balance';
    end if;
  end if;

  update public.payment_reviews
     set decision = decide_payment_review.decision, decided_at = now(), decided_by = auth.uid(),
         returned_cents = case when decide_payment_review.decision = 'refund_brand' then decide_payment_review.amount_cents else 0 end,
         takes = taken,
         note = said_note, updated_at = now()
   where id = v.id
  returning * into v;

  still_paused := public.factory_paused(v.factory_org_id);
  insert into public.notifications (org_id, kind, subject_type, subject_id, order_id, title, body, data, dedupe_key)
  values (v.factory_org_id, 'payment_disputed', 'payment', p.id, o.id,
          case when v.decision = 'refund_brand' or still_paused then 'Payment review complete'
               else 'Withdrawals resumed' end,
          case when v.decision = 'refund_brand'
                 then format('%s for "%s" was returned to the brand.', public.format_money(v.returned_cents, 'USD'), step)
               else format('The review of the payment for "%s" is done.', step) end
          || case when still_paused then ' Withdrawals stay paused while another payment is reviewed.'
                  when v.decision = 'refund_brand' then ' You can withdraw the rest of your balance.'
                  else ' You can withdraw your balance again.' end
          -- A disputed step stays on hold until the bank decides (told again then).
          || case when v.decision = 'pay_factory' and p.disputed_at is not null
                  then format(' "%s" stays on hold until the payment is settled.', step) else '' end
          || case when said_note is not null then ' Note from our team: ' || said_note else '' end,
          jsonb_build_object('review_id', v.id, 'returned_cents', v.returned_cents),
          'payment_review_done:' || v.id)
  on conflict (org_id, dedupe_key) do nothing;
  return v;
end;
$$;
revoke all on function public.decide_payment_review(uuid, text, bigint, text) from public, anon;
grant execute on function public.decide_payment_review(uuid, text, bigint, text) to authenticated, service_role;

create or replace function public.unpause_brand(target_review uuid)
returns public.payment_reviews
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v public.payment_reviews;
begin
  if not public.is_platform_admin() then
    raise exception 'unpausing a brand is limited to platform staff' using errcode = '42501';
  end if;
  select * into v from public.payment_reviews where id = target_review for update;
  if not found then
    raise exception 'payment review not found' using errcode = 'P0002';
  end if;
  perform public.payout_staff_check(v.factory_org_id);
  if public.is_org_member(v.brand_org_id) then
    raise exception 'you belong to this brand, so someone else on the staff must decide'
      using errcode = '42501', hint = 'review_own_company';
  end if;
  if v.cause <> 'dispute' or v.brand_unpaused_at is not null then
    raise exception 'this brand is not paused by this review' using errcode = '22023', hint = 'review_brand_not_paused';
  end if;
  update public.payment_reviews
     set brand_unpaused_at = now(), brand_unpaused_by = auth.uid(), updated_at = now(),
         -- A review that paused only the brand is done once it is unpaused (20261124100100).
         decision = case when not pauses_factory and decided_at is null then 'brand_unpaused' else decision end,
         decided_by = case when not pauses_factory and decided_at is null then auth.uid() else decided_by end,
         decided_at = case when not pauses_factory and decided_at is null then now() else decided_at end
   where id = v.id
  returning * into v;
  if not public.brand_paused(v.brand_org_id) then
    insert into public.notifications (org_id, kind, subject_type, subject_id, order_id, title, body, data, dedupe_key)
    values (v.brand_org_id, 'payment_disputed', 'payment', v.payment_id, v.order_id,
            'Account review complete', 'Your account is no longer under review.',
            jsonb_build_object('review_id', v.id), 'payment_review_brand_done:' || v.id)
    on conflict (org_id, dedupe_key) do nothing;
  end if;
  return v;
end;
$$;
revoke all on function public.unpause_brand(uuid) from public, anon;
grant execute on function public.unpause_brand(uuid) to authenticated, service_role;

create or replace function public.payment_review_board()
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
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', v.id, 'payment_id', v.payment_id, 'order_id', v.order_id, 'order_number', o.order_number,
      'factory_org_id', v.factory_org_id, 'factory_name', f.name,
      'brand_org_id', v.brand_org_id, 'brand_name', b.name,
      'milestone_title', m.title, 'cause', v.cause,
      'amount_cents', v.amount_cents, 'currency', v.currency,
      -- The factory's part of that amount: Refund brand's suggestion.
      'factory_part_cents', public.payment_review_factory_part(v),
      'step_cents', public.payment_factory_base_cents(p),
      'stripe_ref', v.stripe_ref, 'stripe_payment_intent_id', p.stripe_payment_intent_id,
      'dispute_status', v.dispute_status, 'dispute_due_by', v.dispute_due_by,
      'dispute_fee_cents', coalesce(v.dispute_fee_cents, p.dispute_fee_cents),
      'approved', p.release_requested_at is not null or p.state = 'released',
      'payment_state', p.state,
      -- What can still be returned now, and what of this step already left.
      'returnable_cents', public.review_returnable_cents(v.factory_org_id),
      'withdrawn_cents', case
          when p.state = 'released' and not exists (select 1 from public.payment_takes t where t.payment_id = p.id and t.status in ('held', 'sent'))
            then public.payment_factory_base_cents(p)
          else coalesce((select sum(t.amount_cents) from public.payment_takes t where t.payment_id = p.id and t.status = 'sent'), 0) end,
      'withdrawn_by', coalesce((
          select jsonb_agg(distinct case when t.road = 'stripe' then 'stripe' else coalesce(w.provider, 'bank') end)
            from public.payment_takes t
            left join public.factory_withdrawals w on w.id = t.factory_withdrawal_id
           where t.payment_id = p.id and t.status = 'sent'), '[]'::jsonb),
      'in_withdrawal_cents', coalesce((select sum(t.amount_cents) from public.payment_takes t
                                        where t.payment_id = p.id and t.status = 'held'), 0),
      'factory_paused', v.decided_at is null and v.pauses_factory,
      'pauses_factory', v.pauses_factory,
      -- The paused factory's orders: staff's payout rows (by order) show no
      -- payout button for them (20261124100100).
      'factory_order_ids', case when v.decided_at is null and v.pauses_factory then
          (select coalesce(jsonb_agg(x.id), '[]'::jsonb) from public.production_orders x where x.factory_org_id = v.factory_org_id)
        else '[]'::jsonb end,
      -- What the brand was charged, for "Partly refunded: $X of $Y".
      'charged_cents', coalesce(p.charged_cents, p.amount_received_cents, p.amount_cents),
      'refund_failed_at', v.refund_failed_at, 'refund_failed_cents', v.refund_failed_cents,
      -- Paused by any review (this one decided, another still open).
      'factory_still_paused', public.factory_paused(v.factory_org_id),
      'step_on_hold', p.disputed_at is not null,
      'brand_paused', v.cause = 'dispute' and v.brand_unpaused_at is null,
      'decision', v.decision, 'returned_cents', v.returned_cents, 'note', v.note,
      'decided_at', v.decided_at, 'decided_by_name', (select u.full_name from public.user_profiles u where u.id = v.decided_by),
      'brand_unpaused_at', v.brand_unpaused_at,
      'brand_unpaused_by_name', (select u.full_name from public.user_profiles u where u.id = v.brand_unpaused_by),
      'created_at', v.created_at,
      'open', public.payment_review_needs_staff(v)
    ) order by public.payment_review_needs_staff(v) desc,
               v.dispute_due_by nulls last, v.created_at)
      from public.payment_reviews v
      join public.order_payments p on p.id = v.payment_id
      join public.production_orders o on o.id = v.order_id
      join public.orgs f on f.id = v.factory_org_id
      join public.orgs b on b.id = v.brand_org_id
      left join public.order_milestones m on m.id = p.milestone_id
     where public.payment_review_needs_staff(v)
        or greatest(v.decided_at, v.brand_unpaused_at) > now() - interval '30 days'), '[]'::jsonb);
end;
$$;
revoke all on function public.payment_review_board() from public, anon;
grant execute on function public.payment_review_board() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- A refund that failed, and a dispute lost before approval.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_payment_refund_failed(target_payment uuid, payment_intent text, refunded_cents bigint)
 RETURNS order_payments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  p public.order_payments;
  o public.production_orders;
  m public.order_milestones;
  was_total bigint;
  was_share bigint;
  total bigint := $3;
  ref text := format(' (Stripe %s)', payment_intent);
  v public.payment_reviews;
  t record;
  back bigint;
  left_back bigint;
  given_back bigint := 0;
  reopen boolean;
  reopened boolean := false;
begin
  if nullif(btrim(coalesce(payment_intent, '')), '') is null then
    raise exception 'a refund names the PaymentIntent it refunded' using errcode = '22023';
  end if;
  if total is null or total < 0 then
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
  if p.stripe_payment_intent_id is distinct from payment_intent or p.state not in ('confirmed', 'released')
     or total >= p.refunded_cents then
    return p;
  end if;
  was_total := p.refunded_cents;
  was_share := p.factory_refund_cents;
  update public.order_payments
     set refunded_cents = total, refund_amount_at = now(),
         -- The failed part was kept by the factory first (20261124100000).
         review_kept_cents = greatest(0, review_kept_cents - (was_total - total))
   where id = p.id
  returning * into p;
  -- An open refund review says only what still went back (20261124100000).
  update public.payment_reviews
     set amount_cents = greatest(0, amount_cents - (was_total - total)), updated_at = now()
   where payment_id = p.id and cause = 'refund' and decided_at is null;
  -- Staff already took money from the factory's balance for this refund
  -- (Refund brand): it comes back, exactly where it was taken from, and the
  -- review opens again for staff to decide on what still went back
  -- (20261124100100).
  for v in select * from public.payment_reviews
            where payment_id = p.id and cause = 'refund' and decision = 'refund_brand' and returned_cents > 0
            order by decided_at desc
              for update loop
    left_back := v.returned_cents;
    for t in select (e->>'payment_id')::uuid as payment_id, (e->>'cents')::bigint as cents
               from jsonb_array_elements(case when jsonb_array_length(v.takes) > 0 then v.takes
                                              else jsonb_build_array(jsonb_build_object('payment_id', v.payment_id, 'cents', v.returned_cents)) end) e loop
      exit when left_back <= 0;
      select least(x.taken_back_cents, t.cents, left_back) into back
        from public.order_payments x where x.id = t.payment_id for update;
      continue when coalesce(back, 0) <= 0;
      update public.order_payments x set taken_back_cents = x.taken_back_cents - back where x.id = t.payment_id;
      insert into public.payment_events (payment_id, from_state, to_state, actor_kind, note)
      select x.id, x.state, x.state, 'system',
             format('The refund to the brand failed: %s given back to the factory''s balance (payment review).', public.format_money(back, 'USD'))
        from public.order_payments x where x.id = t.payment_id;
      left_back := left_back - back;
    end loop;
    given_back := given_back + (v.returned_cents - left_back);
    reopen := not exists (select 1 from public.payment_reviews x where x.payment_id = p.id and x.cause = 'refund'
                            and x.decided_at is null);
    update public.payment_reviews
       set amount_cents = greatest(0, amount_cents - (was_total - total)),
           refund_failed_at = now(), refund_failed_cents = refund_failed_cents + (v.returned_cents - left_back),
           returned_cents = 0, takes = '[]'::jsonb,
           decision = case when reopen then null else decision end,
           decided_at = case when reopen then null else decided_at end,
           decided_by = case when reopen then null else decided_by end,
           updated_at = now()
     where id = v.id;
    reopened := reopened or reopen;
  end loop;
  if given_back > 0 then
    -- Its payments read again: the figures below compare with the new ones.
    select * into p from public.order_payments where id = p.id;
  end if;
  insert into public.payment_events (payment_id, stripe_ref, from_state, to_state, actor_kind, note)
  values (p.id, record_payment_refund_failed.payment_intent, p.state, p.state, 'system',
          format('A refund failed in Stripe: %s refunded in all.', public.format_money(total, p.currency)) || ref);
  -- Each side was told of the refund: told it did not go through (20261121240000).
  select * into m from public.order_milestones where id = p.milestone_id;
  insert into public.notifications (org_id, kind, subject_type, subject_id, order_id, title, body)
  values (o.brand_org_id, 'payment_refunded', 'payment', p.id, o.id,
          format('Refund for "%s" didn''t go through', coalesce(m.title, o.order_number)),
          format('Your %s refund didn''t go through. That amount stays on this order.', public.format_money(was_total - total, p.currency)));
  if given_back > 0 or p.factory_refund_cents < was_share then
    insert into public.notifications (org_id, kind, subject_type, subject_id, order_id, title, body)
    values (o.factory_org_id, 'payment_refunded', 'payment', p.id, o.id,
            format('Refund for "%s" didn''t go through', coalesce(m.title, o.order_number)),
            format('The refund to the brand didn''t go through. Your earnings from %s went back up by %s.', o.order_number,
                   public.format_money(greatest(given_back, was_share - p.factory_refund_cents), p.currency))
            -- The review is open again: staff decide on what still went back.
            || case when reopened then ' Withdrawals are paused while our team reviews the payment again.' else '' end);
  end if;
  return p;
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_payment_dispute_lost(target_payment uuid, dispute_id text, lost_cents bigint, fee_cents bigint)
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
  next_state public.payment_state;
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
     -- Only a recording counts: the line kept for staff while the payment
     -- was not funded yet (from = to) does not (20261121230000).
     or exists (select 1 from public.payment_events e where e.payment_id = p.id and e.cause = 'dispute_lost'
                  and e.stripe_ref = record_payment_dispute_lost.dispute_id and e.from_state is distinct from e.to_state) then
    return p;
  end if;
  charged := coalesce(p.charged_cents, p.amount_received_cents, p.amount_cents);
  lost := least(coalesce(lost_cents, charged, 0), greatest(coalesce(charged, 0) - p.refunded_cents, 0));
  select * into m from public.order_milestones where id = p.milestone_id;

  -- Before approval, all that was left of the charge lost: as a full refund,
  -- the brand pays again. Part of it lost: the step stays funded with the
  -- rest, as after a partial refund (below), so nothing is left in TSC's
  -- Stripe balance unrecorded (20261121230000).
  if was = 'confirmed' and p.release_requested_at is null and lost >= coalesce(charged, 0) - p.refunded_cents then
    next_state := case when o.status = 'cancelled' then 'cancelled'::public.payment_state else 'failed'::public.payment_state end;
    -- One reset with the refund's (20261121340000), keeping this loss on a
    -- cancelled order.
    p := public.reset_refunded_payment(p.id, next_state, why, lost, fee_cents);
    insert into public.payment_events (payment_id, stripe_ref, from_state, to_state, actor_kind, note, cause)
    values (p.id, record_payment_dispute_lost.dispute_id, was, next_state, 'system',
            format('Dispute lost: %s went back to the brand. Stripe''s dispute fee %s is TSC''s.',
                   public.format_money(lost, p.currency), public.format_money(coalesce(fee_cents, 0), p.currency)) || ref, 'dispute_lost');
    insert into public.notifications (org_id, kind, subject_type, subject_id, order_id, title, body)
    values (o.brand_org_id, 'payment_refunded', 'payment', p.id, o.id,
            format('Your bank reversed your payment for "%s"', coalesce(m.title, o.order_number)),
            format('%s went back to your card.', public.format_money(lost, p.currency))
            -- Not to a paused brand, which can't pay until staff unpause it
            -- (its notice says so) (20261124100100).
            || case when next_state = 'failed' and not public.brand_paused(o.brand_org_id)
                    then format(' Pay again from the step''s payment page on %s.', o.order_number) else '' end);
    insert into public.notifications (org_id, kind, subject_type, subject_id, order_id, title, body)
    values (o.factory_org_id, 'payment_refunded', 'payment', p.id, o.id,
            format('Payment for "%s" reversed', coalesce(m.title, o.order_number)),
            case when next_state = 'failed'
                 then format('TSC no longer holds money for this step on %s. The brand has been asked to pay again; we will tell you when it is held.',
                             o.order_number)
                 else format('%s was cancelled.', o.order_number) end);
    return p;
  end if;

  if was not in ('confirmed', 'released') then
    -- Not funded here (yet, or any more): the line is kept for staff.
    insert into public.payment_events (payment_id, stripe_ref, from_state, to_state, actor_kind, note, cause)
    values (p.id, record_payment_dispute_lost.dispute_id, was, was, 'system',
            format('Dispute lost: %s went back to the brand. Stripe''s dispute fee %s is TSC''s.',
                   public.format_money(coalesce(lost, 0), p.currency), public.format_money(coalesce(fee_cents, 0), p.currency)) || ref, 'dispute_lost');
    return p;
  end if;

  -- After approval (or part of it before): the step stays as it is; its
  -- earning goes down by the factory's part, and what had already left is
  -- owed to TSC.
  was_share := p.factory_refund_cents;
  was_debt := coalesce(public.payment_debt_cents(p), 0);
  update public.order_payments
     set dispute_lost_cents = lost, dispute_lost_at = now(), dispute_fee_cents = fee_cents, disputed_at = null,
         -- After approval the factory's part is kept: the payment review
         -- decides (20261124100000).
         review_kept_cents = review_kept_cents
           + case when p.state = 'released' or p.release_requested_at is not null then lost else 0 end
   where id = p.id
  returning * into p;
  now_debt := coalesce(public.payment_debt_cents(p), 0);
  insert into public.payment_events (payment_id, stripe_ref, from_state, to_state, actor_kind, note, cause)
  values (p.id, record_payment_dispute_lost.dispute_id, was, was, 'system',
          format('Dispute lost: %s went back to the brand. Stripe''s dispute fee %s is TSC''s.',
                 public.format_money(lost, p.currency), public.format_money(coalesce(fee_cents, 0), p.currency))
          || case when now_debt > was_debt
                  then format(' %s of it had already been withdrawn: TSC is owed it.', public.format_money(now_debt - was_debt, p.currency))
                  else '' end
          || ref, 'dispute_lost');
  insert into public.notifications (org_id, kind, subject_type, subject_id, order_id, title, body)
  values (o.brand_org_id, 'payment_refunded', 'payment', p.id, o.id,
          format('Your bank reversed your payment for "%s"', coalesce(m.title, o.order_number)),
          format('%s went back to your card.', public.format_money(lost, p.currency)));
  perform public.tell_earnings_down(p, o, format('Payment for "%s" reversed', coalesce(m.title, o.order_number)),
                                    'The brand''s bank reversed the payment.', was_share, was_debt);
  return p;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Staff can't pay a paused factory by any road (20261124100100). The
-- withdrawal roads were already refused (payment_takes, provider attempts,
-- Stripe withdrawals, withdrawal_blocker); these close the rest:
--   - a hand payout of an owed step (release_payment_to_factory,
--     release_payment_by_payoneer: staff mark it released);
--   - a Stripe per-step payout starting (claim_payment_release);
--   - a waiting withdrawal marked paid by bank (mark_withdrawal_paid_by_bank).
-- What the server records for a payout that already started (a transfer, a
-- provider's answer) is never refused: it runs without a signed-in user.
-- ---------------------------------------------------------------------------
create or replace function public.guard_paused_payout()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  factory uuid;
begin
  if (new.release_claimed_at is not null and old.release_claimed_at is null)
     or (new.state = 'released' and old.state is distinct from 'released' and auth.uid() is not null) then
    select o.factory_org_id into factory from public.production_orders o where o.id = new.order_id;
    if factory is not null and public.factory_paused(factory) then
      raise exception 'This factory''s withdrawals are paused while a payment is reviewed.'
        using errcode = '22023', hint = 'payment_under_review';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_paused_payout() from public, anon, authenticated;
drop trigger if exists order_payments_paused_payout on public.order_payments;
create trigger order_payments_paused_payout before update of state, release_claimed_at on public.order_payments
  for each row execute function public.guard_paused_payout();

create or replace function public.guard_paused_bank_withdrawal()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'paid' and old.status is distinct from 'paid' and auth.uid() is not null
     and public.factory_paused(new.org_id) then
    raise exception 'This factory''s withdrawals are paused while a payment is reviewed.'
      using errcode = '22023', hint = 'payment_under_review';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_paused_bank_withdrawal() from public, anon, authenticated;
drop trigger if exists factory_withdrawals_paused_paid on public.factory_withdrawals;
create trigger factory_withdrawals_paused_paid before update of status on public.factory_withdrawals
  for each row execute function public.guard_paused_bank_withdrawal();
