-- Deliberate removal of unused factory companies. Accounts are retained;
-- quote/order/payment history must never disappear as part of cleanup.
create table public.admin_factory_deletions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  org_name text not null,
  deleted_by uuid references auth.users(id) on delete set null,
  deleted_at timestamptz not null default now(),
  files jsonb not null default '[]',
  files_cleaned_at timestamptz
);
alter table public.admin_factory_deletions enable row level security;
create policy admin_factory_deletions_read on public.admin_factory_deletions
  for select to authenticated using (public.is_platform_admin());
revoke all on public.admin_factory_deletions from anon, authenticated;
grant select on public.admin_factory_deletions to authenticated;

create or replace function public.admin_delete_factory(target_org uuid, confirm_name text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare company public.orgs; receipt public.admin_factory_deletions;
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform staff can delete factories' using errcode = '42501';
  end if;
  select * into company from public.orgs where id = target_org for update;
  if not found or company.type <> 'factory' then
    raise exception 'Factory not found' using errcode = 'P0002';
  end if;
  if confirm_name is null or btrim(confirm_name) <> company.name then
    raise exception 'Type the exact factory name to confirm deletion' using errcode = '22023';
  end if;
  if exists (select 1 from public.org_members m join public.platform_admins a on a.user_id = m.user_id where m.org_id = target_org) then
    raise exception 'A company linked to platform staff cannot be deleted' using errcode = '42501';
  end if;
  if exists (select 1 from public.quotes where factory_org_id = target_org)
    or exists (select 1 from public.production_orders where factory_org_id = target_org or brand_org_id = target_org)
    or exists (select 1 from public.credit_purchases where org_id = target_org)
    or exists (select 1 from public.stripe_connect_accounts where org_id = target_org)
  then
    raise exception 'This factory has quotes, orders or payment records and cannot be deleted' using errcode = '22023';
  end if;
  insert into public.admin_factory_deletions(org_id, org_name, deleted_by, files)
  select company.id, company.name, auth.uid(), coalesce(jsonb_agg(jsonb_build_object('bucket', d.bucket, 'path', d.storage_path)) filter (where d.id is not null), '[]'::jsonb)
  from public.documents d where d.org_id = target_org
    and d.bucket in ('org-public', 'org-private')
    and split_part(d.storage_path, '/', 1) = target_org::text
  returning * into receipt;
  -- The org lock also serializes new FK references (quotes/orders) against
  -- deletion. Any restrictive reference refuses the whole transaction.
  delete from public.orgs where id = target_org;
  return jsonb_build_object('id', receipt.id, 'name', company.name, 'files', receipt.files);
end;
$$;
revoke all on function public.admin_delete_factory(uuid, text) from public;
grant execute on function public.admin_delete_factory(uuid, text) to authenticated;
notify pgrst, 'reload schema';
