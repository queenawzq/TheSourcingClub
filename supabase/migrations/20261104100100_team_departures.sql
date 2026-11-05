-- Three fixes from the independent test of Team & roles. A separate file from
-- 20261104100000 so the qa database, which marks that one applied by hand,
-- picks these up on an ordinary push.

-- ---------------------------------------------------------------------------
-- Someone who lost their last company: say so, and create nothing
-- ---------------------------------------------------------------------------

-- The app creates a company from the signup answers for an account with no
-- company, which is right once, straight after signing up. Someone removed
-- from their only company looks the same unless this says otherwise. Written
-- by a trigger so every path counts: removal, leaving, staff deleting the
-- company. org_name is a copy because the company may be gone; no foreign key
-- to orgs for the same reason.
create table public.org_member_departures (
  user_id   uuid primary key references auth.users (id) on delete cascade,
  org_name  text,
  by_choice boolean not null,
  left_at   timestamptz not null default now()
);

alter table public.org_member_departures enable row level security;
revoke all on public.org_member_departures from anon, authenticated;
grant select on public.org_member_departures to authenticated;
create policy org_member_departures_own on public.org_member_departures
  for select to authenticated using (user_id = auth.uid());

create or replace function public.org_members_record_departure()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Deleting the account cascades here after the user row is gone.
  if not exists (select 1 from auth.users where id = old.user_id) then
    return null;
  end if;
  insert into public.org_member_departures (user_id, org_name, by_choice, left_at)
  values (old.user_id,
          (select name from public.orgs where id = old.org_id),
          old.user_id is not distinct from auth.uid(),
          now())
  on conflict (user_id) do update
    set org_name = excluded.org_name, by_choice = excluded.by_choice, left_at = excluded.left_at;
  return null;
end;
$$;

revoke all on function public.org_members_record_departure() from public, anon, authenticated;

create trigger org_members_record_departure
  after delete on public.org_members
  for each row execute function public.org_members_record_departure();

-- ---------------------------------------------------------------------------
-- A removed member's invitations die with their access
-- ---------------------------------------------------------------------------

-- Otherwise a member about to be removed can invite a second address of their
-- own and walk back in with the rights that invitation carries. Leaving
-- withdraws them too, for the same reason.
create or replace function public.remove_member(target_org uuid, target_user uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  member    public.org_members;
  leaving   boolean := target_user = auth.uid();
  who       text;
  org_name  text;
  withdrawn integer;
begin
  if leaving then
    if not public.is_org_member(target_org) then
      raise exception 'That person is not on this team' using errcode = '42501';
    end if;
  elsif not public.is_org_owner(target_org) then
    raise exception 'Only an owner can remove someone from the team' using errcode = '42501';
  end if;

  perform 1 from public.org_members
    where org_id = target_org and role = 'owner' for update;

  select * into member from public.org_members
   where org_id = target_org and user_id = target_user for update;
  if member.user_id is null then
    raise exception 'That person is not on this team' using errcode = 'P0002';
  end if;

  if member.role = 'owner' and (
    select count(*) from public.org_members where org_id = target_org and role = 'owner'
  ) <= 1 then
    raise exception 'A company always keeps at least one owner. Make someone else an owner first.'
      using errcode = '23514', hint = 'last_owner';
  end if;

  delete from public.org_members where org_id = target_org and user_id = target_user;

  update public.org_invitations
     set status = 'revoked'
   where org_id = target_org and invited_by = target_user and status = 'pending';
  get diagnostics withdrawn = row_count;

  -- The primary contact goes back to the earliest owner.
  if 'primaryContact' = any (member.permissions) then
    update public.org_members
       set permissions = permissions || 'primaryContact'::text
     where org_id = target_org
       and user_id = (select user_id from public.org_members
                       where org_id = target_org and role = 'owner'
                       order by created_at, user_id limit 1);
  end if;

  select coalesce(nullif(btrim(p.full_name), ''), u.email) into who
    from auth.users u left join public.user_profiles p on p.id = u.id
   where u.id = target_user;
  select name into org_name from public.orgs where id = target_org;

  insert into public.notifications (org_id, kind, subject_type, subject_id, title, body, data)
  values (
    target_org,
    case when leaving then 'team_member_left' else 'team_member_removed' end,
    'org', target_org,
    case when leaving then format('%s left %s', who, org_name)
         else format('%s no longer has access to %s', who, org_name) end,
    'Everything they worked on stays with the company.'
      || case when withdrawn = 1 then ' The invitation they sent was withdrawn.'
              when withdrawn > 1 then format(' The %s invitations they sent were withdrawn.', withdrawn)
              else '' end,
    jsonb_build_object('user_id', target_user)
  );
end;
$$;

revoke all on function public.remove_member(uuid, uuid) from public, anon;
grant execute on function public.remove_member(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- A save that does not touch the name cannot be refused for the name
-- ---------------------------------------------------------------------------

-- account_name null means "leave it". A member's Settings page sends null: its
-- copy of the name goes stale the moment an owner renames the company, and
-- that used to refuse their phone number.
create or replace function public.save_account_settings(target_org uuid, account_name text, phone text, location text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  company public.orgs;
begin
  if not public.has_org_permission(target_org, 'settingsAccess') then
    raise exception 'You need Settings access to change the company''s details'
      using errcode = '42501', hint = 'missing_permission:settingsAccess';
  end if;
  if account_name is not null and nullif(btrim(account_name), '') is null then
    raise exception 'Account name is required' using errcode = '22023';
  end if;
  if length(account_name) > 200 or length($3) > 80 or length($4) > 300 then
    raise exception 'Account details are too long' using errcode = '22023';
  end if;

  select * into company from public.orgs where id = target_org;
  if account_name is not null then
    if btrim(account_name) is distinct from company.name and not public.is_org_owner(target_org) then
      raise exception 'Only a company owner can change the company''s name' using errcode = '42501';
    end if;
    update public.orgs set name = btrim(account_name) where id = target_org returning * into company;
  end if;

  insert into public.company_contact_details (org_id, phone) values (target_org, nullif(btrim($3), ''))
    on conflict (org_id) do update set phone = excluded.phone;
  if company.type = 'brand' then
    update public.brand_profiles set hq_location = nullif(btrim($4), '') where org_id = target_org;
  else
    update public.factory_profiles set location = nullif(btrim($4), '') where org_id = target_org;
  end if;
  return jsonb_build_object('name', company.name, 'phone', coalesce(nullif(btrim($3), ''), ''), 'location', coalesce(nullif(btrim($4), ''), ''));
end;
$$;

revoke all on function public.save_account_settings(uuid, text, text, text) from public, anon;
grant execute on function public.save_account_settings(uuid, text, text, text) to authenticated;

notify pgrst, 'reload schema';
