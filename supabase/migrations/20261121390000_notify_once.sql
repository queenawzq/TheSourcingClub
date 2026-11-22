-- ============================================================================
-- Notify once, by a key
-- ----------------------------------------------------------------------------
-- Once-only notices and once-only payment events were found by their words
-- (a notice's title or body, an event's note): rewording one would have
-- repeated or lost them. Now:
--
-- 1. notifications.dedupe_key: what a notice is about, as a key
--      payment_hold:<payment>:<dispute started, µs>:<held cents>
--      withdrawal_on_hold:<withdrawal>
--      withdrawal_checked:<withdrawal>:<cents returned to the brand>
--      withdrawal_asked:<Stripe withdrawal>           (api/_stripe-withdrawals.js)
--      payout:<Stripe payout>:paid|failed              (api/_stripe-payout-events.js)
--    unique per company (NULLs are distinct, so every other notice is as
--    before); each writer inserts with ON CONFLICT DO NOTHING. "Told again
--    only for more" (a hold, money returned) compares the amount kept in
--    `data` among the notices with the same key prefix. Existing notices
--    get their key from the old matching rules, the earliest one per key.
--    A notice's key cannot be changed afterwards (as its words cannot).
-- 2. payment_events.stripe_ref: the Stripe PaymentIntent or dispute an event
--    is about, written by every recorder, and what "recorded already" is
--    asked by (never `note like '%(Stripe …)'`). Filled for existing events
--    from their note, which keeps its "(Stripe …)" ending for staff.
-- 3. tell_earnings_down(): the one writer of "Your earnings from X went down
--    by Y. You'd already withdrawn Z of that, so you now owe TSC Z.", for a
--    refund and for a lost dispute. Same words as before.
-- Latest full bodies; grants unchanged on replaced functions; the new one is
-- internal. Safe with the live site while applied: two nullable columns, an
-- index, and functions that write and read them; the live server's own
-- notices carry no key and are written as before.
-- ============================================================================

alter table public.notifications add column if not exists dedupe_key text;
comment on column public.notifications.dedupe_key is
  'What a once-only notice is about, as a key (20261121390000): unique per company; null for every other notice.';

with keyed as (
  select n.id, k.key,
         row_number() over (partition by n.org_id, k.key order by n.created_at, n.id) as rn
    from public.notifications n
    left join public.order_payments p on n.subject_type = 'payment' and p.id = n.subject_id
    cross join lateral (select case
      when n.kind = 'payment_disputed' and starts_with(n.body, 'The brand disputed the charge.') and n.data ? 'held_cents'
           and p.disputed_at is not null and n.created_at >= p.disputed_at
        then format('payment_hold:%s:%s:%s', p.id, (extract(epoch from p.disputed_at) * 1000000)::bigint, n.data ->> 'held_cents')
      when n.kind = 'withdrawal' and n.subject_type = 'withdrawal' and n.title like '% on hold'
        then 'withdrawal_on_hold:' || n.subject_id
      when n.kind = 'withdrawal' and n.subject_type = 'withdrawal' and n.title like '% being checked' and n.data ? 'gone_cents'
        then format('withdrawal_checked:%s:%s', n.subject_id, n.data ->> 'gone_cents')
      when n.kind = 'withdrawal' and n.subject_type = 'withdrawal'
           and exists (select 1 from public.stripe_withdrawals s where s.id = n.subject_id)
        then 'withdrawal_asked:' || n.subject_id
      when n.kind in ('funds_released', 'payout_method_changed') and n.data ? 'payout_id' and n.data ? 'payout'
        then format('payout:%s:%s', n.data ->> 'payout_id', n.data ->> 'payout')
      end as key) k
   where k.key is not null and n.dedupe_key is null
)
update public.notifications n set dedupe_key = keyed.key
  from keyed where keyed.id = n.id and keyed.rn = 1;

create unique index if not exists notifications_dedupe_key on public.notifications (org_id, dedupe_key);

-- A notice can only be marked read: its key is fixed with the rest.
create or replace function public.notifications_read_only_read_at()
returns trigger
language plpgsql
as $$
begin
  if new.org_id       is distinct from old.org_id
     or new.kind         is distinct from old.kind
     or new.subject_type is distinct from old.subject_type
     or new.subject_id   is distinct from old.subject_id
     or new.order_id     is distinct from old.order_id
     or new.title        is distinct from old.title
     or new.body         is distinct from old.body
     or new.created_at   is distinct from old.created_at
     or new.dedupe_key   is distinct from old.dedupe_key
  then
    raise exception 'a notification can only be marked read' using errcode = '22023';
  end if;
  return new;
