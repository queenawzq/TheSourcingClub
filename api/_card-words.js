/**
 * What a brand or a factory reads when a card is refused. Our sentences, by
 * Stripe's code, never Stripe's message: its words are written for developers
 * as often as for cardholders, and a test-mode refusal carries a stripe.com
 * link. Copied in src/shared/card-words.mjs for the browser, since the dev
 * server keeps /api for routes; `check:stripe-errors` fails if they differ.
 *
 * The leading underscore keeps Vercel from serving this file.
 */
export const CARD_DECLINED = "Your card was declined.";
export const NOT_COMPLETED = "The payment did not go through, so nothing was charged.";

const BY_CODE = {
  payment_intent_authentication_failure: "Your bank did not confirm this payment, so nothing was charged.",
  authentication_required: "Your bank did not confirm this payment, so nothing was charged.",
  payment_method_unexpected_state: "This card could not be used, so nothing was charged.",
  insufficient_funds: "Your card has insufficient funds.",
  expired_card: "Your card has expired.",
  incorrect_cvc: "The security code is wrong.",
  invalid_cvc: "The security code is wrong.",
  incorrect_number: "The card number is wrong.",
  invalid_number: "The card number is wrong.",
  incorrect_zip: "The postal code doesn't match this card.",
  processing_error: "The card could not be processed, so nothing was charged.",
};

const isCardRefusal = (error) => error?.type === "card_error" || error?.type === "StripeCardError";

/** From a Stripe error (Stripe.js's, the server SDK's, or a PaymentIntent's last_payment_error). */
export function cardReason(error) {
  const known = BY_CODE[error?.decline_code] ?? BY_CODE[error?.code];
  if (known) return known;
  return isCardRefusal(error) ? CARD_DECLINED : NOT_COMPLETED;
}

/**
 * A reason already stored. Rows recorded before this file hold Stripe's words,
 * and a developer's sentence among them says nothing the person can use.
 */
export function plainCardReason(text) {
  const reason = String(text ?? "").trim();
  if (!reason) return NOT_COMPLETED;
  return /https?:|stripe|test mode|test card|real card/i.test(reason) ? CARD_DECLINED : reason;
}
