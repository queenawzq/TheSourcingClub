-- The review card's timeline and product category, in the brand's own words.
--
-- The composer stores the timeline as a month (target_delivery_month) and the
-- category as taxonomy links, which is what matching needs. A resumed draft
-- read them back as "April 2027" and "Tops, Womenswear" where the brand had
-- written "Bulk by April 2027" and "Womenswear / shirts", and saving again
-- kept the rewritten words. The typed line is kept beside the parsed value;
-- the parsed value stays the one everything else reads.
--
-- Additive only: the live site neither reads nor writes these columns, and
-- the table's existing grants and policies cover them.

alter table public.rfqs
  add column if not exists timeline_text text,
  add column if not exists product_type text;
