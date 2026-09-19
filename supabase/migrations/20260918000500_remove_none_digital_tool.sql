-- Digital tools are optional, so an empty selection already represents none.
-- Existing profile links are removed through the term_id cascade.
delete from public.taxonomy_terms
 where kind = 'digital_tool'
   and slug = 'none'
   and org_id is null;
