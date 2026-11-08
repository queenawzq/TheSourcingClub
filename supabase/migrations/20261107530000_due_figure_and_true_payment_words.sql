-- ============================================================================
-- One figure for a payment due, and words that stay true when money waits
-- ----------------------------------------------------------------------------
-- The brand's "is due" notice said the step amount where the order page and the
-- Fund screen say the step plus the fee: $1,100.00 in the bell, $1,177.00 on the
-- page. It now says what the card will be charged, as begin_payment_checkout
-- works it out (amount + payment_fee_cents).
--
-- "On its way" and "paid on to the factory" were written when every factory was
-- paid at once. A factory in China waits for staff, so the emails now say what
-- TSC will do, which is true of every way of paying. Only these four sentences
-- change; the three functions are otherwise their latest definitions.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.advance_order_chain(target_order uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  next_sort integer;
  o         public.production_orders;
begin
  select * into o from public.production_orders where id = target_order;

  select min(sort) into next_sort
  from public.order_milestones
  where order_id = target_order
    and state not in ('complete', 'cancelled');

  if next_sort is null then
    update public.production_orders
       set status = 'completed', completed_at = now()
     where id = target_order and status = 'active';

    insert into public.notifications
      (org_id, kind, subject_type, subject_id, order_id, title, body)
    select org_id, 'order_completed', 'order', o.id, o.id,
           format('%s is complete', o.order_number),
           'Every step on this order is done.'
    from (select o.brand_org_id as org_id union all select o.factory_org_id) parties;
    return;
  end if;

  -- Nothing opens while an earlier step is still outstanding.
  if exists (
    select 1 from public.order_milestones
    where order_id = target_order
      and sort < next_sort
      and state not in ('complete', 'cancelled')
  ) then
    return;
  end if;

  update public.order_milestones
     set state = 'active'
   where order_id = target_order and sort = next_sort and state = 'pending';

  -- A step that involves money is funded as it opens: TSC holds the money
  -- while the work happens and pays it on when the brand approves.
  update public.order_payments p
     set state = 'due', due_at = now()
    from public.order_milestones m
   where m.id = p.milestone_id
     and m.order_id = target_order
     and m.sort = next_sort
     and m.kind in ('payment_only', 'approval_and_payment')
     and p.state = 'not_due';

  insert into public.payment_events (payment_id, from_state, to_state, actor_kind)
  select p.id, 'not_due', 'due', 'system'
  from public.order_payments p
  join public.order_milestones m on m.id = p.milestone_id
  where m.order_id = target_order and m.sort = next_sort
    -- Only the ones this call made due (due_at is this transaction's now()).
    and m.kind in ('payment_only', 'approval_and_payment') and p.state = 'due'
    and p.due_at >= now();

  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  select o.brand_org_id, 'payment_due', 'payment', p.id, o.id,
         format('%s is due on %s', public.format_money(p.amount_cents + public.payment_fee_cents(p.id), p.currency), o.order_number),
         format('"%s". Fund it by card; TSC holds it until the step is done.', m.title)
  from public.order_payments p
  join public.order_milestones m on m.id = p.milestone_id
  where m.order_id = target_order and m.sort = next_sort
    and m.kind in ('payment_only', 'approval_and_payment') and p.state = 'due'
    and p.due_at >= now();
end;
$function$
;
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
      coalesce(
        nullif(btrim(coalesce(note, '')), ''),
        format('The brand approved this step. TSC will send you %s.',
               public.format_money(p.amount_cents, p.currency))
      )
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
        then format('TSC received %s on %s and will send it to you.',
                    public.format_money(p.amount_cents, p.currency), o.order_number)
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
