-- ============================================================================
-- Order activity: refunds read as refunds
-- ----------------------------------------------------------------------------
-- order_activity named every payment event after the state it moved to, so a
-- refund (20261022000300) read as "did not go through", a refund after the
-- payout as a second "TSC paid out", and a history line that changed no state
-- (a stray payment refunded, a repeated decline) repeated the last one. Held
-- money going back is now its own line, and lines that change nothing are
-- left out. Same signature and columns as 20261013000200's definition, which
-- this copies with only the payment-event part changed.
-- ============================================================================

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
    select o.cancel_proposed_at, 'cancellation_proposed', o.cancel_proposed_by_org, null, o.cancel_reason
      from o where o.cancel_proposed_at is not null
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
    (select msg.created_at, 'message', msg.sender_org_id, null, null
       from public.messages msg
       join public.message_threads t on t.id = msg.thread_id
      where t.order_id = target_order
      order by msg.created_at desc
      limit 1)
  ) activity (at, kind, actor_org_id, milestone_title, detail)
  order by at desc;
$$;

revoke all on function public.order_activity(uuid) from public;
grant execute on function public.order_activity(uuid) to authenticated;
