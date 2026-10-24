-- ============================================================================
-- Notification emails
-- ----------------------------------------------------------------------------
-- The bell has had every notification since the start; nothing was emailed.
-- This adds the company's three designed email switches (Settings →
-- Notifications), and an outbox the Vercel function `api/notification-emails`
-- drains through Resend.
--
-- One outbox row per notification and recipient, written by a trigger on
-- `notifications` in the same transaction, so no RPC that notifies needed to
-- change. The trigger swallows its own errors: an email is never worth failing
-- the action that caused it.
--
-- Switches are per company, like the rest of Settings today. Every member with
-- an email receives them until per-member permissions exist; then "members
-- with matching authority" narrows the recipients.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- notification_preferences
-- ---------------------------------------------------------------------------
-- A missing row means every switch is on, so existing companies keep the
-- designed default without a backfill.
create table public.notification_preferences (
  org_id          uuid primary key references public.orgs (id) on delete cascade,
  rfq_emails      boolean not null default true,
  payment_emails  boolean not null default true,
  message_emails  boolean not null default true,
  updated_by      uuid references auth.users (id) on delete set null,
  updated_at      timestamptz not null default now()
);

alter table public.notification_preferences enable row level security;

create policy notification_preferences_read on public.notification_preferences
  for select to authenticated
  using (org_id in (select public.current_org_ids()));

-- Read directly; written only through set_notification_preference. New
-- tables get every privilege by default here, so the writes are revoked.
revoke all on public.notification_preferences from public, anon, authenticated;
grant select on public.notification_preferences to authenticated;
grant select, insert, update on public.notification_preferences to service_role;

-- ---------------------------------------------------------------------------
-- notification_email_category
-- ---------------------------------------------------------------------------
-- Which switch a kind belongs to; null means it stays in the bell only.
--   rfq       "New quote activity" (brand) / "New RFQ matches" (factory)
--   payments  "Payment and approval requests"
--   messages  "Messages and call invites"
-- verification_* already have their own designed email; message_rejected is
-- shown to the sender the moment it happens; milestone_update and
-- payment_processing are short-lived states that would only cost quota.
create or replace function public.notification_email_category(kind text)
returns text
language sql
immutable
as $$
  select case
    when kind in ('rfq_invited', 'rfq_cancelled', 'quote_received', 'quote_withdrawn',
                  'quote_accepted', 'rfq_matched', 'capacity_reminder')
      then 'rfq'
    when kind in ('payment_due', 'payment_sent', 'payment_confirmed', 'payment_rejected',
                  'payment_failed', 'funds_released',
                  'milestone_submitted', 'milestone_approved', 'milestone_dispute',
                  'milestone_reminder', 'milestone_due_soon',
                  'schedule_updated', 'schedule_agreed',
                  'order_created', 'order_activated', 'order_completed', 'order_cancelled',
                  'cancellation_proposed', 'cancellation_withdrawn', 'cancellation_declined')
      then 'payments'
    when kind in ('message', 'call_proposed', 'call_accepted', 'call_declined',
                  'call_countered', 'call_cancelled')
      then 'messages'
    else null
  end
$$;

revoke all on function public.notification_email_category(text) from public, anon;
grant execute on function public.notification_email_category(text) to authenticated, service_role;

-- True when the company's switch for this category is on (or never set).
create or replace function public.notification_email_enabled(target_org uuid, category text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select case category
              when 'rfq'      then p.rfq_emails
              when 'payments' then p.payment_emails
              when 'messages' then p.message_emails
            end
       from public.notification_preferences p
      where p.org_id = target_org),
    category in ('rfq', 'payments', 'messages')
  )
$$;

