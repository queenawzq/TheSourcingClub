-- The conversation list previews the last message in the reader's language.
--
-- `message_thread_summary` gave only `last_body`, what was typed, so a brand
-- reading English saw the factory's last message in Chinese in its list while
-- the conversation itself showed it in English. Two columns are appended (a
-- view can only grow at the end): the last message's translation and its
-- language. Everything else is the view exactly as 20261013000400 left it,
-- still security_invoker, so `messages_read` still hides a held message.
--
-- Additive and safe with the old site live: it selects named columns.

create or replace view public.message_thread_summary
with (security_invoker = true) as
select
  t.*,
  b.name as brand_name,
  f.name as factory_name,
  coalesce(r.title, o.order_number)              as subject_title,
  case when t.order_id is not null then 'order' else 'rfq' end as subject_kind,
  last.body        as last_body,
  last.sender_org_id as last_sender_org_id,
  (
    select count(*)
    from public.messages m
    where m.thread_id = t.id
      and m.delivery = 'delivered'
      and m.sender_user_id is distinct from auth.uid()
      and m.delivered_at > coalesce(
        (select mr.last_read_at from public.message_reads mr
          where mr.thread_id = t.id and mr.user_id = auth.uid()),
        '-infinity'::timestamptz
      )
  )::integer as unread_count,
  (
    select count(*)
    from public.messages m
    where m.thread_id = t.id
  )::integer as message_count,
  last.body_translated      as last_body_translated,
  last.body_translated_lang as last_body_translated_lang
from public.message_threads t
join public.orgs b on b.id = t.brand_org_id
join public.orgs f on f.id = t.factory_org_id
left join public.rfqs r              on r.id = t.rfq_id
left join public.production_orders o on o.id = t.order_id
left join lateral (
  select body, sender_org_id, body_translated, body_translated_lang
  from public.messages
  where thread_id = t.id
  order by coalesce(delivered_at, created_at) desc
  limit 1
) last on true;

grant select on public.message_thread_summary to authenticated;
