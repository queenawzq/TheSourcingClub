-- ============================================================================
-- 039  What is waiting for you
-- ----------------------------------------------------------------------------
-- One function, so the home screen, the navigation and any future email digest
-- cannot disagree about how much is outstanding. The same argument as
-- production_order_summary, and the same one capacity_monthly_units lost when
-- the prototypes ended up with four copies of it.
--
-- Deliberately NOT security definer. It runs as the caller, so every count is
-- exactly what that person could have counted themselves by querying the
-- tables — a bug here can under-report, but it cannot leak.
-- ============================================================================

create or replace function public.dashboard_snapshot(target_org uuid)
returns table (
  is_factory                 boolean,
  orders_active              integer,
  orders_awaiting_schedule   integer,
  steps_awaiting_you         integer,
  steps_you_are_working_on   integer,
  payments_due_cents         bigint,
  payments_in_flight_cents   bigint,
  payments_received_cents    bigint,
  unread_messages            integer,
  rfqs_open                  integer,
  quotes_to_compare          integer,
  quotes_awaiting_decision   integer
)
language sql
stable
as $$
  with me as (
    select o.id, o.type = 'factory' as factory
    from public.orgs o where o.id = target_org
  ),
  mine as (
    select s.*
    from public.production_order_summary s, me
    where s.brand_org_id = me.id or s.factory_org_id = me.id
  )
  select
    me.factory,

    (select count(*) from mine where status = 'active')::integer,
    (select count(*) from mine where status = 'pending_schedule')::integer,

    -- Waiting on YOU. For a brand that is a step the factory has sent for
    -- approval; for a factory it is a step that is open and is not simply a
    -- payment it is waiting to receive.
    (select count(*)
       from public.order_milestones m
       join mine on mine.id = m.order_id
      where mine.status = 'active'
        and case when me.factory
                 then m.state = 'active' and m.kind <> 'payment_only'
                 else m.state = 'submitted'
            end)::integer,

    -- In flight on the other side.
    (select count(*)
       from public.order_milestones m
       join mine on mine.id = m.order_id
      where mine.status = 'active'
        and case when me.factory
                 then m.state = 'submitted'
                 else m.state = 'active' and m.kind <> 'payment_only'
            end)::integer,

    -- Money. A brand sees what it owes; a factory sees what is owed to it.
    coalesce((select sum(p.amount_cents)
                from public.order_payments p
                join mine on mine.id = p.order_id
               where p.state = 'due'), 0)::bigint,

    -- Sent but not yet confirmed by staff — the state that belongs to nobody,
    -- and the one worth showing both sides so it cannot sit unnoticed.
    coalesce((select sum(p.amount_cents)
                from public.order_payments p
                join mine on mine.id = p.order_id
               where p.state = 'sent'), 0)::bigint,

    coalesce((select sum(p.amount_cents)
                from public.order_payments p
                join mine on mine.id = p.order_id
               where p.state in ('confirmed', 'released')), 0)::bigint,

    coalesce((select sum(t.unread_count)
                from public.message_thread_summary t
               where t.brand_org_id = target_org or t.factory_org_id = target_org), 0)::integer,

    -- A brand counts its own live requests. A factory counts the ones it can
    -- see and has not already quoted, which is the only number that tells it
    -- whether there is anything to do here today.
    (select count(*) from public.rfqs r
      where r.status = 'open'
        and case when me.factory
                 then not exists (select 1 from public.quotes q
                                   where q.rfq_id = r.id
                                     and q.factory_org_id = target_org
                                     and q.status in ('submitted', 'accepted'))
                 else r.brand_org_id = target_org
            end)::integer,

    (select count(distinct r.id) from public.rfqs r
      join public.quotes q on q.rfq_id = r.id and q.status = 'submitted'
     where not me.factory and r.brand_org_id = target_org and r.status = 'open')::integer,

    (select count(*) from public.quotes q
      where me.factory and q.factory_org_id = target_org and q.status = 'submitted')::integer

  from me;
$$;

grant execute on function public.dashboard_snapshot(uuid) to authenticated;
