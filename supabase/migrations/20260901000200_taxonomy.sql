-- ============================================================================
-- 002  Taxonomy
-- ----------------------------------------------------------------------------
-- One table replaces the ~15 controlled vocabularies currently hardcoded, and
-- inconsistently, across both prototypes: production types, product
-- categories, market levels, regions, certifications, services, and so on.
--
-- Two problems it solves at once:
--
--   1. Drift. The brand app says "United States" where the filter panel says
--      "USA"; the certification lists differ between onboarding and profile.
--      A slug is the identity, so labels can be corrected in one place.
--
--   2. Bilingual labels. The factory UI needs Chinese for every one of these
--      terms. Carrying label_zh on the row means the term translates without
--      going near the machine-translation path, which is reserved for
--      user-authored prose.
--
-- Custom terms: several onboarding steps let a user add their own production
-- type or category. Those rows carry an org_id; canonical terms have null.
-- ============================================================================

create table public.taxonomy_kinds (
  kind          text primary key check (kind ~ '^[a-z][a-z0-9_]*$'),
  label_en      text not null,
  label_zh      text,

  -- Whether the onboarding UI offers an "add your own" option for this kind.
  allows_custom boolean not null default false,
  created_at    timestamptz not null default now()
);

create table public.taxonomy_terms (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null references public.taxonomy_kinds (kind) on delete cascade,
  slug        text not null check (slug ~ '^[a-z0-9][a-z0-9-]*$'),

  label_en    text not null,
  label_zh    text,

  sort        integer not null default 0,

  -- Variant spellings found in the prototypes, kept so old data and inbound
  -- text can be mapped onto the canonical term.
  aliases     text[] not null default '{}',

  -- Kind-specific payload. Capacity categories carry minutes_per_piece and
  -- their reference style here; most kinds carry nothing.
  extra       jsonb not null default '{}'::jsonb,

  -- Null for canonical platform terms; set for a term one org invented.
  org_id      uuid references public.orgs (id) on delete cascade,

  created_at  timestamptz not null default now()
);

-- Canonical terms are unique per kind. Custom terms are unique per org.
create unique index taxonomy_terms_canonical_slug_idx
  on public.taxonomy_terms (kind, slug)
  where org_id is null;

create unique index taxonomy_terms_custom_slug_idx
  on public.taxonomy_terms (kind, org_id, slug)
  where org_id is not null;

create index taxonomy_terms_kind_idx on public.taxonomy_terms (kind, sort);
create index taxonomy_terms_org_idx  on public.taxonomy_terms (org_id) where org_id is not null;

-- ---------------------------------------------------------------------------
-- Reusable link table
-- ---------------------------------------------------------------------------
-- Rather than a join table per (entity, kind) pair, one polymorphic link table
-- covers brand profiles, factory profiles and RFQs alike. subject_type is
-- constrained, so this stays a closed set rather than a free-for-all.
-- ---------------------------------------------------------------------------

create type public.taxonomy_subject as enum (
  'brand_profile',
  'factory_profile',
  'rfq'
);

create table public.taxonomy_links (
  subject_type public.taxonomy_subject not null,
  subject_id   uuid not null,
  term_id      uuid not null references public.taxonomy_terms (id) on delete cascade,

  -- Denormalised so every access policy can reach an owning org with no join.
  org_id       uuid not null references public.orgs (id) on delete cascade,

  created_at   timestamptz not null default now(),
  primary key (subject_type, subject_id, term_id)
);

create index taxonomy_links_term_idx    on public.taxonomy_links (term_id);
create index taxonomy_links_subject_idx on public.taxonomy_links (subject_type, subject_id);
create index taxonomy_links_org_idx     on public.taxonomy_links (org_id);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.taxonomy_kinds enable row level security;
alter table public.taxonomy_terms enable row level security;
alter table public.taxonomy_links enable row level security;

-- Vocabularies are public reference data to any signed-in user.
create policy taxonomy_kinds_read on public.taxonomy_kinds
  for select to authenticated
  using (true);

-- Canonical terms are readable by everyone; a custom term only by its own org.
create policy taxonomy_terms_read on public.taxonomy_terms
  for select to authenticated
  using (
    org_id is null
    or org_id in (select public.current_org_ids())
    or public.is_platform_admin()
  );

-- An org may invent terms for itself, and only for kinds that allow it.
create policy taxonomy_terms_custom_insert on public.taxonomy_terms
  for insert to authenticated
  with check (
    org_id is not null
    and public.is_org_member(org_id)
    and exists (
      select 1 from public.taxonomy_kinds k
      where k.kind = taxonomy_terms.kind and k.allows_custom
    )
  );

create policy taxonomy_terms_custom_delete on public.taxonomy_terms
  for delete to authenticated
  using (org_id is not null and public.is_org_member(org_id));

-- Links follow their org.
create policy taxonomy_links_read on public.taxonomy_links
  for select to authenticated
  using (org_id in (select public.current_org_ids()) or public.is_platform_admin());

create policy taxonomy_links_write on public.taxonomy_links
  for all to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

-- Note: factory profiles are browsable by brands, and browsing filters on
-- these links. Migration 003 adds the wider read policy for links belonging to
-- published factory profiles, once that table exists to join against.

grant select                 on public.taxonomy_kinds to authenticated;
grant select, insert, delete on public.taxonomy_terms to authenticated;
grant select, insert, delete on public.taxonomy_links to authenticated;
