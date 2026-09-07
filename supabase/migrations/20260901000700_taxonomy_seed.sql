-- ============================================================================
-- 007  Taxonomy seed  (generated from supabase/seed/taxonomy.json)
-- ----------------------------------------------------------------------------
-- Canonical reference data, so this is a migration rather than a local seed:
-- it has to exist in production too. Regenerate with scripts/build-taxonomy.py
-- after editing the JSON; never hand-edit this file.
--
-- Extracted from both prototypes and reconciled. Conflicts resolved here are
-- recorded in the `conflicts` block of the source JSON — notably
-- "United States" vs "USA", three divergent certification lists, and three
-- spellings of the luxury market level.
-- ============================================================================

insert into public.taxonomy_kinds (kind, label_en, allows_custom) values
  ('production_type', 'Production type', true)
on conflict (kind) do nothing;

insert into public.taxonomy_kinds (kind, label_en, allows_custom) values
  ('product_category', 'Product category', true)
on conflict (kind) do nothing;

insert into public.taxonomy_kinds (kind, label_en, allows_custom) values
  ('market_level', 'Market level', false)
on conflict (kind) do nothing;

insert into public.taxonomy_kinds (kind, label_en, allows_custom) values
  ('region', 'Region', false)
on conflict (kind) do nothing;

insert into public.taxonomy_kinds (kind, label_en, allows_custom) values
  ('certification', 'Certification', true)
on conflict (kind) do nothing;

insert into public.taxonomy_kinds (kind, label_en, allows_custom) values
  ('service', 'Service', true)
on conflict (kind) do nothing;

insert into public.taxonomy_kinds (kind, label_en, allows_custom) values
  ('design_service', 'Design service', true)
on conflict (kind) do nothing;

insert into public.taxonomy_kinds (kind, label_en, allows_custom) values
  ('digital_tool', 'Digital tool', false)
on conflict (kind) do nothing;

insert into public.taxonomy_kinds (kind, label_en, allows_custom) values
  ('specialty', 'Specialty', true)
on conflict (kind) do nothing;

insert into public.taxonomy_kinds (kind, label_en, allows_custom) values
  ('make', 'Makes', true)
on conflict (kind) do nothing;

insert into public.taxonomy_kinds (kind, label_en, allows_custom) values
  ('price_point', 'Price point', false)
on conflict (kind) do nothing;

insert into public.taxonomy_kinds (kind, label_en, allows_custom) values
  ('lead_time_band', 'Lead time', false)
on conflict (kind) do nothing;

insert into public.taxonomy_kinds (kind, label_en, allows_custom) values
  ('capacity_category', 'Capacity category', false)
on conflict (kind) do nothing;

insert into public.taxonomy_kinds (kind, label_en, allows_custom) values
  ('brand_category', 'Brand category', false)
on conflict (kind) do nothing;

insert into public.taxonomy_kinds (kind, label_en, allows_custom) values
  ('annual_revenue_band', 'Annual revenue', false)
on conflict (kind) do nothing;

insert into public.taxonomy_kinds (kind, label_en, allows_custom) values
  ('pieces_per_year_band', 'Pieces per year', false)
on conflict (kind) do nothing;

insert into public.taxonomy_kinds (kind, label_en, allows_custom) values
  ('order_size_band', 'Order size', false)
on conflict (kind) do nothing;

insert into public.taxonomy_kinds (kind, label_en, allows_custom) values
  ('collections_per_year', 'Collections per year', false)
on conflict (kind) do nothing;

insert into public.taxonomy_kinds (kind, label_en, allows_custom) values
  ('reorder_cadence', 'Reorder cadence', false)
on conflict (kind) do nothing;

insert into public.taxonomy_kinds (kind, label_en, allows_custom) values
  ('sourcing_stage', 'Sourcing stage', false)
on conflict (kind) do nothing;

insert into public.taxonomy_kinds (kind, label_en, allows_custom) values
  ('client_trust_band', 'Client trust', false)
on conflict (kind) do nothing;

insert into public.taxonomy_kinds (kind, label_en, allows_custom) values
  ('timeline_band', 'Timeline', false)
on conflict (kind) do nothing;

insert into public.taxonomy_kinds (kind, label_en, allows_custom) values
  ('quantity_band', 'Quantity', false)
on conflict (kind) do nothing;

