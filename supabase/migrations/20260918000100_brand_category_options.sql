-- ============================================================================
-- Brand category, as the design now asks it
-- ----------------------------------------------------------------------------
-- The designed field is "Brand category *  Select all that apply" — a dropdown
-- of checkboxes with eight options. `brand_category` in migration 007 still
-- carries the four single-choice values the design asked for in September:
-- fashion brand, retailer, emerging designer, private label. The live mount
-- takes its option list from this table, not from the design's array, so a
-- brand was being shown four choices where the design draws eight, and three
-- of the four were words the design had stopped using.
--
-- Written by hand rather than generated: migration 007 is immutable and
-- supabase/seed/taxonomy.json regenerates only that file. The same reason
-- migration 043 gives.
--
-- The three retired slugs are remapped rather than dropped, because
-- brand_profiles.brand_category stores a slug and a dangling one would show a
-- brand an empty required field it had already answered:
--
--     fashion-brand      -> direct-to-consumer-brand
--     emerging-designer  -> direct-to-consumer-brand
--     retailer           -> physical-retailer
--
-- Their old labels survive as aliases on the term that replaced them, so text
-- arriving with the old wording still resolves.
--
-- This is also the point where the answer stops being one value. "Select all
-- that apply" means the full set lives in taxonomy_links like every other
-- multi-choice group; the column keeps the first choice so that everything
-- already reading it — the review card, the admin queue, match scoring — is
-- unchanged rather than newly null.
-- ============================================================================

insert into public.taxonomy_terms (kind, slug, label_en, label_zh, sort, aliases) values
  ('brand_category', 'direct-to-consumer-brand',           'Direct-to-consumer brand',           null, 1, '{"Fashion brand","Emerging designer","DTC"}'),
  ('brand_category', 'e-commerce-retailer',                'E-commerce retailer',                null, 2, '{}'),
  ('brand_category', 'physical-retailer',                  'Physical retailer',                  null, 3, '{"Retailer"}'),
  ('brand_category', 'wholesale-brand',                    'Wholesale brand',                    null, 4, '{}'),
  ('brand_category', 'multi-brand-retailer-marketplace',   'Multi-brand retailer / marketplace',  null, 6, '{}'),
  ('brand_category', 'distributor-importer',               'Distributor / importer',              null, 7, '{}'),
  ('brand_category', 'other',                              'Other',                               null, 8, '{}')
on conflict (kind, slug) where org_id is null do update
  set label_en = excluded.label_en,
      sort     = excluded.sort,
      aliases  = excluded.aliases;

-- Already present from 007, and still one of the eight. Only its place in the
-- list changes.
update public.taxonomy_terms
   set sort = 5
 where kind = 'brand_category'
   and slug = 'private-label'
   and org_id is null;

-- Answers first, then the terms that held them.
update public.brand_profiles
   set brand_category = 'direct-to-consumer-brand'
 where brand_category in ('fashion-brand', 'emerging-designer');

update public.brand_profiles
   set brand_category = 'physical-retailer'
 where brand_category = 'retailer';

-- taxonomy_links has term_id on delete cascade, so any link to a retired term
-- goes with it. None exist today: brand_category has only ever been stored on
-- the column.
delete from public.taxonomy_terms
 where kind = 'brand_category'
   and org_id is null
   and slug in ('fashion-brand', 'retailer', 'emerging-designer');
