import { PayoutFailure, withoutSecrets } from "./_payout-provider.js";
import { adapterFor, approveWithdrawal, factoryQuote, previewWithdrawal, syncWithdrawals } from "./_withdrawals.js";
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
  const { action: asked0 } = jsonBody(request);
  if (asked0 === "quote") return quoteForFactory(request, response, { db, caller });
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
        .select("id, org_id, provider, status, amount_cents, currency, account_id, paid_to_changed_at, factory_payout_accounts (method, paypal_email, wise_recipient_id, wise_recipient_type, wise_currency, details_changed_at)")
        .eq("id", withdrawalId).maybeSingle();
      if (found.error || !found.data) return reply(response, 404, { error: "That withdrawal isn't on the board any more. Reload the page." });
      const account = found.data.factory_payout_accounts ?? {};
      row = { ...found.data, account: found.data.factory_payout_accounts ?? null, paypal_email: account.paypal_email, wise_recipient_id: account.wise_recipient_id, wise_currency: account.wise_currency };
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

/**
 * The factory owner's preview: the exact fee and what arrives, before it asks.
 * Owner of that company only, for its own account; nothing moves and nothing is
 * claimed. When the provider can't quote, the screen shows the fee line instead.
 */
async function quoteForFactory(request, response, { db, caller }) {
  const { orgId, accountId, amountCents } = jsonBody(request);
  const amount = Number(amountCents);
  if (!Number.isSafeInteger(amount) || amount <= 0) return reply(response, 400, { error: "Enter an amount to withdraw." });
  const owner = await caller.rpc("is_org_owner", { target_org: orgId });
  if (tokenRefused(owner)) return reply(response, 401, { error: "Your sign-in expired. Sign in again." });
  if (owner.error || owner.data !== true) return reply(response, 403, { error: "Only a company owner can withdraw." });
  const found = await db.from("factory_payout_accounts")
    .select("id, org_id, method, paypal_email, wise_recipient_type, wise_recipient_id, wise_currency").eq("id", accountId).eq("org_id", orgId).maybeSingle();
  if (found.error || !found.data) return reply(response, 404, { error: "Choose one of your saved withdrawal methods." });
  const account = found.data;
  const provider = account.method === "paypal" ? "paypal" : account.wise_recipient_type ? "wise" : "bank";
  const adapter = adapterFor(provider);
  if (!adapter || adapter.manual || typeof adapter.factoryQuote !== "function") return reply(response, 200, { exact: false });
  try {
    const client = adapter.build();
    if (!client) return reply(response, 200, { exact: false });
    return reply(response, 200, await factoryQuote({ adapter, client, db, orgId, account, amountCents: amount }));
  } catch (failure) {
    console.error("withdrawal quote:", withoutSecrets(failure?.message), { kind: failure?.kind ?? null });
    if (failure instanceof PayoutFailure && failure.kind === "too_small") return reply(response, 200, { exact: false, refused: failure.message });
    return reply(response, 200, { exact: false });
  }
}
