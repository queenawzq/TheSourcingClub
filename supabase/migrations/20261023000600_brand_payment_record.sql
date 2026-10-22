-- ============================================================================
-- A brand's payment record, as a factory sees it
-- ----------------------------------------------------------------------------
-- brand_summary_for_factory (20260902001000), same signature and grants.
-- payment_verified was null until payments existed, so every brand read
-- "Payment status: Not verified" to every factory, which says something
-- about the brand that nothing checked. Payments are held by TSC through
-- Stripe now, so there is something true to say: the brand has funded at
-- least one step through TSC (held, or paid out). It says nothing about
-- amounts, or which orders.
--
-- Safe with the current site live: a replace with the same return type.
-- ============================================================================

create or replace function public.brand_summary_for_factory(brand_org uuid)
returns table (
  org_id             uuid,
  name               text,
  hq_location        text,
  verified           boolean,
  club_order_count   integer,
  avg_response_hours numeric,
  payment_verified   boolean,
  trust_band         text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  -- Same eligibility test as the RFQ read policy: a factory may learn about a
  -- brand only through a request it can legitimately see.
  if not exists (
    select 1 from public.rfqs r
    where r.brand_org_id = brand_org
      and public.can_see_rfq(r.id)
  ) then
    raise exception 'no visibility into this brand' using errcode = '42501';
  end if;

  return query
  select
    o.id,
    o.name,
    b.hq_location,
    b.verification_status = 'verified',
    null::integer,
    null::numeric,
    exists (
      select 1
      from public.order_payments p
      join public.production_orders po on po.id = p.order_id
      where po.brand_org_id = o.id
        and p.state in ('confirmed', 'released')
    ),
    null::text
  from public.orgs o
  left join public.brand_profiles b on b.org_id = o.id
  where o.id = brand_org;
end;
$$;

revoke all on function public.brand_summary_for_factory(uuid) from public;
grant execute on function public.brand_summary_for_factory(uuid) to authenticated;
