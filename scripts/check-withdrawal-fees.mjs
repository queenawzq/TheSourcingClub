// The withdrawal fee: TSC pays none, the factory receives amount − fee, a
// quote wins over the formula, fees round up, and a payment no bigger than
// its fee is refused. Run: node scripts/check-withdrawal-fees.mjs
import assert from "node:assert/strict";
import { FEE_FORMULAS, withdrawalFee, withdrawalFeeLine, providerCharge } from "../src/shared/withdrawal-fees.mjs";

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

// Stripe US, US$1,000.00: sends T with T + ceil(0.25% T) + 25 <= 100000.
assert.deepEqual(withdrawalFee({ provider: "stripe", amountCents: 100_000, country: "US" }), { feeCents: 275, receivesCents: 99_725, basis: "formula" });
// Stripe DE adds the 0.25% cross-border fee.
assert.equal(withdrawalFee({ provider: "stripe", amountCents: 100_000, country: "DE" }).feeCents, 523);
// PayPal to a US account: US$0.25 a payout (what the sandbox charged).
assert.deepEqual(withdrawalFee({ provider: "paypal", amountCents: 10_000, country: "US" }), { feeCents: 25, receivesCents: 9_975, basis: "formula" });
assert.equal(withdrawalFee({ provider: "paypal", amountCents: 5_000_000, country: "US" }).feeCents, 25);
// Abroad: 2%, at most US$20: US$100.00 → sends 98.03, PayPal charges 1.97 (rounded up).
assert.deepEqual(withdrawalFee({ provider: "paypal", amountCents: 10_000, country: "DE" }), { feeCents: 197, receivesCents: 9_803, basis: "formula" });
assert.equal(withdrawalFee({ provider: "paypal", amountCents: 5_000_000, country: "DE" }).feeCents, 2_000);
// An unknown country pays the larger fee, never less than TSC is charged.
assert.equal(withdrawalFee({ provider: "paypal", amountCents: 10_000 }).feeCents, 197);
assert.equal(withdrawalFee({ provider: "stripe", amountCents: 100_000 }).feeCents, 523);

// A quote wins, rounded up; Wise without a quote decides nothing.
assert.deepEqual(withdrawalFee({ provider: "wise", amountCents: 10_000, quotedFeeCents: 412 }), { feeCents: 412, receivesCents: 9_588, basis: "quote" });
// Tazapay: a fixed US$5.00 per local payout, a placeholder at the top of its
// published range (US$2-5) until TSC's live account. Its quote does not change it.
assert.equal(FEE_FORMULAS.tazapay.localFixedCents, 500);
assert.deepEqual(withdrawalFee({ provider: "tazapay", amountCents: 10_000 }), { feeCents: 500, receivesCents: 9_500, basis: "formula" });
for (const quoted of [323, 544, 543.2, 900]) {
  assert.equal(withdrawalFee({ provider: "tazapay", amountCents: 10_000, quotedFeeCents: quoted }).feeCents, 500, `a Tazapay quote of ${quoted} leaves the fixed fee`);
}
assert.equal(withdrawalFee({ provider: "tazapay", amountCents: 9_999_999 }).feeCents, 500, "fixed, whatever the amount");
assert.match(withdrawalFee({ provider: "tazapay", amountCents: 500 }).refused, /too small: the fee to send it is US\$5\.00/);
assert.equal(withdrawalFee({ provider: "tazapay", amountCents: 501 }).receivesCents, 1);
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
  withdrawalFee({ provider: "tazapay", amountCents: 500 }),
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
