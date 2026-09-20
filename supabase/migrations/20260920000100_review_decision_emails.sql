-- Approval was the only decision that reached a company by email. "Request
-- more information" and "Decline" wrote an in-app notification and nothing
-- else, so a factory that never opens the app never learns its review moved --
-- and needs_information is precisely the decision that asks them to act.
--
-- The outbox therefore carries every decision the company is told about, not
-- just the approval, and carries the note with it: for needs_information the
-- note IS the actionable content, and the database already refuses that
-- decision without one.

alter table public.verification_approval_email_outbox
  add column decision text not null default 'approved'
    check (decision in ('approved', 'needs_information', 'declined')),
  add column note text,
  -- The review revision this email was queued for. See the key below.
  add column review_updated_at timestamptz not null default now();

-- The old key was (org_id, recipient_user_id): one email per person per
-- company, ever. That is right for an approval, which happens once, but it
-- would silently swallow the second "we still need your business licence".
-- Keying on the review revision instead means each decision gets its own
-- email, while a repeated write of the SAME revision -- a double-clicked
-- button, a retried statement -- still collides and is dropped, because
-- now() is transaction time and does not advance within one statement.
alter table public.verification_approval_email_outbox
  drop constraint verification_approval_email_outbox_pkey;

alter table public.verification_approval_email_outbox
  add constraint verification_approval_email_outbox_pkey
  primary key (org_id, recipient_user_id, decision, review_updated_at);

-- Claiming and completing a row now needs all four key columns; an index on
-- the queue read (everything not yet sent, for one org) keeps that cheap.
create index verification_approval_email_outbox_pending_idx
  on public.verification_approval_email_outbox (org_id)
  where status <> 'sent';

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

  -- An approval is final and happens once; re-running the same approval must
  -- not queue a second congratulations. The other two can legitimately recur,
  -- and the primary key dedupes them per review revision.
  if new.state = 'approved'
     and tg_op = 'UPDATE'
     and old.state is not distinct from 'approved' then
    return new;
  end if;

  insert into public.verification_approval_email_outbox (
    org_id, recipient_user_id, recipient_email, recipient_name, locale,
    decision, note, review_updated_at
  )
  select
    new.org_id, member.user_id, profile.email, profile.full_name, profile.locale,
    new.state::text, new.note, new.updated_at
    from public.org_members member
    join public.user_profiles profile on profile.id = member.user_id
   where member.org_id = new.org_id
     and member.role = 'owner'
     and coalesce(btrim(profile.email), '') <> ''
  on conflict (org_id, recipient_user_id, decision, review_updated_at) do nothing;

  return new;
end;
$$;
