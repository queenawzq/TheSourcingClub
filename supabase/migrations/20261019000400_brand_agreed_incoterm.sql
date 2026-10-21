-- The factory proposes an Incoterm in its quote, but the parties may agree to
-- a different one before the brand creates the production order. Preserve the
-- original quote while putting the agreed term on the immutable order snapshot.

create or replace function public.award_quote_with_incoterm(
  target_quote uuid,
  agreed_incoterm uuid
)
returns public.quotes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  original_incoterm uuid;
  awarded_quote public.quotes;
begin
  if agreed_incoterm is null or not exists (
    select 1
    from public.taxonomy_terms
    where id = agreed_incoterm and kind = 'incoterm'
  ) then
    raise exception 'choose a valid agreed delivery term'
      using errcode = '22023';
  end if;

  select incoterm_id
    into original_incoterm
    from public.quotes
   where id = target_quote;

  if not found then
    raise exception 'quote not found' using errcode = 'P0002';
  end if;

  -- award_quote validates ownership and every award precondition. The
  -- temporary value is visible only inside this transaction, allowing
  -- create_order_from_award to snapshot the agreed term. It is restored on
  -- the accepted quote so the factory's original submission remains intact.
  update public.quotes
     set incoterm_id = agreed_incoterm
   where id = target_quote;

  awarded_quote := public.award_quote(target_quote);

  update public.quotes
     set incoterm_id = original_incoterm
   where id = target_quote;

  awarded_quote.incoterm_id := original_incoterm;
  return awarded_quote;
end;
$$;

revoke all on function public.award_quote_with_incoterm(uuid, uuid) from public;
grant execute on function public.award_quote_with_incoterm(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
