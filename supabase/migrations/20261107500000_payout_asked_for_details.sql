-- ============================================================================
-- The factory's page says what its bell says
-- ----------------------------------------------------------------------------
-- A PayPal address with no account leaves the payment processing and the money
-- waiting: the bell said "Check your PayPal address", and Payments said only
-- "Processing". The page reads provider_payouts and never the staff-only
-- attempts table, so the moment the factory was asked goes on the row. It holds
-- a time, no provider's words. Same signature and grants.
-- ============================================================================

alter table public.provider_payouts add column details_asked_at timestamptz;

create or replace function public.record_provider_attempt(
  target_payout uuid,
  new_stage text default null,
  new_ref text default null,
  new_quote text default null,
  new_fee bigint default null,
  new_item text default null,
  new_status text default null,
  sentence text default null,
  received bigint default null,
  received_in text default null,
  keep_lease boolean default false,
  tell_factory text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  live public.provider_payouts;
  told timestamptz;
begin
  select * into live from public.provider_payouts where id = target_payout for update;
  if not found or live.status <> 'processing' then
    return;
  end if;

  update public.provider_payouts x
     set provider_ref = coalesce(new_ref, x.provider_ref),
         received_minor = coalesce(received, x.received_minor),
         received_currency = coalesce(received_in, x.received_currency),
         updated_at = now()
   where x.id = target_payout;

  update public.provider_payout_attempts a
     set stage = coalesce(new_stage, a.stage),
         quote_id = coalesce(new_quote, a.quote_id),
         fee_minor = coalesce(new_fee, a.fee_minor),
         provider_item_id = coalesce(new_item, a.provider_item_id),
         provider_status = coalesce(new_status, a.provider_status),
         staff_sentence = sentence,
         lease_until = case when keep_lease then a.lease_until end,
         updated_at = now()
   where a.payout_id = target_payout
  returning a.factory_told_at into told;

  if tell_factory is not null and told is null then
    insert into public.notifications (org_id, kind, subject_type, subject_id, order_id, title, body)
    select live.factory_org_id, 'payout_method_changed', 'payment', live.payment_id, p.order_id, tell_factory,
           format('Your payment of %s is waiting. %s.', public.format_money(live.amount_cents, live.currency), tell_factory)
      from public.order_payments p where p.id = live.payment_id;
    update public.provider_payout_attempts a set factory_told_at = now() where a.payout_id = target_payout;
    update public.provider_payouts x set details_asked_at = now() where x.id = target_payout;
  end if;
end;
$$;

revoke all on function public.record_provider_attempt(uuid, text, text, text, bigint, text, text, text, bigint, text, boolean, text) from public, anon, authenticated;
grant execute on function public.record_provider_attempt(uuid, text, text, text, bigint, text, text, text, bigint, text, boolean, text) to service_role;
