-- Run again (Nov 12, builder C): staff edit a field the AI read and run one
-- group's checks again. Who changed which field, and when, is kept here.
--
-- Staff-only: no grants on the table, written and read through two
-- functions whose first statement is the admin test (before any select, as
-- every admin function: P0002 vs 42501 must not leak existence). Additive
-- only; the site that is live during the deploy never reads it.

create table if not exists public.verification_field_edits (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs (id) on delete cascade,
  group_key    text not null check (group_key in ('business_registration', 'company_information', 'certification')),
  field_key    text not null check (field_key ~ '^[A-Za-z][A-Za-z0-9_]{0,59}$'),
  value_before text check (value_before is null or length(value_before) <= 2000),
  value_after  text not null check (length(value_after) <= 2000),
  edited_by    uuid references auth.users (id) on delete set null,
  edited_at    timestamptz not null default now()
);

create index if not exists verification_field_edits_org_idx
  on public.verification_field_edits (org_id, group_key, field_key, edited_at desc);

alter table public.verification_field_edits enable row level security;
revoke all on public.verification_field_edits from public, anon, authenticated;

-- Records the fields a staff member edited before Run again. `edits` is
-- [{ "field": "legalName", "from": "…", "to": "…" }, …], at most 20.
-- Runs as the staff member (their token), so edited_by is who pressed it.
create or replace function public.record_verification_field_edits(
  target_org uuid,
  group_key  text,
  edits      jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  edit jsonb;
  saved integer := 0;
begin
  if not public.is_platform_admin() then
    raise exception 'only platform admins may edit what was read' using errcode = '42501';
  end if;
  if public.is_org_member(target_org) then
    raise exception 'staff cannot review a company they belong to' using errcode = '42501';
  end if;
  if not exists (select 1 from public.orgs o where o.id = target_org) then
    raise exception 'org not found' using errcode = 'P0002';
  end if;
  if group_key not in ('business_registration', 'company_information', 'certification') then
    raise exception 'unknown group' using errcode = '22023';
  end if;
  if edits is null or jsonb_typeof(edits) <> 'array' then
    raise exception 'edits must be a list' using errcode = '22023';
  end if;
  if jsonb_array_length(edits) > 20 then
    raise exception 'at most 20 edits at once' using errcode = '22023';
  end if;
  for edit in select value from jsonb_array_elements(edits) loop
    if coalesce(edit ->> 'field', '') !~ '^[A-Za-z][A-Za-z0-9_]{0,59}$' then
      raise exception 'each edit names a field' using errcode = '22023';
    end if;
    if edit ->> 'to' is null or length(edit ->> 'to') > 2000 or length(coalesce(edit ->> 'from', '')) > 2000 then
      raise exception 'an edited value is missing or too long' using errcode = '22023';
    end if;
    insert into public.verification_field_edits (org_id, group_key, field_key, value_before, value_after, edited_by)
    values (target_org, record_verification_field_edits.group_key, edit ->> 'field', edit ->> 'from', edit ->> 'to', auth.uid());
    saved := saved + 1;
  end loop;
  return saved;
end;
$$;

revoke all on function public.record_verification_field_edits(uuid, text, jsonb) from public, anon;
grant execute on function public.record_verification_field_edits(uuid, text, jsonb) to authenticated;

-- The latest edit of each field: { group: { field: { value, before, by, at } } }.
create or replace function public.admin_verification_field_edits(target_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'only platform admins may read edits' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_object_agg(g.group_key, g.fields)
      from (
        select l.group_key, jsonb_object_agg(l.field_key, jsonb_build_object(
                 'value', l.value_after, 'before', l.value_before, 'at', l.edited_at,
                 'by', coalesce(nullif(p.full_name, ''), u.email::text))) as fields
          from (
            select distinct on (e.group_key, e.field_key) e.*
              from public.verification_field_edits e
             where e.org_id = target_org
             order by e.group_key, e.field_key, e.edited_at desc, e.id desc
          ) l
          left join public.user_profiles p on p.id = l.edited_by
          left join auth.users u on u.id = l.edited_by
         group by l.group_key
      ) g
  ), '{}'::jsonb);
end;
$$;

revoke all on function public.admin_verification_field_edits(uuid) from public, anon;
grant execute on function public.admin_verification_field_edits(uuid) to authenticated;
