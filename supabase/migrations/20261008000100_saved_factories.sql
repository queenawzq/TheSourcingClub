-- ============================================================================
-- A brand's saved vendors
-- ----------------------------------------------------------------------------
-- "Save factory" on a vendor's profile, and "Save" on the Browse vendors
-- cards, keep the vendor on the brand's Saved page. `saved_factories` is the
-- brand's own list, the mirror of a factory's `saved_brands`: only the brand
-- that saved a vendor reads or removes the row, and it can only save a vendor
-- whose profile is published (one it can already see). The vendor is never
-- told who saved it, and no other brand can tell either.
--
-- Additive only: one new table and its policies. Nothing existing changes, so
-- the site already live keeps working while this is applied.
-- ============================================================================

create table public.saved_factories (
  org_id         uuid not null references public.orgs (id) on delete cascade,
  factory_org_id uuid not null references public.orgs (id) on delete cascade,
  saved_by       uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),

  primary key (org_id, factory_org_id)
);

create index saved_factories_org_idx on public.saved_factories (org_id, created_at desc);

alter table public.saved_factories enable row level security;

-- The brand's own list: nobody else reads it, the vendor included.
create policy saved_factories_read on public.saved_factories
  for select to authenticated
  using (public.is_org_member(org_id));

create policy saved_factories_remove on public.saved_factories
  for delete to authenticated
  using (public.is_org_member(org_id));

-- Saved by a member of a brand, as themselves, and only a vendor with a
-- published profile: the same vendors Browse vendors lists.
create policy saved_factories_add on public.saved_factories
  for insert to authenticated
  with check (
    public.is_org_member(org_id)
    and saved_by = auth.uid()
    and exists (select 1 from public.orgs o where o.id = org_id and o.type = 'brand')
    and exists (
      select 1 from public.factory_profiles f
      where f.org_id = factory_org_id and f.published_at is not null
    )
  );

-- Read, add and remove; a saved row is never edited. The stack's default
-- privileges would give `authenticated` everything on a new table, so the
-- rest is taken back explicitly.
revoke all on public.saved_factories from anon, authenticated;
grant select, insert, delete on public.saved_factories to authenticated;
