-- ============================================================================
-- 037  Messages
-- ----------------------------------------------------------------------------
-- Both prototypes design a messaging screen and neither one works: `Send` is
-- `onClick={() => setComposer("")}` on both sides, so no message was ever
-- appended to anything. There is no behaviour here to preserve, only intent —
-- which is worth saying, because several of the prototype's fields turn out to
-- be undeliverable and are deliberately absent below.
--
-- A thread hangs off the thing it is about: a request, or an order. That is
-- not merely tidy — it means visibility reuses can_see_rfq() and
-- is_order_party(), rather than inventing a fourth way to decide who may read
-- what. The prototype links a thread to its subject with a TITLE STRING and no
-- id, on both sides, which is why clicking any factory's Message button lands
-- on the first conversation in the list.
--
-- Translation is stored, not computed on read. Both the original and the
-- translation live on the row: a reader sees their own language and can always
-- see what was actually typed, which matters most exactly when the translation
-- is wrong. The taxonomy went the other way — hand-written label_en/label_zh,
-- never machine translation — because a mistranslated CATEGORY silently
-- corrupts matching. A mistranslated sentence is visibly a sentence, and the
-- person can ask.
-- ============================================================================

create table public.message_threads (
  id uuid primary key default gen_random_uuid(),

  -- Exactly one of these. A thread is always about something.
  rfq_id   uuid references public.rfqs (id) on delete cascade,
  order_id uuid references public.production_orders (id) on delete cascade,

  brand_org_id   uuid not null references public.orgs (id) on delete cascade,
  factory_org_id uuid not null references public.orgs (id) on delete cascade,

  last_message_at timestamptz,
  created_at      timestamptz not null default now(),

  constraint thread_has_one_subject check (
    (rfq_id is not null and order_id is null)
    or (rfq_id is null and order_id is not null)
  ),
  constraint thread_parties_differ check (brand_org_id <> factory_org_id)
);

-- One thread per order, and one per (request, factory): a brand talking to
-- four factories about one request has four conversations, which is the whole
-- point of asking four factories.
create unique index message_threads_one_per_order on public.message_threads (order_id)
  where order_id is not null;
create unique index message_threads_one_per_rfq_factory
  on public.message_threads (rfq_id, factory_org_id) where rfq_id is not null;

create index message_threads_brand_idx   on public.message_threads (brand_org_id, last_message_at desc);
create index message_threads_factory_idx on public.message_threads (factory_org_id, last_message_at desc);

create table public.messages (
  id        uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.message_threads (id) on delete cascade,

  sender_org_id  uuid not null references public.orgs (id) on delete cascade,
  sender_user_id uuid references auth.users (id) on delete set null,

  -- What was actually typed. Never overwritten.
  body      text not null check (length(btrim(body)) > 0),
  body_lang text check (body_lang is null or body_lang in ('en', 'zh')),

  -- The other language, when we managed to produce one. Nullable throughout,
  -- because translation must never be able to block a message being sent —
  -- someone whose model call failed still has something to say.
  body_translated      text,
  body_translated_lang text check (body_translated_lang is null or body_translated_lang in ('en', 'zh')),
  translated_by        text,

  created_at timestamptz not null default now(),

  constraint message_translation_is_complete check (
    (body_translated is null and body_translated_lang is null)
    or (body_translated is not null and body_translated_lang is not null)
  ),
  constraint message_translation_differs check (
    body_translated_lang is null or body_lang is null or body_translated_lang <> body_lang
  )
);

create index messages_thread_idx on public.messages (thread_id, created_at);

-- ---------------------------------------------------------------------------
-- Read state
-- ---------------------------------------------------------------------------
-- Per USER, not per org. Two people at the same brand each have their own
-- unread count, which is what anyone would expect and what the prototype's
-- single integer on the thread cannot express. That integer is also never
-- decremented anywhere in either prototype — opening a conversation leaves the
-- badge sitting there forever.
-- ---------------------------------------------------------------------------

