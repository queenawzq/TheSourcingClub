-- A message's translation is written by the server, never by its sender.
--
-- The contact-detail screen (api/screen-message.js) checks the body only. But
-- a signed-in sender could insert body_translated, body_translated_lang and
-- translated_by as well, and the server replaces them only when its own
-- translation succeeds. When it does not (no key, an error, the 8 s timeout,
-- or a body that reads the same in English such as "Porto, Portugal."), the
-- sender's own "translation" stayed and was delivered: an innocent body with
-- a WeChat id or phone number as its English version, shown to the other side
-- in the conversation, the bell and the email before any contract.
--
-- on_message_insert now clears those three columns for a signed-in sender, as
-- it already forces delivery to 'checking'. The app never sends them (the
-- screen translates), so the live site is unaffected during the deploy.
-- Server-side inserts (the service key, migrations, the seed's fixtures) keep
-- what they write. body_lang stays the sender's: it only says which language
-- their own company writes in.

create or replace function public.on_message_insert()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Not security definer, so current_user is the role the request runs as.
  if current_user in ('authenticated', 'anon') then
    new.delivery := 'checking';
    new.body_translated := null;
    new.body_translated_lang := null;
    new.translated_by := null;
  end if;
  new.delivered_at := case when new.delivery = 'delivered' then now() end;
  new.review_note := null;
  return new;
end;
$$;

revoke all on function public.on_message_insert() from public, authenticated;
