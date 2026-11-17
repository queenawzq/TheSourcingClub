/**
 * Which withdrawal providers staff have switched on for this company's region
 * (payout_provider_settings, 20261117200000). The region is the database's
 * rule (payout_region: the company's country, CN or HK is China), so the
 * screen never decides it. Re-read when staff change a switch.
 *
 * `null` until known, or when it cannot be read: the screens then offer what
 * they always did, and the database still refuses a provider that is off.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../lib/supabase.js";
import { tazapayPaysAccount, withdrawalProviderFor } from "../../shared/tazapay-payout.mjs";

export function usePayoutProviders(orgId, enabled = true) {
  const [providers, setProviders] = useState(null);
  const load = useCallback(async () => {
    if (!enabled || !orgId) return;
    const { data, error } = await supabase.rpc("payout_providers_for", { target_org: orgId });
    if (!error && data) setProviders({ paypal: data.paypal !== false, wise: data.wise !== false, tazapay: data.tazapay !== false });
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

/** A bank account in mainland China or Hong Kong with no Wise recipient: Tazapay pays it (tazapay_pays_account()). */
export const tazapayPays = tazapayPaysAccount;

/** The provider that pays a saved method, as request_withdrawal() decides it (withdrawal_provider_for()). */
export const providerOf = (row) => withdrawalProviderFor(row) ?? "bank";

/** Whether a provider is on; unknown switches count as on. */
export const providerOn = (providers, provider) => !providers || providers[provider] !== false;
