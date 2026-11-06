-- A decline needs a reason, like a request for more information: the email and
-- the company's page said "Reason given" over nothing, and the company could
-- not tell why it was turned down (independent test, F11).
--
-- Copy of 20261104200000 with only the check added. Declines already on file
-- without a reason stay as they are. The site still live while this applies
-- sends an empty decline only if staff leave the box empty, and it is then
-- refused in words.
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
