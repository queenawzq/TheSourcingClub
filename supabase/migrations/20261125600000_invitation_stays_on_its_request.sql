-- A factory answers its invitation; it cannot move it.
--
-- rfq_invitations_factory_respond says "a factory may mark its own invitation
-- viewed or declined, nothing else", but the policy only checked that
-- factory_org_id stayed one of the caller's companies, and authenticated held
-- UPDATE on every column. So a factory could set rfq_id on its own invitation
-- to another brand's request. can_see_rfq() and is_invited_to_rfq() then
-- counted it as invited: it read that brand's invite-only (and draft) request,
-- its documents and its private tech pack from storage, and could message and
-- quote on it. The brand was told nothing: the notice is on insert only.
--
-- Signed-in users may now update only status and viewed_at. Which request,
-- which factory and the matching acknowledgement are set when the brand
-- invites and never change. Brands insert and delete invitations, as before
-- (inviteMatchedFactories' upsert ignores duplicates, so it never updates).
-- Every server-side write (submit_quote marks an invitation viewed) is a
-- security definer function and is unaffected.

revoke update on public.rfq_invitations from authenticated;
grant update (status, viewed_at) on public.rfq_invitations to authenticated;
