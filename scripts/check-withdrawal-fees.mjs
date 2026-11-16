// The withdrawal fee: TSC pays none, the factory receives amount − fee, a
// quote wins over the formula, fees round up, and a payment no bigger than
// its fee is refused. Run: node scripts/check-withdrawal-fees.mjs
import assert from "node:assert/strict";
import { withdrawalFee, withdrawalFeeLine, providerCharge } from "../src/shared/withdrawal-fees.mjs";

// What left TSC is the sent amount plus the provider's own charge on it.
const leftTsc = (provider, country, amount) => {
  const r = withdrawalFee({ provider, amountCents: amount, country });
  return r.receivesCents + providerCharge(provider, country)(r.receivesCents);
};

for (const provider of ["stripe", "paypal"]) {
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

// Stripe US, US$1,000.00: sends T with T + ceil(0.25% T) + 25 <= 100000.
assert.deepEqual(withdrawalFee({ provider: "stripe", amountCents: 100_000, country: "US" }), { feeCents: 275, receivesCents: 99_725, basis: "formula" });
// Stripe DE adds the 0.25% cross-border fee.
assert.equal(withdrawalFee({ provider: "stripe", amountCents: 100_000, country: "DE" }).feeCents, 523);
// PayPal 2%: US$100.00 → sends 98.03, PayPal charges 1.97 (rounded up).
assert.deepEqual(withdrawalFee({ provider: "paypal", amountCents: 10_000, country: "US" }), { feeCents: 197, receivesCents: 9_803, basis: "formula" });
// Caps: US$20 domestic, US$100 international.
assert.equal(withdrawalFee({ provider: "paypal", amountCents: 5_000_000, country: "US" }).feeCents, 2000);
assert.equal(withdrawalFee({ provider: "paypal", amountCents: 5_000_000, country: "DE" }).feeCents, 10_000);

// A quote wins, rounded up; Wise/Tazapay without a quote decide nothing.
assert.deepEqual(withdrawalFee({ provider: "wise", amountCents: 10_000, quotedFeeCents: 412 }), { feeCents: 412, receivesCents: 9_588, basis: "quote" });
assert.equal(withdrawalFee({ provider: "tazapay", amountCents: 10_000, quotedFeeCents: 543.2 }).feeCents, 544);
assert.equal(withdrawalFee({ provider: "stripe", amountCents: 10_000, quotedFeeCents: 10 }).feeCents, 10, "a quote wins over the formula");
assert.deepEqual(withdrawalFee({ provider: "wise", amountCents: 10_000 }), { feeCents: null, receivesCents: null, basis: "quote_needed" });
assert.deepEqual(withdrawalFee({ provider: "bank", amountCents: 10_000 }), { feeCents: 0, receivesCents: 10_000, basis: "none" });

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
console.log("withdrawal fees: all checks passed");
