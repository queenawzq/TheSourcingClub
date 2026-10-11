-- A dispute is a milestone update with a distinct kind. It therefore reuses
-- the existing private evidence path, party-only read rules, and update
-- history while remaining distinguishable from an ordinary comment.

alter table public.milestone_updates
  add column kind text not null default 'comment'
  check (kind in ('comment', 'dispute'));

create or replace function public.initiate_milestone_dispute(
  target_milestone uuid,
  reason text,
  document_ids uuid[] default '{}'
)
returns public.milestone_updates
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.order_milestones;
  o public.production_orders;
  u public.milestone_updates;
  doc public.documents;
  d uuid;
begin
  select * into m from public.order_milestones where id = target_milestone;
  if not found then
    raise exception 'milestone not found' using errcode = 'P0002';
  end if;

  select * into o from public.production_orders where id = m.order_id for share;

  if not public.is_org_member(o.brand_org_id) then
    raise exception 'only the brand on this order can initiate a dispute'
      using errcode = '42501';
  end if;
  if o.status <> 'active' then
    raise exception 'this order is %, so a dispute cannot be opened', o.status
      using errcode = '22023';
  end if;
  if m.state not in ('active', 'submitted') then
    raise exception 'that step is %, so a dispute cannot be opened', m.state
      using errcode = '22023';
  end if;
  if length(btrim(coalesce(reason, ''))) = 0 then
    raise exception 'a dispute needs a reason' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.milestone_updates
    where milestone_id = m.id and kind = 'dispute'
  ) then
    raise exception 'a dispute is already open on this step' using errcode = '22023';
  end if;

  insert into public.milestone_updates
    (milestone_id, author_org_id, kind, body, created_by)
  values
    (m.id, o.brand_org_id, 'dispute', btrim(reason), auth.uid())
  returning * into u;

  foreach d in array coalesce(document_ids, '{}') loop
    select * into doc from public.documents where id = d;
    if not found then
      raise exception 'one of those files does not exist' using errcode = 'P0002';
    end if;
    if doc.org_id <> o.brand_org_id then
      raise exception 'you can only attach your own files' using errcode = '42501';
    end if;
    if doc.kind <> 'milestone_update' then
      raise exception 'that file was not uploaded as milestone evidence' using errcode = '22023';
    end if;
    if doc.milestone_update_id is not null then
      raise exception 'that file is already attached to an update' using errcode = '22023';
    end if;
    update public.documents set milestone_update_id = u.id where id = d;
  end loop;

  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  values
    (o.factory_org_id, 'milestone_dispute', 'milestone', m.id, o.id,
     format('Dispute opened on "%s"', m.title), left(btrim(reason), 160));

  return u;
end;
$$;

revoke all on function public.initiate_milestone_dispute(uuid, text, uuid[]) from public;
grant execute on function public.initiate_milestone_dispute(uuid, text, uuid[]) to authenticated;
