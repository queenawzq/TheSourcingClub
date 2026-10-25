-- A withdrawn invite says so.
--
-- cancel_call does two things: the proposer withdrawing an invite nobody has
-- answered, and either side cancelling a confirmed call. The dialog tells the
-- proposer the other side "is told the invite is withdrawn", but the
-- notification said "cancelled the call" for both. The function is the same
-- as in 20261014000100 apart from that title. The kind stays call_cancelled.

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
    case when was = 'proposed'
      then format('%s withdrew the invite to a call about %s', who, public.thread_subject(t))
      else format('%s cancelled the call about %s', who, public.thread_subject(t))
    end,
    coalesce(c.response_note, c.title));
  return c;
end;
$$;
