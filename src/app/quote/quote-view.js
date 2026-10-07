/**
 * A stored quote, read the way the designed brand screens print one.
 *
 * The quote cards, the compare table, the quote detail and the contract step
 * all show the same figures. Written once here, so the price on the card and
 * the price on the contract cannot disagree, and so no screen falls back to
 * the prototype's per-vendor constants (the compare table used to print
 * "30% deposit · 70% before shipment" and a $260 sample subtotal for every
 * live quote).
 *
 * Anything with nothing behind it is "" — the designed components render a
 * row conditionally on that, rather than printing a placeholder figure.
 */
import { formatMoney } from "../../lib/money.js";
import { formatCapacityWindow, quoteTotalCents } from "../../lib/domain/quote.js";
import { termLabel } from "../../lib/domain/taxonomy.js";

export const initialsOf = (name) =>
  (name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join("") || "??";

const money = (cents, currency) => (cents == null ? "" : formatMoney(cents, currency));

/** "30% deposit · 70% before shipment", from the stored split — never guessed. */
export function paymentTermsOf(quote) {
  if (quote?.deposit_pct == null) return "";
  const deposit = Number(quote.deposit_pct);
  const balance = Number(quote.balance_pct ?? 100 - deposit);
  return `${deposit}% deposit · ${balance}% before shipment`;
}

/**
 * What the vendor wrote about shipping ("FOB Porto"), or failing that the
 * incoterm the schema matched it to. `incoterms` is the incoterm term list.
 */
export function shippingOf(quote, incoterms = []) {
  if (quote?.shipping_notes?.trim()) return quote.shipping_notes.trim();
  const term = incoterms.find((candidate) => candidate.id === quote?.incoterm_id);
  return term ? `${termLabel(term)} quoted` : "";
}

/** The sample stages, as the plan the vendor wrote. */
export function samplePlanOf(quote) {
  const lines = quote?.sampleLines ?? [];
  if (!lines.length) return "";
  const stages = lines.map((line) => line.stage).filter(Boolean).join(" + ");
  const days = lines.reduce((total, line) => total + (Number(line.timing_days) || 0), 0);
  return days ? `${stages} · ${days} days` : stages;
}

export function validUntilOf(quote) {
  if (!quote?.valid_until) return "";
  // A bare date parses as UTC midnight and renders a day early west of
  // Greenwich; pinning the time keeps it the day the vendor typed.
  return new Date(`${quote.valid_until}T00:00:00`).toLocaleDateString("en", { dateStyle: "medium" });
}

/**
 * Everything a brand screen prints about one quote. `incoterms` is optional;
 * without it shipping shows only what the vendor typed.
 */
export function describeQuote(quote, { incoterms = [] } = {}) {
  const currency = quote.currency;
  const name = quote.orgs?.name ?? quote.factory_name ?? "Vendor";
  const total = quoteTotalCents(quote);
  const quantity = quote.production_quantity ? `${quote.production_quantity} units` : "";

  return {
    id: quote.id,
    name,
    initials: initialsOf(name),
    version: quote.version,
    status: quote.status,
    price: money(quote.unit_price_cents, currency),
    quantity,
    lead: quote.bulk_lead_time_days ? `${quote.bulk_lead_time_days} days` : "",
    productionSubtotal: money(quote.productionSubtotalCents, currency),
    sampleSubtotal: quote.sampleLines?.length ? money(quote.sampleSubtotalCents ?? 0, currency) : "",
    total: money(total, currency),
    paymentTerms: paymentTermsOf(quote),
    shipping: shippingOf(quote, incoterms),
    capacityWindow: formatCapacityWindow(quote),
    samplePlan: samplePlanOf(quote),
    validUntil: validUntilOf(quote),
    notes: quote.factory_notes ?? "",
    sampleRows: (quote.sampleLines ?? []).map((line) => ({
      stage: line.stage ?? "",
      cost: money(line.cost_cents, currency),
      timing: line.timing_days ? `${line.timing_days} days` : "",
      includes: line.includes ?? "",
    })),
  };
}
