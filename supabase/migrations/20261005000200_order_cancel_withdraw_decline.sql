-- ============================================================================
-- 070  Taking back, or turning down, a proposal to cancel an order
-- ----------------------------------------------------------------------------
-- Migration 035 lets either side propose cancelling an open order and the
-- other side accept. Nothing let a proposal end any other way, so one sent in
-- haste sat on the order until the other side closed it. Two ways out:
--
--   withdraw_cancellation(order)  the side that proposed it takes it back;
--   decline_cancellation(order)   the other side keeps the order.
--
-- Both clear the proposal and tell the other company. Neither changes a step
-- or a payment: until a cancellation is accepted, the order runs as before.
--
-- Additive only. 035's functions are unchanged, so the live site, which calls
-- neither of these, is unaffected.
--
-- Known limits, left as they are:
--   * order_activity reads the proposal from the order row, so once it is
--     cleared its "proposed cancelling" line goes with it. The notifications
--     each side received stay.
--   * propose_cancellation still replaces an open proposal; the screens never
--     offer it while one is open.
-- ============================================================================

create or replace function public.withdraw_cancellation(target_order uuid)
returns public.production_orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  o    public.production_orders;
  mine uuid;
begin
  select * into o from public.production_orders where id = target_order for update;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;

  mine := case
    when public.is_org_member(o.brand_org_id) then o.brand_org_id
    when public.is_org_member(o.factory_org_id) then o.factory_org_id
  end;

  if mine is null then
    raise exception 'only a party to this order may withdraw a cancellation' using errcode = '42501';
  end if;
  if o.status not in ('pending_schedule', 'active') then
    raise exception 'this order is % already', o.status using errcode = '22023';
  end if;
  if o.cancel_proposed_by_org is null then
    raise exception 'nobody has proposed cancelling this order' using errcode = '22023';
  end if;
  if mine <> o.cancel_proposed_by_org then
    raise exception 'only the side that proposed it can withdraw it; the other side keeps the order instead'
      using errcode = '42501';
  end if;

  update public.production_orders
     set cancel_proposed_by_org = null,
         cancel_proposed_at = null,
         cancel_reason = null
   where id = o.id
  returning * into o;

  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  select
    case when mine = o.brand_org_id then o.factory_org_id else o.brand_org_id end,
    'cancellation_withdrawn', 'order', o.id, o.id,
    format('%s: cancellation withdrawn', o.order_number),
    format('%s withdrew its proposal to cancel. The order carries on.', g.name)
  from public.orgs g where g.id = mine;

  return o;
end;
$$;

create or replace function public.decline_cancellation(target_order uuid)
returns public.production_orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  o        public.production_orders;
  mine     uuid;
  proposer uuid;
  reason   text;
begin
  select * into o from public.production_orders where id = target_order for update;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;

  mine := case
    when public.is_org_member(o.brand_org_id) then o.brand_org_id
    when public.is_org_member(o.factory_org_id) then o.factory_org_id
  end;

  if mine is null then
    raise exception 'only a party to this order may decline a cancellation' using errcode = '42501';
  end if;
  if o.status not in ('pending_schedule', 'active') then
    raise exception 'this order is % already', o.status using errcode = '22023';
  end if;
  if o.cancel_proposed_by_org is null then
    raise exception 'nobody has proposed cancelling this order' using errcode = '22023';
  end if;
  if mine = o.cancel_proposed_by_org then
    raise exception 'the side that proposed it withdraws it; the other side keeps the order'
      using errcode = '42501';
  end if;

  proposer := o.cancel_proposed_by_org;
  reason := o.cancel_reason;

  update public.production_orders
     set cancel_proposed_by_org = null,
         cancel_proposed_at = null,
         cancel_reason = null
   where id = o.id
  returning * into o;

  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  select
    proposer, 'cancellation_declined', 'order', o.id, o.id,
    format('%s: %s wants to keep the order', o.order_number, g.name),
    reason
  from public.orgs g where g.id = mine;

  return o;
end;
$$;

revoke all on function public.withdraw_cancellation(uuid) from public, anon;
revoke all on function public.decline_cancellation(uuid)  from public, anon;
grant execute on function public.withdraw_cancellation(uuid) to authenticated;
grant execute on function public.decline_cancellation(uuid)  to authenticated;
