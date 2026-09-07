-- ============================================================================
-- 003  Brand profiles, factory profiles, and the capacity model
-- ----------------------------------------------------------------------------
-- The capacity section is the most load-bearing part of this migration. The
-- prototypes implement the hours-to-pieces conversion FOUR times, and the
-- dashboard copy hardcodes 18 minutes per piece for every category — so a
-- sweater factory, whose real reference style is 42 min/pc, is shown roughly
-- 2.3x its actual capacity. Here the conversion exists exactly once, in SQL,
-- and is category-aware.
-- ============================================================================

create type public.verification_status as enum (
  'unverified',   -- nothing submitted
  'pending',      -- documents uploaded, awaiting admin review
  'verified',
  'rejected'
);

create type public.capacity_input_mode as enum ('units', 'hours');

create type public.capacity_level as enum ('open', 'partial', 'full');

-- ---------------------------------------------------------------------------
-- brand_profiles
-- ---------------------------------------------------------------------------
-- One row per brand org. Taxonomy-valued fields (categories, regions,
-- certifications, services) live in taxonomy_links, not here.
-- ---------------------------------------------------------------------------

create table public.brand_profiles (
  org_id              uuid primary key references public.orgs (id) on delete cascade,

  legal_name          text,
  business_email      text,
  website_url         text,
  hq_location         text,
  founded_year        integer check (founded_year between 1800 and 2200),

  intro               text,

  -- Banded rather than exact: the design asks for ranges, and brands are more
  -- willing to answer a band than a number.
  annual_revenue_band text,
  pieces_per_year_band text,
  order_size_band     text,
  collections_per_year text,
  reorder_cadence     text,
  sourcing_stage      text,
  target_price_min_cents integer check (target_price_min_cents >= 0),
  target_price_max_cents integer check (target_price_max_cents >= 0),

  verification_status public.verification_status not null default 'unverified',

  onboarding_completed_at timestamptz,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint brand_price_band_ordered check (
    target_price_min_cents is null
    or target_price_max_cents is null
    or target_price_min_cents <= target_price_max_cents
  )
);

create trigger brand_profiles_touch
  before update on public.brand_profiles
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- factory_profiles
-- ---------------------------------------------------------------------------

