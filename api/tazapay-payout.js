import { payoutRoute } from "./_provider-payouts.js";
import { tazapayFrom } from "./_tazapay.js";

/** Staff's Pay with Tazapay: see api/_provider-payouts.js. */
export default payoutRoute({
  provider: "tazapay",
  label: "Tazapay",
  settings: "TAZAPAY_BASE_URL, TAZAPAY_API_KEY and TAZAPAY_API_SECRET",
  build: () => tazapayFrom(),
});
