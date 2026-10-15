/**
 * The brand's card or bank payment, and the factory's payouts, through the
 * api/stripe-* routes. Every route decides who may do what in the database
 * as the caller, so each call carries the signed-in user's token.
 *
 * Only the publishable key reaches the browser (VITE_STRIPE_PUBLISHABLE_KEY);
 * the secret key and the webhook secrets stay on the server.
 */
import { kickNotificationEmails, supabase } from "../supabase.js";

export const STRIPE_PUBLISHABLE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY ?? "";

/** Test-mode objects live under /test/ in Stripe's dashboard. */
export function stripeDashboardUrl(kind, id) {
  const mode = STRIPE_PUBLISHABLE_KEY.startsWith("pk_live_") ? "" : "test/";
  return `https://dashboard.stripe.com/${mode}${kind}/${id}`;
}

async function call(route, body) {
  const { data: { session } } = await supabase.auth.getSession();
  const response = await fetch(`/api/${route}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session?.access_token ?? ""}`,
    },
    body: JSON.stringify(body),
  });
  // A payment recorded on the server notifies the other side.
  if (response.ok) kickNotificationEmails();
  let result = {};
  try {
    result = await response.json();
  } catch {
    // An empty or HTML answer (the route is missing) reads as its status.
  }
  if (!response.ok) {
    const failure = new Error(result.error || result.reason || `Payments are not available right now (${response.status}).`);
    failure.status = response.status;
    failure.details = result;
    throw failure;
  }
  return result;
}

/** The client secret for the Payment Element, plus the step, fee and total. */
export const startCheckout = (paymentId) => call("stripe-checkout", { paymentId });

/** Read the payment back from Stripe now (after confirming, or while clearing). */
export const syncPayment = (paymentId) => call("stripe-sync", { paymentId });

/** Pay a held, approved payment out to the factory. */
export const requestRelease = (paymentId) => call("stripe-release", { paymentId });

/** A SetupIntent for a company owner to save a future billing method. */
export const startBillingSetup = (orgId) => call("stripe-billing-setup", { orgId });

/** onboard | refresh | dashboard, for a factory owner's own company. */
export const connectAction = (orgId, action, extra = {}) => call("stripe-connect", { orgId, action, ...extra });

/** The company's Stripe payout account, if it has started one. */
export async function connectAccountFor(orgId) {
  const { data, error } = await supabase
    .from("stripe_connect_accounts")
    .select("org_id, country, details_submitted, payouts_enabled, transfers_active, requirements_due, updated_at")
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw new Error(`Could not load your Stripe payout account: ${error.message}`);
  return data;
}
