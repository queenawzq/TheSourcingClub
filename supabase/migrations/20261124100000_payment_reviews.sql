-- Paused payments: a refund or dispute never takes money from a factory by
-- itself. It opens a payment review instead:
--   * the factory's withdrawals are paused on every road until staff decide;
--   * on a dispute the brand is paused too: it can message vendors, nothing
--     else that commits money (post a request, fund a step, accept a quote,
--     approve a step, cancel an order);
--   * staff decide in admin: Pay factory (nothing taken), Refund brand (an
--     amount, never more than what the factory can still withdraw), and
--     Unpause brand on its own.
-- A refund or dispute after approval no longer lowers the factory's earning:
-- review_kept_cents holds the factory's part of it, and only staff's Refund
-- brand lowers it (taken_back_cents), spread over money that has not left
-- TSC, so no payment's earning ever falls below what was withdrawn from it.
-- The "owes TSC" debt can therefore no longer arise; its helpers stay one
-- more release (always 0) and its sentences are gone from every screen.

-- ---------------------------------------------------------------------------
-- 0. Nothing is owed today (production: no refunds, no disputes). If some
--    payment carried a debt, this stops the deploy rather than hide it.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.order_payments p where coalesce(public.payment_debt_cents(p), 0) > 0) then
    raise exception 'a payment carries money owed to TSC: settle it before paused payments ship';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. What the factory keeps of a refund after approval, and what staff
--    returned to the brand from its balance.
-- ---------------------------------------------------------------------------
alter table public.order_payments
  add column if not exists review_kept_cents bigint not null default 0,
  add column if not exists taken_back_cents bigint not null default 0;
alter table public.order_payments
  drop constraint if exists order_payments_review_kept_cents_check,
  add constraint order_payments_review_kept_cents_check check (review_kept_cents >= 0),
  drop constraint if exists order_payments_taken_back_cents_check,
  add constraint order_payments_taken_back_cents_check check (taken_back_cents >= 0);
comment on column public.order_payments.review_kept_cents is
  'Brand-side cents refunded or lost in a dispute after approval, whose factory part the factory keeps until staff decide (20261124100000).';
comment on column public.order_payments.taken_back_cents is
  'Factory cents staff returned to the brand from this payment in a payment review (20261124100000).';

-- The factory's part of what went back: refunds and losses before approval,
-- in proportion to its step within the charge, plus what staff returned.
alter table public.order_payments
  alter column factory_refund_cents set expression as (
    least(
      greatest((case when charged_cents is not null then amount_cents
                     else coalesce(amount_received_cents, amount_cents) end
                - coalesce(payout_fee_cents, 0)), 0),
      coalesce(round(greatest(refunded_cents + dispute_lost_cents - review_kept_cents, 0)::numeric * amount_cents
                     / nullif(coalesce(charged_cents, amount_received_cents, amount_cents), 0))::bigint, 0)
      + taken_back_cents));

-- ---------------------------------------------------------------------------
-- 2. Payment reviews. Staff read them through payment_review_board(); the
--    factory and the brand only through their own summaries. Only functions
--    write.
-- ---------------------------------------------------------------------------
create table if not exists public.payment_reviews (
  id                 uuid primary key default gen_random_uuid(),
  payment_id         uuid not null references public.order_payments(id) on delete cascade,
  order_id           uuid not null references public.production_orders(id) on delete cascade,
  factory_org_id     uuid not null references public.orgs(id) on delete cascade,
  brand_org_id       uuid not null references public.orgs(id) on delete cascade,
  cause              text not null check (cause in ('dispute', 'refund')),
  -- What went back to the brand, or is disputed, in the charge's cents.
  amount_cents       bigint not null default 0 check (amount_cents >= 0),
  currency           text not null default 'USD',
  -- The dispute's id, or the refunded PaymentIntent.
  stripe_ref         text,
  dispute_status     text,
  dispute_due_by     timestamptz,
  dispute_fee_cents  bigint,
  decision           text check (decision in ('pay_factory', 'refund_brand')),
  returned_cents     bigint not null default 0 check (returned_cents >= 0),
  note               text,
  decided_by         uuid references auth.users(id) on delete set null,
  decided_at         timestamptz,
  brand_unpaused_by  uuid references auth.users(id) on delete set null,
  brand_unpaused_at  timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check ((decision is null) = (decided_at is null)),
  check (decision = 'refund_brand' or returned_cents = 0)
);
comment on table public.payment_reviews is
  'A refund or dispute that paused a factory''s withdrawals (and, on a dispute, its brand) until staff decide (20261124100000).';
create unique index if not exists payment_reviews_one_open
  on public.payment_reviews (payment_id, cause) where decided_at is null;
