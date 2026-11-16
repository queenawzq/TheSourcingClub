import { PayoutFailure, withoutSecrets } from "./_payout-provider.js";
import { adapterFor, approveWithdrawal, previewWithdrawal, syncWithdrawals } from "./_withdrawals.js";
import { callerClient, jsonBody, reply, serviceClient, tokenRefused } from "./_stripe.js";

/**
 * Staff's side of a factory's withdrawal: preview, approve (pays through the
 * withdrawal's adapter), sync. See api/_withdrawals.js. Staff only, checked
 * with the caller's own token; the database checks again in claim_withdrawal.
 */
export default async function handler(request, response) {
  if (request.method !== "POST") return reply(response, 405, { error: "method not allowed" });
  const db = serviceClient();
  const caller = callerClient(request);
  if (!db) return reply(response, 503, { error: "This site isn't connected to its database.", kind: "not_set_up" });
  if (!caller) return reply(response, 401, { error: "Your sign-in expired. Sign in again." });
  const staff = await caller.rpc("is_platform_admin");
  if (tokenRefused(staff)) return reply(response, 401, { error: "Your sign-in expired. Sign in again." });
  if (staff.error || staff.data !== true) return reply(response, 403, { error: "This is limited to platform staff." });

  const { action, withdrawalId, provider: asked, cnyConfirmed } = jsonBody(request);
  let adapter = null;
  try {
    let row = null;
    if (action === "sync") {
      adapter = adapterFor(asked);
    } else {
      const found = await db.from("factory_withdrawals")
        .select("id, provider, status, amount_cents, currency, account_id, factory_payout_accounts (paypal_email, wise_recipient_id, wise_currency)")
        .eq("id", withdrawalId).maybeSingle();
      if (found.error || !found.data) return reply(response, 404, { error: "That withdrawal isn't on the board any more. Reload the page." });
      const account = found.data.factory_payout_accounts ?? {};
      row = { ...found.data, paypal_email: account.paypal_email, wise_recipient_id: account.wise_recipient_id, wise_currency: account.wise_currency };
      adapter = adapterFor(row.provider);
    }
    if (!adapter) return reply(response, 400, { error: "This withdrawal has no way to be paid yet. Decline it with a reason." });
    if (adapter.manual) return reply(response, 400, { error: "Send this by bank yourself, then mark it paid with the bank's reference." });
    let client;
    try {
      client = adapter.build();
    } catch (failure) {
      return reply(response, 503, { error: failure.message, kind: failure.kind ?? null });
    }
    if (!client) return reply(response, 503, { error: `${adapter.label} isn't set up on this site. Set ${adapter.settings}.`, kind: "not_set_up" });

    if (action === "sync") return reply(response, 200, await syncWithdrawals({ adapter, client, db }));
    if (action === "preview") return reply(response, 200, await previewWithdrawal({ adapter, client, caller, db, row, cnyConfirmed }));
    if (action === "approve") return reply(response, 200, await approveWithdrawal({ adapter, client, caller, db, id: row.id, cnyConfirmed }));
    return reply(response, 400, { error: "unknown action" });
  } catch (failure) {
    console.error("withdrawal:", withoutSecrets(failure?.message), { action, withdrawalId, kind: failure?.kind ?? null, detail: withoutSecrets(failure?.detail ?? "") });
    const known = failure instanceof PayoutFailure;
    return reply(response, known && failure.unsure ? 504 : 502, {
      error: known ? failure.message : `${adapter?.label ?? "The provider"} didn't answer as expected. Press Refresh to see where this is.`,
      kind: known ? failure.kind : "unknown",
      unsure: known ? failure.unsure : true,
    });
  }
}
