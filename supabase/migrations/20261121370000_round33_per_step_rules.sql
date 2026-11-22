-- One balance, fix round 33: the per-step payout rules, on every per-step road.
--
-- 1. per_step_payout_check(): the step being paid never covers what the
--    factory owes TSC. It is refused while the debt is more than the
--    factory's OTHER earnings (owed_reachable less this step), as a
--    withdrawal is (request_withdrawal allows at most what is left net of the
--    debt). Used by claim_provider_payout and release_payment_to_factory.
-- 2. A partly refunded step tells staff whether the factory can withdraw the
--    rest now (payout_refunded) or only once it adds a withdrawal method
--    (payout_refunded_no_method: Payoneer, or a bank account Wise cannot pay).
-- 3. release_payment_by_payoneer() takes the company lock first and follows
--    the same rules.
-- 4. tell_withdrawal_refunded(): a debt with no lost dispute behind it (an old
--    pool step refunded in full after it was withdrawn, 20261121350000) reads
--    as a refund.
--
-- Full latest bodies plus the change; CREATE OR REPLACE keeps each grant;
-- no overloads.

create or replace function public.per_step_payout_check(p public.order_payments, factory uuid)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  other bigint;
begin
  -- Under the company lock its callers take, like claim_owed_steps().
  -- What the factory owes TSC must be covered by its OTHER earnings: this
  -- step is what would be sent, so it covers nothing (20261121370000).
  other := (public.owed_reachable(factory) ->> 'any_cents')::bigint
           - case when public.payment_claimable(p)
                  then greatest(public.payment_factory_cents(p) - public.payment_taken_cents(p.id), 0)
                  else 0 end;
  if public.factory_debt_cents(factory) > 0 and other < 0 then
    raise exception 'the factory owes TSC %', public.format_money(public.factory_debt_cents(factory), 'USD')
      using errcode = '22023', hint = 'payout_owes_tsc', detail = public.format_money(public.factory_debt_cents(factory), 'USD');
  end if;
  if p.disputed_at is not null then
    raise exception 'the brand disputed this payment' using errcode = '22023', hint = 'payout_disputed';
  end if;
  -- Part of it went back to the brand: the factory withdraws the rest from
  -- its balance (a per-step payout pays the whole step). A factory with no
  -- method it can withdraw to does so once it adds one: staff are told which.
  if p.factory_refund_cents > 0 then
    raise exception 'part of this payment was returned to the brand' using errcode = '22023',
      hint = case when public.factory_can_withdraw(factory) then 'payout_refunded' else 'payout_refunded_no_method' end;
  end if;
  if not public.payment_cleared(p) then
    raise exception 'the brand''s payment has not cleared yet' using errcode = '22023', hint = 'payout_not_cleared';
  end if;
end;
$$;
revoke all on function public.per_step_payout_check(public.order_payments, uuid) from public, anon, authenticated;

-- Latest body: 20261108710000.
CREATE OR REPLACE FUNCTION public.release_payment_by_payoneer(
  target_payment uuid,
  paid_to text,
  payoneer_payment_id text,
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
  current_email text;
  reference text := btrim(coalesce(payoneer_payment_id, ''));
begin
  if not public.is_platform_admin() then
    raise exception 'recording a payout is limited to platform staff' using errcode = '42501';
  end if;

  -- The company first, the lock withdrawals and refunds take (20261121370000).
  perform 1 from public.orgs where id = (
    select po.factory_org_id from public.order_payments op join public.production_orders po on po.id = op.order_id where op.id = target_payment
  ) for no key update;
  select * into p from public.order_payments where id = target_payment for update;
  if not found then
    raise exception 'payment not found' using errcode = 'P0002';
  end if;

  select * into o from public.production_orders where id = p.order_id;

  if public.is_org_member(o.factory_org_id) then
    raise exception 'you belong to this company, so someone else on the staff must record its payout'
      using errcode = '42501', hint = 'payout_own_company';
  end if;
  if exists (select 1 from public.provider_payouts x where x.payment_id = p.id and x.status = 'processing') then
    raise exception 'a Wise or PayPal payment is under way for this: cancel it first, or it could be paid twice'
      using errcode = '22023', hint = 'payout_in_progress';
  end if;
  if p.state = 'released' then
    raise exception 'that payout was already marked as paid'
      using errcode = '22023', hint = 'payout_already_released';
  end if;
  if p.state <> 'confirmed' then
    raise exception 'that payment is %; only a confirmed one can be released', p.state
      using errcode = '22023';
  end if;
  if p.stripe_charge_id is not null and p.release_requested_at is null then
    raise exception 'the brand has not approved this step yet: money paid through Stripe is paid out once the brand approves it'
      using errcode = '22023';
  end if;
  if p.stripe_payment_intent_id is not null and exists (
    select 1 from public.stripe_connect_accounts s
     where s.org_id = o.factory_org_id and public.uses_stripe_payout(o.factory_org_id)
  ) then
    raise exception 'Stripe pays this factory: retry the payout instead'
      using errcode = '22023', hint = 'payout_stripe';
  end if;
  -- New: a Stripe transfer may exist whatever the route says now.
  if p.release_claimed_at is not null or p.stripe_release_started then
    raise exception 'Stripe may already have paid this: press Retry payout, which checks with Stripe first'
      using errcode = '22023', hint = 'payout_stripe_started';
  end if;

  -- The rules every withdrawal follows, as the other per-step roads (20261121370000).
  perform public.per_step_payout_check(p, o.factory_org_id);

  select a.payoneer_email into current_email
    from public.factory_payout_accounts a
   where a.org_id = o.factory_org_id and a.is_primary and a.method = 'payoneer';
  if current_email is null or current_email <> lower(btrim(coalesce(paid_to, ''))) then
    raise exception 'this factory changed where it is paid'
      using errcode = '22023', hint = 'payout_changed';
  end if;

  if reference !~ '^[A-Za-z0-9._/-]{3,64}$' then
    raise exception 'the Payoneer payment ID is 3 to 64 letters, numbers or - _ . /'
      using errcode = '22023', hint = 'payoneer_id_format';
  end if;
  if exists (
    select 1 from public.payoneer_payouts x
     where lower(x.payoneer_payment_id) = lower(reference)
       and x.factory_org_id <> o.factory_org_id
  ) then
    raise exception 'that Payoneer payment ID is recorded for another factory'
      using errcode = '22023', hint = 'payoneer_id_used';
  end if;

  update public.order_payments
     set state = 'released', released_by = auth.uid(), released_at = now()
   where id = p.id
  returning * into p;

  insert into public.payoneer_payouts
    (payment_id, factory_org_id, paid_to_email, payoneer_payment_id, note, recorded_by)
  values
    (p.id, o.factory_org_id, current_email, reference, nullif(btrim(coalesce(note, '')), ''), auth.uid());

  insert into public.payment_events (payment_id, from_state, to_state, actor_user_id, actor_kind)
  values (p.id, 'confirmed', 'released', auth.uid(), 'admin');

  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  values (
    o.factory_org_id, 'funds_released', 'payment', p.id, o.id,
    format('%s released to you', public.format_money(p.amount_cents, p.currency)),
    format('Sent by Payoneer against %s. Payoneer payment ID %s.', o.order_number, reference)
  );

  return p;
end;
$$;

-- Latest body: 20261121360000.
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
