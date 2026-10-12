/**
 * Where a US platform can pay out through Connect: the US, Canada, the UK,
 * Switzerland and the EEA (Stripe, "Cross-border payouts", checked
 * 2026-10-11). A factory elsewhere (mainland China, Hong Kong, Vietnam…) is
 * paid by bank transfer by staff from the money TSC holds.
 *
 * The factory's Payments page says so before anyone clicks; api/_stripe.js
 * keeps its own copy (Vercel builds api/ on its own) and refuses the rest.
 * The smoke test fails if the two lists differ.
 */
export const PAYOUT_COUNTRIES = new Set([
  "US", "CA", "GB", "CH",
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT",
  "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "IS", "LI", "NO",
]);
