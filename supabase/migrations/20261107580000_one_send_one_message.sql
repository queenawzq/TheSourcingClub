-- ============================================================================
-- One send is one message, whatever the network does
-- ----------------------------------------------------------------------------
-- Chromium resends a POST by itself when a reused connection closes before any
-- reply. On production one message was saved seven times that way. Messages
-- have no update or delete policy (the record of what was said is not the
-- sender's to change), so the copies could never be taken back.
--
-- The browser now names each send with a fresh uuid (`client_id`), and a
-- resend of the same request carries the same one. The index makes every
-- repeat fail with 23505 before the row exists, so no AFTER trigger runs for
-- it: no second notification, no second screening. `sendMessage` reads that as
-- "already saved" and reads the row back.
--
-- Add-only: the site still live while this applies sends no client_id, and
-- NULLs never collide, so old rows and old clients are unaffected. Keyed per
-- person, so one person's id can never block or reveal another's message.
-- ============================================================================

alter table public.messages add column client_id uuid;

comment on column public.messages.client_id is
  'Named by the sender''s browser per send; a repeated request with the same id is refused (messages_one_per_send).';

create unique index messages_one_per_send
  on public.messages (sender_user_id, client_id);
