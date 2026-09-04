/**
 * Money.
 *
 * Dollars on screen, minor units in the database — always. These two functions
 * lived as unexported locals inside BrandOnboarding.jsx; the RFQ composer and
 * the factory quote form both need them, and a third copy is how $18.40
 * becomes 1840 on one screen and 184000 on another.
 *
 * Every monetary column also stores an ISO currency code. Only USD is offered
 * today and a check constraint enforces that, but RMB is coming and adding a
 * currency to a populated payments table later is invasive.
 */

export const DEFAULT_CURRENCY = "USD";

/** "18.40", "$18.40", 18.4 → 1840. Anything unparseable → null. */
export function toCents(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number.parseFloat(String(value).replace(/[^0-9.]/g, ""));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
}

/** 1840 → "18.40", for putting back into an input. */
export function fromCents(cents) {
  if (cents === null || cents === undefined) return "";
  return (cents / 100).toFixed(2).replace(/\.00$/, "");
}

/**
 * 1840 → "$18.40". For display only — never parse this back, which is what
 * the prototype does with regexes over formatted strings.
 */
export function formatMoney(cents, currency = DEFAULT_CURRENCY, options = {}) {
  if (cents === null || cents === undefined) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: options.whole ? 0 : 2,
    minimumFractionDigits: options.whole ? 0 : 2,
  }).format(cents / 100);
}

/** A price band, collapsed when both ends match. */
export function formatRange(minCents, maxCents, currency = DEFAULT_CURRENCY) {
  if (minCents == null && maxCents == null) return "—";
  if (minCents == null) return `up to ${formatMoney(maxCents, currency)}`;
  if (maxCents == null) return `from ${formatMoney(minCents, currency)}`;
  if (minCents === maxCents) return formatMoney(minCents, currency);
  return `${formatMoney(minCents, currency)}–${formatMoney(maxCents, currency)}`;
}