create index if not exists payment_reviews_factory_open on public.payment_reviews (factory_org_id) where decided_at is null;
create index if not exists payment_reviews_brand_open on public.payment_reviews (brand_org_id) where brand_unpaused_at is null and cause = 'dispute';

alter table public.payment_reviews enable row level security;
revoke all on table public.payment_reviews from public, anon, authenticated;
grant all on table public.payment_reviews to service_role;

-- ---------------------------------------------------------------------------
-- 3. Who is paused.
-- ---------------------------------------------------------------------------
create or replace function public.factory_paused(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.payment_reviews v
                  where v.factory_org_id = target_org and v.decided_at is null);
$$;
revoke all on function public.factory_paused(uuid) from public, anon, authenticated;
grant execute on function public.factory_paused(uuid) to service_role;

create or replace function public.brand_paused(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.payment_reviews v
                  where v.brand_org_id = target_org and v.cause = 'dispute' and v.brand_unpaused_at is null);
$$;
revoke all on function public.brand_paused(uuid) from public, anon, authenticated;
grant execute on function public.brand_paused(uuid) to service_role;

-- What a factory's card says: the step of its oldest open review.
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
   where v.factory_org_id = target_org and v.decided_at is null;
$$;
revoke all on function public.factory_review_summary(uuid) from public, anon, authenticated;
grant execute on function public.factory_review_summary(uuid) to service_role;

-- For a company's own screens: whether it is paused, and why, in its own
-- terms. Members only; says nothing about any other company.
create or replace function public.my_payment_pause(target_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_org_member(target_org) then
    raise exception 'not a member of this company' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'brand_paused', public.brand_paused(target_org),
    'factory', public.factory_review_summary(target_org));
end;
$$;
revoke all on function public.my_payment_pause(uuid) from public, anon, authenticated;
grant execute on function public.my_payment_pause(uuid) to authenticated, service_role;

-- The one refusal for a paused brand's actions ("fund steps", "accept quotes"...).
create or replace function public.refuse_paused_brand(target_org uuid, what text)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if public.brand_paused(target_org) then
    raise exception 'You can''t % while your account is under review.', what
      using errcode = '42501', hint = 'brand_under_review', detail = what;
  end if;
end;
$$;
revoke all on function public.refuse_paused_brand(uuid, text) from public, anon, authenticated;
grant execute on function public.refuse_paused_brand(uuid, text) to service_role;

-- What staff may still return to the brand from a factory: per payment, what
-- it earns less what was withdrawn or is in a waiting withdrawal; never a
-- payment whose per-step payout is under way. The reviewed payment first.
create or replace function public.review_returnable_parts(target_org uuid, first_payment uuid)
returns table (payment_id uuid, room_cents bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id,
         greatest(0, public.payment_factory_cents(p)
                     - coalesce((select sum(t.amount_cents) from public.payment_takes t
                                  where t.payment_id = p.id and t.status in ('held', 'sent')), 0))::bigint
    from public.order_payments p
    join public.production_orders o on o.id = p.order_id
   where o.factory_org_id = target_org
     and p.currency = 'USD'
     and p.state = 'confirmed'
     and p.release_requested_at is not null
     and not p.withdrawal_pool
     and not p.stripe_release_started
     and p.release_claimed_at is null
     -- A per-step payout under way or failed is staff's to settle (paid again,
     -- or by hand): never taken from.
     and coalesce((select x.status from public.provider_payouts x where x.payment_id = p.id
                    order by x.created_at desc limit 1), '') not in ('processing', 'failed')
   order by (p.id = first_payment) desc, p.release_requested_at desc, p.id;
$$;
revoke all on function public.review_returnable_parts(uuid, uuid) from public, anon, authenticated;
grant execute on function public.review_returnable_parts(uuid, uuid) to service_role;

