-- ============================================================================
-- 071  Messages held for review
-- ----------------------------------------------------------------------------
-- A message that carries contact details for going off the platform (an
-- email, a phone number, a WeChat or WhatsApp id, a link, "let's talk
-- outside") is HELD rather than delivered, and platform staff release it or
-- reject it. This migration is the database half: where a message stands, who
-- can see it in each state, and the functions that move it. Nothing creates a
-- held message yet. The screening that will (patterns first, then a model,
-- in api/) comes later, and every message the current site sends is
-- `delivered` exactly as before.
--
-- Four states:
--
--   checking   saved, waiting for the server's verdict. Only the sender's
--              company sees it.
--   delivered  what every message is today. Both sides see it.
--   held       the screen found something. Only the sender's company and
--              staff see it, until staff decide.
--   rejected   staff decided against it. The recipient never sees it; the
--              sender sees it with the reason.
--
-- The state is a column on the message, but nothing outside these functions
-- can move it: messages still have no update policy, so an UPDATE from a
-- client touches no rows at all. Hiding a held message is done in the read
-- policy, which is what makes everything built on top of it (the thread
-- summary's preview and counts, the dashboard's unread figure, the order's
-- activity) hide it too, without each of them having to remember.
--
-- Staff have no org and cannot be notified (see admin_payment_queue), so the
-- held messages wait in admin_message_queue() for someone to open it.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Where a message stands
-- ---------------------------------------------------------------------------

alter table public.messages
  add column delivery text not null default 'delivered'
    constraint message_delivery_known
      check (delivery in ('checking', 'delivered', 'held', 'rejected')),
  -- When the recipient could first see it. For an ordinary message that is
  -- the moment it was sent; for a released one it is the release, which is
  -- what unread has to compare against, or a message released after the
  -- recipient last opened the thread would arrive already "read".
  add column delivered_at timestamptz,
  -- Why staff rejected it, for the sender. Only ever on a rejected message,
  -- which the recipient cannot read.
  add column review_note text;

update public.messages set delivered_at = created_at where delivered_at is null;

alter table public.messages
  add constraint message_delivered_has_time
    check ((delivery = 'delivered') = (delivered_at is not null)),
  add constraint message_review_note_only_on_reject
    check (review_note is null or delivery = 'rejected');

-- A sender chooses only whether its message is checked first. When it was
-- delivered, and any review note, are not the sender's to write.
create or replace function public.on_message_insert()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.delivered_at := case when new.delivery = 'delivered' then now() end;
  new.review_note := null;
  return new;
end;
$$;

revoke all on function public.on_message_insert() from public, authenticated;

create trigger messages_before_send
  before insert on public.messages
  for each row execute function public.on_message_insert();

-- ---------------------------------------------------------------------------
-- What the screen found, and what staff decided
-- ---------------------------------------------------------------------------
-- Staff-only, like org_reviews: what a model thought of somebody's message is
-- a note about a customer. What the sender must know travels on the message
-- (review_note) and in a notification.
-- ---------------------------------------------------------------------------

create table public.message_screenings (
  message_id uuid primary key references public.messages (id) on delete cascade,

  -- null when nothing screened it (a message stuck at 'checking' that staff
  -- decided by hand).
  outcome text check (outcome is null or outcome in ('delivered', 'held')),
  -- pattern       a pattern matched, so the model was not asked
  -- ai            the model decided
  -- pattern_only  the model could not answer; the patterns found nothing
  method  text check (method is null or method in ('pattern', 'ai', 'pattern_only')),
  model   text,
  reason  text,
  screened_at timestamptz,

  decision      text check (decision is null or decision in ('released', 'rejected')),
  decided_by    uuid references auth.users (id) on delete set null,
  decided_at    timestamptz,
  decision_note text,

  constraint screening_decision_is_complete check (
    (decision is null and decided_by is null and decided_at is null)
    or (decision is not null and decided_at is not null)
  )
);

alter table public.message_screenings enable row level security;
-- No policies: readable through admin_message_queue() and nothing else.
-- Default privileges hand `authenticated` full DML on every new table.
revoke all on public.message_screenings from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Who can see a message
-- ---------------------------------------------------------------------------

create or replace function public.can_read_message(target_message uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.messages m
    where m.id = target_message
      and public.is_thread_party(m.thread_id)
      and (m.delivery = 'delivered'
           or m.sender_org_id in (select public.current_org_ids()))
  );
$$;

revoke all on function public.can_read_message(uuid) from public;
grant execute on function public.can_read_message(uuid) to authenticated;

-- The recipient sees delivered messages only. The sender's whole company sees
-- its own in every state, so a colleague can tell why a message is waiting.
drop policy messages_read on public.messages;
create policy messages_read on public.messages
  for select to authenticated
  using (
    (public.is_thread_party(thread_id)
      and (delivery = 'delivered'
           or sender_org_id in (select public.current_org_ids())))
    or public.is_platform_admin()
  );

-- Unchanged apart from the last line: a client may send a message delivered
-- (today's site) or ask for it to be checked first. It can never write one
-- straight into held, rejected or anything else.
drop policy messages_send on public.messages;
create policy messages_send on public.messages
  for insert to authenticated
  with check (
    public.is_thread_party(thread_id)
    and sender_org_id in (select public.current_org_ids())
    and sender_user_id = auth.uid()
    and delivery in ('delivered', 'checking')
  );

-- Attachments travel with their message: hidden while it is, released with
-- it. Same three parts as before (the documents row, the storage object, the
-- signed URL), and the same failure if one is missed: the file shows to the
-- recipient while the words do not.
drop policy documents_thread_party_read on public.documents;
create policy documents_thread_party_read on public.documents
  for select to authenticated
  using (
    message_id is not null
    and public.can_read_message(message_id)
  );

-- Storage can only see the object's name, so it asks which message the file
-- at that path belongs to. A file that belongs to no message yet (mid-send)
-- is not the counterparty's to read either; its own company still reads it
-- through "org private read".
create or replace function public.message_attachment_readable(object_name text)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.documents d
    where d.bucket = 'org-private'
      and d.storage_path = object_name
      and d.message_id is not null
      and public.can_read_message(d.message_id)
  );
$$;

revoke all on function public.message_attachment_readable(text) from public;
grant execute on function public.message_attachment_readable(text) to authenticated;

drop policy "thread party private read" on storage.objects;
create policy "thread party private read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'org-private'
    and split_part(name, '/', 2) = 'message_attachment'
    and public.is_thread_party(public.storage_path_scope(name))
    and public.message_attachment_readable(name)
  );

