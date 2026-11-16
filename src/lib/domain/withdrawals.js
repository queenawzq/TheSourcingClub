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
};
const said = (error) => new Error(REFUSALS[error?.hint] ?? "That couldn't be done. Reload the page and try again.");

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

export async function adminWithdrawals() {
  const { data, error } = await supabase.rpc("admin_withdrawals");
  if (error) throw new Error("The board couldn't read the withdrawals. Reload the page.");
  return { withdrawals: data?.withdrawals ?? [], poolPaymentIds: new Set(data?.pool_payment_ids ?? []) };
}

export const previewWithdrawal = (id, cnyConfirmed = false) => call({ action: "preview", withdrawalId: id, cnyConfirmed });
export const approveWithdrawal = (id, cnyConfirmed = false) => call({ action: "approve", withdrawalId: id, cnyConfirmed });
export const syncWithdrawals = (provider) => call({ action: "sync", provider });

export async function declineWithdrawal(id, reason) {
  const { error } = await supabase.rpc("decline_withdrawal", { target_withdrawal: id, why: reason });
  if (error) throw said(error);
  kickNotificationEmails();
}

export async function markWithdrawalPaidByBank(id, reference) {
  const { error } = await supabase.rpc("mark_withdrawal_paid_by_bank", { target_withdrawal: id, reference });
  if (error) throw said(error);
  kickNotificationEmails();
}
