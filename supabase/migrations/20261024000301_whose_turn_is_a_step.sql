-- ============================================================================
-- Whose turn a production step is, said once
-- ----------------------------------------------------------------------------
-- An open step whose payment is still due (or failed) is waiting on the brand
-- to fund it, not on the factory: a paid step is funded before its work. The
-- factory dashboard counted every open step as "needs an update", and the
-- daily job reminded the factory about steps only the brand could move, while
-- the brand, who had to pay, heard nothing.
--
-- milestone_waiting_on() is the one rule, read by dashboard_snapshot and
-- run_daily_notifications:
--   factory         open, and nothing to pay or already funded
--   brand_payment   open, and its payment is due or failed
--   brand_approval  sent to the brand for approval
--   null            nobody: Stripe is still confirming, staff have a bank
--                   claim to check, or the step is not open
--
-- Capacity reminders go only to published manufacturers. A trading company
-- has no capacity card to update, and a factory that never set its capacity
-- is asked to set it rather than told when it "last updated" it.
--
-- Safe with the live site running: dashboard_snapshot keeps its signature and
-- columns, and the rest is new or service-role only.
-- ============================================================================

create or replace function public.milestone_waiting_on(
  step_state public.milestone_state,
  pay        public.payment_state
)
returns text
language sql
immutable
as $$
  select case
    when step_state = 'submitted' then 'brand_approval'
    when step_state <> 'active' then null
    when pay is null or pay in ('confirmed', 'released') then 'factory'
    when pay in ('due', 'failed') then 'brand_payment'
    else null
  end
$$;

revoke all on function public.milestone_waiting_on(public.milestone_state, public.payment_state) from public, anon;
grant execute on function public.milestone_waiting_on(public.milestone_state, public.payment_state)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- dashboard_snapshot (from 20261013000200), same columns. Changed: the step
-- counts follow milestone_waiting_on, so an unfunded step is neither the
-- factory's "needs an update" nor the brand's "the factory is working on it".
-- ---------------------------------------------------------------------------

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
    -- approval (what it owes is the money figure below); for a factory it is
    -- a step that is open, funded if it is paid, and not simply a payment.
    (select count(*)
       from public.order_milestones m
       join mine on mine.id = m.order_id
       left join public.order_payments p on p.milestone_id = m.id
      where mine.status = 'active'
        and case when me.factory
                 then public.milestone_waiting_on(m.state, p.state) = 'factory' and m.kind <> 'payment_only'
                 else public.milestone_waiting_on(m.state, p.state) = 'brand_approval'
            end)::integer,

    -- In flight on the other side.
    (select count(*)
       from public.order_milestones m
       join mine on mine.id = m.order_id
       left join public.order_payments p on p.milestone_id = m.id
      where mine.status = 'active'
        and case when me.factory
                 then public.milestone_waiting_on(m.state, p.state) = 'brand_approval'
                 else public.milestone_waiting_on(m.state, p.state) = 'factory' and m.kind <> 'payment_only'
            end)::integer,

    -- Money. A brand sees what it owes; a factory sees what is owed to it.
    coalesce((select sum(p.amount_cents)
                from public.order_payments p
                join mine on mine.id = p.order_id
               where p.state in ('due', 'failed')), 0)::bigint,

    -- Paid but not cleared (a bank payment), or a legacy wire claimed sent:
    -- worth showing both sides so it cannot sit unnoticed.
    coalesce((select sum(p.amount_cents)
                from public.order_payments p
                join mine on mine.id = p.order_id
               where p.state in ('sent', 'processing')), 0)::bigint,

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

-- ---------------------------------------------------------------------------
-- run_daily_notifications (from 20261015000200). Changed:
-- capacity_reminder: published manufacturers only, and worded for a factory
--   that never set its capacity.
-- milestone_due_soon: to the side milestone_waiting_on names. The brand is
--   reminded to fund an unfunded step, and that reminder opens the step's
--   payment page; a step Stripe is still confirming reminds nobody. The
--   funding reminder has its own key, so a step funded inside the window
--   still reminds the factory afterwards. The other keys are as before, so a
--   re-run sends nothing already sent under the old rule.
-- ---------------------------------------------------------------------------
create or replace function public.run_daily_notifications()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  capacity_count integer;
  due_count      integer;
