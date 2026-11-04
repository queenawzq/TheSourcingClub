-- The marketplace and Settings use orgs.name as the shared display name.
-- Legal registration names stay independent.
create function public.rename_factory(target_org uuid, factory_name text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_org_owner(target_org) then raise exception 'Only a company owner can change the factory name' using errcode = '42501'; end if;
  if nullif(btrim(factory_name),'') is null or length(factory_name)>200 then raise exception 'Factory name is required and must be at most 200 characters' using errcode='22023'; end if;
  update public.orgs set name=btrim(factory_name) where id=target_org and type='factory';
  if not found then raise exception 'Factory not found' using errcode='P0002'; end if;
end;
$$;
revoke all on function public.rename_factory(uuid,text) from public;
grant execute on function public.rename_factory(uuid,text) to authenticated;
notify pgrst, 'reload schema';
