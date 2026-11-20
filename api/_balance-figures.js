/**
 * The one balance with the factory's own Stripe money added (D1): what the
 * database holds for it (factory_balance(), all USD) plus what is already in
 * its Stripe account, read live by the `balance` action of
 * /api/stripe-connect. Each dollar in exactly one figure:
 *
 *   available  TSC's Available + Stripe's available balance
 *   pending    TSC's Pending (which holds payouts on their way) + Stripe's
 *              pending balance
 *   paid out   TSC's Paid out less what is still in the Stripe account
 *   total      the four added up: the database's total, to the cent
 *
 * Stripe amounts in another currency are converted with the indicative
 * display rates (payoutDisplayRates), and `estimated` says so. A currency
 * with no rate leaves Stripe out (`stripe: null`): the figures are then the
 * database's own, never a guess.
 *
 * Pure, so check scripts can run it without Stripe.
 */

/** Minor units of `currency` as US cents, or null when there is no rate. */
export function usdCents(amount, currency, displayFx) {
  const code = String(currency ?? "").toUpperCase();
  const value = Number(amount) || 0;
  if (code === "USD") return value;
  if (!value) return 0;
  const rate = displayFx?.rates?.[code];
  if (!(rate > 0)) return null;
  return Math.round(value * rate);
}

/** Sum rows of { amount, currency } in US cents; null when any has no rate. */
function usdTotal(rows, displayFx) {
  let total = 0;
  for (const row of rows ?? []) {
    const cents = usdCents(row.amount, row.currency, displayFx);
    if (cents == null) return null;
    total += cents;
  }
  return total;
}

const converted = (rows) => (rows ?? []).some((row) => String(row.currency ?? "").toUpperCase() !== "USD" && Number(row.amount));

/**
 * @param tsc       factory_balance(org) as the database returned it
 * @param stripe    { available, pending } from Stripe (the money in the
 *                  factory's own Stripe account now), or null. Other keys
 *                  (onTheirWay, payouts) are ignored: the database counts
 *                  every payout, on its way or arrived, in the US dollars it
 *                  took from the balance.
 * @param displayFx payoutDisplayRates() (may be null)
 *
 * The total is the database's to the cent. Only where the money sits moves:
 * what is in the factory's Stripe account now (which the database counts as
 * sent, in Paid out) moves to Available and Pending, at the indicative rate
 * (`estimated` when converted).
 */
export function balanceFigures(tsc, stripe, displayFx) {
  const n = (value) => Number(value) || 0;
  const base = {
    currency: "USD",
    awaiting_cents: n(tsc?.awaiting_cents),
    available_cents: n(tsc?.available_cents),
    pending_cents: n(tsc?.pending_cents),
    paid_out_cents: n(tsc?.paid_out_cents),
    has_method: Boolean(tsc?.has_method),
    next_cleared_at: tsc?.next_cleared_at ?? null,
    withdrawals: tsc?.withdrawals ?? [],
  };
  const parts = stripe ? {
    available_cents: usdTotal(stripe.available, displayFx),
    pending_cents: usdTotal(stripe.pending, displayFx),
    // Kept for readers of the old shape: the database now holds these.
    in_transit_cents: 0,
    paid_out_cents: 0,
  } : null;
  const known = parts && parts.available_cents != null && parts.pending_cents != null;
  const inStripe = known ? parts.available_cents + parts.pending_cents : 0;
  const figures = known ? {
    ...base,
    available_cents: base.available_cents + parts.available_cents,
    pending_cents: base.pending_cents + parts.pending_cents,
    paid_out_cents: base.paid_out_cents - inStripe,
    estimated: [stripe.available, stripe.pending].some(converted),
  } : { ...base, estimated: false };
  return {
    ...figures,
    total_cents: figures.awaiting_cents + figures.available_cents + figures.pending_cents + figures.paid_out_cents,
    tsc: tsc ?? null,
    stripe: known ? parts : null,
  };
}
