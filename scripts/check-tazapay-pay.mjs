/**
 * Pay with Tazapay against a pretend Tazapay and database: no stack, no keys.
 * The real sandbox run is in the step-2 report; what the database refuses is in
 * supabase/tests/tazapay_payouts_test.sql.
 *
 * The evasions, written before the code: a live account on a laptop; the API
 * key in an error; a payout keyed by the payment, so a second attempt gets the
 * first, failed payout back; a second press that makes a second payout; a
 * timeout or a 500 that ends the attempt (the payout may exist) or a refusal that
 * keeps it (the next press would replay nothing and wait forever); a press after
 * Tazapay forgot the key; a payout made with details missing or another
 * company's USCC; a payout with no invoice, or an invoice TSC didn't keep; a
 * compliance failure blamed on the factory; a reversal recorded as paid; a
 * short balance that pays anyway; Chinese characters drawn as boxes.
 */
import assert from "node:assert/strict";
import { usccCheckChar } from "../src/shared/registration-number.mjs";
import { TAZAPAY_STATES, tazapayFrom } from "../api/_tazapay.js";
import { HK_NO_POSTCODE, PAYEE_EMAIL, beneficiaryBody } from "../api/_tazapay-beneficiary.js";
import { invoiceLines, invoicePath, invoicePdf, pdfText } from "../api/_tazapay-invoice.js";
import { tazapayPay, TAZAPAY_KEY_MEMORY_MS } from "../api/_provider-payouts.js";

const SANDBOX = { TAZAPAY_BASE_URL: "https://service-sandbox.tazapay.com", TAZAPAY_API_KEY: "key-123", TAZAPAY_API_SECRET: "secret-456" };
const json = (status, body) => ({ status, ok: status < 300, text: async () => JSON.stringify(body) });
const USCC = "91440300MA5G8X2Q7" + usccCheckChar("91440300MA5G8X2Q7");

// --- Only the sandbox off production ------------------------------------------
assert.equal(tazapayFrom({}), null, "no settings, no client");
assert.throws(() => tazapayFrom({ ...SANDBOX, TAZAPAY_BASE_URL: "https://service.tazapay.com" }), { kind: "live_elsewhere" }, "a live account is refused on a laptop or a preview");
assert.throws(() => tazapayFrom({ ...SANDBOX, TAZAPAY_BASE_URL: "https://service.tazapay.com", VERCEL_ENV: "preview" }), { kind: "live_elsewhere" });
assert.ok(tazapayFrom({ ...SANDBOX, TAZAPAY_BASE_URL: "https://service.tazapay.com", VERCEL_ENV: "production" }), "production may hold one");
assert.throws(() => tazapayFrom({ ...SANDBOX, TAZAPAY_BASE_URL: "https://service-sandbox.tazapay.com.evil.test" }), { kind: "live_elsewhere" }, "a host that only starts like the sandbox is not it");

// --- Every answer in words, and never the key ----------------------------------
async function failureFor(status, body) {
  const tz = tazapayFrom(SANDBOX, async () => json(status, body));
  try { await tz.getPayout("pot_x"); } catch (e) { return e; }
  assert.fail("no failure");
}
{
  const gateway = await failureFor(403, { message: "Forbidden" });
  assert.equal(gateway.kind, "not_found", "the gateway's 403 is a missing route, not a refused key");
  assert.equal((await failureFor(401, { status: "error", message: "Unauthorized" })).kind, "key_refused");
  const short = await failureFor(400, { status: "error", errors: [{ code: 20199, message: "insufficient balance", remarks: "" }] });
  assert.equal(short.kind, "short_balance");
  assert.equal(short.unsure, false, "a short balance is a certain no");
  const field = await failureFor(400, { status: "error", errors: [{ code: 20321, message: "Please provide all the valid bank local_fields", remarks: "account_holder_name_local" }] });
  assert.deepEqual(field.fields, ["account_holder_name_local"], "the field Tazapay named is kept");
  const down = await failureFor(500, { status: "error", message: "Internal Server Error" });
  assert.equal(down.unsure, true, "a 500 is unsure: it was seen when Tazapay couldn't fetch the invoice, but it can't be known here");
  for (const e of [gateway, short, field, down]) {
    assert(!/key-123|secret-456|Basic /.test(`${e.message} ${e.detail}`), "the key never reaches a sentence");
  }
  const timeout = tazapayFrom(SANDBOX, async () => { throw Object.assign(new Error("aborted"), { name: "AbortError" }); });
  await assert.rejects(timeout.getPayout("pot_x"), (e) => e.kind === "timeout" && e.unsure === true);
}

