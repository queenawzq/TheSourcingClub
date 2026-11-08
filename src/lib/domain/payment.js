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
  processing_at, failed_at, release_requested_at, stripe_payment_intent_id, refunded_at
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
      .select(`${PAYMENT_COLUMNS}, order_milestones (title, sort, due_on, kind)`)
      .in("order_id", orderIds)
      .order("created_at"),
    "load your payments",
  );
}

export async function getPayment(orderId, paymentId) {
  return unwrap(
    await supabase
      .from("order_payments")
      .select(`${PAYMENT_COLUMNS}, order_milestones (title, kind, state, due_on)`)
      // Scoped to the order for the same reason getMilestone is.
      .eq("order_id", orderId)
      .eq("id", paymentId)
      .maybeSingle(),
    "load that payment",
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

/** The database's refusals of a manual payout, in staff's words (20261104300100). */
const RELEASE_REFUSALS = {
  payoneer_default: "This factory is paid by Payoneer. Enter the payment ID, or add a note saying why it was paid by bank.",
  payoneer_id_format: "Enter the payment ID from Payoneer: 3 to 64 letters, numbers or - _ . /",
  payoneer_id_used: "This Payoneer payment ID is already recorded for another factory. Check it and try again.",
  payout_changed: "This factory changed where it is paid after this page loaded. Reload and check before marking it. If you already paid, add a note saying where.",
  payout_already_released: "This payout was already marked as paid. Reload the board.",
  payout_own_company: "You belong to this company, so someone else on the staff must record its payout.",
  payout_stripe: "Stripe pays this factory now. Reload the board and retry the payout.",
  reference_required: "Enter the bank's reference for this transfer.",
  reference_holds_number: "The factory and the brand can read this. Use the bank's reference, not the account number.",
  reveal_brand_side: "Your company has an order with this factory, so someone else on the staff must pay it.",
  reveal_not_owed: "TSC doesn't owe this company a payout by hand, so its number stays hidden.",
  no_number: "No full account number is on file. Ask the factory to add it on its Payments page.",
};

function saidToStaff(failure) {
  const sentence = RELEASE_REFUSALS[failure?.cause?.hint];
  return sentence ? new Error(sentence) : failure;
}

export async function releasePayment(paymentId, note, paidToChangedAt = null) {
  try {
    return unwrap(
      await supabase.rpc("release_payment_to_factory", {
        target_payment: paymentId,
        note: note || null,
        paid_to_changed_at: paidToChangedAt,
      }),
      "release these funds",
    );
  } catch (failure) {
    throw saidToStaff(failure);
  }
}

/**
 * One account's full number, for a person about to pay it. The database records
 * who asked before answering. The caller shows it and forgets it.
 */
export async function revealPayoutNumber(accountId) {
  try {
    const rows = unwrap(
      await supabase.rpc("reveal_payout_account_number", { target_account: accountId }),
      "show this account number",
    );
    return rows[0];
  } catch (failure) {
    const said = saidToStaff(failure);
    throw said === failure ? new Error("Couldn't show the number right now. Try again.") : said;
  }
}

/** Who looked at which account's number, newest first. */
export async function payoutNumberRevealLog() {
  return unwrap(await supabase.rpc("payout_number_reveal_log"), "load who viewed account numbers");
}

/** Staff sent this payout from TSC's Payoneer account by hand: record it. */
export async function releasePaymentByPayoneer(paymentId, { paidTo, payoneerPaymentId, note }) {
  try {
    return unwrap(
      await supabase.rpc("release_payment_by_payoneer", {
        target_payment: paymentId,
        paid_to: paidTo,
        payoneer_payment_id: payoneerPaymentId,
        note: note || null,
      }),
      "record this payout",
    );
  } catch (failure) {
    throw saidToStaff(failure);
  }
}

/** Computed the same way the database computes it: floor, in minor units. */
export function feeCents(payment) {
  if (!payment) return 0;
  return Math.floor((payment.amount_cents * (payment.fee_bps ?? 0)) / 10000);
}

/** States in which nothing has been charged yet: checkout works the price out afresh. */
const NOT_CHARGED = new Set(["not_due", "due", "failed"]);

/**
 * What the brand pays for a payment: the step plus the service fee. Once
 * Stripe has taken the money it is what checkout recorded (charged_cents);
 * before that it is what begin_payment_checkout would charge now,
 * amount_cents + payment_fee_cents (an amount changed since an earlier
 * attempt is charged at the new figure). The factory gets amount_cents.
 */
export function chargedCents(payment) {
  if (!payment) return 0;
  if (payment.charged_cents != null && !NOT_CHARGED.has(payment.state)) return Number(payment.charged_cents);
  return Number(payment.amount_cents) + feeCents(payment);
}

/**
 * The service fee on an order with no payment rows yet (its steps are not
 * agreed): order_payment_fee_bps() gives a new order's first payment 500 bps
 * at $5,000 and over, 700 under, from the order's total. Once payments exist,
 * their own fee_bps is the answer, never this.
 */
export function orderFeeBps(order) {
  return Number(order?.order_total_cents ?? 0) >= 500000 ? 500 : 700;
}

/**
 * Staff: the Stripe payout account of each order's factory, for owed rows that
 * have no withdrawal method on file. Keyed by order id; orders whose factory
 * never started Stripe are left out.
 */
export async function factoryStripeSetup(orderIds) {
  if (!orderIds.length) return new Map();
  const orders = unwrap(
    await supabase.from("production_orders").select("id, factory_org_id").in("id", orderIds),
    "load the orders' factories",
  );
  const orgIds = [...new Set(orders.map((order) => order.factory_org_id))];
  const accounts = unwrap(
    await supabase.from("stripe_connect_accounts").select("org_id, details_submitted, transfers_active").in("org_id", orgIds),
    "load the factories' Stripe accounts",
  );
  const byOrg = new Map(accounts.map((account) => [account.org_id, account]));
  return new Map(orders.filter((order) => byOrg.has(order.factory_org_id)).map((order) => [order.id, byOrg.get(order.factory_org_id)]));
}
