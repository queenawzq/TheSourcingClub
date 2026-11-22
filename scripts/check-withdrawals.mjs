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

// Fix round 34: a charge as Stripe's typings describe it at the SDK's API
// version: `disputed`, never `dispute`. Fixtures name their dispute
// `disputeId`; the code finds it with disputes.list({ charge }).
const asStripeCharge = (fixture) => {
  const { disputeId, dispute, ...charge } = fixture ?? {};
  return charge;
};
const listDisputes = (fixture, statuses = {}, extra = {}) => {
  const id = fixture?.disputeId;
  return { data: id ? [{ id, status: statuses[id] ?? "needs_response", ...(extra[id] ?? {}) }] : [] };
};

// Hermetic: nothing here may reach a real service or change its path because
// of the environment the build runs in (Vercel sets Stripe, PayPal, Wise and
// Supabase variables). Every service is a fake passed in explicitly.
for (const name of Object.keys(process.env)) {
  if (/^(STRIPE_|PAYPAL_|WISE_|SUPABASE_|NEXT_PUBLIC_SUPABASE_|VITE_SUPABASE_|VITE_STRIPE_|OPENROUTER_|RESEND_|PAYONEER_|TAZAPAY_)/.test(name) || name === "VERCEL_ENV") delete process.env[name];
}

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
  // No Stripe here: approveWithdrawal's charge check (F2) is given its own
  // fake where a case needs one, never a client built from the environment.
  return { db, caller, adapter, recorded, paid, client: {}, stripeBuild: () => null };
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

// Fix round 17b: the factory owes TSC more than its other earnings cover
// (a refund after it withdrew): claim_withdrawal refuses, and staff read the
// debt and where it is, never the generic sentence. Nothing is sent.
{
  const w = world();
  w.caller = { rpc: async () => ({ data: null, error: { code: "22023", hint: "withdrawal_owes_tsc", message: "the factory owes TSC $500.00", details: "$500.00" } }) };
  await assert.rejects(approveWithdrawal({ ...w, id: "w1" }), (failure) => failure instanceof PayoutFailure
    && failure.message === "The factory owes TSC $500.00 (To recover, in Needs checking). Decline this withdrawal.");
  assert.equal(w.paid.length, 0, "nothing paid while the factory owes TSC");
  const { owesTscSentence } = await import("../api/_withdrawals.js");
  const { owesTscSentence: boardSentence } = await import("../src/lib/domain/withdrawals.js").catch(() => ({}));
  const board = (await import("node:fs")).readFileSync(new URL("../src/lib/domain/withdrawals.js", import.meta.url), "utf8");
  assert.ok(board.includes(owesTscSentence("${amount || \"money\"}")) || boardSentence?.("$1.00") === owesTscSentence("$1.00"),
    "the board's row says it in the same words");
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
    // As Stripe's Charge typings have it: `disputed`, no `dispute`; the
    // dispute is found by charge (fix round 34).
    const stripe = {
      charges: { retrieve: async (id) => asStripeCharge({ id, payment_intent: `pi_${id}`, ...charges[id] }) },
      disputes: {
        retrieve: async (id) => ({ id, status: disputes[id] ?? "needs_response" }),
        list: async ({ charge }) => listDisputes(charges[charge], disputes),
      },
      refunds: { list: async () => ({ data: [{ metadata: {} }] }), create: async () => { throw new Error("no refund here"); } },
    };
    return { db, rpcs, build: () => stripe };
  };
  const clean = { amount_refunded: 0, disputed: false };

  // Disputed: nothing sent, the dispute recorded.
  {
    const w = world();
    const x = withTakes(w, [{ payment: "s1", charge: "ch_ok" }, { payment: "s2", charge: "ch_d" }], { ch_ok: clean, ch_d: { amount_refunded: 0, disputed: true, disputeId: "du_1" } });
    await assert.rejects(approveWithdrawal({ ...w, db: x.db, id: "w1", stripeBuild: x.build }), (failure) => failure instanceof PayoutFailure && /disputed/i.test(failure.message));
    assert.equal(w.paid.length, 0, "F2: a disputed charge behind the withdrawal: the provider is never asked");
    assert.deepEqual(x.rpcs.find(([name]) => name === "record_payment_disputed")?.[1], { target_payment: "s2", disputed: true }, "and the dispute is recorded");
    assert.equal(w.recorded.at(-1)?.outcome, "requeue", "the withdrawal goes back to waiting (staff then decline it)");
  }
  // A dispute TSC won does not stop it.
  {
    const w = world();
    const x = withTakes(w, [{ payment: "s1", charge: "ch_w" }], { ch_w: { amount_refunded: 0, disputed: true, disputeId: "du_w" } }, { du_w: "won" });
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
    // The database says $50 of what this withdrawal holds was refunded.
    x.db.rpc = async (name, args) => {
      if (name === "record_payment_refund_amount") recorded = args;
      if (name === "withdrawal_refunded_part") return { data: 5000, error: null };
      return rpc(name, args);
    };
    await assert.rejects(approveWithdrawal({ ...w, db: x.db, id: "w1", stripeBuild: x.build }), (failure) => failure instanceof PayoutFailure && /refunded/i.test(failure.message));
    assert.equal(w.paid.length, 0, "F2: a refunded charge behind the withdrawal: the provider is never asked");
    assert.deepEqual(recorded, { target_payment: "s1", payment_intent: "pi_ch_r", refunded_cents: 5000 }, "and the refund is recorded at Stripe's amount");
    assert.equal(w.recorded.at(-1)?.outcome, "requeue", "back to waiting");
  }
  // Partly refunded, and what the withdrawal holds is still the factory's
  // (the refund came out of money still with TSC): recorded, then paid. A
  // partial refund never stops a step for good.
  {
    const w = world();
    const x = withTakes(w, [{ payment: "s1", charge: "ch_p" }], { ch_p: { amount_refunded: 1000, refunded: false, disputed: false } });
    const before = w.db.from;
    let recorded = null;
    x.db.from = (table) => (table === "order_payments"
      ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "s1", state: "confirmed", order_id: "o1", stripe_payment_intent_id: "pi_ch_p", stripe_charge_id: "ch_p" }, error: null }) }) }) }
      : table === "payment_takes" ? withTakes(w, [{ payment: "s1", charge: "ch_p" }], {}).db.from(table) : before(table));
    const rpc = x.db.rpc;
    x.db.rpc = async (name, args) => {
      if (name === "record_payment_refund_amount") recorded = args;
      if (name === "withdrawal_refunded_part") return { data: 0, error: null };
      return rpc(name, args);
    };
    assert.equal((await approveWithdrawal({ ...w, db: x.db, id: "w1", stripeBuild: x.build })).done, "paid", "still covered: paid");
    assert.equal(recorded?.refunded_cents, 1000, "the $10 refund is recorded as it is");
  }
  // A lost dispute: recorded as lost (the hold ends), then the same test.
  {
    const w = world();
    const x = withTakes(w, [{ payment: "s1", charge: "ch_l" }], { ch_l: { amount_refunded: 0, disputed: true, disputeId: "du_l" } }, { du_l: "lost" });
    const rpc = x.db.rpc;
    x.db.rpc = async (name, args) => (name === "withdrawal_refunded_part" ? { data: 6500, error: null } : rpc(name, args));
    await assert.rejects(approveWithdrawal({ ...w, db: x.db, id: "w1", stripeBuild: x.build }), (failure) => failure instanceof PayoutFailure && /refunded/i.test(failure.message));
    assert.equal(x.rpcs.find(([name]) => name === "record_payment_dispute_lost")?.[1]?.target_payment, "s1", "a lost dispute is recorded as lost");
    assert.ok(!x.rpcs.some(([name, args]) => name === "record_payment_disputed" && args.disputed), "never put on hold again");
    assert.equal(w.paid.length, 0, "and what it no longer covers is not sent");
  }
  // Fix round 19 (M1): Stripe says refunded or lost, but recording it fails
  // (the database refused or was unreachable): nothing is sent, ever.
  for (const [label, charges, disputes, failing] of [
    ["a refund", { ch_f: { amount_refunded: 5000, refunded: false, disputed: false } }, {}, "record_payment_refund_amount"],
    ["a lost dispute", { ch_f: { amount_refunded: 0, disputed: true, disputeId: "du_f" } }, { du_f: "lost" }, "record_payment_dispute_lost"],
  ]) {
    const w = world();
    const x = withTakes(w, [{ payment: "s1", charge: "ch_f" }], charges, disputes);
    const before = w.db.from;
    x.db.from = (table) => (table === "order_payments"
      ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "s1", state: "confirmed", order_id: "o1", stripe_payment_intent_id: "pi_ch_f", stripe_charge_id: "ch_f" }, error: null }) }) }) }
      : table === "payment_takes" ? withTakes(w, [{ payment: "s1", charge: "ch_f" }], {}).db.from(table) : before(table));
    const rpc = x.db.rpc;
    x.db.rpc = async (name, args) => {
      if (name === failing) return { data: null, error: { code: "55P03", message: "lock timeout" } };
      if (name === "withdrawal_refunded_part") return { data: 0, error: null };
      return rpc(name, args);
    };
    await assert.rejects(approveWithdrawal({ ...w, db: x.db, id: "w1", stripeBuild: x.build }),
      (failure) => failure instanceof PayoutFailure && /nothing was sent/i.test(failure.message), `${label} not recorded: refused`);
    assert.equal(w.paid.length, 0, `${label} not recorded: the provider is never asked`);
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
  assert.match(disputeCase, /applyDisputeEvent\(\{ stripe, db, dispute \}\)/, "only its current status does (applyDisputeEvent: the charge's newest dispute)");
  const { applyDispute } = await import("../api/_stripe.js");
  const seen = [];
  const db = { rpc: async (name, args) => { seen.push([name, args]); return { data: null, error: null }; } };
  assert.equal(await applyDispute({ db, paymentId: "p", dispute: { id: "du_w", status: "won" } }), false);
  assert.equal(await applyDispute({ db, paymentId: "p", dispute: { id: "du_o", status: "needs_response" } }), true);
  assert.deepEqual(seen.map(([name, args]) => [name, args.disputed]), [["record_payment_disputed", false], ["record_payment_disputed", true]],
    "won: the hold is lifted; open: on hold");
}

// The clearing date (funds_available_at) is Stripe's available_on, read from
// the charge's balance transaction. Right after a payment it can be missing
// (Stripe has not made the balance transaction yet): nothing is recorded then,
// and a later read records it. Without it the step stays Pending for 7 days.
{
  const { ensureFundsAvailable } = await import("../api/_stripe.js");
  const recorded = [];
  let payment = { id: "pay-1", state: "confirmed", stripe_charge_id: "ch_1", funds_available_at: null };
  const db = {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { ...payment }, error: null }) }) }) }),
    rpc: async (name, args) => {
      assert.equal(name, "record_payment_funds_available");
      recorded.push(args);
      payment = { ...payment, funds_available_at: args.available_at };
      return { data: null, error: null };
    },
  };
  let reads = 0;
  const availableOn = 1795478400;
  const stripe = {
    charges: { retrieve: async (id) => (++reads === 1 ? { id, balance_transaction: null } : { id, balance_transaction: { id: "txn_1", available_on: availableOn } }) },
    balanceTransactions: { retrieve: async () => ({ id: "txn_1", available_on: availableOn }) },
  };
  assert.equal(await ensureFundsAvailable({ stripe, db, paymentId: "pay-1" }), null, "no balance transaction yet: nothing recorded");
  assert.equal(recorded.length, 0);
  const date = await ensureFundsAvailable({ stripe, db, paymentId: "pay-1" });
  assert.equal(date, new Date(availableOn * 1000).toISOString(), "a later read records Stripe's date");
  assert.deepEqual(recorded, [{ target_payment: "pay-1", available_at: new Date(availableOn * 1000).toISOString() }]);
  assert.equal(await ensureFundsAvailable({ stripe, db, paymentId: "pay-1" }), date, "once recorded, it is read back, not asked again");
  assert.equal(reads, 2, "Stripe is not asked again");
}

