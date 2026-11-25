// A withdrawal from a factory's Stripe balance pays Stripe's payout fee
// exactly once: taken back by partial transfer reversals (newest first,
// spread over several), then X − fee paid out; given back when the payout is
// refused or fails; never twice on a retry, a crash or a double press.
// With a fake Stripe and a fake database. Run: node scripts/check-stripe-withdrawals.mjs
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { CANNOT_PROCESS, IN_PROGRESS, UNDER_REVIEW, returnFeeOnFailedPayout, refreshPayouts, withdrawWithFee } from "../api/_stripe-withdrawals.js";
import { STRIPE_MINIMUM_PAYOUT, stripeWithdrawalFee, withdrawalFee } from "../src/shared/withdrawal-fees.mjs";
/** A dispute also opens a payment review (20261124100000); the money calls are checked apart from it. */
const withoutReview = (calls) => calls.filter(([name]) => name !== "record_payment_review_dispute");

const REQUEST = "b1f9fd8c-76bd-43a7-ad48-502ebed382b3";
const OTHER = "c2f9fd8c-76bd-43a7-ad48-502ebed382b4";

/** The stripe_withdrawals table and its two claim functions, in memory. */
function fakeDb({ reach = { any_cents: 0, stripe_cents: 0, debt_cents: 0 }, paused = false } = {}) {
  const rows = [];
  const leased = (row) => row.lease_until && Date.parse(row.lease_until) > Date.now();
  const lease = () => new Date(Date.now() + 120_000).toISOString();
  function query() {
    const filters = [];
    let patch = null;
    const matches = () => rows.filter((row) => filters.every((f) => f(row)));
    const q = {
      select() { return q; },
      update(fields) { patch = fields; return q; },
      eq(column, value) { filters.push((row) => row[column] === value); if (patch) for (const row of matches()) Object.assign(row, structuredClone(patch)); return q; },
      in(column, values) { filters.push((row) => values.includes(row[column])); return q; },
      gte(column, value) { filters.push((row) => row[column] >= value); return q; },
      not(column, op, value) { assert.equal(op, "is"); filters.push((row) => (row[column] ?? null) !== value); return q; },
      order() { return q; },
      limit() { return q; },
      async maybeSingle() { return { data: structuredClone(matches()[0] ?? null), error: null }; },
      then(resolve, reject) { return Promise.resolve({ data: structuredClone(matches()), error: null }).then(resolve, reject); },
    };
    return q;
  }
  return {
    rows,
    from(table) { assert.equal(table, "stripe_withdrawals"); return query(); },
    async rpc(name, args) {
      if (name === "claim_stripe_withdrawal") {
        let row = rows.find((r) => r.request_key === args.key);
        if (!row) {
          row = { id: randomUUID(), org_id: args.target_org, stripe_account_id: args.account, request_key: args.key, request_id: args.request,
            amount_minor: args.amount, currency: args.in_currency.toUpperCase(), destination: args.to_destination, fee_cents: null,
            fee_local_minor: null, reversals: [], payout_id: null, payout_minor: null, state: "claimed", reason: null, lease_until: null, created_at: new Date().toISOString() };
          rows.push(row);
        }
        if (["claimed", "fee_taken"].includes(row.state) && !leased(row)) {
          row.lease_until = lease();
          return { data: { claimed: true, row: structuredClone(row) }, error: null };
        }
        return { data: { claimed: false, row: structuredClone(row) }, error: null };
      }
      if (name === "claim_abandoned_stripe_withdrawal") {
        const row = rows.find((r) => r.id === args.target);
        if (!row || !["claimed", "fee_taken"].includes(row.state) || leased(row)) return { data: null, error: null };
        row.lease_until = lease();
        return { data: structuredClone(row), error: null };
      }
      // A payment under review pauses every withdrawal (20261124100000); null: not read.
      if (name === "factory_paused") return paused === null ? { data: null, error: { message: "down" } } : { data: paused, error: null };
      if (name === "owed_reachable") return reach === null ? { data: null, error: { message: "down" } } : { data: reach, error: null };
      throw new Error(`unexpected rpc ${name}`);
    },
  };
}

/**
 * A connected account with US$ transfers that landed at `rate` units of its
 * own currency per US$, and TSC's platform balance in US$.
 */
function fakeStripe({ currency = "usd", rate = 1, transfers, available, payoutFails = [] }) {
  const s = {
    platform: 0,
    balance: available,
    reads: 0,
    payoutReads: 0,
    slowPayouts: false,
    staleBalance: null,
    reversals: [],
    payouts: [],
    returned: [],
    keys: new Map(),
  };
  const once = (key, make) => { if (!s.keys.has(key)) s.keys.set(key, make()); return s.keys.get(key); };
  const list = (items) => ({ async *[Symbol.asyncIterator]() { yield* items; } });
  s.api = {
    accounts: { async update() {}, async retrieveExternalAccount() { return null; } },
    balance: {
      async retrieve() {
        // staleBalance: what a second tab read before the first tab's withdrawal went.
        const amount = s.staleBalance ?? s.balance;
        s.staleBalance = null;
        return { available: [{ currency, amount }] };
      },
    },
    transfers: {
      list: () => list([...transfers].reverse()),
      listReversals: (id) => list(s.reversals.filter((r) => r.transfer === id)),
      async createReversal(id, params, { idempotencyKey }) {
        return once(idempotencyKey, () => {
          const transfer = transfers.find((t) => t.id === id);
          assert.ok(transfer.amount - transfer.amount_reversed >= params.amount, "never more than the transfer has left");
          const local = Math.round(params.amount * rate);
          if (local > s.balance) throw Object.assign(new Error("Insufficient funds in the connected account"), { statusCode: 400, code: "balance_insufficient" });
          transfer.amount_reversed += params.amount;
          s.balance -= local;
          s.platform += params.amount;
          const reversal = { id: `trr_${s.reversals.length + 1}`, transfer: id, amount: params.amount, metadata: params.metadata, destination_payment_refund: `pyr_${s.reversals.length + 1}`, local };
          s.reversals.push(reversal);
          return reversal;
        });
      },
      async create(params, { idempotencyKey }) {
        return once(idempotencyKey, () => {
          s.platform -= params.amount;
          s.balance += Math.round(params.amount * rate);
          const transfer = { id: `tr_back_${s.returned.length + 1}`, amount: params.amount, amount_reversed: 0, currency: "usd", metadata: params.metadata, destination_payment: "py_back" };
          s.returned.push(transfer);
          transfers.push(transfer);
          return transfer;
        });
      },
    },
    charges: { async retrieve() { s.reads += 1; return { balance_transaction: { currency, exchange_rate: currency === "usd" ? null : rate } }; } },
    refunds: { async retrieve(id) { const r = s.reversals.find((x) => x.destination_payment_refund === id); return { balance_transaction: { currency, amount: -r.local } }; } },
    payouts: {
      async list() { return { data: s.payouts }; },
      async retrieve(id) { s.payoutReads += 1; if (s.slowPayouts) return new Promise(() => {}); return structuredClone(s.payouts.find((p) => p.id === id)); },
      async create(params, { idempotencyKey }) {
        const failure = payoutFails.shift();
        if (failure) throw failure;
        return once(idempotencyKey, () => {
          if (params.amount > s.balance) throw Object.assign(new Error("Insufficient funds"), { statusCode: 400, code: "balance_insufficient" });
          s.balance -= params.amount;
          const payout = { id: `po_${s.payouts.length + 1}`, amount: params.amount, currency: params.currency, status: "pending", metadata: params.metadata };
          s.payouts.push(payout);
          return payout;
        });
      },
    },
  };
  return s;
}

