-- One balance, fix round 31 (money review r30, L1).
--
-- A dispute recorded while a withdrawal held part of the step was told at the
-- part left ($300 of a $500 step); when the withdrawal's part came back, the
-- once-per-dispute guard kept the bell at $300 while $500 was on hold. Now an
-- "on hold" notice is written again, in the same sentence, when the amount
-- held has grown since the last one told for this dispute. Each hold notice
-- keeps the amount it told in data.held_cents; an older notice without it
-- counts only for its exact sentence.
--
-- Full latest body (20261121320000) plus the change; grants re-applied
-- exactly; no overloads.
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
  said text;
begin
  if p.state <> 'confirmed' or p.release_requested_at is null then
    return;
  end if;
  amount_cents := public.payment_factory_cents(p) - public.payment_taken_cents(p.id);
  if amount_cents <= 0 then
    return;
  end if;
  said := case when held
               then format('The brand disputed the charge. %s is held until the dispute is settled.',
                           public.format_money(amount_cents, p.currency))
               else format('The dispute is settled. %s is no longer on hold.',
                           public.format_money(amount_cents, p.currency)) end;
  -- Once per dispute and amount: the withdraw call and the webhook may both
  -- get here, and a withdrawal's part coming back makes more of it held.
  if held and exists (
    select 1 from public.notifications n
     where n.subject_type = 'payment' and n.subject_id = p.id and n.kind = 'payment_disputed'
       and n.created_at >= coalesce(p.disputed_at, '-infinity'::timestamptz)
       and starts_with(n.body, 'The brand disputed the charge.')
       and (n.body = said
            or (n.data ? 'held_cents' and (n.data ->> 'held_cents')::bigint >= amount_cents))
  ) then
    return;
  end if;
  select * into o from public.production_orders where id = p.order_id;
  select * into m from public.order_milestones where id = p.milestone_id;
  insert into public.notifications (org_id, kind, subject_type, subject_id, order_id, title, body, data)
  values (o.factory_org_id, 'payment_disputed', 'payment', p.id, o.id,
          case when held then format('Payment for "%s" on hold', coalesce(m.title, o.order_number))
               else format('Hold lifted on "%s"', coalesce(m.title, o.order_number)) end,
          said,
          case when held then jsonb_build_object('held_cents', amount_cents) else '{}'::jsonb end);
end;
$function$;
revoke all on function public.tell_payment_hold(public.order_payments, boolean) from public, anon, authenticated;
