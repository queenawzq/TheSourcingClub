-- ============================================================================
-- Card-only wording
-- ----------------------------------------------------------------------------
-- Brands now fund payments by card only, so
-- nothing the brand or the factory reads may still offer a bank account or
-- say a payment takes four business days to clear. Wording only:
--
--   record_payment_processing  the factory's "on its way" notification no
--                              longer calls it a bank payment
--   record_payment_failed      nor does the factory's "did not go through"
--   advance_order_chain        the brand's "is due" notification says to fund
--                              it by card
--
-- Each is the definition from 20261013000200_stripe_payments.sql with only
-- those strings changed: same signature, return type, security and body, and
-- create or replace keeps the grants and revokes made there.
--
-- Privacy policy: the current version, without the sentence saying a brand
-- may pay by US bank account, published as the next version (a new row, as
-- every legal change is; rows are never edited). Built from whatever version
-- is current rather than a fixed one, because other branches publish
-- privacy versions too and merge order decides the numbers. If the sentence
-- is already gone (a database that got a card-only version another way),
-- nothing is published.
-- Notifications already sent keep their wording.
-- ============================================================================

-- The brand's payment is on its way; it has not been confirmed.
create or replace function public.record_payment_processing(
  target_payment uuid,
  method_type text,
  method_label text
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
  was public.payment_state;
begin
  select * into o from public.production_orders
   where id = (select order_id from public.order_payments where id = target_payment)
   for update;
  select * into p from public.order_payments where id = target_payment for update;
  if not found then
    raise exception 'payment not found' using errcode = 'P0002';
  end if;

  if p.state not in ('due', 'failed') then
    return p;
  end if;
  was := p.state;

  update public.order_payments
     set state = 'processing', processing_at = now(),
         payment_method_type = coalesce(method_type, payment_method_type),
         payment_method_label = coalesce(method_label, payment_method_label),
         failure_reason = null
   where id = p.id
  returning * into p;

  insert into public.payment_events (payment_id, from_state, to_state, actor_kind)
  values (p.id, was, 'processing', 'system');

  select * into m from public.order_milestones where id = p.milestone_id;

  -- Told carefully, like "sent" always was: on its way is not arrived.
  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  values (
    o.factory_org_id, 'payment_processing', 'payment', p.id, o.id,
    format('A payment for "%s" is on its way', m.title),
    format('%s on %s. Stripe is still confirming it. We will tell you when TSC holds it; please do not start this work yet.',
           public.format_money(p.amount_cents, p.currency), o.order_number)
  );

  return p;
end;
$$;

-- The payment did not go through. The brand can pay again.
create or replace function public.record_payment_failed(target_payment uuid, reason text)
returns public.order_payments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p public.order_payments;
  o public.production_orders;
  m public.order_milestones;
  was public.payment_state;
  why text := coalesce(nullif(btrim(coalesce(reason, '')), ''), 'The payment did not go through.');
begin
  select * into o from public.production_orders
   where id = (select order_id from public.order_payments where id = target_payment)
   for update;
  select * into p from public.order_payments where id = target_payment for update;
  if not found then
    raise exception 'payment not found' using errcode = 'P0002';
  end if;

  if p.state not in ('due', 'processing') then
    return p;
  end if;
  was := p.state;

  update public.order_payments
     set state = 'failed', failed_at = now(), failure_reason = why
   where id = p.id
  returning * into p;

  insert into public.payment_events (payment_id, from_state, to_state, actor_kind, note)
  values (p.id, was, 'failed', 'system', why);

  select * into m from public.order_milestones where id = p.milestone_id;

  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  values (
    o.brand_org_id, 'payment_failed', 'payment', p.id, o.id,
    format('Your payment for "%s" did not go through', m.title),
    format('%s Pay again from the step''s payment page on %s.', why, o.order_number)
  );

  -- The factory was told a payment was on its way; tell it that it is not.
  if was = 'processing' then
    insert into public.notifications
      (org_id, kind, subject_type, subject_id, order_id, title, body)
    values (
      o.factory_org_id, 'payment_failed', 'payment', p.id, o.id,
      format('The payment for "%s" did not go through', m.title),
      format('Nothing is held for this step on %s yet. The brand has been asked to pay again.', o.order_number)
    );
  end if;

  return p;
end;
$$;

-- advance_order_chain: a step involving money falls due as it opens, and the
-- brand is asked to fund it by card.
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

  -- A step that involves money is funded as it opens: TSC holds the money
  -- while the work happens and pays it on when the brand approves.
  update public.order_payments p
     set state = 'due', due_at = now()
    from public.order_milestones m
   where m.id = p.milestone_id
     and m.order_id = target_order
     and m.sort = next_sort
     and m.kind in ('payment_only', 'approval_and_payment')
     and p.state = 'not_due';

  insert into public.payment_events (payment_id, from_state, to_state, actor_kind)
  select p.id, 'not_due', 'due', 'system'
  from public.order_payments p
  join public.order_milestones m on m.id = p.milestone_id
  where m.order_id = target_order and m.sort = next_sort
    -- Only the ones this call made due (due_at is this transaction's now()).
    and m.kind in ('payment_only', 'approval_and_payment') and p.state = 'due'
    and p.due_at >= now();

  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  select o.brand_org_id, 'payment_due', 'payment', p.id, o.id,
         format('%s is due on %s', public.format_money(p.amount_cents, p.currency), o.order_number),
         format('"%s". Fund it by card; TSC holds it until the step is done.', m.title)
  from public.order_payments p
  join public.order_milestones m on m.id = p.milestone_id
  where m.order_id = target_order and m.sort = next_sort
    and m.kind in ('payment_only', 'approval_and_payment') and p.state = 'due'
    and p.due_at >= now();
end;
$$;

do $$
declare
  current_version integer;
  current_text    text;
  bank constant text := $t$When a brand pays by card or US bank account, the card or bank details are entered into Stripe's form and sent directly to Stripe; bank accounts may be verified through Stripe Financial Connections.$t$;
  card constant text := $t$When a brand pays by card, the card details are entered into Stripe's form and sent directly to Stripe.$t$;
begin
  select d.version, d.full_en into current_version, current_text
    from public.legal_documents d
   where d.kind = 'privacy'
   order by d.version desc
   limit 1;
  if current_text is null or position(bank in current_text) = 0 then
    return;
  end if;

  insert into public.legal_documents (kind, version, onboarding_en, onboarding_zh, full_en, full_zh)
  values ('privacy', current_version + 1, null, null, replace(current_text, bank, card), null);
end;
$$;