const transfer = (id, amount) => ({ id, amount, amount_reversed: 0, currency: "usd", destination_payment: `py_${id}` });
const args = (s, db, extra = {}) => ({ stripe: s.api, db, orgId: "org", accountId: "acct_us", country: "US", amount: 100_000, currency: "usd", requestId: REQUEST, ...extra });
const usFee = withdrawalFee({ provider: "stripe", amountCents: 100_000, country: "US" }).feeCents;
assert.equal(usFee, 523);

// 1. The fee is reversed newest first, spread over two transfers; X − fee is paid out; TSC gains the fee.
{
  const s = fakeStripe({ transfers: [transfer("tr_old", 99_000), transfer("tr_mid", 1_000), transfer("tr_new", 300)], available: 100_300 });
  const db = fakeDb();
  const payout = await withdrawWithFee(args(s, db));
  assert.deepEqual(s.reversals.map((r) => [r.transfer, r.amount]), [["tr_new", 300], ["tr_mid", 223]]);
  assert.equal(payout.amount, 100_000 - usFee);
  assert.equal(s.platform, usFee, "TSC's balance gains exactly the fee");
  assert.equal(s.balance, 300, "the factory's balance goes down by exactly X");
  assert.deepEqual([db.rows[0].state, db.rows[0].fee_cents, db.rows[0].fee_local_minor, db.rows[0].payout_minor], ["paid_out", 523, 523, 99_477]);
  // The same request again (a resend): the same payout, no second fee.
  const again = await withdrawWithFee(args(s, db));
  assert.equal(again.id, payout.id);
  assert.equal(s.reversals.length, 2);
  assert.equal(s.payouts.length, 1);
}

// 1b. A payment under review (20261124100000): refused before anything is
//     claimed, reversed or paid out; not read: refused too, never skipped.
for (const [paused, words] of [[true, UNDER_REVIEW], [null, CANNOT_PROCESS]]) {
  const s = fakeStripe({ transfers: [transfer("tr_new", 100_300)], available: 100_300 });
  const db = fakeDb({ paused });
  await assert.rejects(withdrawWithFee(args(s, db)), (error) => error.message === words);
  assert.deepEqual([db.rows.length, s.reversals.length, s.payouts.length], [0, 0, 0], "nothing claimed, reversed or paid out");
}

// 2. A crash between the reversal and the payout: the retry finds the reversals and pays out once.
{
  const timeout = Object.assign(new Error("connection reset"), { type: "StripeConnectionError" });
  const s = fakeStripe({ transfers: [transfer("tr_a", 100_000)], available: 100_000, payoutFails: [timeout] });
  const db = fakeDb();
  await assert.rejects(withdrawWithFee(args(s, db)), /connection reset/);
  assert.equal(db.rows[0].state, "fee_taken");
  assert.equal(s.platform, usFee);
  // The lease is handed back, so the same request goes on at once.
  const payout = await withdrawWithFee(args(s, db));
  assert.equal(s.reversals.length, 1, "the fee is not taken twice");
  assert.equal(s.platform, usFee);
  assert.equal(payout.amount, 100_000 - usFee);
  assert.equal(db.rows[0].state, "paid_out");
}

// 2b. A crash that left the lease on, abandoned by the factory: the next withdrawal gives the fee back first.
{
  const timeout = Object.assign(new Error("connection reset"), { type: "StripeConnectionError" });
  const s = fakeStripe({ transfers: [transfer("tr_a", 200_000)], available: 200_000, payoutFails: [timeout] });
  const db = fakeDb();
  await assert.rejects(withdrawWithFee(args(s, db)), /connection reset/);
  db.rows[0].lease_until = new Date(Date.now() - 1000).toISOString();
  await withdrawWithFee(args(s, db, { requestId: OTHER }));
  assert.equal(db.rows[0].state, "fee_returned", "the abandoned withdrawal's fee went back");
  assert.equal(s.returned[0].amount, usFee);
  assert.equal(db.rows[1].state, "paid_out");
  assert.equal(s.platform, usFee, "TSC keeps only the fee of the withdrawal that was paid out");
  assert.equal(s.balance, 100_000);
}

// 3. A payout Stripe refuses: the fee goes back, the factory's balance is whole again.
{
  const refused = Object.assign(new Error("Insufficient funds"), { statusCode: 400, code: "balance_insufficient" });
  const s = fakeStripe({ transfers: [transfer("tr_a", 100_000)], available: 100_000, payoutFails: [refused] });
  const db = fakeDb();
  await assert.rejects(withdrawWithFee(args(s, db)), /Insufficient funds/);
  assert.equal(db.rows[0].state, "fee_returned");
  assert.equal(s.platform, 0, "TSC keeps no fee for a payout that never left");
  assert.equal(s.balance, 100_000);
  // And a payout that fails at the bank later: the webhook gives the fee back once.
  const s2 = fakeStripe({ transfers: [transfer("tr_a", 100_000)], available: 100_000 });
  const db2 = fakeDb();
  const payout = await withdrawWithFee(args(s2, db2));
  assert.equal(await returnFeeOnFailedPayout({ stripe: s2.api, db: db2, payout: { ...payout, status: "failed" } }), true);
  assert.equal(await returnFeeOnFailedPayout({ stripe: s2.api, db: db2, payout: { ...payout, status: "failed" } }), false, "a repeated event gives nothing back twice");
  assert.equal(s2.platform, 0);
  assert.equal(s2.returned.length, 1);
}

// 4. At or under the fee: refused in the module's words, nothing sent, nothing reversed.
{
  const s = fakeStripe({ transfers: [transfer("tr_a", 100)], available: 100 });
  const db = fakeDb();
  await assert.rejects(withdrawWithFee(args(s, db, { amount: 26 })), /^Error: This payment of US\$0\.26 is too small to send\. The fee is US\$0\.26\.$/);
  assert.deepEqual([s.reversals.length, s.payouts.length, s.platform], [0, 0, 0]);
  assert.equal(db.rows[0].state, "refused");
}

// 5. A double press (same request at the same moment) and two tabs (two requests, one balance).
{
  const s = fakeStripe({ transfers: [transfer("tr_a", 100_000)], available: 100_000 });
  const db = fakeDb();
  const [first, second] = await Promise.allSettled([withdrawWithFee(args(s, db)), withdrawWithFee(args(s, db))]);
  assert.equal(first.status, "fulfilled");
  assert.equal(second.reason?.message, IN_PROGRESS);
  assert.equal(s.reversals.length, 1);
  // A second tab asks for the whole balance again: refused before any fee.
  await assert.rejects(withdrawWithFee(args(s, db, { requestId: OTHER })), /^Error: You can withdraw up to \$0\.00\.$/);
  assert.equal(s.reversals.length, 1);
  assert.equal(s.platform, usFee);
}

