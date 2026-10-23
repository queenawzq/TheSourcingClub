-- ============================================================================
-- The bell updates without a refresh
-- ----------------------------------------------------------------------------
-- Supabase Realtime sends a row change only for tables in the
-- `supabase_realtime` publication, and only to a subscriber whose user could
-- SELECT the row. notifications_read limits that to the reader's own
-- companies (current_org_ids(); staff have none), so a company never hears of
-- another's notifications. The dashboards subscribe and recount.
--
-- Additive and safe with the old site live: nothing reads the publication
-- until a page subscribes.
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end
$$;
