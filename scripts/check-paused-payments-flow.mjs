// Paused payments, end to end (20261125100000): every flow a card dispute, a
// refund made in Stripe or a staff refund sets off, driven through the real
// app paths against a local Supabase stack and Stripe TEST mode.
//
//   PP_ENV_FILE=<a worktree's .env.local> npm run check:paused-flow -- --repeat 3 [--only 1,2,8]
//
// What it starts, and stops when done: a dev server on 127.0.0.1 (5460-5469,
// for the api/* routes), `stripe listen` forwarding to a small relay in this
// process, and the relay, which hands every event about this run's payments
// to the dev server's /api/stripe-webhook byte for byte (signed by
// `stripe listen`), retrying a non-2xx answer as Stripe does. The relay can
// hold one PaymentIntent's events for a moment: Stripe's dispute test card
// disputes a charge seconds after it is paid, so a dispute on an APPROVED
// step is made by recording the payment (record_payment_succeeded, the
// server's own call), approving the step, then letting Stripe's events
// through, in the order a later dispute would arrive.
//
// Keys come from the environment or PP_ENV_FILE (default ./.env.local):
// VITE_SUPABASE_URL / SUPABASE_URL, VITE_SUPABASE_ANON_KEY,
// SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY (sk_test_ only). Nothing is
// printed and no key goes on a command line. Only a local database is used.
//
// Every scenario makes its own companies and orders, named with the run's
// stamp (test_data_candidates() finds them); nothing depends on the demo data
// or on another scenario. Exit code 1 on any failure.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { notificationBody, notificationTitle } from "../src/shared/notification-text.mjs";

// ---------------------------------------------------------------------------
// Arguments and keys.
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const argValue = (name) => {
  const at = argv.indexOf(name);
  if (at >= 0) return argv[at + 1];
  const eq = argv.find((a) => a.startsWith(`${name}=`));
  return eq ? eq.slice(name.length + 1) : undefined;
};
const REPEAT = Math.max(1, Number(argValue("--repeat") ?? 1));
const ONLY = argValue("--only") ? new Set(argValue("--only").split(",").map(Number)) : null;
const VERBOSE = argv.includes("--verbose");

function loadEnvFile(path) {
  const out = {};
  let text = "";
  try { text = readFileSync(path, "utf8"); } catch { return out; }
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*["']?([^"'\n]*)["']?\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}
const fileEnv = loadEnvFile(process.env.PP_ENV_FILE ?? ".env.local");
const env = (name) => process.env[name] || fileEnv[name] || "";
const URL = env("SUPABASE_URL") || env("VITE_SUPABASE_URL");
const ANON = env("SUPABASE_ANON_KEY") || env("VITE_SUPABASE_ANON_KEY");
const SERVICE = env("SUPABASE_SERVICE_KEY") || env("SUPABASE_SERVICE_ROLE_KEY");
const STRIPE_KEY = env("STRIPE_SECRET_KEY");
if (!URL || !ANON || !SERVICE) { console.error("No Supabase details: set PP_ENV_FILE to a .env.local with the local stack's URL and keys."); process.exit(1); }
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(URL)) { console.error("Refusing: only a local Supabase stack is used."); process.exit(1); }
if (!STRIPE_KEY.startsWith("sk_test_")) { console.error("Refusing: STRIPE_SECRET_KEY must be a Stripe TEST key (sk_test_)."); process.exit(1); }

const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const stripe = new Stripe(STRIPE_KEY);
const STAMP = String(Date.now());
const PASSWORD = "pp flow 8 check";

// ---------------------------------------------------------------------------
// Small helpers.
// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
const money = (cents) => `$${(Number(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
class Check extends Error {}
let currentStep = "";
const step = (name) => { currentStep = name; if (VERBOSE) console.log(`      · ${name}`); };
function expectEq(got, want, what) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) throw new Check(`${what}: expected ${w}, got ${g}`);
}
function expectTrue(cond, what, got) {
  if (!cond) throw new Check(`${what}${got !== undefined ? ` (got ${JSON.stringify(got)})` : ""}`);
}
const must = ({ data, error }, what) => {
  if (error) throw new Check(`${what}: ${error.message}${error.hint ? ` [hint ${error.hint}]` : ""}`);
  return data;
};
/** A call that must be refused with this hint. */
async function refused(promise, hint, what) {
  const { error } = await promise;
  if (!error) throw new Check(`${what}: expected refusal ${hint}, but it was allowed`);
  const hints = Array.isArray(hint) ? hint : [hint];
  if (!hints.includes(error.hint ?? error.code)) throw new Check(`${what}: expected hint ${hints.join("|")}, got ${error.hint ?? error.code} (${error.message})`);
  return error;
}
/** Polls until fn() returns a truthy value; never a fixed sleep. */
async function waitFor(fn, what, { timeout = 90_000, every = 1000 } = {}) {
  const until = Date.now() + timeout;
  let last;
  for (;;) {
    last = await fn();
    if (last) return last;
    if (Date.now() > until) throw new Check(`timed out waiting for ${what}`);
    await sleep(every);
  }
}

// ---------------------------------------------------------------------------
// Processes: the dev server, stripe listen and the relay between them.
// ---------------------------------------------------------------------------
const children = [];
let devPort = 0;
let relayPort = 0;
const relay = {
  intents: new Set(),
  held: new Map(), // intent -> [{ body, headers, type }]
  log: [], // { intent, type, status }
};
function eventIntent(event) {
  const o = event?.data?.object ?? {};
  if (event.type?.startsWith("payment_intent.")) return o.id;
  return typeof o.payment_intent === "string" ? o.payment_intent : o.payment_intent?.id ?? null;
}
async function deliver(body, headers, intent, type) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${devPort}/api/stripe-webhook`, {
        method: "POST", body, headers: { "content-type": "application/json", "stripe-signature": headers["stripe-signature"] },
      });
      relay.log.push({ intent, type, status: res.status, at: Date.now() });
      if (res.ok) return;
    } catch (failure) {
      relay.log.push({ intent, type, status: `error ${failure.message}`, at: Date.now() });
    }
    await sleep(Math.min(16_000, 1000 * 2 ** attempt));
  }
}
function startRelay(port) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" }).end("{}");
        const body = Buffer.concat(chunks);
        let event;
        try { event = JSON.parse(body.toString("utf8")); } catch { return; }
        const intent = eventIntent(event);
        if (!intent || !relay.intents.has(intent)) return;
        if (relay.held.has(intent)) { relay.held.get(intent).push({ body, headers: req.headers, type: event.type }); return; }
        deliver(body, req.headers, intent, event.type);
      });
    });
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}
const hold = (intent) => { if (!relay.held.has(intent)) relay.held.set(intent, []); };
async function release(intent) {
  const queue = relay.held.get(intent) ?? [];
  relay.held.delete(intent);
  for (const e of queue) await deliver(e.body, e.headers, intent, e.type);
}

async function portFree(port) {
  return new Promise((resolve) => {
    const s = createServer();
    s.once("error", () => resolve(false));
    s.listen(port, "127.0.0.1", () => s.close(() => resolve(true)));
  });
}
function run(cmd, args, extraEnv, { capture = false } = {}) {
  const child = spawn(cmd, args, { env: { ...process.env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"], detached: false });
  children.push(child);
  let out = "";
  child.stdout.on("data", (d) => { out += d; if (VERBOSE && !capture) process.stdout.write(`[${cmd}] ${d}`); });
  child.stderr.on("data", (d) => { out += d; if (VERBOSE && !capture) process.stderr.write(`[${cmd}] ${d}`); });
  return { child, output: () => out };
}
async function printSecret() {
  return new Promise((resolve, reject) => {
    const child = spawn("stripe", ["listen", "--print-secret"], { env: { ...process.env, STRIPE_API_KEY: STRIPE_KEY }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.on("close", (code) => {
      const secret = out.trim().match(/whsec_[A-Za-z0-9]+/)?.[0];
      if (code === 0 && secret) resolve(secret); else reject(new Error("stripe listen --print-secret failed"));
    });
  });
}
async function startProcesses() {
  const free = [];
  for (let p = 5460; p <= 5469 && free.length < 2; p += 1) if (await portFree(p)) free.push(p);
  if (free.length < 2) throw new Error("no two free ports in 5460-5469");
  [devPort, relayPort] = free;
  await startRelay(relayPort);
  const secret = await printSecret();
  const serverEnv = {
    VITE_SUPABASE_URL: URL, SUPABASE_URL: URL, VITE_SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE,
    STRIPE_SECRET_KEY: STRIPE_KEY, STRIPE_WEBHOOK_SECRET: secret, STRIPE_CONNECT_WEBHOOK_SECRET: secret,
    PUBLIC_APP_URL: `http://127.0.0.1:${devPort}`,
    VITE_STRIPE_PUBLISHABLE_KEY: env("VITE_STRIPE_PUBLISHABLE_KEY"),
    // Never email from a test run: no transport configured.
    RESEND_API_KEY: "", RESEND_FROM_EMAIL: "",
  };
  run(process.execPath, ["node_modules/vite/bin/vite.js", "--port", String(devPort), "--host", "127.0.0.1", "--strictPort"], serverEnv);
  await waitFor(async () => {
    try { const r = await fetch(`http://127.0.0.1:${devPort}/api/stripe-webhook`, { method: "GET" }); return r.status === 405; } catch { return false; }
  }, "the dev server", { timeout: 60_000, every: 500 });
  const listen = run("stripe", ["listen", "--all-snapshot", "--forward-to", `http://127.0.0.1:${relayPort}/webhook`], { STRIPE_API_KEY: STRIPE_KEY }, { capture: true });
  await waitFor(() => /Ready!/.test(listen.output()), "stripe listen", { timeout: 60_000, every: 500 });
}
function stopProcesses() {
  for (const child of children) {
    try { child.kill("SIGTERM"); } catch { /* gone */ }
  }
}

// ---------------------------------------------------------------------------
// People and companies. One brand person and one factory person own every
// company of their side this process makes (signing in is rate limited);
// pauses are per company, so scenarios stay independent. Three staff: one
// with no company, one who belongs to a brand, one to a factory (two hats).
// ---------------------------------------------------------------------------
async function person(role, name) {
  const email = `pp-flow-${role}-${STAMP}@example.com`;
  must(await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, user_metadata: { name, full_name: name } }), `create ${role}`);
  const client = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: true } });
  for (let attempt = 1; ; attempt += 1) {
    const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
    if (!error) break;
    if (attempt >= 12 || !(error.status === 429 || /rate limit/i.test(error.message))) throw new Error(`sign in ${role}: ${error.message}`);
    await sleep(30_000);
  }
  const { data } = await client.auth.getUser();
  const token = async () => (await client.auth.getSession()).data.session.access_token;
  return { client, id: data.user.id, email, name, token };
}
let P = null; // the people
async function people() {
  if (P) return P;
  const brand = await person("brand", "PP Brand Owner");
  const factory = await person("factory", "PP Factory Owner");
  const staff = await person("staff", "PP Staff");
  const staffBrand = await person("staff-brand", "PP Staff Brand");
  const staffFactory = await person("staff-factory", "PP Staff Factory");
  for (const s of [staff, staffBrand, staffFactory]) {
    must(await admin.from("user_profiles").update({ full_name: s.name }).eq("id", s.id), "staff name");
    must(await admin.from("platform_admins").upsert({ user_id: s.id, note: `paused-flow check ${STAMP}` }), "staff");
  }
  P = { brand, factory, staff, staffBrand, staffFactory };
  return P;
}

