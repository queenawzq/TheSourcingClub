-- ============================================================================
-- The review queue's "Submitted" is the latest submission
-- ----------------------------------------------------------------------------
-- admin_verification_queue() gave submitted_at = the profile's first
-- completion. A company asked for more information that sent its profile back
-- (resubmit_for_review) kept that first time, so staff read "Submitted 3 weeks
-- ago" on a profile answered an hour ago.
--
-- Every resubmission is already recorded, by the trigger from
-- 20261104200000, in review_resubmission_email_outbox (org_id,
-- resubmitted_at), and those rows are kept once sent. So submitted_at is now
-- the later of the first completion and the latest resubmission. One change
-- in each branch of the union; everything else is 20261026000700's text.
--
-- Knock-on, intended: the queue's "oldest first" order and the overview's
-- "submitted today" both count a resubmission at its own time.
--
-- Same signature and columns, so `create or replace` keeps the live site
-- working during the deploy and keeps the function's grants; they are stated
-- again anyway (anon never had execute; pinned in review_request_test.sql).
-- ============================================================================

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
      -- The latest submission: a profile sent back counts from then.
      greatest(
        coalesce(f.onboarding_completed_at, f.updated_at),
        (select max(x.resubmitted_at) from public.review_resubmission_email_outbox x where x.org_id = o.id)
      ) as submitted_at
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
      greatest(
        coalesce(b.onboarding_completed_at, b.updated_at),
        (select max(x.resubmitted_at) from public.review_resubmission_email_outbox x where x.org_id = o.id)
      )
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

revoke all on function public.admin_verification_queue() from public, anon;
grant execute on function public.admin_verification_queue() to authenticated;
