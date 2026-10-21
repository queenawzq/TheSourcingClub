-- ============================================================================
-- Quotes: materials charged separately, expired quotes, and trust tiers
-- ----------------------------------------------------------------------------
-- 1. Materials marked not included reach the order. The quote form tells the
--    vendor "Costs marked not included are added on top of the quoted unit
--    price", and quote_material_lines stores them (included = false,
--    cost_cents per unit), but the order made at award left them out: the
--    brand compared one total and was asked to fund another.
--    quote_additional_material_per_unit() is that per-unit figure, the same
--    sum as additionalMaterialPerUnitCents() in src/lib/domain/quote.js.
--    create_order_from_award puts it times the quantity into the bulk
--    subtotal, so the deposit and balance (one side computed, the other
--    subtracted, as before) and the order total include it.
--    admin_quote_queue's total is the same definition as quoteTotalCents()
--    again.
--
-- 2. submit_quote refuses a quote whose valid_until has passed, before it
--    charges. It used to send it and take 25 credits, and award_quote then
--    refused it as expired. Same test as award_quote: valid_until <
--    current_date.
--
-- 3. admin_review_decision_with_tier with no tier keeps the factory's tier.
--    It reset the factory to basic, so re-approving a Verified factory from
--    a caller that sends no tier quietly took its badge away.
--
-- 4. guard_factory_trust_tier lets a factory's upsert repeat the tier it
--    already has. The INSERT half of an upsert forced basic before ON
--    CONFLICT DO UPDATE ran, so saving a Verified profile through upsert was
--    a change of tier and refused. A new row is still forced to basic; for
--    an existing row the UPDATE half compares old and new tiers as before.
--
-- Safe with the old site live: one new function; the five redefined keep
-- their names, arguments and return types. The old site awards through
-- award_quote, which calls create_order_from_award unchanged in shape; a
-- quote with no material lines (every quote the old site can write) makes
-- exactly the order it did. The new refusals are errors the old site
-- already shows. Re-runnable: every statement is create or replace,
-- revoke or grant.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Materials charged separately
-- ---------------------------------------------------------------------------

create or replace function public.quote_additional_material_per_unit(target_quote uuid)
returns bigint
language sql
stable
as $$
  select coalesce(sum(cost_cents), 0)::bigint
  from public.quote_material_lines
  where quote_id = target_quote
    and not included;
$$;

revoke all on function public.quote_additional_material_per_unit(uuid) from public;
grant execute on function public.quote_additional_material_per_unit(uuid) to authenticated;

-- 031's function, with the materials added to the bulk subtotal. Everything
-- else is as it was.
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

