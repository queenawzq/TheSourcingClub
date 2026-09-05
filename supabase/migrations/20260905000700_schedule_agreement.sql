-- ============================================================================
-- 032  Agreeing the schedule
-- ----------------------------------------------------------------------------
-- The draft comes from the quote; either side may change it; both must agree
-- before any work or money moves. The whole file exists to make one sentence
-- true: an order cannot become active on terms a party never read.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Replace the whole schedule, never single rows
-- ---------------------------------------------------------------------------
-- Per-row edits would make "which version did I agree to?" unanswerable, and
-- that question is the only thing standing between this and an order that
-- activates on unseen terms.
-- ---------------------------------------------------------------------------

create or replace function public.set_order_schedule(target_order uuid, lines jsonb)
returns setof public.order_milestones
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  o        public.production_orders;
  item     jsonb;
  idx      integer := 0;
  kind     public.milestone_type;
  amount   bigint;
  total    bigint := 0;
  is_brand boolean;
begin
  select * into o from public.production_orders where id = target_order for update;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;

  is_brand := public.is_org_member(o.brand_org_id);

  -- A platform admin is deliberately NOT permitted here, or in agree_schedule.
  -- Admins confirm that money arrived; they do not sign a commercial agreement
  -- on a party's behalf. The one place staff can end an order is
  -- admin_close_order, which is an explicit act with a reason attached.
  if not (is_brand or public.is_org_member(o.factory_org_id)) then
    raise exception 'only the brand or the factory on this order may change its schedule'
      using errcode = '42501';
  end if;

  if o.status <> 'pending_schedule' then
    raise exception 'this schedule is already agreed; a change to the terms needs a new quote'
      using errcode = '22023';
  end if;

  if jsonb_typeof(lines) <> 'array' or jsonb_array_length(lines) = 0 then
    raise exception 'a schedule needs at least one milestone' using errcode = '22023';
  end if;

  -- Validate everything before deleting anything.
  for item in select * from jsonb_array_elements(lines) loop
    idx := idx + 1;

    begin
      kind := (item ->> 'kind')::public.milestone_type;
    exception when others then
      raise exception 'step % has an unknown kind "%"', idx, item ->> 'kind'
        using errcode = '22023';
    end;

    if length(btrim(coalesce(item ->> 'title', ''))) = 0 then
      raise exception 'step % needs a title', idx using errcode = '22023';
    end if;

    amount := nullif(item ->> 'amount_cents', '')::bigint;

    if kind in ('approval_and_payment', 'payment_only') then
      if amount is null or amount <= 0 then
        raise exception 'step % ("%") involves a payment, so it needs an amount',
          idx, item ->> 'title' using errcode = '22023';
      end if;
      total := total + amount;
    elsif amount is not null then
      raise exception 'step % ("%") has no payment, so it cannot carry an amount',
        idx, item ->> 'title' using errcode = '22023';
    end if;
  end loop;

  if total <> o.order_total_cents then
    raise exception 'the steps total %.2f but the agreed order is %.2f',
      total / 100.0, o.order_total_cents / 100.0 using errcode = '22023';
  end if;

  delete from public.order_milestones where order_id = o.id;

  idx := 0;
  for item in select * from jsonb_array_elements(lines) loop
    idx := idx + 1;
    insert into public.order_milestones
      (order_id, sort, kind, title, description, amount_cents, currency, due_on)
    values (
      o.id,
      coalesce(nullif(item ->> 'sort', '')::integer, idx * 10),
      (item ->> 'kind')::public.milestone_type,
      btrim(item ->> 'title'),
      nullif(btrim(coalesce(item ->> 'description', '')), ''),
      nullif(item ->> 'amount_cents', '')::bigint,
      o.currency,   -- explicit, never inherited from the column default
      nullif(item ->> 'due_on', '')::date
    );
  end loop;

  -- Any edit withdraws BOTH agreements. Anything less and one side's signature
  -- survives a change it never saw.
  update public.production_orders
     set schedule_revision = schedule_revision + 1,
         schedule_brand_agreed_at = null,
         schedule_brand_agreed_by = null,
         schedule_factory_agreed_at = null,
         schedule_factory_agreed_by = null
   where id = o.id;

  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  values (
    case when is_brand then o.factory_org_id else o.brand_org_id end,
    'schedule_updated', 'order', o.id, o.id,
    format('The schedule on %s changed', o.order_number),
    'Both agreements were withdrawn. Review the steps and agree again to start.'
  );

  return query select * from public.order_milestones where order_id = o.id order by sort;