// 6. Too little left on the transfers to reverse: refused, nothing taken.
{
  const s = fakeStripe({ transfers: [{ ...transfer("tr_a", 100_000), amount_reversed: 99_900 }], available: 100_000 });
  const db = fakeDb();
  await assert.rejects(withdrawWithFee(args(s, db)), new RegExp(CANNOT_PROCESS.replace(/[.]/g, "\\.")));
  assert.deepEqual([s.reversals.length, s.payouts.length], [0, 0]);
}

// 7. A GBP balance: the fee in US$ on the amount in US$, the payout X less what the reversal took in GBP.
{
  const rate = 0.758366;
  const s = fakeStripe({ currency: "gbp", rate, transfers: [transfer("tr_gb", 200_000)], available: 151_673 });
  const db = fakeDb();
  const payout = await withdrawWithFee(args(s, db, { accountId: "acct_gb", country: "GB", amount: 75_836, currency: "gbp" }));
  assert.equal(s.platform, 770, "TSC gains the US$ fee: 0.75% + 25¢ on US$1,000.00");
  assert.equal(s.reversals[0].local, 584);
  assert.equal(payout.amount, 75_836 - 584, "the payout is X less the GBP the reversal took");
  assert.equal(s.balance, 151_673 - 75_836, "the factory's balance goes down by exactly X");
}

// 8. Many transfers: Stripe is read only as far back as the fee needs, newest first.
{
  const many = Array.from({ length: 300 }, (_, i) => transfer(`tr_${i}`, 100));
  const s = fakeStripe({ transfers: many, available: 30_000 });
  const db = fakeDb();
  const payout = await withdrawWithFee(args(s, db, { amount: 30_000 }));
  const fee = withdrawalFee({ provider: "stripe", amountCents: 30_000, country: "US" }).feeCents;
  assert.equal(payout.amount, 30_000 - fee);
  assert.equal(s.reads, Math.ceil(fee / 100), "one read per transfer the fee uses, not one per transfer");
  assert.deepEqual(s.reversals.map((r) => r.transfer), ["tr_299", "tr_298", "tr_297", "tr_296"].slice(0, Math.ceil(fee / 100)));
}

// 9. Under Stripe's minimum payout once the fee is taken: refused before anything moves.
{
  const rate = 0.758366;
  const s = fakeStripe({ currency: "gbp", rate, transfers: [transfer("tr_gb", 20_000)], available: 15_000 });
  const db = fakeDb();
  const gb = (amount, requestId = REQUEST) => args(s, db, { accountId: "acct_gb", country: "GB", amount, currency: "gbp", requestId });
  for (const pence of [25, 30, 119]) {
    await assert.rejects(withdrawWithFee(gb(pence, randomUUID())), /^Error: The minimum withdrawal is £1\.20\.$/);
  }
  assert.deepEqual([s.reversals.length, s.payouts.length, s.platform, s.reads], [0, 0, 0, 3], "nothing reversed or sent");
  // £1.20 is the first amount that leaves Stripe's £1.00.
  const fee = stripeWithdrawalFee({ amountMinor: 120, currency: "gbp", country: "GB", localPerUsd: rate });
  assert.equal(120 - fee.feeLocalEstimate, STRIPE_MINIMUM_PAYOUT.gbp);
  const payout = await withdrawWithFee(gb(120));
  assert.equal(payout.amount, 100);
}

// 10. Two tabs, both read the whole balance before either went: the second is told the balance in the dialog's words, and keeps no fee.
{
  // The second tab's reversal finds the balance gone.
  const s = fakeStripe({ transfers: [transfer("tr_a", 100_000)], available: 0 });
  s.staleBalance = 100_000;
  const db = fakeDb();
  await assert.rejects(withdrawWithFee(args(s, db)), /^Error: You can withdraw up to \$0\.00\.$/);
  assert.deepEqual([s.reversals.length, s.platform], [0, 0]);
  assert.equal(db.rows[0].reason, "You can withdraw up to $0.00.");
  // The second tab's reversal goes, its payout finds the balance gone: the fee goes back.
  const s2 = fakeStripe({ transfers: [transfer("tr_a", 100_000)], available: 50_000 });
  s2.staleBalance = 100_000;
  const db2 = fakeDb();
  await assert.rejects(withdrawWithFee(args(s2, db2)), /^Error: You can withdraw up to \$500\.00\.$/);
  assert.deepEqual([s2.reversals.length, s2.returned.length, s2.platform, s2.balance], [1, 1, 0, 50_000], "the fee went back");
  assert.equal(db2.rows[0].state, "fee_returned");
}

// 11. Pressed again in the same dialog after a refusal with no sentence: a fresh attempt, not the old answer.
{
  const refused = Object.assign(new Error("Payouts are temporarily paused"), { statusCode: 400, code: "payouts_not_allowed" });
  const s = fakeStripe({ transfers: [transfer("tr_a", 100_000)], available: 100_000, payoutFails: [refused] });
  const db = fakeDb();
  await assert.rejects(withdrawWithFee(args(s, db)), /temporarily paused/);
  assert.deepEqual([db.rows[0].state, db.rows[0].reason], ["fee_returned", null]);
  const payout = await withdrawWithFee(args(s, db));
  assert.equal(payout.amount, 100_000 - usFee);
  assert.equal(db.rows.length, 2, "a new row, so new idempotency keys");
  assert.equal(s.platform, usFee, "one fee kept: the first went back");
  assert.equal((await withdrawWithFee(args(s, db))).id, payout.id, "and a resend after it went is the same payout");
}

// 12. A payout that fails (or is cancelled) before its row was marked paid out: the fee still goes back, once.
{
  for (const status of ["failed", "canceled"]) {
    const s = fakeStripe({ transfers: [transfer("tr_a", 100_000)], available: 100_000 });
    const db = fakeDb();
    const payout = await withdrawWithFee(args(s, db));
    // As if the call died between Stripe's payout and its own record of it.
    Object.assign(db.rows[0], { state: "fee_taken", payout_id: null, payout_minor: null });
    s.payouts[0].status = status;
    const event = { ...s.payouts[0], status };
    // Its call still holds it: Stripe is asked to send the event again.
    db.rows[0].lease_until = new Date(Date.now() + 60_000).toISOString();
    await assert.rejects(returnFeeOnFailedPayout({ stripe: s.api, db, payout: event }), /still being processed/);
    assert.equal(s.returned.length, 0);
    // The call died (lease lapsed): settled from the event.
    db.rows[0].lease_until = new Date(Date.now() - 1000).toISOString();
    assert.equal(await returnFeeOnFailedPayout({ stripe: s.api, db, payout: event }), true);
    assert.equal(await returnFeeOnFailedPayout({ stripe: s.api, db, payout: event }), false, "once");
    assert.deepEqual([s.returned.length, s.platform, db.rows[0].state], [1, 0, "fee_returned"]);
    assert.equal(payout.amount, 100_000 - usFee);
  }
}

