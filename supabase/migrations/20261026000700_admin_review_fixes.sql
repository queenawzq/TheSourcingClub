-- Two admin review fixes.
--
-- 1. A double click on "Approve as Basic" approved twice and told the company
--    twice. admin_review_decision now takes the company's row lock first (a
--    first review has no org_reviews row to lock), reads the decision before
--    it, and writes no notification when the same decision with the same
--    note is made again. The screen also stops a second click.
--
-- 2. A company verified with no review row (verified before reviews existed,
--    or by review_document) read "Ready for review" in the queue and sorted
--    first, and the overview counted it as waiting. The queue now derives the
--    state of a company without a row from its verification status: verified
--    reads approved, rejected reads declined. admin_overview_metrics reads the
--    queue, so its count follows.
--
-- Both are copies of their latest definitions (admin_review_decision from
-- 20260912000100, admin_verification_queue from 20260920000300) with only
-- those parts changed: same signatures, same columns. Safe with the old site
-- live.

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
        note        = coalesce(excluded.note, public.org_reviews.note),
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

create or replace function public.admin_verification_queue()
returns table (
  org_id              uuid,
  org_name            text,
  org_type            public.org_type,
  org_slug            text,
  vendor_kind         public.vendor_kind,
  location            text,
  legal_name          text,
  website_url         text,
  intro               text,
  submitted_at        timestamptz,
  state               public.org_review_state,
  risk                public.org_review_risk,
  note                text,
  owner_user_id       uuid,
  owner_name          text,
  verification_status public.verification_status,
  evidence_received   integer,
  evidence_expected   integer,
  profile_completion  integer,
  verification_score  integer,
  verification_checks jsonb,
  capabilities        jsonb,
  decided_at          timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- First statement, before any select: checking afterwards leaks whether a
  -- row exists through the difference between P0002 and 42501.
  if not public.is_platform_admin() then
    raise exception 'this queue is limited to platform staff' using errcode = '42501';
  end if;

  return query
  with candidates as (
    select
      o.id,
      o.name,
      o.type,
      o.slug,
      f.vendor_kind                    as vendor_kind,
      f.location                       as location,
      f.legal_name                     as legal_name,
      f.website_url                    as website_url,
      f.intro                          as intro,
      f.verification_status            as verification_status,
      coalesce(f.onboarding_completed_at, f.updated_at) as submitted_at
    from public.orgs o
    join public.factory_profiles f on f.org_id = o.id
    where o.is_demo = false
      and (
        f.onboarding_completed_at is not null
        or exists (
          select 1 from public.documents d
          where d.org_id = o.id
            and d.kind in ('business_registration', 'certificate')
        )
      )

    union all

    select
      o.id,
      o.name,
      o.type,
      o.slug,
      null::public.vendor_kind,
      b.hq_location,
      b.legal_name,
      b.website_url,
      b.intro,
      b.verification_status,
      coalesce(b.onboarding_completed_at, b.updated_at)
    from public.orgs o
    join public.brand_profiles b on b.org_id = o.id
    where o.is_demo = false
      and (
        b.onboarding_completed_at is not null
        or exists (
          select 1 from public.documents d
          where d.org_id = o.id
            and d.kind in ('business_registration', 'certificate')
        )
      )
  )
  select
    c.id,
    c.name,
    c.type,
    c.slug,
    c.vendor_kind,
    c.location,
    c.legal_name,
    c.website_url,
    c.intro,
    c.submitted_at,
    coalesce(r.state, case c.verification_status
      when 'verified' then 'approved'::public.org_review_state
      when 'rejected' then 'declined'::public.org_review_state
      else 'ready_for_review'::public.org_review_state
    end),
    r.risk,
    r.note,
    r.owner_user_id,
    u.full_name,
    c.verification_status,
    -- Capped. org_evidence_received() counts every registration document, so
    -- a company that uploaded its licence three times was rendering on the
    -- review screen as "3 of 1 received".
    least(public.org_evidence_received(c.id), public.org_evidence_expected(c.id)),
    public.org_evidence_expected(c.id),
    public.org_profile_completion(c.id),
    public.org_verification_score(c.id),
    public.org_verification_checks(c.id),
    -- What the company says it does, for the designed chip section. Labels,
    -- not slugs: this is the one place the vocabulary is displayed rather
    -- than matched on.
    coalesce((
      select jsonb_agg(t.label_en order by t.label_en)
        from public.taxonomy_links l
        join public.taxonomy_terms t on t.id = l.term_id
       where l.org_id = c.id
         and l.subject_type in ('brand_profile', 'factory_profile')
    ), '[]'::jsonb),
    r.decided_at
  from candidates c
  left join public.org_reviews r on r.org_id = c.id
  left join public.user_profiles u on u.id = r.owner_user_id
  order by
    -- Undecided first, oldest submission first inside that: a queue sorted by
    -- how long someone has been waiting, not by when we last touched it.
    case coalesce(r.state, case c.verification_status
      when 'verified' then 'approved'::public.org_review_state
      when 'rejected' then 'declined'::public.org_review_state
      else 'ready_for_review'::public.org_review_state
    end)
      when 'ready_for_review'  then 0
      when 'in_review'         then 1
      when 'needs_information' then 2
      else 3
    end,
    c.submitted_at asc;
end;
$$;

revoke all on function public.admin_verification_queue() from public;
grant execute on function public.admin_verification_queue() to authenticated;
