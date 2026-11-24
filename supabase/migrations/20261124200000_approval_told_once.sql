-- An approval is told once, and staff can read the message that was sent.
--
-- 1. admin_review_decision (copy of 20261106200000): approving a company that
--    is already approved no longer sends a second "Your profile is verified"
--    when the message differs. It keeps the message the company was sent.
--    The approval email already went once only (queue_verification_approval_email).
-- 2. admin_review_email_status (copy of 20261104200000) also returns the
--    message sent with the latest decision, for the review page's "Email to
--    the company" card. Staff only, as before.
--
-- Additive: same signatures, same grants; the live site keeps working.

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

  -- Approving a company that is already approved tells it nothing again and
  -- keeps the message it was sent, so staff read what the company received.
  -- (Re-approving still sets a new badge, in admin_review_decision_with_tier.)
  if decision = 'approved' and prior.state is not distinct from 'approved' then
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
    -- The message the company was sent with that decision, as typed.
    'note', (select o.note from public.verification_approval_email_outbox o
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
