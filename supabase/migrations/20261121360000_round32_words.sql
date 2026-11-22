-- One balance, fix round 32: one phrase for money going back to the brand.
--
-- The factory's notices say "returned to the brand", as the card, the order
-- page and the failed-withdrawal note do (Chinese unchanged: 已退回品牌):
--   withdrawal paid after part of it went back:
--     "You now owe TSC $X, the part that went back to the brand after it was sent."
--     -> "You now owe TSC $X, the part returned to the brand after it was sent."
--   withdrawal being sent, part of it went back:
--     "$X of it went back to the brand after it was sent. TSC is checking this withdrawal."
--     -> "$X of it was returned to the brand after it was sent. TSC is checking this withdrawal."
--
-- Full latest bodies (20261121350000) plus the change; CREATE OR REPLACE keeps
-- each grant; no overloads.

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
              then format(' You now owe TSC %s, the part returned to the brand after it was sent.', public.format_money(gone, w.currency))
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
