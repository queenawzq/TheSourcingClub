-- ============================================================================
-- 038  Opening a conversation, and counting what is unread
-- ============================================================================

-- ---------------------------------------------------------------------------
-- open_thread
-- ---------------------------------------------------------------------------
-- Definer, and the whole reason is the eligibility test: whether these two
-- parties may talk is a question about the RFQ or the order, not about
-- messaging. Reusing can_see_rfq() and the order's own party test means there
-- is no fourth set of visibility rules to keep in step with the other three.
-- ---------------------------------------------------------------------------

create or replace function public.open_order_thread(target_order uuid)
returns public.message_threads
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  o public.production_orders;
  t public.message_threads;
begin
  select * into o from public.production_orders where id = target_order;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;

  if not public.is_order_party(target_order) then
    raise exception 'only the two parties to an order can message about it'
      using errcode = '42501';
  end if;

  insert into public.message_threads (order_id, brand_org_id, factory_org_id)
  values (o.id, o.brand_org_id, o.factory_org_id)
  on conflict (order_id) where order_id is not null do nothing;

  select * into t from public.message_threads where order_id = o.id;
  return t;
end;
$$;

create or replace function public.open_rfq_thread(target_rfq uuid, factory_org uuid)
returns public.message_threads
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.rfqs;
  t public.message_threads;
begin
  select * into r from public.rfqs where id = target_rfq;
  if not found then
    raise exception 'request not found' using errcode = 'P0002';
  end if;

  -- Either the brand that wrote it, choosing whom to ask; or the factory
  -- itself, and only one it may actually see. A factory cannot open a
  -- conversation about a request it was never shown, and cannot open one on
  -- another factory's behalf.
  if public.is_org_member(r.brand_org_id) then
    if not exists (select 1 from public.orgs where id = factory_org and type = 'factory') then
      raise exception 'that is not a factory' using errcode = '22023';
    end if;
  elsif public.is_org_member(factory_org) then
    if not public.can_see_rfq(target_rfq) then
      raise exception 'this request is not open to you' using errcode = '42501';
    end if;
  else
    raise exception 'you are not part of this conversation' using errcode = '42501';
  end if;

  insert into public.message_threads (rfq_id, brand_org_id, factory_org_id)
  values (r.id, r.brand_org_id, factory_org)
  on conflict (rfq_id, factory_org_id) where rfq_id is not null do nothing;

  select * into t from public.message_threads
  where rfq_id = r.id and factory_org_id = factory_org;
  return t;
end;
$$;

revoke all on function public.open_order_thread(uuid)      from public;
revoke all on function public.open_rfq_thread(uuid, uuid)  from public;
grant execute on function public.open_order_thread(uuid)     to authenticated;
grant execute on function public.open_rfq_thread(uuid, uuid) to authenticated;

-- Marking a conversation read. An upsert rather than an update, because the
-- first time someone opens a thread there is no row to update.
create or replace function public.mark_thread_read(target_thread uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_thread_party(target_thread) then
    raise exception 'you are not part of this conversation' using errcode = '42501';
  end if;

  insert into public.message_reads (thread_id, user_id, last_read_at)
  values (target_thread, auth.uid(), now())
  on conflict (thread_id, user_id) do update set last_read_at = now();
end;
$$;

revoke all on function public.mark_thread_read(uuid) from public;
grant execute on function public.mark_thread_read(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- What the list needs
-- ---------------------------------------------------------------------------
-- Unread is computed per caller from their own last_read_at, so it cannot get
-- stuck the way the prototype's thread-level integer does. Messages the caller
-- sent themselves never count as unread, which is obvious and is exactly the
-- sort of obvious thing a stored counter gets wrong.
-- ---------------------------------------------------------------------------

create or replace view public.message_thread_summary
with (security_invoker = true) as
select
  t.*,
  b.name as brand_name,
  f.name as factory_name,
  coalesce(r.title, o.order_number)              as subject_title,
  case when t.order_id is not null then 'order' else 'rfq' end as subject_kind,
  last.body        as last_body,
  last.sender_org_id as last_sender_org_id,
  (
    select count(*)
    from public.messages m
    where m.thread_id = t.id
      and m.sender_user_id is distinct from auth.uid()
      and m.created_at > coalesce(
        (select mr.last_read_at from public.message_reads mr
          where mr.thread_id = t.id and mr.user_id = auth.uid()),
        '-infinity'::timestamptz
      )
  )::integer as unread_count
from public.message_threads t
join public.orgs b on b.id = t.brand_org_id
join public.orgs f on f.id = t.factory_org_id
left join public.rfqs r              on r.id = t.rfq_id
left join public.production_orders o on o.id = t.order_id
left join lateral (
  select body, sender_org_id
  from public.messages
  where thread_id = t.id
  order by created_at desc
  limit 1
) last on true;

grant select on public.message_thread_summary to authenticated;
