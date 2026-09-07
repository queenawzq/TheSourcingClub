-- ============================================================================
-- 022  Fix an ambiguous column reference in revise_quote
-- ----------------------------------------------------------------------------
-- The function parameter is named `quote_id`, and so is the column on
-- quote_sample_lines and quote_question_answers. In the clone statements:
--
--     select ... from public.quote_sample_lines where quote_id = old_quote.id
--
-- Postgres cannot tell whether `quote_id` means the parameter or the column,
-- and raises at runtime rather than at creation — so the function was created
-- happily and only failed the first time a factory tried to revise a quote.
--
-- Fixed by aliasing the source tables rather than renaming the parameter: the
-- other three lifecycle RPCs all take `quote_id`, and a client calling
-- revise_quote with a different argument name than submit_quote would be a
-- worse trap than this one.
-- ============================================================================

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
  select * into old_quote from public.quotes q where q.id = quote_id for update;
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
  -- per factory per RFQ, so the old row must leave that state before the new
  -- draft can exist.
  update public.quotes q set status = 'superseded' where q.id = quote_id;

  insert into public.quotes (
    rfq_id, factory_org_id, version, supersedes_quote_id, status,
    unit_price_cents, currency, production_quantity, bulk_lead_time_days,
    capacity_window_start, capacity_window_end, capacity_window_units,
    payment_term_id, deposit_pct, balance_pct,
    incoterm_id, shipping_notes, valid_until, factory_notes, created_by
  )
  select
    q.rfq_id, q.factory_org_id, q.version + 1, q.id, 'draft',
    q.unit_price_cents, q.currency, q.production_quantity, q.bulk_lead_time_days,
    q.capacity_window_start, q.capacity_window_end, q.capacity_window_units,
    q.payment_term_id, q.deposit_pct, q.balance_pct,
    q.incoterm_id, q.shipping_notes, q.valid_until, q.factory_notes, auth.uid()
  from public.quotes q where q.id = quote_id
  returning * into new_quote;

  -- Carry the previous version's sample plan and answers so the factory is
  -- editing its own quote rather than retyping it.
  insert into public.quote_sample_lines (quote_id, stage, cost_cents, currency, timing_days, includes, sort)
  select new_quote.id, l.stage, l.cost_cents, l.currency, l.timing_days, l.includes, l.sort
  from public.quote_sample_lines l where l.quote_id = old_quote.id;

  insert into public.quote_question_answers (quote_id, question_id, answer_text)
  select new_quote.id, a.question_id, a.answer_text
  from public.quote_question_answers a where a.quote_id = old_quote.id;

  return new_quote;
end;
$$;

grant execute on function public.revise_quote(uuid) to authenticated;
