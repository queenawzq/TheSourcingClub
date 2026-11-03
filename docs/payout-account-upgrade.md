# Existing factory payout accounts

Stripe does not support changing an existing Express account to the configuration
needed for TSC-managed bank accounts. A factory must onboard a replacement and
accept Stripe's agreement again. This applies to Portugal and every supported
country. See https://docs.stripe.com/connect/configuration-migration-guide.

## Rollout

1. Deploy the additive `managed_payout_upgrade` database migration with the app.
2. Existing factories see **Upgrade payout methods** in Manage payout method.
   Add and method actions lead to that explanation rather than the old edit form.
3. The owner starts the upgrade. Server-only state records both account IDs.
   New approved earnings remain held by TSC; existing balances remain withdrawable.
   Repeated starts resume the same replacement. A separate embedded session
   collects the replacement's identity, business, bank details and agreement.
4. Withdraw available funds from the OLD account and wait for pending funds,
   reserves and in-flight withdrawals to settle. TSC never automatically moves
   balances or reverses transfers to make a migration happen.
5. Close the verification form, or choose **Check and finish upgrade**. The
   server requires the replacement to have submitted details, payouts enabled
   and active transfers, and requires all old balances to be zero and no payouts
   pending/in transit. It then switches the active ID in one DB transaction and
   retries approved earnings. Add, make default, remove and replace use TSC's
   forms thereafter.

Do not delete the old Stripe account. Old transfer IDs are unchanged; historical
withdrawals are read from both accounts. A late account.updated event from either
an old account or an unactivated replacement cannot overwrite the active account.
If money later returns to a retired account (for example a delayed bank return),
operations must reconcile that account in Stripe before paying it onward; do not
assume the historical zero-balance check guarantees it stays zero forever.

Transfer claims and migration start share the active-account row lock. Starting
an upgrade refuses any unresolved release claim, even expired ones, until staff
reconcile it. Claims are blocked during onboarding. After claiming, release code
re-reads the account so a request begun before cutover cannot pay the old account.

No bulk reset or silent recreation of production accounts is safe: each owner
must complete verification and accept the replacement's agreement. No production
accounts are migrated merely by applying the SQL.

## Verification

- `node --test tests/stripe-connect-upgrade.test.mjs`: funds, reserves, negative
  balances, verification and paginated payout checks.
- `supabase/tests/connect_upgrade_test.sql`: owner data visibility, privileged
  RPC permissions, repeat start and transactional cutover/history preservation.
- Local app: Portugal Express factory → Manage → Upgrade payout methods.
  Starting should open replacement onboarding without changing the old balance.
  Closing before completion must retain the old account and offer resume.

## Disposable local demo accounts

With the app's local URL and test keys in `.env.local`, explicitly run:

```
node scripts/upgrade-demo-payouts.mjs --complete
```

This targets only companies belonging to the published demo logins. It refuses
remote databases and live Stripe keys. It upgrades existing Express accounts and
sets up unconfigured Portugal, UK and US demos using synthetic test identity and
bank details, including Stripe's test agreement acceptance. China/Hong Kong demos
keep manual bank transfers. The command settles old fake balances and seeds new
fake funds; test processing and FX fees can change the displayed balance. It
never edits the historical ledger to hide test withdrawals. Existing company
review/approval status is unchanged. Running the ordinary seed again resets demo
companies; rerun this optional command to prepare payout demos afterwards.

## Bank-country selection and USD display

The bank form reads `bank_options` from Stripe Country Specs for the connected
account's country. It starts with the account's country and currency, offers
only supported bank-country/currency combinations, and clears banking fields
when either selection changes. GB GBP accounts use sort code/account number;
GB non-GBP accounts use IBAN. US uses routing/account number. Replacement keeps
the old method's currency because Stripe cannot delete the last default for it.
The server validates the token's country/currency before attaching it.

Factory Payments amounts are displayed in USD. Non-USD balance and withdrawal
amounts are indicative equivalents using dated ECB reference rates through the
public Frankfurter API, cached for one hour; data older than seven days is not
used. No account IDs, names, bank details or amounts go to the rate provider.
Missing rates show an unavailable estimate, never local amounts labelled USD.
Historical withdrawals use the current reference rate, not an accounting FX rate
on the historical payment date. The page states this explicitly. Transfers and
withdrawals continue to use native minor units/currencies, and the confirmation
shows the actual amount/currency sent to the bank.

Additional checks: `node --test tests/*.test.mjs` (13 assertions across three
suites), `npm run build`, and the bank-country form tested on the local demo.
