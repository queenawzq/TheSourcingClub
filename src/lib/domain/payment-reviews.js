/**
 * Payment reviews (20261124100000, v2 20261125100000): a dispute or a refund
 * made in Stripe after approval pauses the factory's withdrawals (and, on a
 * chargeback, the brand); the bank's verdict drives a dispute, and staff
 * Approve or Decline once the money is back with the brand. Staff also refund
 * a brand from the admin board, choosing who pays. The database decides
 * everything; these carry the person's own token.
 *
 * The shapes are in notes/cards/2026-11-25-pp-interface.md.
 */
import { kickNotificationEmails, supabase, unwrap } from "../supabase.js";

/** A company's own status: { brand_paused, factory: { paused, step_title, order_number, since, count } | null }. Members only. */
export async function myPaymentPause(orgId) {
  return unwrap(await supabase.rpc("my_payment_pause", { target_org: orgId }), "read your account status");
}

/** Whether an order is on hold (its brand paused): { on_hold, brand_paused }. Either party, or staff. */
export async function orderPause(orderId) {
  return unwrap(await supabase.rpc("order_pause", { target_order: orderId }), "read this order's status");
}

/**
 * The brand's refunds that went through, one row each (§13): payment_id,
 * order_id, step title, amount_cents, currency, refunded_at, kind
 * (staff | stripe_dashboard | cancellation | automatic), note. Brand members only.
 * Includes refunds on a payment that was later set back to due.
 */
export async function brandPaymentRefunds(orgId) {
  return unwrap(await supabase.rpc("brand_payment_refunds", { target_org: orgId }), "load your refunds") ?? [];
}

/** Staff: every review, with its three-step bar (`step`, `step_line`, `step_date`, `reason`, `flag`); `open` = counted. */
export async function paymentReviewBoard() {
  return unwrap(await supabase.rpc("payment_review_board"), "load payment reviews") ?? [];
}

const REFUSALS = {
  review_decision: "Choose who was at fault.",
  staff_refund_not_open: "This refund isn't waiting on staff any more. Reload the page.",
  staff_refund_close_note: "Add a note.",
  review_no_brand: "A refund made in Stripe has no brand at fault. Choose Factory or Not the factory.",
  review_not_ready: "The bank hasn't decided yet. You can decide once it has.",
  brand_not_paused: "This brand isn't paused. Reload the page.",
  unpause_factory_side: "Your company has orders with this brand, so someone else on the staff must decide.",
  review_decided: "This review was already decided. Reload the board.",
  review_note: "Add a note.",
  review_amount: "Enter an amount of $0.00 or more.",
  review_balance_changed: "The factory's balance changed. Reload and try again.",
  review_own_company: "You belong to this brand, so someone else on the staff must decide.",
  payout_own_company: "You belong to this factory, so someone else on the staff must decide.",
  reveal_brand_side: "Your company has an order with this factory, so someone else on the staff must decide.",
  payment_under_review: "This factory's withdrawals are paused while a payment is reviewed (Payment reviews, in Review needed).",
};
const said = (error) => {
  const detail = error?.details ?? error?.detail;
  if (error?.hint === "review_over_cap" && detail) return `You can take up to ${detail} from the factory's balance.`;
  return REFUSALS[error?.hint] ?? "That couldn't be done. Reload the page and try again.";
};

async function staffCall(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) {
    const failure = new Error(said(error));
    failure.hint = error.hint;
    throw failure;
  }
  kickNotificationEmails();
  return data;
}

/**
 * Resolve a review: who was at fault.
 * - "factory_at_fault": `cents` (0 up to the row's factory_max_cents) from its balance, TSC absorbs the rest; the brand is unpaused. The note goes to the factory.
 * - "brand_at_fault": TSC absorbs it; the brand stays paused (disputes only).
 * - "no_fault": TSC absorbs it; the brand is unpaused (a refund row's "Not the factory").
 */
