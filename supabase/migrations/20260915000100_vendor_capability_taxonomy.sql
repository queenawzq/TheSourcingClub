-- ============================================================================
-- Vendor capability vocabularies
-- ----------------------------------------------------------------------------
-- Six chip groups in the designed vendor onboarding had no taxonomy kind, so
-- the live mount showed the design's hardcoded list and stored nothing. One of
-- them, "Manufacturing model", is marked required: a vendor who saved and came
-- back was refused at that card forever, because their answer had never been
-- written anywhere.
--
--   manufacturing_model   factory: how it engages (OEM, ODM, FPP, CMT, ...)
--   production_program    trading company: the same question, its wording
--   core_service          trading company: the work its own team does
--   product_development   trading company: development it coordinates
--   quality_compliance    trading company: inspection and compliance support
--   sourcing_region       trading company: countries it sources FROM, which is
--                         a different question from `region`, the markets a
--                         vendor sells INTO. One kind for both would have made
--                         each save overwrite the other.
--
-- Written by hand rather than generated: migration 007 is immutable, and
-- supabase/seed/taxonomy.json regenerates only that file. Labels are taken
-- verbatim from the designed copy, English and Chinese alike, so nothing here
-- goes near machine translation.
-- ============================================================================

insert into public.taxonomy_kinds (kind, label_en, label_zh, allows_custom) values
  ('manufacturing_model',  'Manufacturing model',         '合作生产模式',   false),
  ('production_program',   'Production programs supported', '支持的生产合作模式', false),
  ('core_service',         'Core services',               '核心服务',       true),
  ('product_development',  'Product development',         '产品开发',       true),
  ('quality_compliance',   'Quality & compliance',        '质量与合规',     true),
  ('sourcing_region',      'Sourcing regions',            '采购地区',       false)
on conflict (kind) do nothing;

insert into public.taxonomy_terms (kind, slug, label_en, label_zh, sort) values
  ('manufacturing_model', 'oem',           'OEM / made to specification',    'OEM / 按品牌规格生产', 0),
  ('manufacturing_model', 'odm',           'ODM / design + manufacture',     'ODM / 设计与生产',     1),
  ('manufacturing_model', 'full-package',  'Full package production (FPP)',  '全包生产 FPP',         2),
  ('manufacturing_model', 'cmt',           'CMT / cut, make & trim',         'CMT / 来料加工',       3),
  ('manufacturing_model', 'private-label', 'Private label / white label',    'Private label / 白牌', 4),
  ('manufacturing_model', 'obm',           'OBM / own-brand manufacturing',  'OBM / 自有品牌生产',   5),

  ('production_program', 'oem',            'OEM / made to specification',    'OEM / 按品牌规格生产', 0),
  ('production_program', 'odm',            'ODM / design + manufacture',     'ODM / 设计与生产',     1),
  ('production_program', 'full-package',   'Full package production (FPP)',  '全包生产 FPP',         2),
  ('production_program', 'cmt',            'CMT / cut, make & trim',         'CMT / 来料加工',       3),
  ('production_program', 'private-label',  'Private label / white label',    '自有标签 / 白牌',      4),
  ('production_program', 'small-batch',    'Small-batch / low MOQ',          '小批量 / 低起订量',    5),

  ('core_service', 'supplier-matching',      'Supplier matching',      '供应商匹配',   0),
  ('core_service', 'costing-negotiation',    'Costing & negotiation',  '成本核算与谈判', 1),
  ('core_service', 'merchandising',          'Merchandising',          '跟单管理',     2),
  ('core_service', 'sample-management',      'Sample management',      '样品管理',     3),
  ('core_service', 'production-management',  'Production management',  '生产管理',     4),
  ('core_service', 'order-consolidation',    'Order consolidation',    '订单整合',     5),
  ('core_service', 'logistics-coordination', 'Logistics coordination', '物流协调',     6),

  ('product_development', 'design-support',        'Design support',        '设计支持',   0),
  ('product_development', 'tech-pack-support',     'Tech pack support',     '技术包支持', 1),
  ('product_development', 'pattern-making',        'Pattern making',        '制版',       2),
  ('product_development', 'grading',               'Grading',               '放码',       3),
  ('product_development', 'sample-development',    'Sample development',    '样衣开发',   4),
  ('product_development', 'material-sourcing',     'Material sourcing',     '面料采购',   5),
  ('product_development', 'trim-sourcing',         'Trim sourcing',         '辅料采购',   6),
  ('product_development', 'packaging-development', 'Packaging development', '包装开发',   7),

  ('quality_compliance', 'factory-verification',     'Factory verification',       '工厂验证',         0),
  ('quality_compliance', 'in-line-inspection',       'In-line inspection',         '中期验货',         1),
  ('quality_compliance', 'final-inspection',         'Final inspection',           '终期验货',         2),
  ('quality_compliance', 'third-party-inspection',   'Third-party inspection',     '第三方验货',       3),
  ('quality_compliance', 'lab-testing',              'Lab testing coordination',   '实验室测试协调',   4),
  ('quality_compliance', 'certification-validation', 'Certification validation',   '认证核验',         5),
  ('quality_compliance', 'social-compliance',        'Social compliance checks',   '社会责任合规检查', 6),
  ('quality_compliance', 'traceability-support',     'Traceability support',       '可追溯性支持',     7),

  ('sourcing_region', 'china',           'China',             '中国',        0),
  ('sourcing_region', 'portugal',        'Portugal',          '葡萄牙',      1),
  ('sourcing_region', 'south-korea',     'South Korea',       '韩国',        2),
  ('sourcing_region', 'india',           'India',             '印度',        3),
  ('sourcing_region', 'turkey',          'Turkey',            '土耳其',      4),
  ('sourcing_region', 'vietnam',         'Vietnam',           '越南',        5),
  ('sourcing_region', 'bangladesh',      'Bangladesh',        '孟加拉国',    6),
  ('sourcing_region', 'cambodia',        'Cambodia',          '柬埔寨',      7),
  ('sourcing_region', 'indonesia',       'Indonesia',         '印度尼西亚',  8),
  ('sourcing_region', 'pakistan',        'Pakistan',          '巴基斯坦',    9),
  ('sourcing_region', 'sri-lanka',       'Sri Lanka',         '斯里兰卡',   10),
  ('sourcing_region', 'morocco-tunisia', 'Morocco / Tunisia', '摩洛哥 / 突尼斯', 11),
  ('sourcing_region', 'mexico',          'Mexico',            '墨西哥',     12),
  ('sourcing_region', 'united-states',   'United States',     '美国',       13)
on conflict do nothing;