// --- What each status means ------------------------------------------------------
function fakeTazapay(payouts, transactions = {}) {
  return tazapayFrom(SANDBOX, async (url) => {
    const path = new URL(url).pathname;
    const payout = path.match(/^\/v3\/payout\/(pot_\w+)$/);
    if (payout) return json(200, { status: "success", data: payouts[payout[1]] });
    const btr = path.match(/^\/v3\/balance_transaction\/(btr_\w+)$/);
    if (btr) return json(200, { status: "success", data: transactions[btr[1]] });
    return json(404, { status: "error", message: "Not Found" });
  });
}
{
  const tz = fakeTazapay({
    pot_hold: { id: "pot_hold", status: "compliance_hold", amount: 300000, currency: "CNY" },
    pot_paid: { id: "pot_paid", status: "succeeded", amount: 12345, currency: "CNY" },
    pot_bank: { id: "pot_bank", status: "failed", failure: { code: "PF030100", description: "Beneficiary bank rejected incoming funds" }, status_description: "PO1003 rejected_by_bank", balance_transaction: "btr_d1", reversal_balance_transaction: "btr_c1" },
    pot_aml: { id: "pot_aml", status: "failed", failure: { code: "PF040000", description: "Payout is flagged for compliance" }, balance_transaction: "btr_d2", reversal_balance_transaction: "btr_c2" },
    pot_rev: { id: "pot_rev", status: "reversed", status_description: "PR1001", balance_transaction: "btr_d3", reversal_balance_transaction: "btr_c3" },
    pot_early: { id: "pot_early", status: "failed", failure: { code: "PF030100" }, balance_transaction: "btr_d1" },
  }, {
    btr_d1: { net: { amount: -31796, currency: "USD" } }, btr_c1: { net: { amount: 31796, currency: "USD" } },
    btr_d2: { net: { amount: -63049, currency: "USD" } }, btr_c2: { net: { amount: 63049, currency: "USD" } },
    btr_d3: { net: { amount: -86503, currency: "USD" } }, btr_c3: { net: { amount: 83399, currency: "USD" } },
  });
  const hold = await tz.status("pot_hold");
  assert.equal(hold.state, "sent", "a compliance hold is still under way");
  assert.match(hold.waiting, /compliance hold/, "and staff read why");
  assert.equal((await tz.status("pot_paid")).state, "paid");
  assert.equal((await tz.status("pot_paid")).arrivesCents, 12345, "what arrived, in CNY minor units");
  const bank = await tz.status("pot_bank");
  assert.equal(bank.state, "failed");
  assert.equal(bank.tellFactory, true, "a bank's refusal is the factory's to fix");
  assert.match(bank.failure, /\$317\.96 came back to TSC's Tazapay balance, fee included/, "staff read that nothing was lost");
  const aml = await tz.status("pot_aml");
  assert.equal(aml.tellFactory, false, "a compliance refusal is not the factory's to fix, and it isn't told");
  assert.match(aml.failure, /Ask Tazapay why/);
  const rev = await tz.status("pot_rev");
  assert.equal(rev.state, "failed", "a reversal after paying makes the payment owed again");
  assert.match(rev.failure, /\$833\.99 came back.*\$31\.04 was lost/, "staff read what came back and what was lost");
  const early = await tz.status("pot_early");
  assert.equal(early.state, "sent", "failed, but the money isn't back yet: it stays open, so the payment isn't owed twice and staff see where the money is");
  assert.match(early.waiting, /isn't back in TSC's Tazapay balance yet/);
  for (const [raw, state] of Object.entries({ succeeded: "paid", failed: "failed", reversed: "failed", cancelled: "cancelled", processing: "sent", compliance_hold: "sent" })) {
    assert.equal(TAZAPAY_STATES[raw], state, raw);
  }
}

// --- The invoice ----------------------------------------------------------------
{
  const details = {
    reference: "TSC-PO-1001-abcd1234", issuedOn: "2026-11-15", payeeName: "Shenzhen Hengda (Garment) Co., Ltd.",
    orderNumber: "PO-1001", stepTitle: "Deposit 定金", amountMinor: 123456, currency: "USD", payoutMinor: 790000, payoutCurrency: "CNY", rate: 6.3995,
  };
  const pdf = invoicePdf(details).toString("latin1");
  assert(pdf.startsWith("%PDF-1.4\n") && pdf.trimEnd().endsWith("%%EOF"), "a PDF");
  const xref = Number(pdf.match(/startxref\n(\d+)\n/)[1]);
  assert.equal(pdf.slice(xref, xref + 4), "xref", "startxref points at the table");
  const offsets = [...pdf.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  offsets.forEach((o, i) => assert.equal(pdf.slice(o, o + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`, `object ${i + 1} is where the table says`));
  assert.match(pdf, /\(Payee: Shenzhen Hengda \\\(Garment\\\) Co\., Ltd\.\)/, "brackets are escaped");
  assert.match(pdf, /USD 1,234\.56/);
  assert.match(pdf, /CNY 7,900\.00 \\\(rate 6\.3995\\\)/, "what arrives, at which rate");
  assert(!/[^\x00-\x7F]/.test(pdf), "nothing Helvetica can't draw");
  assert.equal(pdfText("定金 Deposit"), "Deposit", "Chinese is dropped, not boxed");
  assert(invoiceLines(details).every(([line]) => !/\d{12,}/.test(line)), "no bank number on it");
  assert.equal(invoicePath("pay-1", "key-1"), "00000000-0000-0000-0000-000000000000/tazapay-invoices/pay-1/key-1.pdf",
    "kept under the nil id: no company's folder, and still a uuid where every storage policy casts one");
}

// --- The payee ----------------------------------------------------------------
{
  const cn = beneficiaryBody({
    account_number: "0000000000b60001", account_name: "Shenzhen Hengda Garment Co., Ltd.", holder_name_local: "深圳市恒达服装制造有限公司",
    registration_number: USCC, bank_name: "Bank of China", bank_country: "CN", bank_code: "104100000004", swift: "bkch cnbj",
    address_line1: "88 Bantian Road", address_city: "Shenzhen", address_state: "Guangdong", address_postal_code: null,
  });
  assert.equal(cn.email, PAYEE_EMAIL, "Tazapay writes to TSC, never the factory");
  assert.equal(cn.type, "business");
  assert.equal(cn.name_local, "深圳市恒达服装制造有限公司");
  assert.equal(cn.destination_details.bank.account_holder_name_local, "深圳市恒达服装制造有限公司", "the Chinese name Tazapay's CNY route requires");
  assert.equal(cn.national_identification_number, USCC);
  assert.deepEqual(cn.destination_details.bank.bank_codes, { swift_code: "BKCHCNBJ", cnaps: "104100000004" });
  assert.equal(cn.destination_details.bank.currency, "CNY");
  assert.equal(cn.address.postal_code, undefined, "no postcode made up for China");
  const hk = beneficiaryBody({
    account_number: "0000000000b60002", account_name: "Kowloon Knitwear Ltd", bank_name: "HSBC", bank_country: "HK", bank_code: "004", swift: "HSBCHKHH",
    address_line1: "45 Hung To Road", address_city: "Kwun Tong", address_state: "Kowloon",
  });
  assert.equal(hk.address.postal_code, HK_NO_POSTCODE, "Hong Kong has no postcodes; Tazapay's route took this one");
  assert.deepEqual(hk.destination_details.bank.bank_codes, { swift_code: "HSBCHKHH", bank_code: "004" });
  assert.equal(hk.destination_details.bank.currency, "HKD");
  assert.equal(hk.name_local, undefined, "an optional Chinese name that isn't there is left out");
}

// --- Paying: the press, the payee, the invoice, the payout ------------------------
const ACCOUNT = {
  id: "acct-1", org_id: "org-f", method: "bank", bank_country: "CN", account_name: "Shenzhen Hengda Garment Co., Ltd.",
  holder_name_local: "深圳市恒达服装制造有限公司", registration_number: USCC, bank_name: "Bank of China", bank_code: null, swift: null,
  address_line1: "88 Bantian Road", address_city: "Shenzhen", address_state: "Guangdong", address_postal_code: null, number_changed_at: "2026-11-01T00:00:00Z",
};

function world({ claim = {}, account = ACCOUNT, registration = USCC, balance = 1_000_000, create = null } = {}) {
  const w = { calls: [], records: [], finishes: [], uploads: [], kept: [] };
  const theClaim = {
    payout_id: "payout-1", key: "11111111-2222-4333-8444-555555555555", resumed: false, provider_ref: null, amount_cents: 10000, currency: "USD",
    order_number: "PO-1001", account_id: "acct-1", tazapay_beneficiary_id: null, milestone_title: "Deposit", attempt_started_at: new Date().toISOString(), ...claim,
  };
  w.caller = {
    rpc: async (name, args) => {
      w.calls.push(["caller", name, args]);
      if (name === "claim_provider_payout") return { data: theClaim };
      if (name === "payout_tazapay_beneficiary") return { data: [{ ...account, account_number: "0000000000b60001", changed_at: "2026-11-01T00:00:00Z" }] };
      return { data: null };
    },
  };
  const table = (name) => {
    const q = { select: () => q, eq: () => q,
      maybeSingle: async () => {
        if (name === "factory_payout_accounts") return { data: account };
        if (name === "company_registrations") return { data: registration ? { number: registration, country_code: "CN" } : null };
        if (name === "provider_payouts") return { data: { provider_ref: w.records.find((r) => r.new_ref)?.new_ref ?? null } };
        return { data: null };
      } };
    return q;
  };
  w.db = {
    from: table,
    rpc: async (name, args) => {
      if (name === "record_provider_attempt") w.records.push(args);
      if (name === "finish_provider_payout") w.finishes.push(args);
      if (name === "record_payout_fee") w.calls.push(["db", "fee", args.fee]);
      if (name === "set_tazapay_beneficiary") return { data: true };
      return { data: null, error: null };
    },
    storage: { from: (bucket) => ({ upload: async (path, bytes, opts) => { w.kept.push({ bucket, path, type: opts.contentType, size: bytes.length }); return { error: null }; } }) },
  };
  const payouts = {};
  w.tazapay = {
    createBeneficiary: async (body, key) => { w.calls.push(["tz", "beneficiary", key]); assert(!("account_number" in body.destination_details.bank) || body.destination_details.bank.account_number); return { id: "bnf_made0001" }; },
    quote: async ({ amountMinor, route }) => { w.calls.push(["tz", "quote", route.network]); return { rate: 6.4, payoutMinor: Math.round((amountMinor - 544) * 6.4), payoutCurrency: route.currency, totalMinor: amountMinor, feeMinor: 544 }; },
    available: async () => balance,
    uploadDocument: async ({ fileName, bytes }) => { w.uploads.push({ fileName, size: bytes.length }); return "https://s3.example/tazapay-temp-doc-sandbox/x.pdf"; },
    createPayout: async (body, key) => {
      w.calls.push(["tz", "payout", key, body]);
      if (create) return create(body, key);
      payouts.pot_new = { id: "pot_new", status: "processing", amount: body.amount, currency: body.currency };
      return payouts.pot_new;
    },
    status: async (id) => { w.calls.push(["tz", "status", id]); return { state: "sent", raw: "processing", waiting: null, arrivesCents: 64000, arrivesCurrency: "CNY", tellFactory: false }; },
  };
  w.made = () => w.calls.filter((c) => c[0] === "tz" && c[1] === "payout");
  return w;
}
const pay = (w, extra = {}) => tazapayPay({ tazapay: w.tazapay, caller: w.caller, db: w.db, paymentId: "pay-0000-1111", changedAt: "2026-11-01T00:00:00Z", ...extra });

{
  const w = world();
  const out = await pay(w);
  assert.equal(out.done, "sent", "a new payout is under way");
  const [made] = w.made();
  assert.equal(made[2], "tsc-11111111-2222-4333-8444-555555555555", "keyed by the attempt, so a payment paid again after a failure is a new payout");
  assert.equal(made[3].reference_id, "tsc-pay-0000-1111", "the payment is in the reference, for tracing");
  assert.equal(made[3].purpose, "PYR031");
  assert.equal(made[3].local.fund_transfer_network, "cnaps");
  assert.equal(made[3].amount, Math.round((10000 - 544) * 6.4), "the factory pays the fee: the step less Tazapay's fee arrives, and TSC pays only the step");
  assert.equal(made[3].holding_currency, "USD");
  assert.deepEqual(made[3].documents, [{ type: "invoice", url: "https://s3.example/tazapay-temp-doc-sandbox/x.pdf" }], "the invoice goes with it");
  assert.deepEqual(w.kept.map((k) => [k.bucket, k.path, k.type]), [["org-private", "00000000-0000-0000-0000-000000000000/tazapay-invoices/pay-0000-1111/11111111-2222-4333-8444-555555555555.pdf", "application/pdf"]], "TSC keeps the invoice in the private bucket");
  assert(w.calls.findIndex((c) => c[1] === "payout") > w.calls.findIndex((c) => c[1] === "beneficiary"), "the payee is made before the payout");
  assert(w.records.some((r) => r.new_ref === "pot_new" && r.new_stage === "sent"), "the payout's id is kept the moment it exists");
  assert.equal(w.finishes.length, 0, "nothing finished yet");
  const feeAt = w.calls.findIndex((c) => c[0] === "db" && c[1] === "fee");
  assert(feeAt >= 0 && w.calls[feeAt][2] === 544, "Tazapay's quoted fee is recorded on the payment (record_payout_fee)");
  assert(feeAt < w.calls.findIndex((c) => c[1] === "payout"), "and recorded before any money moves");
}
{
  const w = world({ claim: { tazapay_beneficiary_id: "bnf_kept0001" } });
  await pay(w);
  assert(!w.calls.some((c) => c[1] === "beneficiary"), "a payee made before is used, not made again");
  assert.equal(w.made()[0][3].beneficiary, "bnf_kept0001");
}
{
  const w = world({ claim: { resumed: true, provider_ref: "pot_old" } });
  await pay(w);
  assert.equal(w.made().length, 0, "a second press on a payout that exists only reads it back");
  assert(w.calls.some((c) => c[1] === "status" && c[2] === "pot_old"));
}
{
  const w = world({ account: { ...ACCOUNT, holder_name_local: null } });
  await assert.rejects(pay(w), (e) => e.kind === "details_missing" && /Chinese name/.test(e.message));
  assert.equal(w.calls.filter((c) => c[0] === "tz").length, 0, "nothing reaches Tazapay with details missing");
  assert.equal(w.finishes[0]?.outcome, "cancelled", "and the attempt ends: nothing went");
}
{
  const other = "91330200MA2AB1234" + usccCheckChar("91330200MA2AB1234");
  const w = world({ registration: other });
  await assert.rejects(pay(w), (e) => e.kind === "details_missing" && /isn't the company's own/.test(e.message));
  assert.equal(w.made().length, 0, "an account in another company's name is not paid");
}
{
  // A step no bigger than Tazapay's fee: refused in words, nothing sent, the attempt ends.
  const w = world({ claim: { amount_cents: 544 } });
  await assert.rejects(pay(w), (e) => e.kind === "fee_too_large" && /the fee to send it is US\$5\.44, so nothing would arrive\. Nothing was sent\./.test(e.message));
  assert.equal(w.made().length, 0, "a payment the fee would swallow pays nothing");
  assert.equal(w.finishes[0]?.outcome, "cancelled");
}
{
  const w = world({ balance: 5000 });
  const out = await pay(w);
  assert.equal(out.done, "short_balance");
  assert.match(out.sentence, /short by \$50\.00, fee included/);
  assert.equal(w.made().length, 0, "a short balance pays nothing");
  assert.equal(w.finishes[0]?.outcome, "cancelled");
}
{
  // The 500 Tazapay gave for an invoice it couldn't fetch: unsure, the attempt stays, the next press uses the same key.
  let tries = 0;
  const create = (body, key) => {
    tries += 1;
    if (tries === 1) throw Object.assign(new Error("Tazapay is having trouble"), { kind: "provider_down", unsure: true });
    return { id: "pot_second", status: "processing", amount: body.amount, currency: body.currency };
  };
  const { PayoutFailure } = await import("../api/_payout-provider.js");
  const w = world({ create: (b, k) => { if (tries === 0) { tries += 1; throw new PayoutFailure("provider_down", "Tazapay is having trouble, so we don't know yet if this went.", { unsure: true }); } return create(b, k); } });
  await assert.rejects(pay(w), (e) => e.unsure === true);
  assert.equal(w.finishes.length, 0, "an unsure answer never ends the attempt: the payout may exist");
  assert(w.records.some((r) => /don't know yet/.test(r.sentence ?? "")), "staff read that it isn't known yet");
  const again = world({ claim: { resumed: true }, create });
  await pay(again);
  assert.equal(again.made()[0][2], w.made()[0][2], "pressing again sends the same key, so Tazapay can't pay twice");
}
{
  const w = world({ claim: { resumed: true, attempt_started_at: new Date(Date.now() - TAZAPAY_KEY_MEMORY_MS - 60000).toISOString() } });
  await assert.rejects(pay(w), (e) => e.kind === "key_expired" && e.unsure === true);
  assert.equal(w.calls.filter((c) => c[0] === "tz").length, 0, "past Tazapay's memory of the key, nothing is sent again");
}
{
  const { PayoutFailure } = await import("../api/_payout-provider.js");
  const w = world({ create: () => { throw new PayoutFailure("refused", "Tazapay refused this: documents[0].url."); } });
  await assert.rejects(pay(w), (e) => e.kind === "refused");
  assert.equal(w.finishes[0]?.outcome, "cancelled", "a certain refusal before a payout exists ends the attempt, so the next press gets a new key");
}
{
  const w = world({ claim: { currency: "EUR" } });
  await assert.rejects(pay(w), /USD balance/);
  assert.equal(w.made().length, 0);
}

console.log("check:tazapay-pay ok");
