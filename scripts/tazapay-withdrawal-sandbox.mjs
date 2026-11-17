#!/usr/bin/env node
/**
 * A factory's withdrawal paid by Tazapay, against Tazapay's SANDBOX, through the
 * real core (api/_withdrawals.js) and adapter (api/_withdrawal-adapters.js).
 * The database and storage are a small in-memory stand-in: no Supabase stack.
 *
 *   node scripts/tazapay-withdrawal-sandbox.mjs [--only=cn,hk,bank,short,small,large,timeout]
 *
 * Needs TAZAPAY_BASE_URL, TAZAPAY_API_KEY and TAZAPAY_API_SECRET in the
 * environment or .env.local. Refuses any Tazapay that isn't the sandbox. Never
 * prints a key. Spends about US$500 of the sandbox's USD balance a run.
 *
 * The sandbox decides a CNY payout's fate by its amount: CNY 2,000-2,500 is
 * refused by the bank; most other amounts succeed.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
for (const file of [join(ROOT, ".env.local"), join(ROOT, "../../../.env.local")]) {
  for (const line of existsSync(file) ? readFileSync(file, "utf8").split("\n") : []) {
    const m = line.match(/^\s*(TAZAPAY_[A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
delete process.env.VERCEL_ENV;
let host;
try { host = new URL(process.env.TAZAPAY_BASE_URL ?? "").host; } catch { host = ""; }
if (host !== "service-sandbox.tazapay.com") {
  console.error("Stopped: TAZAPAY_BASE_URL is not Tazapay's sandbox.");
  process.exit(1);
}

const { tazapayAdapter } = await import("../api/_withdrawal-adapters.js");
const { approveWithdrawal, readBack } = await import("../api/_withdrawals.js");
const { TazapayFailure } = await import("../api/_tazapay.js");
const { usccCheckChar } = await import("../src/shared/registration-number.mjs");

const tazapay = tazapayAdapter.build();
if (!tazapay) throw new Error("TAZAPAY_BASE_URL, TAZAPAY_API_KEY and TAZAPAY_API_SECRET are needed.");
const RUN = Date.now();
const ONLY = (process.argv.find((a) => a.startsWith("--only="))?.slice(7) ?? "cn,hk,bank,short,small,large,timeout").split(",");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const usd = (c) => `US$${(c / 100).toFixed(2)}`;
const USCC = "91440300MA5G8X2Q7" + usccCheckChar("91440300MA5G8X2Q7");
// The sandbox's test account number (scripts/tazapay-sandbox-payouts.mjs). Not a real account.
const TEST_NUMBER = "0000000062178500001";

const ACCOUNTS = {
  CN: {
    method: "bank", bank_country: "CN", account_name: "Shenzhen Hengda Garment Co Ltd", holder_name_local: "深圳市恒达服装制造有限公司",
    registration_number: USCC, bank_name: "Bank of China", bank_code: "104100000004", swift: "BKCHCNBJ",
    address_line1: "88 Bantian Industrial Road", address_city: "Shenzhen", address_state: "Guangdong", address_postal_code: null,
  },
  HK: {
    method: "bank", bank_country: "HK", account_name: "Kowloon Knitwear Trading Ltd", holder_name_local: null, registration_number: null,
    bank_name: "The Hongkong and Shanghai Banking Corporation Limited", bank_code: "004", swift: "HSBCHKHH",
    address_line1: "Unit 12, 8/F, 45 Hung To Road", address_city: "Kwun Tong", address_state: "Kowloon", address_postal_code: null,
  },
};

/** One factory, one withdrawal, held in memory: what the database and storage would say. */
function world({ country, amount, client = tazapay }) {
  const orgId = `org-${country}-${RUN}`;
  const changedAt = new Date(RUN).toISOString();
  const account = { id: `acct-${country}-${RUN}`, org_id: orgId, number_changed_at: changedAt, tazapay_beneficiary_id: null, ...ACCOUNTS[country] };
  const w = { id: randomUUID(), key: randomUUID(), status: "requested", provider_ref: null, recorded: [], files: new Map(), client };
  const first = Math.floor(amount * 0.4);
  const pool = [
    { id: "p1", amount_cents: first, release_requested_at: "2026-11-01T00:00:00Z", milestone_id: "m1", production_orders: { order_number: `TZW-${String(RUN).slice(-5)}-1`, factory_org_id: orgId } },
    { id: "p2", amount_cents: amount - first, release_requested_at: "2026-11-02T00:00:00Z", milestone_id: "m2", production_orders: { order_number: `TZW-${String(RUN).slice(-5)}-2`, factory_org_id: orgId } },
  ];
  const tables = () => ({
    factory_payout_accounts: account,
    company_registrations: country === "CN" ? { number: USCC, country_code: "CN" } : null,
    factory_profiles: { country_code: country },
    order_payments: pool,
    order_milestones: [{ id: "m1", title: "Deposit" }, { id: "m2", title: "Balance before shipping" }],
    factory_withdrawals: [{ id: w.id, amount_cents: amount, status: "paying", created_at: changedAt }],
  });
  w.db = {
    from(table) {
      const q = { select: () => q, eq: () => q, in: () => q, not: () => q, limit: () => q,
        maybeSingle: async () => ({ data: tables()[table] ?? null, error: null }),
        then: (ok) => ok({ data: tables()[table] ?? [], error: null }) };
      return q;
    },
    async rpc(name, args) {
      if (name === "set_tazapay_beneficiary") { account.tazapay_beneficiary_id = args.beneficiary_id; return { data: true, error: null }; }
      if (name !== "record_withdrawal") throw new Error(`unexpected ${name}`);
      w.recorded.push(args);
      if (["paid", "failed"].includes(w.status)) return { data: {}, error: null };
      if (args.ref) w.provider_ref = args.ref;
      if (args.outcome === "requeue") { w.status = "requested"; w.key = randomUUID(); }
      else if (args.outcome === "paid") w.status = "paid";
      else if (args.outcome === "failed") w.status = "failed";
      return { data: {}, error: null };
    },
    storage: { from: () => ({
      upload: async (path, bytes) => { w.files.set(path, { bytes, created_at: w.files.get(path)?.created_at ?? new Date().toISOString() }); return { error: null }; },
      list: async (folder) => ({ data: [...w.files.entries()].filter(([p]) => p.startsWith(`${folder}/`)).map(([p, f]) => ({ name: p.slice(folder.length + 1), created_at: f.created_at })), error: null }),
    }) },
  };
  w.caller = { async rpc(name) {
    if (name === "claim_withdrawal") {
      const resumed = w.status === "paying";
      w.status = "paying";
      return { data: { withdrawal_id: w.id, key: w.key, resumed, provider: "tazapay", provider_ref: w.provider_ref, amount_cents: amount, currency: "USD", org_id: orgId, account_id: account.id }, error: null };
    }
    // payout_tazapay_beneficiary: what the database reveals to staff, here with the sandbox's test number.
    if (name === "payout_tazapay_beneficiary") return { data: [{ ...account, account_number: TEST_NUMBER, changed_at: changedAt }], error: null };
    throw new Error(`unexpected ${name}`);
  } };
  w.approve = () => approveWithdrawal({ adapter: tazapayAdapter, client: w.client, caller: w.caller, db: w.db, id: w.id });
  w.readBackUntil = async (done, minutes = 6) => {
    const until = Date.now() + minutes * 60_000;
    for (;;) {
      const state = await readBack({ adapter: tazapayAdapter, client: w.client, db: w.db, id: w.id, ref: w.provider_ref });
      if (done.includes(state) || Date.now() > until) return state;
      await sleep(15_000);
    }
  };
  return w;
}

