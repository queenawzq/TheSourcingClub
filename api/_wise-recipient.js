import { PayoutFailure } from "./_payout-provider.js";

/**
 * The one place on our server the factory's full bank number passes through,
 * because Wise needs it (check:bank-number allows this file and no other). Read
 * with the staff member's own token, so the same refusals and the same record
 * of who apply; sent to Wise; kept nowhere. Nothing here logs or returns it.
 *
 * Skipped when the account already has a Wise recipient: the database clears
 * that the moment the details change, so a stale one can't be paid.
 */

/** Wise's flat keys back into the shape its API takes: "address.city" → { address: { city } }. */
export function recipientBody(row, { cnyConfirmed }) {
  const details = {};
  let holder = null;
  for (const [key, value] of Object.entries(row.details ?? {})) {
    if (key === "accountHolderName") { holder = value; continue; }
    const path = key.split(".");
    let at = details;
    for (const part of path.slice(0, -1)) at = at[part] ??= {};
    at[path.at(-1)] = value;
  }
  details[row.number_key] = row.account_number;
  if (row.currency === "CNY" && cnyConfirmed) details.isContractDenotedInCny = true;
  return { type: row.recipient_type, currency: row.currency, accountHolderName: holder, details };
}

export async function ensureWiseRecipient({ caller, db, wise, accountId, existingId, cnyConfirmed }) {
  if (existingId) return existingId;
  const { data, error } = await caller.rpc("payout_wise_recipient", { target_account: accountId });
  if (error) {
    throw new PayoutFailure(error.hint === "no_number" ? "details_rejected" : "refused", wordsFor(error), { detail: error.hint ?? null });
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new PayoutFailure("refused", "This factory's bank details could not be read. Reload the page.");
  const id = await wise.createRecipient(recipientBody(row, { cnyConfirmed }));
  // False means the factory changed its details while Wise was answering.
  const { data: kept, error: keptError } = await db.rpc("set_wise_recipient", {
    target_account: accountId, recipient_id: id, made_from: row.changed_at,
  });
  if (keptError || !kept) {
    throw new PayoutFailure("details_changed", "This factory changed where it is paid. Reload the page and check the details.");
  }
  return id;
}

function wordsFor(error) {
  switch (error.hint) {
    case "payout_own_company": return "You belong to this company, so someone else on the staff must pay it.";
    case "reveal_brand_side": return "Your company has an order with this factory, so someone else on the staff must pay it.";
    case "reveal_not_owed": return "TSC doesn't owe this factory a payout right now. Reload the page.";
    case "wise_not_set_up": return "This bank account wasn't set up for Wise. Mark it paid by bank instead.";
    case "no_number": return "No full account number is on file. Ask the factory to add it on its Payments page.";
    default: return "This factory's bank details could not be read. Reload the page.";
  }
}
