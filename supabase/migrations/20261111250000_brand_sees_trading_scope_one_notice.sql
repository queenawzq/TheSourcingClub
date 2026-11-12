-- v3.1, Nov 11 tester finding: a trading-only licence that staff approved
-- with a reason showed to brands as plain "Verified". The brand-visible
-- registry fact now says so ('tradingScope': true), never the reason itself
-- (staff-only). Built on the latest definition (20261108700200).
--
-- (The "matches you" notice beside an invitation is handled on screen: the
-- outbox's "invited to quote instead" rule needs the notice row to stay.)

create or replace function public.factory_registry_fact(target_org uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
           'checkedAt', c.checked_at,
           -- A sole proprietor has no number a registry could be asked about.
           'kind', case when public.registry_source_is_official(c.source) and c.number_checked is not null
                        then 'registry' else 'document' end,
           'tradingScope', exists (select 1 from public.registry_trader_reviews t where t.org_id = target_org))
    from public.current_registry_check(target_org) c
    join public.factory_profiles f on f.org_id = c.org_id
   where c.result = 'found'
     and public.registry_check_holds(target_org, c.details)
     and f.verification_status = 'verified'
     and (f.published_at is not null or public.is_org_member(target_org) or public.is_platform_admin())
$$;
