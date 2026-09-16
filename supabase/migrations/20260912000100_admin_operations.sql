-- ============================================================================
-- 041  Admin operations: org-level verification review
-- ----------------------------------------------------------------------------
-- The admin prototype (src/admin-prototype) reviews a *profile*: one row per
-- company, moving through "Ready for review → Needs information → Approved".
-- The backend so far reviews a *document*: review_document() decides one file
-- at a time, and the org's status is a side effect of whichever registration
-- happened to be decided last.
--
-- Both are needed. A reviewer opens a company, reads six pieces of evidence,
-- and reaches one conclusion — that conclusion is the thing a factory waits
-- on, and it had nowhere to live. review_document() stays exactly as it is
-- and keeps deciding individual files; this adds the company-level verdict on
-- top of it.
--
-- Two things in the design are deliberately NOT built here, because there is
-- nothing behind them and a number on a reviewer's screen that came from
-- nowhere is worse than an empty space:
--
--   * The confidence percentage ("94%", "Below the 80% threshold"). That is
--     the output of an automated KYB check against a company registry. There
--     is no such integration, and a made-up score would be trusted.
--   * The per-check breakdown ("Business identity — Verified 99%"). Same
--     origin. What a reviewer actually has is the documents, and those are
--     counted honestly below as evidence received vs expected.
--
-- `risk` IS here, but as a nullable field an admin sets by hand. It is a
-- judgement, and it reads as one.
-- ============================================================================

create type public.org_review_state as enum (
  'ready_for_review',   -- evidence is in, nobody has picked it up
  'in_review',          -- an admin has taken it
  'needs_information',  -- returned to the company with a note
  'approved',
  'declined'
);

create type public.org_review_risk as enum ('low', 'medium', 'high');

-- ---------------------------------------------------------------------------
-- The admin's working state, and only that
-- ---------------------------------------------------------------------------
-- This table is invisible to the company being reviewed. The internal note
-- and the assigned reviewer are staff notes about a customer, and leaking
-- either is the kind of mistake that is noticed from the outside.
--
-- What the company must see — "we need more information, here is what" —
-- travels the way everything else does, as a notification, written by the
-- RPC below in the same transaction as the state change.
--
-- No row is required for an org to appear in the queue: absent a row the
-- queue reports 'ready_for_review'. That way a company can never be missed
-- because a row was never created for it.
-- ---------------------------------------------------------------------------

