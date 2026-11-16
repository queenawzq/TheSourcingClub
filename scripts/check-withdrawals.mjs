/**
 * A factory's withdrawal is paid once, never more than asked, and TSC pays no
 * fee. Runs the real core (api/_withdrawals.js) and the real Wise adapter's
 * quote against a pretend provider and a pretend database: no stack, no keys.
 * What the database refuses (owner only, balance, one open request, staff
 * only) is in supabase/tests/factory_withdrawals_test.sql.
 *
 * The evasions, written before the code: TSC's provider balance short; a
 * provider that adds its fee on top; a fee as large as the amount; a timeout
 * after the provider took it (press again: same key); a certain refusal
 * replayed by the next press (it gets a new key: requeue).
 */
import assert from "node:assert/strict";
import { approveWithdrawal, previewWithdrawal } from "../api/_withdrawals.js";
import { wiseAdapter } from "../api/_withdrawal-adapters.js";
import { PayoutFailure } from "../api/_payout-provider.js";
import { askedWithdrawalRows, earningsSummaryFor, withdrawalRows } from "../src/app/order/payment-summary.mjs";

function world({ balance = 100000, fee = 80, payFails = null, status = "paid", feeOnTop = false } = {}) {
  const recorded = [];
  const paid = [];
  let claim = { withdrawal_id: "w1", key: "key-1", resumed: false, provider: "paypal", provider_ref: null, amount_cents: 6500, currency: "USD", account_id: "a1", paypal_email: "f@example.com" };
  const db = {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { country_code: "CN" }, error: null }) }) }) }),
    rpc: async (name, args) => {
      assert.equal(name, "record_withdrawal");
      recorded.push(args);
      if (args.ref) claim = { ...claim, provider_ref: args.ref };
      if (args.outcome === "requeue") claim = { ...claim, key: `key-${recorded.filter((r) => r.outcome === "requeue").length + 1}` };
      return { data: {}, error: null };
    },
  };
  const caller = { rpc: async (name) => (assert.equal(name, "claim_withdrawal"), { data: claim, error: null }) };
  const adapter = {
    provider: "paypal", label: "Fake",
    balance: async () => balance,
    quote: async (_client, ctx) => ({ feeCents: fee, leavesCents: feeOnTop ? ctx.amountCents + fee : ctx.amountCents, receivesMinor: ctx.amountCents - fee, receivesCurrency: "USD", quote: null }),
    pay: async (_client, ctx, quote) => {
      paid.push({ key: ctx.key, amount: quote.receivesMinor });
      if (payFails) { const failure = payFails; payFails = null; throw failure; }
      return { ref: "ref-1" };
    },
    status: async () => ({ state: status, raw: status }),
  };
  return { db, caller, adapter, recorded, paid, client: {} };
}

// Short of money: nothing is sent, the request waits again with a sentence.
{
  const w = world({ balance: 1000 });
  const result = await approveWithdrawal({ ...w, id: "w1" });
  assert.equal(result.done, "short_balance");
  assert.match(result.sentence, /short by \$55\.00/);
  assert.equal(w.paid.length, 0, "nothing paid when the provider is short");
  assert.equal(w.recorded.at(-1).outcome, "requeue");
}

// Paid: the factory gets the amount less the fee, and it is recorded paid.
{
  const w = world();
  const result = await approveWithdrawal({ ...w, id: "w1" });
  assert.equal(result.done, "paid");
  assert.deepEqual(w.paid, [{ key: "key-1", amount: 6420 }]);
  assert.equal(w.recorded[0].outcome, "sent");
  assert.equal(w.recorded[0].fee, 80, "the fee is recorded before the provider is asked");
  assert.equal(w.recorded[0].ref, undefined);
  assert.equal(w.recorded.at(-1).outcome, "paid");
}

// A provider that would add its fee on top: refused, nothing sent.
{
  const w = world({ feeOnTop: true });
  await assert.rejects(approveWithdrawal({ ...w, id: "w1" }), /more than the amount/);
  assert.equal(w.paid.length, 0);
  assert.equal(w.recorded.at(-1).outcome, "requeue");
}

