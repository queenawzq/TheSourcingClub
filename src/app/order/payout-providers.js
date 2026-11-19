/**
 * Which withdrawal providers staff have switched on, per region
 * (payout_provider_settings, 20261117200000). Since 20261118600000 the country
 * picked for a method decides its region (payout_region_of); the database
 * sends which countries are China, so the screen never owns the rule. A method
 * saved before then has no country and goes by the company's region, as the
 * database does. Re-read when staff change a switch.
 *
 * `null` until known, or when it cannot be read: the screens then offer what
 * they always did, and the database still refuses a provider that is off.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../lib/supabase.js";

export function usePayoutProviders(orgId, enabled = true) {
  const [providers, setProviders] = useState(null);
  const load = useCallback(async () => {
    if (!enabled || !orgId) return;
    const { data, error } = await supabase.rpc("payout_providers_for", { target_org: orgId });
    if (!error && data) {
      setProviders({
        paypal: data.paypal !== false,
        wise: data.wise !== false,
        byRegion: data.byRegion ?? null,
        chinaCountries: Array.isArray(data.chinaCountries) ? data.chinaCountries : null,
      });
    }
  }, [orgId, enabled]);

  useEffect(() => {
    if (!enabled || !orgId) return undefined;
    load();
    const channel = supabase.channel(`payout-providers:${orgId}:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "payout_provider_settings" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [orgId, enabled, load]);

  return providers;
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