const termCache = new Map();
async function termId(kind, slug) {
  const key = `${kind}/${slug}`;
  if (!termCache.has(key)) termCache.set(key, must(await admin.from("taxonomy_terms").select("id").eq("kind", kind).eq("slug", slug).single(), key).id);
  return termCache.get(key);
}

/** A brand and a factory of their own for one scenario run, both verified; the factory paid by PayPal. */
async function companies(label) {
  const { brand, factory } = await people();
  const brandOrg = must(await brand.client.rpc("create_org", { org_name: `PP ${label} Brand ${STAMP}`, org_kind: "brand" }), "brand org");
  must(await admin.from("brand_profiles").upsert({
    org_id: brandOrg.id, hq_location: "Portland, United States", onboarding_completed_at: new Date().toISOString(), verification_status: "verified",
  }), "brand profile");
  const factoryOrg = must(await factory.client.rpc("create_org", { org_name: `PP ${label} Factory ${STAMP}`, org_kind: "factory" }), "factory org");
  must(await admin.from("factory_profiles").upsert({
    org_id: factoryOrg.id, country_code: "VN", location: "Ho Chi Minh City, Vietnam", moq: 100, typical_lead_days: 30,
    intro: "Cut-and-sew test factory.", onboarding_completed_at: new Date().toISOString(),
    verification_status: "verified", trust_tier: "verified", published_at: new Date().toISOString(),
  }), "factory profile");
  must(await admin.from("credit_ledger").insert({ org_id: factoryOrg.id, delta: 500, reason: "onboarding_grant", note: "Profile verified" }), "credits");
  const account = must(await factory.client.from("factory_payout_accounts").insert({
    org_id: factoryOrg.id, method: "paypal", paypal_email: `pp-flow-payouts-${STAMP}@example.com`, bank_country: "VN", is_primary: true,
  }).select("*").single(), "payout account");
  return { brandOrg, factoryOrg, account, label };
}

/** A published request from the brand, quoted by the factory. Returns the quote. */
async function quotedRequest(c, title, { unitPrice = 2000, quantity = 100 } = {}) {
  const { brand, factory } = await people();
  const rfq = must(await brand.client.from("rfqs").insert({ brand_org_id: c.brandOrg.id, status: "draft", visibility: "open_to_all" }).select("id").single(), "draft").id;
  must(await brand.client.from("rfq_colour_splits").insert({ rfq_id: rfq, colour: "Ecru", quantity, sort: 0 }), "colours");
  must(await brand.client.from("taxonomy_links").insert({ subject_type: "rfq", subject_id: rfq, term_id: await termId("product_category", "tops"), org_id: c.brandOrg.id }), "tags");
  must(await brand.client.from("rfqs").update({
    title, brief: `${title}: test order.`, quantity_total: quantity, material_notes: "As per the tech pack", sample_notes: "Fit sample before bulk",
    additional_details: "", target_delivery_month: "2027-03-01", sourcing_responsibility_term_id: await termId("sourcing_responsibility", "mixed"),
    target_unit_price_min_cents: 1500, target_unit_price_max_cents: 3000, requires_sample: true,
    quote_deadline: new Date(Date.now() + 12 * 864e5).toISOString(), status: "open", published_at: new Date().toISOString(),
  }).eq("id", rfq), "publish request");
  const quote = must(await factory.client.from("quotes").insert({
    rfq_id: rfq, factory_org_id: c.factoryOrg.id, unit_price_cents: unitPrice, production_quantity: quantity, bulk_lead_time_days: 30,
    deposit_pct: 30, balance_pct: 70, payment_term_id: await termId("payment_term", "deposit-30-70"), incoterm_id: await termId("incoterm", "exw"),
    valid_until: new Date(Date.now() + 21 * 864e5).toISOString(), factory_notes: "Fit sample, then bulk.",
  }).select("id").single(), "quote");
  must(await factory.client.from("quote_sample_lines").insert({ quote_id: quote.id, stage: "Fit sample", cost_cents: 6500, timing_days: 10, sort: 0 }), "sample line");
  must(await factory.client.rpc("submit_quote", { quote_id: quote.id }), "submit quote");
  return { rfq, quote };
}

/** An order with its steps confirmed; its first step's payment is due. */
async function runningOrder(c, title, opts) {
  const { brand, factory } = await people();
  const { quote } = await quotedRequest(c, title, opts);
  must(await brand.client.rpc("award_quote", { quote_id: quote.id }), "award");
  let order = must(await admin.from("production_orders").select("*").eq("quote_id", quote.id).single(), "order");
  must(await brand.client.rpc("agree_schedule", { target_order: order.id, revision: order.schedule_revision }), "brand confirms steps");
  order = must(await admin.from("production_orders").select("*").eq("id", order.id).single(), "order");
  if (order.status === "pending_schedule") {
    must(await factory.client.rpc("agree_schedule", { target_order: order.id, revision: order.schedule_revision }), "factory agrees");
    order = must(await admin.from("production_orders").select("*").eq("id", order.id).single(), "order");
  }
  return order;
}
const duePayment = async (order) => must(await admin.from("order_payments").select("*")
  .eq("order_id", order.id).in("state", ["due", "failed"]).order("created_at").limit(1).single(), "the payment due");
const paymentRow = async (id) => must(await admin.from("order_payments").select("*").eq("id", id).single(), "payment");

