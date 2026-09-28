-- ============================================================================
-- 061  Sending a quote costs credits
-- ----------------------------------------------------------------------------
-- The designed flow charges for a quote: the review step's button reads "Send
-- for 25 credits", and the factory dashboard already shows a balance and a
-- "Purchase credits" action. Migration 005 reserved the `quote_submission`
-- ledger reason for exactly this and left it unused, so until now a vendor was
-- shown a price and never charged it.
--
-- The charge lives inside submit_quote() rather than beside it. A quote that
-- is sent without a ledger line, or a line written for a quote that then fails
-- to submit, are both worse than either outcome alone — one transaction makes
-- them impossible.
--
-- Idempotent per quote: revise_quote() clones a quote into a new row with its
-- own id, so a revision is a new charge, but re-submitting the SAME row after
-- a failure is not. The unique index from migration 005 on
-- (org_id, reason, ref_id) is what enforces it.
-- ============================================================================

-- 500 credits is $50 on the factory dashboard, so 25 credits is $2.50. The
-- design bands this by quote value ("$2k-$10k quote"); one price until the
-- bands are agreed.
create or replace function public.quote_credit_cost()
returns integer
language sql
immutable
as $$ select 25 $$;

revoke all on function public.quote_credit_cost() from public;
grant execute on function public.quote_credit_cost() to authenticated;

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
  cost    integer := public.quote_credit_cost();
  balance integer;
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

  -- Charged before the status changes, so a vendor who cannot pay never
  -- reaches "submitted". The message names the shortfall because the screen
  -- offers to buy credits and needs something true to say.
  balance := public.credit_balance(q.factory_org_id);
  if balance < cost then
    raise exception 'sending this quote costs % credits and you have %', cost, balance
      using errcode = '22023';
  end if;

  insert into public.credit_ledger (org_id, delta, reason, ref_type, ref_id, note)
  values (q.factory_org_id, -cost, 'quote_submission', 'quote', q.id,
          'Quote sent to ' || coalesce(r.title, 'a request'))
  -- Matches credit_ledger_once_idx, which is partial on ref_id.
  on conflict (org_id, reason, ref_id) where ref_id is not null do nothing;

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

revoke all on function public.submit_quote(uuid) from public;
grant execute on function public.submit_quote(uuid) to authenticated;
