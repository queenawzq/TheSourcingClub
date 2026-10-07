-- ============================================================================
-- 069  Reorder style: a brand repeats an order as a new draft request
-- ----------------------------------------------------------------------------
-- The brand's order card offers "Reorder style", and nothing behind it could
-- start the next order. An order is always the award of a quote, so a repeat
-- starts where the first one did: a request. This copies the order's request
-- into a new DRAFT, which the brand reads back in the composer and sends to
-- the same factory for a fresh quote.
--
-- Nothing here changes an existing table's rows or an existing function: one
-- new nullable column and one new function.
-- ============================================================================

-- Which order a draft repeats, so a reorder resumed from the requests list
-- still knows its factory.
--
-- No foreign key, on purpose. A key to production_orders would be a second
-- path between rfqs and production_orders (orders already point at their
-- request), and PostgREST refuses an embed with two paths rather than guess.
-- `rfqs (title, brief)` on the order list would stop loading — on the site
-- that is live when this runs, too.
--
-- A member may set it on their own draft like any other column. Pointing it
-- at an order that is not theirs shows them nothing: the composer reads the
-- order under RLS, and an order they are not a party to is not there.
alter table public.rfqs
  add column if not exists reorder_of_order_id uuid;

comment on column public.rfqs.reorder_of_order_id is
  'The production order this request repeats (set by duplicate_rfq_from_order). No foreign key: see migration 069.';

-- ---------------------------------------------------------------------------
-- duplicate_rfq_from_order
-- ---------------------------------------------------------------------------
-- Runs as the caller, so RLS decides everything it reads and writes, and every
-- write is one a brand member can already make from the composer. It is a
-- function only so the copy is one transaction: a half-copied draft would sit
-- in the brand's list looking like the real thing.
--
-- Copied: what the brand asked for (brief, quantities, notes, price band, who
-- sources what), its colour breakdown, its questions and its category,
-- certification and region links.
-- Not copied: the delivery month and the quote deadline, which belong to the
-- last run and are most likely past; invitations, which a draft may not have
-- (the composer invites on publish); quotes and every stamp.
create or replace function public.duplicate_rfq_from_order(target_order uuid)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  o       public.production_orders;
  new_id  uuid;
begin
  select * into o from public.production_orders where id = target_order;

  -- The factory is a party to the order and can read it, but the request is
  -- the brand's. An unknown id, an order the caller cannot see and the
  -- factory's own call all get the same answer.
  if o.id is null or not public.is_org_member(o.brand_org_id) then
    raise exception 'only the brand on this order can reorder it'
      using errcode = '42501';
  end if;

  insert into public.rfqs (
    brand_org_id, title, brief, status, visibility,
    quantity_total, material_notes, sourcing_responsibility_term_id,
    requires_sample, sample_notes,
    target_unit_price_min_cents, target_unit_price_max_cents, currency,
    additional_details, created_by, reorder_of_order_id
  )
  select r.brand_org_id,
         coalesce(nullif(btrim(r.title), '') || ' (reorder)', 'Reorder'),
         r.brief, 'draft', 'invited_only',
         r.quantity_total, r.material_notes, r.sourcing_responsibility_term_id,
         r.requires_sample, r.sample_notes,
         r.target_unit_price_min_cents, r.target_unit_price_max_cents, r.currency,
         r.additional_details, auth.uid(), o.id
    from public.rfqs r
   where r.id = o.rfq_id
  returning id into new_id;

  insert into public.rfq_colour_splits (rfq_id, colour, quantity, sort)
  select new_id, colour, quantity, sort
    from public.rfq_colour_splits
   where rfq_id = o.rfq_id;

  insert into public.rfq_questions (rfq_id, prompt, is_sensitive, sort)
  select new_id, prompt, is_sensitive, sort
    from public.rfq_questions
   where rfq_id = o.rfq_id;

  insert into public.taxonomy_links (subject_type, subject_id, term_id, org_id)
  select 'rfq', new_id, term_id, org_id
    from public.taxonomy_links
   where subject_type = 'rfq' and subject_id = o.rfq_id;

  return new_id;
end;
$$;

revoke all on function public.duplicate_rfq_from_order(uuid) from public, anon;
grant execute on function public.duplicate_rfq_from_order(uuid) to authenticated;
