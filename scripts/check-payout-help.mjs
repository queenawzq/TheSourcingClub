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
// Nov 12 call: each withdrawal method says its fee and its timing, and none promises instant.
const info = await import("../src/shared/payout-method-info.mjs");
const methodLines = {
  stripe: ["No TSC fee per withdrawal", "Not instant: usually 1–4 business days after you withdraw"],
  wise: ["No fee: TSC pays the transfer fee", "Not instant: sent once released, then a few business days to arrive"],
  bank: ["No TSC fee; your bank may charge to receive a transfer", "Not instant: sent once released, then a few business days to arrive"],
  paypal: ["No TSC fee; PayPal may charge to convert or withdraw", "Not instant: sent once released, then a few business days to arrive"],
};
for (const [method, lines] of Object.entries(methodLines)) {
  assert.deepEqual(info.payoutMethodLines(method), lines, `${method} keeps its fee and timing lines`);
}
// The lines follow the route Set up takes. Only Stripe's "Bank account" is
// certain; every other bank option may open staff's bank form (no Wise currency,
// e.g. TW and KH, or Wise not set up), so it must never claim Wise's terms.
const { PAYOUT_COUNTRIES } = await import("../src/shared/stripe-payout-countries.mjs");
const { wiseCurrencyFor } = await import("../api/_wise-currencies.js");
for (const country of ["TW", "KH"]) assert.equal(wiseCurrencyFor(country, "CNY"), null, `${country} has no Wise currency, so its bank option opens the staff form`);
for (const country of [...PAYOUT_COUNTRIES, "CN", "TW", "KH", "HK", "VN", "other"]) {
  const supported = PAYOUT_COUNTRIES.has(country);
  assert.equal(info.chooserMethod("bank", { supported }), supported ? "stripe" : "bank", `${country}: the recommended bank option's lines match its route`);
  assert.equal(info.chooserMethod("wise", { supported }), "bank", `${country}: International bank transfer may open the staff form`);
  assert.equal(info.chooserMethod("paypal", { supported }), "paypal");
}
for (const option of ["bank", "wise", "paypal"]) {
  assert.ok(card.includes(`<MethodLines method={chooserMethod("${option}", { supported })} />`), `the ${option} option draws the lines of its route`);
}
assert.ok(!/<MethodLines method="/.test(card), "no option hardcodes its lines");
assert.ok(read("src/app/order/LiveFund.jsx").includes("once it is funded, and it takes a few business days to arrive."), "the deposit agreement says a payout takes days");
const quiet = read("src/app/live-quiet.css").replace(/\/\*[\s\S]*?\*\//g, "");
assert.ok(!/payout-transactions-header|payment-help|payment-metric-label|payout-security-copy/.test(quiet), "copy cleanup cannot hide payout help");
const helper = read("src/app/order/PaymentHelp.jsx");
for (const behavior of ["onPointerEnter", "onFocus", "onClick", 'role="tooltip"']) assert.ok(helper.includes(behavior), `help supports ${behavior}`);
console.log("Payout explanations and mouse, keyboard and tap help are preserved.");
