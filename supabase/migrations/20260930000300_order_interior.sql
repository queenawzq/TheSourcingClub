-- ============================================================================
-- 065  The order interior: comments from either side, reminders, activity
-- ----------------------------------------------------------------------------
-- Three things the designed order screen draws had nothing behind them:
--
--   * "Add comment" on a step, with "+ Upload photos". Only the factory could
--     post against a step, so the brand's comment had nowhere to go — and the
--     live screen wired the menu item to the row's own action instead, which
--     on a brand row approved the step.
--   * "Send reminder" on a step. It changed a label and sent nothing.
--   * "Project activity" beside the timeline. Four hardcoded lines.
--
-- And one rule from the design review: the brand approves a step from the
-- factory's update, with no separate "send for approval" in between.
--
-- Nothing here changes a table. post_milestone_update and approve_milestone
-- keep their names and arguments and only admit more; the other two
-- functions are new.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- post_milestone_update: either party may post
-- ---------------------------------------------------------------------------
-- Unchanged from 20260905000800 apart from who may call it. A brand's post is
-- its comment on the step; it is stored exactly like a factory update, with
-- the brand as author_org_id, so the counterparty read policies on
-- milestone_updates, documents and storage (all keyed on the ORDER, never on
-- the author) already cover it.
--
-- Someone who belongs to both companies posts as the factory, which is what
-- the old function did for them.
-- ---------------------------------------------------------------------------

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

  if o.status <> 'active' then
    raise exception 'this order is %, so there is nothing to report against yet', o.status
      using errcode = '22023';
  end if;

  if m.state not in ('active', 'submitted') then
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

-- ---------------------------------------------------------------------------
-- remind_milestone: nudge the other side about a step
-- ---------------------------------------------------------------------------
-- The step has to be waiting on somebody: open for work, sent for approval,
-- or with its payment due. Once a day per step and recipient, so the button
-- cannot be turned into a way of flooding the other company's inbox; the
-- earlier reminder is still sitting there unread.
--
-- The party test is the first statement, before anything is read about the
-- step, so a stranger learns nothing from the error it gets back.
-- ---------------------------------------------------------------------------

create or replace function public.remind_milestone(target_milestone uuid)
returns public.notifications
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m       public.order_milestones;
  o       public.production_orders;
  pay     public.payment_state;
  sender  uuid;
  reader  uuid;
  n       public.notifications;
begin
  if not public.is_order_party(public.milestone_order(target_milestone)) then
    raise exception 'only the two parties to this order can send a reminder' using errcode = '42501';
  end if;

  select * into m from public.order_milestones where id = target_milestone;
  select * into o from public.production_orders where id = m.order_id;
  select state into pay from public.order_payments where milestone_id = m.id;

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

  if m.state not in ('active', 'submitted') and coalesce(pay::text, '') <> 'due' then
    raise exception 'that step is %, so it is not waiting on anyone', m.state
      using errcode = '22023';
  end if;

  if exists (
    select 1 from public.notifications
    where org_id = reader
      and kind = 'milestone_reminder'
      and subject_id = m.id
      and created_at > now() - interval '24 hours'
  ) then
    raise exception 'a reminder about this step was already sent today' using errcode = '22023';
  end if;

  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  values (
    reader, 'milestone_reminder', 'milestone', m.id, o.id,
    format('Reminder: "%s"', m.title),
    case
      when pay = 'due' and reader = o.brand_org_id then 'The payment for this step is due.'
      when m.state = 'submitted' and reader = o.brand_org_id then 'This step is waiting for your approval.'
      when m.state = 'submitted' then 'The brand has been reminded about this step.'
      else 'This step is waiting for an update.'
    end
  )
  returning * into n;

  return n;
end;
$$;

