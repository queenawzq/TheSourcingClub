/**
 * A factory's withdrawal is paid once, never more than asked, and TSC pays no
 * fee. Runs the real core (api/_withdrawals.js) and the real Wise adapter's
 * quote against a pretend provider and a pretend database: no stack, no keys.
 * What the database refuses (owner only, balance, one open request, staff
 * only) is in supabase/tests/factory_withdrawals_test.sql.
 *
 * The evasions, written before the code: TSC's provider balance short; a
 * provider that adds its fee on top; a fee as large as the amount; a timeout
 * after the provider took it (press again: same key); a certain refusal
 * replayed by the next press (it gets a new key: requeue).
 */
import assert from "node:assert/strict";
import { BACK_IN_BALANCE, REFERENCE_MAX, approveWithdrawal, previewWithdrawal, withdrawalReference } from "../api/_withdrawals.js";
import { wiseAdapter } from "../api/_withdrawal-adapters.js";
import { PayoutFailure } from "../api/_payout-provider.js";
import { CANT_PAY_FROM_BALANCE, wiseFrom } from "../api/_wise.js";
import { WITHDRAWAL_FAILED_NOTE, askedWithdrawalRows, figuresByPayment, staffBankNote, summaryFrom, withdrawReach, withdrawalRows } from "../src/app/order/payment-summary.mjs";

function world({ balance = 100000, fee = 80, payFails = null, status = "paid", feeOnTop = false } = {}) {
  const recorded = [];
  const paid = [];
  let claim = { withdrawal_id: "w1", key: "key-1", resumed: false, provider: "paypal", provider_ref: null, amount_cents: 6500, currency: "USD", account_id: "a1", paypal_email: "f@example.com" };
  const db = {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { country_code: "CN" }, error: null }) }) }) }),
    rpc: async (name, args) => {
      assert.equal(name, "record_withdrawal");
      recorded.push(args);
      if (args.ref) claim = { ...claim, provider_ref: args.ref };
      if (args.outcome === "requeue") claim = { ...claim, key: `key-${recorded.filter((r) => r.outcome === "requeue").length + 1}` };
      return { data: {}, error: null };
    },
  };
  const caller = { rpc: async (name) => (assert.equal(name, "claim_withdrawal"), { data: claim, error: null }) };
  const adapter = {
    provider: "paypal", label: "Fake",
    balance: async () => balance,
    quote: async (_client, ctx) => ({ feeCents: fee, leavesCents: feeOnTop ? ctx.amountCents + fee : ctx.amountCents, receivesMinor: ctx.amountCents - fee, receivesCurrency: "USD", quote: null }),
    pay: async (_client, ctx, quote) => {
      paid.push({ key: ctx.key, amount: quote.receivesMinor });
      if (payFails) { const failure = payFails; payFails = null; throw failure; }
      return { ref: "ref-1" };
    },
    status: async () => ({ state: status, raw: status }),
  };
  return { db, caller, adapter, recorded, paid, client: {} };
}

// Short of money: nothing is sent, the request waits again with a sentence.
{
  const w = world({ balance: 1000 });
  const result = await approveWithdrawal({ ...w, id: "w1" });
  assert.equal(result.done, "short_balance");
  assert.match(result.sentence, /short by \$55\.00/);
  assert.equal(w.paid.length, 0, "nothing paid when the provider is short");
  assert.equal(w.recorded.at(-1).outcome, "requeue");
}

// Paid: the factory gets the amount less the fee, and it is recorded paid.
{
  const w = world();
  const result = await approveWithdrawal({ ...w, id: "w1" });
  assert.equal(result.done, "paid");
  assert.deepEqual(w.paid, [{ key: "key-1", amount: 6420 }]);
  assert.equal(w.recorded[0].outcome, "sent");
  assert.equal(w.recorded[0].fee, 80, "the fee is recorded before the provider is asked");
  assert.equal(w.recorded[0].ref, undefined);
  assert.equal(w.recorded.at(-1).outcome, "paid");
}

// A provider that would add its fee on top: refused, nothing sent.
{
  const w = world({ feeOnTop: true });
  await assert.rejects(approveWithdrawal({ ...w, id: "w1" }), /more than the amount/);
  assert.equal(w.paid.length, 0);
  assert.equal(w.recorded.at(-1).outcome, "requeue");
}

// A fee as large as the amount: refused in a sentence, nothing sent.
{
  const w = world({ fee: 6500 });
  await assert.rejects(approveWithdrawal({ ...w, id: "w1" }), (failure) => failure instanceof PayoutFailure && failure.kind === "too_small");
  assert.equal(w.paid.length, 0);
}

// Timeout after the provider took it: stays paying; the next press uses the same key.
{
  const w = world({ payFails: new PayoutFailure("timeout", "Fake didn't answer.", { unsure: true }) });
  await assert.rejects(approveWithdrawal({ ...w, id: "w1" }), /didn't answer/);
  assert.equal(w.recorded.at(-1).outcome, "sent", "an unsure failure never goes back to waiting");
  await approveWithdrawal({ ...w, id: "w1" });
  assert.deepEqual(w.paid.map((p) => p.key), ["key-1", "key-1"], "same key: the provider answers with the first payment");
}

// A certain refusal: back to waiting under a new key, so it is never replayed.
{
  const w = world({ payFails: new PayoutFailure("refused", "Fake refused this payment. Nothing was sent.") });
  await assert.rejects(approveWithdrawal({ ...w, id: "w1" }), /refused/);
  assert.equal(w.recorded.at(-1).outcome, "requeue");
  await approveWithdrawal({ ...w, id: "w1" });
  assert.deepEqual(w.paid.map((p) => p.key), ["key-1", "key-2"]);
}

// F2 (stage 2 money review): a PayPal / Wise withdrawal that took owed steps
// is paid from TSC's own provider balance, so every brand charge behind its
// held parts is checked in Stripe before the provider is asked. Refunded or
// disputed (not won): nothing is sent, and it is recorded, so the database
// then refuses to approve it and staff decline it.
{
  const withTakes = (w, takes, charges, disputes = {}) => {
    const rpcs = [];
    const db = {
      ...w.db,
      from(table) {
        if (table !== "payment_takes") return w.db.from(table);
        const q = { select: () => q, eq: () => q,
          then: (resolve, reject) => Promise.resolve({ data: takes.map((t) => ({ payment_id: t.payment, order_payments: { stripe_charge_id: t.charge } })), error: null }).then(resolve, reject) };
        return q;
      },
      async rpc(name, args) {
        if (name === "record_withdrawal") return w.db.rpc(name, args);
        rpcs.push([name, args]);
        return { data: null, error: null };
      },
    };
    const stripe = {
      charges: { retrieve: async (id) => ({ id, payment_intent: `pi_${id}`, ...charges[id] }) },
      disputes: { retrieve: async (id) => ({ id, status: disputes[id] ?? "needs_response" }) },
      refunds: { list: async () => ({ data: [{ metadata: {} }] }), create: async () => { throw new Error("no refund here"); } },
    };
    return { db, rpcs, build: () => stripe };
  };
  const clean = { amount_refunded: 0, disputed: false };

  // Disputed: nothing sent, the dispute recorded.
  {
    const w = world();
    const x = withTakes(w, [{ payment: "s1", charge: "ch_ok" }, { payment: "s2", charge: "ch_d" }], { ch_ok: clean, ch_d: { amount_refunded: 0, disputed: true, dispute: "du_1" } });
    await assert.rejects(approveWithdrawal({ ...w, db: x.db, id: "w1", stripeBuild: x.build }), (failure) => failure instanceof PayoutFailure && /disputed/i.test(failure.message));
    assert.equal(w.paid.length, 0, "F2: a disputed charge behind the withdrawal: the provider is never asked");
    assert.deepEqual(x.rpcs.find(([name]) => name === "record_payment_disputed")?.[1], { target_payment: "s2", disputed: true }, "and the dispute is recorded");
    assert.equal(w.recorded.at(-1)?.outcome, "requeue", "the withdrawal goes back to waiting (staff then decline it)");
  }
  // A dispute TSC won does not stop it.
  {
    const w = world();
    const x = withTakes(w, [{ payment: "s1", charge: "ch_w" }], { ch_w: { amount_refunded: 0, disputed: true, dispute: "du_w" } }, { du_w: "won" });
    assert.equal((await approveWithdrawal({ ...w, db: x.db, id: "w1", stripeBuild: x.build })).done, "paid", "a won dispute: paid");
  }
  // Refunded: nothing sent, the refund recorded.
  {
    const w = world();
    const x = withTakes(w, [{ payment: "s1", charge: "ch_r" }], { ch_r: { amount_refunded: 5000, refunded: true, disputed: false } });
    const before = w.db.from;
    let recorded = false;
    x.db.from = (table) => (table === "order_payments"
      ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "s1", state: "confirmed", order_id: "o1", stripe_payment_intent_id: "pi_ch_r", stripe_charge_id: "ch_r" }, error: null }) }) }) }
      : table === "payment_takes" ? withTakes(w, [{ payment: "s1", charge: "ch_r" }], {}).db.from(table) : before(table));
    const rpc = x.db.rpc;
    x.db.rpc = async (name, args) => { if (name === "record_payment_refunded") recorded = true; return rpc(name, args); };
    await assert.rejects(approveWithdrawal({ ...w, db: x.db, id: "w1", stripeBuild: x.build }), (failure) => failure instanceof PayoutFailure && /refunded/i.test(failure.message));
    assert.equal(w.paid.length, 0, "F2: a refunded charge behind the withdrawal: the provider is never asked");
    assert.ok(recorded, "and the refund is recorded");
    assert.equal(w.recorded.at(-1)?.outcome, "requeue", "back to waiting");
  }
  // Stripe can't be read: nothing sent, said in words.
  {
    const w = world();
    const x = withTakes(w, [{ payment: "s1", charge: "ch_x" }], {});
    const broken = { ...x.build(), charges: { retrieve: async () => { throw Object.assign(new Error("down"), { statusCode: 500 }); } } };
    await assert.rejects(approveWithdrawal({ ...w, db: x.db, id: "w1", stripeBuild: () => broken }), (failure) => failure instanceof PayoutFailure && /nothing was sent/i.test(failure.message));
    assert.equal(w.paid.length, 0, "F2: unchecked charges: nothing sent");
  }
  // Pool money only (no takes), or clean charges: paid as before.
  {
    const w = world();
    const x = withTakes(w, [{ payment: "s1", charge: "ch_ok" }], { ch_ok: clean });
    assert.equal((await approveWithdrawal({ ...w, db: x.db, id: "w1", stripeBuild: x.build })).done, "paid", "clean charges: paid");
  }
}

