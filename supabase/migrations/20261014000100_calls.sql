-- ===========================================================================
-- Calls: a brand and a factory schedule a video call from their conversation
-- ===========================================================================
-- A call belongs to a conversation (`message_threads`), so who may see it is
-- already answered by `is_thread_party()`: there is no new set of rules to
-- keep in step with messages.
--
-- One side proposes a time; only the OTHER side accepts, declines or proposes
-- another time (a counter is a new row pointing at the one it answers, which
-- becomes `countered`, so the history keeps every time that was offered). The
-- proposing side may withdraw its proposal; either side may cancel an
-- accepted call that has not started. Every step notifies the other company.
--
-- Times are stored in UTC (`timestamptz`). Each person's own time zone is kept
-- on `user_profiles` (saved by the app from the browser) so each side can be
-- shown the other side's local time, and the proposer's zone is kept on the
-- call itself.
--
-- The video meeting (Zoom) is created by the server the first time someone
-- joins, and its number, passcode and link live in `call_meetings`, which the
-- browser cannot read: a join goes through `/api/call-join`, which checks the
-- caller is a party and the call is on now.
--
-- Additive only (new type, two tables, one nullable column, functions), so it
-- is safe while the current site is live.
-- ===========================================================================

create type public.call_status as enum ('proposed', 'accepted', 'declined', 'countered', 'cancelled');

