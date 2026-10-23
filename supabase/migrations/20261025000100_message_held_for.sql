-- ============================================================================
-- Why a held message was held, for its sender
-- ----------------------------------------------------------------------------
-- The sender of a held message was always told "it looks like it shares
-- contact details", whatever the screen found. A message held because it
-- proposed going outside the platform said the same, which is wrong and
-- confusing. What the screen thinks is in message_screenings, which is
-- staff-only (a note about a customer), so the sender's page had nothing
-- truer to say.
--
-- `held_for` is the one thing the sender is told, as a kind, not the
-- screen's words:
--
--   contact_details    an email, a phone number, a messaging-app id, a link
--   outside_platform   proposes talking, paying or ordering off the platform
--
-- It lives only while the message is held: a trigger clears it the moment
-- the message leaves `held`, so the recipient of a released message never
-- reads why it was held, and staff's release and reject functions need no
-- change. record_message_screening takes it as a sixth, optional argument;
-- the five-argument calls of the site that is live while this is applied
-- still resolve, and leave it empty.
-- ============================================================================

alter table public.messages
  add column held_for text
    constraint message_held_for_known
      check (held_for in ('contact_details', 'outside_platform')),
  add constraint message_held_for_only_while_held
    check (held_for is null or delivery = 'held');

create or replace function public.on_message_leaves_hold()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.delivery <> 'held' then
    new.held_for := null;
  end if;
  return new;
end;
$$;

revoke all on function public.on_message_leaves_hold() from public, authenticated;

create trigger messages_held_for_while_held
  before insert or update on public.messages
  for each row execute function public.on_message_leaves_hold();

drop function public.record_message_screening(uuid, text, text, text, text);

create function public.record_message_screening(
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

  if outcome = 'delivered' then
    update public.messages set delivery = 'delivered', delivered_at = now()
     where id = m.id returning * into m;
    perform public.announce_message(m.id);
  else
    update public.messages
       set delivery = 'held',
           held_for = record_message_screening.held_for
     where id = m.id returning * into m;
  end if;

  insert into public.message_screenings (message_id, outcome, method, model, reason, screened_at)
  values (m.id, outcome, method, nullif(btrim(model), ''), nullif(btrim(reason), ''), now())
  on conflict (message_id) do nothing;

  return m;
end;
$$;

revoke all on function public.record_message_screening(uuid, text, text, text, text, text)
  from public, authenticated;
grant execute on function public.record_message_screening(uuid, text, text, text, text, text)
  to service_role;