create table public.message_reads (
  thread_id    uuid not null references public.message_threads (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.is_thread_party(target_thread uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.message_threads t
    where t.id = target_thread
      and (t.brand_org_id in (select public.current_org_ids())
        or t.factory_org_id in (select public.current_org_ids()))
  );
$$;

create or replace function public.message_thread(target_message uuid)
returns uuid
language sql stable security definer
set search_path = public, pg_temp
as $$ select thread_id from public.messages where id = target_message; $$;

revoke all on function public.is_thread_party(uuid) from public;
revoke all on function public.message_thread(uuid) from public;
grant execute on function public.is_thread_party(uuid) to authenticated;
grant execute on function public.message_thread(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Attachments
-- ---------------------------------------------------------------------------

alter table public.documents
  add column message_id uuid references public.messages (id) on delete set null;

create index documents_message_idx on public.documents (message_id) where message_id is not null;

-- The counterparty has to be able to read what was sent to them. Same three
-- parts as milestone photos, and the same failure if any one is missing: the
-- metadata policy alone gives a signed URL that 400s, which shows as a broken
-- tile rather than an error anyone can act on.
create policy documents_thread_party_read on public.documents
  for select to authenticated
  using (
    message_id is not null
    and public.is_thread_party(public.message_thread(message_id))
  );

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.message_threads enable row level security;
alter table public.messages        enable row level security;
alter table public.message_reads   enable row level security;

create policy message_threads_read on public.message_threads
  for select to authenticated
  using (
    brand_org_id in (select public.current_org_ids())
    or factory_org_id in (select public.current_org_ids())
    or public.is_platform_admin()
  );

-- No insert grant: open_thread() decides whether these two parties have any
-- business talking, and that test is the access rules of the RFQ or the order
-- rather than anything new.
grant select on public.message_threads to authenticated;

create policy messages_read on public.messages
  for select to authenticated
  using (public.is_thread_party(thread_id) or public.is_platform_admin());

-- Sending IS a plain insert, unlike almost everything else in this schema.
-- There is no state machine here and no privilege to escalate: the payload is
-- the sender's own words, and the only thing worth enforcing is that they are
-- in the conversation and are not writing as somebody else. A `with check` can
-- express exactly that, so it does.
create policy messages_send on public.messages
  for insert to authenticated
  with check (
    public.is_thread_party(thread_id)
    and sender_org_id in (select public.current_org_ids())
    and sender_user_id = auth.uid()
  );

grant select, insert on public.messages to authenticated;

-- A message is never edited or deleted. Saying something and then changing
-- what the record says you said is the opposite of what a conversation is for
-- when there is money involved.
create policy message_reads_own on public.message_reads
  for all to authenticated
  using (user_id = auth.uid() and public.is_thread_party(thread_id))
  with check (user_id = auth.uid() and public.is_thread_party(thread_id));

grant select, insert, update on public.message_reads to authenticated;

-- ---------------------------------------------------------------------------
-- Sending a message tells the other side
-- ---------------------------------------------------------------------------

create or replace function public.on_message_sent()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  t         public.message_threads;
  other_org uuid;
  sender    text;
  subject   text;
begin
  select * into t from public.message_threads where id = new.thread_id;

  update public.message_threads set last_message_at = new.created_at where id = t.id;

  -- The sender has, by definition, read their own message.
  insert into public.message_reads (thread_id, user_id, last_read_at)
  values (new.thread_id, new.sender_user_id, new.created_at)
  on conflict (thread_id, user_id) do update set last_read_at = excluded.last_read_at;

  other_org := case when t.brand_org_id = new.sender_org_id
                    then t.factory_org_id else t.brand_org_id end;

  select name into sender from public.orgs where id = new.sender_org_id;

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
    left(btrim(new.body), 160)
  );

  return new;
end;
$$;

create trigger messages_after_send
  after insert on public.messages
  for each row execute function public.on_message_sent();

-- ---------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------
-- uploadDocument writes attachments to {org}/message_attachment/{thread}/{file},
-- so the third path segment is the thread and is_thread_party can be asked
-- about it directly. Storage policies can only see the object's name, which is
-- why the thread has to be IN the path.
-- ---------------------------------------------------------------------------

create policy "thread party private read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'org-private'
    and split_part(name, '/', 2) = 'message_attachment'
    and public.is_thread_party(public.storage_path_scope(name))
  );
