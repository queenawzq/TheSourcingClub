/**
 * Payment reviews (20261124100000): a refund or dispute pauses the factory's
 * withdrawals (and, on a dispute, the brand) until staff decide. The database
 * decides everything; these carry the person's own token.
 */
import { kickNotificationEmails, supabase, unwrap } from "../supabase.js";

/** A company's own status: { brand_paused, factory: { paused, step_title, ... } | null }. Members only. */
export async function myPaymentPause(orgId) {
  return unwrap(await supabase.rpc("my_payment_pause", { target_org: orgId }), "read your account status");
}

/** Staff: every review waiting on a decision, then the last 30 days' decided ones. */
export async function paymentReviewBoard() {
  return unwrap(await supabase.rpc("payment_review_board"), "load payment reviews") ?? [];
}

const REFUSALS = {
  review_decided: "This review was already decided. Reload the board.",
  review_amount: "Enter an amount to take from the factory's balance.",
  review_dispute_open: "The bank hasn't decided this dispute yet. Refund brand is available once the brand has its money back.",
  review_not_approved: "This step isn't approved, so its money isn't in the factory's balance. Choose Pay factory.",
  review_brand_only: "This step isn't approved, so the factory isn't paused. Use Unpause brand.",
  payment_under_review: "This factory's withdrawals are paused while a payment is reviewed (Payment reviews, in Needs checking).",
  review_note: "Add a note for the factory.",
  review_brand_not_paused: "This brand isn't paused by this review. Reload the board.",
  review_own_company: "You belong to this brand, so someone else on the staff must decide.",
  payout_own_company: "You belong to this factory, so someone else on the staff must decide.",
  reveal_brand_side: "Your company has an order with this factory, so someone else on the staff must decide.",
};
const said = (error) => {
  if (error?.hint === "review_over_balance" && (error.details ?? error.detail)) return `You can take up to ${error.details ?? error.detail}, the factory's balance now.`;
  if (error?.hint === "review_over_part" && (error.details ?? error.detail)) return `You can take up to ${error.details ?? error.detail}, the factory's part of what the brand got back.`;
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

/** Pay factory: unpause it, nothing taken. */
export const payFactory = (reviewId, note = null) => staffCall("decide_payment_review", {
  target_review: reviewId, decision: "pay_factory", amount_cents: null, note,
});
/** Refund brand: return `cents` to the brand from the factory's balance (capped by the database). */
export const refundBrand = (reviewId, cents, note) => staffCall("decide_payment_review", {
  target_review: reviewId, decision: "refund_brand", amount_cents: cents, note,
});
/** Unpause brand: it can fund steps and accept quotes again. */
export const unpauseBrand = (reviewId) => staffCall("unpause_brand", { target_review: reviewId });
