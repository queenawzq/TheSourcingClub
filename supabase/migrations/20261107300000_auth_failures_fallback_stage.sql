-- A page moving to the fallback (/sb on our own host) is counted the same way
-- as a sign-in that got no answer: no email, name, address or IP. It is how we
-- would know the fallback ever fires for a real person.
alter table public.auth_connection_failures
  drop constraint auth_connection_failures_stage_check;
alter table public.auth_connection_failures
  add constraint auth_connection_failures_stage_check
  check (stage in ('signup', 'login', 'reset', 'code', 'company', 'fallback'));
