-- ============================================================================
-- 008  Service role grants
-- ----------------------------------------------------------------------------
-- Migrations 001-007 granted table privileges to `authenticated` explicitly and
-- said nothing about `service_role`. Supabase's default privileges hand new
-- tables only REFERENCES/TRIGGER/TRUNCATE, so service_role ended up with no
-- SELECT, INSERT, UPDATE or DELETE on anything — every server-side path would
-- have failed with "permission denied for table ...".
--
-- That affects: the admin review surface, the nightly demo-org reset, the
-- Claude brief-generation and translation functions, and any future webhook.
--
-- service_role carries BYPASSRLS, so these grants are the only gate on it.
-- That is the intended arrangement — it is used exclusively by server code
-- holding the secret key, never by anything that reaches a browser. The
-- publishable key used by the app maps to `authenticated`/`anon`, which remain
-- fully governed by row level security.
--
-- `anon` is deliberately left with nothing: a signed-out visitor should be
-- refused at the grant level, before RLS is even consulted.
-- ============================================================================

grant usage on schema public to service_role;

grant select, insert, update, delete on all tables    in schema public to service_role;
grant usage,  select                 on all sequences in schema public to service_role;
grant execute                        on all functions in schema public to service_role;

-- Tables added by later migrations inherit the same treatment, so this does
-- not have to be remembered every time.
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;

alter default privileges in schema public
  grant usage, select on sequences to service_role;

alter default privileges in schema public
  grant execute on functions to service_role;

-- Sequences for `authenticated` too: every id in this schema is a uuid today,
-- but a future serial column would otherwise fail on insert in a way that is
-- annoying to diagnose.
grant usage, select on all sequences in schema public to authenticated;

alter default privileges in schema public
  grant usage, select on sequences to authenticated;
