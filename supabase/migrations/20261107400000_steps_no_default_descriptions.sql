-- ============================================================================
-- A generated production step has no description (Queena, Nov 6).
--
-- The generator wrote a sentence about the process on every step, and "30.00%
-- of the production total" read as a bug. A step now carries only what someone
-- typed: the factory's "includes" on a sample line, or the brand's own words in
-- the steps editor.
--
-- create_order_from_award is 20261022000400's, with those five values changed.
-- Existing steps lose exactly the generator's words; anything else stays.
-- Safe with the live site running: no signature or column changes, and the
-- screens already draw a step with no description.
-- ============================================================================

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

  -- Production at the quoted unit price, plus the materials the factory
  -- marked not included, which it adds on top of that price for every unit.
  -- The same total the brand compared (quoteTotalCents in quote.js).
  bulk    := q.unit_price_cents::bigint * q.production_quantity
             + public.quote_additional_material_per_unit(q.id) * q.production_quantity;
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
      line.includes,
      line.id, line.cost_cents, o.currency
    );
  end loop;

  if deposit > 0 then
    insert into public.order_milestones
      (order_id, sort, kind, title, description, amount_cents, currency)
    values (
      o.id, 1000, 'payment_only', 'Bulk deposit',
      null,
      deposit, o.currency
    );
  end if;

  insert into public.order_milestones (order_id, sort, kind, title, description, currency)
  values (
    o.id, 1100, 'progress_only', 'Bulk production',
    null,
    o.currency
  );

  insert into public.order_milestones (order_id, sort, kind, title, description, currency)
  values (
    o.id, 1200, 'approval_only', 'QC photos',
    null,
    o.currency
  );

  if balance > 0 then
    insert into public.order_milestones
      (order_id, sort, kind, title, description, amount_cents, currency)
    values (
      o.id, 1300, 'payment_only', 'Final balance',
      null,
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

update public.order_milestones
   set description = null
 where description in (
         'Factory prepares this sample and posts photos for approval.',
         'The brand approves finished-goods photos before the balance falls due.',
         'The remainder of the production total, once QC photos are approved.'
       )
    or description ~ '^[0-9.]+% of the production total, paid before bulk materials are bought\.$'
    or description ~ '^Cutting and sewing\. The factory quoted (a lead time of|[0-9]+) days from approval\.$';