end;
$$;

alter table public.payment_events add column if not exists stripe_ref text;
comment on column public.payment_events.stripe_ref is
  'The Stripe PaymentIntent or dispute this event is about (20261121390000): how a recorder asks whether it recorded it already.';
update public.payment_events
   set stripe_ref = substring(note from '\(Stripe ([^()[:space:]]+)\)$')
 where stripe_ref is null and note ~ '\(Stripe [^()[:space:]]+\)$';
create index if not exists payment_events_stripe_ref on public.payment_events (payment_id, stripe_ref) where stripe_ref is not null;

create or replace function public.tell_earnings_down(p public.order_payments, o public.production_orders, title text, lead text,
                                                     was_share bigint, was_debt bigint)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  now_debt bigint := coalesce(public.payment_debt_cents(p), 0);
begin
  -- Only when the factory's part went down: "Your earnings went down", and
  -- what of that had already left, now owed to TSC.
  if p.factory_refund_cents <= was_share then
    return;
  end if;
  insert into public.notifications (org_id, kind, subject_type, subject_id, order_id, title, body)
  values (o.factory_org_id, 'payment_refunded', 'payment', p.id, o.id, title,
          lead || format(' Your earnings from %s went down by %s.', o.order_number,
                         public.format_money(p.factory_refund_cents - was_share, p.currency))
          || case when now_debt > was_debt
                  then format(' You''d already withdrawn %s of that, so you now owe TSC %s.',
                              public.format_money(now_debt - was_debt, p.currency), public.format_money(now_debt - was_debt, p.currency))
                  else '' end);
end;
$$;
revoke all on function public.tell_earnings_down(public.order_payments, public.production_orders, text, text, bigint, bigint) from public, anon, authenticated;
grant execute on function public.tell_earnings_down(public.order_payments, public.production_orders, text, text, bigint, bigint) to service_role;

