-- ============================================================================
-- Notices that spoke about the reader in the third person, or said what was
-- not there (flow check R2m7)
-- ----------------------------------------------------------------------------
-- * activate_order(): the brand read "The brand confirmed the production
--   steps" about its own action. The brand now reads "You confirmed…"; the
--   factory's words are unchanged.
-- * submit_quote(): "Compare it with the other quotes on this request." was
--   sent with only one quote. It is said only when another vendor's quote is
--   submitted on the request; otherwise the notice has no body.
-- * decline_cancellation(): the proposer's notice "<decliner> wants to keep
--   the order" carried the proposer's own reason as its body, so it read as
--   the decliner's words. The decliner gives no reason; the body says only
--   "The order continues."
-- Each function is otherwise as it stands on the stack (pg_get_functiondef).
-- Same signatures, so their grants are kept. Notices already written keep
-- their words.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.activate_order(target_order uuid)
 RETURNS production_orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  o public.production_orders;
begin
  update public.production_orders
     set status = 'active', activated_at = now()
   where id = target_order
  returning * into o;

  -- Payments come into existence now, not at award: the numbers have stopped
  -- moving, so there is nothing left to keep in step.
  insert into public.order_payments (order_id, milestone_id, amount_cents, currency, fee_bps)
  select m.order_id, m.id, m.amount_cents, m.currency, 0
  from public.order_milestones m
  where m.order_id = o.id
    and m.kind in ('approval_and_payment', 'payment_only');

  perform public.advance_order_chain(o.id);

  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  select org_id, 'order_activated', 'order', o.id, o.id,
         format('%s is under way', o.order_number),
         case when parties.org_id = o.brand_org_id
           then 'You confirmed the production steps. The first step is open.'
           else 'The brand confirmed the production steps. The first step is open.' end
  from (select o.brand_org_id as org_id union all select o.factory_org_id) parties;

  return o;
end;
$function$;

CREATE OR REPLACE FUNCTION public.submit_quote(quote_id uuid)
 RETURNS quotes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  q       public.quotes;
  r       public.rfqs;
  missing text[] := '{}';
  cost    integer := public.quote_credit_cost();
  balance integer;
  vendor  text;
begin
  select * into q from public.quotes where id = quote_id for update;
  if not found then
    raise exception 'quote not found' using errcode = 'P0002';
  end if;

  perform public.require_org_permission(q.factory_org_id, 'rfqFlow');
  if not public.is_org_member(q.factory_org_id) then
    raise exception 'only the quoting factory may submit this quote'
      using errcode = '42501';
  end if;

  if q.status <> 'draft' then
    raise exception 'quote is %, only a draft can be submitted', q.status
      using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.factory_profiles f
    where f.org_id = q.factory_org_id and f.verification_status = 'verified'
  ) then
    raise exception 'factory must be verified before quoting'
      using errcode = '42501';
  end if;

  select * into r from public.rfqs where id = q.rfq_id;
  if r.status <> 'open' then
    raise exception 'this request is %, and is no longer accepting quotes', r.status
      using errcode = '22023';
  end if;

  if r.quote_deadline is not null and now() > r.quote_deadline then
    raise exception 'the deadline for this request passed on %', r.quote_deadline
      using errcode = '22023';
  end if;

  -- Name every missing field at once rather than making the factory discover
  -- them one submit at a time.
  if q.unit_price_cents    is null then missing := array_append(missing, 'unit price'); end if;
  if q.production_quantity is null then missing := array_append(missing, 'production quantity'); end if;
  if q.bulk_lead_time_days is null then missing := array_append(missing, 'bulk lead time'); end if;
  if q.payment_term_id     is null then missing := array_append(missing, 'payment terms'); end if;
  if q.incoterm_id         is null then missing := array_append(missing, 'shipping terms'); end if;
  if q.valid_until         is null then missing := array_append(missing, 'quote valid until'); end if;

  if array_length(missing, 1) > 0 then
    raise exception 'quote is missing: %', array_to_string(missing, ', ')
      using errcode = '22023';
  end if;

  -- The same test award_quote makes, so a quote is never sent (and paid for)
  -- that the brand could not then choose. Before the charge.
  if q.valid_until < current_date then
    raise exception 'this quote expired on %; choose a later "quote valid until" date and send it again', q.valid_until
      using errcode = '22023';
  end if;

  -- Charged before the status changes, so a vendor who cannot pay never
  -- reaches "submitted". The message names the shortfall because the screen
  -- offers to buy credits and needs something true to say.
  balance := public.credit_balance(q.factory_org_id);
  if balance < cost then
    raise exception 'sending this quote costs % credits and you have %', cost, balance
      using errcode = '22023';
  end if;

  insert into public.credit_ledger (org_id, delta, reason, ref_type, ref_id, note)
  values (q.factory_org_id, -cost, 'quote_submission', 'quote', q.id,
          'Quote sent to ' || coalesce(r.title, 'a request'))
  -- Matches credit_ledger_once_idx, which is partial on ref_id.
  on conflict (org_id, reason, ref_id) where ref_id is not null do nothing;

  update public.quotes
     set status = 'submitted',
         submitted_at = now()
   where id = quote_id
  returning * into q;

  update public.rfq_invitations
     set status = 'viewed'
   where rfq_id = q.rfq_id
     and factory_org_id = q.factory_org_id
     and status = 'invited';

  -- New in 064. A second version is a revision the brand has already seen a
  -- first price for, so it is named as one.
  select name into vendor from public.orgs where id = q.factory_org_id;
  insert into public.notifications (org_id, kind, subject_type, subject_id, title, body)
  values (
    r.brand_org_id,
    'quote_received',
    'rfq',
    r.id,
    format('%s sent a %s on "%s"',
           coalesce(vendor, 'A vendor'),
           case when q.version > 1 then 'revised quote' else 'quote' end,
           coalesce(nullif(btrim(r.title), ''), 'your request')),
    -- Only when another vendor's quote is there to compare it with.
    case when exists (
      select 1 from public.quotes other
       where other.rfq_id = q.rfq_id
         and other.factory_org_id <> q.factory_org_id
         and other.status = 'submitted'
    ) then 'Compare it with the other quotes on this request.' end
  );

  return q;
end;
$function$;

CREATE OR REPLACE FUNCTION public.decline_cancellation(target_order uuid)
 RETURNS production_orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  o        public.production_orders;
  mine     uuid;
  proposer uuid;
begin
  select * into o from public.production_orders where id = target_order for update;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;

  mine := case
    when public.is_org_member(o.brand_org_id) then o.brand_org_id
    when public.is_org_member(o.factory_org_id) then o.factory_org_id
  end;

  if mine is null then
    raise exception 'only a party to this order may decline a cancellation' using errcode = '42501';
  end if;
  if o.status not in ('pending_schedule', 'active') then
    raise exception 'this order is % already', o.status using errcode = '22023';
  end if;
  if o.cancel_proposed_by_org is null then
    raise exception 'nobody has proposed cancelling this order' using errcode = '22023';
  end if;
  if mine = o.cancel_proposed_by_org then
    raise exception 'the side that proposed it withdraws it; the other side keeps the order'
      using errcode = '42501';
  end if;

  proposer := o.cancel_proposed_by_org;

  update public.production_orders
     set cancel_proposed_by_org = null,
         cancel_proposed_at = null,
         cancel_reason = null
   where id = o.id
  returning * into o;

  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  select
    proposer, 'cancellation_declined', 'order', o.id, o.id,
    format('%s: %s wants to keep the order', o.order_number, g.name),
    'The order continues.'
  from public.orgs g where g.id = mine;

  return o;
end;
$function$;