revoke all on function public.notification_email_enabled(uuid, text) from public, anon, authenticated;
grant execute on function public.notification_email_enabled(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- set_notification_preference
-- ---------------------------------------------------------------------------
create or replace function public.set_notification_preference(
  target_org uuid,
  category   text,
  enabled    boolean
)
returns public.notification_preferences
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  result public.notification_preferences;
begin
  if auth.uid() is null or not public.is_org_member(target_org) then
    raise exception 'only a member of this company can change its email settings'
      using errcode = '42501';
  end if;
  if category not in ('rfq', 'payments', 'messages') or enabled is null then
    raise exception 'unknown email setting' using errcode = '22023';
  end if;

  insert into public.notification_preferences as p
    (org_id, rfq_emails, payment_emails, message_emails, updated_by, updated_at)
  values (
    target_org,
    case when category = 'rfq'      then enabled else true end,
    case when category = 'payments' then enabled else true end,
    case when category = 'messages' then enabled else true end,
    auth.uid(), now()
  )
  on conflict (org_id) do update set
    rfq_emails     = case when category = 'rfq'      then enabled else p.rfq_emails end,
    payment_emails = case when category = 'payments' then enabled else p.payment_emails end,
    message_emails = case when category = 'messages' then enabled else p.message_emails end,
    updated_by     = auth.uid(),
    updated_at     = now()
  returning * into result;

  return result;
end;
$$;

revoke all on function public.set_notification_preference(uuid, text, boolean) from public, anon;
grant execute on function public.set_notification_preference(uuid, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- notification_email_outbox
-- ---------------------------------------------------------------------------
create table public.notification_email_outbox (
  id                 uuid primary key default gen_random_uuid(),
  notification_id    uuid not null references public.notifications (id) on delete cascade,
  org_id             uuid not null references public.orgs (id) on delete cascade,
  recipient_user_id  uuid not null references auth.users (id) on delete cascade,
  recipient_email    text not null,
  category           text not null check (category in ('rfq', 'payments', 'messages')),
  status             text not null default 'pending'
                     check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts           integer not null default 0 check (attempts >= 0),
  next_attempt_at    timestamptz not null default now(),
  claimed_at         timestamptz,
  last_error         text,
  provider_id        text,
  sent_at            timestamptz,
  created_at         timestamptz not null default now(),
  unique (notification_id, recipient_user_id)
);

create index notification_email_outbox_due_idx
  on public.notification_email_outbox (next_attempt_at)
  where status in ('pending', 'sending');

alter table public.notification_email_outbox enable row level security;

-- No browser role receives any access: only the Vercel function (service role).
revoke all on public.notification_email_outbox from public, anon, authenticated;
grant select, insert, update on public.notification_email_outbox to service_role;

-- ---------------------------------------------------------------------------
-- queue_notification_emails (trigger on notifications)
-- ---------------------------------------------------------------------------
-- Messages are the chatty kind and Resend's free tier is 100 emails a day, so
-- a recipient gets at most one message email per conversation every 6 hours;
-- the bell still shows every message.
create or replace function public.queue_notification_emails()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cat text := public.notification_email_category(new.kind);
begin
  if cat is null or not public.notification_email_enabled(new.org_id, cat) then
    return new;
  end if;

  begin
    insert into public.notification_email_outbox
      (notification_id, org_id, recipient_user_id, recipient_email, category)
    select new.id, new.org_id, member.user_id, btrim(profile.email), cat
      from public.org_members member
      join public.user_profiles profile on profile.id = member.user_id
     where member.org_id = new.org_id
       and coalesce(btrim(profile.email), '') <> ''
       and not (
         new.kind = 'message'
         and exists (
           select 1
             from public.notification_email_outbox earlier
             join public.notifications n on n.id = earlier.notification_id
            where earlier.recipient_user_id = member.user_id
              and earlier.status <> 'skipped'
              and earlier.created_at > now() - interval '6 hours'
              and n.kind = 'message'
              and n.org_id = new.org_id
              and n.subject_id is not distinct from new.subject_id
         )
       )
    on conflict (notification_id, recipient_user_id) do nothing;
  exception when others then
    raise warning 'notification % was not queued for email: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

revoke all on function public.queue_notification_emails() from public, anon, authenticated;

create trigger notifications_queue_emails
  after insert on public.notifications
  for each row execute function public.queue_notification_emails();

-- ---------------------------------------------------------------------------
-- claim_notification_emails (service role)
-- ---------------------------------------------------------------------------
-- Hands the sender up to `max_rows` due emails with what it needs to write
-- them, marked `sending`. A row stuck in `sending` for 10 minutes (a sender
-- that died mid-way) is due again; Resend's idempotency key stops a double
-- send. A switch turned off after the row was queued skips it here.
create or replace function public.claim_notification_emails(max_rows integer default 25)
returns table (
  id               uuid,
  attempts         integer,
  recipient_email  text,
  recipient_name   text,
  locale           text,
  time_zone        text,
  category         text,
  org_id           uuid,
  org_name         text,
  org_type         text,
  kind             text,
  subject_type     text,
  subject_id       uuid,
  order_id         uuid,
  title            text,
  body             text,
  created_at       timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  update public.notification_email_outbox o
     set status = 'skipped', last_error = 'switched off in Settings'
   where o.status = 'pending'
     and o.next_attempt_at <= now()
     and not public.notification_email_enabled(o.org_id, o.category);

  return query
  with due as (
    select o.id
      from public.notification_email_outbox o
     where (o.status = 'pending' and o.next_attempt_at <= now())
        or (o.status = 'sending' and o.claimed_at < now() - interval '10 minutes')
     order by o.next_attempt_at
     limit greatest(1, least(coalesce(max_rows, 25), 100))
     for update skip locked
  ), claimed as (
    update public.notification_email_outbox o
       set status = 'sending', attempts = o.attempts + 1, claimed_at = now()
      from due
     where o.id = due.id
    returning o.*
  )
  select c.id, c.attempts, c.recipient_email, profile.full_name, profile.locale,
         profile.time_zone, c.category, c.org_id, org.name, org.type::text,
         n.kind, n.subject_type, n.subject_id, n.order_id, n.title, n.body, n.created_at
    from claimed c
    join public.notifications n on n.id = c.notification_id
    join public.orgs org on org.id = c.org_id
    left join public.user_profiles profile on profile.id = c.recipient_user_id;
end;
$$;

revoke all on function public.claim_notification_emails(integer) from public, anon, authenticated;
grant execute on function public.claim_notification_emails(integer) to service_role;

-- ---------------------------------------------------------------------------
-- finish_notification_email (service role)
-- ---------------------------------------------------------------------------
-- A failure waits 5, 10, 20, 40 minutes and gives up after the fifth try.
create or replace function public.finish_notification_email(
  outbox_id   uuid,
  delivered   boolean,
  provider    text default null,
  error_text  text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.notification_email_outbox o
     set status = case
                    when delivered then 'sent'
                    when o.attempts >= 5 then 'failed'
                    else 'pending'
                  end,
         sent_at = case when delivered then now() else o.sent_at end,
         provider_id = coalesce(provider, o.provider_id),
         last_error = case when delivered then null else left(error_text, 500) end,
         next_attempt_at = case
                             when delivered then o.next_attempt_at
                             else now() + interval '5 minutes' * power(2, greatest(o.attempts - 1, 0))
                           end,
         claimed_at = null
   where o.id = outbox_id
     and o.status = 'sending';
end;
$$;

revoke all on function public.finish_notification_email(uuid, boolean, text, text) from public, anon, authenticated;
grant execute on function public.finish_notification_email(uuid, boolean, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- skip_notification_email (service role)
-- ---------------------------------------------------------------------------
-- An email that must not go out at all, with the reason: a reserved test
-- address (example.com, .test) on a database with demo companies.
create or replace function public.skip_notification_email(outbox_id uuid, reason text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.notification_email_outbox
     set status = 'skipped', last_error = left(reason, 500), claimed_at = null
   where id = outbox_id
     and status = 'sending';
$$;

revoke all on function public.skip_notification_email(uuid, text) from public, anon, authenticated;
grant execute on function public.skip_notification_email(uuid, text) to service_role;
