-- ============================================================================
-- 059  How many messages a conversation holds
-- ----------------------------------------------------------------------------
-- The designed request card (RfqCard, src/prototype/main.jsx) draws three
-- figures: quotes received, invited, and messages. The first two come back
-- with the request row; the third had nothing behind it, so the live adapter
-- sent two cells to a card that destructures three — and every brand with a
-- request got an error boundary instead of its Quotes screen.
--
-- The count belongs next to unread_count rather than in JavaScript: the
-- alternative is reading every message in every thread into the browser to
-- length-check it.
--
-- unread_count stays exactly as it was — per user, derived from
-- message_reads. message_count is the whole thread, the same for both sides.
-- ============================================================================

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
      and m.sender_user_id is distinct from auth.uid()
      and m.created_at > coalesce(
        (select mr.last_read_at from public.message_reads mr
          where mr.thread_id = t.id and mr.user_id = auth.uid()),
        '-infinity'::timestamptz
      )
  )::integer as unread_count,
  (
    select count(*)
    from public.messages m
    where m.thread_id = t.id
  )::integer as message_count
from public.message_threads t
join public.orgs b on b.id = t.brand_org_id
join public.orgs f on f.id = t.factory_org_id
left join public.rfqs r              on r.id = t.rfq_id
left join public.production_orders o on o.id = t.order_id
left join lateral (
  select body, sender_org_id
  from public.messages
  where thread_id = t.id
  order by created_at desc
  limit 1
) last on true;

grant select on public.message_thread_summary to authenticated;
