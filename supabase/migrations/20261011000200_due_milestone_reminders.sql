-- Brand reminders are for factory work that is due within seven days or
-- overdue. Enforce that in the database too: hiding a button is not an
-- authorization or anti-spam rule. Factory reminders retain their existing
-- purpose — an approval or payment waiting on the brand.

create or replace function public.remind_milestone(target_milestone uuid)
returns public.notifications
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m              public.order_milestones;
  o              public.production_orders;
  pay            public.payment_state;
  sender         uuid;
  reader         uuid;
  n              public.notifications;
  factory_posted boolean;
begin
  if not public.is_order_party(public.milestone_order(target_milestone)) then
    raise exception 'only the two parties to this order can send a reminder'
      using errcode = '42501';
  end if;

  select * into m from public.order_milestones where id = target_milestone;
  select * into o from public.production_orders where id = m.order_id;
  select state into pay from public.order_payments where milestone_id = m.id;
  select exists (
    select 1 from public.milestone_updates
    where milestone_id = m.id and author_org_id = o.factory_org_id
  ) into factory_posted;

  if public.is_org_member(o.factory_org_id) then
    sender := o.factory_org_id;
    reader := o.brand_org_id;
  else
    sender := o.brand_org_id;
    reader := o.factory_org_id;
  end if;

  if o.status <> 'active' then
    raise exception 'this order is %, so there is nothing to remind anyone about', o.status
      using errcode = '22023';
  end if;

  if sender = o.brand_org_id then
    if m.state <> 'active' or factory_posted then
      raise exception 'this step is not waiting for a factory update'
        using errcode = '22023';
    end if;
    if m.due_on is null or m.due_on > current_date + 7 then
      raise exception 'a factory reminder is available seven days before the due date'
        using errcode = '22023';
    end if;
  elsif not (
    coalesce(pay::text, '') = 'due'
    or m.state = 'submitted'
    or (m.state = 'active' and factory_posted)
  ) then
    raise exception 'this step is not waiting for the brand'
      using errcode = '22023';
  end if;

  if exists (
    select 1 from public.notifications
    where org_id = reader
      and kind = 'milestone_reminder'
      and subject_id = m.id
      and created_at > now() - interval '24 hours'
  ) then
    raise exception 'a reminder about this step was already sent today'
      using errcode = '22023';
  end if;

  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  values (
    reader, 'milestone_reminder', 'milestone', m.id, o.id,
    format('Reminder: "%s"', m.title),
    case
      when sender = o.brand_org_id and m.due_on < current_date
        then format('This production step was due %s and needs an update.', m.due_on)
      when sender = o.brand_org_id
        then format('This production step is due %s and needs an update.', m.due_on)
      when pay = 'due' then 'The payment for this step is due.'
      else 'This step is waiting for your approval.'
    end
  )
  returning * into n;

  return n;
end;
$$;

revoke all on function public.remind_milestone(uuid) from public;
grant execute on function public.remind_milestone(uuid) to authenticated;