// Fix round 9: a charge disputed before its payment is recorded.
// (a) The dispute event finds the payment by its charge, else by its
// PaymentIntent; an order payment Stripe knows that is not recorded yet
// throws (the event is delivered again); anything else is null.
{
  const { paymentForDispute, applyPaymentIntent } = await import("../api/_stripe.js");
  const dbWith = (rows, events = []) => ({
    from: (table) => ({ select: () => ({ eq: (column, value) => {
      const filters = [(row) => row[column] === value];
      const q = {
        maybeSingle: async () => ({ data: rows.find((row) => filters.every((f) => f(row))) ?? null, error: null }),
        eq: (other, wanted) => (filters.push((row) => row[other] === wanted), q),
        // payment_events: a lost dispute recorded on that payment, by its
        // cause (round 32: never by the note's words) and its Stripe id.
        like: (_, pattern) => ({ limit: async () => ({ data: table === "payment_events"
          ? events.filter((event) => filters.every((f) => f(event)) && event.note.endsWith(pattern.split("%").at(-1))) : [], error: null }) }),
      };
      return q;
    } }) }),
  });
  const stripeWith = (metadata) => ({ paymentIntents: { retrieve: async (id) => ({ id, metadata }) } });
  const rows = [{ id: "pay-charge", stripe_charge_id: "ch_1", stripe_payment_intent_id: "pi_1" },
    { id: "pay-intent", stripe_charge_id: null, stripe_payment_intent_id: "pi_2" }];
  assert.equal((await paymentForDispute({ stripe: stripeWith({}), db: dbWith(rows), dispute: { charge: "ch_1", payment_intent: "pi_1" } }))?.id,
    "pay-charge", "found by its charge");
  assert.equal((await paymentForDispute({ stripe: stripeWith({}), db: dbWith(rows), dispute: { charge: "ch_new", payment_intent: "pi_2" } }))?.id,
    "pay-intent", "found by its PaymentIntent when the charge is not recorded yet");
  await assert.rejects(paymentForDispute({ stripe: stripeWith({ payment_id: "pay-unknown" }), db: dbWith(rows), dispute: { charge: "ch_x", payment_intent: "pi_x" } }),
    /not recorded yet/, "an order payment Stripe knows and the database doesn't yet: thrown, so Stripe sends the event again");
  // Fix round 19 (L7): lost before approval already, so the payment no
  // longer names the charge: a late event about it is done, not retried.
  assert.equal(await paymentForDispute({ stripe: stripeWith({ payment_id: "pay-lost" }),
    db: dbWith(rows, [{ payment_id: "pay-lost", cause: "dispute_lost", note: "Dispute lost: $107.00 went back to the brand. Stripe's dispute fee $15.00 is TSC's. (Stripe du_late)" }]),
    dispute: { id: "du_late", charge: "ch_old", payment_intent: "pi_old" } }), null, "a late dispute event after a loss: nothing to do, no retry");
  // Round 32 (DB review #5): the loss is known by its cause, whatever the note says.
  assert.equal(await paymentForDispute({ stripe: stripeWith({ payment_id: "pay-lost" }),
    db: dbWith(rows, [{ payment_id: "pay-lost", cause: "dispute_lost", note: "Reworded later, any words. (Stripe du_late)" }]),
    dispute: { id: "du_late", charge: "ch_old", payment_intent: "pi_old" } }), null, "R32: a reworded note still counts: the cause decides");
  await assert.rejects(paymentForDispute({ stripe: stripeWith({ payment_id: "pay-lost" }),
    db: dbWith(rows, [{ payment_id: "pay-lost", cause: null, note: "Dispute lost: $107.00 went back to the brand. (Stripe du_late)" }]),
    dispute: { id: "du_late", charge: "ch_old", payment_intent: "pi_old" } }), /not recorded yet/, "R32: words alone never count");
  await assert.rejects(paymentForDispute({ stripe: stripeWith({ payment_id: "pay-lost" }),
    db: dbWith(rows, [{ payment_id: "pay-lost", cause: "dispute_lost", note: "Dispute lost: … (Stripe du_other)" }]),
    dispute: { id: "du_late", charge: "ch_old", payment_intent: "pi_old" } }), /not recorded yet/, "another dispute's note does not count");
  assert.equal(await paymentForDispute({ stripe: stripeWith({ kind: "credits" }), db: dbWith(rows), dispute: { charge: "ch_y", payment_intent: "pi_y" } }),
    null, "another app's charge or a credit pack: nothing");
  assert.equal(await paymentForDispute({ stripe: stripeWith({}), db: dbWith(rows), dispute: { charge: "ch_z" } }), null, "no intent: nothing");

  // (b) Recording a successful payment whose charge is already disputed:
  // the dispute is recorded first, then the payment.
  const calls = [];
  const db = {
    rpc: async (name, args) => {
      calls.push([name, args]);
      if (name === "record_payment_succeeded") return { data: { funded: true, payment: { id: args.target_payment } }, error: null };
      return { data: null, error: null };
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
  };
  const stripe = {
    disputes: { retrieve: async (id) => ({ id, status: "needs_response" }), list: async () => ({ data: [{ id: "du_1", status: "needs_response" }] }) },
    charges: { retrieve: async (id) => ({ id, disputed: true, balance_transaction: { available_on: 1795478400 } }) },
    balanceTransactions: { retrieve: async () => ({ available_on: 1795478400 }) },
    paymentIntents: { retrieve: async () => { throw new Error("already expanded"); } },
  };
  const intent = { id: "pi_d", status: "succeeded", amount: 5000, amount_received: 5000, metadata: { payment_id: "pay-d" },
    payment_method: { type: "card", card: { brand: "visa", last4: "0259" } },
    latest_charge: { id: "ch_d", disputed: true, amount_refunded: 0, balance_transaction: { available_on: 1795478400 } } };
  await applyPaymentIntent({ stripe, db, intent });
  const names = calls.map(([name]) => name);
  assert.ok(names.includes("record_payment_disputed"), "R9: the dispute is recorded");
  assert.deepEqual(calls.find(([name]) => name === "record_payment_disputed")[1], { target_payment: "pay-d", disputed: true });
  assert.ok(names.indexOf("record_payment_disputed") < names.indexOf("record_payment_succeeded"),
    "R9: before the payment is recorded, so the funded notice says on hold");
  // A dispute already won does not hold it.
  calls.length = 0;
  await applyPaymentIntent({ stripe: { ...stripe, disputes: { retrieve: async (id) => ({ id, status: "won" }), list: async () => ({ data: [{ id: "du_1", status: "won" }] }) } }, db, intent });
  assert.deepEqual(calls.find(([name]) => name === "record_payment_disputed")?.[1], { target_payment: "pay-d", disputed: false }, "a won dispute is not a hold");
}

// Fix round 10 (c): a balance read records the clearing date of the few
// payments with none, and a dispute Stripe already holds on their charges.
{
  const { ensureFundsAvailableFor } = await import("../api/_stripe.js");
  const calls = [];
  const payment = { id: "pay-new", state: "confirmed", stripe_charge_id: "ch_new", funds_available_at: null };
  const query = (rows) => {
    const q = { select: () => q, eq: () => q, in: () => q, not: () => q, is: () => q, order: () => q, limit: () => q,
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      then: (resolve, reject) => Promise.resolve({ data: rows, error: null }).then(resolve, reject) };
    return q;
  };
  const db = {
    from: () => query([payment]),
    rpc: async (name, args) => (calls.push([name, args]), { data: null, error: null }),
  };
  const stripe = {
    charges: { retrieve: async (id) => ({ id, disputed: true, balance_transaction: { available_on: 1795478400 } }) },
    balanceTransactions: { retrieve: async () => ({ available_on: 1795478400 }) },
    disputes: { retrieve: async (id) => ({ id, status: "needs_response" }), list: async () => ({ data: [{ id: "du_n", status: "needs_response" }] }) },
  };
  await ensureFundsAvailableFor({ stripe, db, orgId: "org-1" });
  assert.ok(calls.some(([name, args]) => name === "record_payment_funds_available" && args.target_payment === "pay-new"), "R10: the clearing date is recorded");
  assert.deepEqual(calls.find(([name]) => name === "record_payment_disputed")?.[1], { target_payment: "pay-new", disputed: true },
    "R10: and the dispute Stripe holds on the charge");
}

// Fix round 10 (b): the backfill's per-payment decision (api/_backfill.js),
// with no stack and no Stripe.
{
  const { decideBackfill, applyBackfill } = await import("../api/_backfill.js");
  const row = (over = {}) => ({ id: "pay-b", state: "confirmed", funds_available_at: "2026-11-01T00:00:00Z", disputed_at: null, ...over });
  const charge = (over = {}) => ({ id: "ch_b", payment_intent: "pi_b", amount: 10000, amount_refunded: 0, refunded: false, disputed: false,
    balance_transaction: { available_on: 1795478400 }, ...over });
  const world = () => {
    const calls = [];
    const refundsMade = [];
    const db = {
      rpc: async (name, args) => (calls.push([name, args]), { data: null, error: null }),
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "pay-b", state: "confirmed", order_id: "o1", stripe_payment_intent_id: "pi_b", stripe_charge_id: "ch_b" }, error: null }) }) }) }),
    };
    const stripe = { refunds: { list: async () => ({ data: [{ id: "re_1", metadata: {} }] }), create: async (args) => (refundsMade.push(args), { id: "re_new" }) } };
    return { calls, refundsMade, db, stripe };
  };

  // Nothing differs: nothing to do.
  assert.deepEqual(decideBackfill({ row: row(), charge: charge() }), {}, "in line with Stripe: nothing");
  // No clearing date: Stripe's, or null while Stripe has none.
  assert.equal(decideBackfill({ row: row({ funds_available_at: null }), charge: charge() }).date, new Date(1795478400 * 1000).toISOString());
  assert.equal(decideBackfill({ row: row({ funds_available_at: null }), charge: charge({ balance_transaction: null }) }).date, null);

  // Disputed in Stripe (open), not recorded: record it, on hold.
  {
    const d = decideBackfill({ row: row(), charge: charge({ disputed: true }), dispute: { id: "du_1", status: "needs_response" } });
    assert.deepEqual(d, { disputed: true }, "disputed and not recorded: disputed true");
    const w = world();
    await applyBackfill({ stripe: w.stripe, db: w.db, row: row(), charge: charge({ disputed: true }), decision: d, write: true });
    assert.deepEqual(w.calls, [["record_payment_disputed", { target_payment: "pay-b", disputed: true }]]);
    const dry = world();
    const lines = await applyBackfill({ stripe: dry.stripe, db: dry.db, row: row(), charge: charge(), decision: d, write: false });
    assert.equal(dry.calls.length, 0, "a dry run writes nothing");
    assert.match(lines[0], /on hold \(not written\)/);
  }
  // Recorded as disputed, won in Stripe (disputed stays true there): hold lifted.
  {
    for (const status of ["won", "warning_closed"]) {
      const d = decideBackfill({ row: row({ disputed_at: "2026-11-19T00:00:00Z" }), charge: charge({ disputed: true }), dispute: { status } });
      assert.deepEqual(d, { disputed: false }, `${status}: disputed false`);
    }
    const w = world();
    await applyBackfill({ stripe: w.stripe, db: w.db, row: row(), charge: charge(), decision: { disputed: false }, write: true });
    assert.deepEqual(w.calls, [["record_payment_disputed", { target_payment: "pay-b", disputed: false }]]);
  }
  // Won and not recorded, or open and recorded: nothing to change.
  assert.deepEqual(decideBackfill({ row: row(), charge: charge({ disputed: true }), dispute: { status: "won" } }), {});
  // Lost in Stripe (Stripe keeps `disputed` true): recorded as lost, once (fix round 19).
  {
    const lostDispute = { id: "du_l", status: "lost", amount: 10000, balance_transactions: [{ fee: 1500 }] };
    const d = decideBackfill({ row: row({ disputed_at: "2026-11-19T00:00:00Z" }), charge: charge({ disputed: true }), dispute: lostDispute });
    assert.deepEqual(d, { lost: true }, "lost and not recorded: recorded as lost, not put on hold");
    assert.deepEqual(decideBackfill({ row: row({ dispute_lost_at: "2026-11-20T00:00:00Z" }), charge: charge({ disputed: true }), dispute: lostDispute }), {},
      "recorded already: nothing");
    const w = world();
    const lines = await applyBackfill({ stripe: w.stripe, db: w.db, row: row(), charge: charge({ disputed: true }), dispute: lostDispute, decision: d, write: true });
    assert.deepEqual(w.calls, [["record_payment_dispute_lost", { target_payment: "pay-b", dispute_id: "du_l", lost_cents: 10000, fee_cents: 1500 }]]);
    assert.match(lines[0], /dispute lost in Stripe, not recorded: recorded as lost/);
  }

  // Refunded in full in Stripe, still confirmed here: the refund is recorded, no new refund is made.
  {
    const c = charge({ amount_refunded: 10000, refunded: true });
    const d = decideBackfill({ row: row(), charge: c });
    assert.equal(d.refund, "full");
    const w = world();
    await applyBackfill({ stripe: w.stripe, db: w.db, row: row(), charge: c, decision: d, write: true });
    assert.ok(w.calls.some(([name, args]) => name === "record_payment_refund_amount" && args.target_payment === "pay-b" && args.refunded_cents === 10000),
      "the refund is recorded, at Stripe's amount");
    assert.equal(w.refundsMade.length, 0, "no refunds.create: the charge is refunded already");
  }
  // Partly refunded: recorded at Stripe's amount too (fix round 19), never added to.
  {
    const c = charge({ amount_refunded: 2500, refunded: false });
    const d = decideBackfill({ row: row(), charge: c });
    assert.equal(d.refund, "partial");
    const w = world();
    const lines = await applyBackfill({ stripe: w.stripe, db: w.db, row: row(), charge: c, decision: d, write: true });
    assert.ok(w.calls.some(([name, args]) => name === "record_payment_refund_amount" && args.refunded_cents === 2500), "recorded at Stripe's amount");
    assert.equal(w.refundsMade.length, 0);
    assert.match(lines.join(" "), /recorded at Stripe's amount/);
    assert.doesNotMatch(lines.join(" "), /still held here/, "never says it is still held");
  }
  // Recorded already at that amount: nothing. A released step's refund is recorded too.
  assert.equal(decideBackfill({ row: row({ refunded_cents: 2500 }), charge: charge({ amount_refunded: 2500 }) }).refund, undefined);
  assert.equal(decideBackfill({ row: row({ state: "released" }), charge: charge({ amount_refunded: 10000, refunded: true }) }).refund, "full");
  // The script uses this module, not a copy of the rules.
  const script = (await import("node:fs")).readFileSync(new URL("./backfill-funds-available.mjs", import.meta.url), "utf8");
  assert.ok(script.includes("decideBackfill") && script.includes("applyBackfill"), "the backfill script runs these two functions");
}

