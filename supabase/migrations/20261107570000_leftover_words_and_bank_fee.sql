-- ============================================================================
-- Notification words left over from Nov 7, and the fee on a bank payment
-- ----------------------------------------------------------------------------
-- Rows already written stay as they are (notifications are immutable); only
-- the functions that write them change. Each function below is its latest
-- definition with only the lines named here changed:
--
-- record_payment_processing (20261022000200): the factory's "on its way"
--   notice said "Stripe is still confirming it". No provider is named to a
--   brand or a factory (Queena): it is "still being confirmed".
-- record_payment_funded (20261107540000): the brand's "$95.00 received. TSC
--   holds it" body named no order. It now carries the order number, which
--   notification_project_name() (20261107500200) turns into "Title (TSC-…)".
-- award_quote (20261104100000): "Your quote was accepted" said nothing of
--   which request; the title now names it, as the declined body already did.
-- confirm_payment_received (20260905000900): the old site's bank-wire path
--   recorded the step amount as received and told the brand that figure,
--   without TSC's fee. It now records and says the step plus the fee, as the
--   card path does (charged_cents), unless staff typed what arrived.
-- ============================================================================

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

  -- Told carefully, and without naming who confirms it (Queena).
  -- Told carefully, like "sent" always was: on its way is not arrived.
  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  values (
    o.factory_org_id, 'payment_processing', 'payment', p.id, o.id,
    format('A payment for "%s" is on its way', m.title),
    format('%s on %s. It is still being confirmed. We will tell you when TSC holds it; please do not start this work yet.',
           public.format_money(p.amount_cents, p.currency), o.order_number)
  );

  return p;
end;
$$;

CREATE OR REPLACE FUNCTION public.record_payment_funded(target_payment uuid, charge text, method_type text, method_label text, received bigint)
 RETURNS order_payments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  p public.order_payments;
  o public.production_orders;
  m public.order_milestones;
  was public.payment_state;
  pays_out boolean := false;
begin
  select * into o from public.production_orders
   where id = (select order_id from public.order_payments where id = target_payment)
   for update;
  select * into p from public.order_payments where id = target_payment for update;
  if not found then
    raise exception 'payment not found' using errcode = 'P0002';
  end if;

  if p.state in ('confirmed', 'released') then
    return p;
  end if;
  -- A cancelled payment can still be charged (a bank payment already on its
  -- way when the order was cancelled): the money arrived, so record it.
  -- Staff see it held on a cancelled order and refund it.
  was := p.state;

  select * into m from public.order_milestones where id = p.milestone_id for update;

  -- Nothing to approve on a payment-only step; a step approved under the old
  -- rules (approve first, pay after) was waiting only for this.
  pays_out := o.status = 'active'
    and (m.kind = 'payment_only' or m.state = 'approved');

  update public.order_payments
     set state = 'confirmed', confirmed_at = now(), confirmed_by = null,
         amount_received_cents = coalesce(received, p.charged_cents, p.amount_cents),
         stripe_charge_id = coalesce(charge, stripe_charge_id),
         payment_method_type = coalesce(method_type, payment_method_type),
         payment_method_label = coalesce(method_label, payment_method_label),
         failure_reason = null,
         release_requested_at = case when pays_out then now() else release_requested_at end
   where id = p.id
  returning * into p;

  insert into public.payment_events (payment_id, from_state, to_state, actor_kind)
  values (p.id, was, 'confirmed', 'system');

  if pays_out then
    update public.order_milestones
       set state = 'complete', completed_at = now()
     where id = m.id and state in ('active', 'approved');
    perform public.advance_order_chain(o.id);
  end if;

  if o.status = 'active' then
    insert into public.notifications
      (org_id, kind, subject_type, subject_id, order_id, title, body)
    values (
      o.factory_org_id, 'payment_confirmed', 'payment', p.id, o.id,
      format('Payment held for "%s"', m.title),
      case when pays_out
        then format('TSC received %s on %s and will send it to you%s.',
                    public.format_money(p.amount_cents, p.currency), o.order_number,
                    case when public.factory_has_no_payout_method(o.factory_org_id)
                         then ' once you add a withdrawal method' else '' end)
        else format('TSC holds %s for this step on %s. You can start this work; it is paid to you when the brand approves it.',
                    public.format_money(p.amount_cents, p.currency), o.order_number)
      end
    );

    insert into public.notifications
      (org_id, kind, subject_type, subject_id, order_id, title, body)
    values (
      o.brand_org_id, 'payment_confirmed', 'payment', p.id, o.id,
      format('Your payment for "%s" is funded', m.title),
      case when pays_out
        then format('%s received on %s. TSC will pay the factory.',
                    public.format_money(p.charged_cents, p.currency), o.order_number)
        else format('%s received on %s. TSC holds it and pays the factory when you approve this step.',
                    public.format_money(coalesce(p.charged_cents, p.amount_cents), p.currency), o.order_number)
      end
    );
  end if;

  return p;
end;
$function$
;

