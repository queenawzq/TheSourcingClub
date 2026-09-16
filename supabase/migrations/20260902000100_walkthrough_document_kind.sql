-- ============================================================================
-- 012  Walkthrough document kind
-- ----------------------------------------------------------------------------
-- Factory onboarding asks for a walkthrough video or photo tour of the floor.
-- It is shown on the public profile, so it belongs in the public bucket
-- alongside product imagery rather than with the private paperwork.
--
-- Alone in its own migration: a new enum value cannot be used in the same
-- transaction that adds it.
-- ============================================================================

alter type public.document_kind add value if not exists 'walkthrough';
