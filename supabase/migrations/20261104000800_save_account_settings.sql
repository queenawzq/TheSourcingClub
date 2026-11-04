create table public.company_contact_details (
  org_id uuid primary key references public.orgs(id) on delete cascade,
  phone text
);
alter table public.company_contact_details enable row level security;
revoke all on public.company_contact_details from anon, authenticated;
grant select on public.company_contact_details to authenticated;
create policy company_contact_details_read on public.company_contact_details for select to authenticated using (public.is_org_member(org_id) or public.is_platform_admin());
create or replace function public.save_account_settings(target_org uuid, account_name text, phone text, location text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare company public.orgs;
begin
  if not public.is_org_owner(target_org) then raise exception 'Only a company owner can save account settings' using errcode = '42501'; end if;
  if nullif(btrim(account_name), '') is null then raise exception 'Account name is required' using errcode = '22023'; end if;
  if length(account_name) > 200 or length(phone) > 80 or length($4) > 300 then raise exception 'Account details are too long' using errcode = '22023'; end if;
  update public.orgs set name = btrim(account_name) where id = target_org returning * into company;
  insert into public.company_contact_details(org_id,phone) values(target_org,nullif(btrim($3),'')) on conflict(org_id) do update set phone=excluded.phone;
  if company.type = 'brand' then
    update public.brand_profiles set hq_location = nullif(btrim($4),'') where org_id = target_org;
  else
    update public.factory_profiles set location = nullif(btrim($4),'') where org_id = target_org;
  end if;
  return jsonb_build_object('name',company.name,'phone',coalesce(nullif(btrim($3),''),''),'location',coalesce(nullif(btrim($4),''),''));
end;
$$;
revoke all on function public.save_account_settings(uuid,text,text,text) from public;
grant execute on function public.save_account_settings(uuid,text,text,text) to authenticated;
notify pgrst, 'reload schema';
