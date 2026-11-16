import { tazapayRef, tazapaySignatureOk, webhookRoute } from "./_payout-webhooks.js";
import { tazapayFrom } from "./_tazapay.js";

/**
 * Tazapay's payout.* events: see api/_payout-webhooks.js. The event only says
 * "look now": the payout is read back from Tazapay and recorded exactly as the
 * board's Refresh and the daily sweep do, so an event that arrives late or out
 * of order records where the payout is now, never what the event said.
 */
export default webhookRoute({
  provider: "tazapay",
  build: () => tazapayFrom(),
  verify: async ({ request, body }) => {
    const secret = process.env.TAZAPAY_WEBHOOK_SECRET;
    if (!secret) return "not_set_up";
    return tazapaySignatureOk(body, request.headers.signature, secret);
  },
  // Tazapay's retries of one event share its id.
  identify: ({ event }) => ({ id: event?.id, type: event?.type, ref: tazapayRef(event) }),
});
