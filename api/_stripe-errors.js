/**
 * What a person is told when Stripe (or the database behind a Stripe route)
 * fails, and what goes to the server log instead.
 *
 * Stripe's own messages are written for developers, and an authentication
 * failure quotes the end of the secret key. So nothing from a failure reaches
 * a response unless it is written here. The one exception is a card or bank
 * refusal, whose words are written for the person holding that card.
 *
 * The leading underscore keeps Vercel from serving this file.
 */

const OPERATIONS = "operations@contact.sourcing-club.com";

/** No key, whole or in part, even in a log. Anything else is kept to diagnose by. */
export function withoutKeys(text) {
  return String(text ?? "").replace(/\b(?:sk|rk|pk|whsec|ek)_[A-Za-z0-9_*]+/g, "[key]");
}

/** The raw failure, for the server log and nowhere else. */
export function logStripeFailure(where, failure, context = {}) {
  console.error(`${where}:`, withoutKeys(failure?.message), {
    type: failure?.type ?? failure?.name ?? null,
    code: failure?.code ?? null,
    requestId: failure?.requestId ?? null,
    ...context,
  });
}

const OUR_SETUP = new Set(["StripeAuthenticationError", "StripePermissionError"]);
const OUTAGE = new Set(["StripeConnectionError", "StripeAPIError", "StripeRateLimitError"]);

/**
 * For a brand or a factory. `fallback` says what could not be done, in the
 * words of that route; it is used for anything without a sentence of its own.
 */
export function sentenceFor(failure, fallback) {
  if (failure?.type === "StripeCardError" && failure.message) return withoutKeys(failure.message);
  if (OUR_SETUP.has(failure?.type)) {
    return `Payments have a problem on TSC's side, so nothing changed. Email ${OPERATIONS} and we'll sort it out.`;
  }
  if (OUTAGE.has(failure?.type)) return "Stripe can't be reached right now, so nothing changed. Try again in a few minutes.";
  return fallback;
}

/** For staff pressing "Retry payout": what happened and what to do next. */
export function payoutSentenceForStaff(failure) {
  const code = failure?.code;
  const type = failure?.type;
  if (failure?.payoutNotReady) {
    return "The factory's Stripe account can't take transfers yet, so nothing was sent. It pays out on its own once Stripe enables them.";
  }
  if (type === "StripeAuthenticationError") {
    return "Stripe refused TSC's secret key, so nothing was sent. Replace STRIPE_SECRET_KEY in Vercel, redeploy, then retry.";
  }
  if (type === "StripePermissionError") {
    return "TSC's Stripe key isn't allowed to make transfers, so nothing was sent. Check the key's permissions in Stripe, then retry.";
  }
  if (type === "StripeConnectionError" || type === "StripeAPIError") {
    return "Stripe couldn't be reached. Retry in a few minutes: a payout that did go through is found first, never sent twice.";
  }
  if (type === "StripeRateLimitError") return "Stripe is busy, so nothing was sent. Retry in a minute.";
  if (code === "balance_insufficient") {
    return "TSC's Stripe balance can't cover this yet, so nothing was sent. Check the balance in Stripe, then retry.";
  }
  if (code === "transfers_not_allowed" || code === "account_invalid" || code === "insufficient_capabilities_for_transfer") {
    return "The factory's Stripe account can't take this transfer, so nothing was sent. Open the account in Stripe and check what it still needs.";
  }
  if (failure?.requestId) {
    return `Stripe refused this payout, so nothing was sent. Look up request ${failure.requestId} in Stripe's logs for the reason.`;
  }
  return "This payout could not be sent, and it was not marked as paid. The reason is in the server log. Retry, and if it fails again, ask a developer to check it.";
}
