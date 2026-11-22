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
import { cancelAttempt, checkWords, FUND_IN_WISE, setFundSettleMs, tellFactoryDetails, paypalPay, syncAttempts, wisePay, wisePreview } from "../api/_provider-payouts.js";
import { PayoutFailure, withoutSecrets } from "../api/_payout-provider.js";
import { detailsAtFault, wiseFrom, WISE_STATES } from "../api/_wise.js";
import { settleRelease } from "../api/_stripe.js";
import { ensureWiseRecipient, recipientBody } from "../api/_wise-recipient.js";

const NUMBER = "0000000000001234";
const WISE_ENV = { WISE_API_BASE: "https://api.wise-sandbox.com", WISE_API_TOKEN: "wise-secret-token", WISE_PROFILE_ID: "7", WISE_PAYOUT_CURRENCY: "CNY" };
const PAYPAL_ENV = { PAYPAL_API_BASE: "https://api-m.sandbox.paypal.com", PAYPAL_CLIENT_ID: "paypal-id", PAYPAL_CLIENT_SECRET: "paypal-secret" };

const json = (status, body, headers = {}) => ({ status, headers: new Headers(headers), text: async () => JSON.stringify(body ?? null) });

/** A pretend Wise: one transfer per key, one payment per transfer, as the sandbox behaves. */
function fakeWise({ fund = "ok", balance = 1000000, failNext = [], lag = 0, disabled = null, shave = 0, extra = 0 } = {}) {
  const state = { transfers: new Map(), byId: new Map(), funded: 0, recipients: [], calls: [], quotes: [], lag };
  state.setBalance = (value) => { balance = value; };
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
    if (path.includes("/quotes")) {
      // As the sandbox answers: a fixed target puts the fee on top, and a quote the
      // balance can't cover keeps its figures with the balance route disabled.
      state.quotes.push(body);
      const rate = body.sourceCurrency === body.targetCurrency ? 1 : 6.6;
      const sourceAmount = body.targetAmount != null ? Math.round((body.targetAmount / rate + 14.74) * 100) / 100 : body.sourceAmount + extra;
      const targetAmount = body.targetAmount != null ? body.targetAmount - shave : Math.max(0, (body.sourceAmount - 14.74) * rate);
      const code = disabled ?? (sourceAmount > balance ? "error.payInmethod.disabled" : null);
      return json(200, { id: `q${state.calls.length}`, rate, paymentOptions: [{ payIn: "BALANCE", disabled: Boolean(code), disabledReason: code ? { code, message: "No." } : undefined, fee: { total: 14.74 }, sourceAmount, targetAmount }] });
    }
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
    if (read) {
      const t = state.byId.get(read[1]);
      // Wise's status catching up with a payment it already took.
      if (t.status === "processing" && state.lag > 0) { state.lag -= 1; return json(200, { ...t, status: "incoming_payment_waiting" }); }
      return json(200, t);
    }
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
      state.sent = body.items[0].amount.value;
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
    payout: null, finished: [], told: [], records: [], fees: [], reads: 0, recipientSet: 0, leased: false,
    claim(which) {
      if (this.leased) return { error: { hint: "payout_in_progress" } };
      if (this.payout?.status === "paid") return { error: { hint: "payout_already_released" } };
      const resumed = this.payout?.status === "processing";
      if (!this.payout || ["failed", "cancelled"].includes(this.payout.status)) {
        this.payout = { id: `p${this.finished.length + 1}`, key: `key-${this.finished.length + 1}`, status: "processing", provider: which, provider_ref: null, stage: "claimed" };
      }
      this.leased = true;
      return {
        data: {
          payout_id: this.payout.id, key: this.payout.key, stage: this.payout.stage, provider_ref: this.payout.provider_ref, resumed,
          amount_cents: db.amount ?? 100000, currency: "USD", order_number: "TSC-1", account_id: "a1", paypal_email: "fake@example.com",
          wise_recipient_id: recipient,
        },
      };
    },
  };
  db.rpc = async (name, args) => {
    if (name === "record_provider_attempt") {
      db.records.push(args);
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
    if (name === "record_payout_fee") { db.fees.push(args.fee); return {}; }
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
setFundSettleMs(0);
for (const lag of [1, 5]) {
  // Funded, but Wise's status still says waiting (q79 test, Nov 7): not "Fund it in Wise", and no second payment.
  const fake = fakeWise({ lag }); const db = fakeDb();
  const wise = wiseFrom(WISE_ENV, fake.fetchImpl);
  const answer = await pay(wise, db);
  assert.equal(fake.state.funded, 1, "funded once");
  assert.equal(answer.done, "sent", `a funded transfer is sent, however long Wise's status lags (${lag})`);
  assert.notEqual(db.payout.sentence, FUND_IN_WISE, "staff aren't asked to fund what Wise already took");
  assert.equal(db.payout.stage, "sent");
}
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
  // The factory pays the fee: the quote is asked with the amount as the source, so
  // the fee is inside it, TSC pays exactly the amount, and the rest is converted.
  const fake = fakeWise(); const db = fakeDb();
  const wise = wiseFrom(WISE_ENV, fake.fetchImpl);
  const seen = await wisePreview({ wise, caller: db.caller, db, row, cnyConfirmed: true });
  assert.deepEqual([seen.feeCents, seen.totalCents, seen.receivesCents, seen.arrivesCents, seen.arrivesCurrency, seen.shortByCents, seen.refused], [1474, 100000, 98526, 650272, "CNY", 0, null], "staff see the fee, TSC paying exactly the amount, and what the factory receives");
  assert.equal(fake.state.quotes.at(-1).sourceAmount, 1000, "the amount is the source");
  assert.equal(fake.state.quotes.at(-1).targetAmount, undefined, "what arrives is Wise's to work out, fee taken");
  const answer = await pay(wise, db);
  assert.equal(answer.done, "sent");
  assert.equal(fake.state.funded, 1);
  assert(db.records.some((r) => r.new_fee === 1474), "the fee is recorded on the attempt");
  assert.deepEqual(db.fees, [1474], "and on the payment, before the transfer: the one figure the row and bell read");
  assert(db.records.some((r) => r.received === 650272 && r.received_in === "CNY"), "and what arrives, the fee taken from it");

  // Same currency: one quote, the amount less the fee.
  const fake2 = fakeWise(); const db2 = fakeDb();
  const usd = await wisePreview({ wise: wiseFrom(WISE_ENV, fake2.fetchImpl), caller: db2.caller, db: db2, row: { ...row, wise_currency: "USD" }, cnyConfirmed: true });
  assert.equal(fake2.state.quotes.length, 1, "one quote");
  assert.deepEqual([usd.arrivesCents, usd.arrivesCurrency, usd.totalCents], [98526, "USD", 100000]);

  // A payment no bigger than its fee is refused with a sentence, nothing sent.
  const fake3 = fakeWise(); const db3 = fakeDb(); db3.amount = 1000;
  await assert.rejects(pay(wiseFrom(WISE_ENV, fake3.fetchImpl), db3), /too small to send\. The fee is US\$14\.74/);
  assert.equal(fake3.state.transfers.size, 0, "no transfer made");
  assert.equal(db3.payout.status, "cancelled", "the attempt ends: nothing was sent");
  assert.deepEqual(db3.fees, [], "no fee recorded for a payment that did not go");
  const tinyPreview = await wisePreview({ wise: wiseFrom(WISE_ENV, fakeWise().fetchImpl), caller: db3.caller, db: db3, row: { ...row, amount_cents: 1000 }, cnyConfirmed: true });
  assert.match(tinyPreview.refused, /too small/, "staff see the refusal before pressing");
}
{
  // The balance covers the amount: the fee is inside it, so nothing is short.
  const fake = fakeWise({ balance: 1000 }); const db = fakeDb();
  const wise = wiseFrom(WISE_ENV, fake.fetchImpl);
  const seen = await wisePreview({ wise, caller: db.caller, db, row, cnyConfirmed: true });
  assert.deepEqual([seen.shortByCents, seen.feeCents, seen.totalCents], [0, 1474, 100000]);
  const answer = await pay(wise, db);
  assert.equal(answer.done, "sent", "a balance of exactly the amount pays it");
}
{
  // Short on a press after a lost answer: Wise may hold a transfer for this key, so the key stays.
  const fake = fakeWise({ failNext: [{ match: "POST /v3/profiles", before: "throw" }] }); const db = fakeDb();
  const wise = wiseFrom(WISE_ENV, fake.fetchImpl);
  await assert.rejects(pay(wise, db), (f) => f.unsure);
  fake.state.setBalance(995);
  const answer = await pay(wise, db);
  assert.equal(answer.done, "short_balance");
  assert.equal(db.payout.status, "processing", "not ended, or the next press would use a new key");
  assert.equal(db.payout.key, "key-1");
  assert.equal(db.leased, false, "and the next press isn't locked out");
}
for (const [label, options] of [
  ["Wise disables the balance for another reason", { disabled: "error.quote.targetAmount.max" }],
  ["Wise says the balance is too low when it isn't", { disabled: "error.payInmethod.disabled" }],
  ["the quote would take more than the amount from TSC", { extra: 0.01 }],
]) {
  const fake = fakeWise(options); const db = fakeDb();
  await assert.rejects(pay(wiseFrom(WISE_ENV, fake.fetchImpl), db), /can't pay this from TSC's balance/, label);
  assert.equal(fake.state.transfers.size, 0, `${label}: no transfer`);
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
  // Refused at the transfer, about the factory's bank (the sandbox's words, Nov 9).
  const said = "We could not send to this account as we are unable to recognise the bank of the recipient.";
  const fake = fakeWise({ failNext: [{ match: "POST /v1/transfers", status: 422, body: { errors: [{ code: "x", path: "targetAccount", message: said }] } }] }); const db = fakeDb({ recipient: "900" });
  const wise = wiseFrom(WISE_ENV, fake.fetchImpl);
  await assert.rejects(pay(wise, db), (f) => f.kind === "details_rejected" && f.fields.length === 0);
  assert.equal(db.payout.status, "cancelled", "nothing went");
  assert.deepEqual(db.told, [], "staff decide, as at the recipient");
  await tellFactoryDetails({ caller: db.caller, db, paymentId: "x", which: "wise", sentence: `Wise refused this: ${said}`, fields: [] });
  assert.deepEqual(db.told, ["Check your bank details"], "the factory reads our words, never the provider's");
  assert.equal(db.payout.status, "failed");
  assert.equal(db.payout.provider_ref, null, "telling it made no transfer");
  await pay(wise, db);
  assert.equal(fake.state.funded, 1, "paying after the fix pays once");
}
{
  // TSC's problem at the transfer or the quote: the factory hears nothing.
  for (const [match, message] of [["POST /v1/transfers", "Your balance is insufficient to pay this recipient."], ["/quotes", "This quote has expired for the recipient."]]) {
    const fake = fakeWise({ failNext: [{ match, status: 422, body: { errors: [{ code: "x", message }] } }] }); const db = fakeDb({ recipient: "900" });
    await assert.rejects(pay(wiseFrom(WISE_ENV, fake.fetchImpl), db), (f) => f.kind === "refused");
    assert.deepEqual(db.told, []);
  }
  // Wise's trouble says so and can't be told either.
  const fake = fakeWise({ failNext: [{ match: "POST /v1/transfers", status: 503 }] }); const db = fakeDb({ recipient: "900" });
  await assert.rejects(pay(wiseFrom(WISE_ENV, fake.fetchImpl), db), (f) => f.kind === "provider_down" && f.unsure);
  assert.equal(db.payout.status, "processing", "a retry keeps its key");
}
for (const [message, fault] of [
  ["The recipient's IBAN could not be used.", true],
  ["This bank does not accept transfers in this currency.", true],
  ["Recipient not found.", false],
  ["Daily limit reached for this recipient.", false],
  ["Payments to this bank are temporarily unavailable.", false],
  ["Reference contains invalid characters.", false],
  ["Something went wrong.", false],
]) assert.equal(detailsAtFault([{ code: "x", message }]), fault, message);
{
  // Refused while another press's transfer is on record: the attempt stays open, and is nothing to tell.
  const fake = fakeWise({ failNext: [{ match: "POST /v1/transfers", status: 422, body: { errors: [{ code: "x", message: "Unable to recognise the bank of the recipient." }] } }] }); const db = fakeDb({ recipient: "900" });
  db.from = () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { provider_ref: "5000" } }) }) }) });
  await assert.rejects(pay(wiseFrom(WISE_ENV, fake.fetchImpl), db), (f) => f.kind === "refused");
  assert.equal(db.payout.status, "processing");
  // And a stale page can't end it: the next press could then pay again.
  await assert.rejects(tellFactoryDetails({ caller: db.caller, db, paymentId: "x", which: "wise", sentence: "Wise refused this.", fields: [] }), /still open/);
  assert.equal(db.payout.status, "processing");
  assert.deepEqual(db.told, []);
  assert.equal(db.leased, false, "and the lease is given back");
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
{
  // Stripe can no longer be asked and an earlier call started it: its transfer is found however many others the order has.
  const payment = { id: "pay", state: "confirmed", amount_cents: 100, currency: "USD", order_id: "o", stripe_charge_id: "ch", stripe_release_started: true,
    release_requested_at: "t", production_orders: { factory_org_id: "f" } };
  const rpcs = [];
  const db = {
    from(table) { const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: table === "order_payments" ? payment : { stripe_account_id: "a", transfers_active: false } }) }; return q; },
    async rpc(name, args) { rpcs.push([name, args]); return { data: null }; },
  };
  const stripe = { charges: { retrieve: async () => ({ amount_refunded: 0 }) }, transfers: { list: async function* () {
    for (let i = 0; i < 100; i += 1) yield { id: `other${i}`, metadata: { payment_id: "x" } };
    yield { id: "past_the_first_page", metadata: { payment_id: "pay" } };
  } } };
  assert.deepEqual(await settleRelease({ stripe, db, paymentId: "pay" }), { released: true, reason: "past_the_first_page" });
  assert.deepEqual(rpcs, [["record_payment_released", { target_payment: "pay", transfer: "past_the_first_page" }]]);
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
  // The factory pays PayPal's fee: a country we can't read is charged as abroad (2%),
  // so US$1,000.00 sends 980.39 and PayPal's 19.61 on top makes the amount.
  assert.equal(fake.state.sent, "980.39", "PayPal is sent the amount less its fee");
  assert.deepEqual(db.fees, [1961], "the fee is recorded on the payment before PayPal is asked");
}
{
  // A US factory: PayPal's US$0.25.
  const fake = fakePaypal(); const db = fakeDb();
  const from = db.from;
  db.from = (table) => (table === "order_payments"
    ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { production_orders: { factory_org_id: "f" } } }) }) }) }
    : table === "factory_profiles" ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { country_code: "US" } }) }) }) } : from(table));
  await paypalPress(paypalFrom(PAYPAL_ENV, fake.fetchImpl), db);
  assert.equal(fake.state.sent, "999.75");
  assert.deepEqual(db.fees, [25]);
}
{
  // Too small to send: refused with a sentence, PayPal never asked.
  const fake = fakePaypal(); const db = fakeDb(); db.amount = 1;
  await assert.rejects(paypalPress(paypalFrom(PAYPAL_ENV, fake.fetchImpl), db), /too small/);
  assert.equal(fake.state.paid, 0, "nothing sent");
  assert.equal(db.payout.status, "cancelled");
}
// The factory is told which detail, in our words, never Wise's.
assert.equal(checkWords("Wise refused this: Please enter a valid SWIFT code."), "Check your SWIFT code");
assert.equal(checkWords("Wise refused this: Account number is not valid."), "Check your account number");
assert.equal(checkWords("Wise refused this: Something else entirely."), "Check your bank details");
assert.equal(checkWords("Wise refused this: Please specify a BIC with a valid country code."), "Check your SWIFT code", "Wise's real sentence");
assert.equal(checkWords("anything", ["swiftCode"]), "Check your SWIFT code", "the keys Wise named come first");
assert.equal(checkWords("anything", ["accountNumber", "address.city", "address.firstLine"]), "Check your account number and address");
assert.equal(checkWords("anything", ["somethingNew"]), "Check your bank details", "a key we have no word for says the plain sentence");
{
  const db = fakeDb();
  const saved = [];
  db.from = () => ({ update: (row) => ({ eq: async () => { saved.push(row); return { error: null }; } }) });
  await tellFactoryDetails({ caller: db.caller, db, paymentId: "x", which: "wise", sentence: "Wise refused this.", fields: ["swiftCode", "not a key!"] });
  assert.deepEqual(db.told, ["Check your SWIFT code"], "the bell names the field Wise named");
  assert.deepEqual(saved, [{ details_fields: ["swiftCode"] }], "and only a real key is kept");
}
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
  // PayPal may already have paid: cancelling now would let staff pay twice.
  await assert.rejects(cancelAttempt({ client: paypal, caller: db.caller, db, paymentId: "x" }), /Press again first/);
  assert.equal(db.payout.status, "processing", "a blind cancel leaves it where it was");
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

