/**
 * Demo Factory, paid through Stripe with money to withdraw: the state the
 * Stripe Withdraw dialog needs, which the demo seed does not make.
 *
 *   npm run seed:demo             (once, or already done on this database)
 *   npm run seed:demo:stripe      this script
 *
 * Against a test database, as seed-demo.mjs:
 *
 *   SUPABASE_URL=… SUPABASE_ANON_KEY=… SUPABASE_SERVICE_KEY=… npm run seed:demo:stripe -- --remote
 *
 * It refuses the production project and any key but a Stripe TEST secret key
 * (STRIPE_SECRET_KEY from the shell, else .env.local). The Stripe test
 * account the database's site uses must be the same one, or the site cannot
 * see the account made here.
 *
 * What it does, through the app's own code wherever the app has some:
 *
 * 1. Demo Factory's Stripe account. If the database has none for it, one is
 *    created exactly as api/stripe-connect.js creates it (MANAGED_CONTROLLER,
 *    transfers + card_payments, manual payouts) and saved with
 *    saveConnectAccount(). Country US: the two banks below are US test banks
 *    and the balance is USD (Demo Factory's profile says Portugal; Stripe's
 *    form would have let it pick either). The details Stripe asks for are
 *    filled with Stripe's documented test values (date of birth 1901-01-01,
 *    SSN 000000000, "address_full_match"), and the terms are accepted by the
 *    platform, as on an account TSC manages. Stripe then verifies them on
 *    its own, which takes a minute or two; the script waits.
 *    Older accounts made by this script for the same database (an earlier
 *    seed, whose company the seed deleted) are deleted at Stripe: test mode
 *    only, and only ones no company in this database still uses.
 * 2. Two USD bank accounts, added with addPayoutMethod() from Stripe test
 *    tokens: routing 110000000, account 000123456789 (ending 6789, the
 *    default) and 000111111116 (ending 1116). Ones already there are kept.
 * 3. What the factory's Payments page does once the account can take
 *    transfers ("refresh"): saveConnectAccount() and releaseOwedTo(), which
 *    pays out every step already owed to it (the seed's funded bulk deposit
 *    on "Organic poplin shirt, AW27"). The seed charged those with the test
 *    card 4242, so they reach the factory as Pending, not Available.
 * 4. Money available now: when the account has less than US$50 available,
 *    one due step of Demo Factory's is funded with the test card 4000 0000
 *    0000 0077 (pm_card_bypassPending: available at once), recorded as the
 *    seed records a payment (attach_payment_intent, record_payment_funded).
 *    A paid step is then approved as the app approves it (Demo Factory posts
 *    an update, Demo Brand approves), and releasePayment() sends it to the
 *    factory: the same transfer, with source_transaction, as approving does.
 *    The step chosen is the fit sample of "Washed denim jacket, AW27" first
 *    (the seed's "Due" one; its bulk deposit then falls due, so the brand
 *    still has a "Due" payment), else any due step of Demo Factory's.
 *
 * Running it again changes nothing at Stripe except step 4, which funds one
 * more step only when the available balance is under US$50 (a tester
 * withdrew it). --fund funds one more regardless. --pending-step also funds
 * one more step with the test card 4242, whose money stays pending at Stripe
 * for a few days, so Payments shows an earning "Pending · Available <day>".
 * After `npm run seed:demo`
 * the company is new, so the account, the banks and the balance are made
 * again and the old account is deleted.
 */
import Stripe from "stripe";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { DEMO_LOGINS as LOGINS, DEMO_PASSWORD as PASSWORD } from "../src/shared/demo-logins.mjs";

// --login <key> runs this for another factory login from demo-logins.mjs
// (default: Demo Factory). The factory must have no PayPal or Wise method saved,
// or Stripe pays it nothing.
const loginArg = process.argv.indexOf("--login");
const FACTORY = LOGINS[loginArg > -1 ? process.argv[loginArg + 1] : "factory"];
if (!FACTORY) throw new Error(`no demo login "${process.argv[loginArg + 1]}" in demo-logins.mjs`);
import { demoTarget } from "./demo-target.mjs";
import { MANAGED_CONTROLLER, addPayoutMethod, holdPayouts, managedByTsc } from "../api/_stripe-payouts.js";
import { releaseOwedTo, releasePayment, saveConnectAccount } from "../api/_stripe.js";

