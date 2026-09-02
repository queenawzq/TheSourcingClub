-- ============================================================================
-- 020  Notifications and award
-- ----------------------------------------------------------------------------
-- Silence is the main complaint about marketplaces like this: a factory quotes
-- and then never hears anything. Awarding therefore tells every factory that
-- quoted, winner and losers alike, in the same transaction that decides.
-- ============================================================================

-- `kind` is plain text, not an enum, and that is a deliberate departure from
-- the convention elsewhere in this schema. Migration 012 already hit the wall
-- that a new enum value cannot be used in the transaction that adds it, and
-- notification kinds will keep growing through contracts, milestones and
-- payments. One standalone migration per new kind is not worth the tidiness.
create table public.notifications (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs (id) on delete cascade,

  kind         text not null check (length(btrim(kind)) > 0),
  subject_type text,
  subject_id   uuid,

  title        text not null,
  body         text,

  read_at      timestamptz,
  created_at   timestamptz not null default now()
);

create index notifications_org_idx on public.notifications (org_id, created_at desc);
create index notifications_unread_idx on public.notifications (org_id) where read_at is null;

alter table public.notifications enable row level security;

-- Readable and markable-as-read by the recipient org. Deliberately no insert
-- or delete grant at all, exactly like credit_ledger: every row is written by
-- a security-definer function, so a client cannot fabricate a notification.
create policy notifications_read on public.notifications
  for select to authenticated
  using (org_id in (select public.current_org_ids()));

create policy notifications_mark_read on public.notifications
  for update to authenticated
  using (org_id in (select public.current_org_ids()))
  with check (org_id in (select public.current_org_ids()));

grant select, update on public.notifications to authenticated;

-- ---------------------------------------------------------------------------
-- award_quote
-- ---------------------------------------------------------------------------

create or replace function public.award_quote(quote_id uuid)
returns public.quotes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  q            public.quotes;
  r            public.rfqs;
  factory_name text;
  rfq_title    text;
begin
  select * into q from public.quotes where id = quote_id for update;
  if not found then
    raise exception 'quote not found' using errcode = 'P0002';
  end if;

  -- Locking the RFQ as well as the quote is load-bearing, not defensive. Two
  -- brand members awarding two different quotes on the same RFQ milliseconds
  -- apart would otherwise both pass the "is it open" check below and the RFQ
  -- would end with two accepted quotes.
  select * into r from public.rfqs where id = q.rfq_id for update;

  if not public.is_org_owner(r.brand_org_id) then
    raise exception 'only an owner of the requesting brand may award a quote'
      using errcode = '42501';
  end if;

  if r.status <> 'open' then
    raise exception 'this request is %, so it cannot be awarded', r.status
      using errcode = '22023';
  end if;

  -- Covers draft, withdrawn, already decided, and — the one that matters —
  -- superseded. A brand reads a quote, the factory revises it, the brand
  -- awards the row it was looking at. That must be refused, not accepted.
  if q.status <> 'submitted' then
    raise exception 'this quote is % and cannot be awarded; the factory may have revised it', q.status
      using errcode = '22023';
  end if;

  if q.valid_until is not null and q.valid_until < current_date then
    raise exception 'this quote expired on %', q.valid_until
      using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.factory_profiles f
    where f.org_id = q.factory_org_id and f.verification_status = 'verified'
  ) then
    raise exception 'this factory is no longer verified'
      using errcode = '22023';
  end if;

  select name into factory_name from public.orgs where id = q.factory_org_id;
  rfq_title := coalesce(nullif(btrim(r.title), ''), 'your request');

  update public.quotes
     set status = 'accepted', decided_at = now()
   where id = quote_id
  returning * into q;

  -- Only other LIVE submissions are declined. Superseded, draft and withdrawn
  -- rows are already out of the running and keep their own history.
  update public.quotes
     set status = 'declined', decided_at = now()
   where rfq_id = r.id
     and id <> quote_id
     and status = 'submitted';

  update public.rfqs
     set status = 'awarded',
         awarded_quote_id = quote_id,
         awarded_at = now()
   where id = r.id;

  insert into public.notifications (org_id, kind, subject_type, subject_id, title, body)
  select
    d.factory_org_id,
    case when d.factory_org_id = q.factory_org_id then 'quote_accepted' else 'quote_declined' end,
    'rfq',
    r.id,
    case
      when d.factory_org_id = q.factory_org_id then 'Your quote was accepted'
      else 'Your quote was not selected'
    end,
    case
      when d.factory_org_id = q.factory_org_id
        then format('%s accepted your quote for "%s".', (select name from public.orgs where id = r.brand_org_id), rfq_title)
      else format('"%s" was awarded to another factory. Thank you for quoting.', rfq_title)
    end
  from (
    select distinct factory_org_id
    from public.quotes
    where rfq_id = r.id and status in ('accepted', 'declined')
  ) d;

  return q;
end;
$$;

revoke all on function public.award_quote(uuid) from public;
grant execute on function public.award_quote(uuid) to authenticated;
