-- Both onboarding groups provide an "Add your own" control. A separate
-- generic "Other" option duplicates that path without capturing the detail.
-- Existing profile links are removed through the term_id cascade.
delete from public.taxonomy_terms
 where kind in ('production_type', 'product_category')
   and slug = 'other'
   and org_id is null;
