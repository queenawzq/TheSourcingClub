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
// Each withdrawal method names its provider, says its fee as a percentage and
// its timing, and none promises instant.
const info = await import("../src/shared/payout-method-info.mjs");
const methodLines = {
  stripeUs: ["Fee: 0% (TSC pays Stripe's fee)", "Not instant: usually 1–4 business days after you withdraw"],
  stripe: ["Fee: 0% to withdraw; Stripe converts from US$ at its rate", "Not instant: usually 1–4 business days after you withdraw"],
  wise: ["Fee: 0% (TSC pays Wise's fee), at the mid-market rate", "Not instant: sent once released, then a few business days to arrive"],
  wiseUs: ["Fee: 0% (TSC pays Wise's fee)", "Not instant: sent once released, then a few business days to arrive"],
  bank: ["Fee: 0% from TSC; your bank may charge to receive it", "Not instant: sent once released, then a few business days to arrive"],
  // PayPal usually lands within minutes of staff sending it.
  paypal: ["Fee: 0% (TSC pays PayPal's fee); PayPal may charge about 3–4% to convert US$", "Not instant: sent once released"],
  paypalUs: ["Fee: 0% (TSC pays PayPal's fee)", "Not instant: sent once released"],
};
assert.deepEqual(Object.keys(info.PAYOUT_METHOD_INFO).sort(), Object.keys(methodLines).sort(), "every route's lines are pinned here");
for (const [method, lines] of Object.entries(methodLines)) {
  assert.deepEqual(info.payoutMethodLines(method), lines, `${method} keeps its fee and timing lines`);
}
for (const lines of Object.values(info.PAYOUT_METHOD_INFO)) assert.ok(!/No TSC fee/.test(lines.join(" ")), "no line says \"No TSC fee\"");
// The lines follow the route Set up takes: Stripe's "Bank account" in a Stripe
// country; Wise's form wherever Wise has a currency for the country; staff's
// bank form where it has none (TW, KH, a country not listed).
const { PAYOUT_COUNTRIES } = await import("../src/shared/stripe-payout-countries.mjs");
const { wiseCurrencyFor } = await import("../api/_wise-currencies.js");
for (const country of ["TW", "KH"]) assert.equal(wiseCurrencyFor(country, "CNY"), null, `${country} has no Wise currency, so its bank option opens the staff form`);
// Wise's HKD requirements offer only "hongkong" (a bank account) beside FPS; CNY
// offers it as "To Hong Kong". Hong Kong gets Wise's form, China never that kind.
const { chooseRecipientType } = await import("../api/_wise-requirements-shape.js");
assert.equal(chooseRecipientType([{ type: "hong_kong_fps" }, { type: "hongkong" }], "HK")?.type, "hongkong", "Hong Kong opens Wise's form");
assert.equal(chooseRecipientType([{ type: "hong_kong_fps" }, { type: "chinese_local_business" }, { type: "hongkong" }], "CN")?.type, "chinese_local_business");
assert.equal(chooseRecipientType([{ type: "hong_kong_fps" }, { type: "hongkong" }], "CN"), null, "a factory outside Hong Kong never gets the Hong Kong form");
const everyCountry = new Set([...PAYOUT_COUNTRIES, ...info.WISE_COUNTRIES, "TW", "KH", "other"]);
for (const country of everyCountry) assert.equal(info.WISE_COUNTRIES.has(country), Boolean(wiseCurrencyFor(country, "CNY")), `${country}: the browser's Wise list matches api/_wise-currencies.js`);
for (const country of [...PAYOUT_COUNTRIES, "CN", "TW", "KH", "HK", "VN", "IN", "other"]) {
  const supported = PAYOUT_COUNTRIES.has(country);
  const wise = Boolean(wiseCurrencyFor(country, "CNY"));
  if (supported) assert.ok(wise, `${country}: International bank transfer (Wise) has a Wise currency`);
  assert.equal(info.paidByWise(country), wise, `${country}: named Wise only where Wise has a currency`);
  // A US factory is paid US$ to US$, so its lines say nothing about converting.
  const us = country === "US";
  assert.equal(info.chooserMethod("bank", { supported, country }), supported ? (us ? "stripeUs" : "stripe") : wise ? "wise" : "bank", `${country}: the recommended bank option's lines match its route`);
  assert.equal(info.chooserMethod("wise", { supported, country }), wise ? (us ? "wiseUs" : "wise") : "bank", `${country}: International bank transfer draws Wise's lines`);
  assert.equal(info.chooserMethod("paypal", { supported, country }), us ? "paypalUs" : "paypal", `${country}: PayPal's lines`);
}
for (const country of ["TW", "KH", "other"]) assert.equal(info.chooserMethod("bank", { country }), "bank", `${country}: staff's bank lines`);
const factoryZh = read("src/factory-prototype/main.jsx");
for (const text of [...new Set(Object.values(info.PAYOUT_METHOD_INFO).flat()), "Bank account (Stripe)", "International bank transfer (Wise)", "Bank transfer (Wise)"]) {
  assert.ok(factoryZh.includes(`  ${JSON.stringify(text)}: "`), `the factory dictionary has Chinese for: ${text}`);
}
assert.ok(card.includes("<strong>{listLabel(method)}</strong>") && card.includes("<strong>{manualListLabel(row)}</strong>") && card.includes("(Wise)`, row.account_number_last4)"), "the saved methods list names the provider as the chooser does");
assert.ok(card.includes('"Bank account (Stripe)"') &&card.includes("{transferName(country)} (Wise)") && card.includes("`${words.bank} (Wise)`"), "each bank option names its provider");
// Nov 13: Stripe's "Bank account" holds payouts (holdPayouts) until the factory
// withdraws, so the chooser's intro says so where that option is offered.
assert.ok(card.includes('{supported ? "Released earnings are sent to your default method, or to your balance to withdraw with a Bank account." : "Released earnings are sent to your default method."}'), "the chooser intro is true of the Stripe route and the others");
for (const option of ["bank", "wise", "paypal"]) {
  assert.ok(card.includes(`<MethodLines method={chooserMethod("${option}", { supported, country })} />`), `the ${option} option draws the lines of its route`);
}
assert.ok(!/<MethodLines method="/.test(card), "no option hardcodes its lines");
const liveFund = read("src/app/order/LiveFund.jsx");
assert.ok(liveFund.includes("once it is funded, and it takes a few business days to arrive."), "the deposit agreement says a payout takes days");
// Nov 13: a deposit or balance is released once funded, so the live Fund
// subtitle and success text must not borrow the design's "after you approve"
// words for it. Approval steps keep the design's; the prototype's text stays.
assert.ok(liveFund.includes("The step amount, without fees, is released to ${factory} once funded."), "the payment-only Fund subtitle says it is released once funded");
assert.match(liveFund, /fundingMilestone = \{[\s\S]*?\.\.\.\(paymentOnly \? \{ fundNote: paymentOnlyFundNote\(/, "the Fund screen passes the payment-only note");
assert.ok(liveFund.includes("Your payment is funded. TSC releases it to ${factory}; it takes a few business days to arrive."), "the payment-only success text says TSC releases it");
assert.ok(liveFund.includes("Once your payment clears, TSC releases it to ${factory}; it takes a few business days to arrive."), "the payment-only processing text says TSC releases it");
assert.equal((liveFund.match(/\.\.\.\(paymentOnly \? \{ description: paymentOnlySuccess\(factory, (true|false)\) \} : \{\}\)/g) ?? []).length, 2, "both success headings pass the payment-only text");
const prototype = read("src/prototype/main.jsx");
assert.ok(prototype.includes("funds are only released after you approve the sample."), "the prototype keeps its own success text");
assert.equal((prototype.match(/Funds stay protected until the related step is approved\./g) ?? []).length, 2, "the prototype keeps its own Fund subtitle");
const quiet = read("src/app/live-quiet.css").replace(/\/\*[\s\S]*?\*\//g, "");
assert.ok(!/payout-transactions-header|payment-help|payment-metric-label|payout-security-copy/.test(quiet), "copy cleanup cannot hide payout help");
const helper = read("src/app/order/PaymentHelp.jsx");
for (const behavior of ["onPointerEnter", "onFocus", "onClick", 'role="tooltip"']) assert.ok(helper.includes(behavior), `help supports ${behavior}`);
console.log("Payout explanations and mouse, keyboard and tap help are preserved.");
