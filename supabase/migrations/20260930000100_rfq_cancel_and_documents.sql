-- ============================================================================
-- 063  Cancelling a request, and the files attached to one
-- ----------------------------------------------------------------------------
-- Two gaps in the brand's side of the RFQ flow:
--
--   * Cancelling was a plain `update rfqs set status = 'cancelled'`, allowed by
--     rfqs_brand_update for ANY member of the brand and from ANY status — an
--     awarded request with a live production order included. Nothing closed
--     the quotes on it and nobody told the vendors, so a factory kept a
--     "submitted" quote on a request that no longer existed.
--   * Files a brand attaches to a request (tech pack, measurement chart) were
--     readable by nobody but the brand. documents.rfq_id existed; no policy
--     read it, and no storage policy let an invited vendor open the object.
--     A vendor asked to quote from a tech pack could not see the tech pack.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- cancel_rfq
-- ---------------------------------------------------------------------------
-- An RPC rather than a policy for the same reason as award_quote: a policy
-- can gate the status a row comes FROM, but not the other rows a cancellation
-- has to change with it (the quotes) or the notifications it owes.

create or replace function public.cancel_rfq(target_rfq uuid, reason text default null)
returns public.rfqs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r          public.rfqs;
  brand_name text;
begin
  -- First statement, before any select: an unknown id and someone else's id
  -- must be refused identically, or the error code says which requests exist.
  if not public.is_org_owner(public.rfq_brand_org(target_rfq)) then
    raise exception 'only an owner of the brand can cancel this request'
      using errcode = '42501';
  end if;

  select * into r from public.rfqs where id = target_rfq for update;

  -- Awarded is final: it has a production order, and that order is cancelled
  -- through propose_cancellation / accept_cancellation, by both parties.
  if r.status not in ('draft', 'open') then
    raise exception 'this request is % and can no longer be cancelled', r.status
      using errcode = '22023';
  end if;

  select name into brand_name from public.orgs where id = r.brand_org_id;

  -- Tell every vendor that was invited or had a quote in progress, BEFORE the
  -- quotes change, so a vendor whose quote is about to be closed is included.
  insert into public.notifications (org_id, kind, subject_type, subject_id, title, body)
  select vendor.org_id,
         'rfq_cancelled',
         'rfq',
         r.id,
         format('%s cancelled "%s"', coalesce(brand_name, 'The brand'), coalesce(r.title, 'a request')),
         coalesce(nullif(btrim(reason), ''), 'The brand is no longer taking quotes on this request.')
    from (
      select factory_org_id as org_id from public.rfq_invitations where rfq_id = r.id
      union
      select factory_org_id from public.quotes where rfq_id = r.id and status in ('draft', 'submitted')
    ) vendor;

  -- A sent quote was not chosen; a draft was never sent. Same words award_quote
  -- uses for the losers, so the vendor's screens need no new status.
  update public.quotes set status = 'declined', decided_at = now()
   where rfq_id = r.id and status = 'submitted';
  update public.quotes set status = 'withdrawn', decided_at = now()
   where rfq_id = r.id and status = 'draft';

  update public.rfqs set status = 'cancelled' where id = r.id returning * into r;
  return r;
end;
$$;

revoke all on function public.cancel_rfq(uuid, text) from public;
grant execute on function public.cancel_rfq(uuid, text) to authenticated;

-- The direct path is closed: a brand member may still edit a draft or an open
-- request, but can no longer move one to 'cancelled' (or touch one that is
-- awarded or cancelled) with a plain update. cancel_rfq() is the only way.
drop policy rfqs_brand_update on public.rfqs;
create policy rfqs_brand_update on public.rfqs
  for update to authenticated
  using (
    public.is_org_member(brand_org_id)
    and status in ('draft', 'open')
  )
  with check (
    public.is_org_member(brand_org_id)
    and status in ('draft', 'open')
  );

