/**
 * Payments — held by TSC through Stripe until the brand approves the step.
 *
 * The brand pays by card (src/lib/domain/stripe.js and
 * api/stripe-*); only the server records what Stripe says. The functions
 * here read payments and carry the staff actions that stay by hand: legacy
 * wire claims (confirm / not received) and paying a factory by bank where
 * Stripe cannot pay out.
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
  released_at, released_note, created_at,
  charged_cents, payment_method_type, payment_method_label, failure_reason,
  processing_at, failed_at, release_requested_at, stripe_payment_intent_id
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

/**
 * Every payment on these orders, with its step's title, order and due date:
 * the brand's Payments page. RLS gives a brand only its own orders' rows.
 */
export async function listPaymentsForOrders(orderIds) {
  if (!orderIds.length) return [];
  return unwrap(
    await supabase
      .from("order_payments")
      .select(`${PAYMENT_COLUMNS}, order_milestones (title, sort, due_on)`)
      .in("order_id", orderIds)
      .order("created_at"),
    "load your payments",
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

/** The factory's own payout accounts, primary first, for its Settings page. */
export async function listPayoutAccounts(factoryOrgId) {
  return unwrap(
    await supabase
      .from("factory_payout_accounts")
      .select("id, label, bank_name, account_name, account_number_last4, swift, iban, bank_country, instructions, is_primary, verified_at, created_at")
      .eq("org_id", factoryOrgId)
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: true }),
    "load your payout accounts",
  );
}

/** Add a payout destination. The first one is automatically the primary. */
export async function addPayoutAccount(factoryOrgId, values, { primary = false } = {}) {
  return unwrap(
    await supabase
      .from("factory_payout_accounts")
      .insert({
        org_id: factoryOrgId,
        is_primary: primary,
        label: values.label?.trim() || null,
        bank_name: values.bank_name?.trim() || null,
        account_name: values.account_name?.trim() || null,
        account_number_last4: values.account_number_last4?.trim() || null,
        swift: values.swift?.trim() || null,
        iban: values.iban?.trim() || null,
        bank_country: values.bank_country?.trim().toUpperCase() || null,
        instructions: values.instructions?.trim() || null,
      })
      .select()
      .single(),
    "add your payout account",
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

/**
 * Staff's payments board: every payment that needs a person or is worth
 * watching (wire claims, bank payments clearing, failed, held, payouts owed).
 * The old admin_payment_queue() stays for the old site only.
 */
export async function paymentBoard() {
  return unwrap(await supabase.rpc("admin_payment_board"), "load the payments board");
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