// Dispute events out of order ("closed" before "created"): the webhook reads
// the dispute back from Stripe and records what it is now, never what the
// event's type says, so a dispute won before its "created" arrives never
// holds the step for good (pgTAP pins the database side).
{
  const hook = (await import("node:fs")).readFileSync(new URL("../api/stripe-webhook.js", import.meta.url), "utf8");
  const disputeCase = hook.slice(hook.indexOf('case "charge.dispute.created"'), hook.indexOf('case "charge.dispute.created"') + 1500);
  assert.match(disputeCase, /stripe\.disputes\.retrieve\(event\.data\.object\.id\)/, "the dispute is read back from Stripe");
  assert.doesNotMatch(disputeCase, /disputed\s*=\s*event\.type/, "the event's type never decides");
  assert.match(disputeCase, /\["won", "warning_closed"\]\.includes\(dispute\.status\)/, "only its current status does");
}

// The reference fits every Wise route: GBP takes 18 characters, others fewer or
// other characters. A 23-character one had Wise refuse every UK withdrawal.
{
  const id = "3f9c2b1e-7a4d-4c1b-9e2f-0123456789ab";
  const reference = withdrawalReference(id);
  assert.ok(reference.length <= REFERENCE_MAX && REFERENCE_MAX <= 10, `reference "${reference}" is at most 10 characters`);
  assert.match(reference, /^[A-Za-z0-9-]+$/, "letters, digits and hyphens only");
  assert.equal(reference, "TSCW3F9C2B", "traceable to the withdrawal's id");
  const w = world();
  const sent = [];
  w.adapter.pay = async (_client, ctx) => (sent.push(ctx.reference), { ref: "ref-1" });
  await approveWithdrawal({ ...w, id: "w1" });
  assert.ok(sent[0].length <= REFERENCE_MAX, "the adapter is handed the short reference");
}

// A failed withdrawal has no Pay again: staff read that the amount is back in the
// factory's balance, never "pay again", and the factory's row says the same, without a fee.
{
  const w = world({ status: "failed" });
  w.adapter.status = async () => ({ state: "failed", raw: "FAILED", failure: "PayPal couldn't pay this. Check the factory's PayPal address, then pay again." });
  w.adapter.provider = "paypal";
  assert.equal((await approveWithdrawal({ ...w, id: "w1" })).done, "failed");
  const sentence = w.recorded.at(-1).sentence;
  assert.equal(w.recorded.at(-1).outcome, "failed");
  assert.doesNotMatch(sentence, /pay again/i, sentence);
  assert.match(sentence, /PayPal address/);
  assert.ok(sentence.endsWith(BACK_IN_BALANCE));
  const [row] = askedWithdrawalRows([{ id: "f", status: "failed", amount_cents: 100, currency: "USD", provider: "paypal", fee_cents: 2, receives_minor: 98, reason: sentence }]);
  assert.equal(row.note, WITHDRAWAL_FAILED_NOTE);
  assert.doesNotMatch(row.note, /pay again|Fee/i);
}

// Preview sends nothing.
const asked = "2026-11-17T10:00:00.123456+00:00";
const previewRow = (account, extra = {}) => ({ id: "w1", provider: "paypal", amount_cents: 6500, currency: "USD", account_id: "a1", paid_to_changed_at: asked,
  account: account === null ? null : { method: "paypal", wise_recipient_type: null, payee_changed_at: asked, details_changed_at: asked, ...account }, ...extra });
{
  const w = world();
  const seen = await previewWithdrawal({ ...w, row: previewRow({}) });
  assert.equal(seen.feeCents, 80);
  assert.equal(seen.receivesMinor, 6420);
  assert.equal(w.paid.length, 0);
}

// Made the default after asking: only details_changed_at moves (20261117360000),
// and where a withdrawal goes is its own account, so preview still quotes it.
{
  const w = world();
  const seen = await previewWithdrawal({ ...w, row: previewRow({ details_changed_at: "2026-11-17T11:00:00+00:00" }) });
  assert.equal(seen.feeCents, 80, "made the default after asking");
  assert.equal(w.paid.length, 0);
}

// Preview runs claim_withdrawal's payout_changed check, so staff read it before
// Pay: the account removed, its details changed, or now paid another way.
for (const [why, row] of [
  ["account removed", previewRow(null, { account_id: null })],
  ["payee details changed", previewRow({ payee_changed_at: "2026-11-17T11:00:00+00:00", details_changed_at: "2026-11-17T11:00:00+00:00" })],
  ["now paid by Wise", previewRow({ method: "bank", wise_recipient_type: "swift_code" })],
]) {
  const w = world();
  await assert.rejects(previewWithdrawal({ ...w, row }), (failure) => {
    assert.equal(failure.message, "This factory changed where it is paid since it asked. Decline it, so it can ask again.", why);
    return true;
  });
  assert.equal(w.paid.length, 0, why);
}

