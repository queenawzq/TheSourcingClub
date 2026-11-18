-- ============================================================================
-- Start a call now
-- ----------------------------------------------------------------------------
-- A party to a conversation may start a call now, not only schedule one. The
-- call starts at once and "rings" for 15 minutes: the caller may join its
-- meeting straight away, and the other company is told (bell, and an email
-- under its messages switch) and may join, which accepts it, or decline. Nobody
-- answering in 15 minutes is a missed call; the caller may start another.
--
-- Everything else is a call as 20261014000100 made it: read through the
-- conversation, written only through functions, joined through /api/call-join.
-- Add-only, so the site live during the deploy keeps working: a new column with
-- a default, a new function, and the answer window and the join context widened
-- for instant calls only (scheduled calls behave exactly as before).
-- ============================================================================

alter table public.calls
  add column instant boolean not null default false;

comment on column public.calls.instant is
  'Started now (start_call_now), not scheduled: rings for 15 minutes from starts_at.';

-- How long an instant call waits for the other side. One place: the answer
-- window, the join context and start_call_now all read it.
create or replace function public.instant_call_rings_until(c public.calls)
returns timestamptz
language sql
immutable
set search_path = public, pg_temp
as $$
  select case when c.instant then c.starts_at + interval '15 minutes' end;
$$;

-- ---------------------------------------------------------------------------
-- The call's title passes the call-text check without the server: it is fixed
-- here, never typed, so there are no person's words to check.
-- ---------------------------------------------------------------------------
create or replace function public.calls_require_checked_text()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- The server's own writes are not a person's words.
  if auth.uid() is null then
    return new;
  end if;
  if (tg_op = 'INSERT' or new.title is distinct from old.title)
     and not (tg_op = 'INSERT' and new.instant and new.title = 'Video call')
     and not public.call_text_checked(new.title) then
    raise exception 'the call''s title was not checked; send it again' using errcode = '42501';
  end if;
  if (tg_op = 'INSERT' or new.agenda is distinct from old.agenda)
     and not public.call_text_checked(new.agenda) then
    raise exception 'the call''s description was not checked; send it again' using errcode = '42501';
  end if;
  if (tg_op = 'INSERT' or new.response_note is distinct from old.response_note)
     and not public.call_text_checked(new.response_note) then
    raise exception 'the reason was not checked; send it again' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Start
-- ---------------------------------------------------------------------------
create or replace function public.start_call_now(target_thread uuid, time_zone text default null)
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
    raise exception 'only a party to this conversation may start a call' using errcode = '42501';
  end if;
  -- One at a time per conversation: two presses, or both sides at once, queue
  -- here and the second finds the first.
  select * into t from public.message_threads where id = target_thread for update;
  mine := public.my_side_of_thread(t);
  other := case when mine = t.brand_org_id then t.factory_org_id else t.brand_org_id end;

  if time_zone is not null and not exists (select 1 from pg_timezone_names where name = time_zone) then
    raise exception 'unknown time zone' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.calls k
     where k.thread_id = t.id
       and k.instant
       and ((k.status = 'proposed' and now() < public.instant_call_rings_until(k))
         or (k.status = 'accepted' and now() < k.starts_at + make_interval(mins => k.duration_minutes)))
  ) then
    raise exception 'there is already a call in this conversation' using errcode = '22023';
  end if;

  insert into public.calls
    (thread_id, title, starts_at, duration_minutes, instant,
     proposer_org_id, proposer_user_id, proposer_time_zone)
  values
    (t.id, 'Video call', now(), 30, true,
     mine, auth.uid(), time_zone)
  returning * into c;

  if time_zone is not null then
    perform public.set_my_time_zone(time_zone);
  end if;

  select name into who from public.orgs where id = mine;
  perform public.notify_call(c, other, 'call_started',
    format('%s started a call about %s', who, public.thread_subject(t)),
    c.title);
  return c;
end;
$$;

-- ---------------------------------------------------------------------------
-- Answering: an instant call may be answered while it rings. A scheduled one
-- is unchanged (before its start).
-- ---------------------------------------------------------------------------
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
  if c.instant then
    if now() >= public.instant_call_rings_until(c) then
      raise exception 'this call has ended' using errcode = '22023';
    end if;
  elsif c.starts_at <= now() then
    raise exception 'this time has passed; propose another time' using errcode = '22023';
  end if;
  return c;