// Fix round 11 (b): without refund / dispute webhooks, a balance read checks
// the owed steps' charges, least recently checked first, a few per read.
{
  const { checkChargesFor } = await import("../api/_stripe.js");
  const make = ({ owed, checks = [], charges, heldIds = [] }) => {
    const calls = [];
    const reads = [];
    const chain = (rows) => {
      const filters = [];
      const q = { select: () => q, in: () => q, not: () => q, limit: () => q, order: () => q,
        eq: (column, value) => (column.includes(".") || ["state", "withdrawal_pool"].includes(column) ? q : (filters.push((r) => r[column] === value), q)),
        maybeSingle: async () => ({ data: rows.find((r) => filters.every((f) => f(r))) ?? null, error: null }),
        then: (resolve, reject) => Promise.resolve({ data: rows, error: null }).then(resolve, reject) };
      return q;
    };
    const db = {
      from: (table) => {
        if (table === "order_payments") return chain(owed.map((r) => ({ ...r, state: "confirmed", order_id: "o1", stripe_payment_intent_id: `pi_${r.id}` })));
        if (table === "payment_charge_checks") return chain(checks);
        // Steps a requested / paying PayPal or Wise withdrawal holds (94eaef7a).
        if (table === "payment_takes") return chain(heldIds.map((id) => ({ payment_id: id })));
        throw new Error(`unexpected table ${table}`);
      },
      rpc: async (name, args) => {
        calls.push([name, args]);
        if (name === "record_charges_checked") {
          const at = new Date().toISOString();
          for (const id of args.targets) {
            const row = checks.find((c) => c.payment_id === id);
            if (row) row.checked_at = at; else checks.push({ payment_id: id, checked_at: at });
          }
        }
        return { data: null, error: null };
      },
    };
    const stripe = {
      charges: { retrieve: async (id) => (reads.push(id), asStripeCharge({ id, payment_intent: `pi_${id}`, amount: 1000, amount_refunded: 0, refunded: false, disputed: false, ...charges[id] })) },
      disputes: { retrieve: async (id) => ({ id, status: "needs_response" }), list: async ({ charge }) => listDisputes(charges[charge]) },
      refunds: { list: async () => ({ data: [{ metadata: {} }] }), create: async () => { throw new Error("no new refund"); } },
    };
    return { db, stripe, calls, reads };
  };
  const owed = Array.from({ length: 7 }, (_, i) => ({ id: `pay-${i}`, stripe_charge_id: `ch_${i}` }));
  // Checked 11 to 16 minutes ago (older than the 5-minute pause), pay-0 never.
  const checks = owed.map((r, i) => ({ payment_id: r.id, checked_at: new Date(Date.now() - (10 + 7 - i) * 60_000).toISOString() })).slice(1);
  const x = make({ owed, checks, charges: {
    ch_0: { amount_refunded: 1000, refunded: true },
    ch_1: { disputed: true, disputeId: "du_1" },
  } });
  await checkChargesFor({ stripe: x.stripe, db: x.db, orgId: "org" });
  assert.deepEqual(x.reads, ["ch_0", "ch_1", "ch_2", "ch_3", "ch_4"], "R11: least recently checked first (never checked first), at most 5");
  assert.ok(x.calls.some(([name, args]) => name === "record_payment_refund_amount" && args.target_payment === "pay-0" && args.refunded_cents === 1000),
    "R11: a refunded charge is recorded (applyChargeRefund), at Stripe's amount");
  assert.deepEqual(x.calls.find(([name]) => name === "record_payment_disputed")?.[1], { target_payment: "pay-1", disputed: true }, "R11: a disputed one is recorded");
  const others = x.calls.filter(([name]) => !["record_payment_refund_amount", "record_payment_disputed", "record_charges_checked"].includes(name));
  assert.deepEqual(others, [], "R11: nothing else is written");
  assert.equal(x.calls.filter(([name]) => name === "record_payment_refund_amount" || name === "record_payment_disputed").length, 2,
    "R11: the charges with neither change are not written");
  assert.deepEqual(x.calls.find(([name]) => name === "record_charges_checked")?.[1].targets.sort(), ["pay-0", "pay-1", "pay-2", "pay-3", "pay-4"],
    "R11: the five read are recorded as checked");
  // Round 32 (DB review #1): a charge refunded in part AND disputed records
  // both; the refund never hides the dispute.
  {
    const both = make({ owed: owed.slice(0, 1), checks: [], charges: { ch_0: { amount_refunded: 5000, refunded: false, amount: 100000, disputed: true, disputeId: "du_0" } } });
    await checkChargesFor({ stripe: both.stripe, db: both.db, orgId: "org" });
    assert.ok(both.calls.some(([name, args]) => name === "record_payment_refund_amount" && args.target_payment === "pay-0" && args.refunded_cents === 5000),
      "R32: the partial refund is recorded");
    assert.deepEqual(both.calls.find(([name]) => name === "record_payment_disputed")?.[1], { target_payment: "pay-0", disputed: true },
      "R32: and so is the dispute on the rest");
  }
  // A charge Stripe can't read is not recorded as checked; nothing throws.
  const y = make({ owed: owed.slice(0, 2), charges: {} });
  y.stripe.charges.retrieve = async (id) => { if (id === "ch_0") throw new Error("down"); return { id, amount_refunded: 0, disputed: false }; };
  await checkChargesFor({ stripe: y.stripe, db: y.db, orgId: "org" });
  assert.deepEqual(y.calls.find(([name]) => name === "record_charges_checked")?.[1].targets, ["pay-1"], "R11: only what was read is recorded as checked");
  // 13ac6414: a charge checked in the last 5 minutes is not read again.
  {
    const recent = make({ owed: owed.slice(0, 3), charges: {}, checks: [
      { payment_id: "pay-0", checked_at: new Date(Date.now() - 60_000).toISOString() },
      { payment_id: "pay-1", checked_at: new Date(Date.now() - 4 * 60_000).toISOString() },
      { payment_id: "pay-2", checked_at: new Date(Date.now() - 6 * 60_000).toISOString() },
    ] });
    await checkChargesFor({ stripe: recent.stripe, db: recent.db, orgId: "org" });
    assert.deepEqual(recent.reads, ["ch_2"], "only the charge checked more than 5 minutes ago is read again");
  }
  // 94eaef7a: a step a waiting PayPal / Wise withdrawal holds is read on every
  // claimed read, first, even if checked a minute ago; others still wait 5 minutes.
  {
    const minuteAgo = new Date(Date.now() - 60_000).toISOString();
    const longAgo = new Date(Date.now() - 30 * 60_000).toISOString();
    const h = make({ owed: owed.slice(0, 3), charges: { ch_2: { amount_refunded: 1000, refunded: true } }, heldIds: ["pay-2"], checks: [
      { payment_id: "pay-0", checked_at: minuteAgo },
      { payment_id: "pay-1", checked_at: longAgo },
      { payment_id: "pay-2", checked_at: minuteAgo },
    ] });
    await checkChargesFor({ stripe: h.stripe, db: h.db, orgId: "org" });
    assert.equal(h.reads[0], "ch_2", "the held step is read first, though checked a minute ago");
    assert.ok(!h.reads.includes("ch_0"), "an unheld step checked a minute ago is not read");
    assert.ok(h.reads.includes("ch_1"), "an unheld step checked long ago is");
    assert.ok(h.calls.some(([name, args]) => name === "record_payment_refund_amount" && args.target_payment === "pay-2"),
      "so a refund under a waiting withdrawal is recorded on the next read");
  }
  // 4a445bb2: with 7 held steps, two reads in a row read 5, then the other 2 first.
  {
    const seven = Array.from({ length: 7 }, (_, i) => ({ id: `held-${i}`, stripe_charge_id: `chh_${i}` }));
    const checks7 = seven.map((r, i) => ({ payment_id: r.id, checked_at: new Date(Date.now() - (20 - i) * 60_000).toISOString() }));
    const h7 = make({ owed: seven, checks: checks7, charges: {}, heldIds: seven.map((r) => r.id) });
    await checkChargesFor({ stripe: h7.stripe, db: h7.db, orgId: "org" });
    assert.deepEqual(h7.reads, ["chh_0", "chh_1", "chh_2", "chh_3", "chh_4"], "first read: the 5 least recently checked");
    h7.reads.length = 0;
    await checkChargesFor({ stripe: h7.stripe, db: h7.db, orgId: "org" });
    assert.deepEqual(h7.reads.slice(0, 2), ["chh_5", "chh_6"], "second read: the other 2 first, so every held step is read in turn");
  }
  // claimStripeRead: true only when the database grants the read; false on a
  // refusal, an error or an exception.
  {
    const { claimStripeRead } = await import("../api/_stripe.js");
    const answering = (answer) => ({ rpc: async (name, args) => (assert.equal(name, "claim_balance_stripe_read"), assert.deepEqual(args, { target_org: "org" }), answer) });
    assert.equal(await claimStripeRead(answering({ data: true, error: null }), "org"), true);
    assert.equal(await claimStripeRead(answering({ data: false, error: null }), "org"), false);
    assert.equal(await claimStripeRead(answering({ data: null, error: { message: "denied" } }), "org"), false);
    assert.equal(await claimStripeRead({ rpc: async () => { throw new Error("offline"); } }, "org"), false);
  }
  // Every route that reads Stripe for a balance asks the database first; with
  // the claim refused it calls neither check.
  {
    const fs = await import("node:fs");
    for (const route of ["stripe-connect.js", "stripe-sync.js"]) {
      const code = fs.readFileSync(new URL(`../api/${route}`, import.meta.url), "utf8");
      const lines = code.split("\n");
      const calls = lines.filter((line) => /(checkChargesFor|refreshPayoutsFor)\(\{/.test(line));
      assert.ok(calls.length > 0, `${route} reads charges or payouts`);
      for (const line of calls) {
        const guarded = /askStripe \?/.test(line) || lines.slice(Math.max(0, lines.indexOf(line) - 2), lines.indexOf(line) + 1).some((l) => /claimStripeRead\(db, orgId\)/.test(l));
        assert.ok(guarded, `${route}: "${line.trim()}" runs only when claimStripeRead granted the read`);
      }
      assert.ok(code.includes("claimStripeRead(db, orgId)"), `${route} asks claimStripeRead`);
    }
  }
  // Nothing owed: no Stripe read, no write.
  const z = make({ owed: [], charges: {} });
  assert.equal(await checkChargesFor({ stripe: z.stripe, db: z.db, orgId: "org" }), 0);
  assert.equal(z.reads.length + z.calls.length, 0);
}

// (d) A Stripe withdrawal records who asked from the token's subject when the
// auth server gives no user for it (the database had just accepted it).
{
  const connect = (await import("node:fs")).readFileSync(new URL("../api/stripe-connect.js", import.meta.url), "utf8");
  const calls = connect.split("withdrawWithFee({").length - 1;
  const withFallback = connect.split("userId: auth?.user?.id ?? tokenSubject(request)").length - 1;
  assert.ok(calls >= 2 && withFallback === calls && !/userId: auth\?\.user\?\.id \?\? null/.test(connect),
    `R9: every Stripe withdrawal call (${calls}) falls back to the token's subject for who asked (${withFallback})`);
  const fn = connect.slice(connect.indexOf("function tokenSubject"), connect.indexOf("export default async function handler"));
  // eslint-disable-next-line no-new-func
  const tokenSubject = new Function(`${fn}; return tokenSubject;`)();
  const jwt = (payload) => `x.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.y`;
  assert.equal(tokenSubject({ headers: { authorization: `Bearer ${jwt({ sub: "6b1c3a2e-0000-4000-8000-000000000001" })}` } }), "6b1c3a2e-0000-4000-8000-000000000001");
  assert.equal(tokenSubject({ headers: { authorization: `Bearer ${jwt({ sub: "not an id" })}` } }), null, "anything but an id is not recorded");
  assert.equal(tokenSubject({ headers: {} }), null);
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
  const [row] = askedWithdrawalRows([{ id: "f", status: "failed", amount_cents: 100, currency: "USD", provider: "paypal", fee_cents: 2, receives_minor: 98, reason: sentence, back_cents: 100 }]);
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
  assert.deepEqual(summaryFrom(null), { total: undefined, approval: undefined, pending: undefined, processing: undefined, paid: undefined }, "no figures yet: nothing guessed");
  // A step released by its withdrawal is not a second, "Bank transfer" withdrawal.
  assert.equal(withdrawalRows([{ ...step, state: "released", released_by: "u", released_note: "Withdrawn" }]).length, 0);
  const rows = askedWithdrawalRows([{ id: "w", status: "paid", amount_cents: 4000, currency: "USD", provider: "paypal", paid_to: "a@b.c", fee_cents: 79, receives_minor: 3921, paid_at: "2026-11-16" }, { id: "x", status: "cancelled", amount_cents: 1, currency: "USD" }]);
  assert.equal(rows.length, 2, "a cancelled withdrawal stays listed (round 28)");
  assert.equal(rows[0].amount, -3921, "a paid withdrawal shows what reached the factory");
  assert.deepEqual([rows[1].status, rows[1].failed], ["Cancelled", true], "cancelled: its word, the amount muted");
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

// The overview's "Payments owed" links to the board's tab that holds what it
// counts (paymentsQueueHref, src/lib/domain/admin.js): Payout owed if it has
// rows, else Failed, else Processing, else Withdrawals, else Needs checking;
// the plain board when nothing is there or a read fails. The board itself
// opens on Payout owed, as on main; only ?tab= opens another tab.
// (Changed Nov 20: the board used to pick its own first tab with rows.)
{
  const fs = await import("node:fs");
  const board = fs.readFileSync(new URL("../src/app/admin/AdminPayments.jsx", import.meta.url), "utf8");
  assert.match(board, /get\("tab"\)/, "?tab= opens the tab asked for");
  assert.match(board, /\? chosen : "payout"/, "and with none asked for, the board opens on Payout owed");
  assert.doesNotMatch(board, /firstWithRows/, "the board no longer picks a tab of its own");
  // One rule for the board's queues and the overview's link (43273dc1).
  const { boardSections, countedByOverview, countedQueue } = await import("../src/shared/payments-board-sections.mjs");
  const admin = fs.readFileSync(new URL("../src/lib/domain/admin.js", import.meta.url), "utf8");
  assert.match(admin, /from "\.\.\/\.\.\/shared\/payments-board-sections\.mjs"/, "the link uses the board's own rule");
  assert.match(board, /payments-board-sections\.mjs/, "and so does the board");
  const start = admin.indexOf("export async function paymentsQueueHref");
  const end = admin.indexOf("\n}\n", start) + 2;
  // The real function, run against a fake client (the module itself needs the browser build).
  // eslint-disable-next-line no-new-func
  const paymentsQueueHref = new Function("supabase", "countedQueue", `${admin.slice(start, end).replace("export ", "")}; return paymentsQueueHref;`);
  const BOARD = "/app.html/admin/payments";
  let n = 0;
  const owed = (over = {}) => ({ payment_id: `p${++n}`, state: "confirmed", release_requested_at: "2026-11-01", order_status: "active",
    stripe_payment_intent_id: `pi_${n}`, factory_stripe_ready: false, payout_method: "paypal", ...over });
  const fake = ({ rows = [], attempts = [], withdrawals = [], pool = [], disputed = [], stuck = [], fail = null } = {}) => ({
    rpc: async (name) => {
      if (fail === "throw") throw new Error("offline");
      if (fail === name) return { data: null, error: { message: "down" } };
      if (name === "admin_payment_board") return { data: rows, error: null };
      if (name === "admin_provider_attempts") return { data: attempts, error: null };
      if (name === "admin_withdrawals") return { data: { withdrawals, pool_payment_ids: pool }, error: null };
      if (name === "admin_balance_attention") return { data: { disputed, stuck }, error: null };
      throw new Error(`unexpected ${name}`);
    },
  });
  const hrefFor = (world) => paymentsQueueHref(fake(world), countedQueue)();
  const sectionOf = (world, row) => {
    const sections = boardSections(world.rows ?? [], new Map((world.attempts ?? []).map((a) => [a.payment_id, a])), new Set(world.pool ?? []));
    return Object.keys(sections).find((id) => sections[id].includes(row)) ?? null;
  };

  // One row per queue: a Stripe release started (Payout owed), a PayPal payout
  // that failed (Failed), a Wise payout under way (Processing).
  const stripeStarted = owed({ stripe_release_started: true, factory_stripe_ready: true, payout_method: null });
  const paypalFailed = owed({ payout_method: "paypal" });
  const wiseMoving = owed({ payout_method: "bank", wise_recipient_type: "iban" });
  const attempts = [
    { payment_id: paypalFailed.payment_id, status: "failed", updated_at: "2026-11-10T00:00:00Z" },
    { payment_id: wiseMoving.payment_id, status: "processing", updated_at: "2026-11-10T00:00:00Z" },
  ];
  const all = { rows: [stripeStarted, paypalFailed, wiseMoving], attempts, withdrawals: [{ status: "requested" }], disputed: [{}], stuck: [{}] };
  assert.deepEqual([sectionOf(all, stripeStarted), sectionOf(all, paypalFailed), sectionOf(all, wiseMoving)], ["payout", "failed", "clearing"],
    "the board puts each in its queue");
  assert.equal(await hrefFor(all), BOARD, "Payout owed first, when it has a counted row");
  assert.equal(await hrefFor({ ...all, rows: [paypalFailed, wiseMoving] }), `${BOARD}?tab=failed`, "else Failed");
  assert.equal(await hrefFor({ rows: [owed({ state: "processing", order_status: "cancelled", refund_failed_at: "x" })] }), `${BOARD}?tab=failed`,
    "a cancelled order's refund Stripe refused is under Failed");
  assert.equal(await hrefFor({ ...all, rows: [wiseMoving] }), `${BOARD}?tab=processing`, "else Processing");
  assert.equal(await hrefFor({ ...all, rows: [] }), `${BOARD}?tab=withdrawals`, "else Withdrawals");
  assert.equal(await hrefFor({ withdrawals: [{ status: "paid" }, { status: "cancelled" }], disputed: [{}] }), `${BOARD}?tab=needs_checking`,
    "else Needs checking (a finished withdrawal is not waiting)");
  assert.equal(await hrefFor({}), BOARD, "nothing waiting: the board");
  // Owed money waiting in a balance is no queue of staff's.
  const waiting = owed();
  assert.equal(countedByOverview(waiting), false);
  assert.equal(await hrefFor({ rows: [waiting] }), BOARD, "owed money in a balance: the board");
  assert.equal(await hrefFor({ rows: [paypalFailed], attempts, pool: [paypalFailed.payment_id], stuck: [{}] }), `${BOARD}?tab=needs_checking`,
    "a step in a withdrawal's balance is not counted under Failed");

  // A PayPal payout that failed, and the factory changed its details since:
  // no longer under Failed (Pay again would use the old details) but under
  // Payout owed, still counted; the board and the link agree on it.
  {
    const changed = owed({ payout_method: "paypal", payout_changed_at: "2026-11-12T00:00:00Z" });
    const world = { rows: [changed], attempts: [{ payment_id: changed.payment_id, status: "failed", updated_at: "2026-11-10T00:00:00Z" }] };
    assert.equal(sectionOf(world, changed), "payout", "failed, then details changed: Payout owed on the board");
    assert.equal(countedByOverview(changed, new Map(world.attempts.map((a) => [a.payment_id, a]))), true, "still counted for staff");
    assert.equal(await hrefFor(world), BOARD, "and the link opens Payout owed, where the board shows it");
  }

  for (const fail of ["admin_payment_board", "admin_provider_attempts", "admin_withdrawals", "admin_balance_attention", "throw"]) {
    assert.equal(await hrefFor({ ...all, fail }), BOARD, `a failed read (${fail}): the plain board link`);
  }
}

// Fix round 6: a Stripe payout is on its way (Pending) until its arrival day,
// even when Stripe already calls it paid (test mode does at once); and "paid
// out to your bank" is said only on payout.paid, never when a payout is made.
{
  const { payoutsOnTheirWay } = await import("../api/_stripe-payouts.js");
  const now = Math.floor(Date.now() / 1000);
  const stripe = { payouts: { list: async () => ({ data: [
    { id: "po_pending", status: "pending", amount: 100, currency: "usd", arrival_date: now + 86400 },
    { id: "po_transit", status: "in_transit", amount: 200, currency: "usd", arrival_date: now + 86400 },
    { id: "po_paid_early", status: "paid", amount: 300, currency: "usd", arrival_date: now + 86400 },
    { id: "po_arrived", status: "paid", amount: 400, currency: "usd", arrival_date: now - 86400 },
    { id: "po_failed", status: "failed", amount: 500, currency: "usd", arrival_date: now - 86400 },
  ] }) } };
  const onTheirWay = await payoutsOnTheirWay(stripe, "acct_f");
  assert.deepEqual(onTheirWay.map((p) => p.id), ["po_pending", "po_transit", "po_paid_early"],
    "on its way until its arrival day, whatever Stripe calls it; arrived and failed are not");

  const { tellPayoutEvent } = await import("../api/_stripe-payout-events.js");
  const told = [];
  const db = {
    from(table) {
      if (table === "stripe_withdrawals") return { update: () => ({ eq: async () => ({ error: null }) }) };
      if (table === "stripe_connect_accounts") return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { org_id: "org-1" }, error: null }) }) }) };
      if (table === "notifications") return { insert: async (row) => (told.push(row), { error: null }) };
      throw new Error(`unexpected table ${table}`);
    },
  };
  const payout = { id: "po_1", amount: 1783, currency: "eur", status: "pending", arrival_date: now + 86400 };
  for (const type of ["payout.created", "payout.updated"]) {
    assert.equal(await tellPayoutEvent(db, { type, account: "acct_f", data: { object: payout } }), false, `${type}: nothing said`);
  }
  assert.equal(told.length, 0, "a payout made is not yet \"paid out to your bank\"");
  assert.equal(await tellPayoutEvent(db, { type: "payout.paid", account: "acct_f", data: { object: { ...payout, status: "paid" } } }), true);
  assert.equal(told.length, 1);
  assert.match(told[0].title, /paid out to your bank$/, "said on payout.paid");
}

