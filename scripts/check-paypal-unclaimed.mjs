/**
 * A PayPal withdrawal nobody claimed (no PayPal account at the address) is
 * taken back by itself: the first read that finds it UNCLAIMED asks PayPal to
 * cancel it, and what PayPal then says is recorded as any answer is. Runs the
 * real core (readBack, syncWithdrawals, readBackWithdrawalRef), the real
 * PayPal adapter and the real PayPal client against a pretend PayPal and a
 * pretend database that ends a withdrawal once, as record_withdrawal /
 * record_withdrawal_returned do, and claims a cancel as an atomic update.
 *
 *   npm run check:paypal-unclaimed
 *
 * The evasions, written before the code: reads at once (the board's sync in
 * two tabs, the webhook); a cancel PayPal refuses (claimed meanwhile, or a
 * 500 as its sandbox once answered); a cancel whose answer is lost; PayPal's
 * own 30-day return; reading too often. In every one PayPal's answer
 * decides, nothing is credited unless PayPal says the money came back,
 * nothing is credited twice, and PayPal is asked to cancel at most once per
 * CANCEL_RETRY_MINUTES.
 */
import assert from "node:assert/strict";
import { CANCEL_RETRY_MINUTES, WITHDRAWAL_UNCLAIMED, readBackWithdrawalRef, syncWithdrawals } from "../api/_withdrawals.js";
import { paypalAdapter } from "../api/_withdrawal-adapters.js";
import { PAYPAL_UNCLAIMED, paypalFrom } from "../api/_paypal.js";

for (const name of Object.keys(process.env)) {
  if (/^(PAYPAL_|STRIPE_|WISE_|SUPABASE_|VITE_SUPABASE_)/.test(name) || name === "VERCEL_ENV") delete process.env[name];
}

const SENT = 6372; // what was sent: $65 less PayPal's $1.28 fee
const T0 = Date.parse("2026-11-23T16:30:00Z");
const minutes = (n) => T0 + n * 60_000;

/** A pretend PayPal: one batch, one item, its state, and how cancel answers. */
function pretendPayPal({ state = "UNCLAIMED", onCancel = null, claimOnCancel = false } = {}) {
  const calls = { cancel: 0, status: 0 };
  const paypal = {
    state,
    calls,
    fetch: async (url, init = {}) => {
      const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
      if (url.endsWith("/v1/oauth2/token")) return reply(200, { access_token: "t" });
      if (url.includes("/v1/payments/payouts-item/ITEM1/cancel") && init.method === "POST") {
        calls.cancel += 1;
        if (onCancel) return onCancel(paypal, reply);
        if (claimOnCancel) paypal.state = "SUCCESS";
        // PayPal cancels only what is still unclaimed.
        if (paypal.state !== "UNCLAIMED") return reply(422, { name: "UNPROCESSABLE_ENTITY", message: "Item cannot be cancelled" });
        paypal.state = "RETURNED";
        return reply(200, { payout_item_id: "ITEM1", transaction_status: "RETURNED" });
      }
      if (url.endsWith("/v1/payments/payouts/BATCH1")) {
        calls.status += 1;
        return reply(200, {
          batch_header: { batch_status: "SUCCESS" },
          items: [{ payout_item_id: "ITEM1", transaction_status: paypal.state, payout_item: { amount: { value: (SENT / 100).toFixed(2), currency: "USD" } } }],
        });
      }
      throw new Error(`unexpected PayPal request ${init.method ?? "GET"} ${url}`);
    },
  };
  paypal.client = paypalFrom({ PAYPAL_API_BASE: "https://api-m.sandbox.paypal.com", PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "s" }, paypal.fetch);
  return paypal;
}

/**
 * A pretend database: the withdrawal row; the two record functions as the
 * migrations write them for these cases (an ended row is never changed again,
 * so the balance is credited at most once); and the cancel claim, an UPDATE
 * ... WHERE status = 'paying' AND (read_back_at IS NULL OR read_back_at < x)
 * that one statement at a time wins.
 */
