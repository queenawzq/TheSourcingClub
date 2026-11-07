-- ============================================================================
-- A factory TSC can't pay is told to add a withdrawal method
-- ----------------------------------------------------------------------------
-- A factory with no withdrawal method and no Stripe account that takes
-- transfers was emailed "TSC will send you $65.00", which can't happen until it
-- adds one. The approval and the payment-only funded notices now end "once you
-- add a withdrawal method" for it, as its dashboard and order page say.
-- A brand's approval note no longer replaces the amount: both are said.
-- The two functions are otherwise their definitions in 20261107530000.
-- ============================================================================
create or replace function public.factory_has_no_payout_method(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select not exists (select 1 from public.factory_payout_accounts a where a.org_id = target_org)
     and not exists (select 1 from public.stripe_connect_accounts s where s.org_id = target_org and s.transfers_active);
$$;
revoke all on function public.factory_has_no_payout_method(uuid) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.approve_milestone(target_milestone uuid, note text DEFAULT NULL::text)
 RETURNS order_milestones
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  m public.order_milestones;
  o public.production_orders;
  p public.order_payments;
begin
  select * into o from public.production_orders
   where id = (select order_id from public.order_milestones where id = target_milestone)
   for update;
  if not found then
    raise exception 'milestone not found' using errcode = 'P0002';
  end if;

  select * into m from public.order_milestones where id = target_milestone for update;

  if o.status <> 'active' then
    raise exception 'this order is %', o.status using errcode = '22023';
  end if;

  if m.kind = 'payment_only' then
    raise exception 'there is nothing to approve on a payment step' using errcode = '22023';
  end if;

  -- Approving is Approve samples; a step that releases money also needs
  -- Release funds (both, so neither alone pays a factory).
  if not public.is_org_member(o.brand_org_id) then
    raise exception 'only the brand on this order approves its steps' using errcode = '42501';
  end if;
  perform public.require_org_permission(o.brand_org_id, 'approve');
  if m.kind = 'approval_and_payment' then
    perform public.require_org_permission(o.brand_org_id, 'releaseFunds');
  end if;

  -- Also the double-approve guard: a second concurrent call blocks on the row
  -- lock above, then reads the new state and lands here.
  if m.state not in ('active', 'submitted') then
    raise exception 'that step is %, so it is not waiting on you', m.state
      using errcode = '22023';
  end if;

  if m.kind = 'approval_and_payment' then
    select * into p from public.order_payments where milestone_id = m.id for update;

    -- Approving pays the factory, so there has to be money to pay it with.
    if not found or p.state <> 'confirmed' then
      raise exception 'fund "%" first: TSC pays the factory from the money it holds when you approve',
        m.title using errcode = '22023';
    end if;

    update public.order_milestones
       set state = 'complete', approved_by = auth.uid(), approved_at = now(),
           approval_note = nullif(btrim(coalesce(note, '')), ''), completed_at = now()
     where id = m.id
    returning * into m;

    update public.order_payments
       set release_requested_at = now()
     where id = p.id
    returning * into p;

    insert into public.notifications
      (org_id, kind, subject_type, subject_id, order_id, title, body)
    values (
      o.factory_org_id, 'milestone_approved', 'milestone', m.id, o.id,
      format('"%s" was approved', m.title),
      -- The amount always, the brand's note after it, and what the factory must
      -- do first when TSC has no way to pay it.
      format('The brand approved this step. TSC will send you %s%s.%s',
             public.format_money(p.amount_cents, p.currency),
             case when public.factory_has_no_payout_method(o.factory_org_id)
                  then ' once you add a withdrawal method' else '' end,
             coalesce(' Their note: ' || nullif(btrim(coalesce(note, '')), ''), ''))
    );

    -- The chain moves on the brand's approval, never on the payout: a
    -- transfer that fails must not freeze the order.
    perform public.advance_order_chain(o.id);
  else
    update public.order_milestones
       set state = 'complete', approved_by = auth.uid(), approved_at = now(),
           approval_note = nullif(btrim(coalesce(note, '')), ''), completed_at = now()
     where id = m.id
    returning * into m;

    insert into public.notifications
      (org_id, kind, subject_type, subject_id, order_id, title, body)
    values (
      o.factory_org_id, 'milestone_approved', 'milestone', m.id, o.id,
      format('"%s" was approved', m.title),
      coalesce(nullif(btrim(coalesce(note, '')), ''), 'You can carry on to the next step.')
    );

    perform public.advance_order_chain(o.id);
  end if;

  return m;
end;
$function$
;

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
  -- A cancelled payment can still be charged (a bank payment already on its
  -- way when the order was cancelled): the money arrived, so record it.
  -- Staff see it held on a cancelled order and refund it.
  was := p.state;

  select * into m from public.order_milestones where id = p.milestone_id for update;

  -- Nothing to approve on a payment-only step; a step approved under the old
  -- rules (approve first, pay after) was waiting only for this.
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
    insert into public.notifications
      (org_id, kind, subject_type, subject_id, order_id, title, body)
    values (
      o.factory_org_id, 'payment_confirmed', 'payment', p.id, o.id,
      format('Payment held for "%s"', m.title),
      case when pays_out
        then format('TSC received %s on %s and will send it to you%s.',
                    public.format_money(p.amount_cents, p.currency), o.order_number,
                    case when public.factory_has_no_payout_method(o.factory_org_id)
                         then ' once you add a withdrawal method' else '' end)
        else format('TSC holds %s for this step on %s. You can start this work; it is paid to you when the brand approves it.',
                    public.format_money(p.amount_cents, p.currency), o.order_number)
      end
    );

    insert into public.notifications
      (org_id, kind, subject_type, subject_id, order_id, title, body)
    values (
      o.brand_org_id, 'payment_confirmed', 'payment', p.id, o.id,
      format('Your payment for "%s" is funded', m.title),
      case when pays_out
        then format('%s received on %s. TSC will pay the factory.',
                    public.format_money(p.charged_cents, p.currency), o.order_number)
        else format('%s received. TSC holds it and pays the factory when you approve this step.',
                    public.format_money(coalesce(p.charged_cents, p.amount_cents), p.currency))
      end
    );
  end if;

  return p;
end;
$function$
;
