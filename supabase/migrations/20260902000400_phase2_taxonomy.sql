-- ============================================================================
-- 015  Phase 2 vocabularies
-- ----------------------------------------------------------------------------
-- Three new taxonomy kinds for the RFQ and quote flows.
--
-- These go in taxonomy_terms rather than becoming Postgres enums for the same
-- reason the other 26 kinds did: the factory UI is Chinese, and a term row
-- carries its own label_zh. An enum would need a translation lookup bolted on
-- beside it. Statuses stay enums because they are the state machine the RPCs
-- manipulate, not content anyone reads.
--
-- Worth flagging: NEITHER prototype has an option list for payment terms or
-- incoterms. They exist only as literal strings baked into display markup
-- ("30% deposit / 70% before shipment", "EXW quoted; shipping TBD"). These
-- vocabularies are therefore invented here and should be reviewed by the
-- product owner before they harden into data that quotes reference.
-- ============================================================================

insert into public.taxonomy_kinds (kind, label_en, label_zh, allows_custom) values
  ('sourcing_responsibility', 'Who sources materials', '面辅料采购方', false),
  ('payment_term',            'Payment terms',         '付款方式',     false),
  ('incoterm',                'Shipping terms',        '贸易条款',     false)
on conflict (kind) do nothing;

-- ---------------------------------------------------------------------------
-- Who buys the fabric and trims
-- ---------------------------------------------------------------------------
-- Described in the product walkthrough but present in neither prototype, so
-- there is no naming precedent to match. It matters commercially: a full
-- package quote and a CMT quote are not comparable numbers, and a brand
-- comparing them side by side without knowing which is which is being
-- misled by its own comparison table.
-- ---------------------------------------------------------------------------

insert into public.taxonomy_terms (kind, slug, label_en, label_zh, sort, extra) values
  ('sourcing_responsibility', 'factory-sources', 'Factory sources everything',
   '工厂负责采购面辅料', 1, '{"note":"Full package. Quote includes materials."}'::jsonb),
  ('sourcing_responsibility', 'brand-supplies',  'Brand supplies materials',
   '品牌方提供面辅料',   2, '{"note":"CMT. Quote is cut, make and trim only."}'::jsonb),
  ('sourcing_responsibility', 'mixed',           'Mixed',
   '部分由品牌方提供',   3, '{"note":"Brand nominates some mills or trims; factory buys the rest."}'::jsonb)
on conflict (kind, slug) where org_id is null do nothing;

-- ---------------------------------------------------------------------------
-- Payment terms
-- ---------------------------------------------------------------------------
-- `extra.default_deposit_pct` pre-fills the quote form. The actual split is
-- stored as first-class columns on the quote, because real deals deviate from
-- the template and the stored number must be what was agreed, not what the
-- template suggested.
-- ---------------------------------------------------------------------------

insert into public.taxonomy_terms (kind, slug, label_en, label_zh, sort, extra) values
  ('payment_term', 'deposit-30-70', '30% deposit, 70% before shipment',
   '30% 定金，70% 发货前付清', 1, '{"default_deposit_pct":30}'::jsonb),
  ('payment_term', 'deposit-40-60', '40% deposit, 60% before shipment',
   '40% 定金，60% 发货前付清', 2, '{"default_deposit_pct":40}'::jsonb),
  ('payment_term', 'deposit-50-50', '50% deposit, 50% before shipment',
   '50% 定金，50% 发货前付清', 3, '{"default_deposit_pct":50}'::jsonb),
  ('payment_term', 'paid-in-full',  'Paid in full before production',
   '生产前全额付款',           4, '{"default_deposit_pct":100}'::jsonb),
  ('payment_term', 'net-30',        'Net 30 after shipment',
   '发货后 30 天付款',          5, '{"default_deposit_pct":0}'::jsonb),
  ('payment_term', 'other',         'Other, described in notes',
   '其他，见备注',              6, '{}'::jsonb)
on conflict (kind, slug) where org_id is null do nothing;

-- ---------------------------------------------------------------------------
-- Incoterms
-- ---------------------------------------------------------------------------
-- The ICC set, trimmed to the terms that actually appear in apparel sourcing.
-- Kept as taxonomy rather than an enum purely for consistency: a client
-- building the quote form fetches every dropdown through one query instead of
-- special-casing this one as a native enum.
--
-- The English acronym is universal in the trade and stays in the Chinese
-- label; the gloss after it is what makes it readable.
-- ---------------------------------------------------------------------------

insert into public.taxonomy_terms (kind, slug, label_en, label_zh, sort, extra) values
  ('incoterm', 'exw', 'EXW — Ex Works',                     'EXW 工厂交货',           1,
   '{"who_ships":"brand","note":"Brand collects from the factory door."}'::jsonb),
  ('incoterm', 'fca', 'FCA — Free Carrier',                 'FCA 货交承运人',         2,
   '{"who_ships":"brand"}'::jsonb),
  ('incoterm', 'fob', 'FOB — Free On Board',                'FOB 装运港船上交货',     3,
   '{"who_ships":"brand","note":"Factory delivers to the export port."}'::jsonb),
  ('incoterm', 'cfr', 'CFR — Cost and Freight',             'CFR 成本加运费',         4,
   '{"who_ships":"factory"}'::jsonb),
  ('incoterm', 'cif', 'CIF — Cost, Insurance and Freight',  'CIF 成本加保险费加运费', 5,
   '{"who_ships":"factory"}'::jsonb),
  ('incoterm', 'dap', 'DAP — Delivered At Place',           'DAP 目的地交货',         6,
   '{"who_ships":"factory"}'::jsonb),
  ('incoterm', 'ddp', 'DDP — Delivered Duty Paid',          'DDP 完税后交货',         7,
   '{"who_ships":"factory","note":"Factory carries duty and clearance."}'::jsonb)
on conflict (kind, slug) where org_id is null do nothing;
