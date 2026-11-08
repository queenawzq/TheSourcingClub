import { paypalRef, webhookRoute } from "./_payout-webhooks.js";
import { paypalFrom } from "./_paypal.js";

/** PayPal's PAYMENT.PAYOUTS-ITEM.* and PAYMENT.PAYOUTSBATCH.*: see api/_payout-webhooks.js. */
export default webhookRoute({
  provider: "paypal",
  build: () => paypalFrom(),
  verify: async ({ request, body, client }) => {
    const webhookId = process.env.PAYPAL_WEBHOOK_ID;
    if (!webhookId) return "not_set_up";
    return client.verifyWebhook({ headers: request.headers, webhookId, rawEvent: body.toString("utf8") });
  },
  identify: ({ event }) => ({ id: event?.id, type: event?.event_type, ...paypalRef(event) }),
});
