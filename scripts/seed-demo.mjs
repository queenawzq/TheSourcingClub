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

// A second verified factory, so a request can have two quotes to compare.
const secondFactoryEmail = `demo-factory-two-${stamp}@example.com`;
const secondFactory = await signedIn(secondFactoryEmail);
const secondFactoryOrg = must(await secondFactory.client.rpc("create_org", { org_name: `Ningbo Loomworks ${stamp}`, org_kind: "factory" }), "create second factory org");
must(await admin.from("factory_profiles").upsert({
  org_id: secondFactoryOrg.id,
  country_code: "CN",
  location: "Ningbo, China",
  moq: 200,
  typical_lead_days: 35,
  intro: "Woven shirting and linen, 200-unit minimums.",
  onboarding_completed_at: new Date().toISOString(),
  verification_status: "verified",
  published_at: new Date().toISOString(),
}), "second factory profile");
must(await admin.from("credit_ledger").insert({
  org_id: secondFactoryOrg.id, delta: 500, reason: "onboarding_grant", note: "demo seed",
}), "second factory credits");

/**
 * A request as a brand fills it in on the review card: the prose fields, the
 * category / certification / region tags, the colour breakdown and a question
 * for vendors. Written through the brand's own login, then published. Copying
 * a request ("Reorder style") and reopening a draft both carry every one of
 * these, so a bare request would show a tester almost nothing.
 */
async function publishRequest({ title, brief, quantity, colours, material, samples, extra, month, tags, question }) {
  const id = must(await brand.client
    .from("rfqs")
    .insert({ brand_org_id: brandOrg.id, status: "draft", visibility: "open_to_all" })
    .select("id")
    .single(), "draft").id;

  must(await brand.client.from("rfq_colour_splits").insert(
    colours.map(([colour, units], sort) => ({ rfq_id: id, colour, quantity: units, sort })),
  ), "colour breakdown");
  must(await brand.client.from("rfq_questions").insert({ rfq_id: id, prompt: question, sort: 0 }), "question");
  const termIds = await Promise.all(tags.map(([kind, slug]) => termId(kind, slug)));
  must(await brand.client.from("taxonomy_links").insert(
    termIds.map((term) => ({ subject_type: "rfq", subject_id: id, term_id: term, org_id: brandOrg.id })),
  ), "request tags");

  must(await brand.client.from("rfqs").update({
    title,
    brief,
    quantity_total: quantity,
    material_notes: material,
    sample_notes: samples,
    additional_details: extra,
    target_delivery_month: month,
    sourcing_responsibility_term_id: await termId("sourcing_responsibility", "mixed"),
    target_unit_price_min_cents: 1800,
    target_unit_price_max_cents: 2600,
    requires_sample: true,
    quote_deadline: new Date(Date.now() + 12 * 864e5).toISOString(),
    status: "open",
    published_at: new Date().toISOString(),
  }).eq("id", id), "publish request");
  return { id, title };
}

/** A quote sent through the vendor's own login, the way the quote form sends it. */
async function sendQuote(vendor, vendorOrg, rfq, { price, quantity, lead, note, answer }) {
  const quote = must(await vendor.client.from("quotes").insert({
    rfq_id: rfq.id,
    factory_org_id: vendorOrg.id,
    unit_price_cents: price,
    production_quantity: quantity,
    bulk_lead_time_days: lead,
    deposit_pct: 30,
    balance_pct: 70,
    payment_term_id: paymentTermId,
    incoterm_id: incotermId,
    valid_until: validUntil,
    factory_notes: note,
  }).select("id").single(), "quote");
  must(await vendor.client.from("quote_sample_lines").insert({
    quote_id: quote.id, stage: "fit_sample", cost_cents: 6500, timing_days: 10, sort: 0,
  }), "sample line");
  if (answer) {
    const [question] = must(await vendor.client.from("rfq_questions").select("id").eq("rfq_id", rfq.id), "questions");
    must(await vendor.client.from("quote_question_answers").insert({
      quote_id: quote.id, question_id: question.id, answer_text: answer,
    }), "answer");
  }
  must(await vendor.client.rpc("submit_quote", { quote_id: quote.id }), "submit quote");
  return quote;
}

/** Award a quote; the order is created in the same transaction. */
async function award(quote) {
  must(await brand.client.rpc("award_quote", { quote_id: quote.id }), "award");
  return must(await admin.from("production_orders").select("*").eq("quote_id", quote.id).single(), "the new order");
}

console.log("requests and quotes");
const shirting = await publishRequest({
  title: "Organic cotton shirting, SS27",
  brief: "300 women's woven shirts in organic cotton poplin. Fit and PP sample before bulk.",
  quantity: 300,
  colours: [["White", 150], ["Sky blue", 150]],
  material: "Organic cotton poplin, 120 gsm, GOTS certified",
  samples: "Fit sample, then PP sample before bulk",
  extra: "Mother-of-pearl buttons. We supply the woven labels.",
  month: "2027-03-01",
  tags: [["product_category", "womenswear"], ["product_category", "tops"], ["certification", "gots"], ["region", "portugal"]],
  question: "Can you hold the same poplin lot for a repeat order?",
});

// Two quotes from two factories, so "Compare quotes" has something to compare.
await sendQuote(factory, factoryOrg, shirting, {
  price: 2150, quantity: 300, lead: 30, note: "Includes fit and PP sample, EXW Porto.",
  answer: "Yes, we can reserve the lot for six months.",
});
await sendQuote(secondFactory, secondFactoryOrg, shirting, {
  price: 1890, quantity: 300, lead: 38, note: "Fit sample included; PP sample at cost.",
  answer: "For three months, with a deposit on the fabric.",
});

