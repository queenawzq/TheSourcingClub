-- A badge change on a company verified some other way tells it nothing.
--
-- 20261124200000 counted only a previous staff approval as "already told".
-- A company verified otherwise (a file review, the seed, an older path) has no
-- such review, so changing its badge sent a second "Your profile is verified"
-- and queued the approval email. Now a company whose profile is already
-- verified counts as told, for both:
--   1. admin_review_decision (copy of 20261124200000): no notification, and
--      the message on file is kept;
--   2. queue_verification_approval_email (copy of 20261104200000): no email.
--
-- Additive: same signatures and grants; the trigger itself is unchanged.

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
  already_told boolean := false;
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

  -- Approving a company that is already approved, or already verified some
  -- other way (a file review, the seed, an older path), tells it nothing
  -- again and keeps the message it was sent, so staff read what the company
  -- received. (Re-approving still sets a new badge, in
  -- admin_review_decision_with_tier.)
  already_told := decision = 'approved' and (
    prior.state is not distinct from 'approved'
    or exists (select 1 from public.factory_profiles f where f.org_id = target_org and f.verification_status = 'verified')
    or exists (select 1 from public.brand_profiles b where b.org_id = target_org and b.verification_status = 'verified'));
  if already_told then
    note := prior.note;
  end if;

  if decision = 'needs_information' and coalesce(btrim(note), '') = '' then
    raise exception 'returning a review needs a note saying what is missing'
      using errcode = '22023';
  end if;

  if decision = 'declined' and coalesce(btrim(note), '') = '' then
    raise exception 'declining a company needs a reason: it is what the company is told'
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
  if already_told
     or (prior.state is not distinct from decision
         and coalesce(btrim(prior.note), '') = coalesce(btrim(note), '')) then
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

  -- A company already verified (by a file review, the seed, an older path)
  -- was told when it was verified: approving it again, to change its badge,
  -- emails nobody. admin_review_decision writes this row before it marks the
  -- company verified, so a first approval still reads "not verified" here.
  if new.state = 'approved' and (
       exists (select 1 from public.factory_profiles f where f.org_id = new.org_id and f.verification_status = 'verified')
    or exists (select 1 from public.brand_profiles b where b.org_id = new.org_id and b.verification_status = 'verified')) then
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
