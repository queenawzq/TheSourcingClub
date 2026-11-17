// A withdrawal from a factory's Stripe balance pays Stripe's payout fee
// exactly once: taken back by partial transfer reversals (newest first,
// spread over several), then X − fee paid out; given back when the payout is
// refused or fails; never twice on a retry, a crash or a double press.
// With a fake Stripe and a fake database. Run: node scripts/check-stripe-withdrawals.mjs
import assert from "node:assert/strict";
import { CANNOT_PROCESS, IN_PROGRESS, returnFeeOnFailedPayout, withdrawWithFee } from "../api/_stripe-withdrawals.js";
import { withdrawalFee } from "../src/shared/withdrawal-fees.mjs";

const REQUEST = "b1f9fd8c-76bd-43a7-ad48-502ebed382b3";
const OTHER = "c2f9fd8c-76bd-43a7-ad48-502ebed382b4";

/** The stripe_withdrawals table and its two claim functions, in memory. */
function fakeDb() {
  const rows = [];
  let n = 0;
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
          row = { id: `w${(n += 1)}`, org_id: args.target_org, stripe_account_id: args.account, request_key: args.key, request_id: args.request,
            amount_minor: args.amount, currency: args.in_currency.toUpperCase(), destination: args.to_destination, fee_cents: null,
            fee_local_minor: null, reversals: [], payout_id: null, payout_minor: null, state: "claimed", reason: null, lease_until: null };
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
    reversals: [],
    payouts: [],
    returned: [],
    keys: new Map(),
  };
  const once = (key, make) => { if (!s.keys.has(key)) s.keys.set(key, make()); return s.keys.get(key); };
  const list = (items) => ({ async *[Symbol.asyncIterator]() { yield* items; } });
  s.api = {
    accounts: { async update() {}, async retrieveExternalAccount() { return null; } },
    balance: { async retrieve() { return { available: [{ currency, amount: s.balance }] }; } },
    transfers: {
      list: () => list([...transfers].reverse()),
      listReversals: (id) => list(s.reversals.filter((r) => r.transfer === id)),
      async createReversal(id, params, { idempotencyKey }) {
        return once(idempotencyKey, () => {
          const transfer = transfers.find((t) => t.id === id);
          assert.ok(transfer.amount - transfer.amount_reversed >= params.amount, "never more than the transfer has left");
          transfer.amount_reversed += params.amount;
          const local = Math.round(params.amount * rate);
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
    charges: { async retrieve() { return { balance_transaction: { currency, exchange_rate: currency === "usd" ? null : rate } }; } },
    refunds: { async retrieve(id) { const r = s.reversals.find((x) => x.destination_payment_refund === id); return { balance_transaction: { currency, amount: -r.local } }; } },
    payouts: {
      async list() { return { data: s.payouts }; },
      async create(params, { idempotencyKey }) {
        const failure = payoutFails.shift();
        if (failure) throw failure;
        return once(idempotencyKey, () => {
          assert.ok(params.amount <= s.balance, "Stripe enforces the available balance");
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
  await assert.rejects(withdrawWithFee(args(s, db, { amount: 26 })), /^Error: This payment of US\$0\.26 is too small: the fee to send it is US\$0\.26, so nothing would arrive\. Nothing was sent\.$/);
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
  await assert.rejects(withdrawWithFee(args(s, db, { requestId: OTHER })), /more than the available balance/);
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

console.log("stripe withdrawals: the fee is taken once, given back when nothing went, refused when too small");
