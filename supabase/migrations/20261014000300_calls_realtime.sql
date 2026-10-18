-- Calls arrive without a refresh, like the messages beside them
-- (20261013000600). Realtime applies `calls_read` per subscriber, so only the
-- two companies in the conversation hear of a call.
--
-- Additive and safe with the old site live.

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'calls'
  ) then
    alter publication supabase_realtime add table public.calls;
  end if;
end
$$;
