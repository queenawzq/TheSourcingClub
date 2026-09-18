-- ============================================================================
-- 031  Awarding creates the order
-- ----------------------------------------------------------------------------
-- Award was a dead end: the RFQ was stamped, everyone was notified, and then
-- nothing. This closes it into production work, in the same transaction, so
-- there is no window in which a quote is accepted and the order it implies
-- does not exist.
--
-- Nobody faces a blank schedule. The accepted quote already contains the
-- sample stages, the lead time and the deposit split, so the milestones are
-- derived from it and then edited, rather than typed from nothing by a brand
-- who may never have manufactured anything before.
-- ============================================================================

-- Not granted to anyone. A security definer function calls another with the
-- owner's rights, so award_quote can call this while a client cannot.
create or replace function public.create_order_from_award(target_quote uuid)
returns public.production_orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  q        public.quotes;
  r        public.rfqs;
  o        public.production_orders;
  dep_pct  numeric(5,2);
  bulk     bigint;
  samples  bigint;
  deposit  bigint;
  balance  bigint;
  line     record;
  position integer := 0;
  scheduled bigint;
begin
  select * into q from public.quotes where id = target_quote;
  if not found then
    raise exception 'quote not found' using errcode = 'P0002';
  end if;
  if q.status <> 'accepted' then
    raise exception 'only an accepted quote becomes an order' using errcode = '22023';
  end if;

  select * into r from public.rfqs where id = q.rfq_id;

  -- deposit_pct is NULLABLE on quotes — submit_quote() does not require it, so
  -- an accepted quote may genuinely have none. Left uncoalesced, the schedule
  -- below totals only the sample lines, agree_schedule then refuses it
  -- forever, and the order is dead with nothing on screen explaining why.
  dep_pct := coalesce(q.deposit_pct, 0);

  bulk    := q.unit_price_cents::bigint * q.production_quantity;
  samples := public.quote_sample_subtotal(q.id)::bigint;

  -- Compute one side and SUBTRACT for the other. Rounding both independently
  -- from percentages loses or invents a cent at 33.33% — permanently, on a
  -- figure a brand types into a bank transfer, where one cent looks like a
  -- typo and costs a support conversation.
  deposit := floor(bulk * dep_pct / 100);
  balance := bulk - deposit;

  insert into public.production_orders (
    rfq_id, quote_id, brand_org_id, factory_org_id,
    unit_price_cents, production_quantity,
    bulk_subtotal_cents, sample_subtotal_cents, order_total_cents, currency,
    bulk_lead_time_days, deposit_pct, balance_pct,
    incoterm_id, payment_term_id,
    capacity_window_start, capacity_window_end,
    agreed_scope
  ) values (
    r.id, q.id, r.brand_org_id, q.factory_org_id,
    q.unit_price_cents, q.production_quantity,
    bulk, samples, bulk + samples, q.currency,
    q.bulk_lead_time_days, dep_pct, 100 - dep_pct,
    q.incoterm_id, q.payment_term_id,
    q.capacity_window_start, q.capacity_window_end,
    nullif(btrim(coalesce(r.brief, '')), '')
  )
  returning * into o;

  -- ── the derived schedule ─────────────────────────────────────────────────
  -- Sample stages first, in the order the factory quoted them. Each is work
  -- the brand reviews AND pays for, so both halves apply.
  for line in
    select * from public.quote_sample_lines where quote_id = q.id order by sort, stage
  loop
    position := position + 10;
    insert into public.order_milestones
      (order_id, sort, kind, title, description, source_sample_line_id, amount_cents, currency)
    values (
      o.id, position, 'approval_and_payment', line.stage,
      coalesce(line.includes, 'Factory prepares this sample and posts photos for approval.'),
      line.id, line.cost_cents, o.currency
    );
  end loop;

  if deposit > 0 then
    insert into public.order_milestones
      (order_id, sort, kind, title, description, amount_cents, currency)
    values (
      o.id, 1000, 'payment_only', 'Bulk deposit',
      format('%s%% of the production total, paid before bulk materials are bought.', dep_pct),
      deposit, o.currency
    );
  end if;

  insert into public.order_milestones (order_id, sort, kind, title, description, currency)
  values (
    o.id, 1100, 'progress_only', 'Bulk production',
    format('Cutting and sewing. The factory quoted %s days from approval.',
           coalesce(q.bulk_lead_time_days::text, 'a lead time of')),
    o.currency
  );

  insert into public.order_milestones (order_id, sort, kind, title, description, currency)
  values (
    o.id, 1200, 'approval_only', 'QC photos',
    'The brand approves finished-goods photos before the balance falls due.',
    o.currency
  );

  if balance > 0 then
    insert into public.order_milestones
      (order_id, sort, kind, title, description, amount_cents, currency)
    values (
      o.id, 1300, 'payment_only', 'Final balance',
      'The remainder of the production total, once QC photos are approved.',
      balance, o.currency
    );
  end if;

  -- The schedule must total the contract. If this ever fires it means the
  -- derivation is wrong, and emitting a schedule nobody can ever agree to
  -- would be a far worse outcome than refusing the award.
  select coalesce(sum(amount_cents), 0) into scheduled
  from public.order_milestones where order_id = o.id;

  if scheduled <> o.order_total_cents then
    raise exception 'the generated schedule totals % but the order is %',
      scheduled, o.order_total_cents using errcode = '22023';
  end if;

  -- No payment rows here. The schedule is still editable, and keeping payments
  -- in step with edits is a synchronisation problem with no upside. They are
  -- created at activation, once the numbers have stopped moving.

  return o;
end;
$$;

revoke all on function public.create_order_from_award(uuid) from public;

-- ---------------------------------------------------------------------------
-- award_quote gains one line
-- ---------------------------------------------------------------------------
-- Replaced whole rather than patched, since Postgres has no way to add a
-- statement to an existing function. The only changes from migration 020 are
-- the create_order_from_award call and the winner's notification carrying the
-- order rather than the RFQ.
-- ---------------------------------------------------------------------------

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

  if not public.is_org_owner(r.brand_org_id) then
    raise exception 'only an owner of the requesting brand may award a quote'
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
      when d.factory_org_id = q.factory_org_id then 'Your quote was accepted'
      else 'Your quote was not selected'
    end,
    case
      when d.factory_org_id = q.factory_org_id
        then format('%s accepted your quote for "%s". Agree the production schedule to begin.',
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
    format('%s accepted. Review the schedule we drafted from their quote, then agree it to start.',
           factory_name)
  );

  return q;
end;
$$;

revoke all on function public.award_quote(uuid) from public;
grant execute on function public.award_quote(uuid) to authenticated;
