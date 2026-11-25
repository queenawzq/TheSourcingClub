-- ============================================================================
-- A minimum order is often a range ("100-200 件 / 款"), and only its first
-- number was kept: a vendor that typed 100-200 was shown to brands as
-- "100/style" (flow check R3f7), as lead times were before 20261124601000.
-- ----------------------------------------------------------------------------
-- moq stays the low end (matching and Browse's MOQ filter keep reading it);
-- the high end is added beside it. Null means a single figure. Additive only.
-- ============================================================================

alter table public.factory_profiles
  add column if not exists moq_max integer;

alter table public.factory_profiles
  add constraint factory_profiles_moq_max_check
    check (moq_max is null or (moq is not null and moq_max >= moq));
