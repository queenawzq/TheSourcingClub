/**
 * Pressing once pays once, and every failure is said. Runs the real payout code
 * against a pretend Wise, a pretend PayPal and a pretend database, so it needs no
 * stack and no keys. What the database itself refuses is in
 * supabase/tests/provider_payouts_test.sql.
 *
 * The evasions, written before the code: double press; press, timeout, press;
 * funding again after a timeout; a certain "no" replayed by the next press;
 * a live account away from production; a key or the bank number in a response
 * or a log; a key reaching the browser's code.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { paypalFrom, PAYPAL_UNCLAIMED } from "../api/_paypal.js";
import { cancelAttempt, checkWords, FUND_IN_WISE, paypalPay, syncAttempts, wisePay, wisePreview } from "../api/_provider-payouts.js";
import { PayoutFailure, withoutSecrets } from "../api/_payout-provider.js";
import { wiseFrom, WISE_STATES } from "../api/_wise.js";
import { ensureWiseRecipient, recipientBody } from "../api/_wise-recipient.js";

const NUMBER = "0000000000001234";
const WISE_ENV = { WISE_API_BASE: "https://api.wise-sandbox.com", WISE_API_TOKEN: "wise-secret-token", WISE_PROFILE_ID: "7", WISE_PAYOUT_CURRENCY: "CNY" };
const PAYPAL_ENV = { PAYPAL_API_BASE: "https://api-m.sandbox.paypal.com", PAYPAL_CLIENT_ID: "paypal-id", PAYPAL_CLIENT_SECRET: "paypal-secret" };

const json = (status, body, headers = {}) => ({ status, headers: new Headers(headers), text: async () => JSON.stringify(body ?? null) });

/** A pretend Wise: one transfer per key, one payment per transfer, as the sandbox behaves. */
function fakeWise({ fund = "ok", balance = 1000000, failNext = [] } = {}) {
  const state = { transfers: new Map(), byId: new Map(), funded: 0, recipients: [], calls: [] };
  const fetchImpl = async (url, options) => {
    const path = url.replace(WISE_ENV.WISE_API_BASE, "");
    const name = `${options.method} ${path.replace(/\d{3,}/g, "N")}`;
    state.calls.push(name);
    const failing = failNext.findIndex((f) => name.includes(f.match));
    if (failing >= 0) {
      const [f] = failNext.splice(failing, 1);
      if (f.before === "throw") { const e = new Error("aborted"); e.name = "AbortError"; throw e; }
      if (f.status) return json(f.status, f.body ?? {});
      // The provider did it, and the answer was lost.
      await respond(path, options);
      const e = new Error("aborted"); e.name = "AbortError"; throw e;
    }
    return respond(path, options);
  };
  async function respond(path, options) {
    const body = options.body ? JSON.parse(options.body) : null;
    if (path.startsWith("/v4/profiles")) return json(200, [{ currency: "USD", amount: { value: balance } }]);
    if (path === "/v1/accounts") { state.recipients.push(body); return json(200, { id: 900 + state.recipients.length }); }
    if (path.includes("/quotes")) return json(200, { id: `q${state.calls.length}`, rate: 6.6, paymentOptions: [{ payIn: "BALANCE", disabled: false, fee: { total: 14.74 }, targetAmount: body.sourceAmount <= 14.74 ? 0 : (body.sourceAmount - 14.74) * 6.6 }] });
    if (path === "/v1/transfers") {
      let t = state.transfers.get(body.customerTransactionId);
      if (!t) { t = { id: 5000 + state.transfers.size, status: "incoming_payment_waiting", targetValue: 66 }; state.transfers.set(body.customerTransactionId, t); state.byId.set(String(t.id), t); }
      return json(200, t);
    }
    const pay = path.match(/transfers\/(\d+)\/payments/);
    if (pay) {
      if (fund === "refused") return json(403, { error: "forbidden" }, { "x-2fa-approval": "x", "x-2fa-approval-result": "REJECTED" });
      if (fund === "short") return json(200, { status: "REJECTED", errorCode: "balance.insufficient" });
      const t = state.byId.get(pay[1]);
      if (t.status !== "incoming_payment_waiting") return json(409, { errors: [{ code: "already" }] });
      state.funded += 1; t.status = "processing";
      return json(200, { status: "COMPLETED" });
    }
    const cancel = path.match(/transfers\/(\d+)\/cancel/);
    if (cancel) { const t = state.byId.get(cancel[1]); t.status = "cancelled"; return json(200, t); }
    const read = path.match(/transfers\/(\d+)$/);
    if (read) return json(200, state.byId.get(read[1]));
    return json(404, {});
  }
  return { state, fetchImpl };
}

