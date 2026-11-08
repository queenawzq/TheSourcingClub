import { createVerify } from "node:crypto";
import { PayoutFailure, withoutSecrets } from "./_payout-provider.js";
import { readBackRef } from "./_provider-payouts.js";
import { rawBody, reply, serviceClient } from "./_stripe.js";

/**
 * Wise and PayPal tell us a payout moved, so the factory's row turns Paid (or
 * Failed) with nobody on the staff board.
 *
 * A webhook is only a prompt. Nothing in its body is written: on a signed event
 * we ask the provider about that one transfer or batch (readBackRef) and record
 * its answer, exactly as the board's Refresh does. A forged event that somehow
 * passed would only make us read.
 *
 * Signature first, before anything is parsed or claimed:
 *   Wise    RSA-SHA256 over the raw body, header X-Signature-SHA256, against
 *           Wise's published key: the sandbox's when WISE_API_BASE says sandbox,
 *           production's otherwise. WISE_WEBHOOK_PUBLIC_KEY overrides both.
 *   PayPal  PayPal's own verify-webhook-signature, with PAYPAL_WEBHOOK_ID.
 *
 * Idempotent like api/stripe-webhook.js: each delivery is claimed in
 * provider_events (claim_provider_event) and marked processed; a repeat does
 * nothing, and one whose handler died is run again after 5 minutes. A failure
 * removes the claim and answers 500, so the provider sends it again (Wise for
 * two weeks, PayPal 25 times over 3 days). The read-back itself can't pay or
 * fail anything twice: finish_provider_payout ignores a repeat.
 *
 * Going live is settings only: the same WISE_API_BASE / PAYPAL_API_BASE switch
 * picks the key and the API, and a live base away from production is refused.
 */

export const WISE_PUBLIC_KEYS = {
  sandbox: `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwpb91cEYuyJNQepZAVfP
ZIlPZfNUefH+n6w9SW3fykqKu938cR7WadQv87oF2VuT+fDt7kqeRziTmPSUhqPU
ys/V2Q1rlfJuXbE+Gga37t7zwd0egQ+KyOEHQOpcTwKmtZ81ieGHynAQzsn1We3j
wt760MsCPJ7GMT141ByQM+yW1Bx+4SG3IGjXWyqOWrcXsxAvIXkpUD/jK/L958Cg
nZEgz0BSEh0QxYLITnW1lLokSx/dTianWPFEhMC9BgijempgNXHNfcVirg1lPSyg
z7KqoKUN0oHqWLr2U1A+7kqrl6O2nx3CKs1bj1hToT1+p4kcMoHXA7kA+VBLUpEs
VwIDAQAB
-----END PUBLIC KEY-----`,
  production: `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAvO8vXV+JksBzZAY6GhSO
XdoTCfhXaaiZ+qAbtaDBiu2AGkGVpmEygFmWP4Li9m5+Ni85BhVvZOodM9epgW3F
bA5Q1SexvAF1PPjX4JpMstak/QhAgl1qMSqEevL8cmUeTgcMuVWCJmlge9h7B1CS
D4rtlimGZozG39rUBDg6Qt2K+P4wBfLblL0k4C4YUdLnpGYEDIth+i8XsRpFlogx
CAFyH9+knYsDbR43UJ9shtc42Ybd40Afihj8KnYKXzchyQ42aC8aZ/h5hyZ28yVy
Oj3Vos0VdBIs/gAyJ/4yyQFCXYte64I7ssrlbGRaco4nKF3HmaNhxwyKyJafz19e
HwIDAQAB
-----END PUBLIC KEY-----`,
};

export function wisePublicKey(env = process.env) {
  if (env.WISE_WEBHOOK_PUBLIC_KEY) return env.WISE_WEBHOOK_PUBLIC_KEY.replace(/\\n/g, "\n");
  return /sandbox/i.test(env.WISE_API_BASE ?? "") ? WISE_PUBLIC_KEYS.sandbox : WISE_PUBLIC_KEYS.production;
}

