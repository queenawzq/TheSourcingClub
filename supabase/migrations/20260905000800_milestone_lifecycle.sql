-- ============================================================================
-- 033  Milestone lifecycle
-- ----------------------------------------------------------------------------
-- The factory posts updates and says when a step is ready; the brand approves.
-- The party that benefits from a step being finished is never the party that
-- declares it finished.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Advancing the chain — internal, never granted
-- ---------------------------------------------------------------------------
-- "Every milestone at a strictly LOWER sort is terminal", not "the previous
-- milestone is complete". Sort ties are how parallel work is expressed — a lab
-- dip and a strike-off running together — and the naive phrasing silently
-- skips the second half of a tied pair.
--
-- Terminal means complete or cancelled, and explicitly NOT approved. An
-- approved-but-unpaid milestone still blocks. That is how "work starts once
-- an admin confirms the money" is expressed structurally, rather than as
-- advisory text on a screen.
-- ---------------------------------------------------------------------------

create or replace function public.advance_order_chain(target_order uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  next_sort integer;
  o         public.production_orders;
begin
  select * into o from public.production_orders where id = target_order;

  select min(sort) into next_sort
  from public.order_milestones
  where order_id = target_order
    and state not in ('complete', 'cancelled');

  if next_sort is null then
    update public.production_orders
       set status = 'completed', completed_at = now()
     where id = target_order and status = 'active';

    insert into public.notifications
      (org_id, kind, subject_type, subject_id, order_id, title, body)
    select org_id, 'order_completed', 'order', o.id, o.id,
           format('%s is complete', o.order_number),
           'Every step on this order is done.'
    from (select o.brand_org_id as org_id union all select o.factory_org_id) parties;
    return;
  end if;

  -- Nothing opens while an earlier step is still outstanding.
  if exists (
    select 1 from public.order_milestones
    where order_id = target_order
      and sort < next_sort
      and state not in ('complete', 'cancelled')
  ) then
    return;
  end if;

  update public.order_milestones
     set state = 'active'
   where order_id = target_order and sort = next_sort and state = 'pending';

  -- A payment-only step has nothing to do but pay, so its money falls due the
  -- moment it opens.
  update public.order_payments p
     set state = 'due', due_at = now()
    from public.order_milestones m
   where m.id = p.milestone_id
     and m.order_id = target_order
     and m.sort = next_sort
     and m.kind = 'payment_only'
     and p.state = 'not_due';

  insert into public.payment_events (payment_id, from_state, to_state, actor_kind)
  select p.id, 'not_due', 'due', 'system'
  from public.order_payments p
  join public.order_milestones m on m.id = p.milestone_id
  where m.order_id = target_order and m.sort = next_sort
    and m.kind = 'payment_only' and p.state = 'due';

  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  select o.brand_org_id, 'payment_due', 'payment', p.id, o.id,
         format('%s is due on %s', public.format_money(p.amount_cents, p.currency), o.order_number),
         format('"%s". Wire it, then mark it sent so we can confirm it arrived.', m.title)
  from public.order_payments p
  join public.order_milestones m on m.id = p.milestone_id
  where m.order_id = target_order and m.sort = next_sort
    and m.kind = 'payment_only' and p.state = 'due';
end;
$$;

revoke all on function public.advance_order_chain(uuid) from public;

-- Small shared formatter so a notification body and a screen agree.
create or replace function public.format_money(cents bigint, currency char(3))
returns text
language sql immutable
as $$ select case when currency = 'USD' then '$' else currency || ' ' end
              || to_char(cents / 100.0, 'FM999,999,990.00'); $$;

grant execute on function public.format_money(bigint, char) to authenticated;

-- ---------------------------------------------------------------------------
-- The factory posts an update
-- ---------------------------------------------------------------------------
-- Definer rather than a plain insert policy because attaching the photos has
-- to be atomic with creating the update, and because each document has to be
-- checked — letting a client set documents.milestone_update_id itself is the
-- read-amplification hole that documents_link_guard also closes.
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
  m   public.order_milestones;
  o   public.production_orders;
  u   public.milestone_updates;
  doc public.documents;
  d   uuid;
begin
  select * into m from public.order_milestones where id = target_milestone;
  if not found then
    raise exception 'milestone not found' using errcode = 'P0002';
  end if;

  select * into o from public.production_orders where id = m.order_id for share;

  if not public.is_org_member(o.factory_org_id) then
    raise exception 'only the factory on this order posts updates' using errcode = '42501';
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
  values (m.id, o.factory_org_id, btrim(body), auth.uid())
  returning * into u;

  foreach d in array coalesce(document_ids, '{}') loop
    select * into doc from public.documents where id = d;
    if not found then
      raise exception 'one of those files does not exist' using errcode = 'P0002';
    end if;
    if doc.org_id <> o.factory_org_id then
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
    o.brand_org_id, 'milestone_update', 'milestone', m.id, o.id,
    format('New update on "%s"', m.title),
    left(btrim(body), 160)
  );

  return u;
end;
$$;

revoke all on function public.post_milestone_update(uuid, text, uuid[]) from public;
grant execute on function public.post_milestone_update(uuid, text, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- The factory says a step is ready
-- ---------------------------------------------------------------------------

create or replace function public.submit_milestone(target_milestone uuid)
returns public.order_milestones
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.order_milestones;
  o public.production_orders;
begin
  select * into m from public.order_milestones where id = target_milestone for update;
  if not found then
    raise exception 'milestone not found' using errcode = 'P0002';
  end if;

  select * into o from public.production_orders where id = m.order_id;

  if not public.is_org_member(o.factory_org_id) then
    raise exception 'only the factory sends a step for approval' using errcode = '42501';
  end if;
  if o.status <> 'active' then
    raise exception 'this order is %', o.status using errcode = '22023';
  end if;
  if m.kind = 'payment_only' then
    raise exception 'a payment step has nothing to send for approval' using errcode = '22023';
  end if;
  if m.state <> 'active' then
    raise exception 'that step is %, not open work', m.state using errcode = '22023';
  end if;

  update public.order_milestones
     set state = 'submitted', submitted_at = now()
   where id = m.id
  returning * into m;

  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  values (
    o.brand_org_id, 'milestone_submitted', 'milestone', m.id, o.id,
    format('"%s" is ready for you', m.title),
    'The factory has sent this step for your approval.'
  );

  return m;
end;
$$;

revoke all on function public.submit_milestone(uuid) from public;
grant execute on function public.submit_milestone(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The brand approves
-- ---------------------------------------------------------------------------
-- Locks the ORDER first, then the milestone, and every function in this schema
-- does the same. set_order_schedule locks the order then deletes milestones;
-- taking them in the other order here would deadlock the two under any real
-- concurrency.
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
  if m.state <> 'submitted' then
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