create or replace function public.award_quote(quote_id uuid)
returns public.quotes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  q            public.quotes;
  r            public.rfqs;
  o            public.production_orders;
  factory_name text;
  rfq_title    text;
begin
  select * into q from public.quotes where id = quote_id for update;
  if not found then
    raise exception 'quote not found' using errcode = 'P0002';
  end if;

  -- Locking the RFQ as well as the quote is load-bearing, not defensive. Two
  -- brand members awarding two different quotes on the same RFQ milliseconds
  -- apart would otherwise both pass the "is it open" check below and the RFQ
  -- would end with two accepted quotes.
  select * into r from public.rfqs where id = q.rfq_id for update;

  perform public.require_org_permission(r.brand_org_id, 'rfqFlow');
  if not public.is_org_member(r.brand_org_id) then
    raise exception 'only the requesting brand may award a quote'
      using errcode = '42501';
  end if;

  if r.status <> 'open' then
    raise exception 'this request is %, so it cannot be awarded', r.status
      using errcode = '22023';
  end if;

  -- Covers draft, withdrawn, already decided, and — the one that matters —
  -- superseded. A brand reads a quote, the factory revises it, the brand
  -- awards the row it was looking at. That must be refused, not accepted.
  if q.status <> 'submitted' then
    raise exception 'this quote is % and cannot be awarded; the factory may have revised it', q.status
      using errcode = '22023';
  end if;

  if q.valid_until is not null and q.valid_until < current_date then
    raise exception 'this quote expired on %', q.valid_until
      using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.factory_profiles f
    where f.org_id = q.factory_org_id and f.verification_status = 'verified'
  ) then
    raise exception 'this factory is no longer verified'
      using errcode = '22023';
  end if;

  select name into factory_name from public.orgs where id = q.factory_org_id;
  rfq_title := coalesce(nullif(btrim(r.title), ''), 'your request');

  update public.quotes
     set status = 'accepted', decided_at = now()
   where id = quote_id
  returning * into q;

  -- Only other LIVE submissions are declined. Superseded, draft and withdrawn
  -- rows are already out of the running and keep their own history.
  update public.quotes
     set status = 'declined', decided_at = now()
   where rfq_id = r.id
     and id <> quote_id
     and status = 'submitted';

  update public.rfqs
     set status = 'awarded',
         awarded_quote_id = quote_id,
         awarded_at = now()
   where id = r.id;

  -- The order and its draft schedule, in this same transaction. A window in
  -- which a quote is accepted but its order does not exist would be a state
  -- with no screen and no way out.
  o := public.create_order_from_award(quote_id);

  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  select
    d.factory_org_id,
    case when d.factory_org_id = q.factory_org_id then 'quote_accepted' else 'quote_declined' end,
    case when d.factory_org_id = q.factory_org_id then 'order' else 'rfq' end,
    case when d.factory_org_id = q.factory_org_id then o.id else r.id end,
    case when d.factory_org_id = q.factory_org_id then o.id else null end,
    case
      when d.factory_org_id = q.factory_org_id then
        coalesce('Your quote for "' || nullif(btrim(r.title), '') || '" was accepted',
                 'Your quote was accepted')
      else 'Your quote was not selected'
    end,
    case
      when d.factory_org_id = q.factory_org_id
        then format('%s accepted your quote for "%s". The brand is setting the production steps; you will be told when they start.',
                    (select name from public.orgs where id = r.brand_org_id), rfq_title)
      else format('"%s" was awarded to another factory. Thank you for quoting.', rfq_title)
    end
  from (
    select distinct factory_org_id
    from public.quotes
    where rfq_id = r.id and status in ('accepted', 'declined')
  ) d;

  -- The brand has something to do now too, and nothing else would tell it.
  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  values (
    r.brand_org_id, 'order_created', 'order', o.id, o.id,
    format('Production order %s is ready', o.order_number),
    format('%s accepted. Review the production steps drafted from their quote, then confirm them to start.',
           factory_name)
  );

  return q;
end;
$$;

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
  charged bigint;
begin
  if not public.is_platform_admin() then
    raise exception 'confirming a payment is limited to platform staff' using errcode = '42501';
  end if;

  select * into p from public.order_payments where id = target_payment for update;
  if not found then
    raise exception 'payment not found' using errcode = 'P0002';
  end if;

  if p.state <> 'sent' then
    raise exception 'that payment is %; only one marked sent can be confirmed', p.state
      using errcode = '22023';
  end if;

  select * into o from public.production_orders where id = p.order_id for update;
  select * into m from public.order_milestones where id = p.milestone_id for update;

  -- What the brand pays is the step plus TSC's fee, as on the card path:
  -- the fee is added to the brand's payment and the factory gets the step.
  charged := coalesce(p.charged_cents, p.amount_cents + public.payment_fee_cents(p.id));

  update public.order_payments
     set state = 'confirmed', confirmed_by = auth.uid(), confirmed_at = now(),
         charged_cents = charged,
         amount_received_cents = coalesce(amount_received, charged),
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
           public.format_money(charged, p.currency))
  );

  return p;
end;
$$;
