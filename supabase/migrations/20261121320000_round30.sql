-- One balance, fix round 30 (gap test of Nov 21 and money review r29).
--
-- * G1: a dispute recorded while a withdrawal still held the step (found by
--   the withdraw call itself) is told once the step's money is back in the
--   balance, at the true amount; and an "on hold" notice is written once per
--   dispute, whichever path records it first.
-- * G7: removing the default bank while another method takes over says the
--   bank was removed, as well as which method is the default now.
-- * L2: a Stripe withdrawal open for more than 15 minutes reaches the staff
--   board however often it is tried again (keyed on created_at, not on
--   updated_at, which every try bumps).
--
-- Full latest bodies plus the change; grants re-applied exactly; no overloads.

-- G1 --------------------------------------------------------------------------
-- 20261120270000's body; an "on hold" notice already written for this
-- dispute (since disputed_at) is not written again.
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
begin
  if p.state <> 'confirmed' or p.release_requested_at is null then
    return;
  end if;
  amount_cents := public.payment_factory_cents(p) - public.payment_taken_cents(p.id);
  if amount_cents <= 0 then
    return;
  end if;
  -- Once per dispute: the withdraw call and the webhook may both get here.
  if held and exists (
    select 1 from public.notifications n
     where n.subject_type = 'payment' and n.subject_id = p.id and n.kind = 'payment_disputed'
       and n.created_at >= coalesce(p.disputed_at, '-infinity'::timestamptz)
       and starts_with(n.body, 'The brand disputed the charge.')
  ) then
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
               else format('The dispute is settled. %s is no longer on hold.',
                           public.format_money(amount_cents, p.currency)) end);
end;
$function$;
revoke all on function public.tell_payment_hold(public.order_payments, boolean) from public, anon, authenticated;

-- A step's money back in the balance (a withdrawal's part returned) while the
-- brand's dispute is open: the hold is told now, if it was not told before
-- (the withdrawal still held the step when the dispute was recorded, so
-- there was nothing to hold then). Read at commit, so the payment's state
-- is the final one (return_sent_take moves it back to confirmed after).
create or replace function public.tell_hold_after_take_return()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare p public.order_payments;
begin
  select * into p from public.order_payments where id = new.payment_id;
  if found and p.disputed_at is not null and p.dispute_lost_at is null then
    perform public.tell_payment_hold(p, true);
  end if;
  return null;
end;
$$;
revoke all on function public.tell_hold_after_take_return() from public, anon, authenticated;
drop trigger if exists payment_takes_tell_hold on public.payment_takes;
create constraint trigger payment_takes_tell_hold
  after update of status on public.payment_takes
  deferrable initially deferred
  for each row
  when (old.status is distinct from 'returned' and new.status = 'returned')
  execute function public.tell_hold_after_take_return();

-- G7 --------------------------------------------------------------------------
-- 20261121310000's body.
create or replace function public.notify_default_bank_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  org uuid := coalesce(new.org_id, old.org_id);
  what text;
  named text;
