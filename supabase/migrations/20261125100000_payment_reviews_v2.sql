-- Paused payments v2 (20261124100000 follow-up).
--
--  1. A review has a state: inquiry, open, decide, resumed, approved,
--     declined, inquiry_closed. The bank's verdict drives a dispute: won
--     resumes the factory by itself; lost waits for staff. An inquiry pauses
--     nobody. One review per Stripe dispute id.
--  2. Staff decide who pays once the money is back with the brand: the
--     factory (an amount from its balance, up to its part and what is still
--     with TSC; the brand can use its account again) or TSC (nothing taken;
--     the brand stays paused). A loss on a step not approved has nothing to
--     decide. Staff unpause a brand from its account (unpause_brand_org),
--     which lifts every pause of that brand.
--  3. Staff refund a brand in the app (staff_refunds): claimed in the
--     database with who pays (the factory's balance, taken in the same
--     transaction, or TSC), made in Stripe by the server, recorded without
--     opening a review, and given back exactly if Stripe refuses or fails it.
--  4. A paused brand may accept the factory's cancellation, and gets no
--     reminders for steps waiting on it.
--  5. A hand payout whose payout number staff revealed is on its way: no cap
--     takes from it, and staff may still mark it paid if the number was
--     revealed before the factory was paused.

-- ---------------------------------------------------------------------------
-- 1. Review states.
-- ---------------------------------------------------------------------------
alter table public.payment_reviews add column if not exists state text;
alter table public.payment_reviews add column if not exists closed_at timestamptz;
alter table public.payment_reviews add column if not exists paused_at timestamptz;
-- Stripe's reason for a dispute (its code), for staff deciding fault (T2 A6).
alter table public.payment_reviews add column if not exists dispute_reason text;
-- What staff refunded the brand outside Stripe, closing a failed refund (T2 R3).
alter table public.order_payments add column if not exists manual_refunded_cents bigint not null default 0;
alter table public.order_payments drop constraint if exists order_payments_manual_refunded_cents_check;
alter table public.order_payments add constraint order_payments_manual_refunded_cents_check check (manual_refunded_cents >= 0);

alter table public.payment_reviews drop constraint if exists payment_reviews_decision_check;
alter table public.payment_reviews drop constraint if exists payment_reviews_check1;

-- Rows written by 20261124100000/100100 (qa only; production has none).
update public.payment_reviews set decision = case when cause = 'dispute' then 'brand_at_fault' else 'no_fault' end
 where decision = 'pay_factory';
update public.payment_reviews set decision = 'factory_at_fault' where decision = 'refund_brand';
update public.payment_reviews
   set decision = null, decided_at = null, decided_by = null
 where decision = 'brand_unpaused'
   and coalesce(dispute_status, '') not in ('won', 'prevented', 'lost', 'warning_closed');
update public.payment_reviews v
   set state = case
         when v.decision in ('factory_at_fault', 'brand_at_fault', 'no_fault') then v.decision
         when v.decision = 'brand_unpaused' then 'closed'
         when v.cause = 'dispute' and v.dispute_status in ('warning_needs_response', 'warning_under_review') then 'inquiry'
         when v.cause = 'dispute' and v.dispute_status = 'warning_closed' then 'inquiry_closed'
         when v.cause = 'dispute' and v.dispute_status in ('won', 'prevented') then 'resumed'
         when v.cause = 'dispute' and v.dispute_status = 'lost' and not v.pauses_factory then 'closed'
         when v.cause = 'dispute' and v.dispute_status = 'lost' then 'decide'
         when v.cause = 'dispute' then 'open'
         else 'decide' end,
       closed_at = case when v.decided_at is not null then v.decided_at
                        when v.dispute_status in ('won', 'prevented', 'warning_closed')
                          or (v.dispute_status = 'lost' and not v.pauses_factory) then v.updated_at end,
       paused_at = case when v.pauses_factory then v.created_at end
 where v.state is null;
-- An inquiry pauses nobody: a brand paused only by one under 100000's rules is not any more.
update public.payment_reviews set brand_unpaused_at = coalesce(brand_unpaused_at, now())
 where state in ('inquiry', 'inquiry_closed');

alter table public.payment_reviews alter column state set default 'open';
alter table public.payment_reviews alter column state set not null;
alter table public.payment_reviews drop constraint if exists payment_reviews_state_check;
alter table public.payment_reviews add constraint payment_reviews_state_check
  check (state in ('inquiry', 'inquiry_closed', 'open', 'decide', 'resumed', 'closed', 'factory_at_fault', 'brand_at_fault', 'no_fault',
                   'refund_failed'));
alter table public.payment_reviews add constraint payment_reviews_decision_check
  check (decision in ('factory_at_fault', 'brand_at_fault', 'no_fault', 'brand_unpaused'));
alter table public.payment_reviews drop constraint if exists payment_reviews_returned_check;
alter table public.payment_reviews add constraint payment_reviews_returned_check
  check (decision = 'factory_at_fault' or returned_cents = 0);
comment on column public.payment_reviews.state is
  'inquiry | inquiry_closed | open | decide | resumed | closed | factory_at_fault | brand_at_fault | no_fault (20261125100000).';

-- One review per Stripe dispute; one open refund review per payment.
drop index if exists public.payment_reviews_one_open;
create unique index if not exists payment_reviews_one_per_dispute
  on public.payment_reviews (payment_id, stripe_ref) where cause = 'dispute';
create unique index if not exists payment_reviews_one_open_refund
  on public.payment_reviews (payment_id) where cause = 'refund' and state = 'decide';
drop index if exists public.payment_reviews_factory_open;
create index if not exists payment_reviews_factory_open on public.payment_reviews (factory_org_id) where state in ('open', 'decide');
drop index if exists public.payment_reviews_brand_open;
create index if not exists payment_reviews_brand_open on public.payment_reviews (brand_org_id) where brand_unpaused_at is null and cause = 'dispute';

-- What a reveal of a factory's payout number was for: the step or the
-- withdrawal staff were paying (20261125100000). Only that payout counts as
-- being sent by hand.
alter table public.payout_number_reveals add column if not exists payment_id uuid;
alter table public.payout_number_reveals add column if not exists factory_withdrawal_id uuid;
create index if not exists payout_number_reveals_payment_idx on public.payout_number_reveals (payment_id) where payment_id is not null;
create index if not exists payout_number_reveals_withdrawal_idx on public.payout_number_reveals (factory_withdrawal_id) where factory_withdrawal_id is not null;

-- ---------------------------------------------------------------------------
-- 2. Who is paused, and what waits on staff.
-- ---------------------------------------------------------------------------
create or replace function public.factory_paused(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.payment_reviews v
                  where v.factory_org_id = target_org and v.state in ('open', 'decide') and v.pauses_factory);
$$;
revoke all on function public.factory_paused(uuid) from public, anon, authenticated;
grant execute on function public.factory_paused(uuid) to service_role;

-- A chargeback pauses the brand until staff decide the factory pays, or
-- unpause the brand from its account; an inquiry never does.
create or replace function public.brand_paused(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.payment_reviews v
                  where v.brand_org_id = target_org and v.cause = 'dispute'
                    and v.state not in ('inquiry', 'inquiry_closed') and v.brand_unpaused_at is null);
$$;
revoke all on function public.brand_paused(uuid) from public, anon, authenticated;
grant execute on function public.brand_paused(uuid) to service_role;

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
           -- T2 Y1: the first review's cause, so the card line says it: 'dispute' | 'refund'.
           'cause', (array_agg(v.cause order by v.created_at))[1],
           'since', min(v.created_at),
           'count', count(*)) end
    from public.payment_reviews v
    join public.production_orders o on o.id = v.order_id
    join public.order_payments p on p.id = v.payment_id
    left join public.order_milestones m on m.id = p.milestone_id
   where v.factory_org_id = target_org and v.state in ('open', 'decide') and v.pauses_factory;
$$;
revoke all on function public.factory_review_summary(uuid) from public, anon, authenticated;
grant execute on function public.factory_review_summary(uuid) to service_role;

-- The board's progress bar: 1 the bank deciding (or the refund made), 2 staff
-- decide who pays, 3 done.
create or replace function public.payment_review_step(v public.payment_reviews)
returns int
language sql
stable
set search_path = public, pg_temp
as $$
  select case when v.state in ('inquiry', 'open') then 1 when v.state = 'decide' then 2 else 3 end;
$$;
revoke all on function public.payment_review_step(public.payment_reviews) from public, anon, authenticated;
grant execute on function public.payment_review_step(public.payment_reviews) to service_role;

-- Counted on the overview and in "Payment reviews (N)": a dispute staff must
-- answer in Stripe (it has a respond-by date), or a decision.
create or replace function public.payment_review_needs_staff(v public.payment_reviews)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select v.state = 'decide' or (v.state in ('inquiry', 'open') and v.dispute_due_by is not null);
$$;
revoke all on function public.payment_review_needs_staff(public.payment_reviews) from public, anon, authenticated;
grant execute on function public.payment_review_needs_staff(public.payment_reviews) to service_role;