// A conversation, so the request card's third metric is a real number.
const thread = must(await brand.client.rpc("open_rfq_thread", { target_rfq: shirting.id, factory_org: factoryOrg.id }), "thread");
const threadId = thread?.id ?? thread;
must(await brand.client.from("messages").insert({
  thread_id: threadId, sender_org_id: brandOrg.id, sender_user_id: brand.id,
  body: "Could you confirm the lab dip timing before we award?",
}), "message");

// A message held for review: the brand asks to move to WeChat. It is saved to
// be checked first, and the verdict is recorded with the secret key, as the
// server does. The brand sees it in the thread; the factory sees nothing of
// it until staff release it.
const heldMessage = must(await brand.client.from("messages").insert({
  thread_id: threadId, sender_org_id: brandOrg.id, sender_user_id: brand.id,
  body: "Easier to sort the details on WeChat, my ID is demo_brand_88.",
  delivery: "checking",
}).select("id").single(), "message to check");
must(await admin.rpc("record_message_screening", {
  target_message: heldMessage.id, outcome: "held", method: "pattern", reason: "WeChat ID",
}), "hold the message");
console.log("a message held for review, on the request conversation above");

console.log("orders");
// 1. Waiting for its production steps, the state right after an award.
const merino = await publishRequest({
  title: "Merino knit capsule",
  brief: "Fine-gauge merino blend tops and cardigans, visible sample-room support.",
  quantity: 180,
  colours: [["Oatmeal", 90], ["Charcoal", 90]],
  material: "Extra-fine merino blend, 14 gauge",
  samples: "Knit-down and fit sample",
  extra: "Recycled hangtags. Fold and polybag each piece.",
  month: "2027-01-01",
  tags: [["product_category", "womenswear"], ["region", "portugal"]],
  question: "Can you knit both colours from one yarn lot?",
});
await award(await sendQuote(factory, factoryOrg, merino, {
  price: 3400, quantity: 180, lead: 35, note: "Merino capsule, includes knit-down.",
}));

// 2. Running: steps agreed, the factory has posted an update on the first one
// and sent it for approval, and the brand has written on the order's thread.
const linen = await publishRequest({
  title: "Linen overshirt, SS27",
  brief: "200 garment-washed linen overshirts with patch pockets. Fit sample before bulk.",
  quantity: 200,
  colours: [["Sand", 100], ["Olive", 100]],
  material: "Washed European linen, 190 gsm",
  samples: "Fit sample before bulk",
  extra: "Corozo buttons. Size label and care label on the side seam.",
  month: "2027-02-01",
  tags: [["product_category", "menswear"], ["product_category", "outerwear"], ["region", "portugal"]],
  question: "Can you garment-wash in house?",
});
let running = await award(await sendQuote(factory, factoryOrg, linen, {
  price: 2900, quantity: 200, lead: 32, note: "Garment wash in house, EXW Porto.",
}));
// The brand confirms the steps. Where the factory still has to agree as well
// (the rule before the brand set the steps alone), it does.
must(await brand.client.rpc("agree_schedule", { target_order: running.id, revision: running.schedule_revision }), "brand agrees the steps");
running = must(await admin.from("production_orders").select("*").eq("id", running.id).single(), "the running order");
if (running.status === "pending_schedule") {
  must(await factory.client.rpc("agree_schedule", { target_order: running.id, revision: running.schedule_revision }), "factory agrees the steps");
}
const firstStep = must(await admin.from("order_milestones").select("id, title")
  .eq("order_id", running.id).eq("state", "active").order("sort").limit(1).single(), "the first open step");
must(await factory.client.rpc("post_milestone_update", {
  target_milestone: firstStep.id,
  body: "Fit sample is sewn in the washed linen. Pocket placement and collar checked against the tech pack.",
  document_ids: [],
}), "factory update");
must(await factory.client.rpc("submit_milestone", { target_milestone: firstStep.id }), "send the step for approval");
const orderThread = must(await brand.client.rpc("open_order_thread", { target_order: running.id }), "order thread");
must(await brand.client.from("messages").insert({
  thread_id: orderThread?.id ?? orderThread, sender_org_id: brandOrg.id, sender_user_id: brand.id,
  body: "Thanks, we'll review the fit sample today.",
}), "order message");

// 3. Cancelled by both sides, so the Closed tab and archiving have an order.
const tote = await publishRequest({
  title: "Cotton canvas tote",
  brief: "500 heavy canvas totes with a screen-printed logo.",
  quantity: 500,
  colours: [["Natural", 500]],
  material: "12 oz organic cotton canvas",
  samples: "One pre-production sample",
  extra: "Two-colour screen print on one side.",
  month: "2026-12-01",
  tags: [["product_category", "accessories"], ["region", "portugal"]],
  question: "Can you print in house?",
});
const cancelled = await award(await sendQuote(factory, factoryOrg, tote, {
  price: 650, quantity: 500, lead: 21, note: "Printing in house.",
}));
must(await brand.client.rpc("propose_cancellation", { target_order: cancelled.id, reason: "The season's tote was dropped." }), "propose cancelling");
must(await factory.client.rpc("accept_cancellation", { target_order: cancelled.id }), "accept the cancellation");

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
  factory  ${secondFactoryEmail}   (a second factory, with a competing quote)
  password ${PASSWORD}

  The brand has:
    - "${shirting.title}": open, with two quotes to compare
    - "${merino.title}": an order waiting for its production steps
    - "${linen.title}": a running order, its first step sent for approval
    - "${tote.title}": an order cancelled by both sides
`);
