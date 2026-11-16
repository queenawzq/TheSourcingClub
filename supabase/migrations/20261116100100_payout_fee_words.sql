-- The paid notification names the fee as the payout fee, taken from this
-- payment, so it never reads as TSC's service fee (which the brand pays on
-- top). Same words as payoutFeeSentence() in src/shared/withdrawal-fees.mjs,
-- the factory's payments row, and their Chinese in src/app/live-zh.js and
-- src/shared/notification-zh.mjs. finish_provider_payout and
-- record_payment_released call this, so only this changes.
create or replace function public.payout_fee_sentence(p public.order_payments)
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select case when coalesce(p.payout_fee_cents, 0) > 0
    then format(' Payout fee %s is taken from this payment: you receive %s.',
      public.format_money(p.payout_fee_cents, p.currency),
      public.format_money(p.amount_cents - p.payout_fee_cents, p.currency))
    else '' end;
$$;

revoke all on function public.payout_fee_sentence(public.order_payments) from public, anon, authenticated;
