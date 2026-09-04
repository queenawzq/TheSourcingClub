-- ============================================================================
-- 006  Match score
-- ----------------------------------------------------------------------------
-- The prototypes show a match percentage on every factory card and quote, with
-- the number hardcoded per factory. This makes it real, deterministic, and
-- explainable: a weighted overlap computed in SQL, with the weights held in a
-- table so they can be tuned without a deploy.
--
-- Two properties worth preserving if this is ever changed:
--
--   * Certification is a SUBSET test, not an overlap. A factory holding nine
--     irrelevant certificates must not outrank one holding the required two.
--
--   * Factors the brand left unspecified are EXCLUDED and the remaining
--     weights renormalised, rather than scored as a free full mark. A brand
--     that named no preferred region should not make every factory look like
--     a regional match.
--
-- Tiers reuse the thresholds already written into TSC_DESIGN_SYSTEM.md, so the
-- colour a card is painted keeps meaning what the design system says it means.
-- ============================================================================

create table public.match_weights (
  factor      text primary key,
  weight      numeric not null check (weight >= 0 and weight <= 1),
  description text,
  updated_at  timestamptz not null default now()
);

insert into public.match_weights (factor, weight, description) values
  ('production_type',  0.30, 'Share of the brand''s production types the factory covers'),
  ('product_category', 0.20, 'Share of the brand''s product categories the factory covers'),
  ('region',           0.15, 'Factory sits in one of the brand''s preferred regions'),
  ('certification',    0.15, 'Factory holds every certification the brand requires, verified'),
  ('moq',              0.10, 'Factory MOQ fits the order quantity'),
  ('capacity',         0.10, 'Factory has capacity open in the delivery month')
on conflict (factor) do nothing;

alter table public.match_weights enable row level security;

create policy match_weights_read on public.match_weights
  for select to authenticated using (true);

grant select on public.match_weights to authenticated;

-- ---------------------------------------------------------------------------
-- Helper: the share of one org's terms of a given kind that another covers
-- ---------------------------------------------------------------------------
-- Returns null when the requiring side specified nothing, which is the signal
-- to drop that factor from the weighting rather than score it.
-- ---------------------------------------------------------------------------

create or replace function public.taxonomy_overlap_share(
  required_subject public.taxonomy_subject,
  required_org     uuid,
  offered_subject  public.taxonomy_subject,
  offered_org      uuid,
  term_kind        text
)
returns numeric
language sql
stable
as $$
  with required as (
    select l.term_id
    from public.taxonomy_links l
    join public.taxonomy_terms t on t.id = l.term_id
    where l.subject_type = required_subject
      and l.org_id = required_org
      and t.kind = term_kind
  ),
  offered as (
    select l.term_id
    from public.taxonomy_links l
    join public.taxonomy_terms t on t.id = l.term_id
    where l.subject_type = offered_subject
      and l.org_id = offered_org
      and t.kind = term_kind
  )
  select case
    when (select count(*) from required) = 0 then null
    else (select count(*) from required r where r.term_id in (select term_id from offered))::numeric
       / (select count(*) from required)::numeric
  end;
$$;

-- ---------------------------------------------------------------------------
-- Certification coverage — subset test against VERIFIED certifications only
-- ---------------------------------------------------------------------------

create or replace function public.certification_coverage(
  required_subject public.taxonomy_subject,
  required_org     uuid,
  factory_org      uuid
)
returns numeric
language sql
stable
as $$
  with required as (
    select l.term_id
    from public.taxonomy_links l
    join public.taxonomy_terms t on t.id = l.term_id
    where l.subject_type = required_subject
      and l.org_id = required_org
      and t.kind = 'certification'
  ),
  held as (
    select c.term_id
    from public.factory_certifications c
    where c.org_id = factory_org
      and c.status = 'verified'
  )
  select case
    when (select count(*) from required) = 0 then null
    else (select count(*) from required r where r.term_id in (select term_id from held))::numeric
       / (select count(*) from required)::numeric
  end;
$$;

-- ---------------------------------------------------------------------------
-- match_score
-- ---------------------------------------------------------------------------
-- Scores a factory against a brand's stated profile. Phase 2 adds a sibling
-- that scores against a specific RFQ, reusing every helper above.
--
-- quantity and target_month are optional: pass them when scoring in the
-- context of a real order, omit them when browsing.
-- ---------------------------------------------------------------------------

create or replace function public.match_score(
  brand_org    uuid,
  factory_org  uuid,
  quantity     integer default null,
  target_month date    default null
)
returns numeric
language plpgsql
stable
as $$
declare
  w             record;
  total_weight  numeric := 0;
  earned        numeric := 0;
  share         numeric;
  factory       public.factory_profiles;
  cap_level     public.capacity_level;
begin
  select * into factory from public.factory_profiles where org_id = factory_org;
  if not found then
    return null;
  end if;

  for w in select factor, weight from public.match_weights loop
    share := null;

    case w.factor
      when 'production_type' then
        share := public.taxonomy_overlap_share(
          'brand_profile', brand_org, 'factory_profile', factory_org, 'production_type');

      when 'product_category' then
        share := public.taxonomy_overlap_share(
          'brand_profile', brand_org, 'factory_profile', factory_org, 'product_category');

      when 'region' then
        -- The brand's preferred regions are terms; the factory's country is a
        -- column. A region term carries its country codes in extra.countries.
        if exists (
          select 1 from public.taxonomy_links l
          join public.taxonomy_terms t on t.id = l.term_id
          where l.subject_type = 'brand_profile'
            and l.org_id = brand_org
            and t.kind = 'region'
        ) then
          share := case when exists (
            select 1 from public.taxonomy_links l
            join public.taxonomy_terms t on t.id = l.term_id
            where l.subject_type = 'brand_profile'
              and l.org_id = brand_org
              and t.kind = 'region'
              and factory.country_code is not null
              and factory.country_code = any (
                select jsonb_array_elements_text(coalesce(t.extra -> 'countries', '[]'::jsonb))
              )
          ) then 1 else 0 end;
        end if;

      when 'certification' then
        share := public.certification_coverage('brand_profile', brand_org, factory_org);

      when 'moq' then
        if quantity is not null and factory.moq is not null then
          share := case when factory.moq <= quantity then 1 else 0 end;
        end if;

      when 'capacity' then
        if target_month is not null then
          select m.level into cap_level
          from public.factory_capacity_months m
          where m.org_id = factory_org
            and m.month = date_trunc('month', target_month)::date;

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

    -- Null means this factor does not discriminate here; drop it entirely so
    -- the remaining weights renormalise across what we actually know.
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

-- ---------------------------------------------------------------------------
-- Tier labels — the thresholds from TSC_DESIGN_SYSTEM.md
-- ---------------------------------------------------------------------------

create type public.match_tier as enum ('strong', 'good', 'potential', 'weak');

create or replace function public.match_tier(score numeric)
returns public.match_tier
language sql
immutable
as $$
  select case
    when score is null then null
    when score >= 0.90 then 'strong'::public.match_tier
    when score >= 0.75 then 'good'::public.match_tier
    when score >= 0.60 then 'potential'::public.match_tier
    else 'weak'::public.match_tier
  end;
$$;

grant execute on function public.match_score(uuid, uuid, integer, date) to authenticated;
grant execute on function public.match_tier(numeric)                    to authenticated;
grant execute on function public.taxonomy_overlap_share(
  public.taxonomy_subject, uuid, public.taxonomy_subject, uuid, text)   to authenticated;
grant execute on function public.certification_coverage(
  public.taxonomy_subject, uuid, uuid)                                  to authenticated;
