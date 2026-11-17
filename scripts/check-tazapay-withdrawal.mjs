/**
 * A factory's withdrawal paid by Tazapay, against a pretend Tazapay and
 * database: no stack, no keys. The run against the real sandbox is
 * scripts/tazapay-withdrawal-sandbox.mjs.
 *
 * The evasions, written before the code: the adapter missing from the core or
 * breaking its contract; the factory's fee taken from Tazapay's quote instead of
 * the fixed placeholder; a quote that creates a payee or a payout for the
 * factory's own preview; an amount above Tazapay's maximum split or sent as a
 * generic refusal; a payment too small sent anyway; one payout per step instead
 * of one per withdrawal; an invoice that doesn't add up to the withdrawal, or
 * lists steps another withdrawal paid; a payout made before TSC kept the
 * invoice; a press after Tazapay forgot the key; a bank-detail failure not told
 * to the factory, or a cut-off blamed on it; Tazapay's own sentence shown to
 * the factory; a webhook body (with the full account number) stored or logged;
 * proof_of_payment_generated ignored or treated as a status.
 */
import assert from "node:assert/strict";
import { ADAPTERS, tazapayAdapter } from "../api/_withdrawal-adapters.js";
import { approveWithdrawal, factoryQuote, readBackWithdrawalRef } from "../api/_withdrawals.js";
import { tazapayFrom, tazapayFailureRoute } from "../api/_tazapay.js";
import { webhookRoute, tazapayRef } from "../api/_payout-webhooks.js";
import { withdrawalInvoiceLines, withdrawalInvoicePdf, withdrawalSteps } from "../api/_tazapay-invoice.js";
import { TAZAPAY_KEY_MEMORY_MS } from "../api/_tazapay-pay.js";
import { PayoutFailure } from "../api/_payout-provider.js";
import { usccCheckChar } from "../src/shared/registration-number.mjs";

const SANDBOX = { TAZAPAY_BASE_URL: "https://service-sandbox.tazapay.com", TAZAPAY_API_KEY: "k", TAZAPAY_API_SECRET: "s" };
const json = (status, body) => ({ status, ok: status < 300, text: async () => JSON.stringify(body) });
const USCC = "91440300MA5G8X2Q7" + usccCheckChar("91440300MA5G8X2Q7");
const ACCOUNT_NUMBER = "6217850000012345678";

// --- The contract --------------------------------------------------------------
assert.equal(ADAPTERS.tazapay, tazapayAdapter, "registered in the core");
assert.equal(tazapayAdapter.provider, "tazapay");
assert.equal(tazapayAdapter.label, "Tazapay");
assert.match(tazapayAdapter.settings, /TAZAPAY_BASE_URL.*TAZAPAY_API_KEY.*TAZAPAY_API_SECRET/);
for (const fn of ["build", "balance", "quote", "factoryQuote", "pay", "status"]) assert.equal(typeof tazapayAdapter[fn], "function", fn);
assert.equal(tazapayAdapter.build({}), null, "not set up: null");
assert.throws(() => tazapayAdapter.build({ ...SANDBOX, TAZAPAY_BASE_URL: "https://service.tazapay.com" }), { kind: "live_elsewhere" });

// --- Failure routing, the same for steps and withdrawals --------------------------
for (const code of ["PF020000", "PF020106", "PF020201", "PF020500", "PF020600", "PF030100", "PF030300"]) assert.equal(tazapayFailureRoute(code), "details", code);
for (const code of ["PF000200", "PF010100", "PF010200", "PF010300", "PF030200", "PF030400", "PF030500"]) assert.equal(tazapayFailureRoute(code), "retry", code);
for (const code of ["PF000000", "PF030101", "PF030102", "PF040102", "PF060400", "PF070100", null, "XX"]) assert.equal(tazapayFailureRoute(code), "staff", String(code));

