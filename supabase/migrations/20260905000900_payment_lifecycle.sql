-- ============================================================================
-- 034  Payment lifecycle
-- ----------------------------------------------------------------------------
-- Four transitions, three of them admin-only, and every one of them stamped
-- with who and when.
--
-- On why these are functions and not policies: an UPDATE policy's `using`
-- clause can gate the state a row is coming FROM, but its `with check` cannot
-- stop the same statement writing `confirmed_by = auth.uid()` alongside
-- `state = 'sent'`. A policy gates the transition; it cannot gate the payload.
-- So order_payments has no write grant at all and these four own every write.
--
-- On the admin check placement: a security definer function has NO policy
-- behind it. The `or is_platform_admin()` branches on the read policies do not
-- protect this file. An omitted check here is not "RLS will catch it", it is
-- anybody confirming anybody's payment — and a check placed after the row is
-- read leaks existence, since a stranger would learn P0002 from 42501. So the
-- admin test is the first statement in all three, before any select.
-- ============================================================================

create or replace function public.mark_payment_sent(
  target_payment uuid,
  reference text default null,
  note text default null
)
returns public.order_payments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p public.order_payments;
  o public.production_orders;
begin
  select * into p from public.order_payments where id = target_payment for update;
  if not found then
    raise exception 'payment not found' using errcode = 'P0002';
  end if;

  select * into o from public.production_orders where id = p.order_id;

  -- Owner, not member: this is a statement that money left the company.
  if not public.is_org_owner(o.brand_org_id) then
    raise exception 'only a brand owner can record a payment as sent' using errcode = '42501';
  end if;

  if o.status <> 'active' then
    raise exception 'this order is %s', o.status using errcode = '22023';
  end if;

  if p.state <> 'due' then
    raise exception 'that payment is %s, not due', p.state using errcode = '22023';
  end if;

  update public.order_payments
     set state = 'sent', sent_by = auth.uid(), sent_at = now(),
         brand_reference = nullif(btrim(coalesce(reference, '')), ''),
         sent_note = nullif(btrim(coalesce(note, '')), '')
   where id = p.id
  returning * into p;

  insert into public.payment_events (payment_id, from_state, to_state, actor_user_id, actor_kind)
  values (p.id, 'due', 'sent', auth.uid(), 'brand');

  -- The factory is told, and told carefully. "Sent" is the brand's claim, not
  -- an arrival, and nothing here may imply work can start.
  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  values (
    o.factory_org_id, 'payment_sent', 'payment', p.id, o.id,
    format('%s says a payment is on its way', (select name from public.orgs where id = o.brand_org_id)),
    format('%s on %s. We will confirm here once it lands — please do not start on this yet.',
           public.format_money(p.amount_cents, p.currency), o.order_number)
  );

  return p;
end;
$$;

