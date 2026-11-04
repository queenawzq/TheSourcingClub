-- Public aggregate performance, without exposing any buyer or order detail.
create function public.public_factory_metrics(target_org uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select case when auth.uid() is not null and exists (
    select 1 from public.factory_profiles where org_id=target_org and published_at is not null
  ) then jsonb_build_object(
    'clubOrders',(select count(*) from public.production_orders where factory_org_id=target_org and status<>'cancelled'),
    'repeatBrands',(select count(*) from (select brand_org_id from public.production_orders where factory_org_id=target_org and status<>'cancelled' group by brand_org_id having count(*)>1) r)
  ) else null end;
$$;
revoke all on function public.public_factory_metrics(uuid) from public;
grant execute on function public.public_factory_metrics(uuid) to authenticated;
notify pgrst,'reload schema';
