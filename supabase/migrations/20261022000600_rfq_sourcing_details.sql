-- Keep the sourcing-specific explanation separate from general RFQ notes.
-- The composer previously joined both textareas with a blank line, which
-- meant every downstream screen had to present two different ideas as one.

alter table public.rfqs
  add column if not exists sourcing_details text;

-- Existing rows written by that composer used this exact order:
-- additional details, two newlines, sourcing details. Split only rows with
-- the delimiter; a single legacy value remains general additional detail
-- because its original field cannot be inferred safely.
with combined as (
  select id,
         position(E'\n\n' in additional_details) as divider,
         additional_details
    from public.rfqs
   where position(E'\n\n' in additional_details) > 0
     and sourcing_details is null
)
update public.rfqs r
   set additional_details = nullif(btrim(left(c.additional_details, c.divider - 1)), ''),
       sourcing_details = nullif(btrim(substr(c.additional_details, c.divider + 2)), '')
  from combined c
 where r.id = c.id;

-- Reorders carry both kinds of notes into the new private draft.
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

  if o.id is null or not public.is_org_member(o.brand_org_id) then
    raise exception 'only the brand on this order can reorder it'
      using errcode = '42501';
  end if;

  insert into public.rfqs (
    brand_org_id, title, brief, status, visibility,
    quantity_total, material_notes, sourcing_responsibility_term_id,
    sourcing_details, requires_sample, sample_notes,
    target_unit_price_min_cents, target_unit_price_max_cents, currency,
    additional_details, created_by, reorder_of_order_id
  )
  select r.brand_org_id,
         coalesce(nullif(btrim(r.title), '') || ' (reorder)', 'Reorder'),
         r.brief, 'draft', 'invited_only',
         r.quantity_total, r.material_notes, r.sourcing_responsibility_term_id,
         r.sourcing_details, r.requires_sample, r.sample_notes,
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
