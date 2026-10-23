-- ===========================================================================
-- Calls: the words on a call are checked for contact details, like messages
-- ===========================================================================
-- A call's title and description reach the other side (its card, the
-- notification and its email), and so does the reason given for declining or
-- cancelling one. Messages are screened for a way off the platform; call text
-- was not, so "or just WhatsApp me on +44 …" in a description went straight
-- through.
--
-- The check is the message patterns (api/_message-patterns.js), which only
-- the server can run, so the server records what it passed: `/api/screen-call-text`
-- checks the words a person is about to send and, when they are clean,
-- writes them here for that person. A trigger on `calls` then refuses any
-- title, description or reason written by a signed-in person that the server
-- has not passed in the last 10 minutes. Calling `propose_call` (or counter,
-- decline, cancel) directly with words the server never saw is refused, so
-- the check cannot be stepped around. Words with contact details are refused
-- at the check, with a reason the person can act on; nothing is held.
--
-- The server's own writes (the secret key, no signed-in person) are not
-- checked: that is the code doing the checking.
--
-- Also: a counter to a proposal whose time has passed is refused, as
-- counter_call's comment always said and the screen already assumes (a
-- passed invite has no buttons).
--
-- Additive only (a table, functions, a trigger), so it is safe while the
-- current site is live; the current site has no calls.
-- ===========================================================================

create table public.call_text_checks (
  user_id     uuid not null references auth.users (id) on delete cascade,
  body        text not null,
  checked_at  timestamptz not null default now()
);

-- md5 so a long description in Chinese still fits a btree entry; the trigger
-- compares the text itself too.
create unique index call_text_checks_user_body on public.call_text_checks (user_id, md5(body));

alter table public.call_text_checks enable row level security;
-- No policy and no grant: the server's record, unreadable with the publishable key.
revoke all on public.call_text_checks from public, anon, authenticated;
grant all on public.call_text_checks to service_role;

-- What the server passed, for one person. Trimmed as the call functions trim.
create or replace function public.record_call_text_check(target_user uuid, texts text[])
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.call_text_checks
   where user_id = target_user and checked_at < now() - interval '1 day';
  insert into public.call_text_checks (user_id, body)
  select target_user, btrim(t)
    from unnest(coalesce(texts, '{}')) as t
   where length(btrim(coalesce(t, ''))) > 0
  on conflict (user_id, md5(body)) do update set checked_at = now();
end;
$$;

-- Whether the signed-in person's words were passed by the server just now.
-- Nothing to check (no text) passes.
create or replace function public.call_text_checked(value text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select length(btrim(coalesce(value, ''))) = 0
      or exists (
        select 1 from public.call_text_checks k
         where k.user_id = auth.uid()
           and md5(k.body) = md5(btrim(value))
           and k.body = btrim(value)
           and k.checked_at > now() - interval '10 minutes'
      );
$$;

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

create trigger calls_text_checked
  before insert or update on public.calls
  for each row execute function public.calls_require_checked_text();

-- ---------------------------------------------------------------------------
-- Propose another time: checked exactly like an accept, the passed time too
-- ---------------------------------------------------------------------------
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
  -- Locked and checked like an accept, so a counter to a time that has
  -- passed is refused: the screen offers a fresh proposal instead.
  old := public.call_to_answer(target_call);

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
-- Grants
-- ---------------------------------------------------------------------------
revoke all on function public.record_call_text_check(uuid, text[]) from public, anon, authenticated;
revoke all on function public.call_text_checked(text) from public, anon, authenticated;
revoke all on function public.calls_require_checked_text() from public, anon, authenticated;
revoke all on function public.counter_call(uuid, timestamptz, integer, text, text, text) from public;

grant execute on function public.record_call_text_check(uuid, text[]) to service_role;
grant execute on function public.counter_call(uuid, timestamptz, integer, text, text, text) to authenticated;
