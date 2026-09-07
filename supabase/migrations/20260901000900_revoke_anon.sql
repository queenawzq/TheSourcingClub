-- ============================================================================
-- 009  Revoke everything from anon
-- ----------------------------------------------------------------------------
-- Local and hosted Supabase do not start from the same default privileges.
--
-- On a local stack, `anon` received no SELECT on the tables created by
-- migrations 001-007, so a signed-out request was refused outright. On the
-- hosted project the same request returned an empty array instead, because
-- hosted default privileges had already granted `anon` SELECT — leaving row
-- level security as the only thing standing between a signed-out visitor and
-- the data.
--
-- RLS did hold, so nothing was ever exposed. But "no grant" and "a grant that
-- RLS happens to filter" are different guarantees, and the weaker one is one
-- forgotten policy away from a leak. This makes both environments match the
-- stronger behaviour, and makes the assertion in access_rules_test.sql true
-- everywhere rather than only on a laptop.
--
-- Nothing in this product is readable while signed out. Every public-facing
-- page is static marketing HTML that never touches Postgres.
-- ============================================================================

revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

-- Tables added by future migrations must not quietly re-acquire the grant.
alter default privileges in schema public revoke all on tables    from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;

-- Storage stays reachable for anon only through signed URLs, which are issued
-- server-side and carry their own authorisation.
revoke all on storage.objects from anon;
revoke all on storage.buckets from anon;
