-- Brands may maintain the descriptive production plan after an order starts
-- without replacing milestone rows (which would destroy payments and updates).
-- Commercial fields remain immutable: kind, currency and amount are untouched.
create or replace function public.update_order_milestone_details(target_order uuid, lines jsonb)
returns setof public.order_milestones
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  o public.production_orders;
  item jsonb;
  milestone_id uuid;
  expected_count integer;
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
    raise exception 'the milestone list is required' using errcode = '22023';
  end if;

  select count(*) into expected_count
  from public.order_milestones
  where order_id = target_order;

  if jsonb_array_length(lines) <> expected_count then
    raise exception 'active orders cannot add or remove milestones'
      using errcode = '22023';
  end if;

  if (select count(distinct value ->> 'id') from jsonb_array_elements(lines)) <> expected_count then
    raise exception 'every milestone must appear exactly once'
      using errcode = '22023';
  end if;

  for item in select * from jsonb_array_elements(lines) loop
    begin
      milestone_id := (item ->> 'id')::uuid;
    exception when others then
      raise exception 'a milestone id is invalid' using errcode = '22023';
    end;

    if length(btrim(coalesce(item ->> 'title', ''))) = 0 then
      raise exception 'every milestone needs a title' using errcode = '22023';
    end if;

    update public.order_milestones
       set title = btrim(item ->> 'title'),
           description = nullif(btrim(coalesce(item ->> 'description', '')), ''),
           due_on = nullif(item ->> 'due_on', '')::date,
           sort = coalesce(nullif(item ->> 'sort', '')::integer, sort)
     where id = milestone_id
       and order_id = target_order;

    if not found then
      raise exception 'a milestone does not belong to this order'
        using errcode = '22023';
    end if;
  end loop;

  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  values (
    o.factory_org_id, 'schedule_updated', 'order', o.id, o.id,
    format('The brand updated milestones on %s', o.order_number),
    'Review the updated milestone names, descriptions, and due dates.'
  );

  return query
    select * from public.order_milestones
    where order_id = target_order
    order by sort;
end;
$$;

revoke all on function public.update_order_milestone_details(uuid, jsonb) from public;
grant execute on function public.update_order_milestone_details(uuid, jsonb) to authenticated;
