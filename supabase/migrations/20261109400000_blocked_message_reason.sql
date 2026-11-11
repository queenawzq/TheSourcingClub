-- A blocked message tells its sender why: contact details, or dealing outside
-- the platform. The screen has always found which (held_for), and since
-- 20261108100000 it was thrown away, so every sender read "contact details".
--
-- It goes in review_note, the one column of the screen's that the sender already
-- reads, and which no client can write (on_message_insert clears it). held_for
-- stays what it says: only while a message is held. A blocked message reaches
-- nobody else, and nothing older has a reason, so those read as before.
--
-- From 20261108100000, the latest definition, same signature so the server
-- that is live while this applies still resolves it.
alter table public.messages drop constraint message_review_note_only_on_reject;
alter table public.messages
  add constraint message_review_note_rejected_or_blocked
    check (review_note is null or delivery in ('rejected', 'blocked'));

-- Copied from 20261025000110, which clears held_for the same way.
create or replace function public.on_message_leaves_hold()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.delivery <> 'held' then
    new.held_for := null;
  end if;
  if new.delivery not in ('rejected', 'blocked') then
    new.review_note := null;
  end if;
  return new;
end;
$$;

create or replace function public.record_message_screening(
  target_message uuid,
  outcome        text,
  method         text,
  reason         text default null,
  model          text default null,
  held_for       text default null
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
  if held_for is not null and held_for not in ('contact_details', 'outside_platform') then
    raise exception 'held_for must be contact_details or outside_platform' using errcode = '22023';
  end if;

  select * into m from public.messages where id = target_message for update;
  if not found then
    raise exception 'message not found' using errcode = 'P0002';
  end if;
  if m.delivery <> 'checking' then
    return m;
  end if;

  if outcome = 'delivered' or public.thread_has_contract(m.thread_id) then
    update public.messages set delivery = 'delivered', delivered_at = now()
     where id = m.id returning * into m;
    perform public.announce_message(m.id);
  else
    update public.messages set delivery = 'blocked', review_note = record_message_screening.held_for
     where id = m.id returning * into m;
  end if;

  insert into public.message_screenings (message_id, outcome, method, model, reason, screened_at)
  values (m.id, outcome, method, nullif(btrim(model), ''), nullif(btrim(reason), ''), now())
  on conflict (message_id) do nothing;
  return m;
end;
$$;

revoke all on function public.record_message_screening(uuid, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.record_message_screening(uuid, text, text, text, text, text)
  to service_role;