end;
$$;

revoke all on function public.set_order_schedule(uuid, jsonb) from public;
grant execute on function public.set_order_schedule(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Agree
-- ---------------------------------------------------------------------------
-- `revision` is not decoration; it is the entire defence. Without it:
--
--   brand agrees at revision 3
--   factory edits            -> revision 4, brand's agreement cleared
--   factory agrees
--   a client that cached "I already agreed" re-submits for the brand
--   -> the order activates on terms the brand never saw, with two green
--      checkmarks and nothing anywhere looking wrong.
-- ---------------------------------------------------------------------------

create or replace function public.agree_schedule(target_order uuid, revision integer)
returns public.production_orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  o          public.production_orders;
  is_brand   boolean;
  is_factory boolean;
  total      bigint;
begin
  select * into o from public.production_orders where id = target_order for update;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;

  is_brand   := public.is_org_member(o.brand_org_id);
  is_factory := public.is_org_member(o.factory_org_id);

  if is_brand and is_factory then
    raise exception 'an order cannot be agreed by someone who is a party to both sides'
      using errcode = '42501';
  end if;
  if not (is_brand or is_factory) then
    raise exception 'only the brand or the factory on this order may agree its schedule'
      using errcode = '42501';
  end if;

  if o.status <> 'pending_schedule' then
    raise exception 'this order is % and its schedule is settled', o.status
      using errcode = '22023';
  end if;

  if revision <> o.schedule_revision then
    raise exception 'the schedule changed while you were reading it; reload and agree again'
      using errcode = '22023';
  end if;

  -- Cheap, and catches a service_role edit that went around set_order_schedule.
  select coalesce(sum(amount_cents), 0) into total
  from public.order_milestones where order_id = o.id;
  if total <> o.order_total_cents then
    raise exception 'the steps no longer total the agreed order value'
      using errcode = '22023';
  end if;

  if is_brand then
    if o.schedule_brand_agreed_at is not null then
      raise exception 'your side has already agreed this schedule' using errcode = '22023';
    end if;
    update public.production_orders
       set schedule_brand_agreed_at = now(), schedule_brand_agreed_by = auth.uid()
     where id = o.id returning * into o;
  else
    if o.schedule_factory_agreed_at is not null then
      raise exception 'your side has already agreed this schedule' using errcode = '22023';
    end if;
    update public.production_orders
       set schedule_factory_agreed_at = now(), schedule_factory_agreed_by = auth.uid()
     where id = o.id returning * into o;
  end if;

  if o.schedule_brand_agreed_at is not null and o.schedule_factory_agreed_at is not null then
    o := public.activate_order(o.id);
  else
    insert into public.notifications
      (org_id, kind, subject_type, subject_id, order_id, title, body)
    values (
      case when is_brand then o.factory_org_id else o.brand_org_id end,
      'schedule_agreed', 'order', o.id, o.id,
      format('The other side agreed the schedule on %s', o.order_number),
      'Agree it too and the order starts.'
    );
  end if;

  return o;
end;
$$;

revoke all on function public.agree_schedule(uuid, integer) from public;
grant execute on function public.agree_schedule(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Activation — internal, never granted
-- ---------------------------------------------------------------------------

create or replace function public.activate_order(target_order uuid)
returns public.production_orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  o public.production_orders;
begin
  update public.production_orders
     set status = 'active', activated_at = now()
   where id = target_order
  returning * into o;

  -- Payments come into existence now, not at award: the numbers have stopped
  -- moving, so there is nothing left to keep in step.
  insert into public.order_payments (order_id, milestone_id, amount_cents, currency, fee_bps)
  select m.order_id, m.id, m.amount_cents, m.currency, 0
  from public.order_milestones m
  where m.order_id = o.id
    and m.kind in ('approval_and_payment', 'payment_only');

  perform public.advance_order_chain(o.id);

  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  select org_id, 'order_activated', 'order', o.id, o.id,
         format('%s is under way', o.order_number),
         'Both sides agreed the schedule. The first step is open.'
  from (select o.brand_org_id as org_id union all select o.factory_org_id) parties;

  return o;
end;
$$;

revoke all on function public.activate_order(uuid) from public;
