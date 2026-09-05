-- ============================================================================
-- 028  Milestone updates, and the document links that go with them
-- ----------------------------------------------------------------------------
-- The factory's only lever on a running order. It does not mark work complete
-- and it does not request payment; it posts what it has done, with photos, and
-- the brand decides. Both prototypes agree on that, and it is the right shape:
-- the party that benefits from a step being finished should not be the party
-- that declares it finished.
--
-- Two policies here are load-bearing in opposite directions, and BOTH of them
-- fail silently if wrong:
--
--   documents_order_party_read  — without it the brand's photo gallery is
--   empty, with no error, on the screen the whole feature exists for. A
--   factory's photo has org_id = the factory, and documents_own keys on
--   org_id, so the brand is simply not in it.
--
--   documents_link_guard — without it, documents_own is `for all` with a
--   with-check that says nothing about the link columns, so a factory can
--   run `update documents set milestone_update_id = <another order's update>`
--   and the read policy above then serves that document to a third party.
--   Read amplification out of one UPDATE, no error, no log.
-- ============================================================================

create table public.milestone_updates (
  id           uuid primary key default gen_random_uuid(),
  milestone_id uuid not null references public.order_milestones (id) on delete cascade,

  -- Denormalised, and set by the trigger below rather than by the caller. The
  -- common read is "every update on this order", and a per-row definer call in
  -- the policy is the shape that has been slow elsewhere in this schema.
  order_id     uuid not null references public.production_orders (id) on delete cascade,

  -- The factory today. The column exists so a brand-side reply is additive
  -- later rather than a migration; post_milestone_update forces it for now.
  author_org_id uuid not null references public.orgs (id),

  body       text not null check (length(btrim(body)) > 0),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index milestone_updates_milestone_idx on public.milestone_updates (milestone_id, created_at desc);
create index milestone_updates_order_idx     on public.milestone_updates (order_id, created_at desc);

create or replace function public.milestone_updates_set_order()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.order_id := public.milestone_order(new.milestone_id);
  if new.order_id is null then
    raise exception 'that milestone does not exist' using errcode = 'P0002';
  end if;
  return new;
end;
$$;

create trigger milestone_updates_order_stamp
  before insert on public.milestone_updates
  for each row execute function public.milestone_updates_set_order();

create or replace function public.milestone_update_order(target_update uuid)
returns uuid
language sql stable security definer
set search_path = public, pg_temp
as $$ select order_id from public.milestone_updates where id = target_update; $$;

revoke all on function public.milestone_update_order(uuid) from public;
grant execute on function public.milestone_update_order(uuid) to authenticated;

alter table public.milestone_updates enable row level security;

-- is_order_party, NOT is_org_member(author_org_id). The latter is this
-- project's signature bug — a helper keyed on the wrong id — and here it would
-- show the factory its own posts, look completely correct from the side that
-- wrote them, and show the brand nothing at all.
create policy milestone_updates_read on public.milestone_updates
  for select to authenticated
  using (public.is_order_party(order_id) or public.is_platform_admin());

grant select on public.milestone_updates to authenticated;

-- ---------------------------------------------------------------------------
-- documents gains its order links
-- ---------------------------------------------------------------------------

alter table public.documents
  add column milestone_update_id uuid references public.milestone_updates (id) on delete set null,
  add column order_id uuid references public.production_orders (id) on delete set null;

create index documents_milestone_update_idx on public.documents (milestone_update_id)
  where milestone_update_id is not null;
create index documents_order_idx on public.documents (order_id)
  where order_id is not null;

-- The counterparty read. Both branches are needed: photos hang off an update,
-- the signed contract hangs off the order.
create policy documents_order_party_read on public.documents
  for select to authenticated
  using (
    (milestone_update_id is not null
      and public.is_order_party(public.milestone_update_order(milestone_update_id)))
    or (order_id is not null and public.is_order_party(order_id))
  );

-- The guard. documents_own is `for all`, so without this the link columns are
-- freely writable by the document's owner to point anywhere.
create or replace function public.documents_link_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.milestone_update_id is not null
     and new.milestone_update_id is distinct from old.milestone_update_id
     and not public.is_order_party(public.milestone_update_order(new.milestone_update_id))
  then
    raise exception 'you cannot attach a file to an order you are not part of'
      using errcode = '42501';
  end if;

  if new.order_id is not null
     and new.order_id is distinct from old.order_id
     and not public.is_order_party(new.order_id)
  then
    raise exception 'you cannot attach a file to an order you are not part of'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- Separate triggers so the INSERT case has no OLD row to compare against.
create trigger documents_link_guard_insert
  before insert on public.documents
  for each row
  when (new.milestone_update_id is not null or new.order_id is not null)
  execute function public.documents_link_guard();

create trigger documents_link_guard_update
  before update on public.documents
  for each row execute function public.documents_link_guard();

-- ---------------------------------------------------------------------------
-- Storage: the counterparty needs to read the object, not just its metadata
-- ---------------------------------------------------------------------------
-- With only the documents policy above, urlFor() cheerfully mints a signed URL
-- and the fetch behind it 400s. The symptom is a broken image tile, not an
-- error message, which is the worst of both outcomes.
--
-- uploadDocument writes milestone photos to {org}/{kind}/{order}/{file}, so
-- the third path segment is the order id and is_order_party can be asked
-- directly about it.
-- ---------------------------------------------------------------------------

create or replace function public.storage_path_scope(object_name text)
returns uuid
language sql
immutable
as $$
  select nullif(split_part(object_name, '/', 3), '')::uuid;
$$;

create policy "order party private read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'org-private'
    and split_part(name, '/', 2) = 'milestone_update'
    and public.is_order_party(public.storage_path_scope(name))
  );

-- Phones share HEIC and the allowlist refuses it, with nothing the person can
-- act on. Admitting the real type is the fix; relabelling it as JPEG would
-- store an object no browser can render, which is worse and harder to notice.
update storage.buckets
   set allowed_mime_types = allowed_mime_types || array['image/heic', 'image/heif']
 where id = 'org-private';
