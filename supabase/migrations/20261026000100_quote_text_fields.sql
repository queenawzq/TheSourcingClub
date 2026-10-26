alter table public.quotes add column if not exists sourcing_includes text;
alter table public.quotes add column if not exists factory_response text;

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
  if not found then raise exception 'quote not found' using errcode = 'P0002'; end if;
  if not public.is_org_member(old_quote.factory_org_id) then
    raise exception 'only the quoting factory may revise this quote' using errcode = '42501';
  end if;
  if old_quote.status <> 'submitted' then
    raise exception 'quote is %, only a submitted quote can be revised', old_quote.status using errcode = '22023';
  end if;
  select * into r from public.rfqs where id = old_quote.rfq_id;
  if r.status <> 'open' then
    raise exception 'this request is % and can no longer be revised', r.status using errcode = '22023';
  end if;

  update public.quotes q set status = 'superseded' where q.id = quote_id;
  insert into public.quotes (
    rfq_id, factory_org_id, version, supersedes_quote_id, status,
    unit_price_cents, unit_price_max_cents, currency, production_quantity,
    bulk_lead_time_days, bulk_lead_time_max_days,
    capacity_window_start, capacity_window_end, capacity_window_units,
    payment_term_id, deposit_pct, balance_pct,
    incoterm_id, shipping_notes, valid_until, factory_notes, sourcing_includes, factory_response, created_by
  )
  select
    q.rfq_id, q.factory_org_id, q.version + 1, q.id, 'draft',
    q.unit_price_cents, q.unit_price_max_cents, q.currency, q.production_quantity,
    q.bulk_lead_time_days, q.bulk_lead_time_max_days,
    q.capacity_window_start, q.capacity_window_end, q.capacity_window_units,
    q.payment_term_id, q.deposit_pct, q.balance_pct,
    q.incoterm_id, q.shipping_notes, q.valid_until, q.factory_notes, q.sourcing_includes, q.factory_response, auth.uid()
  from public.quotes q where q.id = quote_id
  returning * into new_quote;

  insert into public.quote_sample_lines (
    quote_id, stage, cost_cents, currency, timing_days, timing_max_days, includes, sort
  )
  select
    new_quote.id, l.stage, l.cost_cents, l.currency, l.timing_days, l.timing_max_days, l.includes, l.sort
  from public.quote_sample_lines l where l.quote_id = old_quote.id;

  insert into public.quote_material_lines (quote_id, material, cost_cents, currency, included, sort)
  select new_quote.id, l.material, l.cost_cents, l.currency, l.included, l.sort
  from public.quote_material_lines l where l.quote_id = old_quote.id;

  insert into public.quote_question_answers (quote_id, question_id, answer_text)
  select new_quote.id, a.question_id, a.answer_text
  from public.quote_question_answers a where a.quote_id = old_quote.id;

  return new_quote;
end;
$$;

grant execute on function public.revise_quote(uuid) to authenticated;

select pg_notify('pgrst', 'reload schema');
