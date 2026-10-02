-- ============================================================================
-- 066  Order tabs: a company's own groupings of its production orders
-- ----------------------------------------------------------------------------
-- Both designed order lists draw "Active orders", "Closed", "+ Add tab", a
-- "Manage tabs" window (rename, Up/Down, Delete) and, on each card, "Add to ›
-- <tab>". All of it lived in React state: a reload lost every tab, and no
-- order was ever put in one.
--
-- A tab belongs to a COMPANY, not a person, the same as saved requests: every
-- member sees and edits the same tabs, and the other side of an order never
-- learns how it was filed.
--
-- Active and Closed are rows too, so they can be renamed and moved like the
-- design allows, but never deleted. They are created lazily, by the first add
-- or save; a company with no rows is shown the defaults, and reading never
-- writes.
--
-- Nothing here changes an existing table or function.
-- ============================================================================

create table public.order_tabs (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.orgs (id) on delete cascade,
  kind       text not null check (kind in ('active', 'closed', 'custom')),
  label      text not null check (char_length(btrim(label)) between 1 and 40),
  sort       integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One Active and one Closed per company; any number of custom tabs.
create unique index order_tabs_one_default on public.order_tabs (org_id, kind)
  where kind <> 'custom';

-- Two tabs a person cannot tell apart are one tab too many.
create unique index order_tabs_label_unique on public.order_tabs (org_id, lower(label));

create trigger order_tabs_touch before update on public.order_tabs
  for each row execute function public.touch_updated_at();

alter table public.order_tabs enable row level security;

create policy order_tabs_read on public.order_tabs
  for select to authenticated
  using (public.is_org_member(org_id));

-- The default privileges give `authenticated` every write on a new table, so
-- `grant select` alone narrows nothing. The two functions below own every
-- write: a rename, a reorder and a delete arrive as one save, and the save has
-- to see the whole list to keep Active and Closed in it.
revoke insert, update, delete, truncate on public.order_tabs from authenticated;
grant select on public.order_tabs to authenticated;

-- ---------------------------------------------------------------------------
-- Which orders are in which tab
-- ---------------------------------------------------------------------------
-- A plain table write, like saved_rfqs: one row in or out is the whole act.
create table public.order_tab_orders (
  tab_id     uuid not null references public.order_tabs (id) on delete cascade,
  order_id   uuid not null references public.production_orders (id) on delete cascade,
  added_by   uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),

  primary key (tab_id, order_id)
);

create index order_tab_orders_order_idx on public.order_tab_orders (order_id);

alter table public.order_tab_orders enable row level security;

create policy order_tab_orders_read on public.order_tab_orders
  for select to authenticated
  using (exists (
    select 1 from public.order_tabs t
    where t.id = tab_id and public.is_org_member(t.org_id)
  ));

-- The TAB's company has to be a party to the order. is_order_party() is not
-- enough: someone who belongs to both a brand and an unrelated factory is a
-- party through the brand, and could otherwise file the order under the
-- factory's tabs.
create policy order_tab_orders_add on public.order_tab_orders
  for insert to authenticated
  with check (
    added_by = auth.uid()
    and exists (
      select 1 from public.order_tabs t
      where t.id = tab_id
        and public.is_org_member(t.org_id)
        and t.org_id in (public.order_brand_org(order_id), public.order_factory_org(order_id))
    )
  );

create policy order_tab_orders_remove on public.order_tab_orders
  for delete to authenticated
  using (exists (
    select 1 from public.order_tabs t
    where t.id = tab_id and public.is_org_member(t.org_id)
  ));

revoke update, truncate on public.order_tab_orders from authenticated;
grant select, insert, delete on public.order_tab_orders to authenticated;

