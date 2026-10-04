/**
 * A populated local marketplace, for looking at screens.
 *
 *   supabase start
 *   node scripts/seed-demo.mjs
 *
 * The suites prove behaviour; this exists so a human (or Claude in Chrome) can
 * open the app and SEE a dashboard with real requests, quotes and an order on
 * it. Every account uses the same password and the run prints them at the end.
 *
 * Local only: it needs the service key, and it creates confirmed users without
 * email round trips.
 */
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

function localStack() {
  try {
    return JSON.parse(execFileSync("supabase", ["status", "-o", "json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }));
  } catch {
    return {};
  }
}

const stack = localStack();
const URL = process.env.SUPABASE_URL ?? stack.API_URL;
const ANON = process.env.SUPABASE_ANON_KEY ?? stack.PUBLISHABLE_KEY ?? stack.ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_KEY ?? stack.SECRET_KEY ?? stack.SERVICE_ROLE_KEY;
if (!URL || !ANON || !SERVICE) {
  console.error("No local Supabase. Run `supabase start` first.");
  process.exit(1);
}

const PASSWORD = "demo password 8";
const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });
const stamp = Date.now();

async function signedIn(email) {
  const existing = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { name: email.split("@")[0] },
  });
  if (existing.error && !/already/i.test(existing.error.message)) throw existing.error;
  const client = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  const { data } = await client.auth.getUser();
  return { client, id: data.user.id, email };
}

const must = ({ data, error }, what) => {
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
};

const brandEmail = `demo-brand-${stamp}@example.com`;
const factoryEmail = `demo-factory-${stamp}@example.com`;

console.log("\ncreating accounts");
const brand = await signedIn(brandEmail);
const factory = await signedIn(factoryEmail);

const brandOrg = must(await brand.client.rpc("create_org", { org_name: `Demo Brand ${stamp}`, org_kind: "brand" }), "create brand org");
const factoryOrg = must(await factory.client.rpc("create_org", { org_name: `Demo Factory ${stamp}`, org_kind: "factory" }), "create factory org");

// Onboarded and verified, so both land on the dashboard rather than the
// onboarding flow or the "in review" card.
must(await admin.from("brand_profiles").upsert({
  org_id: brandOrg.id,
  hq_location: "London, UK",
  onboarding_completed_at: new Date().toISOString(),
  verification_status: "verified",
}), "brand profile");
must(await admin.from("factory_profiles").upsert({
  org_id: factoryOrg.id,
  country_code: "PT",
  location: "Porto, Portugal",
  moq: 150,
  typical_lead_days: 28,
  intro: "Woven shirting and light outerwear, small runs.",
  onboarding_completed_at: new Date().toISOString(),
  verification_status: "verified",
  published_at: new Date().toISOString(),
}), "factory profile");

// submit_quote() refuses a quote missing commercial terms, and it is right to.
const termId = async (kind, slug) => (must(await admin
  .from("taxonomy_terms").select("id").eq("kind", kind).eq("slug", slug).single(), `${kind}/${slug}`)).id;
const paymentTermId = await termId("payment_term", "deposit-30-70");
const incotermId = await termId("incoterm", "exw");
const validUntil = new Date(Date.now() + 21 * 864e5).toISOString();

// Sending a quote costs credits now, so the factory starts with the grant a
// verified vendor gets.
must(await admin.from("credit_ledger").insert({
  org_id: factoryOrg.id, delta: 500, reason: "onboarding_grant", note: "demo seed",
}), "factory credits");

console.log("requests and quotes");
const rfqs = [];
for (const [title, brief, quantity] of [
  ["Organic cotton shirting, SS27", "300 women's woven shirts in organic cotton poplin. Fit and PP sample before bulk.", 300],
  ["Merino knit capsule", "Fine-gauge merino blend tops and cardigans, visible sample-room support.", 180],
]) {
  const draft = must(await brand.client
    .from("rfqs")
    .insert({ brand_org_id: brandOrg.id, status: "draft", visibility: "open_to_all" })
    .select("id")
    .single(), "draft");
  const id = draft.id;
  must(await brand.client.from("rfqs").update({
    title,
    brief,
    quantity_total: quantity,
    target_unit_price_min_cents: 1800,
    target_unit_price_max_cents: 2600,
    requires_sample: true,
    quote_deadline: new Date(Date.now() + 12 * 864e5).toISOString(),
    status: "open",
    published_at: new Date().toISOString(),
  }).eq("id", id), "publish request");
  rfqs.push({ id, title });
}

// One request gets a quote, so "Ready to compare" and the quotes screen have
// something in them.
const quote = must(await factory.client.from("quotes").insert({
  rfq_id: rfqs[0].id,
  factory_org_id: factoryOrg.id,
  unit_price_cents: 2150,
  production_quantity: 300,
  bulk_lead_time_days: 30,
  deposit_pct: 30,
  balance_pct: 70,
  payment_term_id: paymentTermId,
  incoterm_id: incotermId,
  valid_until: validUntil,
  factory_notes: "Includes fit and PP sample, EXW Porto.",
}).select("id").single(), "quote");
must(await factory.client.from("quote_sample_lines").insert({
  quote_id: quote.id, stage: "Fit sample", cost_cents: 6500, timing_days: 10, sort: 0,
}), "sample line");
must(await factory.client.rpc("submit_quote", { quote_id: quote.id }), "submit quote");

// A conversation, so the request card's third metric is a real number.
const thread = must(await brand.client.rpc("open_rfq_thread", { target_rfq: rfqs[0].id, factory_org: factoryOrg.id }), "thread");
const threadId = thread?.id ?? thread;
must(await brand.client.from("messages").insert({
  thread_id: threadId, sender_org_id: brandOrg.id, sender_user_id: brand.id,
  body: "Could you confirm the lab dip timing before we award?",
}), "message");

console.log("an awarded order");
const secondQuote = must(await factory.client.from("quotes").insert({
  rfq_id: rfqs[1].id,
  factory_org_id: factoryOrg.id,
  unit_price_cents: 3400,
  production_quantity: 180,
  bulk_lead_time_days: 35,
  deposit_pct: 30,
  balance_pct: 70,
  payment_term_id: paymentTermId,
  incoterm_id: incotermId,
  valid_until: validUntil,
  factory_notes: "Merino capsule, includes knit-down.",
}).select("id").single(), "second quote");
must(await factory.client.from("quote_sample_lines").insert({
  quote_id: secondQuote.id, stage: "Fit sample", cost_cents: 4500, timing_days: 12, sort: 0,
}), "sample line 2");
must(await factory.client.rpc("submit_quote", { quote_id: secondQuote.id }), "submit second quote");
must(await brand.client.rpc("award_quote", { quote_id: secondQuote.id }), "award");

// Credits and a discount code, so the Savings card has real figures.
must(await admin.from("credit_ledger").insert({
  org_id: brandOrg.id, delta: 500, reason: "onboarding_grant", note: "demo seed",
}), "credits");
must(await admin.from("discount_codes").insert({
  code: `DEMO-${String(stamp).slice(-6)}`, owner_org_id: brandOrg.id, amount_cents: 5000,
}), "discount code");

console.log(`
done. Sign in at http://127.0.0.1:5173/app.html

  brand    ${brandEmail}
  factory  ${factoryEmail}   (http://127.0.0.1:5173/app.html?portal=factory)
  password ${PASSWORD}
`);
