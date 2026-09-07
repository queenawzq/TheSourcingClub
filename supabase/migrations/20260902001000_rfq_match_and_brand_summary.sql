-- ============================================================================
-- 021  RFQ-scoped matching, and what a factory may learn about a brand
-- ============================================================================

-- ---------------------------------------------------------------------------
-- match_score_rfq
-- ---------------------------------------------------------------------------
-- Mirrors match_score() with the required side switched from the brand's
-- general profile to this specific request. That distinction matters: a brand
-- that mostly makes woven shirts might post one RFQ for knitwear, and scoring
-- that request against the brand's profile would quietly rank the wrong
-- factories highly.
--
-- Reuses the same helpers and the same match_weights table, so there is one
-- tuning knob rather than two that can drift apart.
--
-- RFQs carry no production_type link — brands pick that per profile, not per
-- request — so that factor evaluates to null and drops out through the
-- existing renormalisation. No special case needed.
-- ---------------------------------------------------------------------------

create or replace function public.match_score_rfq(
  rfq_id      uuid,
  factory_org uuid
)
returns numeric
language plpgsql
stable
as $$
declare
  w            record;
  total_weight numeric := 0;
  earned       numeric := 0;
  share        numeric;
  r            public.rfqs;
  factory      public.factory_profiles;
  cap_level    public.capacity_level;
begin
  select * into r from public.rfqs where id = rfq_id;
  if not found then
    return null;
  end if;

  select * into factory from public.factory_profiles where org_id = factory_org;
  if not found then
    return null;
  end if;

  for w in select factor, weight from public.match_weights loop
    share := null;

    case w.factor
      when 'production_type' then
        share := public.taxonomy_overlap_share(
          'rfq', rfq_id, 'factory_profile', factory_org, 'production_type');

      when 'product_category' then
        share := public.taxonomy_overlap_share(
          'rfq', rfq_id, 'factory_profile', factory_org, 'product_category');

      when 'region' then
        if exists (
          select 1 from public.taxonomy_links l
          join public.taxonomy_terms t on t.id = l.term_id
          where l.subject_type = 'rfq' and l.subject_id = rfq_id and t.kind = 'region'
        ) then
          share := case when exists (
            select 1 from public.taxonomy_links l
            join public.taxonomy_terms t on t.id = l.term_id
            where l.subject_type = 'rfq'
              and l.subject_id = rfq_id
              and t.kind = 'region'
              and factory.country_code is not null
              and factory.country_code = any (
                select jsonb_array_elements_text(coalesce(t.extra -> 'countries', '[]'::jsonb))
              )
          ) then 1 else 0 end;
        end if;

      when 'certification' then
        share := public.certification_coverage('rfq', rfq_id, factory_org);

      when 'moq' then
        if r.quantity_total is not null and factory.moq is not null then
          share := case when factory.moq <= r.quantity_total then 1 else 0 end;
        end if;

      when 'capacity' then
        if r.target_delivery_month is not null then
          select m.level into cap_level
          from public.factory_capacity_months m
          where m.org_id = factory_org and m.month = r.target_delivery_month;

          if found then
            share := case cap_level
              when 'open'    then 1.0
              when 'partial' then 0.5
              when 'full'    then 0.0
            end;
          end if;
        end if;

      else
        share := null;
    end case;

    if share is not null then
      total_weight := total_weight + w.weight;
      earned       := earned + (w.weight * share);
    end if;
  end loop;

  if total_weight = 0 then
    return null;
  end if;

  return round(earned / total_weight, 4);
end;
$$;

grant execute on function public.match_score_rfq(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- brand_summary_for_factory
-- ---------------------------------------------------------------------------
-- Row level security decides which ROWS a caller sees; it cannot redact
-- columns. So `brand_profiles` stays locked to its own org exactly as Phase 1
-- left it, and a factory learns about a brand only through this function.
--
-- Four of the seven fields the design asks for return null, on purpose:
-- club_order_count, avg_response_hours, payment_verified and trust_band all
-- depend on orders, payments and messaging that do not exist until Phases 3
-- and 4. They are in the signature so adding them later is not a breaking
-- change, and they are null rather than fabricated because a plausible-looking
-- "$5k+ spent" that nothing computed is worse than an honest blank.
-- ---------------------------------------------------------------------------

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
    null::boolean,
    null::text
  from public.orgs o
  left join public.brand_profiles b on b.org_id = o.id
  where o.id = brand_org;
end;
$$;

revoke all on function public.brand_summary_for_factory(uuid) from public;
grant execute on function public.brand_summary_for_factory(uuid) to authenticated;
