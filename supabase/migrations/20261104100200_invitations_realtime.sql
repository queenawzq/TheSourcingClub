-- An open Settings page hears of an invitation being sent, accepted or
-- withdrawn, and an invited person's open page hears of one arriving or being
-- withdrawn. Realtime applies org_invitations' read policies per subscriber:
-- Settings access at the company, or the invited address itself.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'org_invitations'
  ) then
    alter publication supabase_realtime add table public.org_invitations;
  end if;
end;
$$;
