import { webhookRoute, wisePublicKey, wiseRef, wiseSignatureOk } from "./_payout-webhooks.js";
import { wiseFrom } from "./_wise.js";

/** Wise's transfers#state-change: see api/_payout-webhooks.js. */
export default webhookRoute({
  provider: "wise",
  build: () => wiseFrom(),
  verify: async ({ request, body }) => wiseSignatureOk(body, request.headers["x-signature-sha256"], wisePublicKey()),
  identify: ({ request, event }) => ({
    // Wise's retries of one event share this id.
    id: request.headers["x-delivery-id"],
    type: event?.event_type,
    ref: wiseRef(event),
    test: String(request.headers["x-test-notification"] ?? "") === "true",
  }),
});