// ---------------------------------------------------------------------------
// Paying, approving, and Stripe's decisions.
// ---------------------------------------------------------------------------
async function api(path, who, body) {
  const res = await fetch(`http://127.0.0.1:${devPort}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(who ? { authorization: `Bearer ${await who.token()}` } : {}) },
    body: JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* none */ }
  return { status: res.status, body: json };
}

/**
 * The brand pays a step as the Fund screen does: /api/stripe-checkout as the
 * brand, then the card confirms the PaymentIntent (here with a Stripe test
 * PaymentMethod). With `record: true` the relay holds Stripe's events and the
 * payment is recorded the way the webhook records it (record_payment_succeeded),
 * so the step can be approved before a dispute on it is heard.
 */
async function pay(payment, method, { record = false } = {}) {
  const { brand } = await people();
  const checkout = await api("/api/stripe-checkout", brand, { paymentId: payment.id });
  if (checkout.status !== 200) throw new Check(`checkout: ${checkout.status} ${JSON.stringify(checkout.body)}`);
  const intentId = checkout.body.clientSecret.split("_secret_")[0];
  relay.intents.add(intentId);
  if (record) hold(intentId);
  const intent = await stripe.paymentIntents.confirm(intentId, { payment_method: method });
  if (intent.status !== "succeeded") throw new Check(`payment ${method}: ${intent.status}`);
  if (record) {
    must(await admin.rpc("record_payment_succeeded", {
      target_payment: payment.id, payment_intent: intent.id, charge: intent.latest_charge,
      method_type: "card", method_label: "Visa ···0259", received: intent.amount_received,
    }), "record the payment");
  }
  await waitFor(async () => ["confirmed", "released"].includes((await paymentRow(payment.id)).state), `payment ${payment.id} funded`);
  return { intentId, charge: intent.latest_charge, charged: intent.amount_received };
}

/** The factory posts on the open step and the brand approves it. */
async function approveStep(order, who = null) {
  const { brand, factory } = await people();
  const stepRow = must(await admin.from("order_milestones").select("id, title")
    .eq("order_id", order.id).eq("state", "active").order("sort").limit(1).single(), "open step");
  must(await factory.client.rpc("post_milestone_update", { target_milestone: stepRow.id, body: "Fit sample sewn and measured.", document_ids: [] }), "factory update");
  const result = await (who ?? brand).client.rpc("approve_milestone", { target_milestone: stepRow.id, note: "Fit approved." });
  return { step: stepRow, result };
}

async function disputeOf(intentId) {
  return waitFor(async () => (await stripe.disputes.list({ payment_intent: intentId, limit: 5 })).data[0], "Stripe's dispute", { timeout: 60_000, every: 2000 });
}
/** The bank's decision in Stripe test mode: evidence that wins or loses. */
async function bankRules(intentId, forTsc) {
  const dispute = await disputeOf(intentId);
  await stripe.disputes.update(dispute.id, { evidence: { uncategorized_text: forTsc ? "winning_evidence" : "losing_evidence" }, submit: true });
  return dispute;
}
const reviewsOf = async (paymentId) => must(await admin.from("payment_reviews").select("*").eq("payment_id", paymentId).order("created_at"), "reviews");
async function reviewIn(paymentId, states, what) {
  const want = Array.isArray(states) ? states : [states];
  return waitFor(async () => (await reviewsOf(paymentId)).find((v) => want.includes(v.state)), what ?? `review in ${want.join("/")}`, { timeout: 180_000, every: 1500 });
}

// ---------------------------------------------------------------------------
// What each person sees: pauses, the board, the balance, notices and emails.
// ---------------------------------------------------------------------------
async function pauses(c) {
  const { brand, factory } = await people();
  const b = must(await brand.client.rpc("my_payment_pause", { target_org: c.brandOrg.id }), "the brand's my_payment_pause");
  const f = must(await factory.client.rpc("my_payment_pause", { target_org: c.factoryOrg.id }), "the factory's my_payment_pause");
  return { brand: b.brand_paused, factory: f.factory };
}
async function expectPaused(c, { brand, factory }, what) {
  const now = await pauses(c);
  expectEq(now.brand, brand, `${what}: brand paused (my_payment_pause)`);
  expectEq(Boolean(now.factory?.paused), factory, `${what}: factory paused (my_payment_pause)`);
  return now;
}
async function boardRow(reviewId) {
  const { staff } = await people();
  const row = must(await staff.client.rpc("payment_review_board"), "payment_review_board").find((r) => r.id === reviewId);
  if (!row) throw new Check(`the board has no row for review ${reviewId}`);
  return row;
}
function expectRow(row, want, what) {
  for (const [key, value] of Object.entries(want)) expectEq(row[key], value, `${what}: board ${key}`);
}
async function pausedBrandRow(orgId) {
  const { staff } = await people();
  return must(await staff.client.rpc("admin_paused_brands"), "admin_paused_brands").find((r) => r.org_id === orgId) ?? null;
}
async function balanceOf(c, what = "balance") {
  const { factory } = await people();
  const b = must(await factory.client.rpc("factory_balance", { target_org: c.factoryOrg.id }), "factory_balance");
  for (const key of ["available_cents", "pending_cents", "processing_cents", "awaiting_cents", "paid_out_cents", "total_cents", "refunded_cents"]) {
    if (Number(b[key]) < 0) throw new Check(`${what}: ${key} is negative (${b[key]})`);
  }
  // A refund row is drawn as a deduction (negative); every other row is money the factory has.
  for (const row of b.rows ?? []) if (row.figure !== "refunded" && Number(row.amount_cents) < 0) throw new Check(`${what}: a Transactions row is negative: ${JSON.stringify(row)}`);
  const sum = (figure) => (b.rows ?? []).filter((r) => r.figure === figure).reduce((s, r) => s + Number(r.amount_cents), 0);
  expectEq(sum("available"), Number(b.available_cents), `${what}: the Available rows add up to Available`);
  expectEq(sum("pending"), Number(b.pending_cents), `${what}: the Pending rows add up to Pending`);
  expectEq(Number(b.total_cents),
    Number(b.awaiting_cents) + Number(b.available_cents) + Number(b.pending_cents) + Number(b.processing_cents) + Number(b.paid_out_cents),
    `${what}: the balance's total is its parts`);
  return b;
}
async function noticesOf(orgId) {
  return must(await admin.from("notifications").select("id, org_id, kind, title, body, data, subject_type, subject_id, order_id, created_at")
    .eq("org_id", orgId).order("created_at"), "notices");
}
/** One notice with these words (EN; ZH as the app shows it), and its email queued. */
async function expectNotice(orgId, { title, body, startsWith = false, zhTitle, zhBody, count = 1 }, what) {
  const all = await noticesOf(orgId);
  const rows = all.filter((n) => n.title === title && (startsWith ? n.body.startsWith(body) : n.body === body));
  if (rows.length !== count) {
    const near = all.filter((n) => n.kind === "payment_disputed" || n.title === title || /refund/i.test(n.title)).map((n) => `${n.title} | ${n.body}`);
    throw new Check(`${what}: expected ${count} notice "${title}" / "${body}", got ${rows.length}; have ${JSON.stringify(near)}`);
  }
  for (const n of rows) {
    const out = must(await admin.from("notification_email_outbox").select("id, category").eq("notification_id", n.id), "outbox");
    if (!out.length) throw new Check(`${what}: no email queued for "${title}"`);
    if (zhTitle !== undefined) expectEq(notificationTitle(n, { timeZone: "UTC", locale: "zh" }), zhTitle, `${what}: ZH title`);
    if (zhBody !== undefined) expectEq(notificationBody(n, { timeZone: "UTC", locale: "zh" }), zhBody, `${what}: ZH body`);
  }
  return rows[0];
}
async function expectNoNotice(orgId, test, what) {
  const hit = (await noticesOf(orgId)).find(test);
  if (hit) throw new Check(`${what}: unexpected notice "${hit.title}" / "${hit.body}"`);
}
// A review's notices. Not the funding notice of a charge disputed in the same
// second ("Payment for "…" under review"): it replaces "Payment held".
const isReviewNotice = (n) => n.kind === "payment_disputed" && !/^Payment for ".*" under review$/.test(n.title);
async function tryWithdraw(c, amount) {
  const { factory } = await people();
  const { data, error } = await factory.client.rpc("request_withdrawal", { target_org: c.factoryOrg.id, amount, target_account: c.account.id });
  if (!error) must(await factory.client.rpc("cancel_withdrawal", { target_withdrawal: data.id ?? data }), "cancel the test withdrawal");
  return error;
}
/**
 * The step's title, the order number, and the order as notices name it
 * ("<request title> (TSC-000061)": the bell names an order by its request).
 */
async function stepInfo(order, payment) {
  const m = must(await admin.from("order_milestones").select("title").eq("id", payment.milestone_id).single(), "step");
  const o = must(await admin.from("production_orders").select("order_number, rfqs (title)").eq("id", order.id).single(), "order");
  const title = Array.isArray(o.rfqs) ? o.rfqs[0]?.title : o.rfqs?.title;
  return { step: m.title, num: o.order_number, label: title ? `${title} (${o.order_number})` : o.order_number };
}
const TEXT = {
  fPaused: (step, num) => ({
    title: "Withdrawals paused",
    body: `A brand requested a refund for "${step}" on ${num}, so our team is reviewing the payment. Withdrawals are paused until the review is done.`,
    zhTitle: "提现已暂停",
    zhBody: `品牌方就 ${num} 中的“${step}”申请了退款，我们的团队正在审核这笔付款。审核完成前，提现已暂停。`,
  }),
  bPaused: (step, num) => ({
    title: "Account under review",
    body: `A payment for "${step}" on ${num} was disputed with your bank. Until our review is done, you can only message vendors.`,
  }),
  fResumed: (step) => ({
    title: "Withdrawals resumed",
    body: `The review of the payment for "${step}" is done. You can withdraw your balance again.`,
    zhTitle: "提现已恢复",
    zhBody: `“${step}”的付款审核已完成。你可以再次提现余额。`,
  }),
  fStillPaused: (step) => ({
    title: "Payment review complete",
    body: `The review of the payment for "${step}" is done. Withdrawals stay paused while another payment is reviewed.`,
    zhTitle: "付款审核已完成",
    zhBody: `“${step}”的付款审核已完成。另一笔付款仍在审核中，提现继续暂停。`,
  }),
  fTaken: (amount, step, num, note) => ({
    title: "Payment review complete",
    body: `${money(amount)} for "${step}" on ${num} was returned to the brand. You can withdraw the rest of your balance. Note from our team: ${note}`,
    zhTitle: "付款审核已完成",
    zhBody: `${num} 中“${step}”的 ${money(amount)} 已退回品牌。你可以提现余额中的其余部分。我们团队的备注：${note}`,
  }),
  bUnpaused: () => ({ title: "Account review complete", body: "You can fund steps, approve steps and accept quotes again." }),
  bRefunded: (step, amount, note) => ({ title: `Your payment for "${step}" was refunded`, body: `${money(amount)} was refunded to your card. Note from our team: ${note}`, startsWith: true }),
  fRefunded: (amount, step, num, note) => ({
    title: `Refund for "${step}"`,
    body: `${money(amount)} for "${step}" on ${num} was returned to the brand from your balance. Note from our team: ${note}`,
    zhTitle: `“${step}”的退款`,
    zhBody: `${num} 中“${step}”的 ${money(amount)} 已从你的余额退回品牌。我们团队的备注：${note}`,
  }),
  bRefundFailed: (step, amount) => ({ title: `Refund for "${step}" didn't go through`, body: `Your ${money(amount)} refund didn't go through. That amount stays on this order.` }),
  fRefundFailed: (step, num, amount) => ({ title: `Refund for "${step}" didn't go through`, body: `The refund to the brand didn't go through. Your earnings from ${num} went back up by ${money(amount)}.` }),
};
async function unpause(c) {
  const { staff } = await people();
  return must(await staff.client.rpc("unpause_brand_org", { target_org: c.brandOrg.id }), "staff unpause the brand");
}
async function resolve(reviewId, fault, cents, note, who = null) {
  const { staff } = await people();
  return (who ?? staff).client.rpc("decide_payment_review", { target_review: reviewId, decision: fault, amount_cents: cents, note });
}
const nextDue = async (order) => (await admin.from("order_payments").select("*").eq("order_id", order.id).in("state", ["due", "failed"]).order("created_at").limit(1)).data?.[0] ?? null;
async function checkoutStatus(payment) {
  const { brand } = await people();
  const r = await api("/api/stripe-checkout", brand, { paymentId: payment.id });
  // An intent the page would have opened: cancelled again, so nothing is left open.
  if (r.status === 200) {
    const id = r.body.clientSecret.split("_secret_")[0];
    relay.intents.add(id);
  }
  return r;
}

// ---------------------------------------------------------------------------
// A chargeback on an APPROVED step (scenarios 1-4): order A's fit sample paid
// with Stripe's dispute card and approved before the dispute is heard; order
// B's fit sample paid with a card whose money is available at once, so the
// factory has a balance it could withdraw.
// ---------------------------------------------------------------------------
async function disputedApprovedStep(label) {
  step("companies and two orders");
  const c = await companies(label);
  const B = await runningOrder(c, `${label} cleared tee`);
  const A = await runningOrder(c, `${label} disputed tee`);
  step("order B paid and approved; its money available");
  const pB = await duePayment(B);
  await pay(pB, "pm_card_bypassPending");
  must((await approveStep(B)).result, "approve B");
  await waitFor(async () => Number((await balanceOf(c)).available_cents) >= 6500, "B's money available", { timeout: 60_000 });
  step("order A paid with the dispute card and approved before the dispute is heard");
  const pA = await duePayment(A);
  const paidA = await pay(pA, "pm_card_createDispute", { record: true });
  must((await approveStep(A)).result, "approve A");
  const before = await balanceOf(c, "balance before the dispute");
  expectEq(Number(before.total_cents), 13000, "balance before the dispute: both steps");
  step("the dispute is heard");
  await release(paidA.intentId);
  const v = await reviewIn(pA.id, "open", "the dispute's review (open)");
  expectEq(v.pauses_factory, true, "review pauses the factory");
  const info = await stepInfo(A, pA);
  step("the brand and the factory are paused and told");
  const now = await expectPaused(c, { brand: true, factory: true }, "dispute open");
  expectEq([now.factory.step_title, now.factory.order_number, now.factory.count], [info.step, info.num, 1], "the factory's card line");
  const { factory, brand } = await people();
  expectEq(must(await factory.client.rpc("order_pause", { target_order: A.id }), "order_pause").on_hold, true, "the factory's order page: on hold");
  await expectNotice(c.factoryOrg.id, TEXT.fPaused(info.step, info.label), "factory told");
  await expectNotice(c.brandOrg.id, TEXT.bPaused(info.step, info.label), "brand told");
  step("staff board: at the bank");
  const row = await boardRow(v.id);
  expectRow(row, { step: 1, reason: "card_dispute", actions: [], open: Boolean(row.respond_by), factory_paused: true, brand_paused: true }, "dispute open");
  expectEq(row.step_line, row.respond_by ? "Respond in Stripe by" : "Waiting for the bank's ruling", "board step_line");
  expectTrue(row.respond_by, "Stripe gave a respond-by date", row.respond_by);
  step("refusals while the bank decides");
  await refused(factory.client.rpc("request_withdrawal", { target_org: c.factoryOrg.id, amount: 1000, target_account: c.account.id }), "payment_under_review", "the factory withdraws while paused");
  await refused(resolve(v.id, "factory_at_fault", 0, "too early"), "review_not_ready", "staff resolve before the bank rules");
  const pBDue = await nextDue(A);
  const blocked = await checkoutStatus(pBDue);
  expectTrue(blocked.status !== 200 && /under review/.test(blocked.body?.error ?? ""), "the paused brand's Fund is refused in words", blocked);
  const during = await balanceOf(c, "balance during the dispute");
  expectEq(Number(during.total_cents), Number(before.total_cents), "the balance is unchanged by the pause");
  const pausedRow = await pausedBrandRow(c.brandOrg.id);
  expectEq([pausedRow?.reason, pausedRow?.order_number], ["Bank ruling pending", info.num], "Users: paused brand while the bank decides");
  void brand;
  return { c, A, B, pA, paidA, before, v, info };
}

// ---------------------------------------------------------------------------
// The scenarios.
// ---------------------------------------------------------------------------
const SCENARIOS = {
  1: ["Approved step disputed; bank rules for TSC", async (run) => {
    const { c, A, paidA, pA, before, v, info } = await disputedApprovedStep(`S1R${run}`);
    step("the bank rules for TSC");
    await bankRules(paidA.intentId, true);
    await reviewIn(pA.id, "resumed", "review resumed by itself");
    const row = await boardRow(v.id);
    expectRow(row, { step: 3, step_line: "Bank ruled for TSC", actions: [], open: false, factory_paused: false, brand_paused: true }, "won");
    await expectNotice(c.factoryOrg.id, TEXT.fResumed(info.step), "factory told it can withdraw");
    await expectPaused(c, { brand: true, factory: false }, "after the win");
    expectEq(await tryWithdraw(c, 1000), null, "the factory withdraws again with no staff action");
    expectEq(Number((await balanceOf(c, "balance after the win")).total_cents), Number(before.total_cents), "balance after the win");
    expectEq((await pausedBrandRow(c.brandOrg.id))?.reason, "Bank ruled for TSC", "Users: the brand stays paused");
    step("staff unpause the brand on Users");
    expectEq((await unpause(c)).lifted, 1, "unpause lifts one pause");
    await expectNotice(c.brandOrg.id, TEXT.bUnpaused(), "brand told it can use its account");
    await expectPaused(c, { brand: false, factory: false }, "after unpause");
    expectEq(await pausedBrandRow(c.brandOrg.id), null, "Users: no longer paused");
    const fund = await checkoutStatus(await nextDue(A));
    expectEq(fund.status, 200, "the brand funds again");
    await expectNoNotice(c.brandOrg.id, (n) => /pay again/i.test(n.body), "brand never told to pay again");
  }],

  2: ["Bank rules for the brand; Factory at fault, partial amount", async (run) => {
    const { c, pA, paidA, before, v, info } = await disputedApprovedStep(`S2R${run}`);
    step("the bank rules for the brand");
    await bankRules(paidA.intentId, false);
    await reviewIn(pA.id, "decide", "review waits for staff");
    let row = await boardRow(v.id);
    expectRow(row, { step: 2, step_line: "Bank ruled for the brand", actions: ["decide"], open: true, factory_paused: true, brand_paused: true }, "lost");
    expectEq(row.factory_max_cents, 6500, "Resolve: up to the step's amount from the factory");
    await expectPaused(c, { brand: true, factory: true }, "lost, before Resolve");
    step("Resolve refusals");
    await refused(resolve(v.id, "factory_at_fault", 2000, " "), "review_note", "no note");
    const over = await refused(resolve(v.id, "factory_at_fault", 6501, "x"), "review_over_cap", "over the cap");
    expectEq(over.details, "$65.00", "the cap in the refusal");
    await refused(resolve(v.id, "someone", 0, "x"), "review_decision", "no fault chosen");
    step("Resolve: the factory, $20.00");
    const note = "The sample did not match the approved spec.";
    must(await resolve(v.id, "factory_at_fault", 2000, note), "resolve factory at fault");
    row = await boardRow(v.id);
    expectRow(row, { step: 3, state: "factory_at_fault", returned_cents: 2000, step_line: "Factory at fault · $20.00 from its balance · PP Staff", brand_paused: false }, "resolved");
    await expectNotice(c.factoryOrg.id, TEXT.fTaken(2000, info.step, info.label, note), "factory told what was taken");
    await expectNotice(c.brandOrg.id, TEXT.bUnpaused(), "brand unpaused and told");
    await expectPaused(c, { brand: false, factory: false }, "after Resolve");
    const after = await balanceOf(c, "balance after Resolve");
    expectEq(Number(after.total_cents), Number(before.total_cents) - 2000, "the factory's balance less $20.00 (TSC absorbed the rest)");
    expectEq(await tryWithdraw(c, 1000), null, "the factory withdraws the rest");
    await refused(resolve(v.id, "no_fault", null, "again"), "review_decided", "deciding twice");
  }],

  3: ["Bank rules for the brand; Brand at fault", async (run) => {
    const { c, pA, paidA, before, v, info } = await disputedApprovedStep(`S3R${run}`);
    await bankRules(paidA.intentId, false);
    const lost = await reviewIn(pA.id, "decide", "review waits for staff");
    step("Resolve: the brand");
    must(await resolve(v.id, "brand_at_fault", null, "Chargeback filed after receiving the goods."), "resolve brand at fault");
    const row = await boardRow(v.id);
    expectRow(row, { step: 3, state: "brand_at_fault", returned_cents: 0, step_line: `Brand at fault · TSC absorbed ${money(lost.amount_cents)} · PP Staff`, brand_paused: true }, "resolved");
    await expectNotice(c.factoryOrg.id, TEXT.fResumed(info.step), "factory resumed, nothing taken");
    await expectPaused(c, { brand: true, factory: false }, "brand at fault");
    expectEq(Number((await balanceOf(c, "balance after Resolve")).total_cents), Number(before.total_cents), "nothing taken from the factory");
    const paused = await pausedBrandRow(c.brandOrg.id);
    expectEq([paused?.reason, paused?.order_number], ["Brand at fault", info.num], "Users: Brand at fault");
    await expectNoNotice(c.brandOrg.id, (n) => n.title === "Account review complete", "brand not told it is unpaused");
    expectEq(await tryWithdraw(c, 1000), null, "the factory withdraws");
    step("staff Unpause");
    expectEq((await unpause(c)).lifted, 1, "unpause");
    await expectNotice(c.brandOrg.id, TEXT.bUnpaused(), "brand told after Unpause");
    await expectPaused(c, { brand: false, factory: false }, "after Unpause");
  }],

  4: ["Bank rules for the brand; No one at fault", async (run) => {
    const { c, pA, paidA, before, v, info } = await disputedApprovedStep(`S4R${run}`);
    await bankRules(paidA.intentId, false);
    const lost = await reviewIn(pA.id, "decide", "review waits for staff");
    must(await resolve(v.id, "no_fault", null, "Stolen card, confirmed by the bank."), "resolve no fault");
    const row = await boardRow(v.id);
    expectRow(row, { step: 3, state: "no_fault", step_line: `No fault · TSC absorbed ${money(lost.amount_cents)} · PP Staff`, brand_paused: false }, "resolved");
    await expectNotice(c.factoryOrg.id, TEXT.fResumed(info.step), "factory resumed");
    await expectNotice(c.brandOrg.id, TEXT.bUnpaused(), "brand unpaused");
    await expectPaused(c, { brand: false, factory: false }, "no fault");
    expectEq(Number((await balanceOf(c, "balance after Resolve")).total_cents), Number(before.total_cents), "nothing taken from the factory");
    expectEq(await pausedBrandRow(c.brandOrg.id), null, "Users: not paused");
  }],

  5: ["Dispute on a step not approved; bank rules for the brand", async (run) => {
    const c = await companies(`S5R${run}`);
    const A = await runningOrder(c, `S5R${run} tee`);
    const pA = await duePayment(A);
    step("paid with the dispute card, not approved");
    const paid = await pay(pA, "pm_card_createDispute");
    const v = await reviewIn(pA.id, "open", "the dispute's review");
    const info = await stepInfo(A, pA);
    expectEq(v.pauses_factory, false, "a step not approved never pauses the factory");
    await expectPaused(c, { brand: true, factory: false }, "dispute open");
    await expectNotice(c.brandOrg.id, TEXT.bPaused(info.step, info.label), "brand told");
    await expectNoNotice(c.factoryOrg.id, isReviewNotice, "factory not told (never its money)");
    step("the bank rules for the brand");
    await bankRules(paid.intentId, false);
    await reviewIn(pA.id, "closed", "closed by itself");
    const row = await boardRow(v.id);
    expectRow(row, { step: 3, step_line: "Bank ruled for the brand · step not approved", actions: [], open: false, brand_paused: true, factory_paused: false }, "lost");
    await expectPaused(c, { brand: true, factory: false }, "after the loss");
    const paused = await pausedBrandRow(c.brandOrg.id);
    expectEq([paused?.reason, paused?.order_number], ["Bank ruled for the brand", info.num], "Users: paused brand");
    await expectNoNotice(c.brandOrg.id, (n) => /pay again/i.test(n.body), "brand not asked to pay again");
    await expectNoNotice(c.factoryOrg.id, (n) => isReviewNotice(n) || /pay again/i.test(n.body), "factory: no review notice, no 'pay again'");
    expectEq((await balanceOf(c)).total_cents, 0, "factory untouched");
    const due = await waitFor(() => nextDue(A), "the step due again");
    expectTrue((await checkoutStatus(due)).status !== 200, "Fund refused while paused");
    step("staff Unpause; the brand funds again");
    must(await unpause(c), "unpause");
    await expectNotice(c.brandOrg.id, TEXT.bUnpaused(), "brand told");
    expectEq((await checkoutStatus(due)).status, 200, "the brand funds again");
  }],

  6: ["Inquiry", async (run) => {
    const c = await companies(`S6R${run}`);
    const A = await runningOrder(c, `S6R${run} tee`);
    const pA = await duePayment(A);
    step("paid with the inquiry card, approved");
    const paid = await pay(pA, "pm_card_createDisputeInquiry", { record: true });
    must((await approveStep(A)).result, "approve");
    await release(paid.intentId);
    const v = await reviewIn(pA.id, "inquiry", "the inquiry's review");
    let row = await boardRow(v.id);
    expectRow(row, { step: 1, reason: "inquiry", actions: [], open: Boolean(row.respond_by), brand_paused: false, factory_paused: false }, "inquiry");
    expectEq(row.step_line, row.respond_by ? "Respond in Stripe by" : "Waiting for the bank's ruling", "board step_line");
    await expectPaused(c, { brand: false, factory: false }, "inquiry");
    await expectNoNotice(c.brandOrg.id, isReviewNotice, "brand not told");
    await expectNoNotice(c.factoryOrg.id, isReviewNotice, "factory not told");
    expectEq(await pausedBrandRow(c.brandOrg.id), null, "Users: not paused");
    step("the inquiry closes");
    await bankRules(paid.intentId, true);
    await reviewIn(pA.id, "inquiry_closed", "inquiry closed");
    row = await boardRow(v.id);
    expectRow(row, { step: 3, step_line: "Inquiry closed", open: false }, "closed");
    await expectPaused(c, { brand: false, factory: false }, "closed");
    await expectNoNotice(c.brandOrg.id, isReviewNotice, "brand not told");
    await expectNoNotice(c.factoryOrg.id, isReviewNotice, "factory not told");
  }],

  7: ["Refund made in Stripe's dashboard after approval", async (run) => {
    const c = await companies(`S7R${run}`);
    const A = await runningOrder(c, `S7R${run} tee A`);
    const B = await runningOrder(c, `S7R${run} tee B`);
    const pA = await duePayment(A);
    const pB = await duePayment(B);
    const paidA = await pay(pA, "pm_card_visa");
    const paidB = await pay(pB, "pm_card_visa");
    must((await approveStep(A)).result, "approve A");
    must((await approveStep(B)).result, "approve B");
    const before = await balanceOf(c, "balance before");
    step("refund $30.00 of A in Stripe");
    await stripe.refunds.create({ payment_intent: paidA.intentId, amount: 3000 });
    const v = await reviewIn(pA.id, "decide", "a refund review");
    const info = await stepInfo(A, pA);
    expectEq([v.cause, v.amount_cents, v.pauses_factory], ["refund", 3000, true], "the refund review");
    await expectPaused(c, { brand: false, factory: true }, "refunded in Stripe");
    await expectNotice(c.factoryOrg.id, TEXT.fPaused(info.step, info.label), "factory told");
    await expectNoNotice(c.brandOrg.id, isReviewNotice, "brand not paused or told");
    let row = await boardRow(v.id);
    expectRow(row, { step: 2, reason: "refunded_in_stripe", step_line: "Refunded in Stripe", actions: ["decide"], open: true, brand_paused: false }, "refund row");
    await refused(resolve(v.id, "brand_at_fault", null, "x"), "review_no_brand", "Brand at fault on a refund");
    step("Resolve A: the factory, $15.00");
    const note = "Agreed partial refund for a short shipment.";
    must(await resolve(v.id, "factory_at_fault", 1500, note), "resolve A");
    await expectNotice(c.factoryOrg.id, TEXT.fTaken(1500, info.step, info.label, note), "factory told what was taken");
    await expectPaused(c, { brand: false, factory: false }, "after Resolve A");
    const mid = await balanceOf(c, "balance after A");
    expectEq(Number(mid.total_cents), Number(before.total_cents) - 1500, "A: the factory's balance less $15.00");
    step("refund all of B in Stripe; Resolve: not the factory");
    await stripe.refunds.create({ payment_intent: paidB.intentId });
    const w = await reviewIn(pB.id, "decide", "B's refund review");
    expectEq(w.amount_cents, paidB.charged, "B's review amount is the whole charge");
    must(await resolve(w.id, "no_fault", null, "Refunded by mistake in Stripe."), "resolve B");
    row = await boardRow(w.id);
    expectRow(row, { step: 3, state: "no_fault", step_line: `No fault · TSC absorbed ${money(paidB.charged)} · PP Staff` }, "B resolved");
    await expectPaused(c, { brand: false, factory: false }, "after Resolve B");
    expectEq(Number((await balanceOf(c, "balance after B")).total_cents), Number(mid.total_cents), "B: nothing taken from the factory");
    await expectNoNotice(c.brandOrg.id, isReviewNotice, "brand never told of a review");
  }],

  8: ["In-app refund of a held step and of an approved step", async (run) => {
    const c = await companies(`S8R${run}`);
    const { staff } = await people();
    const A = await runningOrder(c, `S8R${run} approved tee`);
    const H = await runningOrder(c, `S8R${run} held tee`);
    const pA = await duePayment(A);
    const pH = await duePayment(H);
    const paidA = await pay(pA, "pm_card_visa");
    const paidH = await pay(pH, "pm_card_visa");
    must((await approveStep(A)).result, "approve A");
    const before = await balanceOf(c, "balance before");
    const infoA = await stepInfo(A, pA);
    step("held step: Refund…, no payer");
    const prevH = must(await staff.client.rpc("staff_refund_preview", { target_payment: pH.id }), "preview H");
    expectEq([prevH.approved_step, prevH.refundable_cents, prevH.refund_refusal], [false, paidH.charged, null], "preview of the held step");
    let r = await api("/api/stripe-refund", staff, { paymentId: pH.id, amountCents: paidH.charged, payer: "factory", note: "x" });
    expectEq([r.status, r.body?.hint], [409, "staff_refund_payer_not_approved"], "payer on a held step");
    const noteH = "The sample was cancelled by agreement.";
    r = await api("/api/stripe-refund", staff, { paymentId: pH.id, amountCents: paidH.charged, payer: null, note: noteH });
    expectEq([r.status, r.body?.status, r.body?.factoryCents, r.body?.tscCents], [200, "refunded", 0, paidH.charged], "held step refunded, TSC pays");
    step("approved step: refusals");
    const prevA = must(await staff.client.rpc("staff_refund_preview", { target_payment: pA.id }), "preview A");
    expectEq([prevA.approved_step, prevA.refundable_cents], [true, paidA.charged], "preview of the approved step");
    r = await api("/api/stripe-refund", staff, { paymentId: pA.id, amountCents: 3000, payer: null, note: "x" });
    expectEq([r.status, r.body?.hint], [409, "staff_refund_payer"], "no payer on an approved step");
    r = await api("/api/stripe-refund", staff, { paymentId: pA.id, amountCents: paidA.charged + 1, payer: "tsc", note: "x" });
    expectEq([r.status, r.body?.hint, r.body?.error], [409, "staff_refund_over", `You can refund up to ${money(paidA.charged)}.`], "over the charge");
    r = await api("/api/stripe-refund", staff, { paymentId: pA.id, amountCents: 3000, payer: "tsc", note: "" });
    expectEq([r.status, r.body?.hint], [409, "staff_refund_note"], "no reason");
    step("approved step: $30.00, the factory's balance $10.00");
    const noteA = "Short shipment of two units.";
    r = await api("/api/stripe-refund", staff, { paymentId: pA.id, amountCents: 3000, payer: "factory", note: noteA, factoryCents: 1000 });
    expectEq([r.status, r.body?.status, r.body?.factoryCents, r.body?.tscCents], [200, "refunded", 1000, 2000], "refund with the factory paying part");
    step("approved step: $10.00 more, TSC pays");
    const noteA2 = "Goodwill for the late sample.";
    r = await api("/api/stripe-refund", staff, { paymentId: pA.id, amountCents: 1000, payer: "tsc", note: noteA2 });
    expectEq([r.status, r.body?.factoryCents, r.body?.tscCents], [200, 0, 1000], "refund TSC pays");
    step("webhooks for the refunds change nothing");
    await waitFor(() => relay.log.filter((e) => [paidA.intentId, paidH.intentId].includes(e.intent) && e.type === "charge.refunded" && e.status === 200).length >= 3, "the refunds' webhooks", { timeout: 60_000 });
    expectEq((await reviewsOf(pA.id)).length + (await reviewsOf(pH.id)).length, 0, "no review opened");
    await expectPaused(c, { brand: false, factory: false }, "after in-app refunds");
    const refundsA = (await stripe.refunds.list({ payment_intent: paidA.intentId })).data;
    expectEq(refundsA.reduce((s, x) => s + x.amount, 0), 4000, "Stripe refunded $40.00 of A");
    expectEq((await stripe.refunds.list({ payment_intent: paidH.intentId })).data.reduce((s, x) => s + x.amount, 0), paidH.charged, "Stripe refunded all of H");
    const rows = must(await admin.from("staff_refunds").select("status, amount_cents, factory_cents").in("payment_id", [pA.id, pH.id]).order("created_at"), "staff_refunds");
    expectEq(rows.map((x) => [x.status, Number(x.amount_cents), Number(x.factory_cents)]), [["made", paidH.charged, 0], ["made", 3000, 1000], ["made", 1000, 0]], "staff_refunds rows");
    expectEq(Number((await paymentRow(pA.id)).refunded_cents), 4000, "A's refunded figure");
    // The held step was awaiting approval (in the total) and is gone; the approved one lost $10.00.
    expectEq(Number(before.awaiting_cents), 6500, "the held step awaits approval");
    expectEq(Number((await balanceOf(c, "balance after")).total_cents), Number(before.total_cents) - 6500 - 1000, "the factory's balance less exactly $10.00 and the refunded held step");
    step("notices");
    await expectNotice(c.brandOrg.id, TEXT.bRefunded(infoA.step, 3000, noteA), "brand told of $30.00");
    await expectNotice(c.brandOrg.id, TEXT.bRefunded(infoA.step, 1000, noteA2), "brand told of $10.00");
    await expectNotice(c.brandOrg.id, TEXT.bRefunded(infoA.step, paidH.charged, noteH), "brand told of the held refund");
    await expectNotice(c.factoryOrg.id, TEXT.fRefunded(1000, infoA.step, infoA.label, noteA), "factory told only of what its balance paid");
    const factoryRefundNotices = (await noticesOf(c.factoryOrg.id)).filter((n) => n.title === `Refund for "${infoA.step}"`);
    expectEq(factoryRefundNotices.length, 1, "factory not told of refunds TSC paid");
  }],

  9: ["In-app refund fails later; Stripe unreachable, then Check again", async (run) => {
    const c = await companies(`S9R${run}`);
    const { staff } = await people();
    const A = await runningOrder(c, `S9R${run} failing tee`);
    const pA = await duePayment(A);
    const paidA = await pay(pA, "pm_card_refundFail");
    must((await approveStep(A)).result, "approve");
    const before = await balanceOf(c, "balance before");
    const info = await stepInfo(A, pA);
    step("refund $30.00, the factory's balance pays its share");
    const r = await api("/api/stripe-refund", staff, { paymentId: pA.id, amountCents: 3000, payer: "factory", note: "Two units short." });
    expectEq([r.status, r.body?.status], [200, "refunded"], "refund accepted at first");
    const share = r.body.factoryCents;
    expectEq(share, Math.round(3000 * 6500 / paidA.charged), "the factory's share of $30.00");
    expectEq(Number((await balanceOf(c, "balance after the refund")).total_cents), Number(before.total_cents) - share, "share taken from the balance");
    step("Stripe fails the refund later");
    const failed = await waitFor(async () => (await admin.from("staff_refunds").select("*").eq("payment_id", pA.id).eq("status", "failed")).data?.[0], "the refund failing", { timeout: 420_000, every: 3000 });
    expectEq(Number(failed.amount_cents), 3000, "the failed refund");
    expectEq(Number((await balanceOf(c, "balance after the failure")).total_cents), Number(before.total_cents), "the share given back exactly");
    const p = await paymentRow(pA.id);
    expectEq([p.state, Number(p.refunded_cents)], ["confirmed", 0], "the step funded again, nothing refunded");
    await expectNotice(c.brandOrg.id, TEXT.bRefundFailed(info.step, 3000), "brand told it didn't go through");
    const fn = await expectNotice(c.factoryOrg.id, TEXT.fRefundFailed(info.step, info.label, share), "factory told its share is back");
    expectTrue(notificationTitle(fn, { timeZone: "UTC", locale: "zh" }) !== fn.title, "factory's failure notice has Chinese", notificationTitle(fn, { timeZone: "UTC", locale: "zh" }));
    expectEq((await stripe.refunds.list({ payment_intent: paidA.intentId })).data.length, 1, "Stripe made one refund only");
    step("Stripe unreachable: the claim is left; Check again finishes it once");
    const B = await runningOrder(c, `S9R${run} unreachable tee`);
    const pB = await duePayment(B);
    const paidB = await pay(pB, "pm_card_visa");
    const claim = must(await staff.client.rpc("claim_staff_refund", { target_payment: pB.id, amount_cents: 2000, payer: null, note: "Price adjustment.", factory_cents: null }), "claim");
    const preview = must(await staff.client.rpc("staff_refund_preview", { target_payment: pB.id }), "preview");
    expectEq(preview.pending_refund_id, claim.staff_refund_id, "the dialog shows Checking with Stripe");
    let again = await api("/api/stripe-refund", staff, { staffRefundId: claim.staff_refund_id });
    expectEq([again.status, again.body?.status], [200, "refunded"], "Check again finishes it");
    again = await api("/api/stripe-refund", staff, { staffRefundId: claim.staff_refund_id });
    expectEq(again.status, 200, "Check again a second time");
    const listB = (await stripe.refunds.list({ payment_intent: paidB.intentId })).data;
    expectEq(listB.map((x) => x.amount), [2000], "Stripe refunded once");
    step("Stripe refunded but the answer was lost: Check again finds it");
    const C = await runningOrder(c, `S9R${run} lost answer tee`);
    const pC = await duePayment(C);
    const paidC = await pay(pC, "pm_card_visa");
    const claimC = must(await staff.client.rpc("claim_staff_refund", { target_payment: pC.id, amount_cents: 2000, payer: null, note: "Price adjustment.", factory_cents: null }), "claim C");
    await stripe.refunds.create({
      payment_intent: paidC.intentId, amount: 2000, reason: "requested_by_customer",
      metadata: { payment_id: pC.id, order_id: C.id, staff_refund_id: claimC.staff_refund_id, tsc_problem: "staff_refund" },
    }, { idempotencyKey: claimC.key });
    again = await api("/api/stripe-refund", staff, { staffRefundId: claimC.staff_refund_id });
    expectEq([again.status, again.body?.status], [200, "refunded"], "Check again records Stripe's refund");
    expectEq((await stripe.refunds.list({ payment_intent: paidC.intentId })).data.map((x) => x.amount), [2000], "still one refund in Stripe");
    await waitFor(() => relay.log.some((e) => e.intent === paidC.intentId && e.type === "charge.refunded" && e.status === 200), "C's refund webhook", { timeout: 60_000 });
    expectEq(Number((await paymentRow(pC.id)).refunded_cents), 2000, "C refunded once in the database");
    expectEq((await reviewsOf(pC.id)).length, 0, "no review for staff's own refund");
  }],

  10: ["Paused brand: every blocked action, and what still works", async (run) => {
    const c = await companies(`S10R${run}`);
    const { brand, factory } = await people();
    const A = await runningOrder(c, `S10R${run} disputed tee`);
    const B = await runningOrder(c, `S10R${run} second tee`);
    const { quote } = await quotedRequest(c, `S10R${run} quoted tee`);
    const draft = must(await brand.client.from("rfqs").insert({ brand_org_id: c.brandOrg.id, status: "draft", visibility: "open_to_all", title: `S10R${run} draft` }).select("id").single(), "draft request");
    const pA = await duePayment(A);
    const pB = await duePayment(B);
    step("the brand disputes a payment");
    await pay(pA, "pm_card_createDispute");
    await reviewIn(pA.id, "open", "the dispute's review");
    await expectPaused(c, { brand: true, factory: false }, "brand paused");
    step("each blocked action, at the button and in the database");
    const fund = await checkoutStatus(pB);
    expectTrue(fund.status !== 200 && fund.body?.error === "You can't fund steps while your account is under review.", "Fund refused in words", fund);
    const e1 = await refused(brand.client.rpc("begin_payment_checkout", { target_payment: pB.id }), "brand_under_review", "fund, called directly");
    expectEq(e1.message, "You can't fund steps while your account is under review.", "fund refusal words");
    await refused(brand.client.rpc("mark_payment_sent", { target_payment: pB.id, reference: "WIRE-1", note: null }), "brand_under_review", "mark payment sent");
    const ap = await approveStep(A);
    expectEq([ap.result.error?.hint, ap.result.error?.message], ["brand_under_review", "You can't approve steps while your account is under review."], "approve refused");
    const e3 = await refused(brand.client.rpc("award_quote_with_incoterm", { target_quote: quote.id, agreed_incoterm: await termId("incoterm", "exw") }), "brand_under_review", "accept a quote");
    expectEq(e3.message, "You can't accept quotes while your account is under review.", "accept quote words");
    const e4 = await refused(brand.client.from("rfqs").update({ status: "open", published_at: new Date().toISOString() }).eq("id", draft.id), "brand_under_review", "post a request");
    expectEq(e4.message, "You can't post requests while your account is under review.", "post request words");
    const e5 = await refused(brand.client.rpc("propose_cancellation", { target_order: B.id, reason: "Changed plans." }), "brand_under_review", "propose cancelling");
    expectEq(e5.message, "You can't cancel orders while your account is under review.", "cancel words");
    step("the factory proposes cancelling; the paused brand accepts");
    expectEq(must(await factory.client.rpc("order_pause", { target_order: B.id }), "order_pause").on_hold, true, "factory's order line: on hold");
    must(await factory.client.rpc("propose_cancellation", { target_order: B.id, reason: "We cannot source the yarn." }), "factory proposes");
    must(await brand.client.rpc("accept_cancellation", { target_order: B.id }), "paused brand accepts");
    expectEq(must(await admin.from("production_orders").select("status").eq("id", B.id).single(), "B").status, "cancelled", "order B cancelled");
    step("messages and calls still work");
    const thread = must(await brand.client.rpc("open_order_thread", { target_order: A.id }), "thread");
    const threadId = thread?.id ?? thread;
    const msg = must(await brand.client.from("messages").insert({ thread_id: threadId, sender_org_id: c.brandOrg.id, sender_user_id: brand.id, body: "Can we talk about the sample?", client_id: randomUUID() }).select("id").single(), "message");
    const screened = await api("/api/screen-message", brand, { messageId: msg.id });
    expectEq(screened.status, 200, "message screened");
    const words = ["Sample review", "The fit sample."];
    expectEq((await api("/api/screen-call-text", brand, { texts: words })).status, 200, "call words checked");
    must(await brand.client.rpc("propose_call", { target_thread: threadId, starts_at: new Date(Date.now() + 2 * 864e5).toISOString(), duration_minutes: 30, title: words[0], agenda: words[1], time_zone: "UTC" }), "propose a call");
  }],

  11: ["Paused factory: every withdrawal road; hand payouts", async (run) => {
    const { factory, staff } = await people();
    step("a PayPal factory with money available and a waiting withdrawal");
    const c = await companies(`S11R${run}`);
    const X = await runningOrder(c, `S11R${run} cleared tee`);
    const pX = await duePayment(X);
    await pay(pX, "pm_card_bypassPending");
    must((await approveStep(X)).result, "approve X");
    await waitFor(async () => Number((await balanceOf(c)).available_cents) >= 6500, "money available", { timeout: 60_000 });
    const waiting = must(await factory.client.rpc("request_withdrawal", { target_org: c.factoryOrg.id, amount: 3000, target_account: c.account.id }), "a withdrawal before the pause");
    const waitingId = waiting.id ?? waiting;
    const Y = await runningOrder(c, `S11R${run} disputed tee`);
    const pY = await duePayment(Y);
    const paidY = await pay(pY, "pm_card_createDispute", { record: true });
    must((await approveStep(Y)).result, "approve Y");
    await release(paidY.intentId);
    await reviewIn(pY.id, "open", "the dispute's review");
    await expectPaused(c, { brand: true, factory: true }, "factory paused");
    step("every road refused");
    await refused(factory.client.rpc("request_withdrawal", { target_org: c.factoryOrg.id, amount: 1000, target_account: c.account.id }), "payment_under_review", "PayPal / Wise / bank withdrawal");
    const { withdrawWithFee, UNDER_REVIEW } = await import("../api/_stripe-withdrawals.js");
    let words = null;
    try {
      await withdrawWithFee({ stripe, db: admin, orgId: c.factoryOrg.id, accountId: "acct_pp_none", amount: 1000, currency: "usd", requestId: randomUUID(), oneBalance: true, payoutCurrency: "usd" });
    } catch (failure) { words = failure.message; }
    expectEq(words, UNDER_REVIEW, "a Stripe withdrawal refused in words");
    await refused(admin.from("stripe_withdrawals").insert({ org_id: c.factoryOrg.id, stripe_account_id: "acct_pp_none", request_key: `pp-${randomUUID()}`, amount_minor: 1000, currency: "USD", state: "claimed" }), "payment_under_review", "a Stripe withdrawal claim in the database");
    await refused(staff.client.rpc("claim_withdrawal", { target_withdrawal: waitingId }), "payment_under_review", "staff pay the waiting withdrawal");
    const approve = await api("/api/withdrawal", staff, { action: "approve", withdrawalId: waitingId });
    // Without PayPal keys (a local run) the route stops at "PayPal isn't set up"
    // before it claims; claim_withdrawal above is the refusal it would reach.
    if (approve.body?.kind !== "not_set_up") {
      expectTrue(approve.status >= 400 && /paused/.test(approve.body?.error ?? ""), "staff Approve on the withdrawal refused in words", approve);
    }
    must(await factory.client.rpc("cancel_withdrawal", { target_withdrawal: waitingId }), "the factory cancels its withdrawal");

    step("a factory paid by bank: hand payouts revealed before and after the pause");
    const c2 = await companies(`S11bR${run}`);
    must(await admin.from("factory_payout_accounts").delete().eq("id", c2.account.id), "drop PayPal");
    const number = "0000000000004321";
    const bank = must(await factory.client.rpc("save_bank_payout_account", {
      target_org: c2.factoryOrg.id, bank_name: "Test Bank", account_name: "PP Test Mill", bank_country: "VN", swift: "TESTVNVX",
      account_number: number, account_number_again: number,
    }), "bank account");
    const bankId = bank.id;
    const orders = [];
    for (const name of ["first", "second"]) {
      const o = await runningOrder(c2, `S11bR${run} ${name} tee`);
      const p = await duePayment(o);
      // Cleared at once: a hand payout waits for the brand's money to clear.
      await pay(p, "pm_card_bypassPending");
      must((await approveStep(o)).result, `approve ${name}`);
      await waitFor(async () => (await paymentRow(p.id)).funds_available_at, `${name}: the brand's money cleared`, { timeout: 60_000 });
      orders.push({ o, p });
    }
    must(await staff.client.rpc("reveal_payout_account_number", { target_account: bankId, for_payment: orders[0].p.id, for_withdrawal: null }), "reveal for the first, before the pause");
    const Z = await runningOrder(c2, `S11bR${run} disputed tee`);
    const pZ = await duePayment(Z);
    const paidZ = await pay(pZ, "pm_card_createDispute", { record: true });
    must((await approveStep(Z)).result, "approve Z");
    await release(paidZ.intentId);
    await reviewIn(pZ.id, "open", "the bank factory's review");
    must(await staff.client.rpc("reveal_payout_account_number", { target_account: bankId, for_payment: orders[1].p.id, for_withdrawal: null }), "reveal for the second, after the pause");
    await refused(staff.client.rpc("release_payment_to_factory", { target_payment: orders[1].p.id, note: "BANKREF-2", paid_to_changed_at: null }), "payment_under_review", "hand payout revealed after the pause");
    const marked = must(await staff.client.rpc("release_payment_to_factory", { target_payment: orders[0].p.id, note: "BANKREF-1", paid_to_changed_at: null }), "mark paid the payout revealed before the pause");
    expectEq(marked.state, "released", "the payout revealed before is marked paid");
    expectEq((await paymentRow(orders[1].p.id)).state, "confirmed", "nothing else left");
  }],

  12: ["Two reviews on one factory; a second dispute on one payment", async (run) => {
    const c = await companies(`S12R${run}`);
    const A = await runningOrder(c, `S12R${run} tee A`);
    const B = await runningOrder(c, `S12R${run} tee B`);
    const pA = await duePayment(A);
    const pB = await duePayment(B);
    const paidA = await pay(pA, "pm_card_createDispute", { record: true });
    const paidB = await pay(pB, "pm_card_createDispute", { record: true });
    must((await approveStep(A)).result, "approve A");
    must((await approveStep(B)).result, "approve B");
    await release(paidA.intentId);
    await release(paidB.intentId);
    const vA = await reviewIn(pA.id, "open", "A's review");
    const vB = await reviewIn(pB.id, "open", "B's review");
    const now = await expectPaused(c, { brand: true, factory: true }, "two reviews");
    expectEq(now.factory.count, 2, "the card counts two reviews");
    expectEq([(await boardRow(vA.id)).open, (await boardRow(vB.id)).open], [true, true], "two rows on the board");
    step("A won: still paused by B");
    await bankRules(paidA.intentId, true);
    await reviewIn(pA.id, "resumed");
    await expectPaused(c, { brand: true, factory: true }, "one review left");
    const info = await stepInfo(A, pA);
    await expectNotice(c.factoryOrg.id, TEXT.fStillPaused(info.step), "factory told it stays paused");
    step("B won: resumed");
    await bankRules(paidB.intentId, true);
    await reviewIn(pB.id, "resumed");
    await expectPaused(c, { brand: true, factory: false }, "both done");
    await expectNotice(c.factoryOrg.id, TEXT.fResumed(info.step), "factory told it can withdraw");
    step("a second dispute on A's payment (recorded as the webhook records one; Stripe's test mode can't open it)");
    const second = `du_pp_second_${STAMP}_${run}`;
    must(await admin.rpc("record_payment_review_dispute", { target_payment: pA.id, dispute_id: second, status: "needs_response", amount_cents: 2000, due_by: new Date(Date.now() + 7 * 864e5).toISOString(), fee_cents: 1500 }), "second dispute");
    const reviewsA = await reviewsOf(pA.id);
    expectEq(reviewsA.map((v) => v.state), ["resumed", "open"], "two rows for A's payment");
    await expectPaused(c, { brand: true, factory: true }, "paused again by the second dispute");
    must(await admin.rpc("record_payment_review_dispute", { target_payment: pA.id, dispute_id: second, status: "won", amount_cents: 2000, due_by: null, fee_cents: 1500 }), "second dispute won");
    await expectPaused(c, { brand: true, factory: false }, "the last review ended");
  }],

  13: ["The brand approves while staff refund the step", async (run) => {
    const c = await companies(`S13R${run}`);
    const { brand, factory, staff } = await people();
    const A = await runningOrder(c, `S13R${run} tee`);
    const pA = await duePayment(A);
    const paidA = await pay(pA, "pm_card_visa");
    const stepRow = must(await admin.from("order_milestones").select("id").eq("id", pA.milestone_id).single(), "step");
    must(await factory.client.rpc("post_milestone_update", { target_milestone: stepRow.id, body: "Fit sample ready.", document_ids: [] }), "factory update");
    step("staff start a refund (claimed, not yet made)");
    const claim = must(await staff.client.rpc("claim_staff_refund", { target_payment: pA.id, amount_cents: 2000, payer: null, note: "Price adjustment.", factory_cents: null }), "claim");
    const e = await refused(brand.client.rpc("approve_milestone", { target_milestone: stepRow.id, note: "Approved." }), "staff_refund_in_progress", "approve during the refund");
    expectEq(e.message, "A refund is in progress for this step.", "approve refusal words");
    const r = await api("/api/stripe-refund", staff, { staffRefundId: claim.staff_refund_id });
    expectEq([r.status, r.body?.status], [200, "refunded"], "the refund finishes");
    step("approve once the refund is made");
    must(await brand.client.rpc("approve_milestone", { target_milestone: stepRow.id, note: "Approved." }), "approve after the refund");
    expectEq((await stripe.refunds.list({ payment_intent: paidA.intentId })).data.map((x) => x.amount), [2000], "Stripe refunded once");
    const p = await paymentRow(pA.id);
    expectEq(Number(p.refunded_cents), 2000, "refunded once in the database");
    const b = await balanceOf(c, "balance after");
    expectEq(Number(b.total_cents), 6500 - Math.round(2000 * 6500 / paidA.charged), "the factory gets the step less the refund's share, once");
  }],

  14: ["Staff who belong to the brand or the factory", async (run) => {
    const c = await companies(`S14R${run}`);
    const { staff, staffBrand, staffFactory } = await people();
    const A = await runningOrder(c, `S14R${run} tee`);
    const pA = await duePayment(A);
    const paidA = await pay(pA, "pm_card_visa");
    must((await approveStep(A)).result, "approve");
    await stripe.refunds.create({ payment_intent: paidA.intentId, amount: 2000 });
    const v = await reviewIn(pA.id, "decide", "a refund review");
    must(await admin.from("org_members").insert({ org_id: c.brandOrg.id, user_id: staffBrand.id, role: "member", permissions: [] }), "staff joins the brand");
    must(await admin.from("org_members").insert({ org_id: c.factoryOrg.id, user_id: staffFactory.id, role: "member", permissions: [] }), "staff joins the factory");
    step("Resolve refused");
    await refused(resolve(v.id, "no_fault", null, "x", staffBrand), ["reveal_brand_side", "review_own_company"], "Resolve by staff in the brand");
    await refused(resolve(v.id, "no_fault", null, "x", staffFactory), "payout_own_company", "Resolve by staff in the factory");
    step("Refund refused");
    let r = await api("/api/stripe-refund", staffBrand, { paymentId: pA.id, amountCents: 1000, payer: "tsc", note: "x" });
    expectTrue(r.status === 403 && ["reveal_brand_side", "review_own_company"].includes(r.body?.hint), "Refund by staff in the brand refused", r);
    r = await api("/api/stripe-refund", staffFactory, { paymentId: pA.id, amountCents: 1000, payer: "tsc", note: "x" });
    expectEq([r.status, r.body?.hint, r.body?.error], [403, "payout_own_company", "You belong to this factory, so someone else on the staff must refund it."], "Refund by staff in the factory");
    step("Unpause refused");
    await refused(staffBrand.client.rpc("unpause_brand_org", { target_org: c.brandOrg.id }), "review_own_company", "Unpause by staff in the brand");
    await refused(staffFactory.client.rpc("unpause_brand_org", { target_org: c.brandOrg.id }), "unpause_factory_side", "Unpause by staff in the factory");
    await refused(staff.client.rpc("unpause_brand_org", { target_org: c.brandOrg.id }), "brand_not_paused", "Unpause a brand that isn't paused");
    step("other staff decide");
    must(await resolve(v.id, "no_fault", null, "Not the factory: our own mistake."), "resolve by other staff");
    expectEq((await boardRow(v.id)).state, "no_fault", "resolved");
    expectEq((await stripe.refunds.list({ payment_intent: paidA.intentId })).data.length, 1, "no refund from the refused calls");
  }],

  15: ["Emails for every new notice, EN + ZH, as rendered", async (run) => {
    const { notificationEmail } = await import("./generate-notification-email.mjs");
    const { staff } = await people();
    const c = await companies(`S15R${run}`);
    step("a staff refund the factory pays part of");
    const A = await runningOrder(c, `S15R${run} tee A`);
    const pA = await duePayment(A);
    const paidA = await pay(pA, "pm_card_visa");
    must((await approveStep(A)).result, "approve A");
    const r = await api("/api/stripe-refund", staff, { paymentId: pA.id, amountCents: 2000, payer: "factory", note: "Short shipment." });
    expectEq(r.status, 200, "staff refund");
    step("a refund in Stripe: factory at fault, then one with no fault");
    await stripe.refunds.create({ payment_intent: paidA.intentId, amount: 1000 });
    const vA = await reviewIn(pA.id, "decide");
    must(await resolve(vA.id, "factory_at_fault", 500, "Agreed with the factory."), "resolve A");
    const B = await runningOrder(c, `S15R${run} tee B`);
    const pB = await duePayment(B);
    const paidB = await pay(pB, "pm_card_visa");
    must((await approveStep(B)).result, "approve B");
    await stripe.refunds.create({ payment_intent: paidB.intentId, amount: 1000 });
    const vB = await reviewIn(pB.id, "decide");
    must(await resolve(vB.id, "no_fault", null, "Our mistake."), "resolve B");
    step("a chargeback: brand paused, then unpaused");
    const D = await runningOrder(c, `S15R${run} tee D`);
    const pD = await duePayment(D);
    await pay(pD, "pm_card_createDispute");
    await reviewIn(pD.id, "open");
    must(await unpause(c), "unpause");
    step("each notice rendered as its email");
    const env = { appUrl: `http://127.0.0.1:${devPort}`, logoUrl: "https://example.com/logo.png", supportEmail: "operations@contact.sourcing-club.com", companyAddress: "New York, USA" };
    const want = {
      [c.brandOrg.id]: ["Account under review", "Account review complete", `Your payment for "Fit sample" was refunded`],
      [c.factoryOrg.id]: ["Withdrawals paused", "Payment review complete", "Withdrawals resumed", `Refund for "Fit sample"`],
    };
    for (const [orgId, titles] of Object.entries(want)) {
      const isFactory = orgId === c.factoryOrg.id;
      const all = await noticesOf(orgId);
      for (const title of titles) {
        const n = all.find((x) => x.title === title);
        if (!n) throw new Check(`no "${title}" notice to render (have ${JSON.stringify(all.map((x) => x.title))})`);
        const outbox = must(await admin.from("notification_email_outbox").select("category").eq("notification_id", n.id), "outbox");
        expectTrue(outbox.length > 0, `"${title}" queued as an email`);
        const row = { ...n, locale: "en", recipient_name: "Sam", org_name: isFactory ? "PP Factory" : "PP Brand", org_type: isFactory ? "factory" : "brand", category: outbox[0].category, time_zone: "UTC" };
        const en = notificationEmail(row, env);
        expectEq(en.subject, n.title, `"${title}": the email's subject is the bell's title`);
        expectTrue(en.text.includes(n.body) && en.html.includes(n.title.replace(/"/g, "&quot;")), `"${title}": the email carries the bell's words`, en.text);
        if (isFactory) {
          const zh = notificationEmail({ ...row, locale: "zh" }, env);
          const zhTitle = notificationTitle(n, { timeZone: "UTC", locale: "zh" });
          const zhBody = notificationBody(n, { timeZone: "UTC", locale: "zh" });
          expectTrue(zhTitle !== n.title && /[一-鿿]/.test(zhTitle), `"${title}": a Chinese title`, zhTitle);
          expectTrue(/[一-鿿]/.test(zhBody), `"${title}": a Chinese body`, zhBody);
          expectEq(zh.subject, zhTitle, `"${title}": ZH subject is the bell's ZH title`);
          expectTrue(zh.text.includes(zhBody), `"${title}": ZH email carries the bell's ZH words`, zh.text);
        }
      }
    }
  }],
};

// ---------------------------------------------------------------------------
// Run.
// ---------------------------------------------------------------------------
const results = {}; // n -> [{ ok, message, ms }]
const started = Date.now();
let exitCode = 0;
try {
  await startProcesses();
  console.log(`paused payments flow: dev server 127.0.0.1:${devPort}, relay ${relayPort}, run stamp ${STAMP}`);
  await people();
  for (let run = 1; run <= REPEAT; run += 1) {
    console.log(`\nrun ${run} of ${REPEAT}`);
    for (const [n, [name, fn]] of Object.entries(SCENARIOS)) {
      if (ONLY && !ONLY.has(Number(n))) continue;
      const t0 = Date.now();
      currentStep = "";
      try {
        await fn(run);
        (results[n] ??= []).push({ ok: true, ms: Date.now() - t0 });
        console.log(`  PASS ${n}. ${name} (${Math.round((Date.now() - t0) / 1000)} s)`);
      } catch (failure) {
        const message = failure instanceof Check ? failure.message : `${failure?.message ?? failure}${VERBOSE ? `\n${failure?.stack}` : ""}`;
        (results[n] ??= []).push({ ok: false, message, step: currentStep, ms: Date.now() - t0 });
        console.log(`  FAIL ${n}. ${name}: [${currentStep}] ${message}`);
      }
    }
  }
} catch (failure) {
  console.error(`could not run: ${failure.message}`);
  exitCode = 1;
} finally {
  stopProcesses();
}
console.log(`\nsummary (${REPEAT} run${REPEAT > 1 ? "s" : ""}, ${Math.round((Date.now() - started) / 60000)} min)`);
for (const [n, list] of Object.entries(results)) {
  const passed = list.filter((r) => r.ok).length;
  const ok = passed === list.length;
  if (!ok) exitCode = 1;
  console.log(`  ${ok ? "PASS" : "FAIL"} ${n}. ${SCENARIOS[n][0]}: ${passed}/${list.length}${ok ? "" : ` — ${list.find((r) => !r.ok).message}`}`);
}
setTimeout(() => process.exit(exitCode), 500);