begin
  with factories as (
    select p.org_id,
           (c.org_id is null
            and not exists (select 1 from public.factory_capacity_months m where m.org_id = p.org_id)) as never_set,
           greatest(
             coalesce(c.updated_at, p.created_at),
             coalesce((select max(m.updated_at) from public.factory_capacity_months m where m.org_id = p.org_id),
                      '-infinity'::timestamptz)
           ) as last_change
      from public.factory_profiles p
      left join public.factory_capacity c on c.org_id = p.org_id
     where p.verification_status = 'verified'
       and p.vendor_kind = 'manufacturer'
       and p.published_at is not null
  ), due as (
    select org_id, never_set, last_change,
           floor(extract(epoch from now() - last_change) / 86400)::integer as days
      from factories
     where last_change <= now() - interval '30 days'
  ), claimed as (
    insert into public.notification_reminders (kind, subject_id, due_key, org_id)
    select 'capacity_reminder', org_id,
           to_char(last_change at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') || ':' || (days / 30),
           org_id
      from due
    on conflict do nothing
    returning org_id
  )
  insert into public.notifications (org_id, kind, subject_type, subject_id, title, body)
  select due.org_id, 'capacity_reminder', 'capacity', due.org_id,
         case when due.never_set then 'Set your open capacity' else 'Is your capacity still right?' end,
         case when due.never_set
              then 'You haven''t set your open capacity yet. Brands see it when they choose who to invite, so add it from your dashboard.'
              else format('You last updated your open capacity %s days ago. Brands see it when they choose who to invite, so update it from your dashboard.', due.days)
         end
    from claimed
    join due on due.org_id = claimed.org_id;
  get diagnostics capacity_count = row_count;

  with steps as (
    select m.id, m.title, m.due_on, o.id as order_id, o.order_number,
           o.brand_org_id, o.factory_org_id, p.id as payment_id,
           (m.due_on - current_date) as days_left,
           public.milestone_waiting_on(m.state, p.state) as turn
      from public.order_milestones m
      join public.production_orders o on o.id = m.order_id
      left join public.order_payments p on p.milestone_id = m.id
     where o.status = 'active'
       and m.state in ('active', 'submitted')
       and m.due_on between current_date and current_date + 3
  ), keyed as (
    select steps.*,
           case when turn = 'factory' then factory_org_id else brand_org_id end as reader,
           (case when days_left >= 2 then '3d' else '1d' end) || ':' || due_on::text
             || case when turn = 'brand_payment' then ':fund' else '' end as due_key
      from steps
     where turn is not null
  ), claimed as (
    insert into public.notification_reminders (kind, subject_id, due_key, org_id)
    select 'milestone_due_soon', id, due_key, reader from keyed
    on conflict do nothing
    returning subject_id, due_key
  )
  insert into public.notifications (org_id, kind, subject_type, subject_id, order_id, title, body, data)
  select k.reader, 'milestone_due_soon',
         case when k.turn = 'brand_payment' then 'payment' else 'milestone' end,
         case when k.turn = 'brand_payment' then k.payment_id else k.id end,
         k.order_id,
         format('"%s" is due %s', k.title,
                case k.days_left when 0 then 'today' when 1 then 'tomorrow' else format('in %s days', k.days_left) end),
         case k.turn
              when 'factory' then format('This production step on %s is due %s and needs an update.',
                                         k.order_number, to_char(k.due_on, 'FMMon FMDD'))
              when 'brand_payment' then format('This step on %s is waiting for your payment. It is due %s.',
                                               k.order_number, to_char(k.due_on, 'FMMon FMDD'))
              else format('This step on %s is waiting for your approval. It is due %s.',
                          k.order_number, to_char(k.due_on, 'FMMon FMDD'))
         end,
         jsonb_build_object('due_on', k.due_on)
    from keyed k
    join claimed c on c.subject_id = k.id and c.due_key = k.due_key;
  get diagnostics due_count = row_count;

  return jsonb_build_object('capacity_reminders', capacity_count, 'due_soon', due_count);
end;
$$;

revoke all on function public.run_daily_notifications() from public, anon, authenticated;
grant execute on function public.run_daily_notifications() to service_role;
