-- Team & roles: per-member permissions, removing a member, invites that
-- carry what the person may do.
--
-- The permission keys are the design's own (Settings → Roles & access):
--   brand:   rfqFlow, approve, releaseFunds, primaryContact, settingsAccess
--   factory: rfqFlow, addUpdate, primaryContact, settingsAccess
--
-- An owner holds every authority and cannot be restricted. primaryContact is
-- not an authority: it names the one person the other side should reach, and
-- an owner may or may not be it.
--
-- Enforced here, not in the screens. Each RPC asks require_org_permission()
-- before it acts; the tables a client writes directly (quotes and their lines,
-- requests and their parts) carry a guard trigger, so no policy is rewritten
-- and a direct POST meets the same rule as the button.
--
-- Members who exist when this runs keep what they could do the day before
-- (brand: rfqFlow + approve; factory: rfqFlow + addUpdate). So does a member
-- row written straight into the table (the seed, tests), because the default
-- is filled in by trigger. An invitation starts from the design's ticked box.

-- ---------------------------------------------------------------------------
-- Vocabulary
-- ---------------------------------------------------------------------------

create or replace function public.permission_keys(kind public.org_type)
returns text[]
language sql
immutable
as $$
  select case kind
    when 'brand'   then array['rfqFlow', 'approve', 'releaseFunds', 'primaryContact', 'settingsAccess']
    when 'factory' then array['rfqFlow', 'addUpdate', 'primaryContact', 'settingsAccess']
  end
$$;

-- What a member gets when nobody says otherwise. `invited` is the design's
-- ticked box in the invite drawer; the other is what a member could do before
-- permissions existed.
create or replace function public.default_member_permissions(kind public.org_type, invited boolean)
returns text[]
language sql
immutable
as $$
  select case
    when kind = 'brand'   and invited then array['approve']
    when kind = 'brand'               then array['approve', 'rfqFlow']
    when kind = 'factory' and invited then array['addUpdate']
    when kind = 'factory'             then array['addUpdate', 'rfqFlow']
  end
$$;

create or replace function public.permission_label(kind public.org_type, perm text)
returns text
language sql
immutable
as $$
  select case perm
    when 'rfqFlow'        then case when kind = 'brand' then 'Quote flow' else 'RFQ flow' end
    when 'approve'        then 'Approve samples'
    when 'releaseFunds'   then 'Release funds'
    when 'addUpdate'      then 'Add update'
    when 'primaryContact' then 'Primary contact'
    when 'settingsAccess' then 'Settings access'
    else perm
  end
$$;

