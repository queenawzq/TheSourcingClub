import { PayoutFailure, apiBase, decimal, timedCall } from "./_payout-provider.js";

/**
 * PayPal Payouts, for staff's Pay with PayPal. Server only.
 *
 * One setting per value (PAYPAL_API_BASE, PAYPAL_CLIENT_ID,
 * PAYPAL_CLIENT_SECRET) and no branch on which account this is.
 *
 * sender_batch_id is the idempotency key: PayPal refuses a repeat with
 * "already exists" and a link to the original (seen on the sandbox), which is
 * how a press after a timeout finds what the first one did.
 *
 * A batch's status doesn't say the money went: a batch reads SUCCESS while its
 * one item is UNCLAIMED, an address with no PayPal account. Only the item counts.
 */

const LABEL = "PayPal";

export const PAYPAL_ITEM_STATES = {
  SUCCESS: "paid",
  PENDING: "sent",
  ONHOLD: "sent",
  UNCLAIMED: "sent",
  NEW: "sent",
  FAILED: "failed",
  RETURNED: "failed",
  BLOCKED: "failed",
  REFUNDED: "failed",
  REVERSED: "failed",
};

const PAYPAL_FAILURES = {
  FAILED: "PayPal couldn't pay this. Check the factory's PayPal address, then pay again.",
  RETURNED: "PayPal returned this to TSC: nothing arrived. Check the factory's PayPal address, then pay again.",
  BLOCKED: "PayPal blocked this payment. Check why in PayPal before paying again.",
  REFUNDED: "This payment was refunded to TSC. Check why in PayPal before paying again.",
  REVERSED: "This payment was reversed. Check why in PayPal before paying again.",
};

export const PAYPAL_UNCLAIMED = "Not claimed: no PayPal account at this address. Ask the factory to open one, or cancel and pay again. Returns to TSC after 30 days.";

