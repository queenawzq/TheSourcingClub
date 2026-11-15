#!/usr/bin/env node
/**
 * Tazapay step 1: a sandbox-only proof that Tazapay can pay a factory in
 * mainland China (CNY over CNAPS) and in Hong Kong. Research by running code;
 * nothing in the app uses it.
 *
 *   node scripts/tazapay-sandbox.mjs                 every step in order
 *   node scripts/tazapay-sandbox.mjs --step=auth     one step: auth, corridors,
 *        beneficiaries, balance, payouts, poll, hk, unfunded
 *
 * Reads TAZAPAY_BASE_URL / TAZAPAY_API_KEY / TAZAPAY_API_SECRET from the
 * environment or .env.local. Refuses any host but the sandbox (api/_tazapay.js).
 * Prints ids, statuses, amounts, fees and rates; never a key, never a header.
 * Ids made by one run are kept in $TMPDIR/tsc-tazapay-sandbox.json so a later
 * --step can poll them.
 *
 * Sandbox outcomes are chosen by the payout amount (Tazapay's docs, "Simulating
 * Payouts on Test Environment"): exactly 100,000 stays processing; 200,000 to
 * 250,000 fails; 300,000 to 350,000 is held for compliance then succeeds;
 * 400,000 to 450,000 held then fails; 500,000 to 550,000 succeeds then is
 * reversed. The script found the amount is the `amount` field in minor units.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tazapayFrom } from "../api/_tazapay.js";

const ROOT = new URL("..", import.meta.url).pathname;
const STATE = join(tmpdir(), "tsc-tazapay-sandbox.json");

function loadEnv() {
  const file = join(ROOT, ".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*(TAZAPAY_[A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {};
const save = () => writeFileSync(STATE, JSON.stringify(state, null, 2));
const now = () => new Date().toISOString();
const log = (...a) => console.log(...a);
const run = Date.now();

/** A payout reduced to what the report needs. Bank numbers are masked. */
export function payoutSummary(p) {
  const fx = (t) => t && { rate: t.exchange_rate, from: t.initial, to: t.final };
  const bank = p?.beneficiary_details?.destination_details?.bank;
  return {
    id: p?.id,
    status: p?.status,
    status_description: p?.status_description || undefined,
    amount: p?.amount,
    currency: p?.currency,
    holding_currency: p?.holding_currency,
    type: p?.type,
    network: p?.local?.fund_transfer_network ?? p?.swift?.fund_transfer_network,
    charge_type: p?.charge_type || undefined,
    is_balance_sufficient: p?.is_balance_sufficient,
    available_balance: p?.available_balance,
    holding_fx: fx(p?.holding_fx_transaction),
    payout_fx: fx(p?.payout_fx_transaction),
    fees: p?.fee ?? p?.fees ?? p?.charges ?? undefined,
    failure: p?.failure ?? undefined,
    reversal: p?.reversal ?? p?.reversal_details ?? undefined,
    tracking: p?.tracking_details ?? undefined,
    beneficiary: p?.beneficiary,
    bank_account: bank?.account_number ? `****${String(bank.account_number).slice(-4)}` : undefined,
    created_at: p?.created_at,
  };
}

const show = (label, value) => log(`\n## ${label}\n${JSON.stringify(value, null, 2)}`);

async function attempt(label, fn) {
  try {
    return await fn();
  } catch (e) {
    show(`${label} FAILED (${e.kind ?? "error"})`, { message: e.message, errors: e.body?.errors });
    return null;
  }
}

// --- test data: fictional companies, real public bank routing codes --------
const CN_COMPANY = {
  name: "Shenzhen Hengda Garment Manufacturing Co., Ltd.",
  name_local: "深圳市恒达服装制造有限公司",
  type: "business",
  email: `tazapay-cn-${run}@example.com`,
  // A unified social credit code (USCC) is 18 characters; this one is made up.
  national_identification_number: "91440300MA5G8X2Q7K",
  registration_number: "91440300MA5G8X2Q7K",
  address: { line1: "88 Bantian Industrial Road", city: "Shenzhen", state: "Guangdong", country: "CN", postal_code: "518129" },
  phone: { calling_code: "86", number: "75512345678" },
  destination_details: {
    type: "bank",
    bank: {
      account_number: "6217850000001234567",
      account_holder_name: "Shenzhen Hengda Garment Manufacturing Co., Ltd.",
      account_holder_name_local: "深圳市恒达服装制造有限公司",
      bank_name: "Bank of China Shenzhen Branch",
      country: "CN",
      currency: "CNY",
      // Bank of China's head-office CNAPS code and SWIFT BIC (public).
      bank_codes: { cnaps: "104100000004", swift_code: "BKCHCNBJ" },
    },
  },
};