// --- PayPal: a retry after a lost answer never pays twice ----------------------
{
  // A database that hands back a claim, so each failure is seen exactly as written.
  const claimDb = ({ resumed = false, ref = null } = {}) => {
    const db = {
      calls: [],
      from() { const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { provider_ref: null } }) }; return q; },
      async rpc(name, args) {
        db.calls.push([name, args]);
        if (name === "claim_provider_payout") return { data: { payout_id: "payout", key: "same-key", resumed, provider_ref: ref, paypal_email: "a@b.c", amount_cents: 100, currency: "USD", order_number: "T-1" } };
        return { data: null };
      },
    };
    db.caller = db;
    return db;
  };
  const finished = (db) => db.calls.filter(([name]) => name === "finish_provider_payout").map(([, args]) => args.outcome);
  const scripted = (tokenStatus, [status, body]) => paypalFrom(PAYPAL_ENV, async (url) => (url.includes("oauth2")
    ? json(tokenStatus, tokenStatus === 200 ? { access_token: "t" } : {})
    : json(status, body)));

  for (const [label, tokenStatus, answer] of [
    ["token 503", 503, [200, {}]],
    ["token 401", 401, [200, {}]],
    ["not enough funds", 200, [422, { name: "INSUFFICIENT_FUNDS" }]],
    ["a plain refusal", 200, [400, { name: "SOMETHING" }]],
    ["an invalid address", 200, [422, { name: "VALIDATION_ERROR", details: [{ field: "items[0].receiver" }] }]],
  ]) {
    const db = claimDb({ resumed: true });
    await assert.rejects(paypalPress(scripted(tokenStatus, answer), db), (f) => f.unsure === true && !/nothing was sent/i.test(f.message), label);
    assert.deepEqual(finished(db), [], `${label} on a retry after a lost answer ends nothing, or staff could pay it again under a new key`);
  }
  for (const status of [401, 403, 500]) {
    await assert.rejects(scripted(status, [200, {}]).pay({ key: "k", email: "a", amountCents: 1, currency: "USD", reference: "r" }),
      (f) => f.unsure === true && !/nothing was sent/i.test(f.message), `token ${status} is unsure`);
  }
  {
    const db = claimDb();
    await assert.rejects(paypalPress(scripted(200, [422, { name: "INSUFFICIENT_FUNDS" }]), db), /too low/);
    assert.deepEqual(finished(db), ["cancelled"], "a first press PayPal refuses outright still ends, so staff can fix it");
  }
  {
    const db = claimDb();
    await assert.rejects(paypalPress({ pay: async () => { throw new TypeError("no batch_header"); } }, db), TypeError);
    assert.deepEqual(finished(db), [], "an answer we could not read is not a refusal");
  }
  {
    const db = claimDb({ resumed: true, ref: "BATCH" });
    let posted = 0;
    const answer = await paypalPress({
      pay: async () => { posted += 1; return { batchId: "NEW" }; },
      status: async (id) => { assert.equal(id, "BATCH"); return { state: "sent", raw: "PENDING" }; },
    }, db);
    assert.equal(posted, 0, "with a batch id on file PayPal is read, never posted to");
    assert.equal(answer.done, "sent");
  }
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
const { zhNotificationBody: zhNotificationBodyR30 } = await import("../src/shared/notification-zh.mjs");
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