create table public.org_reviews (
  org_id        uuid primary key references public.orgs (id) on delete cascade,

  state         public.org_review_state not null default 'ready_for_review',
  owner_user_id uuid references auth.users (id) on delete set null,
  risk          public.org_review_risk,

  -- The last note written to the company. Kept so the queue can show what was
  -- asked for without re-reading the notification stream.
  note          text,

  decided_at    timestamptz,
  decided_by    uuid references auth.users (id) on delete set null,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index org_reviews_state_idx on public.org_reviews (state);
create index org_reviews_owner_idx on public.org_reviews (owner_user_id)
  where owner_user_id is not null;

create trigger org_reviews_touch
  before update on public.org_reviews
  for each row execute function public.touch_updated_at();

alter table public.org_reviews enable row level security;

-- Select and nothing else, the Phase 3 rule: an UPDATE policy can gate the
-- state a row comes from but not the payload written alongside it, so every
-- write goes through the security-definer RPCs below.
create policy org_reviews_admin_read on public.org_reviews
  for select to authenticated
  using (public.is_platform_admin());

grant select on public.org_reviews to authenticated;

-- ---------------------------------------------------------------------------
-- Evidence, counted rather than scored
-- ---------------------------------------------------------------------------
-- "8 of 8 received" in the design. Expected is one business registration plus
-- one document per certification the factory claims — a brand claims none, so
-- a brand expects exactly the registration. Received counts the documents
-- actually uploaded against those slots.
--
-- Returns a pair rather than a percentage on purpose. "6 of 8" tells a
-- reviewer what to chase; "75%" does not.
-- ---------------------------------------------------------------------------

create or replace function public.org_evidence_expected(target_org uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select 1 + (
    select count(*)::integer
    from public.factory_certifications c
    where c.org_id = target_org
  );
$$;

create or replace function public.org_evidence_received(target_org uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select (
    select count(*)::integer
    from public.documents d
    where d.org_id = target_org
      and d.kind = 'business_registration'
  ) + (
    select count(*)::integer
    from public.factory_certifications c
    where c.org_id = target_org
      and c.document_id is not null
  );
$$;

revoke all on function public.org_evidence_expected(uuid) from public;
revoke all on function public.org_evidence_received(uuid) from public;
grant execute on function public.org_evidence_expected(uuid) to authenticated;
grant execute on function public.org_evidence_received(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The queue
-- ---------------------------------------------------------------------------
-- The population is every company that has either finished onboarding or put
-- a reviewable document in front of us. Both halves matter: a company that
-- finished onboarding without uploading a registration is not "not yet in the
-- queue", it is the specific case a reviewer needs to see and ask about.
-- ---------------------------------------------------------------------------

create or replace function public.admin_verification_queue()
returns table (
  org_id              uuid,
  org_name            text,
  org_type            public.org_type,
  org_slug            text,
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
    c.location,
    c.legal_name,
    c.website_url,
    c.intro,
    c.submitted_at,
    coalesce(r.state, 'ready_for_review'::public.org_review_state),
    r.risk,
    r.note,
    r.owner_user_id,
    u.full_name,
    c.verification_status,
    public.org_evidence_received(c.id),
    public.org_evidence_expected(c.id),
    r.decided_at
  from candidates c
  left join public.org_reviews r on r.org_id = c.id
  left join public.user_profiles u on u.id = r.owner_user_id
  order by
    -- Undecided first, oldest submission first inside that: a queue sorted by
    -- how long someone has been waiting, not by when we last touched it.
    case coalesce(r.state, 'ready_for_review'::public.org_review_state)
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

-- ---------------------------------------------------------------------------
-- Taking a review
-- ---------------------------------------------------------------------------

create or replace function public.admin_claim_review(
  target_org uuid,
  assign_to  uuid default null
)
returns public.org_reviews
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  claimed public.org_reviews;
  owner   uuid := coalesce(assign_to, auth.uid());
begin
  if not public.is_platform_admin() then
    raise exception 'only platform admins may claim a review' using errcode = '42501';
  end if;

  if not exists (select 1 from public.orgs o where o.id = target_org) then
    raise exception 'org not found' using errcode = 'P0002';
  end if;

  -- Only a platform admin can be an assignee. Without this an admin could
  -- park a company's review on an arbitrary user id, and the queue would
  -- report it as owned by someone who cannot open it.
  if not exists (select 1 from public.platform_admins p where p.user_id = owner) then
    raise exception 'a review can only be assigned to a platform admin'
      using errcode = '22023';
  end if;

  insert into public.org_reviews (org_id, state, owner_user_id)
  values (target_org, 'in_review', owner)
  on conflict (org_id) do update
    set owner_user_id = excluded.owner_user_id,
        -- Claiming a decided review does not reopen it; reopening is
        -- admin_review_decision('ready_for_review'), which is a deliberate act.
        state = case
          when public.org_reviews.state in ('approved', 'declined')
            then public.org_reviews.state
          else 'in_review'
        end
  returning * into claimed;

  return claimed;
end;
$$;

revoke all on function public.admin_claim_review(uuid, uuid) from public;
grant execute on function public.admin_claim_review(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The decision
-- ---------------------------------------------------------------------------
-- Approving a company here does what a verified business registration does in
-- review_document(): it sets verification_status on whichever profile the org
-- has, and that is the gate on quoting. The two paths agree because they both
-- write the same column — this one is just the conclusion a human reached
-- about the company rather than about one file.
--
-- 'needs_information' is the reason this function writes a notification and
-- review_document() does not. A rejected file is a fact the company can see
-- on the file; "we need your export licence as well" is a sentence, and it
-- has to reach them.
-- ---------------------------------------------------------------------------

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
begin
  if not public.is_platform_admin() then
    raise exception 'only platform admins may decide a review' using errcode = '42501';
  end if;

  if not exists (select 1 from public.orgs o where o.id = target_org) then
    raise exception 'org not found' using errcode = 'P0002';
  end if;

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

-- ============================================================================
-- Marketplace oversight
-- ----------------------------------------------------------------------------
-- The RFQ and quote policies already carry an `or is_platform_admin()` branch,
-- so staff can read both tables today. What they cannot do is read them
-- *across the marketplace* in one query: a brand sees its own requests, a
-- factory sees the ones it was invited to, and an admin sees the union of
-- everything one row at a time with no counts attached.
--
-- These two functions are that missing shape. They are security definer for
-- the same reason admin_payment_queue() is: the aggregate — how many vendors
-- were invited, what the quote totals are — is the thing being authorised,
-- and it is cheaper and clearer to authorise it once at the top.
-- ============================================================================

create or replace function public.admin_rfq_queue(row_limit integer default 200)
returns table (
  rfq_id           uuid,
  title            text,
  brand_org_id     uuid,
  brand_name       text,
  status           public.rfq_status,
  visibility       public.rfq_visibility,
  quantity_total   integer,
  currency         char(3),
  invited_count    integer,
  quote_count      integer,
  latest_quote_at  timestamptz,
  quote_deadline   timestamptz,
  published_at     timestamptz,
  awarded_at       timestamptz,
  created_at       timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'this queue is limited to platform staff' using errcode = '42501';
  end if;

  return query
  select
    r.id,
    r.title,
    r.brand_org_id,
    b.name,
    r.status,
    r.visibility,
    r.quantity_total,
    r.currency,
    (select count(*)::integer from public.rfq_invitations i where i.rfq_id = r.id),
    -- Submitted and beyond. A draft quote is the factory's private working
    -- copy; counting it would tell a brand's account manager that a quote
    -- exists before the factory has decided to send one.
    (select count(*)::integer from public.quotes q
      where q.rfq_id = r.id and q.status <> 'draft'),
    (select max(q.submitted_at) from public.quotes q
      where q.rfq_id = r.id and q.submitted_at is not null),
    r.quote_deadline,
    r.published_at,
    r.awarded_at,
    r.created_at
  from public.rfqs r
  join public.orgs b on b.id = r.brand_org_id
  where r.status <> 'draft'
  order by coalesce(r.published_at, r.created_at) desc
  limit greatest(row_limit, 1);
end;
$$;

revoke all on function public.admin_rfq_queue(integer) from public;
grant execute on function public.admin_rfq_queue(integer) to authenticated;

create or replace function public.admin_quote_queue(row_limit integer default 200)
returns table (
  quote_id        uuid,
  rfq_id          uuid,
  rfq_title       text,
  brand_org_id    uuid,
  brand_name      text,
  factory_org_id  uuid,
  factory_name    text,
  status          public.quote_status,
  version         integer,
  total_cents     bigint,
  currency        char(3),
  submitted_at    timestamptz,
  decided_at      timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'this queue is limited to platform staff' using errcode = '42501';
  end if;

  return query
  select
    q.id,
    r.id,
    r.title,
    r.brand_org_id,
    b.name,
    q.factory_org_id,
    f.name,
    q.status,
    q.version,
    -- Production plus samples, the same definition quoteTotalCents() uses in
    -- src/lib/domain/quote.js. bigint because unit_price_cents *
    -- production_quantity overflows int4 at 100,000 units of a $250 jacket.
    case
      when q.unit_price_cents is null or q.production_quantity is null then null
      else q.unit_price_cents::bigint * q.production_quantity
             + coalesce(public.quote_sample_subtotal(q.id), 0)
    end,
    q.currency,
    q.submitted_at,
    q.decided_at
  from public.quotes q
  join public.rfqs r on r.id = q.rfq_id
  join public.orgs b on b.id = r.brand_org_id
  join public.orgs f on f.id = q.factory_org_id
  where q.status <> 'draft'
  order by coalesce(q.submitted_at, q.created_at) desc
  limit greatest(row_limit, 1);
end;
$$;

revoke all on function public.admin_quote_queue(integer) from public;
grant execute on function public.admin_quote_queue(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- The four numbers on the overview
-- ---------------------------------------------------------------------------
-- The design's fourth card is "Low-confidence checks — below the 80%
-- threshold". There is no confidence score (see the header of this file), so
-- that card would have to be filled with a fabricated number or left blank.
--
-- It is neither: it becomes payments awaiting confirmation, which is a real
-- figure and a more urgent one. Platform staff have no org and so cannot be
-- notified of anything — a payment sits at 'sent' until a human looks at the
-- queue, and nothing anywhere will chase them. A count of it on the first
-- screen an admin opens is the only prompt that exists.
-- ---------------------------------------------------------------------------

create or replace function public.admin_overview_metrics()
returns table (
  profiles_awaiting_review integer,
  rfqs_submitted_today     integer,
  quotes_submitted_today   integer,
  payments_awaiting_confirmation integer,
  profiles_submitted_today integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'these metrics are limited to platform staff' using errcode = '42501';
  end if;

  return query
  select
    (select count(*)::integer from public.admin_verification_queue() q
      where q.state in ('ready_for_review', 'in_review', 'needs_information')),
    (select count(*)::integer from public.rfqs r
      where r.published_at >= date_trunc('day', now())),
    (select count(*)::integer from public.quotes q
      where q.submitted_at >= date_trunc('day', now())),
    (select count(*)::integer from public.order_payments p
      where p.state = 'sent'),
    (select count(*)::integer from public.admin_verification_queue() q
      where q.submitted_at >= date_trunc('day', now()));
end;
$$;

revoke all on function public.admin_overview_metrics() from public;
grant execute on function public.admin_overview_metrics() to authenticated;
