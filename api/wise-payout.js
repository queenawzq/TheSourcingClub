import { payoutRoute } from "./_provider-payouts.js";
import { wiseFrom } from "./_wise.js";

/** Staff's Pay with Wise: see api/_provider-payouts.js. */
export default payoutRoute({
  provider: "wise",
  label: "Wise",
  settings: "WISE_API_BASE, WISE_API_TOKEN, WISE_PROFILE_ID and WISE_PAYOUT_CURRENCY",
  build: () => wiseFrom(),
});
