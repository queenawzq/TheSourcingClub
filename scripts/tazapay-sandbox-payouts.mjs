#!/usr/bin/env node
/**
 * Pay with Tazapay, end to end, on the LOCAL stack against Tazapay's SANDBOX.
 * The staff route (api/tazapay-payout.js) is called as a signed-in member of
 * staff, exactly as the board calls it; the board's own read-back ("sync")
 * records where each payout goes.
 *
 *   npx supabase start && node scripts/tazapay-sandbox-payouts.mjs [--scenario=outcomes|hk|retry]
 *
 * Needs TAZAPAY_* in the environment or .env.local, with money in the sandbox's
 * USD balance (about USD 1,700 a run). Refuses any database that isn't on this
 * machine and any Tazapay that isn't the sandbox. Makes its own companies, named
 * with the run's stamp, so test_data_candidates() can remove them.
 *
 * Five payments, one per outcome Tazapay simulates by the payout's CNY amount:
 *   success (any amount), 200k-250k fails at the bank, 300k-350k is held for
 *   compliance then paid, 400k-450k is held then refused, 500k-550k is paid
 *   then reversed. USD steps are picked so that, at the sandbox's rate, each
 *   lands inside its band; the run checks that it did.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { usccCheckChar } from "../src/shared/registration-number.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const RUN = Date.now();
const OUT = join(tmpdir(), `tsc-tazapay-e2e-${RUN}.json`);
const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Settings: local database, sandbox Tazapay -----------------------------------
for (const line of existsSync(join(ROOT, ".env.local")) ? readFileSync(join(ROOT, ".env.local"), "utf8").split("\n") : []) {
  const m = line.match(/^\s*(TAZAPAY_[A-Z_]+)\s*=\s*(.*?)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const stack = JSON.parse(execFileSync("npx", ["supabase", "status", "-o", "json"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
const URL_ = stack.API_URL;
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(URL_ ?? "")) throw new Error("This runs on the local stack only.");
Object.assign(process.env, {
  SUPABASE_URL: URL_, SUPABASE_ANON_KEY: stack.ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: stack.SERVICE_ROLE_KEY,
  VERCEL_ENV: "development",
});
const project = readFileSync(join(ROOT, "supabase/config.toml"), "utf8").match(/^project_id = "([^"]+)"/m)[1];
const sql = (text) => execFileSync("docker", ["exec", "-i", `supabase_db_${project}`, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-qAt"], { input: text, encoding: "utf8" }).trim();

const { default: payRoute } = await import("../api/tazapay-payout.js");
const { tazapayFrom } = await import("../api/_tazapay.js");
const tazapay = tazapayFrom();
if (!tazapay) throw new Error("TAZAPAY_BASE_URL, TAZAPAY_API_KEY and TAZAPAY_API_SECRET are needed.");
const db = createClient(URL_, stack.SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// --- Fixtures ----------------------------------------------------------------
const id = (n) => `e2e00000-0000-4000-8000-${String(RUN).slice(-8)}${String(n).padStart(4, "0")}`;
const ORG = { brand: id(1), factory: id(2) };
const USERS = { owner: id(3), brand: id(4) };
const ORDER = id(5);
const ACCOUNT = id(6);
const USCC = "91440300MA5G8X2Q7" + usccCheckChar("91440300MA5G8X2Q7");
// --scenario=outcomes (default): the five outcomes, a mainland account.
// --scenario=hk: one payout to a Hong Kong account, HKD over CHATS.
// --scenario=retry: a bank refusal, then the reopened payment paid again (a new
//   attempt, key and payout; the first left as it was). The sandbox decides by
//   amount, so the second payout of the same step is refused by the bank too.
const SCENARIO = process.argv.find((a) => a.startsWith("--scenario="))?.slice(11) ?? "outcomes";
const HK = SCENARIO === "hk";
const CASES = ({
  outcomes: [
    { name: "success", usd: 10000, band: [1, 99999] },
    { name: "bank refuses", usd: 34375, band: [200000, 250000] },
    { name: "compliance hold, then paid", usd: 50000, band: [300000, 350000] },
    { name: "compliance hold, then refused", usd: 64000, band: [400000, 450000] },
    { name: "paid, then reversed", usd: 80000, band: [500001, 550000] },
  ],
  hk: [{ name: "Hong Kong, HKD over CHATS", usd: 3000, band: [100, 99999] }],
  retry: [{ name: "bank refuses, then paid again", usd: 34375, band: [200000, 250000] }],
})[SCENARIO].map((c, i) => ({ ...c, milestone: id(10 + i), payment: id(20 + i) }));
const ACCOUNT_VALUES = HK
  ? `'${ACCOUNT}', '${ORG.factory}', 'bank', 'The Hongkong and Shanghai Banking Corporation Limited', 'Kowloon Knitwear Trading Ltd', '0001', 'HK', true,
  null, null, '004', 'HSBCHKHH', 'Unit 12, 8/F, 45 Hung To Road', 'Kwun Tong', 'Kowloon', now()`
  : `'${ACCOUNT}', '${ORG.factory}', 'bank', 'Bank of China', 'Shenzhen Hengda Garment Co Ltd', '0001', 'CN', true,
  '深圳市恒达服装制造有限公司', '${USCC}', '104100000004', 'BKCHCNBJ', '88 Bantian Industrial Road', 'Shenzhen', 'Guangdong', now()`;

const staffEmail = `tazapay-staff-${RUN}@example.com`;
const password = `tz-${RUN}-pw`;
const made = await db.auth.admin.createUser({ email: staffEmail, password, email_confirm: true });
if (made.error) throw made.error;
const staffId = made.data.user.id;

sql(`
set session_replication_role = replica;
insert into auth.users (id, email) values ('${USERS.owner}', 'tazapay-owner-${RUN}@example.com'), ('${USERS.brand}', 'tazapay-brand-${RUN}@example.com');
insert into public.platform_admins (user_id, note) values ('${staffId}', 'tazapay e2e ${RUN}');
insert into public.orgs (id, type, name, slug) values
  ('${ORG.brand}', 'brand', 'Tazapay e2e brand ${RUN}', 'tz-e2e-brand-${RUN}'),
  ('${ORG.factory}', 'factory', 'Tazapay e2e mill ${RUN}', 'tz-e2e-mill-${RUN}');
insert into public.org_members (org_id, user_id, role, permissions) values
  ('${ORG.factory}', '${USERS.owner}', 'owner', '{}'), ('${ORG.brand}', '${USERS.brand}', 'owner', '{}');
insert into public.company_registrations (org_id, country_code, number) values ('${ORG.factory}', 'CN', '${USCC}');
insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total)
values ('${id(7)}', '${ORG.brand}', 'Tazapay e2e request', 'awarded', 'invited_only', 100);
insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity, submitted_at)
values ('${id(8)}', '${id(7)}', '${ORG.factory}', 'accepted', 100, 1, now());
insert into public.production_orders (id, rfq_id, quote_id, brand_org_id, factory_org_id, unit_price_cents,
  production_quantity, bulk_subtotal_cents, sample_subtotal_cents, order_total_cents, deposit_pct, balance_pct, order_number)
values ('${ORDER}', '${id(7)}', '${id(8)}', '${ORG.brand}', '${ORG.factory}', 1000, 1, 1000, 0, 1000, 50, 50, 'TZ-${String(RUN).slice(-6)}');
${CASES.map((c, i) => `
insert into public.order_milestones (id, order_id, kind, title, amount_cents) values ('${c.milestone}', '${ORDER}', 'payment_only', 'Step ${i + 1}: ${c.name}', ${c.usd});
insert into public.order_payments (id, order_id, milestone_id, amount_cents, currency, state, confirmed_at, release_requested_at)
values ('${c.payment}', '${ORDER}', '${c.milestone}', ${c.usd}, 'USD', 'confirmed', now(), now());`).join("")}
insert into public.factory_payout_accounts (id, org_id, method, bank_name, account_name, account_number_last4, bank_country, is_primary,
  holder_name_local, registration_number, bank_code, swift, address_line1, address_city, address_state, details_changed_at)
values (${ACCOUNT_VALUES});
insert into public.payout_account_numbers (account_id, vault_secret_id, number_kind)
values ('${ACCOUNT}', vault.create_secret('0000000062178500001', 'payout-number-${ACCOUNT}'), 'account');
-- The guard sets this from the stored number; it is off in replica mode.
update public.factory_payout_accounts set number_changed_at = (select updated_at from public.payout_account_numbers where account_id = '${ACCOUNT}') where id = '${ACCOUNT}';
`);
log(`fixtures: factory ${ORG.factory}, order TZ-${String(RUN).slice(-6)}, ${CASES.length} payments owed`);

const signedIn = await createClient(URL_, stack.ANON_KEY, { auth: { persistSession: false } }).auth.signInWithPassword({ email: staffEmail, password });
if (signedIn.error) throw signedIn.error;
const token = signedIn.data.session.access_token;

async function call(body) {
  const response = { code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await payRoute({ method: "POST", headers: { authorization: `Bearer ${token}` }, body }, response);
  return { code: response.code, ...response.body };
}
const changedAt = async () => (await db.from("factory_payout_accounts").select("details_changed_at").eq("id", ACCOUNT).single()).data.details_changed_at;
const pay = async (c) => call({ action: "pay", paymentId: c.payment, paidToChangedAt: await changedAt() });

async function snapshot(c) {
  const [{ data: payment }, { data: payouts }] = await Promise.all([
    db.from("order_payments").select("state, released_at").eq("id", c.payment).single(),
    db.from("provider_payouts").select("id, status, provider_ref, failure_code, paid_at, received_minor, received_currency, asked_to_check").eq("payment_id", c.payment).order("created_at"),
  ]);
  const latest = payouts?.at(-1);
  const attempt = latest ? (await db.from("provider_payout_attempts").select("stage, provider_status, staff_sentence, fee_minor, attempt_key").eq("payout_id", latest.id).single()).data : null;
  return { payment: payment?.state, attempts: payouts?.length ?? 0, ...latest, ...attempt };
}

// --- Press: each payment once, one of them twice at the same moment -------------
const result = { run: RUN, scenario: SCENARIO, startedAt: new Date().toISOString(), cases: {} };
function pick(s) {
  return { payment: s.payment, status: s.status, provider_status: s.provider_status, stage: s.stage, sentence: s.staff_sentence, attempts: s.attempts, failure_code: s.failure_code, ref: s.provider_ref };
}
async function press(c, twice = false) {
  const t0 = Date.now();
  const presses = twice ? await Promise.all([pay(c), pay(c)]) : [await pay(c)];
  const snap = await snapshot(c);
  const entry = result.cases[c.name] ??= { usd: c.usd, presses: [], seen: [] };
  entry.presses.push(...presses.map((p) => ({ at: new Date().toISOString(), code: p.code, done: p.done ?? null, error: p.error ?? null })));
  entry.ms = Date.now() - t0;
  entry.seen.push({ at: new Date().toISOString(), ...pick(snap) });
  const payout = snap.provider_ref ? await tazapay.getPayout(snap.provider_ref) : null;
  c.ref = snap.provider_ref;
  c.sent = payout?.amount;
  c.currency = payout?.currency;
  c.network = payout?.local?.fund_transfer_network;
  c.beneficiary = payout?.beneficiary;
  c.documents = payout?.documents?.length ?? 0;
  log(`${c.name}: ${presses.map((p) => `${p.code} ${p.done ?? p.error}`).join(" | ")}  payout ${c.ref} ${c.currency} ${c.sent} over ${c.network || "(Tazapay's choice)"} in band ${c.sent >= c.band[0] && c.sent <= c.band[1]}`);
}

// --- Read back, as the board does, until each is where it ends -----------------
async function readBackUntil(done, minutes = 9) {
  const until = Date.now() + minutes * 60_000;
  while (Date.now() < until) {
    await sleep(20_000);
    const synced = await call({ action: "sync" });
    if (synced.code !== 200) log("sync", synced.code, synced.error);
    let all = true;
    for (const c of CASES) {
      const s = pick(await snapshot(c));
      const seen = result.cases[c.name].seen;
      const last = seen.at(-1);
      if (s.status !== last.status || s.provider_status !== last.provider_status || s.payment !== last.payment || s.sentence !== last.sentence || s.ref !== last.ref) {
        seen.push({ at: new Date().toISOString(), ...s });
        log(`${new Date().toISOString()} ${c.name}: ${last.provider_status} -> ${s.provider_status} (attempt ${s.status}, payment ${s.payment})`);
      }
      if (!done(c.name, s)) all = false;
    }
    if (all) return true;
  }
  return false;
}
const finished = (name, s) => name === "paid, then reversed" ? s.provider_status === "reversed" : ["paid", "failed", "cancelled"].includes(s.status);

for (const c of CASES) await press(c, c.name.startsWith("compliance hold, then paid"));
await readBackUntil(finished);

if (SCENARIO === "retry") {
  // The bank refused; the payment is owed again. Staff press again.
  const c = CASES[0];
  const first = (await db.from("provider_payouts").select("id, status, provider_ref, failure_code, updated_at").eq("payment_id", c.payment).order("created_at")).data[0];
  const firstKey = (await db.from("provider_payout_attempts").select("attempt_key").eq("payout_id", first.id).single()).data.attempt_key;
  await press(c);
  await readBackUntil((_n, s) => s.attempts === 2 && ["paid", "failed"].includes(s.status));
  const rows = (await db.from("provider_payouts").select("id, status, provider_ref, failure_code, updated_at").eq("payment_id", c.payment).order("created_at")).data;
  const keys = await Promise.all(rows.map(async (r) => (await db.from("provider_payout_attempts").select("attempt_key").eq("payout_id", r.id).single()).data.attempt_key));
  result.retry = {
    firstBefore: first, firstKey, rows, keys,
    newKey: keys[1] !== firstKey, newPayout: rows[1]?.provider_ref && rows[1].provider_ref !== first.provider_ref,
    firstUntouched: rows[0].status === first.status && rows[0].provider_ref === first.provider_ref && rows[0].updated_at === first.updated_at,
  };
  log(`retry: new key ${result.retry.newKey}, new payout ${result.retry.newPayout} (${rows[1]?.provider_ref}), first untouched ${result.retry.firstUntouched}`);
}

// --- Replays and what each side was told -----------------------------------------
result.replay = await pay(CASES[0]);
const doubled = CASES.find((c) => c.name.startsWith("compliance hold, then paid"));
if (doubled) {
  result.providerRefsDoublePress = (await db.from("provider_payouts").select("provider_ref").eq("payment_id", doubled.payment)).data;
}
result.beneficiaries = [...new Set(CASES.map((c) => c.beneficiary))];
result.accountBeneficiary = (await db.from("factory_payout_accounts").select("tazapay_beneficiary_id").eq("id", ACCOUNT).single()).data.tazapay_beneficiary_id;
result.documents = CASES.map((c) => c.documents);
result.invoicesKept = await Promise.all(CASES.map(async (c) => ((await db.storage.from("org-private").list(`00000000-0000-0000-0000-000000000000/tazapay-invoices/${c.payment}`)).data ?? []).length));
result.factoryNotices = (await db.from("notifications").select("title, body, created_at").eq("org_id", ORG.factory).order("created_at")).data;
result.events = (await db.from("payment_events").select("payment_id, from_state, to_state, note, created_at").in("payment_id", CASES.map((c) => c.payment)).order("created_at")).data;
result.reveals = sql(`select how || ' by ' || staff_email from public.payout_number_reveals where account_id = '${ACCOUNT}'`).split("\n");
result.sent = Object.fromEntries(CASES.map((c) => [c.name, { amount: c.sent, currency: c.currency, network: c.network, band: c.band, inBand: c.sent >= c.band[0] && c.sent <= c.band[1], ref: c.ref }]));
result.finishedAt = new Date().toISOString();
writeFileSync(OUT, JSON.stringify(result, null, 2));
log(`\npressing again on the first payment: ${result.replay.code} ${result.replay.error ?? result.replay.done}`);
if (doubled) log(`double press: refs ${JSON.stringify(result.providerRefsDoublePress)}`);
log(`payees used: ${JSON.stringify(result.beneficiaries)} (account keeps ${result.accountBeneficiary})`);
log(`invoices: Tazapay ${result.documents.join(",")} / kept ${result.invoicesKept.join(",")}`);
log(`summary written to ${OUT}`);