revoke all on function public.permission_keys(public.org_type) from public, anon;
revoke all on function public.default_member_permissions(public.org_type, boolean) from public, anon;
revoke all on function public.permission_label(public.org_type, text) from public, anon;
grant execute on function public.permission_keys(public.org_type) to authenticated, service_role;
grant execute on function public.default_member_permissions(public.org_type, boolean) to authenticated, service_role;
grant execute on function public.permission_label(public.org_type, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

alter table public.org_members
  add column permissions text[],
  add column title       text check (title is null or char_length(title) between 1 and 60),
  add column updated_at  timestamptz not null default now();

update public.org_members m
   set permissions = case
         when m.role = 'owner' then '{}'::text[]
         else public.default_member_permissions(o.type, false)
       end
  from public.orgs o
 where o.id = m.org_id;

-- The earliest owner of each company is its primary contact until someone
-- else is chosen.
update public.org_members m
   set permissions = m.permissions || 'primaryContact'::text
  from (
    select distinct on (org_id) org_id, user_id
      from public.org_members
     where role = 'owner'
     order by org_id, created_at, user_id
  ) first_owner
 where m.org_id = first_owner.org_id
   and m.user_id = first_owner.user_id;

-- No default on purpose: org_members_permissions fills it in by the company's
-- kind, and NOT NULL is checked after BEFORE triggers.
alter table public.org_members alter column permissions set not null;

alter table public.org_invitations
  add column permissions  text[],
  add column title        text check (title is null or char_length(title) between 1 and 60),
  add column invited_name text check (invited_name is null or char_length(invited_name) between 1 and 120),
  add column emailed_at   timestamptz;

-- Contact details the company keeps for itself (Settings → Account). Not on
-- `orgs`, which the other side of an order can read: an email or phone shown
-- to a counterparty is exactly what message screening exists to stop.
create table public.org_contact_details (
  org_id     uuid primary key references public.orgs (id) on delete cascade,
  email      text check (email is null or (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  phone      text check (phone is null or char_length(phone) between 3 and 40),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

alter table public.org_contact_details enable row level security;

create policy org_contact_details_read on public.org_contact_details
  for select to authenticated
  using (public.is_org_member(org_id) or public.is_platform_admin());

revoke all on public.org_contact_details from anon, authenticated;
grant select on public.org_contact_details to authenticated;
grant all on public.org_contact_details to service_role;

-- ---------------------------------------------------------------------------
-- Asking
-- ---------------------------------------------------------------------------

-- Every authority check in the schema comes through here. Owners hold every
-- authority; primaryContact is a fact about a person, so even an owner holds
-- it only when chosen.
create or replace function public.member_has_permission(target_user uuid, target_org uuid, perm text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.org_members m
     where m.org_id = target_org
       and m.user_id = target_user
       and ((m.role = 'owner' and perm <> 'primaryContact') or perm = any (m.permissions))
  )
$$;

create or replace function public.has_org_permission(target_org uuid, perm text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.member_has_permission(auth.uid(), target_org, perm)
$$;

revoke all on function public.member_has_permission(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.member_has_permission(uuid, uuid, text) to service_role;
revoke all on function public.has_org_permission(uuid, text) from public, anon;
grant execute on function public.has_org_permission(uuid, text) to authenticated, service_role;

-- Raises for a MEMBER of target_org who lacks the permission. A stranger, the
-- service role and staff fall through, so each caller's own party check keeps
-- deciding them, with its own words and its own error code.
create or replace function public.require_org_permission(target_org uuid, perm text)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  org public.orgs;
begin
  if auth.uid() is null or target_org is null then
    return;
  end if;
  if not public.is_org_member(target_org) then
    return;
  end if;
  if public.member_has_permission(auth.uid(), target_org, perm) then
    return;
  end if;

  select * into org from public.orgs where id = target_org;
  raise exception 'You need the % permission at % to do this. An owner can give it to you in Settings.',
      public.permission_label(org.type, perm), org.name
    using errcode = '42501', hint = 'missing_permission:' || perm;
end;
$$;

revoke all on function public.require_org_permission(uuid, text) from public, anon, authenticated;
grant execute on function public.require_org_permission(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- org_members: what a row may hold
-- ---------------------------------------------------------------------------

create or replace function public.org_members_permissions()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  kind public.org_type;
  bad  text;
begin
  select type into kind from public.orgs where id = new.org_id;

  if new.permissions is null then
    new.permissions := case when new.role = 'owner' then '{}'::text[]
                            else public.default_member_permissions(kind, false) end;
  end if;

  select p into bad from unnest(new.permissions) p
   where not p = any (public.permission_keys(kind)) limit 1;
  if bad is not null then
    raise exception 'A % company has no permission called %', kind, bad using errcode = '22023';
  end if;

  -- An owner holds every authority already; storing them would only let the
  -- two drift apart after a demotion.
  if new.role = 'owner' then
    new.permissions := array(select p from unnest(new.permissions) p where p = 'primaryContact');
  end if;

  if tg_op = 'INSERT' and new.role = 'owner' and not exists (
    select 1 from public.org_members
     where org_id = new.org_id and 'primaryContact' = any (permissions)
  ) then
    new.permissions := new.permissions || 'primaryContact'::text;
  end if;

  new.permissions := array(select distinct p from unnest(new.permissions) p order by p);
  new.title := nullif(btrim(coalesce(new.title, '')), '');
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create trigger org_members_permissions
  before insert or update of permissions, role, title on public.org_members
  for each row execute function public.org_members_permissions();

-- One primary contact per company: choosing someone takes it from whoever
-- held it.
create or replace function public.org_members_single_contact()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if 'primaryContact' = any (new.permissions) then
    update public.org_members
       set permissions = array_remove(permissions, 'primaryContact')
     where org_id = new.org_id
       and user_id <> new.user_id
       and 'primaryContact' = any (permissions);
  end if;
  return null;
end;
$$;

create trigger org_members_single_contact
  after insert or update of permissions on public.org_members
  for each row execute function public.org_members_single_contact();

revoke all on function public.org_members_permissions() from public, anon, authenticated;
revoke all on function public.org_members_single_contact() from public, anon, authenticated;

-- Membership changes go through the functions below. The old owner UPDATE
-- policy let an owner rewrite any column, user_id included: a way to add
-- anyone without an invitation. And anyone could delete their own row, the
-- last owner too.
revoke insert, update, delete, truncate on public.org_members from authenticated, anon;

-- ---------------------------------------------------------------------------
-- Guards on what a client writes directly
-- ---------------------------------------------------------------------------

-- A quote is the factory's RFQ flow while it is a draft (writing, sending).
-- Once sent, its changes are the brand's award or the factory's revise and
-- withdraw, and those RPCs ask themselves.
create or replace function public.guard_quote_permission()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    perform public.require_org_permission(new.factory_org_id, 'rfqFlow');
    return new;
  end if;
  if old.status = 'draft' then
    perform public.require_org_permission(old.factory_org_id, 'rfqFlow');
  end if;
  return coalesce(new, old);
end;
$$;

create trigger quotes_permission
  before insert or update or delete on public.quotes
  for each row execute function public.guard_quote_permission();

create or replace function public.guard_quote_line_permission()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.require_org_permission(
    (select q.factory_org_id from public.quotes q
      where q.id = case when tg_op = 'DELETE' then old.quote_id else new.quote_id end),
    'rfqFlow');
  return coalesce(new, old);
end;
$$;

create trigger quote_sample_lines_permission
  before insert or update or delete on public.quote_sample_lines
  for each row execute function public.guard_quote_line_permission();
create trigger quote_question_answers_permission
  before insert or update or delete on public.quote_question_answers
  for each row execute function public.guard_quote_line_permission();
create trigger quote_material_lines_permission
  before insert or update or delete on public.quote_material_lines
  for each row execute function public.guard_quote_line_permission();

-- A request, and everything a brand writes into one, is its Quote flow.
create or replace function public.guard_rfq_permission()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target uuid;
begin
  if tg_table_name = 'rfqs' then
    target := case when tg_op = 'DELETE' then old.brand_org_id else new.brand_org_id end;
  else
    target := public.rfq_brand_org(case when tg_op = 'DELETE' then old.rfq_id else new.rfq_id end);
  end if;
  perform public.require_org_permission(target, 'rfqFlow');
  return coalesce(new, old);
end;
$$;

create trigger rfqs_permission
  before insert or update or delete on public.rfqs
  for each row execute function public.guard_rfq_permission();
create trigger rfq_colour_splits_permission
  before insert or update or delete on public.rfq_colour_splits
  for each row execute function public.guard_rfq_permission();
create trigger rfq_questions_permission
  before insert or update or delete on public.rfq_questions
  for each row execute function public.guard_rfq_permission();
-- Not update: that is the factory marking its invitation viewed or declined.
create trigger rfq_invitations_permission
  before insert or delete on public.rfq_invitations
  for each row execute function public.guard_rfq_permission();

-- A request's categories and its matching requirements are part of writing
-- it; a profile's are not, and stay open to every member.
create or replace function public.guard_rfq_subject_permission()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  row_subject_type text;
  row_subject_id   uuid;
begin
  if tg_op = 'DELETE' then
    row_subject_type := old.subject_type::text;
    row_subject_id := old.subject_id;
  else
    row_subject_type := new.subject_type::text;
    row_subject_id := new.subject_id;
  end if;
  if row_subject_type = 'rfq' then
    perform public.require_org_permission(public.rfq_brand_org(row_subject_id), 'rfqFlow');
  end if;
  return coalesce(new, old);
end;
$$;

create trigger taxonomy_links_rfq_permission
  before insert or update or delete on public.taxonomy_links
  for each row execute function public.guard_rfq_subject_permission();
create trigger matching_requirements_rfq_permission
  before insert or update or delete on public.matching_requirements
  for each row execute function public.guard_rfq_subject_permission();

revoke all on function public.guard_quote_permission() from public, anon, authenticated;
revoke all on function public.guard_quote_line_permission() from public, anon, authenticated;
revoke all on function public.guard_rfq_permission() from public, anon, authenticated;
revoke all on function public.guard_rfq_subject_permission() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Invitations
-- ---------------------------------------------------------------------------

-- Settings access invites; owners hold it already.
create policy org_invitations_settings_read on public.org_invitations
  for select to authenticated
  using (public.has_org_permission(org_id, 'settingsAccess'));

create policy org_invitations_settings_insert on public.org_invitations
  for insert to authenticated
  with check (public.has_org_permission(org_id, 'settingsAccess'));

create policy org_invitations_settings_revoke on public.org_invitations
  for update to authenticated
  using (public.has_org_permission(org_id, 'settingsAccess'))
  with check (public.has_org_permission(org_id, 'settingsAccess'));

-- Insert stays a plain insert so the site that is live while this migration
-- runs keeps inviting; the guard decides everything a client could choose.
revoke insert, update, delete, truncate on public.org_invitations from authenticated, anon;
grant insert (org_id, email, role, permissions, title, invited_name) on public.org_invitations to authenticated;
grant update (status) on public.org_invitations to authenticated;

create or replace function public.guard_org_invitation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  kind     public.org_type;
  bad      text;
  inviter  uuid := auth.uid();
begin
  if tg_op = 'UPDATE' then
    -- A client may only withdraw a pending invitation. Accepting happens in
    -- accept_invitation(), which runs as the definer.
    if current_user = 'authenticated'
       and not (old.status = 'pending' and new.status = 'revoked') then
      raise exception 'Only a pending invitation can be withdrawn' using errcode = '42501';
    end if;
    return new;
  end if;

  -- The service role (seed, server) writes what it means to.
  if inviter is null then
    return new;
  end if;

  select type into kind from public.orgs where id = new.org_id;

  new.email := lower(btrim(new.email));
  new.invited_by := inviter;
  new.role := 'member';
  new.status := 'pending';
  new.expires_at := now() + interval '14 days';
  new.title := nullif(btrim(coalesce(new.title, '')), '');
  new.invited_name := nullif(btrim(coalesce(new.invited_name, '')), '');

  if new.permissions is null then
    new.permissions := array(
      select p from unnest(public.default_member_permissions(kind, true)) p
       where public.member_has_permission(inviter, new.org_id, p));
  end if;

  select p into bad from unnest(new.permissions) p
   where not p = any (public.permission_keys(kind)) limit 1;
  if bad is not null then
    raise exception 'A % company has no permission called %', kind, bad using errcode = '22023';
  end if;

  -- The primary contact is chosen among people already on the team.
  new.permissions := array(select distinct p from unnest(new.permissions) p
                            where p <> 'primaryContact' order by p);

  -- No inviting a second address of your own with more than you hold.
  select p into bad from unnest(new.permissions) p
   where not public.member_has_permission(inviter, new.org_id, p) limit 1;
  if bad is not null then
    raise exception 'You can only give permissions you have yourself (not %)', public.permission_label(kind, bad)
      using errcode = '42501', hint = 'permission_not_held:' || bad;
  end if;

  if exists (
    select 1 from public.org_members m
      join auth.users u on u.id = m.user_id
     where m.org_id = new.org_id and lower(u.email) = new.email
  ) then
    raise exception '% is already on this team', new.email using errcode = '23505', hint = 'already_member';
  end if;

  if exists (
    select 1 from public.platform_admins a
      join auth.users u on u.id = a.user_id
     where lower(u.email) = new.email
  ) then
    raise exception 'That address belongs to The Sourcing Club staff, who cannot join a company'
      using errcode = '42501', hint = 'staff_address';
  end if;

  -- Per person, not per company: a second company is not a second allowance.
  if (select count(*) from public.org_invitations
       where invited_by = inviter and created_at > now() - interval '1 day') >= 20 then
    raise exception 'You can invite up to 20 people a day. Try again tomorrow.'
      using errcode = '54000', hint = 'daily_limit';
  end if;

  return new;
end;
$$;

create trigger org_invitations_guard
  before insert or update on public.org_invitations
  for each row execute function public.guard_org_invitation();

revoke all on function public.guard_org_invitation() from public, anon, authenticated;

create or replace function public.revoke_invitation(target_invitation uuid)
returns public.org_invitations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  invite public.org_invitations;
begin
  -- One answer for "not yours" and "does not exist".
  if not exists (
    select 1 from public.org_invitations i
     where i.id = target_invitation
       and public.has_org_permission(i.org_id, 'settingsAccess')
  ) then
    raise exception 'invitation not found' using errcode = '42501';
  end if;

  update public.org_invitations
     set status = 'revoked'
   where id = target_invitation and status = 'pending'
  returning * into invite;

  if invite.id is null then
    raise exception 'This invitation was already accepted or withdrawn' using errcode = '22023';
  end if;
  return invite;
end;
$$;

-- Gives a pending invitation another 14 days; the server sends the email
-- again. Ten minutes between sends, so Resend can't be used to spam an inbox.
create or replace function public.resend_invitation(target_invitation uuid)
returns public.org_invitations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  invite public.org_invitations;
begin
  if not exists (
    select 1 from public.org_invitations i
     where i.id = target_invitation
       and public.has_org_permission(i.org_id, 'settingsAccess')
  ) then
    raise exception 'invitation not found' using errcode = '42501';
  end if;

  select * into invite from public.org_invitations where id = target_invitation for update;
  if invite.status <> 'pending' then
    raise exception 'This invitation was already accepted or withdrawn' using errcode = '22023';
  end if;
  if invite.emailed_at > now() - interval '10 minutes' then
    raise exception 'This invitation was emailed a few minutes ago. Try again in 10 minutes.'
      using errcode = '54000', hint = 'resend_too_soon';
  end if;

  update public.org_invitations
     set expires_at = now() + interval '14 days'
   where id = target_invitation
  returning * into invite;
  return invite;
end;
$$;

revoke all on function public.revoke_invitation(uuid) from public, anon;
revoke all on function public.resend_invitation(uuid) from public, anon;
grant execute on function public.revoke_invitation(uuid) to authenticated;
grant execute on function public.resend_invitation(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Changing the team
-- ---------------------------------------------------------------------------

create or replace function public.set_member_access(
  target_org  uuid,
  target_user uuid,
  new_permissions text[],
  new_title text
)
returns public.org_members
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  member public.org_members;
begin
  if not public.is_org_owner(target_org) then
    raise exception 'Only an owner can change what a teammate may do' using errcode = '42501';
  end if;

  select * into member from public.org_members
   where org_id = target_org and user_id = target_user for update;
  if member.user_id is null then
    raise exception 'That person is not on this team' using errcode = 'P0002';
  end if;

  -- For an owner only the title and primaryContact mean anything; the row
  -- trigger drops the rest.
  update public.org_members
     set permissions = coalesce(new_permissions, '{}'::text[]),
         title = new_title
   where org_id = target_org and user_id = target_user
  returning * into member;
  return member;
end;
$$;

create or replace function public.set_member_role(
  target_org  uuid,
  target_user uuid,
  new_role    public.org_role
)
returns public.org_members
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  member public.org_members;
  kind   public.org_type;
begin
  if not public.is_org_owner(target_org) then
    raise exception 'Only an owner can make someone an owner' using errcode = '42501';
  end if;

  -- Lock every owner row of the company, so two owners demoting each other at
  -- the same moment cannot both succeed.
  perform 1 from public.org_members
    where org_id = target_org and role = 'owner' for update;

  select * into member from public.org_members
   where org_id = target_org and user_id = target_user for update;
  if member.user_id is null then
    raise exception 'That person is not on this team' using errcode = 'P0002';
  end if;
  if member.role = new_role then
    return member;
  end if;

  if new_role = 'member' and (
    select count(*) from public.org_members where org_id = target_org and role = 'owner'
  ) <= 1 then
    raise exception 'A company always keeps at least one owner. Make someone else an owner first.'
      using errcode = '23514', hint = 'last_owner';
  end if;

  select type into kind from public.orgs where id = target_org;
  update public.org_members
     set role = new_role,
         permissions = case
           when new_role = 'member'
             then public.default_member_permissions(kind, true)
                  || array(select p from unnest(member.permissions) p where p = 'primaryContact')
           else member.permissions
         end
   where org_id = target_org and user_id = target_user
  returning * into member;
  return member;
end;
$$;

-- Removing someone, or leaving. What they started stays with the company:
-- requests, quotes, messages, files and calls all belong to the company, not
-- to the person.
create or replace function public.remove_member(target_org uuid, target_user uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  member   public.org_members;
  leaving  boolean := target_user = auth.uid();
  who      text;
  org_name text;
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
    'Everything they worked on stays with the company.',
    jsonb_build_object('user_id', target_user)
  );
end;
$$;

revoke all on function public.set_member_access(uuid, uuid, text[], text) from public, anon;
revoke all on function public.set_member_role(uuid, uuid, public.org_role) from public, anon;
revoke all on function public.remove_member(uuid, uuid) from public, anon;
grant execute on function public.set_member_access(uuid, uuid, text[], text) to authenticated;
grant execute on function public.set_member_role(uuid, uuid, public.org_role) to authenticated;
grant execute on function public.remove_member(uuid, uuid) to authenticated;

-- Settings → Account. The company's name is not here: it is what staff
-- verified, so renaming goes through support.
create or replace function public.save_company_basics(
  target_org   uuid,
  new_email    text,
  new_phone    text,
  new_location text
)
returns public.org_contact_details
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  kind    public.org_type;
  details public.org_contact_details;
begin
  if not public.has_org_permission(target_org, 'settingsAccess') then
    raise exception 'You need Settings access to change the company''s details'
      using errcode = '42501', hint = 'missing_permission:settingsAccess';
  end if;

  select type into kind from public.orgs where id = target_org;

  insert into public.org_contact_details (org_id, email, phone, updated_at, updated_by)
  values (target_org,
          nullif(lower(btrim(coalesce(new_email, ''))), ''),
          nullif(btrim(coalesce(new_phone, '')), ''),
          now(), auth.uid())
  on conflict (org_id) do update
     set email = excluded.email, phone = excluded.phone,
         updated_at = now(), updated_by = auth.uid()
  returning * into details;

  if new_location is not null then
    if kind = 'brand' then
      update public.brand_profiles set hq_location = nullif(btrim(new_location), '') where org_id = target_org;
    else
      update public.factory_profiles set location = nullif(btrim(new_location), '') where org_id = target_org;
    end if;
  end if;
  return details;
end;
$$;

revoke all on function public.save_company_basics(uuid, text, text, text) from public, anon;
grant execute on function public.save_company_basics(uuid, text, text, text) to authenticated;

-- A permission changed or a person removed reaches their open screen.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'org_members'
  ) then
    alter publication supabase_realtime add table public.org_members;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Existing functions, each now asking for its permission
-- ---------------------------------------------------------------------------
-- submit_quote: RFQ flow (body from 20261022000400_quote_fixes.sql)
create or replace function public.submit_quote(quote_id uuid)
returns public.quotes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  q       public.quotes;
  r       public.rfqs;
  missing text[] := '{}';
  cost    integer := public.quote_credit_cost();
  balance integer;
  vendor  text;
begin
  select * into q from public.quotes where id = quote_id for update;
  if not found then
    raise exception 'quote not found' using errcode = 'P0002';
  end if;

  perform public.require_org_permission(q.factory_org_id, 'rfqFlow');
  if not public.is_org_member(q.factory_org_id) then
    raise exception 'only the quoting factory may submit this quote'
      using errcode = '42501';
  end if;

  if q.status <> 'draft' then
    raise exception 'quote is %, only a draft can be submitted', q.status
      using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.factory_profiles f
    where f.org_id = q.factory_org_id and f.verification_status = 'verified'
  ) then
    raise exception 'factory must be verified before quoting'
      using errcode = '42501';
  end if;

  select * into r from public.rfqs where id = q.rfq_id;
  if r.status <> 'open' then
    raise exception 'this request is %, and is no longer accepting quotes', r.status
      using errcode = '22023';
  end if;

  if r.quote_deadline is not null and now() > r.quote_deadline then
    raise exception 'the deadline for this request passed on %', r.quote_deadline
      using errcode = '22023';
  end if;

  -- Name every missing field at once rather than making the factory discover
  -- them one submit at a time.
  if q.unit_price_cents    is null then missing := array_append(missing, 'unit price'); end if;
  if q.production_quantity is null then missing := array_append(missing, 'production quantity'); end if;
  if q.bulk_lead_time_days is null then missing := array_append(missing, 'bulk lead time'); end if;
  if q.payment_term_id     is null then missing := array_append(missing, 'payment terms'); end if;
  if q.incoterm_id         is null then missing := array_append(missing, 'shipping terms'); end if;
  if q.valid_until         is null then missing := array_append(missing, 'quote valid until'); end if;

  if array_length(missing, 1) > 0 then
    raise exception 'quote is missing: %', array_to_string(missing, ', ')
      using errcode = '22023';
  end if;

  -- The same test award_quote makes, so a quote is never sent (and paid for)
  -- that the brand could not then choose. Before the charge.
  if q.valid_until < current_date then
    raise exception 'this quote expired on %; choose a later "quote valid until" date and send it again', q.valid_until
      using errcode = '22023';
  end if;

  -- Charged before the status changes, so a vendor who cannot pay never
  -- reaches "submitted". The message names the shortfall because the screen
  -- offers to buy credits and needs something true to say.
  balance := public.credit_balance(q.factory_org_id);
  if balance < cost then
    raise exception 'sending this quote costs % credits and you have %', cost, balance
      using errcode = '22023';
  end if;

  insert into public.credit_ledger (org_id, delta, reason, ref_type, ref_id, note)
  values (q.factory_org_id, -cost, 'quote_submission', 'quote', q.id,
          'Quote sent to ' || coalesce(r.title, 'a request'))
  -- Matches credit_ledger_once_idx, which is partial on ref_id.
  on conflict (org_id, reason, ref_id) where ref_id is not null do nothing;

  update public.quotes
     set status = 'submitted',
         submitted_at = now()
   where id = quote_id
  returning * into q;

  update public.rfq_invitations
     set status = 'viewed'
   where rfq_id = q.rfq_id
     and factory_org_id = q.factory_org_id
     and status = 'invited';

  -- New in 064. A second version is a revision the brand has already seen a
  -- first price for, so it is named as one.
  select name into vendor from public.orgs where id = q.factory_org_id;
  insert into public.notifications (org_id, kind, subject_type, subject_id, title, body)
  values (
    r.brand_org_id,
    'quote_received',
    'rfq',
    r.id,
    format('%s sent a %s on "%s"',
           coalesce(vendor, 'A vendor'),
           case when q.version > 1 then 'revised quote' else 'quote' end,
           coalesce(nullif(btrim(r.title), ''), 'your request')),
    'Compare it with the other quotes on this request.'
  );

  return q;
end;
$$;

-- revise_quote: RFQ flow (body from 20261026000100_quote_text_fields.sql)
create or replace function public.revise_quote(quote_id uuid)
returns public.quotes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  old_quote public.quotes;
  new_quote public.quotes;
  r         public.rfqs;
begin
  select * into old_quote from public.quotes q where q.id = quote_id for update;
  if not found then raise exception 'quote not found' using errcode = 'P0002'; end if;
  perform public.require_org_permission(old_quote.factory_org_id, 'rfqFlow');
  if not public.is_org_member(old_quote.factory_org_id) then
    raise exception 'only the quoting factory may revise this quote' using errcode = '42501';
  end if;
  if old_quote.status <> 'submitted' then
    raise exception 'quote is %, only a submitted quote can be revised', old_quote.status using errcode = '22023';
  end if;
  select * into r from public.rfqs where id = old_quote.rfq_id;
  if r.status <> 'open' then
    raise exception 'this request is % and can no longer be revised', r.status using errcode = '22023';
  end if;

  update public.quotes q set status = 'superseded' where q.id = quote_id;
  insert into public.quotes (
    rfq_id, factory_org_id, version, supersedes_quote_id, status,
    unit_price_cents, unit_price_max_cents, currency, production_quantity,
    bulk_lead_time_days, bulk_lead_time_max_days,
    capacity_window_start, capacity_window_end, capacity_window_units,
    payment_term_id, deposit_pct, balance_pct,
    incoterm_id, shipping_notes, valid_until, factory_notes, sourcing_includes, factory_response, created_by
  )
  select
    q.rfq_id, q.factory_org_id, q.version + 1, q.id, 'draft',
    q.unit_price_cents, q.unit_price_max_cents, q.currency, q.production_quantity,
    q.bulk_lead_time_days, q.bulk_lead_time_max_days,
    q.capacity_window_start, q.capacity_window_end, q.capacity_window_units,
    q.payment_term_id, q.deposit_pct, q.balance_pct,
    q.incoterm_id, q.shipping_notes, q.valid_until, q.factory_notes, q.sourcing_includes, q.factory_response, auth.uid()
  from public.quotes q where q.id = quote_id
  returning * into new_quote;

  insert into public.quote_sample_lines (
    quote_id, stage, cost_cents, currency, timing_days, timing_max_days, includes, sort
  )
  select
    new_quote.id, l.stage, l.cost_cents, l.currency, l.timing_days, l.timing_max_days, l.includes, l.sort
  from public.quote_sample_lines l where l.quote_id = old_quote.id;

  insert into public.quote_material_lines (quote_id, material, cost_cents, currency, included, sort)
  select new_quote.id, l.material, l.cost_cents, l.currency, l.included, l.sort
  from public.quote_material_lines l where l.quote_id = old_quote.id;

  insert into public.quote_question_answers (quote_id, question_id, answer_text)
  select new_quote.id, a.question_id, a.answer_text
  from public.quote_question_answers a where a.quote_id = old_quote.id;

  return new_quote;
end;
$$;

-- withdraw_quote: RFQ flow (body from 20260930000200_rfq_notifications.sql)
create or replace function public.withdraw_quote(quote_id uuid)
returns public.quotes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  q        public.quotes;
  was      public.quote_status;
  r        public.rfqs;
  vendor   text;
begin
  select * into q from public.quotes where id = quote_id for update;
  if not found then
    raise exception 'quote not found' using errcode = 'P0002';
  end if;

  perform public.require_org_permission(q.factory_org_id, 'rfqFlow');
  if not public.is_org_member(q.factory_org_id) then
    raise exception 'only the quoting factory may withdraw this quote'
      using errcode = '42501';
  end if;

  if q.status not in ('draft', 'submitted') then
    raise exception 'quote is % and cannot be withdrawn', q.status
      using errcode = '22023';
  end if;

  was := q.status;

  update public.quotes
     set status = 'withdrawn', decided_at = now()
   where id = quote_id
  returning * into q;

  if was = 'submitted' then
    select * into r from public.rfqs where id = q.rfq_id;
    select name into vendor from public.orgs where id = q.factory_org_id;
    insert into public.notifications (org_id, kind, subject_type, subject_id, title, body)
    values (
      r.brand_org_id,
      'quote_withdrawn',
      'rfq',
      r.id,
      format('%s withdrew its quote on "%s"',
             coalesce(vendor, 'A vendor'),
             coalesce(nullif(btrim(r.title), ''), 'your request')),
      'It no longer appears in your comparison.'
    );
  end if;

  return q;
end;
$$;

-- award_quote: Quote flow, was owner only (body from 20260930000400_brand_sets_schedule.sql)
create or replace function public.award_quote(quote_id uuid)
returns public.quotes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  q            public.quotes;
  r            public.rfqs;
  o            public.production_orders;
  factory_name text;
  rfq_title    text;
begin
  select * into q from public.quotes where id = quote_id for update;
  if not found then
    raise exception 'quote not found' using errcode = 'P0002';
  end if;

  -- Locking the RFQ as well as the quote is load-bearing, not defensive. Two
  -- brand members awarding two different quotes on the same RFQ milliseconds
  -- apart would otherwise both pass the "is it open" check below and the RFQ
  -- would end with two accepted quotes.
  select * into r from public.rfqs where id = q.rfq_id for update;

  perform public.require_org_permission(r.brand_org_id, 'rfqFlow');
  if not public.is_org_member(r.brand_org_id) then
    raise exception 'only the requesting brand may award a quote'
      using errcode = '42501';
  end if;

  if r.status <> 'open' then
    raise exception 'this request is %, so it cannot be awarded', r.status
      using errcode = '22023';
  end if;

  -- Covers draft, withdrawn, already decided, and — the one that matters —
  -- superseded. A brand reads a quote, the factory revises it, the brand
  -- awards the row it was looking at. That must be refused, not accepted.
  if q.status <> 'submitted' then
    raise exception 'this quote is % and cannot be awarded; the factory may have revised it', q.status
      using errcode = '22023';
  end if;

  if q.valid_until is not null and q.valid_until < current_date then
    raise exception 'this quote expired on %', q.valid_until
      using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.factory_profiles f
    where f.org_id = q.factory_org_id and f.verification_status = 'verified'
  ) then
    raise exception 'this factory is no longer verified'
      using errcode = '22023';
  end if;

  select name into factory_name from public.orgs where id = q.factory_org_id;
  rfq_title := coalesce(nullif(btrim(r.title), ''), 'your request');

  update public.quotes
     set status = 'accepted', decided_at = now()
   where id = quote_id
  returning * into q;

  -- Only other LIVE submissions are declined. Superseded, draft and withdrawn
  -- rows are already out of the running and keep their own history.
  update public.quotes
     set status = 'declined', decided_at = now()
   where rfq_id = r.id
     and id <> quote_id
     and status = 'submitted';

  update public.rfqs
     set status = 'awarded',
         awarded_quote_id = quote_id,
         awarded_at = now()
   where id = r.id;

  -- The order and its draft schedule, in this same transaction. A window in
  -- which a quote is accepted but its order does not exist would be a state
  -- with no screen and no way out.
  o := public.create_order_from_award(quote_id);

  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  select
    d.factory_org_id,
    case when d.factory_org_id = q.factory_org_id then 'quote_accepted' else 'quote_declined' end,
    case when d.factory_org_id = q.factory_org_id then 'order' else 'rfq' end,
    case when d.factory_org_id = q.factory_org_id then o.id else r.id end,
    case when d.factory_org_id = q.factory_org_id then o.id else null end,
    case
      when d.factory_org_id = q.factory_org_id then 'Your quote was accepted'
      else 'Your quote was not selected'
    end,
    case
      when d.factory_org_id = q.factory_org_id
        then format('%s accepted your quote for "%s". The brand is setting the production steps; you will be told when they start.',
                    (select name from public.orgs where id = r.brand_org_id), rfq_title)
      else format('"%s" was awarded to another factory. Thank you for quoting.', rfq_title)
    end
  from (
    select distinct factory_org_id
    from public.quotes
    where rfq_id = r.id and status in ('accepted', 'declined')
  ) d;

  -- The brand has something to do now too, and nothing else would tell it.
  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  values (
    r.brand_org_id, 'order_created', 'order', o.id, o.id,
    format('Production order %s is ready', o.order_number),
    format('%s accepted. Review the production steps drafted from their quote, then confirm them to start.',
           factory_name)
  );

  return q;
end;
$$;

-- cancel_rfq: Quote flow, was owner only (body from 20260930000100_rfq_cancel_and_documents.sql)
create or replace function public.cancel_rfq(target_rfq uuid, reason text default null)
returns public.rfqs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r          public.rfqs;
  brand_name text;
begin
  -- First statement, before any select: an unknown id and someone else's id
  -- must be refused identically, or the error code says which requests exist.
  perform public.require_org_permission(public.rfq_brand_org(target_rfq), 'rfqFlow');
  if not public.is_org_member(public.rfq_brand_org(target_rfq)) then
    raise exception 'only the brand can cancel this request'
      using errcode = '42501';
  end if;

  select * into r from public.rfqs where id = target_rfq for update;

  -- Awarded is final: it has a production order, and that order is cancelled
  -- through propose_cancellation / accept_cancellation, by both parties.
  if r.status not in ('draft', 'open') then
    raise exception 'this request is % and can no longer be cancelled', r.status
      using errcode = '22023';
  end if;

  select name into brand_name from public.orgs where id = r.brand_org_id;

  -- Tell every vendor that was invited or had a quote in progress, BEFORE the
  -- quotes change, so a vendor whose quote is about to be closed is included.
  insert into public.notifications (org_id, kind, subject_type, subject_id, title, body)
  select vendor.org_id,
         'rfq_cancelled',
         'rfq',
         r.id,
         format('%s cancelled "%s"', coalesce(brand_name, 'The brand'), coalesce(r.title, 'a request')),
         coalesce(nullif(btrim(reason), ''), 'The brand is no longer taking quotes on this request.')
    from (
      select factory_org_id as org_id from public.rfq_invitations where rfq_id = r.id
      union
      select factory_org_id from public.quotes where rfq_id = r.id and status in ('draft', 'submitted')
    ) vendor;

  -- A sent quote was not chosen; a draft was never sent. Same words award_quote
  -- uses for the losers, so the vendor's screens need no new status.
  update public.quotes set status = 'declined', decided_at = now()
   where rfq_id = r.id and status = 'submitted';
  update public.quotes set status = 'withdrawn', decided_at = now()
   where rfq_id = r.id and status = 'draft';

  update public.rfqs set status = 'cancelled' where id = r.id returning * into r;
  return r;
end;
$$;

-- save_contract_attachments: Quote flow, was owner only (body from 20261026000200_contract_attachments.sql)
create or replace function public.save_contract_attachments(target_quote uuid, selected_documents uuid[])
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare q public.quotes; r public.rfqs;
begin
  select * into q from public.quotes where id = target_quote for update;
  select * into r from public.rfqs where id = q.rfq_id for update;
  perform public.require_org_permission(r.brand_org_id, 'rfqFlow');
  if r.id is null or not public.is_org_member(r.brand_org_id) then
    raise exception 'Only the requesting brand can edit contract attachments' using errcode = '42501';
  end if;
  if q.status <> 'submitted' or r.status <> 'open'
    or exists (select 1 from public.production_orders where quote_id = target_quote) then
    raise exception 'Contract attachments can no longer be edited' using errcode = '22023';
  end if;
  if selected_documents is null or exists (
    select 1 from unnest(selected_documents) s(id)
    where not exists (
      select 1 from public.documents d where d.id = s.id and d.org_id = r.brand_org_id
      and (d.rfq_id = r.id or (d.kind = 'contract' and d.bucket = 'org-private'
        and split_part(d.storage_path, '/', 3) = q.id::text))
    )
  ) then
    raise exception 'Choose files belonging to this request or contract' using errcode = '22023';
  end if;
  insert into public.quote_contract_attachments values (target_quote, selected_documents)
  on conflict (quote_id) do update set document_ids = excluded.document_ids;
end;
$$;

-- set_order_schedule: Quote flow (body from 20260930000400_brand_sets_schedule.sql)
create or replace function public.set_order_schedule(target_order uuid, lines jsonb)
returns setof public.order_milestones
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  o        public.production_orders;
  item     jsonb;
  idx      integer := 0;
  kind     public.milestone_type;
  amount   bigint;
  total    bigint := 0;
  is_brand boolean;
begin
  select * into o from public.production_orders where id = target_order for update;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;

  perform public.require_org_permission(o.brand_org_id, 'rfqFlow');
  is_brand := public.is_org_member(o.brand_org_id);

  -- A platform admin is deliberately NOT permitted here, or in agree_schedule.
  -- Admins confirm that money arrived; they do not sign a commercial agreement
  -- on a party's behalf. The one place staff can end an order is
  -- admin_close_order, which is an explicit act with a reason attached.
  --
  -- Only the brand changes the steps. The factory is told of every change
  -- and, if one does not work for it, says so in the order's conversation.
  if not is_brand then
    if public.is_org_member(o.factory_org_id) then
      raise exception 'only the brand changes the production steps; if something does not work for you, message the brand'
        using errcode = '42501';
    end if;
    raise exception 'only the brand on this order may change its schedule'
      using errcode = '42501';
  end if;

  if o.status <> 'pending_schedule' then
    raise exception 'this schedule is already agreed; a change to the terms needs a new quote'
      using errcode = '22023';
  end if;

  if jsonb_typeof(lines) <> 'array' or jsonb_array_length(lines) = 0 then
    raise exception 'a schedule needs at least one milestone' using errcode = '22023';
  end if;

  -- Validate everything before deleting anything.
  for item in select * from jsonb_array_elements(lines) loop
    idx := idx + 1;

    begin
      kind := (item ->> 'kind')::public.milestone_type;
    exception when others then
      raise exception 'step % has an unknown kind "%"', idx, item ->> 'kind'
        using errcode = '22023';
    end;

    if length(btrim(coalesce(item ->> 'title', ''))) = 0 then
      raise exception 'step % needs a title', idx using errcode = '22023';
    end if;

    amount := nullif(item ->> 'amount_cents', '')::bigint;

    if kind in ('approval_and_payment', 'payment_only') then
      if amount is null or amount <= 0 then
        raise exception 'step % ("%") involves a payment, so it needs an amount',
          idx, item ->> 'title' using errcode = '22023';
      end if;
      total := total + amount;
    elsif amount is not null then
      raise exception 'step % ("%") has no payment, so it cannot carry an amount',
        idx, item ->> 'title' using errcode = '22023';
    end if;
  end loop;

  if total <> o.order_total_cents then
    raise exception 'the steps total %.2f but the agreed order is %.2f',
      total / 100.0, o.order_total_cents / 100.0 using errcode = '22023';
  end if;

  delete from public.order_milestones where order_id = o.id;

  idx := 0;
  for item in select * from jsonb_array_elements(lines) loop
    idx := idx + 1;
    insert into public.order_milestones
      (order_id, sort, kind, title, description, amount_cents, currency, due_on)
    values (
      o.id,
      coalesce(nullif(item ->> 'sort', '')::integer, idx * 10),
      (item ->> 'kind')::public.milestone_type,
      btrim(item ->> 'title'),
      nullif(btrim(coalesce(item ->> 'description', '')), ''),
      nullif(item ->> 'amount_cents', '')::bigint,
      o.currency,   -- explicit, never inherited from the column default
      nullif(item ->> 'due_on', '')::date
    );
  end loop;

  -- Any edit withdraws any confirmation already on record (including one a
  -- factory gave under the old two-sided rule): a signature never survives a
  -- change it did not see.
  update public.production_orders
     set schedule_revision = schedule_revision + 1,
         schedule_brand_agreed_at = null,
         schedule_brand_agreed_by = null,
         schedule_factory_agreed_at = null,
         schedule_factory_agreed_by = null
   where id = o.id;

  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  values (
    o.factory_org_id,
    'schedule_updated', 'order', o.id, o.id,
    format('The brand changed the production steps on %s', o.order_number),
    'Nothing starts until the brand confirms them. If something does not work for you, message the brand.'
  );

  return query select * from public.order_milestones where order_id = o.id order by sort;
end;
$$;

-- update_order_milestone_details: Quote flow (body from 20261013000200_stripe_payments.sql)
create or replace function public.update_order_milestone_details(target_order uuid, lines jsonb)
returns setof public.order_milestones
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  o public.production_orders;
  item jsonb;
  existing public.order_milestones;
  payment public.order_payments;
  item_id uuid;
  item_kind public.milestone_type;
  item_amount bigint;
  total bigint := 0;
  idx integer := 0;
  has_payment boolean;
  commercial_changed boolean;
  desired_payment_state public.payment_state;
begin
  select * into o from public.production_orders where id = target_order for update;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;

  perform public.require_org_permission(o.brand_org_id, 'rfqFlow');
  if not public.is_org_member(o.brand_org_id) then
    raise exception 'only the brand on this order may manage its milestones'
      using errcode = '42501';
  end if;

  if o.status not in ('pending_schedule', 'active') then
    raise exception 'milestones cannot be changed on this order'
      using errcode = '22023';
  end if;

  if jsonb_typeof(lines) <> 'array' or jsonb_array_length(lines) = 0 then
    raise exception 'a schedule needs at least one milestone' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(lines) entry
    where nullif(entry ->> 'id', '') is not null
    group by entry ->> 'id'
    having count(*) > 1
  ) then
    raise exception 'a milestone appears more than once' using errcode = '22023';
  end if;

  -- Validate the complete proposed schedule before touching any row.
  for item in select * from jsonb_array_elements(lines) loop
    idx := idx + 1;
    begin
      item_kind := (item ->> 'kind')::public.milestone_type;
      item_id := nullif(item ->> 'id', '')::uuid;
      item_amount := nullif(item ->> 'amount_cents', '')::bigint;
    exception when others then
      raise exception 'step % contains an invalid id, type, or amount', idx
        using errcode = '22023';
    end;

    if length(btrim(coalesce(item ->> 'title', ''))) = 0 then
      raise exception 'step % needs a title', idx using errcode = '22023';
    end if;

    if item_kind in ('approval_and_payment', 'payment_only') then
      if item_amount is null or item_amount <= 0 then
        raise exception 'step % involves a payment, so it needs an amount', idx
          using errcode = '22023';
      end if;
      total := total + item_amount;
    elsif item_amount is not null then
      raise exception 'step % has no payment, so it cannot carry an amount', idx
        using errcode = '22023';
    end if;

    if item_id is not null and not exists (
      select 1 from public.order_milestones
      where id = item_id and order_id = target_order
    ) then
      raise exception 'a milestone does not belong to this order'
        using errcode = '22023';
    end if;
  end loop;

  if total <> o.order_total_cents then
    raise exception 'the steps total %.2f but the agreed order is %.2f',
      total / 100.0, o.order_total_cents / 100.0 using errcode = '22023';
  end if;

  -- Omitted rows are removals. Work that has started is history, not a form
  -- row, and a payment that moved beyond not-due must never disappear.
  for existing in
    select m.*
    from public.order_milestones m
    where m.order_id = target_order
      and not exists (
        select 1 from jsonb_array_elements(lines) entry
        where nullif(entry ->> 'id', '') = m.id::text
      )
    for update
  loop
    if existing.state <> 'pending' then
      raise exception '"%" has already started and cannot be removed', existing.title
        using errcode = '22023';
    end if;
    if exists (select 1 from public.milestone_updates where milestone_id = existing.id) then
      raise exception '"%" has updates and cannot be removed', existing.title
        using errcode = '22023';
    end if;
    if exists (
      select 1 from public.order_payments
      where milestone_id = existing.id and state <> 'not_due'
    ) then
      raise exception '"%" has payment activity and cannot be removed', existing.title
        using errcode = '22023';
    end if;
  end loop;

  delete from public.order_milestones m
  where m.order_id = target_order
    and not exists (
      select 1 from jsonb_array_elements(lines) entry
      where nullif(entry ->> 'id', '') = m.id::text
    );

  idx := 0;
  for item in select * from jsonb_array_elements(lines) loop
    idx := idx + 1;
    item_id := nullif(item ->> 'id', '')::uuid;
    item_kind := (item ->> 'kind')::public.milestone_type;
    item_amount := nullif(item ->> 'amount_cents', '')::bigint;

    if item_id is null then
      insert into public.order_milestones
        (order_id, sort, kind, title, description, amount_cents, currency, due_on, state)
      values (
        target_order,
        coalesce(nullif(item ->> 'sort', '')::integer, idx * 10),
        item_kind,
        btrim(item ->> 'title'),
        nullif(btrim(coalesce(item ->> 'description', '')), ''),
        item_amount,
        o.currency,
        nullif(item ->> 'due_on', '')::date,
        'pending'
      ) returning id into item_id;

      if item_kind in ('approval_and_payment', 'payment_only') then
        insert into public.order_payments
          (order_id, milestone_id, amount_cents, currency, state)
        values (target_order, item_id, item_amount, o.currency, 'not_due');
      end if;
      continue;
    end if;

    select * into existing
    from public.order_milestones
    where id = item_id and order_id = target_order
    for update;

    select * into payment
    from public.order_payments
    where milestone_id = item_id
    for update;
    has_payment := found;

    commercial_changed := existing.kind is distinct from item_kind
      or existing.amount_cents is distinct from item_amount;

    if commercial_changed and existing.state not in ('pending', 'active') then
      raise exception '"%" is already under review or complete, so its payment type cannot change', existing.title
        using errcode = '22023';
    end if;

    if commercial_changed and has_payment and payment.state not in ('not_due', 'due') then
      raise exception '"%" has payment activity, so its amount or type cannot change', existing.title
        using errcode = '22023';
    end if;

    if has_payment and item_kind not in ('approval_and_payment', 'payment_only') then
      delete from public.order_payments where id = payment.id;
      has_payment := false;
    end if;

    update public.order_milestones
       set kind = item_kind,
           title = btrim(item ->> 'title'),
           description = nullif(btrim(coalesce(item ->> 'description', '')), ''),
           amount_cents = item_amount,
           due_on = nullif(item ->> 'due_on', '')::date,
           sort = coalesce(nullif(item ->> 'sort', '')::integer, idx * 10)
     where id = item_id;

    if item_kind in ('approval_and_payment', 'payment_only') then
      desired_payment_state := case
        when existing.state in ('active', 'submitted', 'approved') then 'due'::public.payment_state
        else 'not_due'::public.payment_state
      end;

      if has_payment then
        -- Only money that has not moved follows the step. Anything paid,
        -- clearing, failed or held keeps its state and its history.
        if payment.state in ('not_due', 'due') then
          if payment.state is distinct from desired_payment_state then
            insert into public.payment_events
              (payment_id, from_state, to_state, actor_user_id, actor_kind, note)
            values (
              payment.id, payment.state, desired_payment_state, auth.uid(), 'brand',
              'Payment timing changed while managing production steps.'
            );
          end if;
          update public.order_payments
             set amount_cents = item_amount,
                 state = desired_payment_state,
                 due_at = case when desired_payment_state = 'due' then coalesce(due_at, now()) else null end
           where id = payment.id;
        end if;
      else
        insert into public.order_payments
          (order_id, milestone_id, amount_cents, currency, state, due_at)
        values (
          target_order, item_id, item_amount, o.currency, desired_payment_state,
          case when desired_payment_state = 'due' then now() else null end
        );
      end if;
    end if;
  end loop;

  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  values (
    o.factory_org_id, 'schedule_updated', 'order', o.id, o.id,
    format('The brand updated milestones on %s', o.order_number),
    'Review the updated production steps, payment amounts, and due dates.'
  );

  return query
    select * from public.order_milestones
    where order_id = target_order
    order by sort;
end;
$$;

-- agree_schedule: Quote flow, brand side (body from 20260930000400_brand_sets_schedule.sql)
create or replace function public.agree_schedule(target_order uuid, revision integer)
returns public.production_orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  o          public.production_orders;
  is_brand   boolean;
  is_factory boolean;
  total      bigint;
begin
  select * into o from public.production_orders where id = target_order for update;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;

  is_brand   := public.is_org_member(o.brand_org_id);
  is_factory := public.is_org_member(o.factory_org_id);

  if is_brand and is_factory then
    raise exception 'an order cannot be agreed by someone who is a party to both sides'
      using errcode = '42501';
  end if;
  if is_brand then
    perform public.require_org_permission(o.brand_org_id, 'rfqFlow');
  end if;
  if not (is_brand or is_factory) then
    raise exception 'only the brand or the factory on this order may agree its schedule'
      using errcode = '42501';
  end if;

  if o.status <> 'pending_schedule' then
    raise exception 'this order is % and its schedule is settled', o.status
      using errcode = '22023';
  end if;

  if revision <> o.schedule_revision then
    raise exception 'the schedule changed while you were reading it; reload and agree again'
      using errcode = '22023';
  end if;

  -- Cheap, and catches a service_role edit that went around set_order_schedule.
  select coalesce(sum(amount_cents), 0) into total
  from public.order_milestones where order_id = o.id;
  if total <> o.order_total_cents then
    raise exception 'the steps no longer total the agreed order value'
      using errcode = '22023';
  end if;

  -- The brand's confirmation starts the order. A brand that agreed under the
  -- old two-sided rule and was left waiting on the factory confirms again and
  -- the order starts, rather than being told it already agreed.
  if is_brand then
    if o.schedule_brand_agreed_at is null then
      update public.production_orders
         set schedule_brand_agreed_at = now(), schedule_brand_agreed_by = auth.uid()
       where id = o.id returning * into o;
    end if;
    o := public.activate_order(o.id);
  else
    -- A factory agreeing (the current site still offers it) is recorded and
    -- the brand told, but it no longer decides anything.
    if o.schedule_factory_agreed_at is not null then
      raise exception 'your side has already agreed this schedule' using errcode = '22023';
    end if;
    update public.production_orders
       set schedule_factory_agreed_at = now(), schedule_factory_agreed_by = auth.uid()
     where id = o.id returning * into o;

    insert into public.notifications
      (org_id, kind, subject_type, subject_id, order_id, title, body)
    values (
      o.brand_org_id,
      'schedule_agreed', 'order', o.id, o.id,
      format('The factory agreed the production steps on %s', o.order_number),
      'Confirm them and the order starts.'
    );
  end if;

  return o;
end;
$$;

-- approve_milestone: Approve samples, plus Release funds for a paid step (body from 20261026000400_approve_without_comments.sql)
create or replace function public.approve_milestone(target_milestone uuid, note text default null)
returns public.order_milestones
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.order_milestones;
  o public.production_orders;
  p public.order_payments;
begin
  select * into o from public.production_orders
   where id = (select order_id from public.order_milestones where id = target_milestone)
   for update;
  if not found then
    raise exception 'milestone not found' using errcode = 'P0002';
  end if;

  select * into m from public.order_milestones where id = target_milestone for update;

  if o.status <> 'active' then
    raise exception 'this order is %', o.status using errcode = '22023';
  end if;

  if m.kind = 'payment_only' then
    raise exception 'there is nothing to approve on a payment step' using errcode = '22023';
  end if;

  -- Approving a paid step releases money, so it takes an owner, matching
  -- award_quote. Signing off a lab dip does not, and requiring an owner for
  -- every colour approval would put the founder in the middle of daily work.
  -- Approving is Approve samples; a step that releases money also needs
  -- Release funds (both, so neither alone pays a factory).
  if not public.is_org_member(o.brand_org_id) then
    raise exception 'only the brand on this order approves its steps' using errcode = '42501';
  end if;
  perform public.require_org_permission(o.brand_org_id, 'approve');
  if m.kind = 'approval_and_payment' then
    perform public.require_org_permission(o.brand_org_id, 'releaseFunds');
  end if;

  -- Active or submitted steps can be approved without a comment. Completed
  -- and future steps remain protected, including concurrent approvals.
  if m.state not in ('active', 'submitted') then
    raise exception 'that step is %, so it is not waiting on you', m.state
      using errcode = '22023';
  end if;

  if m.kind = 'approval_and_payment' then
    select * into p from public.order_payments where milestone_id = m.id for update;

    -- Approving pays the factory, so there has to be money to pay it with.
    if not found or p.state <> 'confirmed' then
      raise exception 'fund "%" first: TSC pays the factory from the money it holds when you approve',
        m.title using errcode = '22023';
    end if;

    update public.order_milestones
       set state = 'complete', approved_by = auth.uid(), approved_at = now(),
           approval_note = nullif(btrim(coalesce(note, '')), ''), completed_at = now()
     where id = m.id
    returning * into m;

    update public.order_payments
       set release_requested_at = now()
     where id = p.id
    returning * into p;

    insert into public.notifications
      (org_id, kind, subject_type, subject_id, order_id, title, body)
    values (
      o.factory_org_id, 'milestone_approved', 'milestone', m.id, o.id,
      format('"%s" was approved', m.title),
      coalesce(
        nullif(btrim(coalesce(note, '')), ''),
        format('The brand approved this step. %s held by TSC is on its way to you.',
               public.format_money(p.amount_cents, p.currency))
      )
    );

    -- The chain moves on the brand's approval, never on the payout: a
    -- transfer that fails must not freeze the order.
    perform public.advance_order_chain(o.id);
  else
    update public.order_milestones
       set state = 'complete', approved_by = auth.uid(), approved_at = now(),
           approval_note = nullif(btrim(coalesce(note, '')), ''), completed_at = now()
     where id = m.id
    returning * into m;

    insert into public.notifications
      (org_id, kind, subject_type, subject_id, order_id, title, body)
    values (
      o.factory_org_id, 'milestone_approved', 'milestone', m.id, o.id,
      format('"%s" was approved', m.title),
      coalesce(nullif(btrim(coalesce(note, '')), ''), 'You can carry on to the next step.')
    );

    perform public.advance_order_chain(o.id);
  end if;

  return m;
end;
$$;

-- initiate_milestone_dispute: Approve samples (body from 20261011000100_milestone_disputes.sql)
create or replace function public.initiate_milestone_dispute(
  target_milestone uuid,
  reason text,
  document_ids uuid[] default '{}'
)
returns public.milestone_updates
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.order_milestones;
  o public.production_orders;
  u public.milestone_updates;
  doc public.documents;
  d uuid;
begin
  select * into m from public.order_milestones where id = target_milestone;
  if not found then
    raise exception 'milestone not found' using errcode = 'P0002';
  end if;

  select * into o from public.production_orders where id = m.order_id for share;

  perform public.require_org_permission(o.brand_org_id, 'approve');
  if not public.is_org_member(o.brand_org_id) then
    raise exception 'only the brand on this order can initiate a dispute'
      using errcode = '42501';
  end if;
  if o.status <> 'active' then
    raise exception 'this order is %, so a dispute cannot be opened', o.status
      using errcode = '22023';
  end if;
  if m.state not in ('active', 'submitted') then
    raise exception 'that step is %, so a dispute cannot be opened', m.state
      using errcode = '22023';
  end if;
  if length(btrim(coalesce(reason, ''))) = 0 then
    raise exception 'a dispute needs a reason' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.milestone_updates
    where milestone_id = m.id and kind = 'dispute'
  ) then
    raise exception 'a dispute is already open on this step' using errcode = '22023';
  end if;

  insert into public.milestone_updates
    (milestone_id, author_org_id, kind, body, created_by)
  values
    (m.id, o.brand_org_id, 'dispute', btrim(reason), auth.uid())
  returning * into u;

  foreach d in array coalesce(document_ids, '{}') loop
    select * into doc from public.documents where id = d;
    if not found then
      raise exception 'one of those files does not exist' using errcode = 'P0002';
    end if;
    if doc.org_id <> o.brand_org_id then
      raise exception 'you can only attach your own files' using errcode = '42501';
    end if;
    if doc.kind <> 'milestone_update' then
      raise exception 'that file was not uploaded as milestone evidence' using errcode = '22023';
    end if;
    if doc.milestone_update_id is not null then
      raise exception 'that file is already attached to an update' using errcode = '22023';
    end if;
    update public.documents set milestone_update_id = u.id where id = d;
  end loop;

  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  values
    (o.factory_org_id, 'milestone_dispute', 'milestone', m.id, o.id,
     format('Dispute opened on "%s"', m.title), left(btrim(reason), 160));

  return u;
end;
$$;

-- begin_payment_checkout: Release funds, was owner only (body from 20261013000200_stripe_payments.sql)
create or replace function public.begin_payment_checkout(target_payment uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p public.order_payments;
  o public.production_orders;
  m public.order_milestones;
  fee bigint;
begin
  select * into p from public.order_payments where id = target_payment;
  if not found then
    raise exception 'payment not found' using errcode = 'P0002';
  end if;

  select * into o from public.production_orders where id = p.order_id;

  perform public.require_org_permission(o.brand_org_id, 'releaseFunds');
  if not public.is_org_member(o.brand_org_id) then
    raise exception 'only the brand on this order pays for its steps' using errcode = '42501';
  end if;

  if o.status <> 'active' then
    raise exception 'this order is %', o.status using errcode = '22023';
  end if;

  if p.state not in ('due', 'failed') then
    raise exception 'that payment is %, so there is nothing to pay', p.state
      using errcode = '22023';
  end if;

  select * into m from public.order_milestones where id = p.milestone_id;
  fee := public.payment_fee_cents(p.id);

  return jsonb_build_object(
    'payment_id', p.id,
    'order_id', o.id,
    'order_number', o.order_number,
    'brand_org_id', o.brand_org_id,
    'factory_org_id', o.factory_org_id,
    'milestone_title', m.title,
    'amount_cents', p.amount_cents,
    'fee_bps', p.fee_bps,
    'fee_cents', fee,
    'charged_cents', p.amount_cents + fee,
    'currency', p.currency,
    'state', p.state,
    'stripe_payment_intent_id', p.stripe_payment_intent_id
  );
end;
$$;

-- mark_payment_sent: Release funds, was owner only (body from 20260905000900_payment_lifecycle.sql)
create or replace function public.mark_payment_sent(
  target_payment uuid,
  reference text default null,
  note text default null
)
returns public.order_payments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p public.order_payments;
  o public.production_orders;
begin
  select * into p from public.order_payments where id = target_payment for update;
  if not found then
    raise exception 'payment not found' using errcode = 'P0002';
  end if;

  select * into o from public.production_orders where id = p.order_id;

  -- Owner, not member: this is a statement that money left the company.
  perform public.require_org_permission(o.brand_org_id, 'releaseFunds');
  if not public.is_org_member(o.brand_org_id) then
    raise exception 'only the brand on this order records a payment as sent' using errcode = '42501';
  end if;

  if o.status <> 'active' then
    raise exception 'this order is %', o.status using errcode = '22023';
  end if;

  if p.state <> 'due' then
    raise exception 'that payment is %, not due', p.state using errcode = '22023';
  end if;

  update public.order_payments
     set state = 'sent', sent_by = auth.uid(), sent_at = now(),
         brand_reference = nullif(btrim(coalesce(reference, '')), ''),
         sent_note = nullif(btrim(coalesce(note, '')), '')
   where id = p.id
  returning * into p;

  insert into public.payment_events (payment_id, from_state, to_state, actor_user_id, actor_kind)
  values (p.id, 'due', 'sent', auth.uid(), 'brand');

  -- The factory is told, and told carefully. "Sent" is the brand's claim, not
  -- an arrival, and nothing here may imply work can start.
  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  values (
    o.factory_org_id, 'payment_sent', 'payment', p.id, o.id,
    format('%s says a payment is on its way', (select name from public.orgs where id = o.brand_org_id)),
    format('%s on %s. We will confirm here once it lands — please do not start on this yet.',
           public.format_money(p.amount_cents, p.currency), o.order_number)
  );

  return p;
end;
$$;

-- post_milestone_update: Add update, factory side only (brand comments stay open) (body from 20261025000100_completed_step_comments.sql)
create or replace function public.post_milestone_update(
  target_milestone uuid,
  body text,
  document_ids uuid[] default '{}'
)
returns public.milestone_updates
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m      public.order_milestones;
  o      public.production_orders;
  u      public.milestone_updates;
  doc    public.documents;
  d      uuid;
  author uuid;
  reader uuid;
begin
  select * into m from public.order_milestones where id = target_milestone;
  if not found then
    raise exception 'milestone not found' using errcode = 'P0002';
  end if;

  select * into o from public.production_orders where id = m.order_id for share;

  if public.is_org_member(o.factory_org_id) then
    author := o.factory_org_id;
    perform public.require_org_permission(o.factory_org_id, 'addUpdate');
    reader := o.brand_org_id;
  elsif public.is_org_member(o.brand_org_id) then
    author := o.brand_org_id;
    reader := o.factory_org_id;
  else
    raise exception 'only the two parties to this order post on its steps' using errcode = '42501';
  end if;

  if o.status not in ('active', 'completed') then
    raise exception 'this order is %, so there is nothing to report against yet', o.status
      using errcode = '22023';
  end if;

  if m.state not in ('active', 'submitted', 'complete') then
    raise exception 'that step is %, so it cannot take an update', m.state
      using errcode = '22023';
  end if;

  if length(btrim(coalesce(body, ''))) = 0 then
    raise exception 'an update needs a note saying what happened' using errcode = '22023';
  end if;

  insert into public.milestone_updates (milestone_id, author_org_id, body, created_by)
  values (m.id, author, btrim(body), auth.uid())
  returning * into u;

  foreach d in array coalesce(document_ids, '{}') loop
    select * into doc from public.documents where id = d;
    if not found then
      raise exception 'one of those files does not exist' using errcode = 'P0002';
    end if;
    if doc.org_id <> author then
      raise exception 'you can only attach your own files' using errcode = '42501';
    end if;
    if doc.kind <> 'milestone_update' then
      raise exception 'that file was not uploaded as an update photo' using errcode = '22023';
    end if;
    -- Stops an already-attached document being re-parented onto a second
    -- update, which is how one order's photo would reach another's parties.
    if doc.milestone_update_id is not null then
      raise exception 'that file is already attached to an update' using errcode = '22023';
    end if;

    update public.documents set milestone_update_id = u.id where id = d;
  end loop;

  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  values (
    reader, 'milestone_update', 'milestone', m.id, o.id,
    case when author = o.factory_org_id
      then format('New update on "%s"', m.title)
      else format('New comment on "%s"', m.title)
    end,
    left(btrim(body), 160)
  );

  return u;
end;
$$;

-- submit_milestone: Add update (body from 20260905000800_milestone_lifecycle.sql)
create or replace function public.submit_milestone(target_milestone uuid)
returns public.order_milestones
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.order_milestones;
  o public.production_orders;
begin
  select * into m from public.order_milestones where id = target_milestone for update;
  if not found then
    raise exception 'milestone not found' using errcode = 'P0002';
  end if;

  select * into o from public.production_orders where id = m.order_id;

  perform public.require_org_permission(o.factory_org_id, 'addUpdate');
  if not public.is_org_member(o.factory_org_id) then
    raise exception 'only the factory sends a step for approval' using errcode = '42501';
  end if;
  if o.status <> 'active' then
    raise exception 'this order is %', o.status using errcode = '22023';
  end if;
  if m.kind = 'payment_only' then
    raise exception 'a payment step has nothing to send for approval' using errcode = '22023';
  end if;
  if m.state <> 'active' then
    raise exception 'that step is %, not open work', m.state using errcode = '22023';
  end if;

  update public.order_milestones
     set state = 'submitted', submitted_at = now()
   where id = m.id
  returning * into m;

  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  values (
    o.brand_org_id, 'milestone_submitted', 'milestone', m.id, o.id,
    format('"%s" is ready for you', m.title),
    'The factory has sent this step for your approval.'
  );

  return m;
end;
$$;

-- set_notification_preference: Settings access (body from 20261015000100_notification_emails.sql)
create or replace function public.set_notification_preference(
  target_org uuid,
  category   text,
  enabled    boolean
)
returns public.notification_preferences
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  result public.notification_preferences;
begin
  perform public.require_org_permission(target_org, 'settingsAccess');
  if auth.uid() is null or not public.is_org_member(target_org) then
    raise exception 'only a member of this company can change its email settings'
      using errcode = '42501';
  end if;
  if category not in ('rfq', 'payments', 'messages') or enabled is null then
    raise exception 'unknown email setting' using errcode = '22023';
  end if;

  insert into public.notification_preferences as p
    (org_id, rfq_emails, payment_emails, message_emails, updated_by, updated_at)
  values (
    target_org,
    case when category = 'rfq'      then enabled else true end,
    case when category = 'payments' then enabled else true end,
    case when category = 'messages' then enabled else true end,
    auth.uid(), now()
  )
  on conflict (org_id) do update set
    rfq_emails     = case when category = 'rfq'      then enabled else p.rfq_emails end,
    payment_emails = case when category = 'payments' then enabled else p.payment_emails end,
    message_emails = case when category = 'messages' then enabled else p.message_emails end,
    updated_by     = auth.uid(),
    updated_at     = now()
  returning * into result;

  return result;
end;
$$;

-- create_credit_purchase: Settings access, was owner only (body from 20261024000100_custom_credit_purchases.sql)
create or replace function public.create_credit_purchase(
  target_org   uuid,
  pack_credits integer,
  buyer        uuid
)
returns public.credit_purchases
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p     public.credit_purchases;
  kind  public.org_type;
  price bigint;
  cur   char(3) := 'USD';
begin
  if buyer is null or not public.member_has_permission(buyer, target_org, 'settingsAccess') then
    raise exception 'only someone with Settings access at the company can buy credits' using errcode = '42501';
  end if;

  select type into kind from public.orgs where id = target_org;
  if kind is distinct from 'factory' then
    raise exception 'credits are for vendors sending quotes' using errcode = '22023';
  end if;

  if pack_credits is null or pack_credits < 50 then
    raise exception 'the minimum credit purchase is 50 credits' using errcode = '22023';
  end if;

  price := pack_credits::bigint * 10;

  insert into public.credit_purchases (org_id, credits, amount_cents, currency, created_by)
  values (target_org, pack_credits, price, cur, buyer)
  returning * into p;
  return p;
end;
$$;

-- accept_invitation: joins with what the invitation says the person may do,
-- refuses staff (as create_org does), and tells the team.
create or replace function public.accept_invitation(invitation_id uuid)
returns public.orgs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  invite public.org_invitations;
  target_org public.orgs;
  caller_email text;
  who text;
begin
  caller_email := lower(coalesce(auth.jwt() ->> 'email', ''));

  if caller_email = '' then
    raise exception 'must be signed in to accept an invitation'
      using errcode = '42501';
  end if;

  if public.is_platform_admin() then
    raise exception 'The Sourcing Club staff cannot join a company'
      using errcode = '42501', hint = 'staff_address';
  end if;

  select * into invite
  from public.org_invitations
  where id = invitation_id
    and email = caller_email
    and status = 'pending'
    and expires_at > now()
  for update;

  if not found then
    raise exception 'invitation not found, already used, or expired'
      using errcode = 'P0002';
  end if;

  select * into target_org from public.orgs where id = invite.org_id;

  insert into public.org_members (org_id, user_id, role, permissions, title)
  values (invite.org_id, auth.uid(), invite.role,
          coalesce(invite.permissions, public.default_member_permissions(target_org.type, true)),
          invite.title)
  on conflict (org_id, user_id) do nothing;

  update public.org_invitations
     set status = 'accepted',
         accepted_at = now(),
         accepted_by = auth.uid()
   where id = invite.id;

  if found then
    select coalesce(nullif(btrim(p.full_name), ''), invite.invited_name, caller_email) into who
      from public.user_profiles p where p.id = auth.uid();
    insert into public.notifications (org_id, kind, subject_type, subject_id, title, body, data)
    values (
      invite.org_id, 'team_member_joined', 'org', invite.org_id,
      format('%s joined %s', coalesce(who, invite.invited_name, caller_email), target_org.name),
      'They accepted the invitation and can now work with the permissions it gave them.',
      jsonb_build_object('user_id', auth.uid())
    );
  end if;

  return target_org;
end;
$$;

-- The name of the company inviting you. The invitee is not a member yet, so
-- orgs_member_read does not show it; this shows the name and kind of the
-- companies that invited the caller's address, and nothing else.
create or replace function public.my_invitation_companies()
returns table (invitation_id uuid, org_id uuid, org_name text, org_type public.org_type,
               role public.org_role, title text, permissions text[], created_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select i.id, o.id, o.name, o.type, i.role, i.title, i.permissions, i.created_at
    from public.org_invitations i
    join public.orgs o on o.id = i.org_id
   where i.email = lower(coalesce(auth.jwt() ->> 'email', ''))
     and i.status = 'pending'
     and i.expires_at > now()
     and not exists (select 1 from public.org_members m
                      where m.org_id = i.org_id and m.user_id = auth.uid())
   order by i.created_at
$$;

revoke all on function public.my_invitation_companies() from public, anon;
grant execute on function public.my_invitation_companies() to authenticated;
