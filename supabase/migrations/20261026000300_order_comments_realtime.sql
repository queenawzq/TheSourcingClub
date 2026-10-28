-- Publish milestone comments to authorized order participants. Existing
-- milestone_updates_read RLS remains the gate; no access policy is widened.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'milestone_updates'
  ) then
    alter publication supabase_realtime add table public.milestone_updates;
  end if;
end
$$;