// 13. Two tabs withdraw the whole US$35.20: the losing tab is told what it can
// still withdraw, not the balance read between the other tab's fee and its payout.
{
  const whole = 3520;
  const fee = stripeWithdrawalFee({ amountMinor: whole, currency: "usd", country: "US", localPerUsd: 1 }).feeCents;
  // The other tab's row: its fee taken, its payout of the rest still to go.
  const otherTab = () => ({ id: randomUUID(), org_id: "org", stripe_account_id: "acct_us", request_key: "withdraw-other-tab", request_id: OTHER,
    amount_minor: whole, currency: "USD", destination: null, fee_cents: fee, fee_local_minor: fee, reversals: [], payout_id: null,
    payout_minor: null, state: "fee_taken", reason: null, lease_until: new Date(Date.now() + 60_000).toISOString() });
  const upToNothing = /^Error: You can withdraw up to \$0\.00\.$/;

  // Seen before this tab takes a fee, the other tab's fee taken or not yet: refused at once, nothing reversed.
  for (const [state, balance] of [["claimed", whole], ["fee_taken", whole - fee]]) {
    const s = fakeStripe({ transfers: [transfer("tr_a", 6500)], available: balance });
    const db = fakeDb();
    db.rows.push(state === "claimed" ? { ...otherTab(), state, fee_cents: null, fee_local_minor: null } : otherTab());
    await assert.rejects(withdrawWithFee(args(s, db, { amount: whole })), upToNothing);
    assert.deepEqual([s.reversals.length, s.payouts.length, s.platform], [0, 0, 0]);
  }

  // Seen only after this tab's fee went and its payout was refused: the fee goes back, and the words are the same.
  const s2 = fakeStripe({ transfers: [transfer("tr_a", 6500)], available: whole - fee });
  s2.staleBalance = whole;
  const db2 = fakeDb();
  const reverse = s2.api.transfers.createReversal;
  s2.api.transfers.createReversal = async (...call) => {
    if (!db2.rows.some((row) => row.request_key === "withdraw-other-tab")) db2.rows.push(otherTab());
    return reverse(...call);
  };
  await assert.rejects(withdrawWithFee(args(s2, db2, { amount: whole })), upToNothing);
  assert.deepEqual([s2.reversals.length, s2.returned.length, s2.platform, s2.balance], [1, 1, 0, whole - fee], "the fee went back");
  assert.equal(db2.rows.find((row) => row.request_key !== "withdraw-other-tab").reason, "You can withdraw up to $0.00.");
}

// 14. A payout that fails or is cancelled with no webhook (unsubscribed, or
// missed): the next balance read or withdrawal gives the fee back, once,
// whichever of it and the webhook comes first. Stripe slow: the page waits no
// longer than the budget. Older than 14 days, or still on its way: untouched.
for (const status of ["failed", "canceled"]) {
  for (const first of ["sweep", "webhook"]) {
    const s = fakeStripe({ transfers: [transfer("tr_a", 100_000)], available: 100_000 });
    const db = fakeDb();
    const payout = await withdrawWithFee(args(s, db));
    await refreshPayouts({ stripe: s.api, db, accountId: "acct_us" });
    assert.equal(s.returned.length, 0, "a payout on its way keeps the fee");
    assert.equal(s.returned.length, 0);
    s.payouts[0].status = status;
    s.balance += s.payouts[0].amount;
    const event = { ...payout, id: s.payouts[0].id, status };
    if (first === "sweep") {
      await refreshPayouts({ stripe: s.api, db, accountId: "acct_us" });
      assert.equal(s.returned.length, 1, `${status}: the payout read gives the fee back`);
      assert.equal(await returnFeeOnFailedPayout({ stripe: s.api, db, payout: event }), false, `${status}: the late webhook gives nothing twice`);
    } else {
      assert.equal(await returnFeeOnFailedPayout({ stripe: s.api, db, payout: event }), true);
      await refreshPayouts({ stripe: s.api, db, accountId: "acct_us" });
      assert.equal(s.returned.length, 1, `${status}: the read after the webhook gives nothing twice`);
    }
    await refreshPayouts({ stripe: s.api, db, accountId: "acct_us" });
    assert.deepEqual([s.returned.length, s.platform, s.balance, db.rows[0].state], [1, 0, 100_000, "fee_returned"], `${status} (${first} first): whole again, once`);
  }
}
{
  // Both at the same moment: one transfer back.
  const s = fakeStripe({ transfers: [transfer("tr_a", 100_000)], available: 100_000 });
  const db = fakeDb();
  const payout = await withdrawWithFee(args(s, db));
  s.payouts[0].status = "failed";
  await Promise.all([
    refreshPayouts({ stripe: s.api, db, accountId: "acct_us" }),
    returnFeeOnFailedPayout({ stripe: s.api, db, payout: { ...payout, id: s.payouts[0].id, status: "failed" } }),
  ]);
  assert.deepEqual([s.returned.length, s.platform], [1, 0], "a webhook and a read together: one transfer back");
}
{
  // Stripe never answers: the read goes on after the budget, with nothing changed.
  const s = fakeStripe({ transfers: [transfer("tr_a", 100_000)], available: 100_000 });
  const db = fakeDb();
  await withdrawWithFee(args(s, db));
  s.payouts[0].status = "failed";
  s.slowPayouts = true;
  const started = Date.now();
  assert.equal(await refreshPayouts({ stripe: s.api, db, accountId: "acct_us", budgetMs: 50 }), 0, "nothing read in time");
  assert.ok(Date.now() - started < 1000, "the page is not held up");
  assert.equal(db.rows[0].state, "paid_out", "tried again next time");
  // Stripe erroring: the same, no throw.
  s.slowPayouts = false;
  s.api.payouts.retrieve = async () => { throw new Error("Stripe is down"); };
  assert.equal(await refreshPayouts({ stripe: s.api, db, accountId: "acct_us" }), 0, "Stripe erroring: nothing read, no throw");
  // Older than 14 days: not looked up.
  s.api.payouts.retrieve = async (id) => structuredClone(s.payouts.find((p) => p.id === id));
  db.rows[0].created_at = new Date(Date.now() - 15 * 86_400_000).toISOString();
  Object.assign(db.rows[0], { payout_status: "paid", payout_arrives_on: new Date(Date.now() - 13 * 86_400_000).toISOString().slice(0, 10) });
  s.payoutReads = 0;
  assert.equal(await refreshPayouts({ stripe: s.api, db, accountId: "acct_us" }), 0, "older than 14 days and arrived: not read");
  assert.equal(db.rows[0].state, "paid_out");
}

