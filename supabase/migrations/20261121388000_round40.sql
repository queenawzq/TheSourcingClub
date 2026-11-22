-- One balance, fix round 40.
--
-- F4  A charge already disputed when it is recorded as funded tells the
--     factory its money is on hold ("The brand disputed the charge. $X is
--     held until the dispute is settled."), never "it is added to your balance
--     when the brand approves it", for a step held until approval as well as
--     one owed at once. Settling that dispute before approval lifts the hold
--     in words; approving the step still says it is on hold (once per
--     dispute, amount and approval). A dispute on a funded step not yet
--     approved is still not told until approval.
--
-- Latest full bodies (from the running database, 20261121220000 and
-- 20261121320000/20261121330000); CREATE OR REPLACE keeps the grants, which
-- are re-applied exactly below; no overloads.

-- 20261121330000's body; a lift for a step not yet approved whose hold was
-- told at funding, and once per dispute, amount and approval.
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
  approved boolean := p.release_requested_at is not null;
begin
  if p.state <> 'confirmed' then
    return;
  end if;
  -- Not approved yet: the factory is not told of money it was never told was
  -- its own (a hold is told at funding by record_payment_funded only); a lift
  -- only after such a hold was told and not lifted since.
  if not approved and (held or not exists (
    select 1 from public.notifications n
     where n.subject_type = 'payment' and n.subject_id = p.id and n.kind = 'payment_disputed'
       and starts_with(n.body, 'The brand disputed the charge.')
       and not exists (select 1 from public.notifications l
                        where l.subject_type = 'payment' and l.subject_id = p.id and l.kind = 'payment_disputed'
                          and starts_with(l.body, 'The dispute is settled.') and l.created_at >= n.created_at)
  )) then
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
  -- Once per dispute, amount and approval: the withdraw call and the webhook
  -- may both get here, a withdrawal's part coming back makes more of it held,
  -- and approving a step told on hold at funding says so again.
  if held and exists (
    select 1 from public.notifications n
     where n.subject_type = 'payment' and n.subject_id = p.id and n.kind = 'payment_disputed'
       and n.created_at >= coalesce(p.disputed_at, '-infinity'::timestamptz)
       and starts_with(n.body, 'The brand disputed the charge.')
       and (n.body = said
            or (n.data ? 'held_cents' and (n.data ->> 'held_cents')::bigint >= amount_cents))
       and coalesce((n.data ->> 'approved')::boolean, true) = approved
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
          case when held then jsonb_build_object('held_cents', amount_cents, 'approved', approved) else '{}'::jsonb end);
end;
$function$;
revoke all on function public.tell_payment_hold(public.order_payments, boolean) from public, anon, authenticated;

-- 20261121220000's body; a disputed charge on a step held until approval is
-- told on hold too.
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
    -- A charge disputed before it was recorded (the same second): the step's
    -- money is on hold, never "added to your balance", owed now or on
    -- approval (20261121388000: a step held until approval too).
    if pays_out and p.disputed_at is not null then
      perform public.tell_payment_hold(p, true);
    elsif p.disputed_at is not null then
      -- Held until approval: the hold in tell_payment_hold's words, in place
      -- of the funded notice (that function tells only approved steps).
      insert into public.notifications (org_id, kind, subject_type, subject_id, order_id, title, body, data)
      values (o.factory_org_id, 'payment_disputed', 'payment', p.id, o.id,
              format('Payment for "%s" on hold', coalesce(m.title, o.order_number)),
              format('The brand disputed the charge. %s is held until the dispute is settled.',
                     public.format_money(public.payment_factory_cents(p), p.currency)),
              jsonb_build_object('held_cents', public.payment_factory_cents(p), 'approved', false));
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
        then format('%s added to your balance for "%s" on %s.%s',
                    public.format_money(p.amount_cents, p.currency), m.title, o.order_number,
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
        then format('%s received on %s. We add %s to the factory''s balance.',
                    public.format_money(p.charged_cents, p.currency), o.order_number,
                    public.format_money(p.amount_cents, p.currency))
        else format('%s received on %s. TSC holds it and adds it to the factory''s balance when you approve this step.',
                    public.format_money(coalesce(p.charged_cents, p.amount_cents), p.currency), o.order_number)
      end
    );
  end if;

  return p;
end;
$function$;

revoke all on function public.record_payment_funded(uuid, text, text, text, bigint) from public, anon, authenticated;
grant execute on function public.record_payment_funded(uuid, text, text, text, bigint) to service_role;
