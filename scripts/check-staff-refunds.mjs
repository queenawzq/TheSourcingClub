// Staff refunds from the admin board (20261125100000): makeStaffRefund against
// a fake Stripe and database. Never refunds twice, never replays an old
// failure, and treats an unknown outcome as unknown.
import assert from "node:assert/strict";
import { makeStaffRefund, staffRefundFailure } from "../api/_stripe.js";

const claim = (over = {}) => ({
  staff_refund_id: "sr-1", payment_id: "pay-1", order_id: "ord-1", intent: "pi_1", charge: "ch_1",
  amount_cents: 1000, factory_cents: 900, tsc_cents: 100, status: "claimed", key: "staff-refund-sr-1-100", ...over,
});
function dbFake({ busy = false } = {}) {
  const calls = [];
  return {
    calls,
    rpc: async (name, args) => {
      calls.push([name, args]);
      // The try's lease: busy while another runs; a retry (renew) after one gets a new key.
      if (name === "staff_refund_attempt") return busy ? { ...claim(), busy: true } : { ...claim(), key: args.renew ? "staff-refund-sr-1-200" : "staff-refund-sr-1-100" };
      return { data: null, error: null };
    },
  };
}
// _stripe.js's rpc reads { data, error } from db.rpc.
const wrap = (fake) => ({ calls: fake.calls, rpc: async (name, args) => ({ data: await fake.rpc(name, args), error: null }) });
function stripeFake({ listed = [], received = 1000, create }) {
  const created = [];
  return {
    created,
    refunds: {
      list: async () => ({ data: listed }),
      create: async (params, options) => { created.push([params, options]); return create ? create(params, options) : { id: "re_new", status: "succeeded" }; },
    },
    paymentIntents: { retrieve: async () => ({ amount_received: received }) },
  };
}
const names = (db) => db.calls.map(([name]) => name);

// 1. A fresh claim: created once with the claim's key, then recorded.
{
  const db = wrap(dbFake());
  const stripe = stripeFake({});
  const out = await makeStaffRefund({ stripe, db, claim: claim() });
  assert.equal(out.status, "refunded");
  assert.equal(stripe.created.length, 1);
  assert.equal(stripe.created[0][1].idempotencyKey, "staff-refund-sr-1-100");
  assert.equal(stripe.created[0][0].metadata.staff_refund_id, "sr-1");
  assert.deepEqual(names(db), ["staff_refund_attempt", "record_staff_refund"]);
}
// 2. Check again: a refund already made for this claim is found by its id, never made again.
{
  const db = wrap(dbFake());
  const stripe = stripeFake({ listed: [{ id: "re_old", status: "succeeded", amount: 1000, metadata: { staff_refund_id: "sr-1" } }] });
  const out = await makeStaffRefund({ stripe, db, claim: claim(), renew: true });
  assert.equal(out.status, "refunded");
  assert.equal(stripe.created.length, 0, "found by metadata: not made twice");
  assert.deepEqual(names(db), ["record_staff_refund"]);
  assert.equal(db.calls[0][1].stripe_refund, "re_old");
}
// 3. Check again with nothing made: a new key, so Stripe can't replay a stored 500.
{
  const db = wrap(dbFake());
  const stripe = stripeFake({});
  await makeStaffRefund({ stripe, db, claim: claim(), renew: true });
  assert.deepEqual(names(db), ["staff_refund_attempt", "record_staff_refund"]);
  assert.equal(stripe.created[0][1].idempotencyKey, "staff-refund-sr-1-200");
}
// 4. An idempotency error (another try with the same key still running) is an unknown outcome: the claim stays.
{
  const db = wrap(dbFake());
  const failure = Object.assign(new Error("Keys for idempotent requests can only be used once"), { type: "StripeIdempotencyError" });
  const stripe = stripeFake({ create: () => { throw failure; } });
  const out = await makeStaffRefund({ stripe, db, claim: claim() });
  assert.deepEqual(out, { retry: true });
  assert.deepEqual(names(db), ["staff_refund_attempt"], "nothing recorded as failed");
}
// 5. Stripe can't be reached: the same.
{
  const db = wrap(dbFake());
  const failure = Object.assign(new Error("connection"), { type: "StripeConnectionError" });
  const out = await makeStaffRefund({ stripe: stripeFake({ create: () => { throw failure; } }), db, claim: claim() });
  assert.deepEqual(out, { retry: true });
  assert.deepEqual(names(db), ["staff_refund_attempt"]);
}
// 6. Refused: given back, said in our words.
{
  const db = wrap(dbFake());
  const failure = Object.assign(new Error("sk_test_secret leaked words"), { type: "StripeInvalidRequestError", code: "insufficient_funds" });
  const out = await makeStaffRefund({ stripe: stripeFake({ create: () => { throw failure; } }), db, claim: claim() });
  assert.equal(out.failed, "TSC's Stripe balance is too low. Add funds in Stripe, then try again.");
  assert.deepEqual(names(db), ["staff_refund_attempt", "record_staff_refund_failed"]);
  assert.ok(!JSON.stringify(db.calls).includes("sk_test"), "never Stripe's message");
}
// 6b. Another try's lease is still running: nothing is sent, the claim stays.
{
  const db = wrap(dbFake({ busy: true }));
  const stripe = stripeFake({});
  const out = await makeStaffRefund({ stripe, db, claim: claim(), renew: true });
  assert.deepEqual(out, { retry: true });
  assert.equal(stripe.created.length, 0, "no second try while the first may still run at Stripe");
}
// 7. More than Stripe still holds: refused before any create.
{
  const db = wrap(dbFake());
  const stripe = stripeFake({ received: 1500, listed: [{ id: "re_x", status: "succeeded", amount: 800, metadata: {} }] });
  const out = await makeStaffRefund({ stripe, db, claim: claim() });
  assert.deepEqual(out, { refused: "staff_refund_over", detail: "$7.00" });
  assert.equal(stripe.created.length, 0);
}
// 8. A claim already made or failed is never sent to Stripe again.
{
  const stripe = stripeFake({});
  assert.equal((await makeStaffRefund({ stripe, db: wrap(dbFake()), claim: claim({ status: "made" }) })).status, "refunded");
  assert.ok((await makeStaffRefund({ stripe, db: wrap(dbFake()), claim: claim({ status: "failed", failure: "x" }) })).failed);
  assert.equal(stripe.created.length, 0);
}
assert.equal(staffRefundFailure({ code: "charge_disputed" }), "The bank is deciding this payment.");
assert.equal(staffRefundFailure({ refundStatus: "failed", refundFailureReason: "expired_or_canceled_card" }),
  "Stripe refused the refund: the card was closed. Nothing was refunded, and the factory's balance is unchanged.");
assert.equal(staffRefundFailure({ refundStatus: "failed" }), "Stripe refused the refund. Nothing was refunded, and the factory's balance is unchanged.");
console.log("staff refunds: made once, found again by its id, a new key on a retry, an unknown outcome kept, refusals in our words");
