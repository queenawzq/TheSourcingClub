-- ============================================================================
-- Tazapay step 2b: staff pay a factory in mainland China or Hong Kong
-- ----------------------------------------------------------------------------
-- The same press as Pay with Wise (20261107200000): claim_provider_payout makes
-- the attempt and its key before Tazapay is called, a second press resumes it,
-- and only the server records what Tazapay says. What is new:
--
-- 1. tazapay_account_check(): what the account must hold before a payout is
--    claimed, in the database as well as in src/shared/tazapay-payout.mjs. A
--    mainland account carries the Chinese name and a USCC that is the company's
--    own registered number: a payout to an account in another name is refused.
--    A Hong Kong account carries the bank code, SWIFT and district.
-- 2. payout_tazapay_beneficiary(): the one read of the full number for
--    Tazapay, as payout_wise_recipient() is for Wise. Run as the staff member,
--    with the same refusals, and recorded as a reveal ('sent_to_tazapay').
-- 3. claim_provider_payout() accepts 'tazapay' and returns what the invoice
--    and the payee need.
--
-- Safe with the live site while applied: the claim keeps its signature and its
-- answers for Wise and PayPal; the reveal check only gains a value.
-- ============================================================================

alter table public.payout_number_reveals
  drop constraint payout_number_reveals_how_check,
  add constraint payout_number_reveals_how_check check (how in ('shown', 'sent_to_wise', 'sent_to_tazapay'));

-- ---------------------------------------------------------------------------
-- What a Tazapay payout needs on the account. Raises with a hint the server
-- turns into words; returns nothing when the account can be paid.
-- ---------------------------------------------------------------------------
create or replace function public.tazapay_account_check(a public.factory_payout_accounts)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  country text := upper(coalesce(a.bank_country::text, ''));
  registered text;
begin
  if a.id is null or a.method <> 'bank' or country not in ('CN', 'HK') then
    raise exception 'Tazapay pays bank accounts in mainland China and Hong Kong only'
      using errcode = '22023', hint = 'tazapay_not_set_up';
  end if;
  if not exists (select 1 from public.payout_account_numbers n where n.account_id = a.id) then
    raise exception 'no full account number is on file' using errcode = '22023', hint = 'no_number';
  end if;
  if nullif(btrim(coalesce(a.account_name, '')), '') is null or not public.payout_name_is_latin(a.account_name)
     or nullif(btrim(coalesce(a.bank_name, '')), '') is null
     or a.address_line1 is null or a.address_city is null
     or (country = 'CN' and (a.holder_name_local is null or a.registration_number is null))
     or (country = 'HK' and (a.bank_code is null or a.bank_code !~ '^[0-9]{3}$' or a.swift is null or a.address_state is null)) then
    raise exception 'this bank account is missing details Tazapay needs'
      using errcode = '22023', hint = 'tazapay_details_missing';
  end if;
  if country = 'CN' then
    select r.number into registered from public.company_registrations r
     where r.org_id = a.org_id and r.country_code = 'CN';
    if registered is null or registered <> a.registration_number then
      raise exception 'the account''s registration number is not the company''s'
        using errcode = '22023', hint = 'tazapay_not_the_company';
    end if;
  end if;