// A fee as large as the amount: refused in a sentence, nothing sent.
{
  const w = world({ fee: 6500 });
  await assert.rejects(approveWithdrawal({ ...w, id: "w1" }), (failure) => failure instanceof PayoutFailure && failure.kind === "too_small");
  assert.equal(w.paid.length, 0);
}

// Timeout after the provider took it: stays paying; the next press uses the same key.
{
  const w = world({ payFails: new PayoutFailure("timeout", "Fake didn't answer.", { unsure: true }) });
  await assert.rejects(approveWithdrawal({ ...w, id: "w1" }), /didn't answer/);
  assert.equal(w.recorded.at(-1).outcome, "sent", "an unsure failure never goes back to waiting");
  await approveWithdrawal({ ...w, id: "w1" });
  assert.deepEqual(w.paid.map((p) => p.key), ["key-1", "key-1"], "same key: the provider answers with the first payment");
}

// A certain refusal: back to waiting under a new key, so it is never replayed.
{
  const w = world({ payFails: new PayoutFailure("refused", "Fake refused this payment. Nothing was sent.") });
  await assert.rejects(approveWithdrawal({ ...w, id: "w1" }), /refused/);
  assert.equal(w.recorded.at(-1).outcome, "requeue");
  await approveWithdrawal({ ...w, id: "w1" });
  assert.deepEqual(w.paid.map((p) => p.key), ["key-1", "key-2"]);
}

// Preview sends nothing.
{
  const w = world();
  const seen = await previewWithdrawal({ ...w, row: { id: "w1", amount_cents: 6500, currency: "USD", account_id: "a1" } });
  assert.equal(seen.feeCents, 80);
  assert.equal(seen.receivesMinor, 6420);
  assert.equal(w.paid.length, 0);
}

// The Wise adapter keeps Wise's fee inside the amount: Wise quotes with its fee on
// top, so it steps down until what leaves TSC's balance fits.
{
  const quotes = [];
  const wise = {
    payoutCurrency: "CNY",
    quote: async ({ amountCents }) => {
      quotes.push(amountCents);
      const fee = 300 + Math.ceil(amountCents * 0.005);
      return { id: `q${quotes.length}`, feeCents: fee, totalCents: amountCents + fee, arrivesCents: amountCents * 7, arrivesCurrency: "CNY", balanceRefused: false };
    },
  };
  const ctx = { amountCents: 6500, currency: "USD", account: { id: "a1", wiseRecipientId: "r1", wiseCurrency: "CNY" }, caller: null, db: null };
  const quote = await wiseAdapter.quote(wise, ctx);
  assert.ok(quote.leavesCents <= 6500, `leaves ${quote.leavesCents}, never more than the amount`);
  assert.equal(quote.feeCents, 6500 - quotes.at(-1), "the fee is the amount less what is sent to the factory");
  assert.ok(quote.feeCents >= 300, "the factory carries Wise's fee");
}

// One figure: a $40 withdrawal of a $65 step moves $40 from Pending to Paid out.
{
  const step = { id: "p1", state: "confirmed", release_requested_at: "2026-11-16", amount_cents: 6500, currency: "USD", withdrawal_pool: true, order: { status: "active" } };
  const summary = earningsSummaryFor([step], "All clients", new Map([["p1", 4000]]));
  assert.deepEqual(summary.pending, [{ currency: "USD", amount: 2500 }]);
  assert.deepEqual(summary.paid, [{ currency: "USD", amount: 4000 }]);
  assert.deepEqual(summary.total, [{ currency: "USD", amount: 6500 }]);
  // A step released by its withdrawal is not a second, "Bank transfer" withdrawal.
  assert.equal(withdrawalRows([{ ...step, state: "released", released_by: "u", released_note: "Withdrawn" }]).length, 0);
  const rows = askedWithdrawalRows([{ id: "w", status: "paid", amount_cents: 4000, currency: "USD", provider: "paypal", paid_to: "a@b.c", fee_cents: 79, receives_minor: 3921, paid_at: "2026-11-16" }, { id: "x", status: "cancelled", amount_cents: 1, currency: "USD" }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount, -4000);
}

console.log("withdrawals: short balance sends nothing; fee inside the amount; one key per attempt; a refusal is never replayed");