revoke all on function public.remind_milestone(uuid) from public;
grant execute on function public.remind_milestone(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- order_activity: what has happened on an order, newest first
-- ---------------------------------------------------------------------------
-- Invoker, not definer: every row below is read through its own table's RLS,
-- so a non-party gets an empty list and this function adds no access of its
-- own. It is a union of stamps that already exist; there is no activity table
-- to fall out of step with them.
--
-- The client writes the sentences. The rows carry which org acted, so each
-- side can say "you" for itself and the company's name for the other.
-- ---------------------------------------------------------------------------

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
    select e.created_at, 'payment_' || e.to_state::text,
           case e.actor_kind when 'brand' then o.brand_org_id
                             when 'factory' then o.factory_org_id end,
           m.title, p.amount_cents::text
      from public.payment_events e
      join public.order_payments p on p.id = e.payment_id
      join public.order_milestones m on m.id = p.milestone_id
      join o on o.id = p.order_id
     where e.to_state in ('due', 'sent', 'confirmed', 'released')

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


-- ---------------------------------------------------------------------------
-- approve_milestone: approve from the update, without "send for approval"
-- ---------------------------------------------------------------------------
-- The design review (Oct 2) took "send for approval" off the screens: the
-- factory posts its update, and the brand approves from it. So a step that is
-- still ACTIVE may now be approved, once the factory has posted at least one
-- update on it. A SUBMITTED step is approvable exactly as before, so the
-- current site's "Send for approval" keeps working.
--
-- Unchanged from 20260905000800 apart from that one check: same name, same
-- arguments, same owner rule on a paying step, same outcomes (a paying step
-- becomes approved and its payment due; any other step completes and the
-- chain moves on).
-- ---------------------------------------------------------------------------

create or replace function public.approve_milestone(target_milestone uuid, note text default null)
returns public.order_milestones
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.order_milestones;
  o public.production_orders;
  p public.order_payments;
begin
  select * into o from public.production_orders
   where id = (select order_id from public.order_milestones where id = target_milestone)
   for update;
  if not found then
    raise exception 'milestone not found' using errcode = 'P0002';
  end if;

  select * into m from public.order_milestones where id = target_milestone for update;

  if o.status <> 'active' then
    raise exception 'this order is %', o.status using errcode = '22023';
  end if;

  if m.kind = 'payment_only' then
    raise exception 'there is nothing to approve on a payment step' using errcode = '22023';
  end if;

  -- Approving a sample makes money due, so it takes an owner, matching
  -- award_quote. Signing off a lab dip does not, and requiring an owner for
  -- every colour approval would put the founder in the middle of daily work.
  if m.kind = 'approval_and_payment' then
    if not public.is_org_owner(o.brand_org_id) then
      raise exception 'approving a step that releases a payment is limited to a brand owner'
        using errcode = '42501';
    end if;
  elsif not public.is_org_member(o.brand_org_id) then
    raise exception 'only the brand on this order approves its steps' using errcode = '42501';
  end if;

  -- Also the double-approve guard: a second concurrent call blocks on the row
  -- lock above, then reads the new state and lands here.
  --
  -- An ACTIVE step is approvable once the factory has posted on it: the brand
  -- approves from the update it has seen. Before anything is posted there is
  -- nothing to approve, and a brand's own comment is not the factory's work.
  if m.state = 'active' then
    if not exists (
      select 1 from public.milestone_updates u
       where u.milestone_id = m.id and u.author_org_id = o.factory_org_id
    ) then
      raise exception 'the factory has not posted an update on "%" yet, so there is nothing to approve', m.title
        using errcode = '22023';
    end if;
  elsif m.state <> 'submitted' then
    raise exception 'that step is %, so it is not waiting on you', m.state
      using errcode = '22023';
  end if;

  if m.kind = 'approval_and_payment' then
    update public.order_milestones
       set state = 'approved', approved_by = auth.uid(), approved_at = now(),
           approval_note = nullif(btrim(coalesce(note, '')), '')
     where id = m.id
    returning * into m;

    update public.order_payments
       set state = 'due', due_at = now()
     where milestone_id = m.id and state = 'not_due'
    returning * into p;

    insert into public.payment_events (payment_id, from_state, to_state, actor_user_id, actor_kind)
    values (p.id, 'not_due', 'due', auth.uid(), 'brand');

    insert into public.notifications
      (org_id, kind, subject_type, subject_id, order_id, title, body)
    values (
      o.brand_org_id, 'payment_due', 'payment', p.id, o.id,
      format('%s is due on %s', public.format_money(p.amount_cents, p.currency), o.order_number),
      format('You approved "%s". Wire the payment, then mark it sent.', m.title)
    );

    insert into public.notifications
      (org_id, kind, subject_type, subject_id, order_id, title, body)
    values (
      o.factory_org_id, 'milestone_approved', 'milestone', m.id, o.id,
      format('"%s" was approved', m.title),
      'The brand has approved this step. Payment follows once it is confirmed.'
    );
  else
    update public.order_milestones
       set state = 'complete', approved_by = auth.uid(), approved_at = now(),
           approval_note = nullif(btrim(coalesce(note, '')), ''), completed_at = now()
     where id = m.id
    returning * into m;

    insert into public.notifications
      (org_id, kind, subject_type, subject_id, order_id, title, body)
    values (
      o.factory_org_id, 'milestone_approved', 'milestone', m.id, o.id,
      format('"%s" was approved', m.title),
      coalesce(nullif(btrim(coalesce(note, '')), ''), 'You can carry on to the next step.')
    );

    perform public.advance_order_chain(o.id);
  end if;

  return m;
end;
$$;

revoke all on function public.approve_milestone(uuid, text) from public;
grant execute on function public.approve_milestone(uuid, text) to authenticated;