begin
  if coalesce(auth.role(), '') <> 'authenticated' then
    return null;
  end if;
  if not exists (select 1 from public.orgs where id = org) then
    return null;
  end if;

  if tg_op <> 'DELETE' and new.method = 'bank' and new.is_primary
     and (tg_op = 'INSERT' or not old.is_primary or old.method <> 'bank') then
    -- It may have lost the default again before the transaction ended.
    if not exists (
      select 1 from public.factory_payout_accounts where id = new.id and is_primary
    ) then
      return null;
    end if;
    named := new.bank_name || case when new.account_number_last4 is not null
      then format(' ending %s', new.account_number_last4) else '' end;
    if exists (
      select 1 from public.notifications n
       where n.org_id = org and n.kind = 'payout_method_changed' and n.created_at = now()
         and starts_with(n.body, format('TSC now pays your bank account at %s, instead of Payoneer account', named))
    ) then
      return null;
    end if;
    -- New: while Stripe pays, this bank is only saved. (The route is read at
    -- commit, so choose_payout_method's own change counts.)
    what := case when public.uses_stripe_payout(org)
      then format('Your bank account at %s was saved.', named)
      else format('Your bank account at %s is now your default withdrawal method.', named) end;

  elsif tg_op = 'UPDATE' and new.method = 'bank' and new.is_primary and old.is_primary and old.method = 'bank'
        and (new.bank_name, new.account_name, new.account_number_last4, new.swift, new.branch,
             new.bank_country, new.instructions, new.number_changed_at,
             new.wise_details, new.wise_number_key, new.wise_currency, new.wise_recipient_type)
            is distinct from
            (old.bank_name, old.account_name, old.account_number_last4, old.swift, old.branch,
             old.bank_country, old.instructions, old.number_changed_at,
             old.wise_details, old.wise_number_key, old.wise_currency, old.wise_recipient_type) then
    named := new.bank_name || case when new.account_number_last4 is not null
      then format(' ending %s', new.account_number_last4) else '' end;
    what := case when public.uses_stripe_payout(org)
      then format('Your saved bank account changed: it is now %s, in the name of %s.', named, new.account_name)
      else format('Your bank account at %s is now your default withdrawal method.', named) end;

  -- New: a row that was another method and is now a bank, default or not.
  elsif tg_op = 'UPDATE' and new.method = 'bank' and old.method <> 'bank' then
    named := new.bank_name || case when new.account_number_last4 is not null
      then format(' ending %s', new.account_number_last4) else '' end;
    what := format('Your bank account at %s replaced a withdrawal method.', named);

  elsif old.method = 'bank' and old.is_primary
        and (tg_op = 'DELETE' or not new.is_primary or new.method <> 'bank')
        -- No default left, or the bank itself is gone (another method took
        -- over in the same change: that one's notice says which, this one
        -- says the bank went; 20261121320000).
        and (not exists (select 1 from public.factory_payout_accounts where org_id = org and is_primary)
             or not exists (select 1 from public.factory_payout_accounts where id = old.id)) then
    named := old.bank_name || case when old.account_number_last4 is not null
      then format(' ending %s', old.account_number_last4) else '' end;
    -- Removed only when the row is gone at commit; a bank that only stopped
    -- being the default is still saved (20261121310000).
    what := case when tg_op = 'UPDATE' and new.method = 'bank'
                   and exists (select 1 from public.factory_payout_accounts where id = old.id)
      then format('Your bank account at %s is no longer your default withdrawal method.', named)
      else format('Your bank account at %s was removed.', named) end;
  end if;

  if what is not null then
    insert into public.notifications (org_id, kind, title, body)
    values (org, 'payout_method_changed', 'Your payout methods changed',
      what || ' If nobody at your company made this change, email operations@contact.sourcing-club.com now.');
  end if;
  return null;
end;
$$;
revoke all on function public.notify_default_bank_change() from public, anon, authenticated;

-- L2 --------------------------------------------------------------------------
-- 20261121250000's body.
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
       where p.state = 'confirmed' and p.release_requested_at is not null and p.disputed_at is not null
         and not p.withdrawal_pool), '[]'::jsonb),
    -- Refunded to the brand (or a dispute lost) after the factory had
    -- withdrawn it: TSC paid that money twice. Staff cannot be notified, so
    -- this list is the only prompt. Where it went, and what the factory's
    -- balance is now (Available, net of what it owes).
    'recover', coalesce((
      select jsonb_agg(x.row order by x.at nulls last) from (
        select greatest(p.refund_amount_at, p.dispute_lost_at) as at, jsonb_build_object(
          'payment_id', p.id, 'org_id', o.factory_org_id, 'order_id', o.id, 'order_number', o.order_number,
          'factory_name', f.name, 'brand_name', b.name, 'milestone_title', m.title,
          'amount_cents', public.payment_debt_cents(p), 'currency', p.currency,
          'cause', case when p.dispute_lost_cents > 0 and p.refund_amount_at is null then 'dispute_lost'
                        when p.dispute_lost_cents > 0 and p.dispute_lost_at > p.refund_amount_at then 'dispute_lost'
                        else 'refund' end,
          'at', greatest(p.refund_amount_at, p.dispute_lost_at),
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
         where p.state in ('confirmed', 'released') and not p.withdrawal_pool and p.currency = 'USD'
           and p.factory_refund_cents > 0 and public.payment_debt_cents(p) > 0
        union all
        -- The old pool paid out beyond what its refunded payments now hold.
        select null, jsonb_build_object(
          'payment_id', null, 'org_id', f.id, 'order_id', null, 'order_number', null,
          'factory_name', f.name, 'brand_name', null, 'milestone_title', null,
          'amount_cents', d.pool_debt, 'currency', 'USD', 'cause', 'refund', 'at', null,
          'withdrawn_cents', null, 'withdrawn_by', '[]'::jsonb, 'dispute_fee_cents', null,
          'balance_cents', (public.factory_balance(f.id) ->> 'available_cents')::bigint,
          'stripe_payment_intent_id', null)
          from public.orgs f
          cross join lateral (select public.factory_debt_cents(f.id)
                                     - coalesce((select sum(public.payment_debt_cents(p)) from public.order_payments p
                                                   join public.production_orders o on o.id = p.order_id
                                                  where o.factory_org_id = f.id and not p.withdrawal_pool and p.currency = 'USD'
                                                    and p.state in ('confirmed', 'released') and p.factory_refund_cents > 0), 0) as pool_debt) d
         where f.type = 'factory' and exists (select 1 from public.factory_withdrawals w where w.org_id = f.id and w.status = 'paid')
           and d.pool_debt > 0
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
revoke all on function public.admin_balance_attention() from public, anon;
grant execute on function public.admin_balance_attention() to authenticated, service_role;
