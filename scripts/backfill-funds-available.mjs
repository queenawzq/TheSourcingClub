/**
 * One-off: record when each confirmed Stripe payment's money became available
 * on TSC's Stripe account (order_payments.funds_available_at), for payments
 * recorded before the date was kept. Until then payment_clears_at() guesses
 * 7 days after confirmation; Stripe's own date replaces the guess.
 *
 *   node scripts/backfill-funds-available.mjs            # local stack, dry run
 *   node scripts/backfill-funds-available.mjs --write    # local stack, writes
 *
 * A test database: SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_KEY and
 * --remote (the same guard as the demo seed). Production is refused unless
 * --production is also given, and then only with a live Stripe key; a test
 * key is refused anywhere but a test database. STRIPE_SECRET_KEY comes from
 * the environment or .env.local. Prints no key and no address.
 *
 * Writes only through record_payment_funds_available() (service role), which
 * changes nothing when the date is already right. Safe to run again.
 */
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

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
    .select("id, state, stripe_charge_id, funds_available_at, confirmed_at")
    .in("state", ["confirmed", "released"]).not("stripe_charge_id", "is", null).is("funds_available_at", null)
    .order("id").range(from, from + 999);
  if (error) stop(`Could not read payments: ${error.message}`);
  rows.push(...data);
  if (data.length < 1000) break;
}

console.log(`${rows.length} confirmed Stripe payment(s) with no clearing date (${write ? "writing" : "dry run: pass --write to record"}).`);
let recorded = 0;
let missing = 0;
let failed = 0;
for (const row of rows) {
  try {
    const charge = await stripe.charges.retrieve(row.stripe_charge_id, { expand: ["balance_transaction"] });
    const seconds = Number(charge.balance_transaction?.available_on);
    if (!seconds) {
      missing += 1;
      console.log(`  ${row.id}: Stripe has no date yet`);
      continue;
    }
    const at = new Date(seconds * 1000).toISOString();
    console.log(`  ${row.id}: ${at}${write ? "" : " (not written)"}`);
    if (write) {
      const { error } = await db.rpc("record_payment_funds_available", { target_payment: row.id, available_at: at });
      if (error) throw new Error(error.message);
      recorded += 1;
    }
  } catch (failure) {
    failed += 1;
    console.log(`  ${row.id}: failed (${failure?.code ?? failure?.statusCode ?? "error"}: ${String(failure?.message ?? "").slice(0, 120)})`);
  }
}
console.log(`Done: ${recorded} recorded, ${missing} with no date yet, ${failed} failed.`);
process.exit(failed ? 1 : 0);