const { URL, ANON, SERVICE } = demoTarget("set up Demo Factory's Stripe balance on");
const DB_HOST = new globalThis.URL(URL).host;
const ENOUGH_CENTS = 5000;
const BANKS = [
  { account: "000123456789", last4: "6789", makeDefault: true },
  { account: "000111111116", last4: "1116", makeDefault: false },
];
const DENIM_TITLE = "Washed denim jacket, AW27";

// A test key, and nothing else: this script charges a card.
function stripeTestKey() {
  let key = process.env.STRIPE_SECRET_KEY ?? "";
  if (!key) {
    try {
      key = readFileSync(".env.local", "utf8").match(/^STRIPE_SECRET_KEY=["']?([^"'\s]+)/m)?.[1] ?? "";
    } catch { /* no .env.local: the shell is the only place to look */ }
  }
  if (/^(sk|rk)_live_/.test(key)) {
    console.error("Refusing: STRIPE_SECRET_KEY is a live key. This script charges a card; use a test key.");
    process.exit(1);
  }
  if (!key.startsWith("sk_test_")) {
    console.error("No Stripe test key. Set STRIPE_SECRET_KEY (sk_test_…) in the shell or .env.local.");
    process.exit(1);
  }
  return key;
}
const stripe = new Stripe(stripeTestKey(), { maxNetworkRetries: 2, appInfo: { name: "The Sourcing Club demo setup" } });
const db = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

const must = ({ data, error }, what) => {
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
};
const money = (cents) => `US$${(cents / 100).toFixed(2)}`;

async function signIn({ email }) {
  const client = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`sign in as ${email}: ${error.message}. Run \`npm run seed:demo\` first.`);
  return client;
}

// Demo Factory: the factory its login started (the seed's create_org).
const factoryUser = must(await db.from("user_profiles").select("id").eq("email", FACTORY.email).maybeSingle(), "Demo Factory's login");
if (!factoryUser) throw new Error(`${FACTORY.email} does not exist here. Run \`npm run seed:demo\` first.`);
const owned = must(await db.from("org_members").select("org_id, orgs!inner (id, name, type)")
  .eq("user_id", factoryUser.id).eq("role", "owner").eq("orgs.type", "factory").eq("orgs.name", FACTORY.name), "Demo Factory");
if (owned.length !== 1) throw new Error(`expected one "${FACTORY.name}" owned by ${FACTORY.email}, found ${owned.length}. Run \`npm run seed:demo\` first.`);
const org = owned[0].orgs;
console.log(`${org.name} (${org.id}) on ${DB_HOST}`);

// 1. The account.
let row = must(await db.from("stripe_connect_accounts").select("*").eq("org_id", org.id).maybeSingle(), "its Stripe account");
let account = null;
if (row) {
  account = await stripe.accounts.retrieve(row.stripe_account_id).catch(() => null);
  if (!account || account.deleted) {
    throw new Error(`the database links ${org.name} to ${row.stripe_account_id}, which this Stripe key cannot read. Is the site on another Stripe account? Nothing was changed.`);
  }
  if (!managedByTsc(account)) {
    throw new Error(`${row.stripe_account_id} is an Express account, made before TSC managed accounts: its banks change only in Stripe's form. Nothing was changed.`);
  }
  console.log(`account ${account.id}: already linked`);
} else {
  // As api/stripe-connect.js "session" creates it, plus two metadata keys
  // that let a later run find and delete it once its company is gone.
  account = await stripe.accounts.create({
    controller: MANAGED_CONTROLLER,
    country: "US",
    email: FACTORY.email,
    capabilities: { transfers: { requested: true }, card_payments: { requested: true } },
    business_profile: { name: org.name },
    metadata: { org_id: org.id, tsc_demo_setup: FACTORY.email, tsc_demo_db: DB_HOST },
    settings: { payouts: { schedule: { interval: "manual" } } },
  });
  await saveConnectAccount(db, org.id, account);
  console.log(`account ${account.id}: created`);
}

// Earlier runs' accounts for this database whose company the seed deleted.
const inUse = new Set(must(await db.from("stripe_connect_accounts").select("stripe_account_id"), "accounts in use").map((r) => r.stripe_account_id));
for await (const old of stripe.accounts.list({ limit: 100 })) {
  if (old.metadata?.tsc_demo_setup !== FACTORY.email || old.metadata?.tsc_demo_db !== DB_HOST) continue;
  if (old.id === account.id || inUse.has(old.id)) continue;
  await stripe.accounts.del(old.id);
  console.log(`account ${old.id}: deleted (an earlier run's; its company is gone)`);
}

// What Stripe asks for, with its documented test values.
if (!account.details_submitted || account.requirements?.currently_due?.some((r) => r !== "external_account")) {
  account = await stripe.accounts.update(account.id, {
    business_type: "individual",
    business_profile: { mcc: "5699", url: "https://sourcing-club.com", product_description: "Apparel manufacturing for brands on The Sourcing Club." },
    individual: {
      first_name: "Demo", last_name: "Factory", email: FACTORY.email, phone: "0000000000",
      dob: { day: 1, month: 1, year: 1901 }, id_number: "000000000", ssn_last_4: "0000",
      address: { line1: "address_full_match", city: "San Francisco", state: "CA", postal_code: "94111", country: "US" },
    },
    tos_acceptance: { date: Math.floor(Date.now() / 1000), ip: "127.0.0.1" },
  });
  console.log("details: filled with Stripe's test values");
}

// 2. Two USD banks, the first the default. TSC's own change, as the app marks it.
const { data: methods } = await stripe.accounts.listExternalAccounts(account.id, { limit: 20 });
for (const bank of BANKS) {
  if (methods.some((m) => m.object === "bank_account" && m.currency === "usd" && m.last4 === bank.last4)) continue;
  must(await db.from("stripe_connect_accounts").update({ methods_changed_by_tsc_at: new Date().toISOString() }).eq("org_id", org.id), "mark TSC's change");
  const token = await stripe.tokens.create({ bank_account: {
    country: "US", currency: "usd", account_holder_name: org.name, account_holder_type: "company",
    routing_number: "110000000", account_number: bank.account,
  } });
  const added = await addPayoutMethod(stripe, account.id, { token: token.id, makeDefault: bank.makeDefault && !methods.length });
  methods.push(added);
  console.log(`bank ending ${added.last4}: added${added.default_for_currency ? " (default)" : ""}`);
}

// Stripe verifies the details on its own; payouts open once it has.
for (let wait = 0; ; wait++) {
  account = await stripe.accounts.retrieve(account.id);
  if (account.payouts_enabled && account.capabilities?.transfers === "active") break;
  if (wait >= 60) throw new Error(`Stripe has not finished verifying ${account.id} after 5 minutes (${account.requirements?.disabled_reason ?? "no reason given"}). Run this again later.`);
  if (wait === 0) process.stdout.write("waiting for Stripe to verify the account");
  process.stdout.write(".");
  await new Promise((resolve) => setTimeout(resolve, 5000));
}
console.log(`\naccount ${account.id}: payouts enabled, transfers active`);

// 3. As the factory's page does on "refresh".
await holdPayouts(stripe, account.id);
row = await saveConnectAccount(db, org.id, account);
const preference = must(await db.from("factory_payout_preferences").select("route").eq("org_id", org.id).maybeSingle(), "its payout choice");
if (preference?.route === "manual") {
  throw new Error(`${org.name} chose another withdrawal method than Stripe (factory_payout_preferences: manual), so Stripe pays it nothing. Make Stripe its default on its Payments page, then run this again.`);
}
for (const result of await releaseOwedTo({ stripe, db, factoryOrgId: org.id })) {
  console.log(`owed payment ${result.id}: ${result.released ? `paid out (${result.reason})` : `not paid out: ${result.reason}`}`);
}

// 4. Money available now (card 4000 0000 0000 0077), and with --pending-step
//    one more step paid with the ordinary test card 4242, whose money stays
//    pending at Stripe for a few days: the factory's Payments page then shows
//    it as "Pending · Available <day>".
const availableUsd = async () => (await stripe.balance.retrieve({}, { stripeAccount: account.id })).available
  .filter((b) => b.currency === "usd").reduce((sum, b) => sum + b.amount, 0);

const CARDS = {
  now: { method: "pm_card_bypassPending", label: "Visa ···0077", said: "the test card 4000 0000 0000 0077 (available at once)" },
  pending: { method: "pm_card_visa", label: "Visa ···4242", said: "the test card 4242 4242 4242 4242 (pending at Stripe for a few days)" },
};

/** Funds Demo Factory's next due step with a test card, approves it as the app does, and pays it out. */
async function fundOneStep(card) {
  const due = must(await db.from("order_payments")
    .select("id, order_id, milestone_id, amount_cents, release_requested_at, production_orders!inner (factory_org_id, status, rfqs (title))")
    .eq("state", "due").eq("production_orders.factory_org_id", org.id).eq("production_orders.status", "active")
    .order("due_at"), "Demo Factory's due payments");
  const payment = due.find((p) => p.production_orders.rfqs?.title === DENIM_TITLE) ?? due[0];
  if (!payment) throw new Error(`${org.name} has no due payment to fund. Run \`npm run seed:demo\` for a fresh set.`);
  const title = payment.production_orders.rfqs?.title ?? payment.order_id;

  // As the seed's fundedByStripe().
  const total = Number(must(await db.rpc("payment_charge_cents", { target_payment: payment.id }), "the charge"));
  must(await db.rpc("attach_payment_intent", { target_payment: payment.id, payment_intent: null, charged: total }), "the charge");
  const intent = await stripe.paymentIntents.create({
    amount: total, currency: "usd", payment_method: card.method, confirm: true,
    automatic_payment_methods: { enabled: true, allow_redirects: "never" },
    transfer_group: payment.order_id, metadata: { payment_id: payment.id },
  });
  must(await db.rpc("attach_payment_intent", { target_payment: payment.id, payment_intent: intent.id, charged: total }), "the test charge");
  must(await db.rpc("record_payment_funded", {
    target_payment: payment.id, charge: intent.latest_charge, method_type: "card", method_label: card.label, received: total,
  }), "a payment held by TSC");
  console.log(`funded: ${title}, ${money(total)} charged to ${card.said} (${intent.id})`);

  // A paid step is approved from the factory's update on it; a payment-only
  // one is owed as soon as it is funded.
  const owedNow = must(await db.from("order_payments").select("release_requested_at").eq("id", payment.id).single(), "the payment").release_requested_at;
  if (!owedNow) {
    const [factory, brand] = await Promise.all([signIn(FACTORY), signIn(LOGINS.brand)]);
    must(await factory.rpc("post_milestone_update", {
      target_milestone: payment.milestone_id, body: "Fit sample is sewn and measured against the spec sheet.", document_ids: [],
    }), "Demo Factory's update");
    must(await brand.rpc("approve_milestone", { target_milestone: payment.milestone_id, note: "Fit approved." }), "Demo Brand approves");
    console.log("approved: Demo Factory posted an update and Demo Brand approved the step");
  }
  const released = await releasePayment({ stripe, db, paymentId: payment.id });
  // A payment-only step is owed the moment it is funded, so the site's own
  // webhook may have paid it out first: that is the same result.
  if (!released.released && released.reason !== "already being paid") throw new Error(`the step was funded but not paid out: ${released.reason}`);
  console.log(released.released ? `paid out to the factory: ${released.reason}` : "paid out to the factory by the site's webhook");
}

const before = await availableUsd();
if (before >= ENOUGH_CENTS && !process.argv.includes("--fund")) {
  console.log(`available: ${money(before)} already; no step funded (pass --fund for one more)`);
} else {
  await fundOneStep(CARDS.now);
}
if (process.argv.includes("--pending-step")) await fundOneStep(CARDS.pending);

const after = await availableUsd();
const pending = (await stripe.balance.retrieve({}, { stripeAccount: account.id })).pending
  .filter((b) => b.currency === "usd").reduce((sum, b) => sum + b.amount, 0);
const banks = (await stripe.accounts.listExternalAccounts(account.id, { limit: 20 })).data
  .map((m) => `${m.object === "card" ? "card" : "bank"} ending ${m.last4}${m.default_for_currency ? " (default)" : ""} ${m.id}`);
console.log(`
${org.name} is ready to withdraw through Stripe
  account    ${account.id}
  available  ${money(after)}
  pending    ${money(pending)}
  banks      ${banks.join("\n             ")}
Sign in as ${FACTORY.email} and open Payments.`);