// --- Out of range: 20003 and 20298, small or large --------------------------------
{
  // CN: holding under US$5.44 is 20003; a payout over CNY 600,000 is 20298.
  const tz = tazapayFrom(SANDBOX, async (url, init) => {
    const body = JSON.parse(init.body);
    const holding = body.holding_info.amount;
    const payout = body.payout_info.amount ?? (holding - 544) * 7;
    if (holding != null && holding < 544) return json(400, { status: "error", errors: [{ code: 20003, message: "Please provide a valid amount", remarks: "holding_info.amount" }] });
    if (payout > 60_000_000) return json(400, { status: "error", errors: [{ code: 20298, message: "does not meet the required minimum or maximum limits" }] });
    return json(200, { status: "success", data: { exchange_rates: { holding_to_payout: 7 }, payout_info: { amount: payout }, holding_info: { amount: holding ?? Math.ceil(payout / 7) + 544 }, fee_info: { fixed: { in_holding_currency: 544 } } } });
  });
  const route = { type: "local", network: "cnaps", currency: "CNY", country: "CN" };
  const small = await tz.quote({ holdingCurrency: "USD", amountMinor: 400, route });
  assert.equal(small.tooSmall, true, "20003: too small, with the fee named");
  assert.equal(small.feeMinor, 544);
  const large = await tz.quote({ holdingCurrency: "USD", amountMinor: 10_000_000, route });
  assert.equal(large.tooLarge, true, "20298 at the amount and above it: over the maximum");
  const fits = await tz.quote({ holdingCurrency: "USD", amountMinor: 10_000, route });
  assert.ok(fits.totalMinor <= 10_000 && fits.payoutMinor > 0);
}

// --- A pretend world ---------------------------------------------------------------
const ACCOUNT = {
  id: "acct-1", org_id: "org-f", method: "bank", bank_country: "CN", account_name: "Shenzhen Hengda Garment Co Ltd",
  holder_name_local: "深圳市恒达服装制造有限公司", registration_number: USCC, bank_name: "Bank of China", bank_code: "104100000004", swift: "BKCHCNBJ",
  address_line1: "88 Bantian Road", address_city: "Shenzhen", address_state: "Guangdong", address_postal_code: null,
  number_changed_at: "2026-11-01T00:00:00Z", tazapay_beneficiary_id: null,
};
const POOL = [
  { id: "p-a", amount_cents: 30000, release_requested_at: "2026-11-01T00:00:00Z", milestone_id: "m-a", production_orders: { order_number: "PO-1001", factory_org_id: "org-f" } },
  { id: "p-b", amount_cents: 50000, release_requested_at: "2026-11-02T00:00:00Z", milestone_id: "m-b", production_orders: { order_number: "PO-1002", factory_org_id: "org-f" } },
  { id: "p-c", amount_cents: 40000, release_requested_at: "2026-11-03T00:00:00Z", milestone_id: "m-c", production_orders: { order_number: "PO-1002", factory_org_id: "org-f" } },
];

