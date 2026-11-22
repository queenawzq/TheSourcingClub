-- Funded paid step, held until approval: the factory is told who funded it,
-- for which step on which project, and when it becomes available; the brand
-- is told when the money becomes available to the factory. Only those two
-- bodies change; record_payment_funded is otherwise as in 20261121410000.

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
  brand_name text;
  project_name text;
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
    select nullif(btrim(name), '') into brand_name from public.orgs where id = o.brand_org_id;
    select nullif(btrim(title), '') into project_name from public.rfqs where id = o.rfq_id;
    brand_name := coalesce(brand_name, 'The brand');
    project_name := coalesce(project_name, o.order_number);

    -- A charge disputed before it was recorded (the same second): the step's
    -- money is on hold, never "added to your balance", owed now or on
    -- approval (20261121388000: a step held until approval too).
    if pays_out and p.disputed_at is not null then
      perform public.tell_payment_hold(p, true);
    elsif p.disputed_at is not null then
      -- Held until approval: the hold in tell_payment_hold's words, in place
      -- of the funded notice (that function tells only approved steps).
      -- Keyed (20261121410000) so tell_payment_hold finds it: the lift
      -- before approval, and the hold said once more on approval.
      insert into public.notifications (org_id, kind, subject_type, subject_id, order_id, title, body, data, dedupe_key)
      values (o.factory_org_id, 'payment_disputed', 'payment', p.id, o.id,
              format('Payment for "%s" on hold', coalesce(m.title, o.order_number)),
              format('The brand disputed the charge. %s is held until the dispute is settled.',
                     public.format_money(public.payment_factory_cents(p), p.currency)),
              jsonb_build_object('held_cents', public.payment_factory_cents(p), 'approved', false),
              format('payment_hold:%s:%s:%s:before_approval', p.id,
                     (extract(epoch from p.disputed_at) * 1000000)::bigint, public.payment_factory_cents(p)))
      on conflict (org_id, dedupe_key) do nothing;
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
        else format('%s funded %s for %s on %s. It will become available when %s approves this step.',
                    brand_name, public.format_money(p.amount_cents, p.currency), m.title,
                    project_name, brand_name)
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
        else format('%s received on %s. It becomes available to the factory when you approve this step.',
                    public.format_money(coalesce(p.charged_cents, p.amount_cents), p.currency), o.order_number)
      end
    );
  end if;

  return p;
end;
$function$;
revoke all on function public.record_payment_funded(uuid, text, text, text, bigint) from public, anon, authenticated;
grant execute on function public.record_payment_funded(uuid, text, text, text, bigint) to service_role;
