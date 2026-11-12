import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Product requirement, Nov 11: these helpers were removed twice during copy cleanup.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const page = read("src/app/order/PayoutDetails.jsx");
const card = read("src/app/order/StripePayoutCard.jsx");
for (const label of ["Total earnings", "Awaiting approval", "Pending", "Paid out"]) {
  assert.match(page, new RegExp(`\\["${label}", summary\\.\\w+, "[^"\\n]+"\\]`), `${label} keeps its explanation`);
}
assert.ok(page.includes('<PaymentHelp label={label}>{help}</PaymentHelp>'), "summary helpers remain reachable");
for (const label of ["Balance", "Available balance", "Pending balance"]) {
  assert.ok(card.includes(`<PaymentHelp label="${label}">`), `${label} keeps its help button`);
}
for (const text of ["Earnings stay in your balance until you withdraw them.", "Our payment partner securely verifies", "Choose where your company is registered."]) {
  assert.ok(card.includes(text), `preserve payout guidance: ${text}`);
}
const quiet = read("src/app/live-quiet.css").replace(/\/\*[\s\S]*?\*\//g, "");
assert.ok(!/payout-transactions-header|payment-help|payment-metric-label|payout-security-copy/.test(quiet), "copy cleanup cannot hide payout help");
const helper = read("src/app/order/PaymentHelp.jsx");
for (const behavior of ["onPointerEnter", "onFocus", "onClick", 'role="tooltip"']) assert.ok(helper.includes(behavior), `help supports ${behavior}`);
console.log("Payout explanations and mouse, keyboard and tap help are preserved.");