-- ---------------------------------------------------------------------------
-- Delivering tells the other side; holding tells nobody
-- ---------------------------------------------------------------------------
-- What 037's trigger did on every send, now done at the moment of delivery:
-- at send time for an ordinary message, at release for a held one. A held
-- message moves nothing the recipient can see, not even the thread's place in
-- their list.
-- ---------------------------------------------------------------------------

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

  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  values (
    other_org, 'message', 'thread', t.id, t.order_id,
    format('%s messaged you about %s', sender, subject),
    left(btrim(m.body), 160)
  );
end;
$$;

-- Internal. Callable by a client, it would re-send any notification it liked.
revoke all on function public.announce_message(uuid) from public, authenticated;

create or replace function public.on_message_sent()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- The sender has, by definition, read their own message.
  insert into public.message_reads (thread_id, user_id, last_read_at)
  values (new.thread_id, new.sender_user_id, new.created_at)
  on conflict (thread_id, user_id) do update set last_read_at = excluded.last_read_at;

  if new.delivery = 'delivered' then
    perform public.announce_message(new.id);
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- The thread list
-- ---------------------------------------------------------------------------
-- Same columns as 059. The read policy already keeps a held message out of
-- the recipient's preview and counts. Two changes: unread counts delivered
-- messages by when they were delivered (a released message is new to the
-- recipient even though it was written earlier, and the sender's colleagues
-- are not shown their own held message as unread), and the preview is the
-- last message to arrive.
-- ---------------------------------------------------------------------------

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
  order by coalesce(delivered_at, created_at) desc
  limit 1
) last on true;