// What each method can withdraw (D5): Stripe reaches owed money and the
// factory's own Stripe money (D1); PayPal / Wise reach owed money, never D1
// (the old pool is ordinary owed money since 20261121350000). The server's answers come first when the page has them.
{
  const figures = { tsc: { parts: { owed_cleared_cents: 10000, pool_available_cents: 3000 } }, stripe: { available_cents: 2500 } };
  assert.deepEqual(withdrawReach(figures), { stripe: 12500, balance: 10000, estimated: false }, "Stripe: owed + D1; PayPal/Wise: owed, never D1; an old pool part is not read (R32)");
  assert.deepEqual(withdrawReach({ parts: { owed_cleared_cents: 10000, pool_available_cents: 3000 } }), { stripe: 10000, balance: 10000, estimated: false },
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
  assert.ok(form.includes('disabled={busy || Boolean(error) || asking || !method ||'), "Withdraw is off while nothing is chosen");
  assert.ok(form.includes("{methodId ? null : <option value=\"\" />}"), "the dropdown shows nothing chosen");
}

// One balance (20261120100000): the database's figures plus the factory's own
// Stripe money (D1), each dollar in exactly one figure, total the sum of four.
{
  const { balanceFigures } = await import("../api/_balance-figures.js");
  const sum = (f) => f.awaiting_cents + f.available_cents + f.pending_cents + f.processing_cents + f.paid_out_cents;
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
    // Fix round 8: the database counts every payout (on its way: Pending,
    // until its arrival day; then Paid out), so only the money sitting in the
    // factory's Stripe account moves: out of Paid out, into Available and
    // Pending. onTheirWay and payouts are not read.
    assert.equal(f.available_cents, 10000 + 5000, "D1: Stripe's available money is in Available with the owed money");
    assert.equal(f.pending_cents, 3000 + 2000, "Stripe's pending money is Pending (payouts on their way are the database's)");
    assert.equal(f.paid_out_cents, 8000 - (5000 + 2000), "Paid out is the database's, less what still sits in the Stripe account");
    assert.equal(f.awaiting_cents, 1000);
    assert.equal(f.total_cents, sum(f), "total is the sum of the four");
    assert.equal(f.total_cents, 1000 + 10000 + 3000 + 8000, "and the database's total, to the cent");
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
  // Fix round 5: one answer for owner and member. The database's figures
  // already take Stripe's payout fee out of Paid out; the owner's card adds
  // its Stripe account, whose payouts are net of that fee, so for a US$
  // account the owner reads exactly what a member reads from the database.
  {
    // $10 withdrawn by Stripe, 33c fee, $9.67 paid out to the bank.
    const db = tsc({ available_cents: 18500, paid_out_cents: 967, parts: { stripe_released_cents: 1000, stripe_withdrawal_fees_cents: 33 } });
    const stripe = { available: [{ amount: 0, currency: "usd" }], pending: [], onTheirWay: [], payouts: [{ amount: 967, currency: "usd", paid: true }] };
    const owner = balanceFigures(db, stripe, null);
    assert.equal(owner.paid_out_cents, 967, "the owner's Paid out: $9.67, as the member's");
    assert.equal(owner.total_cents, db.available_cents + db.paid_out_cents, "the owner's Total is the member's");
    // Fix round 8: a payout on its way is the database's to place (Pending
    // until its arrival day); Stripe's own list of payouts changes nothing.
    const onItsWay = balanceFigures(db, { available: [], pending: [], onTheirWay: [{ amount: 967, currency: "usd" }], payouts: [{ amount: 967, currency: "usd", paid: false }] }, null);
    assert.deepEqual([onItsWay.pending_cents, onItsWay.paid_out_cents, onItsWay.total_cents], [db.pending_cents, db.paid_out_cents, db.available_cents + db.paid_out_cents],
      "Stripe's payouts list moves nothing: the owner reads the database's figures");
  }
  // Fix round 8: the owner's Total is factory_balance's total to the cent,
  // with EUR sitting in the factory's Stripe account (converted, estimated).
  {
    const db = tsc({ awaiting_cents: 6500, available_cents: 4500, pending_cents: 11500, paid_out_cents: 1960,
      withdrawals: [{ id: "w1", road: "stripe", word: "on_its_way", amount_cents: 1960 }] });
    const total = 6500 + 4500 + 11500 + 1960;
    const stripe = { available: [{ amount: 910, currency: "eur" }], pending: [{ amount: 182, currency: "eur" }] };
    const owner = balanceFigures(db, stripe, { rates: { EUR: 1.1 } });
    assert.equal(owner.total_cents, total, "the owner's Total is the server's, to the cent");
    assert.equal(owner.estimated, true, "the EUR part is an estimate");
    assert.equal(owner.available_cents, 4500 + 1001, "EUR in the Stripe account converted into Available");
    assert.equal(owner.pending_cents, 11500 + 200, "and into Pending");
    assert.equal(owner.paid_out_cents, 1960 - 1001 - 200, "taken out of Paid out, where the server counted it");
    assert.deepEqual(owner.withdrawals, db.withdrawals, "the server's withdrawals list passes through");
  }
  // Fix round 8b: at an indicative rate, the money in the factory's Stripe
  // account can read more than the database counted as sent. Paid out never
  // goes below zero; the excess comes off the Stripe part of Available, then
  // of Pending; the total stays the server's.
  {
    const db = tsc({ available_cents: 100, paid_out_cents: 1000 });
    const f = balanceFigures(db, { available: [{ amount: 1000, currency: "eur" }], pending: [] }, { rates: { EUR: 1.1 } });
    assert.deepEqual([f.available_cents, f.pending_cents, f.paid_out_cents, f.total_cents], [1100, 0, 0, 1100],
      "€10.00 at 1.10 against $10.00 Paid out: Available $11.00, Paid out $0, Total the server's $11.00");
    assert.equal(f.stripe.available_cents, 1000, "the Stripe part reported after the trim");
    assert.equal(f.estimated, true);
  }
  {
    // €1.00 available and €10.00 pending (=$1.10 + $11.00) against $5.00 Paid
    // out: $7.10 too much. Available's Stripe part ($1.10) is used up; Pending's
    // gives the remaining $6.00.
    const db = tsc({ awaiting_cents: 300, available_cents: 2000, pending_cents: 400, paid_out_cents: 500 });
    const total = 300 + 2000 + 400 + 500;
    const f = balanceFigures(db, { available: [{ amount: 100, currency: "eur" }], pending: [{ amount: 1000, currency: "eur" }] }, { rates: { EUR: 1.1 } });
    assert.equal(f.stripe.available_cents, 0, "Available's Stripe part goes first");
    assert.equal(f.stripe.pending_cents, 500, "then Pending's absorbs the rest");
    assert.deepEqual([f.awaiting_cents, f.available_cents, f.pending_cents, f.paid_out_cents], [300, 2000, 900, 0]);
    assert.equal(f.total_cents, total, "Total is the server's");
    assert.ok([f.awaiting_cents, f.available_cents, f.pending_cents, f.paid_out_cents].every((x) => x >= 0), "no figure below zero");
  }
  // And for any amounts in the Stripe account: total = the server's, nothing below zero.
  for (const [avail, pend, paid] of [[0, 0, 0], [5000, 0, 100], [0, 5000, 100], [3000, 4000, 2500], [100, 100, 100000]]) {
    const db = tsc({ awaiting_cents: 10, available_cents: 20, pending_cents: 30, paid_out_cents: paid });
    const f = balanceFigures(db, { available: [{ amount: avail, currency: "eur" }], pending: [{ amount: pend, currency: "eur" }] }, { rates: { EUR: 1.1 } });
    assert.equal(f.total_cents, 10 + 20 + 30 + paid, `total is the server's (${avail}/${pend}/${paid})`);
    assert.ok([f.awaiting_cents, f.available_cents, f.pending_cents, f.paid_out_cents].every((x) => x >= 0), `no figure below zero (${avail}/${pend}/${paid})`);
  }
  // 94eaef7a: money in the Stripe account an open withdrawal holds is on its
  // way: moved from Available to Processing (round 14: withdrawals in
  // progress are not Pending), the total unchanged, never more than is available.
  {
    const db = tsc({ awaiting_cents: 0, available_cents: 500, pending_cents: 0, paid_out_cents: 200000 });
    const all = balanceFigures(db, { available: [{ amount: 175597, currency: "usd" }], pending: [], held: [{ amount: 175597, currency: "usd" }] }, null);
    assert.equal(all.stripe.available_cents, 0, "all of it held: the Stripe part of Available is 0");
    assert.equal(all.available_cents, 500, "Available is only TSC's");
    assert.equal(all.pending_cents, 0, "the held $1,755.97 is not Pending");
    assert.equal(all.processing_cents, 175597, "it is Processing");
    assert.equal(all.total_cents, 500 + 200000, "Total is the server's");
    assert.equal(all.stripe.held_cents, 175597, "stripe.held_cents: the held amount moved to Processing");
    const capped = balanceFigures(db, { available: [{ amount: 1000, currency: "usd" }], pending: [], held: [{ amount: 5000, currency: "usd" }] }, null);
    assert.equal(capped.stripe.available_cents, 0, "held beyond what is available is capped");
    assert.equal(capped.processing_cents, 1000, "only what is there moves to Processing");
    assert.equal(capped.stripe.held_cents, 1000, "and held_cents is capped at what is available");
    assert.equal(capped.total_cents, 500 + 200000);
    const none = balanceFigures(db, { available: [{ amount: 1000, currency: "usd" }], pending: [] }, null);
    assert.equal(none.available_cents, 1500, "nothing held: unchanged");
    assert.equal(none.stripe.held_cents, 0);
    // The owner's balance and the members' figures pass the same `held`, so they agree during an open withdrawal.
    const connect = (await import("node:fs")).readFileSync(new URL("../api/stripe-connect.js", import.meta.url), "utf8");
    assert.equal(connect.split("held: heldRows(balance.available, heldElsewhere)").length - 1, 2, "owner's balance and members' figures pass the same held");
    assert.equal(JSON.stringify(balanceFigures(db, { available: [{ amount: 175597, currency: "usd" }], pending: [], held: [{ amount: 175597, currency: "usd" }] }, null)),
      JSON.stringify(all), "same inputs, same figures, owner or member");
  }
  // Round 14 (b2d6d425): the reported state with Stripe money as well. The
  // database: $1,313 clearing (Pending), a $1,000 PayPal withdrawal waiting
  // (Processing), $3,000 already sent to the Stripe account (Paid out). In
  // the Stripe account: $500 available of which $200 an open withdrawal
  // holds, and $100 still pending at Stripe.
  {
    const { withStripePart } = await import("../src/app/order/payment-summary.mjs");
    const db = tsc({ available_cents: 0, pending_cents: 131300, processing_cents: 100000, paid_out_cents: 300000 });
    const f = balanceFigures(db, { available: [{ amount: 50000, currency: "usd" }], pending: [{ amount: 10000, currency: "usd" }], held: [{ amount: 20000, currency: "usd" }] }, null);
    assert.equal(f.pending_cents, 131300 + 10000, "Pending: the database's clearing + Stripe's own pending, never the held money");
    assert.equal(f.processing_cents, 100000 + 20000, "Processing: the waiting withdrawal + the Stripe money it holds");
    assert.equal(f.available_cents, 30000, "Available: the Stripe money nothing holds");
    assert.equal(f.paid_out_cents, 300000 - 60000, "Paid out less what is still in the Stripe account");
    assert.equal(f.stripe.processing_cents, 20000, "the Stripe part of Processing is the held money");
    assert.equal(f.total_cents, 131300 + 100000 + 300000, "Total is the database's to the cent");
    assert.equal(f.total_cents, sum(f), "and the five added up");
    const s = summaryFrom(f);
    assert.equal(s.processing, 120000, "the summary carries Processing");
    assert.equal(s.total, s.approval + s.available + s.pending + s.processing + s.paid, "the summary's Total includes Processing");
    assert.equal(s.total, f.total_cents, "and is the server's Total");
    // A newer database read (the withdrawal paid: Processing 0, Paid out +$999.60)
    // keeps the Stripe part exactly: the held $200 stays in Processing.
    const later = tsc({ available_cents: 0, pending_cents: 131300, processing_cents: 0, paid_out_cents: 300000 + 99960 });
    const merged = withStripePart(later, f);
    assert.equal(merged.processing_cents, 20000, "merged: only the Stripe-held part is still Processing");
    assert.equal(merged.pending_cents, 141300, "merged: Pending unchanged");
    assert.equal(merged.total_cents, later.awaiting_cents + later.available_cents + later.pending_cents + later.processing_cents + later.paid_out_cents,
      "merged: Total is the newer database total");
    // At a rate, Stripe can read more than was counted as sent: the excess
    // comes off Available, then Pending, then Processing; never below zero.
    const short = balanceFigures(tsc({ pending_cents: 0, processing_cents: 0, paid_out_cents: 25000 }),
      { available: [{ amount: 30000, currency: "usd" }], pending: [{ amount: 10000, currency: "usd" }], held: [{ amount: 20000, currency: "usd" }] }, null);
    assert.deepEqual([short.stripe.available_cents, short.stripe.pending_cents, short.stripe.processing_cents, short.paid_out_cents], [0, 5000, 20000, 0],
      "over by $150: $100 off Available, $50 off Pending, Processing kept");
    assert.equal(short.total_cents, 25000, "Total still the database's");
    const shorter = balanceFigures(tsc({ paid_out_cents: 5000 }),
      { available: [{ amount: 30000, currency: "usd" }], pending: [{ amount: 10000, currency: "usd" }], held: [{ amount: 20000, currency: "usd" }] }, null);
    assert.deepEqual([shorter.stripe.available_cents, shorter.stripe.pending_cents, shorter.stripe.processing_cents, shorter.paid_out_cents], [0, 0, 5000, 0],
      "over by $350: Available and Pending to 0, then $150 off Processing");
    assert.equal(shorter.stripe.held_cents, shorter.stripe.processing_cents, "held_cents follows what is left in Processing");
    assert.equal(shorter.total_cents, 5000);
  }
  // Fix round 27 (re-test 2, shot 01): the server read Stripe while a
  // withdrawal's $1,293.18 sat in the Stripe account, its payout not yet made
  // (held: Processing, out of Paid out). A newer database read has recorded
  // the payout (on its way: the database's Processing). The Stripe part must
  // drop what that withdrawal held, or it is counted twice: "$3,083.99 on its
  // way", Paid out -$1,293.18, "(estimated USD)".
  {
    const { withStripePart } = await import("../src/app/order/payment-summary.mjs");
    const atRead = tsc({ processing_cents: 49763, paid_out_cents: 129318,
      withdrawals: [{ id: "w-small", road: "stripe", word: "on_its_way", amount_cents: 49763 }] });
    const stripe = { available: [{ amount: 117600, currency: "eur" }], pending: [], held: [{ amount: 117600, currency: "eur" }],
      held_by: [{ id: "w-race", amount: 117600, currency: "eur" }] };
    const server = balanceFigures(atRead, stripe, { rates: { EUR: 1.1 } });
    assert.equal(server.processing_cents, 179081, "at the read: both withdrawals on their way, $1,790.81");
    assert.equal(server.paid_out_cents, 0, "at the read: nothing paid out");
    assert.deepEqual(server.stripe.held_by, [{ id: "w-race", cents: 129318 }], "the held part, per withdrawal, after the cap");
    const later = tsc({ processing_cents: 179081, paid_out_cents: 0,
      withdrawals: [{ id: "w-small", road: "stripe", word: "on_its_way", amount_cents: 49763 }, { id: "w-race", road: "stripe", word: "on_its_way", amount_cents: 129318 }] });
    const merged = withStripePart(later, server);
    assert.equal(merged.processing_cents, 179081, "merged: $1,790.81 on its way, not $3,083.99");
    assert.equal(merged.paid_out_cents, 0, "merged: Paid out never below zero");
    assert.equal(merged.available_cents, 0);
    assert.equal(merged.estimated, false, "merged: no Stripe money counted, so no estimate");
    assert.equal(merged.stripe.processing_cents, 0, "merged: the Stripe part dropped");
    assert.equal(merged.total_cents, 179081, "merged: Total is the newer database's");
    // Still open in the newer read: kept as the server had it.
    const stillOpen = withStripePart(tsc({ processing_cents: 49763, paid_out_cents: 129318, withdrawals: atRead.withdrawals }), server);
    assert.equal(stillOpen.processing_cents, 179081, "not yet recorded: the held part stays in Processing");
    assert.equal(stillOpen.paid_out_cents, 0);
    assert.equal(stillOpen.estimated, true, "and the figures stay estimates");
    // An answer without held_by (an older server): Paid out still never below zero.
    const old = { ...server, stripe: { ...server.stripe, held_by: undefined } };
    const clamped = withStripePart(later, old);
    assert.ok(clamped.paid_out_cents >= 0, "no per-withdrawal part: Paid out is still never below zero");
    assert.equal(clamped.processing_cents, 179081, "and nothing counted twice");
    assert.equal(clamped.total_cents, 179081);
    // The server reads Stripe, the database and what is held from one moment.
    const connect = (await import("node:fs")).readFileSync(new URL("../api/stripe-connect.js", import.meta.url), "utf8");
    assert.equal(connect.split("consistentMoneyRead(db, existing.stripe_account_id, async () => {").length - 1, 2,
      "the balance and the members' figures read Stripe and the database from one moment");
    assert.equal(connect.split("held_by: heldByRows(heldById),").length - 1, 2, "both pass the held part per withdrawal");
    const withdrawalsSource = (await import("node:fs")).readFileSync(new URL("../api/_stripe-withdrawals.js", import.meta.url), "utf8");
    assert.ok(withdrawalsSource.includes("if (before === after) return { ...result, consistent: true };"), "a withdrawal that changed during the read is read again");
    const card = (await import("node:fs")).readFileSync(new URL("../src/app/order/StripePayoutCard.jsx", import.meta.url), "utf8");
    assert.ok(card.includes("const heldElsewhere = stripeCounted === 0 ? [] :"), "no estimate line when the figures count no Stripe money");
  }
  // Fix round 28 (money review r27). The page kept the last server answer's
  // Stripe part and merged it with a newer database read. That is only right
  // while nothing moved money in the factory's Stripe account; when a Stripe
  // withdrawal changed, the page now asks the server again.
  {
    const { withStripePart, stripePartStale, askUntilConsistent } = await import("../src/app/order/payment-summary.mjs");
    const { consistentMoneyRead, openWithdrawalsKey } = await import("../api/_stripe-withdrawals.js");
    const fs = await import("node:fs");
    // F1: tab A read at S: $300 of the factory's own money back in its Stripe
    // account (a payout that failed), $495 owed. Another tab then withdrew
    // both by Stripe and the payout was made. Tab A's newer database read has
    // that withdrawal on its way; S's Stripe part still has the $300.
    const atS = tsc({ available_cents: 49500, paid_out_cents: 100000, withdrawals: [] });
    const server = balanceFigures(atS, { available: [{ amount: 30000, currency: "usd" }], pending: [], held: [], held_by: [] }, null);
    assert.deepEqual([server.available_cents, server.paid_out_cents], [79500, 70000], "F1 at S: $795 available, $700 paid out");
    const later = tsc({ available_cents: 0, processing_cents: 79500, paid_out_cents: 70000,
      withdrawals: [{ id: "w-other-tab", road: "stripe", word: "on_its_way", amount_cents: 79500 }] });
    assert.equal(stripePartStale(later, server), true, "F1: a Stripe withdrawal the answer never saw: its Stripe part is stale");
    const merged = withStripePart(later, server);
    assert.equal(merged.stripe_part_stale, true, "F1: the merge says so, and the page asks the server again");
    assert.equal(merged.total_cents, 149500, "F1: Total is still the newer database's");
    // What the server answers when asked again (Stripe now empty): the truth.
    const again = balanceFigures(later, { available: [], pending: [], held: [], held_by: [] }, null);
    assert.deepEqual([again.available_cents, again.processing_cents, again.paid_out_cents], [0, 79500, 70000], "F1: asked again, nothing counted twice");
    assert.equal(again.consistent, undefined, "and that answer is consistent");
    // F2: W held $300 of the factory's own Stripe money at S, then was refused
    // (or its fee given back, or its payout failed): the money is back in
    // Stripe's available, which only the server can read.
    const openAtS = tsc({ paid_out_cents: 100000, withdrawals: [] });
    const heldAtS = balanceFigures(openAtS, { available: [{ amount: 30000, currency: "usd" }], pending: [], held: [{ amount: 30000, currency: "usd" }],
      held_by: [{ id: "w-refused", amount: 30000, currency: "usd" }] }, null);
    for (const word of ["returned"]) {
      const refused = tsc({ paid_out_cents: 100000, withdrawals: [{ id: "w-refused", road: "stripe", word, amount_cents: 30000 }] });
      assert.equal(stripePartStale(refused, heldAtS), true, `F2: a withdrawal the answer had open, now ${word}: ask again`);
      assert.equal(withStripePart(refused, heldAtS).stripe_part_stale, true, "F2: the merge says so");
    }
    const failedLater = { ...server, tsc: { ...server.tsc, withdrawals: [{ id: "w-p", road: "stripe", word: "on_its_way" }] } };
    assert.equal(stripePartStale(tsc({ withdrawals: [{ id: "w-p", road: "stripe", word: "returned" }] }), failedLater), true,
      "F2: a payout that was on its way and failed: ask again");
    assert.equal(stripePartStale(tsc({ withdrawals: [{ id: "w-p", road: "stripe", word: "paid" }] }), failedLater), false,
      "a payout that arrived moves nothing in Stripe: no need to ask");
    assert.equal(stripePartStale(tsc({ withdrawals: [{ id: "w-p", road: "stripe", word: "on_its_way" }, { id: "p1", road: "pool", word: "waiting" }] }), failedLater), false,
      "nothing new by Stripe (a PayPal or Wise withdrawal is the database's own): the merge is kept");
    assert.equal(withStripePart(tsc({ paid_out_cents: 100000, withdrawals: [] }), server).stripe_part_stale, undefined, "a merge that can be kept is not marked");
    // F5: the clamp is a bridge only: a merge that had to clamp asks again.
    const clamped = withStripePart(tsc({ paid_out_cents: 1000, withdrawals: [] }), server);
    assert.equal(clamped.paid_out_cents, 0, "F5: Paid out never below zero");
    assert.equal(clamped.stripe_part_stale, true, "F5: and the page asks the server again");
    // The server's own clamp with every amount in US dollars: not consistent.
    const usdClamp = balanceFigures(tsc({ paid_out_cents: 1000 }), { available: [{ amount: 30000, currency: "usd" }], pending: [], held: [] }, null);
    assert.equal(usdClamp.consistent, false, "F5: a US$ clamp on the server says the reads disagree");
    const fxClamp = balanceFigures(tsc({ paid_out_cents: 32990 }), { available: [{ amount: 30000, currency: "eur" }], pending: [], held: [] }, { rates: { EUR: 1.1 } });
    assert.equal(fxClamp.consistent, undefined, "a clamp at an indicative rate is the rate, not a disagreement");

    // The page: a stripe_withdrawals change, or a stale merge, asks the server again.
    const page = fs.readFileSync(new URL("../src/app/order/PayoutDetails.jsx", import.meta.url), "utf8");
    assert.ok(page.includes("if (moved && withdrawalAskCap.current.allow(payload?.new?.id ?? payload?.old?.id)) askStripeAgain();"),
      "F1: a Stripe withdrawal changing asks the server again, not only the database (money fields only since round 29)");
    assert.ok(page.includes("const partStale = Boolean(allFigures?.stripe_part_stale);") && page.includes("if (staleAsks.current >= 2) return;"),
      "a stale merge asks again, at most twice in a row");
    assert.ok(page.includes("if (clearingPath.current) askFigures();") && page.includes("setRereadKey((key) => key + 1)"),
      "members ask the figures action (within its limit since round 29); the owner's card reads its balance again");
    const cardSource = fs.readFileSync(new URL("../src/app/order/StripePayoutCard.jsx", import.meta.url), "utf8");
    assert.ok(cardSource.includes("if (!rereadKey || !isOwner || !account) return;"), "the card reads again when the page asks");
    assert.ok(/setWithdrawal\(\{ previous: true[^\n]*\n\s*setError\(null\);\s*\n\s*setModal\("withdraw"\)/.test(cardSource),
      "nit: Withdraw previous balance clears an earlier error when it opens");

    // F3: the key changes when a take turns sent or a fee reversal is written,
    // though the withdrawal's state and transfers_done_at do not.
    const fakeDb = (states) => {
      let call = 0;
      return {
        reads: () => call,
        from(table) {
          const chain = {
            select() { return chain; }, eq() { return chain; }, in() { return chain; }, order() { return chain; },
            then(resolve) {
              const state = states[Math.min(call, states.length - 1)];
              if (table === "payment_takes") call += 1;
              resolve({ data: table === "stripe_withdrawals" ? state.rows : state.takes, error: null });
            },
          };
          return chain;
        },
      };
    };
    const open = [{ id: "w1", state: "claimed", transfers_done_at: null, updated_at: "t0", reversals: [] }];
    const heldTake = { rows: open, takes: [{ id: "k1", stripe_withdrawal_id: "w1", status: "held" }] };
    const sentTake = { rows: open, takes: [{ id: "k1", stripe_withdrawal_id: "w1", status: "sent" }] };
    assert.notEqual(await openWithdrawalsKey(fakeDb([heldTake]), "acct"), await openWithdrawalsKey(fakeDb([sentTake]), "acct"),
      "F3: a take landing changes the key");
    const reversed = { rows: [{ ...open[0], updated_at: "t1", reversals: [{ transfer: "tr", amount: 300, reversal: "trr", local: 300 }] }], takes: heldTake.takes };
    assert.notEqual(await openWithdrawalsKey(fakeDb([heldTake]), "acct"), await openWithdrawalsKey(fakeDb([reversed]), "acct"),
      "F3: a fee reversal changes the key");
    // A take landing between the key reads: read again, then consistent.
    let reads = 0;
    const db3 = fakeDb([heldTake, sentTake, sentTake, sentTake]);
    const result = await consistentMoneyRead(db3, "acct", async () => { reads += 1; return { n: reads }; });
    assert.equal(reads, 2, "F3: a read during a transfer is read again");
    assert.equal(result.consistent, true);
    // F4: still changing after three reads: said, never silently returned.
    reads = 0;
    const churn = await consistentMoneyRead(fakeDb([heldTake, sentTake, heldTake, sentTake, heldTake, sentTake, heldTake]), "acct", async () => { reads += 1; return {}; });
    assert.equal(reads, 3, "F4: at most three reads");
    assert.equal(churn.consistent, false, "F4: and the answer says it is not consistent");
    // F4: the key cannot be read: one read, not three, and said.
    reads = 0;
    const broken = { from() { const c = { select: () => c, eq: () => c, in: () => c, order: () => c, then: (ok) => ok({ data: null, error: { message: "down" } }) }; return c; } };
    const once = await consistentMoneyRead(broken, "acct", async () => { reads += 1; return {}; });
    assert.equal(reads, 1, "F4: no key, one read");
    assert.equal(once.consistent, false);
    // F4: the page asks again shortly, a bounded number of times.
    let asks = 0;
    const answers = [{ figures: { consistent: false } }, { figures: { consistent: false } }, { figures: {} }];
    const final = await askUntilConsistent(async () => answers[asks++], { wait: async () => {} });
    assert.equal(asks, 3, "F4: asked again while not consistent");
    assert.equal(final, answers[2]);
    asks = 0;
    await askUntilConsistent(async () => { asks += 1; return { figures: { consistent: false } }; }, { wait: async () => {} });
    assert.equal(asks, 3, "F4: never more than three asks");
    asks = 0;
    const kept = await askUntilConsistent(async () => { asks += 1; if (asks > 1) throw new Error("down"); return { figures: { consistent: false }, first: true }; }, { wait: async () => {} });
    assert.equal(kept.first, true, "a later ask that fails keeps the answer before it");
    const connectSource = fs.readFileSync(new URL("../api/stripe-connect.js", import.meta.url), "utf8");
    assert.equal(connectSource.split("checkedFigures(figures, consistent, orgId);").length - 1, 2, "F4: both reads say when they are not consistent");
    assert.ok(cardSource.includes("askUntilConsistent(() => connectAction(org.id, \"balance\"))") && page.includes("askUntilConsistent(() => connectAction(org.id, \"figures\"))"),
      "F4: the owner's balance and the members' figures are asked again when not consistent");
  }
  // Fix round 29 (money review r28).
  {
    const fs = await import("node:fs");
    const { stripeWithdrawalMoved, realtimeAskCap, figuresAskDelay, answerOrder, figuresAfterFailedAsk } = await import("../src/app/order/payment-summary.mjs");
    const { settleAbandoned, openWithdrawalsKey } = await import("../api/_stripe-withdrawals.js");
    // N1: a withdrawal left half-way whose settle keeps failing (Stripe 500 on
    // the payout list). A fake database that publishes every change as a
    // realtime event, the real settleAbandoned, and the page's filter + cap.
    const loop = () => {
      const row = { id: "w-stuck", org_id: "o1", stripe_account_id: "acct", request_key: "k", state: "fee_taken", usd_cents: null, fee_cents: 300,
        reversals: [], transfers_done_at: null, payout_id: null, payout_status: null, refusal_cause: null, lease_until: null, updated_at: "t0" };
      const events = [];
      let tick = 0;
      const emit = () => events.push({ eventType: "UPDATE", new: { ...row }, old: { id: row.id } });
      const db = {
        claims: 0,
        from() {
          const filters = {};
          let patch = null;
          const chain = {
            select() { return chain; }, in() { return chain; }, order() { return chain; },
            eq(column, value) { filters[column] = value; return chain; },
            update(fields) { patch = fields; return chain; },
            maybeSingle: async () => ({ data: { ...row }, error: null }),
            then(resolve, reject) {
              if (patch) {
                if (filters.lease_until !== undefined && filters.lease_until !== row.lease_until) return Promise.resolve({ data: null, error: null }).then(resolve, reject);
                Object.assign(row, patch, { updated_at: `t${++tick}` });
                emit();
                return Promise.resolve({ data: null, error: null }).then(resolve, reject);
              }
              return Promise.resolve({ data: ["claimed", "fee_taken"].includes(row.state) ? [{ ...row }] : [], error: null }).then(resolve, reject);
            },
          };
          return chain;
        },
        async rpc(name) {
          assert.equal(name, "claim_abandoned_stripe_withdrawal");
          if (row.lease_until && Date.parse(row.lease_until) > Date.now()) return { data: null, error: null };
          db.claims += 1;
          Object.assign(row, { lease_until: new Date(Date.now() + 120_000).toISOString(), updated_at: `t${++tick}` });
          emit();
          return { data: { ...row }, error: null };
        },
      };
      const stripe = { payouts: { list: async () => { throw Object.assign(new Error("Stripe is down"), { statusCode: 500 }); } } };
      return { row, events, db, stripe };
    };
    // Server: a failed settle leaves its lease to lapse, so ten balance reads
    // in a row claim it once; the old code released it and claimed it ten times.
    {
      const { row, events, db, stripe } = loop();
      for (let read = 0; read < 10; read += 1) await settleAbandoned({ stripe, db, accountId: "acct" }).catch(() => null);
      assert.equal(db.claims, 1, "N1: a settle that keeps failing is tried once per lease, not on every read");
      assert.ok(row.lease_until, "N1: its lease is left to lapse");
      assert.equal(events.length, 1, "N1: one change heard, not two per read");
    }
    // Client: lease and updated_at changes ask nothing; money changes ask, capped.
    {
      const seen = new Map();
      const cap = realtimeAskCap();
      let asks = 0;
      const hear = (payload, now) => { if (stripeWithdrawalMoved(seen, payload) && cap.allow(payload.new?.id ?? payload.old?.id, now)) asks += 1; };
      const base = { id: "w1", state: "fee_taken", fee_cents: 300, reversals: [{ transfer: "tr", amount: 300 }], transfers_done_at: null, payout_id: null, payout_status: null, refusal_cause: null };
      hear({ new: { ...base, lease_until: null, updated_at: "t0" } }, 0);
      assert.equal(asks, 1, "N1: a withdrawal first heard of asks once");
      for (let i = 1; i <= 50; i += 1) hear({ new: { ...base, lease_until: i % 2 ? `l${i}` : null, updated_at: `t${i}` } }, i * 1500);
      assert.equal(asks, 1, "N1: fifty lease claims and releases ask nothing");
      hear({ new: { ...base, state: "fee_returned", lease_until: null, updated_at: "t51" } }, 80_000);
      assert.equal(asks, 2, "N1: the withdrawal settling asks again");
      for (const [i, field] of ["payout_id", "payout_status", "refusal_cause", "transfers_done_at"].entries()) {
        hear({ new: { ...base, state: "fee_returned", [field]: "x", lease_until: null } }, 81_000 + i);
      }
      assert.equal(asks, 3, "N1: money changes on one withdrawal ask at most twice a minute");
      for (let i = 0; i < 10; i += 1) hear({ new: { ...base, id: `n${i}` } }, 82_000 + i);
      assert.equal(asks, 5, "N1: and at most four times a minute in all (two on w1, two new ones)");
      hear({ new: { ...base, id: "later" } }, 200_000);
      assert.equal(asks, 6, "N1: the cap is per minute");
      assert.equal(stripeWithdrawalMoved(seen, { new: {}, old: { id: "later" } }), true, "a delete is a change");
      // The whole loop: the page asks, the server settles (and fails), the
      // page hears what that changed. It stops on its own.
      const { events, db, stripe } = loop();
      const pageSeen = new Map();
      const pageCap = realtimeAskCap();
      let heard = 0;
      let pending = 1;
      let rounds = 0;
      while (pending > 0 && rounds < 50) {
        pending -= 1;
        rounds += 1;
        await settleAbandoned({ stripe, db, accountId: "acct" }).catch(() => null);
        for (; heard < events.length; heard += 1) {
          const event = events[heard];
          if (stripeWithdrawalMoved(pageSeen, event) && pageCap.allow(event.new.id, rounds * 1500)) pending += 1;
        }
      }
      assert.ok(rounds <= 2, `N1: the page and a stuck withdrawal no longer feed each other (${rounds} asks)`);
    }
    // The server's key: the lease and updated_at are not in it.
    {
      // Answers with the columns asked for, as PostgREST does.
      const keyDb = (rows) => ({ from(table) { let columns = []; const c = { select(list) { columns = list.split(",").map((name) => name.trim()); return c; }, eq() { return c; }, in() { return c; }, order() { return c; },
        then(ok) { return ok({ data: table === "stripe_withdrawals" ? rows.map((row) => Object.fromEntries(columns.map((name) => [name, row[name]]))) : [], error: null }); } }; return c; } });
      const open = { id: "w1", state: "claimed", transfers_done_at: null, fee_cents: null, usd_cents: 5000, payout_id: null, refusal_cause: null, reversals: [] };
      assert.equal(await openWithdrawalsKey(keyDb([{ ...open }]), "a"), await openWithdrawalsKey(keyDb([{ ...open, updated_at: "t9", lease_until: "l" }]), "a"),
        "N1: a lease claimed during a read does not make it read again");
      assert.notEqual(await openWithdrawalsKey(keyDb([{ ...open }]), "a"), await openWithdrawalsKey(keyDb([{ ...open, fee_cents: 300 }]), "a"), "a fee taken does");
      const source = fs.readFileSync(new URL("../api/_stripe-withdrawals.js", import.meta.url), "utf8");
      assert.ok(!/OPEN_WITHDRAWAL_KEY_FIELDS = "[^"]*(updated_at|lease_until)/.test(source), "N1: the key names neither");
    }
    // Members: once a minute, whatever asked (a realtime event, a stale merge).
    {
      assert.equal(figuresAskDelay({ now: 100_000, requestedAt: 100_000, lastAskAt: 0, limited: true }), 1500, "a member past the minute waits out the debounce only");
      assert.equal(figuresAskDelay({ now: 101_500, requestedAt: 100_000, lastAskAt: 0, limited: true }), 0);
      assert.equal(figuresAskDelay({ now: 20_000, requestedAt: 20_000, lastAskAt: 15_000, limited: true }), 55_000, "N1: a member asked 5 s ago waits for the minute");
      assert.equal(figuresAskDelay({ now: 21_500, requestedAt: 20_000, lastAskAt: 20_500, limited: true }), null, "an ask made since answers it: no second ask");
      assert.equal(figuresAskDelay({ now: 20_000, requestedAt: 20_000, lastAskAt: 19_000, limited: false }), 1500, "an owner's card only waits out the debounce");
      // Simulated: 30 money events over 5 minutes on a member's page ask at most once a minute.
      let lastAskAt = -60_000;
      const askTimes = [];
      let requestedAt = null;
      for (let now = 0; now <= 300_000; now += 500) {
        if (now % 10_000 === 0) requestedAt = now;
        if (requestedAt == null) continue;
        const delay = figuresAskDelay({ now, requestedAt, lastAskAt, limited: true });
        if (delay === null) { requestedAt = null; continue; }
        if (delay === 0) { askTimes.push(now); lastAskAt = now; requestedAt = null; }
      }
      assert.ok(askTimes.every((at, i) => i === 0 || at - askTimes[i - 1] >= 60_000), "N1: a member's page asks at most once a minute");
      assert.ok(askTimes.length >= 4, "and still asks, a minute apart");
      const page = fs.readFileSync(new URL("../src/app/order/PayoutDetails.jsx", import.meta.url), "utf8");
      const listedSeen = new Map();
      stripeWithdrawalMoved(listedSeen, { new: { id: "x", state: "claimed", lease_until: null, updated_at: "a", payout_arrives_on: null } }, { anyField: true });
      assert.equal(stripeWithdrawalMoved(listedSeen, { new: { id: "x", state: "claimed", lease_until: "l", updated_at: "b", payout_arrives_on: null } }, { anyField: true }), false,
        "N1: a lease alone does not even re-read the database");
      assert.equal(stripeWithdrawalMoved(listedSeen, { new: { id: "x", state: "claimed", lease_until: "l", updated_at: "c", payout_arrives_on: "2026-11-25" } }, { anyField: true }), true,
        "an arrival day does (the list shows it), without asking the server");
      assert.ok(page.includes("const moved = stripeWithdrawalMoved(withdrawalsSeen.current, payload);") && page.includes("if (listed || moved) refresh();")
        && page.includes("if (moved && withdrawalAskCap.current.allow(payload?.new?.id ?? payload?.old?.id)) askStripeAgain();")
        && page.includes("const withdrawalAskCap = useRef(realtimeAskCap());")
        && page.includes("now: Date.now(), requestedAt: askRequestedAt.current, lastAskAt: clearingAskedAt.current, limited: clearingPath.current,"),
        "N1: the page filters, caps, and keeps the members' minute");
    }
    // N2: answers apply in the order asked.
    {
      const order = answerOrder();
      const first = order.start();
      const second = order.start();
      assert.equal(order.accept(second), true);
      assert.equal(order.accept(first), false, "N2: an older answer landing last is dropped");
      const third = order.start();
      order.skip();
      assert.equal(order.accept(third), false, "a reset (a withdrawal just made) drops what was asked before it");
      // Two overlapping asks, the older one slow: the newer answer stays.
      const figuresOrder = answerOrder();
      let shown = null;
      const ask = async (value, ms) => {
        const n = figuresOrder.start();
        await new Promise((resolve) => { setTimeout(resolve, ms); });
        if (figuresOrder.accept(n)) shown = value;
      };
      await Promise.all([ask("older", 30), ask("newer", 5)]);
      assert.equal(shown, "newer", "N2: the newer answer wins whatever lands last");
      const page = fs.readFileSync(new URL("../src/app/order/PayoutDetails.jsx", import.meta.url), "utf8");
      const card = fs.readFileSync(new URL("../src/app/order/StripePayoutCard.jsx", import.meta.url), "utf8");
      assert.ok(page.includes("if (!figuresOrder.current.accept(asked)) return;"), "N2: the members' figures in order");
      assert.ok(card.includes("if (!balanceOrder.current.accept(asked)) return nextBalance;") && card.includes("if (!balanceOrder.current.accept(asked)) continue;")
        && card.includes("balanceOrder.current.skip();\n      setBalance(null);"), "N2: the card's read and re-read in order");
    }
    // N3: a member's failed re-ask keeps the last answer, and its time.
    {
      const good = { available_cents: 100 };
      const fallback = { available_cents: 50, stripe_unavailable: true };
      assert.deepEqual(figuresAfterFailedAsk(good, new Error("network")), { figures: good, dated: false }, "N3: a network error keeps the last answer");
      assert.deepEqual(figuresAfterFailedAsk(good, Object.assign(new Error("502"), { details: { figures: fallback } })), { figures: good, dated: false }, "N3: so does a 502");
      assert.deepEqual(figuresAfterFailedAsk(fallback, new Error("403")), { figures: fallback, dated: false }, "N3: the last answer's 'Stripe unavailable' mark stays");
      assert.deepEqual(figuresAfterFailedAsk(undefined, Object.assign(new Error("502"), { details: { figures: fallback } })), { figures: fallback, dated: true }, "a first ask shows the server's fallback");
      assert.deepEqual(figuresAfterFailedAsk(undefined, new Error("network")), { figures: null, dated: true }, "or nothing");
    }
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
  const { withdrawWithFee, checkStripeWithdrawal, returnFeeOnFailedPayout, settleAbandoned, refreshPayoutsFor, heldByOpenWithdrawals, CANNOT_PROCESS: CANNOT } = await import("../api/_stripe-withdrawals.js");
  const { PayoutMethodRefusal } = await import("../api/_stripe-payouts.js");
  const { stripeWithdrawalFee } = await import("../src/shared/withdrawal-fees.mjs");
  const { randomUUID } = await import("node:crypto");

  const iterable = (items) => ({ data: items, has_more: false, async *[Symbol.asyncIterator]() { yield* items; } });

  function oneBalanceWorld({ currency = "usd", rate = 1, d1 = 0, platform = 1_000_000, steps, disputed = [], refunded = [] }) {
    const rows = [];
    const takes = [];
    const calls = [];
    const notices = [];
    const leased = (row) => row.lease_until && Date.parse(row.lease_until) > Date.now();
    const lease = () => new Date(Date.now() + 120_000).toISOString();
    const left = (step) => step.amount - takes.filter((t) => t.payment_id === step.id && t.status !== "returned").reduce((a, t) => a + t.amount_cents, 0);
    const stripeReach = () => steps.filter((step) => step.charge && step.cleared !== false).reduce((a, step) => a + left(step), 0);
    function table(rowsOf, afterPatch = () => {}) {
      return () => {
        const filters = [];
        let patch = null;
        const matches = () => rowsOf().filter((row) => filters.every((f) => f(row)));
        const q = {
          select() { return q; },
          update(fields) { patch = fields; return q; },
          eq(column, value) {
            filters.push((row) => row[column] === value);
            if (patch) for (const row of matches()) { Object.assign(row, structuredClone(patch)); afterPatch(row, patch); }
            return q;
          },
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
    // The database's stripe_withdrawals_end_takes trigger: an ended withdrawal
    // hands back the parts never asked of Stripe (20261121350000).
    const withdrawalsTable = table(() => rows, (row, patch) => {
      if (!["refused", "fee_returned"].includes(patch.state)) return;
      for (const take of takes) if (take.stripe_withdrawal_id === row.id && take.status === "held" && !take.attempted_at) take.status = "returned";
    });
    const takesTable = table(() => takes.map((take) => {
      const step = steps.find((s) => s.id === take.payment_id);
      return { ...take, order_payments: { stripe_charge_id: step.charge, order_id: step.order, state: step.refundRecorded ? "failed" : "confirmed",
        disputed_at: step.disputedRecorded ? new Date().toISOString() : null, production_orders: { order_number: step.number ?? "TSC-1" } } };
    }));
    const db = {
      rows, takes, calls, notices,
      from(name) {
        if (name === "stripe_withdrawals") return withdrawalsTable();
        if (name === "payment_takes") return takesTable();
        if (name === "stripe_connect_accounts") return table(() => [])();
        if (name === "notifications") {
          const q = table(() => notices)();
          q.insert = async (row) => { notices.push({ id: randomUUID(), ...row }); return { data: null, error: null }; };
          return q;
        }
        if (name === "order_payments") return table(() => steps.map((step) => ({ id: step.id, state: "confirmed", order_id: step.order,
          stripe_payment_intent_id: `pi_${step.id}`, stripe_charge_id: step.charge })))();
        throw new Error(`unexpected table ${name}`);
      },
      async rpc(name, args) {
        calls.push(name);
        (db.callArgs ??= []).push([name, args]);
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
        if (name === "claim_abandoned_stripe_withdrawal") {
          // Only a withdrawal still open and no longer held by any call.
          const row = rows.find((r) => r.id === args.target);
          if (!row || !["claimed", "fee_taken"].includes(row.state) || leased(row)) return { data: null, error: null };
          row.lease_until = lease();
          return { data: structuredClone(row), error: null };
        }
        if (name === "claim_owed_steps") {
          assert.equal(args.road, "stripe", "the Stripe road claims as stripe");
          // A debt recorded after the server read the reach: the database refuses (20261121230000).
          if (db.claimOwes) return { data: null, error: { message: "the factory owes TSC $50.00", code: "22023", hint: "withdrawal_owes_tsc" } };
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
        if (name === "owed_reachable") {
          if (db.reachFails) return { data: null, error: { message: "database did not answer", code: "08006" } };
          return { data: { any_cents: stripeReach(), stripe_cents: stripeReach() }, error: null };
        }
        if (name === "record_take_sent") {
          const take = takes.find((t) => t.id === args.target_take);
          assert.equal(take.status, "held", "only a held take is sent");
          Object.assign(take, { status: "sent", stripe_transfer_id: args.transfer });
          return { data: null, error: null };
        }
        if (name === "mark_take_attempted") {
          const take = takes.find((t) => t.id === args.target_take);
          take.attempted_at ??= new Date().toISOString();
          return { data: take.attempted_at, error: null };
        }
        if (name === "return_take_leased") {
          // Only the call holding the withdrawal's live lease may hand a part back (20261120230000).
          const take = takes.find((t) => t.id === args.target_take);
          const row = rows.find((r) => r.id === take.stripe_withdrawal_id);
          if (row && leased(row) && row.lease_until !== (args.lease ?? null)) {
            return { data: null, error: { message: "this withdrawal is being processed", code: "22023", hint: "withdrawal_busy" } };
          }
          if (take.status === "held") take.status = "returned";
          return { data: null, error: null };
        }
        if (name === "return_sent_take") {
          // A sent part whose transfer was reversed back to TSC (fix round 6): back in the balance.
          if (db.failReturnSent?.(args)) return { data: null, error: { message: "database did not answer", code: "08006" } };
          const take = takes.find((t) => t.id === args.target_take);
          const row = rows.find((r) => r.id === take.stripe_withdrawal_id);
          if (row && leased(row) && row.lease_until !== (args.lease ?? null)) {
            return { data: null, error: { message: "this withdrawal is being processed", code: "22023", hint: "withdrawal_busy" } };
          }
          assert.ok(args.reversal, "a sent part goes back only with the reversal that took it back");
          if (take.status === "sent") Object.assign(take, { status: "returned", reversal_id: args.reversal });
          return { data: null, error: null };
        }
        if (name === "lease_stripe_withdrawal") {
          const row = rows.find((r) => r.id === args.target);
          if (!row || leased(row)) return { data: null, error: null };
          row.lease_until = lease();
          return { data: structuredClone(row), error: null };
        }
        if (name === "record_payment_refunded" || name === "record_payment_refund_amount") {
          steps.find((st) => st.id === args.target_payment).refundRecorded = true;
          return { data: null, error: null };
        }
        // Here a refund takes the whole step: every part held on it is no longer covered.
        if (name === "withdrawal_refunded_part") {
          const short = takes.filter((t) => t.stripe_withdrawal_id === args.target_withdrawal && t.status === "held"
            && steps.find((st) => st.id === t.payment_id)?.refundRecorded).reduce((sum, t) => sum + t.amount_cents, 0);
          return { data: short, error: null };
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
          const refusal = s.onReversal?.(id, params);
          if (refusal) throw refusal;
          const transfer = s.transfers.find((t) => t.id === id);
          transfer.amount_reversed += params.amount;
          const local = currency === "usd" ? params.amount : Math.ceil(params.amount * rate);
          s.balance[currency] -= local;
          const reversal = { id: `trr_${++n}`, transfer: id, amount: params.amount, metadata: params.metadata, destination_payment_refund: `pyr_${n}`, local };
          s.reversals.push(reversal);
          s.platform += params.amount;
          return structuredClone(reversal);
        }),
      },
      charges: {
        retrieve: async (id) => {
          if (id.startsWith("py_")) {
            const transfer = s.transfers.find((t) => t.destination_payment === id);
            return { id, balance_transaction: { currency, exchange_rate: currency === "usd" ? 1 : rate, amount: transfer.local,
              status: transfer.landedPending ? "pending" : "available" } };
          }
          const isRefunded = refunded.includes(id);
          return { id, payment_intent: `pi_${id.slice(3)}`, amount_refunded: isRefunded ? 1 : 0, refunded: isRefunded,
            disputed: disputed.includes(id) };
        },
      },
      disputes: { retrieve: async () => ({ status: "needs_response" }),
        list: async ({ charge }) => ({ data: disputed.includes(charge) ? [{ id: `du_${charge}`, status: "needs_response" }] : [] }) },
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
          if (s.payoutRefusal) throw s.payoutRefusal;
          if (s.payoutDown) throw Object.assign(new Error("Stripe did not answer"), { statusCode: 500 });
          if (params.amount > (s.balance[params.currency] ?? 0)) throw refused("insufficient funds", 400);
          s.balance[params.currency] -= params.amount;
          const payout = { id: `po_${++n}`, amount: params.amount, currency: params.currency, status: "pending", metadata: params.metadata ?? {} };
          s.payouts.push(payout);
          // The payout was made, but the answer is lost (the call dies here).
          if (s.payoutAnswerLost) throw Object.assign(new Error("Stripe did not answer"), { type: "StripeConnectionError" });
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

  // Fix round 19 (M2): what the factory may reach could not be read, or the
  // database refuses the claim (a debt recorded since): refused, nothing moves.
  for (const [label, flag] of [["the reach unread", "reachFails"], ["a debt the database sees", "claimOwes"]]) {
    const w = oneBalanceWorld({ steps: [step("q1", 10000)] });
    w.db[flag] = true;
    await assert.rejects(withdraw(w, 5000), (failure) => failure instanceof PayoutMethodRefusal, `${label}: refused`);
    assert.equal(w.stripe.transfers.length, 0, `${label}: nothing transferred`);
    assert.equal(w.stripe.payouts.length, 0, `${label}: nothing paid out`);
    assert.equal(held(w).length, 0, `${label}: nothing held`);
  }

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
    assert.equal(w.stripe.platform, 1_000_000 - 15000 + usFee(15000), "TSC's platform balance paid exactly the claimed parts, and got the fee back");
    // The $50 left on the step and the newest step are still there for the next withdrawal.
    await withdraw(w, 15000);
    assert.deepEqual(w.stripe.transfers.slice(2).map((t) => [t.source_transaction, t.amount]), [["ch_p2", 5000], ["ch_p3", 10000]],
      "the next withdrawal takes the remainder before the newer step");
  }

  // Fix round 5: the company is told of a Stripe withdrawal, as of a PayPal
  // one, in the same words, once.
  {
    const w = oneBalanceWorld({ steps: [step("p1", 10000)] });
    const requestId = randomUUID();
    await withdraw(w, 5000, { requestId });
    const told = w.db.notices.filter((n) => n.kind === "withdrawal" && n.subject_id === w.db.rows[0].id);
    assert.equal(told.length, 1, "one notice for the Stripe withdrawal");
    assert.equal(told[0].title, "Withdrawal of $50.00 requested", "in the PayPal notice's words, the amount asked");
    assert.equal(told[0].body, "To your bank account.");
    assert.equal(told[0].org_id, "org");
    await withdraw(w, 5000, { requestId });
    assert.equal(w.db.notices.filter((n) => n.kind === "withdrawal").length, 1, "pressed again: not told twice");
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
    assert.ok(w.db.calls.includes("record_payment_refund_amount"), "the refund is recorded, at Stripe's amount");
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
    // Fix round 6: refused means nothing left the balance. The part already
    // transferred is reversed back to TSC and returned with the refused one.
    assert.deepEqual(w.db.takes.map((t) => [t.payment_id, t.status]), [["p1", "returned"], ["p2", "returned"]],
      "the transferred part is taken back, and both parts are back in the balance");
    assert.equal(w.stripe.transfers.length, 1);
    assert.deepEqual(w.stripe.reversals.map((r) => [r.transfer, r.amount]), [[w.stripe.transfers[0].id, 10000]], "its whole transfer is reversed");
    assert.equal(w.stripe.balance.usd, 0, "nothing is left in the factory's Stripe account for it");
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
    // Returned only with the reversal that took its transfer back (fix round 6), never while the money sits in the factory's account.
    const backed = (t) => t.status !== "returned" || (t.reversal_id && w.stripe.reversals.some((r) => r.id === t.reversal_id && r.metadata?.take_reversal === t.id));
    assert.ok(backed(take), "F5: a take whose transfer exists is never returned to the balance without taking the transfer back");
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
    const t0 = w.db.takes[0];
    assert.ok(t0.status !== "returned" || (t0.reversal_id && w.stripe.reversals.some((r) => r.id === t0.reversal_id)),
      "F5: nor when the resume finds the platform balance short");
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
    // R3-1: another call holds the withdrawal's lease: Check again touches no
    // part. Fix round 30 (L1): it says the withdrawal is being processed, not
    // "still not settled … check again tomorrow" (the lease lasts 2 minutes).
    {
      const x = stuck({ attemptedAgo: DAY + 3600_000 });
      x.row.lease_until = new Date(Date.now() + 90_000).toISOString();
      let asked = 0;
      x.w.stripe.onTransfer = () => { asked += 1; return undefined; };
      const answer = await check(x);
      assert.equal(x.take.status, "held", "R3-1: a part of a withdrawal another call holds is not touched");
      assert.equal(asked, 0, "and Stripe is not asked");
      assert.equal(answer.done, false);
      assert.equal(answer.sentence, "This withdrawal is being processed. Try again in a few minutes.", "L1: said as being processed");
      assert.equal(answer.unsure, 5000, "the part still counted as not settled");
      assert.ok(Date.parse(x.row.lease_until) > Date.now(), "the other call's lease is left as it was");
    }
    // And a stale return (no lease) while another call holds it is refused by the database.
    {
      const x = stuck();
      x.row.lease_until = new Date(Date.now() + 90_000).toISOString();
      const refusedReturn = await x.w.db.rpc("return_take_leased", { target_take: x.take.id, lease: null });
      assert.equal(refusedReturn.error?.hint, "withdrawal_busy", "the fake database models the lease rule");
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

  // Fix round 6: the payout refused after the transfers went. The transfers
  // are reversed (less the fee reversal that already came back), every part
  // returns to the balance, the owner reads "can't be processed… Nothing was
  // sent", and no step reads Paid.
  {
    const w = oneBalanceWorld({ steps: [step("p1", 10000), step("p2", 10000)] });
    w.stripe.payoutRefusal = Object.assign(new Error("payouts not allowed"), { statusCode: 400 });
    await assert.rejects(withdraw(w, 15000), (failure) => failure instanceof PayoutMethodRefusal && failure.message === CANNOT,
      "the owner is told it can't be processed, nothing was sent");
    assert.deepEqual(w.db.takes.map((t) => t.status), ["returned", "returned"], "every part is back in the balance");
    assert.ok(w.db.takes.every((t) => t.reversal_id), "each with the reversal that took it back");
    const reversed = w.stripe.reversals.reduce((sum, r) => sum + r.amount, 0);
    assert.equal(reversed, 15000, "the transfers are taken back whole, the fee reversal included");
    assert.equal(w.stripe.balance.usd, 0, "nothing stays in the factory's Stripe account");
    assert.equal(w.stripe.platform, 1_000_000, "TSC's platform balance is whole again");
    assert.equal(w.stripe.payouts.length, 0);
    assert.ok(["refused", "fee_returned"].includes(w.db.rows[0].state));
    assert.ok(!w.db.rows[0].refusal_cause, "nothing for staff to check");
    assert.equal(w.stripe.transfers.filter((t) => t.metadata?.stripe_withdrawal_fee_return).length, 0,
      "no fee is given back by transfer: it came back with the reversals");
  }
  // A reversal Stripe refuses: the part stays sent (it is in the factory's
  // account), the withdrawal goes to Needs checking, nothing reads Paid out.
  {
    const w = oneBalanceWorld({ steps: [step("p1", 10000)] });
    w.stripe.payoutRefusal = Object.assign(new Error("payouts not allowed"), { statusCode: 400 });
    w.stripe.onReversal = (_id, params) => (params.metadata?.take_reversal ? Object.assign(new Error("cannot reverse"), { statusCode: 400 }) : null);
    await assert.rejects(withdraw(w, 5000));
    assert.equal(w.db.takes[0].status, "sent", "the part Stripe would not give back stays sent");
    assert.equal(w.db.rows[0].refusal_cause, "reversal_failed", "and the withdrawal is listed for staff (Needs checking)");
    assert.equal(w.stripe.payouts.length, 0, "no payout");
    assert.ok(w.db.rows[0].state !== "paid_out", "never Paid out");
  }
  // Two owners at once, each asking for the whole balance by Stripe: one is
  // paid out, the other is refused before any transfer, and nothing is left
  // stranded in the factory's Stripe account.
  {
    const w = oneBalanceWorld({ steps: [step("p1", 174000)] });
    const both = await Promise.allSettled([withdraw(w, 174000), withdraw(w, 174000)]);
    const paid = both.filter((r) => r.status === "fulfilled");
    assert.equal(paid.length, 1, "one of the two owners is paid out");
    assert.equal(w.stripe.payouts.length, 1, "one payout");
    assert.equal(w.stripe.transfers.length, 1, "one transfer");
    assert.equal(w.db.takes.filter((t) => t.status === "sent").reduce((a, t) => a + t.amount_cents, 0), 174000, "the step was taken once");
    const refused = both.find((r) => r.status === "rejected");
    assert.ok(refused.reason instanceof PayoutMethodRefusal, `the other is told in words (${refused.reason?.message})`);
    const refusedRow = w.db.rows.find((r) => r.state !== "paid_out");
    assert.equal(w.db.takes.filter((t) => t.stripe_withdrawal_id === refusedRow.id && t.status !== "returned").length, 0,
      "the refused one holds and sent nothing: it was refused at its claim, before any transfer");
    assert.equal(w.stripe.balance.usd, 0, "nothing stranded in the factory's Stripe account");
  }

  // The race the tester hit: another owner's one-balance withdrawal is still
  // open (claimed, lease live, nothing landed yet). It must count only its own
  // Stripe part and what it has landed, never its whole estimated gross, or
  // this owner's payout is refused after its transfer went.
  {
    const w = oneBalanceWorld({ steps: [step("p1", 174000)] });
    w.db.rows.push({ id: randomUUID(), org_id: "org", stripe_account_id: "acct_f", request_key: "other-owner", request_id: randomUUID(),
      amount_minor: 174000, currency: "USD", state: "claimed", usd_cents: 174000, owed_cents: null, d1_minor: null, landed_minor: null,
      fee_cents: null, fee_local_minor: null, reversals: [], payout_id: null, lease_until: new Date(Date.now() + 90_000).toISOString(),
      created_at: new Date().toISOString() });
    const payout = await withdraw(w, 174000);
    assert.equal(payout.amount, 174000 - usFee(174000), "the payout goes: the other open withdrawal holds nothing of this money");
    assert.equal(w.db.takes.filter((t) => t.status === "sent").length, 1);
  }

  // Fix round 7, R6-1/R6-2.
  // (2) The payout refused before any payout exists: each sent part's transfer
  // is reversed once, under swx-<take>, less the fee reversal it already gave;
  // one return_sent_take per part; the owner reads CANNOT_PROCESS.
  {
    const w = oneBalanceWorld({ steps: [step("p1", 10000), step("p2", 10000)] });
    w.stripe.payoutRefusal = Object.assign(new Error("payouts not allowed"), { statusCode: 400 });
    await assert.rejects(withdraw(w, 15000), (failure) => failure.message === CANNOT);
    const takeReversals = w.stripe.reversals.filter((r) => r.metadata?.take_reversal);
    assert.equal(takeReversals.length, 2, "one take-back reversal per sent part");
    for (const take of w.db.takes) {
      const mine = takeReversals.filter((r) => r.metadata.take_reversal === take.id);
      assert.equal(mine.length, 1, "each part reversed once");
      assert.ok(w.stripe.keys.has(`swx-${take.id}`), "under the key swx-<take>");
      const feeHere = w.stripe.reversals.filter((r) => r.transfer === mine[0].transfer && r.metadata?.stripe_withdrawal_id).reduce((a, r) => a + r.amount, 0);
      assert.equal(mine[0].amount, take.amount_cents - feeHere, "less the fee reversal it already gave");
    }
    assert.equal(w.db.callArgs.filter(([name]) => name === "return_sent_take").length, 2, "one return_sent_take per part");
  }
  // (1) payout.failed / payout.canceled after the payout was made: only the fee
  // goes back; the parts stay sent (their money is in the factory's Stripe
  // account, as Stripe money); no take-back reversal, no return_sent_take.
  for (const status of ["failed", "canceled"]) {
    const w = oneBalanceWorld({ steps: [step("p1", 10000)] });
    const payout = await withdraw(w, 5000);
    const reversalsBefore = w.stripe.reversals.length;
    const row = w.db.rows[0];
    const failed = { id: payout.id, status, metadata: { stripe_withdrawal_id: row.id } };
    assert.equal(await returnFeeOnFailedPayout({ stripe: w.api, db: w.db, payout: failed }), true, `payout.${status}: the fee goes back`);
    await returnFeeOnFailedPayout({ stripe: w.api, db: w.db, payout: failed });
    const feeBack = w.stripe.transfers.filter((t) => t.metadata?.stripe_withdrawal_fee_return === row.id);
    assert.equal(feeBack.length, 1, `payout.${status}: exactly one fee give-back, even told twice`);
    assert.equal(feeBack[0].amount, usFee(5000));
    assert.equal(w.stripe.reversals.length, reversalsBefore, `payout.${status}: no take-back reversal`);
    assert.ok(!w.db.calls.includes("return_sent_take"), `payout.${status}: no return_sent_take`);
    assert.deepEqual(w.db.takes.map((t) => t.status), ["sent"], `payout.${status}: the part stays sent`);
    assert.equal(w.db.rows[0].state, "fee_returned");
  }
  // (3) Check again on a reversal_failed row: a part whose reversal Stripe made
  // (but whose return was not recorded) is returned with it, no new reversal;
  // a part with no reversal stays sent; the row leaves Needs checking.
  {
    const w = oneBalanceWorld({ steps: [step("p1", 10000), step("p2", 10000)] });
    w.stripe.payoutRefusal = Object.assign(new Error("payouts not allowed"), { statusCode: 400 });
    const p2Take = () => w.db.takes.find((t) => t.payment_id === "p2");
    // p1's take-back reversal goes but its return is not recorded; p2's reversal is refused.
    w.db.failReturnSent = (args) => args.target_take === w.db.takes.find((t) => t.payment_id === "p1")?.id;
    w.stripe.onReversal = (transferId, params) => (params.metadata?.take_reversal && params.metadata.take_reversal === p2Take()?.id
      ? Object.assign(new Error("cannot reverse"), { statusCode: 400 }) : null);
    await assert.rejects(withdraw(w, 15000));
    const row = w.db.rows[0];
    assert.equal(row.refusal_cause, "reversal_failed", "listed under Needs checking");
    assert.deepEqual(w.db.takes.map((t) => [t.payment_id, t.status]), [["p1", "sent"], ["p2", "sent"]]);
    const reversalsBefore = w.stripe.reversals.length;
    const createdBefore = [...w.stripe.keys.keys()].filter((k) => k.startsWith("swx-")).length;
    w.db.failReturnSent = null;
    w.stripe.onReversal = () => { throw new Error("Check again must not make a reversal"); };
    row.lease_until = null;
    await checkStripeWithdrawal({ stripe: w.api, db: w.db, withdrawalId: row.id });
    assert.equal(w.stripe.reversals.length, reversalsBefore, "R6-2: no new reversal");
    assert.equal([...w.stripe.keys.keys()].filter((k) => k.startsWith("swx-")).length, createdBefore);
    const p1 = w.db.takes.find((t) => t.payment_id === "p1");
    assert.equal(p1.status, "returned", "R6-2: the part Stripe already took back is returned");
    assert.ok(w.stripe.reversals.some((r) => r.id === p1.reversal_id && r.metadata?.take_reversal === p1.id), "with its existing reversal");
    assert.equal(p2Take().status, "sent", "R6-2: the part with no reversal stays sent (its money is in the factory's account)");
    assert.equal(w.db.callArgs.filter(([name, args]) => name === "return_sent_take" && args.target_take === p2Take().id).length, 0,
      "and no return is asked for it");
    assert.equal(w.db.rows[0].refusal_cause, null, "R6-2: the row leaves Needs checking");
  }

  // Fix round 7b, R7-1: a withdrawal stopped after its fee was taken, its
  // payout made but the answer lost; the payout then failed (or was
  // cancelled). Settled later (settleAbandoned): the payout is recorded,
  // only the fee goes back, once (swg-<row>), and the parts stay sent: the
  // money is back in the factory's Stripe account as Stripe money.
  for (const status of ["failed", "canceled"]) {
    const w = oneBalanceWorld({ steps: [step("p1", 10000)] });
    w.stripe.payoutAnswerLost = true;
    await assert.rejects(withdraw(w, 5000), (failure) => !(failure instanceof PayoutMethodRefusal));
    w.stripe.payoutAnswerLost = false;
    const row = w.db.rows[0];
    assert.equal(row.state, "fee_taken", "stopped after the fee, before recording the payout");
    w.stripe.payouts[0].status = status;
    row.lease_until = null;
    const reversalsBefore = w.stripe.reversals.length;
    await settleAbandoned({ stripe: w.api, db: w.db, accountId: "acct_f" });
    assert.ok(w.db.rows[0].payout_id === w.stripe.payouts[0].id, `${status}: the payout is recorded`);
    const feeBack = w.stripe.transfers.filter((t) => t.metadata?.stripe_withdrawal_fee_return === row.id);
    assert.equal(feeBack.length, 1, `${status}: exactly one fee give-back`);
    assert.ok(w.stripe.keys.has(`swg-${row.id}`), "under swg-<row>");
    assert.equal(w.stripe.reversals.length, reversalsBefore, `${status}: no take-back reversal`);
    assert.ok(!w.db.calls.includes("return_sent_take"), `${status}: no return_sent_take`);
    assert.deepEqual(w.db.takes.map((t) => t.status), ["sent"], `${status}: the part stays sent`);
    assert.equal(w.db.rows[0].state, "fee_returned");
  }
  // Contrast: stopped after the fee, and no payout exists at all. Then the
  // parts are taken back (reversed) and returned to the balance.
  {
    const w = oneBalanceWorld({ steps: [step("p1", 10000)] });
    w.stripe.payoutDown = true;
    await assert.rejects(withdraw(w, 5000), (failure) => !(failure instanceof PayoutMethodRefusal));
    w.stripe.payoutDown = false;
    const row = w.db.rows[0];
    assert.equal(row.state, "fee_taken");
    assert.equal(w.stripe.payouts.length, 0, "no payout was made");
    row.lease_until = null;
    await settleAbandoned({ stripe: w.api, db: w.db, accountId: "acct_f" });
    assert.deepEqual(w.db.takes.map((t) => t.status), ["returned"], "no payout: the part is taken back and returned");
    assert.ok(w.stripe.reversals.some((r) => r.metadata?.take_reversal === w.db.takes[0].id) || w.db.takes[0].reversal_id,
      "with the reversal that took it back");
    assert.equal(w.stripe.balance.usd, 0, "nothing left in the factory's Stripe account");
  }

  // Fix round 7b, R7-2: Check again on a reversal_failed row whose sent part
  // was taken back whole by this withdrawal's fee reversal (nothing left to
  // reverse): it is returned, with no new reversal, and the row leaves Needs
  // checking.
  {
    // $50 already in the factory's Stripe account, 25c owed: the 25c part's
    // own transfer is the newest, so the fee reversal takes all of it.
    const w = oneBalanceWorld({ d1: 5000, steps: [step("p1", 25)] });
    assert.ok(usFee(5025) >= 25, "the fee is at least the small part");
    w.stripe.payoutRefusal = Object.assign(new Error("payouts not allowed"), { statusCode: 400 });
    w.db.failReturnSent = () => true;
    await assert.rejects(withdraw(w, 5025));
    const row = w.db.rows[0];
    const part = w.db.takes[0];
    assert.equal(part.status, "sent");
    const fromPart = w.stripe.reversals.filter((r) => r.transfer === part.stripe_transfer_id && r.metadata?.stripe_withdrawal_id === row.id)
      .reduce((a, r) => a + r.amount, 0);
    assert.equal(fromPart, 25, "the fee reversal took the part's whole transfer");
    assert.equal(row.refusal_cause, "reversal_failed");
    w.db.failReturnSent = null;
    const reversalsBefore = w.stripe.reversals.length;
    w.stripe.onReversal = () => { throw new Error("Check again must not make a reversal"); };
    row.lease_until = null;
    const asked = w.db.callArgs.length;
    await checkStripeWithdrawal({ stripe: w.api, db: w.db, withdrawalId: row.id });
    assert.equal(w.stripe.reversals.length, reversalsBefore, "R7-2: no new reversal");
    assert.ok(w.db.callArgs.slice(asked).some(([name, args]) => name === "return_sent_take" && args.target_take === part.id), "R7-2: return_sent_take is called for it");
    assert.equal(part.status, "returned", "the part is back in the balance");
    assert.equal(w.db.rows[0].refusal_cause, null, "the row leaves Needs checking");
  }

  // Fix round 8: a refused Stripe withdrawal still records who asked.
  {
    const w = oneBalanceWorld({ steps: [step("p1", 10000)] });
    await assert.rejects(withdraw(w, 20000, { userId: "user-owner-1" }), (failure) => failure instanceof PayoutMethodRefusal);
    assert.equal(w.db.rows[0].state, "refused");
    assert.equal(w.db.rows[0].requested_by, "user-owner-1", "the refused row keeps requested_by");
    const ok1 = oneBalanceWorld({ steps: [step("p1", 10000)] });
    await withdraw(ok1, 5000, { userId: "user-owner-2" });
    assert.equal(ok1.db.rows[0].requested_by, "user-owner-2", "and so does a paid one");
  }

  // Fix round 11 (a): without payout webhooks, a balance read reads back the
  // payouts the database still has on their way, once their day has come.
  {
    const day = (offset) => new Date(Date.now() + offset * 86400_000).toISOString().slice(0, 10);
    // Paid in Stripe, recorded pending with yesterday's arrival: updated.
    const w = oneBalanceWorld({ steps: [step("p1", 10000)] });
    await withdraw(w, 5000);
    const row = w.db.rows[0];
    Object.assign(row, { payout_status: "pending", payout_arrives_on: day(-1) });
    Object.assign(w.stripe.payouts[0], { status: "paid", arrival_date: Math.floor(Date.now() / 1000) - 86400 });
    assert.equal(await refreshPayoutsFor({ stripe: w.api, db: w.db, orgId: "org" }), 1);
    assert.equal(row.payout_status, "paid", "R11: a payout Stripe paid is recorded paid");
    assert.equal(row.payout_arrives_on, day(-1));
    // Failed in Stripe: the fee goes back once, however often it is read.
    const f = oneBalanceWorld({ steps: [step("p1", 10000)] });
    await withdraw(f, 5000);
    Object.assign(f.db.rows[0], { payout_status: "in_transit", payout_arrives_on: day(-1) });
    Object.assign(f.stripe.payouts[0], { status: "failed", metadata: { stripe_withdrawal_id: f.db.rows[0].id } });
    await refreshPayoutsFor({ stripe: f.api, db: f.db, orgId: "org" });
    await refreshPayoutsFor({ stripe: f.api, db: f.db, orgId: "org" });
    assert.equal(f.stripe.transfers.filter((t) => t.metadata?.stripe_withdrawal_fee_return === f.db.rows[0].id).length, 1,
      "R11: a failed payout gives its fee back once (returnFeeOnFailedPayout)");
    assert.equal(f.db.rows[0].state, "fee_returned");
    // Arriving tomorrow: not read. And at most `limit` per read, oldest first.
    const t = oneBalanceWorld({ steps: [step("p1", 10000)] });
    let reads = [];
    t.api.payouts.retrieve = async (id) => (reads.push(id), { id, status: "paid", arrival_date: Math.floor(Date.now() / 1000) });
    const add = (k, arrives, ageMinutes) => t.db.rows.push({ id: `sw-${k}`, org_id: "org", stripe_account_id: "acct_f", state: "paid_out", payout_id: `po_${k}`,
      payout_status: "pending", payout_arrives_on: arrives, created_at: new Date(Date.now() - ageMinutes * 60_000).toISOString(), currency: "USD" });
    add("tomorrow", day(1), 100);
    for (let k = 1; k <= 7; k += 1) add(k, k % 2 ? day(-1) : null, 10 * k);
    await refreshPayoutsFor({ stripe: t.api, db: t.db, orgId: "org" });
    assert.ok(!reads.includes("po_tomorrow"), "R11: a payout arriving tomorrow is not read");
    assert.equal(reads.length, 5, "R11: at most 5 per read");
    assert.deepEqual(reads.sort(), ["po_3", "po_4", "po_5", "po_6", "po_7"], "R11: the oldest first");
    // 13ac6414: a payout's status only moves forward. A stale Stripe answer
    // ranked below what is recorded (pending after in_transit) is ignored.
    {
      const r = oneBalanceWorld({ steps: [step("p1", 10000)] });
      r.db.rows.push({ id: "sw-way", org_id: "org", stripe_account_id: "acct_f", state: "paid_out", payout_id: "po_way",
        payout_status: null, payout_arrives_on: null, created_at: new Date().toISOString() });
      let answer = "in_transit";
      r.api.payouts.retrieve = async (id) => ({ id, status: answer, arrival_date: Math.floor(Date.now() / 1000) - 86400 });
      await refreshPayoutsFor({ stripe: r.api, db: r.db, orgId: "org" });
      assert.equal(r.db.rows.at(-1).payout_status, "in_transit", "a newer answer moves it forward");
      answer = "pending";
      const before = JSON.stringify(r.db.rows.at(-1));
      await refreshPayoutsFor({ stripe: r.api, db: r.db, orgId: "org" });
      assert.equal(JSON.stringify(r.db.rows.at(-1)), before, "a lower-ranked answer is ignored: nothing on the row is written");
    }
    // Never throws.
    const broken = oneBalanceWorld({ steps: [step("p1", 10000)] });
    broken.db.rows.push({ id: "sw-x", org_id: "org", stripe_account_id: "acct_f", state: "paid_out", payout_id: "po_x", payout_status: null,
      payout_arrives_on: null, created_at: new Date().toISOString() });
    broken.api.payouts.retrieve = async () => { throw new Error("Stripe down"); };
    assert.equal(await refreshPayoutsFor({ stripe: broken.api, db: broken.db, orgId: "org" }), 0, "R11: a failed read never throws");
  }

  // 37b6c70f: what other open withdrawals on the account still hold of the
  // money in it (heldByOpenWithdrawals), so Withdraw never offers it twice.
  {
    const w = oneBalanceWorld({ steps: [step("p1", 10000)] });
    const base = { org_id: "org", stripe_account_id: "acct_f", request_id: randomUUID(), fee_cents: null, reversals: [], payout_id: null,
      lease_until: null, created_at: new Date().toISOString() };
    // Mid-transfer (one balance, transfers not done): its own Stripe part plus the parts already sent.
    w.db.rows.push({ ...base, id: "mid", request_key: "mid", state: "claimed", currency: "USD", amount_minor: 9000, usd_cents: 9000,
      d1_minor: 1500, transfers_done_at: null });
    w.db.takes.push({ id: "t-sent", payment_id: "p1", stripe_withdrawal_id: "mid", amount_cents: 2500, status: "sent" },
      { id: "t-held", payment_id: "p1", stripe_withdrawal_id: "mid", amount_cents: 5000, status: "held" });
    // Fee taken, payout not made: its amount less the fee already taken back.
    w.db.rows.push({ ...base, id: "fee", request_key: "fee", state: "fee_taken", currency: "USD", amount_minor: 4000, usd_cents: 4000,
      d1_minor: 0, transfers_done_at: new Date().toISOString(), fee_local_minor: 120 });
    // Ignored: refused and paid out.
    w.db.rows.push({ ...base, id: "refused", request_key: "refused", state: "refused", currency: "USD", amount_minor: 99999, usd_cents: 99999 },
      { ...base, id: "paid", request_key: "paid", state: "paid_out", currency: "USD", amount_minor: 88888, usd_cents: 88888 });
    // A non-US$ one, mid-transfer: sent US$ parts at its own rate.
    w.db.rows.push({ ...base, id: "eur", request_key: "eur", state: "claimed", currency: "EUR", amount_minor: 9100, usd_cents: 10000,
      d1_minor: 0, transfers_done_at: null });
    w.db.takes.push({ id: "t-eur", payment_id: "p1", stripe_withdrawal_id: "eur", amount_cents: 1000, status: "sent" });
    // Its sent part's transfer, landed as Stripe available.
    w.stripe.transfers.push({ id: "tr_mid", amount: 2500, currency: "usd", destination: "acct_f", destination_payment: "py_mid", local: 2500, metadata: {} });
    w.db.takes.find((t) => t.id === "t-sent").stripe_transfer_id = "tr_mid";
    const held = await heldByOpenWithdrawals(w.db, "acct_f");
    assert.equal(held.usd, (1500 + 2500) + (4000 - 120), "mid-transfer: Stripe part + parts sent; fee taken: amount less the fee; refused and paid out ignored");
    assert.equal(held.eur, 910, "a non-US$ row: its sent parts at its own rate");
    const byId = {};
    await heldByOpenWithdrawals(w.db, "acct_f", null, { byId });
    assert.ok(byId.mid && byId.eur && !byId.refused && !byId.paid, "each open row's own claim; refused and paid out ignored");
    assert.deepEqual(byId.eur, { amount: 910, currency: "eur" }, "per withdrawal, in its currency");
    assert.equal(Object.values(byId).filter((row) => row.currency === "usd").reduce((sum, row) => sum + row.amount, 0), held.usd, "and they add up to the per-currency total");
    assert.equal((await heldByOpenWithdrawals(w.db, "acct_f", "mid")).usd, 4000 - 120, "the withdrawal being made is not counted against itself");
    // 4a445bb2: with Stripe at hand, a sent part still clearing (its landed
    // balance transaction pending) is Stripe's pending, not held of available.
    assert.equal((await heldByOpenWithdrawals(w.db, "acct_f", null, { stripe: w.api })).usd, (1500 + 2500) + (4000 - 120),
      "landed as available: still held");
    w.stripe.transfers.find((t) => t.id === "tr_mid").landedPending = true;
    assert.equal((await heldByOpenWithdrawals(w.db, "acct_f", null, { stripe: w.api })).usd, 1500 + (4000 - 120),
      "landed as pending: left out; the withdrawal's own Stripe-account part stays in");
    w.api.transfers.retrieve = async () => { throw new Error("Stripe down"); };
    assert.equal((await heldByOpenWithdrawals(w.db, "acct_f", null, { stripe: w.api })).usd, (1500 + 2500) + (4000 - 120),
      "Stripe unreadable: nothing is left out (never throws)");
  }
  // Reach: $1,343.03 in the account, all held by another open withdrawal:
  // Stripe reaches only owed money; never below zero per currency.
  {
    const connect = (await import("node:fs")).readFileSync(new URL("../api/stripe-connect.js", import.meta.url), "utf8");
    // Since fix round 30 both reckon it in stripeMoneyUsd (api/_stripe-withdrawals.js), held part left out.
    const lib = (await import("node:fs")).readFileSync(new URL("../api/_stripe-withdrawals.js", import.meta.url), "utf8");
    assert.ok(lib.includes("const free = Math.max(0, Number(entry?.amount ?? 0) - (held?.[currency] ?? 0));"), "stripeMoneyUsd leaves out what other withdrawals hold");
    assert.equal(connect.split("stripeMoneyUsd(stripe, existing.stripe_account_id, balance.available, heldElsewhere, account.default_currency)").length - 1, 2,
      "the balance answer and the members' figures both leave out what other withdrawals hold");
    assert.equal(connect.split("heldByOpenWithdrawals(db, existing.stripe_account_id, null, { stripe, byId })").length - 1, 2,
      "both ask with Stripe at hand, so money still clearing is not counted as held (4a445bb2)");
    // The same rule, on the tester's numbers.
    const free = (entry, held) => Math.max(0, Number(entry.amount) - (held[entry.currency.toLowerCase()] ?? 0));
    const available = [{ amount: 134303, currency: "usd" }, { amount: 500, currency: "eur" }];
    const held = { usd: 134303, eur: 800 };
    const owedStripe = 2500;
    const stripeCents = owedStripe + available.reduce((sum, entry) => sum + (entry.currency === "usd" ? free(entry, held) : 0), 0);
    assert.equal(stripeCents, 2500, "all $1,343.03 held elsewhere: Stripe reaches only the owed money");
    assert.equal(free(available[1], held), 0, "never below zero per currency");
  }

  // Fix round 31b: a EUR account no transfer has reached yet holds EUR 50.00
  // of its own. No rate prices it, so the withdrawal leaves it in the account
  // and takes the owed $100 (old: refused everything, CANNOT_PROCESS); and
  // what Withdraw offers (stripeMoneyUsd + owed) is exactly what it takes.
  {
    const w = oneBalanceWorld({ currency: "eur", rate: 0.9, steps: [step("p1", 10000)] });
    w.stripe.balance.eur = 5000;
    const { stripeMoneyUsd } = await import("../api/_stripe-withdrawals.js");
    const offered = (await stripeMoneyUsd(w.api, "acct_f", [{ amount: 5000, currency: "eur" }], {}, "eur")).cents + 10000;
    assert.equal(offered, 10000, "the dialog offers the owed $100.00 only");
    const payout = await withdraw(w, offered, { payoutCurrency: "eur", country: "DE" });
    assert.ok(payout?.id, "the full amount offered goes through");
    assert.equal(w.stripe.transfers.length, 1, "the owed step is transferred");
    assert.equal(w.stripe.balance.eur, 5000, "the euros no rate priced stay in the account");
    const more = oneBalanceWorld({ currency: "eur", rate: 0.9, steps: [step("p1", 10000)] });
    more.stripe.balance.eur = 5000;
    await assert.rejects(withdraw(more, offered + 1, { payoutCurrency: "eur", country: "DE" }), /You can withdraw up to \$100\.00\./,
      "a cent more is refused with the same limit");
    assert.equal(more.stripe.payouts.length, 0, "and nothing is paid out");
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
  // reach owed steps, never D1.
  {
    const connect = (await import("node:fs")).readFileSync(new URL("../api/stripe-connect.js", import.meta.url), "utf8");
    // Net of what the company owes TSC (owed_reachable can be below zero), never below zero (20261121200000).
    assert.match(connect, /stripe_cents:\s*Math\.max\(0, Number\(owedReach\.data\?\.stripe_cents \?\? 0\)\s*\+\s*inStripeUsd\)/, "Stripe: owed with a charge + D1");
    assert.match(connect, /pool_cents:\s*Math\.max\(0, Number\(owedReach\.data\?\.any_cents \?\? 0\)\)/,
      "PayPal / Wise: owed steps only (the old pool is takes since 20261121350000), never D1");
    assert.ok(!connect.includes("factory_withdrawable"), "R32: no old-pool read");
    assert.ok(!/pool_cents:[^\n]*inStripe/.test(connect), "D1 never reaches the pool road");
  }
}

// Round 16.
{
  const { readFileSync } = await import("node:fs");
  const form = readFileSync(new URL("../src/app/order/WithdrawFromBalance.jsx", import.meta.url), "utf8");
  const card = readFileSync(new URL("../src/app/order/StripePayoutCard.jsx", import.meta.url), "utf8");
  // F2: a saved method whose provider is switched off is listed, disabled,
  // with the sentence; never silently dropped. The card lets the dialog say so.
  assert.ok(form.includes("const switchedOff = methods.filter((row) => usable(row) && !methodProviderOn(providers, row));")
    && form.includes("{switchedOff.map((row) => <option key={row.id} value={row.id} disabled>{label(row)}</option>)}")
    && form.includes("{label(row)}: {METHOD_OFF_CHOOSE}") && form.includes("{label(row)}: {METHOD_OFF}"), "a switched-off method is shown, disabled, and said");
  assert.ok(card.includes("const balanceCan = (balanceChoices.length > 0 || balanceOff.length > 0) && reach.balance > 0;")
    && card.includes("balanceOff.map((row) => <option key={row.id} value={`balance:${row.id}`} disabled>"), "the card opens the dialog that says it, and lists it in the Stripe dialog too");
  // Double cancel: the losing tab says it was already cancelled, and re-reads.
  assert.ok(form.includes('if (error?.hint === "withdrawal_not_waiting")') && form.includes('data.every((w) => w.status === "cancelled")) return ALREADY_CANCELLED;')
    && form.includes("throw new Error(await cancelRefusal(error, ids));") && form.includes("throw new Error(await cancelRefusal(error, [id]));"),
    "a withdrawal another tab cancelled is said as cancelled, not as being sent");
  assert.ok(form.includes("onChanged?.();") && card.includes("onChanged={() => { fromBalance.load(); readReach(); }}"), "and the balance is read again");
  // Race: one message, and Withdraw stays off until the person changes something.
  assert.ok(form.includes("disabled={busy || Boolean(error) ||") && form.includes("{!error && choices.length > 0 && amountTouched"), "one line after a refusal, button off");
  assert.ok(form.includes("onRefused?.();") && card.includes("onRefused={() => { fromBalance.load(); readReach(); onMethodsChanged?.(); }}"), "a refusal re-reads the balance and the methods");
  // Stripe: a double click asks once; the minimum is said before asking.
  assert.ok(card.includes("if (withdrawing.current || busy") && card.includes("withdrawing.current = false;"), "one Stripe withdrawal per click burst");
  assert.ok(card.includes("disabled={busy || Boolean(error) || !(withdrawal.amount > 0) || (withdrawal.max != null && withdrawal.amount > withdrawal.max) || Boolean(stripeMinimumProblem)}") && card.includes("minimumWithdrawalSentence(leastLocal, local)"),
    "Stripe's minimum is checked in the dialog, in the server's sentence; after a refusal, or over what is left, Withdraw is off (round 27)");
  assert.equal(card.split("setError(null);").length - 1 >= 3 && card.includes("else { setError(null); setWithdrawal((was) => ({ ...was, destination: value })); }"), true,
    "changing the amount or the method turns it back on, as PayPal's dialog does");
  const { stripeMinimumWithdrawal, minimumWithdrawalSentence } = await import("../src/shared/withdrawal-fees.mjs");
  const leastEur = stripeMinimumWithdrawal({ currency: "EUR", country: "PT", localPerUsd: 1 / 1.08 });
  assert.ok(leastEur > 100 && leastEur < 200, "a euro account's minimum is a little over €1");
  assert.equal(minimumWithdrawalSentence(leastEur, "EUR"), `The minimum withdrawal is €${(leastEur / 100).toFixed(2)}.`);
  assert.ok(50 < Math.ceil(leastEur * 1.08), "so $0.50 is refused before asking");
}

console.log("withdrawals: short balance sends nothing; fee inside the amount; one key per attempt; a refusal is never replayed; the one balance withdraws exactly the amount asked, by one road");