export const resolveReview = (reviewId, fault, cents, note) => staffCall("decide_payment_review", {
  target_review: reviewId, decision: fault, amount_cents: fault === "factory_at_fault" ? cents ?? null : null, note,
});
/** @deprecated use resolveReview(id, "factory_at_fault", cents, note) */
export const factoryPays = (reviewId, cents, note) => resolveReview(reviewId, "factory_at_fault", cents, note);
/** @deprecated use resolveReview(id, "brand_at_fault", null, note) */
export const tscPays = (reviewId, note) => resolveReview(reviewId, "brand_at_fault", null, note);
/** Staff, on the brand's account: lift every pause of this brand. Resolves to { org_id, lifted }. */
export const unpauseBrandOrg = (orgId) => staffCall("unpause_brand_org", { target_org: orgId });
/** Staff: the brands paused now, [{ org_id, name, since, reviews }], for Users' "Paused" filter and count. */
export async function pausedBrands() {
  return unwrap(await supabase.rpc("admin_paused_brands"), "load paused brands") ?? [];
}

/** Staff: the Refund… dialog's figures, read when it opens. */
export async function staffRefundPreview(paymentId) {
  return unwrap(await supabase.rpc("staff_refund_preview", { target_payment: paymentId }), "load this payment");
}
/** Staff: an order by its number (with or without TSC-), with its payments; null when none. */
export async function adminOrderPayments(search) {
  return unwrap(await supabase.rpc("admin_order_payments", { search }), "find this order");
}
/** Staff: refund facts for the Held tab's rows, { [paymentId]: { refundable_cents, refund_refusal, approved_step, staff_refunds } }. */
export async function adminRefundInfo(paymentIds) {
  if (!paymentIds?.length) return {};
  return unwrap(await supabase.rpc("admin_refund_info", { payment_ids: paymentIds }), "load refunds") ?? {};
}

/** Why Refund… is refused on a payment (refund_refusal), in the words staff read. */
export const REFUND_REFUSALS = {
  staff_refund_over: "Nothing left to refund.",
  staff_refund_not_charged: "This payment hasn't been charged.",
  staff_refund_processing: "This payment is still processing. Try again once it's funded.",
  staff_refund_disputed: "The bank is deciding this payment.",
  staff_refund_cancelled_order: "This order was cancelled. Its payments are refunded automatically.",
  staff_refund_claimed: "This payment is being refunded. Reload in a minute.",
};

async function refundCall(body) {
  const { data: { session } } = await supabase.auth.getSession();
  let response;
  try {
    response = await fetch("/api/stripe-refund", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
      body: JSON.stringify(body),
    });
  } catch {
    const failure = new Error("We couldn't reach the server. Press Check again in a minute; nothing will be refunded twice.");
    failure.hint = "stripe_unreachable";
    throw failure;
  }
  let result = {};
  try { result = await response.json(); } catch { /* read as its status below */ }
  if (!response.ok) {
    const failure = new Error(result.error || "That couldn't be done. Reload the page and try again.");
    failure.hint = result.hint ?? null;
    failure.staffRefundId = result.staffRefundId ?? null;
    throw failure;
  }
  kickNotificationEmails();
  return result;
}

/**
 * Staff refund a brand: { paymentId, amountCents, payer: "factory" | "tsc" | null, note, factoryCents }.
 * factoryCents (optional, payer "factory"): less than the factory's share; TSC pays the rest.
 * Resolves to { status: "refunded" | "pending", amountCents, factoryCents, tscCents };
 * throws Error(sentence) with .hint (and .staffRefundId when Stripe couldn't be reached).
 */
export const staffRefund = ({ paymentId, amountCents, payer = null, note, factoryCents = null }) =>
  refundCall({ paymentId, amountCents, payer, note, factoryCents });
/** Check again on a refund Stripe couldn't be asked about: the same claim, never refunded twice. */
export const checkStaffRefund = (staffRefundId) => refundCall({ staffRefundId });

// #150's board still imports these until the staff screens move to "who
// pays" (S's change).
/** @deprecated use tscPays */
export const payFactory = (reviewId, note) => tscPays(reviewId, note);
/** @deprecated use factoryPays */
export const refundBrand = (reviewId, cents, note) => factoryPays(reviewId, cents, note);
/** @deprecated unpause from the brand's account: unpauseBrandOrg */
export const unpauseBrand = () => Promise.reject(new Error("Unpause the brand from its account in Users."));

/** Staff: close a staff refund that failed after it was made (refunded the brand another way). The note is required. */
export const closeStaffRefundFailure = (staffRefundId, note) => staffCall("close_staff_refund_failure", { target_refund: staffRefundId, note });