const results = [];
const report = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}: ${detail}`); };
const said = (e) => `${e?.kind ?? "error"}: ${e?.message ?? e}`;

async function paid(country, amount) {
  const w = world({ country, amount });
  const out = await w.approve();
  const fee = w.recorded.find((r) => r.fee != null);
  const state = out.done === "paid" ? "paid" : await w.readBackUntil(["paid", "failed"]);
  const pdf = [...w.files.values()][0]?.bytes.toString("latin1") ?? "";
  const lines = (pdf.match(/TZW-\d+-\d \/ [^)]+/g) ?? []).length;
  report(`${country} paid`, state === "paid" && fee?.fee === 500 && lines === 2,
    `${usd(amount)} -> ${w.provider_ref}, ${state}; fee ${usd(fee?.fee ?? 0)}, receives ${fee?.receives} ${fee?.receives_in} minor; invoice lines ${lines}`);
}

if (ONLY.includes("cn")) await paid("CN", 10000).catch((e) => report("CN paid", false, said(e)));
if (ONLY.includes("hk")) await paid("HK", 3000).catch((e) => report("HK paid", false, said(e)));

if (ONLY.includes("bank")) {
  try {
    // Aim for CNY 2,250 arriving, which the sandbox's bank refuses.
    const probe = await tazapay.quote({ holdingCurrency: "USD", amountMinor: 50000, route: { type: "local", network: "cnaps", currency: "CNY", country: "CN" } });
    const amount = Math.round(225000 / probe.rate) + 500;
    const w = world({ country: "CN", amount });
    await w.approve();
    const state = await w.readBackUntil(["failed", "paid"], 9);
    const last = w.recorded.at(-1);
    report("bank refuses", state === "failed" && /Check your bank details/.test(last.sentence ?? ""),
      `${usd(amount)} -> ${w.provider_ref}, ${state}; factory reads: "${last.sentence}"`);
  } catch (e) { report("bank refuses", false, said(e)); }
}

if (ONLY.includes("short")) {
  try {
    // A stand-in balance of US$10: the sandbox balance can't be drained.
    const client = { ...tazapay, available: async () => 1000 };
    const w = world({ country: "CN", amount: 20000, client });
    const out = await w.approve();
    report("TSC balance short", out.done === "short_balance" && !w.provider_ref && w.status === "requested", `${out.done}: "${out.sentence}"`);
  } catch (e) { report("TSC balance short", false, said(e)); }
}

if (ONLY.includes("small")) {
  for (const [country, amount, why] of [["CN", 500, "no more than the fee"], ["HK", 505, "under Tazapay's HK$1 minimum after the fee"]]) {
    const w = world({ country, amount });
    try {
      await w.approve();
      report(`too small (${country} ${usd(amount)})`, false, `sent: ${w.provider_ref}`);
    } catch (e) {
      report(`too small (${country} ${usd(amount)}, ${why})`, e.kind === "too_small" && !w.provider_ref && w.status === "requested", `"${e.message}"`);
    }
  }
}

if (ONLY.includes("large")) {
  const client = { ...tazapay, available: async () => 100_000_000 };
  const w = world({ country: "CN", amount: 10_000_000, client });
  try {
    await w.approve();
    report("above the maximum", false, `sent: ${w.provider_ref}`);
  } catch (e) {
    report("above the maximum (CN US$100,000)", e.kind === "too_large" && !w.provider_ref && w.status === "requested", `"${e.message}"`);
  }
}

if (ONLY.includes("timeout")) {
  try {
    // The first press's payout is made, then its answer is lost.
    let lose = true;
    const made = [];
    const client = {
      ...tazapay,
      async createPayout(body, key) {
        const payout = await tazapay.createPayout(body, key);
        made.push(payout.id);
        if (lose) { lose = false; throw new TazapayFailure("timeout", "Tazapay didn't answer in time, so we don't know yet if this went. Press again: it can't pay twice.", { unsure: true }); }
        return payout;
      },
    };
    const w = world({ country: "CN", amount: 12000, client });
    const firstKey = w.key;
    let first;
    try { await w.approve(); } catch (e) { first = e; }
    const stillPaying = w.status === "paying" && !w.provider_ref && w.key === firstKey;
    const out = await w.approve();
    report("timeout, pressed again", first?.unsure === true && stillPaying && made.length === 2 && made[0] === made[1] && w.provider_ref === made[0],
      `first press lost (${first?.kind}); second press, same key, got ${made[1]} = first ${made[0]}; ${out.done}`);
  } catch (e) { report("timeout, pressed again", false, said(e)); }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