end;
$$;
revoke all on function public.tazapay_account_check(public.factory_payout_accounts) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The account as Tazapay's payee needs it, number included. Staff only, run as
-- the staff member, with payout_wise_recipient()'s refusals, and recorded.
-- ---------------------------------------------------------------------------
create or replace function public.payout_tazapay_beneficiary(target_account uuid)
returns table (
  account_number text,
  account_name text,
  holder_name_local text,
  registration_number text,
  bank_name text,
  bank_country text,
  bank_code text,
  swift text,
  address_line1 text,
  address_city text,
  address_state text,
  address_postal_code text,
  changed_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  a public.factory_payout_accounts;
begin
  if not public.is_platform_admin() then
    raise exception 'this is limited to platform staff' using errcode = '42501';
  end if;

  select * into a from public.factory_payout_accounts x where x.id = target_account;
  if not found then
    raise exception 'that account does not exist' using errcode = 'P0002';
  end if;

  if public.is_org_member(a.org_id) then
    raise exception 'you belong to this company, so someone else on the staff must pay it'
      using errcode = '42501', hint = 'payout_own_company';
  end if;
  if exists (
    select 1 from public.production_orders o
     where o.factory_org_id = a.org_id and public.is_org_member(o.brand_org_id)
  ) then
    raise exception 'your company has an order with this factory, so someone else on the staff must pay it'
      using errcode = '42501', hint = 'reveal_brand_side';
  end if;
  if not a.is_primary or not exists (
    select 1
      from public.order_payments p
      join public.production_orders o on o.id = p.order_id
     where o.factory_org_id = a.org_id
       and p.state = 'confirmed'
       and p.release_requested_at is not null
       and not (public.uses_stripe_payout(o.factory_org_id) and p.stripe_payment_intent_id is not null)
  ) then
    raise exception 'TSC does not owe this company a payout by hand, so its number stays hidden'
      using errcode = '22023', hint = 'reveal_not_owed';
  end if;
  perform public.tazapay_account_check(a);

  insert into public.payout_number_reveals
    (account_id, org_id, org_name, bank_name, last4, staff_user_id, staff_email, how)
  select a.id, a.org_id, o.name, a.bank_name, a.account_number_last4, auth.uid(),
         (select u.email from auth.users u where u.id = auth.uid()), 'sent_to_tazapay'
    from public.orgs o where o.id = a.org_id;

  return query select public.payout_number_plain(a.id), a.account_name, a.holder_name_local, a.registration_number,
    a.bank_name, upper(a.bank_country::text), a.bank_code, a.swift, a.address_line1, a.address_city, a.address_state,
    a.address_postal_code, a.details_changed_at;
end;
$$;
revoke all on function public.payout_tazapay_beneficiary(uuid) from public, anon;
grant execute on function public.payout_tazapay_beneficiary(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The press (from 20261108710000). Changed: 'tazapay' is a provider, checked by
-- tazapay_account_check(); the answer carries the payee, the factory's name and
-- the step's title for the invoice, and when the attempt began.
-- ---------------------------------------------------------------------------
create or replace function public.claim_provider_payout(
  target_payment uuid,
  which text,
  paid_to_changed_at timestamptz,
  cny_confirmed boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p public.order_payments;
  o public.production_orders;
  account public.factory_payout_accounts;
  live public.provider_payouts;
  attempt public.provider_payout_attempts;
  resumed boolean := false;
  paid_to text;
begin
  if not public.is_platform_admin() then
    raise exception 'paying a factory is limited to platform staff' using errcode = '42501';
  end if;

  perform 1 from public.stripe_connect_accounts where org_id=(
    select po.factory_org_id from public.order_payments op join public.production_orders po on po.id=op.order_id where op.id=target_payment
  ) for update;
  select * into p from public.order_payments where id = target_payment for update;
  if not found then
    raise exception 'payment not found' using errcode = 'P0002';
  end if;
  select * into o from public.production_orders where id = p.order_id;
  perform public.payout_staff_check(o.factory_org_id);

  if p.state = 'released' then
    raise exception 'that payout was already paid' using errcode = '22023', hint = 'payout_already_released';
  end if;
  if p.state <> 'confirmed' or p.release_requested_at is null then
    raise exception 'that payment is not approved for payout' using errcode = '22023', hint = 'payout_not_owed';
  end if;
  if p.stripe_payment_intent_id is not null and exists (
    select 1 from public.stripe_connect_accounts s
     where s.org_id = o.factory_org_id and public.uses_stripe_payout(o.factory_org_id)
  ) then
    raise exception 'Stripe pays this factory: retry the payout instead' using errcode = '22023', hint = 'payout_stripe';
  end if;
  if p.release_claimed_at is not null and p.release_claimed_at > now() - interval '10 minutes' then
    raise exception 'a Stripe payout is being made for this payment' using errcode = '22023', hint = 'payout_in_progress';
  end if;

  select * into account from public.factory_payout_accounts a
   where a.org_id = o.factory_org_id and a.is_primary;
  if which = 'wise' and (account.id is null or account.method <> 'bank' or account.wise_recipient_type is null) then
    raise exception 'this factory has no bank account Wise can pay' using errcode = '22023', hint = 'wise_not_set_up';
  end if;
  if which = 'paypal' and (account.id is null or account.method <> 'paypal') then
    raise exception 'this factory has no PayPal address' using errcode = '22023', hint = 'paypal_not_set_up';
  end if;
  if which = 'tazapay' then
    perform public.tazapay_account_check(account);
  end if;
  if which not in ('wise', 'paypal', 'tazapay') then
    raise exception 'unknown payment provider' using errcode = '22023';
  end if;
  if paid_to_changed_at is null or account.details_changed_at is distinct from paid_to_changed_at then
    raise exception 'this factory changed where it is paid' using errcode = '22023', hint = 'payout_changed';
  end if;
  if which = 'wise' and account.wise_currency = 'CNY' and not coalesce(cny_confirmed, false) then
    raise exception 'confirm the contract and invoice statement first' using errcode = '22023', hint = 'cny_statement';
  end if;

  select * into live from public.provider_payouts x
   where x.payment_id = p.id and x.status = 'processing';
  if found then
    if live.provider <> which then
      raise exception 'another payment is under way for this' using errcode = '22023', hint = 'payout_in_progress';
    end if;
    select * into attempt from public.provider_payout_attempts a where a.payout_id = live.id for update;
    if attempt.lease_until is not null and attempt.lease_until > now() then
      raise exception 'this is already being paid' using errcode = '22023', hint = 'payout_in_progress';
    end if;
    resumed := true;
  else
    -- New: only a payment already with this provider may carry on.
    if p.stripe_release_started then
      raise exception 'Stripe may already have paid this: press Retry payout, which checks with Stripe first'
        using errcode = '22023', hint = 'payout_stripe_started';
    end if;
    paid_to := case which
      when 'paypal' then account.paypal_email
      else format('%s ending %s', account.bank_name, account.account_number_last4)
    end;
    insert into public.provider_payouts
      (payment_id, factory_org_id, account_id, provider, paid_to, amount_cents, currency, requested_by)
    values (p.id, o.factory_org_id, account.id, which, paid_to, p.amount_cents, p.currency, auth.uid())
    returning * into live;
    insert into public.provider_payout_attempts (payout_id) values (live.id);
    select * into attempt from public.provider_payout_attempts a where a.payout_id = live.id;
  end if;

  update public.provider_payout_attempts a
     set lease_until = now() + interval '90 seconds', updated_at = now(),
         cny_confirmed_by = case when coalesce(cny_confirmed, false) then auth.uid() else a.cny_confirmed_by end,
         cny_confirmed_at = case when coalesce(cny_confirmed, false) then now() else a.cny_confirmed_at end
   where a.payout_id = live.id
  returning * into attempt;

  return jsonb_build_object(
    'payout_id', live.id,
    'key', attempt.attempt_key,
    'stage', attempt.stage,
    'resumed', resumed,
    'provider_ref', live.provider_ref,
    'quote_id', attempt.quote_id,
    'amount_cents', p.amount_cents,
    'currency', p.currency,
    'order_number', o.order_number,
    'account_id', account.id,
    'paypal_email', account.paypal_email,
    'wise_recipient_id', account.wise_recipient_id,
    'tazapay_beneficiary_id', account.tazapay_beneficiary_id,
    'factory_name', (select name from public.orgs where id = o.factory_org_id),
    'milestone_title', (select m.title from public.order_milestones m where m.id = p.milestone_id),
    'attempt_started_at', live.created_at
  );
end;
$$;


-- ---------------------------------------------------------------------------
-- set_tazapay_beneficiary (from 20261115600000). Changed: true only when the
-- payee is on the account afterwards. The guard runs on this update too, and
-- clears the payee if it finds the details changed (a number replaced in the
-- same moment), which the old version still answered true to.
-- ---------------------------------------------------------------------------
create or replace function public.set_tazapay_beneficiary(target_account uuid, beneficiary_id text, made_from timestamptz)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  kept text;
begin
  update public.factory_payout_accounts
     set tazapay_beneficiary_id = beneficiary_id
   where id = target_account and method = 'bank' and details_changed_at = made_from
  returning tazapay_beneficiary_id into kept;
  return kept is not null and kept = beneficiary_id;
end;
$$;
