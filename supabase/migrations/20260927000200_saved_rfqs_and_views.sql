-- ============================================================================
-- 062  Saved requests, and when a brand last looked
-- ----------------------------------------------------------------------------
-- Two panels on the designed RFQ detail screen had nothing behind them:
--
--   * "Save request", beside Send quote. The factory nav has a Saved item and
--     there was nowhere for a saved request to live.
--   * "Last viewed by brand: 12 min ago" in the activity panel. A vendor
--     deciding whether to spend credits on a quote wants to know the brand is
--     still paying attention, and that was a hardcoded string.
--
-- The view is recorded per BRAND ORG, not per person. A vendor learns that the
-- company looked, never which member — which is why the vendor reads it
-- through a definer function rather than the table.
-- ============================================================================

create table public.saved_rfqs (
  org_id     uuid not null references public.orgs (id) on delete cascade,
  rfq_id     uuid not null references public.rfqs (id) on delete cascade,
  saved_by   uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),

  primary key (org_id, rfq_id)
);

create index saved_rfqs_org_idx on public.saved_rfqs (org_id, created_at desc);

alter table public.saved_rfqs enable row level security;

-- A saved list is the org's own business and nobody else's — not the brand
-- whose request it is, and not another vendor.
create policy saved_rfqs_own on public.saved_rfqs
  for all to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id) and saved_by = auth.uid());

grant select, insert, delete on public.saved_rfqs to authenticated;

-- ---------------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------------
-- One row per request per viewing org, stamped forward. A log of every open
-- would grow without bound and answer no question this product asks.
create table public.rfq_views (
  rfq_id       uuid not null references public.rfqs (id) on delete cascade,
  viewer_org_id uuid not null references public.orgs (id) on delete cascade,
  last_viewed_at timestamptz not null default now(),

  primary key (rfq_id, viewer_org_id)
);

alter table public.rfq_views enable row level security;

-- Readable by the viewing org itself. Vendors do NOT read this table; they
-- call rfq_last_brand_view() below, which answers with a time and nothing else.
create policy rfq_views_own on public.rfq_views
  for select to authenticated
  using (public.is_org_member(viewer_org_id) or public.is_platform_admin());

grant select on public.rfq_views to authenticated;

-- Writing is a definer function: a client that could write this table could
-- also write someone else's, and the value of "the brand looked" depends
-- entirely on it being true.
create or replace function public.record_rfq_view(target_rfq uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  owner_org uuid;
begin
  select brand_org_id into owner_org from public.rfqs where id = target_rfq;
  if owner_org is null then
    raise exception 'request not found' using errcode = 'P0002';
  end if;

  -- Only the brand that owns the request records a view. A vendor opening a
  -- request is not "the brand looked at it".
  if not public.is_org_member(owner_org) then
    return;
  end if;

  insert into public.rfq_views (rfq_id, viewer_org_id)
  values (target_rfq, owner_org)
  on conflict (rfq_id, viewer_org_id)
  do update set last_viewed_at = now();
end;
$$;

revoke all on function public.record_rfq_view(uuid) from public;
grant execute on function public.record_rfq_view(uuid) to authenticated;

-- What a vendor may know: when the brand last looked, and nothing else. Gated
-- on being able to see the request at all, which is already answered by
-- can_see_rfq().
create or replace function public.rfq_last_brand_view(target_rfq uuid)
returns timestamptz
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  owner_org uuid;
  seen      timestamptz;
begin
  select brand_org_id into owner_org from public.rfqs where id = target_rfq;
  if owner_org is null or not public.can_see_rfq(target_rfq) then
    return null;
  end if;

  select v.last_viewed_at into seen
    from public.rfq_views v
   where v.rfq_id = target_rfq and v.viewer_org_id = owner_org;

  return seen;
end;
$$;

revoke all on function public.rfq_last_brand_view(uuid) from public;
grant execute on function public.rfq_last_brand_view(uuid) to authenticated;
