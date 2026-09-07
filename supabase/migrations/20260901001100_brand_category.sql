-- ============================================================================
-- 011  Brand category
-- ----------------------------------------------------------------------------
-- The onboarding design asks "what kind of business are you" — fashion brand,
-- retailer, emerging designer, private label — and 003 had nowhere to put the
-- answer. Stored as the taxonomy slug rather than a foreign key, matching the
-- other single-choice band columns on this table; the vocabulary itself lives
-- in taxonomy_terms under kind 'brand_category'.
-- ============================================================================

alter table public.brand_profiles
  add column if not exists brand_category text;

comment on column public.brand_profiles.brand_category is
  'taxonomy_terms.slug where kind = ''brand_category''';
