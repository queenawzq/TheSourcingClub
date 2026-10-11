-- Let a brand maintain the remaining structure of an active production plan
-- without replacing milestone rows that already own updates or payments.
create or replace function public.update_order_milestone_details(target_order uuid, lines jsonb)
returns setof public.order_milestones
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  o public.production_orders;
  item jsonb;
  existing public.order_milestones;
  payment public.order_payments;
  item_id uuid;
  item_kind public.milestone_type;
  item_amount bigint;
  total bigint := 0;
  idx integer := 0;
  has_payment boolean;
  commercial_changed boolean;
  desired_payment_state public.payment_state;
begin
  select * into o from public.production_orders where id = target_order for update;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;

  if not public.is_org_member(o.brand_org_id) then
    raise exception 'only the brand on this order may manage its milestones'
      using errcode = '42501';
  end if;

  if o.status not in ('pending_schedule', 'active') then
    raise exception 'milestones cannot be changed on this order'
      using errcode = '22023';
  end if;

  if jsonb_typeof(lines) <> 'array' or jsonb_array_length(lines) = 0 then
    raise exception 'a schedule needs at least one milestone' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(lines) entry
    where nullif(entry ->> 'id', '') is not null
    group by entry ->> 'id'
    having count(*) > 1
  ) then
    raise exception 'a milestone appears more than once' using errcode = '22023';
  end if;

  -- Validate the complete proposed schedule before touching any row.
  for item in select * from jsonb_array_elements(lines) loop
    idx := idx + 1;
    begin
      item_kind := (item ->> 'kind')::public.milestone_type;
      item_id := nullif(item ->> 'id', '')::uuid;
      item_amount := nullif(item ->> 'amount_cents', '')::bigint;
    exception when others then
      raise exception 'step % contains an invalid id, type, or amount', idx
        using errcode = '22023';
    end;

    if length(btrim(coalesce(item ->> 'title', ''))) = 0 then
      raise exception 'step % needs a title', idx using errcode = '22023';
    end if;

    if item_kind in ('approval_and_payment', 'payment_only') then
      if item_amount is null or item_amount <= 0 then
        raise exception 'step % involves a payment, so it needs an amount', idx
          using errcode = '22023';
      end if;
      total := total + item_amount;
    elsif item_amount is not null then
      raise exception 'step % has no payment, so it cannot carry an amount', idx
        using errcode = '22023';
    end if;

    if item_id is not null and not exists (
      select 1 from public.order_milestones
      where id = item_id and order_id = target_order
    ) then
      raise exception 'a milestone does not belong to this order'
        using errcode = '22023';
    end if;
  end loop;

  if total <> o.order_total_cents then
    raise exception 'the steps total %.2f but the agreed order is %.2f',
      total / 100.0, o.order_total_cents / 100.0 using errcode = '22023';
  end if;

  -- Omitted rows are removals. Work that has started is history, not a form
  -- row, and a payment that moved beyond not-due must never disappear.
  for existing in
    select m.*
    from public.order_milestones m
    where m.order_id = target_order
      and not exists (
        select 1 from jsonb_array_elements(lines) entry
        where nullif(entry ->> 'id', '') = m.id::text
      )
    for update
  loop
    if existing.state <> 'pending' then
      raise exception '"%" has already started and cannot be removed', existing.title
        using errcode = '22023';
    end if;
    if exists (select 1 from public.milestone_updates where milestone_id = existing.id) then
      raise exception '"%" has updates and cannot be removed', existing.title
        using errcode = '22023';
    end if;
    if exists (
      select 1 from public.order_payments
      where milestone_id = existing.id and state <> 'not_due'
    ) then
      raise exception '"%" has payment activity and cannot be removed', existing.title
        using errcode = '22023';
    end if;
  end loop;

  delete from public.order_milestones m
  where m.order_id = target_order
    and not exists (
      select 1 from jsonb_array_elements(lines) entry
      where nullif(entry ->> 'id', '') = m.id::text
    );

  idx := 0;
  for item in select * from jsonb_array_elements(lines) loop
    idx := idx + 1;
    item_id := nullif(item ->> 'id', '')::uuid;
    item_kind := (item ->> 'kind')::public.milestone_type;
    item_amount := nullif(item ->> 'amount_cents', '')::bigint;

    if item_id is null then
      insert into public.order_milestones
        (order_id, sort, kind, title, description, amount_cents, currency, due_on, state)
      values (
        target_order,
        coalesce(nullif(item ->> 'sort', '')::integer, idx * 10),
        item_kind,
        btrim(item ->> 'title'),
        nullif(btrim(coalesce(item ->> 'description', '')), ''),
        item_amount,
        o.currency,
        nullif(item ->> 'due_on', '')::date,
        'pending'
      ) returning id into item_id;

      if item_kind in ('approval_and_payment', 'payment_only') then
        insert into public.order_payments
          (order_id, milestone_id, amount_cents, currency, state)
        values (target_order, item_id, item_amount, o.currency, 'not_due');
      end if;
      continue;
    end if;

    select * into existing
    from public.order_milestones
    where id = item_id and order_id = target_order
    for update;

    select * into payment
    from public.order_payments
    where milestone_id = item_id
    for update;
    has_payment := found;

    commercial_changed := existing.kind is distinct from item_kind
      or existing.amount_cents is distinct from item_amount;

    if commercial_changed and existing.state not in ('pending', 'active') then
      raise exception '"%" is already under review or complete, so its payment type cannot change', existing.title
        using errcode = '22023';
    end if;

    if commercial_changed and has_payment and payment.state not in ('not_due', 'due') then
      raise exception '"%" has payment activity, so its amount or type cannot change', existing.title
        using errcode = '22023';
    end if;

    if has_payment and item_kind not in ('approval_and_payment', 'payment_only') then
      delete from public.order_payments where id = payment.id;
      has_payment := false;
    end if;

    update public.order_milestones
       set kind = item_kind,
           title = btrim(item ->> 'title'),
           description = nullif(btrim(coalesce(item ->> 'description', '')), ''),
           amount_cents = item_amount,
           due_on = nullif(item ->> 'due_on', '')::date,
           sort = coalesce(nullif(item ->> 'sort', '')::integer, idx * 10)
     where id = item_id;

    if item_kind in ('approval_and_payment', 'payment_only') then
      desired_payment_state := case
        when existing.state = 'active' and item_kind = 'payment_only' then 'due'::public.payment_state
        else 'not_due'::public.payment_state
      end;

      if has_payment then
        if payment.state is distinct from desired_payment_state then
          insert into public.payment_events
            (payment_id, from_state, to_state, actor_user_id, actor_kind, note)
          values (
            payment.id, payment.state, desired_payment_state, auth.uid(), 'brand',
            'Payment timing changed while managing production steps.'
          );
        end if;
        update public.order_payments
           set amount_cents = item_amount,
               state = desired_payment_state,
               due_at = case when desired_payment_state = 'due' then coalesce(due_at, now()) else null end
         where id = payment.id;
      else
        insert into public.order_payments
          (order_id, milestone_id, amount_cents, currency, state, due_at)
        values (
          target_order, item_id, item_amount, o.currency, desired_payment_state,
          case when desired_payment_state = 'due' then now() else null end
        );
      end if;
    end if;
  end loop;

  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  values (
    o.factory_org_id, 'schedule_updated', 'order', o.id, o.id,
    format('The brand updated milestones on %s', o.order_number),
    'Review the updated production steps, payment amounts, and due dates.'
  );

  return query
    select * from public.order_milestones
    where order_id = target_order
    order by sort;
end;
$$;

revoke all on function public.update_order_milestone_details(uuid, jsonb) from public;
grant execute on function public.update_order_milestone_details(uuid, jsonb) to authenticated;
