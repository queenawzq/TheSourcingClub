/**
 * What each withdrawal method costs and how long it takes, in the two short
 * lines the chooser draws under its name. One entry per route, so a new
 * provider adds its own here. Each option names the provider that pays the
 * factory, and its fee as a percentage of what reaches it.
 *
 * Every line must be true for every country it is shown in. No payout is
 * instant (a card payment can still be reversed), so each says so.
 * Fees and figures checked 2026-11-15:
 *
 *   stripe / stripeUs  "Bank account (Stripe)" where Stripe pays out
 *           (stripe-payout-countries.mjs). TSC-managed accounts are created
 *           with fees.payer = application (api/_stripe-payouts.js), so Stripe's
 *           payout fees are TSC's (https://stripe.com/connect/pricing). TSC
 *           transfers US$ (api/_stripe.js); outside the US Stripe converts it
 *           to the account's currency at its rate
 *           (https://docs.stripe.com/connect/currencies). Stripe publishes no
 *           figure for converting a Connect transfer, so that line has no
 *           number. Timing: "Manual payouts typically take 1–4 business days"
 *           (https://docs.stripe.com/payouts).
 *   wise    "International bank transfer (Wise)", and "Bank transfer (Wise)"
 *           where Wise has a currency for the country (wiseCurrencyFor). TSC
 *           pays Wise's fee on top, so the whole step arrives, converted at
 *           Wise's mid-market rate (api/_wise.js, quote();
 *           https://wise.com/pricing/business).
 *   bank    "Bank transfer" where Wise has no currency (Taiwan, Cambodia, a
 *           country not listed): staff pay it by bank ("Mark paid out by bank").
 *   paypal  PayPal Payouts: the sender (TSC) pays the payout fee
 *           (https://developer.paypal.com/docs/payouts/standard/reference/fees/).
 *           PayPal charges the receiver to convert US$, about 3% above its base
 *           rate on its regional fee pages
 *           (https://www.paypal.com/us/business/paypal-business-fees), more in
 *           some countries. Timing: staff send it from the payments board once
 *           released (api/_provider-payouts.js), and it usually reaches the
 *           PayPal balance within minutes, so no "few business days" here.
 */
import { wiseCurrencyFor } from "../../api/_wise-currencies.js";

const SENT_AFTER_RELEASE = "Not instant: sent once released, then a few business days to arrive";
const STRIPE_TIMING = "Not instant: usually 1–4 business days after you withdraw";

export const PAYOUT_METHOD_INFO = {
  stripeUs: ["Fee: 0% (TSC pays Stripe's fee)", STRIPE_TIMING],
  stripe: ["Fee: 0% to withdraw; Stripe converts from US$ at its rate", STRIPE_TIMING],
  wise: ["Fee: 0% (TSC pays Wise's fee), at the mid-market rate", SENT_AFTER_RELEASE],
  bank: ["Paid by TSC by bank; your bank may charge to receive it", SENT_AFTER_RELEASE],
  paypal: ["Fee: 0% (TSC pays PayPal's fee); PayPal may charge about 3–4% to convert US$", "Not instant: sent once released"],
};

export const payoutMethodLines = (method) => PAYOUT_METHOD_INFO[method] ?? [];

/**
 * Whether a bank option in this country opens Wise's form. Wise is set up on
 * a deploy only with its payout currency (api/wise-requirements.js), which is
 * China's, so China counts as one whenever Wise is there at all.
 */
export const paidByWise = (country) => Boolean(country && wiseCurrencyFor(country, "CNY"));

/**
 * Which lines a chooser option draws: the route its Set up actually takes.
 * "Bank account" in a Stripe country is Stripe's. Every other bank option
 * opens Wise's form where Wise has a currency for the country, and staff's
 * bank form otherwise (WiseBankStep's onUnavailable).
 */
export function chooserMethod(option, { supported = false, country = "" } = {}) {
  if (option === "paypal") return "paypal";
  if (option === "bank" && supported) return country === "US" ? "stripeUs" : "stripe";
  return paidByWise(country) ? "wise" : "bank";
}
