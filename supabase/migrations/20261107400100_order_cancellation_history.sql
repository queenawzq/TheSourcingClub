-- ============================================================================
-- An order's activity keeps its cancellation history (tester, Nov 7).
--
-- A proposal was read from the order's own columns, which are cleared when it
-- is kept or withdrawn, so "proposed" and "kept the order" left no line. The
-- notifications written at each step are the record, but each one is addressed
-- to one company and order_activity runs as the caller, so a definer helper
-- reads them for either party. The actor is the company it was NOT sent to.
--
-- order_activity is 20261026000500's, with the proposal's line changed.
-- Additive and safe with the live site running: same signature, same columns.
-- ============================================================================

create or replace function public.order_cancellation_events(target_order uuid)
returns table (
  at           timestamptz,
  kind         text,
  actor_org_id uuid,
  detail       text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select n.created_at,
         n.kind,
         case when n.org_id = o.brand_org_id then o.factory_org_id else o.brand_org_id end,
         case when n.kind = 'cancellation_withdrawn' then null else n.body end
    from public.notifications n
    join public.production_orders o on o.id = n.order_id
   where n.order_id = target_order
     and n.kind in ('cancellation_proposed', 'cancellation_declined', 'cancellation_withdrawn')
     and public.is_order_party(target_order)
$$;

revoke all on function public.order_cancellation_events(uuid) from public, anon;
grant execute on function public.order_cancellation_events(uuid) to authenticated;

create or replace function public.order_activity(target_order uuid)
returns table (
  at              timestamptz,
  kind            text,
  actor_org_id    uuid,
  milestone_title text,
  detail          text
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with o as (
    select * from public.production_orders where id = target_order
  )
  select * from (
    select o.created_at, 'order_created', null::uuid, null::text, o.order_number from o
    union all
    select o.schedule_brand_agreed_at, 'schedule_agreed', o.brand_org_id, null, null
      from o where o.schedule_brand_agreed_at is not null
    union all
    select o.schedule_factory_agreed_at, 'schedule_agreed', o.factory_org_id, null, null
      from o where o.schedule_factory_agreed_at is not null
    union all
    select o.activated_at, 'order_activated', null, null, null
      from o where o.activated_at is not null
    union all
    select c.at, c.kind, c.actor_org_id, null, c.detail
      from public.order_cancellation_events(target_order) c
    union all
    select o.completed_at, 'order_completed', null, null, null
      from o where o.completed_at is not null
    union all
    select o.cancelled_at, 'order_cancelled', null, null, null
      from o where o.cancelled_at is not null

    union all
    select m.submitted_at, 'step_submitted', o.factory_org_id, m.title, null
      from public.order_milestones m join o on o.id = m.order_id
     where m.submitted_at is not null
    union all
    select m.approved_at, 'step_approved', o.brand_org_id, m.title, m.approval_note
      from public.order_milestones m join o on o.id = m.order_id
     where m.approved_at is not null
    union all
    -- A step that was approved and completed in one go already has its line.
    select m.completed_at, 'step_completed', null, m.title, null
      from public.order_milestones m join o on o.id = m.order_id
     where m.completed_at is not null
       and m.completed_at is distinct from m.approved_at

    union all
    select u.created_at, 'update_posted', u.author_org_id, m.title, left(u.body, 140)
      from public.milestone_updates u
      join public.order_milestones m on m.id = u.milestone_id
     where u.order_id = target_order

    union all
    select e.created_at,
           case
             -- Held money that went back to the brand (refunded in Stripe,
             -- or a payment that could no longer count).
             when e.from_state = 'confirmed' and e.to_state in ('failed', 'cancelled', 'not_due')
               then 'payment_refunded'
             when e.from_state = 'released' and e.to_state = 'released'
               then 'payment_refunded_after_payout'
             else 'payment_' || e.to_state::text
           end,
           case e.actor_kind when 'brand' then o.brand_org_id
                             when 'factory' then o.factory_org_id end,
           m.title, p.amount_cents::text
      from public.payment_events e
      join public.order_payments p on p.id = e.payment_id
      join public.order_milestones m on m.id = p.milestone_id
      join o on o.id = p.order_id
     where (e.from_state is distinct from e.to_state
            and e.to_state in ('due', 'sent', 'processing', 'failed', 'confirmed', 'released'))
        or (e.from_state = 'confirmed' and e.to_state in ('failed', 'cancelled', 'not_due'))
        or (e.from_state = 'released' and e.to_state = 'released')

    union all
    (select coalesce(msg.delivered_at, msg.created_at), 'message', msg.sender_org_id, null, null
       from public.messages msg
       join public.message_threads t on t.id = msg.thread_id
      where t.order_id = target_order
        and (msg.delivery = 'delivered' or public.is_org_member(msg.sender_org_id))
      order by coalesce(msg.delivered_at, msg.created_at) desc
      limit 1)
  ) activity (at, kind, actor_org_id, milestone_title, detail)
  order by at desc;
$$;

revoke all on function public.order_activity(uuid) from public;
grant execute on function public.order_activity(uuid) to authenticated;
