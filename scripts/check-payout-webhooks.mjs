/**
 * A Wise or PayPal payout turns Paid with nobody on the staff board. Runs the
 * real webhook routes and the sweep against a pretend Wise, PayPal and
 * database, so it needs no stack and no keys. What the database refuses is in
 * supabase/tests/provider_payouts_test.sql.
 *
 * The evasions, written before the code: an unsigned or re-signed body; a
 * signature over other bytes; a test event treated as a payout; the same
 * delivery twice; an event for another site's transfer failing forever; a
 * failed read-back swallowed; PayPal's event re-serialised before its check;
 * a lost press answer (no ref kept) never found; the live key used on the
 * sandbox; the event's own status written instead of the provider's answer.
 */
import assert from "node:assert/strict";
import { createPublicKey, createSign, generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { WISE_PUBLIC_KEYS, paypalRef, wisePublicKey, wiseRef, wiseSignatureOk } from "../api/_payout-webhooks.js";
import { paypalFrom } from "../api/_paypal.js";
import { wiseFrom } from "../api/_wise.js";
import wiseWebhook from "../api/wise-webhook.js";
import paypalWebhook from "../api/paypal-webhook.js";
import { sweepProviderPayouts } from "../api/payout-sync.js";
import { tellExternalAccountEvent } from "../api/_stripe-payouts.js";

const json = (status, body) => ({ status, headers: new Headers(), text: async () => JSON.stringify(body ?? null) });
const KEY = "0b7c8d1e-1111-4222-8333-944455556666";

// --- The published keys are keys, and the sandbox's is picked on the sandbox ---
for (const pem of Object.values(WISE_PUBLIC_KEYS)) assert.equal(createPublicKey(pem).asymmetricKeyType, "rsa", "Wise's published key reads as RSA");
assert.equal(wisePublicKey({ WISE_API_BASE: "https://api.wise-sandbox.com" }), WISE_PUBLIC_KEYS.sandbox, "sandbox base, sandbox key");
assert.equal(wisePublicKey({ WISE_API_BASE: "https://api.wise.com" }), WISE_PUBLIC_KEYS.production, "live base, live key");

// --- A pretend database: payouts by ref, one claim per delivery ---------------
function fakeDb(payouts) {
  const db = { payouts, events: new Map(), finished: [], recorded: [] };
  const query = (table) => {
    const filters = {};
    const q = {
      select: () => q,
      eq: (col, val) => { filters[col] = val; return q; },
      update: (patch) => ({ eq: async (_c, id) => { Object.assign(db.events.get(id) ?? {}, patch); return {}; } }),
      delete: () => ({ eq: async (_c, id) => { db.events.delete(id); return {}; } }),
      maybeSingle: async () => {
        if (table === "provider_payout_attempts") {
          const p = db.payouts.find((x) => x.key === filters.attempt_key);
          return { data: p ? { payout_id: p.id } : null };
        }
        const p = db.payouts.find((x) => Object.entries(filters).every(([k, v]) => String(x[k]) === String(v)));
        return { data: p ? { ...p } : null };
      },
    };
    return q;
  };
  db.from = query;
  db.rpc = async (name, args) => {
    if (name === "claim_provider_event") {
      const seen = db.events.get(args.event_id);
      if (seen && (seen.processed_at || Date.now() - seen.claimed < 300000)) return { data: false };
      db.events.set(args.event_id, { claimed: Date.now() });
      return { data: true };
    }
    if (name === "finish_provider_payout") {
      const p = db.payouts.find((x) => x.id === args.target_payout);
      if (args.outcome === "paid" && p.status !== "processing") return {};
      p.status = args.outcome; db.finished.push(args); return {};
    }
    if (name === "record_provider_attempt") {
      const p = db.payouts.find((x) => x.id === args.target_payout);
      if (args.new_ref) p.provider_ref = args.new_ref;
      db.recorded.push(args); return {};
    }
    throw new Error(`unexpected ${name}`);
  };
  return db;
}

function call(route, { headers = {}, body, deps }) {
  const raw = Buffer.from(body);
  const request = { method: "POST", headers, rawBody: raw };
  const out = {};
  const response = { status(code) { out.status = code; return this; }, json(b) { out.body = b; return this; } };
  return route(request, response, deps).then(() => out);
}

// --- Wise -----------------------------------------------------------------------
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = publicKey.export({ type: "spki", format: "pem" });
process.env.WISE_WEBHOOK_PUBLIC_KEY = pem;
const sign = (text, key = privateKey) => createSign("RSA-SHA256").update(text).sign(key, "base64");
const WISE_ENV = { WISE_API_BASE: "https://api.wise-sandbox.com", WISE_API_TOKEN: "t", WISE_PROFILE_ID: "7", WISE_PAYOUT_CURRENCY: "CNY" };

function fakeWise(states) {
  const reads = [];
  const fetchImpl = async (url) => {
    const id = url.match(/transfers\/(\d+)$/)?.[1];
    reads.push(id);
    if (states[id] === "down") return json(503, {});
    return json(200, { id: Number(id), status: states[id], targetValue: 660 });
  };
  return { reads, client: wiseFrom(WISE_ENV, fetchImpl) };
}
const wiseEvent = (id, state = "outgoing_payment_sent") => JSON.stringify({
  data: { resource: { id, profile_id: 7, type: "transfer" }, current_state: state, previous_state: "processing", occurred_at: "2026-11-08T01:00:00Z" },
  subscription_id: "s", event_type: "transfers#state-change", schema_version: "4.0.0", sent_at: "2026-11-08T01:00:01Z",
});

{
  const db = fakeDb([{ id: "p1", provider: "wise", provider_ref: "5001", status: "processing", received_currency: "CNY", paid_at: null }]);
  const wise = fakeWise({ 5001: "outgoing_payment_sent" });
  const body = wiseEvent(5001);
  const deps = { db, client: wise.client };

  // Unsigned, wrongly signed, signed over other bytes, signed by someone else: refused, nothing read.
  for (const headers of [{}, { "x-signature-sha256": "bm9wZQ==" }, { "x-signature-sha256": sign(body + " ") },
    { "x-signature-sha256": sign(body, generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey) }]) {
    const out = await call(wiseWebhook, { headers: { ...headers, "x-delivery-id": "d1" }, body, deps });
    assert.equal(out.status, 400, "a body Wise didn't sign is refused");
  }
  assert.equal(wise.reads.length, 0, "a refused event reads nothing");
  assert.equal(db.events.size, 0, "a refused event claims nothing");

  // Wise's test event when the subscription is made: answered, nothing done.
  const test = await call(wiseWebhook, { headers: { "x-signature-sha256": sign(body), "x-delivery-id": "t1", "x-test-notification": "true" }, body, deps });
  assert.equal(test.status, 200);
  assert.equal(wise.reads.length, 0, "a test event reads nothing");

  // The real one: read back from Wise, and paid.
  const out = await call(wiseWebhook, { headers: { "x-signature-sha256": sign(body), "x-delivery-id": "d1" }, body, deps });
  assert.equal(out.status, 200);
  assert.equal(out.body.state, "paid");
  assert.deepEqual(wise.reads, ["5001"], "the transfer is read from Wise");
  assert.equal(db.payouts[0].status, "paid", "the factory's row is paid with nobody on the board");

  // Wise sends the same delivery again: nothing happens.
  const again = await call(wiseWebhook, { headers: { "x-signature-sha256": sign(body), "x-delivery-id": "d1" }, body, deps });
  assert.equal(again.body.duplicate, true, "the same delivery is handled once");
  assert.equal(wise.reads.length, 1);
  assert.equal(db.finished.length, 1, "paid once");
}
{
  // The event's own word is never written: Wise's answer is. It says paid, Wise says processing.
  const db = fakeDb([{ id: "p2", provider: "wise", provider_ref: "5002", status: "processing", received_currency: "CNY" }]);
  const wise = fakeWise({ 5002: "processing" });
  const body = wiseEvent(5002, "outgoing_payment_sent");
  const out = await call(wiseWebhook, { headers: { "x-signature-sha256": sign(body), "x-delivery-id": "d2" }, body, deps: { db, client: wise.client } });
  assert.equal(out.body.state, "sent");
  assert.equal(db.payouts[0].status, "processing", "an event saying paid doesn't make it paid");
}
{
  // Returned by the factory's bank after it went: failed, and the factory is told to check its details.
  const db = fakeDb([{ id: "p3", provider: "wise", provider_ref: "5003", status: "paid", received_currency: "CNY", paid_at: "x" }]);
  const wise = fakeWise({ 5003: "bounced_back" });
  const body = wiseEvent(5003, "bounced_back");
  await call(wiseWebhook, { headers: { "x-signature-sha256": sign(body), "x-delivery-id": "d3" }, body, deps: { db, client: wise.client } });
  assert.equal(db.payouts[0].status, "failed", "a returned transfer fails");
  assert.equal(db.finished[0].failure, "details_rejected");
  assert.match(db.finished[0].tell_factory, /bank details/, "the factory is asked to check its bank details");
}
{
  // Another site's transfer on the same Wise account: 200, so Wise doesn't give up on the endpoint.
  const db = fakeDb([]);
  const wise = fakeWise({});
  const body = wiseEvent(9999);
  const out = await call(wiseWebhook, { headers: { "x-signature-sha256": sign(body), "x-delivery-id": "d4" }, body, deps: { db, client: wise.client } });
  assert.equal(out.status, 200);
  assert.equal(out.body.state, "unknown_here");
}
{
  // Wise is down when we read: 500 and the claim is let go, so Wise's retry runs it.
  const db = fakeDb([{ id: "p5", provider: "wise", provider_ref: "5005", status: "processing", received_currency: "CNY" }]);
  const wise = fakeWise({ 5005: "down" });
  const body = wiseEvent(5005);
  const out = await call(wiseWebhook, { headers: { "x-signature-sha256": sign(body), "x-delivery-id": "d5" }, body, deps: { db, client: wise.client } });
  assert.equal(out.status, 500, "a failed read-back is said, so Wise sends it again");
  assert.equal(db.events.has("wise:d5"), false, "and the claim is released");
  assert.equal(db.payouts[0].status, "processing");
}
assert.equal(wiseRef({ event_type: "balances#update", data: { resource: { id: 1 } } }), null, "only transfer state changes name a transfer");

// --- PayPal ---------------------------------------------------------------------
const PAYPAL_ENV = { PAYPAL_API_BASE: "https://api-m.sandbox.paypal.com", PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" };
function fakePaypal({ verified = "SUCCESS", item = "SUCCESS" } = {}) {
  const seen = { verifyBodies: [], reads: [] };
  const fetchImpl = async (url, options) => {
    if (url.endsWith("/v1/oauth2/token")) return json(200, { access_token: "a" });
    if (url.endsWith("/verify-webhook-signature")) { seen.verifyBodies.push(options.body); return json(200, { verification_status: verified }); }
    const batch = url.match(/payouts\/([A-Z0-9]+)$/)?.[1];
    if (batch) { seen.reads.push(batch); return json(200, { batch_header: { batch_status: "SUCCESS" }, items: [{ transaction_status: item, payout_item_id: "I1" }] }); }
    return json(404, {});
  };
  return { seen, client: paypalFrom(PAYPAL_ENV, fetchImpl) };
}
// Spaces and a 1.0 kept as written: PayPal checks the event byte for byte.
const paypalEvent = (batch, key = KEY) => `{"id":"WH-1",  "event_type":"PAYMENT.PAYOUTS-ITEM.SUCCEEDED","event_version":1.0,"resource":{"payout_batch_id":"${batch}","payout_item_id":"I1","transaction_status":"SUCCESS","payout_item":{"sender_item_id":"${key}"}}}`;
const PAYPAL_HEADERS = { "paypal-auth-algo": "SHA256withRSA", "paypal-cert-url": "https://api.sandbox.paypal.com/cert", "paypal-transmission-id": "t", "paypal-transmission-sig": "s", "paypal-transmission-time": "2026-11-08T01:00:00Z" };

{
  delete process.env.PAYPAL_WEBHOOK_ID;
  const db = fakeDb([{ id: "q1", provider: "paypal", provider_ref: "B1", status: "processing", key: KEY }]);
  const paypal = fakePaypal();
  const off = await call(paypalWebhook, { headers: PAYPAL_HEADERS, body: paypalEvent("B1"), deps: { db, client: paypal.client } });
  assert.equal(off.status, 503, "without PAYPAL_WEBHOOK_ID nothing is trusted");

  process.env.PAYPAL_WEBHOOK_ID = "WH-ID";
  const out = await call(paypalWebhook, { headers: PAYPAL_HEADERS, body: paypalEvent("B1"), deps: { db, client: paypal.client } });
  assert.equal(out.status, 200);
  assert(paypal.seen.verifyBodies[0].endsWith(`"webhook_event":${paypalEvent("B1")}}`), "the event reaches PayPal's check exactly as it arrived");
  assert.equal(JSON.parse(paypal.seen.verifyBodies[0]).webhook_id, "WH-ID");
  assert.deepEqual(paypal.seen.reads, ["B1"], "the batch is read from PayPal");
  assert.equal(db.payouts[0].status, "paid", "PayPal's SUCCESS pays the factory's row");
}
{
  const db = fakeDb([{ id: "q2", provider: "paypal", provider_ref: "B2", status: "processing", key: KEY }]);
  const paypal = fakePaypal({ verified: "FAILURE" });
  const out = await call(paypalWebhook, { headers: PAYPAL_HEADERS, body: paypalEvent("B2"), deps: { db, client: paypal.client } });
  assert.equal(out.status, 400, "PayPal's FAILURE refuses the event");
  assert.equal(paypal.seen.reads.length, 0);
}
{
  // The press's answer was lost, so the batch id was never kept: found by the key we sent.
  const db = fakeDb([{ id: "q3", provider: "paypal", provider_ref: null, status: "processing", key: KEY }]);
  const paypal = fakePaypal({ item: "UNCLAIMED" });
  const out = await call(paypalWebhook, { headers: PAYPAL_HEADERS, body: paypalEvent("B3"), deps: { db, client: paypal.client } });
  assert.equal(out.status, 200);
  assert.equal(db.payouts[0].provider_ref, "B3", "the batch id is kept");
  assert.equal(out.body.state, "sent", "unclaimed stays open");
}
assert.deepEqual(paypalRef({ event_type: "PAYMENT.PAYOUTSBATCH.SUCCESS", resource: { batch_header: { payout_batch_id: "B9", sender_batch_header: { sender_batch_id: KEY } } } }), { ref: "B9", key: KEY }, "a batch event names its batch");
assert.deepEqual(paypalRef({ event_type: "PAYMENT.CAPTURE.COMPLETED", resource: {} }), { ref: null, key: null }, "other events name nothing");

// --- The sweep -------------------------------------------------------------------
{
  const swept = await sweepProviderPayouts({}, {});
  assert.deepEqual(swept, { wise: { configured: false }, paypal: { configured: false } }, "no settings, nothing swept, nothing thrown");
  const live = await sweepProviderPayouts({}, { WISE_API_BASE: "https://api.wise.com", WISE_API_TOKEN: "t", WISE_PROFILE_ID: "1", WISE_PAYOUT_CURRENCY: "CNY" });
  assert.equal(live.wise.error, "live_elsewhere", "a live Wise account away from production is refused, not thrown");
}

// --- A bank changed in the embedded form is told to the company ------------------
{
  const bankDb = ({ changedAt = null, org = "org" } = {}) => {
    const inserted = [];
    return { inserted, from() { const q = { select: () => q, eq: () => q,
      maybeSingle: async () => ({ data: org ? { org_id: org, methods_changed_by_tsc_at: changedAt } : null }),
      insert: async (row) => { inserted.push(row); return {}; } }; return q; } };
  };
  const bank = { id: "ba_1", object: "bank_account", last4: "4321", currency: "usd" };
  const event = (type, object, previous) => ({ type, account: "acct", created: Math.floor(Date.now() / 1000), data: { object, previous_attributes: previous } });

  for (const [type, words] of [["created", /Bank account ending in 4321 was added/], ["deleted", /Bank account ending in 4321 was removed/]]) {
    const db = bankDb();
    assert.equal(await tellExternalAccountEvent(db, event(`account.external_account.${type}`, bank)), true, `${type} is told`);
    assert.match(db.inserted[0].body, words);
    assert.match(db.inserted[0].body, /email operations@/, "and says who to tell if nobody made it");
    assert.doesNotMatch(db.inserted[0].body, /stripe|wise/i, "in words that name no provider");
    assert.equal(db.inserted[0].org_id, "org");
    assert.equal(db.inserted[0].kind, "payout_method_changed");
  }
  const becameDefault = bankDb();
  assert.equal(await tellExternalAccountEvent(becameDefault, event("account.external_account.updated", { ...bank, default_for_currency: true }, { default_for_currency: false })), true);
  assert.match(becameDefault.inserted[0].body, /is now your default/);
  const statusFlip = bankDb();
  assert.equal(await tellExternalAccountEvent(statusFlip, event("account.external_account.updated", bank, { status: "new" })), false, "a status flip says nothing");
  assert.deepEqual(statusFlip.inserted, []);

  const echo = bankDb({ changedAt: new Date().toISOString() });
  assert.equal(await tellExternalAccountEvent(echo, event("account.external_account.created", bank)), false, "TSC's own change is not told twice");
  assert.deepEqual(echo.inserted, []);
  const later = bankDb({ changedAt: new Date(Date.now() - 600_000).toISOString() });
  assert.equal(await tellExternalAccountEvent(later, event("account.external_account.created", bank)), true, "a change long after TSC's own is someone else's");
  const stranger = bankDb({ org: null });
  assert.equal(await tellExternalAccountEvent(stranger, event("account.external_account.created", bank)), false, "an account we don't know is left");
  assert.deepEqual(stranger.inserted, []);
  assert.equal(await tellExternalAccountEvent(bankDb(), { ...event("account.external_account.created", bank), account: undefined }), false, "TSC's own account has none of these");
}

// The route answers those events, and no withdrawal-request case came back with them.
{
  const route = readFileSync("api/stripe-webhook.js", "utf8");
  for (const type of ["created", "updated", "deleted"]) assert(route.includes(`case "account.external_account.${type}"`), `the webhook handles ${type}`);
  assert(!route.includes('case "payout.'), "payout events have no job here");
}

console.log("check:payout-webhooks: webhooks and the sweep read payouts back with nobody on the board");