export function paypalFrom(env = process.env, fetchImpl = fetch) {
  const base = apiBase(env, "PAYPAL_API_BASE", LABEL);
  const id = env.PAYPAL_CLIENT_ID;
  const secret = env.PAYPAL_CLIENT_SECRET;
  if (!base || !id || !secret) return null;

  async function token() {
    const answer = await timedCall({
      fetchImpl, label: LABEL, url: `${base}/v1/oauth2/token`, method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    if (answer.status === 401 || answer.status === 403) {
      throw new PayoutFailure("key_refused", "PayPal refused TSC's API keys. Check PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.", { status: answer.status });
    }
    if (answer.status >= 300 || !answer.body?.access_token) {
      throw new PayoutFailure("provider_down", "PayPal is having trouble, so nothing was sent. Press again in a minute.", { status: answer.status });
    }
    return answer.body.access_token;
  }

  /** A string body goes as it is: a webhook's event must reach PayPal byte for byte. */
  async function call(method, path, body) {
    const bearer = await token();
    const answer = await timedCall({
      fetchImpl, label: LABEL, url: `${base}${path}`, method,
      headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    if (answer.status === 401) {
      throw new PayoutFailure("key_refused", "PayPal refused TSC's API keys. Check PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.", { status: 401 });
    }
    if (answer.status >= 500 || answer.status === 429) {
      throw new PayoutFailure("provider_down", "PayPal is having trouble, so we don't know yet if this went. Press again in a minute: it can't pay twice.", { unsure: true, status: answer.status });
    }
    return answer;
  }

  const batchIn = (answer) => {
    const detail = (answer.body?.details ?? []).find((d) => d.field === "SENDER_BATCH_ID");
    if (!detail) return null;
    const href = (detail.link ?? [])[0]?.href ?? "";
    return href.split("/").pop() || null;
  };

  const isDuplicate = (answer) => /already exists/i.test(answer.body?.message ?? "")
    || (answer.body?.details ?? []).some((d) => d.field === "SENDER_BATCH_ID" || /already exists/i.test(d.issue ?? ""));

  return {
    provider: "paypal",
    /** The app's address, from the API's. */
    appUrl: base.replace("//api-m.", "//www."),

    /** Same key, same batch: a repeat answers with the original's id. */
    async pay({ key, email, amountCents, currency, reference }) {
      const answer = await call("POST", "/v1/payments/payouts", {
        sender_batch_header: { sender_batch_id: key, email_subject: "Payment from The Sourcing Club", recipient_type: "EMAIL" },
        items: [{
          recipient_type: "EMAIL",
          amount: { value: decimal(amountCents), currency },
          receiver: email,
          note: reference,
          sender_item_id: key,
        }],
      });
      if (answer.status < 300) return { batchId: answer.body.batch_header.payout_batch_id };
      const existing = batchIn(answer);
      if (existing) return { batchId: existing };
      // It exists but PayPal didn't say where. Read as a refusal this would end the
      // attempt, and the next press would pay again under a new key.
      if (isDuplicate(answer)) {
        throw new PayoutFailure("already_exists", "PayPal says this payment already exists but didn't say where. Check PayPal before paying it any other way.", { unsure: true, status: answer.status });
      }
      if (answer.body?.name === "INSUFFICIENT_FUNDS") {
        throw new PayoutFailure("short_balance", "TSC's PayPal balance is too low for this. Add money in PayPal, then pay again.", { status: answer.status });
      }
      if (answer.body?.name === "VALIDATION_ERROR" && (answer.body.details ?? []).some((d) => /receiver/i.test(d.field ?? ""))) {
        throw new PayoutFailure("refused", "PayPal says this address isn't valid. Ask the factory to check it on its Payments page.", { status: answer.status });
      }
      throw new PayoutFailure("refused", "PayPal refused this payment. Nothing was sent.", { status: answer.status, detail: answer.body?.name ?? null });
    },

    async status(batchId) {
      const answer = await call("GET", `/v1/payments/payouts/${batchId}`);
      if (answer.status >= 300) throw new PayoutFailure("refused", "PayPal wouldn't show this payment.", { status: answer.status });
      const item = (answer.body.items ?? [])[0];
      const batch = answer.body.batch_header?.batch_status;
      if (!item) {
        if (batch === "DENIED" || batch === "CANCELED") {
          return { raw: batch, state: "failed", failure: "PayPal refused this payment. Nothing was sent.", itemId: null };
        }
        return { raw: batch ?? null, state: "sent", failure: null, itemId: null };
      }
      const raw = item.transaction_status;
      return {
        raw,
        state: PAYPAL_ITEM_STATES[raw] ?? null,
        failure: PAYPAL_FAILURES[raw] ?? null,
        waiting: raw === "UNCLAIMED" ? PAYPAL_UNCLAIMED : null,
        factoryFixes: raw === "UNCLAIMED",
        itemId: item.payout_item_id ?? null,
      };
    },

    /**
     * PayPal's own check of a webhook's signature: the headers it sent, our
     * webhook's id (PAYPAL_WEBHOOK_ID) and the event's raw text, unparsed.
     * True only on PayPal's SUCCESS.
     */
    async verifyWebhook({ headers, webhookId, rawEvent }) {
      const fields = JSON.stringify({
        auth_algo: headers["paypal-auth-algo"] ?? "",
        cert_url: headers["paypal-cert-url"] ?? "",
        transmission_id: headers["paypal-transmission-id"] ?? "",
        transmission_sig: headers["paypal-transmission-sig"] ?? "",
        transmission_time: headers["paypal-transmission-time"] ?? "",
        webhook_id: webhookId,
      });
      const answer = await call("POST", "/v1/notifications/verify-webhook-signature",
        `${fields.slice(0, -1)},"webhook_event":${rawEvent}}`);
      return answer.status < 300 && answer.body?.verification_status === "SUCCESS";
    },

    /** Only an unclaimed payment can be taken back. */
    async cancel(itemId) {
      const answer = await call("POST", `/v1/payments/payouts-item/${itemId}/cancel`);
      if (answer.status >= 300) throw new PayoutFailure("refused", "PayPal wouldn't cancel this: it may have been claimed. Press Refresh.", { status: answer.status });
      return { raw: answer.body?.transaction_status ?? null };
    },
  };
}
