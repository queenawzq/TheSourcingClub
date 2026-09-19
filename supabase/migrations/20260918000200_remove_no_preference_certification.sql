-- An empty certification selection already means that the brand has no
-- preference. Keeping a selectable taxonomy term for the same state creates
-- a contradictory answer when it is chosen alongside real certifications.
-- Existing links are removed automatically through the term_id cascade.
delete from public.taxonomy_terms
 where kind = 'certification'
   and slug = 'no-preference'
   and org_id is null;