-- ---------------------------------------------------------------------------
-- The defaults, written the first time a company changes anything
-- ---------------------------------------------------------------------------
create or replace function public.ensure_default_order_tabs(target_org uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.order_tabs (org_id, kind, label, sort)
  select target_org, d.kind, d.label, d.sort
  from (values ('active', 'Active orders', 10), ('closed', 'Closed', 20)) as d (kind, label, sort)
  where not exists (
    select 1 from public.order_tabs t where t.org_id = target_org and t.kind = d.kind
  );
$$;

-- Internal to the two functions below; nobody calls it from the browser.
revoke all on function public.ensure_default_order_tabs(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- save_order_tabs: the "Manage tabs" window's Save changes
-- ---------------------------------------------------------------------------
-- Takes the whole list in display order: [{ "id"?, "kind", "label" }, ...].
-- A custom tab with no id is new; an existing custom tab missing from the list
-- is deleted, and the orders in it leave with it. Active and Closed must each
-- appear exactly once, matched by kind, so they can be renamed and moved but
-- never removed.
--
-- Everything is validated before anything is written.
-- ---------------------------------------------------------------------------
create or replace function public.save_order_tabs(target_org uuid, tabs jsonb)
returns setof public.order_tabs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  item        jsonb;
  idx         integer := 0;
  tab_id      uuid;
  tab_kind    text;
  tab_label   text;
  existing    public.order_tabs;
  seen_ids    uuid[] := '{}';
  seen_labels text[] := '{}';
  n_active    integer := 0;
  n_closed    integer := 0;
  n_custom    integer := 0;
begin
  -- First, before any read, so a company that does not exist and one the
  -- caller does not belong to are refused the same way.
  if not public.is_org_member(target_org) then
    raise exception 'only members of this company can change its order tabs'
      using errcode = '42501';
  end if;

  -- One change to a company's tabs at a time, so two teammates saving at once
  -- cannot interleave a delete with a rename.
  perform pg_advisory_xact_lock(hashtextextended('order_tabs:' || target_org::text, 0));

  if jsonb_typeof(tabs) is distinct from 'array' then
    raise exception 'tabs must be a list' using errcode = '22023';
  end if;

  for item in select * from jsonb_array_elements(tabs) loop
    idx := idx + 1;
    if jsonb_typeof(item) <> 'object' then
      raise exception 'tab % is not a tab', idx using errcode = '22023';
    end if;

    tab_kind := item ->> 'kind';
    if tab_kind is null or tab_kind not in ('active', 'closed', 'custom') then
      raise exception 'tab % has no kind', idx using errcode = '22023';
    end if;

    tab_label := btrim(coalesce(item ->> 'label', ''));
    if char_length(tab_label) = 0 then
      raise exception 'tab % needs a name', idx using errcode = '22023';
    end if;
    if char_length(tab_label) > 40 then
      raise exception 'the tab name "%" is longer than 40 characters', tab_label using errcode = '22023';
    end if;
    if lower(tab_label) = any (seen_labels) then
      raise exception 'there are two tabs called "%"', tab_label using errcode = '22023';
    end if;
    seen_labels := seen_labels || lower(tab_label);

    if nullif(item ->> 'id', '') is not null then
      begin
        tab_id := (item ->> 'id')::uuid;
      exception when invalid_text_representation then
        raise exception 'the tab "%" is not one of this company''s tabs', tab_label using errcode = '22023';
      end;
      select * into existing from public.order_tabs where id = tab_id and org_id = target_org;
      if not found then
        raise exception 'the tab "%" is not one of this company''s tabs', tab_label using errcode = '22023';
      end if;
      if existing.kind <> tab_kind then
        raise exception 'the tab "%" cannot change kind', tab_label using errcode = '22023';
      end if;
      if tab_id = any (seen_ids) then
        raise exception 'the tab "%" is listed twice', tab_label using errcode = '22023';
      end if;
      seen_ids := seen_ids || tab_id;
    end if;

    case tab_kind
      when 'active' then n_active := n_active + 1;
      when 'closed' then n_closed := n_closed + 1;
      else n_custom := n_custom + 1;
    end case;
  end loop;

  if n_active <> 1 or n_closed <> 1 then
    raise exception 'the active and closed tabs must each appear once; they cannot be deleted'
      using errcode = '22023';
  end if;
  if n_custom > 20 then
    raise exception 'a company can have at most 20 custom tabs' using errcode = '22023';
  end if;

  perform public.ensure_default_order_tabs(target_org);

  delete from public.order_tabs
  where org_id = target_org and kind = 'custom' and id <> all (seen_ids);

  -- Park every name on the row's own id first, so swapping two names never
  -- trips order_tabs_label_unique halfway through.
  update public.order_tabs set label = id::text where org_id = target_org;

  idx := 0;
  for item in select * from jsonb_array_elements(tabs) loop
    idx := idx + 1;
    tab_kind := item ->> 'kind';
    tab_label := btrim(item ->> 'label');
    tab_id := nullif(item ->> 'id', '')::uuid;
    if tab_id is null and tab_kind <> 'custom' then
      select id into tab_id from public.order_tabs where org_id = target_org and kind = tab_kind;
    end if;

    if tab_id is null then
      insert into public.order_tabs (org_id, kind, label, sort)
      values (target_org, tab_kind, tab_label, idx * 10);
    else
      update public.order_tabs set label = tab_label, sort = idx * 10 where id = tab_id;
    end if;
  end loop;

  return query
    select * from public.order_tabs where org_id = target_org order by sort;
end;
$$;

revoke all on function public.save_order_tabs(uuid, jsonb) from public;
grant execute on function public.save_order_tabs(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- add_order_tab: the tab bar's "+ Add tab"
-- ---------------------------------------------------------------------------
-- Appends one tab. It exists apart from save_order_tabs so that adding a tab
-- never sends the whole list, which would delete a tab a teammate made since
-- the page loaded.
-- ---------------------------------------------------------------------------
create or replace function public.add_order_tab(target_org uuid, new_label text)
returns public.order_tabs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  tab_label text := btrim(coalesce(new_label, ''));
  created   public.order_tabs;
begin
  if not public.is_org_member(target_org) then
    raise exception 'only members of this company can change its order tabs'
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('order_tabs:' || target_org::text, 0));

  if char_length(tab_label) = 0 then
    raise exception 'a tab needs a name' using errcode = '22023';
  end if;
  if char_length(tab_label) > 40 then
    raise exception 'the tab name "%" is longer than 40 characters', tab_label using errcode = '22023';
  end if;

  perform public.ensure_default_order_tabs(target_org);

  if exists (
    select 1 from public.order_tabs where org_id = target_org and lower(label) = lower(tab_label)
  ) then
    raise exception 'there is already a tab called "%"', tab_label using errcode = '22023';
  end if;
  if (select count(*) from public.order_tabs where org_id = target_org and kind = 'custom') >= 20 then
    raise exception 'a company can have at most 20 custom tabs' using errcode = '22023';
  end if;

  insert into public.order_tabs (org_id, kind, label, sort)
  values (
    target_org, 'custom', tab_label,
    (select coalesce(max(sort), 0) + 10 from public.order_tabs where org_id = target_org)
  )
  returning * into created;

  return created;
end;
$$;

revoke all on function public.add_order_tab(uuid, text) from public;
grant execute on function public.add_order_tab(uuid, text) to authenticated;
