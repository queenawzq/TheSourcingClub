-- ============================================================================
-- 016  RFQs
-- ----------------------------------------------------------------------------
-- A brand's request for quotes. Requirements (product category, region,
-- required certifications) are NOT columns here — they link through the
-- existing taxonomy_links with subject_type = 'rfq', which the taxonomy_subject
-- enum reserved back in migration 002 for exactly this.
--
-- That reuse is what lets the RFQ-scoped match score call the same helpers the
-- profile score uses, with no second implementation to drift.
-- ============================================================================

create type public.rfq_status as enum (
  'draft',      -- being written; invisible to everyone but the brand
  'open',       -- published, accepting quotes
  'awarded',    -- a quote was accepted; set only by award_quote()
  'cancelled'   -- withdrawn by the brand without awarding
);

create type public.rfq_visibility as enum (
  'invited_only',  -- only factories with an invitation row
  'open_to_all'    -- any factory may see it; only verified ones may quote
);

create table public.rfqs (
  id            uuid primary key default gen_random_uuid(),
  brand_org_id  uuid not null references public.orgs (id) on delete cascade,

  title         text not null default '',
  brief         text,                               -- the original free text
  status        public.rfq_status not null default 'draft',
  visibility    public.rfq_visibility not null default 'invited_only',

  quantity_total integer check (quantity_total is null or quantity_total > 0),
  material_notes text,

  sourcing_responsibility_term_id uuid references public.taxonomy_terms (id),

  -- First of the month: the capacity model works in months, and a precise
  -- delivery date at RFQ time is a guess anyway.
  target_delivery_month date check (
    target_delivery_month is null
    or target_delivery_month = date_trunc('month', target_delivery_month)::date
  ),

  requires_sample boolean not null default true,
  sample_notes    text,

  target_unit_price_min_cents integer check (target_unit_price_min_cents is null or target_unit_price_min_cents >= 0),
  target_unit_price_max_cents integer check (target_unit_price_max_cents is null or target_unit_price_max_cents >= 0),
  currency char(3) not null default 'USD' check (currency = 'USD'),

  quote_deadline     timestamptz,
  additional_details text,

  published_at timestamptz,
  awarded_at   timestamptz,
  -- awarded_quote_id is added in migration 018, once `quotes` exists to
  -- reference. The two tables point at each other, so one direction has to
  -- wait.

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint rfq_price_band_ordered check (
    target_unit_price_min_cents is null
    or target_unit_price_max_cents is null
    or target_unit_price_min_cents <= target_unit_price_max_cents
  )
);

create index rfqs_brand_idx  on public.rfqs (brand_org_id, status);
create index rfqs_open_idx   on public.rfqs (status, visibility) where status = 'open';

create trigger rfqs_touch
  before update on public.rfqs
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Colour breakdown
-- ---------------------------------------------------------------------------
-- "300 units · 3 colours, 100 each" is displayed as one string in the
-- prototype. Stored as rows because a factory quoting it needs the per-colour
-- split to price dye lots, and a string cannot be summed or checked.
--
-- Deliberately NOT constrained to sum to quantity_total: that needs a trigger,
-- and a brand halfway through typing the breakdown would fight it. Validated
-- in the client instead.
-- ---------------------------------------------------------------------------

create table public.rfq_colour_splits (
  id       uuid primary key default gen_random_uuid(),
  rfq_id   uuid not null references public.rfqs (id) on delete cascade,
  colour   text not null,
  quantity integer not null check (quantity > 0),
  sort     integer not null default 0
);

create index rfq_colour_splits_rfq_idx on public.rfq_colour_splits (rfq_id, sort);

-- ---------------------------------------------------------------------------
-- Attachments
-- ---------------------------------------------------------------------------
-- documents keyed on org_id alone cannot say which of a brand's three open
-- RFQs a tech pack belongs to. Nullable so every existing row stays valid;
-- `on delete set null` because RFQs are cancelled rather than deleted, and a
-- future tidy-up job must not silently destroy the document record.
-- ---------------------------------------------------------------------------

alter table public.documents
  add column if not exists rfq_id uuid references public.rfqs (id) on delete set null;

create index if not exists documents_rfq_idx on public.documents (rfq_id) where rfq_id is not null;

-- ---------------------------------------------------------------------------
-- Invitations
-- ---------------------------------------------------------------------------
-- Lives here rather than with questions because RFQ visibility depends on it:
-- can_see_rfq() below cannot be written until this table exists.
-- ---------------------------------------------------------------------------

create type public.rfq_invitation_status as enum ('invited', 'viewed', 'declined');

create table public.rfq_invitations (
  id             uuid primary key default gen_random_uuid(),
  rfq_id         uuid not null references public.rfqs (id) on delete cascade,
  factory_org_id uuid not null references public.orgs (id) on delete cascade,

  status      public.rfq_invitation_status not null default 'invited',
  invited_by  uuid references auth.users (id) on delete set null,
  viewed_at   timestamptz,
  created_at  timestamptz not null default now(),

  unique (rfq_id, factory_org_id)
);

create index rfq_invitations_factory_idx on public.rfq_invitations (factory_org_id, status);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.rfqs               enable row level security;
alter table public.rfq_invitations    enable row level security;
alter table public.rfq_colour_splits  enable row level security;

