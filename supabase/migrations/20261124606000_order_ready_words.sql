-- ============================================================================
-- The brand's "order is ready" notice names who did what (flow check B4)
-- ----------------------------------------------------------------------------
-- award_quote() told the brand "<factory> accepted. Review the production
-- steps…", but it is the brand that accepts the factory's quote. Only that
-- sentence changes; the function is otherwise as it stands
-- (20261107570000_leftover_words_and_bank_fee.sql and later). Same signature,
-- so its grants are kept. Notices already written keep their words.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.award_quote(quote_id uuid)
 RETURNS quotes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    format('You accepted %s''s quote. Review the production steps, then confirm them to start.',
           factory_name)
  );

  return q;
end;
$function$;