// Why a payout failed, in the factory's words (src/shared/payout-failure-words.mjs):
// the same sentence on the row, the card and the bell, in both languages.
{
  const { PAYOUT_FAILURE_WORDS, UNKNOWN_PAYOUT_FAILURE, payoutFailureSentence } = await import("../src/shared/payout-failure-words.mjs");
  const { PAYOUT_WORDS_ZH, zhPayoutWords, zhNotificationBody, zhNotificationTitle } = await import("../src/shared/notification-zh.mjs");
  const { tellPayoutEvent } = await import("../api/_stripe-payout-events.js");
  const { chosenBankName, wiseBankList } = await import("../src/shared/wise-form-check.mjs");

  assert.equal(payoutFailureSentence("wise", "no_such_code"), UNKNOWN_PAYOUT_FAILURE, "an unknown code gets the plain sentence");
  assert.equal(payoutFailureSentence("paypal", null), UNKNOWN_PAYOUT_FAILURE);
  assert.equal(payoutFailureSentence("wise", "toString"), UNKNOWN_PAYOUT_FAILURE, "never a property of the map itself");
  assert.equal(UNKNOWN_PAYOUT_FAILURE, "The payment did not go through. Check your payout details or contact TSC operations.");
  for (const sentence of [UNKNOWN_PAYOUT_FAILURE, ...Object.values(PAYOUT_FAILURE_WORDS).flatMap(Object.values)]) {
    assert(zhPayoutWords(sentence), `no Chinese for: ${sentence}`);
    assert(zhPayoutWords(sentence.replace(/\.$/, "")), `no Chinese for the row's note: ${sentence}`);
    assert(!/stripe|\bwise\b/i.test(sentence) && !/_|\b[A-Z]{4,}\b/.test(sentence), `a provider's word or code in: ${sentence}`);
  }
  // The database writes the bell from its own copy of the Wise and PayPal map.
  const sql = read("supabase/migrations/20261116500000_payout_failure_words.sql");
  for (const provider of ["wise", "paypal"]) {
    for (const [code, sentence] of Object.entries(PAYOUT_FAILURE_WORDS[provider])) {
      assert(sql.includes(`when '${code}' then '${sentence.replaceAll("'", "''")}'`), `payout_failure_sentence() says something else for ${provider} ${code}`);
    }
  }
  assert(sql.includes(`'${UNKNOWN_PAYOUT_FAILURE}'`), "the database's unknown sentence is the same");
  assert.equal(zhNotificationTitle({ kind: "payout_method_changed", title: "A payment to you did not go through" }), PAYOUT_WORDS_ZH["A payment to you did not go through"]);
  assert.equal(zhNotificationBody({ kind: "payout_method_changed", body: `Your payment of $250.00 did not go through. ${payoutFailureSentence("wise", "bounced_back")}` }),
    "你的一笔 $250.00 款项未成功。你的银行退回了这笔款项。请检查你的银行信息：信息无误后 TSC 会重新付款。");
  assert.equal(zhNotificationTitle({ kind: "funds_released", title: "$1,250.00 added to your balance" }), "$1,250.00 已计入你的余额");

  // Stripe's own withdrawal: the bell when it lands at the bank, and when it fails.
  const inserted = [];
  const fakeDb = {
    from(table) {
      if (table === "stripe_connect_accounts") {
        return { select: () => ({ eq: (_, id) => ({ maybeSingle: async () => ({ data: id === "acct_known" ? { org_id: "org-1" } : null, error: null }) }) }) };
      }
      return { upsert: async (row, options) => { assert.deepEqual(options, { onConflict: "org_id,dedupe_key", ignoreDuplicates: true }); inserted.push(row); return { error: null }; } };
    },
  };
  const payoutEvent = (type, payout, account = "acct_known") => ({ type, account, data: { object: { amount: 123456, currency: "eur", ...payout } } });
  assert.equal(await tellPayoutEvent(fakeDb, payoutEvent("payout.failed", { failure_code: "account_closed" })), true);
  assert.deepEqual(inserted.at(-1), { org_id: "org-1", kind: "payout_method_changed", title: "A withdrawal did not go through",
    body: "Your withdrawal of EUR 1,234.56 did not go through. Your bank account is closed. Add another bank account, then withdraw again. The money is back in your balance." });
  assert(zhNotificationBody(inserted.at(-1)) && zhNotificationTitle(inserted.at(-1)), "the failed withdrawal's bell has its Chinese");
  assert.equal(await tellPayoutEvent(fakeDb, payoutEvent("payout.paid", { amount: 5000, currency: "usd" })), true);
  assert.deepEqual(inserted.at(-1), { org_id: "org-1", kind: "funds_released", title: "$50.00 paid out to your bank", body: "Withdrawn from your balance." });
  assert.equal(zhNotificationTitle(inserted.at(-1)), "$50.00 已付至你的银行账户");
  assert.equal(zhNotificationBody(inserted.at(-1)), "已从你的余额提现。");
  assert.equal(await tellPayoutEvent(fakeDb, payoutEvent("payout.failed", { failure_code: "weird" }, "acct_other")), false, "an account TSC does not know writes nothing");
  assert.equal(inserted.length, 2);
  assert.match(read("api/stripe-webhook.js"), /case "payout\.paid":\s*case "payout\.failed":\s*\{[\s\S]{0,300}?returnFeeOnFailedPayout[\s\S]{0,200}?if \(await tellPayoutEvent/, "the webhook says both, after a failed payout's fee goes back");

  // Hong Kong's Wise form names the bank in its own list: "Bank name" is asked once.
  const hk = [
    { key: "accountHolderName", label: "Full name of the account holder", kind: "text" },
    { key: "bankCode", label: "Bank name", kind: "select", options: [{ value: "004", label: "THE HONGKONG AND SHANGHAI BANKING CORPORATION LIMITED" }] },
  ];
  assert.equal(wiseBankList(hk)?.key, "bankCode");
  assert.equal(chosenBankName(wiseBankList(hk), "004"), "THE HONGKONG AND SHANGHAI BANKING CORPORATION LIMITED", "the saved name is the bank chosen");
  assert.equal(chosenBankName(wiseBankList(hk), undefined), "");
  assert.equal(wiseBankList([{ key: "bankName", label: "Bank name", kind: "text" }]), null, "a typed bank name is not a list");
  assert.equal(wiseBankList([{ key: "branchCode", label: "Branch", kind: "select", options: [] }]), null);
  const steps = read("src/app/order/PayoutSetupSteps.jsx");
  assert.match(steps, /\{bankList \? null : <label>/, "our own Bank name field steps aside for Wise's list");
  assert.match(steps, /bankName: savedBankName/, "and the bank chosen is what is saved");
}

// Fix round 30: a Stripe payout's notices, in an order and words that stay
// true when Stripe says "paid" and then "failed" (G4), and its status kept
// even when Stripe says so before the withdrawal saved its payout id (G6).
{
  const { tellPayoutEvent } = await import("../api/_stripe-payout-events.js");
  const tables = {
    stripe_connect_accounts: [{ stripe_account_id: "acct_known", org_id: "org-1" }],
    notifications: [],
    stripe_withdrawals: [
      { id: "0f0c1d2e-0000-4000-8000-000000000001", stripe_account_id: "acct_known", payout_id: null, payout_status: null },
      { id: "0f0c1d2e-0000-4000-8000-000000000002", stripe_account_id: "acct_other", payout_id: null, payout_status: null },
    ],
  };
  const fieldOf = (row, column) => (column.includes("->>") ? row[column.split("->>")[0]]?.[column.split("->>")[1]] : row[column]);
  const fake = {
    from(table) {
      const filters = [];
      let patch = null;
      let inserting = null;
      const run = () => {
        if (inserting) {
          // An upsert that ignores duplicates: a row with the same company and key is not written again.
          if (inserting.dedupe_key && tables[table].some((row) => row.org_id === inserting.org_id && row.dedupe_key === inserting.dedupe_key)) return { error: null };
          tables[table].push(structuredClone(inserting));
          return { error: null };
        }
        const rows = tables[table].filter((row) => filters.every((f) => f(row)));
        if (patch) rows.forEach((row) => Object.assign(row, structuredClone(patch)));
        return { data: rows, error: null };
      };
      const q = {
        select() { return q; },
        update(fields) { patch = fields; return q; },
        insert(row) { inserting = row; return q; },
        upsert(row) { inserting = row; return q; },
        eq(column, value) { filters.push((row) => fieldOf(row, column) === value); return q; },
        in(column, values) { filters.push((row) => values.includes(fieldOf(row, column))); return q; },
        is(column, value) { filters.push((row) => (row[column] ?? null) === value); return q; },
        maybeSingle: async () => ({ data: run().data[0] ?? null, error: null }),
        then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); },
      };
      return q;
    },
  };
  const event = (type, payout, account = "acct_known") => ({ type, account, data: { object: { amount: 5859, currency: "eur", arrival_date: 1795392000, ...payout } } });
  const ownRow = tables.stripe_withdrawals[0];

  // G6: payout.paid before the withdrawal saved its payout id.
  const early = { id: "po_early", status: "paid", metadata: { stripe_withdrawal_id: ownRow.id } };
  assert.equal(await tellPayoutEvent(fake, event("payout.paid", early)), true);
  assert.equal(ownRow.payout_status, "paid", "matched by the payout's own record of its withdrawal: no longer left pending");
  assert.equal(ownRow.payout_arrives_on, "2026-11-23");
  assert.equal(ownRow.payout_id, null, "its id is still the withdrawal call's to save");
  await tellPayoutEvent(fake, event("payout.paid", { id: "po_stranger", status: "paid", metadata: { stripe_withdrawal_id: tables.stripe_withdrawals[1].id } }));
  assert.equal(tables.stripe_withdrawals[1].payout_status, null, "never another account's withdrawal");

  // G4: "paid out", then failed: the same words as any failed withdrawal.
  assert.equal(await tellPayoutEvent(fake, event("payout.failed", { ...early, status: "failed", failure_code: "no_account" })), true);
  const failed = tables.notifications.at(-1);
  assert.equal(failed.title, "A withdrawal did not go through");
  assert.equal(failed.body, "Your withdrawal of EUR 58.59 did not go through. Your bank has no account with these details. Check the account number, then withdraw again. The money is back in your balance.");
  assert.equal(zhNotificationBodyR30(failed), "你的一笔 EUR 58.59 提现未成功。你的银行没有与这些信息相符的账户。请检查账号，然后重新提现。款项已退回你的余额。");
  // Failed first (Stripe sends both in the same second in test mode), then paid: "paid out" is never said.
  const quick = { id: "po_quick", status: "failed", failure_code: "no_account" };
  assert.equal(await tellPayoutEvent(fake, event("payout.failed", quick)), true);
  assert.match(tables.notifications.at(-1).body, /^Your withdrawal of EUR 58\.59 did not go through\./, "nothing was said before: did not go through");
  const before = tables.notifications.length;
  assert.equal(await tellPayoutEvent(fake, event("payout.paid", { ...quick, status: "paid" })), false, "paid after its failure: not said");
  assert.equal(tables.notifications.length, before);

  // "Withdrawal of $X requested" is dated when it was asked for, so it is listed before its payout's notices.
  const source = read("api/_stripe-withdrawals.js");
  const asked = source.slice(source.indexOf("async function tellWithdrawalAsked"), source.indexOf("async function balanceShortSentence"));
  assert.match(asked, /\.\.\.\(row\.created_at \? \{ created_at: row\.created_at \} : \{\}\)/, "the requested notice keeps the request's time");
}

// Round 32 (DB review #2): per-step payouts follow the withdrawal rules.
{
  const { refuseIfChargeReturned } = await import("../api/_provider-payouts.js");
  const dbFor = (written) => ({
    from: (table) => ({ select: () => ({ eq: () => ({
      eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
      maybeSingle: async () => ({ data: table === "order_payments" ? { stripe_charge_id: "ch_1" } : null, error: null }),
    }) }) }),
    rpc: async (name, args) => { written.push([name, args]); return { data: null, error: null }; },
  });
  // Fix round 34: as Stripe's Charge typings have it, `disputed` and no
  // `dispute`; the dispute is found by charge.
  const stripeWith = (dispute) => () => ({
    charges: { retrieve: async (id) => ({ id, amount_refunded: 0, disputed: true }) },
    disputes: { retrieve: async () => { throw new Error("no dispute id on the charge"); },
      list: async ({ charge }) => ({ data: charge === "ch_1" ? [{ id: "du_1", charge, status: dispute }] : [] }) },
  });
  // Won: Stripe still says `disputed`; the payout goes ahead and the hold is cleared.
  const won = [];
  await refuseIfChargeReturned({ db: dbFor(won), paymentId: "p1", build: stripeWith("won") });
  assert.deepEqual(won, [["record_payment_disputed", { target_payment: "p1", disputed: false }]], "R32: a dispute TSC won pays, and the hold is cleared");
  // Open: refused, and the hold recorded.
  const open = [];
  await assert.rejects(refuseIfChargeReturned({ db: dbFor(open), paymentId: "p1", build: stripeWith("needs_response") }),
    (failure) => failure.kind === "charge_disputed", "R32: an open dispute is refused");
  assert.deepEqual(open, [["record_payment_disputed", { target_payment: "p1", disputed: true }]], "R32: and recorded, as a withdrawal would");
  // R33 (M1): lost: recorded as a loss, and refused, so a resumed attempt never
  // sends the whole step after the brand's bank took money back.
  const lost = [];
  await assert.rejects(refuseIfChargeReturned({ db: dbFor(lost), paymentId: "p1", build: stripeWith("lost") }),
    (failure) => failure.kind === "charge_disputed", "R33: a lost dispute is refused");
  assert.equal(lost[0]?.[0], "record_payment_dispute_lost", "R33: and recorded as lost");
  // The database's refusals are said to staff in words, the amount owed named.
  const refusedWith = (hint, details = null) => paypalPay({ paypal: {}, caller: { rpc: async () => ({ data: null, error: { hint, details } }) }, db: {}, paymentId: "p1", changedAt: "t" });
  await assert.rejects(refusedWith("payout_owes_tsc", "$500.00"),
    (failure) => failure.message === "The factory owes TSC $500.00 (To recover, in Needs checking). Nothing is paid until that is covered.", "R32: owes TSC");
  await assert.rejects(refusedWith("payout_disputed"), (failure) => failure.message === "The brand disputed this payment. It waits until the dispute is settled.");
  await assert.rejects(refusedWith("payout_refunded"), (failure) => failure.message === "Part of this payment was returned to the brand. The factory withdraws the rest from its balance.");
  // R33 (M2): no method to withdraw to: said as it is.
  await assert.rejects(refusedWith("payout_refunded_no_method"), (failure) => failure.message === "Part of this payment was returned to the brand. The factory withdraws the rest once it adds a withdrawal method.");
  await assert.rejects(refusedWith("payout_not_cleared"), (failure) => failure.message === "The brand's payment hasn't cleared yet. Try again once it has.");
}

console.log("check:provider-payouts ok");
