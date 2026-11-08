-- The overview's payments card stops counting bank-wire claims.
--
-- John, Nov 7: the staff payments board no longer has a Bank-wire claims tab
-- (a transfer a brand said it sent on the old site). The card counts what the
-- board asks staff to act on, so a 'sent' payment no longer counts: the card
-- would otherwise point at a tab that isn't there.
--
-- A copy of admin_overview_metrics() from 20261013000200 with that one clause
-- gone: same signature, same columns. Safe with the old site live. The board's
-- read (admin_payment_board) is unchanged and still returns 'sent' rows.

create or replace function public.admin_overview_metrics()
returns table (
  profiles_awaiting_review integer,
  rfqs_submitted_today     integer,
  quotes_submitted_today   integer,
  payments_awaiting_confirmation integer,
  profiles_submitted_today integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'these metrics are limited to platform staff' using errcode = '42501';
  end if;

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
      where (p.state = 'confirmed' and p.release_requested_at is not null)
         or (p.state in ('confirmed', 'processing') and o.status = 'cancelled')),
    (select count(*)::integer from public.admin_verification_queue() q
      where q.submitted_at >= date_trunc('day', now()));
end;
$$;
