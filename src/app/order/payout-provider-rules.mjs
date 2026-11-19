/**
 * Which withdrawal providers are on, as payout_providers_for() answers: the
 * company's region switches, every region's switches, which countries are
 * China, and (20261119300000) PayPal "Any country Stripe can't pay" with the
 * countries Stripe pays out to. Kept free of the database client so
 * check:payout-routing can run it.
 */

/** The answer of payout_providers_for(), shaped for the screens. Every key it sends is kept. */
export function providersFrom(data) {
  return {
    paypal: data.paypal !== false,
    wise: data.wise !== false,
    byRegion: data.byRegion ?? null,
    chinaCountries: Array.isArray(data.chinaCountries) ? data.chinaCountries : null,
    paypalWhereNoStripe: data.paypalWhereNoStripe === true,
    stripeCountries: Array.isArray(data.stripeCountries) ? data.stripeCountries : null,
  };
}

/** The provider that pays a saved method, as request_withdrawal() decides it. */
export const providerOf = (row) => (row?.method === "paypal" ? "paypal" : row?.method === "bank" && row.wise_recipient_type ? "wise" : "bank");

/** Whether a provider is on; unknown switches count as on. */
export const providerOn = (providers, provider) => !providers || providers[provider] !== false;

/** The region a country is in, by the database's list; null when not known. */
const regionOf = (providers, country) => {
  if (!providers?.byRegion || !providers.chinaCountries || !country) return null;
  return providers.chinaCountries.includes(String(country).trim().toUpperCase()) ? "china" : "elsewhere";
};

/**
 * Whether a provider is on for a picked country ("ZZ" for not listed is
 * elsewhere). With no country, or before the regions are known, the company's
 * region decides, as for a method saved before countries were kept.
 */
export const providerOnFor = (providers, provider, country) => {
  const region = regionOf(providers, country);
  if (!region) return providerOn(providers, provider);
  if (providers.byRegion[region]?.[provider] !== false) return true;
  // PayPal "where Stripe isn't available" (20261119300000): on for a country
  // Stripe can't pay out to, by the database's list.
  return provider === "paypal" && providers.paypalWhereNoStripe === true && Array.isArray(providers.stripeCountries)
    && !providers.stripeCountries.includes(String(country).trim().toUpperCase());
};

/** Whether a saved method's provider is on, by the country it was added for. */
export const methodProviderOn = (providers, row) => providerOnFor(providers, providerOf(row), row?.payout_country);