insert into public.taxonomy_kinds (kind, label_en, allows_custom) values
  ('trust_standard', 'Club standard', false)
on conflict (kind) do nothing;

insert into public.taxonomy_kinds (kind, label_en, allows_custom) values
  ('booking_level', 'Booking level', false)
on conflict (kind) do nothing;


-- ---------------------------------------------------------------------------
-- Terms
-- ---------------------------------------------------------------------------

-- production_type: Canonical 8-item list (factory-side factoryProfileEditorOptions.productionTypes and both files' onboarding chip groups agree) reconciled against brand-side brandProfileEditorOptions.garmentFocus (a 6-item variant: Wovens, Cut & sew knits, Knitwear, Denim, Outerwear, Intimates). 'Knitwear' aliased to 'Sweaters / knitwear'; 'Intimates' aliased to 'Intimates / delicate garments'; 'Outerwear' was excluded here because it is actually a product_category value (garmentFocus conflates the two axes). 'Other' was added because the zh onboarding step groups include an extra '其他' item that the English arrays omit.
insert into public.taxonomy_terms (kind, slug, label_en, label_zh, sort, aliases, extra) values
  ('production_type', 'cut-sew-knits', 'Cut & sew knits', '针织裁剪缝制', 1, '{}', '{}'::jsonb),
  ('production_type', 'wovens', 'Wovens', '梭织', 2, '{}', '{}'::jsonb),
  ('production_type', 'sweaters-knitwear', 'Sweaters / knitwear', '毛衫 / 针织成衣', 3, array['Knitwear'], '{}'::jsonb),
  ('production_type', 'denim', 'Denim', '牛仔', 4, '{}', '{}'::jsonb),
  ('production_type', 'seamless-circular-knit', 'Seamless / circular knit', '无缝 / 圆机针织', 5, '{}', '{}'::jsonb),
  ('production_type', 'intimates-delicate-garments', 'Intimates / delicate garments', '内衣 / 精细服装', 6, array['Intimates'], '{}'::jsonb),
  ('production_type', 'leather-suede', 'Leather / suede', '皮革 / 麂皮', 7, '{}', '{}'::jsonb),
  ('production_type', 'bags-soft-goods', 'Bags / soft goods', '包袋 / 软配件', 8, '{}', '{}'::jsonb),
  ('production_type', 'other', 'Other', '其他', 9, '{}', '{}'::jsonb)
on conflict (kind, slug) where org_id is null do nothing;

-- product_category: Canonical 11-item garment-type list (matches factory-side and both files' onboarding chip groups exactly) reconciled against brandProfileEditorOptions.productCategories, a 6-item demographic-segment variant (Womenswear, Menswear, Childrenswear, Activewear, Swimwear, Accessories). Activewear/Swimwear/Accessories were exact duplicates; Childrenswear aliased to 'Childrenswear / baby'; Womenswear and Menswear added as new terms since they describe a buyer-segment axis the garment-type list doesn't cover. 'Other' added because the zh onboarding step groups include an extra '其他' item that the English arrays omit.
insert into public.taxonomy_terms (kind, slug, label_en, label_zh, sort, aliases, extra) values
  ('product_category', 'tops', 'Tops', '上装', 1, '{}', '{}'::jsonb),
  ('product_category', 'bottoms', 'Bottoms', '下装', 2, '{}', '{}'::jsonb),
  ('product_category', 'dresses-jumpsuits', 'Dresses & jumpsuits', '连衣裙 / 连体衣', 3, '{}', '{}'::jsonb),
  ('product_category', 'outerwear', 'Outerwear', '外套', 4, '{}', '{}'::jsonb),
  ('product_category', 'activewear', 'Activewear', '运动服', 5, '{}', '{}'::jsonb),
  ('product_category', 'intimates-underwear', 'Intimates / underwear', '内衣', 6, '{}', '{}'::jsonb),
  ('product_category', 'swimwear', 'Swimwear', '泳装', 7, '{}', '{}'::jsonb),
  ('product_category', 'sleepwear-loungewear', 'Sleepwear / loungewear', '睡衣 / 家居服', 8, '{}', '{}'::jsonb),
  ('product_category', 'childrenswear-baby', 'Childrenswear / baby', '童装 / 婴童', 9, array['Childrenswear'], '{}'::jsonb),
  ('product_category', 'uniforms-workwear', 'Uniforms / workwear', '制服 / 工装', 10, '{}', '{}'::jsonb),
  ('product_category', 'accessories', 'Accessories', '配饰', 11, '{}', '{}'::jsonb),
  ('product_category', 'womenswear', 'Womenswear', null, 12, '{}', '{}'::jsonb),
  ('product_category', 'menswear', 'Menswear', null, 13, '{}', '{}'::jsonb),
  ('product_category', 'other', 'Other', '其他', 14, '{}', '{}'::jsonb)
on conflict (kind, slug) where org_id is null do nothing;

-- market_level: Three spelling variants found: brand onboarding chip group (fullest, with $ price qualifiers), brandProfileEditorOptions (bare label), factory-side onboarding/profile-editor ('Luxury / high-end' instead of 'Luxury'). Canonical label_en keeps the fullest ($-range) wording; the other spellings are recorded as aliases. label_zh comes from the factory-side onboarding zh group.
insert into public.taxonomy_terms (kind, slug, label_en, label_zh, sort, aliases, extra) values
  ('market_level', 'luxury', 'Luxury ($500+)', '奢侈 / 高端', 1, array['Luxury', 'Luxury / high-end'], '{}'::jsonb),
  ('market_level', 'premium-contemporary', 'Premium / contemporary ($100-$500)', '高级成衣 / 当代品牌', 2, array['Premium / contemporary'], '{}'::jsonb),
  ('market_level', 'mid-range', 'Mid range ($50-$100)', '中端市场', 3, array['Mid range'], '{}'::jsonb),
  ('market_level', 'mass-market', 'Mass market (under $50)', '大众市场', 4, array['Mass market'], '{}'::jsonb)
on conflict (kind, slug) where org_id is null do nothing;

-- region: Brand onboarding/profile-editor chip list (6 items, 'United States') reconciled against the directory/marketplace filter panels in both files (7 items, includes 'Europe', uses 'USA'). Canonical uses the fuller 'United States' country name; 'Europe' merged in from the filter list as an additional region. No zh translations of country names were found in either file.
insert into public.taxonomy_terms (kind, slug, label_en, label_zh, sort, aliases, extra) values
  ('region', 'china', 'China', null, 1, '{}', '{"countries": ["CN"]}'::jsonb),
  ('region', 'portugal', 'Portugal', null, 2, '{}', '{"countries": ["PT"]}'::jsonb),
  ('region', 'korea', 'Korea', null, 3, '{}', '{"countries": ["KR"]}'::jsonb),
  ('region', 'europe', 'Europe', null, 4, '{}', '{"countries": ["PT", "ES", "IT", "FR", "DE", "PL", "RO", "BG", "GR", "LT", "HU", "SK", "CZ", "NL", "GB"]}'::jsonb),
  ('region', 'india', 'India', null, 5, '{}', '{"countries": ["IN"]}'::jsonb),
  ('region', 'turkey', 'Turkey', null, 6, '{}', '{"countries": ["TR"]}'::jsonb),
  ('region', 'united-states', 'United States', null, 7, array['USA'], '{"countries": ["US"]}'::jsonb)
on conflict (kind, slug) where org_id is null do nothing;

-- certification: Reconciled 4 divergent lists: brand onboarding/profile-editor (GOTS, OEKO-TEX, BSCI, GRS, WRAP, No preference), directory/marketplace filter panels in both files (GOTS, OEKO-TEX, BSCI, WRAP, Fair Trade -- no GRS or No preference), and factory onboarding's actual-certs-held list (GOTS, OEKO-TEX Standard 100, BSCI). Canonical label uses the fuller 'OEKO-TEX Standard 100'; 'OEKO-TEX' recorded as an alias. 'Business registration' (factory legal/account verification) was intentionally excluded -- it is a verification checkbox, not a product or labor certification. No zh translations exist; certification acronyms are kept in English even on the zh onboarding screen.
insert into public.taxonomy_terms (kind, slug, label_en, label_zh, sort, aliases, extra) values
  ('certification', 'gots', 'GOTS', null, 1, '{}', '{}'::jsonb),
  ('certification', 'oeko-tex-standard-100', 'OEKO-TEX Standard 100', null, 2, array['OEKO-TEX'], '{}'::jsonb),
  ('certification', 'bsci', 'BSCI', null, 3, '{}', '{}'::jsonb),
  ('certification', 'grs', 'GRS', null, 4, '{}', '{}'::jsonb),
  ('certification', 'wrap', 'WRAP', null, 5, '{}', '{}'::jsonb),
  ('certification', 'fair-trade', 'Fair Trade', null, 6, '{}', '{}'::jsonb),
  ('certification', 'no-preference', 'No preference', null, 7, '{}', '{}'::jsonb)
on conflict (kind, slug) where org_id is null do nothing;

-- service: Brand-side 'Services needed' vocabulary (src/prototype/main.jsx onboarding + profile editor). Distinct from the factory-side design_service vocabulary though largely overlapping in intent -- see design_service note for the cross-mapping. No zh translations exist (this file has no Chinese UI).
insert into public.taxonomy_terms (kind, slug, label_en, label_zh, sort, aliases, extra) values
  ('service', 'full-package', 'Full package', null, 1, '{}', '{}'::jsonb),
  ('service', 'cmt', 'CMT', null, 2, '{}', '{}'::jsonb),
  ('service', 'pattern-making', 'Pattern making', null, 3, '{}', '{}'::jsonb),
  ('service', 'sample-development', 'Sample development', null, 4, '{}', '{}'::jsonb),
  ('service', 'fabric-sourcing', 'Fabric sourcing', null, 5, '{}', '{}'::jsonb)
on conflict (kind, slug) where org_id is null do nothing;

-- design_service: Factory-side capability list (onboarding 'Design Services' group and factoryProfileEditorOptions.services, identical in both places). Overlaps conceptually with the brand-side service kind (Full package/CMT/Pattern making/Sample development appear in both under slightly different labels, cross-referenced here via aliases); kept as a separate kind since design_service additionally includes Grading and Tech pack support, which the brand's service list lacks, while service's Fabric sourcing has no design_service counterpart.
insert into public.taxonomy_terms (kind, slug, label_en, label_zh, sort, aliases, extra) values
  ('design_service', 'pattern-making', 'Pattern making', '制版', 1, '{}', '{}'::jsonb),
  ('design_service', 'grading', 'Grading', '放码', 2, '{}', '{}'::jsonb),
  ('design_service', 'sample-development', 'Sample development', '样衣开发', 3, '{}', '{}'::jsonb),
  ('design_service', 'tech-pack-support', 'Tech pack support', 'Tech pack 支持', 4, '{}', '{}'::jsonb),
  ('design_service', 'full-package-fpp', 'Full package (FPP)', '全包生产 FPP', 5, array['Full package'], '{}'::jsonb),
  ('design_service', 'cmt-only', 'CMT only', '仅 CMT', 6, array['CMT'], '{}'::jsonb)
on conflict (kind, slug) where org_id is null do nothing;

-- digital_tool: Factory-side only (factoryProfileEditorOptions.tools and onboarding '3D & digital tools' group), single source, no conflicts.
insert into public.taxonomy_terms (kind, slug, label_en, label_zh, sort, aliases, extra) values
  ('digital_tool', 'clo-3d', 'CLO 3D', 'CLO 3D', 1, '{}', '{}'::jsonb),
  ('digital_tool', 'browzwear', 'Browzwear', 'Browzwear', 2, '{}', '{}'::jsonb),
  ('digital_tool', 'lectra', 'Lectra', 'Lectra', 3, '{}', '{}'::jsonb),
  ('digital_tool', 'gerber', 'Gerber', 'Gerber', 4, '{}', '{}'::jsonb),
  ('digital_tool', 'none', 'None', '无', 5, '{}', '{}'::jsonb)
on conflict (kind, slug) where org_id is null do nothing;

-- specialty: Factory onboarding/profile-editor 'Specializes in' list (8 core items + 2 profile-only items) merged with the brand-side marketplace filter's 'Specializes in' list (5 items). Only 'Wash development' was an exact duplicate. The remaining brand-filter items are near-duplicates of factory items in intent but differ in wording (e.g. 'Small-batch production' vs 'Small-batch export', 'Fit sample support' vs 'Fit sample + PP sample') -- kept as distinct terms rather than merged as aliases since their precise meaning differs; flagged for product-owner review.
insert into public.taxonomy_terms (kind, slug, label_en, label_zh, sort, aliases, extra) values
  ('specialty', 'in-house-pattern-room', 'In-house pattern room', '内部制版房', 1, '{}', '{}'::jsonb),
  ('specialty', 'fit-sample-pp-sample', 'Fit sample + PP sample', '试身样 + 产前样', 2, '{}', '{}'::jsonb),
  ('specialty', 'small-batch-export', 'Small-batch export', '小批量出口', 3, '{}', '{}'::jsonb),
  ('specialty', 'gots-cotton', 'GOTS cotton', 'GOTS 棉', 4, '{}', '{}'::jsonb),
  ('specialty', 'wash-development', 'Wash development', '水洗开发', 5, '{}', '{}'::jsonb),
  ('specialty', 'trim-sourcing', 'Trim sourcing', '辅料采购', 6, '{}', '{}'::jsonb),
  ('specialty', 'qc-photo-updates', 'QC photo updates', 'QC 图片更新', 7, '{}', '{}'::jsonb),
  ('specialty', 'low-moq-sampling', 'Low-MOQ sampling', '低起订量打样', 8, '{}', '{}'::jsonb),
  ('specialty', 'organic-poplin-shirts', 'Organic poplin shirts', null, 9, '{}', '{}'::jsonb),
  ('specialty', 'low-moq-woven-tops', 'Low-MOQ woven tops', null, 10, '{}', '{}'::jsonb),
  ('specialty', 'small-batch-production', 'Small-batch production', null, 11, '{}', '{}'::jsonb),
  ('specialty', 'fit-sample-support', 'Fit sample support', null, 12, '{}', '{}'::jsonb),
  ('specialty', 'yarn-sourcing', 'Yarn sourcing', null, 13, '{}', '{}'::jsonb),
  ('specialty', 'embroidery-print', 'Embroidery / print', null, 14, '{}', '{}'::jsonb)
on conflict (kind, slug) where org_id is null do nothing;

-- make: Factory-side only (onboarding 'Makes' group, factoryProfileEditorOptions.makes, and factoryProfileData.makes all agree), single source, no conflicts.
insert into public.taxonomy_terms (kind, slug, label_en, label_zh, sort, aliases, extra) values
  ('make', 'button-down-shirts', 'Button-down shirts', '纽扣衬衫', 1, '{}', '{}'::jsonb),
  ('make', 'poplin-blouses', 'Poplin blouses', '府绸上衣', 2, '{}', '{}'::jsonb),
  ('make', 'woven-dresses', 'Woven dresses', '梭织连衣裙', 3, '{}', '{}'::jsonb),
  ('make', 'linen-co-ords', 'Linen co-ords', '亚麻套装', 4, '{}', '{}'::jsonb),
  ('make', 'lightweight-jackets', 'Lightweight jackets', '轻薄外套', 5, '{}', '{}'::jsonb),
  ('make', 'pleated-skirts', 'Pleated skirts', '百褶裙', 6, '{}', '{}'::jsonb),
  ('make', 'rib-tops', 'Rib tops', '罗纹上衣', 7, '{}', '{}'::jsonb),
  ('make', 'canvas-totes', 'Canvas totes', '帆布托特包', 8, '{}', '{}'::jsonb),
  ('make', 'denim-jackets', 'Denim jackets', '牛仔夹克', 9, '{}', '{}'::jsonb),
  ('make', 'swim-sets', 'Swim sets', '泳装套装', 10, '{}', '{}'::jsonb)
on conflict (kind, slug) where org_id is null do nothing;

-- price_point: Identical list in both files' 'Price point' filter groups, no conflicts.
insert into public.taxonomy_terms (kind, slug, label_en, label_zh, sort, aliases, extra) values
  ('price_point', 'mass', 'Mass $8-$18', '大众 $8-$18', 1, '{}', '{}'::jsonb),
  ('price_point', 'middle', 'Middle $18-$40', '中端 $18-$40', 2, '{}', '{}'::jsonb),
  ('price_point', 'premium', 'Premium $40-$90', '高级 $40-$90', 3, '{}', '{}'::jsonb),
  ('price_point', 'luxury', 'Luxury $90+', '奢侈 $90+', 4, '{}', '{}'::jsonb)
on conflict (kind, slug) where org_id is null do nothing;

-- lead_time_band: Brand-side directory/marketplace filter only (src/prototype/main.jsx). The factory side only stores lead time as free text (e.g. '30-45 days') on the profile, not as a selectable band list, so no cross-file conflict exists. No zh translation exists (this file has no Chinese UI).
insert into public.taxonomy_terms (kind, slug, label_en, label_zh, sort, aliases, extra) values
  ('lead_time_band', 'under-30-days', 'Under 30 days', null, 1, '{}', '{}'::jsonb),
  ('lead_time_band', '30-45-days', '30-45 days', null, 2, '{}', '{}'::jsonb),
  ('lead_time_band', '45-plus-days', '45+ days', null, 3, '{}', '{}'::jsonb)
on conflict (kind, slug) where org_id is null do nothing;

-- capacity_category: From FACTORY_CAPACITY_CATEGORIES (src/factory-prototype/main.jsx, ~line 3759), single source. Slugs preserve the original `key` values from the array since they are load-bearing identifiers referenced elsewhere in the code (e.g. form.capacityCategoryKey). minutesPerPiece is required for capacity math and captured in extra.
insert into public.taxonomy_terms (kind, slug, label_en, label_zh, sort, aliases, extra) values
  ('capacity_category', 'cut-sew-knits', 'Cut & sew knits', '裁剪车缝针织', 1, '{}', '{"minutes_per_piece": 12, "reference_style_en": "Basic jersey T-shirt", "reference_style_zh": "基础针织 T 恤"}'::jsonb),
  ('capacity_category', 'wovens', 'Wovens', '梭织', 2, '{}', '{"minutes_per_piece": 18, "reference_style_en": "Basic woven shirt", "reference_style_zh": "基础梭织衬衫"}'::jsonb),
  ('capacity_category', 'sweaters', 'Sweaters / knitwear', '毛衫 / 针织衫', 3, '{}', '{"minutes_per_piece": 42, "reference_style_en": "Basic crewneck sweater", "reference_style_zh": "基础圆领毛衫"}'::jsonb),
  ('capacity_category', 'denim', 'Denim', '牛仔', 4, '{}', '{"minutes_per_piece": 34, "reference_style_en": "Five-pocket denim jean", "reference_style_zh": "五袋牛仔裤"}'::jsonb),
  ('capacity_category', 'seamless', 'Seamless / circular knit', '无缝 / 圆机针织', 5, '{}', '{"minutes_per_piece": 9, "reference_style_en": "Seamless knit top", "reference_style_zh": "无缝针织上衣"}'::jsonb),
  ('capacity_category', 'intimates', 'Intimates / delicate garments', '内衣 / 精细服装', 6, '{}', '{"minutes_per_piece": 26, "reference_style_en": "Soft bra or delicate top", "reference_style_zh": "软杯文胸或精细上衣"}'::jsonb),
  ('capacity_category', 'bags', 'Bags / soft goods', '包袋 / 软配件', 7, '{}', '{"minutes_per_piece": 22, "reference_style_en": "Simple tote bag", "reference_style_zh": "基础托特包"}'::jsonb)
on conflict (kind, slug) where org_id is null do nothing;

-- brand_category: Brand onboarding 'Brand category' select (src/prototype/main.jsx, ~line 2062), single source.
insert into public.taxonomy_terms (kind, slug, label_en, label_zh, sort, aliases, extra) values
  ('brand_category', 'fashion-brand', 'Fashion brand', null, 1, '{}', '{}'::jsonb),
  ('brand_category', 'retailer', 'Retailer', null, 2, '{}', '{}'::jsonb),
  ('brand_category', 'emerging-designer', 'Emerging designer', null, 3, '{}', '{}'::jsonb),
  ('brand_category', 'private-label', 'Private label', null, 4, '{}', '{}'::jsonb)
on conflict (kind, slug) where org_id is null do nothing;

-- annual_revenue_band: Brand onboarding trust step select (src/prototype/main.jsx, ~line 2141), single source.
insert into public.taxonomy_terms (kind, slug, label_en, label_zh, sort, aliases, extra) values
  ('annual_revenue_band', 'under-250k', 'Under $250k', null, 1, '{}', '{}'::jsonb),
  ('annual_revenue_band', '250k-1m', '$250k-$1M', null, 2, '{}', '{}'::jsonb),
  ('annual_revenue_band', '1m-5m', '$1M-$5M', null, 3, '{}', '{}'::jsonb),
  ('annual_revenue_band', '5m-plus', '$5M+', null, 4, '{}', '{}'::jsonb)
on conflict (kind, slug) where org_id is null do nothing;

-- pieces_per_year_band: Brand onboarding 'Share your sourcing volume' step, field 'Average pieces ordered per year' (src/prototype/main.jsx, ~line 863), single source.
insert into public.taxonomy_terms (kind, slug, label_en, label_zh, sort, aliases, extra) values
  ('pieces_per_year_band', 'under-1000', 'Under 1,000', null, 1, '{}', '{}'::jsonb),
  ('pieces_per_year_band', '1000-5000', '1,000-5,000', null, 2, '{}', '{}'::jsonb),
  ('pieces_per_year_band', '5000-20000', '5,000-20,000', null, 3, '{}', '{}'::jsonb),
  ('pieces_per_year_band', '20000-100000', '20,000-100,000', null, 4, '{}', '{}'::jsonb),
  ('pieces_per_year_band', '100000-plus', '100,000+', null, 5, '{}', '{}'::jsonb)
on conflict (kind, slug) where org_id is null do nothing;

-- order_size_band: Brand onboarding 'Share your sourcing volume' step, field 'Typical order size per style' (src/prototype/main.jsx, ~line 864), single source. Distinct kind from quantity_band, which buckets RFQ/directory quantities rather than per-style order size.
insert into public.taxonomy_terms (kind, slug, label_en, label_zh, sort, aliases, extra) values
  ('order_size_band', 'under-100', 'Under 100', null, 1, '{}', '{}'::jsonb),
  ('order_size_band', '100-300', '100-300', null, 2, '{}', '{}'::jsonb),
  ('order_size_band', '300-1000', '300-1,000', null, 3, '{}', '{}'::jsonb),
  ('order_size_band', '1000-5000', '1,000-5,000', null, 4, '{}', '{}'::jsonb),
  ('order_size_band', '5000-plus', '5,000+', null, 5, '{}', '{}'::jsonb)
on conflict (kind, slug) where org_id is null do nothing;

-- collections_per_year: Brand onboarding 'Share your sourcing volume' step, field 'Collections per year' (src/prototype/main.jsx, ~line 865), single source.
insert into public.taxonomy_terms (kind, slug, label_en, label_zh, sort, aliases, extra) values
  ('collections_per_year', 'one', '1', null, 1, '{}', '{}'::jsonb),
  ('collections_per_year', 'two', '2', null, 2, '{}', '{}'::jsonb),
  ('collections_per_year', 'three-to-four', '3-4', null, 3, '{}', '{}'::jsonb),
  ('collections_per_year', 'five-to-six', '5-6', null, 4, '{}', '{}'::jsonb),
  ('collections_per_year', 'monthly-drops', 'Monthly drops', null, 5, '{}', '{}'::jsonb)
on conflict (kind, slug) where org_id is null do nothing;

-- reorder_cadence: Brand onboarding 'Share your sourcing volume' step, field 'Typical reorder cadence' (src/prototype/main.jsx, ~line 867), single source.
insert into public.taxonomy_terms (kind, slug, label_en, label_zh, sort, aliases, extra) values
  ('reorder_cadence', 'one-time-seasonal-buys', 'One-time seasonal buys', null, 1, '{}', '{}'::jsonb),
  ('reorder_cadence', 'monthly-reorders', 'Monthly reorders', null, 2, '{}', '{}'::jsonb),
  ('reorder_cadence', 'quarterly-reorders', 'Quarterly reorders', null, 3, '{}', '{}'::jsonb),
  ('reorder_cadence', 'repeat-best-sellers-as-needed', 'Repeat best sellers as needed', null, 4, '{}', '{}'::jsonb)
on conflict (kind, slug) where org_id is null do nothing;

-- sourcing_stage: Brand onboarding 'Share your sourcing volume' step, field 'Current sourcing stage' (src/prototype/main.jsx, ~line 868), single source.
insert into public.taxonomy_terms (kind, slug, label_en, label_zh, sort, aliases, extra) values
  ('sourcing_stage', 'exploring-factories', 'Exploring factories', null, 1, '{}', '{}'::jsonb),
  ('sourcing_stage', 'sampling-soon', 'Sampling soon', null, 2, '{}', '{}'::jsonb),
  ('sourcing_stage', 'ready-for-production', 'Ready for production', null, 3, '{}', '{}'::jsonb),
  ('sourcing_stage', 'replacing-current-supplier', 'Replacing current supplier', null, 4, '{}', '{}'::jsonb)
on conflict (kind, slug) where org_id is null do nothing;

-- client_trust_band: Factory-side 'Client trust' filter used when factories browse brand RFQs (src/factory-prototype/main.jsx, ~line 3704), single source. label_zh for '$10k+ spent' was not found anywhere in the file and was left null rather than invented.
insert into public.taxonomy_terms (kind, slug, label_en, label_zh, sort, aliases, extra) values
  ('client_trust_band', 'payment-verified', 'Payment verified', '付款已验证', 1, '{}', '{}'::jsonb),
  ('client_trust_band', '5k-plus-spent', '$5k+ spent', '已消费 $5k+', 2, '{}', '{}'::jsonb),
  ('client_trust_band', '10k-plus-spent', '$10k+ spent', null, 3, '{}', '{}'::jsonb),
  ('client_trust_band', '25k-plus-spent', '$25k+ spent', '已消费 $25k+', 4, '{}', '{}'::jsonb)
on conflict (kind, slug) where org_id is null do nothing;

-- timeline_band: Factory-side 'Timeline' filter used when factories browse brand RFQs (src/factory-prototype/main.jsx, ~line 3711), single source.
insert into public.taxonomy_terms (kind, slug, label_en, label_zh, sort, aliases, extra) values
  ('timeline_band', 'sample-in-30-days', 'Sample in 30 days', '30 天内打样', 1, '{}', '{}'::jsonb),
  ('timeline_band', 'bulk-in-60-days', 'Bulk in 60 days', '60 天内大货', 2, '{}', '{}'::jsonb),
  ('timeline_band', 'flexible', 'Flexible', '灵活', 3, '{}', '{}'::jsonb)
on conflict (kind, slug) where org_id is null do nothing;

-- quantity_band: Factory-side directory/marketplace 'Quantity' filter (3 items: Under 300, 300-500, 500+) reconciled against the brand-side 'Available quantity' select (2 items: 300-500 units, 500+ units, no 'Under 300' option). Canonical uses the fuller 3-item list; the unit-suffixed phrasing is recorded as aliases.
insert into public.taxonomy_terms (kind, slug, label_en, label_zh, sort, aliases, extra) values
  ('quantity_band', 'under-300', 'Under 300', '300 件以下', 1, '{}', '{}'::jsonb),
  ('quantity_band', '300-500', '300-500', null, 2, array['300-500 units'], '{}'::jsonb),
  ('quantity_band', '500-plus', '500+', null, 3, array['500+ units'], '{}'::jsonb)
on conflict (kind, slug) where org_id is null do nothing;

-- trust_standard: Additional vocabulary found beyond the 25 known kinds: the brand-side 'Club Standard' filter used to rate factory trust/verification tier in the factory directory and marketplace screens (src/prototype/main.jsx, ~lines 3746 and similar). Brand-side only; no zh translation exists.
insert into public.taxonomy_terms (kind, slug, label_en, label_zh, sort, aliases, extra) values
  ('trust_standard', 'trusted', 'Trusted', null, 1, '{}', '{}'::jsonb),
  ('trust_standard', 'verified', 'Verified', null, 2, '{}', '{}'::jsonb),
  ('trust_standard', 'basic', 'Basic', null, 3, '{}', '{}'::jsonb)
on conflict (kind, slug) where org_id is null do nothing;

-- booking_level: Additional vocabulary found beyond the 25 known kinds: factory monthly booking-level bands used in the capacity drawer (src/factory-prototype/main.jsx levelRanges, ~line 3838). Percentage ranges: Mostly open = 60-100% open, Partly booked = 25-60% open, Mostly full = 0-25% open. The percentage-labeled phrasing (e.g. '60-100% open') is recorded as an alias rather than a structured field, since the output rules reserve `extra` for capacity_category only.
insert into public.taxonomy_terms (kind, slug, label_en, label_zh, sort, aliases, extra) values
  ('booking_level', 'open', 'Mostly open', '较空', 1, array['60-100% open'], '{}'::jsonb),
  ('booking_level', 'partial', 'Partly booked', '部分已订', 2, array['25-60% open'], '{}'::jsonb),
  ('booking_level', 'full', 'Mostly full', '较满', 3, array['0-25% open'], '{}'::jsonb)
on conflict (kind, slug) where org_id is null do nothing;

