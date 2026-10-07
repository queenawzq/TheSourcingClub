-- ============================================================================
-- 064  Telling each side what the other did on a request
-- ----------------------------------------------------------------------------
-- A brand invited a vendor, a vendor sent a quote, a vendor pulled one back —
-- and nobody heard about any of it unless they happened to open the right
-- page. The notifications table has been there since 024; until now only
-- award_quote, cancel_rfq and messages wrote to it.
--
-- Each write sits inside the transaction that makes the change, as award_quote
-- and cancel_rfq do, so a notification can never describe something that then
-- rolled back. Emails for these belong to the notifications work, not here.
--
-- Also here: a withdrawal is final. A vendor that sent a quote and withdrew it
-- cannot start a new one on the same request — otherwise "withdraw" is only a
-- way to disappear from the brand's comparison and come back at will.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Invited → the factory hears about it
-- ---------------------------------------------------------------------------
-- An invitation to a draft is refused by RLS (the composer publishes first),
-- so a row arriving here is always an invitation to a request that is open.

create or replace function public.on_rfq_invited()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r          public.rfqs;
  brand_name text;
begin
  select * into r from public.rfqs where id = new.rfq_id;
  select name into brand_name from public.orgs where id = r.brand_org_id;

  insert into public.notifications (org_id, kind, subject_type, subject_id, title, body)
  values (
    new.factory_org_id,
    'rfq_invited',
    'rfq',
    r.id,
    format('%s invited you to quote on "%s"', coalesce(brand_name, 'A brand'), coalesce(nullif(btrim(r.title), ''), 'a request')),
    case when r.quote_deadline is not null
         then format('Quotes close %s.', to_char(r.quote_deadline, 'FMMon FMDD'))
         else 'Open the request to read the brief and send a quote.'
    end
  );

  return new;
end;
$$;

revoke all on function public.on_rfq_invited() from public;

create trigger rfq_invitations_notify
  after insert on public.rfq_invitations
  for each row execute function public.on_rfq_invited();

-- ---------------------------------------------------------------------------
-- submit_quote — 061 unchanged, plus the brand's notification
-- ---------------------------------------------------------------------------

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
  vendor  text;
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

  -- New in 064. A second version is a revision the brand has already seen a
  -- first price for, so it is named as one.
  select name into vendor from public.orgs where id = q.factory_org_id;
  insert into public.notifications (org_id, kind, subject_type, subject_id, title, body)
  values (
    r.brand_org_id,
    'quote_received',
    'rfq',
    r.id,
    format('%s sent a %s on "%s"',
           coalesce(vendor, 'A vendor'),
           case when q.version > 1 then 'revised quote' else 'quote' end,
           coalesce(nullif(btrim(r.title), ''), 'your request')),
    'Compare it with the other quotes on this request.'
  );

  return q;
end;
$$;

revoke all on function public.submit_quote(uuid) from public;
grant execute on function public.submit_quote(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- withdraw_quote — the same checks, and the brand hears about a sent one
-- ---------------------------------------------------------------------------
-- A draft the brand never saw goes quietly; telling a brand about a quote it
-- was never shown would only raise a question nobody can answer.

create or replace function public.withdraw_quote(quote_id uuid)
returns public.quotes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  q        public.quotes;
  was      public.quote_status;
  r        public.rfqs;
  vendor   text;
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

  was := q.status;

  update public.quotes
     set status = 'withdrawn', decided_at = now()
   where id = quote_id
  returning * into q;

  if was = 'submitted' then
    select * into r from public.rfqs where id = q.rfq_id;
    select name into vendor from public.orgs where id = q.factory_org_id;
    insert into public.notifications (org_id, kind, subject_type, subject_id, title, body)
    values (
      r.brand_org_id,
      'quote_withdrawn',
      'rfq',
      r.id,
      format('%s withdrew its quote on "%s"',
             coalesce(vendor, 'A vendor'),
             coalesce(nullif(btrim(r.title), ''), 'your request')),
      'It no longer appears in your comparison.'
    );
  end if;

  return q;
end;
$$;

revoke all on function public.withdraw_quote(uuid) from public;
grant execute on function public.withdraw_quote(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- A withdrawal is final
-- ---------------------------------------------------------------------------
-- Only a quote that was SENT and then withdrawn closes the door: a draft the
-- vendor abandoned was never seen by the brand. Revisions carry
-- supersedes_quote_id and are not new quotes, so they pass.

create or replace function public.quotes_refuse_after_withdrawal()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.supersedes_quote_id is null and exists (
    select 1 from public.quotes q
     where q.rfq_id = new.rfq_id
       and q.factory_org_id = new.factory_org_id
       and q.status = 'withdrawn'
       and q.submitted_at is not null
  ) then
    raise exception 'you withdrew your quote on this request and cannot quote on it again'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke all on function public.quotes_refuse_after_withdrawal() from public;

create trigger quotes_refuse_after_withdrawal
  before insert on public.quotes
  for each row execute function public.quotes_refuse_after_withdrawal();