// 15. Refunds and lost disputes (20261121200000): a refund staff make in
// Stripe is recorded at Stripe's amount and never made bigger; a lost
// dispute is recorded as lost, with Stripe's fee.
{
  const { applyChargeRefund, applyDispute, recordChargeDispute, refundCancelledPayment, disputeFeeCents } = await import("../api/_stripe.js");
  const payment = { id: "pay-r", state: "confirmed", order_id: "o-r", stripe_payment_intent_id: "pi_r", stripe_charge_id: "ch_r", refunded_cents: 0 };
  const refundDb = () => {
    const calls = [];
    return {
      calls,
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { ...payment }, error: null }) }) }) }),
      rpc: async (name, args) => { calls.push([name, args]); return { data: { ...payment }, error: null }; },
    };
  };
  const refundStripe = (refunds) => ({
    made: [],
    refunds: {
      list: async () => ({ data: refunds }),
      create: async function create(args) { throw new Error(`refunds.create must not be called: ${JSON.stringify(args)}`); },
    },
  });
  // Staff refund $50.00 of a $992.08 charge (F2): recorded as $50.00; nothing more is refunded.
  {
    const db = refundDb();
    const stripe = refundStripe([{ id: "re_staff", amount: 5000, metadata: {} }]);
    await applyChargeRefund({ stripe, db, charge: { id: "ch_r", payment_intent: "pi_r", amount: 99208, amount_refunded: 5000, refunded: false } });
    assert.deepEqual(db.calls, [["record_payment_refund_amount", { target_payment: "pay-r", payment_intent: "pi_r", refunded_cents: 5000 }]],
      "a partial staff refund: its amount recorded, no refunds.create");
  }
  // Refunded in full by staff: the amount too (the database decides: Due again before approval, the step stays done after).
  {
    const db = refundDb();
    await applyChargeRefund({ stripe: refundStripe([{ id: "re_staff", amount: 99208, metadata: {} }]), db,
      charge: { id: "ch_r", payment_intent: "pi_r", amount: 99208, amount_refunded: 99208, refunded: true } });
    assert.deepEqual(db.calls.map(([name, args]) => [name, args.refunded_cents]), [["record_payment_refund_amount", 99208]], "a full staff refund: the amount");
  }
  // Our own refund of a stray intent keeps its reason.
  {
    const db = refundDb();
    await applyChargeRefund({ stripe: refundStripe([{ id: "re_ours", amount: 1000, metadata: { tsc_problem: "amount_changed" } }]), db,
      charge: { id: "ch_r", payment_intent: "pi_r", amount: 1000, amount_refunded: 1000, refunded: true } });
    assert.deepEqual(db.calls[0][0], "record_payment_refunded");
    assert.match(db.calls[0][1].reason, /The amount changed while you were paying/);
  }
  // Round 23 (I-a): our own refund for a reason with no sentence of its own is
  // never recorded as "The payment was refunded." (a refund made in Stripe,
  // which may be funded again if it fails), but as not needed any more.
  {
    const db = refundDb();
    await applyChargeRefund({ stripe: refundStripe([{ id: "re_ours", amount: 1000, metadata: { tsc_problem: "order_completed" } }]), db,
      charge: { id: "ch_r", payment_intent: "pi_r", amount: 1000, amount_refunded: 1000, refunded: true } });
    assert.equal(db.calls[0][0], "record_payment_refunded");
    assert.equal(db.calls[0][1].reason, "This payment was not needed any more. You were refunded.", "an unlisted reason of ours is never REFUNDED");
  }
  // The server never refunds the rest of a charge on its own.
  {
    const source = (await import("node:fs")).readFileSync(new URL("../api/_stripe.js", import.meta.url), "utf8");
    const body = source.slice(source.indexOf("export async function applyChargeRefund"), source.indexOf("/** What the brand reads when a cancelled order"));
    assert.doesNotMatch(body, /refunds\.create/, "applyChargeRefund makes no refund");
  }
  // A cancelled order's held money after staff refunded part of it: only the rest is refunded.
  {
    const calls = [];
    const db = { rpc: async (name, args) => { calls.push([name, args]); return { data: name === "claim_cancellation_refund" ? { payment_id: "pay-r", order_id: "o-r", intent: "pi_r", key: "k-1" } : null, error: null }; } };
    const made = [];
    const stripe = {
      refunds: { list: async () => ({ data: [{ id: "re_staff", amount: 5000, status: "succeeded", metadata: {} }] }),
        create: async (args) => { made.push(args); return { id: "re_rest", status: "succeeded" }; } },
      paymentIntents: { retrieve: async () => ({ id: "pi_r", amount_received: 99208 }) },
    };
    assert.equal(await refundCancelledPayment({ stripe, db, paymentId: "pay-r" }), "refunded");
    assert.equal(made.length, 1, "the rest is refunded");
    assert.equal(made[0].amount, undefined, "with no amount: Stripe refunds what is left, never the whole charge again");
  }
  // Disputes: lost is recorded as lost, with Stripe's fee; won lifts the hold; open holds.
  {
    const lost = { id: "du_l", status: "lost", amount: 99208, balance_transactions: [{ fee: 1500, amount: -99208 }] };
    assert.equal(disputeFeeCents(lost), 1500);
    assert.equal(disputeFeeCents({ balance_transactions: [] }), null);
    const calls = [];
    const db = { rpc: async (name, args) => { calls.push([name, args]); return { data: null, error: null }; } };
    assert.equal(await applyDispute({ db, paymentId: "pay-d", dispute: lost }), false, "a lost dispute is no longer on hold");
    assert.deepEqual(withoutReview(calls), [["record_payment_dispute_lost", { target_payment: "pay-d", dispute_id: "du_l", lost_cents: 99208, fee_cents: 1500 }]]);
    calls.length = 0;
    // Fix round 34: the charge carries no `dispute` (Stripe's typings at the
    // SDK's API version): found by charge.
    const stripe = { disputes: { retrieve: async () => { throw new Error("no id to retrieve by"); },
      list: async ({ charge, limit }) => ({ data: charge === "ch_d" && limit === 1 ? [lost] : [] }) } };
    await recordChargeDispute({ stripe, db, paymentId: "pay-d", charge: { id: "ch_d", disputed: true } });
    assert.equal(withoutReview(calls)[0][0], "record_payment_dispute_lost", "a charge read later (no webhook) records the loss too");
    assert.equal(withoutReview(calls)[0][1].lost_cents, 99208, "R34: at the amount lost");
    // Won, found by charge: the hold is lifted, never set again.
    calls.length = 0;
    const won = { disputes: { list: async () => ({ data: [{ id: "du_w", status: "won" }] }) } };
    assert.equal(await recordChargeDispute({ stripe: won, db, paymentId: "pay-d", charge: { id: "ch_d", disputed: true } }), null, "R34: a won dispute is not a hold");
    assert.deepEqual(withoutReview(calls), [["record_payment_disputed", { target_payment: "pay-d", disputed: false }]]);
    // The id, when Stripe does send it (it does today, outside the typings), is used as it is.
    const { disputeForCharge } = await import("../api/_stripe.js");
    const byId = { disputes: { retrieve: async (id) => ({ id, status: "won" }), list: async () => { throw new Error("not needed"); } } };
    assert.equal((await disputeForCharge(byId, { id: "ch_d", disputed: true, dispute: "du_x" }))?.id, "du_x", "R34: an id on the charge is retrieved");
    assert.equal(await disputeForCharge(byId, { id: "ch_d", disputed: false }), null, "R34: not disputed: nothing read");
    const none = { disputes: { list: async () => ({ data: [] }) } };
    assert.equal(await disputeForCharge(none, { id: "ch_d", disputed: true }), null, "R34: none found: null (the callers hold it)");
    const hook = (await import("node:fs")).readFileSync(new URL("../api/stripe-webhook.js", import.meta.url), "utf8");
    const disputeCase = hook.slice(hook.indexOf('case "charge.dispute.created"'), hook.indexOf('case "refund.updated"'));
    assert.match(disputeCase, /applyDisputeEvent\(/, "the dispute webhook records a loss as lost, through the charge's newest dispute");
    assert.doesNotMatch(disputeCase, /record_payment_disputed/, "never as 'still disputed'");
  }
  // Fix round 35 (R34-1): an inquiry, then a chargeback, then the inquiry's
  // warning_closed arriving last: the chargeback's hold stays.
  {
    const { applyDisputeEvent } = await import("../api/_stripe.js");
    assert.equal(typeof applyDisputeEvent, "function", "R34-1: the webhook's dispute handler");
    const inquiryOpen = { id: "du_inq", charge: "ch_i", payment_intent: "pi_i", status: "warning_needs_response" };
    const inquiryClosed = { ...inquiryOpen, status: "warning_closed" };
    const chargeback = { id: "du_cb", charge: "ch_i", payment_intent: "pi_i", status: "needs_response" };
    const run = async ({ charge, disputes, events }) => {
      const calls = [];
      const db = {
        from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "pay-i" }, error: null }) }) }) }),
        rpc: async (name, args) => { calls.push([name, args]); return { data: null, error: null }; },
      };
      const stripe = {
        charges: { retrieve: async (id) => (id === "ch_i" ? charge : null) },
        disputes: {
          retrieve: async (id) => disputes.find((d) => d.id === id),
          list: async ({ charge: c, limit }) => ({ data: c === "ch_i" && limit === 1 ? [disputes.at(-1)] : [] }),
        },
      };
      const held = [];
      for (const event of events) held.push(await applyDisputeEvent({ stripe, db, dispute: event }));
      return { calls, held };
    };
    // The charge names the chargeback (as Stripe sends it today).
    {
      const { calls, held } = await run({ charge: { id: "ch_i", disputed: true, dispute: "du_cb" }, disputes: [inquiryClosed, chargeback],
        events: [inquiryOpen, chargeback, inquiryClosed] });
      assert.deepEqual(held, [true, true, true], "R34-1: the late warning_closed leaves the chargeback's hold");
      assert.deepEqual(calls.at(-1), ["record_payment_disputed", { target_payment: "pay-i", disputed: true }], "R34-1: recorded as still disputed");
    }
    // The charge carries no `dispute`: found by charge, newest first.
    {
      const { calls, held } = await run({ charge: { id: "ch_i", disputed: true }, disputes: [inquiryClosed, chargeback],
        events: [inquiryOpen, chargeback, inquiryClosed] });
      assert.deepEqual(held, [true, true, true], "R34-1: by charge too");
      assert.equal(calls.at(-1)[1].disputed, true);
    }
    // The chargeback lost meanwhile: the late warning_closed records the loss, never a lifted hold.
    {
      const lostCb = { ...chargeback, status: "lost", amount: 5000, balance_transactions: [{ fee: 1500 }] };
      const { calls } = await run({ charge: { id: "ch_i", disputed: true, dispute: "du_cb" }, disputes: [inquiryClosed, lostCb], events: [inquiryClosed] });
      assert.equal(withoutReview(calls)[0][0], "record_payment_dispute_lost", "R34-1: the chargeback's loss decides");
      // One review per dispute (20261125100000): the late inquiry's own review
      // is recorded first, then the chargeback's, whose loss decides.
      assert.deepEqual(calls.filter(([name]) => name === "record_payment_review_dispute").map(([, args]) => args.dispute_id), ["du_inq", "du_cb"],
        "v2: each dispute on its own review");
      assert.equal(withoutReview(calls)[0][1].dispute_id, "du_cb");
    }
    // An inquiry closed with no chargeback after it still lifts the hold.
    {
      const { calls, held } = await run({ charge: { id: "ch_i", disputed: true, dispute: "du_inq" }, disputes: [inquiryClosed], events: [inquiryOpen, inquiryClosed] });
      assert.deepEqual(held, [true, false], "R34-1: a closed inquiry alone lifts the hold");
      assert.deepEqual(calls.at(-1), ["record_payment_disputed", { target_payment: "pay-i", disputed: false }]);
    }
    // The chargeback won: the hold is lifted.
    {
      const won = { ...chargeback, status: "won" };
      const { held } = await run({ charge: { id: "ch_i", disputed: true, dispute: "du_cb" }, disputes: [inquiryClosed, won], events: [won] });
      assert.deepEqual(held, [false], "R34-1: the chargeback won lifts the hold");
    }
  }
}

