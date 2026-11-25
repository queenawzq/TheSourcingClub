-- The review card's target price, regions and certifications, in the brand's
-- own words.
--
-- Like timeline_text and product_type (20261124607100): the composer stores
-- the price as cents and the regions and certifications as taxonomy links,
-- which is what matching and the vendors' screens read. A resumed draft read
-- "$18-$22 per unit FOB" back as "$18–$22", "China, Vietnam" as "China" (no
-- term for Vietnam) and so on, and saving again kept the rewritten words. The
-- typed line is kept beside the parsed value; the parsed value stays the one
-- everything else reads.
--
-- Additive only: the live site neither reads nor writes these columns, and
-- the table's existing grants and policies cover them.

alter table public.rfqs
  add column if not exists price_text text,
  add column if not exists regions_text text,
  add column if not exists certifications_text text;
