-- ============================================================================
-- Removing a withdrawal method; the payment-only funded notice's title
-- ----------------------------------------------------------------------------
-- 1. guard_payout_account_delete(): an account is kept only while money is
--    being sent to it now (a waiting or paying withdrawal to it, or a payout
--    per step to it under way), for any account, not only the default.
--    Approved money in the factory's balance is not on its way to any account
--    until the factory withdraws, so it no longer stops the last method being
--    removed. The default-account rule and the manual-route cleanup are as
--    before.
-- 2. record_payment_funded(): a payment-only step's factory notice is titled
--    with the approved words (" added to your balance"), which the bell
--    shows; "Payment held for …" stays for a step held until approval.
-- Safe with the live site while applied: replaced functions, same signatures.
-- ============================================================================

create or replace function public.guard_payout_account_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  owed_cents bigint;
  owed_currency text;
begin
  if coalesce(auth.role(), '') <> 'authenticated' then
    return old;
  end if;

  -- Money being sent to this account now: a PayPal / Wise / bank withdrawal
  -- to it that is waiting or being paid, or a payout per step to it under
  -- way. Removing it would leave that payment with nowhere to go. (Owed money
  -- in the factory's balance is not on its way anywhere until it withdraws.)
  select sum(x.amount), min(x.currency)
    into owed_cents, owed_currency
    from (select w.amount_cents as amount, w.currency::text as currency from public.factory_withdrawals w
           where w.account_id = old.id and w.status in ('requested', 'paying')
          union all
          select x.amount_cents, x.currency::text from public.provider_payouts x
           where x.account_id = old.id and x.status = 'processing') x;
  if coalesce(owed_cents, 0) > 0 then
    raise exception 'TSC is about to pay this account, so it cannot be removed until that payment is sent'
      using errcode = 'P0001',
            hint = 'payout_owed',
            detail = owed_cents::text || ' ' || owed_currency;
  end if;

  if not old.is_primary then
    return old;
  end if;

  if exists (select 1 from public.factory_payout_accounts a
              where a.org_id = old.org_id and a.id <> old.id) then
    raise exception 'this is the account TSC pays: choose another account for TSC to pay before removing it'
      using errcode = 'P0001', hint = 'payout_primary';
  end if;

  if exists (select 1 from public.stripe_connect_accounts s
              where s.org_id = old.org_id and public.uses_stripe_payout(old.org_id)) then
    return old;
  end if;

  -- The last manual account is going, so "manual" would mean nobody pays.
  delete from public.factory_payout_preferences where org_id = old.org_id and route = 'manual';

  return old;
end;
$$;
revoke all on function public.guard_payout_account_delete() from public, anon, authenticated;

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
    -- A charge disputed before it was recorded (the same second): an owed
    -- step's money is on hold, never "added to your balance".
    if pays_out and p.disputed_at is not null then
      perform public.tell_payment_hold(p, true);
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
        then format('%s added to your balance.%s',
                    public.format_money(p.amount_cents, p.currency),
                    case when public.factory_has_no_saved_method(o.factory_org_id)
                         then ' Add a withdrawal method to receive earnings.' else '' end)
        else format('TSC holds %s for this step on %s. You can start this work; it is added to your balance when the brand approves it.',
                    public.format_money(p.amount_cents, p.currency), o.order_number)
      end
    );
    end if;

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
$function$;