// 16. Fix round 19 (H1, L5): the charge as it is now decides, never an
// event's copy; a refund that failed lowers the total only when Stripe, read
// again, says so; a refund before the payment is funded records nothing
// until it is (a full one sends the brand back to pay).
{
  const { applyChargeRefund, applyRefundUpdate } = await import("../api/_stripe.js");
  const hook = (await import("node:fs")).readFileSync(new URL("../api/stripe-webhook.js", import.meta.url), "utf8");
  const refundCase = hook.slice(hook.indexOf('case "charge.refunded"'), hook.indexOf('case "charge.dispute.created"'));
  assert.match(refundCase, /stripe\.charges\.retrieve\(event\.data\.object\.id\)/, "charge.refunded reads the charge again from Stripe");
  assert.doesNotMatch(refundCase, /charge: event\.data\.object/, "never records the event's copy");

  const dbFor = (state) => {
    const calls = [];
    return { calls,
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "pay-h", state, order_id: "o-h",
        stripe_payment_intent_id: "pi_h", stripe_charge_id: "ch_h", refunded_cents: 8000 }, error: null }) }) }) }),
      rpc: async (name, args) => { calls.push([name, args]); return { data: { id: "pay-h" }, error: null }; } };
  };
  // amountRefunded: one figure, or a list read in turn (a refund made between two reads).
  const stripeFor = ({ refundStatus = "failed", amountRefunded = 5000 } = {}) => {
    const totals = [].concat(amountRefunded);
    let reads = 0;
    return {
      refunds: { list: async () => ({ data: [{ id: "re_1", metadata: {} }] }), retrieve: async (id) => ({ id, status: refundStatus }),
        create: async () => { throw new Error("no refund is made here"); } },
      charges: { retrieve: async (id) => ({ id, payment_intent: "pi_h", amount: 10700, refunded: false,
        amount_refunded: totals[Math.min(reads++, totals.length - 1)] }) },
    };
  };
  // A refund failed, and Stripe read again agrees: the charge's total then is
  // recorded by the lowering function, then the charge as it is now by the
  // raising one (fix round 20: a refund made between the two is never lost).
  {
    const db = dbFor("confirmed");
    await applyRefundUpdate({ stripe: stripeFor({ amountRefunded: [0, 2000] }), db, refund: { id: "re_1", status: "failed", charge: "ch_h", metadata: {} } });
    assert.deepEqual(db.calls, [["record_payment_refund_failed", { target_payment: "pay-h", payment_intent: "pi_h", refunded_cents: 0 }],
      ["record_payment_refund_amount", { target_payment: "pay-h", payment_intent: "pi_h", refunded_cents: 2000 }]]);
  }
  // Fix round 20: a full refund before approval that failed, the payment no
  // longer naming the charge: record_full_refund_failed decides (funded
  // again, or staff). An old charge refunded again: its staff row goes.
  {
    const calls = [];
    const db = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
      rpc: async (name, args) => { calls.push([name, args]); return { data: { id: "pay-f", stripe_payment_intent_id: "pi_f" }, error: null }; } };
    // Fix round 21: the failed refund's own amount ($570 of a $1,070 charge,
    // $500 lost in a dispute) and what Stripe still counts are passed on.
    const stripe = { refunds: { retrieve: async (id) => ({ id, status: "failed", amount: 57000, metadata: {} }), list: async () => ({ data: [] }) },
      charges: { retrieve: async (id) => ({ id, payment_intent: "pi_f", amount: 107000, amount_captured: 107000, amount_refunded: 0, refunded: false,
        disputed: true }) },
      disputes: { retrieve: async () => { throw new Error("no dispute id on the charge"); },
        list: async ({ charge }) => ({ data: charge === "ch_f" ? [{ id: "du_f", status: "lost", amount: 50000, balance_transactions: [{ fee: 1500 }] }] : [] }) },
      paymentIntents: { retrieve: async (id) => ({ id, metadata: { payment_id: "pay-f" } }) } };
    await applyRefundUpdate({ stripe, db, refund: { id: "re_f", status: "failed", charge: "ch_f", metadata: {} } });
    assert.deepEqual(calls, [["record_full_refund_failed", { target_payment: "pay-f", payment_intent: "pi_f", charge: "ch_f", charged: 107000,
      refunded_now: 0, failed_cents: 57000, lost_cents: 50000, fee_cents: 1500 }]]);
    // A cancelled order's payment keeps its charge: found by it, the same function decides (staff, the brand told).
    calls.length = 0;
    const cancelledDb = { ...db, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "pay-c", state: "cancelled", order_id: "o-c",
      stripe_payment_intent_id: "pi_f", stripe_charge_id: "ch_f", refunded_cents: 0 }, error: null }) }) }) }) };
    await applyRefundUpdate({ stripe, db: cancelledDb, refund: { id: "re_f", status: "failed", charge: "ch_f", metadata: {} } });
    assert.equal(calls[0]?.[0], "record_full_refund_failed", "a cancelled order's failed refund reaches staff");
    assert.equal(calls[0]?.[1].target_payment, "pay-c");
    // Round 22 (I1): TSC's own refund of an extra payment that failed reaches
    // the database too, which never funds the step with it (staff row, cause
    // stray; pinned in money_review_round22_test.sql).
    calls.length = 0;
    const ours = { ...stripe, refunds: { ...stripe.refunds, retrieve: async (id) => ({ id, status: "failed", amount: 10700, metadata: { tsc_problem: "amount_changed" } }) } };
    await applyRefundUpdate({ stripe: ours, db, refund: { id: "re_o", status: "failed", charge: "ch_f", metadata: {} } });
    assert.equal(calls[0]?.[0], "record_full_refund_failed", "a stray intent's failed refund reaches staff");
    // Round 22 (G1): TSC's own refund on a cancelled order (order_cancelled) of
    // the payment's own charge that fails reaches staff and the brand.
    calls.length = 0;
    const ownCancelled = { ...stripe, refunds: { ...stripe.refunds, retrieve: async (id) => ({ id, status: "failed", amount: 10700, metadata: { tsc_problem: "order_cancelled" } }) } };
    await applyRefundUpdate({ stripe: ownCancelled, db: cancelledDb, refund: { id: "re_c", status: "failed", charge: "ch_f", metadata: {} } });
    assert.equal(calls[0]?.[1]?.target_payment, "pay-c", "a cancelled order's own refund that failed reaches record_full_refund_failed");
    calls.length = 0;
    await applyChargeRefund({ stripe, db, charge: { id: "ch_f", payment_intent: "pi_f", amount: 10700, amount_refunded: 10700, refunded: true } });
    assert.deepEqual(calls, [["record_refund_failure_resolved", { payment_intent: "pi_f" }]], "staff refunded the old charge again: the row goes");
    // A sync whose charge read fails keeps the funding (fix round 21).
    const source = (await import("node:fs")).readFileSync(new URL("../api/_stripe.js", import.meta.url), "utf8");
    assert.match(source, /stripe\.charges\.retrieve\(charge\.id\)\.catch\(/, "the charge read after funding never fails the sync");
  }
  // The event says failed, Stripe now says it succeeded: nothing lowered.
  {
    const db = dbFor("confirmed");
    await applyRefundUpdate({ stripe: stripeFor({ refundStatus: "succeeded" }), db, refund: { id: "re_1", status: "failed", charge: "ch_h", metadata: {} } });
    assert.deepEqual(db.calls, [], "a stale failure event lowers nothing");
  }
  // charge.refunded only ever raises (the database ignores a smaller total).
  {
    const db = dbFor("confirmed");
    await applyChargeRefund({ stripe: stripeFor(), db, charge: { id: "ch_h", payment_intent: "pi_h", amount: 10700, amount_refunded: 5000, refunded: false } });
    assert.deepEqual(db.calls.map(([name]) => name), ["record_payment_refund_amount"], "never the lowering function");
  }
  // Before the payment is funded: a partial refund records nothing yet; a full one sends the brand back to pay.
  {
    const db = dbFor("processing");
    await applyChargeRefund({ stripe: stripeFor(), db, charge: { id: "ch_h", payment_intent: "pi_h", amount: 10700, amount_refunded: 10000, refunded: false } });
    assert.deepEqual(db.calls, [], "a $100 refund of a $107 charge is not a full refund, and waits for the funding");
    await applyChargeRefund({ stripe: stripeFor(), db, charge: { id: "ch_h", payment_intent: "pi_h", amount: 10700, amount_refunded: 10700, refunded: true } });
    assert.deepEqual(db.calls.map(([name]) => name), ["record_payment_refunded"], "refunded in full: back to Due");
  }
  // Funded later: the dispute is read again after the payment is recorded (a loss noted while processing is recorded then).
  {
    const source = (await import("node:fs")).readFileSync(new URL("../api/_stripe.js", import.meta.url), "utf8");
    const succeeded = source.slice(source.indexOf('rpc(db, "record_payment_succeeded"'), source.indexOf("return result.payment;", source.indexOf('rpc(db, "record_payment_succeeded"')));
    assert.match(succeeded, /stripe\.charges\.retrieve\(charge\.id\)[\s\S]*now\?\.disputed[\s\S]*recordChargeDispute[\s\S]*applyChargeRefund\(\{ stripe, db, charge: now \}\)/,
      "after funding is saved, the charge is read again: its dispute and any refund made meanwhile are recorded (fix round 20)");
  }
}

