import { createClient } from "@supabase/supabase-js";
import { supabaseServerEnv } from "./_supabase-env.js";
import { syncAttempts } from "./_provider-payouts.js";
import { withoutSecrets } from "./_payout-provider.js";
import { paypalFrom } from "./_paypal.js";
import { reply, serviceClient } from "./_stripe.js";
import { wiseFrom } from "./_wise.js";

/**
 * The sweep: read back every Wise and PayPal payout that can still change, with
 * nobody on the staff board. The webhooks (api/wise-webhook.js,
 * api/paypal-webhook.js) do this the moment a payout moves; this catches what
 * they missed (a site they can't reach, a delivery that gave up).
 *
 * Runs inside the daily job (api/cron-daily.js), since this Vercel plan allows
 * one run a day per cron. It can also be called on its own: GET with
 * `Authorization: Bearer $CRON_SECRET` (any outside scheduler), or POST as
 * platform staff. Running it twice records nothing twice.
 */
export async function sweepProviderPayouts(db, env = process.env) {
  const result = {};
  for (const [provider, build] of [["wise", wiseFrom], ["paypal", paypalFrom]]) {
    try {
      const client = build(env);
      result[provider] = client ? await syncAttempts({ client, db }) : { configured: false };
    } catch (failure) {
      console.error(`payout sweep ${provider}:`, withoutSecrets(failure?.message));
      result[provider] = { error: failure?.kind ?? "failed" };
    }
  }
  return result;
}

async function isStaff(authorization) {
  const { supabaseUrl, anonKey } = supabaseServerEnv();
  if (!authorization.startsWith("Bearer ") || !supabaseUrl || !anonKey) return false;
  const caller = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data, error } = await caller.rpc("is_platform_admin");
  return !error && data === true;
}

export default async function handler(request, response) {
  if (request.method !== "GET" && request.method !== "POST") return reply(response, 405, { error: "method not allowed" });
  const db = serviceClient();
  if (!db) return reply(response, 503, { error: "the payout sweep is not configured on the server" });
  const authorization = request.headers.authorization ?? "";
  const cronSecret = process.env.CRON_SECRET;
  const isCron = request.method === "GET" && Boolean(cronSecret) && authorization === `Bearer ${cronSecret}`;
  if (!isCron && !(request.method === "POST" && (await isStaff(authorization)))) {
    return reply(response, 401, { error: "platform staff access is required" });
  }
  return reply(response, 200, await sweepProviderPayouts(db));
}
