-- Private organization only: never changes an RFQ, invitation or quote status.
create table public.factory_rfq_organization (
  org_id uuid primary key references public.orgs(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object')
);
alter table public.factory_rfq_organization enable row level security;
grant select, insert, update on public.factory_rfq_organization to authenticated;
create policy factory_rfq_organization_member on public.factory_rfq_organization
  for all to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id) and exists (
    select 1 from public.orgs where id = org_id and type = 'factory'
  ));
