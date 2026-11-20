/**
 * One payment of scripts/backfill-funds-available.mjs: what Stripe says now
 * against what the database holds, decided without any I/O (decideBackfill),
 * then recorded through the server's own functions (applyBackfill). Split out
 * so the decision can be tested without a stack or Stripe.
 *
 * The leading underscore keeps Vercel from serving this file.
 */

/**
 * @param row     { id, state, funds_available_at, disputed_at } from order_payments
 * @param charge  the Stripe charge, balance_transaction expanded
 * @param dispute the charge's dispute (Stripe object) when charge.disputed, else null
 * @returns {{ date?: string|null, disputed?: boolean, refund?: "full"|"partial" }}
 *   date      the clearing date to record (ISO), or null when Stripe has none yet;
 *             absent when one is already recorded
 *   disputed  the dispute flag to record, only when it differs from the row's
 *   refund    "full": refunded in full in Stripe while still held here (record it);
 *             "partial": partly refunded (report only, staff decide)
 */
export function decideBackfill({ row, charge, dispute = null }) {
  const decision = {};
  if (!row.funds_available_at) {
    const seconds = Number(charge?.balance_transaction?.available_on);
    decision.date = seconds ? new Date(seconds * 1000).toISOString() : null;
  }
  // Stripe keeps `disputed` true after a win.
  const disputed = Boolean(charge?.disputed) && (!dispute || !["won", "warning_closed"].includes(dispute.status));
  if (disputed !== Boolean(row.disputed_at)) decision.disputed = disputed;
  if (Number(charge?.amount_refunded) > 0 && row.state === "confirmed") {
    decision.refund = charge.refunded ? "full" : "partial";
  }
  return decision;
}

/**
 * Record a decision, or only describe it (write false). Returns the lines to
 * print, each a sentence about this payment. Throws on a failed write.
 */
export async function applyBackfill({ stripe, db, row, charge, decision, write }) {
  const lines = [];
  const note = write ? "" : " (not written)";
  if ("date" in decision) {
    if (!decision.date) {
      lines.push("Stripe has no date yet");
    } else {
      lines.push(`clears ${decision.date}${note}`);
      if (write) {
        const { error } = await db.rpc("record_payment_funds_available", { target_payment: row.id, available_at: decision.date });
        if (error) throw new Error(error.message);
      }
    }
  }
  if ("disputed" in decision) {
    lines.push(`${decision.disputed ? "disputed in Stripe, not recorded: on hold" : "recorded as disputed, settled in Stripe: hold lifted"}${note}`);
    if (write) {
      const { error } = await db.rpc("record_payment_disputed", { target_payment: row.id, disputed: decision.disputed });
      if (error) throw new Error(error.message);
    }
  }
  if (decision.refund === "full") {
    lines.push(`refunded in full in Stripe, still held here: recorded as refunded${note}`);
    // The server's own recording: the charge is refunded already, so it
    // makes no new refund.
    if (write) {
      const { applyChargeRefund } = await import("./_stripe.js");
      await applyChargeRefund({ stripe, db, charge });
    }
  } else if (decision.refund === "partial") {
    lines.push(`partly refunded in Stripe (${charge.amount_refunded} of ${charge.amount}): for staff, not changed`);
  }
  return lines;
}
