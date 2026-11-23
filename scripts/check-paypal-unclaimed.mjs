/**
 * Staff's "Cancel payment" on a PayPal withdrawal nobody claimed (no PayPal
 * account at the address). Runs the real core (cancelUnclaimedWithdrawal,
 * readBack, syncWithdrawals), the real PayPal adapter and the real PayPal
 * client against a pretend PayPal and a pretend database that ends a
 * withdrawal once, as record_withdrawal / record_withdrawal_returned do.
 *
 *   npm run check:paypal-unclaimed
 *
 * The evasions, written before the code: a press on an item that is not
 * unclaimed; two presses at once; a press racing the 30 s read-back; the
 * factory claiming it between the read and the cancel; a cancel whose answer
 * is lost; a row no longer being sent. In every one PayPal's answer decides,
 * nothing is credited unless PayPal says the money came back, and nothing is
 * credited twice.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { CANCEL_REFUSED, cancelUnclaimedWithdrawal, syncWithdrawals } from "../api/_withdrawals.js";
import { paypalAdapter } from "../api/_withdrawal-adapters.js";
import { PAYPAL_UNCLAIMED, paypalFrom } from "../api/_paypal.js";

for (const name of Object.keys(process.env)) {
  if (/^(PAYPAL_|STRIPE_|WISE_|SUPABASE_|VITE_SUPABASE_)/.test(name) || name === "VERCEL_ENV") delete process.env[name];
}

const SENT = 6420; // what was sent: $65 less the fee

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
      throw new Error(`unexpected PayPal call ${init.method ?? "GET"} ${url}`);
    },
  };
  paypal.client = paypalFrom({ PAYPAL_API_BASE: "https://api-m.sandbox.paypal.com", PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "s" }, paypal.fetch);
  return paypal;
}

/**
 * A pretend database: the withdrawal row, and the two record functions as the
 * migrations write them for these cases. An ended row is never changed again
 * (record_withdrawal returns it as it is; record_withdrawal_returned does
 * nothing for the same figure), so the balance is credited at most once.
 */
function pretendDb(status = "paying") {
  const row = { id: "w1", provider: "paypal", status, provider_ref: "BATCH1", amount_cents: 6500, staff_sentence: PAYPAL_UNCLAIMED, back_cents: 0, kept_cents: 0 };
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
  const db = {
    row, notices,
    get credited() { return credited; },
    rpc: async (name, args) => {
      await new Promise((resolve) => setTimeout(resolve, 1));
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
      const query = {
        select: () => query, eq: () => query, not: () => query, gte: () => query, or: () => query, order: () => query,
        update: () => ({ in: async () => ({ error: null }) }),
        limit: async () => ({ data: row.status === "paying" ? [{ id: row.id, provider_ref: row.provider_ref, status: row.status }] : [], error: null }),
      };
      return query;
    },
  };
  return db;
}

const cancel = (paypal, db) => cancelUnclaimedWithdrawal({ adapter: paypalAdapter, client: paypal.client, db, row: { ...db.row } });

// 1. Unclaimed: PayPal cancels it, it reads RETURNED, and the withdrawal ends
// as a returned one does: what was sent is back in the balance, the factory told.
{
  const paypal = pretendPayPal();
  const db = pretendDb();
  const result = await cancel(paypal, db);
  assert.deepEqual(result, { done: "failed" });
  assert.equal(paypal.calls.cancel, 1);
  assert.equal(db.row.status, "failed");
  assert.equal(db.credited, SENT, "what PayPal gave back is credited");
  assert.equal(db.notices.length, 1, "the factory is told once");
  assert.match(db.row.staff_sentence, /PayPal returned this to TSC/);
}

// 2. Two presses at once: one cancel goes through, the other is refused by
// PayPal (no longer unclaimed); credited once, told once.
{
  const paypal = pretendPayPal();
  const db = pretendDb();
  const results = await Promise.all([cancel(paypal, db), cancel(paypal, db)]);
  assert.ok(results.every((r) => r.done === "failed"), JSON.stringify(results));
  assert.equal(db.credited, SENT, "two presses credit once");
  assert.equal(db.notices.length, 1, "two presses tell once");
}

