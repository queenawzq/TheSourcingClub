-- ============================================================================
-- A request stays with the brand that wrote it
-- ----------------------------------------------------------------------------
-- rfqs_brand_update lets a member of the request's brand update the row while
-- it is a draft or open, and its with-check only asks that the NEW
-- brand_org_id be one of the caller's companies. The grant covers every
-- column. So a person in two brands could move a request, with the factories'
-- submitted quotes on it, to their other brand, which could then read and
-- award them; guard_rfq_permission checks Quote flow on the new brand only,
-- so it worked even after Quote flow was taken away in the first one.
--
-- Nothing in the product moves a request between companies: the composer,
-- publish, cancel and award paths never write brand_org_id after insert. So a
-- change is refused outright, for every caller. With brand_org_id fixed,
-- guard_rfq_permission's check on new.brand_org_id is the original brand's.
--
-- Additive: the live site never changes brand_org_id, so it keeps working
-- while this is applied.
-- ============================================================================

create or replace function public.guard_rfq_brand_fixed()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.brand_org_id is distinct from old.brand_org_id then
    raise exception 'a request stays with the company that wrote it'
      using errcode = '42501', hint = 'request_brand_fixed';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_rfq_brand_fixed() from public, anon, authenticated;

create trigger rfqs_brand_fixed
  before update of brand_org_id on public.rfqs
  for each row execute function public.guard_rfq_brand_fixed();
