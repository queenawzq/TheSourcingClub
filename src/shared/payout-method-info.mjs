/**
 * What each withdrawal method costs and how long it takes, in the two short
 * lines the chooser draws under its name (Nov 12 call: "like the Upwork
 * example"). One entry per method, so a new provider adds its own here.
 *
 * Every line must be true. No payout is instant (John, Nov 12: a card payment
 * can still be reversed), so each says so. Where a provider's own figure is
 * not established, the line has no number.
 *
 *   stripe  "Bank account" where Stripe pays out (stripe-payout-countries.mjs).
 *           The factory withdraws its available balance itself (a standard
 *           payout, never instant); TSC-managed accounts are created with
 *           fees.payer = application, so Stripe's payout fee is TSC's
 *           (api/_stripe-payouts.js). Timing: Stripe, "Manual payouts typically
 *           take 1–4 business days" (docs.stripe.com/payouts, checked 2026-11-13).
 *   wise    "Bank transfer" / "International bank transfer". TSC pays Wise's fee
 *           on top, so the whole step arrives (api/_wise.js, quote()).
 *   bank    "Bank transfer" for a country not listed: staff pay it by bank
 *           ("Mark paid out by bank").
 *   tazapay "Bank transfer (Tazapay)" in mainland China (CNY over CNAPS) and Hong
 *           Kong (HKD over CHATS) (src/shared/tazapay-payout.mjs). TSC pays
 *           Tazapay's fee on top (about US$5.40 a payout, sandbox Nov 15), so
 *           the whole step is converted; Tazapay sets the rate (quote,
 *           api/_tazapay.js). China payouts run weekdays 9-5 China time, 3pm
 *           cut-off, and settle the same or next day.
 *   paypal  PayPal Payouts: the sender (TSC) pays the payout fee
 *           (developer.paypal.com/docs/payouts/standard/reference/fees/).
 *           Timing: staff send it from the payments board once released
 *           (api/_provider-payouts.js), and it usually reaches the PayPal
 *           balance within minutes; only withdrawing from PayPal to a bank
 *           takes days. So no "few business days" here (Nov 13 tester, #3).
 */
const SENT_AFTER_RELEASE = "Not instant: sent once released, then a few business days to arrive";
const TAZAPAY_TIMING = "Not instant: sent once released, then usually the same or next business day";

export const PAYOUT_METHOD_INFO = {
  stripe: ["No TSC fee per withdrawal", "Not instant: usually 1–4 business days after you withdraw"],
  wise: ["No fee: TSC pays the transfer fee", SENT_AFTER_RELEASE],
  bank: ["No TSC fee; your bank may charge to receive a transfer", SENT_AFTER_RELEASE],
  paypal: ["No TSC fee; PayPal may charge to convert or withdraw", "Not instant: sent once released"],
  tazapayCN: ["Fee: 0% (TSC pays Tazapay's fee); arrives in CNY at Tazapay's rate", TAZAPAY_TIMING],
  tazapayHK: ["Fee: 0% (TSC pays Tazapay's fee); arrives in HKD at Tazapay's rate", TAZAPAY_TIMING],
};

/** The chooser's Tazapay option for a country, or null where Tazapay doesn't pay. */
export const tazapayMethod = (country) => ({ CN: "tazapayCN", HK: "tazapayHK" })[String(country ?? "").toUpperCase()] ?? null;

export const payoutMethodLines = (method) => PAYOUT_METHOD_INFO[method] ?? [];

/**
 * Which lines a chooser option draws: the route its Set up actually takes.
 * "Bank account" in a Stripe country is Stripe's. Every other bank option opens
 * Wise's form only when the server has a Wise currency for the country and Wise
 * is set up on the deploy (api/wise-requirements.js); otherwise, Taiwan and
 * Cambodia today, it falls back to staff's bank form (WiseBankStep's
 * onUnavailable). The browser cannot know which, so those options draw the
 * bank lines, true of both. `wise` waits for a route the browser can know.
 */
export function chooserMethod(option, { supported = false } = {}) {
  if (option === "paypal") return "paypal";
  return option === "bank" && supported ? "stripe" : "bank";
}
