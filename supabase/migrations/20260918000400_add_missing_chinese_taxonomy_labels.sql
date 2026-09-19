-- Prevent Chinese onboarding screens from falling back to English for these
-- product-category and region options.
update public.taxonomy_terms as term
   set label_zh = translation.label_zh
  from (
    values
      ('product_category', 'womenswear', '女装'),
      ('product_category', 'menswear', '男装'),
      ('region', 'china', '中国'),
      ('region', 'portugal', '葡萄牙'),
      ('region', 'korea', '韩国'),
      ('region', 'europe', '欧洲'),
      ('region', 'india', '印度'),
      ('region', 'turkey', '土耳其'),
      ('region', 'united-states', '美国')
  ) as translation(kind, slug, label_zh)
 where term.kind = translation.kind
   and term.slug = translation.slug
   and term.org_id is null;