const HK_COMPANY = {
  name: "Kowloon Knitwear Trading Limited",
  name_local: "九龍針織貿易有限公司",
  type: "business",
  email: `tazapay-hk-${run}@example.com`,
  registration_number: "3123456",
  address: { line1: "Unit 12, 8/F, 45 Hung To Road", city: "Kwun Tong", state: "Kowloon", country: "HK", postal_code: "000000" },
  phone: { calling_code: "852", number: "21234567" },
  destination_details: {
    type: "bank",
    bank: {
      account_number: "012345678901",
      account_holder_name: "Kowloon Knitwear Trading Limited",
      bank_name: "The Hongkong and Shanghai Banking Corporation Limited",
      country: "HK",
      currency: "HKD",
      // HSBC Hong Kong: bank code 004, SWIFT HSBCHKHH (public).
      bank_codes: { swift_code: "HSBCHKHH", bank_code: "004", branch_code: "001" },
    },
  },
};

// A goods payout to China over CNAPS needs logistics tracking and items (PYR022);
// services and advance payments (PYR031) need an invoice document instead.
// Tazapay downloads each document when the payout is created: a URL it cannot
// fetch is a 500, and no document at all on PYR031 is 400 20283.
const CN_DOCS = [{ type: "invoice", url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf" }];
const CN_ITEMS = (amount) => [{ name: "Knitted sweaters, production deposit", quantity: 1, amount, category: "Goods", description: "Sandbox test order" }];

function cnPayout(amount, purpose = "PYR031") {
  const body = {
    beneficiary: state.cnBeneficiary,
    amount,
    currency: "CNY",
    holding_currency: "USD",
    type: "local",
    local: { fund_transfer_network: "cnaps" },
    purpose,
    transaction_description: "TSC sandbox: production step payment",
    reference_id: `tsc-sbx-${run}-${amount}`,
    statement_descriptor: "TSC order payment",
    documents: CN_DOCS,
  };
  if (purpose === "PYR022") {
    body.items = CN_ITEMS(amount);
    body.logistics_tracking_details = [{ tracking_number: "SF1234567890", logistics_provider: { name: "SF Express", code: "SF" } }];
  }
  return body;
}

// --- steps ---------------------------------------------------------------
const steps = {};

steps.auth = async (tz) => {
  const balance = await tz.balance();
  show("auth: GET /v3/balance answered", { base: tz.base, balance });
  state.balanceAtStart = balance;
};

steps.corridors = async (tz) => {
  for (const [country, currency] of [["CN", "CNY"], ["HK", "HKD"], ["HK", "USD"], ["CN", "USD"]]) {
    const meta = await attempt(`corridor ${country} ${currency}`, () => tz.bankMetadata({ country, currency }));
    const methods = (meta?.payout_methods ?? []).map((m) => ({
      payout_type: m.payout_type,
      networks: (m.fund_transfer_networks ?? []).map((n) => `${n.name} (${n.transfer_limit?.minimum}..${n.transfer_limit?.maximum} ${n.transfer_limit?.currency})`),
      required_bank_codes: m.required_bank_codes,
      required_bank_fields: m.required_bank_fields,
      required_beneficiary_fields: m.required_beneficiary_fields,
      recommended: m.recommended_fields,
      limit: m.transfer_limit,
    }));
    show(`corridor ${country} ${currency}`, methods);
    (state.corridors ??= {})[`${country}-${currency}`] = methods;
  }
  save();
};

steps.beneficiaries = async (tz) => {
  const cn = await attempt("CN beneficiary", () => tz.createBeneficiary(CN_COMPANY, `tsc-sbx-bnf-cn-${run}`));
  if (cn) {
    state.cnBeneficiary = cn.id;
    show("CN beneficiary created", { id: cn.id, status: cn.status, name: cn.name, name_local: cn.name_local, type: cn.type, destination: cn.destination, bank: { ...cn.destination_details?.bank, account_number: "****" + String(cn.destination_details?.bank?.account_number ?? "").slice(-4) } });
  }
  const hk = await attempt("HK beneficiary", () => tz.createBeneficiary(HK_COMPANY, `tsc-sbx-bnf-hk-${run}`));
  if (hk) {
    state.hkBeneficiary = hk.id;
    show("HK beneficiary created", { id: hk.id, status: hk.status, name: hk.name, destination: hk.destination, bank: { ...hk.destination_details?.bank, account_number: "****" + String(hk.destination_details?.bank?.account_number ?? "").slice(-4) } });
  }
  save();
};

steps.balance = async (tz) => {
  const balance = await tz.balance();
  show("balance", balance);
  const usd = balance?.available?.find((b) => b.currency === "USD")?.amount ?? 0;
  if (usd < 1_000_000) {
    log(`\nUSD balance is ${usd} (minor units). Tazapay has no top-up API in sandbox (POST /v3/sandbox/balance/topup answers 404);`);
    log("fund it on the dashboard: https://dashboard-sandbox.tazapay.com -> Virtual Accounts -> an Active USD account -> Simulate Collect -> status Succeeded, amount 50000 (USD) -> Confirm.");
    return false;
  }
  return true;
};

// Amounts in CNY minor units, inside each documented band.
const OUTCOMES = [
  { name: "success", amount: 12_345 },
  { name: "processing forever", amount: 100_000 },
  { name: "fail", amount: 200_000 },
  { name: "compliance hold then success", amount: 300_000 },
  { name: "compliance hold then fail", amount: 400_000 },
  { name: "success then reversed", amount: 500_100 },
  { name: "reversed with fx impact and fees", amount: 550_100 },
];

steps.payouts = async (tz) => {
  if (!state.cnBeneficiary) throw new Error("no CN beneficiary yet: run --step=beneficiaries");
  state.payouts ??= {};
  for (const o of OUTCOMES) {
    const p = await attempt(`payout ${o.name}`, () => tz.createPayout(cnPayout(o.amount), `tsc-sbx-pot-${run}-${o.amount}`));
    if (!p) continue;
    state.payouts[o.name] = { id: p.id, amount: o.amount, createdAt: now(), seen: [{ at: now(), status: p.status }] };
    show(`payout ${o.name} created`, payoutSummary(p));
    save();
  }
};

steps.poll = async (tz, { minutes = Number(process.env.POLL_MINUTES ?? 6) } = {}) => {
  const entries = Object.entries(state.payouts ?? {});
  if (!entries.length) throw new Error("no payouts yet: run --step=payouts");
  const until = Date.now() + minutes * 60_000;
  while (Date.now() < until) {
    for (const [name, entry] of entries) {
      const p = await attempt(`poll ${name}`, () => tz.getPayout(entry.id));
      if (!p) continue;
      const last = entry.seen.at(-1)?.status;
      if (p.status !== last) {
        entry.seen.push({ at: now(), status: p.status });
        log(`${now()}  ${name}: ${last} -> ${p.status}`);
      }
      entry.last = payoutSummary(p);
    }
    save();
    const terminal = entries.every(([n, e]) => ["failed", "cancelled", "reversed"].includes(e.last?.status) || (e.last?.status === "succeeded" && !/reversed/.test(n)));
    if (terminal) break;
    await new Promise((r) => setTimeout(r, 20_000));
  }
  for (const [name, e] of entries) show(`final ${name}`, { seen: e.seen, ...e.last });
};

steps.hk = async (tz) => {
  if (!state.hkBeneficiary) throw new Error("no HK beneficiary yet: run --step=beneficiaries");
  const meta = state.corridors?.["HK-HKD"]?.find((m) => m.payout_type === "local");
  // CHATS was the cheaper quote (USD 3.23 vs 5.38 with no network named).
  const network = meta?.networks?.[0]?.split(" ")[0] ?? "chats";
  const body = {
    beneficiary: state.hkBeneficiary,
    amount: 23_456,
    currency: "HKD",
    holding_currency: "USD",
    type: "local",
    ...(network ? { local: { fund_transfer_network: network } } : {}),
    purpose: "PYR003",
    transaction_description: "TSC sandbox: production step payment",
    reference_id: `tsc-sbx-hk-${run}`,
    documents: CN_DOCS,
  };
  const p = await attempt("HK payout", () => tz.createPayout(body, `tsc-sbx-pot-hk-${run}`));
  if (!p) return;
  state.payouts ??= {};
  state.payouts["hk local"] = { id: p.id, amount: body.amount, createdAt: now(), seen: [{ at: now(), status: p.status }] };
  show("HK payout created", payoutSummary(p));
  save();
};

/** What happens with no balance: is a payout refused, or left waiting for funds? */
steps.unfunded = async (tz) => {
  if (!state.cnBeneficiary) throw new Error("no CN beneficiary yet: run --step=beneficiaries");
  const p = await attempt("payout with no balance", () => tz.createPayout(cnPayout(10_000), `tsc-sbx-pot-unfunded-${run}`));
  if (p) {
    (state.payouts ??= {})["unfunded"] = { id: p.id, amount: 10_000, createdAt: now(), seen: [{ at: now(), status: p.status }] };
    show("payout with no balance", payoutSummary(p));
    save();
  }
};

/** Fees and FX before any money: a payout quote needs no balance. */
const QUOTES = [
  ["CN CNY cnaps 10,000.00", { payout_type: "local", local: { fund_transfer_network: "cnaps" }, payout_info: { currency: "CNY", amount: 1_000_000 }, destination_info: { currency: "CNY", country: "CN" } }],
  ["CN CNY cnaps 100.00", { payout_type: "local", local: { fund_transfer_network: "cnaps" }, payout_info: { currency: "CNY", amount: 10_000 }, destination_info: { currency: "CNY", country: "CN" } }],
  ["CN CNY cnaps 100,000.00", { payout_type: "local", local: { fund_transfer_network: "cnaps" }, payout_info: { currency: "CNY", amount: 10_000_000 }, destination_info: { currency: "CNY", country: "CN" } }],
  ["CN CNY unionpay 10,000.00", { payout_type: "local", local: { fund_transfer_network: "unionpay" }, payout_info: { currency: "CNY", amount: 1_000_000 }, destination_info: { currency: "CNY", country: "CN" } }],
  ["CN CNY swift 10,000.00", { payout_type: "swift", payout_info: { currency: "CNY", amount: 1_000_000 }, destination_info: { currency: "CNY", country: "CN" } }],
  ["CN USD swift 1,000.00", { payout_type: "swift", payout_info: { currency: "USD", amount: 100_000 }, destination_info: { currency: "USD", country: "CN" } }],
  ["HK HKD fps 10,000.00", { payout_type: "local", local: { fund_transfer_network: "fps" }, payout_info: { currency: "HKD", amount: 1_000_000 }, destination_info: { currency: "HKD", country: "HK" } }],
  ["HK HKD chats 10,000.00", { payout_type: "local", local: { fund_transfer_network: "chats" }, payout_info: { currency: "HKD", amount: 1_000_000 }, destination_info: { currency: "HKD", country: "HK" } }],
  ["HK HKD local (no network) 10,000.00", { payout_type: "local", payout_info: { currency: "HKD", amount: 1_000_000 }, destination_info: { currency: "HKD", country: "HK" } }],
  ["HK USD swift cross_border_wire 1,000.00", { payout_type: "swift", swift: { fund_transfer_network: "cross_border_wire" }, payout_info: { currency: "USD", amount: 100_000 }, destination_info: { currency: "USD", country: "HK" } }],
];

steps.quotes = async (tz) => {
  for (const [label, body] of QUOTES) {
    const q = await attempt(`quote ${label}`, () => tz.payoutQuote({ ...body, holding_info: { currency: "USD" } }));
    if (!q) continue;
    show(`quote ${label}`, { id: q.id, status: q.status, created_at: q.created_at, valid_until: q.valid_until, holding_debited: q.holding_info, payout: q.payout_info, exchange_rates: q.exchange_rates, fee_info: q.fee_info });
  }
};

/**
 * Without a balance: does Tazapay validate a payout's fields before refusing it
 * for funds, and does the outcome amount change anything?
 */
steps.validate = async (tz) => {
  if (!state.cnBeneficiary) throw new Error("no CN beneficiary yet: run --step=beneficiaries");
  for (const o of OUTCOMES) {
    await attempt(`unfunded payout, ${o.name} (${o.amount})`, () => tz.createPayout(cnPayout(o.amount), `tsc-sbx-val-${run}-${o.amount}`));
  }
  await attempt("unfunded payout, PYR022 goods with tracking and items", () => tz.createPayout(cnPayout(12_345, "PYR022"), `tsc-sbx-val-${run}-goods`));
  const noPurpose = cnPayout(12_345); delete noPurpose.purpose;
  await attempt("payout with no purpose", () => tz.createPayout(noPurpose));
  const noDescription = cnPayout(12_345); delete noDescription.transaction_description;
  await attempt("payout with no transaction_description", () => tz.createPayout(noDescription));
  await attempt("payout to an unknown beneficiary", () => tz.createPayout({ ...cnPayout(12_345), beneficiary: "bnf_doesnotexist000000000" }));
  await attempt("payout above the CNAPS limit (CNY 600,001)", () => tz.createPayout(cnPayout(60_000_100)));
  // A CN beneficiary missing every corridor-required field, then a payout to it.
  const bare = await attempt("bare CN beneficiary", () => tz.createBeneficiary({
    name: "Bare Test Co", type: "business", email: `tazapay-bare-${run}@example.com`,
    address: { line1: "1 Road", country: "CN" },
    destination_details: { type: "bank", bank: { bank_name: "Bank of China", country: "CN", currency: "CNY" } },
  }));
  if (bare) {
    show("bare CN beneficiary accepted", { id: bare.id, status: bare.status });
    await attempt("payout to the bare beneficiary", () => tz.createPayout({ ...cnPayout(12_345), beneficiary: bare.id }));
  }
  // Idempotency: the same key twice on a create that succeeds.
  const key = `tsc-sbx-idem-${run}`;
  const body = { ...CN_COMPANY, email: `tazapay-idem-${run}@example.com` };
  const first = await attempt("idempotent beneficiary #1", () => tz.createBeneficiary(body, key));
  const second = await attempt("idempotent beneficiary #2 (same key)", () => tz.createBeneficiary(body, key));
  show("idempotency", { first: first?.id, second: second?.id, same: Boolean(first && first.id === second?.id) });
};

/**
 * A hosted checkout to fund the sandbox balance when no collection account can
 * be made. A person pays it in a browser with Tazapay's published test card.
 * Tries the largest amount first and steps down if refused.
 */
steps.checkout = async (tz) => {
  // Card is offered only up to some amount (not at USD 50,000 in sandbox; yes at
  // 10,000), and only for some buyer countries (an SG buyer, not a US one).
  for (const dollars of [50_000, 25_000, 10_000, 5_000, 1_000]) {
    const body = {
      invoice_currency: "USD",
      payment_methods: ["card"],
      amount: dollars * 100,
      transaction_description: "TSC sandbox: fund balance for payout tests",
      reference_id: `tsc-sbx-fund-card-${run}-${dollars}`,
      success_url: "https://example.com/tsc-sandbox/success",
      cancel_url: "https://example.com/tsc-sandbox/cancel",
      customer_details: {
        name: "TSC Sandbox Buyer",
        email: `tazapay-buyer-${run}@example.com`,
        country: "SG",
        phone: { calling_code: "65", number: "61234567" },
      },
      billing_details: {
        name: "TSC Sandbox Buyer",
        address: { line1: "1 Test Street", city: "Singapore", country: "SG", postal_code: "018989" },
        phone: { calling_code: "65", number: "61234567" },
      },
    };
    const c = await attempt(`checkout USD ${dollars}`, () => tz.call("POST", "/v3/checkout", { body, idempotencyKey: body.reference_id }));
    if (!c) continue;
    (state.checkouts ??= []).push({ id: c.id, dollars, url: c.url, payin: c.payin, at: now() });
    save();
    show(`checkout USD ${dollars} created`, { id: c.id, url: c.url, status: c.status, payment_status: c.payment_status, payin: c.payin, payment_methods: c.payment_methods, expires_at: c.expires_at });
    return c;
  }
};

/** Read back each checkout made here: status, payin, and what it did to the balance. */
steps.checkoutStatus = async (tz) => {
  for (const c of state.checkouts ?? []) {
    const got = await attempt(`checkout ${c.id}`, () => tz.call("GET", `/v3/checkout/${c.id}`));
    if (got) show(`checkout ${c.id}`, { status: got.status, payment_status: got.payment_status, payment_status_description: got.payment_status_description, payin: got.payin, paid_amount: got.paid_amount, latest_payment_attempt: got.latest_payment_attempt });
  }
  show("balance now", await tz.balance());
  show("balance transactions", await tz.call("GET", "/v3/balance_transaction"));
};

const ORDER = ["auth", "corridors", "beneficiaries", "balance", "payouts", "hk", "poll"];

async function main() {
  loadEnv();
  const tz = tazapayFrom();
  if (!tz) throw new Error("Tazapay is not set up: TAZAPAY_BASE_URL, TAZAPAY_API_KEY and TAZAPAY_API_SECRET are needed.");
  const only = process.argv.find((a) => a.startsWith("--step="))?.slice(7);
  if (only) {
    if (!steps[only]) throw new Error(`no step "${only}": ${Object.keys(steps).join(", ")}`);
    await steps[only](tz);
    return;
  }
  for (const name of ORDER) {
    const result = await steps[name](tz);
    if (name === "balance" && result === false) { log("\nStopped before payouts: fund the sandbox balance first."); return; }
  }
}

main().catch((e) => { console.error(`\n${e.kind ? `[${e.kind}] ` : ""}${e.message}`); process.exit(1); });
