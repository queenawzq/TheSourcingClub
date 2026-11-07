/**
 * Staff's Pay with Wise and Pay with PayPal, through api/wise-payout and
 * api/paypal-payout. Every step carries the staff member's own token; the keys
 * stay on the server.
 */
import { kickNotificationEmails, supabase } from "../supabase.js";

async function call(provider, body) {
  const { data: { session } } = await supabase.auth.getSession();
  let response;
  try {
    response = await fetch(`/api/${provider}-payout`, {
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
  try {
    result = await response.json();
  } catch {
    // An empty or HTML answer (the route is missing, a timeout) reads as its status.
  }
  if (!response.ok) {
    const failure = new Error(result.error || `This didn't get an answer (${response.status}), so we don't know yet if it went. Press Refresh.`);
    failure.kind = result.kind ?? null;
    failure.unsure = result.unsure ?? false;
    throw failure;
  }
  kickNotificationEmails();
  return result;
}

export const previewWise = (paymentId, cnyConfirmed) => call("wise", { action: "preview", paymentId, cnyConfirmed });

export const payByProvider = (provider, row, cnyConfirmed = false) => call(provider, {
  action: "pay", paymentId: row.payment_id, paidToChangedAt: row.payout_changed_at, cnyConfirmed,
});

export const cancelProviderPayout = (provider, paymentId) => call(provider, { action: "cancel", paymentId });

export const tellFactoryToFixDetails = (provider, row, sentence, cnyConfirmed = false) => call(provider, {
  action: "tell", paymentId: row.payment_id, paidToChangedAt: row.payout_changed_at, sentence, cnyConfirmed,
});

/** Read back what can still change. Previews can't receive a webhook, so the board asks. */
export const syncProvider = (provider) => call(provider, { action: "sync" });

export async function providerAttempts() {
  const { data, error } = await supabase.rpc("admin_provider_attempts");
  if (error) throw new Error("The board couldn't read its Wise and PayPal payments. Reload the page.");
  return data ?? [];
}
