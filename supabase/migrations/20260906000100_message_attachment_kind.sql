-- ============================================================================
-- 036  A document kind for message attachments
-- ----------------------------------------------------------------------------
-- Alone in its own migration, and that is not tidiness. Postgres refuses to
-- USE a new enum value in the transaction that adds it, which migration 012
-- discovered the hard way. The tables that reference this kind therefore have
-- to land in a later file.
-- ============================================================================

alter type public.document_kind add value if not exists 'message_attachment';
