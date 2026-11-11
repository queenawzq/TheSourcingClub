// Country Specs describe supported bank countries per settlement currency for
// the connected account's country. A global Stripe country list is too broad.
const cache = new Map();
export async function payoutBankOptions(stripe, accountCountry) {
  const existing = cache.get(accountCountry);
  if (existing && existing.expires > Date.now()) return existing.value;
  const spec = await stripe.countrySpecs.retrieve(accountCountry);
  const currencies = spec.supported_bank_account_currencies;
  if (!currencies || !Object.keys(currencies).length) throw new Error("Couldn't list bank countries. Try again.");
  const value = { accountCountry, currencies };
  cache.set(accountCountry, { value, expires: Date.now() + 3600000 });
  return value;
}