function pretendDb(status = "paying") {
  const row = { id: "w1", provider: "paypal", status, provider_ref: "BATCH1", currency: "USD", amount_cents: 6500, staff_sentence: "Sent. Waiting for the provider to confirm.", read_back_at: null, back_cents: 0, kept_cents: 0 };
  const notices = [];
  let credited = 0;
  const end = (cameBack, sentence) => {
    row.status = "failed";
    row.back_cents = cameBack;
    row.kept_cents = row.amount_cents - cameBack;
    row.staff_sentence = sentence ?? row.staff_sentence;
    credited += cameBack;
    notices.push("Withdrawal of $65.00 did not go through");
  };
  const tick = () => new Promise((resolve) => setTimeout(resolve, 1));
  const db = {
    row, notices,
    get credited() { return credited; },
    rpc: async (name, args) => {
      await tick();
      if (name === "record_withdrawal") {
        if (["paid", "failed", "declined", "cancelled"].includes(row.status)) return { data: row, error: null };
        if (args.outcome === "sent") row.staff_sentence = args.sentence ?? row.staff_sentence;
        else if (args.outcome === "paid") row.status = "paid";
        else if (args.outcome === "failed") end(row.amount_cents, args.sentence);
        return { data: row, error: null };
      }
      if (name === "record_withdrawal_returned") {
        if (row.status === "failed") return { data: row, error: null }; // the same figure again changes nothing
        if (row.status === "paying" || row.status === "paid") end(args.came_back, args.sentence);
        return { data: row, error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    },
    from: (table) => {
      assert.equal(table, "factory_withdrawals");
      const filters = [];
      let patch = null;
      const query = {
        select: () => query,
        eq: (column, value) => (filters.push((r) => r[column] === value), query),
        not: () => query, gte: () => query, order: () => query,
        or: (text) => {
          const before = text.match(/read_back_at\.lt\.(.+)$/)?.[1];
          if (before) filters.push((r) => r.read_back_at === null || r.read_back_at < before);
          return query;
        },
        update: (values) => (patch = values, query),
        in: async () => ({ error: null }),
        maybeSingle: async () => ({ data: filters.every((f) => f(row)) ? { ...row } : null, error: null }),
        limit: async () => ({ data: row.status === "paying" ? [{ id: row.id, provider_ref: row.provider_ref, status: row.status }] : [], error: null }),
        then: (resolve, reject) => tick().then(() => {
          // The claim: one UPDATE, checked and written in one step.
          if (!patch) return { data: [], error: null };
          if (!filters.every((f) => f(row))) return { data: [], error: null };
          Object.assign(row, patch);
          return { data: [{ id: row.id }], error: null };
        }).then(resolve, reject),
      };
      return query;
    },
  };
  return db;
}

const sync = (paypal, db, now = T0) => syncWithdrawals({ adapter: paypalAdapter, client: paypal.client, db, now });
const webhook = (paypal, db) => readBackWithdrawalRef({ provider: "paypal", client: paypal.client, db, ref: "BATCH1" });

// 1. The first read that finds it unclaimed takes it back: PayPal cancels it,
// it reads RETURNED, and the withdrawal ends as a returned one does. What was
// sent comes back to the balance (PayPal keeps its fee, as on any return), and
// the factory is told once.
{
  const paypal = pretendPayPal();
  const db = pretendDb();
  await sync(paypal, db);
  assert.equal(paypal.calls.cancel, 1);
  assert.equal(db.row.status, "failed");
  assert.equal(db.credited, SENT, "what PayPal gave back is credited");
  assert.equal(db.row.kept_cents, 128, "PayPal's fee is the factory's, as on any return");
  assert.equal(db.notices.length, 1, "the factory is told once");
  assert.match(db.row.staff_sentence, /PayPal returned this to TSC/);
}

// 2. Reads at once (the board's sync in two tabs and PayPal's webhook): one
// cancel, credited once, told once.
{
  const paypal = pretendPayPal();
  const db = pretendDb();
  await Promise.all([sync(paypal, db), sync(paypal, db), webhook(paypal, db), webhook(paypal, db)]);
  assert.equal(paypal.calls.cancel, 1, "one reader claims the cancel");
  assert.equal(db.row.status, "failed");
  assert.equal(db.credited, SENT, "reads at once credit once");
  assert.equal(db.notices.length, 1);
  await sync(paypal, db, minutes(60));
  assert.equal(db.credited, SENT, "a read after it changes nothing");
  assert.equal(paypal.calls.cancel, 1, "and asks nothing more");
}

// 3. Claimed between the read and the cancel: PayPal refuses, nothing is
// credited, and the row reads Paid.
{
  const paypal = pretendPayPal({ claimOnCancel: true });
  const db = pretendDb();
  await sync(paypal, db);
  assert.equal(db.row.status, "paid");
  assert.equal(db.credited, 0, "a claimed payment is never credited back");
}

// 4. PayPal refuses the cancel (a 500, as its sandbox answered on Nov 7, or a
// 4xx): nothing changes but staff's line, nothing is credited, PayPal is not
// asked again for CANCEL_RETRY_MINUTES, and is asked again after it.
for (const refusal of [500, 400]) {
  const paypal = pretendPayPal({ onCancel: (_p, reply) => reply(refusal, { name: refusal === 500 ? "INTERNAL_SERVICE_ERROR" : "VALIDATION_ERROR" }) });
  const db = pretendDb();
  await sync(paypal, db);
  assert.equal(db.row.status, "paying", `${refusal}: the row is left as it was`);
  assert.equal(db.row.staff_sentence, WITHDRAWAL_UNCLAIMED, `${refusal}: staff read that it is being returned`);
  assert.equal(db.credited, 0);
  assert.equal(db.notices.length, 0);
  for (const at of [0.5, 1, 5, CANCEL_RETRY_MINUTES - 1]) await sync(paypal, db, minutes(at));
  assert.equal(paypal.calls.cancel, 1, `${refusal}: not asked again within ${CANCEL_RETRY_MINUTES} minutes`);
  await sync(paypal, db, minutes(CANCEL_RETRY_MINUTES + 1));
  assert.equal(paypal.calls.cancel, 2, `${refusal}: asked again after the wait`);
  assert.equal(db.credited, 0);
}

// 5. The cancel's answer is lost: nothing is credited until PayPal says it
// came back; the next read records it once.
{
  const paypal = pretendPayPal({ onCancel: () => { throw Object.assign(new Error("aborted"), { name: "AbortError" }); } });
  const db = pretendDb();
  await sync(paypal, db);
  assert.equal(db.credited, 0, "no answer, no credit");
  assert.equal(db.row.status, "paying");
  paypal.state = "RETURNED"; // it did cancel, after all
  await sync(paypal, db, minutes(1));
  assert.equal(db.credited, SENT, "the next read records it once");
  assert.equal(paypal.calls.cancel, 1);
}

// 6. PayPal's own 30-day return, with every cancel refused until then: the
// read-back credits it once, however many reads follow, at once or later.
{
  const paypal = pretendPayPal({ onCancel: (_p, reply) => reply(500, { name: "INTERNAL_SERVICE_ERROR" }) });
  const db = pretendDb();
  await sync(paypal, db);
  assert.equal(db.credited, 0, "still unclaimed: nothing credited");
  paypal.state = "RETURNED";
  await Promise.all([sync(paypal, db, minutes(43_200)), sync(paypal, db, minutes(43_200)), webhook(paypal, db)]);
  await sync(paypal, db, minutes(43_300));
  assert.equal(db.credited, SENT, "the 30-day return credits once");
  assert.equal(db.notices.length, 1);
}

// 7. Not unclaimed (still processing, on hold, or paid): PayPal is not asked to cancel.
for (const state of ["PENDING", "ONHOLD", "SUCCESS"]) {
  const paypal = pretendPayPal({ state });
  const db = pretendDb();
  await sync(paypal, db);
  assert.equal(paypal.calls.cancel, 0, `${state}: PayPal is not asked to cancel`);
  assert.equal(db.credited, 0);
}

// 8. Staff's line is new for withdrawals only: a per-step payout keeps its own
// (it has a Cancel payment button), and the withdrawal's no longer says to cancel.
assert.notEqual(WITHDRAWAL_UNCLAIMED, PAYPAL_UNCLAIMED);
assert.doesNotMatch(WITHDRAWAL_UNCLAIMED, /cancel|pay again|ask the factory/i);

console.log("paypal-unclaimed: an unclaimed withdrawal is cancelled by the first read, credited once; reads at once, a refused or lost cancel, a claim meanwhile and PayPal's own return credit nothing extra; one cancel per wait");
