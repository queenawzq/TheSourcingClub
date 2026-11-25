-- ============================================================================
-- One Chinese name per production type (flow check R3f5). Onboarding's
-- production-type chips (production_type) and its capacity category
-- (capacity_category) named the same two types two ways: 针织裁剪缝制 /
-- 裁剪车缝针织 and 毛衫 / 针织成衣 / 毛衫 / 针织衫. The capacity category takes
-- the production type's hand-written label. Only the old label is replaced,
-- so a label staff have since written is kept.
-- ============================================================================

update public.taxonomy_terms t
   set label_zh = v.label_zh
  from (values
    ('cut-sew-knits', '裁剪车缝针织', '针织裁剪缝制'),
    ('sweaters', '毛衫 / 针织衫', '毛衫 / 针织成衣')
  ) as v(slug, old_zh, label_zh)
 where t.kind = 'capacity_category'
   and t.slug = v.slug
   and t.org_id is null
   and t.label_zh = v.old_zh;
