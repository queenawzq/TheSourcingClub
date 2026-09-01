-- ============================================================================
-- 010  Terms acceptance
-- ----------------------------------------------------------------------------
-- Both onboarding flows end with an agreement checkbox and a typed
-- e-signature. That is a legal record, so it needs somewhere durable to live
-- rather than being a checkbox that gates a button and is then forgotten.
--
-- Recorded per org: who signed, what name they typed, when, and which version
-- of the terms they saw. The version matters — without it, a later change to
-- the terms leaves no way to prove what any given user actually agreed to.
-- ============================================================================

create table public.terms_acceptances (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs (id) on delete cascade,

  -- Bump this constant in the app when the wording changes materially.
  terms_version text not null,

  -- The name the user typed, kept verbatim. Not validated against their
  -- account name: what matters is what they actually wrote.
  signature     text not null check (length(btrim(signature)) > 0),

  accepted_by   uuid not null references auth.users (id) on delete restrict,
  accepted_at   timestamptz not null default now(),

  unique (org_id, terms_version)
);

create index terms_acceptances_org_idx on public.terms_acceptances (org_id);

alter table public.terms_acceptances enable row level security;

-- Readable by the org and by admins. Insert-only from a client: a signature
-- that can be edited afterwards is not evidence of anything.
create policy terms_acceptances_read on public.terms_acceptances
  for select to authenticated
  using (org_id in (select public.current_org_ids()) or public.is_platform_admin());

create policy terms_acceptances_insert on public.terms_acceptances
  for insert to authenticated
  with check (public.is_org_member(org_id) and accepted_by = auth.uid());

grant select, insert on public.terms_acceptances to authenticated;