// The Wise adapter keeps Wise's fee inside the amount: Wise quotes with its fee on
// top, so it steps down until what leaves TSC's balance fits.
{
  const quotes = [];
  const wise = {
    payoutCurrency: "CNY",
    quote: async ({ amountCents }) => {
      quotes.push(amountCents);
      const fee = 300 + Math.ceil(amountCents * 0.005);
      return { id: `q${quotes.length}`, feeCents: fee, totalCents: amountCents + fee, arrivesCents: amountCents * 7, arrivesCurrency: "CNY", balanceRefused: false };
    },
  };
  const ctx = { amountCents: 6500, currency: "USD", account: { id: "a1", wiseRecipientId: "r1", wiseCurrency: "CNY" }, caller: null, db: null };
  const quote = await wiseAdapter.quote(wise, ctx);
  assert.ok(quote.leavesCents <= 6500, `leaves ${quote.leavesCents}, never more than the amount`);
  assert.equal(quote.feeCents, 6500 - quotes.at(-1), "the fee is the amount less what is sent to the factory");
  assert.ok(quote.feeCents >= 300, "the factory carries Wise's fee");
}

// Under Wise's smallest amount for the route (the sandbox's answer for $5 to a
// Chinese business account, by SWIFT from 9.25 USD): said as the amount, never as
// TSC's balance, which was untouched.
{
  const body = { id: "q", rate: 7, paymentOptions: [{ payIn: "BALANCE", payOut: "SWIFT", disabled: true, sourceAmount: 5, targetAmount: 0, fee: { total: 9.24 },
    disabledReason: { code: "error.quote.sourceAmount.min", message: "The smallest amount you can send is 9.25 USD.", path: "sourceAmount", arguments: [{ limit: "9.25 USD" }] } }] };
  const wise = wiseFrom({ WISE_API_BASE: "https://api.wise-sandbox.com", WISE_API_TOKEN: "t", WISE_PROFILE_ID: "7", WISE_PAYOUT_CURRENCY: "CNY" },
    async () => new Response(JSON.stringify(body), { status: 200 }));
  await assert.rejects(wise.quote({ sourceCurrency: "USD", targetCurrency: "CNY", amountCents: 500, recipientId: "r1" }), (failure) =>
    failure.kind === "too_small" && /smallest transfer to this account is 9\.25 USD/.test(failure.message) && failure.message !== CANT_PAY_FROM_BALANCE);
}

