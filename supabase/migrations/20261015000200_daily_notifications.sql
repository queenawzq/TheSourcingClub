-- ============================================================================
-- Daily notifications, new matches, and dates in the reader's time zone
-- ----------------------------------------------------------------------------
-- Three kinds the design promises and nothing wrote:
--   rfq_matched         an open request a verified factory fits well
--   capacity_reminder   a factory's capacity is a month or more old
--   milestone_due_soon  a step is due in three days, and again the day before
--
-- The two reminders come from run_daily_notifications(), called once a day by
-- the Vercel cron (api/cron-daily) and by staff from Admin → Settings on test
-- sites, which have no crons. notification_reminders makes every reminder
-- happen once, however often the job runs.
--
-- notifications.data carries the raw values behind dates in the text, so the
-- bell (browser's zone) and the email (the reader's saved zone) can each say
-- them in local time. The body keeps a UTC wording for anything that does not
-- read data.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- notifications.data
-- ---------------------------------------------------------------------------
alter table public.notifications
  add column data jsonb not null default '{}'::jsonb;

-- ---------------------------------------------------------------------------
-- notification_reminders
-- ---------------------------------------------------------------------------
-- One row per reminder that went out. The writer inserts here first and writes
-- the notification only when the insert went in.
create table public.notification_reminders (
  kind        text not null,
  subject_id  uuid not null,
  due_key     text not null,
  org_id      uuid not null references public.orgs (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (kind, subject_id, due_key)
);

alter table public.notification_reminders enable row level security;

revoke all on public.notification_reminders from public, anon, authenticated;
grant select, insert on public.notification_reminders to service_role;

-- ---------------------------------------------------------------------------
-- rfq_matched
-- ---------------------------------------------------------------------------
-- Verified, published factories scoring 0.7 or more on the request, best 20,
-- never the brand itself. The factory must also make one of the request's
-- product categories: the score drops factors the request leaves blank, so a
-- thin request scores 1.0 on MOQ alone, and that is not a match. Called when
-- an open-to-all request is published; returns how many factories were told.
create or replace function public.notify_rfq_matches(target_rfq uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r          public.rfqs;
  brand_name text;
  told       integer;
begin
  select * into r from public.rfqs where id = target_rfq;
  if not found or r.status <> 'open' or r.visibility <> 'open_to_all' then
    return 0;
  end if;
  select name into brand_name from public.orgs where id = r.brand_org_id;

  with candidates as (
    select f.org_id, public.match_score_rfq(r.id, f.org_id) as score
      from public.factory_profiles f
     where f.verification_status = 'verified'
       and f.published_at is not null
       and f.org_id <> r.brand_org_id
       and public.taxonomy_overlap_share('rfq', r.id, 'factory_profile', f.org_id, 'product_category') > 0
       and not exists (
         select 1 from public.rfq_invitations i
          where i.rfq_id = r.id and i.factory_org_id = f.org_id
       )
  ), best as (
    select org_id from candidates
     where score >= 0.7
     order by score desc, org_id
     limit 20
  ), claimed as (
    insert into public.notification_reminders (kind, subject_id, due_key, org_id)
    select 'rfq_matched', r.id, best.org_id::text, best.org_id from best
    on conflict do nothing
    returning org_id
  )
  insert into public.notifications (org_id, kind, subject_type, subject_id, title, body, data)
  select claimed.org_id, 'rfq_matched', 'rfq', r.id,
         format('New request that matches you: "%s"', coalesce(nullif(btrim(r.title), ''), 'a request')),
         case when r.quote_deadline is not null
              then format('%s is looking for a factory. Quotes close %s.',
                          coalesce(brand_name, 'A brand'), to_char(r.quote_deadline, 'FMMon FMDD'))
              else format('%s is looking for a factory. Open the request to read the brief and send a quote.',
                          coalesce(brand_name, 'A brand'))
         end,
         case when r.quote_deadline is not null
              then jsonb_build_object('quote_deadline', r.quote_deadline)
              else '{}'::jsonb
         end
    from claimed;

  get diagnostics told = row_count;
  return told;
end;
$$;

revoke all on function public.notify_rfq_matches(uuid) from public, anon, authenticated;
grant execute on function public.notify_rfq_matches(uuid) to service_role;

create or replace function public.on_rfq_published()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'open' and new.visibility = 'open_to_all'
     and (tg_op = 'INSERT' or old.status <> 'open' or old.visibility <> 'open_to_all') then
    begin
      perform public.notify_rfq_matches(new.id);
    exception when others then
      raise warning 'matches for request % were not notified: %', new.id, sqlerrm;
    end;
  end if;
  return new;
end;
$$;

revoke all on function public.on_rfq_published() from public, anon, authenticated;

create trigger rfqs_notify_matches
  after insert or update of status, visibility on public.rfqs
  for each row execute function public.on_rfq_published();

-- ---------------------------------------------------------------------------
-- on_rfq_invited — the deadline as data, and one email, not two
-- ---------------------------------------------------------------------------
-- The composer publishes first and invites afterwards, so a factory it then
-- invites may already have a "matches you" email queued. The invitation says
-- more, so that email is skipped; the bell keeps both.
create or replace function public.on_rfq_invited()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r          public.rfqs;
  brand_name text;
begin
  select * into r from public.rfqs where id = new.rfq_id;
  select name into brand_name from public.orgs where id = r.brand_org_id;

  insert into public.notifications (org_id, kind, subject_type, subject_id, title, body, data)
  values (
    new.factory_org_id,
    'rfq_invited',
    'rfq',
    r.id,
    format('%s invited you to quote on "%s"', coalesce(brand_name, 'A brand'), coalesce(nullif(btrim(r.title), ''), 'a request')),
    case when r.quote_deadline is not null
         then format('Quotes close %s.', to_char(r.quote_deadline, 'FMMon FMDD'))
         else 'Open the request to read the brief and send a quote.'
    end,
    case when r.quote_deadline is not null
         then jsonb_build_object('quote_deadline', r.quote_deadline)
         else '{}'::jsonb
    end
  );

  update public.notification_email_outbox o
     set status = 'skipped', last_error = 'invited to quote instead'
    from public.notifications n
   where n.id = o.notification_id
     and n.kind = 'rfq_matched'
     and n.subject_id = r.id
     and n.org_id = new.factory_org_id
     and o.status = 'pending';

  return new;
end;
$$;

revoke all on function public.on_rfq_invited() from public;

-- ---------------------------------------------------------------------------
-- notify_call — the call's time as data
-- ---------------------------------------------------------------------------
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
    (org_id, kind, subject_type, subject_id, order_id, title, body, data)
  values (recipient, kind, 'thread', t.id, t.order_id, title, body,
          jsonb_build_object('starts_at', c.starts_at, 'duration_minutes', c.duration_minutes));
end;
$$;

-- ---------------------------------------------------------------------------
-- run_daily_notifications (service role)
-- ---------------------------------------------------------------------------
-- capacity_reminder: a verified factory whose capacity last changed 30 or more
--   days ago, on day 30, 60, 90… after that change, so at most monthly and
--   never again once they update it. Brands rank factories on it.
-- milestone_due_soon: a step on an active order due within three days, once
--   at 3–2 days and once at 1–0 days (a missed day still sends the next), to
--   the side that acts: the factory for a step in progress, the brand for one
--   waiting for approval. A new due date reminds again.
create or replace function public.run_daily_notifications()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  capacity_count integer;
  due_count      integer;
begin
  with factories as (
    select p.org_id,
           greatest(
             coalesce(c.updated_at, p.created_at),
             coalesce((select max(m.updated_at) from public.factory_capacity_months m where m.org_id = p.org_id),
                      '-infinity'::timestamptz)
           ) as last_change
      from public.factory_profiles p
      left join public.factory_capacity c on c.org_id = p.org_id
     where p.verification_status = 'verified'
  ), due as (
    select org_id, last_change,
           floor(extract(epoch from now() - last_change) / 86400)::integer as days
      from factories
     where last_change <= now() - interval '30 days'
  ), claimed as (
    insert into public.notification_reminders (kind, subject_id, due_key, org_id)
    select 'capacity_reminder', org_id,
           to_char(last_change at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') || ':' || (days / 30),
           org_id
      from due
    on conflict do nothing
    returning org_id
  )
  insert into public.notifications (org_id, kind, subject_type, subject_id, title, body)
  select due.org_id, 'capacity_reminder', 'capacity', due.org_id,
         'Is your capacity still right?',
         format('You last updated your open capacity %s days ago. Brands see it when they choose who to invite, so update it from your dashboard.', due.days)
    from claimed
    join due on due.org_id = claimed.org_id;
  get diagnostics capacity_count = row_count;

  with steps as (
    select m.id, m.title, m.due_on, m.state, o.id as order_id, o.order_number,
           (m.due_on - current_date) as days_left,
           case when m.state = 'active' then o.factory_org_id else o.brand_org_id end as reader
      from public.order_milestones m
      join public.production_orders o on o.id = m.order_id
     where o.status = 'active'
       and m.state in ('active', 'submitted')
       and m.due_on between current_date and current_date + 3
  ), keyed as (
    select steps.*,
           (case when days_left >= 2 then '3d' else '1d' end) || ':' || due_on::text as due_key
      from steps
  ), claimed as (
    insert into public.notification_reminders (kind, subject_id, due_key, org_id)
    select 'milestone_due_soon', id, due_key, reader from keyed
    on conflict do nothing
    returning subject_id, due_key
  )
  insert into public.notifications (org_id, kind, subject_type, subject_id, order_id, title, body, data)
  select k.reader, 'milestone_due_soon', 'milestone', k.id, k.order_id,
         format('"%s" is due %s', k.title,
                case k.days_left when 0 then 'today' when 1 then 'tomorrow' else format('in %s days', k.days_left) end),
         case when k.state = 'active'
              then format('This production step on %s is due %s and needs an update.',
                          k.order_number, to_char(k.due_on, 'FMMon FMDD'))
              else format('This step on %s is waiting for your approval. It is due %s.',
                          k.order_number, to_char(k.due_on, 'FMMon FMDD'))
         end,
         jsonb_build_object('due_on', k.due_on)
    from keyed k
    join claimed c on c.subject_id = k.id and c.due_key = k.due_key;
  get diagnostics due_count = row_count;

  return jsonb_build_object('capacity_reminders', capacity_count, 'due_soon', due_count);
end;
$$;

revoke all on function public.run_daily_notifications() from public, anon, authenticated;
grant execute on function public.run_daily_notifications() to service_role;

-- ---------------------------------------------------------------------------
-- claim_notification_emails — now with the notification's data
-- ---------------------------------------------------------------------------
drop function public.claim_notification_emails(integer);

create function public.claim_notification_emails(max_rows integer default 25)
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
  data             jsonb,
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
         n.kind, n.subject_type, n.subject_id, n.order_id, n.title, n.body, n.data, n.created_at
    from claimed c
    join public.notifications n on n.id = c.notification_id
    join public.orgs org on org.id = c.org_id
    left join public.user_profiles profile on profile.id = c.recipient_user_id;
end;
$$;

revoke all on function public.claim_notification_emails(integer) from public, anon, authenticated;
grant execute on function public.claim_notification_emails(integer) to service_role;