// 3. A press racing the 30 s read-back: credited once.
{
  const paypal = pretendPayPal();
  const db = pretendDb();
  await Promise.all([cancel(paypal, db), syncWithdrawals({ adapter: paypalAdapter, client: paypal.client, db }), syncWithdrawals({ adapter: paypalAdapter, client: paypal.client, db })]);
  assert.equal(db.row.status, "failed");
  assert.equal(db.credited, SENT, "the read-back racing the cancel credits once");
  assert.equal(db.notices.length, 1);
  // And a read-back after it changes nothing.
  await syncWithdrawals({ adapter: paypalAdapter, client: paypal.client, db });
  assert.equal(db.credited, SENT);
}

// 4. Claimed between the read and the cancel: PayPal refuses, nothing is
// credited, the row reads Paid, and staff are told.
{
  const paypal = pretendPayPal({ claimOnCancel: true });
  const db = pretendDb();
  const result = await cancel(paypal, db);
  assert.deepEqual(result, { done: "paid", refused: CANCEL_REFUSED });
  assert.equal(db.row.status, "paid");
  assert.equal(db.credited, 0, "a claimed payment is never credited back");
}

// 5. Not unclaimed (PayPal still processing it, or already paid): no cancel is asked.
for (const state of ["PENDING", "SUCCESS", "ONHOLD"]) {
  const paypal = pretendPayPal({ state });
  const db = pretendDb();
  await cancel(paypal, db);
  assert.equal(paypal.calls.cancel, 0, `${state}: PayPal is not asked to cancel`);
  assert.equal(db.credited, 0);
}

// 6. The cancel's answer is lost: nothing is credited until PayPal says it
// came back; the next read (or press) records it once.
{
  const paypal = pretendPayPal({ onCancel: () => { throw Object.assign(new Error("aborted"), { name: "AbortError" }); } });
  const db = pretendDb();
  const result = await cancel(paypal, db);
  assert.equal(result.done, "sent");
  assert.match(result.refused, /didn't answer/);
  assert.equal(db.credited, 0, "no answer, no credit");
  assert.equal(db.row.status, "paying");
  paypal.state = "RETURNED"; // it did cancel, after all
  await syncWithdrawals({ adapter: paypalAdapter, client: paypal.client, db });
  assert.equal(db.credited, SENT, "the read-back records it once");
}

// 7. PayPal refuses for another reason and the item stays unclaimed: nothing changes.
{
  const paypal = pretendPayPal({ onCancel: (_p, reply) => reply(400, { name: "VALIDATION_ERROR" }) });
  const db = pretendDb();
  const result = await cancel(paypal, db);
  assert.deepEqual(result, { done: "sent", refused: CANCEL_REFUSED });
  assert.equal(db.row.status, "paying");
  assert.equal(db.row.staff_sentence, PAYPAL_UNCLAIMED, "the row keeps its sentence, and its button");
  assert.equal(db.credited, 0);
}

// 8. A row no longer being sent is refused before PayPal is asked.
for (const status of ["failed", "paid", "requested"]) {
  const paypal = pretendPayPal();
  const db = pretendDb(status);
  await assert.rejects(cancel(paypal, db), /isn't waiting any more/);
  assert.equal(paypal.calls.cancel + paypal.calls.status, 0);
}

// 9. The board shows the button by the row's sentence: the same words as the server's.
{
  const board = fs.readFileSync(new URL("../src/app/admin/AdminWithdrawals.jsx", import.meta.url), "utf8");
  const shown = board.match(/PAYPAL_UNCLAIMED_SENTENCE = "([^"]+)"/)?.[1];
  assert.equal(shown, PAYPAL_UNCLAIMED, "AdminWithdrawals' PAYPAL_UNCLAIMED_SENTENCE is api/_paypal.js's PAYPAL_UNCLAIMED");
  assert.match(board, /data-testid="withdrawal-cancel-unclaimed"[^>]*>Cancel payment</);
}

console.log("paypal-unclaimed: PayPal decides; a cancelled one ends as a returned one, credited once; two presses, the read-back race, a claim meanwhile and a lost answer credit nothing extra");