-- 20260912000100's queue, with the same total as quoteTotalCents().
create or replace function public.admin_quote_queue(row_limit integer default 200)
returns table (
  quote_id        uuid,
  rfq_id          uuid,
  rfq_title       text,
  brand_org_id    uuid,
  brand_name      text,
  factory_org_id  uuid,
  factory_name    text,
  status          public.quote_status,
  version         integer,
  total_cents     bigint,
  currency        char(3),
  submitted_at    timestamptz,
  decided_at      timestamptz
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
    q.id,
    r.id,
    r.title,
    r.brand_org_id,
    b.name,
    q.factory_org_id,
    f.name,
    q.status,
    q.version,
    -- Production plus samples plus materials charged separately, the same
    -- definition quoteTotalCents() uses in src/lib/domain/quote.js. bigint
    -- because unit_price_cents * production_quantity overflows int4 at
    -- 100,000 units of a $250 jacket.
    case
      when q.unit_price_cents is null or q.production_quantity is null then null
      else q.unit_price_cents::bigint * q.production_quantity
             + public.quote_additional_material_per_unit(q.id) * q.production_quantity
             + coalesce(public.quote_sample_subtotal(q.id), 0)
    end,
    q.currency,
    q.submitted_at,
    q.decided_at
  from public.quotes q
  join public.rfqs r on r.id = q.rfq_id
  join public.orgs b on b.id = r.brand_org_id
  join public.orgs f on f.id = q.factory_org_id
  where q.status <> 'draft'
  order by coalesce(q.submitted_at, q.created_at) desc
  limit greatest(row_limit, 1);
end;
$$;

revoke all on function public.admin_quote_queue(integer) from public;
grant execute on function public.admin_quote_queue(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. An expired quote is not sent, and not charged for
-- ---------------------------------------------------------------------------
-- 064's function (20260930000200), with the expiry test before the charge.

create or replace function public.submit_quote(quote_id uuid)
returns public.quotes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
    'Compare it with the other quotes on this request.'
  );

  return q;
end;
$$;

revoke all on function public.submit_quote(uuid) from public;
grant execute on function public.submit_quote(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. No tier given keeps the tier the factory has
-- ---------------------------------------------------------------------------
-- 20261021000100's function. A tier that is given is checked against the
-- evidence as before; none given changes nothing (a first approval stays at
-- the column's default, basic).

create or replace function public.admin_review_decision_with_tier(
  target_org uuid,
  decision   public.org_review_state,
  note       text default null,
  risk       public.org_review_risk default null,
  tier       public.factory_trust_tier default null
)
returns public.org_reviews
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  decided     public.org_reviews;
  eligibility jsonb;
  chosen      public.factory_trust_tier;
begin
  if not public.is_platform_admin() then
    raise exception 'only platform admins may decide a review' using errcode = '42501';
  end if;

  if decision = 'approved' and exists (
    select 1 from public.factory_profiles f where f.org_id = target_org
  ) then
    chosen := tier;
    if chosen is not null then
      eligibility := public.admin_factory_tier_eligibility(target_org);

      if chosen = 'verified' and not (eligibility ->> 'eligibleVerified')::boolean then
        raise exception 'Verified requires a production walkthrough' using errcode = '22023';
      end if;
      if chosen = 'trusted' and not (eligibility ->> 'eligibleTrusted')::boolean then
        raise exception 'Trusted requires a walkthrough, completed on-time Club orders, and visible quality history'
          using errcode = '22023';
      end if;
    end if;
  elsif tier is not null then
    raise exception 'trust tiers may only be assigned when approving a factory profile' using errcode = '22023';
  end if;

  decided := public.admin_review_decision(target_org, decision, note, risk);

  if decision = 'approved' and chosen is not null then
    update public.factory_profiles set trust_tier = chosen where org_id = target_org;
  end if;

  return decided;
end;
$$;

revoke all on function public.admin_review_decision_with_tier(
  uuid, public.org_review_state, text, public.org_review_risk, public.factory_trust_tier
) from public;
grant execute on function public.admin_review_decision_with_tier(
  uuid, public.org_review_state, text, public.org_review_risk, public.factory_trust_tier
) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. An upsert may repeat the tier it already has
-- ---------------------------------------------------------------------------
-- 20261022000100's trigger function; the trigger itself is unchanged. The
-- lookup runs as the caller, and factory_profiles_read lets a member read its
-- own row; a row the caller cannot see is one it cannot write either.

create or replace function public.guard_factory_trust_tier()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user not in ('authenticated', 'anon') or public.is_platform_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- A new row starts at basic whatever it asks for. When the row already
    -- exists this INSERT is the first half of an upsert that becomes an
    -- UPDATE (a plain insert fails on the key), and that UPDATE is checked
    -- below against the tier the row really has.
    if not exists (select 1 from public.factory_profiles f where f.org_id = new.org_id) then
      new.trust_tier := 'basic';
    end if;
  elsif new.trust_tier is distinct from old.trust_tier then
    raise exception 'only TSC staff can change a factory''s trust tier'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_factory_trust_tier() from public, anon, authenticated;

notify pgrst, 'reload schema';
