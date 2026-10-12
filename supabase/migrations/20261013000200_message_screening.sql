-- ============================================================================
-- 072  Every message a brand or a factory sends is checked first
-- ----------------------------------------------------------------------------
-- 20261013000100 let a sender choose `checking` or `delivered`. Now the choice
-- is gone: a message written by a signed-in user (the browser's publishable
-- key, role `authenticated`) is always saved as `checking`, whatever the
-- insert asked for, and api/screen-message.js delivers it or holds it for
-- staff. A client therefore cannot deliver its own message, including a tab
-- left open on the site from before this change.
--
-- A send is never refused. A tab still running the old code inserts as it
-- always did and its message lands in `checking`: the sender sees it in the
-- thread, the new code on their next visit re-screens it, and if nobody does
-- within two minutes it appears for staff under "Not checked" in
-- admin_message_queue(), where it can be released by hand.
--
-- Server-side inserts (the service key, migrations, the database owner) are
-- left as written, so their default stays `delivered`.
-- ============================================================================

create or replace function public.on_message_insert()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Not security definer, so current_user is the role the request runs as.
  if current_user in ('authenticated', 'anon') then
    new.delivery := 'checking';
  end if;
  new.delivered_at := case when new.delivery = 'delivered' then now() end;
  new.review_note := null;
  return new;
end;
$$;

revoke all on function public.on_message_insert() from public, authenticated;
