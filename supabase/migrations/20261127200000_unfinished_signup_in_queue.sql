-- Stream U (Nov 27): a company that has not finished signup but sent its
-- registration document is reviewable again, under its own queue tab
-- "Signup not finished". Staff may ask it for more information or decline it;
-- Approve stays refused by guard_approval_needs_terms until it signs.
--
-- Safe with the live site during the deploy: admin_verification_queue() keeps
-- its exact signature and columns and still returns only companies that
-- finished signup, so the overview's figures (admin_overview_metrics) and the
-- old screens are unchanged. The new screen reads admin_verification_queue_all(),
-- the same rows plus unfinished ones, each with signup_finished.
--
-- One body for both: verification_queue_rows() is 20261126300000's queue with
-- the wider candidate rule and a signup_finished column, callable only by these
-- functions.

create or replace function public.verification_queue_rows()
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
  decided_at          timestamptz,
  signup_finished     boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Only the two staff functions below call this; each checks staff first.
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
      f.onboarding_completed_at is not null as signup_finished,
      -- The latest submission: a profile sent back counts from then.
      greatest(
        coalesce(f.onboarding_completed_at, f.updated_at),
        (select max(x.resubmitted_at) from public.review_resubmission_email_outbox x where x.org_id = o.id)
      ) as submitted_at
    from public.orgs o
    join public.factory_profiles f on f.org_id = o.id
    where o.is_demo = false
      -- Finished signup, or not finished but sent a registration document.
      and (f.onboarding_completed_at is not null
           or exists (select 1 from public.documents d
                       where d.org_id = o.id and d.kind = 'business_registration'))

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
      b.onboarding_completed_at is not null,
      greatest(
        coalesce(b.onboarding_completed_at, b.updated_at),
        (select max(x.resubmitted_at) from public.review_resubmission_email_outbox x where x.org_id = o.id)
      )
    from public.orgs o
    join public.brand_profiles b on b.org_id = o.id
    where o.is_demo = false
      -- Finished signup, or not finished but sent a registration document.
      and (b.onboarding_completed_at is not null
           or exists (select 1 from public.documents d
                       where d.org_id = o.id and d.kind = 'business_registration'))
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
    r.decided_at,
    c.signup_finished
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

revoke all on function public.verification_queue_rows() from public, anon, authenticated;

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
  if not public.is_platform_admin() then
    raise exception 'this queue is limited to platform staff' using errcode = '42501';
  end if;
  -- Unchanged for its callers: only companies that finished signup.
  return query
  select q.org_id, q.org_name, q.org_type, q.org_slug, q.vendor_kind, q.location,
         q.legal_name, q.website_url, q.intro, q.submitted_at, q.state, q.risk,
         q.note, q.owner_user_id, q.owner_name, q.verification_status,
         q.evidence_received, q.evidence_expected, q.profile_completion,
         q.verification_score, q.verification_checks, q.capabilities, q.decided_at
    from public.verification_queue_rows() q
   where q.signup_finished;
end;
$$;

revoke all on function public.admin_verification_queue() from public, anon;
grant execute on function public.admin_verification_queue() to authenticated;

create or replace function public.admin_verification_queue_all()
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
  decided_at          timestamptz,
  signup_finished     boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- First statement, before any select (see admin_verification_queue).
  if not public.is_platform_admin() then
    raise exception 'this queue is limited to platform staff' using errcode = '42501';
  end if;
  return query select * from public.verification_queue_rows();
end;
$$;

revoke all on function public.admin_verification_queue_all() from public, anon;
grant execute on function public.admin_verification_queue_all() to authenticated;