-- A vendor that quoted on an open-to-all request must still be able to read
-- it once it is cancelled: its RFQs page lists the request under Closed, and
-- the "cancelled" notification links to it. Visibility was open and awarded
-- only, so the request vanished from the vendor's side the moment it closed.
-- Awarded requests already stay readable; cancelled ones now do too. Browse
-- lists open requests only, so nothing new is offered for quoting.
create or replace function public.can_see_rfq(target_rfq uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.rfqs r
    where r.id = target_rfq
      and (
        -- the brand that owns it
        r.brand_org_id in (select org_id from public.org_members where user_id = auth.uid())
        -- or it is (or was) published to everyone
        or (r.status in ('open', 'awarded', 'cancelled') and r.visibility = 'open_to_all')
        -- or this factory was invited
        or exists (
          select 1 from public.rfq_invitations i
          where i.rfq_id = r.id
            and i.factory_org_id in (select org_id from public.org_members where user_id = auth.uid())
        )
        or exists (select 1 from public.platform_admins a where a.user_id = auth.uid())
      )
  );
$$;

drop policy rfqs_read on public.rfqs;
create policy rfqs_read on public.rfqs
  for select to authenticated
  using (
    brand_org_id in (select public.current_org_ids())
    or public.is_platform_admin()
    or (status in ('open', 'awarded', 'cancelled') and visibility = 'open_to_all')
    or public.is_invited_to_rfq(id)
  );

-- ---------------------------------------------------------------------------
-- Files attached to a request
-- ---------------------------------------------------------------------------
-- The same three parts milestone photos and message attachments needed:
--   1. a documents policy, so the row is visible;
--   2. a storage.objects policy, or urlFor() mints a signed URL that 400s;
--   3. the link guard, because documents_own is `for all` and would otherwise
--      let anyone point their own file at someone else's request.
--
-- A file is readable through a request only when it belongs to the brand that
-- owns that request. Without that condition a vendor could attach its own file
-- to a brand's request and have it appear among the brand's attachments.

create policy documents_rfq_read on public.documents
  for select to authenticated
  using (
    rfq_id is not null
    and org_id = public.rfq_brand_org(rfq_id)
    and public.can_see_rfq(rfq_id)
  );

-- Uploads go to {brand org}/{kind}/{rfq id}/{file}. Storage policies can only
-- see the object's name, so the request has to be in the path.
--
-- A CASE, not a chain of ANDs: SQL does not promise to evaluate AND left to
-- right, and storage_path_scope() casts the third segment to a uuid. A tech
-- pack uploaded before this migration has its file name there, and a failed
-- cast inside a policy would refuse every read of the private bucket.
create policy "rfq viewer private read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'org-private'
    and case
      when split_part(name, '/', 2) in ('tech_pack', 'measurement_chart')
       and split_part(name, '/', 3) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.storage_path_org(name) = public.rfq_brand_org(public.storage_path_scope(name))
       and public.can_see_rfq(public.storage_path_scope(name))
      else false
    end
  );

create or replace function public.documents_link_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.milestone_update_id is not null
     and new.milestone_update_id is distinct from old.milestone_update_id
     and not public.is_order_party(public.milestone_update_order(new.milestone_update_id))
  then
    raise exception 'you cannot attach a file to an order you are not part of'
      using errcode = '42501';
  end if;

  if new.order_id is not null
     and new.order_id is distinct from old.order_id
     and not public.is_order_party(new.order_id)
  then
    raise exception 'you cannot attach a file to an order you are not part of'
      using errcode = '42501';
  end if;

  -- New: a request's files are the brand's own.
  if new.rfq_id is not null
     and new.rfq_id is distinct from old.rfq_id
     and new.org_id is distinct from public.rfq_brand_org(new.rfq_id)
  then
    raise exception 'you can only attach your own files to your own request'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- The insert trigger fired only for the two order links; widen it to rfq_id.
drop trigger documents_link_guard_insert on public.documents;
create trigger documents_link_guard_insert
  before insert on public.documents
  for each row
  when (new.milestone_update_id is not null or new.order_id is not null or new.rfq_id is not null)
  execute function public.documents_link_guard();
