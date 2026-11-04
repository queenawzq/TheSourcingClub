-- ============================================================================
-- Review decision emails: who gets them, when, and what happens when one fails
-- ----------------------------------------------------------------------------
-- Staff "Request more information" (and approve, and decline) email the
-- company. Six things were wrong with that, and this fixes the database half:
--
-- 1. Approving after a request quoted the request. admin_review_decision kept
--    the old note when the new decision had none (coalesce), so the approval
--    email said "A note from our team: please upload your licence". A decision
--    the company is told about now replaces the note.
-- 2. The same request twice skipped the bell but sent a second email: the
--    outbox key carries org_reviews.updated_at, which the touch trigger moves
--    on every write. The trigger now applies the bell's rule itself: the same
--    state with the same note queues nothing.
-- 3. Nothing retried a failed email. claim_review_decision_emails() hands the
--    sender what is due (pending, failed under 5 attempts, or stuck sending for
--    10 minutes), for one company (staff's kick and "Resend email") or for all
--    (the daily job). admin_requeue_review_emails() is staff's "Resend email".
--    A send that timed out is 'unconfirmed', not 'failed': the provider may
--    have delivered it, so it is retried under the SAME idempotency key and
--    the provider drops the copy. Only a definite refusal moves the key on
--    (key_generation), because a provider replays a key's first answer,
--    errors included, for 24 hours.
--    Only the company's current decision is sent: an older unsent email is
--    skipped, so a request that failed last week no longer goes out with
--    today's approval.
-- 4. With nobody to send to, the screen said "already sent".
--    admin_review_email_status() says who was emailed and who could not be.
-- 5. Staff heard nothing when a company sent its profile back. Staff have no
--    org and cannot be notified, so a resubmission queues an email to the
--    operations inbox (review_resubmission_email_outbox), sent by the server.
-- 6. Only owners were emailed. Every member with an address is now; a person
--    removed from the company before the send is skipped.
--
-- Additive: a widened check, one new table, replaced functions with the same
-- signatures, new functions. Safe with the old site live.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. A decision the company is told about replaces the note
-- ---------------------------------------------------------------------------
-- Copy of 20261026000700 with only the note assignment changed.
create or replace function public.admin_review_decision(
  target_org uuid,
  decision   public.org_review_state,
  note       text default null,
  risk       public.org_review_risk default null
)
returns public.org_reviews
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  decided  public.org_reviews;
  is_final boolean := decision in ('approved', 'declined');
  status   public.verification_status;
  prior    public.org_reviews;
begin
  if not public.is_platform_admin() then
    raise exception 'only platform admins may decide a review' using errcode = '42501';
  end if;

  -- One decision on a company at a time (the company's row, since a first
  -- review has no review row to lock), and the one before it read under
  -- that lock: a double click ran this twice side by side.
  perform 1 from public.orgs o where o.id = target_org for update;
  if not found then
    raise exception 'org not found' using errcode = 'P0002';
  end if;
  select * into prior from public.org_reviews r where r.org_id = target_org;

  if decision = 'needs_information' and coalesce(btrim(note), '') = '' then
    raise exception 'returning a review needs a note saying what is missing'
      using errcode = '22023';
  end if;

  status := case decision
    when 'approved'          then 'verified'::public.verification_status
    when 'declined'          then 'rejected'::public.verification_status
    when 'needs_information' then 'pending'::public.verification_status
    else null
  end;

  insert into public.org_reviews (org_id, state, note, risk, decided_at, decided_by, owner_user_id)
  values (
    target_org,
    decision,
    note,
    risk,
    case when is_final then now() end,
    case when is_final then auth.uid() end,
    auth.uid()
  )
  on conflict (org_id) do update
    set state       = excluded.state,
        -- The note travels with the decision the company is told about: an
        -- approval with no note must not carry the earlier request. Internal
        -- movements keep it.
        note        = case
                        when excluded.state in ('approved', 'declined', 'needs_information')
                          then excluded.note
                        else coalesce(excluded.note, public.org_reviews.note)
                      end,
        risk        = coalesce(excluded.risk, public.org_reviews.risk),
        decided_at  = case when is_final then now() else null end,
        decided_by  = case when is_final then auth.uid() else null end,
        -- An unclaimed review decided straight from the queue belongs to
        -- whoever decided it.
        owner_user_id = coalesce(public.org_reviews.owner_user_id, auth.uid())
  returning * into decided;

  if status is not null then
    update public.factory_profiles set verification_status = status where org_id = target_org;
    update public.brand_profiles   set verification_status = status where org_id = target_org;
  end if;

  -- What the company sees. No note is sent on 'in_review' or
  -- 'ready_for_review': those are internal movements and telling a factory
  -- "someone opened your file" is noise.
  -- The same decision again, with the same note, tells the company nothing
  -- new, so it is not told again.
  if prior.state is not distinct from decision
     and coalesce(btrim(prior.note), '') = coalesce(btrim(note), '') then
    return decided;
  end if;

  if decision = 'approved' then
    insert into public.notifications (org_id, kind, subject_type, subject_id, title, body)
    values (target_org, 'verification_approved', 'org', target_org,
            'Your profile is verified', note);
  elsif decision = 'declined' then
    insert into public.notifications (org_id, kind, subject_type, subject_id, title, body)
    values (target_org, 'verification_declined', 'org', target_org,
            'We could not verify your profile', note);
  elsif decision = 'needs_information' then
    insert into public.notifications (org_id, kind, subject_type, subject_id, title, body)
    values (target_org, 'verification_needs_information', 'org', target_org,
            'We need a little more information', note);
  end if;

  return decided;
end;
$$;

revoke all on function public.admin_review_decision(uuid, public.org_review_state, text, public.org_review_risk) from public;
grant execute on function public.admin_review_decision(uuid, public.org_review_state, text, public.org_review_risk) to authenticated;

-- ---------------------------------------------------------------------------
-- 2 and 6. Every member, and never the same decision twice
-- ---------------------------------------------------------------------------
-- 'skipped' is a row the sender decided not to send, with the reason in
-- last_error: a reserved test address, a later decision, a person no longer
-- in the company.
-- The table was created granting only service_role, but new tables here get
-- every privilege by default, so signed-in users held a grant (RLS, with no
-- policy, returned them nothing). The server alone reads it.
revoke all on public.verification_approval_email_outbox from public, anon, authenticated;

alter table public.verification_approval_email_outbox
  drop constraint if exists verification_approval_email_outbox_status_check;
alter table public.verification_approval_email_outbox
  add constraint verification_approval_email_outbox_status_check
  check (status in ('pending', 'sending', 'sent', 'failed', 'unconfirmed', 'skipped'));

-- Part of the provider's idempotency key; moves on only after a refusal.
alter table public.verification_approval_email_outbox
  add column key_generation integer not null default 0 check (key_generation >= 0);

-- Copy of 20260920000100 with the recipients and the repeat rule changed.
create or replace function public.queue_verification_approval_email()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- 'in_review' and 'ready_for_review' are internal movements. Telling a
  -- factory "someone opened your file" is noise, and admin_review_decision
  -- deliberately writes no notification for them either.
  if new.state not in ('approved', 'needs_information', 'declined') then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- An approval is final and happens once; re-running the same approval
    -- must not queue a second congratulations.
    if new.state = 'approved' and old.state is not distinct from 'approved' then
      return new;
    end if;
    -- The bell's rule (admin_review_decision): the same decision with the
    -- same note tells the company nothing new. updated_at moves on every
    -- write, so the outbox key alone did not stop a second email.
    if old.state is not distinct from new.state
       and coalesce(btrim(old.note), '') = coalesce(btrim(new.note), '') then
      return new;
    end if;
  end if;

  -- Every member with an address: the request is for whoever answers it,
  -- not only for the person who signed up.
  insert into public.verification_approval_email_outbox (
    org_id, recipient_user_id, recipient_email, recipient_name, locale,
    decision, note, review_updated_at
  )
  select
    new.org_id, member.user_id, btrim(profile.email), profile.full_name, profile.locale,
    new.state::text, new.note, new.updated_at
    from public.org_members member
    join public.user_profiles profile on profile.id = member.user_id
   where member.org_id = new.org_id
     and coalesce(btrim(profile.email), '') <> ''
  on conflict (org_id, recipient_user_id, decision, review_updated_at) do nothing;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Sending, retrying, and only the current decision
-- ---------------------------------------------------------------------------
-- The company's current decision is the newest one queued, and only while the
-- review still says it: a request the company has already answered, or one
-- staff have since approved, is not worth an email.
create or replace function public.review_email_is_current(
  target_org uuid, row_decision text, row_review_updated_at timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.org_reviews r
     where r.org_id = target_org
       and r.state::text = row_decision
  )
  and row_review_updated_at = (
    select max(o.review_updated_at)
      from public.verification_approval_email_outbox o
     where o.org_id = target_org
  )
$$;

revoke all on function public.review_email_is_current(uuid, text, timestamptz) from public, anon, authenticated;

create or replace function public.claim_review_decision_emails(
  target_org uuid default null,
  max_rows   integer default 25
)
returns table (
  org_id             uuid,
  recipient_user_id  uuid,
  decision           text,
  review_updated_at  timestamptz,
  attempts           integer,
  key_generation     integer,
  recipient_email    text,
  recipient_name     text,
  locale             text,
  note               text,
  org_name           text,
  org_type           text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Not sent, and no longer worth sending.
  update public.verification_approval_email_outbox o
     set status = 'skipped',
         last_error = 'a later step in the review replaced this email'
   where o.status in ('pending', 'failed', 'unconfirmed', 'sending')
     and (target_org is null or o.org_id = target_org)
     and not public.review_email_is_current(o.org_id, o.decision, o.review_updated_at);

  update public.verification_approval_email_outbox o
     set status = 'skipped',
         last_error = 'no longer a member of the company'
   where o.status in ('pending', 'failed', 'unconfirmed', 'sending')
     and (target_org is null or o.org_id = target_org)
     and not exists (
       select 1 from public.org_members m
        where m.org_id = o.org_id and m.user_id = o.recipient_user_id
     );

  -- What is due: new, failed under five attempts, or claimed by a sender that
  -- died more than 10 minutes ago (the provider's idempotency key stops a
  -- double send). Only rows touched in the last 7 days go by themselves: an
  -- email that has waited longer is stale news, and the first run of this
  -- job must not send production's old failures. Staff's "Resend email"
  -- touches the row, which brings it back.
  return query
  with due as (
    select o.org_id, o.recipient_user_id, o.decision, o.review_updated_at
      from public.verification_approval_email_outbox o
     where (target_org is null or o.org_id = target_org)
       and o.updated_at > now() - interval '7 days'
       and (
         o.status = 'pending'
         or (o.status in ('failed', 'unconfirmed') and o.attempts < 5)
         or (o.status = 'sending' and o.updated_at < now() - interval '10 minutes')
       )
     order by o.created_at
     limit greatest(1, least(coalesce(max_rows, 25), 100))
       for update of o skip locked
  ),
  claimed as (
    update public.verification_approval_email_outbox o
       set status = 'sending', attempts = o.attempts + 1, last_error = null
      from due
     where o.org_id = due.org_id
       and o.recipient_user_id = due.recipient_user_id
       and o.decision = due.decision
       and o.review_updated_at = due.review_updated_at
    returning o.*
  )
  select c.org_id, c.recipient_user_id, c.decision, c.review_updated_at, c.attempts,
         c.key_generation, c.recipient_email, c.recipient_name, c.locale, c.note, g.name, g.type::text
    from claimed c
    join public.orgs g on g.id = c.org_id;
end;
$$;

revoke all on function public.claim_review_decision_emails(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_review_decision_emails(uuid, integer) to service_role;

create or replace function public.finish_review_decision_email(
  target_org          uuid,
  target_user         uuid,
  row_decision        text,
  row_review_updated_at timestamptz,
  outcome             text,
  provider            text default null,
  error_text          text default null,
  new_key             boolean default false
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if outcome not in ('sent', 'failed', 'unconfirmed', 'skipped') then
    raise exception 'unknown email outcome' using errcode = '22023';
  end if;
  update public.verification_approval_email_outbox o
     set status      = outcome,
         key_generation = o.key_generation + case when new_key then 1 else 0 end,
         provider_id = coalesce(provider, o.provider_id),
         last_error  = case when outcome = 'sent' then null else left(error_text, 500) end,
         sent_at     = case when outcome = 'sent' then now() else o.sent_at end
   where o.org_id = target_org
     and o.recipient_user_id = target_user
     and o.decision = row_decision
     and o.review_updated_at = row_review_updated_at;
end;
$$;

revoke all on function public.finish_review_decision_email(uuid, uuid, text, timestamptz, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.finish_review_decision_email(uuid, uuid, text, timestamptz, text, text, text, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- 4. What staff are told about the email
-- ---------------------------------------------------------------------------
-- The current decision's emails, one per person, and how many members have no
-- address at all (they were never queued).
create or replace function public.admin_review_email_status(target_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  latest timestamptz;
  result jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'only platform staff can read review emails' using errcode = '42501';
  end if;

  select max(o.review_updated_at) into latest
    from public.verification_approval_email_outbox o
   where o.org_id = target_org;

  select jsonb_build_object(
    'decision', (select o.decision from public.verification_approval_email_outbox o
                  where o.org_id = target_org and o.review_updated_at = latest limit 1),
    'current', coalesce((select bool_or(public.review_email_is_current(o.org_id, o.decision, o.review_updated_at))
                  from public.verification_approval_email_outbox o
                  where o.org_id = target_org and o.review_updated_at = latest), false),
    'recipients', coalesce((
      select jsonb_agg(jsonb_build_object(
               'email', o.recipient_email,
               'name', o.recipient_name,
               'status', o.status,
               'attempts', o.attempts,
               'reason', o.last_error,
               'sent_at', o.sent_at
             ) order by o.recipient_email)
        from public.verification_approval_email_outbox o
       where o.org_id = target_org and o.review_updated_at = latest
    ), '[]'::jsonb),
    'members_without_email', (
      select count(*)::int
        from public.org_members m
        join public.user_profiles p on p.id = m.user_id
       where m.org_id = target_org
         and coalesce(btrim(p.email), '') = ''
    )
  ) into result;

  return result;
end;
$$;

revoke all on function public.admin_review_email_status(uuid) from public, anon;
grant execute on function public.admin_review_email_status(uuid) to authenticated;

-- "Resend email": the current decision's failed, unconfirmed or waiting emails go back in
-- the queue with a fresh allowance of attempts (and a fresh 7 days). Returns
-- how many are now waiting.
create or replace function public.admin_requeue_review_emails(target_org uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  waiting integer;
begin
  if not public.is_platform_admin() then
    raise exception 'only platform staff can resend review emails' using errcode = '42501';
  end if;

  update public.verification_approval_email_outbox o
     set status = 'pending', attempts = 0, last_error = null
   where o.org_id = target_org
     and o.status in ('failed', 'unconfirmed', 'pending')
     and public.review_email_is_current(o.org_id, o.decision, o.review_updated_at);

  select count(*)::int into waiting
    from public.verification_approval_email_outbox o
   where o.org_id = target_org
     and o.status = 'pending'
     and public.review_email_is_current(o.org_id, o.decision, o.review_updated_at);

  return waiting;
end;
$$;

revoke all on function public.admin_requeue_review_emails(uuid) from public, anon;
grant execute on function public.admin_requeue_review_emails(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Telling staff a company sent its profile back
-- ---------------------------------------------------------------------------
create table public.review_resubmission_email_outbox (
  org_id          uuid not null references public.orgs (id) on delete cascade,
  resubmitted_at  timestamptz not null,
  -- The request the company was answering, so staff know what to look for.
  note            text,
  status          text not null default 'pending'
                  check (status in ('pending', 'sending', 'sent', 'failed', 'unconfirmed', 'skipped')),
  attempts        integer not null default 0 check (attempts >= 0),
  key_generation  integer not null default 0 check (key_generation >= 0),
  provider_id     text,
  last_error      text,
  sent_at         timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (org_id, resubmitted_at)
);

create trigger review_resubmission_email_outbox_touch
  before update on public.review_resubmission_email_outbox
  for each row execute function public.touch_updated_at();

alter table public.review_resubmission_email_outbox enable row level security;

-- The server alone: new tables here get every privilege by default.
revoke all on public.review_resubmission_email_outbox from public, anon, authenticated;
grant select, insert, update on public.review_resubmission_email_outbox to service_role;

-- Any path that moves a returned review back to staff, not only the RPC.
create or replace function public.queue_review_resubmission_email()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.state = 'needs_information' and new.state = 'ready_for_review' then
    insert into public.review_resubmission_email_outbox (org_id, resubmitted_at, note)
    values (new.org_id, new.updated_at, new.note)
    on conflict do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.queue_review_resubmission_email() from public, anon, authenticated;

create trigger org_review_queue_resubmission_email
  after update of state on public.org_reviews
  for each row execute function public.queue_review_resubmission_email();

create or replace function public.claim_review_resubmission_emails(
  target_org uuid default null,
  max_rows   integer default 25
)
returns table (
  org_id          uuid,
  resubmitted_at  timestamptz,
  attempts        integer,
  key_generation  integer,
  note            text,
  org_name        text,
  org_type        text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Staff have already acted on it: nothing to tell them.
  update public.review_resubmission_email_outbox o
     set status = 'skipped', last_error = 'staff had already decided the review'
   where o.status in ('pending', 'failed', 'unconfirmed', 'sending')
     and (target_org is null or o.org_id = target_org)
     and not exists (
       select 1 from public.org_reviews r
        where r.org_id = o.org_id and r.state in ('ready_for_review', 'in_review')
     );

  return query
  with due as (
    select o.org_id, o.resubmitted_at
      from public.review_resubmission_email_outbox o
     where (target_org is null or o.org_id = target_org)
       and o.updated_at > now() - interval '7 days'
       and (
         o.status = 'pending'
         or (o.status in ('failed', 'unconfirmed') and o.attempts < 5)
         or (o.status = 'sending' and o.updated_at < now() - interval '10 minutes')
       )
     order by o.created_at
     limit greatest(1, least(coalesce(max_rows, 25), 100))
       for update of o skip locked
  ),
  claimed as (
    update public.review_resubmission_email_outbox o
       set status = 'sending', attempts = o.attempts + 1, last_error = null
      from due
     where o.org_id = due.org_id and o.resubmitted_at = due.resubmitted_at
    returning o.*
  )
  select c.org_id, c.resubmitted_at, c.attempts, c.key_generation, c.note, g.name, g.type::text
    from claimed c
    join public.orgs g on g.id = c.org_id;
end;
$$;

revoke all on function public.claim_review_resubmission_emails(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_review_resubmission_emails(uuid, integer) to service_role;

create or replace function public.finish_review_resubmission_email(
  target_org      uuid,
  row_resubmitted_at timestamptz,
  outcome         text,
  provider        text default null,
  error_text      text default null,
  new_key         boolean default false
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if outcome not in ('sent', 'failed', 'unconfirmed', 'skipped') then
    raise exception 'unknown email outcome' using errcode = '22023';
  end if;
  update public.review_resubmission_email_outbox o
     set status      = outcome,
         key_generation = o.key_generation + case when new_key then 1 else 0 end,
         provider_id = coalesce(provider, o.provider_id),
         last_error  = case when outcome = 'sent' then null else left(error_text, 500) end,
         sent_at     = case when outcome = 'sent' then now() else o.sent_at end
   where o.org_id = target_org
     and o.resubmitted_at = row_resubmitted_at;
end;
$$;

revoke all on function public.finish_review_resubmission_email(uuid, timestamptz, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.finish_review_resubmission_email(uuid, timestamptz, text, text, text, boolean) to service_role;
