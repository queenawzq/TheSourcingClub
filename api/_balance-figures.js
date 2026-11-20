/**
 * The one balance with the factory's own Stripe money added (D1): what the
 * database holds for it (factory_balance(), all USD) plus what is already in
 * its Stripe account, read live by the `balance` action of
 * /api/stripe-connect. Each dollar in exactly one figure:
 *
 *   available  TSC's Available + Stripe's available balance
 *   pending    TSC's Pending + Stripe's pending balance + payouts on their way
 *   paid out   TSC's Paid out, with the steps it paid by Stripe transfer
 *              replaced by Stripe's paid payouts (what reached the bank)
 *   total      the four added up, never worked out separately
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
 * @param stripe    { available, pending, onTheirWay, payouts } from Stripe, or null
 * @param displayFx payoutDisplayRates() (may be null)
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
  };
  const paidRows = (stripe?.payouts ?? []).filter((payout) => payout.paid).map(({ amount, currency }) => ({ amount, currency }));
  const parts = stripe ? {
    available_cents: usdTotal(stripe.available, displayFx),
    pending_cents: usdTotal(stripe.pending, displayFx),
    in_transit_cents: usdTotal(stripe.onTheirWay, displayFx),
    paid_out_cents: usdTotal(paidRows, displayFx),
  } : null;
  const known = parts && Object.values(parts).every((value) => value != null);
  const figures = known ? {
    ...base,
    available_cents: base.available_cents + parts.available_cents,
    pending_cents: base.pending_cents + parts.pending_cents + parts.in_transit_cents,
    // The database already took Stripe's payout fees out of Paid out; the
    // Stripe payouts below are net of them, so the fees are put back first.
    paid_out_cents: base.paid_out_cents + n(tsc?.parts?.stripe_withdrawal_fees_cents) - n(tsc?.parts?.stripe_released_cents) + parts.paid_out_cents,
    estimated: [stripe.available, stripe.pending, stripe.onTheirWay, paidRows].some(converted),
  } : { ...base, estimated: false };
  return {
    ...figures,
    total_cents: figures.awaiting_cents + figures.available_cents + figures.pending_cents + figures.paid_out_cents,
    tsc: tsc ?? null,
    stripe: known ? parts : null,
  };
}