CREATE OR REPLACE FUNCTION public.tell_payment_hold(p order_payments, held boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  o public.production_orders;
  m public.order_milestones;
  amount_cents bigint;
  said text;
  -- This dispute's notices: one per held amount (dedupe_key).
  key text := format('payment_hold:%s:%s', p.id, coalesce((extract(epoch from p.disputed_at) * 1000000)::bigint, 0));
begin
  if p.state <> 'confirmed' or p.release_requested_at is null then
    return;
  end if;
  amount_cents := public.payment_factory_cents(p) - public.payment_taken_cents(p.id);
  if amount_cents <= 0 then
    return;
  end if;
  said := case when held
               then format('The brand disputed the charge. %s is held until the dispute is settled.',
                           public.format_money(amount_cents, p.currency))
               else format('The dispute is settled. %s is no longer on hold.',
                           public.format_money(amount_cents, p.currency)) end;
  select * into o from public.production_orders where id = p.order_id;
  -- Once per dispute and amount: the withdraw call and the webhook may both
  -- get here, and a withdrawal's part coming back makes more of it held.
  -- By its key, never its words (20261121390000).
  if held and exists (
    select 1 from public.notifications n
     where n.org_id = o.factory_org_id and starts_with(n.dedupe_key, key || ':')
       and (n.data ->> 'held_cents')::bigint >= amount_cents
  ) then
    return;
  end if;
  select * into m from public.order_milestones where id = p.milestone_id;
  insert into public.notifications (org_id, kind, subject_type, subject_id, order_id, title, body, data, dedupe_key)
  values (o.factory_org_id, 'payment_disputed', 'payment', p.id, o.id,
          case when held then format('Payment for "%s" on hold', coalesce(m.title, o.order_number))
               else format('Hold lifted on "%s"', coalesce(m.title, o.order_number)) end,
          said,
          case when held then jsonb_build_object('held_cents', amount_cents) else '{}'::jsonb end,
          case when held then key || ':' || amount_cents end)
  on conflict (org_id, dedupe_key) do nothing;
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
              -- By its key, never its words (20261121390000).
              and (f.status = 'paying'
                   or not exists (select 1 from public.notifications n
                                   where n.org_id = f.org_id
                                     and (n.dedupe_key = 'withdrawal_on_hold:' || f.id
                                          or starts_with(n.dedupe_key, 'withdrawal_checked:' || f.id || ':'))))
  loop
    -- Already sent to the provider: the factory cannot cancel it. Said as it
    -- is: part of it went back to the brand, and TSC is checking it (staff see
    -- the amount at risk on its row) (20261121280000).
    if w.status = 'paying' then
      -- All that went back so far, told whenever it grows (20261121290000).
      gone := coalesce((select sum(public.take_refunded_cents(t)) from public.payment_takes t
                         where t.factory_withdrawal_id = w.id and t.status = 'held'), 0)::bigint;
      if gone > 0 and not exists (select 1 from public.notifications n
                                   where n.org_id = w.org_id and starts_with(n.dedupe_key, 'withdrawal_checked:' || w.id || ':')
                                     and coalesce((n.data ->> 'gone_cents')::bigint, 0) >= gone) then
        insert into public.notifications (org_id, kind, subject_type, subject_id, title, body, data, dedupe_key)
        values (w.org_id, 'withdrawal', 'withdrawal', w.id,
                format('Withdrawal of %s being checked', public.format_money(w.amount_cents, w.currency)),
                format('%s of it was returned to the brand after it was sent. TSC is checking this withdrawal.', public.format_money(gone, w.currency)),
                jsonb_build_object('amount_cents', w.amount_cents, 'currency', w.currency, 'gone_cents', gone),
                'withdrawal_checked:' || w.id || ':' || gone)
        on conflict (org_id, dedupe_key) do nothing;
      end if;
      continue;
    end if;
    -- On hold only because of the debt (nothing it holds was refunded): it
    -- says what is owed, and never to withdraw again (20261121230000).
    owes := not exists (select 1 from public.payment_takes t
                         where t.factory_withdrawal_id = w.id and t.payment_id = new.id and t.status = 'held'
                           and (new.state <> 'confirmed' or public.take_refunded_cents(t) > 0));
    insert into public.notifications (org_id, kind, subject_type, subject_id, title, body, data, dedupe_key)
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
            jsonb_build_object('amount_cents', w.amount_cents, 'currency', w.currency),
            'withdrawal_on_hold:' || w.id)
    on conflict (org_id, dedupe_key) do nothing;
  end loop;
  return null;
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
     set dispute_lost_cents = lost, dispute_lost_at = now(), dispute_fee_cents = fee_cents, disputed_at = null
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

CREATE OR REPLACE FUNCTION public.record_payment_refunded(target_payment uuid, payment_intent text, reason text, cause text DEFAULT NULL::text)
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

  next_state := case
    when o.status = 'cancelled' then 'cancelled'::public.payment_state
    when was = 'not_due' then 'not_due'::public.payment_state
    else 'failed'::public.payment_state
  end;
  p := public.reset_refunded_payment(p.id, next_state, why);

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
      when 'failed' then format('%s Pay again from the step''s payment page on %s.', why, o.order_number)
      when 'cancelled' then format('%s was cancelled. You were refunded.', o.order_number)
      else format('%s You will be asked to pay when the step opens on %s.', why, o.order_number)
    end
  );

  if was in ('confirmed', 'processing') and next_state = 'failed' then
    insert into public.notifications
      (org_id, kind, subject_type, subject_id, order_id, title, body)
    values (
      o.factory_org_id, 'payment_refunded', 'payment', p.id, o.id,
      format('The payment for "%s" was refunded', m.title),
      format('TSC no longer holds money for this step on %s. The brand has been asked to pay again; we will tell you when it is held.',
             o.order_number)
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
     set refunded_cents = total, refund_amount_at = now()
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

  -- What the brand got back (fee part included), then the factory's part (20261121240000).
  perform public.tell_earnings_down(p, o, format('Payment for "%s" refunded', coalesce(m.title, o.order_number)),
                                    format('The brand was refunded %s.', public.format_money(total - was_total, p.currency)), was_share, was_debt);
  return p;
end;
$function$;

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
                      and e.to_state = 'failed' and e.cause = 'stripe_refund' and e.stripe_ref = record_full_refund_failed.payment_intent) then
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
     set refunded_cents = total, refund_amount_at = now()
   where id = p.id
  returning * into p;
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
       and e.stripe_ref = p.stripe_payment_intent_id
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
