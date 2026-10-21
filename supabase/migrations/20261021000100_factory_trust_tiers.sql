-- A factory's marketplace badge is separate from profile approval.
-- Approval controls whether it may quote; this tier explains how much evidence
-- the Club has behind the company.
do $$ begin
  create type public.factory_trust_tier as enum ('basic', 'verified', 'trusted');
exception when duplicate_object then null;
end $$;

alter table public.factory_profiles
  add column if not exists trust_tier public.factory_trust_tier not null default 'basic';

-- The facts shown beside the admin's tier selector. Trusted is intentionally
-- strict: at least one completed Club order, every completed order on time,
-- and at least one completed order with a brand-approved step and visible
-- factory update evidence.
create or replace function public.admin_factory_tier_eligibility(target_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  current_tier          public.factory_trust_tier;
  has_walkthrough       boolean;
  completed_orders      integer;
  on_time_orders        integer;
  quality_history_orders integer;
begin
  if not public.is_platform_admin() then
    raise exception 'factory tier evidence is limited to platform staff' using errcode = '42501';
  end if;

  select f.trust_tier into current_tier
    from public.factory_profiles f where f.org_id = target_org;
  if current_tier is null then
    return null;
  end if;

  select exists (
    select 1 from public.documents d
     where d.org_id = target_org
       and d.kind = 'walkthrough'
       and d.status <> 'rejected'
       and coalesce(d.size_bytes, 0) > 0
  ) into has_walkthrough;

  select count(*)::integer into completed_orders
    from public.production_orders o
   where o.factory_org_id = target_org and o.status = 'completed';

  select count(*)::integer into on_time_orders
    from public.production_orders o
   where o.factory_org_id = target_org
     and o.status = 'completed'
     and exists (
       select 1 from public.order_milestones m
        where m.order_id = o.id and m.due_on is not null
     )
     and not exists (
       select 1 from public.order_milestones m
        where m.order_id = o.id
          and (m.due_on is null or m.completed_at is null or m.completed_at::date > m.due_on)
     );

  select count(*)::integer into quality_history_orders
    from public.production_orders o
   where o.factory_org_id = target_org
     and o.status = 'completed'
     and exists (
       select 1 from public.order_milestones m
        where m.order_id = o.id and m.approved_at is not null
     )
     and exists (
       select 1
         from public.milestone_updates u
        where u.order_id = o.id
          and u.author_org_id = target_org
          and exists (
            select 1 from public.documents d where d.milestone_update_id = u.id
          )
     );

  return jsonb_build_object(
    'currentTier', current_tier,
    'hasWalkthrough', has_walkthrough,
    'completedOrders', completed_orders,
    'onTimeOrders', on_time_orders,
    'qualityHistoryOrders', quality_history_orders,
    'eligibleBasic', true,
    'eligibleVerified', has_walkthrough,
    'eligibleTrusted', has_walkthrough
      and completed_orders > 0
      and on_time_orders = completed_orders
      and quality_history_orders > 0
  );
end;
$$;

revoke all on function public.admin_factory_tier_eligibility(uuid) from public;
grant execute on function public.admin_factory_tier_eligibility(uuid) to authenticated;

-- Keep the existing decision RPC stable for older clients. The new admin uses
-- this wrapper, whose validation and approval are one transaction: an invalid
-- tier rolls the approval and notification back as well.
create or replace function public.admin_review_decision_with_tier(
  target_org uuid,
  decision   public.org_review_state,
  note       text default null,
  risk       public.org_review_risk default null,
  tier       public.factory_trust_tier default null
)
returns public.org_reviews
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  decided     public.org_reviews;
  eligibility jsonb;
  chosen      public.factory_trust_tier;
begin
  if not public.is_platform_admin() then
    raise exception 'only platform admins may decide a review' using errcode = '42501';
  end if;

  if decision = 'approved' and exists (
    select 1 from public.factory_profiles f where f.org_id = target_org
  ) then
    chosen := coalesce(tier, 'basic'::public.factory_trust_tier);
    eligibility := public.admin_factory_tier_eligibility(target_org);

    if chosen = 'verified' and not (eligibility ->> 'eligibleVerified')::boolean then
      raise exception 'Verified requires a production walkthrough' using errcode = '22023';
    end if;
    if chosen = 'trusted' and not (eligibility ->> 'eligibleTrusted')::boolean then
      raise exception 'Trusted requires a walkthrough, completed on-time Club orders, and visible quality history'
        using errcode = '22023';
    end if;
  elsif tier is not null then
    raise exception 'trust tiers may only be assigned when approving a factory profile' using errcode = '22023';
  end if;

  decided := public.admin_review_decision(target_org, decision, note, risk);

  if decision = 'approved' and chosen is not null then
    update public.factory_profiles set trust_tier = chosen where org_id = target_org;
  end if;

  return decided;
end;
$$;

revoke all on function public.admin_review_decision_with_tier(
  uuid, public.org_review_state, text, public.org_review_risk, public.factory_trust_tier
) from public;
grant execute on function public.admin_review_decision_with_tier(
  uuid, public.org_review_state, text, public.org_review_risk, public.factory_trust_tier
) to authenticated;

notify pgrst, 'reload schema';