// One figure (D3, 20261120100000): a $65 step in the balance, $40 of it taken
// by a paid PayPal withdrawal with a $0.79 fee. The figures come from the
// server only (factory_balance): $25 Available, $39.21 Paid out; the fee is in
// no figure, and the page never sums payments itself. Changed Nov 20: until
// then balance money read as Paid out whole (earningsSummaryFor), which put
// money the factory could still withdraw under Paid out (IMG 76).
{
  const step = { id: "p1", state: "confirmed", release_requested_at: "2026-11-16", amount_cents: 6500, currency: "USD", withdrawal_pool: true, order: { status: "active" } };
  const figures = { awaiting_cents: 0, available_cents: 2500, pending_cents: 0, paid_out_cents: 4000 - 79,
    rows: [{ payment_id: "p1", figure: "available", amount_cents: 2500 }, { payment_id: "p1", figure: "paid_out", amount_cents: 4000 }] };
  const summary = summaryFrom(figures);
  assert.equal(summary.available, 2500, "the part not withdrawn is Available");
  assert.equal(summary.paid, 3921, "the part withdrawn is Paid out, net of its fee");
  assert.equal(summary.pending, 0);
  assert.equal(summary.total, 6421, "total is the four added up: the step less the fee");
  assert.deepEqual([...figuresByPayment(figures).get("p1")].sort(), ["available", "paid_out"], "the split step is in both figures, each part once");
  assert.deepEqual(summaryFrom(null), { total: undefined, approval: undefined, pending: undefined, paid: undefined }, "no figures yet: nothing guessed");
  // A step released by its withdrawal is not a second, "Bank transfer" withdrawal.
  assert.equal(withdrawalRows([{ ...step, state: "released", released_by: "u", released_note: "Withdrawn" }]).length, 0);
  const rows = askedWithdrawalRows([{ id: "w", status: "paid", amount_cents: 4000, currency: "USD", provider: "paypal", paid_to: "a@b.c", fee_cents: 79, receives_minor: 3921, paid_at: "2026-11-16" }, { id: "x", status: "cancelled", amount_cents: 1, currency: "USD" }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount, -3921, "a paid withdrawal shows what reached the factory");
}

// F6: the history lists each withdrawal once. A step released by one-balance
// withdrawals (PayPal / Wise, or Stripe and PayPal together) is released with
// no Stripe transfer and not in the old pool; its money left on the
// withdrawals' own rows, never on a second "Bank transfer" row.
{
  const base = { id: "p9", state: "released", amount_cents: 10000, currency: "USD", withdrawal_pool: false, stripe_transfer_id: null,
    released_by: "staff-1", released_note: "Withdrawn", order: { brand_org_id: "b" } };
  assert.equal(withdrawalRows([{ ...base, payment_takes: [{ status: "sent", road: "pool" }] }]).length, 0, "taken by a PayPal withdrawal: no extra row");
  assert.equal(withdrawalRows([{ ...base, payment_takes: [{ status: "sent", road: "stripe" }, { status: "sent", road: "pool" }] }]).length, 0,
    "taken by both roads: no extra row");
  assert.equal(withdrawalRows([base]).length, 0, "released as Withdrawn, takes not read: still no extra row");
  assert.equal(staffBankNote({ ...base, payment_takes: [{ status: "sent" }] }), null, "and no \"Reference Withdrawn\"");
  // Paid by staff by hand: still its own row, with the bank's reference.
  const byHand = withdrawalRows([{ ...base, released_note: "BANKREF-1", bank_payouts: { paid_to_bank: "Bank", paid_to_last4: "1234" } }]);
  assert.equal(byHand.length, 1, "a step staff paid by bank still has its row");
  assert.equal(byHand[0].note, "Reference BANKREF-1");
}

// What each method can withdraw (D5): Stripe reaches owed money and the
// factory's own Stripe money (D1); PayPal / Wise reach owed money and pool
// money, never D1. The server's answers come first when the page has them.
{
  const figures = { tsc: { parts: { owed_cleared_cents: 10000, pool_available_cents: 3000 } }, stripe: { available_cents: 2500 } };
  assert.deepEqual(withdrawReach(figures), { stripe: 12500, balance: 13000, estimated: false }, "Stripe: owed + D1; PayPal/Wise: owed + pool, never D1");
  assert.deepEqual(withdrawReach({ parts: { owed_cleared_cents: 10000, pool_available_cents: 3000 } }), { stripe: 10000, balance: 13000, estimated: false },
    "no Stripe account: Stripe reaches only owed money");
  assert.deepEqual(withdrawReach(figures, { stripe_cents: 9000, pool_cents: 11000 }), { stripe: 9000, balance: 11000, estimated: false }, "the server's reach wins");
  assert.deepEqual(withdrawReach(figures, null, 10500), { stripe: 12500, balance: 10500, estimated: false },
    "without the server's reach, my_withdrawal_balance (what request_withdrawal checks) decides PayPal/Wise");
  assert.deepEqual(withdrawReach(figures, { stripe_cents: 9000, pool_cents: 11000, estimated: true }), { stripe: 9000, balance: 11000, estimated: true },
    "a Stripe reach converted from the account's currency is said to be an estimate");
  assert.deepEqual(withdrawReach(null), { stripe: null, balance: null, estimated: false }, "unknown until the figures answer");
}

// The Withdraw dialog never moves a withdrawal to another method by itself:
// when the chosen method stops being offered (a provider switched off while
// it is open), the choice is cleared and Withdraw stays off until the person
// chooses again (Nov 18).
{
  const { readFileSync } = await import("node:fs");
  const form = readFileSync(new URL("../src/app/order/WithdrawFromBalance.jsx", import.meta.url), "utf8");
  assert.ok(form.includes('if (methodId && !choices.some((m) => m.id === methodId)) setMethodId("");'), "a method no longer offered clears the choice");
  assert.ok(!/setMethodId\(\(choices\.find\(\(m\) => m\.id === defaultId\)[^;]*\}, \[offered\]\)/s.test(form), "and never picks another method in its place");
  assert.ok(form.includes('disabled={busy || asking || !method ||'), "Withdraw is off while nothing is chosen");
  assert.ok(form.includes("{methodId ? null : <option value=\"\" />}"), "the dropdown shows nothing chosen");
}

// One balance (20261120100000): the database's figures plus the factory's own
// Stripe money (D1), each dollar in exactly one figure, total the sum of four.
{
  const { balanceFigures } = await import("../api/_balance-figures.js");
  const sum = (f) => f.awaiting_cents + f.available_cents + f.pending_cents + f.paid_out_cents;
  const tsc = (over = {}) => ({ awaiting_cents: 0, available_cents: 0, pending_cents: 0, paid_out_cents: 0, has_method: true, next_cleared_at: null,
    parts: { stripe_released_cents: 0 }, ...over });

  // IMG 75: no method, $1 owed and cleared, no Stripe account: Available $1, Pending $0.
  {
    const f = balanceFigures(tsc({ available_cents: 100, has_method: false }), null, null);
    assert.equal(f.available_cents, 100, "IMG 75: owed money is Available");
    assert.equal(f.pending_cents, 0, "IMG 75: and not Pending");
    assert.equal(f.paid_out_cents, 0);
    assert.equal(f.has_method, false, "the card offers Add withdrawal method");
    assert.equal(f.total_cents, 100);
  }
  // IMG 76: PayPal added; nothing moved: still Available $1, Paid out $0.
  {
    const f = balanceFigures(tsc({ available_cents: 100 }), null, null);
    assert.equal(f.available_cents, 100, "IMG 76: still Available after adding PayPal");
    assert.equal(f.paid_out_cents, 0, "IMG 76: not Paid out");
    assert.equal(f.has_method, true);
  }
  // D1: $80 of steps went to the factory's Stripe account before this change.
  // $50 is still there, $5 is on its way to the bank, $25 reached it; $20 more
  // is clearing in Stripe. Owed on TSC: $100 cleared, $30 clearing; $10 awaiting.
  {
    const db = tsc({ awaiting_cents: 1000, available_cents: 10000, pending_cents: 3000, paid_out_cents: 8000, parts: { stripe_released_cents: 8000 } });
    const stripe = {
      available: [{ amount: 5000, currency: "usd" }],
      pending: [{ amount: 2000, currency: "usd" }],
      onTheirWay: [{ amount: 500, currency: "usd" }],
      payouts: [{ amount: 2500, currency: "usd", paid: true }, { amount: 500, currency: "usd", paid: false }],
    };
    const f = balanceFigures(db, stripe, null);
    assert.equal(f.available_cents, 10000 + 5000, "D1: Stripe's available money is in Available with the owed money");
    assert.equal(f.pending_cents, 3000 + 2000 + 500, "Stripe pending and payouts on their way are Pending");
    assert.equal(f.paid_out_cents, 2500, "Paid out is what reached the bank, not the transfers made to Stripe");
    assert.equal(f.awaiting_cents, 1000);
    assert.equal(f.total_cents, sum(f), "total is the sum of the four");
    assert.equal(f.estimated, false);
  }
  // Non-USD Stripe money is converted and marked estimated; a currency with no
  // rate leaves Stripe out rather than guessing.
  {
    const db = tsc({ available_cents: 1000, paid_out_cents: 500, parts: { stripe_released_cents: 500 } });
    const stripe = { available: [{ amount: 400, currency: "gbp" }], pending: [], onTheirWay: [], payouts: [] };
    const withRate = balanceFigures(db, stripe, { rates: { GBP: 1.25 } });
    assert.equal(withRate.available_cents, 1000 + 500, "GBP converted to US cents");
    assert.equal(withRate.estimated, true, "and said to be an estimate");
    assert.equal(withRate.total_cents, sum(withRate));
    const noRate = balanceFigures(db, stripe, { rates: {} });
    assert.equal(noRate.stripe, null, "no rate: Stripe money is not guessed");
    assert.equal(noRate.available_cents, 1000);
    assert.equal(noRate.paid_out_cents, 500, "and the database's own figures stand");
    assert.equal(noRate.total_cents, sum(noRate));
  }
  // F6: Stripe can't be read. The balance action answers with the database's
  // figures alone (balanceFigures(db, null)): never empty, never guessed.
  {
    const db = tsc({ awaiting_cents: 300, available_cents: 10000, pending_cents: 2000, paid_out_cents: 8000, has_method: true,
      next_cleared_at: "2026-11-22T00:00:00Z", parts: { stripe_released_cents: 8000 } });
    const f = balanceFigures(db, null, null);
    assert.equal(f.stripe, null, "no Stripe part");
    assert.equal(f.estimated, false);
    assert.deepEqual([f.awaiting_cents, f.available_cents, f.pending_cents, f.paid_out_cents], [300, 10000, 2000, 8000],
      "the database's four figures, unchanged (Stripe-transferred steps stay in Paid out)");
    assert.equal(f.total_cents, 300 + 10000 + 2000 + 8000);
    assert.equal(f.has_method, true);
    assert.equal(f.next_cleared_at, "2026-11-22T00:00:00Z");
    assert.equal(f.tsc, db, "the database's own answer is passed through");
    const empty = balanceFigures(null, null, null);
    assert.equal(empty.total_cents, 0, "nothing at all reads as zero, not as an error");
    const connect = (await import("node:fs")).readFileSync(new URL("../api/stripe-connect.js", import.meta.url), "utf8");
    assert.ok(/balanceFigures\(data, null, null\), stripe_unavailable: true/.test(connect), "the balance action falls back to it when Stripe can't be read");
  }
  // Whatever the inputs, total is never computed separately.
  for (const db of [tsc(), tsc({ awaiting_cents: 7, available_cents: 11, pending_cents: 13, paid_out_cents: 17 })]) {
    const f = balanceFigures(db, { available: [], pending: [], onTheirWay: [], payouts: [] }, null);
    assert.equal(f.total_cents, sum(f));
  }
}

// One balance, stage 2 (20261120200000): withdrawing to Stripe from the one
// balance. A fake Stripe and a fake database whose claim_owed_steps claims the
// oldest steps for exactly the amount asked (the database's own rules are
// pinned in supabase/tests/unified_withdraw_test.sql). What this pins is the
// server's side: money already in the factory's Stripe account (D1) first,
// then owed steps; each part transferred from its own charge, exactly the part
// claimed, under a key per step and withdrawal; every charge checked and TSC's
// platform balance checked before any transfer; the payout worked out from
// what the transfers landed as (non-US$ accounts); and nothing claimed is left
// held when the withdrawal is refused.
{
  const { withdrawWithFee, checkStripeWithdrawal, CANNOT_PROCESS: CANNOT } = await import("../api/_stripe-withdrawals.js");
  const { PayoutMethodRefusal } = await import("../api/_stripe-payouts.js");
  const { stripeWithdrawalFee } = await import("../src/shared/withdrawal-fees.mjs");
  const { randomUUID } = await import("node:crypto");

  const iterable = (items) => ({ data: items, has_more: false, async *[Symbol.asyncIterator]() { yield* items; } });

  function oneBalanceWorld({ currency = "usd", rate = 1, d1 = 0, platform = 1_000_000, steps, disputed = [], refunded = [] }) {
    const rows = [];
    const takes = [];
    const calls = [];
    const leased = (row) => row.lease_until && Date.parse(row.lease_until) > Date.now();
    const lease = () => new Date(Date.now() + 120_000).toISOString();
    const left = (step) => step.amount - takes.filter((t) => t.payment_id === step.id && t.status !== "returned").reduce((a, t) => a + t.amount_cents, 0);
    const stripeReach = () => steps.filter((step) => step.charge && step.cleared !== false).reduce((a, step) => a + left(step), 0);
    function table(rowsOf) {
      return () => {
        const filters = [];
        let patch = null;
        const matches = () => rowsOf().filter((row) => filters.every((f) => f(row)));
        const q = {
          select() { return q; },
          update(fields) { patch = fields; return q; },
          eq(column, value) { filters.push((row) => row[column] === value); if (patch) for (const row of matches()) Object.assign(row, structuredClone(patch)); return q; },
          in(column, values) { filters.push((row) => values.includes(row[column])); return q; },
          gte() { return q; },
          not() { return q; },
          order() { return q; },
          limit() { return q; },
          range() { return q; },
          async maybeSingle() { return { data: structuredClone(matches()[0] ?? null), error: null }; },
          then(resolve, reject) { return Promise.resolve({ data: structuredClone(matches()), error: null }).then(resolve, reject); },
        };
        return q;
      };
    }
    const withdrawalsTable = table(() => rows);
    const takesTable = table(() => takes.map((take) => {
      const step = steps.find((s) => s.id === take.payment_id);
      return { ...take, order_payments: { stripe_charge_id: step.charge, order_id: step.order, state: step.refundRecorded ? "failed" : "confirmed",
        disputed_at: step.disputedRecorded ? new Date().toISOString() : null, production_orders: { order_number: step.number ?? "TSC-1" } } };
    }));
    const db = {
      rows, takes, calls,
      from(name) {
        if (name === "stripe_withdrawals") return withdrawalsTable();
        if (name === "payment_takes") return takesTable();
        if (name === "stripe_connect_accounts") return table(() => [])();
        if (name === "order_payments") return table(() => steps.map((step) => ({ id: step.id, state: "confirmed", order_id: step.order,
          stripe_payment_intent_id: `pi_${step.id}`, stripe_charge_id: step.charge })))();
        throw new Error(`unexpected table ${name}`);
      },
      async rpc(name, args) {
        calls.push(name);
        if (name === "claim_stripe_withdrawal") {
          let row = rows.find((r) => r.request_key === args.key);
          if (!row) {
            row = { id: randomUUID(), org_id: args.target_org, stripe_account_id: args.account, request_key: args.key, request_id: args.request,
              amount_minor: args.amount, currency: args.in_currency.toUpperCase(), destination: args.to_destination, fee_cents: null,
              fee_local_minor: null, reversals: [], payout_id: null, payout_minor: null, state: "claimed", reason: null, lease_until: null,
              usd_cents: null, owed_cents: null, d1_minor: null, landed_minor: null, transfers_done_at: null, created_at: new Date().toISOString() };
            rows.push(row);
          }
          if (["claimed", "fee_taken"].includes(row.state) && !leased(row)) {
            row.lease_until = lease();
            return { data: { claimed: true, row: structuredClone(row) }, error: null };
          }
          return { data: { claimed: false, row: structuredClone(row) }, error: null };
        }
        if (name === "claim_abandoned_stripe_withdrawal") return { data: null, error: null };
        if (name === "claim_owed_steps") {
          assert.equal(args.road, "stripe", "the Stripe road claims as stripe");
          const row = rows.find((r) => r.id === args.withdrawal);
          if (!row || row.owed_cents != null) return { data: null, error: { message: "not waiting", code: "22023", hint: "withdrawal_not_waiting" } };
          if (!(args.amount > 0)) return { data: null, error: { message: "Enter an amount to withdraw.", code: "22023", hint: "withdrawal_amount" } };
          if (args.amount > stripeReach()) return { data: null, error: { message: "That is more than your balance.", code: "22023", hint: "withdrawal_over_balance" } };
          let need = args.amount;
          const made = [];
          for (const step of steps) {
            if (need <= 0) break;
            if (!step.charge || step.cleared === false) continue;
            const part = Math.min(left(step), need);
            if (part <= 0) continue;
            const take = { id: randomUUID(), payment_id: step.id, org_id: args.target_org, road: "stripe", stripe_withdrawal_id: row.id,
              amount_cents: part, status: "held", stripe_transfer_id: null, attempted_at: null, created_at: new Date().toISOString() };
            takes.push(take);
            made.push({ take_id: take.id, payment_id: step.id, amount_cents: part, charge_id: step.charge, order_id: step.order });
            need -= part;
          }
          row.owed_cents = args.amount;
          return { data: { claimed_cents: args.amount, takes: made }, error: null };
        }
        if (name === "owed_reachable") return { data: { any_cents: stripeReach(), stripe_cents: stripeReach() }, error: null };
        if (name === "record_take_sent") {
          const take = takes.find((t) => t.id === args.target_take);
          assert.equal(take.status, "held", "only a held take is sent");
          Object.assign(take, { status: "sent", stripe_transfer_id: args.transfer });
          return { data: null, error: null };
        }
        if (name === "return_stripe_takes") {
          // Parts already asked of Stripe are the server's to settle (return_take), never returned here.
          for (const take of takes) if (take.stripe_withdrawal_id === args.target_withdrawal && take.status === "held" && !take.attempted_at) take.status = "returned";
          return { data: null, error: null };
        }
        if (name === "mark_take_attempted") {
          const take = takes.find((t) => t.id === args.target_take);
          take.attempted_at ??= new Date().toISOString();
          return { data: take.attempted_at, error: null };
        }
        if (name === "return_take") {
          const take = takes.find((t) => t.id === args.target_take);
          if (take.status === "held") take.status = "returned";
          return { data: null, error: null };
        }
        if (name === "record_payment_refunded") {
          steps.find((st) => st.id === args.target_payment).refundRecorded = true;
          return { data: null, error: null };
        }
        if (name === "record_payment_disputed") {
          steps.find((s) => s.id === args.target_payment).disputedRecorded = true;
          return { data: null, error: null };
        }
        throw new Error(`unexpected rpc ${name}`);
      },
    };

    const s = { platform, balance: { [currency]: d1 }, transfers: [], reversals: [], payouts: [], keys: new Map() };
    let n = 0;
    const once = (key, make) => {
      if (key && s.keys.has(key)) return s.keys.get(key);
      const made = make();
      if (key) s.keys.set(key, made);
      return made;
    };
    // D1: an older transfer is what put the D1 money there (the fee can be reversed from it).
    if (d1 > 0) s.transfers.push({ id: "tr_old", amount: Math.ceil(d1 / rate), amount_reversed: 0, currency: "usd", destination: "acct_f", destination_payment: "py_old", metadata: {}, local: d1 });
    const refused = (message, code = 402) => Object.assign(new Error(message), { statusCode: code });
    s.failedKeys = new Map();
    const makeTransfer = (params, options) => once(options?.idempotencyKey, () => {
      if (params.source_transaction) {
        if (params.amount > s.platform) throw refused("insufficient available funds");
        s.platform -= params.amount;
      }
      const local = currency === "usd" ? params.amount : Math.round(params.amount * rate);
      const transfer = { id: `tr_${++n}`, ...params, amount_reversed: 0, destination_payment: `py_${n}`, local, key: options?.idempotencyKey };
      s.transfers.push(transfer);
      s.balance[currency] = (s.balance[currency] ?? 0) + local;
      return structuredClone(transfer);
    });
    const api = {
      accounts: { update: async () => ({}), retrieveExternalAccount: async () => null },
      balance: {
        retrieve: async (_params, options) => options?.stripeAccount
          ? { available: Object.entries(s.balance).map(([c, amount]) => ({ currency: c, amount })), pending: [] }
          : { available: [{ currency: "usd", amount: s.platform }], pending: [] },
      },
      transfers: {
        // groupListMisses: Stripe's list by transfer_group not yet showing a transfer just made.
        list: (params) => iterable(params.transfer_group && s.groupListMisses ? [] : [...s.transfers].reverse().filter((t) =>
          (!params.destination || t.destination === params.destination) && (!params.transfer_group || t.transfer_group === params.transfer_group))),
        retrieve: async (id) => structuredClone(s.transfers.find((t) => t.id === id)),
        // onTransfer(params, key) → undefined (made), "timeout" (made, but the answer is lost),
        // or an error to throw (nothing made); an error marked stored is replayed for that key, as Stripe does for 24 h.
        create: async (params, options) => {
          const key = options?.idempotencyKey;
          if (key && s.failedKeys.has(key)) throw s.failedKeys.get(key);
          if (key && s.keys.has(key)) return s.keys.get(key);
          const what = s.onTransfer?.(params, key);
          if (what instanceof Error) {
            if (what.stored && key) s.failedKeys.set(key, what);
            throw what;
          }
          const made = makeTransfer(params, options);
          if (what === "timeout") throw Object.assign(new Error("Stripe did not answer"), { type: "StripeConnectionError" });
          return made;
        },
        listReversals: (id) => iterable(s.reversals.filter((r) => r.transfer === id)),
        createReversal: async (id, params, options) => once(options?.idempotencyKey, () => {
          const transfer = s.transfers.find((t) => t.id === id);
          transfer.amount_reversed += params.amount;
          const local = currency === "usd" ? params.amount : Math.ceil(params.amount * rate);
          s.balance[currency] -= local;
          const reversal = { id: `trr_${++n}`, transfer: id, amount: params.amount, metadata: params.metadata, destination_payment_refund: `pyr_${n}`, local };
          s.reversals.push(reversal);
          return structuredClone(reversal);
        }),
      },
      charges: {
        retrieve: async (id) => {
          if (id.startsWith("py_")) {
            const transfer = s.transfers.find((t) => t.destination_payment === id);
            return { id, balance_transaction: { currency, exchange_rate: currency === "usd" ? 1 : rate, amount: transfer.local } };
          }
          const isRefunded = refunded.includes(id);
          return { id, payment_intent: `pi_${id.slice(3)}`, amount_refunded: isRefunded ? 1 : 0, refunded: isRefunded,
            disputed: disputed.includes(id), dispute: disputed.includes(id) ? `du_${id}` : null };
        },
      },
      disputes: { retrieve: async () => ({ status: "needs_response" }) },
      refunds: {
        list: async () => ({ data: [{ id: "re_1", metadata: {} }] }),
        create: async () => { throw new Error("no refund is made here: the charge is already refunded"); },
        retrieve: async (id) => {
          const reversal = s.reversals.find((r) => r.destination_payment_refund === id);
          return { id, balance_transaction: { currency, amount: -reversal.local } };
        },
      },
      payouts: {
        create: async (params, options) => once(options?.idempotencyKey, () => {
          if (params.amount > (s.balance[params.currency] ?? 0)) throw refused("insufficient funds", 400);
          s.balance[params.currency] -= params.amount;
          const payout = { id: `po_${++n}`, amount: params.amount, currency: params.currency, status: "pending", metadata: params.metadata ?? {} };
          s.payouts.push(payout);
          return structuredClone(payout);
        }),
        list: async () => ({ data: structuredClone([...s.payouts].reverse()) }),
        retrieve: async (id) => structuredClone(s.payouts.find((p) => p.id === id)),
      },
    };
    return { db, stripe: s, api };
  }
  const step = (id, amount, extra = {}) => ({ id, amount, charge: `ch_${id}`, order: `order-${id}`, ...extra });
  const usFee = (amount) => stripeWithdrawalFee({ amountMinor: amount, currency: "usd", country: "US", localPerUsd: 1 }).feeCents;
  const withdraw = (w, amount, extra = {}) => withdrawWithFee({ stripe: w.api, db: w.db, orgId: "org", accountId: "acct_f", country: "US",
    amount, currency: "usd", requestId: randomUUID(), oneBalance: true, payoutCurrency: "usd", transfersActive: true, ...extra });
  const held = (w) => w.db.takes.filter((t) => t.status === "held");

  // Exact amount: $150 from two $100 steps is $100 + $50, each from its own
  // charge, under a key per step and withdrawal; the payout is $150 less the fee.
  {
    const w = oneBalanceWorld({ steps: [step("p1", 10000), step("p2", 10000), step("p3", 10000)] });
    const payout = await withdraw(w, 15000);
    const moved = w.stripe.transfers.map((t) => [t.source_transaction, t.amount]);
    assert.deepEqual(moved, [["ch_p1", 10000], ["ch_p2", 5000]], "exact amount: the oldest step whole, then $50 of the next");
    const row = w.db.rows[0];
    assert.deepEqual(w.stripe.transfers.map((t) => t.key), [`release-p1-${row.id}`, `release-p2-${row.id}`], "one key per step and withdrawal");
    assert.ok(w.stripe.transfers.every((t) => t.metadata?.take_id && t.metadata?.payment_id), "each transfer names its take and step");
    assert.equal(payout.amount, 15000 - usFee(15000), "the payout is the amount less the fee");
    assert.equal(row.owed_cents, 15000, "the row owns its claim");
    assert.equal(row.d1_minor, 0);
    assert.equal(row.landed_minor, 15000);
    assert.equal(row.state, "paid_out");
    assert.equal(held(w).length, 0, "nothing left held");
    assert.deepEqual(w.db.takes.map((t) => [t.payment_id, t.amount_cents, t.status]), [["p1", 10000, "sent"], ["p2", 5000, "sent"]]);
    assert.equal(w.stripe.platform, 1_000_000 - 15000, "TSC's platform balance paid exactly the claimed parts");
    // The $50 left on the step and the newest step are still there for the next withdrawal.
    await withdraw(w, 15000);
    assert.deepEqual(w.stripe.transfers.slice(2).map((t) => [t.source_transaction, t.amount]), [["ch_p2", 5000], ["ch_p3", 10000]],
      "the next withdrawal takes the remainder before the newer step");
  }

  // D1 first: $30 already in the factory's Stripe account, $50 asked: only $20 is claimed and transferred.
  {
    const w = oneBalanceWorld({ d1: 3000, steps: [step("p1", 10000)] });
    const payout = await withdraw(w, 5000);
    assert.deepEqual(w.stripe.transfers.filter((t) => t.source_transaction).map((t) => t.amount), [2000], "D1 money is used first; only the rest is claimed");
    assert.equal(w.db.rows[0].owed_cents, 2000);
    assert.equal(w.db.rows[0].d1_minor, 3000);
    assert.equal(payout.amount, 5000 - usFee(5000));
  }

  // All of it from D1: nothing owed is claimed, nothing transferred.
  {
    const w = oneBalanceWorld({ d1: 9000, steps: [step("p1", 10000)] });
    await withdraw(w, 5000);
    assert.equal(w.stripe.transfers.filter((t) => t.source_transaction).length, 0, "covered by D1: no transfer");
    assert.ok(!w.db.calls.includes("claim_owed_steps"), "and no claim");
    assert.equal(w.db.rows[0].owed_cents, 0);
  }

  // Over what Stripe can reach (D1 + owed steps with a cleared charge): refused
  // naming the reachable amount; nothing claimed, nothing transferred.
  {
    const w = oneBalanceWorld({ d1: 1000, steps: [step("p1", 10000), step("p2", 5000, { charge: null }), step("p3", 2000, { cleared: false })] });
    await assert.rejects(withdraw(w, 11001), (failure) => failure instanceof PayoutMethodRefusal && failure.message === "You can withdraw up to $110.00.");
    assert.equal(w.stripe.transfers.filter((t) => t.source_transaction).length, 0, "nothing transferred");
    assert.equal(held(w).length, 0, "nothing held");
    assert.equal(w.stripe.payouts.length, 0);
    assert.equal(w.db.rows[0].state, "refused");
  }

  // A disputed charge among the claimed steps: nothing is transferred at all,
  // the dispute is recorded, the claim goes back to the balance.
  {
    const w = oneBalanceWorld({ steps: [step("p1", 10000), step("p2", 10000)], disputed: ["ch_p2"] });
    await assert.rejects(withdraw(w, 15000), (failure) => failure.message === CANNOT);
    assert.equal(w.stripe.transfers.length, 0, "every charge is checked before any transfer");
    assert.ok(w.db.calls.includes("record_payment_disputed"), "the dispute is recorded");
    assert.equal(held(w).length, 0, "the claim is returned");
    assert.equal(w.stripe.payouts.length, 0);
  }

  // TSC's platform balance short of the transfers: refused before any transfer.
  {
    const w = oneBalanceWorld({ platform: 14999, steps: [step("p1", 10000), step("p2", 10000)] });
    await assert.rejects(withdraw(w, 15000), (failure) => failure.message === CANNOT);
    assert.equal(w.stripe.transfers.length, 0, "platform short: no transfer");
    assert.equal(held(w).length, 0, "and the claim is returned");
    assert.equal(w.db.rows[0].refusal_cause, "platform_short", "and the row says why, for the staff board");
  }

  // Not verified for transfers: owed money needed, refused, nothing claimed.
  {
    const w = oneBalanceWorld({ steps: [step("p1", 10000)] });
    await assert.rejects(withdraw(w, 5000, { transfersActive: false }), (failure) => failure.message === "Finish payout verification before withdrawing.");
    assert.equal(w.db.takes.length, 0);
  }

  // Fix round 2 (stage 2 money review). Refunded at the click: the charge is
  // checked before any transfer, the refund is recorded, the claim returned.
  {
    const w = oneBalanceWorld({ steps: [step("p1", 10000), step("p2", 10000)], refunded: ["ch_p2"] });
    await assert.rejects(withdraw(w, 15000), (failure) => failure.message === CANNOT);
    assert.equal(w.stripe.transfers.length, 0, "a refunded charge among the claimed steps: no transfer at all");
    assert.ok(w.db.calls.includes("record_payment_refunded"), "the refund is recorded");
    assert.equal(held(w).length, 0, "the claim is returned");
    assert.equal(w.stripe.payouts.length, 0);
  }

  // A transfer refused mid-sequence: what went before stays sent (it is in the
  // factory's Stripe account), the rest goes back, nothing is paid out.
  {
    const w = oneBalanceWorld({ steps: [step("p1", 10000), step("p2", 10000)] });
    let made = 0;
    // Stripe keeps a refusal under its key and answers it again for 24 hours.
    w.stripe.onTransfer = () => (++made === 2 ? Object.assign(new Error("refused"), { statusCode: 400, stored: true }) : undefined);
    await assert.rejects(withdraw(w, 15000), (failure) => failure.message === CANNOT);
    assert.deepEqual(w.db.takes.map((t) => [t.payment_id, t.status]), [["p1", "sent"], ["p2", "returned"]],
      "the transferred part stays sent, the refused part is returned");
    assert.equal(w.stripe.transfers.length, 1);
    assert.equal(w.stripe.payouts.length, 0, "nothing paid out");
  }

  // F5: a transfer whose answer was lost (timeout). On resume Stripe's list by
  // transfer group does not show it yet, and the charge is now disputed. The
  // take must never go back to the balance while its transfer exists: the
  // create under the same key finds it.
  {
    const w = oneBalanceWorld({ steps: [step("p1", 10000)] });
    w.stripe.onTransfer = () => "timeout";
    const requestId = randomUUID();
    await assert.rejects(withdraw(w, 5000, { requestId }), (failure) => !(failure instanceof PayoutMethodRefusal), "a lost answer is not a refusal");
    assert.equal(w.stripe.transfers.length, 1, "the transfer was made");
    assert.equal(held(w).length, 1, "and its take is still held, not returned");
    w.stripe.onTransfer = null;
    w.stripe.groupListMisses = true;
    w.db.rows[0].lease_until = null;
    await withdraw(w, 5000, { requestId }).catch(() => null);
    const take = w.db.takes[0];
    assert.notEqual(take.status, "returned", "F5: a take whose transfer exists is never returned to the balance");
    assert.equal(w.stripe.transfers.length, 1, "and no second transfer was made");
    if (take.status === "sent") assert.equal(take.stripe_transfer_id, w.stripe.transfers[0].id, "it is recorded with the transfer that went");
  }
  {
    const w = oneBalanceWorld({ steps: [step("p1", 10000)], disputed: [] });
    w.stripe.onTransfer = () => "timeout";
    const requestId = randomUUID();
    await withdraw(w, 5000, { requestId }).catch(() => null);
    w.stripe.onTransfer = null;
    w.stripe.groupListMisses = true;
    w.db.rows[0].lease_until = null;
    w.stripe.platform = 0; // and TSC's platform balance is now short
    await withdraw(w, 5000, { requestId }).catch(() => null);
    assert.notEqual(w.db.takes[0].status, "returned", "F5: nor when the resume finds the platform balance short");
    assert.equal(w.stripe.transfers.length, 1);
  }

  // A Stripe 500 stored under the transfer's key is replayed on every resume:
  // the take stays held (nothing is known to have gone), nothing is paid out,
  // and the withdrawal waits for staff (the board; pgTAP).
  {
    const w = oneBalanceWorld({ steps: [step("p1", 10000)] });
    w.stripe.onTransfer = () => Object.assign(new Error("Stripe API error"), { statusCode: 500, stored: true });
    const requestId = randomUUID();
    await assert.rejects(withdraw(w, 5000, { requestId }), (failure) => !(failure instanceof PayoutMethodRefusal));
    w.stripe.onTransfer = null;
    w.db.rows[0].lease_until = null;
    await assert.rejects(withdraw(w, 5000, { requestId }), (failure) => !(failure instanceof PayoutMethodRefusal), "the replayed 500 again");
    assert.equal(w.db.takes[0].status, "held", "the take stays held: it may have gone");
    assert.equal(w.stripe.transfers.length, 0);
    assert.equal(w.stripe.payouts.length, 0);
    assert.equal(w.db.rows[0].state, "claimed", "the row stays open for staff to see");
  }

  // R2-3: Stripe's "key reused with other values" says nothing about whether
  // the first request made anything: never a refusal. The part stays held and
  // the withdrawal waits for staff, nothing is paid out.
  {
    const w = oneBalanceWorld({ steps: [step("p1", 10000)] });
    w.stripe.onTransfer = () => Object.assign(new Error("Keys for idempotent requests can only be used with the same parameters"),
      { type: "StripeIdempotencyError", rawType: "idempotency_error", statusCode: 400 });
    await assert.rejects(withdraw(w, 5000), (failure) => !(failure instanceof PayoutMethodRefusal), "an idempotency clash is not a refusal");
    assert.equal(w.db.takes[0].status, "held", "R2-3: the part stays held");
    assert.ok(w.db.takes[0].attempted_at, "marked attempted");
    assert.equal(w.db.rows[0].state, "claimed", "the row stays open for staff");
    assert.equal(w.stripe.payouts.length, 0);
  }

  // R2-1: staff's "Check again" (checkStripeWithdrawal) on a withdrawal left
  // with a part asked of Stripe and never recorded. It never sends money of
  // its own accord: a transfer found is recorded; none after Stripe's key
  // window is returned; a refunded step's same-key ask refused by Stripe is
  // returned; a disputed step inside the window stays held.
  {
    const DAY = 24 * 3600 * 1000;
    const stuck = ({ attemptedAgo = 60_000, stepExtra = {}, refundedState = false, disputed = false } = {}) => {
      const st = step("p1", 10000, stepExtra);
      if (refundedState) st.refundRecorded = true;
      if (disputed) st.disputedRecorded = true;
      const w = oneBalanceWorld({ steps: [st] });
      const row = { id: randomUUID(), org_id: "org", stripe_account_id: "acct_f", request_key: "k-stuck", request_id: randomUUID(),
        amount_minor: 5000, currency: "USD", state: "refused", reason: "x", usd_cents: 5000, owed_cents: 5000, d1_minor: 0, fee_cents: null,
        reversals: [], payout_id: null, lease_until: null, created_at: new Date(Date.now() - attemptedAgo).toISOString() };
      w.db.rows.push(row);
      w.db.takes.push({ id: randomUUID(), payment_id: "p1", org_id: "org", road: "stripe", stripe_withdrawal_id: row.id, amount_cents: 5000,
        status: "held", stripe_transfer_id: null, attempted_at: new Date(Date.now() - attemptedAgo).toISOString(), created_at: row.created_at });
      return { w, row, take: w.db.takes[0] };
    };
    const check = (x) => checkStripeWithdrawal({ stripe: x.w.api, db: x.w.db, withdrawalId: x.row.id });

    // A transfer exists (its answer was lost): recorded as sent.
    {
      const x = stuck();
      const made = await x.w.api.transfers.create({ amount: 5000, currency: "usd", destination: "acct_f", source_transaction: "ch_p1",
        transfer_group: "order-p1", metadata: { take_id: x.take.id, take_withdrawal_id: x.row.id, payment_id: "p1" } },
        { idempotencyKey: `release-p1-${x.row.id}` });
      const answer = await check(x);
      assert.equal(x.take.status, "sent", "R2-1: a transfer found: the part is recorded sent");
      assert.equal(x.take.stripe_transfer_id, made.id);
      assert.equal(answer.sent, 5000);
      assert.equal(x.w.stripe.transfers.length, 1, "and nothing more is transferred");
      assert.match(answer.sentence, /\$50\.00 was sent to the factory's Stripe account/);
    }
    // No transfer, asked over 24 hours ago: Stripe keeps no key that old, so none exists: returned.
    {
      const x = stuck({ attemptedAgo: DAY + 3600_000 });
      const answer = await check(x);
      assert.equal(x.take.status, "returned", "R2-1: no transfer after the key window: back in the balance");
      assert.equal(x.w.stripe.transfers.length, 0, "nothing transferred");
      assert.equal(answer.returned, 5000);
      assert.match(answer.sentence, /\$50\.00 is back in the factory's balance/);
    }
    // Refunded since, no transfer, inside the window: asked again under the same key; Stripe refuses: returned.
    {
      const x = stuck({ refundedState: true });
      x.w.stripe.onTransfer = () => Object.assign(new Error("must not exceed the source amount"), { statusCode: 400 });
      const answer = await check(x);
      assert.equal(x.take.status, "returned", "R2-1: a refunded step with no transfer: back in the balance");
      assert.equal(x.w.stripe.transfers.length, 0);
      assert.equal(answer.returned, 5000);
    }
    // Refunded, no transfer, after the window: returned without asking Stripe again.
    {
      const x = stuck({ refundedState: true, attemptedAgo: DAY + 3600_000 });
      let asked = 0;
      x.w.stripe.onTransfer = () => { asked += 1; return undefined; };
      await check(x);
      assert.equal(x.take.status, "returned", "R2-1: refunded, after the window: returned");
      assert.equal(asked, 0, "without asking Stripe to transfer");
    }
    // Disputed, no transfer, inside the window: asking again could move disputed money: stays held.
    {
      const x = stuck({ disputed: true });
      let asked = 0;
      x.w.stripe.onTransfer = () => { asked += 1; return undefined; };
      const answer = await check(x);
      assert.equal(x.take.status, "held", "R2-1: disputed inside the key window: stays held (accepted deviation)");
      assert.equal(asked, 0, "and Stripe is not asked to transfer");
      assert.equal(answer.unsure, 5000);
      assert.match(answer.sentence, /still not settled/);
    }
    // Disputed, after the window: returned (no transfer can exist).
    {
      const x = stuck({ disputed: true, attemptedAgo: DAY + 3600_000 });
      await check(x);
      assert.equal(x.take.status, "returned", "R2-1: disputed with no transfer after the window: returned");
    }
    // A key clash on the staff check: unsure, held.
    {
      const x = stuck();
      x.w.stripe.onTransfer = () => Object.assign(new Error("clash"), { type: "StripeIdempotencyError", statusCode: 400 });
      const answer = await check(x);
      assert.equal(x.take.status, "held", "R2-3: a key clash on Check again leaves the part held");
      assert.equal(answer.unsure, 5000);
    }
    // Nothing held: said so.
    {
      const x = stuck();
      x.take.status = "returned";
      const answer = await check(x);
      assert.equal(answer.sentence, "Nothing is waiting on this withdrawal.");
    }
    // A withdrawal no longer there.
    {
      const x = stuck();
      const answer = await checkStripeWithdrawal({ stripe: x.w.api, db: x.w.db, withdrawalId: randomUUID() });
      assert.equal(answer.done, false);
    }
  }

  // Pressed twice at once: one claim, one set of transfers, one payout.
  {
    const w = oneBalanceWorld({ steps: [step("p1", 10000), step("p2", 10000)] });
    const requestId = randomUUID();
    const both = await Promise.allSettled([withdraw(w, 15000, { requestId }), withdraw(w, 15000, { requestId })]);
    assert.ok(both.some((r) => r.status === "fulfilled"), "one goes through");
    assert.equal(w.stripe.payouts.length, 1, "one payout");
    assert.equal(w.stripe.transfers.length, 2, "one set of transfers");
    assert.equal(w.db.takes.filter((t) => t.status !== "returned").reduce((a, t) => a + t.amount_cents, 0), 15000, "claimed once");
  }

  // Non-US$ account: $100 asked in US$, transferred in US$, landed as £76.32;
  // the payout is worked out from what landed, less the fee in pounds.
  {
    const w = oneBalanceWorld({ currency: "gbp", rate: 0.7632, steps: [step("p1", 10000)] });
    const payout = await withdraw(w, 10000, { payoutCurrency: "gbp", country: "GB" });
    const row = w.db.rows[0];
    assert.deepEqual(w.stripe.transfers.map((t) => [t.currency, t.amount]), [["usd", 10000]], "the transfer is the US$ step");
    assert.equal(row.landed_minor, 7632, "what it landed as, in pounds");
    assert.equal(row.amount_minor, 7632, "the withdrawal's gross is what landed");
    assert.equal(payout.currency, "gbp", "paid out in the account's currency");
    assert.equal(payout.amount, 7632 - Number(row.fee_local_minor), "what landed, less the fee as Stripe took it in pounds");
    assert.ok(Number(row.fee_local_minor) > 0);
  }

  // What Withdraw offers per road (the balance action): Stripe reaches owed
  // steps with a charge plus the Stripe account's money (D1); PayPal and Wise
  // reach owed steps plus pool money, never D1.
  {
    const connect = (await import("node:fs")).readFileSync(new URL("../api/stripe-connect.js", import.meta.url), "utf8");
    assert.match(connect, /stripe_cents:\s*Number\(owedReach\.data\?\.stripe_cents \?\? 0\)\s*\+\s*inStripeUsd/, "Stripe: owed with a charge + D1");
    assert.match(connect, /pool_cents:\s*Math\.max\(0, Number\(poolLeft\.data \?\? 0\)\)\s*\+\s*Number\(owedReach\.data\?\.any_cents \?\? 0\)/,
      "PayPal / Wise: pool money + owed, never D1");
    assert.ok(!/pool_cents:[^\n]*inStripe/.test(connect), "D1 never reaches the pool road");
  }
}

console.log("withdrawals: short balance sends nothing; fee inside the amount; one key per attempt; a refusal is never replayed; the one balance withdraws exactly the amount asked, by one road");