/** True only when the signature over these exact bytes is Wise's. */
export function wiseSignatureOk(body, signature, publicKey) {
  if (!signature || typeof signature !== "string") return false;
  try {
    const check = createVerify("RSA-SHA256");
    check.update(body);
    return check.verify(publicKey, signature, "base64");
  } catch {
    return false;
  }
}

/** Which transfer a Wise event is about. Only state changes name one we track. */
export function wiseRef(event) {
  if (event?.event_type !== "transfers#state-change") return null;
  const id = event?.data?.resource?.id;
  return id == null ? null : String(id);
}

/** Which batch (and our key) a PayPal event is about. Item events and batch events place them differently. */
export function paypalRef(event) {
  if (!/^PAYMENT\.PAYOUTS(BATCH|-ITEM)\./.test(event?.event_type ?? "")) return { ref: null, key: null };
  const r = event.resource ?? {};
  return {
    ref: r.payout_batch_id ?? r.batch_header?.payout_batch_id ?? null,
    key: r.payout_item?.sender_item_id ?? r.batch_header?.sender_batch_header?.sender_batch_id ?? null,
  };
}

const log = (where, failure, context = {}) => console.error(`${where}:`, withoutSecrets(failure?.message ?? failure), {
  kind: failure?.kind ?? null, detail: withoutSecrets(failure?.detail ?? ""), ...context,
});

/**
 * One route per provider. `verify` answers whether the delivery is the provider's;
 * `identify` gives the delivery id, the event type and what to read back.
 */
export function webhookRoute({ provider, build, verify, identify }) {
  return async function handler(request, response, deps = {}) {
    if (request.method !== "POST") return reply(response, 405, { error: "method not allowed" });

    let client;
    try {
      client = deps.client ?? build();
    } catch (failure) {
      return reply(response, 503, { error: failure.message });
    }
    const db = deps.db ?? serviceClient();
    if (!client || !db) return reply(response, 503, { error: `${provider} payouts are not set up on this site` });

    const body = await rawBody(request);
    let verified;
    try {
      verified = await verify({ request, body, client });
    } catch (failure) {
      log(`${provider}-webhook verify`, failure);
      // PayPal didn't answer the check: say so, and it sends the event again.
      return reply(response, 503, { error: "the signature could not be checked; send it again" });
    }
    if (verified === "not_set_up") return reply(response, 503, { error: `${provider} webhooks are not set up on this site` });
    if (!verified) return reply(response, 400, { error: "bad signature" });

    let event;
    try {
      event = JSON.parse(body.toString("utf8"));
    } catch {
      return reply(response, 400, { error: "not JSON" });
    }
    const { id, type, ref, key, test } = identify({ request, event });
    // Wise checks a new subscription's address with a signed test event.
    if (test || (!ref && !key)) return reply(response, 200, { received: true, ignored: true });
    if (!id) return reply(response, 400, { error: "no delivery id" });

    const eventId = `${provider}:${id}`;
    const { data: claimed, error: claimError } = await db.rpc("claim_provider_event", { event_id: eventId, event_type: String(type ?? "") });
    if (claimError) {
      log(`${provider}-webhook claim`, claimError, { eventId });
      return reply(response, 500, { error: "this event could not be claimed; send it again" });
    }
    if (!claimed) return reply(response, 200, { received: true, duplicate: true });

    try {
      const state = await readBackRef({ client, db, ref, key });
      await db.from("provider_events").update({ processed_at: new Date().toISOString() }).eq("id", eventId);
      // Null: not a payout of this database's (another site on the same account). Answered 200,
      // since a retry can't change that and an endpoint that keeps failing gets switched off.
      return reply(response, 200, { received: true, state: state ?? "unknown_here" });
    } catch (failure) {
      log(`${provider}-webhook`, failure, { eventId, ref });
      await db.from("provider_events").delete().eq("id", eventId);
      return reply(response, 500, { error: failure instanceof PayoutFailure ? failure.message : "the payout could not be read back; send it again" });
    }
  };
}