grant select on public.message_thread_summary to authenticated;

-- ---------------------------------------------------------------------------
-- The screen's verdict
-- ---------------------------------------------------------------------------
-- Called by the server, with the secret key, once it has looked at a message
-- saved as 'checking'. Not granted to `authenticated`: a client that could
-- call this could deliver its own message unchecked. Acts only on a message
-- still being checked, and otherwise hands back the row unchanged, so a
-- retried request cannot release something staff have since rejected.
-- ---------------------------------------------------------------------------

create or replace function public.record_message_screening(
  target_message uuid,
  outcome        text,
  method         text,
  reason         text default null,
  model          text default null
)
returns public.messages
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.messages;
begin
  if outcome not in ('delivered', 'held') then
    raise exception 'outcome must be delivered or held' using errcode = '22023';
  end if;
  if method not in ('pattern', 'ai', 'pattern_only') then
    raise exception 'method must be pattern, ai or pattern_only' using errcode = '22023';
  end if;

  select * into m from public.messages where id = target_message for update;
  if not found then
    raise exception 'message not found' using errcode = 'P0002';
  end if;
  if m.delivery <> 'checking' then
    return m;
  end if;

  if outcome = 'delivered' then
    update public.messages set delivery = 'delivered', delivered_at = now()
     where id = m.id returning * into m;
    perform public.announce_message(m.id);
  else
    update public.messages set delivery = 'held'
     where id = m.id returning * into m;
  end if;

  insert into public.message_screenings (message_id, outcome, method, model, reason, screened_at)
  values (m.id, outcome, method, nullif(btrim(model), ''), nullif(btrim(reason), ''), now())
  on conflict (message_id) do nothing;

  return m;
end;
$$;

revoke all on function public.record_message_screening(uuid, text, text, text, text)
  from public, authenticated;
