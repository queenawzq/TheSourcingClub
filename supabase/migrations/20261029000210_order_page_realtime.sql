-- The order page is live for both sides (John's board, Oct 29: "comments not
-- automatically showing"). 20261026000300 published milestone_updates, so a
-- comment arrived at once, but a step approved, a payment funded or a
-- schedule confirmed by the other side waited for the page's 15 s re-read.
-- Publishing the three tables the page reads lets it re-read on the change.
-- Realtime applies each table's read policy per subscriber
-- (order_milestones_read, order_payments_read, production_orders_read), so
-- only the order's parties and staff hear of a change; no policy is widened.
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['order_milestones', 'order_payments', 'production_orders'] loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$$;
