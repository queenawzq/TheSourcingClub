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
for (const text of ["Earnings stay in your balance until you withdraw them.", "Our payment partner securely verifies"]) {
  assert.ok(card.includes(text), `preserve payout guidance: ${text}`);
}
// Removed on request (Nov 18): the country picked now decides the methods, so
// the chooser no longer asks for the country of registration.
assert.ok(!card.includes("Choose where your company is registered."), "the chooser does not ask for the country of registration");
// Each withdrawal method names its provider, says its fee as a percentage and
// its timing, and none promises instant.
const info = await import("../src/shared/payout-method-info.mjs");
const methodLines = {
  stripeUs: ["From 0.25% fee, processed by Stripe", "Usually processed within 3–7 business days"],
  stripe: ["From 0.25% fee, processed by Stripe", "Usually processed within 3–7 business days"],
  wise: ["From 0.23% fee, processed by Wise", "Usually processed within 3–7 business days"],
  wiseUs: ["From 0.23% fee, processed by Wise", "Usually processed within 3–7 business days"],
  paypal: ["Up to 2% fee", "Usually processed within 3–7 business days"],
  paypalUs: ["Up to 2% fee", "Usually processed within 3–7 business days"],
};
assert.deepEqual(Object.keys(info.PAYOUT_METHOD_INFO).sort(), Object.keys(methodLines).sort(), "every route's lines are pinned here");
for (const [method, lines] of Object.entries(methodLines)) {
  assert.deepEqual(info.payoutMethodLines(method), lines, `${method} keeps its fee and timing lines`);
}
for (const lines of Object.values(info.PAYOUT_METHOD_INFO)) assert.ok(!/No TSC fee|TSC pays/.test(lines.join(" ")), "no line says TSC pays the fee: the factory does");
// The lines follow the route Set up takes: Stripe's "Bank account" in a Stripe
// country; Wise's form wherever Wise has a currency for the country; staff's
// PayPal alone where it has none (TW, KH, a country not listed).
const { PAYOUT_COUNTRIES } = await import("../src/shared/stripe-payout-countries.mjs");
const { wiseCurrencyFor } = await import("../api/_wise-currencies.js");
for (const country of ["TW", "KH"]) assert.equal(wiseCurrencyFor(country, "CNY"), null, `${country} has no Wise currency, so it is offered PayPal alone`);
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
  assert.equal(info.chooserMethod("bank", { supported, country }), supported ? (us ? "stripeUs" : "stripe") : wise ? "wise" : null, `${country}: the recommended bank option's lines match its route`);
  assert.equal(info.chooserMethod("wise", { supported, country }), wise ? (us ? "wiseUs" : "wise") : null, `${country}: International bank transfer draws Wise's lines`);
  assert.equal(info.chooserMethod("paypal", { supported, country }), us ? "paypalUs" : "paypal", `${country}: PayPal's lines`);
}
// No staff-paid bank option: where neither Stripe nor Wise pays, PayPal alone.
for (const country of ["TW", "KH", "other"]) assert.equal(info.chooserMethod("bank", { country }), null, `${country}: no bank option`);
// The options follow the country picked, once it is listed (Nov 18: the picked country decides the switches).
assert.ok(card.includes("const bankRoute = supported || (wiseOn && paidByWise(picked));") && card.includes("picked && !bankRoute ?"), "the chooser offers PayPal alone where no bank route pays");
assert.ok(card.includes('onUnavailable={() => setModal("bank-unavailable")}') && !card.includes('onUnavailable={() => setModal("setup-bank")}'), "Wise's form unavailable never falls back to the staff bank form");
assert.ok(!card.includes('notListed ? "setup-bank"'), "the chooser never opens the staff bank form");
// TSC no longer pays a bank by hand (20261117500000): the staff-paid form and its save are gone.
assert.ok(!card.includes('"setup-bank"') && !card.includes("onSaveManual"), "the card has no staff-paid bank form, to set up or to edit");
assert.ok(!read("src/app/order/use-manual-payouts.js").includes("save_bank_payout_account"), "nothing in the app saves a bank account staff would pay by hand");
const factoryZh = read("src/factory-prototype/main.jsx");
const { WITHDRAWAL_FEE_LINES_ZH } = await import("../src/shared/withdrawal-fees.mjs");
assert.ok(factoryZh.includes("  ...WITHDRAWAL_FEE_LINES_ZH,"), "the factory dictionary takes the fee lines' Chinese from the fee module");
for (const text of [...new Set(Object.values(info.PAYOUT_METHOD_INFO).flat()), "Bank account (Stripe)", "International bank transfer (Wise)", "Bank transfer (Wise)"]) {
  assert.ok(factoryZh.includes(`  ${JSON.stringify(text)}: "`) || WITHDRAWAL_FEE_LINES_ZH[text], `the factory dictionary has Chinese for: ${text}`);
}
assert.ok(card.includes("<strong>{listLabel(method)}</strong>") && card.includes("<strong>{manualListLabel(row)}</strong>") && card.includes("(Wise)`, row.account_number_last4)"), "the saved methods list names the provider as the chooser does");
assert.ok(card.includes('"Bank account (Stripe)"') && card.includes("{transferName(picked)} (Wise)") && card.includes("`${words.bank} (Wise)`"), "each bank option names its provider");
// A US factory's Wise option, its dialog and its saved row say "Bank transfer": US$ to US$ is not international.
assert.ok(card.includes('export const transferName = (country) => (PAYOUT_COUNTRIES.has(country) && country !== "US" ? "International bank transfer" : LIST_WORDS.bank);'), "a US bank transfer is not called international");
// "(Wise)" on a saved bank row only where the server pays it through Wise: a Wise recipient on the row (20261108163459).
assert.ok(card.includes('const manualListLabel = (row) => (row?.method === "bank" && row.wise_recipient_type ? '), "the saved list says (Wise) only on a row Wise pays (the balance card has no method line)");
// Nov 13: Stripe's "Bank account" holds payouts (holdPayouts) until the factory
// withdraws, so the chooser's intro says so where that option is offered.
assert.ok(card.includes('{supported ? "Released earnings are sent to your default method, or to your balance to withdraw with a Bank account." : "Released earnings are sent to your default method."}'), "the chooser intro is true of the Stripe route and the others");
for (const option of ["bank", "wise", "paypal"]) {
  assert.ok(card.includes(`<MethodLines method={chooserMethod("${option}", { supported, country: picked })} />`), `the ${option} option draws the lines of its route`);
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
