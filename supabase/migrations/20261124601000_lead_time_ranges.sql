-- ============================================================================
-- A lead time is often a range ("45-60 days"), and only its first number was
-- kept: a vendor that typed 45-60 was shown to brands as "45 days".
-- ----------------------------------------------------------------------------
-- typical_lead_days and sample_lead_days stay the low end (matching and the
-- directory's lead-time sort keep reading them); the high end is added beside
-- each. Null means a single figure. Additive only.
-- ============================================================================

alter table public.factory_profiles
  add column if not exists typical_lead_days_max integer,
  add column if not exists sample_lead_days_max integer;

alter table public.factory_profiles
  add constraint factory_profiles_typical_lead_days_max_check
    check (typical_lead_days_max is null or (typical_lead_days is not null and typical_lead_days_max >= typical_lead_days)),
  add constraint factory_profiles_sample_lead_days_max_check
    check (sample_lead_days_max is null or (sample_lead_days is not null and sample_lead_days_max >= sample_lead_days));
