-- A factory creates a quote as a draft; only Send makes it submitted.
--
-- quotes_factory_insert checked who, the verification and the request, but
-- not the row's own state, and authenticated holds INSERT on every column. So
-- a factory could insert a quote already 'submitted' (or 'accepted'), with
-- submitted_at set: the brand saw a sent quote, submit_quote() never ran, and
-- no 25 credits were charged, no checks on the terms, no notice. Setting
-- supersedes_quote_id also skips quotes_refuse_after_withdrawal, the rule that
-- a withdrawn quote is final.
--
-- The policy now also requires a plain first draft: status 'draft', version 1,
-- no submitted or decided time, not a revision. The app inserts only
-- (rfq_id, factory_org_id) and the defaults (src/lib/domain/quote.js), so the
-- live site keeps working during the deploy. submit_quote(), revise_quote()
-- and the award are security definer functions and are unaffected.

drop policy if exists quotes_factory_insert on public.quotes;

create policy quotes_factory_insert on public.quotes
  for insert to authenticated
  with check (
    public.is_org_member(factory_org_id)
    and exists (
      select 1 from public.factory_profiles f
      where f.org_id = quotes.factory_org_id
        and f.verification_status = 'verified'
    )
    and public.rfq_status_of(rfq_id) = 'open'
    and public.can_see_rfq(rfq_id)
    and status = 'draft'
    and version = 1
    and supersedes_quote_id is null
    and submitted_at is null
    and decided_at is null
  );
