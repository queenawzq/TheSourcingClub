-- ============================================================================
-- 013  Remaining factory onboarding fields
-- ----------------------------------------------------------------------------
-- Two gaps the factory flow exposed that migration 003 did not cover.
-- ============================================================================

-- Free text rather than a vocabulary on purpose: factories describe machines
-- in wildly specific terms ("2 x Juki MO-6714 overlock"), and forcing that into
-- a controlled list would either lose the detail or produce a list of one-offs.
alter table public.factory_profiles
  add column if not exists equipment_notes text;

comment on column public.factory_profiles.equipment_notes is
  'Key machines and equipment, free text. Deliberately not a taxonomy.';

-- ---------------------------------------------------------------------------
-- Country
-- ---------------------------------------------------------------------------
-- factory_profiles.country_code is an ISO code, and the match score compares it
-- against the country list on each region term. Onboarding therefore needs a
-- country picker, and that vocabulary belongs in taxonomy_terms like every
-- other option list rather than as an array in a component.
-- ---------------------------------------------------------------------------

insert into public.taxonomy_kinds (kind, label_en, label_zh, allows_custom) values
  ('country', 'Country', '国家', false)
on conflict (kind) do nothing;

insert into public.taxonomy_terms (kind, slug, label_en, label_zh, sort, extra) values
  ('country', 'china',          'China',          '中国',       1,  '{"code":"CN"}'::jsonb),
  ('country', 'portugal',       'Portugal',       '葡萄牙',     2,  '{"code":"PT"}'::jsonb),
  ('country', 'korea',          'South Korea',    '韩国',       3,  '{"code":"KR"}'::jsonb),
  ('country', 'india',          'India',          '印度',       4,  '{"code":"IN"}'::jsonb),
  ('country', 'turkey',         'Türkiye',        '土耳其',     5,  '{"code":"TR"}'::jsonb),
  ('country', 'vietnam',        'Vietnam',        '越南',       6,  '{"code":"VN"}'::jsonb),
  ('country', 'bangladesh',     'Bangladesh',     '孟加拉国',   7,  '{"code":"BD"}'::jsonb),
  ('country', 'indonesia',      'Indonesia',      '印度尼西亚', 8,  '{"code":"ID"}'::jsonb),
  ('country', 'italy',          'Italy',          '意大利',     9,  '{"code":"IT"}'::jsonb),
  ('country', 'spain',          'Spain',          '西班牙',     10, '{"code":"ES"}'::jsonb),
  ('country', 'poland',         'Poland',         '波兰',       11, '{"code":"PL"}'::jsonb),
  ('country', 'romania',        'Romania',        '罗马尼亚',   12, '{"code":"RO"}'::jsonb),
  ('country', 'morocco',        'Morocco',        '摩洛哥',     13, '{"code":"MA"}'::jsonb),
  ('country', 'mexico',         'Mexico',         '墨西哥',     14, '{"code":"MX"}'::jsonb),
  ('country', 'united-states',  'United States',  '美国',       15, '{"code":"US"}'::jsonb),
  ('country', 'united-kingdom', 'United Kingdom', '英国',       16, '{"code":"GB"}'::jsonb),
  ('country', 'japan',          'Japan',          '日本',       17, '{"code":"JP"}'::jsonb),
  ('country', 'taiwan',         'Taiwan',         '台湾',       18, '{"code":"TW"}'::jsonb),
  ('country', 'thailand',       'Thailand',       '泰国',       19, '{"code":"TH"}'::jsonb),
  ('country', 'cambodia',       'Cambodia',       '柬埔寨',     20, '{"code":"KH"}'::jsonb)
on conflict (kind, slug) where org_id is null do nothing;