create table public.factory_profiles (
  org_id              uuid primary key references public.orgs (id) on delete cascade,

  legal_name          text,
  website_url         text,
  location            text,
  country_code        text check (country_code ~ '^[A-Z]{2}$'),
  nearest_port        text,
  founded_year        integer check (founded_year between 1800 and 2200),
  registration_date   date,
  employee_count      integer check (employee_count >= 0),
  registered_capital  text,

  intro               text,

  moq                 integer check (moq >= 0),
  typical_lead_days   integer check (typical_lead_days >= 0),

  verification_status public.verification_status not null default 'unverified',

  -- A factory appears in brand browse only once it has completed onboarding.
  -- Verification gates quoting, not visibility — see rfq policies in 005.
  published_at        timestamptz,
  onboarding_completed_at timestamptz,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index factory_profiles_published_idx
  on public.factory_profiles (published_at)
  where published_at is not null;

create index factory_profiles_verification_idx
  on public.factory_profiles (verification_status);

create trigger factory_profiles_touch
  before update on public.factory_profiles
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Sample work / product imagery shown on a profile
-- ---------------------------------------------------------------------------

create table public.profile_showcase_items (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs (id) on delete cascade,
  title       text,
  caption     text,
  image_path  text not null,
  sort        integer not null default 0,
  created_at  timestamptz not null default now()
);

create index profile_showcase_org_idx on public.profile_showcase_items (org_id, sort);

-- ---------------------------------------------------------------------------
-- Past and current work, shown as references on a profile
-- ---------------------------------------------------------------------------

create table public.profile_references (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs (id) on delete cascade,
  title         text not null,
  counterparty  text,
  period        text,
  outcome       text,
  summary       text,
  is_active     boolean not null default false,
  sort          integer not null default 0,
  created_at    timestamptz not null default now()
);

create index profile_references_org_idx on public.profile_references (org_id, sort);

-- ============================================================================
-- CAPACITY
-- ============================================================================
-- A factory declares capacity either directly in units per month, or in line
-- hours per month which are converted using the minutes-per-piece of its
-- chosen reference style. Then it marks each of the next months as mostly
-- open, partly booked, or mostly full.
-- ============================================================================

create table public.factory_capacity (
  org_id            uuid primary key references public.orgs (id) on delete cascade,

  -- References a taxonomy_terms row of kind 'capacity_category', whose extra
  -- payload carries minutes_per_piece and the reference style name.
  category_term_id  uuid references public.taxonomy_terms (id) on delete set null,

  input_mode        public.capacity_input_mode not null default 'units',

  line_hours        numeric(10, 2) check (line_hours >= 0),
  monthly_units     integer        check (monthly_units >= 0),

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- Whichever mode is selected, the corresponding figure must be present.
  constraint capacity_mode_has_value check (
    (input_mode = 'hours' and line_hours is not null)
    or (input_mode = 'units' and monthly_units is not null)
  )
);

create trigger factory_capacity_touch
  before update on public.factory_capacity
  for each row execute function public.touch_updated_at();

create table public.factory_capacity_months (
  org_id      uuid not null references public.orgs (id) on delete cascade,

  -- Always the first of the month, so the rolling six-month window the UI
  -- shows is derived from real dates rather than the hardcoded
  -- ["Aug".."Jan"] array the prototype uses.
  month       date not null check (month = date_trunc('month', month)::date),

  level       public.capacity_level not null,
  updated_at  timestamptz not null default now(),
  primary key (org_id, month)
);

-- ---------------------------------------------------------------------------
-- The one conversion. Everything else calls these.
-- ---------------------------------------------------------------------------

-- Minutes per piece for a capacity category, defaulting to a plain woven
-- shirt when a factory has not chosen one yet.
create or replace function public.capacity_minutes_per_piece(category_term uuid)
returns numeric
language sql
stable
as $$
  select coalesce(
    (select (t.extra ->> 'minutes_per_piece')::numeric
       from public.taxonomy_terms t
      where t.id = category_term
        and t.kind = 'capacity_category'),
    18
  );
$$;

-- Monthly capacity in pieces, whichever way the factory expressed it.
create or replace function public.capacity_monthly_units(org uuid)
returns integer
language sql
stable
as $$
  select case
    when c.input_mode = 'units' then c.monthly_units
    else round((c.line_hours * 60) / nullif(public.capacity_minutes_per_piece(c.category_term_id), 0))::integer
  end
  from public.factory_capacity c
  where c.org_id = org;
$$;

-- The share of capacity still free at each booking level. These percentages
-- are the ones already used in the prototype's three copies of the widget.
create or replace function public.capacity_level_bounds(level public.capacity_level)
returns table (min_share numeric, max_share numeric)
language sql
immutable
as $$
  select t.min_share, t.max_share from (values
    ('open'::public.capacity_level,    0.60::numeric, 1.00::numeric),
    ('partial'::public.capacity_level, 0.25::numeric, 0.60::numeric),
    ('full'::public.capacity_level,    0.00::numeric, 0.25::numeric)
  ) as t(lvl, min_share, max_share)
  where t.lvl = level;
$$;

-- Pieces a factory could take in a given month. This is what a brand sees on
-- a factory card, and what the capacity component of the match score reads.
create or replace function public.capacity_available_range(org uuid, target_month date)
returns table (min_pieces integer, max_pieces integer)
language sql
stable
as $$
  select
    round(public.capacity_monthly_units(org) * b.min_share)::integer,
    round(public.capacity_monthly_units(org) * b.max_share)::integer
  from public.factory_capacity_months m
  cross join lateral public.capacity_level_bounds(m.level) b
  where m.org_id = org
    and m.month = date_trunc('month', target_month)::date;
$$;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.brand_profiles          enable row level security;
alter table public.factory_profiles        enable row level security;
alter table public.profile_showcase_items  enable row level security;
alter table public.profile_references      enable row level security;
alter table public.factory_capacity        enable row level security;
alter table public.factory_capacity_months enable row level security;

-- A brand profile is private to its own org. Factories see a brand's details
-- through an RFQ, not by browsing brands.
create policy brand_profiles_own on public.brand_profiles
  for all to authenticated
  using (public.is_org_member(org_id) or public.is_platform_admin())
  with check (public.is_org_member(org_id));

-- A published factory profile is readable by any signed-in user: that is what
-- makes browse work. Writes stay with the factory.
create policy factory_profiles_read on public.factory_profiles
  for select to authenticated
  using (
    published_at is not null
    or public.is_org_member(org_id)
    or public.is_platform_admin()
  );

create policy factory_profiles_write on public.factory_profiles
  for all to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

-- Showcase items and references inherit their profile's visibility.
create policy showcase_read on public.profile_showcase_items
  for select to authenticated
  using (
    public.is_org_member(org_id)
    or public.is_platform_admin()
    or exists (
      select 1 from public.factory_profiles f
      where f.org_id = profile_showcase_items.org_id
        and f.published_at is not null
    )
  );

create policy showcase_write on public.profile_showcase_items
  for all to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

create policy references_read on public.profile_references
  for select to authenticated
  using (
    public.is_org_member(org_id)
    or public.is_platform_admin()
    or exists (
      select 1 from public.factory_profiles f
      where f.org_id = profile_references.org_id
        and f.published_at is not null
    )
  );

create policy references_write on public.profile_references
  for all to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

-- Capacity is public for published factories — brands filter browse on it.
create policy capacity_read on public.factory_capacity
  for select to authenticated
  using (
    public.is_org_member(org_id)
    or public.is_platform_admin()
    or exists (
      select 1 from public.factory_profiles f
      where f.org_id = factory_capacity.org_id
        and f.published_at is not null
    )
  );

create policy capacity_write on public.factory_capacity
  for all to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

create policy capacity_months_read on public.factory_capacity_months
  for select to authenticated
  using (
    public.is_org_member(org_id)
    or public.is_platform_admin()
    or exists (
      select 1 from public.factory_profiles f
      where f.org_id = factory_capacity_months.org_id
        and f.published_at is not null
    )
  );

create policy capacity_months_write on public.factory_capacity_months
  for all to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

-- Deferred from 002: taxonomy links on a published factory profile must be
-- readable by browsing brands, or filtering by certification cannot work.
create policy taxonomy_links_public_factory_read on public.taxonomy_links
  for select to authenticated
  using (
    subject_type = 'factory_profile'
    and exists (
      select 1 from public.factory_profiles f
      where f.org_id = taxonomy_links.org_id
        and f.published_at is not null
    )
  );

grant select, insert, update, delete on public.brand_profiles          to authenticated;
grant select, insert, update, delete on public.factory_profiles        to authenticated;
grant select, insert, update, delete on public.profile_showcase_items  to authenticated;
grant select, insert, update, delete on public.profile_references      to authenticated;
grant select, insert, update, delete on public.factory_capacity        to authenticated;
grant select, insert, update, delete on public.factory_capacity_months to authenticated;
