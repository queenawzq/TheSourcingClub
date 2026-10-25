-- Preserve discussion after approval without reopening steps or payments.
create or replace function public.post_milestone_update(
  target_milestone uuid,
  body text,
  document_ids uuid[] default '{}'
)
returns public.milestone_updates
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m      public.order_milestones;
  o      public.production_orders;
  u      public.milestone_updates;
  doc    public.documents;
  d      uuid;
  author uuid;
  reader uuid;
begin
  select * into m from public.order_milestones where id = target_milestone;
  if not found then
    raise exception 'milestone not found' using errcode = 'P0002';
  end if;

  select * into o from public.production_orders where id = m.order_id for share;

  if public.is_org_member(o.factory_org_id) then
    author := o.factory_org_id;
    reader := o.brand_org_id;
  elsif public.is_org_member(o.brand_org_id) then
    author := o.brand_org_id;
    reader := o.factory_org_id;
  else
    raise exception 'only the two parties to this order post on its steps' using errcode = '42501';
  end if;

  if o.status not in ('active', 'completed') then
    raise exception 'this order is %, so there is nothing to report against yet', o.status
      using errcode = '22023';
  end if;

  if m.state not in ('active', 'submitted', 'complete') then
    raise exception 'that step is %, so it cannot take an update', m.state
      using errcode = '22023';
  end if;

  if length(btrim(coalesce(body, ''))) = 0 then
    raise exception 'an update needs a note saying what happened' using errcode = '22023';
  end if;

  insert into public.milestone_updates (milestone_id, author_org_id, body, created_by)
  values (m.id, author, btrim(body), auth.uid())
  returning * into u;

  foreach d in array coalesce(document_ids, '{}') loop
    select * into doc from public.documents where id = d;
    if not found then
      raise exception 'one of those files does not exist' using errcode = 'P0002';
    end if;
    if doc.org_id <> author then
      raise exception 'you can only attach your own files' using errcode = '42501';
    end if;
    if doc.kind <> 'milestone_update' then
      raise exception 'that file was not uploaded as an update photo' using errcode = '22023';
    end if;
    -- Stops an already-attached document being re-parented onto a second
    -- update, which is how one order's photo would reach another's parties.
    if doc.milestone_update_id is not null then
      raise exception 'that file is already attached to an update' using errcode = '22023';
    end if;

    update public.documents set milestone_update_id = u.id where id = d;
  end loop;

  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  values (
    reader, 'milestone_update', 'milestone', m.id, o.id,
    case when author = o.factory_org_id
      then format('New update on "%s"', m.title)
      else format('New comment on "%s"', m.title)
    end,
    left(btrim(body), 160)
  );

  return u;
end;
$$;

revoke all on function public.post_milestone_update(uuid, text, uuid[]) from public;
grant execute on function public.post_milestone_update(uuid, text, uuid[]) to authenticated;
