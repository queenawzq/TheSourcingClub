-- ============================================================================
-- Bank details a person can pay
-- ----------------------------------------------------------------------------
-- The factory's Payments page saved an all-blank bank form, then told the
-- factory "Bank details on file. TSC pays your released earnings…". Staff
-- paying by bank (where Stripe cannot pay out) had nothing to pay to. The page
-- now asks for the bank, the account name and the country; this keeps a row
-- from being saved with no bank at all.
--
-- Only the bank's name is required here. The account name is required on the
-- page, but older rows, the seed's and the tests' were written without one.
-- The country stays optional: "Other / not listed" has no two-letter code, so
-- that factory names its bank's country in the instructions instead.
--
-- `not valid`: rows already saved blank are left alone (the page reads them
-- as incomplete and asks for the rest), while every new row and every edit is
-- checked. The site still live while this applies sends null for a blank
-- field, so a blank save there is refused too, which is the point.
-- ============================================================================

alter table public.factory_payout_accounts
  add constraint factory_payout_bank_name_present
    check (bank_name is not null and btrim(bank_name) <> '') not valid;

-- An ISO country code, as the page sends it (char(2) pads a single letter).
alter table public.factory_payout_accounts
  add constraint factory_payout_bank_country_code
    check (bank_country is null or bank_country ~ '^[A-Z]{2}$') not valid;
