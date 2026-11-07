/**
 * Nothing a Stripe route answers may carry key material or Stripe's raw words.
 * Stripe quotes the end of the secret key when it refuses one, and that text
 * once reached the staff board through "Retry payout".
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { payoutSentenceForStaff, sentenceFor, withoutKeys } from "../api/_stripe-errors.js";
import { cardReason, plainCardReason } from "../api/_card-words.js";

const RAW = "Invalid API Key provided: sk_test_*********abc123";
const failures = [
  { type: "StripeAuthenticationError", message: RAW },
  { type: "StripePermissionError", message: `Forbidden for ${RAW}` },
  { type: "StripeConnectionError", message: RAW },
  { type: "StripeAPIError", message: RAW },
  { type: "StripeRateLimitError", message: RAW },
  { type: "StripeInvalidRequestError", code: "balance_insufficient", message: RAW },
  { type: "StripeInvalidRequestError", code: "account_invalid", message: RAW },
  { type: "StripeInvalidRequestError", message: RAW, requestId: "req_1" },
  { name: "Error", message: `claim_payment_release: ${RAW}` },
];
const FALLBACK = "That could not be done.";
for (const failure of failures) {
  for (const said of [payoutSentenceForStaff(failure), sentenceFor(failure, FALLBACK)]) {
    assert.ok(said && said !== failure.message, `a sentence of our own for ${failure.type ?? failure.name}`);
    assert.ok(!/sk_|abc123|Invalid API Key/.test(said), `no key and no raw words: ${said}`);
  }
}
assert.equal(payoutSentenceForStaff({}).includes("server log"), true, "an unknown failure says where the reason is");

// A card's refusal is written for the person holding it, and is still scrubbed.
assert.equal(sentenceFor({ type: "StripeCardError", message: "Your card was declined." }, FALLBACK), "Your card was declined.");
assert.equal(sentenceFor({ type: "StripeCardError", message: RAW }, FALLBACK).includes("abc123"), false);

// A card's refusal is our sentence, whatever Stripe wrote: a test-mode decline
// carries a stripe.com link, and it reached the factory's timeline.
const LINK = "Your card was declined. Your request used a real card while testing. For a list of valid test cards, visit: https://stripe.com/docs/testing.";
for (const error of [
  { type: "card_error", code: "card_declined", decline_code: "test_mode_live_card", message: LINK },
  { type: "StripeCardError", code: "card_declined", message: LINK },
]) {
  assert.equal(cardReason(error), "Your card was declined.");
}
assert.equal(sentenceFor({ type: "StripeCardError", message: LINK }, FALLBACK), "Your card was declined.");
assert.equal(cardReason({ type: "card_error", code: "card_declined", decline_code: "insufficient_funds", message: LINK }), "Your card has insufficient funds.");
assert.ok(!/stripe/i.test(cardReason({ type: "api_error", message: LINK })));
assert.equal(plainCardReason(LINK), "Your card was declined.", "a row stored before this keeps no link");
assert.equal(plainCardReason("The amount changed while you were paying. You were refunded; please pay again."), "The amount changed while you were paying. You were refunded; please pay again.", "our own reasons stay");
assert.equal(readFileSync("src/shared/card-words.mjs", "utf8"), readFileSync("api/_card-words.js", "utf8"), "the browser's copy of the card words is the server's");
assert.equal(plainCardReason(null), "The payment did not go through, so nothing was charged.");

for (const key of ["sk_live_abc", "rk_test_a1", "sk_test_***abc123", "whsec_abc", "pk_test_x"]) {
  assert.equal(withoutKeys(`before ${key} after`), "before [key] after", key);
}
assert.equal(withoutKeys("req_123 tok_abc acct_1"), "req_123 tok_abc acct_1", "ids stay, to diagnose by");

// No route answers with a failure's message, except where a person's words are
// expected: the database's own refusals, which are written for that person
// (raised by begin_payment_checkout and its like, with a code), our own
// refusals, the live-key refusal, and a card or bank refusal, which is scrubbed.
const ALLOWED = [
  /error\.code === "42501"/,                       // an RPC's refusal, written for the caller
  /failure instanceof PayoutMethodRefusal/,        // our own sentence
  /return reply\(response, 503, \{ error: failure\.message \}\)/, // stripeFrom: "a live Stripe key is only allowed…"
];
for (const file of readdirSync("api").filter((name) => /^stripe-.*\.js$/.test(name))) {
  for (const line of readFileSync(`api/${file}`, "utf8").split("\n")) {
    if (!/reply\(response/.test(line) || !/(failure|error|Error)\.message/.test(line)) continue;
    if (/withoutKeys\(failure\.message\)/.test(line)) continue;
    assert.ok(ALLOWED.some((rule) => rule.test(line)), `api/${file} answers with a raw message: ${line.trim()}`);
  }
}

console.log("stripe errors: a sentence for each failure, no key material, no route passes Stripe's words on");
