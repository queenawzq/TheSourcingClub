/**
 * Where a US platform can pay out through Connect: the US, Canada, the UK,
 * Switzerland and the EEA (Stripe, "Cross-border payouts", checked
 * 2026-10-11). A factory elsewhere (mainland China, Hong Kong, Vietnam…) is
 * paid by bank transfer by staff from the money TSC holds.
 *
 * Shared by api/stripe-connect.js, which refuses the rest, and the factory's
 * Payments page, which says so before anyone clicks.
 */
export const PAYOUT_COUNTRIES = new Set([
  "US", "CA", "GB", "CH",
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT",
  "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "IS", "LI", "NO",
]);
