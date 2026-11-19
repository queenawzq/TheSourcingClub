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
import { providersFrom } from "./payout-provider-rules.mjs";

// The rules live in payout-provider-rules.mjs, so the build's checks can run them.
export { methodProviderOn, providerOf, providerOn, providerOnFor, providersFrom } from "./payout-provider-rules.mjs";

export function usePayoutProviders(orgId, enabled = true) {
  const [providers, setProviders] = useState(null);
  const load = useCallback(async () => {
    if (!enabled || !orgId) return;
    const { data, error } = await supabase.rpc("payout_providers_for", { target_org: orgId });
    if (!error && data) setProviders(providersFrom(data));
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

