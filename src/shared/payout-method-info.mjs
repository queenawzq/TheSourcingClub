/**
 * What each withdrawal method costs and how long it takes, in the two short
 * lines the chooser draws under its name. One entry per route, so a new
 * provider adds its own here. Each option names the provider that pays the
 * factory, and its fee as a percentage of what reaches it.
 *
 * Every line must be true for every country it is shown in. No payout is
 * instant (a card payment can still be reversed), so each says so.
 * The fee line comes from src/shared/withdrawal-fees.mjs, the one source of
 * the fee: the factory pays the provider's fee, TSC none (its header has the
 * figures and their sources). Routes, checked 2026-11-15:
 *
 *   stripe / stripeUs  "Bank account (Stripe)" where Stripe pays out
 *           (stripe-payout-countries.mjs). TSC-managed accounts are created
 *           with fees.payer = application (api/_stripe-payouts.js), so Stripe
 *           bills TSC its payout fees, and the transfer holds them back. TSC
 *           transfers US$ (api/_stripe.js); outside the US Stripe converts it
 *           to the account's currency at its rate
 *           (https://docs.stripe.com/connect/currencies). Stripe publishes no
 *           figure for converting a Connect transfer, so that line has no
 *           number. Timing: "Manual payouts typically take 1–4 business days"
 *           (https://docs.stripe.com/payouts).
 *   wise    "International bank transfer (Wise)" (US: "Bank transfer (Wise)"), and "Bank transfer (Wise)"
 *           where Wise has a currency for the country (wiseCurrencyFor). Wise's
 *           quoted fee comes out of the step, the rest converted at Wise's
 *           mid-market rate (api/_wise.js, quote();
 *           https://wise.com/pricing/business).
 *   bank    "Bank transfer" where Wise has no currency (Taiwan, Cambodia, a
 *           country not listed): staff pay it by bank ("Mark paid out by bank"),
 *           and TSC charges nothing for it.
 *   wiseUs / paypalUs  the same for a US factory, paid US$ to US$, so without
 *           the conversion words.
 *   paypal  PayPal Payouts: PayPal bills the sender (TSC), and the
 *           payment sent holds it back
 *           (https://developer.paypal.com/docs/payouts/standard/reference/fees/).
 *           PayPal charges the receiver to convert US$, about 3% above its base
 *           rate on its regional fee pages
 *           (https://www.paypal.com/us/business/paypal-business-fees), more in
 *           some countries. Timing: staff send it from the payments board once
 *           released (api/_provider-payouts.js), and it usually reaches the
 *           PayPal balance within minutes, so no "few business days" here.
 */

import { withdrawalFeeLine } from "./withdrawal-fees.mjs";

const SENT_AFTER_RELEASE = "Not instant: sent once released, then a few business days to arrive";
const STRIPE_TIMING = "Not instant: usually 1–4 business days after you withdraw";

export const PAYOUT_METHOD_INFO = {
  stripeUs: [withdrawalFeeLine("stripe", { country: "US" }), STRIPE_TIMING],
  stripe: [withdrawalFeeLine("stripe"), STRIPE_TIMING],
  wise: [withdrawalFeeLine("wise"), SENT_AFTER_RELEASE],
  // A US factory is paid US$ to US$: nothing is converted.
  wiseUs: [withdrawalFeeLine("wise", { country: "US" }), SENT_AFTER_RELEASE],
  bank: [withdrawalFeeLine("bank"), SENT_AFTER_RELEASE],
  paypal: [withdrawalFeeLine("paypal"), "Not instant: sent once released"],
  paypalUs: [withdrawalFeeLine("paypal", { country: "US" }), "Not instant: sent once released"],
};

export const payoutMethodLines = (method) => PAYOUT_METHOD_INFO[method] ?? [];

/**
 * The countries api/_wise-currencies.js has a Wise currency for: a bank option
 * there opens Wise's form. Wise is set up on a deploy only with its payout
 * currency (api/wise-requirements.js), which is China's, so China is one
 * whenever Wise is there at all. A copy, because the browser cannot load
 * api/ (the dev server answers /api/* as functions); check-payout-help.mjs
 * fails if the two differ.
 */
export const WISE_COUNTRIES = new Set([
  "AT", "BE", "BG", "HR", "CY", "EE", "FI", "FR", "DE", "GR", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PT", "SK", "SI", "ES",
  "US", "CA", "GB", "CH", "LI", "CZ", "DK", "HU", "PL", "RO", "SE", "IS", "NO",
  "HK", "VN", "IN", "BD", "PK", "TR", "ID", "TH", "LK", "KR", "JP", "MX", "BR", "MA", "EG", "CN",
]);

export const paidByWise = (country) => WISE_COUNTRIES.has(country);

/**
 * Which lines a chooser option draws: the route its Set up actually takes.
 * "Bank account" in a Stripe country is Stripe's. Every other bank option
 * opens Wise's form where Wise has a currency for the country, and staff's
 * bank form otherwise (WiseBankStep's onUnavailable).
 */
export function chooserMethod(option, { supported = false, country = "" } = {}) {
  const us = country === "US";
  if (option === "paypal") return us ? "paypalUs" : "paypal";
  if (option === "bank" && supported) return us ? "stripeUs" : "stripe";
  return paidByWise(country) ? (us ? "wiseUs" : "wise") : "bank";
}
