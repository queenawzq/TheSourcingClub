-- Preserve the fourth sourcing option instead of collapsing "Not sure yet"
-- into a missing value. Readouts can therefore repeat the brand's exact choice.
insert into public.taxonomy_terms (kind, slug, label_en, label_zh, sort, extra)
values (
  'sourcing_responsibility',
  'unsure',
  'Not sure yet',
  '暂不确定',
  4,
  '{"note":"The brand has not decided who will source materials and components."}'::jsonb
)
on conflict (kind, slug) where org_id is null do nothing;
