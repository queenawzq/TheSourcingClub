/**
 * Payments — tracked, never held.
 *
 * The platform is not in the money path. What it provides is the record that
 * a transfer happened and the third party who confirms it, which is the only
 * reason a factory in Ningbo would extend credit to a brand it has never met.
 *
 * The fee is read from fee_bps on the row rather than a constant here, so the
 * screen and the database cannot disagree about what a brand was shown, and
 * turning the fee on later changes no JavaScript at all.
 */
import { supabase, unwrap } from "../supabase.js";

const PAYMENT_COLUMNS = `
  id, order_id, milestone_id, amount_cents, currency, fee_bps, state,
  due_at, brand_reference, sent_at, sent_note,
  confirmed_at, confirmed_note, amount_received_cents,
  released_at, released_note, created_at
`;

export async function listPayments(orderId) {
  return unwrap(
    await supabase
      .from("order_payments")
      .select(`${PAYMENT_COLUMNS}, order_milestones (title, sort)`)
      .eq("order_id", orderId)
      .order("created_at"),
    "load the payments on this order",
  );
}

export async function getPayment(orderId, paymentId) {
  return unwrap(
    await supabase
      .from("order_payments")
      .select(`${PAYMENT_COLUMNS}, order_milestones (title)`)
      // Scoped to the order for the same reason getMilestone is.
      .eq("order_id", orderId)
      .eq("id", paymentId)
      .maybeSingle(),
    "load that payment",
  );
}

/** Where the brand actually sends the money. */
export async function payoutAccountFor(factoryOrgId) {
  return unwrap(
    await supabase
      .from("factory_payout_accounts")
      .select("id, bank_name, account_name, account_number_last4, swift, iban, bank_country, instructions")
      .eq("org_id", factoryOrgId)
      .eq("is_primary", true)
      .maybeSingle(),
    "load the factory's payment details",
  );
}

export async function markPaymentSent(paymentId, { reference, note } = {}) {
  return unwrap(
    await supabase.rpc("mark_payment_sent", {
      target_payment: paymentId,
      reference: reference || null,
      note: note || null,
    }),
    "record this payment as sent",
  );
}

/* --------------------------------- admin -------------------------------- */

export async function paymentQueue() {
  return unwrap(await supabase.rpc("admin_payment_queue"), "load the payment queue");
}

export async function confirmPaymentReceived(paymentId, { amountReceived, note } = {}) {
  return unwrap(
    await supabase.rpc("confirm_payment_received", {
      target_payment: paymentId,
      amount_received: amountReceived ?? null,
      note: note || null,
    }),
    "confirm this payment",
  );
}

export async function rejectPaymentSent(paymentId, note) {
  return unwrap(
    await supabase.rpc("reject_payment_sent", { target_payment: paymentId, note }),
    "record this payment as not received",
  );
}

export async function releasePayment(paymentId, note) {
  return unwrap(
    await supabase.rpc("release_payment_to_factory", {
      target_payment: paymentId,
      note: note || null,
    }),
    "release these funds",
  );
}

/** Computed the same way the database computes it: floor, in minor units. */
export function feeCents(payment) {
  if (!payment) return 0;
  return Math.floor((payment.amount_cents * (payment.fee_bps ?? 0)) / 10000);
}
