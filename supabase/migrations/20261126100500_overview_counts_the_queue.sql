-- M7 (Nov 26): one figure, one source. "Profiles awaiting review" on the
-- overview is the verification queue's Active count: companies that finished
-- signup (the queue's rule, 20261126100000) and are waiting on staff. A
-- company asked for more information is waiting on itself, and the queue
-- lists it under "Needs information", not Active. Same signature; grants
-- restated.

create or replace function public.admin_overview_metrics()
 RETURNS TABLE(profiles_awaiting_review integer, rfqs_submitted_today integer, quotes_submitted_today integer, payments_awaiting_confirmation integer, profiles_submitted_today integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare attention jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'these metrics are limited to platform staff' using errcode = '42501';
  end if;
  attention := public.admin_balance_attention();

  return query
  select
    (select count(*)::integer from public.admin_verification_queue() q
      where q.state in ('ready_for_review', 'in_review')),
    (select count(*)::integer from public.rfqs r
      where r.published_at >= date_trunc('day', now())),
    (select count(*)::integer from public.quotes q
      where q.submitted_at >= date_trunc('day', now())),
    (select count(*)::integer from public.order_payments p
      join public.production_orders o on o.id = p.order_id
      where (p.state = 'confirmed' and p.release_requested_at is not null
             and not exists (select 1 from public.payment_takes t where t.payment_id = p.id and t.status in ('held', 'sent'))
             and (p.stripe_release_started
                  or (select x.status from public.provider_payouts x where x.payment_id = p.id
                       order by x.created_at desc limit 1) in ('processing', 'failed')))
         or (p.state in ('confirmed', 'processing') and o.status = 'cancelled'
             and p.refund_failed_at is not null))
     + (select count(*)::integer from public.factory_withdrawals w where w.status in ('requested', 'paying'))
     + jsonb_array_length(attention -> 'disputed') + jsonb_array_length(attention -> 'stuck')
     + jsonb_array_length(attention -> 'recover')
     + jsonb_array_length(attention -> 'returned')
     + jsonb_array_length(attention -> 'refund_failed'),
    (select count(*)::integer from public.admin_verification_queue() q
      where q.submitted_at >= date_trunc('day', now()));
end;
$function$;
revoke all on function public.admin_overview_metrics() from public, anon;
grant execute on function public.admin_overview_metrics() to authenticated, service_role;
