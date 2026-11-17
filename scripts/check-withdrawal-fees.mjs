// The withdrawal fee: TSC pays none, the factory receives amount − fee, a
// quote wins over the formula, fees round up, and a payment no bigger than
// its fee is refused. Run: node scripts/check-withdrawal-fees.mjs
import assert from "node:assert/strict";
import { FEE_FORMULAS, withdrawalFee, withdrawalFeeLine, providerCharge, stripeWithdrawalFee } from "../src/shared/withdrawal-fees.mjs";

// What left TSC is the sent amount plus the provider's own charge on it.
const leftTsc = (provider, country, amount) => {
  const r = withdrawalFee({ provider, amountCents: amount, country });
  return r.receivesCents + providerCharge(provider, country)(r.receivesCents);
};

for (const provider of ["stripe", "paypal", "bank"]) {
  for (const country of ["US", "DE", "GB"]) {
    for (const amount of [76, 100, 999, 10_000, 123_457, 1_000_000, 5_000_000, 100_000_000]) {
      const r = withdrawalFee({ provider, amountCents: amount, country });
      if (r.refused) continue;
      assert.equal(r.feeCents + r.receivesCents, amount, `${provider} ${country} ${amount}: fee + receives = amount`);
      const out = leftTsc(provider, country, amount);
      assert.ok(out <= amount && out >= amount - 1, `${provider} ${country} ${amount}: TSC paid ${out}, not more than the amount and at most a cent less`);
      assert.ok(r.feeCents > 0, "a fee is charged");
    }
  }
}

// Stripe US, US$1,000.00: pays out T with T + ceil(0.50% T) + 25 <= 100000
// (0.25% + 25¢ per payout, 0.25% funds routing on every payout, 2026-11-17).
assert.deepEqual(withdrawalFee({ provider: "stripe", amountCents: 100_000, country: "US" }), { feeCents: 523, receivesCents: 99_477, basis: "formula" });
assert.equal(providerCharge("stripe", "US")(99_477), 498 + 25, "US: 0.50% + 25¢ on what is paid out");
// Stripe DE adds the 0.25% cross-border fee: 0.75% + 25¢.
assert.equal(withdrawalFee({ provider: "stripe", amountCents: 100_000, country: "DE" }).feeCents, 770);
assert.equal(providerCharge("stripe", "DE")(99_230), 745 + 25);
assert.equal(FEE_FORMULAS.stripe.fundsRoutingBps, 25, "funds routing is charged on every payout, US included");
// PayPal to a US account: US$0.25 a payout (what the sandbox charged).
assert.deepEqual(withdrawalFee({ provider: "paypal", amountCents: 10_000, country: "US" }), { feeCents: 25, receivesCents: 9_975, basis: "formula" });
assert.equal(withdrawalFee({ provider: "paypal", amountCents: 5_000_000, country: "US" }).feeCents, 25);
// Abroad: 2%, at most US$20: US$100.00 → sends 98.03, PayPal charges 1.97 (rounded up).
assert.deepEqual(withdrawalFee({ provider: "paypal", amountCents: 10_000, country: "DE" }), { feeCents: 197, receivesCents: 9_803, basis: "formula" });
assert.equal(withdrawalFee({ provider: "paypal", amountCents: 5_000_000, country: "DE" }).feeCents, 2_000);
// An unknown country pays the larger fee, never less than TSC is charged.
assert.equal(withdrawalFee({ provider: "paypal", amountCents: 10_000 }).feeCents, 197);
assert.equal(withdrawalFee({ provider: "stripe", amountCents: 100_000 }).feeCents, 770);