/** A pretend PayPal: one batch per sender_batch_id; a repeat says "already exists", with a link. */
function fakePaypal({ item = "SUCCESS", refuse = null, loseAnswer = false } = {}) {
  const state = { batches: new Map(), paid: 0, cancelled: 0 };
  let lose = loseAnswer;
  const fetchImpl = async (url, options) => {
    const path = url.replace(PAYPAL_ENV.PAYPAL_API_BASE, "");
    if (path === "/v1/oauth2/token") return json(200, { access_token: "t" });
    if (path === "/v1/payments/payouts") {
      if (refuse) return json(refuse.status, refuse.body);
      const body = JSON.parse(options.body);
      const key = body.sender_batch_header.sender_batch_id;
      if (state.batches.has(key)) {
        return json(400, { name: "USER_BUSINESS_ERROR", details: [{ field: "SENDER_BATCH_ID", issue: "exists", link: [{ href: `https://x/v1/payments/payouts/${state.batches.get(key)}` }] }] });
      }
      const id = `B${state.batches.size + 1}`;
      state.batches.set(key, id);
      state.paid += 1;
      if (lose) { lose = false; const e = new Error("aborted"); e.name = "AbortError"; throw e; }
      return json(201, { batch_header: { payout_batch_id: id, batch_status: "PENDING" } });
    }
    if (path.endsWith("/cancel")) { state.cancelled += 1; return json(200, { transaction_status: "RETURNED" }); }
    if (path.startsWith("/v1/payments/payouts/")) return json(200, { batch_header: { batch_status: "SUCCESS" }, items: [{ transaction_status: item, payout_item_id: "I1" }] });
    return json(404, {});
  };
  return { state, fetchImpl };
}

/** A pretend database that claims as the real one does: one live attempt, one lease, one key. */
function fakeDb({ recipient = null } = {}) {
  const db = {
    payout: null, finished: [], told: [], reads: 0, recipientSet: 0, leased: false,
    claim(which) {
      if (this.leased) return { error: { hint: "payout_in_progress" } };
      if (this.payout?.status === "paid") return { error: { hint: "payout_already_released" } };
      if (!this.payout || ["failed", "cancelled"].includes(this.payout.status)) {
        this.payout = { id: `p${this.finished.length + 1}`, key: `key-${this.finished.length + 1}`, status: "processing", provider: which, provider_ref: null, stage: "claimed" };
      }
      this.leased = true;
      return {
        data: {
          payout_id: this.payout.id, key: this.payout.key, stage: this.payout.stage, provider_ref: this.payout.provider_ref,
          amount_cents: db.amount ?? 100000, currency: "USD", order_number: "TSC-1", account_id: "a1", paypal_email: "fake@example.com",
          wise_recipient_id: recipient,
        },
      };
    },
  };
  db.rpc = async (name, args) => {
    if (name === "record_provider_attempt") {
      if (args.new_ref) db.payout.provider_ref = args.new_ref;
      if (args.new_stage) db.payout.stage = args.new_stage;
      if (args.sentence !== undefined) db.payout.sentence = args.sentence;
      if (args.tell_factory) db.told.push(args.tell_factory);
      if (args.received != null && !args.keep_lease) db.lastReceived = args.received;
      if (!args.keep_lease) db.leased = false;
      return {};
    }
    if (name === "finish_provider_payout") {
      db.payout.status = args.outcome;
      db.payout.sentence = args.sentence;
      db.finished.push(args);
      if (args.tell_factory) db.told.push(args.tell_factory);
      db.leased = false;
      return {};
    }
    if (name === "set_wise_recipient") { db.recipientSet += 1; recipient = args.recipient_id; return { data: true }; }
    throw new Error(`unexpected ${name}`);
  };
  db.from = () => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: db.payout }) }) }),
  });
  db.caller = {
    rpc: async (name, args) => {
      if (name === "claim_provider_payout") return db.claim(args.which);
      if (name === "lease_provider_payout") {
        if (db.leased) return { error: { hint: "payout_in_progress" } };
        db.leased = true;
        return { data: { payout_id: db.payout.id, provider: db.payout.provider, stage: db.payout.stage, provider_ref: db.payout.provider_ref } };
      }
      if (name === "payout_wise_recipient") {
        db.reads += 1;
        return { data: [{ recipient_type: "chinese_local_business", currency: "CNY", number_key: "accountNumber", account_number: NUMBER, details: { accountHolderName: "FAKE CO LTD", swiftCode: "BKCHCNBJ", "address.city": "Ningbo", "address.country": "CN" }, changed_at: "t" }] };
      }
      throw new Error(`unexpected ${name}`);
    },
  };
  return db;
}