revoke all on function public.mark_payment_sent(uuid, text, text) from public;
grant execute on function public.mark_payment_sent(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- An admin confirms it arrived. This is the gate the whole product rests on.
-- ---------------------------------------------------------------------------

create or replace function public.confirm_payment_received(
  target_payment uuid,
  amount_received bigint default null,
  note text default null
)
returns public.order_payments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p public.order_payments;
  o public.production_orders;
  m public.order_milestones;
begin
  if not public.is_platform_admin() then
    raise exception 'confirming a payment is limited to platform staff' using errcode = '42501';
  end if;

  select * into p from public.order_payments where id = target_payment for update;
  if not found then
    raise exception 'payment not found' using errcode = 'P0002';
  end if;

  if p.state <> 'sent' then
    raise exception 'that payment is %s; only one marked sent can be confirmed', p.state
      using errcode = '22023';
  end if;

  select * into o from public.production_orders where id = p.order_id for update;
  select * into m from public.order_milestones where id = p.milestone_id for update;

  update public.order_payments
     set state = 'confirmed', confirmed_by = auth.uid(), confirmed_at = now(),
         amount_received_cents = coalesce(amount_received, p.amount_cents),
         confirmed_note = nullif(btrim(coalesce(note, '')), '')
   where id = p.id
  returning * into p;

  insert into public.payment_events (payment_id, from_state, to_state, actor_user_id, actor_kind)
  values (p.id, 'sent', 'confirmed', auth.uid(), 'admin');

  -- The milestone finishes here, on confirmation, NOT on release. Releasing is
  -- downstream bookkeeping; if the chain waited for it, one forgotten admin
  -- click would freeze a production order permanently, with no error and no
  -- party able to unstick it.
  update public.order_milestones
     set state = 'complete', completed_at = now()
   where id = m.id and state in ('active', 'approved');

  perform public.advance_order_chain(o.id);

  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  values (
    o.factory_org_id, 'payment_confirmed', 'payment', p.id, o.id,
    format('Payment confirmed on %s', o.order_number),
    format('%s has arrived for "%s". You can start this work.',
           public.format_money(p.amount_cents, p.currency), m.title)
  );

  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  values (
    o.brand_org_id, 'payment_confirmed', 'payment', p.id, o.id,
    format('Your payment on %s was confirmed', o.order_number),
    format('%s received. The factory has been told to begin.',
           public.format_money(p.amount_cents, p.currency))
  );

  return p;
end;
$$;

revoke all on function public.confirm_payment_received(uuid, bigint, text) from public;
grant execute on function public.confirm_payment_received(uuid, bigint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- ...and an admin can say it did not.
-- ---------------------------------------------------------------------------
-- Without this edge a mis-clicked "payment sent" is unrecoverable: confirm
-- requires money that genuinely arrived, so the order would stall at `sent`
-- for good. The sent stamps are deliberately kept — that a payment was once
-- claimed sent and bounced back is exactly what payment_events is for.
-- ---------------------------------------------------------------------------

create or replace function public.reject_payment_sent(target_payment uuid, note text)
returns public.order_payments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p public.order_payments;
  o public.production_orders;
begin
  if not public.is_platform_admin() then
    raise exception 'this is limited to platform staff' using errcode = '42501';
  end if;

  if length(btrim(coalesce(note, ''))) = 0 then
    raise exception 'say why it was not received; the brand sees this' using errcode = '22023';
  end if;

  select * into p from public.order_payments where id = target_payment for update;
  if not found then
    raise exception 'payment not found' using errcode = 'P0002';
  end if;
  if p.state <> 'sent' then
    raise exception 'that payment is %s', p.state using errcode = '22023';
  end if;

  select * into o from public.production_orders where id = p.order_id;

  update public.order_payments set state = 'due' where id = p.id returning * into p;

  insert into public.payment_events (payment_id, from_state, to_state, actor_user_id, actor_kind, note)
  values (p.id, 'sent', 'due', auth.uid(), 'admin', btrim(note));

  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  values (
    o.brand_org_id, 'payment_rejected', 'payment', p.id, o.id,
    format('We could not find your payment on %s', o.order_number),
    btrim(note)
  );

  return p;
end;
$$;

revoke all on function public.reject_payment_sent(uuid, text) from public;
grant execute on function public.reject_payment_sent(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Released. Terminal: reversing a real bank transfer is not a database
-- operation, so there is no edge back.
-- ---------------------------------------------------------------------------

create or replace function public.release_payment_to_factory(
  target_payment uuid,
  note text default null
)
returns public.order_payments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p public.order_payments;
  o public.production_orders;
begin
  if not public.is_platform_admin() then
    raise exception 'releasing funds is limited to platform staff' using errcode = '42501';
  end if;

  select * into p from public.order_payments where id = target_payment for update;
  if not found then
    raise exception 'payment not found' using errcode = 'P0002';
  end if;
  if p.state <> 'confirmed' then
    raise exception 'that payment is %s; only a confirmed one can be released', p.state
      using errcode = '22023';
  end if;

  select * into o from public.production_orders where id = p.order_id;

  update public.order_payments
     set state = 'released', released_by = auth.uid(), released_at = now(),
         released_note = nullif(btrim(coalesce(note, '')), '')
   where id = p.id
  returning * into p;

  insert into public.payment_events (payment_id, from_state, to_state, actor_user_id, actor_kind)
  values (p.id, 'confirmed', 'released', auth.uid(), 'admin');

  -- Deliberately no milestone or chain effect. The work already opened when
  -- the payment was confirmed.
  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  values (
    o.factory_org_id, 'funds_released', 'payment', p.id, o.id,
    format('%s released to you', public.format_money(p.amount_cents, p.currency)),
    format('Paid out against %s.', o.order_number)
  );

  return p;
end;
$$;

revoke all on function public.release_payment_to_factory(uuid, text) from public;
grant execute on function public.release_payment_to_factory(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The admin queue
-- ---------------------------------------------------------------------------
-- Not a convenience. notifications.org_id is `not null references orgs`, and
-- platform staff have no org — so an admin CANNOT be notified. Without a queue
-- somebody watches, every payment stalls at `sent` and the workflow has no
-- trigger for its third step at all.
--
-- (The tempting fix, a synthetic "platform" org, would leak into
-- current_org_ids() and every `or is_platform_admin()` branch in the schema.
-- Don't.)
-- ---------------------------------------------------------------------------

create or replace function public.admin_payment_queue()
returns table (
  payment_id      uuid,
  state           public.payment_state,
  amount_cents    bigint,
  currency        char(3),
  fee_cents       bigint,
  order_id        uuid,
  order_number    text,
  brand_name      text,
  factory_name    text,
  milestone_title text,
  brand_reference text,
  sent_at         timestamptz,
  confirmed_at    timestamptz,
  payout_summary  text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'this queue is limited to platform staff' using errcode = '42501';
  end if;

  return query
  select
    p.id, p.state, p.amount_cents, p.currency, public.payment_fee_cents(p.id),
    o.id, o.order_number,
    b.name, f.name,
    m.title,
    p.brand_reference,
    p.sent_at, p.confirmed_at,
    coalesce(a.bank_name || ' ····' || coalesce(a.account_number_last4, ''), 'no payout account on file')
  from public.order_payments p
  join public.production_orders o on o.id = p.order_id
  join public.order_milestones m  on m.id = p.milestone_id
  join public.orgs b on b.id = o.brand_org_id
  join public.orgs f on f.id = o.factory_org_id
  left join public.factory_payout_accounts a
    on a.org_id = o.factory_org_id and a.is_primary
  where p.state in ('sent', 'confirmed')
  order by p.state desc, p.sent_at;
end;
$$;

revoke all on function public.admin_payment_queue() from public;
grant execute on function public.admin_payment_queue() to authenticated;