// Fix round 30 (G2): "Withdraw full amount" offers what the server allows.
// After a payout came back in EUR the dialog offered $65.13 (EUR 59.26 at the
// indicative rate) and the withdrawal refused anything over $64.99 (the same
// euros at the rate of the newest transfer, rounded down). Both now reckon
// the Stripe money one way (stripeMoneyUsd).
{
  const { stripeMoneyUsd } = await import("../api/_stripe-withdrawals.js");
  const rate = 0.9118; // EUR per US$, as Stripe converted the last transfer
  const stripe = {
    transfers: {
      async *list() { yield { id: "tr_last", currency: "usd", destination_payment: "py_last" }; },
    },
    charges: { retrieve: async () => ({ balance_transaction: { currency: "eur", exchange_rate: rate, amount: 5926 } }) },
  };
  const reach = await stripeMoneyUsd(stripe, "acct_f", [{ amount: 5926, currency: "eur" }], {}, "eur");
  assert.equal(reach.cents, Math.floor(5926 / rate), "the euros at the transfer's rate, rounded down, as gatherOwed reckons them");
  assert.equal(reach.cents, 6499, "$64.99, the server's own limit, not the $65.13 the dialog offered");
  assert.equal(reach.estimated, true);
  // What another open withdrawal holds is left out.
  assert.deepEqual(await stripeMoneyUsd(stripe, "acct_f", [{ amount: 5926, currency: "eur" }, { amount: 300, currency: "usd" }], { eur: 926, usd: 100 }, "eur"),
    { cents: Math.floor(5000 / rate), estimated: true }, "a EUR withdrawal: the euros only; the US$ in the account is not taken by it");
  assert.deepEqual(await stripeMoneyUsd(stripe, "acct_f", [{ amount: 0, currency: "eur" }, { amount: 4200, currency: "usd" }], {}, "usd"), { cents: 4200, estimated: false });
}

