-- ============================================================================
-- 068  Order archive: a company puts its finished orders out of the way
-- ----------------------------------------------------------------------------
-- Both designed order lists offer "Archive order" in a card's "…" menu, and
-- nothing could archive anything, so a company's Closed tab only ever grew.
--
-- An archive belongs to a COMPANY, the same as its tabs: every member sees the
-- same archive, and the other side of the order keeps its own. A brand putting
-- an order away says nothing to the factory, and changes nothing for it.
--
-- Only a closed order (completed or cancelled) can be archived. Neither state
-- ever reopens, so nothing has to undo an archive when an order moves.
--
-- Nothing here changes an existing table or function.
-- ============================================================================

-- A plain table write, like order_tab_orders: one row in or out is the whole
-- act. An archived order keeps its tab filing; the screens leave it out of its
-- tabs while it is archived, and unarchiving puts it back where it was.
create table public.order_archives (
  org_id      uuid not null references public.orgs (id) on delete cascade,
  order_id    uuid not null references public.production_orders (id) on delete cascade,
  archived_by uuid references auth.users (id) on delete set null default auth.uid(),
  archived_at timestamptz not null default now(),

  primary key (org_id, order_id)
);

create index order_archives_order_idx on public.order_archives (order_id);

alter table public.order_archives enable row level security;

create policy order_archives_read on public.order_archives
  for select to authenticated
  using (public.is_org_member(org_id));

-- The company archiving has to be a party to the order, the same rule as
-- filing it in a tab: someone in both a brand and an unrelated factory is a
-- party through the brand, and could otherwise archive under the factory.
create policy order_archives_add on public.order_archives
  for insert to authenticated
  with check (
    archived_by = auth.uid()
    and public.is_org_member(org_id)
    and org_id in (public.order_brand_org(order_id), public.order_factory_org(order_id))
    and public.order_status_of(order_id) in ('completed', 'cancelled')
  );

create policy order_archives_remove on public.order_archives
  for delete to authenticated
  using (public.is_org_member(org_id));

-- The default privileges give `authenticated` every write on a new table.
-- There is nothing to update: an order is archived or it is not.
revoke update, truncate on public.order_archives from authenticated;
grant select, insert, delete on public.order_archives to authenticated;
