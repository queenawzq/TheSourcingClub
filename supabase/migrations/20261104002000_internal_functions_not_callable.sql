-- Functions only other functions should run were callable by any signed-in
-- account. Each migration said `revoke all ... from public`, but Supabase's
-- default privileges grant execute to `authenticated` by name, and revoking
-- from public does not touch that grant. So any account could call, through
-- the API, with no check on who it was:
--
--   close_order              cancels any order (and emails both companies)
--   advance_order_chain      moves any order's steps on
--   activate_order           starts an order
--   create_order_from_award  makes an order from a quote
--   org_profile_*, org_verification_*   read any company's details and checks
--
-- Every caller of these is a `security definer` function, which runs as the
-- owner, so none of them needs the grant. No screen, route or script calls them.
revoke all on function public.close_order(uuid, text) from public, anon, authenticated;
do $$
declare
  fn regprocedure;
begin
  for fn in
    select p.oid::regprocedure
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('advance_order_chain', 'activate_order', 'create_order_from_award',
                        'org_profile_completion', 'org_profile_fields',
                        'org_verification_checks', 'org_verification_score', 'url_host')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
  end loop;
end;
$$;
