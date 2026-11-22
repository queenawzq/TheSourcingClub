/**
 * The one balance with the factory's own Stripe money added (D1): what the
 * database holds for it (factory_balance(), all USD) plus what is already in
 * its Stripe account, read live by the `balance` action of
 * /api/stripe-connect. Each dollar in exactly one figure:
 *
 *   available  TSC's Available + Stripe's available balance
 *   pending    TSC's Pending (earnings not yet available) + Stripe's
 *              pending balance
 *   processing TSC's withdrawals in progress (asked for, or on their way)
 *              + the Stripe money an open withdrawal holds
 *   paid out   TSC's Paid out less what is still in the Stripe account
 *   total      the five added up: the database's total, to the cent
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
 * @param stripe    { available, pending, held? } from Stripe (the money in the
 *                  factory's own Stripe account now; `held`, rows of
 *                  { amount, currency }, is the part of `available` an open
 *                  withdrawal holds, counted in Processing), or null. Other keys
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
    processing_cents: n(tsc?.processing_cents),
    paid_out_cents: n(tsc?.paid_out_cents),
    // Refunded after it was withdrawn: inside Available (already taken off it).
    owed_to_tsc_cents: n(tsc?.owed_to_tsc_cents),
    // The part its earnings do not cover: the card's "You owe TSC" line.
    uncovered_debt_cents: n(tsc?.uncovered_debt_cents),
    has_method: Boolean(tsc?.has_method),
    no_saved_method: tsc?.no_saved_method === true,
    next_cleared_at: tsc?.next_cleared_at ?? null,
    withdrawals: tsc?.withdrawals ?? [],
  };
  // Money in the Stripe account an open withdrawal holds (its own part, or
  // owed money transferred for its payout) is on its way: Processing.
  const heldCents = stripe ? usdTotal(stripe.held ?? [], displayFx) : 0;
  const availableRaw = stripe ? usdTotal(stripe.available, displayFx) : null;
  const pendingRaw = stripe ? usdTotal(stripe.pending, displayFx) : null;
  const heldKnown = heldCents == null ? 0 : Math.min(heldCents, availableRaw ?? 0);
  const parts = stripe ? {
    available_cents: availableRaw == null ? null : availableRaw - heldKnown,
    pending_cents: pendingRaw,
    // The Stripe money an open withdrawal holds (on its way): Processing.
    processing_cents: heldKnown,
    held_cents: heldKnown,
    // Kept for readers of the old shape: the database now holds these.
    in_transit_cents: 0,
    paid_out_cents: 0,
  } : null;
  const known = parts && parts.available_cents != null && parts.pending_cents != null;
  // How much the clamp below took (US cents). At an indicative rate a little
  // is expected; with every Stripe amount in US dollars it means the two
  // reads disagree (a withdrawal moved between them), so the answer says it
  // is not consistent and the page asks again (`consistent`).
  let clamped = 0;
  if (known) {
    // At an indicative rate, what is in the Stripe account can read a little
    // more than the database counted as sent: Paid out never goes below
    // zero, and the excess comes off the Stripe part of Available (then of
    // Pending), so the total stays the database's.
    let over = Math.max(0, parts.available_cents + parts.pending_cents + parts.processing_cents - base.paid_out_cents);
    clamped = over;
    const fromAvailable = Math.min(over, parts.available_cents);
    parts.available_cents -= fromAvailable;
    over -= fromAvailable;
    const fromPending = Math.min(over, parts.pending_cents);
    parts.pending_cents -= fromPending;
    over -= fromPending;
    parts.processing_cents -= Math.min(over, parts.processing_cents);
    parts.held_cents = parts.processing_cents;
  }
  const inStripe = known ? parts.available_cents + parts.pending_cents + parts.processing_cents : 0;
  const figures = known ? {
    ...base,
    available_cents: base.available_cents + parts.available_cents,
    pending_cents: base.pending_cents + parts.pending_cents,
    processing_cents: base.processing_cents + parts.processing_cents,
    paid_out_cents: base.paid_out_cents - inStripe,
    estimated: [stripe.available, stripe.pending].some(converted),
  } : { ...base, estimated: false };
  const suspect = known && clamped > 0 && ![stripe.available, stripe.pending, stripe.held].some(converted);
  return {
    ...figures,
    // Only when false: logged by the server (a clamp with every amount in US$).
    ...(suspect ? { consistent: false } : {}),
    total_cents: figures.awaiting_cents + figures.available_cents + figures.pending_cents + figures.processing_cents + figures.paid_out_cents,
    tsc: tsc ?? null,
    stripe: known ? parts : null,
  };
}