create or replace function public.review_returnable_cents(target_org uuid)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(room_cents), 0)::bigint from public.review_returnable_parts(target_org, null);
$$;
revoke all on function public.review_returnable_cents(uuid) from public, anon, authenticated;
grant execute on function public.review_returnable_cents(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Opening a review, and what each side is told.
-- ---------------------------------------------------------------------------
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
                                      stripe_ref, dispute_status, dispute_due_by, dispute_fee_cents)
  values (p.id, o.id, o.factory_org_id, o.brand_org_id, why, greatest(coalesce(amount, 0), 0), p.currency,
          ref, status, due_by, fee)
  returning * into v;

  select * into m from public.order_milestones where id = p.milestone_id;
  step := coalesce(m.title, o.order_number);
  -- Only a refund or a dispute pauses today, so "requested a refund" is true
  -- of both, and never says the factory did anything wrong.
  insert into public.notifications (org_id, kind, subject_type, subject_id, order_id, title, body, data, dedupe_key)
  values (o.factory_org_id, 'payment_disputed', 'payment', p.id, o.id,
          'Withdrawals paused',
          format('A brand requested a refund for "%s" on %s, so our team is reviewing the payment. Withdrawals are paused until the review is done.',
                 step, o.order_number),
          jsonb_build_object('review_id', v.id),
          'payment_review:' || v.id)
  on conflict (org_id, dedupe_key) do nothing;
  if why = 'dispute' then
    insert into public.notifications (org_id, kind, subject_type, subject_id, order_id, title, body, data, dedupe_key)
    values (o.brand_org_id, 'payment_disputed', 'payment', p.id, o.id,
            'Account under review',
            format('A payment for "%s" on %s was disputed with your bank. Until the review is done, you can message vendors but can''t post requests, fund steps, accept quotes, approve steps or cancel orders.',
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

-- The server, for every dispute it reads (opened, updated, won or lost):
-- opens the review once and keeps Stripe's status on it. Never decides.
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
    update public.payment_reviews
       set dispute_status = coalesce(status, dispute_status),
           dispute_due_by = coalesce(due_by, dispute_due_by),
           dispute_fee_cents = coalesce(fee_cents, dispute_fee_cents),
           amount_cents = coalesce(record_payment_review_dispute.amount_cents, payment_reviews.amount_cents),
           updated_at = now()
     where id = v.id
    returning * into v;
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

-- The old per-step dispute notices ("Payment for X on hold", "Hold lifted")
-- are replaced by the review's: a dispute's outcome no longer decides
-- anything by itself, staff do.
create or replace function public.tell_payment_hold(p public.order_payments, held boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return;
end;
$$;
revoke all on function public.tell_payment_hold(public.order_payments, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Staff decide.
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
    cap := public.review_returnable_cents(v.factory_org_id);
    if amount_cents > cap then
      raise exception 'You can refund up to %, the factory''s balance now.', public.format_money(cap, 'USD')
        using errcode = '22023', hint = 'review_over_balance', detail = public.format_money(cap, 'USD');
    end if;
    left_to_take := amount_cents;
    for part in select * from public.review_returnable_parts(v.factory_org_id, v.payment_id) loop
      exit when left_to_take <= 0;
      take := least(part.room_cents, left_to_take);
      continue when take <= 0;
      update public.order_payments set taken_back_cents = taken_back_cents + take where id = part.payment_id;
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
         note = said_note, updated_at = now()
   where id = v.id
  returning * into v;

  still_paused := public.factory_paused(v.factory_org_id);
  insert into public.notifications (org_id, kind, subject_type, subject_id, order_id, title, body, data, dedupe_key)
  values (v.factory_org_id, 'payment_disputed', 'payment', p.id, o.id,
          case when v.decision = 'refund_brand' then 'Review complete'
               when still_paused then 'Review complete'
               else 'Withdrawals resumed' end,
          case when v.decision = 'refund_brand'
                 then format('%s for "%s" was returned to the brand.', public.format_money(v.returned_cents, 'USD'), step)
               else format('The review of the payment for "%s" is done.', step) end
          || case when still_paused then ' Withdrawals stay paused while another payment is reviewed.'
                  when v.decision = 'refund_brand' then ' You can withdraw the rest of your balance.'
                  else ' You can withdraw your balance again.' end
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
     set brand_unpaused_at = now(), brand_unpaused_by = auth.uid(), updated_at = now()
   where id = v.id
  returning * into v;
  if not public.brand_paused(v.brand_org_id) then
    insert into public.notifications (org_id, kind, subject_type, subject_id, order_id, title, body, data, dedupe_key)
    values (v.brand_org_id, 'payment_disputed', 'payment', v.payment_id, v.order_id,
            'Review complete', 'You can fund steps and accept quotes again.',
            jsonb_build_object('review_id', v.id), 'payment_review_brand_done:' || v.id)
    on conflict (org_id, dedupe_key) do nothing;
  end if;
  return v;
end;
$$;
revoke all on function public.unpause_brand(uuid) from public, anon;
grant execute on function public.unpause_brand(uuid) to authenticated, service_role;

-- Staff's board: every review still waiting on a decision, and the last 30
-- days' decided ones, with what staff need to decide.
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
      'factory_part_cents', least(public.payment_factory_base_cents(p),
          coalesce(round(v.amount_cents::numeric * p.amount_cents
                         / nullif(coalesce(p.charged_cents, p.amount_received_cents, p.amount_cents), 0))::bigint, 0)),
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
      'factory_paused', v.decided_at is null,
      'brand_paused', v.cause = 'dispute' and v.brand_unpaused_at is null,
      'decision', v.decision, 'returned_cents', v.returned_cents, 'note', v.note,
      'decided_at', v.decided_at, 'decided_by_name', (select u.full_name from public.user_profiles u where u.id = v.decided_by),
      'brand_unpaused_at', v.brand_unpaused_at,
      'brand_unpaused_by_name', (select u.full_name from public.user_profiles u where u.id = v.brand_unpaused_by),
      'created_at', v.created_at,
      'open', v.decided_at is null or (v.cause = 'dispute' and v.brand_unpaused_at is null)
    ) order by (v.decided_at is null or (v.cause = 'dispute' and v.brand_unpaused_at is null)) desc,
               v.dispute_due_by nulls last, v.created_at)
      from public.payment_reviews v
      join public.order_payments p on p.id = v.payment_id
      join public.production_orders o on o.id = v.order_id
      join public.orgs f on f.id = v.factory_org_id
      join public.orgs b on b.id = v.brand_org_id
      left join public.order_milestones m on m.id = p.milestone_id
     where v.decided_at is null or (v.cause = 'dispute' and v.brand_unpaused_at is null)
        or greatest(v.decided_at, v.brand_unpaused_at) > now() - interval '30 days'), '[]'::jsonb);
end;
$$;
revoke all on function public.payment_review_board() from public, anon;
grant execute on function public.payment_review_board() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Every withdrawal road refuses while the factory is paused: a new take
--    (a PayPal / Wise / bank request, a Stripe withdrawal) and a new
--    Wise / PayPal attempt. Staff paying a waiting one is refused by
--    withdrawal_blocker (below). Recording money that already went (Mark
--    paid by bank) is never refused.
-- ---------------------------------------------------------------------------
create or replace function public.guard_paused_take()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.factory_paused(new.org_id) then
    raise exception 'Withdrawals are paused while a payment is reviewed.'
      using errcode = '22023', hint = 'payment_under_review';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_paused_take() from public, anon, authenticated;
drop trigger if exists payment_takes_paused on public.payment_takes;
create trigger payment_takes_paused before insert on public.payment_takes
  for each row execute function public.guard_paused_take();

create or replace function public.guard_paused_provider_attempt()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare factory uuid;
begin
  select o.factory_org_id into factory
    from public.provider_payouts x
    join public.order_payments p on p.id = x.payment_id
    join public.production_orders o on o.id = p.order_id
   where x.id = new.payout_id;
  if factory is not null and public.factory_paused(factory) then
    raise exception 'Withdrawals are paused while a payment is reviewed.'
      using errcode = '22023', hint = 'payment_under_review';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_paused_provider_attempt() from public, anon, authenticated;
drop trigger if exists provider_payout_attempts_paused on public.provider_payout_attempts;
create trigger provider_payout_attempts_paused before insert on public.provider_payout_attempts
  for each row execute function public.guard_paused_provider_attempt();

-- A Stripe withdrawal (its own Stripe money, or owed steps) is claimed first:
-- refused while paused, as the server already says before it gets here.
create or replace function public.guard_paused_stripe_withdrawal()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.factory_paused(new.org_id) then
    raise exception 'Withdrawals are paused while a payment is reviewed.'
      using errcode = '22023', hint = 'payment_under_review';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_paused_stripe_withdrawal() from public, anon, authenticated;
drop trigger if exists stripe_withdrawals_paused on public.stripe_withdrawals;
create trigger stripe_withdrawals_paused before insert on public.stripe_withdrawals
  for each row execute function public.guard_paused_stripe_withdrawal();

-- ---------------------------------------------------------------------------
-- 7. A paused brand can't post a request (a draft can still be written).
-- ---------------------------------------------------------------------------
create or replace function public.guard_paused_brand_rfq()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'open' and (tg_op = 'INSERT' or old.status is distinct from 'open')
     and auth.uid() is not null then
    perform public.refuse_paused_brand(new.brand_org_id, 'post requests');
  end if;
  return new;
end;
$$;
revoke all on function public.guard_paused_brand_rfq() from public, anon, authenticated;
drop trigger if exists rfqs_paused_brand on public.rfqs;
create trigger rfqs_paused_brand before insert or update of status on public.rfqs
  for each row execute function public.guard_paused_brand_rfq();

-- ---------------------------------------------------------------------------
-- 8. Recreated from their latest bodies (named in each), with the review.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_payment_refund_amount(target_payment uuid, payment_intent text, refunded_cents bigint)
 RETURNS order_payments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    if not exists (select 1 from public.payment_events where payment_id = p.id and stripe_ref = record_payment_refund_amount.payment_intent) then
      insert into public.payment_events (payment_id, stripe_ref, from_state, to_state, actor_kind, note)
      values (p.id, record_payment_refund_amount.payment_intent, p.state, p.state, 'system', 'A payment that was not this step''s own was refunded.' || ref);
    end if;
    return p;
  end if;

  -- Not funded here yet (processing, due): nothing is recorded. Once the
  -- payment is recorded as funded, the server records the refund at its
  -- amount and everyone is told (20261121230000). A full refund before
  -- that is the server's record_payment_refunded.
  if p.state not in ('confirmed', 'released') then
    return p;
  end if;
  charged := coalesce(p.charged_cents, p.amount_received_cents, p.amount_cents);
  if charged is null or charged <= 0 then
    return p;
  end if;
  total := least(refunded_cents, charged);

  -- Refunded in full before approval: as before, back to Due and the brand
  -- pays again (cancelled on a cancelled order). Part lost in a dispute and
  -- the rest refunded is all of it too (20261121240000).
  if total + p.dispute_lost_cents >= charged and p.state <> 'released'
     and not (p.state = 'confirmed' and p.release_requested_at is not null) then
    -- A refund made in Stripe (20261121340000: the code, not the words).
    return public.record_payment_refunded(p.id, payment_intent, 'The payment was refunded.', 'stripe_refund');
  end if;

  -- Never lower: a smaller total is an older copy of the charge (Stripe's
  -- events arrive in any order). Only a refund Stripe says failed lowers it
  -- (record_payment_refund_failed, 20261121230000).
  if total <= p.refunded_cents then
    return p;
  end if;
  was_total := p.refunded_cents;
  was_share := p.factory_refund_cents;
  was_debt := coalesce(public.payment_debt_cents(p), 0);

  update public.order_payments
     set refunded_cents = total, refund_amount_at = now(),
         -- After approval the factory's part is kept: staff decide in a
         -- payment review (20261124100000), nothing is taken by itself.
         review_kept_cents = review_kept_cents
           + case when p.state = 'released' or p.release_requested_at is not null then total - was_total else 0 end
   where id = p.id
  returning * into p;
  now_debt := coalesce(public.payment_debt_cents(p), 0);

  insert into public.payment_events (payment_id, stripe_ref, from_state, to_state, actor_kind, note)
  values (p.id, record_payment_refund_amount.payment_intent, p.state, p.state, 'system',
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

  -- Money already in the factory's balance: a payment review pauses its
  -- withdrawals until staff decide (20261124100000). The brand is not paused.
  if p.state = 'released' or p.release_requested_at is not null then
    perform public.open_payment_review(p, o, 'refund', total - was_total, record_payment_refund_amount.payment_intent, null, null, null);
  end if;

  -- What the brand got back (fee part included), then the factory's part (20261121240000).
  perform public.tell_earnings_down(p, o, format('Payment for "%s" refunded', coalesce(m.title, o.order_number)),
                                    format('The brand was refunded %s.', public.format_money(total - was_total, p.currency)), was_share, was_debt);
  return p;
end;
$function$;


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
  insert into public.payment_events (payment_id, stripe_ref, from_state, to_state, actor_kind, note)
  values (p.id, record_payment_refund_failed.payment_intent, p.state, p.state, 'system',
          format('A refund failed in Stripe: %s refunded in all.', public.format_money(total, p.currency)) || ref);
  -- Each side was told of the refund: told it did not go through (20261121240000).
  select * into m from public.order_milestones where id = p.milestone_id;
  insert into public.notifications (org_id, kind, subject_type, subject_id, order_id, title, body)
  values (o.brand_org_id, 'payment_refunded', 'payment', p.id, o.id,
          format('Refund for "%s" didn''t go through', coalesce(m.title, o.order_number)),
          format('Your %s refund didn''t go through. That amount stays on this order.', public.format_money(was_total - total, p.currency)));
  if p.factory_refund_cents < was_share then
    insert into public.notifications (org_id, kind, subject_type, subject_id, order_id, title, body)
    values (o.factory_org_id, 'payment_refunded', 'payment', p.id, o.id,
            format('Refund for "%s" didn''t go through', coalesce(m.title, o.order_number)),
            format('The refund to the brand didn''t go through. Your earnings from %s went back up by %s.', o.order_number,
                   public.format_money(was_share - p.factory_refund_cents, p.currency)));
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
            || case when next_state = 'failed' then format(' Pay again from the step''s payment page on %s.', o.order_number) else '' end);
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
  perform public.refuse_paused_brand(o.brand_org_id, 'approve steps');
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
             public.format_money(public.payment_factory_cents(p), p.currency),
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


create or replace function public.begin_payment_checkout(target_payment uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p public.order_payments;
  o public.production_orders;
  m public.order_milestones;
  fee bigint;
  charged bigint;
begin
  select * into p from public.order_payments where id = target_payment;
  if not found then
    raise exception 'payment not found' using errcode = 'P0002';
  end if;

  select * into o from public.production_orders where id = p.order_id;

  perform public.require_org_permission(o.brand_org_id, 'releaseFunds');
  if not public.is_org_member(o.brand_org_id) then
    raise exception 'only the brand on this order pays for its steps' using errcode = '42501';
  end if;

  perform public.refuse_paused_brand(o.brand_org_id, 'fund steps');

  if o.status <> 'active' then
    raise exception 'this order is %', o.status using errcode = '22023';
  end if;

  if p.state not in ('due', 'failed') then
    raise exception 'that payment is %, so there is nothing to pay', p.state
      using errcode = '22023';
  end if;

  select * into m from public.order_milestones where id = p.milestone_id;
  fee := public.payment_fee_cents(p.id);
  charged := public.payment_charge_cents(p.id);

  if charged > 99999999 then
    raise exception 'This payment is %, more than a card can be charged at once (%). Split this step into smaller steps, or contact TSC.',
      public.format_money(charged, p.currency), public.format_money(99999999, p.currency)
      using errcode = '22003';
  end if;

  return jsonb_build_object(
    'payment_id', p.id,
    'order_id', o.id,
    'order_number', o.order_number,
    'brand_org_id', o.brand_org_id,
    'factory_org_id', o.factory_org_id,
    'milestone_title', m.title,
    'amount_cents', p.amount_cents,
    'fee_bps', p.fee_bps,
    'fee_cents', fee,
    'processing_fee_cents', charged - p.amount_cents - fee,
    'charged_cents', charged,
    'currency', p.currency,
    'state', p.state,
    'stripe_payment_intent_id', p.stripe_payment_intent_id
  );
end;
$$;


create or replace function public.award_quote(quote_id uuid)
returns public.quotes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  q            public.quotes;
  r            public.rfqs;
  o            public.production_orders;
  factory_name text;
  rfq_title    text;
begin
  select * into q from public.quotes where id = quote_id for update;
  if not found then
    raise exception 'quote not found' using errcode = 'P0002';
  end if;

  -- Locking the RFQ as well as the quote is load-bearing, not defensive. Two
  -- brand members awarding two different quotes on the same RFQ milliseconds
  -- apart would otherwise both pass the "is it open" check below and the RFQ
  -- would end with two accepted quotes.
  select * into r from public.rfqs where id = q.rfq_id for update;

  perform public.require_org_permission(r.brand_org_id, 'rfqFlow');
  if not public.is_org_member(r.brand_org_id) then
    raise exception 'only the requesting brand may award a quote'
      using errcode = '42501';
  end if;

  perform public.refuse_paused_brand(r.brand_org_id, 'accept quotes');

  if r.status <> 'open' then
    raise exception 'this request is %, so it cannot be awarded', r.status
      using errcode = '22023';
  end if;

  -- Covers draft, withdrawn, already decided, and — the one that matters —
  -- superseded. A brand reads a quote, the factory revises it, the brand
  -- awards the row it was looking at. That must be refused, not accepted.
  if q.status <> 'submitted' then
    raise exception 'this quote is % and cannot be awarded; the factory may have revised it', q.status
      using errcode = '22023';
  end if;

  if q.valid_until is not null and q.valid_until < current_date then
    raise exception 'this quote expired on %', q.valid_until
      using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.factory_profiles f
    where f.org_id = q.factory_org_id and f.verification_status = 'verified'
  ) then
    raise exception 'this factory is no longer verified'
      using errcode = '22023';
  end if;

  select name into factory_name from public.orgs where id = q.factory_org_id;
  rfq_title := coalesce(nullif(btrim(r.title), ''), 'your request');

  update public.quotes
     set status = 'accepted', decided_at = now()
   where id = quote_id
  returning * into q;

  -- Only other LIVE submissions are declined. Superseded, draft and withdrawn
  -- rows are already out of the running and keep their own history.
  update public.quotes
     set status = 'declined', decided_at = now()
   where rfq_id = r.id
     and id <> quote_id
     and status = 'submitted';

  update public.rfqs
     set status = 'awarded',
         awarded_quote_id = quote_id,
         awarded_at = now()
   where id = r.id;

  -- The order and its draft schedule, in this same transaction. A window in
  -- which a quote is accepted but its order does not exist would be a state
  -- with no screen and no way out.
  o := public.create_order_from_award(quote_id);

  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  select
    d.factory_org_id,
    case when d.factory_org_id = q.factory_org_id then 'quote_accepted' else 'quote_declined' end,
    case when d.factory_org_id = q.factory_org_id then 'order' else 'rfq' end,
    case when d.factory_org_id = q.factory_org_id then o.id else r.id end,
    case when d.factory_org_id = q.factory_org_id then o.id else null end,
    case
      when d.factory_org_id = q.factory_org_id then
        coalesce('Your quote for "' || nullif(btrim(r.title), '') || '" was accepted',
                 'Your quote was accepted')
      else 'Your quote was not selected'
    end,
    case
      when d.factory_org_id = q.factory_org_id
        then format('%s accepted your quote for "%s". The brand is setting the production steps; you will be told when they start.',
                    (select name from public.orgs where id = r.brand_org_id), rfq_title)
      else format('"%s" was awarded to another factory. Thank you for quoting.', rfq_title)
    end
  from (
    select distinct factory_org_id
    from public.quotes
    where rfq_id = r.id and status in ('accepted', 'declined')
  ) d;

  -- The brand has something to do now too, and nothing else would tell it.
  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  values (
    r.brand_org_id, 'order_created', 'order', o.id, o.id,
    format('Production order %s is ready', o.order_number),
    format('%s accepted. Review the production steps drafted from their quote, then confirm them to start.',
           factory_name)
  );

  return q;
end;
$$;


create or replace function public.propose_cancellation(target_order uuid, reason text)
returns public.production_orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  o        public.production_orders;
  is_brand boolean;
  mine     uuid;
begin
  select * into o from public.production_orders where id = target_order for update;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;

  is_brand := public.is_org_member(o.brand_org_id);
  if not (is_brand or public.is_org_member(o.factory_org_id)) then
    raise exception 'only a party to this order may propose cancelling it' using errcode = '42501';
  end if;

  if is_brand then
    perform public.refuse_paused_brand(o.brand_org_id, 'cancel orders');
  end if;

  if o.status not in ('pending_schedule', 'active') then
    raise exception 'this order is % already', o.status using errcode = '22023';
  end if;

  if length(btrim(coalesce(reason, ''))) = 0 then
    raise exception 'say why; the other side sees this' using errcode = '22023';
  end if;

  mine := case when is_brand then o.brand_org_id else o.factory_org_id end;

  update public.production_orders
     set cancel_proposed_by_org = mine,
         cancel_proposed_at = now(),
         cancel_reason = btrim(reason)
   where id = o.id
  returning * into o;

  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  values (
    case when is_brand then o.factory_org_id else o.brand_org_id end,
    'cancellation_proposed', 'order', o.id, o.id,
    format('%s has been proposed for cancellation', o.order_number),
    btrim(reason)
  );

  return o;
end;
$$;


create or replace function public.accept_cancellation(target_order uuid)
returns public.production_orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  o    public.production_orders;
  mine uuid;
begin
  select * into o from public.production_orders where id = target_order for update;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;

  if o.cancel_proposed_by_org is null then
    raise exception 'nobody has proposed cancelling this order' using errcode = '22023';
  end if;

  mine := case
    when public.is_org_member(o.brand_org_id) then o.brand_org_id
    when public.is_org_member(o.factory_org_id) then o.factory_org_id
  end;

  if mine is null then
    raise exception 'only a party to this order may accept a cancellation' using errcode = '42501';
  end if;
  if mine = o.brand_org_id then
    perform public.refuse_paused_brand(o.brand_org_id, 'cancel orders');
  end if;
  if mine = o.cancel_proposed_by_org then
    raise exception 'the other side has to accept, not the side that proposed it'
      using errcode = '42501';
  end if;

  perform public.close_order(o.id, o.cancel_reason);
  select * into o from public.production_orders where id = target_order;
  return o;
end;
$$;


create or replace function public.withdrawal_blocker(w public.factory_withdrawals)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    -- A payment under review pauses all of the factory's withdrawals (20261124100000).
    when public.factory_paused(w.org_id) then 'payment_under_review'
    -- Money refunded after the factory withdrew it, more than its other
    -- earnings cover: TSC recovers it before paying anything more (20261121210000).
    when public.factory_debt_uncovered_cents(w.org_id) > 0 then 'withdrawal_owes_tsc'
    -- A step under it no longer confirmed, disputed, or refunded in part since it was asked.
    when exists (select 1 from public.payment_takes k
                   join public.order_payments p on p.id = k.payment_id
                  where k.factory_withdrawal_id = w.id and k.status = 'held'
                    and (p.state <> 'confirmed' or p.disputed_at is not null
                         or public.take_refunded_cents(k) > 0)) then 'withdrawal_over_balance'
  end;
$$;


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

  -- What a provider kept of a withdrawal it returned (paid or still being
  -- sent) counts like a fee: the factory bears it (20261121385000).
  select coalesce(sum(w.fee_cents) filter (where w.status = 'paid'), 0)
         + coalesce(sum(w.kept_cents) filter (where w.status = 'failed'), 0)
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
      -- Returned to the brand by staff after a payment review (20261124100000).
      if (r.p).taken_back_cents > 0 then
        out_rows := out_rows || jsonb_build_array(jsonb_build_object('payment_id', (r.p).id, 'figure', 'refunded',
          'amount_cents', -least((r.p).taken_back_cents, r.base_cents - r.factory_cents), 'stripe', false, 'cause', 'returned',
          'at', (select max(v.decided_at) from public.payment_reviews v
                  where v.factory_org_id = target_org and v.decision = 'refund_brand')));
      end if;
      refund_part := least(r.base_cents, coalesce(round(((r.p).refunded_cents)::numeric * (r.p).amount_cents
                       / nullif(coalesce((r.p).charged_cents, (r.p).amount_received_cents, (r.p).amount_cents), 0))::bigint, 0));
      refund_part := least(refund_part, r.base_cents - r.factory_cents - least((r.p).taken_back_cents, r.base_cents - r.factory_cents));
      refunded_total := refunded_total + (r.base_cents - r.factory_cents);
      if refund_part > 0 then
        out_rows := out_rows || jsonb_build_array(jsonb_build_object('payment_id', (r.p).id, 'figure', 'refunded',
          'amount_cents', -refund_part, 'stripe', false, 'cause', 'refund', 'at', (r.p).refund_amount_at));
      end if;
      if r.base_cents - r.factory_cents - refund_part - least((r.p).taken_back_cents, r.base_cents - r.factory_cents) > 0 then
        out_rows := out_rows || jsonb_build_array(jsonb_build_object('payment_id', (r.p).id, 'figure', 'refunded',
          'amount_cents', -(r.base_cents - r.factory_cents - refund_part - least((r.p).taken_back_cents, r.base_cents - r.factory_cents)), 'stripe', false, 'cause', 'dispute_lost',
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
        -- Returned or failed: what the provider kept (20261121385000).
        'kept_cents', case when fw.status = 'failed' then fw.kept_cents end,
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
    -- Withdrawals paused while a payment is reviewed (20261124100000): the
    -- card's line names the step of the oldest open review.
    'review', public.factory_review_summary(target_org),
    'rows', out_rows,
    'withdrawals', out_withdrawals
  );
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
     + jsonb_array_length(attention -> 'stuck')
     -- Payment reviews waiting on staff (20261124100000), in place of the
     -- disputed steps and the debts to recover they replaced.
     + (select count(*)::integer from public.payment_reviews v
         where v.decided_at is null or (v.cause = 'dispute' and v.brand_unpaused_at is null))
     + jsonb_array_length(attention -> 'returned')
     + jsonb_array_length(attention -> 'refund_failed'),
    (select count(*)::integer from public.admin_verification_queue() q
      where q.submitted_at >= date_trunc('day', now()));
end;
$function$;

-- From 20261121400000_one_rule_per_check.sql: the pause is a refusal too, so
-- staff cannot start paying a waiting withdrawal while the factory is paused.
create or replace function public.check_withdrawal_can_go(w public.factory_withdrawals)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  why text := public.withdrawal_blocker(w);
begin
  if why = 'withdrawal_owes_tsc' then
    -- The amount travels in detail, for staff's sentence.
    -- What its earnings do not cover: the To recover row's amount (20261121380000).
    raise exception 'the factory owes TSC %', public.format_money(public.factory_debt_uncovered_cents(w.org_id), 'USD')
      using errcode = '22023', hint = 'withdrawal_owes_tsc', detail = public.format_money(public.factory_debt_uncovered_cents(w.org_id), 'USD');
  elsif why = 'payment_under_review' then
    -- A payment review pauses every withdrawal, a waiting one included (20261124100000).
    raise exception 'Withdrawals are paused while a payment is reviewed.' using errcode = '22023', hint = 'payment_under_review';
  elsif why = 'withdrawal_over_balance' then
    raise exception 'the factory''s balance no longer covers this' using errcode = '22023', hint = 'withdrawal_over_balance';
  end if;
end;
$$;
revoke all on function public.check_withdrawal_can_go(public.factory_withdrawals) from public, anon, authenticated;
grant execute on function public.check_withdrawal_can_go(public.factory_withdrawals) to service_role;
