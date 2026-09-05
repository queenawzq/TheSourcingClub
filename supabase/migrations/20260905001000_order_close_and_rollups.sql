-- ============================================================================
-- 035  Leaving an order, and the numbers on its header
-- ----------------------------------------------------------------------------
-- Nothing in either prototype covers an order going wrong, and an order that
-- can only move forwards is a trap: the first factory that stops answering
-- leaves a row nobody can close.
--
-- No refund logic, and that is not an omission. The platform never held the
-- money, so there is nothing to unwind — which is exactly what makes an exit
-- cheap to build now rather than later.
-- ============================================================================

create or replace function public.propose_cancellation(target_order uuid, reason text)
returns public.production_orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  o        public.production_orders;
  is_brand boolean;
  mine     uuid;
begin
  select * into o from public.production_orders where id = target_order for update;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;

  is_brand := public.is_org_member(o.brand_org_id);
  if not (is_brand or public.is_org_member(o.factory_org_id)) then
    raise exception 'only a party to this order may propose cancelling it' using errcode = '42501';
  end if;

  if o.status not in ('pending_schedule', 'active') then
    raise exception 'this order is % already', o.status using errcode = '22023';
  end if;

  if length(btrim(coalesce(reason, ''))) = 0 then
    raise exception 'say why; the other side sees this' using errcode = '22023';
  end if;

  mine := case when is_brand then o.brand_org_id else o.factory_org_id end;

  update public.production_orders
     set cancel_proposed_by_org = mine,
         cancel_proposed_at = now(),
         cancel_reason = btrim(reason)
   where id = o.id
  returning * into o;

  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  values (
    case when is_brand then o.factory_org_id else o.brand_org_id end,
    'cancellation_proposed', 'order', o.id, o.id,
    format('%s has been proposed for cancellation', o.order_number),
    btrim(reason)
  );

  return o;
end;
$$;

-- The OTHER side accepts. Payments already confirmed stay on the record —
-- cancelling an order does not unsay that money changed hands.
create or replace function public.accept_cancellation(target_order uuid)
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

  if o.cancel_proposed_by_org is null then
    raise exception 'nobody has proposed cancelling this order' using errcode = '22023';
  end if;

  mine := case
    when public.is_org_member(o.brand_org_id) then o.brand_org_id
    when public.is_org_member(o.factory_org_id) then o.factory_org_id
  end;

  if mine is null then
    raise exception 'only a party to this order may accept a cancellation' using errcode = '42501';
  end if;
  if mine = o.cancel_proposed_by_org then
    raise exception 'the other side has to accept, not the side that proposed it'
      using errcode = '42501';
  end if;

  perform public.close_order(o.id, o.cancel_reason);
  select * into o from public.production_orders where id = target_order;
  return o;
end;
$$;

-- Staff can force-close a stuck order. Distinct from the agreement path
-- because it is a different act: one side has stopped participating.
create or replace function public.admin_close_order(target_order uuid, reason text)
returns public.production_orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  o public.production_orders;
begin
  if not public.is_platform_admin() then
    raise exception 'this is limited to platform staff' using errcode = '42501';
  end if;
  if length(btrim(coalesce(reason, ''))) = 0 then
    raise exception 'a forced close needs a reason; both sides see it' using errcode = '22023';
  end if;

  perform public.close_order(target_order, btrim(reason));
  select * into o from public.production_orders where id = target_order;
  return o;
end;
$$;