// A quote wins, rounded up; Wise/Tazapay without a quote decide nothing.
assert.deepEqual(withdrawalFee({ provider: "wise", amountCents: 10_000, quotedFeeCents: 412 }), { feeCents: 412, receivesCents: 9_588, basis: "quote" });
assert.equal(withdrawalFee({ provider: "tazapay", amountCents: 10_000, quotedFeeCents: 543.2 }).feeCents, 544);
assert.equal(withdrawalFee({ provider: "stripe", amountCents: 10_000, quotedFeeCents: 10 }).feeCents, 10, "a quote wins over the formula");
assert.deepEqual(withdrawalFee({ provider: "wise", amountCents: 10_000 }), { feeCents: null, receivesCents: null, basis: "quote_needed" });
// The staff-paid bank wire: a fixed US$50, the same figure as the database's.
assert.deepEqual(withdrawalFee({ provider: "bank", amountCents: 10_000 }), { feeCents: 5000, receivesCents: 5_000, basis: "formula" });
assert.match(withdrawalFee({ provider: "bank", amountCents: 5000 }).refused, /too small: the fee to send it is US\$50\.00/);
{
  const { readFileSync, readdirSync } = await import("node:fs");
  const file = readdirSync("supabase/migrations").filter((name) => readFileSync(`supabase/migrations/${name}`, "utf8").includes("function public.bank_payout_fee_cents()")).sort().at(-1);
  const sql = readFileSync(`supabase/migrations/${file}`, "utf8");
  assert.ok(sql.includes(`select ${FEE_FORMULAS.bank.fixedCents}::bigint`), "public.bank_payout_fee_cents() is the module's bank fee");
}
// Stripe's cross-border fee is the highest it publishes (0.25%; see the header).
assert.equal(FEE_FORMULAS.stripe.crossBorderBps, 25);

// Too small: refused with a sentence.
for (const r of [
  withdrawalFee({ provider: "stripe", amountCents: 25, country: "US" }),
  withdrawalFee({ provider: "wise", amountCents: 300, quotedFeeCents: 300 }),
  withdrawalFee({ provider: "tazapay", amountCents: 500, quotedFeeCents: 544 }),
  withdrawalFee({ provider: "paypal", amountCents: 0 }),
]) assert.match(r.refused ?? "", /^[A-Z].*\.$/, "a refusal is a sentence");
assert.equal(withdrawalFee({ provider: "stripe", amountCents: 27, country: "US" }).receivesCents, 1);

// Lines: both languages, never "TSC pays".
for (const provider of ["stripe", "wise", "paypal", "tazapay", "bank"]) {
  for (const country of ["US", "CN", "DE"]) {
    const en = withdrawalFeeLine(provider, { country });
    const zh = withdrawalFeeLine(provider, { country, language: "zh" });
    assert.match(en, /^Fee/);
    assert.ok(!/TSC pays/.test(en) && !/TSC 承担/.test(zh), `${provider}: no line says TSC pays`);
    assert.notEqual(en, zh);
  }
}
// A withdrawal from a Stripe balance: the fee in US$, on the amount in US$.
assert.deepEqual(stripeWithdrawalFee({ amountMinor: 100_000, currency: "usd", country: "US" }), { feeCents: 523, usdCents: 100_000, feeLocalEstimate: 523 });
// A GBP balance at 0.758366 GBP per US$ (the sandbox's rate on 2026-11-17):
// £758.36 is US$1,000.00 (rounded up), so the fee is the DE/GB US$7.70, about £5.84.
assert.deepEqual(stripeWithdrawalFee({ amountMinor: 75_836, currency: "gbp", country: "GB", localPerUsd: 0.758366 }), { feeCents: 770, usdCents: 100_000, feeLocalEstimate: 584 });
// At or under the fee: refused with the module's sentence, in the balance's currency.
assert.match(stripeWithdrawalFee({ amountMinor: 26, currency: "usd", country: "US" }).refused, /^This payment of US\$0\.26 is too small: the fee to send it is US\$0\.26, so nothing would arrive\. Nothing was sent\.$/);
assert.equal(stripeWithdrawalFee({ amountMinor: 27, currency: "usd", country: "US" }).feeCents, 26);
assert.match(stripeWithdrawalFee({ amountMinor: 20, currency: "gbp", country: "GB", localPerUsd: 0.758366 }).refused, /^This payment of GBP 0\.20 is too small: the fee to send it is GBP 0\.20/);
assert.match(stripeWithdrawalFee({ amountMinor: 0, currency: "usd" }).refused, /more than zero/);
console.log("withdrawal fees: all checks passed");
