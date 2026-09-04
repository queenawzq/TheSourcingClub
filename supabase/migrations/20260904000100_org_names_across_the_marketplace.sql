-- ============================================================================
-- 023  Counterparty org names
-- ----------------------------------------------------------------------------
-- A factory browsing open requests saw "A brand" instead of a name: the orgs
-- policy only admits orgs you belong to, so the embed came back null.
--
-- Showing the name is correct — brand_summary_for_factory() already returns it,
-- and a request from an anonymous counterparty is not something anyone would
-- quote on. The browse list simply had no way to read it.
--
-- Widening the orgs policy is safe here in a way it would not be for
-- brand_profiles: every column on orgs is a public-facing identifier —
-- id, type, name, slug, is_demo, created_at. There is nothing on this table to
-- redact, which is why a row policy suffices and brand_profiles still needs a
-- function.
--
-- Scoped to a real relationship, not to everyone: you may read an org that
-- owns a request you can see, or that quoted on a request you own. Browsing
-- the whole directory of orgs stays impossible.
-- ============================================================================

create policy orgs_counterparty_read on public.orgs
  for select to authenticated
  using (
    -- The brand behind a request I am allowed to see.
    exists (
      select 1 from public.rfqs r
      where r.brand_org_id = orgs.id
        and public.can_see_rfq(r.id)
    )
    -- Or a factory that quoted on a request I own.
    or exists (
      select 1
      from public.quotes q
      where q.factory_org_id = orgs.id
        and q.status <> 'draft'
        and public.is_org_member(public.rfq_brand_org(q.rfq_id))
    )
    -- Or a factory I invited to one of my requests.
    or exists (
      select 1
      from public.rfq_invitations i
      where i.factory_org_id = orgs.id
        and public.is_org_member(public.rfq_brand_org(i.rfq_id))
    )
  );
