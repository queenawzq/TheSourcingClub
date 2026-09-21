-- ============================================================================
-- The answers a trading company gives, somewhere to put them
-- ----------------------------------------------------------------------------
-- The vendor onboarding has two copies: a factory one and a trading-company
-- one. Only the factory copy's labels were in COLUMN_FOR_LABEL, so every
-- free-text answer on the trading copy was collected, shown back on the
-- review step, and then dropped on the floor at save.
--
-- That included the company's NAME. A trading company finished onboarding
-- with factory_profiles.legal_name still null, which is why they arrive in
-- the verification queue with a blank legal name and score zero on the field
-- that asks for one -- the reviewer sees a company that looks like it never
-- filled the form in, when in fact it did and we threw the answers away.
--
-- Six of the labels map onto columns that already exist (name, location,
-- team size, minimum order, lead time, about). These five had nowhere to go.
-- ============================================================================
alter table public.factory_profiles
  -- "Languages supported". Free text: a network answering "English, Mandarin,
  -- Portuguese" is more useful to a reviewer than a constrained list would be,
  -- and this is read by people rather than matched on.
  add column if not exists languages_supported text,

  -- "Typical order value". A band, like the brand side's order_size_band,
  -- because vendors answer a range more readily than a number.
  add column if not exists typical_order_value_band text,

  -- "Number of active partner factories". The one genuinely numeric answer
  -- here, and the one a reviewer uses to sanity-check the claim.
  add column if not exists partner_factory_count integer
    check (partner_factory_count is null or partner_factory_count >= 0),

  -- "Supported Incoterms" and "Typical payment terms". Free text rather than
  -- taxonomy ids: these are the trading company's own words about how it
  -- trades, read by a reviewer, never matched against anything. The quote
  -- flow's incoterm and payment-split TERMS are separate and stay on the
  -- taxonomy, where matching does happen.
  add column if not exists supported_incoterms text,
  add column if not exists typical_payment_terms text,

  -- "Typical Sample Lead Time", on the factory copy. Asked since the flow was
  -- built and never stored: the label had no entry in COLUMN_FOR_LABEL either.
  add column if not exists sample_lead_days integer
    check (sample_lead_days is null or sample_lead_days >= 0);

comment on column public.factory_profiles.languages_supported is
  'Free text. Read by a reviewer, never matched on.';
comment on column public.factory_profiles.partner_factory_count is
  'Trading companies only. Factories leave it null.';
