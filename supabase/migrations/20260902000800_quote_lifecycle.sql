-- ============================================================================
-- 019  Quote lifecycle
-- ----------------------------------------------------------------------------
-- Every status transition goes through one of these, never through a direct
-- update: the RLS policy on `quotes` only permits editing a draft, so a
-- factory cannot mark its own quote submitted, let alone accepted.
--
-- Completeness is validated here rather than by table constraints, so a
-- factory gets told WHICH field is missing instead of a generic rejection.
-- ============================================================================

create or replace function public.submit_quote(quote_id uuid)
returns public.quotes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  q       public.quotes;
  r       public.rfqs;
  missing text[] := '{}';
begin
  select * into q from public.quotes where id = quote_id for update;
  if not found then
    raise exception 'quote not found' using errcode = 'P0002';
  end if;

  if not public.is_org_member(q.factory_org_id) then
    raise exception 'only the quoting factory may submit this quote'
      using errcode = '42501';
  end if;

  if q.status <> 'draft' then
    raise exception 'quote is %, only a draft can be submitted', q.status
      using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.factory_profiles f
    where f.org_id = q.factory_org_id and f.verification_status = 'verified'
  ) then
    raise exception 'factory must be verified before quoting'
      using errcode = '42501';
  end if;

  select * into r from public.rfqs where id = q.rfq_id;
  if r.status <> 'open' then
    raise exception 'this request is %, and is no longer accepting quotes', r.status
      using errcode = '22023';
  end if;

  if r.quote_deadline is not null and now() > r.quote_deadline then
    raise exception 'the deadline for this request passed on %', r.quote_deadline
      using errcode = '22023';
  end if;

  -- Name every missing field at once rather than making the factory discover
  -- them one submit at a time.
  if q.unit_price_cents    is null then missing := array_append(missing, 'unit price'); end if;
  if q.production_quantity is null then missing := array_append(missing, 'production quantity'); end if;
  if q.bulk_lead_time_days is null then missing := array_append(missing, 'bulk lead time'); end if;
  if q.payment_term_id     is null then missing := array_append(missing, 'payment terms'); end if;
  if q.incoterm_id         is null then missing := array_append(missing, 'shipping terms'); end if;
  if q.valid_until         is null then missing := array_append(missing, 'quote valid until'); end if;

  if array_length(missing, 1) > 0 then
    raise exception 'quote is missing: %', array_to_string(missing, ', ')
      using errcode = '22023';
  end if;

  update public.quotes
     set status = 'submitted',
         submitted_at = now()
   where id = quote_id
  returning * into q;

  update public.rfq_invitations
     set status = 'viewed'
   where rfq_id = q.rfq_id
     and factory_org_id = q.factory_org_id
     and status = 'invited';

  return q;
end;
$$;

-- ---------------------------------------------------------------------------
-- revise_quote — the versioning mechanism
-- ---------------------------------------------------------------------------
-- Clones the submitted quote into a fresh draft the factory can edit, and
-- marks the old row superseded. Sample lines and answers come along so the
-- factory is editing its previous quote rather than retyping it.
-- ---------------------------------------------------------------------------

create or replace function public.revise_quote(quote_id uuid)
returns public.quotes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  old_quote public.quotes;
  new_quote public.quotes;
  r         public.rfqs;
begin
  select * into old_quote from public.quotes where id = quote_id for update;
  if not found then
    raise exception 'quote not found' using errcode = 'P0002';
  end if;

  if not public.is_org_member(old_quote.factory_org_id) then
    raise exception 'only the quoting factory may revise this quote'
      using errcode = '42501';
  end if;

  if old_quote.status <> 'submitted' then
    raise exception 'quote is %, only a submitted quote can be revised', old_quote.status
      using errcode = '22023';
  end if;

  select * into r from public.rfqs where id = old_quote.rfq_id;
  if r.status <> 'open' then
    raise exception 'this request is % and can no longer be revised', r.status
      using errcode = '22023';
  end if;

  -- Supersede first: the partial unique index allows only one submitted quote
  -- per factory per RFQ, so the old row must move out of that state before the
  -- new draft exists.
  update public.quotes set status = 'superseded' where id = quote_id;

  insert into public.quotes (
    rfq_id, factory_org_id, version, supersedes_quote_id, status,
    unit_price_cents, currency, production_quantity, bulk_lead_time_days,
    capacity_window_start, capacity_window_end, capacity_window_units,
    payment_term_id, deposit_pct, balance_pct,
    incoterm_id, shipping_notes, valid_until, factory_notes, created_by
  )
  select
    rfq_id, factory_org_id, version + 1, id, 'draft',
    unit_price_cents, currency, production_quantity, bulk_lead_time_days,
    capacity_window_start, capacity_window_end, capacity_window_units,
    payment_term_id, deposit_pct, balance_pct,
    incoterm_id, shipping_notes, valid_until, factory_notes, auth.uid()
  from public.quotes where id = quote_id
  returning * into new_quote;

  insert into public.quote_sample_lines (quote_id, stage, cost_cents, currency, timing_days, includes, sort)
  select new_quote.id, stage, cost_cents, currency, timing_days, includes, sort
  from public.quote_sample_lines where quote_id = old_quote.id;

  insert into public.quote_question_answers (quote_id, question_id, answer_text)
  select new_quote.id, question_id, answer_text
  from public.quote_question_answers where quote_id = old_quote.id;

  return new_quote;
end;
$$;

create or replace function public.withdraw_quote(quote_id uuid)
returns public.quotes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  q public.quotes;
begin
  select * into q from public.quotes where id = quote_id for update;
  if not found then
    raise exception 'quote not found' using errcode = 'P0002';
  end if;

  if not public.is_org_member(q.factory_org_id) then
    raise exception 'only the quoting factory may withdraw this quote'
      using errcode = '42501';
  end if;

  if q.status not in ('draft', 'submitted') then
    raise exception 'quote is % and cannot be withdrawn', q.status
      using errcode = '22023';
  end if;

  update public.quotes
     set status = 'withdrawn', decided_at = now()
   where id = quote_id
  returning * into q;

  return q;
end;
$$;

revoke all on function public.submit_quote(uuid)   from public;
revoke all on function public.revise_quote(uuid)   from public;
revoke all on function public.withdraw_quote(uuid) from public;

grant execute on function public.submit_quote(uuid)   to authenticated;
grant execute on function public.revise_quote(uuid)   to authenticated;
grant execute on function public.withdraw_quote(uuid) to authenticated;