create table public.calls (
  id                 uuid primary key default gen_random_uuid(),
  thread_id          uuid not null references public.message_threads (id) on delete cascade,
  -- The proposal this one answers with another time, if any.
  counter_of         uuid references public.calls (id) on delete set null,

  title              text not null check (length(btrim(title)) between 1 and 120),
  agenda             text check (agenda is null or length(agenda) <= 1000),
  starts_at          timestamptz not null,
  duration_minutes   integer not null default 30 check (duration_minutes between 15 and 120),

  proposer_org_id    uuid not null references public.orgs (id) on delete cascade,
  proposer_user_id   uuid references auth.users (id) on delete set null,
  proposer_time_zone text,

  status             public.call_status not null default 'proposed',
  responded_by       uuid references auth.users (id) on delete set null,
  responded_at       timestamptz,
  response_note      text check (response_note is null or length(response_note) <= 500),
  cancelled_by_org_id uuid references public.orgs (id) on delete set null,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index calls_thread_idx on public.calls (thread_id, starts_at);
create index calls_upcoming_idx on public.calls (starts_at) where status in ('proposed', 'accepted');

create trigger calls_touch
  before update on public.calls
  for each row execute function public.touch_updated_at();

alter table public.calls enable row level security;

create policy calls_read on public.calls
  for select to authenticated
  using (public.is_thread_party(thread_id));

-- Reads only. Every change goes through the functions below, which check who
-- is acting and what state the call is in (a policy can gate the row a change
-- starts from, not what the change writes).
revoke insert, update, delete, truncate on public.calls from authenticated, anon;
grant select on public.calls to authenticated;

-- ---------------------------------------------------------------------------
-- The video meeting behind an accepted call. Server only.
-- ---------------------------------------------------------------------------
create table public.call_meetings (
  call_id         uuid primary key references public.calls (id) on delete cascade,
  provider        text not null default 'zoom',
  meeting_number  text,
  passcode        text,
  join_url        text,
  -- Set while one request is creating the meeting, so a second Join at the
  -- same moment waits for it instead of creating a second meeting.
  creating_since  timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger call_meetings_touch
  before update on public.call_meetings
  for each row execute function public.touch_updated_at();

alter table public.call_meetings enable row level security;
-- No policy and no grant: unreadable to anyone holding the publishable key.
revoke all on public.call_meetings from authenticated, anon;

-- ---------------------------------------------------------------------------
-- Each person's time zone
-- ---------------------------------------------------------------------------
alter table public.user_profiles add column time_zone text;

create or replace function public.set_my_time_zone(zone text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  if zone is null or not exists (select 1 from pg_timezone_names where name = zone) then
    raise exception 'unknown time zone' using errcode = '22023';
  end if;
  update public.user_profiles
     set time_zone = zone
   where id = auth.uid()
     and time_zone is distinct from zone;
end;
$$;

-- The other company's time zone in a conversation: the zone of its member
-- who was seen most recently. Nothing else about them.
create or replace function public.thread_counterparty_time_zone(target_thread uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  t     public.message_threads;
  other uuid;
  zone  text;
begin
  if not public.is_thread_party(target_thread) then
    raise exception 'not your conversation' using errcode = '42501';
  end if;
  select * into t from public.message_threads where id = target_thread;
  other := case when public.is_org_member(t.brand_org_id) then t.factory_org_id else t.brand_org_id end;
  select p.time_zone into zone
  from public.org_members m
  join public.user_profiles p on p.id = m.user_id
  where m.org_id = other and p.time_zone is not null
  order by p.updated_at desc
  limit 1;
  return zone;
end;
$$;

-- ---------------------------------------------------------------------------
-- Helpers (internal)
-- ---------------------------------------------------------------------------

-- What the conversation is about, for notification titles.
create or replace function public.thread_subject(t public.message_threads)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when t.order_id is not null then
      (select order_number from public.production_orders where id = t.order_id)
    else
      (select coalesce(nullif(btrim(title), ''), 'your request') from public.rfqs where id = t.rfq_id)
  end;
$$;

create or replace function public.notify_call(c public.calls, recipient uuid, kind text, title text, body text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  t public.message_threads;
begin
  select * into t from public.message_threads where id = c.thread_id;
  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  values (recipient, kind, 'thread', t.id, t.order_id, title, body);
end;
$$;

-- The checks a new time must pass, whoever proposes it.
create or replace function public.check_call_fields(starts_at timestamptz, duration integer, title text, agenda text, zone text)
returns void
language plpgsql
stable
set search_path = public, pg_temp
as $$
begin
  if starts_at is null or starts_at < now() + interval '15 minutes' then
    raise exception 'pick a time at least 15 minutes from now' using errcode = '22023';
  end if;
  if starts_at > now() + interval '1 year' then
    raise exception 'pick a time within the next year' using errcode = '22023';
  end if;
  if duration is null or duration not between 15 and 120 then
    raise exception 'a call lasts 15 to 120 minutes' using errcode = '22023';
  end if;
  if length(btrim(coalesce(title, ''))) = 0 then
    raise exception 'give the call a title' using errcode = '22023';
  end if;
  if length(btrim(title)) > 120 then
    raise exception 'keep the title under 120 characters' using errcode = '22023';
  end if;
  if agenda is not null and length(agenda) > 1000 then
    raise exception 'keep the description under 1000 characters' using errcode = '22023';
  end if;
  if zone is not null and not exists (select 1 from pg_timezone_names where name = zone) then
    raise exception 'unknown time zone' using errcode = '22023';
  end if;
end;
$$;

-- The caller's company in this conversation (null if it is not a party).
create or replace function public.my_side_of_thread(t public.message_threads)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when public.is_org_member(t.brand_org_id) then t.brand_org_id
    when public.is_org_member(t.factory_org_id) then t.factory_org_id
  end;
$$;

-- ---------------------------------------------------------------------------
-- Propose
-- ---------------------------------------------------------------------------
create or replace function public.propose_call(
  target_thread uuid,
  starts_at timestamptz,
  duration_minutes integer,
  title text,
  agenda text,
  time_zone text
)
returns public.calls
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  t     public.message_threads;
  mine  uuid;
  other uuid;
  who   text;
  c     public.calls;
begin
  if not public.is_thread_party(target_thread) then
    raise exception 'only a party to this conversation may propose a call' using errcode = '42501';
  end if;
  select * into t from public.message_threads where id = target_thread;
  mine := public.my_side_of_thread(t);
  other := case when mine = t.brand_org_id then t.factory_org_id else t.brand_org_id end;

  perform public.check_call_fields(starts_at, duration_minutes, title, agenda, time_zone);

  insert into public.calls
    (thread_id, title, agenda, starts_at, duration_minutes,
     proposer_org_id, proposer_user_id, proposer_time_zone)
  values
    (t.id, btrim(title), nullif(btrim(coalesce(agenda, '')), ''), starts_at, duration_minutes,
     mine, auth.uid(), time_zone)
  returning * into c;

  select name into who from public.orgs where id = mine;
  perform public.notify_call(c, other, 'call_proposed',
    format('%s invited you to a call about %s', who, public.thread_subject(t)),
    c.title);
  return c;
end;
$$;

-- ---------------------------------------------------------------------------
-- Accept, decline, propose another time: the other side only
-- ---------------------------------------------------------------------------

-- Locks an open proposal the caller may answer, or refuses.
create or replace function public.call_to_answer(target_call uuid)
returns public.calls
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c public.calls;
begin
  select * into c from public.calls where id = target_call for update;
  if not found or not public.is_thread_party(c.thread_id) then
    raise exception 'call not found' using errcode = 'P0002';
  end if;
  if public.is_org_member(c.proposer_org_id) then
    raise exception 'the other side answers this invite' using errcode = '42501';
  end if;
  if c.status <> 'proposed' then
    raise exception 'this invite is % already', c.status using errcode = '22023';
  end if;
  if c.starts_at <= now() then
    raise exception 'this time has passed; propose another time' using errcode = '22023';
  end if;
  return c;
end;
$$;

create or replace function public.accept_call(target_call uuid, time_zone text default null)
returns public.calls
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c   public.calls;
  t   public.message_threads;
  who text;
begin
  c := public.call_to_answer(target_call);
  select * into t from public.message_threads where id = c.thread_id;

  update public.calls
     set status = 'accepted', responded_by = auth.uid(), responded_at = now()
   where id = c.id
  returning * into c;

  if time_zone is not null then
    perform public.set_my_time_zone(time_zone);
  end if;

  select name into who from public.orgs where id = public.my_side_of_thread(t);
  perform public.notify_call(c, c.proposer_org_id, 'call_accepted',
    format('%s accepted your call about %s', who, public.thread_subject(t)),
    c.title);
  return c;
end;
$$;

create or replace function public.decline_call(target_call uuid, note text default null)
returns public.calls
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c   public.calls;
  t   public.message_threads;
  who text;
begin
  c := public.call_to_answer(target_call);
  if note is not null and length(note) > 500 then
    raise exception 'keep the note under 500 characters' using errcode = '22023';
  end if;
  select * into t from public.message_threads where id = c.thread_id;

  update public.calls
     set status = 'declined', responded_by = auth.uid(), responded_at = now(),
         response_note = nullif(btrim(coalesce(note, '')), '')
   where id = c.id
  returning * into c;

  select name into who from public.orgs where id = public.my_side_of_thread(t);
  perform public.notify_call(c, c.proposer_org_id, 'call_declined',
    format('%s declined your call about %s', who, public.thread_subject(t)),
    coalesce(c.response_note, c.title));
  return c;
end;
$$;

create or replace function public.counter_call(
  target_call uuid,
  starts_at timestamptz,
  duration_minutes integer,
  title text,
  agenda text,
  time_zone text
)
returns public.calls
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  old  public.calls;
  t    public.message_threads;
  mine uuid;
  who  text;
  c    public.calls;
begin
  -- Locked and checked like an accept; a counter to a passed time is still
  -- refused there, since the screen offers "propose another time" instead
  -- as a fresh proposal.
  select * into old from public.calls where id = target_call for update;
  if not found or not public.is_thread_party(old.thread_id) then
    raise exception 'call not found' using errcode = 'P0002';
  end if;
  if public.is_org_member(old.proposer_org_id) then
    raise exception 'the other side answers this invite' using errcode = '42501';
  end if;
  if old.status <> 'proposed' then
    raise exception 'this invite is % already', old.status using errcode = '22023';
  end if;

  perform public.check_call_fields(starts_at, duration_minutes, title, agenda, time_zone);
  select * into t from public.message_threads where id = old.thread_id;
  mine := public.my_side_of_thread(t);

  update public.calls
     set status = 'countered', responded_by = auth.uid(), responded_at = now()
   where id = old.id;

  insert into public.calls
    (thread_id, counter_of, title, agenda, starts_at, duration_minutes,
     proposer_org_id, proposer_user_id, proposer_time_zone)
  values
    (t.id, old.id, btrim(title), nullif(btrim(coalesce(agenda, '')), ''), starts_at, duration_minutes,
     mine, auth.uid(), time_zone)
  returning * into c;

  select name into who from public.orgs where id = mine;
  perform public.notify_call(c, old.proposer_org_id, 'call_countered',
    format('%s proposed another time for your call about %s', who, public.thread_subject(t)),
    c.title);
  return c;
end;
$$;

-- ---------------------------------------------------------------------------
-- Withdraw (proposer) or cancel (either side, accepted and not started)
-- ---------------------------------------------------------------------------
create or replace function public.cancel_call(target_call uuid, note text default null)
returns public.calls
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c     public.calls;
  t     public.message_threads;
  mine  uuid;
  other uuid;
  who   text;
begin
  select * into c from public.calls where id = target_call for update;
  if not found or not public.is_thread_party(c.thread_id) then
    raise exception 'call not found' using errcode = 'P0002';
  end if;
  select * into t from public.message_threads where id = c.thread_id;
  mine := public.my_side_of_thread(t);
  other := case when mine = t.brand_org_id then t.factory_org_id else t.brand_org_id end;

  if c.status = 'proposed' then
    if c.proposer_org_id <> mine then
      raise exception 'decline the invite instead' using errcode = '42501';
    end if;
  elsif c.status = 'accepted' then
    if c.starts_at <= now() then
      raise exception 'this call has started' using errcode = '22023';
    end if;
  else
    raise exception 'this call is % already', c.status using errcode = '22023';
  end if;
  if note is not null and length(note) > 500 then
    raise exception 'keep the note under 500 characters' using errcode = '22023';
  end if;

  update public.calls
     set status = 'cancelled', cancelled_by_org_id = mine,
         response_note = nullif(btrim(coalesce(note, '')), '')
   where id = c.id
  returning * into c;

  select name into who from public.orgs where id = mine;
  perform public.notify_call(c, other, 'call_cancelled',
    format('%s cancelled the call about %s', who, public.thread_subject(t)),
    coalesce(c.response_note, c.title));
  return c;
end;
$$;

-- ---------------------------------------------------------------------------
-- Joining (server only: /api/call-join)
-- ---------------------------------------------------------------------------

-- Whether this user may join this call now, with what the server needs.
-- Opens 10 minutes before the start and closes 30 minutes after the end.
create or replace function public.call_join_context(target_call uuid, target_user uuid)
returns table (
  call_id uuid, title text, starts_at timestamptz, duration_minutes integer,
  status public.call_status, user_name text, org_name text, is_party boolean,
  opens_at timestamptz, closes_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.id, c.title, c.starts_at, c.duration_minutes, c.status,
         coalesce(nullif(btrim(p.full_name), ''), split_part(p.email, '@', 1)),
         o.name,
         o.id is not null,
         c.starts_at - interval '10 minutes',
         c.starts_at + make_interval(mins => c.duration_minutes) + interval '30 minutes'
  from public.calls c
  join public.message_threads t on t.id = c.thread_id
  left join public.user_profiles p on p.id = target_user
  left join lateral (
    select g.id, g.name from public.orgs g
    join public.org_members m on m.org_id = g.id and m.user_id = target_user
    where g.id in (t.brand_org_id, t.factory_org_id)
    limit 1
  ) o on true
  where c.id = target_call;
$$;

-- Claims the right to create the meeting. Returns the existing row when a
-- meeting exists (or another request is creating one, started under a minute
-- ago); returns a row with `creating_since` = now() when THIS caller should
-- create it.
create or replace function public.claim_call_meeting(target_call uuid)
returns table (meeting_number text, passcode text, join_url text, should_create boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.call_meetings;
begin
  insert into public.call_meetings (call_id) values (target_call)
  on conflict (call_id) do nothing;
  select * into m from public.call_meetings where call_id = target_call for update;
  if m.meeting_number is not null then
    return query select m.meeting_number, m.passcode, m.join_url, false;
  elsif m.creating_since is not null and m.creating_since > now() - interval '1 minute' then
    return query select null::text, null::text, null::text, false;
  else
    update public.call_meetings set creating_since = now() where call_id = target_call;
    return query select null::text, null::text, null::text, true;
  end if;
end;
$$;

create or replace function public.record_call_meeting(target_call uuid, number text, code text, url text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.call_meetings
     set meeting_number = number, passcode = code, join_url = url, creating_since = null
   where call_id = target_call;
$$;

-- A failed create frees the claim at once, so the next Join tries again.
create or replace function public.release_call_meeting_claim(target_call uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.call_meetings set creating_since = null
   where call_id = target_call and meeting_number is null;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on function public.set_my_time_zone(text) from public;
revoke all on function public.thread_counterparty_time_zone(uuid) from public;
revoke all on function public.thread_subject(public.message_threads) from public, anon, authenticated;
revoke all on function public.notify_call(public.calls, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.check_call_fields(timestamptz, integer, text, text, text) from public, anon, authenticated;
revoke all on function public.my_side_of_thread(public.message_threads) from public, anon, authenticated;
revoke all on function public.propose_call(uuid, timestamptz, integer, text, text, text) from public;
revoke all on function public.call_to_answer(uuid) from public, anon, authenticated;
revoke all on function public.accept_call(uuid, text) from public;
revoke all on function public.decline_call(uuid, text) from public;
revoke all on function public.counter_call(uuid, timestamptz, integer, text, text, text) from public;
revoke all on function public.cancel_call(uuid, text) from public;
revoke all on function public.call_join_context(uuid, uuid) from public, anon, authenticated;
revoke all on function public.claim_call_meeting(uuid) from public, anon, authenticated;
revoke all on function public.record_call_meeting(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.release_call_meeting_claim(uuid) from public, anon, authenticated;

grant execute on function public.set_my_time_zone(text) to authenticated;
grant execute on function public.thread_counterparty_time_zone(uuid) to authenticated;
grant execute on function public.propose_call(uuid, timestamptz, integer, text, text, text) to authenticated;
grant execute on function public.accept_call(uuid, text) to authenticated;
grant execute on function public.decline_call(uuid, text) to authenticated;
grant execute on function public.counter_call(uuid, timestamptz, integer, text, text, text) to authenticated;
grant execute on function public.cancel_call(uuid, text) to authenticated;

-- The server's: the join checks and the meeting record.
grant execute on function public.call_join_context(uuid, uuid) to service_role;
grant execute on function public.claim_call_meeting(uuid) to service_role;
grant execute on function public.record_call_meeting(uuid, text, text, text) to service_role;
grant execute on function public.release_call_meeting_claim(uuid) to service_role;
grant all on public.call_meetings to service_role;