-- Stripe's dispute status → the review's state ('decide' on a loss; a loss
-- on a step not approved is 'closed' by the caller: nothing to decide).
create or replace function public.payment_review_state_for(status text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when status in ('warning_needs_response', 'warning_under_review') then 'inquiry'
    when status = 'warning_closed' then 'inquiry_closed'
    when status in ('won', 'prevented') then 'resumed'
    when status = 'lost' then 'decide'
    else 'open' end;
$$;
revoke all on function public.payment_review_state_for(text) from public, anon, authenticated;
grant execute on function public.payment_review_state_for(text) to service_role;

-- Brands paused now, for staff's Users page (admin_paused_brands) and the
-- server's user directory (paused_brand_ids).
create or replace function public.paused_brand_rows()
returns table (org_id uuid, name text, since timestamptz, reviews bigint, reason text, order_number text, owner_email text, more bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select g.brand_org_id, b.name, g.since, g.reviews,
         case latest.state when 'open' then 'Bank ruling pending'
                           when 'brand_at_fault' then 'Brand at fault'
                           when 'resumed' then 'Bank ruled for TSC'
                           else 'Bank ruled for the brand' end,
         latest.order_number,
         (select u.email::text from public.org_members om join auth.users u on u.id = om.user_id
           where om.org_id = g.brand_org_id and om.role = 'owner' order by om.created_at limit 1),
         g.reviews - 1
    from (select v.brand_org_id, min(v.created_at) as since, count(*) as reviews
            from public.payment_reviews v
           where v.cause = 'dispute' and v.state not in ('inquiry', 'inquiry_closed') and v.brand_unpaused_at is null
           group by v.brand_org_id) g
    join public.orgs b on b.id = g.brand_org_id
    cross join lateral (
      select v.state, o.order_number from public.payment_reviews v join public.production_orders o on o.id = v.order_id
       where v.brand_org_id = g.brand_org_id and v.cause = 'dispute'
         and v.state not in ('inquiry', 'inquiry_closed') and v.brand_unpaused_at is null
       -- The most pressing first (T1 #7): the bank still deciding, then ruled
       -- for the brand (waiting, at fault, step not approved), then for TSC.
       order by case v.state when 'open' then 1 when 'decide' then 2 when 'brand_at_fault' then 3 when 'closed' then 4 else 5 end,
                v.created_at desc limit 1) latest;
$$;
revoke all on function public.paused_brand_rows() from public, anon, authenticated;
grant execute on function public.paused_brand_rows() to service_role;

-- ---------------------------------------------------------------------------
-- 3. On its way: a hand payout whose number staff revealed. What staff may
--    still return from a factory never includes it.
-- ---------------------------------------------------------------------------
create or replace function public.hand_payout_revealed(p public.order_payments, factory uuid, before timestamptz default null)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.state = 'confirmed' and p.release_requested_at is not null
     and not p.withdrawal_pool and not p.stripe_release_started and p.release_claimed_at is null
     and not public.uses_stripe_payout(factory)
     and exists (select 1 from public.payout_number_reveals r
                  where r.payment_id = p.id and r.org_id = factory and r.revealed_at >= p.release_requested_at
                    and (before is null or r.revealed_at < before));
$$;
revoke all on function public.hand_payout_revealed(public.order_payments, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.hand_payout_revealed(public.order_payments, uuid, timestamptz) to service_role;

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
     -- A disputed step is on hold until the bank decides: never taken from.
     and p.disputed_at is null
     -- A per-step payout under way or failed is staff's to settle (paid again,
     -- or by hand): never taken from.
     and coalesce((select x.status from public.provider_payouts x where x.payment_id = p.id
                    order by x.created_at desc limit 1), '') not in ('processing', 'failed')
     -- A hand payout staff are sending (its number revealed): on its way (20261125100000).
     and not public.hand_payout_revealed(p, target_org)
   order by (p.id = first_payment) desc, p.release_requested_at desc, p.id;
$$;
revoke all on function public.review_returnable_parts(uuid, uuid) from public, anon, authenticated;
grant execute on function public.review_returnable_parts(uuid, uuid) to service_role;

-- Staff may still record a hand payout whose number was revealed before the
-- factory was paused: the wire may already have gone. Nothing else.
create or replace function public.factory_paused_since(target_org uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select min(coalesce(v.paused_at, v.created_at)) from public.payment_reviews v
   where v.factory_org_id = target_org and v.state in ('open', 'decide') and v.pauses_factory;
$$;
revoke all on function public.factory_paused_since(uuid) from public, anon, authenticated;
grant execute on function public.factory_paused_since(uuid) to service_role;

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
    if factory is not null and public.factory_paused(factory)
       -- Marking paid a wire staff were already sending (20261125100000).
       and not (new.state = 'released' and new.release_claimed_at is not distinct from old.release_claimed_at
                and public.hand_payout_revealed(old, factory, public.factory_paused_since(factory))) then
      raise exception 'This factory''s withdrawals are paused while a payment is reviewed.'
        using errcode = '22023', hint = 'payment_under_review';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_paused_payout() from public, anon, authenticated;

create or replace function public.guard_paused_bank_withdrawal()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'paid' and old.status is distinct from 'paid' and auth.uid() is not null
     and public.factory_paused(new.org_id)
     -- Its number revealed for this withdrawal before the pause: the wire may
     -- already have gone, so marking it paid records a fact (20261125100000).
     and not exists (select 1 from public.payout_number_reveals r
                      where r.factory_withdrawal_id = old.id and r.org_id = new.org_id and r.revealed_at >= old.created_at
                        and r.revealed_at < public.factory_paused_since(new.org_id)) then
    raise exception 'This factory''s withdrawals are paused while a payment is reviewed.'
      using errcode = '22023', hint = 'payment_under_review';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_paused_bank_withdrawal() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Opening a review, and what each side is told.
-- ---------------------------------------------------------------------------
create or replace function public.tell_brand_paused(v public.payment_reviews, step text, order_number text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.notifications (org_id, kind, subject_type, subject_id, order_id, title, body, data, dedupe_key)
  values (v.brand_org_id, 'payment_disputed', 'payment', v.payment_id, v.order_id,
          'Account under review',
          -- T2 B6: "You can still message vendors.", as the order page says it.
          format('A payment for "%s" on %s was disputed with your bank. Until our review is done, you can''t fund or approve steps or accept quotes. You can still message vendors.',
                 step, order_number),
          jsonb_build_object('review_id', v.id),
          'payment_review_brand:' || v.id)
  on conflict (org_id, dedupe_key) do nothing;
end;
$$;
revoke all on function public.tell_brand_paused(public.payment_reviews, text, text) from public, anon, authenticated;

-- The factory's "Withdrawals resumed" (or "Payment review complete" while
-- another review still pauses it), once per review.
create or replace function public.tell_factory_resumed(v public.payment_reviews, step text, note text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  still_paused boolean := public.factory_paused(v.factory_org_id);
  num text := (select order_number from public.production_orders where id = v.order_id);
begin
  -- T2 A3: names the order. Nothing left its balance, and that is not said
  -- (src/app/order/AGENTS.md; John and Queena, Nov 23).
  insert into public.notifications (org_id, kind, subject_type, subject_id, order_id, title, body, data, dedupe_key)
  values (v.factory_org_id, 'payment_disputed', 'payment', v.payment_id, v.order_id,
          case when still_paused then 'Payment review complete' else 'Withdrawals resumed' end,
          format('The review of the payment for "%s" on %s is done.', step, num)
          || case when still_paused then ' Withdrawals stay paused while another payment is reviewed.'
                  else ' You can withdraw your balance again.' end
          || case when nullif(btrim(coalesce(note, '')), '') is not null then ' Note from our team: ' || btrim(note) else '' end,
          jsonb_build_object('review_id', v.id, 'returned_cents', 0),
          'payment_review_done:' || v.id)
  on conflict (org_id, dedupe_key) do nothing;
end;
$$;
revoke all on function public.tell_factory_resumed(public.payment_reviews, text, text) from public, anon, authenticated;

-- The factory's "Withdrawals paused", once per review, in the true cause's
-- words (T2 Y1): a card dispute, or a refund made outside the app.
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
          case when v.cause = 'dispute'
               then format('A brand disputed a card payment for "%s" on %s, so our team is reviewing it. Withdrawals are paused until the review is done.',
                           step, order_number)
               else format('A brand requested a refund for "%s" on %s, so our team is reviewing the payment. Withdrawals are paused until the review is done.',
                           step, order_number) end,
          jsonb_build_object('review_id', v.id),
          'payment_review:' || v.id)
  on conflict (org_id, dedupe_key) do nothing;
end;
$$;
revoke all on function public.tell_factory_paused(public.payment_reviews, text, text) from public, anon, authenticated;

-- A chargeback on a step not approved (the money isn't in the factory's
-- balance, so it isn't paused): "Payment for "X" disputed", once per review
-- (T2 R2, C1). Also what record_payment_funded sends when the charge was
-- disputed before it was recorded.
create or replace function public.tell_factory_disputed(v public.payment_reviews)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  step text;
  num text;
begin
  if v is null or v.cause <> 'dispute' or v.state not in ('open', 'decide', 'closed') then
    return;
  end if;
  select coalesce(m.title, o.order_number), o.order_number into step, num
    from public.production_orders o
    join public.order_payments p on p.id = v.payment_id
    left join public.order_milestones m on m.id = p.milestone_id
   where o.id = v.order_id;
  insert into public.notifications (org_id, kind, subject_type, subject_id, order_id, title, body, data, dedupe_key)
  values (v.factory_org_id, 'payment_disputed', 'payment', v.payment_id, v.order_id,
          format('Payment for "%s" disputed', step),
          format('A brand disputed a card payment for "%s" on %s, so our team is reviewing it.', step, num),
          jsonb_build_object('review_id', v.id),
          'payment_review_funded:' || v.id)
  on conflict (org_id, dedupe_key) do nothing;
end;
$$;
revoke all on function public.tell_factory_disputed(public.payment_reviews) from public, anon, authenticated;

-- "Account review complete", once the brand has no pause left.
create or replace function public.tell_brand_unpaused(v public.payment_reviews)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.brand_paused(v.brand_org_id) then
    return;
  end if;
  insert into public.notifications (org_id, kind, subject_type, subject_id, order_id, title, body, data, dedupe_key)
  values (v.brand_org_id, 'payment_disputed', 'payment', v.payment_id, v.order_id,
          'Account review complete', 'You can fund steps, approve steps and accept quotes again.',
          jsonb_build_object('review_id', v.id), 'payment_review_brand_done:' || v.id)
  on conflict (org_id, dedupe_key) do nothing;
end;
$$;
revoke all on function public.tell_brand_unpaused(public.payment_reviews) from public, anon, authenticated;

-- Everyone told when a review starts pausing: the factory (money in its
-- balance) and, on a chargeback, the brand. Inquiries tell nobody.
create or replace function public.tell_review_opened(v public.payment_reviews)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  step text;
  num text;
begin
  if v.state not in ('open', 'decide', 'closed') then
    return;
  end if;
  select coalesce(m.title, o.order_number), o.order_number into step, num
    from public.production_orders o
    join public.order_payments p on p.id = v.payment_id
    left join public.order_milestones m on m.id = p.milestone_id
   where o.id = v.order_id;
  if v.pauses_factory and v.state in ('open', 'decide') then
    perform public.tell_factory_paused(v, step, num);
  elsif v.cause = 'dispute' and not v.pauses_factory and v.state = 'open'
        and exists (select 1 from public.order_payments p where p.id = v.payment_id and p.state in ('confirmed', 'released')) then
    -- Held for a step not approved yet: told once per dispute (T2 R2). A
    -- charge disputed before it is recorded is told by record_payment_funded.
    perform public.tell_factory_disputed(v);
  end if;
  if v.cause = 'dispute' and v.brand_unpaused_at is null then
    perform public.tell_brand_paused(v, step, num);
  end if;
  -- The "funded" notices sent a moment before no longer hold (T1 #4).
  if v.cause = 'dispute' then
    perform public.withdraw_funded_notices(v.payment_id);
  end if;
end;
$$;
revoke all on function public.tell_review_opened(public.payment_reviews) from public, anon, authenticated;

create or replace function public.open_payment_review(p public.order_payments, o public.production_orders, why text,
                                                      amount bigint, ref text, status text, due_by timestamptz, fee bigint)
returns public.payment_reviews
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v public.payment_reviews;
  approved boolean := p.state = 'released' or p.release_requested_at is not null;
  first_state text := case when why = 'refund' then 'decide' else public.payment_review_state_for(status) end;
begin
  -- A loss on a step not approved: the factory never had the money, so there
  -- is nothing to decide (20261125100000).
  if first_state = 'decide' and why = 'dispute' and not approved then
    first_state := 'closed';
  end if;
  if why = 'refund' then
    -- A further refund made in Stripe adds to the one staff haven't decided yet.
    select * into v from public.payment_reviews
     where payment_id = p.id and cause = 'refund' and state = 'decide'
     for update;
    if found then
      update public.payment_reviews
         set amount_cents = amount_cents + greatest(coalesce(amount, 0), 0),
             stripe_ref = coalesce(ref, stripe_ref), updated_at = now()
       where id = v.id
      returning * into v;
      return v;
    end if;
  else
    select * into v from public.payment_reviews
     where payment_id = p.id and cause = 'dispute' and stripe_ref = ref
     for update;
    if found then
      return v;
    end if;
  end if;

  insert into public.payment_reviews (payment_id, order_id, factory_org_id, brand_org_id, cause, amount_cents, currency,
                                      stripe_ref, dispute_status, dispute_due_by, dispute_fee_cents, pauses_factory,
                                      state, paused_at, brand_unpaused_at, closed_at)
  values (p.id, o.id, o.factory_org_id, o.brand_org_id, why, greatest(coalesce(amount, 0), 0), p.currency,
          ref, status, due_by, fee,
          -- Before approval the money was never in the factory's balance:
          -- only the brand is paused (20261124100100).
          approved, first_state,
          case when approved and first_state in ('open', 'decide') then now() end,
          -- An inquiry pauses nobody (20261125100000).
          case when first_state = 'inquiry' then now() end,
          case when first_state = 'closed' then now() end)
  returning * into v;
  perform public.tell_review_opened(v);
  return v;
end;
$$;
revoke all on function public.open_payment_review(public.order_payments, public.production_orders, text, bigint, text, text, timestamptz, bigint) from public, anon, authenticated;
grant execute on function public.open_payment_review(public.order_payments, public.production_orders, text, bigint, text, text, timestamptz, bigint) to service_role;

-- The server, for every dispute it reads: one review per dispute id, its
-- state from Stripe's status. Won resumes the factory by itself; lost waits
-- for staff (or closes, on a step not approved); an inquiry pauses nobody.
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
  was_state text;
  next_state text;
  step text;
  approved boolean;
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
  approved := p.state = 'released' or p.release_requested_at is not null;

  select * into v from public.payment_reviews
   where payment_id = p.id and cause = 'dispute' and stripe_ref = dispute_id
   for update;
  if not found then
    -- First heard of once already settled in TSC's favour: nothing to review.
    if status in ('won', 'prevented', 'warning_closed') then
      return null;
    end if;
    return public.open_payment_review(p, o, 'dispute', record_payment_review_dispute.amount_cents, dispute_id, status, due_by, fee_cents);
  end if;

  was_state := v.state;
  -- Staff's decision is final; only the bank's own news is kept on it.
  next_state := case when was_state in ('inquiry', 'open') then public.payment_review_state_for(coalesce(status, v.dispute_status))
                     else was_state end;
  -- An inquiry never goes back from a chargeback.
  if was_state = 'open' and next_state in ('inquiry', 'inquiry_closed') then
    next_state := 'open';
  end if;
  -- Lost on a step still not approved: nothing to decide (20261125100000).
  if next_state = 'decide' and was_state <> 'decide' and not approved and not v.pauses_factory then
    next_state := 'closed';
  end if;
  update public.payment_reviews
     set dispute_status = coalesce(status, dispute_status),
         dispute_due_by = coalesce(due_by, dispute_due_by),
         dispute_fee_cents = coalesce(fee_cents, dispute_fee_cents),
         amount_cents = coalesce(record_payment_review_dispute.amount_cents, payment_reviews.amount_cents),
         state = next_state,
         -- The bank decided for the brand on a step approved since: the money
         -- is in the factory's balance now (20261124100100).
         -- On any change into a pausing state, on money now in the
         -- factory's balance (20261124100100, 20261125100000).
         pauses_factory = pauses_factory or (next_state in ('open', 'decide') and approved),
         paused_at = case when paused_at is null and next_state in ('open', 'decide')
                               and (pauses_factory or approved) then now() else paused_at end,
         -- An inquiry that became a chargeback pauses the brand from now.
         brand_unpaused_at = case when was_state = 'inquiry' and next_state in ('open', 'decide', 'closed') then null else brand_unpaused_at end,
         brand_unpaused_by = case when was_state = 'inquiry' and next_state in ('open', 'decide', 'closed') then null else brand_unpaused_by end,
         closed_at = case when next_state in ('resumed', 'inquiry_closed', 'closed') and closed_at is null then now() else closed_at end,
         updated_at = now()
   where id = v.id
  returning * into v;

  if was_state is distinct from next_state then
    if next_state in ('open', 'decide', 'closed') then
      perform public.tell_review_opened(v);
    elsif next_state = 'resumed' and v.pauses_factory and was_state = 'open' then
      select coalesce(m.title, o.order_number) into step
        from public.order_milestones m right join (select 1) one on m.id = p.milestone_id;
      perform public.tell_factory_resumed(v, step);
    end if;
  end if;
  return v;
end;
$$;
revoke all on function public.record_payment_review_dispute(uuid, text, text, bigint, timestamptz, bigint) from public, anon, authenticated;
grant execute on function public.record_payment_review_dispute(uuid, text, text, bigint, timestamptz, bigint) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Staff decide who was at fault, once the money is back with the brand:
--    the factory (an amount from its balance, TSC the rest; brand unpaused),
--    the brand (TSC absorbs it; the brand stays paused; disputes only), or
--    nobody (TSC absorbs it; the brand unpaused, e.g. a stolen card).
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
  taken jsonb := '[]'::jsonb;
  amount bigint := 0;
  still_paused boolean;
begin
  if not public.is_platform_admin() then
    raise exception 'deciding a payment review is limited to platform staff' using errcode = '42501';
  end if;
  if decision is null or decision not in ('factory_at_fault', 'brand_at_fault', 'no_fault') then
    raise exception 'choose who was at fault' using errcode = '22023', hint = 'review_decision';
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

  -- The order, then the factory: the same order as a withdrawal's claim.
  select * into o from public.production_orders where id = v.order_id for update;
  perform 1 from public.orgs where id = v.factory_org_id for no key update;
  select * into v from public.payment_reviews where id = target_review for update;
  if v.state in ('inquiry', 'open') then
    raise exception 'the bank hasn''t decided yet' using errcode = '22023', hint = 'review_not_ready';
  end if;
  if v.state <> 'decide' then
    raise exception 'this review was already decided' using errcode = '22023', hint = 'review_decided';
  end if;
  if said_note is null then
    raise exception 'add a note' using errcode = '22023', hint = 'review_note';
  end if;
  -- A refund made in Stripe paused no brand: the factory, or not the factory.
  if decision = 'brand_at_fault' and v.cause <> 'dispute' then
    raise exception 'a refund made in Stripe has no brand at fault' using errcode = '22023', hint = 'review_no_brand';
  end if;
  select * into p from public.order_payments where id = v.payment_id;
  select * into m from public.order_milestones where id = p.milestone_id;
  step := coalesce(m.title, o.order_number);

  if decision = 'factory_at_fault' and v.pauses_factory then
    if amount_cents is null or amount_cents < 0 then
      raise exception 'enter an amount of 0 or more' using errcode = '22023', hint = 'review_amount';
    end if;
    cap := least(public.payment_review_factory_part(v), public.review_returnable_cents(v.factory_org_id));
    if amount_cents > cap then
      raise exception 'You can take up to % from the factory''s balance.', public.format_money(cap, 'USD')
        using errcode = '22023', hint = 'review_over_cap', detail = public.format_money(cap, 'USD');
    end if;
    amount := amount_cents;
    left_to_take := amount;
    for part in select * from public.review_returnable_parts(v.factory_org_id, v.payment_id) loop
      exit when left_to_take <= 0;
      take := least(part.room_cents, left_to_take);
      continue when take <= 0;
      update public.order_payments set taken_back_cents = taken_back_cents + take where id = part.payment_id;
      taken := taken || jsonb_build_array(jsonb_build_object('payment_id', part.payment_id, 'cents', take));
      insert into public.payment_events (payment_id, from_state, to_state, actor_kind, actor_user_id, note)
      select x.id, x.state, x.state, 'admin', auth.uid(),
             format('Returned %s to the brand from the factory''s balance (payment review).', public.format_money(take, 'USD'))
        from public.order_payments x where x.id = part.payment_id;
      left_to_take := left_to_take - take;
    end loop;
    if left_to_take > 0 then
      raise exception 'the factory''s balance changed: try again' using errcode = '40001', hint = 'review_balance_changed';
    end if;
  end if;

  update public.payment_reviews
     set decision = decide_payment_review.decision, decided_at = now(), decided_by = auth.uid(), closed_at = now(),
         state = decide_payment_review.decision,
         returned_cents = amount, takes = taken, note = said_note, updated_at = now(),
         -- The factory at fault, or nobody: the brand can use its account
         -- again (if nothing else pauses it). The brand at fault stays paused.
         brand_unpaused_at = case when decide_payment_review.decision in ('factory_at_fault', 'no_fault') and cause = 'dispute'
                                  then coalesce(brand_unpaused_at, now()) else brand_unpaused_at end,
         brand_unpaused_by = case when decide_payment_review.decision in ('factory_at_fault', 'no_fault') and cause = 'dispute' and brand_unpaused_at is null
                                  then auth.uid() else brand_unpaused_by end
   where id = v.id
  returning * into v;

  if v.pauses_factory then
    if amount > 0 then
      still_paused := public.factory_paused(v.factory_org_id);
      insert into public.notifications (org_id, kind, subject_type, subject_id, order_id, title, body, data, dedupe_key)
      values (v.factory_org_id, 'payment_disputed', 'payment', p.id, o.id,
              'Payment review complete',
              -- T2 A3/A4: what left its balance (the brand may have got more).
              format('%s was taken from your balance for the brand''s refund of "%s" on %s.', public.format_money(amount, 'USD'), step, o.order_number)
              || case when still_paused then ' Withdrawals stay paused while another payment is reviewed.'
                      else ' You can withdraw the rest of your balance.' end
              || ' Note from our team: ' || said_note,
              jsonb_build_object('review_id', v.id, 'returned_cents', amount),
              'payment_review_done:' || v.id)
      on conflict (org_id, dedupe_key) do nothing;
    else
      -- The factory-at-fault note goes to the factory; the others stay with staff.
      perform public.tell_factory_resumed(v, step, case when v.decision = 'factory_at_fault' then said_note end);
    end if;
  end if;
  if v.decision in ('factory_at_fault', 'no_fault') and v.cause = 'dispute' then
    perform public.tell_brand_unpaused(v);
    perform public.release_held_while_paused(v.brand_org_id);
  end if;
  return v;
end;
$$;
revoke all on function public.decide_payment_review(uuid, text, bigint, text) from public, anon;
grant execute on function public.decide_payment_review(uuid, text, bigint, text) to authenticated, service_role;

-- Unpausing moved to the brand's account (20261125100000): it lifts every
-- pause of that brand. Staff in the brand, or in a factory it orders from,
-- leave it to someone else.
drop function if exists public.unpause_brand(uuid);

create or replace function public.unpause_brand_org(target_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v public.payment_reviews;
  lifted int := 0;
  last public.payment_reviews;
begin
  if not public.is_platform_admin() then
    raise exception 'unpausing a brand is limited to platform staff' using errcode = '42501';
  end if;
  if not exists (select 1 from public.orgs where id = target_org and type = 'brand') then
    raise exception 'brand not found' using errcode = 'P0002';
  end if;
  if public.is_org_member(target_org) then
    raise exception 'you belong to this brand, so someone else on the staff must decide'
      using errcode = '42501', hint = 'review_own_company';
  end if;
  if exists (select 1 from public.production_orders o
              where o.brand_org_id = target_org and public.is_org_member(o.factory_org_id)) then
    raise exception 'your company has orders with this brand, so someone else on the staff must decide'
      using errcode = '42501', hint = 'unpause_factory_side';
  end if;
  perform 1 from public.orgs where id = target_org for no key update;
  for v in select * from public.payment_reviews
            where brand_org_id = target_org and cause = 'dispute'
              and state not in ('inquiry', 'inquiry_closed') and brand_unpaused_at is null
            order by created_at
              for update loop
    update public.payment_reviews
       set brand_unpaused_at = now(), brand_unpaused_by = auth.uid(), updated_at = now()
     where id = v.id
    returning * into last;
    lifted := lifted + 1;
  end loop;
  if lifted = 0 then
    raise exception 'this brand isn''t paused' using errcode = '22023', hint = 'brand_not_paused';
  end if;
  perform public.tell_brand_unpaused(last);
  perform public.release_held_while_paused(target_org);
  return jsonb_build_object('org_id', target_org, 'lifted', lifted);
end;
$$;
revoke all on function public.unpause_brand_org(uuid) from public, anon;
grant execute on function public.unpause_brand_org(uuid) to authenticated, service_role;

-- Staff's Users page: the brands paused now.
create or replace function public.admin_paused_brands()
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
  return coalesce((select jsonb_agg(jsonb_build_object('org_id', org_id, 'name', name, 'since', since, 'reviews', reviews,
                                                       'reason', reason, 'order_number', order_number, 'owner_email', owner_email,
                                                       'more', more)
                                    order by since)
                     from public.paused_brand_rows()), '[]'::jsonb);
end;
$$;
revoke all on function public.admin_paused_brands() from public, anon;
grant execute on function public.admin_paused_brands() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Staff's board: one row per review, a three-step progress bar.
-- ---------------------------------------------------------------------------

-- Stripe's dispute reason in words staff read (T2 A6).
create or replace function public.dispute_reason_words(reason text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case reason
    when 'product_not_received' then 'Product not received'
    when 'product_unacceptable' then 'Product unacceptable'
    when 'fraudulent' then 'Fraudulent'
    when 'unrecognized' then 'Charge not recognised'
    when 'duplicate' then 'Duplicate charge'
    when 'credit_not_processed' then 'Refund not processed'
    when 'subscription_canceled' then 'Subscription cancelled'
    when 'general' then 'General'
    when 'bank_cannot_process' then 'Bank can''t process'
    when 'customer_initiated' then 'Customer initiated'
    when 'debit_not_authorized' then 'Debit not authorised'
    when 'incorrect_account_details' then 'Incorrect account details'
    when 'insufficient_funds' then 'Insufficient funds'
    when 'check_returned' then 'Check returned'
    when 'noncompliant' then 'Noncompliant'
    else case when reason is null then null else initcap(replace(reason, '_', ' ')) end
  end;
$$;
revoke all on function public.dispute_reason_words(text) from public, anon, authenticated;
grant execute on function public.dispute_reason_words(text) to service_role;

-- The server, with each dispute it reads: Stripe's reason, on its review.
create or replace function public.record_payment_review_dispute_reason(dispute_id text, reason text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.payment_reviews set dispute_reason = nullif(btrim(coalesce(reason, '')), '')
   where cause = 'dispute' and stripe_ref = dispute_id
     and dispute_reason is distinct from nullif(btrim(coalesce(reason, '')), '');
$$;
revoke all on function public.record_payment_review_dispute_reason(text, text) from public, anon, authenticated;
grant execute on function public.record_payment_review_dispute_reason(text, text) to service_role;

create or replace function public.payment_review_reason(v public.payment_reviews)
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select case when v.cause = 'refund' then 'refunded_in_stripe'
              when v.state in ('inquiry', 'inquiry_closed') or coalesce(v.dispute_status, '') like 'warning%' then 'inquiry'
              else 'card_dispute' end;
$$;
revoke all on function public.payment_review_reason(public.payment_reviews) from public, anon, authenticated;
grant execute on function public.payment_review_reason(public.payment_reviews) to service_role;

-- The one short line beside the bar, without a date: step_date is shown
-- after it in the reader's zone ("by <date>" on step 1, " · <date>" on 3).
create or replace function public.payment_review_step_line(v public.payment_reviews)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when v.state in ('inquiry', 'open') and v.dispute_due_by is not null then 'Respond in Stripe by'
    when v.state in ('inquiry', 'open') then 'Waiting for the bank''s ruling'
    when v.state = 'decide' and v.cause = 'refund' then 'Refunded in Stripe'
    when v.state = 'decide' then 'Bank ruled for the brand'
    when v.state = 'factory_at_fault' then format('Factory at fault · %s from its balance', public.format_money(v.returned_cents, v.currency))
      || coalesce(' · ' || (select nullif(btrim(u.full_name), '') from public.user_profiles u where u.id = v.decided_by), '')
    when v.state = 'brand_at_fault' then format('Brand at fault · TSC absorbed %s', public.format_money(v.amount_cents, v.currency))
      || coalesce(' · ' || (select nullif(btrim(u.full_name), '') from public.user_profiles u where u.id = v.decided_by), '')
    when v.state = 'no_fault' then format('No fault · TSC absorbed %s', public.format_money(v.amount_cents, v.currency))
      || coalesce(' · ' || (select nullif(btrim(u.full_name), '') from public.user_profiles u where u.id = v.decided_by), '')
    when v.state = 'resumed' then 'Bank ruled for TSC'
    when v.state = 'closed' then 'Bank ruled for the brand · step not approved'
    when v.state = 'inquiry_closed' then 'Inquiry closed'
    when v.state = 'refund_failed' then 'Refund failed · nothing returned'
  end;
$$;
revoke all on function public.payment_review_step_line(public.payment_reviews) from public, anon, authenticated;
grant execute on function public.payment_review_step_line(public.payment_reviews) to service_role;

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
    select jsonb_agg(row_json order by counted desc, step_no, due_by nulls last, created_at)
      from (
        select public.payment_review_needs_staff(v) as counted, public.payment_review_step(v) as step_no,
               v.dispute_due_by as due_by, v.created_at,
               jsonb_build_object(
          'kind', 'review',
          'id', v.id, 'payment_id', v.payment_id, 'order_id', v.order_id, 'order_number', o.order_number,
          'factory_org_id', v.factory_org_id, 'factory_name', f.name,
          'brand_org_id', v.brand_org_id, 'brand_name', b.name,
          'milestone_title', m.title, 'cause', v.cause,
          'state', v.state,
          'reason', public.payment_review_reason(v),
          'step', public.payment_review_step(v),
          'step_line', public.payment_review_step_line(v),
          'step_date', case when v.state in ('inquiry', 'open') then v.dispute_due_by
                            when v.state = 'decide' then null
                            else coalesce(v.decided_at, v.closed_at) end,
          'flag', case when v.state = 'decide' and v.refund_failed_at is not null then 'Refund failed' end,
          'respond_by', case when v.state in ('inquiry', 'open') then v.dispute_due_by end,
          'open', public.payment_review_needs_staff(v),
          'actions', case when v.state = 'decide' then '["decide"]'::jsonb else '[]'::jsonb end,
          'amount_cents', v.amount_cents, 'currency', v.currency,
          'charged_cents', public.payment_charged_display_cents(p),
          'step_cents', public.payment_factory_base_cents(p),
          'factory_part_cents', public.payment_review_factory_part(v),
          'returnable_cents', public.review_returnable_cents(v.factory_org_id),
          'factory_max_cents', case when v.pauses_factory
                                    then least(public.payment_review_factory_part(v), public.review_returnable_cents(v.factory_org_id))
                                    else 0 end,
          'approved_step', p.release_requested_at is not null or p.state = 'released',
          'factory_paused', v.state in ('open', 'decide') and v.pauses_factory,
          'brand_paused', public.brand_paused(v.brand_org_id),
          'decision', v.decision, 'returned_cents', v.returned_cents, 'note', v.note,
          'decided_at', v.decided_at, 'decided_by_name', (select u.full_name from public.user_profiles u where u.id = v.decided_by),
          'refund_failed_at', v.refund_failed_at, 'refund_failed_cents', v.refund_failed_cents,
          'closed_at', v.closed_at,
          'stripe_ref', v.stripe_ref, 'stripe_payment_intent_id', p.stripe_payment_intent_id,
          'dispute_status', v.dispute_status, 'dispute_due_by', v.dispute_due_by,
          'dispute_fee_cents', coalesce(v.dispute_fee_cents, p.dispute_fee_cents),
          'pauses_factory', v.pauses_factory,
          'payment_state', p.state,
          -- What of this step already left, and how (20261124100000).
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
          'factory_order_ids', case when v.state in ('open', 'decide') and v.pauses_factory then
              (select coalesce(jsonb_agg(x.id), '[]'::jsonb) from public.production_orders x where x.factory_org_id = v.factory_org_id)
            else '[]'::jsonb end,
          'created_at', v.created_at)
          -- A second object: jsonb_build_object takes at most 100 arguments.
          || jsonb_build_object(
          -- T2 A10: this review is what pauses the brand now.
          'pauses_brand', v.cause = 'dispute' and v.state not in ('inquiry', 'inquiry_closed') and v.brand_unpaused_at is null,
          -- T2 A5: another review keeps the brand paused whatever is decided here.
          'brand_stays_paused', exists (select 1 from public.payment_reviews x
                                         where x.brand_org_id = v.brand_org_id and x.id <> v.id and x.cause = 'dispute'
                                           and x.state not in ('inquiry', 'inquiry_closed') and x.brand_unpaused_at is null),
          -- T2 A6: Stripe's reason, its code and in words.
          'dispute_reason', v.dispute_reason,
          'dispute_reason_words', public.dispute_reason_words(v.dispute_reason)) as row_json
          from public.payment_reviews v
          join public.order_payments p on p.id = v.payment_id
          join public.production_orders o on o.id = v.order_id
          join public.orgs f on f.id = v.factory_org_id
          join public.orgs b on b.id = v.brand_org_id
          left join public.order_milestones m on m.id = p.milestone_id
         where public.payment_review_step(v) < 3
            or coalesce(v.closed_at, v.decided_at, v.updated_at) > now() - interval '30 days'
      ) rows), '[]'::jsonb)
    -- A staff refund that failed after it was made (T1 #1).
    || public.staff_refund_board_rows();
end;
$$;
revoke all on function public.payment_review_board() from public, anon;
grant execute on function public.payment_review_board() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. The order page: is this order on hold (its brand paused)?
-- ---------------------------------------------------------------------------
create or replace function public.order_pause(target_order uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  o public.production_orders;
  held boolean;
begin
  select * into o from public.production_orders where id = target_order;
  if not found or not (public.is_org_member(o.brand_org_id) or public.is_org_member(o.factory_org_id) or public.is_platform_admin()) then
    raise exception 'not a party to this order' using errcode = '42501';
  end if;
  held := public.brand_paused(o.brand_org_id);
  -- The payments under a chargeback the bank is still deciding or has ruled
  -- on, not resolved yet: their step reads Disputed (T1 #4). Inquiries are staff's.
  return jsonb_build_object('on_hold', held, 'brand_paused', held,
    'disputed_payment_ids', coalesce((select jsonb_agg(distinct v.payment_id) from public.payment_reviews v
                                       where v.order_id = o.id and v.cause = 'dispute' and v.state in ('open', 'decide')), '[]'::jsonb));
end;
$$;
revoke all on function public.order_pause(uuid) from public, anon;
grant execute on function public.order_pause(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. Staff refunds in the app.
-- ---------------------------------------------------------------------------
create table if not exists public.staff_refunds (
  id               uuid primary key default gen_random_uuid(),
  payment_id       uuid not null references public.order_payments(id) on delete cascade,
  order_id         uuid not null references public.production_orders(id) on delete cascade,
  factory_org_id   uuid not null references public.orgs(id) on delete cascade,
  brand_org_id     uuid not null references public.orgs(id) on delete cascade,
  amount_cents     bigint not null check (amount_cents > 0),
  currency         text not null default 'USD',
  -- Null on a step not approved: the factory's balance isn't involved.
  payer            text check (payer in ('factory', 'tsc')),
  factory_cents    bigint not null default 0 check (factory_cents >= 0),
  -- Where the factory's part was taken from ([{payment_id, cents}]), to give it back exactly.
  takes            jsonb not null default '[]'::jsonb,
  note             text not null,
  status           text not null default 'claimed' check (status in ('claimed', 'made', 'failed')),
  stripe_refund_id text,
  stripe_status    text,
  failure          text,
  -- A full refund of a held payment sent the brand back to pay (as a refund made in Stripe does).
  reset_payment    boolean not null default false,
  -- What the claim decided, so recording and giving back never re-read the
  -- payment's state (20261125100000): approved then, and what recording
  -- added to review_kept_cents.
  approved_at_claim boolean not null default false,
  kept_cents       bigint not null default 0 check (kept_cents >= 0),
  payment_intent   text,
  -- A try at Stripe holds a lease (R2): no new key while one may still run.
  attempt_at       timestamptz,
  -- Marked failed, then made after all: Stripe decides (R1).
  recovered_at     timestamptz,
  claimed_at       timestamptz not null default now(),
  recorded_at      timestamptz,
  failed_at        timestamptz,
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (payer = 'factory' or factory_cents = 0)
);
comment on table public.staff_refunds is
  'A refund staff made from the admin board, with who bore it (20261125100000). Only functions write.';
create unique index if not exists staff_refunds_one_claimed on public.staff_refunds (payment_id) where status = 'claimed';

-- Every refund that went through on a payment, one line each (T1 #2/#5):
-- what the brand reads on its Payments. A refund that later fails takes its
-- line away. Written only by the functions that record refunds.
create table if not exists public.payment_refund_lines (
  id               uuid primary key default gen_random_uuid(),
  payment_id       uuid not null references public.order_payments(id) on delete cascade,
  order_id         uuid not null references public.production_orders(id) on delete cascade,
  brand_org_id     uuid not null references public.orgs(id) on delete cascade,
  kind             text not null,
  amount_cents     bigint not null check (amount_cents > 0),
  currency         text not null default 'USD',
  payment_intent   text,
  staff_refund_id  uuid references public.staff_refunds(id) on delete set null,
  note             text,
  refunded_at      timestamptz not null default now()
);
-- 'manual': refunded by staff another way, closing a failed refund (T2 R3).
alter table public.payment_refund_lines drop constraint if exists payment_refund_lines_kind_check;
alter table public.payment_refund_lines add constraint payment_refund_lines_kind_check
  check (kind in ('staff', 'stripe_dashboard', 'cancellation', 'automatic', 'manual'));
create index if not exists payment_refund_lines_brand on public.payment_refund_lines (brand_org_id, refunded_at desc);
create index if not exists payment_refund_lines_payment on public.payment_refund_lines (payment_id, refunded_at desc);
alter table public.payment_refund_lines enable row level security;
revoke all on table public.payment_refund_lines from public, anon, authenticated;
grant all on table public.payment_refund_lines to service_role;

create or replace function public.add_refund_line(target_payment uuid, kind text, amount bigint, payment_intent text,
                                                  staff_refund uuid default null, note text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(amount, 0) <= 0 then
    return;
  end if;
  insert into public.payment_refund_lines (payment_id, order_id, brand_org_id, kind, amount_cents, currency, payment_intent, staff_refund_id, note)
  select p.id, o.id, o.brand_org_id, kind, amount, p.currency, payment_intent, staff_refund, nullif(btrim(coalesce(note, '')), '')
    from public.order_payments p join public.production_orders o on o.id = p.order_id
   where p.id = target_payment;
end;
$$;
revoke all on function public.add_refund_line(uuid, text, bigint, text, uuid, text) from public, anon, authenticated;

-- A refund that did not go through after all takes its lines away, newest
-- first, up to the failed amount (of the kinds given).
create or replace function public.take_back_refund_lines(target_payment uuid, kinds text[], amount bigint, for_intent text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  l record;
  left_amount bigint := coalesce(amount, 0);
begin
  for l in select * from public.payment_refund_lines x
            where x.payment_id = target_payment and x.kind = any(kinds)
              and (for_intent is null or x.payment_intent is not distinct from for_intent)
            order by x.refunded_at desc for update loop
    exit when left_amount <= 0;
    if l.amount_cents <= left_amount then
      delete from public.payment_refund_lines where id = l.id;
      left_amount := left_amount - l.amount_cents;
    else
      update public.payment_refund_lines set amount_cents = amount_cents - left_amount where id = l.id;
      left_amount := 0;
    end if;
  end loop;
end;
$$;
revoke all on function public.take_back_refund_lines(uuid, text[], bigint, text) from public, anon, authenticated;

-- Refunds staff made before the ledger: their lines.
insert into public.payment_refund_lines (payment_id, order_id, brand_org_id, kind, amount_cents, currency, payment_intent, staff_refund_id, note, refunded_at)
select s.payment_id, s.order_id, s.brand_org_id, 'staff', s.amount_cents, s.currency, s.payment_intent, s.id, s.note, coalesce(s.recorded_at, s.created_at)
  from public.staff_refunds s
 where s.status = 'made'
   and not exists (select 1 from public.payment_refund_lines l where l.staff_refund_id = s.id);


-- ---------------------------------------------------------------------------
-- 12. Tester fixes (20261125100000, T1).
-- ---------------------------------------------------------------------------
-- #1: a staff refund that failed after Stripe made it is open work for staff:
-- its own row on Review needed, counted, until refunded again or closed
-- with a note (for when staff refund the brand another way).
alter table public.staff_refunds add column if not exists closed_at timestamptz;
alter table public.staff_refunds add column if not exists closed_by uuid references auth.users(id) on delete set null;
alter table public.staff_refunds add column if not exists close_note text;
alter table public.staff_refunds add column if not exists close_refunded_cents bigint;

create or replace function public.staff_refund_needs_staff(s public.staff_refunds)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  -- Failed after it was made (Stripe's refund.failed): nobody saw it fail.
  -- One refused in the dialog was seen there. A later refund of the same
  -- payment that was made settles it.
  select s.status = 'failed' and s.recorded_at is not null and s.closed_at is null
     and not exists (select 1 from public.staff_refunds x where x.payment_id = s.payment_id and x.status = 'made'
                       and x.created_at > s.created_at);
$$;
revoke all on function public.staff_refund_needs_staff(public.staff_refunds) from public, anon, authenticated;
grant execute on function public.staff_refund_needs_staff(public.staff_refunds) to service_role;

-- Close asks how much went back another way (0 up to the failed amount):
-- that much is a 'manual' refund line and on the payment's
-- manual_refunded_cents, so the brand's figures follow (T2 R3). It is TSC's
-- money: the factory's balance doesn't change.
drop function if exists public.close_staff_refund_failure(uuid, text);
create or replace function public.close_staff_refund_failure(target_refund uuid, note text, refunded_cents bigint)
returns public.staff_refunds
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.staff_refunds;
  said text := nullif(btrim(coalesce(note, '')), '');
begin
  if not public.is_platform_admin() then
    raise exception 'limited to platform staff' using errcode = '42501';
  end if;
  select * into s from public.staff_refunds where id = target_refund;
  if not found then
    raise exception 'refund not found' using errcode = 'P0002';
  end if;
  perform public.payout_staff_check(s.factory_org_id);
  if public.is_org_member(s.brand_org_id) then
    raise exception 'you belong to this brand, so someone else on the staff must decide'
      using errcode = '42501', hint = 'review_own_company';
  end if;
  select * into s from public.staff_refunds where id = target_refund for update;
  if not public.staff_refund_needs_staff(s) then
    raise exception 'this refund isn''t waiting on staff' using errcode = '22023', hint = 'staff_refund_not_open';
  end if;
  if said is null then
    raise exception 'add a note' using errcode = '22023', hint = 'staff_refund_close_note';
  end if;
  if refunded_cents is null or refunded_cents < 0 or refunded_cents > s.amount_cents then
    raise exception 'enter an amount from 0 up to %', public.format_money(s.amount_cents, s.currency)
      using errcode = '22023', hint = 'staff_refund_close_amount', detail = public.format_money(s.amount_cents, s.currency);
  end if;
  update public.staff_refunds set closed_at = now(), closed_by = auth.uid(), close_note = said,
         close_refunded_cents = close_staff_refund_failure.refunded_cents, updated_at = now()
   where id = s.id
  returning * into s;
  if s.close_refunded_cents > 0 then
    update public.order_payments set manual_refunded_cents = manual_refunded_cents + s.close_refunded_cents
     where id = s.payment_id;
    perform public.add_refund_line(s.payment_id, 'manual', s.close_refunded_cents, null, s.id, said);
    insert into public.payment_events (payment_id, from_state, to_state, actor_kind, actor_user_id, note)
    select p.id, p.state, p.state, 'admin', auth.uid(),
           format('Refunded %s to the brand another way (closing a failed refund).', public.format_money(s.close_refunded_cents, p.currency))
      from public.order_payments p where p.id = s.payment_id;
  end if;
  -- The note goes to the brand (Round 2 #10).
  insert into public.notifications (org_id, kind, subject_type, subject_id, order_id, title, body, dedupe_key)
  select s.brand_org_id, 'payment_refunded', 'payment', s.payment_id, s.order_id,
         format('Refund for "%s"', coalesce(m.title, o.order_number)),
         format('Update on your %s refund. Note from our team: %s', public.format_money(s.amount_cents, s.currency), said),
         'staff_refund_closed:' || s.id
    from public.production_orders o
    left join public.order_payments p on p.id = s.payment_id
    left join public.order_milestones m on m.id = p.milestone_id
   where o.id = s.order_id
  on conflict (org_id, dedupe_key) do nothing;
  return s;
end;
$$;
revoke all on function public.close_staff_refund_failure(uuid, text, bigint) from public, anon;
grant execute on function public.close_staff_refund_failure(uuid, text, bigint) to authenticated, service_role;

-- The board: failed staff refunds as rows of their own (kind 'staff_refund'),
-- beside the reviews (kind 'review').
create or replace function public.staff_refund_board_rows()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', 'staff_refund', 'id', s.id, 'staff_refund_id', s.id,
           'payment_id', s.payment_id, 'order_id', s.order_id, 'order_number', o.order_number,
           'factory_org_id', s.factory_org_id, 'factory_name', f.name,
           'brand_org_id', s.brand_org_id, 'brand_name', b.name,
           'milestone_title', m.title, 'cause', 'staff_refund', 'reason', 'staff_refund',
           'state', case when public.staff_refund_needs_staff(s) then 'refund_failed' else 'closed' end,
           'step', case when public.staff_refund_needs_staff(s) then 2 else 3 end,
           'step_line', case when public.staff_refund_needs_staff(s) then 'Refund failed'
                             else 'Refund failed · closed' || coalesce(' · ' || nullif(btrim(u.full_name), ''), '') end,
           'step_date', case when public.staff_refund_needs_staff(s) then null else s.closed_at end,
           'flag', case when public.staff_refund_needs_staff(s) then 'Refund failed' end,
           'failure', s.failure,
           'amount_cents', s.amount_cents, 'currency', s.currency,
           'factory_cents', s.factory_cents, 'payer', s.payer, 'note', s.note, 'close_note', s.close_note, 'close_refunded_cents', s.close_refunded_cents,
           'open', public.staff_refund_needs_staff(s),
           'actions', case when public.staff_refund_needs_staff(s) then '["refund_again", "close"]'::jsonb else '[]'::jsonb end,
           'brand_paused', public.brand_paused(s.brand_org_id),
           'created_at', coalesce(s.failed_at, s.created_at))
         order by coalesce(s.failed_at, s.created_at)), '[]'::jsonb)
    from public.staff_refunds s
    join public.production_orders o on o.id = s.order_id
    join public.orgs f on f.id = s.factory_org_id
    join public.orgs b on b.id = s.brand_org_id
    left join public.order_payments p on p.id = s.payment_id
    left join public.order_milestones m on m.id = p.milestone_id
    left join public.user_profiles u on u.id = s.closed_by
   where s.status = 'failed' and s.recorded_at is not null
     and (public.staff_refund_needs_staff(s) or s.closed_at > now() - interval '30 days');
$$;
revoke all on function public.staff_refund_board_rows() from public, anon, authenticated;
grant execute on function public.staff_refund_board_rows() to service_role;

-- #3 / #4: no "funded" notices on a charge disputed at funding (a chargeback;
-- an inquiry is staff's only and changes nothing for the two companies).
create or replace function public.payment_has_chargeback(target_payment uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.payment_reviews v
                  where v.payment_id = target_payment and v.cause = 'dispute'
                    and v.state not in ('inquiry', 'inquiry_closed'));
$$;
revoke all on function public.payment_has_chargeback(uuid) from public, anon, authenticated;
grant execute on function public.payment_has_chargeback(uuid) to service_role;

-- #4: a chargeback opened right after funding: the "funded" notices sent a
-- moment before are withdrawn (unread ones, and their emails not sent yet).
create or replace function public.withdraw_funded_notices(target_payment uuid)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  gone int;
begin
  update public.notification_email_outbox x set status = 'skipped', last_error = 'withdrawn: the charge was disputed'
   where x.status = 'pending'
     and x.notification_id in (select n.id from public.notifications n
                                where n.subject_id = target_payment and n.kind = 'payment_confirmed'
                                  and n.read_at is null and n.created_at > now() - interval '15 minutes');
  delete from public.notifications n
   where n.subject_id = target_payment and n.kind = 'payment_confirmed'
     and n.read_at is null and n.created_at > now() - interval '15 minutes'
     and not exists (select 1 from public.notification_email_outbox x where x.notification_id = n.id and x.status <> 'skipped');
  get diagnostics gone = row_count;
  return gone;
end;
$$;
revoke all on function public.withdraw_funded_notices(uuid) from public, anon, authenticated;

-- #5: the brand's own refunds, one line each (a staff refund, made).
create or replace function public.brand_payment_refunds(target_org uuid)
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
  -- Nothing about the factory's share: what the brand got back, and why.
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', l.id, 'payment_id', l.payment_id, 'order_id', l.order_id, 'order_number', o.order_number,
             'step_title', m.title, 'amount_cents', l.amount_cents, 'currency', l.currency,
             'refunded_at', l.refunded_at, 'kind', l.kind, 'note', case when l.kind in ('staff', 'manual') then l.note end)
           order by l.refunded_at desc)
      from public.payment_refund_lines l
      join public.production_orders o on o.id = l.order_id
      left join public.order_payments p on p.id = l.payment_id
      left join public.order_milestones m on m.id = p.milestone_id
     where l.brand_org_id = target_org), '[]'::jsonb);
end;
$$;
revoke all on function public.brand_payment_refunds(uuid) from public, anon;
grant execute on function public.brand_payment_refunds(uuid) to authenticated, service_role;

-- #2: what went back to the brand on a payment, also after a full refund of a
-- held step reset it (the step waits for a payment again; the refund was made).
create or replace function public.payment_refunded_display_cents(p public.order_payments)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.refunded_cents + p.dispute_lost_cents
         + case when p.state in ('due', 'failed', 'not_due', 'cancelled') and p.refunded_at is not null
                then coalesce((select sum(s.amount_cents) from public.staff_refunds s
                                where s.payment_id = p.id and s.status = 'made' and s.reset_payment
                                  and s.recorded_at >= p.refunded_at - interval '1 minute'), 0)
                else 0 end;
$$;
revoke all on function public.payment_refunded_display_cents(public.order_payments) from public, anon, authenticated;
grant execute on function public.payment_refunded_display_cents(public.order_payments) to service_role;

create index if not exists staff_refunds_payment on public.staff_refunds (payment_id, created_at desc);
alter table public.staff_refunds enable row level security;
revoke all on table public.staff_refunds from public, anon, authenticated;
grant all on table public.staff_refunds to service_role;

-- What could still go back to the brand, from what TSC recorded. The server
-- checks Stripe's own refund list as well before refunding.
create or replace function public.staff_refundable_cents(p public.order_payments)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select greatest(0, coalesce(p.charged_cents, p.amount_received_cents, p.amount_cents, 0)
                     - p.refunded_cents - p.dispute_lost_cents - p.manual_refunded_cents
                     - coalesce((select sum(s.amount_cents) from public.staff_refunds s
                                  where s.payment_id = p.id and (s.status = 'claimed' or (s.status = 'made' and s.recorded_at is null))), 0))::bigint;
$$;
revoke all on function public.staff_refundable_cents(public.order_payments) from public, anon, authenticated;
grant execute on function public.staff_refundable_cents(public.order_payments) to service_role;

-- Why Refund… is refused on a payment now, as a hint; null when it can go.
create or replace function public.staff_refund_refusal(p public.order_payments)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when o.status = 'cancelled' then 'staff_refund_cancelled_order'
    when p.state = 'processing' then 'staff_refund_processing'
    when p.state not in ('confirmed', 'released') or p.stripe_payment_intent_id is null then 'staff_refund_not_charged'
    -- A chargeback refuses; an inquiry doesn't (a refund is the usual way
    -- to settle one, and no money has moved).
    when exists (select 1 from public.payment_reviews v where v.payment_id = p.id and v.cause = 'dispute' and v.state = 'open')
      or (p.disputed_at is not null
          and not exists (select 1 from public.payment_reviews v where v.payment_id = p.id and v.cause = 'dispute' and v.state = 'inquiry'))
      then 'staff_refund_disputed'
    when exists (select 1 from public.staff_refunds s where s.payment_id = p.id and s.status = 'claimed') then 'staff_refund_claimed'
    when public.staff_refundable_cents(p) <= 0 then 'staff_refund_over'
  end
    from public.production_orders o where o.id = p.order_id;
$$;
revoke all on function public.staff_refund_refusal(public.order_payments) from public, anon, authenticated;
grant execute on function public.staff_refund_refusal(public.order_payments) to service_role;

-- The factory's share of an amount the brand gets back: its step within the charge.
create or replace function public.staff_refund_factory_share(p public.order_payments, amount bigint)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with x as (
    select coalesce(p.charged_cents, p.amount_received_cents, p.amount_cents) as charged,
           public.payment_factory_base_cents(p) as base,
           p.refunded_cents + p.dispute_lost_cents
             + coalesce((select sum(s.amount_cents) from public.staff_refunds s
                          where s.payment_id = p.id and (s.status = 'claimed' or (s.status = 'made' and s.recorded_at is null))), 0) as before)
  select greatest(0,
           least(x.base, coalesce(round((x.before + amount)::numeric * p.amount_cents / nullif(x.charged, 0))::bigint, 0))
           - least(x.base, coalesce(round(x.before::numeric * p.amount_cents / nullif(x.charged, 0))::bigint, 0)))
    from x;
$$;
revoke all on function public.staff_refund_factory_share(public.order_payments, bigint) from public, anon, authenticated;
grant execute on function public.staff_refund_factory_share(public.order_payments, bigint) to service_role;

create or replace function public.staff_refund_rows(target_payment uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'amount_cents', s.amount_cents, 'factory_cents', s.factory_cents,
           'tsc_cents', s.amount_cents - s.factory_cents, 'payer', s.payer, 'note', s.note,
           'status', s.status, 'stripe_status', s.stripe_status, 'failure', s.failure,
           'flag', case when s.recovered_at is not null then 'Refund succeeded after a failure' end,
           'created_at', s.created_at, 'by_name', (select u.full_name from public.user_profiles u where u.id = s.created_by),
           -- Closed after a failure (Round 2 #10): when, by whom, the note the brand got.
           'closed_at', s.closed_at, 'close_note', s.close_note, 'close_refunded_cents', s.close_refunded_cents,
           'closed_by_name', (select u.full_name from public.user_profiles u where u.id = s.closed_by))
         order by s.created_at desc), '[]'::jsonb)
    from public.staff_refunds s where s.payment_id = target_payment;
$$;
revoke all on function public.staff_refund_rows(uuid) from public, anon, authenticated;
grant execute on function public.staff_refund_rows(uuid) to service_role;

-- The dialog's figures, read when it opens.
create or replace function public.staff_refund_preview(target_payment uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  p public.order_payments;
  o public.production_orders;
begin
  if not public.is_platform_admin() then
    raise exception 'limited to platform staff' using errcode = '42501';
  end if;
  select * into p from public.order_payments where id = target_payment;
  if not found then
    raise exception 'payment not found' using errcode = 'P0002';
  end if;
  select * into o from public.production_orders where id = p.order_id;
  return jsonb_build_object(
    'payment_id', p.id, 'order_id', o.id, 'order_number', o.order_number,
    'step_title', (select m.title from public.order_milestones m where m.id = p.milestone_id),
    'brand_name', (select name from public.orgs where id = o.brand_org_id),
    'factory_name', (select name from public.orgs where id = o.factory_org_id),
    'state', p.state,
    'approved_step', p.release_requested_at is not null or p.state = 'released',
    'charged_cents', public.payment_charged_display_cents(p),
    'refunded_cents', public.payment_refunded_display_cents(p),
    'refundable_cents', public.staff_refundable_cents(p),
    'step_cents', p.amount_cents,
    'factory_cap_cents', public.review_returnable_cents(o.factory_org_id),
    'factory_max_cents', least(public.staff_refund_factory_share(p, public.staff_refundable_cents(p)),
                               public.review_returnable_cents(o.factory_org_id)),
    'refund_refusal', public.staff_refund_refusal(p),
    'pending_refund_id', (select s.id from public.staff_refunds s where s.payment_id = p.id and s.status = 'claimed'),
    'staff_refunds', public.staff_refund_rows(p.id));
end;
$$;
revoke all on function public.staff_refund_preview(uuid) from public, anon;
grant execute on function public.staff_refund_preview(uuid) to authenticated, service_role;

-- Refund facts for the rows of the Held tab (admin_payment_board), by id.
create or replace function public.admin_refund_info(payment_ids uuid[])
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
    select jsonb_object_agg(p.id, jsonb_build_object(
             'refundable_cents', public.staff_refundable_cents(p),
             'refunded_cents', public.payment_refunded_display_cents(p),
             'refund_refusal', public.staff_refund_refusal(p),
             'approved_step', p.release_requested_at is not null or p.state = 'released',
             'staff_refunds', public.staff_refund_rows(p.id)))
      from public.order_payments p where p.id = any(payment_ids)), '{}'::jsonb);
end;
$$;
revoke all on function public.admin_refund_info(uuid[]) from public, anon;
grant execute on function public.admin_refund_info(uuid[]) to authenticated, service_role;

-- Find an order by its number, with its payments and what Refund… can do.
create or replace function public.admin_order_payments(search text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  o public.production_orders;
  wanted text := upper(regexp_replace(btrim(coalesce(search, '')), '\s+', '', 'g'));
begin
  if not public.is_platform_admin() then
    raise exception 'limited to platform staff' using errcode = '42501';
  end if;
  if wanted = '' then
    return null;
  end if;
  if wanted !~ '^TSC-' then
    wanted := 'TSC-' || wanted;
  end if;
  select * into o from public.production_orders x where upper(x.order_number) = wanted
    or upper(x.order_number) = 'TSC-' || lpad(substr(wanted, 5), 6, '0') limit 1;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'order_id', o.id, 'order_number', o.order_number, 'status', o.status,
    'brand_name', (select name from public.orgs where id = o.brand_org_id),
    'factory_name', (select name from public.orgs where id = o.factory_org_id),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
               'payment_id', p.id, 'step_title', m.title, 'state', p.state,
               'approved_step', p.release_requested_at is not null or p.state = 'released',
               'charged_cents', public.payment_charged_display_cents(p),
               'refunded_cents', public.payment_refunded_display_cents(p),
               'refundable_cents', public.staff_refundable_cents(p),
               'refund_refusal', public.staff_refund_refusal(p),
               'staff_refunds', public.staff_refund_rows(p.id))
             order by m.sort nulls last, p.created_at)
        from public.order_payments p left join public.order_milestones m on m.id = p.milestone_id
       where p.order_id = o.id), '[]'::jsonb));
end;
$$;
revoke all on function public.admin_order_payments(text) from public, anon;
grant execute on function public.admin_order_payments(text) to authenticated, service_role;

-- Staff, through /api/stripe-refund with their own token: claim a refund.
-- The factory's part (when it pays) is taken from its balance here, in the
-- same transaction, so no withdrawal can race it. Returns what the server
-- needs to make it in Stripe once (the key carries the claim's time).
create or replace function public.claim_staff_refund(target_payment uuid, amount_cents bigint, payer text, note text,
                                                     factory_cents bigint default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  o public.production_orders;
  p public.order_payments;
  s public.staff_refunds;
  refusal text;
  refundable bigint;
  approved boolean;
  share bigint := 0;
  left_to_take bigint;
  take bigint;
  part record;
  taken jsonb := '[]'::jsonb;
  said_note text := nullif(btrim(coalesce(note, '')), '');
begin
  if not public.is_platform_admin() then
    raise exception 'refunds are limited to platform staff' using errcode = '42501';
  end if;
  select * into o from public.production_orders
   where id = (select order_id from public.order_payments where id = target_payment)
   for update;
  if not found then
    raise exception 'payment not found' using errcode = 'P0002';
  end if;
  perform public.payout_staff_check(o.factory_org_id);
  if public.is_org_member(o.brand_org_id) then
    raise exception 'you belong to this brand, so someone else on the staff must refund it'
      using errcode = '42501', hint = 'review_own_company';
  end if;
  perform 1 from public.orgs where id = o.factory_org_id for no key update;
  select * into p from public.order_payments where id = target_payment for update;

  refusal := public.staff_refund_refusal(p);
  if refusal is not null and refusal <> 'staff_refund_over' then
    raise exception '%', refusal using errcode = '22023', hint = refusal;
  end if;
  if amount_cents is null or amount_cents <= 0 then
    raise exception 'enter an amount above 0' using errcode = '22023', hint = 'staff_refund_amount';
  end if;
  refundable := public.staff_refundable_cents(p);
  if amount_cents > refundable then
    raise exception 'You can refund up to %.', public.format_money(refundable, p.currency)
      using errcode = '22023', hint = 'staff_refund_over', detail = public.format_money(refundable, p.currency);
  end if;
  approved := p.state = 'released' or p.release_requested_at is not null;
  if approved and (payer is null or payer not in ('factory', 'tsc')) then
    raise exception 'choose who pays for this refund' using errcode = '22023', hint = 'staff_refund_payer';
  end if;
  if not approved and payer is not null then
    raise exception 'this step isn''t approved' using errcode = '22023', hint = 'staff_refund_payer_not_approved';
  end if;
  if said_note is null then
    raise exception 'add a reason for the brand' using errcode = '22023', hint = 'staff_refund_note';
  end if;

  if payer = 'factory' then
    share := least(public.staff_refund_factory_share(p, amount_cents), public.review_returnable_cents(o.factory_org_id));
    -- Staff may take less than the factory's share; never more (20261125100000).
    if factory_cents is not null then
      if factory_cents < 0 or factory_cents > share then
        raise exception 'You can take up to % from the factory''s balance.', public.format_money(share, p.currency)
          using errcode = '22023', hint = 'staff_refund_factory_over', detail = public.format_money(share, p.currency);
      end if;
      share := factory_cents;
    end if;
    left_to_take := share;
    for part in select * from public.review_returnable_parts(o.factory_org_id, p.id) loop
      exit when left_to_take <= 0;
      take := least(part.room_cents, left_to_take);
      continue when take <= 0;
      update public.order_payments set taken_back_cents = taken_back_cents + take where id = part.payment_id;
      taken := taken || jsonb_build_array(jsonb_build_object('payment_id', part.payment_id, 'cents', take));
      insert into public.payment_events (payment_id, from_state, to_state, actor_kind, actor_user_id, note)
      select x.id, x.state, x.state, 'admin', auth.uid(),
             format('Took %s from the factory''s balance for a refund to the brand.', public.format_money(take, 'USD'))
        from public.order_payments x where x.id = part.payment_id;
      left_to_take := left_to_take - take;
    end loop;
    if left_to_take > 0 then
      raise exception 'the factory''s balance changed: try again' using errcode = '40001', hint = 'staff_refund_balance_changed';
    end if;
  end if;

  insert into public.staff_refunds (payment_id, order_id, factory_org_id, brand_org_id, amount_cents, currency, payer,
                                    factory_cents, takes, note, created_by, approved_at_claim, payment_intent)
  values (p.id, o.id, o.factory_org_id, o.brand_org_id, amount_cents, p.currency, payer, share, taken, said_note, auth.uid(),
          approved, p.stripe_payment_intent_id)
  returning * into s;
  return public.staff_refund_claim(s, p);
end;
$$;
revoke all on function public.claim_staff_refund(uuid, bigint, text, text, bigint) from public, anon;
grant execute on function public.claim_staff_refund(uuid, bigint, text, text, bigint) to authenticated, service_role;

create or replace function public.staff_refund_claim(s public.staff_refunds, p public.order_payments)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'staff_refund_id', s.id, 'payment_id', s.payment_id, 'order_id', s.order_id,
    'intent', p.stripe_payment_intent_id, 'charge', p.stripe_charge_id,
    'amount_cents', s.amount_cents, 'factory_cents', s.factory_cents, 'tsc_cents', s.amount_cents - s.factory_cents,
    'status', s.status, 'stripe_refund_id', s.stripe_refund_id, 'failure', s.failure,
    'key', format('staff-refund-%s-%s', s.id, (extract(epoch from s.claimed_at) * 1000)::bigint));
$$;
revoke all on function public.staff_refund_claim(public.staff_refunds, public.order_payments) from public, anon, authenticated;
grant execute on function public.staff_refund_claim(public.staff_refunds, public.order_payments) to service_role;

-- Staff's "Check again" on a refund Stripe couldn't be asked about: the same
-- claim, so the server finds it by its id and never refunds twice.
create or replace function public.staff_refund_retry(target_refund uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  s public.staff_refunds;
  p public.order_payments;
begin
  if not public.is_platform_admin() then
    raise exception 'refunds are limited to platform staff' using errcode = '42501';
  end if;
  select * into s from public.staff_refunds where id = target_refund;
  if not found then
    raise exception 'refund not found' using errcode = 'P0002';
  end if;
  perform public.payout_staff_check(s.factory_org_id);
  if public.is_org_member(s.brand_org_id) then
    raise exception 'you belong to this brand, so someone else on the staff must refund it'
      using errcode = '42501', hint = 'review_own_company';
  end if;
  select * into p from public.order_payments where id = s.payment_id;
  return public.staff_refund_claim(s, p);
end;
$$;
revoke all on function public.staff_refund_retry(uuid) from public, anon;
grant execute on function public.staff_refund_retry(uuid) to authenticated, service_role;

-- Gives back exactly what a staff refund took from the factory's balance.
create or replace function public.give_back_staff_refund_takes(s public.staff_refunds)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  t record;
  back bigint;
  given bigint := 0;
begin
  for t in select (e->>'payment_id')::uuid as payment_id, (e->>'cents')::bigint as cents
             from jsonb_array_elements(s.takes) e loop
    select least(x.taken_back_cents, t.cents) into back from public.order_payments x where x.id = t.payment_id for update;
    continue when coalesce(back, 0) <= 0;
    update public.order_payments x set taken_back_cents = x.taken_back_cents - back where x.id = t.payment_id;
    insert into public.payment_events (payment_id, from_state, to_state, actor_kind, note)
    select x.id, x.state, x.state, 'system',
           format('The refund to the brand didn''t go through: %s given back to the factory''s balance.', public.format_money(back, 'USD'))
      from public.order_payments x where x.id = t.payment_id;
    given := given + back;
  end loop;
  return given;
end;
$$;
revoke all on function public.give_back_staff_refund_takes(public.staff_refunds) from public, anon, authenticated;

-- The server, once Stripe made the refund (or its webhook says so): recorded
-- on the payment without opening a review, and both sides told. Once.
create or replace function public.record_staff_refund(target_refund uuid, stripe_refund text, refund_status text)
returns public.staff_refunds
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.staff_refunds;
  o public.production_orders;
  p public.order_payments;
  m public.order_milestones;
  approved boolean;
  charged bigint;
  was_share bigint;
  was_debt bigint;
  step text;
  recovering boolean := false;
  part record;
  left_to_take bigint;
  take bigint;
  taken jsonb := '[]'::jsonb;
  retaken bigint := 0;
begin
  select * into s from public.staff_refunds where id = target_refund;
  if not found then
    return null;
  end if;
  if refund_status in ('failed', 'canceled') then
    return public.record_staff_refund_failed(target_refund, null);
  end if;
  select * into o from public.production_orders where id = s.order_id for update;
  perform 1 from public.orgs where id = o.factory_org_id for no key update;
  select * into p from public.order_payments where id = s.payment_id for update;
  select * into s from public.staff_refunds where id = target_refund for update;
  -- Marked failed (refused, or failed later), and Stripe now says it was
  -- made: Stripe decides (20261125100000). The factory's part is taken again,
  -- up to what is still with TSC; TSC absorbs the rest; staff see a flag.
  if s.status = 'failed' and refund_status in ('succeeded', 'pending') then
    recovering := true;
    if s.payer = 'factory' and s.factory_cents > 0 and s.approved_at_claim then
      left_to_take := least(s.factory_cents, public.review_returnable_cents(o.factory_org_id));
      for part in select * from public.review_returnable_parts(o.factory_org_id, p.id) loop
        exit when left_to_take <= 0;
        take := least(part.room_cents, left_to_take);
        continue when take <= 0;
        update public.order_payments set taken_back_cents = taken_back_cents + take where id = part.payment_id;
        taken := taken || jsonb_build_array(jsonb_build_object('payment_id', part.payment_id, 'cents', take));
        insert into public.payment_events (payment_id, from_state, to_state, actor_kind, note)
        select x.id, x.state, x.state, 'system',
               format('Took %s from the factory''s balance again: Stripe made a refund it had refused.', public.format_money(take, 'USD'))
          from public.order_payments x where x.id = part.payment_id;
        left_to_take := left_to_take - take;
        retaken := retaken + take;
      end loop;
    end if;
    update public.staff_refunds
       set status = 'claimed', factory_cents = retaken, takes = taken, recovered_at = now(), failed_at = null, updated_at = now()
     where id = s.id
    returning * into s;
  end if;
  if s.status <> 'claimed' then
    -- Recorded already; a later status from Stripe is kept for staff.
    update public.staff_refunds set stripe_status = coalesce(refund_status, stripe_status),
           stripe_refund_id = coalesce(stripe_refund_id, stripe_refund), updated_at = now()
     where id = s.id and s.status = 'made'
    returning * into s;
    return coalesce(s, (select x from public.staff_refunds x where x.id = target_refund));
  end if;

  select * into m from public.order_milestones where id = p.milestone_id;
  step := coalesce(m.title, o.order_number);
  -- What the claim decided (20261125100000): no approval can happen while a
  -- claim is open (guard_refund_in_progress), and this never re-reads it.
  approved := s.approved_at_claim;
  charged := coalesce(p.charged_cents, p.amount_received_cents, p.amount_cents);

  update public.staff_refunds
     set status = 'made', stripe_refund_id = stripe_refund, stripe_status = refund_status, recorded_at = now(),
         reset_payment = (not approved and p.refunded_cents + p.dispute_lost_cents + s.amount_cents >= charged),
         kept_cents = case when approved then s.amount_cents else 0 end,
         updated_at = now()
   where id = s.id
  returning * into s;
  perform public.add_refund_line(p.id, 'staff', s.amount_cents, p.stripe_payment_intent_id, s.id, s.note);

  if s.reset_payment then
    -- All of a held payment back to the brand: as a full refund, the step
    -- waits for the brand's payment again.
    perform public.record_payment_refunded(p.id, p.stripe_payment_intent_id,
              format('%s was refunded to your card. Note from our team: %s', public.format_money(s.amount_cents, p.currency), s.note),
              'staff_refund');
    return s;
  end if;

  was_share := p.factory_refund_cents;
  was_debt := coalesce(public.payment_debt_cents(p), 0);
  update public.order_payments
     set refunded_cents = refunded_cents + s.amount_cents, refund_amount_at = now(),
         -- After approval the factory keeps its part; only what staff took
         -- (taken_back_cents, at the claim) leaves its balance.
         review_kept_cents = review_kept_cents + case when approved then s.amount_cents else 0 end
   where id = p.id
  returning * into p;
  insert into public.payment_events (payment_id, stripe_ref, from_state, to_state, actor_kind, actor_user_id, note)
  values (p.id, stripe_refund, p.state, p.state, 'admin', s.created_by,
          format('Refunded %s to the brand from the admin board: the factory''s balance %s, TSC %s. %s',
                 public.format_money(s.amount_cents, p.currency), public.format_money(s.factory_cents, p.currency),
                 public.format_money(s.amount_cents - s.factory_cents, p.currency), s.note));

  insert into public.notifications (org_id, kind, subject_type, subject_id, order_id, title, body, dedupe_key)
  values (o.brand_org_id, 'payment_refunded', 'payment', p.id, o.id,
          format('Your payment for "%s" was refunded', step),
          format('%s was refunded to your card. Note from our team: %s', public.format_money(s.amount_cents, p.currency), s.note),
          'staff_refund:' || s.id || case when recovering then ':recovered' else '' end)
  on conflict (org_id, dedupe_key) do nothing;

  if approved then
    if s.factory_cents > 0 then
      insert into public.notifications (org_id, kind, subject_type, subject_id, order_id, title, body, data, dedupe_key)
      values (o.factory_org_id, 'payment_refunded', 'payment', p.id, o.id,
              format('Refund for "%s"', step),
              -- T2 A4: what left its balance, in the review's words.
              format('%s was taken from your balance for the brand''s refund of "%s" on %s. Note from our team: %s',
                     public.format_money(s.factory_cents, p.currency), step, o.order_number, s.note),
              jsonb_build_object('staff_refund_id', s.id, 'returned_cents', s.factory_cents),
              'staff_refund:' || s.id || case when recovering then ':recovered' else '' end)
      on conflict (org_id, dedupe_key) do nothing;
    end if;
  else
    -- Held, not approved: the step stays funded with the rest, and the
    -- factory's earning for it goes down, as after a partial refund.
    perform public.tell_earnings_down(p, o, format('Payment for "%s" refunded', step),
                                      format('The brand was refunded %s.', public.format_money(s.amount_cents, p.currency)), was_share, was_debt);
  end if;
  return s;
end;
$$;
revoke all on function public.record_staff_refund(uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_staff_refund(uuid, text, text) to service_role;

-- The server: Stripe refused the refund (never made: nothing changes but
-- the factory's part given back), or failed it later (made: undone, both
-- sides told). A full refund of a held payment that failed later is the
-- usual record_full_refund_failed's (reset_payment: the server goes there).
create or replace function public.record_staff_refund_failed(target_refund uuid, reason text)
returns public.staff_refunds
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.staff_refunds;
  o public.production_orders;
  p public.order_payments;
  m public.order_milestones;
  was_status text;
  approved boolean;
  given bigint;
  was_share bigint;
  step text;
begin
  select * into s from public.staff_refunds where id = target_refund;
  if not found then
    return null;
  end if;
  select * into o from public.production_orders where id = s.order_id for update;
  perform 1 from public.orgs where id = o.factory_org_id for no key update;
  select * into p from public.order_payments where id = s.payment_id for update;
  select * into s from public.staff_refunds where id = target_refund for update;
  if s.status = 'failed' then
    return s;
  end if;
  was_status := s.status;
  given := public.give_back_staff_refund_takes(s);
  -- It did not go through: no line for it on the brand's Payments.
  delete from public.payment_refund_lines where staff_refund_id = s.id;
  update public.staff_refunds
     set status = 'failed', failed_at = now(), updated_at = now(),
         failure = coalesce(nullif(btrim(coalesce(reason, '')), ''), failure, 'The refund failed.'),
         stripe_status = case when was_status = 'made' then 'failed' else stripe_status end
   where id = s.id
  returning * into s;
  if was_status <> 'made' or s.reset_payment then
    return s;
  end if;

  -- Made, then failed: undo exactly what recording added (the row says),
  -- and tell both sides.
  select * into p from public.order_payments where id = s.payment_id;
  approved := s.approved_at_claim;
  was_share := p.factory_refund_cents;
  update public.order_payments
     set refunded_cents = greatest(0, refunded_cents - s.amount_cents), refund_amount_at = now(),
         review_kept_cents = greatest(0, review_kept_cents - s.kept_cents)
   where id = p.id
  returning * into p;
  select * into m from public.order_milestones where id = p.milestone_id;
  step := coalesce(m.title, o.order_number);
  insert into public.payment_events (payment_id, stripe_ref, from_state, to_state, actor_kind, note)
  values (p.id, s.stripe_refund_id, p.state, p.state, 'system',
          format('The refund of %s to the brand failed in Stripe.', public.format_money(s.amount_cents, p.currency)));
  insert into public.notifications (org_id, kind, subject_type, subject_id, order_id, title, body, dedupe_key)
  values (o.brand_org_id, 'payment_refunded', 'payment', p.id, o.id,
          format('Refund for "%s" didn''t go through', step),
          format('Your %s refund didn''t go through. That amount stays on this order.', public.format_money(s.amount_cents, p.currency)),
          'staff_refund_failed:' || s.id)
  on conflict (org_id, dedupe_key) do nothing;
  if given > 0 or p.factory_refund_cents < was_share then
    insert into public.notifications (org_id, kind, subject_type, subject_id, order_id, title, body, dedupe_key)
    values (o.factory_org_id, 'payment_refunded', 'payment', p.id, o.id,
            format('Refund for "%s" didn''t go through', step),
            format('The refund to the brand didn''t go through. Your earnings from %s went back up by %s.', o.order_number,
                   public.format_money(greatest(given, was_share - p.factory_refund_cents), p.currency)),
            'staff_refund_failed:' || s.id)
    on conflict (org_id, dedupe_key) do nothing;
  end if;
  return s;
end;
$$;
revoke all on function public.record_staff_refund_failed(uuid, text) from public, anon, authenticated;
grant execute on function public.record_staff_refund_failed(uuid, text) to service_role;

-- Claims Stripe couldn't be asked about, for the daily job to finish.
create or replace function public.staff_refunds_unsettled()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select id from public.staff_refunds where status = 'claimed' and claimed_at < now() - interval '5 minutes'
   order by claimed_at limit 25;
$$;
revoke all on function public.staff_refunds_unsettled() from public, anon, authenticated;
grant execute on function public.staff_refunds_unsettled() to service_role;

-- ---------------------------------------------------------------------------
-- 9. Recreated from their latest bodies (named in each), with the v2 states.
-- ---------------------------------------------------------------------------

-- Which review each refund made in Stripe's dashboard belongs to, so a
-- refund that fails gives back only its own review's takes (20261125100000).
create table if not exists public.payment_review_refunds (
  stripe_refund_id text primary key,
  review_id        uuid not null references public.payment_reviews(id) on delete cascade,
  payment_id       uuid not null references public.order_payments(id) on delete cascade,
  amount_cents     bigint not null check (amount_cents >= 0),
  created_at       timestamptz not null default now()
);
alter table public.payment_review_refunds enable row level security;
revoke all on table public.payment_review_refunds from public, anon, authenticated;
grant all on table public.payment_review_refunds to service_role;

-- The server, after recording a charge's refunds: each dashboard refund not
-- noted yet belongs to the payment's newest refund review.
create or replace function public.note_review_refunds(target_payment uuid, refunds jsonb)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  v uuid;
  noted int := 0;
  approved_at timestamptz;
begin
  -- Only refunds made after approval belong to a review: one made before was
  -- the brand's own money back, and never opened one (20261125100000).
  select release_requested_at into approved_at from public.order_payments where id = target_payment;
  if approved_at is null then
    return 0;
  end if;
  select id into v from public.payment_reviews
   where payment_id = target_payment and cause = 'refund'
   order by (state = 'decide') desc, created_at desc limit 1;
  if v is null then
    return 0;
  end if;
  for r in select e->>'id' as id, (e->>'amount')::bigint as amount, to_timestamp((e->>'created')::double precision) as created
             from jsonb_array_elements(coalesce(refunds, '[]'::jsonb)) e loop
    continue when r.id is null or r.created is null or r.created < approved_at;
    insert into public.payment_review_refunds (stripe_refund_id, review_id, payment_id, amount_cents)
    values (r.id, v, target_payment, greatest(coalesce(r.amount, 0), 0))
    on conflict (stripe_refund_id) do nothing;
    noted := noted + 1;
  end loop;
  return noted;
end;
$$;
revoke all on function public.note_review_refunds(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.note_review_refunds(uuid, jsonb) to service_role;

-- record_payment_refund_failed (20261124100100), v2 (20261125100000): a refund
-- made in Stripe's dashboard that failed gives back only what belongs to it.
-- The failed amount is matched to the refund reviews newest first (the one
-- staff haven't decided yet, then decided ones); on a review where the factory
-- paid, only the factory's part of that amount comes back, from its newest
-- takes, and that review reopens for staff.
drop function if exists public.record_payment_refund_failed(uuid, text, bigint);
CREATE OR REPLACE FUNCTION public.record_payment_refund_failed(target_payment uuid, payment_intent text, refunded_cents bigint,
                                                               failed_refund text DEFAULT NULL::text)
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
  failed_left bigint;
  amt_here bigint;
  back_here bigint;
  kept_takes jsonb;
  charged bigint;
  reopened boolean := false;
  own_review uuid;
begin
  if nullif(btrim(coalesce(payment_intent, '')), '') is null then
    raise exception 'a refund names the PaymentIntent it refunded' using errcode = '22023';
  end if;
  select x.review_id into own_review from public.payment_review_refunds x where x.stripe_refund_id = failed_refund;
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
  charged := coalesce(p.charged_cents, p.amount_received_cents, p.amount_cents);
  update public.order_payments
     set refunded_cents = total, refund_amount_at = now(),
         -- The failed part was kept by the factory first (20261124100000).
         review_kept_cents = greatest(0, review_kept_cents - (was_total - total))
   where id = p.id
  returning * into p;

  failed_left := was_total - total;
  -- What did not go through leaves the brand's Payments too.
  perform public.take_back_refund_lines(p.id, array['stripe_dashboard', 'automatic'], was_total - total, payment_intent);
  for v in select * from public.payment_reviews
            where payment_id = p.id and cause = 'refund' and state in ('decide', 'factory_at_fault', 'brand_at_fault', 'no_fault')
              -- The failed refund's own review when it is known; else newest first.
              and (own_review is null or id = own_review)
            order by (state = 'decide') desc, coalesce(decided_at, created_at) desc
              for update loop
    exit when failed_left <= 0;
    amt_here := least(v.amount_cents, failed_left);
    continue when amt_here <= 0;
    failed_left := failed_left - amt_here;
    if v.state <> 'factory_at_fault' then
      -- Nothing left with the brand: the review closes, the factory resumes.
      update public.payment_reviews
         set amount_cents = amount_cents - amt_here, updated_at = now(),
             state = case when amount_cents - amt_here <= 0 then 'refund_failed' else state end,
             refund_failed_at = case when amount_cents - amt_here <= 0 then now() else refund_failed_at end,
             closed_at = case when amount_cents - amt_here <= 0 then now() else closed_at end
       where id = v.id;
      continue;
    end if;
    -- The factory paid on this review: only its part of the failed amount
    -- comes back, from its newest takes.
    back_here := least(v.returned_cents,
                       coalesce(round(amt_here::numeric * p.amount_cents / nullif(charged, 0))::bigint, 0));
    left_back := back_here;
    kept_takes := '[]'::jsonb;
    for t in select (e->>'payment_id')::uuid as payment_id, (e->>'cents')::bigint as cents, n
               from jsonb_array_elements(case when jsonb_array_length(v.takes) > 0 then v.takes
                                              else jsonb_build_array(jsonb_build_object('payment_id', v.payment_id, 'cents', v.returned_cents)) end)
                    with ordinality as x(e, n)
              order by n desc loop
      back := 0;
      if left_back > 0 then
        select least(x.taken_back_cents, t.cents, left_back) into back
          from public.order_payments x where x.id = t.payment_id for update;
        back := coalesce(back, 0);
        if back > 0 then
          update public.order_payments x set taken_back_cents = x.taken_back_cents - back where x.id = t.payment_id;
          insert into public.payment_events (payment_id, from_state, to_state, actor_kind, note)
          select x.id, x.state, x.state, 'system',
                 format('The refund to the brand failed: %s given back to the factory''s balance (payment review).', public.format_money(back, 'USD'))
            from public.order_payments x where x.id = t.payment_id;
          left_back := left_back - back;
        end if;
      end if;
      if t.cents - back > 0 then
        kept_takes := jsonb_build_array(jsonb_build_object('payment_id', t.payment_id, 'cents', t.cents - back)) || kept_takes;
      end if;
    end loop;
    given_back := given_back + (back_here - left_back);
    -- All of it failed: nothing left with the brand. The review closes, and
    -- what it took goes back (below, with what it still kept).
    if v.amount_cents - amt_here <= 0 then
      update public.payment_reviews
         set amount_cents = 0, refund_failed_at = now(), refund_failed_cents = refund_failed_cents + (back_here - left_back),
             returned_cents = 0, takes = '[]'::jsonb, state = 'refund_failed', closed_at = now(), updated_at = now()
       where id = v.id;
      for t in select (e->>'payment_id')::uuid as payment_id, (e->>'cents')::bigint as cents from jsonb_array_elements(kept_takes) e loop
        select least(x.taken_back_cents, t.cents) into back from public.order_payments x where x.id = t.payment_id for update;
        continue when coalesce(back, 0) <= 0;
        update public.order_payments x set taken_back_cents = x.taken_back_cents - back where x.id = t.payment_id;
        given_back := given_back + back;
      end loop;
    -- Reopened for staff, unless another refund review is already waiting.
    elsif not exists (select 1 from public.payment_reviews x where x.payment_id = p.id and x.cause = 'refund'
                     and x.state = 'decide' and x.id <> v.id) then
      update public.payment_reviews
         set amount_cents = amount_cents - amt_here,
             refund_failed_at = now(), refund_failed_cents = refund_failed_cents + (back_here - left_back),
             returned_cents = 0, takes = '[]'::jsonb,
             decision = null, decided_at = null, decided_by = null, closed_at = null, state = 'decide',
             updated_at = now()
       where id = v.id;
      -- What it had taken and still keeps goes back too: staff decide again
      -- on what still went back.
      for t in select (e->>'payment_id')::uuid as payment_id, (e->>'cents')::bigint as cents from jsonb_array_elements(kept_takes) e loop
        select least(x.taken_back_cents, t.cents) into back from public.order_payments x where x.id = t.payment_id for update;
        continue when coalesce(back, 0) <= 0;
        update public.order_payments x set taken_back_cents = x.taken_back_cents - back where x.id = t.payment_id;
        given_back := given_back + back;
      end loop;
      reopened := true;
    else
      update public.payment_reviews
         set amount_cents = amount_cents - amt_here,
             refund_failed_at = now(), refund_failed_cents = refund_failed_cents + (back_here - left_back),
             returned_cents = returned_cents - (back_here - left_back), takes = kept_takes, updated_at = now()
       where id = v.id;
    end if;
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
revoke all on function public.record_payment_refund_failed(uuid, text, bigint, text) from public, anon, authenticated;
grant execute on function public.record_payment_refund_failed(uuid, text, bigint, text) to service_role;

-- accept_cancellation (20261124100000): a paused brand may accept the factory's proposal.
CREATE OR REPLACE FUNCTION public.accept_cancellation(target_order uuid)
 RETURNS production_orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  -- A paused brand may accept the factory's cancellation (20261125100000).
  if mine = o.cancel_proposed_by_org then
    raise exception 'the other side has to accept, not the side that proposed it'
      using errcode = '42501';
  end if;

  perform public.close_order(o.id, o.cancel_reason);
  select * into o from public.production_orders where id = target_order;
  return o;
end;
$function$;

-- run_daily_notifications (20261024000301): no reminders to a paused brand.
CREATE OR REPLACE FUNCTION public.run_daily_notifications()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  capacity_count integer;
  due_count      integer;
begin
  with factories as (
    select p.org_id,
           (c.org_id is null
            and not exists (select 1 from public.factory_capacity_months m where m.org_id = p.org_id)) as never_set,
           greatest(
             coalesce(c.updated_at, p.created_at),
             coalesce((select max(m.updated_at) from public.factory_capacity_months m where m.org_id = p.org_id),
                      '-infinity'::timestamptz)
           ) as last_change
      from public.factory_profiles p
      left join public.factory_capacity c on c.org_id = p.org_id
     where p.verification_status = 'verified'
       and p.vendor_kind = 'manufacturer'
       and p.published_at is not null
  ), due as (
    select org_id, never_set, last_change,
           floor(extract(epoch from now() - last_change) / 86400)::integer as days
      from factories
     where last_change <= now() - interval '30 days'
  ), claimed as (
    insert into public.notification_reminders (kind, subject_id, due_key, org_id)
    select 'capacity_reminder', org_id,
           to_char(last_change at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') || ':' || (days / 30),
           org_id
      from due
    on conflict do nothing
    returning org_id
  )
  insert into public.notifications (org_id, kind, subject_type, subject_id, title, body)
  select due.org_id, 'capacity_reminder', 'capacity', due.org_id,
         case when due.never_set then 'Set your open capacity' else 'Is your capacity still right?' end,
         case when due.never_set
              then 'You haven''t set your open capacity yet. Brands see it when they choose who to invite, so add it from your dashboard.'
              else format('You last updated your open capacity %s days ago. Brands see it when they choose who to invite, so update it from your dashboard.', due.days)
         end
    from claimed
    join due on due.org_id = claimed.org_id;
  get diagnostics capacity_count = row_count;

  with steps as (
    select m.id, m.title, m.due_on, o.id as order_id, o.order_number,
           o.brand_org_id, o.factory_org_id, p.id as payment_id,
           (m.due_on - current_date) as days_left,
           public.milestone_waiting_on(m.state, p.state) as turn
      from public.order_milestones m
      join public.production_orders o on o.id = m.order_id
      left join public.order_payments p on p.milestone_id = m.id
     where o.status = 'active'
       and m.state in ('active', 'submitted')
       and m.due_on between current_date and current_date + 3
  ), keyed as (
    select steps.*,
           case when turn = 'factory' then factory_org_id else brand_org_id end as reader,
           (case when days_left >= 2 then '3d' else '1d' end) || ':' || due_on::text
             || case when turn = 'brand_payment' then ':fund' else '' end as due_key
      from steps
     where turn is not null
       -- No reminders to a paused brand for steps it can't act on (20261125100000).
       and not (turn <> 'factory' and public.brand_paused(brand_org_id))
  ), claimed as (
    insert into public.notification_reminders (kind, subject_id, due_key, org_id)
    select 'milestone_due_soon', id, due_key, reader from keyed
    on conflict do nothing
    returning subject_id, due_key
  )
  insert into public.notifications (org_id, kind, subject_type, subject_id, order_id, title, body, data)
  select k.reader, 'milestone_due_soon',
         case when k.turn = 'brand_payment' then 'payment' else 'milestone' end,
         case when k.turn = 'brand_payment' then k.payment_id else k.id end,
         k.order_id,
         format('"%s" is due %s', k.title,
                case k.days_left when 0 then 'today' when 1 then 'tomorrow' else format('in %s days', k.days_left) end),
         case k.turn
              when 'factory' then format('This production step on %s is due %s and needs an update.',
                                         k.order_number, to_char(k.due_on, 'FMMon FMDD'))
              when 'brand_payment' then format('This step on %s is waiting for your payment. It is due %s.',
                                               k.order_number, to_char(k.due_on, 'FMMon FMDD'))
              else format('This step on %s is waiting for your approval. It is due %s.',
                          k.order_number, to_char(k.due_on, 'FMMon FMDD'))
         end,
         jsonb_build_object('due_on', k.due_on)
    from keyed k
    join claimed c on c.subject_id = k.id and c.due_key = k.due_key;
  get diagnostics due_count = row_count;

  return jsonb_build_object('capacity_reminders', capacity_count, 'due_soon', due_count);
end;
$function$;

-- The daily job's read of a claim Stripe couldn't be asked about: the same
-- claim and key as staff's Check again, for the server alone.
create or replace function public.staff_refund_for_server(target_refund uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.staff_refund_claim(s, p)
    from public.staff_refunds s join public.order_payments p on p.id = s.payment_id
   where s.id = target_refund;
$$;
revoke all on function public.staff_refund_for_server(uuid) from public, anon, authenticated;
grant execute on function public.staff_refund_for_server(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 10. A paused brand can't pay again, so nobody is told it was asked to
--     (20261125100000). Recreated from their latest bodies.
-- ---------------------------------------------------------------------------

-- record_payment_dispute_lost (20261124100100).
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
            case when next_state = 'failed' and public.brand_paused(o.brand_org_id)
                 then format('TSC no longer holds money for this step on %s.', o.order_number)
                 when next_state = 'failed'
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

-- record_payment_refunded (20261121410000).
CREATE OR REPLACE FUNCTION public.record_payment_refunded(target_payment uuid, payment_intent text, reason text, cause text DEFAULT NULL::text)
 RETURNS order_payments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  refunded_now bigint;
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
  -- The factory's balance, before the payment: the order withdrawals lock in.
  perform 1 from public.orgs where id = o.factory_org_id for no key update;
  select * into p from public.order_payments where id = target_payment for update;
  if not found then
    return null;
  end if;
  was := p.state;

  -- Already recorded: the webhook after our own refund, or the page's sync.
  if was = 'cancelled' and p.refunded_at is not null and p.stripe_payment_intent_id = payment_intent then
    return p;
  end if;

  if p.stripe_payment_intent_id is distinct from payment_intent then
    if not exists (
      select 1 from public.payment_events
       where payment_id = p.id and stripe_ref = record_payment_refunded.payment_intent
    ) then
      insert into public.payment_events (payment_id, stripe_ref, from_state, to_state, actor_kind, note)
      values (p.id, record_payment_refunded.payment_intent, was, was, 'system', 'A payment that was not this step''s own was refunded: ' || why || ref);
    end if;
    return p;
  end if;

  -- After approval (paid out the old way, approved, or a funded payment-only
  -- step): the factory's already. The step stays done; the whole charge is
  -- recorded as refunded and only the factory's earning for it goes down.
  if was = 'released' or (was = 'confirmed' and p.release_requested_at is not null) then
    return public.record_payment_refund_amount(p.id, payment_intent, coalesce(p.charged_cents, p.amount_received_cents, p.amount_cents));
  end if;

  -- A refunded payment is not a failed one (T1 #2): the step asks the brand
  -- to fund it again (Due), with no failure reason.
  next_state := case
    when o.status = 'cancelled' then 'cancelled'::public.payment_state
    when was = 'not_due' then 'not_due'::public.payment_state
    else 'due'::public.payment_state
  end;
  refunded_now := greatest(coalesce(p.charged_cents, p.amount_received_cents, p.amount_cents, 0) - p.refunded_cents - p.dispute_lost_cents, 0);
  p := public.reset_refunded_payment(p.id, next_state, why);
  -- Its line on the brand's Payments (a staff refund writes its own).
  if coalesce(cause, '') <> 'staff_refund' then
    perform public.add_refund_line(p.id,
      case when cause in ('cancelled_order', 'order_cancelled') or next_state = 'cancelled' then 'cancellation'
           when cause = 'stripe_refund' then 'stripe_dashboard' else 'automatic' end,
      refunded_now, payment_intent);
  end if;

  -- Why, as a code: 'stripe_refund' for a refund made in Stripe (which
  -- record_full_refund_failed may fund again if it fails), else TSC's own
  -- reason. Never read back from the note.
  insert into public.payment_events (payment_id, stripe_ref, from_state, to_state, actor_kind, note, cause)
  values (p.id, record_payment_refunded.payment_intent, was, next_state, 'system', why || ref, record_payment_refunded.cause);

  select * into m from public.order_milestones where id = p.milestone_id;

  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  values (
    o.brand_org_id, 'payment_refunded', 'payment', p.id, o.id,
    format('Your payment for "%s" was refunded', m.title),
    case next_state
      when 'due' then why || case when public.brand_paused(o.brand_org_id) then ''
                                   else format(' Pay again from the step''s payment page on %s.', o.order_number) end
      when 'cancelled' then format('%s was cancelled. You were refunded.', o.order_number)
      else format('%s You will be asked to pay when the step opens on %s.', why, o.order_number)
    end
  );

  if was in ('confirmed', 'processing') and next_state = 'due' then
    insert into public.notifications
      (org_id, kind, subject_type, subject_id, order_id, title, body)
    values (
      o.factory_org_id, 'payment_refunded', 'payment', p.id, o.id,
      format('The payment for "%s" was refunded', m.title),
      case when public.brand_paused(o.brand_org_id)
           then format('TSC no longer holds money for this step on %s.', o.order_number)
           else format('TSC no longer holds money for this step on %s. The brand has been asked to pay again; we will tell you when it is held.',
                       o.order_number) end
    );
  elsif was = 'confirmed' and next_state = 'cancelled' then
    -- The factory was told this money was held for it.
    insert into public.notifications
      (org_id, kind, subject_type, subject_id, order_id, title, body)
    values (
      o.factory_org_id, 'payment_refunded', 'payment', p.id, o.id,
      format('The payment for "%s" went back to the brand', m.title),
      format('%s was cancelled.', o.order_number)
    );
  end if;

  return p;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 11. Review fixes (20261125100000, money and security reviews).
-- ---------------------------------------------------------------------------
-- No step is approved, nor its payout asked for, while staff are refunding
-- its payment: the refund was claimed for a held step and is recorded as one.
create or replace function public.guard_refund_in_progress()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.release_requested_at is not null and old.release_requested_at is null
     and exists (select 1 from public.staff_refunds s where s.payment_id = new.id and s.status = 'claimed') then
    raise exception 'A refund is in progress for this step.' using errcode = '22023', hint = 'staff_refund_in_progress';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_refund_in_progress() from public, anon, authenticated;
drop trigger if exists order_payments_refund_in_progress on public.order_payments;
create trigger order_payments_refund_in_progress before update of release_requested_at on public.order_payments
  for each row execute function public.guard_refund_in_progress();

-- What a paused brand funded on a payment-only step is held, not paid out,
-- until the brand is unpaused; then it goes to the factory's balance.
create or replace function public.release_held_while_paused(target_brand uuid)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  released int := 0;
begin
  if public.brand_paused(target_brand) then
    return 0;
  end if;
  for r in select p.id as payment_id, o.id as order_id, m.id as milestone_id, m.title, o.order_number, o.factory_org_id,
                  p.amount_cents, p.currency
             from public.order_payments p
             join public.production_orders o on o.id = p.order_id
             join public.order_milestones m on m.id = p.milestone_id
            where o.brand_org_id = target_brand and o.status = 'active'
              and p.state = 'confirmed' and p.release_requested_at is null and p.disputed_at is null
              and m.kind = 'payment_only' and m.state in ('active', 'approved')
              and not exists (select 1 from public.staff_refunds s where s.payment_id = p.id and s.status = 'claimed')
            order by o.id, m.sort
              for update of p loop
    update public.order_payments set release_requested_at = now() where id = r.payment_id;
    update public.order_milestones set state = 'complete', completed_at = now() where id = r.milestone_id and state in ('active', 'approved');
    perform public.advance_order_chain(r.order_id);
    insert into public.notifications (org_id, kind, subject_type, subject_id, order_id, title, body, dedupe_key)
    values (r.factory_org_id, 'payment_confirmed', 'payment', r.payment_id, r.order_id,
            format('%s added to your balance', public.format_money(r.amount_cents, r.currency)),
            format('%s added to your balance for "%s" on %s.', public.format_money(r.amount_cents, r.currency), r.title, r.order_number),
            'paused_release:' || r.payment_id)
    on conflict (org_id, dedupe_key) do nothing;
    released := released + 1;
  end loop;
  return released;
end;
$$;
revoke all on function public.release_held_while_paused(uuid) from public, anon, authenticated;
grant execute on function public.release_held_while_paused(uuid) to service_role;

-- record_payment_funded (latest): a paused brand's payment-only step is held.
CREATE OR REPLACE FUNCTION public.record_payment_funded(target_payment uuid, charge text, method_type text, method_label text, received bigint)
 RETURNS order_payments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  held_for_review boolean;
  p public.order_payments;
  o public.production_orders;
  m public.order_milestones;
  was public.payment_state;
  pays_out boolean := false;
  brand_name text;
  project_name text;
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

  -- A paused brand's money is recorded but not paid out: that waits until it
  -- is unpaused (release_held_while_paused, 20261125100000).
  held_for_review := public.brand_paused(o.brand_org_id);
  pays_out := o.status = 'active'
    and (m.kind = 'payment_only' or m.state = 'approved')
    and not held_for_review;

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
    select nullif(btrim(name), '') into brand_name from public.orgs where id = o.brand_org_id;
    select nullif(btrim(title), '') into project_name from public.rfqs where id = o.rfq_id;
    brand_name := coalesce(brand_name, 'The brand');
    project_name := coalesce(project_name, o.order_number);

    -- A charge disputed before it was recorded (the same second): a payment
    -- review is open (20261124100000), so the step is never "added to your
    -- balance"; said in the review's words, never "on hold" or who disputed.
    -- A chargeback (not an inquiry, which is staff's only) (T1 #3).
    if public.payment_has_chargeback(p.id) then
      -- Once per dispute, in the dispute's words (T2 R2, C1).
      perform public.tell_factory_disputed(v)
         from public.payment_reviews v
        where v.payment_id = p.id and v.cause = 'dispute' and v.state in ('open', 'decide', 'closed');
    else
    insert into public.notifications
      (org_id, kind, subject_type, subject_id, order_id, title, body)
    values (
      o.factory_org_id, 'payment_confirmed', 'payment', p.id, o.id,
      -- Owed at once (a payment-only step): the approved words as the title,
      -- which is what the bell shows; held until approval otherwise.
      case when pays_out then format('%s added to your balance', public.format_money(p.amount_cents, p.currency))
           else format('Payment held for "%s"', m.title) end,
      case when pays_out
        then format('%s added to your balance for "%s" on %s.%s',
                    public.format_money(p.amount_cents, p.currency), m.title, o.order_number,
                    case when public.factory_has_no_saved_method(o.factory_org_id)
                         then ' Add a withdrawal method to receive earnings.' else '' end)
        when held_for_review and m.kind = 'payment_only'
        then format('%s funded %s for %s on %s. It is added to your balance when our team finishes a payment review.',
                    brand_name, public.format_money(p.amount_cents, p.currency), m.title, project_name)
        else format('%s funded %s for %s on %s. It will become available when %s approves this step.',
                    brand_name, public.format_money(p.amount_cents, p.currency), m.title,
                    project_name, brand_name)
      end
    );
    end if;

    -- No "funded" to a brand whose charge is already disputed (T1 #4).
    if not public.payment_has_chargeback(p.id) then
    insert into public.notifications
      (org_id, kind, subject_type, subject_id, order_id, title, body)
    values (
      o.brand_org_id, 'payment_confirmed', 'payment', p.id, o.id,
      format('Your payment for "%s" is funded', m.title),
      case when pays_out
        then format('%s received on %s. We add %s to the factory''s balance.',
                    public.format_money(p.charged_cents, p.currency), o.order_number,
                    public.format_money(p.amount_cents, p.currency))
        when held_for_review and m.kind = 'payment_only'
        then format('%s received on %s.', public.format_money(coalesce(p.charged_cents, p.amount_cents), p.currency), o.order_number)
        else format('%s received on %s. It becomes available to the factory when you approve this step.',
                    public.format_money(coalesce(p.charged_cents, p.amount_cents), p.currency), o.order_number)
      end
    );
    end if;
  end if;

  return p;
end;
$function$;

-- record_full_refund_failed (20261121410000): a staff refund too.
CREATE OR REPLACE FUNCTION public.record_full_refund_failed(target_payment uuid, payment_intent text, charge text, charged bigint, refunded_now bigint, failed_cents bigint, lost_cents bigint, fee_cents bigint)
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
  why text;
  r public.payment_refund_failures;
  ref text := format(' (Stripe %s)', payment_intent);
begin
  if nullif(btrim(coalesce(payment_intent, '')), '') is null or charged is null or charged <= 0
     or failed_cents is null or failed_cents <= 0 then
    raise exception 'a failed refund names its PaymentIntent, its charge and its amount' using errcode = '22023';
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
  select * into m from public.order_milestones where id = p.milestone_id;

  if was = 'cancelled' and p.stripe_payment_intent_id = payment_intent and p.refunded_at is not null then
    why := 'cancelled';
  elsif not exists (select 1 from public.payment_events e where e.payment_id = p.id and e.stripe_ref = record_full_refund_failed.payment_intent) then
    -- Nothing recorded about this charge on this payment.
    return p;
  elsif not exists (select 1 from public.payment_events e where e.payment_id = p.id and e.from_state in ('confirmed', 'processing')
                      and e.to_state in ('failed', 'due') and e.cause in ('stripe_refund', 'staff_refund') and e.stripe_ref = record_full_refund_failed.payment_intent) then
    -- Not a payment sent back to pay by a refund made in Stripe: TSC's own
    -- refund of an extra payment (the amount changed, the step was paid
    -- another way, …). Its amount is not the step's, so it is never funded
    -- again with it: staff refund it again (20261121260000).
    why := 'stray';
  elsif p.stripe_payment_intent_id = payment_intent then
    -- Funded again with it already.
    return p;
  elsif was in ('due', 'failed') and o.status <> 'cancelled' then
    update public.order_payments
       set state = 'confirmed', confirmed_at = now(), confirmed_by = null,
           stripe_payment_intent_id = payment_intent, stripe_charge_id = charge,
           charged_cents = charged, amount_received_cents = charged,
           -- What Stripe still counts on this charge, recorded as it is, quietly:
           -- each was told when it happened.
           refunded_cents = least(greatest(coalesce(refunded_now, 0), 0), charged),
           refund_amount_at = case when coalesce(refunded_now, 0) > 0 then now() end,
           dispute_lost_cents = least(greatest(coalesce(lost_cents, 0), 0), charged),
           dispute_lost_at = case when coalesce(lost_cents, 0) > 0 then now() end,
           dispute_fee_cents = case when coalesce(lost_cents, 0) > 0 then fee_cents end,
           failure_reason = null, refunded_at = null
     where id = p.id
    returning * into p;
    -- The refund did not go through: its line leaves the brand's Payments (T1 #5).
    perform public.take_back_refund_lines(p.id, array['stripe_dashboard', 'automatic', 'cancellation'], failed_cents, payment_intent);
    insert into public.payment_events (payment_id, stripe_ref, from_state, to_state, actor_kind, note)
    values (p.id, record_full_refund_failed.payment_intent, was, 'confirmed', 'system',
            format('A %s refund failed in Stripe: TSC holds the payment again.', public.format_money(failed_cents, p.currency)) || ref);
    insert into public.notifications (org_id, kind, subject_type, subject_id, order_id, title, body)
    values (o.brand_org_id, 'payment_refunded', 'payment', p.id, o.id,
            format('Refund for "%s" didn''t go through', coalesce(m.title, o.order_number)),
            format('Your %s refund didn''t go through, so TSC still holds your payment for this step. You don''t need to pay again.',
                   public.format_money(failed_cents, p.currency)));
    insert into public.notifications (org_id, kind, subject_type, subject_id, order_id, title, body)
    values (o.factory_org_id, 'payment_confirmed', 'payment', p.id, o.id,
            format('Payment held for "%s"', coalesce(m.title, o.order_number)),
            format('TSC holds %s for this step on %s. You can start this work; it is added to your balance when the brand approves it.',
                   public.format_money(public.payment_factory_cents(p), p.currency), o.order_number));
    return p;
  else
    why := case when o.status = 'cancelled' then 'cancelled' else 'paid_again' end;
  end if;

  -- For staff: open, or open again after a resolved one.
  select * into r from public.payment_refund_failures x where x.payment_intent = record_full_refund_failed.payment_intent for update;
  if found and r.resolved_at is null then
    return p;
  end if;
  if found then
    update public.payment_refund_failures
       set resolved_at = null, amount_cents = failed_cents, cause = why, failed_at = now(), charge_id = coalesce(charge, charge_id)
     where id = r.id;
  else
    insert into public.payment_refund_failures (payment_id, payment_intent, charge_id, amount_cents, currency, cause)
    values (p.id, payment_intent, charge, failed_cents, p.currency, why);
  end if;
  perform public.take_back_refund_lines(p.id, array['stripe_dashboard', 'automatic', 'cancellation'], failed_cents, payment_intent);
  insert into public.payment_events (payment_id, stripe_ref, from_state, to_state, actor_kind, note)
  values (p.id, record_full_refund_failed.payment_intent, was, was, 'system',
          format('A %s refund failed in Stripe: %s', public.format_money(failed_cents, p.currency),
                 case when why = 'cancelled' then 'refund the brand again.'
                      when why = 'stray' then 'an extra payment, refund it again.'
                      else 'the brand paid again, refund the first payment.' end) || ref);
  -- The brand was told it was refunded; on a cancelled order nothing else
  -- tells it otherwise.
  if why = 'cancelled' then
    insert into public.notifications (org_id, kind, subject_type, subject_id, order_id, title, body)
    values (o.brand_org_id, 'payment_refunded', 'payment', p.id, o.id,
            format('Refund for "%s" didn''t go through', coalesce(m.title, o.order_number)),
            format('Your %s refund didn''t go through. TSC will send it again.', public.format_money(failed_cents, p.currency)));
  end if;
  return p;
end;
$function$;

-- mark_payment_sent (latest): refused for a paused brand.
CREATE OR REPLACE FUNCTION public.mark_payment_sent(target_payment uuid, reference text DEFAULT NULL::text, note text DEFAULT NULL::text)
 RETURNS order_payments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  p public.order_payments;
  o public.production_orders;
begin
  select * into p from public.order_payments where id = target_payment for update;
  if not found then
    raise exception 'payment not found' using errcode = 'P0002';
  end if;

  select * into o from public.production_orders where id = p.order_id;

  -- Owner, not member: this is a statement that money left the company.
  perform public.require_org_permission(o.brand_org_id, 'releaseFunds');
  if not public.is_org_member(o.brand_org_id) then
    raise exception 'only the brand on this order records a payment as sent' using errcode = '42501';
  end if;

  perform public.refuse_paused_brand(o.brand_org_id, 'fund steps');

  if o.status <> 'active' then
    raise exception 'this order is %', o.status using errcode = '22023';
  end if;

  if p.state <> 'due' then
    raise exception 'that payment is %, not due', p.state using errcode = '22023';
  end if;

  update public.order_payments
     set state = 'sent', sent_by = auth.uid(), sent_at = now(),
         brand_reference = nullif(btrim(coalesce(reference, '')), ''),
         sent_note = nullif(btrim(coalesce(note, '')), '')
   where id = p.id
  returning * into p;

  insert into public.payment_events (payment_id, from_state, to_state, actor_user_id, actor_kind)
  values (p.id, 'due', 'sent', auth.uid(), 'brand');

  -- The factory is told, and told carefully. "Sent" is the brand's claim, not
  -- an arrival, and nothing here may imply work can start.
  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  values (
    o.factory_org_id, 'payment_sent', 'payment', p.id, o.id,
    format('%s says a payment is on its way', (select name from public.orgs where id = o.brand_org_id)),
    format('%s on %s. We will confirm here once it lands — please do not start on this yet.',
           public.format_money(p.amount_cents, p.currency), o.order_number)
  );

  return p;
end;
$function$;

-- reveal_payout_account_number (20261117350000): says which step or withdrawal it is for.
drop function if exists public.reveal_payout_account_number(uuid);
CREATE OR REPLACE FUNCTION public.reveal_payout_account_number(target_account uuid, for_payment uuid DEFAULT NULL::uuid, for_withdrawal uuid DEFAULT NULL::uuid)
 RETURNS TABLE(account_number text, number_kind text, changed_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  a public.factory_payout_accounts;
  kind text;
begin
  if not public.is_platform_admin() then
    raise exception 'this is limited to platform staff' using errcode = '42501';
  end if;

  select * into a from public.factory_payout_accounts x where x.id = target_account;
  if not found then
    raise exception 'that account does not exist' using errcode = 'P0002';
  end if;

  if public.is_org_member(a.org_id) then
    raise exception 'you belong to this company, so someone else on the staff must pay it'
      using errcode = '42501', hint = 'payout_own_company';
  end if;
  if exists (
    select 1 from public.production_orders o
     where o.factory_org_id = a.org_id and public.is_org_member(o.brand_org_id)
  ) then
    raise exception 'your company has an order with this factory, so someone else on the staff must pay it'
      using errcode = '42501', hint = 'reveal_brand_side';
  end if;
  -- New: a withdrawal waiting on, or being paid by, staff to this account is owed too, whichever
  -- of the company's accounts it is (as payout_wise_recipient, 20261116200000).
  if exists (select 1 from public.factory_withdrawals w where w.account_id = a.id and w.status in ('requested', 'paying')) then
    null;
  elsif not a.is_primary or not exists (
    select 1
      from public.order_payments p
      join public.production_orders o on o.id = p.order_id
      left join public.stripe_connect_accounts s on s.org_id = o.factory_org_id
     where o.factory_org_id = a.org_id
       and p.state = 'confirmed'
       and p.release_requested_at is not null
       and not (public.uses_stripe_payout(o.factory_org_id) and p.stripe_payment_intent_id is not null)
  ) then
    raise exception 'TSC does not owe this company a payout by hand, so its number stays hidden'
      using errcode = '22023', hint = 'reveal_not_owed';
  end if;

  -- What it is for must be this company's (20261125100000).
  if for_payment is not null and not exists (
       select 1 from public.order_payments p join public.production_orders o on o.id = p.order_id
        where p.id = for_payment and o.factory_org_id = a.org_id) then
    raise exception 'that payment is not this company''s' using errcode = '22023', hint = 'reveal_wrong_payout';
  end if;
  if for_withdrawal is not null and not exists (
       select 1 from public.factory_withdrawals w where w.id = for_withdrawal and w.org_id = a.org_id) then
    raise exception 'that withdrawal is not this company''s' using errcode = '22023', hint = 'reveal_wrong_payout';
  end if;

  select n.number_kind into kind from public.payout_account_numbers n where n.account_id = a.id;
  if kind is null then
    raise exception 'no full account number is on file'
      using errcode = '22023', hint = 'no_number';
  end if;

  insert into public.payout_number_reveals
    (account_id, org_id, org_name, bank_name, last4, staff_user_id, staff_email, payment_id, factory_withdrawal_id)
  select a.id, a.org_id, o.name, a.bank_name, a.account_number_last4, auth.uid(),
         (select u.email from auth.users u where u.id = auth.uid()), for_payment, for_withdrawal
    from public.orgs o where o.id = a.org_id;

  return query select public.payout_number_plain(a.id), kind, a.details_changed_at;
end;
$function$;
revoke all on function public.reveal_payout_account_number(uuid, uuid, uuid) from public, anon;
grant execute on function public.reveal_payout_account_number(uuid, uuid, uuid) to authenticated, service_role;


-- The server cancelled a paused brand's open PaymentIntent: the payment lets
-- go of it, so the brand starts a new one once it is unpaused.
create or replace function public.forget_cancelled_intent(target_payment uuid, payment_intent text)
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
  with done as (
    update public.order_payments set stripe_payment_intent_id = null, updated_at = now()
     where id = target_payment and stripe_payment_intent_id = payment_intent and state in ('due', 'failed')
    returning 1)
  select exists (select 1 from done);
$$;
revoke all on function public.forget_cancelled_intent(uuid, text) from public, anon, authenticated;
grant execute on function public.forget_cancelled_intent(uuid, text) to service_role;

-- A paused brand's payments that may still have an open PaymentIntent.
create or replace function public.paused_brand_open_intents(target_brand uuid)
returns table (payment_id uuid, payment_intent text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id, p.stripe_payment_intent_id
    from public.order_payments p join public.production_orders o on o.id = p.order_id
   where o.brand_org_id = target_brand and p.state in ('due', 'failed') and p.stripe_payment_intent_id is not null
     and public.brand_paused(target_brand);
$$;
revoke all on function public.paused_brand_open_intents(uuid) from public, anon, authenticated;
grant execute on function public.paused_brand_open_intents(uuid) to service_role;

-- The server, before it asks Stripe for a claim's refund (after a list found
-- none made): the try holds a two-minute lease. While another try's lease is
-- running the answer is busy (nothing is sent; Check again later). A retry
-- after a lease ran out gets a new claim time, so a new idempotency key
-- (Stripe replays a stored error for its key) (20261125100000).
create or replace function public.staff_refund_attempt(target_refund uuid, renew boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.staff_refunds;
  p public.order_payments;
begin
  select * into s from public.staff_refunds where id = target_refund for update;
  if not found then
    return null;
  end if;
  select * into p from public.order_payments where id = s.payment_id;
  if s.status <> 'claimed' then
    return public.staff_refund_claim(s, p);
  end if;
  if s.attempt_at is not null and s.attempt_at > clock_timestamp() - interval '2 minutes' then
    return public.staff_refund_claim(s, p) || jsonb_build_object('busy', true);
  end if;
  update public.staff_refunds
     set claimed_at = case when renew and s.attempt_at is not null then clock_timestamp() else claimed_at end,
         attempt_at = clock_timestamp(), updated_at = now()
   where id = s.id
  returning * into s;
  return public.staff_refund_claim(s, p);
end;
$$;
revoke all on function public.staff_refund_attempt(uuid, boolean) from public, anon, authenticated;
grant execute on function public.staff_refund_attempt(uuid, boolean) to service_role;

-- What the server checks a Stripe refund naming a staff refund against.
create or replace function public.staff_refund_matches(target_refund uuid, payment_intent text, amount_cents bigint)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.staff_refunds s
                  where s.id = target_refund and s.payment_intent = staff_refund_matches.payment_intent
                    and s.amount_cents = staff_refund_matches.amount_cents);
$$;
revoke all on function public.staff_refund_matches(uuid, text, bigint) from public, anon, authenticated;
grant execute on function public.staff_refund_matches(uuid, text, bigint) to service_role;

-- admin_overview_metrics (20261124100000): counts a failed staff refund too (T1 #1).
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
         where public.payment_review_needs_staff(v))
     -- A staff refund that failed after it was made (20261125100000, T1 #1).
     + (select count(*)::integer from public.staff_refunds s where public.staff_refund_needs_staff(s))
     + jsonb_array_length(attention -> 'returned')
     + jsonb_array_length(attention -> 'refund_failed'),
    (select count(*)::integer from public.admin_verification_queue() q
      where q.submitted_at >= date_trunc('day', now()));
end;
$function$;

-- ---------------------------------------------------------------------------
-- 13. Tester fixes, second part (20261125100000, T1).
-- ---------------------------------------------------------------------------
-- An inquiry holds nothing a brand or factory reads (only a chargeback sets
-- disputed_at): any set by an inquiry alone is cleared.
update public.order_payments p
   set disputed_at = null
 where p.disputed_at is not null
   and exists (select 1 from public.payment_reviews v where v.payment_id = p.id and v.cause = 'dispute' and v.state = 'inquiry')
   and not exists (select 1 from public.payment_reviews v where v.payment_id = p.id and v.cause = 'dispute'
                     and v.state not in ('inquiry', 'inquiry_closed'));

-- record_payment_refund_amount (20261124100000): its line on the brand's Payments.
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

  -- Its line on the brand's Payments (T1 #5).
  if total > was_total then
    perform public.add_refund_line(p.id, 'stripe_dashboard', total - was_total, record_payment_refund_amount.payment_intent);
  end if;

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

-- record_cancellation_refund_failed (latest): its line goes.
CREATE OR REPLACE FUNCTION public.record_cancellation_refund_failed(target_payment uuid, reason text)
 RETURNS order_payments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  p public.order_payments;
  was public.payment_state;
  why text := coalesce(nullif(btrim(coalesce(reason, '')), ''), 'The refund to the brand did not go through.');
begin
  select * into p from public.order_payments where id = target_payment for update;
  if not found then
    return null;
  end if;
  was := p.state;

  -- Already recorded (refund.failed and charge.refund.updated both say it).
  if was = 'confirmed' and p.refund_failed_at is not null and p.refund_claimed_at is null
     and (select n.failure from public.payment_refund_staff_notes n where n.payment_id = p.id) is not distinct from why then
    return p;
  end if;

  -- A refund that Stripe later says failed puts the money back as held.
  if was = 'cancelled' and p.refunded_at is not null and p.stripe_payment_intent_id is not null then
    update public.order_payments
       set state = 'confirmed', refunded_at = null
     where id = p.id;
    -- It did not go through: no line for it on the brand's Payments (T1 #5).
    perform public.take_back_refund_lines(p.id, array['cancellation'], coalesce(p.charged_cents, p.amount_cents), p.stripe_payment_intent_id);
  elsif was <> 'confirmed' then
    return p;
  end if;

  update public.order_payments
     set refund_claimed_at = null,
         refund_failed_at = now()
   where id = p.id
  returning * into p;

  insert into public.payment_events (payment_id, from_state, to_state, actor_kind, note)
  values (p.id, was, p.state, 'system', 'Refund to the brand failed.');
  insert into public.payment_refund_staff_notes (payment_id, failure) values (p.id, why)
  on conflict (payment_id) do update set failure = excluded.failure, updated_at = now();
  return p;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 14. Old rows read like new ones (20261125100000, after T1).
-- ---------------------------------------------------------------------------
-- Payments recorded before this migration: (a) their refunds become lines on
-- the brand's Payments, (b) a payment a refund left as 'failed' reads Due,
-- with no failure reason. A lost dispute stays failed ("Reversed by your
-- bank"), and so does a declined card. A refund note always ends in
-- "(Stripe pi_…)"; a card's failure never does. Safe to run again.
create or replace function public.backfill_old_refunds()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  refund_note constant text := '\(Stripe (pi_[A-Za-z0-9_]+)\)$';
begin
  -- (a1) Refunds still on the payment (partial, after approval, made in
  -- Stripe): the part no line covers yet.
  insert into public.payment_refund_lines (payment_id, order_id, brand_org_id, kind, amount_cents, currency, payment_intent, refunded_at)
  select p.id, o.id, o.brand_org_id, 'stripe_dashboard', p.refunded_cents - coalesce(l.cents, 0), p.currency,
         p.stripe_payment_intent_id, coalesce(p.refund_amount_at, p.refunded_at, p.updated_at)
    from public.order_payments p
    join public.production_orders o on o.id = p.order_id
    left join lateral (select sum(x.amount_cents) cents from public.payment_refund_lines x
                        where x.payment_id = p.id and x.kind <> 'cancellation'
                          and x.payment_intent is not distinct from p.stripe_payment_intent_id) l on true
   where p.refunded_cents > coalesce(l.cents, 0);

  -- (a2) A cancelled order's payment refunded in full: the rest of the charge.
  insert into public.payment_refund_lines (payment_id, order_id, brand_org_id, kind, amount_cents, currency, payment_intent, refunded_at)
  select p.id, o.id, o.brand_org_id, 'cancellation',
         coalesce(p.charged_cents, p.amount_received_cents, p.amount_cents) - p.refunded_cents - p.dispute_lost_cents - coalesce(l.cents, 0),
         p.currency, p.stripe_payment_intent_id, p.refunded_at
    from public.order_payments p
    join public.production_orders o on o.id = p.order_id
    left join lateral (select sum(x.amount_cents) cents from public.payment_refund_lines x
                        where x.payment_id = p.id and x.kind = 'cancellation'
                          and x.payment_intent is not distinct from p.stripe_payment_intent_id) l on true
   where p.state = 'cancelled' and p.refunded_at is not null and p.stripe_payment_intent_id is not null
     and coalesce(p.charged_cents, p.amount_received_cents, p.amount_cents) - p.refunded_cents - p.dispute_lost_cents - coalesce(l.cents, 0) > 0;

  -- (a3) A full refund that sent the payment back to pay: the payment no
  -- longer names that charge, so its event does. The charge is the step's
  -- (its amount and fee are fixed). Not a staff refund (it has its line),
  -- not one that failed and funded the step again.
  insert into public.payment_refund_lines (payment_id, order_id, brand_org_id, kind, amount_cents, currency, payment_intent, refunded_at)
  select p.id, o.id, o.brand_org_id,
         case when e.cause in ('cancelled_order', 'order_cancelled') or e.to_state = 'cancelled' then 'cancellation'
              when e.cause = 'stripe_refund' then 'stripe_dashboard' else 'automatic' end,
         public.charge_cents(p), p.currency, e.intent, e.created_at
    from (select ev.*, coalesce(ev.stripe_ref, substring(ev.note from refund_note)) intent
            from public.payment_events ev
           where ev.note ~ refund_note and ev.from_state is distinct from ev.to_state
             and ev.to_state in ('failed', 'due', 'not_due')
             and coalesce(ev.cause, '') not in ('dispute_lost', 'staff_refund')
             and ev.note not like 'Dispute lost%') e
    join public.order_payments p on p.id = e.payment_id
    join public.production_orders o on o.id = p.order_id
   where p.stripe_payment_intent_id is distinct from e.intent
     and public.charge_cents(p) > 0
     and not exists (select 1 from public.payment_refund_lines x where x.payment_id = p.id and x.payment_intent = e.intent)
     and not exists (select 1 from public.payment_events later
                      where later.payment_id = p.id and later.to_state = 'confirmed'
                        and later.stripe_ref = e.intent and later.created_at > e.created_at);

  -- (b) A payment a refund left as 'failed': Due, as a refund leaves it now.
  -- Its last change of state says why it failed.
  with last_change as (
    select distinct on (ev.payment_id) ev.payment_id, ev.to_state, ev.note, ev.cause
      from public.payment_events ev
     where ev.from_state is distinct from ev.to_state
     order by ev.payment_id, ev.created_at desc, ev.id desc
  ), moved as (
    update public.order_payments p
       set state = 'due', failure_reason = null, failed_at = null
      from last_change e
     where e.payment_id = p.id and p.state = 'failed' and e.to_state = 'failed'
       and e.note ~ refund_note and coalesce(e.cause, '') <> 'dispute_lost' and e.note not like 'Dispute lost%'
    returning p.id
  )
  insert into public.payment_events (payment_id, from_state, to_state, actor_kind, note)
  select id, 'failed', 'due', 'system', 'A refunded payment is due again, not failed.' from moved;
end;
$$;
revoke all on function public.backfill_old_refunds() from public, anon, authenticated;

select public.backfill_old_refunds();

-- ---------------------------------------------------------------------------
-- 15. Tester fixes, round 2 (20261125100000).
-- ---------------------------------------------------------------------------
-- #2b. A payment a refund sent back to pay no longer names its charge; the
-- refund ledger still does. What was charged then: the lines of the last
-- refunded charge, while the payment has not been charged again.
create or replace function public.payment_reset_charge_cents(p public.order_payments)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with last_line as (
    select l.payment_intent from public.payment_refund_lines l
     where l.payment_id = p.id and l.payment_intent is not null
     order by l.refunded_at desc limit 1
  )
  select sum(l.amount_cents)::bigint
    from public.payment_refund_lines l, last_line
   where p.state in ('due', 'failed', 'not_due', 'processing') and p.refunded_at is not null and p.charged_cents is null
     and l.payment_id = p.id and l.payment_intent = last_line.payment_intent
     and last_line.payment_intent is distinct from p.stripe_payment_intent_id;
$$;
revoke all on function public.payment_reset_charge_cents(public.order_payments) from public, anon, authenticated;
grant execute on function public.payment_reset_charge_cents(public.order_payments) to service_role;

-- Charged, as staff read it: the charge, else the one refunded, else the step's.
create or replace function public.payment_charged_display_cents(p public.order_payments)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(p.charged_cents, p.amount_received_cents, public.payment_reset_charge_cents(p), p.amount_cents);
$$;
revoke all on function public.payment_charged_display_cents(public.order_payments) from public, anon, authenticated;
grant execute on function public.payment_charged_display_cents(public.order_payments) to service_role;

-- Refunded, as staff read it, from the ledger: a payment sent back to pay
-- shows the refund of its last charge; a cancelled order's, its cancellation.
create or replace function public.payment_refunded_display_cents(p public.order_payments)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when public.payment_reset_charge_cents(p) is not null then public.payment_reset_charge_cents(p)
    when p.state = 'cancelled' and p.refunded_at is not null then
      p.refunded_cents + p.dispute_lost_cents + p.manual_refunded_cents
      + coalesce((select sum(l.amount_cents) from public.payment_refund_lines l
                   where l.payment_id = p.id and l.kind = 'cancellation'
                     and l.payment_intent is not distinct from p.stripe_payment_intent_id), 0)
    else p.refunded_cents + p.dispute_lost_cents + p.manual_refunded_cents
  end::bigint;
$$;
revoke all on function public.payment_refunded_display_cents(public.order_payments) from public, anon, authenticated;
grant execute on function public.payment_refunded_display_cents(public.order_payments) to service_role;

-- #4b. A step not approved whose charge the bank is deciding: its own figure,
-- Disputed (disputed_cents and rows with figure 'disputed'), not Awaiting
-- approval. In Total. factory_balance (20261124100000) with that change.
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
  -- Held for a step not approved, its charge disputed (Round 2 #4b).
  disputed_held bigint := 0;
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
    elsif (r.p).release_requested_at is null and (r.p).disputed_at is not null then
      -- A chargeback the bank is deciding: Disputed, not Awaiting approval.
      disputed_held := disputed_held + r.factory_cents;
      out_rows := out_rows || jsonb_build_array(jsonb_build_object('payment_id', (r.p).id, 'figure', 'disputed',
        'amount_cents', r.factory_cents, 'stripe', false, 'held', true, 'held_reason', 'disputed'));
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
    -- Held for steps not approved whose charge the bank is deciding: in Total,
    -- in no other figure.
    'disputed_cents', disputed_held,
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
    'total_cents', awaiting + disputed_held + available + pending + processing + paid_out,
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

-- ---------------------------------------------------------------------------
-- 16. Tester fixes, T2 (20261125100000). Notices (Y1, A3, A4, B6, R2), the
--     board's flags (A5, A10) and Stripe's dispute reason (A6), Close with
--     an amount (R3) are in place above. Here: the order page's figures add
--     up after money went back (B2).
-- ---------------------------------------------------------------------------
-- production_order_charges (20261023000300) with what went back on funded
-- payments, at the brand's charged figures: refunded (by Stripe, or by staff
-- another way) and reversed by the brand's bank. Total = paid − returned −
-- reversed + those two + outstanding, so the header can show each.
create or replace view public.production_order_charges
with (security_invoker = true) as
select
  o.id                                   as order_id,
  coalesce(tot.total, 0)::bigint         as total_charged_cents,
  coalesce(tot.paid, 0)::bigint          as paid_charged_cents,
  (coalesce(tot.total, 0) - coalesce(tot.paid, 0))::bigint as outstanding_charged_cents,
  nx.charged_cents                       as next_payment_charged_cents,
  nx.fee_cents                           as next_payment_fee_cents,
  coalesce(back.refunded, 0)::bigint     as refunded_charged_cents,
  coalesce(back.reversed, 0)::bigint     as reversed_charged_cents
from public.production_orders o
left join lateral (
  select
    sum(c.charged_cents) as total,
    sum(c.charged_cents) filter (where c.state in ('confirmed', 'released')) as paid
  from public.order_step_charges c
  where c.order_id = o.id
) tot on true
left join lateral (
  select c.charged_cents, c.fee_cents
  from public.order_step_charges c
  where c.order_id = o.id and c.state in ('not_due', 'due', 'sent', 'processing', 'failed')
  order by c.sort
  limit 1
) nx on true
left join lateral (
  select sum(p.refunded_cents + p.manual_refunded_cents) as refunded, sum(p.dispute_lost_cents) as reversed
  from public.order_payments p
  where p.order_id = o.id and p.state in ('confirmed', 'released')
) back on true;
revoke all on public.production_order_charges from anon, authenticated;
grant select on public.production_order_charges to authenticated;
