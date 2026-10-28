import test from "node:test";
import assert from "node:assert/strict";
import { holdPayouts, payoutSession, withdrawBalance } from "../api/_stripe-payouts.js";

const request = { amount: 100, currency: "usd", requestId: "b1f9fd8c-76bd-43a7-ad48-502ebed382b3" };
test("holding earnings disables automatic payouts without making a withdrawal", async () => {
  const calls = [];
  await holdPayouts({ accounts: { update: async (...args) => calls.push(args) } }, "acct_factory");
  assert.deepEqual(calls, [["acct_factory", { settings: { payouts: { schedule: { interval: "manual" } } } }]]);
});
test("withdrawal uses the owner's connected account and a stable retry key", async () => {
  const calls = [];
  const stripe = {
    accounts: { update: async () => calls.push("hold") },
    payouts: { create: async (...args) => { calls.push(args); return { id: "po_test" }; } },
  };
  assert.equal((await withdrawBalance(stripe, "acct_factory", request)).id, "po_test");
  await withdrawBalance(stripe, "acct_factory", request);
  assert.equal(calls[0], "hold");
  assert.deepEqual(calls[1], [{ amount: 100, currency: "usd" }, {
    stripeAccount: "acct_factory", idempotencyKey: `withdraw-acct_factory-${request.requestId}`,
  }]);
  assert.deepEqual(calls[1], calls[3]);
});
test("invalid withdrawals and failure to disable autopayouts never move money", async () => {
  for (const invalid of [{ amount: 0 }, { amount: -1 }, { amount: 1.5 }, { currency: "USD" }, { requestId: "" }]) {
    await assert.rejects(withdrawBalance({}, "acct_factory", { ...request, ...invalid }), /valid available balance/);
  }
  await assert.rejects(withdrawBalance({ accounts: { update: async () => { throw Error("Stripe unavailable"); } } }, "acct_factory", request), /Stripe unavailable/);
});
test("the embedded payout session holds earnings and lets the factory add its own bank account", async () => {
  const calls = [];
  const stripe = {
    accounts: { update: async (...args) => calls.push(["hold", ...args]) },
    accountSessions: { create: async (...args) => { calls.push(["session", ...args]); return { client_secret: "acct_session_secret" }; } },
  };
  assert.equal(await payoutSession(stripe, "acct_factory"), "acct_session_secret");
  assert.equal(calls[0][0], "hold");
  const payoutForm = { enabled: true, features: { external_account_collection: true } };
  assert.deepEqual(calls[1], ["session", {
    account: "acct_factory",
    components: { account_onboarding: payoutForm, account_management: payoutForm },
  }]);
  await assert.rejects(payoutSession({ accounts: { update: async () => { throw Error("Stripe unavailable"); } } }, "acct_factory"), /Stripe unavailable/);
});
