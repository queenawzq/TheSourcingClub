-- Approve waits for the company's signed terms.
--
-- A company could be approved before it had signed the terms at the end of
-- onboarding, so a verified company might never have agreed to them. The
-- database now refuses it, on every way a review becomes approved (the guard
-- is on org_reviews, like the registry guard), and staff read the same answer
-- on the review page through admin_terms_signed().
--
-- "The current terms" are the latest published version of the company's kind:
-- terms_brand for a brand; terms_factory or terms_trading for a vendor (staff
-- can change a vendor's type after it signed, and both are the vendor's
-- terms). A signature counts when it points at that version, or when it was
-- recorded without a document id and that version is still 1: every
-- signature before legal_documents existed, and the demo seed's, were to v1.
-- A version 2 therefore needs a new signature before approval.
--
-- Additive: the live site keeps working while this applies. Approving a
-- company without terms is refused in words the page already shows.

create or replace function public.org_signed_current_terms(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with kinds as (
    select case o.type when 'brand' then array['terms_brand']
                       else array['terms_factory', 'terms_trading'] end as kinds
      from public.orgs o
     where o.id = target_org
  ),
  current_docs as (
    select distinct on (d.kind) d.id, d.kind, d.version
      from public.legal_documents d, kinds k
     where d.kind = any (k.kinds)
     order by d.kind, d.version desc
  )
  select exists (
    select 1
      from public.terms_acceptances a
      join current_docs c
        on a.legal_document_id = c.id
        or (a.legal_document_id is null and c.version = 1)
     where a.org_id = target_org
  );
$$;

-- Only other functions call it: the trigger, and the staff read below.
revoke all on function public.org_signed_current_terms(uuid) from public, anon, authenticated;

create or replace function public.guard_approval_needs_terms()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.state <> 'approved' or (tg_op = 'UPDATE' and old.state = 'approved') then
    return new;
  end if;
  -- Older suites approve fixture companies that never signed, as they skip
  -- the registry guard. A client cannot set this: PostgREST runs no SET.
  if coalesce(current_setting('tsc.skip_terms_guard', true), '') = 'on' then
    return new;
  end if;
  if not public.org_signed_current_terms(new.org_id) then
    raise exception 'the company has not signed the current terms: it signs them at the end of onboarding'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_approval_needs_terms() from public, anon, authenticated;

create trigger org_reviews_approval_needs_terms
  before insert or update of state on public.org_reviews
  for each row execute function public.guard_approval_needs_terms();

-- For the review page: whether Approve waits for the terms.
create or replace function public.admin_terms_signed(target_org uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'only platform admins may read this' using errcode = '42501';
  end if;
  return public.org_signed_current_terms(target_org);
end;
$$;

revoke all on function public.admin_terms_signed(uuid) from public, anon;
grant execute on function public.admin_terms_signed(uuid) to authenticated;
