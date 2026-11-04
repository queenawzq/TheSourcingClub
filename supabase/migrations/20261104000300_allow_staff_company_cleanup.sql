-- Company cleanup retains user accounts and independent platform staff access.
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

create or replace function public.admin_delete_brand(target_org uuid, confirm_name text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare company public.orgs; receipt public.admin_factory_deletions;
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform staff can delete brands' using errcode = '42501';
  end if;
  select * into company from public.orgs where id = target_org for update;
  if not found or company.type <> 'brand' then
    raise exception 'Brand not found' using errcode = 'P0002';
  end if;
  if confirm_name is null or btrim(confirm_name) <> company.name then
    raise exception 'Type the exact brand name to confirm deletion' using errcode = '22023';
  end if;
  if exists (select 1 from public.quotes q join public.rfqs r on r.id = q.rfq_id where r.brand_org_id = target_org)
    or exists (select 1 from public.production_orders where factory_org_id = target_org or brand_org_id = target_org)
    or exists (select 1 from public.credit_purchases where org_id = target_org)
    or exists (select 1 from public.stripe_connect_accounts where org_id = target_org)
  then
    raise exception 'This brand has quotes, orders or payment records and cannot be deleted' using errcode = '22023';
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
revoke all on function public.admin_delete_brand(uuid, text) from public;
grant execute on function public.admin_delete_brand(uuid, text) to authenticated;
notify pgrst, 'reload schema';
