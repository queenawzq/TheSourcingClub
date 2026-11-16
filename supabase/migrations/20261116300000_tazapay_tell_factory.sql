-- ============================================================================
-- Tazapay: staff can tell the factory to fix an incomplete bank account
-- ----------------------------------------------------------------------------
-- "Tell the factory to fix its details" is a claim that ends at once as failed
-- with the factory's note (api/_provider-payouts.js, tellFactoryDetails). For
-- Tazapay the claim runs tazapay_account_check(), which refuses exactly the
-- incomplete account staff want the factory to fix, so the button could never
-- work for Tazapay.
--
-- 1. claim_provider_payout_to_tell(): the same claim, for a Tazapay account in
--    mainland China or Hong Kong whose details are incomplete. It marks the
--    transaction (a transaction-local setting) so tazapay_account_check()
--    checks only that Tazapay pays this kind of account. Paying still goes
--    through claim_provider_payout(), which checks everything; the server
--    finishes a tell's attempt as failed before the transaction is gone.
-- 2. tazapay_account_check() reads that mark. Nothing else sets it: a client
--    cannot run set_config() through the API, and each call is its own
--    transaction.
--
-- Safe with the live site while applied: one new function, one redefinition
-- with the same signature and behaviour when the mark is absent.
-- ============================================================================

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
  -- A tell sends nothing: the account only has to be one Tazapay would pay.
  if current_setting('tsc.tazapay_tell', true) = 'on' then
    return;
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

create or replace function public.claim_provider_payout_to_tell(
  target_payment uuid,
  paid_to_changed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  answer jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'paying a factory is limited to platform staff' using errcode = '42501';
  end if;
  perform set_config('tsc.tazapay_tell', 'on', true);
  answer := public.claim_provider_payout(target_payment, 'tazapay', paid_to_changed_at, false);
  perform set_config('tsc.tazapay_tell', 'off', true);
  return answer;
exception when others then
  perform set_config('tsc.tazapay_tell', 'off', true);
  raise;
end;
$$;
revoke all on function public.claim_provider_payout_to_tell(uuid, timestamptz) from public, anon;
grant execute on function public.claim_provider_payout_to_tell(uuid, timestamptz) to authenticated;
