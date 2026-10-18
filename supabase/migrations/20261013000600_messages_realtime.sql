-- Conversations arrive without a refresh.
--
-- Supabase Realtime sends a row change to a subscribed browser only for
-- tables in the `supabase_realtime` publication, and only when that browser's
-- user could SELECT the new row (it applies `messages_read` per subscriber).
-- So the other side hears of a message the moment it is delivered, and never
-- while it is being checked or held: those rows are invisible to it.
--
-- Additive and safe with the old site live: nothing reads the publication
-- until a page subscribes.

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end
$$;
