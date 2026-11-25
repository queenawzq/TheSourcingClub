/**
 * Staff's side of factory withdrawals: the board's list (admin_withdrawals),
 * preview and approve through api/withdrawal (the provider's keys stay on the
 * server), decline and "paid by bank" as RPCs. Each carries the staff member's
 * own token; the database checks again.
 */
import { kickNotificationEmails, supabase } from "../supabase.js";

const REFUSALS = {
  withdrawal_not_waiting: "This withdrawal isn't waiting any more. Reload the board.",
  withdrawal_reason: "Say why, in a sentence the factory will read.",
  withdrawal_over_balance: "The factory's balance no longer covers this. Decline it with a reason.",
  withdrawal_provider: "This one is paid through its provider: use Review and pay.",
  reference_required: "Enter the bank's reference for this transfer.",
  reference_holds_number: "The factory reads this, so it can't hold the account number.",
  fee_too_large: "This withdrawal is not more than the bank transfer fee, so nothing would arrive. Decline it with a reason.",
  payout_own_company: "You belong to this company, so someone else on the staff must decide this.",
  // The same sentence api/_withdrawals.js gives for claim_withdrawal's refusal.
  payout_changed: "This factory changed where it is paid since it asked. Decline it, so it can ask again.",
};
/** Staff's words when a withdrawal waits on money the factory owes TSC (api/_withdrawals.js says the same). */
export const owesTscSentence = (amount) => `The factory owes TSC ${amount || "money"} (To recover, in Review needed). This withdrawal waits until the factory's earnings cover it. You can still decline it.`;
const said = (error) => new Error(error?.hint === "withdrawal_owes_tsc" ? owesTscSentence(error.details)
  : REFUSALS[error?.hint] ?? "That couldn't be done. Reload the page and try again.");

async function call(body) {
  const { data: { session } } = await supabase.auth.getSession();
  let response;
  try {
    response = await fetch("/api/withdrawal", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
      body: JSON.stringify(body),
    });
  } catch {
    const failure = new Error("We couldn't reach the server, so we don't know yet if this went. Press Refresh.");
    failure.unsure = true;
    throw failure;
  }
  let result = {};
  try { result = await response.json(); } catch { /* read as its status below */ }
  if (!response.ok) {
    const failure = new Error(result.error || `This didn't get an answer (${response.status}), so we don't know yet if it went. Press Refresh.`);
    failure.kind = result.kind ?? null;
    failure.unsure = result.unsure ?? false;
    throw failure;
  }
  kickNotificationEmails();
  return result;
}

/**
 * What only staff can see and nobody is told of: owed steps whose brand
 * charge is disputed, and Stripe withdrawals from the balance that stopped
 * half-way or were refused because TSC's Stripe balance was short
 * (admin_balance_attention, counted in the overview's payments card).
 */
export async function adminBalanceAttention() {
  const { data, error } = await supabase.rpc("admin_balance_attention");
  if (error) throw new Error("The board couldn't read the payments that need checking. Reload the page.");
  return { disputed: data?.disputed ?? [], stuck: data?.stuck ?? [], recover: data?.recover ?? [], refund_failed: data?.refund_failed ?? [], returned: data?.returned ?? [] };
}

export async function adminWithdrawals() {
  const { data, error } = await supabase.rpc("admin_withdrawals");
  if (error) throw new Error("The board couldn't read the withdrawals. Reload the page.");
  return { withdrawals: data?.withdrawals ?? [], poolPaymentIds: new Set(data?.pool_payment_ids ?? []) };
}

export const previewWithdrawal =(id, cnyConfirmed = false) => call({ action: "preview", withdrawalId: id, cnyConfirmed });
export const approveWithdrawal = (id, cnyConfirmed = false) => call({ action: "approve", withdrawalId: id, cnyConfirmed });
export const syncWithdrawals = (provider) => call({ action: "sync", provider });
/** Staff's "Check again" on a Stripe withdrawal under "Review needed": { sentence, sent, returned, unsure }. */
export const checkStripeWithdrawal = (id) => call({ action: "check_stripe", withdrawalId: id });

export async function declineWithdrawal(id, reason) {
  const { error } = await supabase.rpc("decline_withdrawal", { target_withdrawal: id, why: reason });
  if (error) throw said(error);
  kickNotificationEmails();
}

