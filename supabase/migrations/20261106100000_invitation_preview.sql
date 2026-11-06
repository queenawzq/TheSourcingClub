-- What the page opened from an invitation's email needs before anyone has
-- signed in: which company, which kind, which address, and whether that address
-- has an account, so the form can ask the right question.
--
-- Granted to anon. The id is an unguessable uuid sent only to the invited
-- address, but a link can be forwarded long after, so everything about the
-- person is returned only while the invitation is open. A closed one says its
-- state and the company to ask. The argument is text so that a malformed id
-- behaves exactly like an unknown one: no row and no error to tell them apart.
create or replace function public.invitation_preview(invitation_id text)
returns table (state text, company_name text, company_kind public.org_type, email text,
               invited_name text, title text, has_account boolean)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  invite  public.org_invitations;
  company public.orgs;
  current text;
begin
  if invitation_id is null
     or invitation_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return;
  end if;

  select * into invite from public.org_invitations i where i.id = invitation_id::uuid;
  if invite.id is null then
    return;
  end if;
  select * into company from public.orgs o where o.id = invite.org_id;

  current := case
    when invite.status = 'accepted' then 'accepted'
    when invite.status = 'revoked' then 'withdrawn'
    when invite.expires_at <= now() then 'expired'
    else 'open'
  end;

  if current <> 'open' then
    return query select current, company.name, null::public.org_type, null::text, null::text, null::text, null::boolean;
    return;
  end if;

  return query select current, company.name, company.type, invite.email, invite.invited_name, invite.title,
    exists (select 1 from auth.users u where lower(u.email) = invite.email);
end;
$$;

revoke all on function public.invitation_preview(text) from public, anon, authenticated;
grant execute on function public.invitation_preview(text) to anon, authenticated;

notify pgrst, 'reload schema';