-- ---------------------------------------------------------------------------
-- Access helpers
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER for the same reason current_org_ids() is: a policy on
-- `rfqs` that reads `rfq_invitations` under RLS re-enters the invitations
-- policy, which reads `rfqs`, which re-enters this policy — Postgres detects
-- the loop and raises "infinite recursion detected in policy". Running these
-- lookups as the definer breaks the cycle. Each one is a single narrow read.
-- ---------------------------------------------------------------------------

create or replace function public.is_invited_to_rfq(target_rfq uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.rfq_invitations i
    join public.org_members m on m.org_id = i.factory_org_id
    where i.rfq_id = target_rfq and m.user_id = auth.uid()
  );
$$;

-- The owning brand of an RFQ, read without re-entering the rfqs policy. Child
-- tables use this instead of `exists (select 1 from public.rfqs ...)`.
create or replace function public.rfq_brand_org(target_rfq uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select brand_org_id from public.rfqs where id = target_rfq;
$$;

create or replace function public.rfq_status_of(target_rfq uuid)
returns public.rfq_status
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select status from public.rfqs where id = target_rfq;
$$;

revoke all on function public.rfq_status_of(uuid) from public;
grant execute on function public.rfq_status_of(uuid) to authenticated;

revoke all on function public.is_invited_to_rfq(uuid) from public;
revoke all on function public.rfq_brand_org(uuid)     from public;
grant execute on function public.is_invited_to_rfq(uuid) to authenticated;
grant execute on function public.rfq_brand_org(uuid)     to authenticated;

-- Visibility is the heart of the marketplace, so it is spelled out once here
-- and reused by every child table and by brand_summary_for_factory().
create or replace function public.can_see_rfq(target_rfq uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.rfqs r
    where r.id = target_rfq
      and (
        -- the brand that owns it
        r.brand_org_id in (select org_id from public.org_members where user_id = auth.uid())
        -- or it is published to everyone
        or (r.status in ('open', 'awarded') and r.visibility = 'open_to_all')
        -- or this factory was invited
        or exists (
          select 1 from public.rfq_invitations i
          where i.rfq_id = r.id
            and i.factory_org_id in (select org_id from public.org_members where user_id = auth.uid())
        )
        or exists (select 1 from public.platform_admins a where a.user_id = auth.uid())
      )
  );
$$;

revoke all on function public.can_see_rfq(uuid) from public;
grant execute on function public.can_see_rfq(uuid) to authenticated;

create policy rfqs_read on public.rfqs
  for select to authenticated
  using (
    brand_org_id in (select public.current_org_ids())
    or public.is_platform_admin()
    or (status in ('open', 'awarded') and visibility = 'open_to_all')
    or public.is_invited_to_rfq(id)
  );

create policy rfqs_brand_insert on public.rfqs
  for insert to authenticated
  with check (public.is_org_member(brand_org_id));

-- The WITH CHECK is what makes 'awarded' unreachable from a client at all.
-- Only award_quote(), running as the table owner, can set it.
create policy rfqs_brand_update on public.rfqs
  for update to authenticated
  using (public.is_org_member(brand_org_id))
  with check (
    public.is_org_member(brand_org_id)
    and status in ('draft', 'open', 'cancelled')
  );

create policy rfqs_brand_delete on public.rfqs
  for delete to authenticated
  using (public.is_org_member(brand_org_id) and status = 'draft');

create policy rfq_colour_splits_read on public.rfq_colour_splits
  for select to authenticated
  using (public.can_see_rfq(rfq_id));

create policy rfq_colour_splits_write on public.rfq_colour_splits
  for all to authenticated
  using (public.is_org_member(public.rfq_brand_org(rfq_id)))
  with check (public.is_org_member(public.rfq_brand_org(rfq_id)));

-- ---------------------------------------------------------------------------
-- Deferred from migration 014: RFQ requirement links must be readable by a
-- factory that can see the RFQ.
--
-- Without this the match helpers — which run under the caller's RLS, not as
-- definer — return a quietly LOW score for a factory rather than an error,
-- because the factory cannot read the terms it is being scored against. A
-- silent wrong number is far harder to notice than a permission failure.
-- ---------------------------------------------------------------------------

create policy taxonomy_links_rfq_read on public.taxonomy_links
  for select to authenticated
  using (subject_type = 'rfq' and public.can_see_rfq(subject_id));

create policy rfq_invitations_read on public.rfq_invitations
  for select to authenticated
  using (
    factory_org_id in (select public.current_org_ids())
    or public.is_platform_admin()
    or public.is_org_member(public.rfq_brand_org(rfq_id))
  );

create policy rfq_invitations_brand_write on public.rfq_invitations
  for insert to authenticated
  with check (
    public.is_org_member(public.rfq_brand_org(rfq_id))
    and public.rfq_status_of(rfq_id) <> 'draft'
  );

create policy rfq_invitations_brand_revoke on public.rfq_invitations
  for delete to authenticated
  using (
    public.is_org_member(public.rfq_brand_org(rfq_id))
    and public.rfq_status_of(rfq_id) = 'open'
  );

-- A factory may mark its own invitation viewed or declined, nothing else.
create policy rfq_invitations_factory_respond on public.rfq_invitations
  for update to authenticated
  using (factory_org_id in (select public.current_org_ids()))
  with check (factory_org_id in (select public.current_org_ids()));

grant select, insert, update, delete on public.rfqs              to authenticated;
grant select, insert, update, delete on public.rfq_invitations   to authenticated;
grant select, insert, update, delete on public.rfq_colour_splits to authenticated;