const row = { payout_account_id: "a1", wise_recipient_id: null, currency: "USD", wise_currency: "CNY", amount_cents: 100000 };
const pay = (wise, db, extra = {}) => wisePay({ wise, caller: db.caller, db, row, paymentId: "x", changedAt: "t", cnyConfirmed: true, ...extra });

// --- Wise ---------------------------------------------------------------------
{
  // The ordinary press: funded, on its way, paid only when Wise says it went.
  const fake = fakeWise(); const db = fakeDb();
  const wise = wiseFrom(WISE_ENV, fake.fetchImpl);
  const answer = await pay(wise, db);
  assert.equal(fake.state.funded, 1, "one press funds once");
  assert.equal(answer.done, "sent", "funded is not paid");
  assert.equal(db.payout.status, "processing", "the payment stays owed until the money went");
  assert.equal(fake.state.recipients[0].details.accountNumber, NUMBER, "the number reaches Wise");
  assert.equal(fake.state.recipients[0].details.address.city, "Ningbo", "dotted keys are unflattened");
  assert.equal(fake.state.recipients[0].accountHolderName, "FAKE CO LTD", "the holder goes on top");
  assert.equal(fake.state.recipients[0].details.isContractDenotedInCny, true, "staff's statement goes with it");
  assert(!JSON.stringify(answer).includes(NUMBER), "the number is not in the answer");

  // Pressed again while the first is running: refused by the claim.
  const fake2 = fakeWise(); const db2 = fakeDb();
  const second = wiseFrom(WISE_ENV, fake2.fetchImpl);
  db2.leased = true;
  await assert.rejects(pay(second, db2), /already being paid/);
  assert.equal(fake2.state.calls.length, 0, "the second press reaches no provider");
}
{
  // Press, the transfer's answer is lost, press: one transfer, funded once.
  const fake = fakeWise({ failNext: [{ match: "POST /v1/transfers" }] }); const db = fakeDb();
  const wise = wiseFrom(WISE_ENV, fake.fetchImpl);
  await assert.rejects(pay(wise, db), (f) => f.unsure && /can't pay twice/.test(f.message));
  assert.equal(db.payout.status, "processing", "unsure keeps the attempt and its key");
  assert.equal(db.payout.key, "key-1");
  await pay(wise, db);
  assert.equal(fake.state.transfers.size, 1, "same key, same transfer");
  assert.equal(fake.state.funded, 1, "funded once");
}
{
  // Press, funding's answer is lost, press: the transfer has moved, so no second payment.
  const fake = fakeWise({ failNext: [{ match: "/payments" }] }); const db = fakeDb();
  const wise = wiseFrom(WISE_ENV, fake.fetchImpl);
  await assert.rejects(pay(wise, db), (f) => f.unsure);
  assert.equal(fake.state.funded, 1, "it went, and we did not hear");
  const answer = await pay(wise, db);
  assert.equal(fake.state.funded, 1, "funding is not sent again");
  assert.equal(answer.done, "sent");
}
{
  // Wise refuses funding by token: said in words, the transfer stands, same code everywhere.
  const fake = fakeWise({ fund: "refused" }); const db = fakeDb();
  const wise = wiseFrom(WISE_ENV, fake.fetchImpl);
  const answer = await pay(wise, db);
  assert.equal(answer.sentence, FUND_IN_WISE);
  assert.match(answer.transferUrl, /^https:\/\/wise-sandbox\.com\/.*5000$/, "a link to the transfer, on the app's address");
  assert.equal(db.payout.stage, "awaiting_funding");
  assert.equal(db.payout.status, "processing");
  // Funded in Wise by a person: the next read sees it.
  fake.state.byId.get("5000").status = "outgoing_payment_sent";
  fake.state.byId.get("5000").targetValue = 66;
  const applied = await wise.status("5000");
  assert.equal(applied.state, "paid");
}
{
  // Short balance before anything is created: said, with the amount; a new key next time.
  const fake = fakeWise({ balance: 400 }); const db = fakeDb();
  const wise = wiseFrom(WISE_ENV, fake.fetchImpl);
  const answer = await pay(wise, db);
  assert.equal(answer.done, "short_balance");
  assert.match(answer.sentence, /short by \$600\.00/);
  assert.equal(fake.state.transfers.size, 0, "no transfer made");
  assert.equal(db.payout.status, "cancelled", "ended before Wise, so the factory sees nothing and the next press is a new attempt");
  // Short at the preview: said with the amount, before Wise can refuse the quote.
  const fake3 = fakeWise({ balance: 400 }); const db3 = fakeDb();
  const seen = await wisePreview({ wise: wiseFrom(WISE_ENV, fake3.fetchImpl), caller: db3.caller, db: db3, row, cnyConfirmed: true });
  assert.equal(seen.shortByCents, 60000);
  assert.equal(db3.reads, 0, "the number isn't read for a payment that can't go");
  // Short when funding: the transfer stands and can be funded again.
  const fake2 = fakeWise({ fund: "short" }); const db2 = fakeDb();
  const answer2 = await pay(wiseFrom(WISE_ENV, fake2.fetchImpl), db2);
  assert.equal(answer2.done, "short_balance");
  assert.equal(db2.payout.stage, "awaiting_funding");
  assert.match(db2.payout.sentence, /too low/);
}
{
  // A fee bigger than the payment: nothing is sent.
  const fake = fakeWise(); const db = fakeDb(); db.amount = 1000;
  const answer = await pay(wiseFrom(WISE_ENV, fake.fetchImpl), db);
  assert.equal(answer.done, "nothing_left");
  assert.equal(fake.state.transfers.size, 0);
}
{
  // A certain "no" isn't replayed: the next press has a new key.
  const fake = fakeWise({ failNext: [{ match: "POST /v1/transfers", status: 422, body: { errors: [{ code: "x", message: "Bad reference." }] } }] }); const db = fakeDb({ recipient: "900" });
  const wise = wiseFrom(WISE_ENV, fake.fetchImpl);
  await assert.rejects(pay(wise, db), /Wise refused this: Bad reference/);
  assert.equal(db.payout.status, "cancelled");
  await pay(wise, db);
  assert.equal(db.payout.key, "key-2", "new attempt, new key");
  assert.equal(fake.state.funded, 1);
}
{
  // A recipient refused is the factory's to fix, and it says which field.
  const fake = fakeWise({ failNext: [{ match: "POST /v1/accounts", status: 422, body: { errors: [{ code: "NOT_VALID", path: "swiftCode", arguments: ["swiftCode", "BADSWIFT"], message: "Please enter a valid SWIFT code." }, { code: "NOT_VALID", path: "not a key 6200000000000000" }] } }] }); const db = fakeDb();
  const wise = wiseFrom(WISE_ENV, fake.fetchImpl);
  // The field's key travels to the factory's row; the value typed and anything not shaped like a key don't.
  await assert.rejects(wisePreview({ wise, caller: db.caller, db, row, cnyConfirmed: true }), (f) => f.kind === "details_rejected" && /valid SWIFT/.test(f.message) && f.fields.length === 1 && f.fields[0] === "swiftCode");
}
{
  // A recipient already made: the number isn't read again.
  const fake = fakeWise(); const db = fakeDb({ recipient: "900" });
  await pay(wiseFrom(WISE_ENV, fake.fetchImpl), db);
  assert.equal(db.reads, 0, "the vault isn't touched");
  assert.equal(fake.state.recipients.length, 0);
}
{
  // Not confirmed: the statement isn't made on anyone's behalf.
  const body = recipientBody({ recipient_type: "t", currency: "CNY", number_key: "accountNumber", account_number: NUMBER, details: {} }, { cnyConfirmed: false });
  assert.equal("isContractDenotedInCny" in body.details, false);
  const usd = recipientBody({ recipient_type: "t", currency: "USD", number_key: "accountNumber", account_number: NUMBER, details: {} }, { cnyConfirmed: true });
  assert.equal("isContractDenotedInCny" in usd.details, false, "only for CNY");
}
{
  // Cancel: Wise cancels, the attempt ends, the next press has a new key.
  const fake = fakeWise({ fund: "refused" }); const db = fakeDb();
  const wise = wiseFrom(WISE_ENV, fake.fetchImpl);
  await pay(wise, db);
  await cancelAttempt({ client: wise, caller: db.caller, db, paymentId: "x" });
  assert.equal(fake.state.byId.get("5000").status, "cancelled");
  assert.equal(db.payout.status, "cancelled");
}
{
  // Wise holds a transfer with an open issue: staff are told; the factory isn't asked to do anything.
  const fake = fakeWise(); const db = fakeDb();
  const wise = wiseFrom(WISE_ENV, fake.fetchImpl);
  await pay(wise, db);
  fake.state.byId.get("5000").hasActiveIssues = true;
  await syncAttempts({ client: wise, db: { ...db, from: () => ({ select: () => ({ eq: () => ({ not: () => ({ or: () => ({ limit: async () => ({ data: [{ id: db.payout.id, status: "processing", provider_ref: "5000" }] }) }) }) }) }) }) } });
  assert.match(db.payout.sentence, /stopped this transfer/);
  assert.equal(db.lastReceived, undefined, "the quote staff confirmed stands until the money arrives");
  assert.deepEqual(db.told, []);
}
assert.equal(WISE_STATES.outgoing_payment_sent, "paid");
assert.equal(WISE_STATES.incoming_payment_waiting, "awaiting_funding");
for (const raw of ["bounced_back", "funds_refunded", "charged_back"]) assert.equal(WISE_STATES[raw], "failed", raw);

// --- PayPal -------------------------------------------------------------------
const paypalPress = (paypal, db) => paypalPay({ paypal, caller: db.caller, db, paymentId: "x", changedAt: "t" });
{
  const fake = fakePaypal(); const db = fakeDb();
  const answer = await paypalPress(paypalFrom(PAYPAL_ENV, fake.fetchImpl), db);
  assert.equal(answer.done, "paid", "SUCCESS on the item is paid");
  assert.equal(db.payout.status, "paid");
}
// The factory is told which detail, in our words, never Wise's.
assert.equal(checkWords("Wise refused this: Please enter a valid SWIFT code."), "Check your SWIFT code");
assert.equal(checkWords("Wise refused this: Account number is not valid."), "Check your account number");
assert.equal(checkWords("Wise refused this: Something else entirely."), "Check your bank details");
{
  // The batch says SUCCESS and the item UNCLAIMED: not paid, said, factory told once.
  const fake = fakePaypal({ item: "UNCLAIMED" }); const db = fakeDb();
  const answer = await paypalPress(paypalFrom(PAYPAL_ENV, fake.fetchImpl), db);
  assert.equal(answer.done, "sent");
  assert.equal(answer.sentence, PAYPAL_UNCLAIMED);
  assert.equal(db.payout.status, "processing");
  assert.deepEqual(db.told, ["Check your PayPal address"]);
  // and it can be taken back.
  await cancelAttempt({ client: paypalFrom(PAYPAL_ENV, fake.fetchImpl), caller: db.caller, db, paymentId: "x" });
  assert.equal(fake.state.cancelled, 1);
}
{
  // Press, the answer is lost, press: "already exists" leads to the first batch.
  const fake = fakePaypal({ loseAnswer: true }); const db = fakeDb();
  const paypal = paypalFrom(PAYPAL_ENV, fake.fetchImpl);
  await assert.rejects(paypalPress(paypal, db), (f) => f.unsure);
  assert.equal(db.payout.status, "processing");
  const answer = await paypalPress(paypal, db);
  assert.equal(fake.state.paid, 1, "paid once");
  assert.equal(answer.done, "paid");
  assert.equal(db.payout.provider_ref, "B1", "found the first batch");
}
{
  const fake = fakePaypal({ refuse: { status: 422, body: { name: "INSUFFICIENT_FUNDS" } } }); const db = fakeDb();
  await assert.rejects(paypalPress(paypalFrom(PAYPAL_ENV, fake.fetchImpl), db), /balance is too low/);
  assert.equal(db.payout.status, "cancelled", "staff's to fix, and nothing the factory sees");
}
{
  const fake = fakePaypal({ refuse: { status: 400, body: { name: "VALIDATION_ERROR", details: [{ field: "items[0].receiver" }] } } }); const db = fakeDb();
  await assert.rejects(paypalPress(paypalFrom(PAYPAL_ENV, fake.fetchImpl), db), /isn't valid/);
  assert.equal(db.finished[0].failure, "details_rejected");
  assert.deepEqual(db.told, ["Check your PayPal address"]);
}
{
  const fake = fakePaypal({ item: "RETURNED" });
  const status = await paypalFrom(PAYPAL_ENV, fake.fetchImpl).status("B1");
  assert.equal(status.state, "failed");
}

// --- Going live is settings, and only production holds a live account ---------
for (const env of [{}, { VERCEL_ENV: "preview" }, { VERCEL_ENV: "development" }]) {
  assert.throws(() => wiseFrom({ ...WISE_ENV, WISE_API_BASE: "https://api.wise.com", ...env }), /only allowed on the production site/);
  assert.throws(() => paypalFrom({ ...PAYPAL_ENV, PAYPAL_API_BASE: "https://api-m.paypal.com", ...env }), /only allowed on the production site/);
}
assert(wiseFrom({ ...WISE_ENV, WISE_API_BASE: "https://api.wise.com", VERCEL_ENV: "production" }));
assert(paypalFrom({ ...PAYPAL_ENV, PAYPAL_API_BASE: "https://api-m.paypal.com", VERCEL_ENV: "production" }));
assert.equal(wiseFrom({}), null, "not set up is not an error");
assert.equal(paypalFrom({}), null);

// Nothing in the flow branches on which account it is: only the guard reads the base.
const read = (path) => readFileSync(path, "utf8");
for (const path of ["api/_wise.js", "api/_paypal.js", "api/_provider-payouts.js", "api/_wise-recipient.js", "api/wise-payout.js", "api/paypal-payout.js"]) {
  const code = read(path).replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, "");
  assert(!/sandbox|simulation/i.test(code), `${path} has a sandbox path in the flow`);
}

// --- Keys and the number stay on the server --------------------------------------
const scrubbed = withoutSecrets("Bearer abc123 wise-secret-token paypal-secret", { WISE_API_TOKEN: "wise-secret-token", PAYPAL_CLIENT_SECRET: "paypal-secret" });
assert(!/abc123|wise-secret-token|paypal-secret/.test(scrubbed), "no key in a log");
assert(new PayoutFailure("x", "y") instanceof Error);

const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : [path];
});
const KEY_NAMES = /WISE_API_TOKEN|WISE_API_BASE|WISE_PROFILE_ID|PAYPAL_CLIENT_ID|PAYPAL_CLIENT_SECRET|PAYPAL_API_BASE|VITE_WISE|VITE_PAYPAL/;
for (const path of walk("src")) {
  if (/\.(jsx?|mjs)$/.test(path)) assert(!KEY_NAMES.test(read(path)), `${path} names a payout key: they stay on the server`);
}
for (const path of ["vite.config.js"]) assert(!/WISE_|PAYPAL_/.test(read(path)), `${path} must not bake a payout key into the bundle`);

// Only the board's own route takes these calls from the browser.
const routeCode = read("api/_provider-payouts.js");
assert(/is_platform_admin/.test(routeCode), "the route checks staff");
assert(!/account_number/.test(routeCode), "the route never handles the number");
assert(!/account_number/.test(read("api/_wise.js")), "the Wise module doesn't name it either");

console.log("check:provider-payouts ok");
