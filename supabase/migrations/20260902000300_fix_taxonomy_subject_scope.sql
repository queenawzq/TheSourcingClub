-- ============================================================================
-- 014  Scope the match helpers by subject, not by org
-- ----------------------------------------------------------------------------
-- `taxonomy_overlap_share()` and `certification_coverage()` from migration 006
-- filter `taxonomy_links.org_id` rather than `subject_id`:
--
--     where l.subject_type = required_subject
--       and l.org_id = required_org        -- wrong as soon as the subject
--                                          -- is not the org itself
--
-- That is correct for `brand_profile` and `factory_profile`, where subject_id
-- and org_id are the same value — true for all 40 rows in the table today.
--
-- It stops being true the moment RFQs exist. One brand has many RFQs, all
-- sharing an org_id, so an RFQ-scoped score would silently union the
-- requirements of EVERY RFQ that brand ever posted and return a plausible
-- wrong number. No error, no empty result — just a score that is quietly not
-- about the request you asked about.
--
-- Fixed before Phase 2 adds the first row that would trigger it.
--
-- The parameters are renamed from `*_org` to `*_subject_id` so a call site
-- passing an org id where a subject id belongs reads as obviously wrong. For
-- profiles the two are the same value, so every existing caller stays correct.
--
-- Note these two functions are deliberately NOT security definer: they run
-- under the caller's row level security, so a factory scoring itself against
-- an RFQ only sees terms it is allowed to read. That is the intended
-- behaviour, and it is why migration 016 adds a read policy for RFQ links —
-- without it the helper returns a low score rather than an error, which is
-- much harder to notice.
-- ============================================================================

drop function if exists public.taxonomy_overlap_share(
  public.taxonomy_subject, uuid, public.taxonomy_subject, uuid, text);

create function public.taxonomy_overlap_share(
  required_subject    public.taxonomy_subject,
  required_subject_id uuid,
  offered_subject     public.taxonomy_subject,
  offered_subject_id  uuid,
  term_kind           text
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
      and l.subject_id = required_subject_id
      and t.kind = term_kind
  ),
  offered as (
    select l.term_id
    from public.taxonomy_links l
    join public.taxonomy_terms t on t.id = l.term_id
    where l.subject_type = offered_subject
      and l.subject_id = offered_subject_id
      and t.kind = term_kind
  )
  select case
    when (select count(*) from required) = 0 then null
    else (select count(*) from required r where r.term_id in (select term_id from offered))::numeric
       / (select count(*) from required)::numeric
  end;
$$;

drop function if exists public.certification_coverage(
  public.taxonomy_subject, uuid, uuid);

create function public.certification_coverage(
  required_subject    public.taxonomy_subject,
  required_subject_id uuid,
  factory_org         uuid
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
      and l.subject_id = required_subject_id
      and t.kind = 'certification'
  ),
  -- Subset test against VERIFIED certifications only: a factory holding nine
  -- irrelevant certificates must not outrank one holding the required two.
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
-- match_score is unchanged in behaviour: for a brand profile the subject id
-- IS the org id, so passing brand_org as the subject is the same value it
-- passed before. Recreated only so the call sites name the new parameters.
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
        if exists (
          select 1 from public.taxonomy_links l
          join public.taxonomy_terms t on t.id = l.term_id
          where l.subject_type = 'brand_profile'
            and l.subject_id = brand_org
            and t.kind = 'region'
        ) then
          share := case when exists (
            select 1 from public.taxonomy_links l
            join public.taxonomy_terms t on t.id = l.term_id
            where l.subject_type = 'brand_profile'
              and l.subject_id = brand_org
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

grant execute on function public.match_score(uuid, uuid, integer, date) to authenticated;
grant execute on function public.taxonomy_overlap_share(
  public.taxonomy_subject, uuid, public.taxonomy_subject, uuid, text) to authenticated;
grant execute on function public.certification_coverage(
  public.taxonomy_subject, uuid, uuid) to authenticated;
