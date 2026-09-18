-- ============================================================================
-- 042  Trading companies
-- ----------------------------------------------------------------------------
-- The designs treat a trading company as a third kind of vendor: its own
-- onboarding copy, its own profile page, its own filter in the admin queue. It
-- sources from a network of factories rather than manufacturing itself.
--
-- It is NOT a third org_type. That enum is `('brand', 'factory')` and it is
-- read by every policy, every `or is_platform_admin()` branch, current_org_ids()
-- and the whole Phase 2-4 access surface. Adding a value there means revisiting
-- every one of them to answer "and what about trading companies?" — for a
-- distinction that changes what a vendor *is*, not what it may *do*. A trading
-- company quotes on requests, wins orders, gets paid and is verified through
-- exactly the same rules as a factory.
--
-- So it is a column on the profile: same org type, same policies, different
-- vocabulary on screen. Additive, and nothing existing has to change.
--
-- Existing rows are manufacturers, which is what they were when they signed up.
-- ============================================================================

create type public.vendor_kind as enum ('manufacturer', 'trading_company');

alter table public.factory_profiles
  add column if not exists vendor_kind public.vendor_kind not null default 'manufacturer';

comment on column public.factory_profiles.vendor_kind is
  'Manufacturer or trading company. Drives onboarding copy and profile layout only — never access.';

create index factory_profiles_vendor_kind_idx
  on public.factory_profiles (vendor_kind)
  where vendor_kind = 'trading_company';