// Fix round 31b (1): a EUR account no transfer has ever reached. No rate, so
// the dialog offered the euros at the indicative rate and the withdrawal then
// refused everything (CANNOT_PROCESS). Now neither counts those euros: the
// dialog offers owed money only, and the withdrawal takes it, leaving them.
// (2): EUR and GBP in the account. One withdrawal pays out in the account's
// currency (EUR) only, so only the euros count, not the pounds as well.
{
  const { stripeMoneyUsd } = await import("../api/_stripe-withdrawals.js");
  const noRate = { transfers: { async *list() {} }, charges: { retrieve: async () => null } };
  assert.deepEqual(await stripeMoneyUsd(noRate, "acct_f", [{ amount: 5926, currency: "eur" }], {}, "eur"), { cents: 0, estimated: false },
    "no transfer gives a rate: the euros are not offered (old: the indicative amount, which the server refused)");
  const eurAndGbp = {
    transfers: {
      async *list() {
        yield { id: "tr_eur", currency: "usd", destination_payment: "py_eur" };
        yield { id: "tr_gbp", currency: "usd", destination_payment: "py_gbp" };
      },
    },
    charges: {
      retrieve: async (id) => ({ balance_transaction: id === "py_eur" ? { currency: "eur", exchange_rate: 0.9, amount: 900 } : { currency: "gbp", exchange_rate: 0.8, amount: 800 } }),
    },
  };
  assert.deepEqual(await stripeMoneyUsd(eurAndGbp, "acct_f", [{ amount: 9000, currency: "eur" }, { amount: 8000, currency: "gbp" }], {}, "eur"),
    { cents: 10000, estimated: true }, "EUR and GBP held, paid out in EUR: $100.00 (the euros), not $200.00 (both added together)");
}
{
  // The withdrawal itself divides by the same rate and rounds down.
  const source = (await import("node:fs")).readFileSync(new URL("../api/_stripe-withdrawals.js", import.meta.url), "utf8");
  assert.match(source, /const inStripeUsd = currency === "usd" \? inStripe : Math\.floor\(inStripe \/ rate\);/, "gatherOwed: floor(inStripe / localPerUsd)");
  const connect = (await import("node:fs")).readFileSync(new URL("../api/stripe-connect.js", import.meta.url), "utf8");
  assert.equal((connect.match(/await stripeMoneyUsd\(stripe, accountId, balance\.available, heldElsewhere, account\.default_currency\)/g) ?? []).length, 1,
    "one balance read (owner and member alike) reckons the Stripe part that way, in the currency a withdrawal pays out in");
  assert.match(connect, /oneBalance: true, payoutCurrency: account\?\.default_currency \?\? "usd"/, "the withdrawal pays out in that same currency");
  assert(!/displayFx/.test(source.slice(source.indexOf("export async function stripeMoneyUsd"), source.indexOf("async function carryOut("))), "never the indicative rate for what Withdraw can reach");
}

// M1. The "owes TSC" rule on every Stripe road. The current account withdraws
// only the one balance in US$ (a non-US$ amount there is refused before
// anything is read); a previous account's own Stripe money leaves only what
// the debt does not need.
{
  const connect = (await import("node:fs")).readFileSync(new URL("../api/stripe-connect.js", import.meta.url), "utf8");
  const withdraw = connect.slice(connect.indexOf('if (action === "withdraw")'), connect.indexOf("// Also applies to accounts created before"));
  assert.match(withdraw, /if \(String\(currency \?\? ""\)\.toLowerCase\(\) !== "usd"\) return reply\(response, 422/, "withdraw: a non-US$ currency is refused");
  assert.match(withdraw, /oneBalance: true/, "withdraw: always the one balance (gatherOwed checks the debt)");
  // Debt $300, owed earnings on Stripe steps $100: $200 uncovered must stay. $1,000 in the old account: up to $800.
  const owes = { any_cents: -20_000, stripe_cents: -20_000, debt_cents: 30_000 };
  {
    const s = fakeStripe({ transfers: [transfer("tr_a", 100_000)], available: 100_000 });
    const db = fakeDb({ reach: owes });
    await assert.rejects(withdrawWithFee(args(s, db, { accountId: "acct_old" })), /^Error: You can withdraw up to \$800\.00\.$/);
    assert.deepEqual([s.reversals.length, s.payouts.length, db.rows.length], [0, 0, 0], "nothing claimed or moved");
    const payout = await withdrawWithFee(args(s, db, { accountId: "acct_old", amount: 80_000, requestId: OTHER }));
    assert.equal(s.payouts.length, 1, "what the debt leaves still goes");
    assert.ok(payout.amount < 80_000);
  }
  {
    // In GBP at 0.8: $200 uncovered is £160; £500 held: up to £340.
    const s = fakeStripe({ currency: "gbp", rate: 0.8, transfers: [transfer("tr_gb", 100_000)], available: 50_000 });
    await assert.rejects(withdrawWithFee(args(s, fakeDb({ reach: owes }), { accountId: "acct_old", country: "GB", amount: 50_000, currency: "gbp" })),
      /^Error: You can withdraw up to £340\.00\.$/);
  }
  {
    // The debt covered by earnings TSC still holds: the old account is free.
    const s = fakeStripe({ transfers: [transfer("tr_a", 100_000)], available: 100_000 });
    await withdrawWithFee(args(s, fakeDb({ reach: { any_cents: 5_000, stripe_cents: 5_000, debt_cents: 30_000 } }), { accountId: "acct_old" }));
    assert.equal(s.payouts.length, 1);
  }
  {
    // The rule cannot be read: refused, never skipped.
    const s = fakeStripe({ transfers: [transfer("tr_a", 100_000)], available: 100_000 });
    await assert.rejects(withdrawWithFee(args(s, fakeDb({ reach: null }), { accountId: "acct_old" })), new RegExp(CANNOT_PROCESS.replace(/[.]/g, "\\.")));
    assert.equal(s.payouts.length, 0);
  }
}

console.log("stripe withdrawals: the fee is taken once, given back when nothing went, refused when too small; refunds recorded, never added to");