grant execute on function public.record_message_screening(uuid, text, text, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- Staff decide
-- ---------------------------------------------------------------------------
-- The is_platform_admin() test is the first statement, before any select:
-- checking afterwards would tell a stranger whether a message id exists
-- (P0002 against 42501).
--
-- Both act on a held message, or on one stuck at 'checking' for more than two
-- minutes (the sender's page closed before the screen answered); the queue
-- shows those too, so nothing waits forever without anyone seeing it.
-- ---------------------------------------------------------------------------

create or replace function public.release_held_message(target_message uuid, note text default null)
returns public.messages
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.messages;
begin
  if not public.is_platform_admin() then
    raise exception 'releasing a message is limited to platform staff' using errcode = '42501';
  end if;

  select * into m from public.messages where id = target_message for update;
  if not found then
    raise exception 'message not found' using errcode = 'P0002';
  end if;
  if not (m.delivery = 'held'
          or (m.delivery = 'checking' and m.created_at < now() - interval '2 minutes')) then
    raise exception 'that message is %; only a held one can be released', m.delivery
      using errcode = '22023';
  end if;

  update public.messages set delivery = 'delivered', delivered_at = now()
   where id = m.id returning * into m;

  insert into public.message_screenings (message_id, decision, decided_by, decided_at, decision_note)
  values (m.id, 'released', auth.uid(), now(), nullif(btrim(coalesce(note, '')), ''))
  on conflict (message_id) do update
    set decision = excluded.decision, decided_by = excluded.decided_by,
        decided_at = excluded.decided_at, decision_note = excluded.decision_note;

  -- The recipient is told exactly as if it had just been sent; the sender is
  -- not told anything, because from their side it simply went.
  perform public.announce_message(m.id);

  return m;
end;
$$;

revoke all on function public.release_held_message(uuid, text) from public;
grant execute on function public.release_held_message(uuid, text) to authenticated;

create or replace function public.reject_held_message(target_message uuid, note text)
returns public.messages
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m         public.messages;
  t         public.message_threads;
  recipient text;
  subject   text;
begin
  if not public.is_platform_admin() then
    raise exception 'rejecting a message is limited to platform staff' using errcode = '42501';
  end if;

  if length(btrim(coalesce(note, ''))) = 0 then
    raise exception 'say why it was not delivered; the sender sees this' using errcode = '22023';
  end if;

  select * into m from public.messages where id = target_message for update;
  if not found then
    raise exception 'message not found' using errcode = 'P0002';
  end if;
  if not (m.delivery = 'held'
          or (m.delivery = 'checking' and m.created_at < now() - interval '2 minutes')) then
    raise exception 'that message is %; only a held one can be rejected', m.delivery
      using errcode = '22023';
  end if;

  update public.messages set delivery = 'rejected', review_note = btrim(note)
   where id = m.id returning * into m;

  insert into public.message_screenings (message_id, decision, decided_by, decided_at, decision_note)
  values (m.id, 'rejected', auth.uid(), now(), btrim(note))
  on conflict (message_id) do update
    set decision = excluded.decision, decided_by = excluded.decided_by,
        decided_at = excluded.decided_at, decision_note = excluded.decision_note;

  select * into t from public.message_threads where id = m.thread_id;

  select name into recipient from public.orgs
   where id = case when t.brand_org_id = m.sender_org_id
                   then t.factory_org_id else t.brand_org_id end;

  if t.order_id is not null then
    select order_number into subject from public.production_orders where id = t.order_id;
  else
    select coalesce(nullif(btrim(title), ''), 'your request') into subject
    from public.rfqs where id = t.rfq_id;
  end if;

  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  values (
    m.sender_org_id, 'message_rejected', 'thread', t.id, t.order_id,
    format('Your message to %s about %s was not delivered', recipient, subject),
    btrim(note)
  );

  return m;
end;
$$;

revoke all on function public.reject_held_message(uuid, text) from public;
grant execute on function public.reject_held_message(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The queue
-- ---------------------------------------------------------------------------
-- The only prompt there is: staff cannot be notified, so a held message waits
-- here until someone opens it. Oldest first.
-- ---------------------------------------------------------------------------

create or replace function public.admin_message_queue()
returns table (
  message_id      uuid,
  delivery        text,
  thread_id       uuid,
  subject_kind    text,
  subject_title   text,
  order_id        uuid,
  rfq_id          uuid,
  brand_name      text,
  factory_name    text,
  sender_side     text,
  sender_name     text,
  body            text,
  body_translated text,
  file_names      text[],
  method          text,
  reason          text,
  model           text,
  sent_at         timestamptz,
  screened_at     timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'this queue is limited to platform staff' using errcode = '42501';
  end if;

  return query
  select
    m.id, m.delivery, t.id,
    case when t.order_id is not null then 'order' else 'rfq' end,
    coalesce(r.title, o.order_number),
    t.order_id, t.rfq_id,
    b.name, f.name,
    case when m.sender_org_id = t.brand_org_id then 'brand' else 'factory' end,
    s.name,
    m.body, m.body_translated,
    coalesce((select array_agg(d.file_name order by d.created_at)
                from public.documents d where d.message_id = m.id), '{}'),
    sc.method, sc.reason, sc.model,
    m.created_at, sc.screened_at
  from public.messages m
  join public.message_threads t on t.id = m.thread_id
  join public.orgs b on b.id = t.brand_org_id
  join public.orgs f on f.id = t.factory_org_id
  join public.orgs s on s.id = m.sender_org_id
  left join public.rfqs r              on r.id = t.rfq_id
  left join public.production_orders o on o.id = t.order_id
  left join public.message_screenings sc on sc.message_id = m.id
  where m.delivery = 'held'
     or (m.delivery = 'checking' and m.created_at < now() - interval '2 minutes')
  order by m.created_at;
end;
$$;

revoke all on function public.admin_message_queue() from public;
grant execute on function public.admin_message_queue() to authenticated;
