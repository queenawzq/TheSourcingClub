/**
 * A factory's full bank number goes from the form to the database, and from the
 * database to one staff member's screen, and nowhere else. The database half is
 * pinned in supabase/tests/bank_numbers_test.sql; this pins the code half:
 *   - nothing on our server ever sees it (the browser talks to Supabase directly),
 *   - only the two named calls reach it from the browser,
 *   - it is never logged where the page handles it,
 *   - every number in the seed, tests and scripts is plainly fake.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : [path];
});
const read = (path) => readFileSync(path, "utf8");

const NUMBER_WORDS = /account_number(?!_last4)|payout_account_numbers|reveal_payout_account_number|save_bank_payout_account|save_wise_payout_account|payout_wise_recipient|decrypted_secrets/;

// The one exception: Wise needs the number to make a recipient, so this file
// reads it with the staff member's token, sends it to Wise and keeps nothing.
const WISE_RECIPIENT = "api/_wise-recipient.js";
for (const path of walk("api")) {
  if (path === WISE_RECIPIENT) {
    assert(!/console\.\w+\([^)]*(number|details|recipient)/i.test(read(path)), `${path} logs something near the number`);
    continue;
  }
  assert(!NUMBER_WORDS.test(read(path)), `${path} touches the bank number: it must never go through our server`);
}

const ALLOWED_IN_SRC = new Set([
  "src/app/order/use-manual-payouts.js",
  "src/app/order/StripePayoutCard.jsx",
  "src/app/order/PayoutSetupSteps.jsx",
  "src/lib/domain/payment.js",
  "src/app/admin/AdminPayments.jsx",
  // Stripe's own path: Stripe.js tokenises the number in the browser (CLAUDE.md, Payments).
  "src/app/order/AddPayoutMethodForm.jsx",
]);
for (const path of walk("src")) {
  if (!/\.(jsx?|mjs)$/.test(path)) continue;
  const text = read(path);
  if (NUMBER_WORDS.test(text)) assert(ALLOWED_IN_SRC.has(path), `${path} touches the bank number: only the form and the board may`);
  if (ALLOWED_IN_SRC.has(path)) {
    assert(!/console\.\w+\([^)]*(number|form)/i.test(text), `${path} logs something near the number`);
  }
  assert(!/from\(["']payout_(account_numbers|number_reveals)["']\)/.test(text), `${path} reads a number table directly`);
}

// What the number is shown in stays out of storage and off the row.
const board = read("src/app/admin/AdminPayments.jsx");
assert(!/localStorage|sessionStorage/.test(board), "the board must not store anything: the number passes through it");
assert(/setTimeout\(hide, REVEAL_SHOWN_MS\)/.test(board), "a shown number hides itself");
const hook = read("src/app/order/use-manual-payouts.js");
assert(/account_number: "", account_number_again: ""/.test(hook), "the form forgets the number once saved");

// Plainly fake: at least eight zeros in a row, or the documentation's own IBAN.
const FAKE = /^(0{8,}\d*|GB82WEST12345698765(432|433))$/;
const texts = [...walk("supabase/tests"), "scripts/seed-demo.mjs", "scripts/smoke-test.mjs", "scripts/e2e.mjs"];
for (const path of texts) {
  const text = read(path);
  const literal = /account_number(?:_again)?\s*(?:=>|:)\s*['"`]([^'"`]+)['"`]/g;
  for (const [, value] of text.matchAll(literal)) {
    const number = value.replace(/[\s-]/g, "");
    assert(FAKE.test(number) || !/\d{5,}/.test(number), `${path}: "${number.slice(-4)}" is not plainly a fake number`);
  }
}

console.log("check:bank-number ok");
