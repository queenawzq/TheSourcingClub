-- ============================================================================
-- A refunded credit purchase takes its credits back
-- ----------------------------------------------------------------------------
-- Staff refund a pack in Stripe (a mistaken purchase, a dispute). Until now
-- charge.refunded found no order payment and only logged, so the factory kept
-- credits it no longer paid for.
--
-- A refund takes back the share of the pack that was refunded: all of it for
-- a full refund, half for half. Stripe's charge carries the total refunded so
-- far, so the purchase keeps how many credits have been taken back and each
-- call writes only the difference: a webhook delivered twice, or two partial
-- refunds, never take back more than the refunded share.
--
-- The balance can go below zero when the credits were already spent on
-- quotes. That is the truth of the ledger, and submit_quote refuses a quote
-- until it is positive again, as it does at zero.
--
-- Safe with the current site live: two new columns with defaults and one new
-- service-role function.
-- ============================================================================

alter table public.credit_purchases
  add column refunded_credits integer not null default 0 check (refunded_credits >= 0),
  add column refunded_at      timestamptz;

create or replace function public.record_credit_purchase_refunded(
  payment_intent  text,
  refunded_cents  bigint
)
returns public.credit_purchases
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p       public.credit_purchases;
  owed    integer;
  delta   integer;
begin
  select * into p from public.credit_purchases
   where stripe_payment_intent_id = payment_intent
   for update;
  if not found then
    raise exception 'credit purchase not found' using errcode = 'P0002';
  end if;
  -- Nothing was granted, so there is nothing to take back.
  if p.state <> 'succeeded' then
    return p;
  end if;

  -- The refunded share of the pack, rounded down: a part refund never takes
  -- back a credit the factory still paid for.
  owed  := least(p.credits, (p.credits::bigint * greatest(refunded_cents, 0) / p.amount_cents)::integer);
  delta := owed - p.refunded_credits;
  if delta <= 0 then
    return p;
  end if;

  insert into public.credit_ledger (org_id, delta, reason, ref_type, note)
  values (p.org_id, -delta, 'refund', 'credit_purchase',
          to_char(delta, 'FM999,999,999') || ' credits taken back: purchase refunded');

  update public.credit_purchases
     set refunded_credits = owed,
         refunded_at = now()
   where id = p.id
  returning * into p;
  return p;
end;
$$;

revoke all on function public.record_credit_purchase_refunded(text, bigint) from public, anon, authenticated;
grant execute on function public.record_credit_purchase_refunded(text, bigint) to service_role;
