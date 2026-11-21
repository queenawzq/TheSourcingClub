/**
 * One-off: bring each confirmed or released Stripe payment in line with what
 * Stripe says now, for payments recorded before the server kept these:
 *   - when the charge's money became available on TSC's Stripe account
 *     (order_payments.funds_available_at), where none is recorded;
 *   - whether the charge is disputed (open) or no longer is
 *     (record_payment_disputed: a dispute answered before the server could
 *     match it was never recorded); a dispute lost is recorded as lost
 *     (record_payment_dispute_lost);
 *   - a refund in Stripe beyond what is recorded, in full or in part,
 *     recorded at Stripe's amount (the server's own refund recording, which
 *     makes no new refund).
 *
 *   node scripts/backfill-funds-available.mjs            # local stack, dry run
 *   node scripts/backfill-funds-available.mjs --write    # local stack, writes
 *
 * A test database: SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_KEY and
 * --remote (the same guard as the demo seed). Production is refused unless
 * --production is also given, and then only with a live Stripe key; a test
 * key is refused anywhere but a test database. qa only with
 * QA_BACKFILL_CONFIRMED=1. STRIPE_SECRET_KEY comes from the environment or
 * .env.local. Prints no key and no address.
 *
 * Writes only through the server's own functions. Safe to run again.
 */
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { applyBackfill, decideBackfill } from "../api/_backfill.js";

const PRODUCTION_REF = "wxzliajdtwekqdvwzqfb";
const args = new Set(process.argv.slice(2));
const write = args.has("--write");

function fromDotEnv(name) {
  try {
    for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (match && match[1] === name) return match[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // no .env.local: the environment alone decides
  }
  return undefined;
}

function localStack() {
  try {
    return JSON.parse(execFileSync("npx", ["supabase", "status", "-o", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  } catch {
    return {};
  }
}

function stop(sentence) {
  console.error(sentence);
  process.exit(1);
}

const fromEnv = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY;
const stack = fromEnv ? {} : localStack();
const url = process.env.SUPABASE_URL ?? stack.API_URL;
const service = process.env.SUPABASE_SERVICE_KEY ?? stack.SECRET_KEY ?? stack.SERVICE_ROLE_KEY;
if (!url || !service) stop("No Supabase. Run `supabase start`, or set SUPABASE_URL and SUPABASE_SERVICE_KEY with --remote.");
const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|$)/.test(url);
const isProduction = url.includes(PRODUCTION_REF);
if (!isLocal && !args.has("--remote")) stop("Refusing a remote database without --remote. Pass it only for a test database.");
if (isProduction && !args.has("--production")) stop("Refusing the production database. Pass --production only when that is meant.");
if (url.includes("lafsvocxthdoryezikdb") && !process.env.QA_BACKFILL_CONFIRMED) {
  stop("Refusing qa from here: the coordinator runs qa through its own guarded script (set QA_BACKFILL_CONFIRMED=1 there).");
}

const secret = process.env.STRIPE_SECRET_KEY ?? fromDotEnv("STRIPE_SECRET_KEY") ?? "";
if (!/^sk_(test|live)_/.test(secret)) stop("No Stripe secret key (STRIPE_SECRET_KEY).");
if (isProduction !== secret.startsWith("sk_live_")) {
  stop(isProduction ? "Production needs TSC's live Stripe key." : "A live Stripe key is refused outside production.");
}

const stripe = new Stripe(secret);
const db = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } });

const rows = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await db.from("order_payments")
    .select("id, state, stripe_charge_id, funds_available_at, confirmed_at, disputed_at, refunded_cents, dispute_lost_at")
    .in("state", ["confirmed", "released"]).not("stripe_charge_id", "is", null)
    .order("id").range(from, from + 999);
  if (error) stop(`Could not read payments: ${error.message}`);
  rows.push(...data);
  if (data.length < 1000) break;
}

console.log(`${rows.length} confirmed or released Stripe payment(s) (${write ? "writing" : "dry run: pass --write to record"}).`);
const done = { dates: 0, noDate: 0, disputed: 0, undisputed: 0, lost: 0, refunded: 0, partlyRefunded: 0, failed: 0 };
for (const row of rows) {
  try {
    const charge = await stripe.charges.retrieve(row.stripe_charge_id, { expand: ["balance_transaction"] });
    const disputeId = charge.disputed ? (typeof charge.dispute === "string" ? charge.dispute : charge.dispute?.id) : null;
    const dispute = disputeId ? await stripe.disputes.retrieve(disputeId) : null;
    const decision = decideBackfill({ row, charge, dispute });
    for (const line of await applyBackfill({ stripe, db, row, charge, dispute, decision, write })) console.log(`  ${row.id}: ${line}`);
    if ("date" in decision) done[decision.date ? "dates" : "noDate"] += 1;
    if ("disputed" in decision) done[decision.disputed ? "disputed" : "undisputed"] += 1;
    if (decision.refund) done[decision.refund === "full" ? "refunded" : "partlyRefunded"] += 1;
    if (decision.lost) done.lost += 1;
  } catch (failure) {
    done.failed += 1;
    console.log(`  ${row.id}: failed (${failure?.code ?? failure?.statusCode ?? "error"}: ${String(failure?.message ?? "").slice(0, 120)})`);
  }
}
console.log(`Done: ${done.dates} clearing dates, ${done.noDate} with no date yet, ${done.disputed} disputes recorded, ${done.undisputed} holds lifted, ${done.lost} lost disputes recorded, ${done.refunded} full refunds recorded, ${done.partlyRefunded} partial refunds recorded, ${done.failed} failed${write ? "" : " (dry run: nothing written)"}.`);
process.exit(done.failed ? 1 : 0);