end;
$$;

-- ---------------------------------------------------------------------------
-- Ending a call that rings: the caller, while it rings. The other side
-- declines instead; once nobody answered it is missed and stays so.
-- As 20261025000210 otherwise.
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
  was   text;
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
    if c.instant and now() >= public.instant_call_rings_until(c) then
      raise exception 'this call has ended' using errcode = '22023';
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

  was := c.status;
  update public.calls
     set status = 'cancelled', cancelled_by_org_id = mine,
         response_note = nullif(btrim(coalesce(note, '')), '')
   where id = c.id
  returning * into c;

  select name into who from public.orgs where id = mine;
  perform public.notify_call(c, other, 'call_cancelled',
    case
      when c.instant then format('%s ended the call about %s', who, public.thread_subject(t))
      when was = 'proposed' then format('%s withdrew the invite to a call about %s', who, public.thread_subject(t))
      else format('%s cancelled the call about %s', who, public.thread_subject(t))
    end,
    coalesce(c.response_note, c.title));
  return c;
end;
$$;

-- ---------------------------------------------------------------------------
-- Joining: /api/call-join lets the caller into an instant call that rings.
-- The return type grows, so the function is dropped and made again in this
-- transaction; the route reads its columns by name.
-- ---------------------------------------------------------------------------
drop function public.call_join_context(uuid, uuid);

create function public.call_join_context(target_call uuid, target_user uuid)
returns table (
  call_id uuid, title text, starts_at timestamptz, duration_minutes integer,
  status public.call_status, user_name text, org_name text, is_party boolean,
  opens_at timestamptz, closes_at timestamptz,
  instant boolean, is_caller boolean, rings_until timestamptz
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
         c.starts_at + make_interval(mins => c.duration_minutes) + interval '30 minutes',
         c.instant,
         exists (select 1 from public.org_members m
                  where m.org_id = c.proposer_org_id and m.user_id = target_user),
         public.instant_call_rings_until(c)
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

-- ---------------------------------------------------------------------------
-- The email: under the messages switch, like every other call notice.
-- As 20261115400000 otherwise (its written map now also lists call_started).
-- ---------------------------------------------------------------------------
create or replace function public.notification_email_category(kind text)
returns text
language sql
immutable
as $$
  select case
    when kind in ('rfq_invited', 'rfq_cancelled', 'quote_received', 'quote_withdrawn',
                  'quote_accepted', 'quote_declined', 'rfq_matched', 'capacity_reminder')
      then 'rfq'
    when kind in ('payment_due', 'payment_sent', 'payment_confirmed', 'payment_rejected',
                  'payment_failed', 'payment_refunded', 'funds_released',
                  'milestone_submitted', 'milestone_approved', 'milestone_dispute',
                  'milestone_reminder', 'milestone_due_soon',
                  'schedule_updated', 'schedule_agreed',
                  'order_created', 'order_activated', 'order_completed', 'order_cancelled',
                  'cancellation_proposed', 'cancellation_withdrawn', 'cancellation_declined')
      then 'payments'
    when kind in ('message', 'call_proposed', 'call_accepted', 'call_declined',
                  'call_countered', 'call_cancelled', 'call_started')
      then 'messages'
    when kind = 'payout_method_changed'
      then 'account'
    else null
  end
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on function public.instant_call_rings_until(public.calls) from public, anon, authenticated;
revoke all on function public.start_call_now(uuid, text) from public, anon;
revoke all on function public.call_to_answer(uuid) from public, anon, authenticated;
revoke all on function public.cancel_call(uuid, text) from public;
revoke all on function public.call_join_context(uuid, uuid) from public, anon, authenticated;
revoke all on function public.notification_email_category(text) from public, anon;

grant execute on function public.start_call_now(uuid, text) to authenticated;
grant execute on function public.cancel_call(uuid, text) to authenticated;
grant execute on function public.call_join_context(uuid, uuid) to service_role;
grant execute on function public.notification_email_category(text) to authenticated, service_role;
