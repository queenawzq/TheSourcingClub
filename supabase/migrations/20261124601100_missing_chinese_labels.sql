-- ============================================================================
-- Chinese labels for platform terms that had none, so a factory using the app
-- in Chinese no longer sees English chips among Chinese ones (onboarding's
-- "Specializes in", Browse's filters). Hand-written, in the words the
-- neighbouring terms already use; never machine translated. Only a blank
-- label_zh is filled, so a label staff have since written is kept.
-- ============================================================================

update public.taxonomy_terms t
   set label_zh = v.label_zh
  from (values
    ('specialty', 'organic-poplin-shirts', '有机府绸衬衫'),
    ('specialty', 'low-moq-woven-tops', '低起订量梭织上衣'),
    ('specialty', 'small-batch-production', '小批量生产'),
    ('specialty', 'fit-sample-support', '试身样支持'),
    ('specialty', 'yarn-sourcing', '纱线采购'),
    ('specialty', 'embroidery-print', '刺绣 / 印花'),
    ('service', 'full-package', '全包生产'),
    ('service', 'cmt', 'CMT / 来料加工'),
    ('service', 'pattern-making', '制版'),
    ('service', 'sample-development', '样衣开发'),
    ('service', 'fabric-sourcing', '面料采购'),
    ('lead_time_band', 'under-30-days', '30 天以内'),
    ('lead_time_band', '30-45-days', '30-45 天'),
    ('lead_time_band', '45-plus-days', '45 天以上'),
    ('client_trust_band', '10k-plus-spent', '已消费 $10k+')
  ) as v(kind, slug, label_zh)
 where t.kind = v.kind
   and t.slug = v.slug
   and t.org_id is null
   and nullif(btrim(coalesce(t.label_zh, '')), '') is null;
