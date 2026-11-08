import { payoutRoute } from "./_provider-payouts.js";
import { paypalFrom } from "./_paypal.js";

/** Staff's Pay with PayPal: see api/_provider-payouts.js. */
export default payoutRoute({
  provider: "paypal",
  label: "PayPal",
  settings: "PAYPAL_API_BASE, PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET",
  build: () => paypalFrom(),
});
