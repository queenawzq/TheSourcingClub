/**
 * Tazapay's payout events, against locally signed fixtures and a pretend
 * Tazapay and database: no stack, no keys.
 *
 * The evasions, written before the code: no secret set and events taken anyway;
 * an unsigned body, a signature over other bytes, another secret, a re-ordered
 * body, a signature whose time was swapped; the same event twice; a payout of
 * another site's; a non-payout event; an event that arrives after a later one
 * (a late "succeeded" after the payout was reversed must not pay); a read-back
 * that fails swallowed instead of sent again; the event's own status written.
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { tazapayRef, tazapaySignatureOk } from "../api/_payout-webhooks.js";
import { tazapayFrom } from "../api/_tazapay.js";
import tazapayWebhook from "../api/tazapay-webhook.js";

const SECRET = "whsec-local-test-not-real";
const ENV = { TAZAPAY_BASE_URL: "https://service-sandbox.tazapay.com", TAZAPAY_API_KEY: "k", TAZAPAY_API_SECRET: "s" };
const json = (status, body) => ({ status, ok: status < 300, text: async () => JSON.stringify(body) });

const sign = (raw, secret = SECRET) => {
  const event = JSON.parse(raw);
  return createHmac("sha256", secret).update(`${event.id}${raw}${event.created_at}`).digest("base64");
};
let n = 0;
const event = (type, potId, at = `2026-11-15T15:2${n % 10}:0${n % 10}.123456789Z`) => JSON.stringify({
  type, id: `evt_local${String(++n).padStart(4, "0")}`, object: "event", created_at: at,
  data: { id: potId, object: "payout", status: type.split(".")[1] },
});

// --- The signature on its own --------------------------------------------------
{
  const raw = event("payout.succeeded", "pot_aaaa1");
  const body = Buffer.from(raw);
  assert.equal(tazapaySignatureOk(body, sign(raw), SECRET), true, "Tazapay's scheme: id + raw body + created_at, HMAC-SHA256, Base64");
  assert.equal(tazapaySignatureOk(body, sign(raw), ""), false, "no secret, nothing passes");
  assert.equal(tazapaySignatureOk(body, sign(raw, "another"), SECRET), false, "another secret");
  assert.equal(tazapaySignatureOk(Buffer.from(raw.replace("succeeded", "failed")), sign(raw), SECRET), false, "other bytes");
  assert.equal(tazapaySignatureOk(Buffer.from(JSON.stringify(JSON.parse(raw), null, 1)), sign(raw), SECRET), false, "the same event re-serialised is other bytes");
  const swapped = JSON.stringify({ ...JSON.parse(raw), created_at: "2030-01-01T00:00:00Z" });
  assert.equal(tazapaySignatureOk(Buffer.from(swapped), sign(raw), SECRET), false, "a new time under an old signature");
  assert.equal(tazapaySignatureOk(body, "", SECRET), false);
  assert.equal(tazapaySignatureOk(body, "not base64 at all !!", SECRET), false);
  assert.equal(tazapaySignatureOk(Buffer.from("not json"), sign(raw), SECRET), false);
  assert.equal(tazapayRef(JSON.parse(raw)), "pot_aaaa1");
  assert.equal(tazapayRef({ type: "collect.succeeded", data: { id: "pot_aaaa1" } }), null, "only payout events name a payout");
  assert.equal(tazapayRef({ type: "payout.succeeded", data: { id: "../x" } }), null, "a payout id is Tazapay's shape");
}

// --- A pretend database and Tazapay -----------------------------------------------
function fakeDb(payouts) {
  const db = { payouts, events: new Map(), finished: [], recorded: [] };
  db.from = (table) => {
    const filters = {};
    const q = {
      select: () => q,
      eq: (col, val) => { filters[col] = val; return q; },
      update: (patch) => ({ eq: async (_c, id) => { Object.assign(db.events.get(id) ?? {}, patch); return {}; } }),
      delete: () => ({ eq: async (_c, id) => { db.events.delete(id); return {}; } }),
      maybeSingle: async () => {
        if (table === "provider_payout_attempts") return { data: null };
        const p = db.payouts.find((x) => Object.entries(filters).every(([k, v]) => String(x[k]) === String(v)));
        return { data: p ? { ...p } : null };
      },
    };
    return q;
  };
  db.rpc = async (name, args) => {
    if (name === "claim_provider_event") {
      const seen = db.events.get(args.event_id);
      if (seen && (seen.processed_at || Date.now() - seen.claimed < 300000)) return { data: false };
      db.events.set(args.event_id, { claimed: Date.now() });
      return { data: true };
    }
    const p = db.payouts.find((x) => x.id === args.target_payout);
    if (name === "finish_provider_payout") {
      if (args.outcome === "paid" && p.status !== "processing") return {};
      if (args.outcome === "failed" && p.status === "failed") return {};
      p.status = args.outcome; db.finished.push(args); return {};
    }
    if (name === "record_provider_attempt") { db.recorded.push(args); return {}; }
    throw new Error(`unexpected ${name}`);
  };
  return db;
}
function fakeTazapay(payouts, transactions = {}) {
  const reads = [];
  const client = tazapayFrom(ENV, async (url) => {
    const path = new URL(url).pathname;
    const pot = path.match(/^\/v3\/payout\/(pot_\w+)$/)?.[1];
    if (pot) {
      reads.push(pot);
      if (payouts[pot] === "down") return json(503, { status: "error", message: "down" });
      return json(200, { status: "success", data: payouts[pot] });
    }
    const btr = path.match(/^\/v3\/balance_transaction\/(btr_\w+)$/)?.[1];
    if (btr) return json(200, { status: "success", data: transactions[btr] });
    return json(404, { status: "error", message: "Not Found" });
  });
  return { reads, client };
}
function call({ headers = {}, body, deps }) {
  const out = {};
  const response = { status(code) { out.status = code; return this; }, json(b) { out.body = b; return this; } };
  return tazapayWebhook({ method: "POST", headers, rawBody: Buffer.from(body) }, response, deps).then(() => out);
}
const signed = (raw) => ({ signature: sign(raw) });

// --- Not set up: refused, so Tazapay sends it again once it is ----------------------
{
  delete process.env.TAZAPAY_WEBHOOK_SECRET;
  const tz = fakeTazapay({ pot_aaaa1: { id: "pot_aaaa1", status: "succeeded", amount: 100, currency: "CNY" } });
  const raw = event("payout.succeeded", "pot_aaaa1");
  const out = await call({ headers: signed(raw), body: raw, deps: { db: fakeDb([]), client: tz.client } });
  assert.equal(out.status, 503, "no secret on this site: not taken");
  assert.equal(tz.reads.length, 0);
}
process.env.TAZAPAY_WEBHOOK_SECRET = SECRET;

// --- Signed, replayed, unknown, not a payout ---------------------------------------
{
  const db = fakeDb([{ id: "p1", provider: "tazapay", provider_ref: "pot_aaaa1", status: "processing", received_currency: "CNY", paid_at: null }]);
  const tz = fakeTazapay({ pot_aaaa1: { id: "pot_aaaa1", status: "succeeded", amount: 63995, currency: "CNY" } });
  const deps = { db, client: tz.client };
  const raw = event("payout.succeeded", "pot_aaaa1");

  for (const headers of [{}, { signature: "bm9wZQ==" }, { signature: sign(raw, "another") }, { signature: sign(`${raw} `) }]) {
    const out = await call({ headers, body: raw, deps });
    assert.equal(out.status, 400, "a body Tazapay didn't sign is refused");
  }
  assert.equal(tz.reads.length, 0, "a refused event reads nothing");
  assert.equal(db.events.size, 0, "and claims nothing");

  const out = await call({ headers: signed(raw), body: raw, deps });
  assert.equal(out.status, 200);
  assert.equal(out.body.state, "paid", "read back from Tazapay, and paid");
  assert.deepEqual(tz.reads, ["pot_aaaa1"]);
  assert.equal(db.payouts[0].status, "paid", "with nobody on the board");
  assert(db.events.has(`tazapay:${JSON.parse(raw).id}`), "claimed under tazapay:<event id>");

  const again = await call({ headers: signed(raw), body: raw, deps });
  assert.equal(again.body.duplicate, true, "the same event is handled once");
  assert.equal(tz.reads.length, 1);
  assert.equal(db.finished.length, 1, "paid once");

  const elsewhere = event("payout.succeeded", "pot_zz99");
  const unknown = await call({ headers: signed(elsewhere), body: elsewhere, deps });
  assert.equal(unknown.status, 200, "another site's payout is answered, so Tazapay stops sending it");
  assert.equal(unknown.body.state, "unknown_here");
  assert.equal(tz.reads.length, 1, "and nothing is read for it");

  const collect = JSON.stringify({ type: "collect.succeeded", id: "evt_collect1", object: "event", created_at: "2026-11-15T15:00:00Z", data: { id: "col_1" } });
  const ignored = await call({ headers: signed(collect), body: collect, deps });
  assert.equal(ignored.body.ignored, true, "an event about something else is answered and ignored");
}

// --- Out of order: the read-back decides, not the event ----------------------------
{
  const db = fakeDb([{ id: "p2", provider: "tazapay", provider_ref: "pot_rrrr1", status: "paid", received_currency: "CNY", paid_at: "2026-11-15T15:27:37Z" }]);
  const tz = fakeTazapay(
    { pot_rrrr1: { id: "pot_rrrr1", status: "reversed", status_description: "PR1001", balance_transaction: "btr_d", reversal_balance_transaction: "btr_c" } },
    { btr_d: { net: { amount: -80544, currency: "USD" } }, btr_c: { net: { amount: 80000, currency: "USD" } } },
  );
  const deps = { db, client: tz.client };
  // payout.succeeded is delivered after the payout was already reversed.
  const late = event("payout.succeeded", "pot_rrrr1");
  const out = await call({ headers: signed(late), body: late, deps });
  assert.equal(out.body.state, "failed", "a late 'succeeded' records where the payout is now: reversed");
  assert.equal(db.payouts[0].status, "failed", "the payment is owed again");
  assert.match(db.finished[0].sentence, /reversed.*\$800\.00 came back.*\$5\.44 was lost/, "staff read what came back and what was lost");
  // Then payout.processing, the oldest of all, arrives last.
  const oldest = event("payout.processing", "pot_rrrr1");
  const last = await call({ headers: signed(oldest), body: oldest, deps });
  assert.equal(last.body.state, "failed", "a finished payout isn't read again or moved back");
  assert.equal(tz.reads.length, 1);
  assert.equal(db.finished.length, 1, "nothing recorded twice");
}

// --- Tazapay down while reading back: answered 500, claim removed, sent again --------
{
  const db = fakeDb([{ id: "p3", provider: "tazapay", provider_ref: "pot_dddd1", status: "processing", received_currency: "CNY", paid_at: null }]);
  const payouts = { pot_dddd1: "down" };
  const tz = fakeTazapay(payouts);
  const raw = event("payout.compliance_hold", "pot_dddd1");
  const first = await call({ headers: signed(raw), body: raw, deps: { db, client: tz.client } });
  assert.equal(first.status, 500, "a read-back that failed is sent again by Tazapay");
  assert.equal(db.events.size, 0, "its claim is removed");
  payouts.pot_dddd1 = { id: "pot_dddd1", status: "compliance_hold", amount: 300000, currency: "CNY" };
  const retry = await call({ headers: signed(raw), body: raw, deps: { db, client: tz.client } });
  assert.equal(retry.body.state, "sent", "the retry records the hold");
  assert.match(db.recorded.at(-1).sentence, /compliance hold/, "and staff read it");
}

// --- Every status Tazapay documents, mapped on purpose ----------------------------
{
  const tz = fakeTazapay({
    pot_ra: { id: "pot_ra", status: "requires_action" },
    pot_rp: { id: "pot_rp", status: "requires_approval" },
    pot_ah: { id: "pot_ah", status: "approval_hold" },
    pot_ib: { id: "pot_ib", status: "initiator_bank_hold" },
    pot_rf: { id: "pot_rf", status: "requires_funding" },
    pot_rc: { id: "pot_rc", status: "requires_confirmation" },
    pot_cn: { id: "pot_cn", status: "cancelled" },
    pot_cw: { id: "pot_cw", status: "cancelled", balance_transaction: "btr_x" },
    pot_nw: { id: "pot_nw", status: "on_the_moon" },
  });
  const read = (id) => tz.client.status(id);
  const waiting = async (id, words) => {
    const s = await read(id);
    assert.equal(s.state, "sent", `${id} stays open`);
    assert.match(s.waiting, words, `${id}: staff read what it waits for`);
  };
  await waiting("pot_ra", /needs something before this payout can go on/);
  await waiting("pot_rp", /approval rights in Tazapay/);
  await waiting("pot_ah", /waits for an approval in Tazapay/);
  await waiting("pot_ib", /sending bank is holding this payout/);
  await waiting("pot_rf", /waits for money in TSC's Tazapay balance/);
  await waiting("pot_rc", /waits for confirmation in Tazapay/);
  await waiting("pot_nw", /"on_the_moon", which TSC doesn't know yet/);
  const cancelled = await read("pot_cn");
  assert.equal(cancelled.state, "cancelled", "cancelled before it was paid: the attempt ends, the payment stays owed");
  assert.match(cancelled.failure, /Tazapay cancelled this payout before it was paid\. Nothing reached the factory\..*still owed/);
  await waiting("pot_cw", /was cancelled, and the money isn't back/);
}

console.log("check:tazapay-webhook ok");