function world({ amount = 60000, account = ACCOUNT, withdrawals = null, resumed = false, keptAt = null, balance = 10_000_000, fee = 544, create = null } = {}) {
  const w = { calls: [], recorded: [], kept: [], logged: [] };
  let claim = { withdrawal_id: "wd-0000-1111", key: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", resumed, provider: "tazapay", provider_ref: null, amount_cents: amount, currency: "USD", org_id: "org-f", account_id: "acct-1" };
  const rows = withdrawals ?? [{ id: "wd-old", amount_cents: 20000, status: "paid", created_at: "2026-11-10T00:00:00Z" }, { id: "wd-0000-1111", amount_cents: amount, status: "paying", created_at: "2026-11-16T00:00:00Z" }];
  const data = {
    factory_payout_accounts: account, company_registrations: { number: USCC, country_code: "CN" }, factory_profiles: { country_code: "CN" },
    order_payments: POOL, factory_withdrawals: rows, order_milestones: [{ id: "m-a", title: "Deposit" }, { id: "m-b", title: "Balance" }, { id: "m-c", title: "Shipped" }],
  };
  w.db = {
    from: (table) => {
      w.calls.push(["db", table]);
      const q = { select: () => q, eq: () => q, in: () => q, order: () => q, not: () => q, limit: () => q,
        maybeSingle: async () => ({ data: Array.isArray(data[table]) ? data[table][0] ?? null : data[table] ?? null, error: null }),
        then: (ok) => ok({ data: data[table] ?? [], error: null }) };
      return q;
    },
    rpc: async (name, args) => {
      if (name === "record_withdrawal") { w.recorded.push(args); if (args.ref) claim = { ...claim, provider_ref: args.ref }; return { data: {}, error: null }; }
      if (name === "set_tazapay_beneficiary") return { data: true, error: null };
      throw new Error(`unexpected rpc ${name}`);
    },
    storage: { from: (bucket) => ({
      upload: async (path, bytes) => { w.kept.push({ bucket, path, bytes }); w.calls.push(["kept", path]); return { error: null }; },
      list: async () => ({ data: keptAt ? [{ name: `${claim.key}.pdf`, created_at: keptAt }] : [], error: null }),
    }) },
  };
  w.caller = { rpc: async (name) => {
    w.calls.push(["caller", name]);
    if (name === "claim_withdrawal") return { data: claim, error: null };
    if (name === "payout_tazapay_beneficiary") return { data: [{ ...account, account_number: ACCOUNT_NUMBER, changed_at: "2026-11-01T00:00:00Z" }], error: null };
    throw new Error(`unexpected caller rpc ${name}`);
  } };
  w.tazapay = {
    appUrl: "https://dashboard-sandbox.tazapay.com",
    available: async () => balance,
    createBeneficiary: async () => { w.calls.push(["tz", "beneficiary"]); return { id: "bnf_new1" }; },
    quote: async ({ amountMinor, route }) => {
      w.calls.push(["tz", "quote", amountMinor]);
      if (amountMinor > 9_000_000) return { tooLarge: true, payoutMinor: 0, totalMinor: amountMinor, feeMinor: null };
      if (amountMinor <= fee) return { tooSmall: true, payoutMinor: 0, totalMinor: amountMinor, feeMinor: fee, payoutCurrency: route.currency };
      return { rate: 7, payoutMinor: (amountMinor - fee) * 7, payoutCurrency: route.currency, totalMinor: amountMinor, feeMinor: fee };
    },
    uploadDocument: async ({ fileName }) => { w.calls.push(["tz", "upload", fileName]); return "https://s3.example/doc.pdf"; },
    createPayout: async (body, key) => { w.calls.push(["tz", "payout", key, body]); return create ? create(body, key) : { id: "pot_wd0001", status: "processing" }; },
    status: async () => ({ state: "sent", raw: "processing", waiting: null }),
  };
  w.made = () => w.calls.filter((c) => c[0] === "tz" && c[1] === "payout");
  return w;
}
const approve = (w) => approveWithdrawal({ adapter: tazapayAdapter, client: w.tazapay, caller: w.caller, db: w.db, id: "wd-0000-1111" });

// --- Which steps a withdrawal pays -----------------------------------------------
{
  const pool = [{ orderNumber: "A", amountMinor: 300 }, { orderNumber: "B", amountMinor: 500 }, { orderNumber: "C", amountMinor: 400 }];
  assert.deepEqual(withdrawalSteps(pool, 200, 600).map((s) => [s.orderNumber, s.amountMinor]), [["A", 100], ["B", 500]], "starts where the earlier withdrawals end");
  assert.deepEqual(withdrawalSteps(pool, 800, 400).map((s) => [s.orderNumber, s.amountMinor]), [["C", 400]]);
  assert.equal(withdrawalSteps(pool, 1000, 300), null, "steps that don't cover it: no invoice");
}

// --- Paid: one payout, one invoice, the fixed fee ------------------------------------
{
  const w = world();
  const out = await approve(w);
  assert.equal(out.done, "sent");
  const made = w.made();
  assert.equal(made.length, 1, "one payout for the whole withdrawal");
  const [, , key, body] = made[0];
  assert.equal(key, "tsc-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", "keyed by the withdrawal's attempt");
  assert.equal(body.reference_id, "tsc-w-wd-0000-1111", "the reference is the withdrawal's id");
  assert.equal(body.purpose, "PYR031");
  assert.equal(body.local.fund_transfer_network, "cnaps");
  assert.equal(body.amount, (60000 - 500) * 7, "the factory receives the amount less the fixed US$5.00, at Tazapay's rate");
  assert.equal(body.transaction_description, "Advance payment for goods, production orders PO-1001, PO-1002");
  assert.ok(body.statement_descriptor.length <= 22);
  assert.deepEqual(body.documents, [{ type: "invoice", url: "https://s3.example/doc.pdf" }]);
  assert.equal(w.recorded[0].fee, 500, "the fee recorded before money moves is the fixed US$5.00, not Tazapay's US$5.44");
  assert.equal(w.recorded[0].receives_in, "CNY");
  const keptAt = w.calls.findIndex((c) => c[0] === "kept");
  assert(keptAt >= 0 && keptAt < w.calls.findIndex((c) => c[1] === "upload"), "TSC keeps the invoice before Tazapay sees it");
  assert.equal(w.kept[0].bucket, "org-private");
  assert.match(w.kept[0].path, /^0{8}-0{4}-0{4}-0{4}-0{12}\/tazapay-invoices\/withdrawals\/wd-0000-1111\/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee\.pdf$/);
  const pdf = w.kept[0].bytes.toString("latin1");
  // The paid withdrawal before it took $200 of PO-1001's $300 step.
  assert.match(pdf, /PO-1001 \/ Deposit \/ USD 100\.00/);
  assert.match(pdf, /PO-1002 \/ Balance \/ USD 500\.00/);
  assert(!/Shipped/.test(pdf), "a step this withdrawal doesn't reach isn't on it");
  assert.match(pdf, /Total: USD 600\.00/, "the lines add up to the withdrawal");
  assert(!pdf.includes(ACCOUNT_NUMBER), "no bank number on the invoice");
}
{
  // Tazapay's fee above the placeholder (the sandbox's US$5.44): TSC carries the 44 cents, so it isn't refused as fee_on_top.
  const w = world();
  const quote = await tazapayAdapter.quote(w.tazapay, { amountCents: 10000, currency: "USD", account: { id: "acct-1" }, caller: w.caller, db: w.db });
  assert.equal(quote.feeCents, 500);
  assert.equal(quote.leavesCents, 10044);
  assert.equal(quote.receivesMinor, 9500 * 7);
}
{
  // A Tazapay fee under the placeholder (Hong Kong, US$3.23): TSC leaves less than the amount; the factory still pays US$5.00.
  const w = world({ fee: 323 });
  const quote = await tazapayAdapter.quote(w.tazapay, { amountCents: 10000, currency: "USD", account: { id: "acct-1" }, caller: w.caller, db: w.db });
  assert.equal(quote.feeCents, 500);
  assert.equal(quote.leavesCents, 9500 + 323);
}

// --- The factory's own preview creates nothing --------------------------------------
{
  const w = world();
  const seen = await factoryQuote({ adapter: tazapayAdapter, client: w.tazapay, db: w.db, orgId: "org-f", account: { id: "acct-1" }, amountCents: 10000 });
  assert.equal(seen.exact, true);
  assert.equal(seen.feeCents, 500);
  assert.equal(seen.receivesCurrency, "CNY");
  assert(!w.calls.some((c) => c[0] === "tz" && ["beneficiary", "payout", "upload"].includes(c[1])), "no payee, no payout, no upload");
  assert(!w.calls.some((c) => c[0] === "caller"), "the number is never read for a preview");
  const incomplete = world({ account: { ...ACCOUNT, holder_name_local: null } });
  assert.equal(await tazapayAdapter.factoryQuote(incomplete.tazapay, { amountCents: 10000, currency: "USD", account: { id: "acct-1" }, db: incomplete.db }), null, "an account Tazapay can't pay yet: the fee line instead");
}

// --- Refusals: nothing sent, back to waiting, in words ---------------------------------
{
  const w = world({ account: { ...ACCOUNT, address_city: "" } });
  await assert.rejects(approve(w), (e) => e.kind === "details_missing" && /the city/.test(e.message));
  assert.equal(w.made().length, 0);
  assert.equal(w.recorded.at(-1).outcome, "requeue");
}
{
  const w = world({ amount: 500, withdrawals: [{ id: "wd-0000-1111", amount_cents: 500, status: "paying", created_at: "2026-11-16T00:00:00Z" }] });
  await assert.rejects(approve(w), (e) => e.kind === "too_small" && /too small: the fee to send it is US\$5\.00, so nothing would arrive/.test(e.message));
  assert.equal(w.calls.filter((c) => c[1] === "quote").length, 0, "refused before Tazapay is asked");
  assert.equal(w.recorded.at(-1).outcome, "requeue");
}
{
  const w = world({ amount: 9_500_000 });
  await assert.rejects(approve(w), (e) => e.kind === "too_large" && /above the most Tazapay can send in one payout\. Nothing was sent\./.test(e.message));
  assert.equal(w.made().length, 0, "not split, not sent");
  assert.equal(w.recorded.at(-1).outcome, "requeue");
}
{
  const w = world({ balance: 1000 });
  const out = await approve(w);
  assert.equal(out.done, "short_balance");
  assert.match(out.sentence, /Tazapay balance is short by \$590\.00/);
  assert.equal(w.made().length, 0);
}
{
  const w = world({ create: () => { throw new PayoutFailure("short_balance", "TSC's Tazapay balance is too low for this payout. Top up the balance in Tazapay, then pay again."); } });
  await assert.rejects(approve(w), /balance is too low/);
  assert.equal(w.recorded.at(-1).outcome, "requeue", "Tazapay's own short-balance refusal: nothing sent, back to waiting");
}

// --- A lost answer: same key; past Tazapay's memory, refused -------------------------
{
  let first = true;
  const create = () => { if (first) { first = false; throw new PayoutFailure("timeout", "Tazapay didn't answer in time.", { unsure: true }); } return { id: "pot_wd0001", status: "processing" }; };
  const w = world({ create });
  await assert.rejects(approve(w), (e) => e.unsure === true);
  assert.equal(w.recorded.at(-1).outcome, "sent", "unsure: stays paying");
  const again = world({ create, resumed: true, keptAt: new Date().toISOString() });
  await approve(again);
  assert.equal(again.made()[0][2], w.made()[0][2], "pressed again: the same key, so Tazapay answers with the first payout");
  const late = world({ resumed: true, keptAt: new Date(Date.now() - TAZAPAY_KEY_MEMORY_MS - 60000).toISOString() });
  await assert.rejects(approve(late), (e) => e.kind === "key_expired" && e.unsure === true);
  assert.equal(late.made().length, 0, "past Tazapay's memory of the key, nothing is sent again");
}

// --- Status: TSC's sentence, by who must act ------------------------------------------
{
  const payouts = {
    pot_ok: { id: "pot_ok", status: "succeeded", amount: 413000, currency: "CNY" },
    pot_bank: { id: "pot_bank", status: "failed", failure: { code: "PF020106", description: "Bank account number is missing/invalid" }, balance_transaction: "b1", reversal_balance_transaction: "b2" },
    pot_cut: { id: "pot_cut", status: "failed", failure: { code: "PF030500", description: "cut off" }, balance_transaction: "b1", reversal_balance_transaction: "b2" },
    pot_aml: { id: "pot_aml", status: "failed", failure: { code: "PF040102", description: "Beneficiary failed compliance check" }, balance_transaction: "b1", reversal_balance_transaction: "b2" },
    pot_rev: { id: "pot_rev", status: "reversed", balance_transaction: "b1", reversal_balance_transaction: "b2" },
    pot_can: { id: "pot_can", status: "cancelled" },
    pot_hold: { id: "pot_hold", status: "compliance_hold" },
  };
  const tz = tazapayFrom(SANDBOX, async (url) => {
    const path = new URL(url).pathname;
    const pot = path.match(/^\/v3\/payout\/(pot_\w+)$/)?.[1];
    if (pot) return json(200, { status: "success", data: payouts[pot] });
    if (/balance_transaction\/b1/.test(path)) return json(200, { data: { net: { amount: -10044, currency: "USD" } } });
    return json(200, { data: { net: { amount: 10044, currency: "USD" } } });
  });
  const ok = await tazapayAdapter.status(tz, "pot_ok");
  assert.deepEqual([ok.state, ok.arrivesMinor], ["paid", 413000]);
  const bank = await tazapayAdapter.status(tz, "pot_bank");
  assert.equal(bank.state, "failed");
  assert.match(bank.failure, /Check your bank details/, "the factory is told to check its details");
  const cut = await tazapayAdapter.status(tz, "pot_cut");
  assert.match(cut.failure, /nothing reached your bank\. You can withdraw again\./);
  assert(!/bank details/.test(cut.failure), "a cut-off is not the factory's details");
  const aml = await tazapayAdapter.status(tz, "pot_aml");
  assert.match(aml.failure, /Contact TSC support/);
  assert.equal((await tazapayAdapter.status(tz, "pot_rev")).state, "failed");
  assert.equal((await tazapayAdapter.status(tz, "pot_can")).state, "cancelled");
  const hold = await tazapayAdapter.status(tz, "pot_hold");
  assert.equal(hold.state, "sent");
  assert.match(hold.waiting, /compliance hold/, "staff read why it waits");
  for (const s of [bank, cut, aml]) {
    assert(!/PF0|missing\/invalid|compliance check|cut off/i.test(s.failure), "never Tazapay's own words or codes to the factory");
  }
}

// --- The webhook reads a withdrawal back, and never keeps or logs the body -----------
{
  assert.equal(tazapayRef({ type: "payout.proof_of_payment_generated", data: { id: "pot_wd0001", object: "payout" } }), "pot_wd0001",
    "proof of payment is a prompt to read the payout back, nothing more");
  const seen = [];
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(JSON.stringify(args));
  const row = { id: "wd-1", status: "paying", provider_ref: "pot_wd0001" };
  const db = {
    from: (table) => {
      const q = { select: () => q, eq: () => q,
        maybeSingle: async () => ({ data: table === "factory_withdrawals" ? row : null, error: null }),
        update: (patch) => { seen.push(["update", table, patch]); return { eq: async () => ({}) }; },
        delete: () => ({ eq: async () => ({}) }) };
      return q;
    },
    rpc: async (name, args) => { seen.push(["rpc", name, args]); return name === "claim_provider_event" ? { data: true } : { data: {}, error: null }; },
  };
  const client = { provider: "tazapay", status: async () => ({ state: "paid", raw: "succeeded", arrivesCents: 413000 }) };
  const handler = webhookRoute({ provider: "tazapay", build: () => client, verify: async () => true, identify: ({ event }) => ({ id: event.id, type: event.type, ref: tazapayRef(event) }) });
  const body = JSON.stringify({
    id: "evt_pop1", type: "payout.proof_of_payment_generated", created_at: "2026-11-17T00:00:00Z",
    data: { id: "pot_wd0001", object: "payout", beneficiary_details: { destination_details: { bank: { account_number: ACCOUNT_NUMBER } } } },
  });
  const out = {};
  const response = { status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; } };
  await handler({ method: "POST", headers: {}, rawBody: Buffer.from(body) }, response, { db, client });
  console.error = original;
  assert.equal(out.status, 200);
  assert.equal(out.body.state, "paid", "a withdrawal's payout is read back from the webhook");
  assert(seen.some(([, name, args]) => name === "record_withdrawal" && args.outcome === "paid"));
  assert(!JSON.stringify(seen).includes(ACCOUNT_NUMBER), "the account number in the body is never written");
  assert(!errors.join("").includes(ACCOUNT_NUMBER), "nor logged");
  assert.deepEqual(Object.keys(seen.find(([, n]) => n === "claim_provider_event")[2]).sort(), ["event_id", "event_type"], "only the event's id and type are kept");
}
{
  // Not a withdrawal of this database's: null, nothing recorded.
  const db = { from: () => { const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: null, error: null }) }; return q; }, rpc: async () => assert.fail("nothing recorded") };
  assert.equal(await readBackWithdrawalRef({ provider: "tazapay", client: {}, db, ref: "pot_zz" }), null);
}

// --- The invoice -------------------------------------------------------------------
{
  const steps = Array.from({ length: 45 }, (_, i) => ({ orderNumber: `PO-${1000 + i}`, stepTitle: `Step ${i}`, amountMinor: 100 }));
  const details = { reference: "TSC-W-abcd1234", issuedOn: "2026-11-17", payeeName: "Kowloon Knitwear Ltd", steps, amountMinor: 4500, currency: "USD", payoutMinor: 30000, payoutCurrency: "HKD", rate: 7.8 };
  const pdf = withdrawalInvoicePdf(details).toString("latin1");
  assert.match(pdf, /\/Count 3 >>/, "45 steps run onto more pages, none dropped");
  const xref = Number(pdf.match(/startxref\n(\d+)\n/)[1]);
  const offsets = [...pdf.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  offsets.forEach((o, i) => assert.equal(pdf.slice(o, o + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`, `object ${i + 1} is where the table says`));
  assert.equal(withdrawalInvoiceLines(details).filter(([l]) => /^PO-/.test(l)).length, 45);
}

console.log("check:tazapay-withdrawal ok");
