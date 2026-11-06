-- ============================================================================
-- Order tables are read-only to every client, as migration 20260905000100 meant
-- ----------------------------------------------------------------------------
-- Those migrations only ever said `grant select`, but the stack's default
-- privileges had already given `authenticated` everything on a new table. RLS
-- has no write policy on any of these, so a direct write changed no rows;
-- this makes it a refusal, and takes away TRUNCATE, which RLS never governed.
--
-- Nothing relies on them: every write goes through a security definer function
-- (checked in pg_proc: no invoker function or trigger writes these tables),
-- foreign-key cascades run as the table's owner, and service_role keeps its own
-- grants. Reads and Realtime need only SELECT. Safe with the live site.
-- ============================================================================

revoke insert, update, delete, truncate, references, trigger
  on public.production_orders,
     public.order_milestones,
     public.milestone_updates,
     public.order_payments,
     public.payment_events,
     public.production_order_summary
  from anon, authenticated;

