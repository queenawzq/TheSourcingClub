/** Shared chooser copy for every country; fee calculations remain in withdrawal-fees.mjs. */
const STRIPE_LINES = ["From 0.25% fee, processed by Stripe", "Usually processed within 3–7 business days"];
const WISE_LINES = ["From 0.23% fee, processed by Wise", "Usually processed within 3–7 business days"];
const PAYPAL_LINES = ["Up to 2% fee", "Usually processed within 3–7 business days"];
// Tazapay (China, Hong Kong): its pricing page lists local payouts from US$2; the line follows TSC's chosen wording.
const TAZAPAY_LINES = ["From US$5 fee, processed by Tazapay", "Usually processed within 3–7 business days"];

export const PAYOUT_METHOD_INFO = {
  stripeUs: STRIPE_LINES,
  stripe: STRIPE_LINES,
  wise: WISE_LINES,
  wiseUs: WISE_LINES,
  paypal: PAYPAL_LINES,
  paypalUs: PAYPAL_LINES,
  tazapayCN: TAZAPAY_LINES,
  tazapayHK: TAZAPAY_LINES,
};

export const payoutMethodFeeUrl = (method) => {
  if (method?.startsWith("stripe")) return "https://stripe.com/connect/pricing";
  if (method?.startsWith("wise")) return "https://wise.com/us/pricing/";
  if (method?.startsWith("paypal")) return "https://www.paypal.com/us/business/paypal-business-fees";
  if (method?.startsWith("tazapay")) return "https://tazapay.com/pricing";
  return null;
};

/** The chooser's Tazapay option for a country, or null where Tazapay doesn't pay. */
export const tazapayMethod = (country) => ({ CN: "tazapayCN", HK: "tazapayHK" })[String(country ?? "").toUpperCase()] ?? null;

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
 * opens Wise's form where Wise has a currency for the country; elsewhere there
 * is no bank option (null), and where Wise's form can't be had the card says
 * so and offers PayPal (WiseBankStep's onUnavailable).
 */
export function chooserMethod(option, { supported = false, country = "" } = {}) {
  const us = country === "US";
  if (option === "paypal") return us ? "paypalUs" : "paypal";
  if (option === "bank" && supported) return us ? "stripeUs" : "stripe";
  // No staff-paid bank option: where neither Stripe nor Wise pays, there is no bank line.
  return paidByWise(country) ? (us ? "wiseUs" : "wise") : null;
}
