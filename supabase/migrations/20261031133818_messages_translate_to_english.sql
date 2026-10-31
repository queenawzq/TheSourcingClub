-- Accept detected ISO 639 source codes beyond English and Chinese.
-- Keep existing translations readable while new messages translate into English.
alter table public.messages drop constraint messages_body_lang_check;
alter table public.messages add constraint messages_body_lang_check
  check (body_lang is null or body_lang ~ '^[a-z]{2,3}$');
