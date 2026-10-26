-- Brand approval does not require a factory comment; retain all money and role guards.
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

  -- Approving a paid step releases money, so it takes an owner, matching
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

  -- Active or submitted steps can be approved without a comment. Completed
  -- and future steps remain protected, including concurrent approvals.
  if m.state not in ('active', 'submitted') then
    raise exception 'that step is %, so it is not waiting on you', m.state
      using errcode = '22023';
  end if;

  if m.kind = 'approval_and_payment' then
    select * into p from public.order_payments where milestone_id = m.id for update;

    -- Approving pays the factory, so there has to be money to pay it with.
    if not found or p.state <> 'confirmed' then
      raise exception 'fund "%" first: TSC pays the factory from the money it holds when you approve',
        m.title using errcode = '22023';
    end if;

    update public.order_milestones
       set state = 'complete', approved_by = auth.uid(), approved_at = now(),
           approval_note = nullif(btrim(coalesce(note, '')), ''), completed_at = now()
     where id = m.id
    returning * into m;

    update public.order_payments
       set release_requested_at = now()
     where id = p.id
    returning * into p;

    insert into public.notifications
      (org_id, kind, subject_type, subject_id, order_id, title, body)
    values (
      o.factory_org_id, 'milestone_approved', 'milestone', m.id, o.id,
      format('"%s" was approved', m.title),
      coalesce(
        nullif(btrim(coalesce(note, '')), ''),
        format('The brand approved this step. %s held by TSC is on its way to you.',
               public.format_money(p.amount_cents, p.currency))
      )
    );

    -- The chain moves on the brand's approval, never on the payout: a
    -- transfer that fails must not freeze the order.
    perform public.advance_order_chain(o.id);
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
