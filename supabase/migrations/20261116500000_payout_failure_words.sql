-- ============================================================================
-- Why a payout failed, said to the factory; Stripe's words that stay true
-- ----------------------------------------------------------------------------
-- 1. A Wise or PayPal payout that failed told the factory nothing unless staff
--    asked it to check a detail; its row said "TSC will try again" whatever
--    happened. The provider's code now travels to the factory's row
--    (`failure_detail`) and the bell says why, in one sentence per known code
--    (`payout_failure_sentence`, the same map as
--    src/shared/payout-failure-words.mjs; check:provider-payouts compares
--    them). Unknown codes get one plain sentence.
--
--    Written by a trigger on provider_payout_attempts, which
--    finish_provider_payout updates with the provider's code after it marks
--    the payout failed: nothing here redefines that function.
--
-- 2. A Stripe transfer reaches the factory's Stripe balance, not its bank:
--    record_payment_released said "paid out to you". It now says "added to
--    your balance"; the bank payout says "paid out to your bank" when it lands
--    (api/stripe-webhook.js). Same signature and grants, and the body as
--    20261116100000 left it (with the factory's payout fee sentence).
-- ============================================================================

alter table public.provider_payouts
  add column failure_detail text,
  add column failure_said_at timestamptz;

comment on column public.provider_payouts.failure_detail is
  'The provider''s code for why this payout failed (Wise transfer status, PayPal item status); the factory reads it as a sentence.';

create or replace function public.payout_failure_sentence(provider text, code text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(
    case provider
      when 'wise' then case code
        when 'bounced_back' then 'Your bank returned the payment. Check your bank details: TSC pays again once they are right.'
        when 'funds_refunded' then 'The payment came back before it reached your bank. TSC will pay again or contact you.'
        when 'charged_back' then 'The payment was reversed. TSC operations will contact you.'
      end
      when 'paypal' then case code
        when 'FAILED' then 'PayPal could not pay your PayPal account. Check your PayPal address: TSC pays again once it is right.'
        when 'RETURNED' then 'PayPal returned the payment: nothing arrived. Check your PayPal address: TSC pays again once it is right.'
        when 'BLOCKED' then 'PayPal blocked the payment. Check your PayPal account for limits, or contact TSC operations.'
        when 'REFUNDED' then 'The payment was returned to TSC. TSC operations will contact you.'
        when 'REVERSED' then 'The payment was reversed. TSC operations will contact you.'
      end
    end,
    'The payment did not go through. Check your payout details or contact TSC operations.'
  );
$$;

revoke all on function public.payout_failure_sentence(text, text) from public, anon;
grant execute on function public.payout_failure_sentence(text, text) to authenticated, service_role;

-- Once per payout: the provider's code goes on the row, and the factory hears
-- why, unless it was already asked to check a detail (that bell said so), or
-- the money never left TSC (staff's business: nothing happened to the
-- factory's money).
create or replace function public.say_provider_payout_failure()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  x public.provider_payouts;
  p public.order_payments;
  o public.production_orders;
begin
  select * into x from public.provider_payouts where id = new.payout_id;
  if not found or x.status <> 'failed' or x.failure_said_at is not null then
    return new;
  end if;

  update public.provider_payouts
     set failure_detail = new.provider_status, failure_said_at = now()
   where id = x.id;

  if x.asked_to_check is null and x.money_left_at is not null then
    select * into p from public.order_payments where id = x.payment_id;
    select * into o from public.production_orders where id = p.order_id;
    insert into public.notifications (org_id, kind, subject_type, subject_id, order_id, title, body)
    values (x.factory_org_id, 'payout_method_changed', 'payment', p.id, o.id,
      'A payment to you did not go through',
      format('Your payment of %s did not go through. %s',
        public.format_money(x.amount_cents, x.currency),
        public.payout_failure_sentence(x.provider, new.provider_status)));
  end if;
  return new;
end;
$$;

revoke all on function public.say_provider_payout_failure() from public, anon, authenticated;

create trigger provider_payout_failure_said
  after update on public.provider_payout_attempts
  for each row
  when (new.stage = 'done')
  execute function public.say_provider_payout_failure();

-- From 20261116100000 (the factory pays the payout fee: its fee sentence on
-- the body stays). Only the title changes.
create or replace function public.record_payment_released(target_payment uuid, transfer text)
returns public.order_payments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p public.order_payments;
  o public.production_orders;
begin
  select * into p from public.order_payments where id = target_payment for update;
  if not found then
    raise exception 'payment not found' using errcode = 'P0002';
  end if;
  if p.state <> 'confirmed' then
    return p;
  end if;

  select * into o from public.production_orders where id = p.order_id;

  update public.order_payments
     set state = 'released', released_at = now(), released_by = null,
         stripe_transfer_id = transfer,
         released_note = null
   where id = p.id
  returning * into p;

  insert into public.payment_events (payment_id, from_state, to_state, actor_kind)
  values (p.id, 'confirmed', 'released', 'system');

  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  values (
    o.factory_org_id, 'funds_released', 'payment', p.id, o.id,
    format('%s added to your balance', public.format_money(p.amount_cents, p.currency)),
    format('Sent against %s.', o.order_number) || public.payout_fee_sentence(p)
  );

  return p;
end;
$$;

revoke all on function public.record_payment_released(uuid, text) from public, anon, authenticated;
grant execute on function public.record_payment_released(uuid, text) to service_role;
