import test from "node:test";
import assert from "node:assert/strict";
import { holdPayouts, payoutSession, withdrawBalance, MANAGED_CONTROLLER } from "../api/_stripe-payouts.js";

const request = { amount: 100, currency: "usd", methodId: "ba_selected", requestId: "b1f9fd8c-76bd-43a7-ad48-502ebed382b3" };
test("holding earnings disables automatic payouts without making a withdrawal", async () => {
  const calls = [];
  await holdPayouts({ accounts: { update: async (...args) => calls.push(args) } }, "acct_factory");
  assert.deepEqual(calls, [["acct_factory", { settings: { payouts: { schedule: { interval: "manual" } } } }]]);
});
test("withdrawal uses the owner's connected account and a stable retry key", async () => {
  const calls = [];
  const stripe = {
    accounts: { update: async () => calls.push("hold"), retrieveExternalAccount: async (account, method) => { assert.equal(account,"acct_factory"); assert.equal(method,"ba_selected"); return {object:"bank_account",currency:"usd"}; } },
    payouts: { create: async (...args) => { calls.push(args); return { id: "po_test" }; } },
  };
  assert.equal((await withdrawBalance(stripe, "acct_factory", request)).id, "po_test");
  await withdrawBalance(stripe, "acct_factory", request);
  assert.equal(calls[0], "hold");
  assert.deepEqual(calls[1], [{ amount: 100, currency: "usd", destination: "ba_selected" }, {
    stripeAccount: "acct_factory", idempotencyKey: `withdraw-acct_factory-${request.requestId}`,
  }]);
  assert.deepEqual(calls[1], calls[3]);
});
test("invalid withdrawals and failure to disable autopayouts never move money", async () => {
  for (const invalid of [{ amount: 0 }, { amount: -1 }, { amount: 1.5 }, { currency: "USD" }, { requestId: "" }]) {
    await assert.rejects(withdrawBalance({}, "acct_factory", { ...request, ...invalid }), /valid available balance/);
  }
  await assert.rejects(withdrawBalance({ accounts: { retrieveExternalAccount: async () => ({object:"bank_account",currency:"usd"}), update: async () => { throw Error("Stripe unavailable"); } } }, "acct_factory", request), /Stripe unavailable/);
});
test("the embedded payout session holds earnings and lets the factory add its own bank account", async () => {
  const calls = [];
  const stripe = {
    accounts: { retrieve: async () => ({ controller: { stripe_dashboard: { type: "express" } } }), update: async (...args) => calls.push(["hold", ...args]) },
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

test("managed embedded forms disable Stripe user authentication", async () => {
  let session;
  await payoutSession({accounts:{update:async()=>{},retrieve:async()=>({controller:MANAGED_CONTROLLER})},accountSessions:{create:async value=>{session=value;return {client_secret:'test'};}}},'acct_managed');
  assert.equal(session.components.account_onboarding.features.disable_stripe_user_authentication,true);
  assert.equal(session.components.account_management.features.disable_stripe_user_authentication,true);
});

test("withdrawal requires an explicit eligible destination and never falls back to default", async () => {
  await assert.rejects(withdrawBalance({}, "acct_factory", { ...request, methodId: undefined }), /Choose a linked bank/);
  await assert.rejects(withdrawBalance({}, "acct_factory", { ...request, methodId: "paypal-email" }), /Choose a linked bank/);
  for (const method of [{object:"card",currency:"usd"},{object:"bank_account",currency:"eur"},{object:"bank_account",currency:"usd",status:"errored"},{object:"bank_account",currency:"usd",available_payout_methods:["instant"]}]) {
    await assert.rejects(withdrawBalance({accounts:{retrieveExternalAccount: async () => method}},"acct_factory",request), /available bank account/);
  }
  await assert.rejects(withdrawBalance({accounts:{retrieveExternalAccount: async () => {throw Error("not owned by this account");}}},"acct_factory",request), /not owned/);
});
