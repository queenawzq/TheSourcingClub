-- The bell and the "messaged you" email give the reader the message in the
-- reader's language.
--
-- announce_message wrote `left(btrim(m.body), 160)`: what the sender typed.
-- A factory writing in Chinese reached the brand's bell, and its email, in
-- Chinese, while the conversation itself showed the English translation.
-- The translation is stored before the message is delivered
-- (api/screen-message.js writes it, then records the verdict, which
-- delivers), so it is here when this runs, at send or at staff release.
--
-- `body` is what the conversation shows an English reader (readable() in
-- src/lib/domain/message.js: the translation when it is English, else the
-- original). `data.message_text` keeps both languages, so the email picks the
-- recipient's saved locale (notificationBody, src/shared/notification-text.mjs
-- and its copy in scripts/generate-notification-email.mjs).
--
-- Same signature, still internal. Safe with the old site live: the old site
-- reads `body` and ignores the new key.

create or replace function public.announce_message(target_message uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m         public.messages;
  t         public.message_threads;
  other_org uuid;
  sender    text;
  subject   text;
  texts     jsonb := '{}'::jsonb;
begin
  select * into m from public.messages where id = target_message;
  select * into t from public.message_threads where id = m.thread_id;

  update public.message_threads
     set last_message_at = greatest(last_message_at, m.delivered_at)
   where id = t.id;

  other_org := case when t.brand_org_id = m.sender_org_id
                    then t.factory_org_id else t.brand_org_id end;

  select name into sender from public.orgs where id = m.sender_org_id;

  if t.order_id is not null then
    select order_number into subject from public.production_orders where id = t.order_id;
  else
    select coalesce(nullif(btrim(title), ''), 'your request') into subject
    from public.rfqs where id = t.rfq_id;
  end if;

  if nullif(btrim(m.body_translated), '') is not null and m.body_translated_lang in ('en', 'zh') then
    texts := jsonb_build_object(m.body_translated_lang, left(btrim(m.body_translated), 160));
    if m.body_lang in ('en', 'zh') and m.body_lang <> m.body_translated_lang then
      texts := texts || jsonb_build_object(m.body_lang, left(btrim(m.body), 160));
    end if;
  end if;

  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body, data)
  values (
    other_org, 'message', 'thread', t.id, t.order_id,
    format('%s messaged you about %s', sender, subject),
    coalesce(texts ->> 'en', left(btrim(m.body), 160)),
    case when texts = '{}'::jsonb then '{}'::jsonb
         else jsonb_build_object('message_text', texts) end
  );
end;
$$;

revoke all on function public.announce_message(uuid) from public, authenticated;
