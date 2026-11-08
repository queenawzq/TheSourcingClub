-- ============================================================================
-- Contact details are blocked before a contract, allowed after it
-- ----------------------------------------------------------------------------
-- The call of Nov 7 (Queena, John): staff no longer review held messages.
-- Like Upwork, a message the screen flags (contact details, or a proposal to
-- talk, deal or pay off the platform) is decided at once:
--
--   before a contract  BLOCKED: never delivered, nobody notified. The sender
--                      sees it marked "Not sent" with the guidelines.
--   after a contract   DELIVERED, as any other message: once two companies
--                      have an order they may exchange details.
--
-- A contract is a production order between the two companies on what the
-- thread is about: the thread is the order's own, or it is a request thread
-- and that request has an order with that factory. Any state counts: once
-- they had an order they have had every reason to talk.
--
-- Decided here, not in api/screen-message.js, so the server that is live
-- while this is applied (which still passes outcome 'held') blocks too, and
-- the server is trusted with nothing new. message_screenings keeps what the
-- screen found (outcome 'held' now means "flagged"), so repeat attempts can
-- be counted later; nothing restricts an account yet.
--
-- release_held_message, reject_held_message and admin_message_queue stay:
-- the live site calls them while this deploys. Nothing is held any more, so
-- they find nothing.
-- ============================================================================

alter table public.messages drop constraint message_delivery_known;
alter table public.messages
  add constraint message_delivery_known
    check (delivery in ('checking', 'delivered', 'held', 'rejected', 'blocked'));

-- ---------------------------------------------------------------------------
-- Is there a contract behind this thread?
-- ---------------------------------------------------------------------------
create or replace function public.thread_has_contract(target_thread uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.message_threads t
    where t.id = target_thread
      and (
        t.order_id is not null
        or exists (
          select 1 from public.production_orders o
          where o.rfq_id = t.rfq_id
            and o.factory_org_id = t.factory_org_id
            and o.brand_org_id = t.brand_org_id
        )
      )
  );
$$;
-- The server asks with the secret key; a person learns it from what happens
-- to their message.
revoke all on function public.thread_has_contract(uuid) from public, anon, authenticated;
grant execute on function public.thread_has_contract(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- The screen's verdict, decided against the contract
-- ---------------------------------------------------------------------------
-- Same signature as 20261025000110, so the live server's call resolves.
-- held_for is still accepted and recorded nowhere new: a blocked message
-- tells its sender one thing whatever the screen found.
-- ---------------------------------------------------------------------------
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
    update public.messages set delivery = 'blocked'
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

-- ---------------------------------------------------------------------------
-- Messages still waiting for staff
-- ---------------------------------------------------------------------------
-- Nobody will decide them now. They were held before the rule changed, so
-- they end as every flagged message before a contract does: not sent, with
-- the guidelines. The trigger from 20261025000110 clears held_for.
-- ---------------------------------------------------------------------------
update public.messages set delivery = 'blocked' where delivery = 'held';
