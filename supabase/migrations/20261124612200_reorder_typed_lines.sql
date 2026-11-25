-- Reorder style carries the brand's own words for the category, timeline,
-- price, regions and certifications (20261124607100, 20261124612100).
--
-- duplicate_rfq_from_order() copied the request's parsed values and links but
-- not the typed lines beside them, so a reorder came back with taxonomy labels
-- ("Uniforms / workwear, Womenswear, Menswear") where the brand had written
-- "Menswear & womenswear / linen workwear", and "China" for "China, Vietnam".
--
-- Same signature, security (invoker: RLS decides), search_path and grants as
-- 20261022000600; only the five columns are added. The delivery month is
-- still not copied: the composer shows a typed timeline only while it reads
-- as the stored month, so a dated line stays blank for the brand to set again,
-- and an undated one ("8 weeks after PP approval") comes back as written.

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
    additional_details, created_by, reorder_of_order_id,
    product_type, timeline_text, price_text, regions_text, certifications_text
  )
  select r.brand_org_id,
         coalesce(nullif(btrim(r.title), '') || ' (reorder)', 'Reorder'),
         r.brief, 'draft', 'invited_only',
         r.quantity_total, r.material_notes, r.sourcing_responsibility_term_id,
         r.sourcing_details, r.requires_sample, r.sample_notes,
         r.target_unit_price_min_cents, r.target_unit_price_max_cents, r.currency,
         r.additional_details, auth.uid(), o.id,
         r.product_type, r.timeline_text, r.price_text, r.regions_text, r.certifications_text
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