create or replace function public.close_order(target_order uuid, reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  o public.production_orders;
begin
  select * into o from public.production_orders where id = target_order for update;
  if o.status not in ('pending_schedule', 'active') then
    raise exception 'this order is % already', o.status using errcode = '22023';
  end if;

  update public.production_orders
     set status = 'cancelled', cancelled_at = now(), cancel_reason = reason
   where id = o.id;

  update public.order_milestones
     set state = 'cancelled'
   where order_id = o.id and state not in ('complete', 'cancelled');

  insert into public.payment_events (payment_id, from_state, to_state, actor_user_id, actor_kind, note)
  select id, state, 'cancelled', auth.uid(), 'system', reason
  from public.order_payments
  where order_id = o.id and state in ('not_due', 'due', 'sent');

  -- A confirmed or released payment is NOT cancelled. The money moved; the
  -- record of it moving survives the order it was for.
  update public.order_payments
     set state = 'cancelled'
   where order_id = o.id and state in ('not_due', 'due', 'sent');

  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  select org_id, 'order_cancelled', 'order', o.id, o.id,
         format('%s was cancelled', o.order_number), reason
  from (select o.brand_org_id as org_id union all select o.factory_org_id) parties;
end;
$$;

revoke all on function public.propose_cancellation(uuid, text) from public;
revoke all on function public.accept_cancellation(uuid)        from public;
revoke all on function public.admin_close_order(uuid, text)    from public;
revoke all on function public.close_order(uuid, text)          from public;
grant execute on function public.propose_cancellation(uuid, text) to authenticated;
grant execute on function public.accept_cancellation(uuid)        to authenticated;
grant execute on function public.admin_close_order(uuid, text)    to authenticated;
-- close_order stays internal: it asks nobody's permission.

-- ---------------------------------------------------------------------------
-- The header metrics
-- ---------------------------------------------------------------------------
-- One view, so the brand, the factory and the admin cannot be looking at three
-- different totals. The client reads this; JavaScript never sums money and
-- never decides whose turn it is. capacity_monthly_units() already has four
-- prototype copies, one of which overstates a sweater factory by 2.3x, and
-- that is the mistake this exists not to repeat.
--
-- total_cents is the sum of the MILESTONES, deliberately not the quote total.
-- They are equal at award and diverge the moment either side edits the
-- schedule; reading the quote total instead is how the prototype ends up
-- showing a $5,780 header over $3,432 of visible steps.
-- ---------------------------------------------------------------------------

create or replace view public.production_order_summary
with (security_invoker = true) as
select
  o.*,
  coalesce(ms.total_cents, 0)::bigint  as total_cents,
  coalesce(pm.paid_cents, 0)::bigint   as paid_cents,
  (coalesce(ms.total_cents, 0) - coalesce(pm.paid_cents, 0))::bigint as outstanding_cents,
  nx.amount_cents                      as next_payment_cents,
  nx.due_on                            as next_payment_due_on,
  cur.id                               as current_milestone_id,
  cur.title                            as current_milestone_title,
  -- Whose turn it is, computed here so both sides read the same answer.
  (o.status = 'pending_schedule' and o.schedule_brand_agreed_at is null)
    or exists (
      select 1 from public.order_milestones m
      where m.order_id = o.id and m.state = 'submitted'
    )
    or exists (
      select 1 from public.order_payments p
      where p.order_id = o.id and p.state = 'due'
    )                                  as awaiting_brand,
  (o.status = 'pending_schedule' and o.schedule_factory_agreed_at is null)
    or exists (
      select 1 from public.order_milestones m
      where m.order_id = o.id and m.state = 'active' and m.kind <> 'payment_only'
    )                                  as awaiting_factory
from public.production_orders o
left join lateral (
  select sum(amount_cents) as total_cents
  from public.order_milestones where order_id = o.id
) ms on true
left join lateral (
  -- confirmed and released only. The brand saying it sent the money is not
  -- funding — that premise is the entire reason the admin step exists.
  select sum(amount_cents) as paid_cents
  from public.order_payments
  where order_id = o.id and state in ('confirmed', 'released')
) pm on true
left join lateral (
  select p.amount_cents, m.due_on
  from public.order_payments p
  join public.order_milestones m on m.id = p.milestone_id
  where p.order_id = o.id and p.state in ('not_due', 'due', 'sent')
  order by m.sort
  limit 1
) nx on true
left join lateral (
  select m.id, m.title
  from public.order_milestones m
  where m.order_id = o.id and m.state not in ('complete', 'cancelled')
  order by m.sort
  limit 1
) cur on true;

grant select on public.production_order_summary to authenticated;

-- ---------------------------------------------------------------------------
-- A notification can only be marked read
-- ---------------------------------------------------------------------------
-- notifications_mark_read is `for update using/with check (own org)`, which
-- also lets a recipient rewrite the title, kind and subject of its own
-- notification. Harmless in Phase 2. From here the feed is part of the payment
-- trail, and a policy cannot compare OLD to NEW.
-- ---------------------------------------------------------------------------

create or replace function public.notifications_read_only_read_at()
returns trigger
language plpgsql
as $$
begin
  if new.org_id       is distinct from old.org_id
     or new.kind         is distinct from old.kind
     or new.subject_type is distinct from old.subject_type
     or new.subject_id   is distinct from old.subject_id
     or new.order_id     is distinct from old.order_id
     or new.title        is distinct from old.title
     or new.body         is distinct from old.body
     or new.created_at   is distinct from old.created_at
  then
    raise exception 'a notification can only be marked read' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger notifications_immutable_except_read_at
  before update on public.notifications
  for each row execute function public.notifications_read_only_read_at();
