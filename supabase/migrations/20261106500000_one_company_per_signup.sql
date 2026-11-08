-- ============================================================================
-- A repeated create_org gives back the company it already made
-- ----------------------------------------------------------------------------
-- Sign-up creates the company from the browser, and two things asked twice:
-- a reply lost on the way back (the shell then retried on its own), and a
-- second tab open on the portal, which hears the sign-in and creates from the
-- same answers. Each left one person owning two companies of the same name,
-- with nothing on screen to say so.
--
-- So the same person asking for the same name and kind within 10 minutes gets
-- the one they own. Only their own, and only as owner: somebody else's company
-- of that name is never returned, and being a member of one does not count.
-- After being removed they are no longer in org_members, so they start afresh.
--
-- The lock makes two calls at once wait for each other. It is per person, so
-- nobody else's sign-up waits. The signature is unchanged, so the site still
-- live during a deploy keeps working, and benefits.
-- ============================================================================

create or replace function public.create_org(
  org_name text,
  org_kind public.org_type
)
returns public.orgs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  base_slug text;
  final_slug text;
  suffix int := 1;
  new_org public.orgs;
begin
  if auth.uid() is null then
    raise exception 'must be signed in to create an organisation'
      using errcode = '42501';
  end if;

  if public.is_platform_admin() then
    raise exception 'platform staff work in the admin console and do not create companies'
      using errcode = '42501';
  end if;

  if org_name is null or length(btrim(org_name)) = 0 then
    raise exception 'organisation name is required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('create_org:' || auth.uid()::text, 0));

  -- btrim alone leaves the ideographic space a Chinese keyboard types.
  select o.* into new_org
  from public.org_members m
  join public.orgs o on o.id = m.org_id
  where m.user_id = auth.uid()
    and m.role = 'owner'
    and o.type = org_kind
    and o.created_at > now() - interval '10 minutes'
    and lower(regexp_replace(o.name, '^[[:space:]　]+|[[:space:]　]+$', '', 'g'))
      = lower(regexp_replace(org_name, '^[[:space:]　]+|[[:space:]　]+$', '', 'g'))
  order by o.created_at
  limit 1;

  if found then
    return new_org;
  end if;

  base_slug := regexp_replace(lower(btrim(org_name)), '[^a-z0-9]+', '-', 'g');
  base_slug := btrim(base_slug, '-');
  if base_slug = '' then
    base_slug := 'org';
  end if;

  final_slug := base_slug;
  while exists (select 1 from public.orgs where slug = final_slug) loop
    suffix := suffix + 1;
    final_slug := base_slug || '-' || suffix;
  end loop;

  insert into public.orgs (type, name, slug)
  values (org_kind, btrim(org_name), final_slug)
  returning * into new_org;

  insert into public.org_members (org_id, user_id, role)
  values (new_org.id, auth.uid(), 'owner');

  return new_org;
end;
$$;

revoke all on function public.create_org(text, public.org_type) from public;
grant execute on function public.create_org(text, public.org_type) to authenticated;
