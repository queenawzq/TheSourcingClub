/**
 * A populated marketplace with fixed demo logins, for looking at screens.
 *
 *   supabase start
 *   npm run seed:demo
 *
 * The suites prove behaviour; this exists so a human (or Claude in Chrome) can
 * open the app and SEE a dashboard with real requests, quotes and an order on
 * it. The logins never change, so a tester can keep them:
 *
 *   demo-brand@example.com        the brand, with every request and order below
 *   demo-factory@example.com      the factory that quoted and runs the orders
 *   demo-factory-two@example.com  a second factory, with a competing quote
 *   demo-factory-new@example.com  a factory waiting for verification
 *   demo-admin@example.com        a platform admin, for /admin.html
 *
 * All use the password "demo password 8". The list lives in
 * src/shared/demo-logins.mjs, which the test sites' one-click sign-in reads
 * too: a scenario that needs an account of its own adds it there, and its
 * setup below. The first two are the logins
 * supabase/seed.sql already makes, so after `supabase db reset` this fills
 * those accounts rather than making new ones.
 *
 * Every run ends in the same state. The demo users are kept (their password is
 * set back), but the demo companies, and every order one of them is part of,
 * are deleted and built again. Run it again to reset the demo data.
 *
 * It needs the service key and creates confirmed users without email round
 * trips, so it only runs against a local stack, or a test database named on
 * purpose with --remote:
 *
 *   SUPABASE_URL=… SUPABASE_ANON_KEY=… SUPABASE_SERVICE_KEY=… npm run seed:demo -- --remote
 *
 * It refuses the production project outright.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { DEMO_LOGINS as LOGINS, DEMO_PASSWORD as PASSWORD } from "../src/shared/demo-logins.mjs";
import { dateIn, zonedTime } from "../src/shared/call-time.mjs";

const PRODUCTION_REF = "wxzliajdtwekqdvwzqfb";

function localStack() {
  try {
    return JSON.parse(execFileSync("npx", ["supabase", "status", "-o", "json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }));
  } catch {
    return {};
  }
}

const fromEnv = process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_SERVICE_KEY;
const stack = fromEnv ? {} : localStack();
const URL = process.env.SUPABASE_URL ?? stack.API_URL;
const ANON = process.env.SUPABASE_ANON_KEY ?? stack.PUBLISHABLE_KEY ?? stack.ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_KEY ?? stack.SECRET_KEY ?? stack.SERVICE_ROLE_KEY;
if (!URL || !ANON || !SERVICE) {
  console.error("No Supabase to seed. Run `supabase start` first, or set SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_KEY.");
  process.exit(1);
}

// A JWT-style key names its project in the payload; the newer sb_secret_ keys
// don't, so the URL check is the one that always applies.
function keyRef(key) {
  try {
    return JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString()).ref ?? null;
  } catch {
    return null;
  }
}
if (URL.includes(PRODUCTION_REF) || keyRef(SERVICE) === PRODUCTION_REF) {
  console.error("Refusing to seed: that is the production database.");
  process.exit(1);
}
const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|$)/.test(URL);
if (!isLocal && !process.argv.includes("--remote")) {
  console.error(`Refusing to seed ${new globalThis.URL(URL).host} without --remote. Pass it only for a test database.`);
  process.exit(1);
}

const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

const must = ({ data, error }, what) => {
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
};

/**
 * The demo user, made once and kept: an existing one gets its password back
 * (a tester may have changed it) and is unblocked (the admin console can
 * disable users).
 */
async function demoUser({ email, name }) {
  const existing = must(await admin.from("user_profiles").select("id").eq("email", email).maybeSingle(), `look up ${email}`);
  if (existing) {
    must(await admin.auth.admin.updateUserById(existing.id, {
      password: PASSWORD, email_confirm: true, ban_duration: "none",
    }), `reset ${email}`);
  } else {
    must(await admin.auth.admin.createUser({
      email, password: PASSWORD, email_confirm: true, user_metadata: { name },
    }), `create ${email}`);
  }
  const client = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`sign in as ${email}: ${error.message}`);
  const { data } = await client.auth.getUser();
  return { client, id: data.user.id, email };
}

console.log("\ndemo logins");
const brand = await demoUser(LOGINS.brand);
const factory = await demoUser(LOGINS.factory);
const secondFactory = await demoUser(LOGINS.secondFactory);
const newFactory = await demoUser(LOGINS.newFactory);
const newBrand = await demoUser(LOGINS.newBrand);
const tradingCompany = await demoUser(LOGINS.tradingCompany);
const adminUser = await demoUser(LOGINS.admin);
const demoUsers = { brand, factory, secondFactory, newFactory, newBrand, tradingCompany, admin: adminUser };
// Every login in the shared list gets a sign-in button on the test sites, so
// one with no setup here would be a button that fails.
const unseeded = Object.keys(LOGINS).filter((key) => !demoUsers[key]);
if (unseeded.length) {
  throw new Error(`demo-logins.mjs lists ${unseeded.join(", ")}, which this script does not set up yet`);
}
const demoUserIds = Object.values(demoUsers).map((user) => user.id);

// The companies only demo users belong to. A company someone else is also a
// member of (a tester who invited a demo login) is left alone.
const memberships = must(await admin.from("org_members").select("org_id").in("user_id", demoUserIds), "demo memberships");
const candidates = [...new Set(memberships.map((m) => m.org_id))];
const everyone = candidates.length
  ? must(await admin.from("org_members").select("org_id, user_id").in("org_id", candidates), "their members")
  : [];
const demoOrgIds = candidates.filter((org) =>
  everyone.filter((m) => m.org_id === org).every((m) => demoUserIds.includes(m.user_id)));

// Orders keep their request, quote and both companies from being deleted, so
// they go first; deleting the companies then takes their requests, quotes,
// threads, credits, codes and notifications with them.
if (demoOrgIds.length) {
  const list = `(${demoOrgIds.join(",")})`;
  // Deleting a company deletes its document rows but not the files behind
  // them, so the files go first.
  const files = must(await admin.from("documents").select("bucket, storage_path").in("org_id", demoOrgIds), "demo files");
  for (const bucket of new Set(files.map((file) => file.bucket))) {
    const paths = files.filter((file) => file.bucket === bucket).map((file) => file.storage_path);
    if (paths.length) must(await admin.storage.from(bucket).remove(paths), `clear demo files in ${bucket}`);
  }
  const orders = must(await admin.from("production_orders").delete()
    .or(`brand_org_id.in.${list},factory_org_id.in.${list}`).select("id"), "clear demo orders");
  must(await admin.from("orgs").delete().in("id", demoOrgIds), "clear demo companies");
  console.log(`cleared ${demoOrgIds.length} demo companies and ${orders.length} orders`);
}

must(await admin.from("platform_admins").upsert({ user_id: adminUser.id, note: "demo admin" }), "demo admin");

const brandOrg = must(await brand.client.rpc("create_org", { org_name: LOGINS.brand.name, org_kind: "brand" }), "create brand org");
const factoryOrg = must(await factory.client.rpc("create_org", { org_name: LOGINS.factory.name, org_kind: "factory" }), "create factory org");

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
  legal_name: "Demo Factory",
  website_url: "https://demofactory.example.com",
  country_code: "PT",
  location: "Porto, Portugal",
  nearest_port: "Port of Leixoes",
  founded_year: 2012,
  employee_count: 85,
  moq: 150,
  typical_lead_days: 28,
  sample_lead_days: 10,
  equipment_notes: "Single-needle lockstitch, Overlock, Automatic buttonholer, Fusing press",
  intro: "Woven shirting and light outerwear, small runs. We pattern, sample and sew in-house, and send photo updates at every step.",
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

// The demo factory's profile, filled in the way onboarding fills it, through
// its own login: production-fit tags, capacity, references, certifications and
// sample images. Its profile page (/profile) shows all of it.
console.log("factory profile");
const factoryTags = [
  ["manufacturing_model", "oem"], ["manufacturing_model", "full-package"],
  ["production_type", "wovens"], ["production_type", "cut-sew-knits"],
  ["product_category", "tops"], ["product_category", "outerwear"], ["product_category", "dresses-jumpsuits"],
  ["make", "button-down-shirts"], ["make", "poplin-blouses"], ["make", "lightweight-jackets"],
  ["market_level", "premium-contemporary"],
  ["specialty", "organic-poplin-shirts"], ["specialty", "fit-sample-pp-sample"], ["specialty", "low-moq-sampling"],
  ["design_service", "pattern-making"], ["design_service", "sample-development"], ["design_service", "tech-pack-support"],
  ["region", "europe"], ["region", "united-states"],
  ["digital_tool", "clo-3d"], ["digital_tool", "gerber"],
];
must(await factory.client.from("taxonomy_links").insert(await Promise.all(factoryTags.map(async ([kind, slug]) => ({
  subject_type: "factory_profile", subject_id: factoryOrg.id, org_id: factoryOrg.id, term_id: await termId(kind, slug),
})))), "factory profile tags");
must(await factory.client.from("factory_capacity").insert({
  org_id: factoryOrg.id, category_term_id: await termId("capacity_category", "wovens"), input_mode: "units", monthly_units: 6000,
}), "factory capacity");
const firstOfMonth = (offset) => {
  const date = new Date();
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1)).toISOString().slice(0, 10);
};
must(await factory.client.from("factory_capacity_months").insert(
  ["open", "partial", "partial", "full", "open", "open"].map((level, offset) => ({ org_id: factoryOrg.id, month: firstOfMonth(offset), level })),
), "factory booking calendar");
must(await factory.client.from("profile_references").insert(
  ["Northline Studio", "Elara Studio", "Harbour & Co"].map((title, sort) => ({ org_id: factoryOrg.id, title, sort })),
), "factory references");
const [oekoTex] = must(await factory.client.from("factory_certifications").insert([
  { org_id: factoryOrg.id, term_id: await termId("certification", "oeko-tex-standard-100") },
  { org_id: factoryOrg.id, term_id: await termId("certification", "gots") },
]).select("id"), "factory certifications");
// OEKO-TEX has its certificate uploaded and waiting for an admin, the way the
// profile's upload leaves it; GOTS has none. So the profile's completion page
// shows an item in review and one that needs attention.
{
  const name = "OEKO-TEX certificate.pdf";
  const path = `${factoryOrg.id}/certificate/${crypto.randomUUID()}-${name.replace(/\s+/g, "-")}`;
  const bytes = new TextEncoder().encode(
    "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n"
    + "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 120]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
  );
  must(await factory.client.storage.from("org-private").upload(path, bytes, { contentType: "application/pdf" }), `upload ${name}`);
  const certificate = must(await factory.client.from("documents").insert({
    org_id: factoryOrg.id, kind: "certificate", bucket: "org-private", storage_path: path,
    file_name: name, mime_type: "application/pdf", size_bytes: bytes.length, status: "pending",
  }).select("id").single(), `record ${name}`);
  must(await factory.client.from("factory_certifications")
    .update({ document_id: certificate.id, status: "pending" }).eq("id", oekoTex.id), "attach the OEKO-TEX certificate");

  // The business registration behind the verified profile, as TSC's review
  // leaves it, so the verification dialog has a file to show.
  const registrationName = "Business registration.pdf";
  const registrationPath = `${factoryOrg.id}/business_registration/${crypto.randomUUID()}-Business-registration.pdf`;
  must(await factory.client.storage.from("org-private").upload(registrationPath, bytes, { contentType: "application/pdf" }), `upload ${registrationName}`);
  must(await admin.from("documents").insert({
    org_id: factoryOrg.id, kind: "business_registration", bucket: "org-private", storage_path: registrationPath,
    file_name: registrationName, mime_type: "application/pdf", size_bytes: bytes.length, status: "verified",
    reviewed_at: new Date().toISOString(),
  }), `record ${registrationName}`);
}
// The repo's own sample-garment photos, uploaded as the factory's sample
// images, the way the profile's image upload stores them (public bucket).
// Each with the name and description the profile's image dialog gives it.
for (const [file, name, caption] of [
  ["dashboard-rfq-shirt.jpg", "Organic cotton poplin shirt.jpg", "Wovens · MOQ 150"],
  ["dashboard-rfq-knit.jpg", "Fine-gauge knit capsule.jpg", "Knitwear · sample room"],
  ["dashboard-rfq-denim.jpg", "Denim jacket development.jpg", "Denim · wash sample"],
]) {
  const path = `${factoryOrg.id}/product_image/${crypto.randomUUID()}-${name.replace(/\s+/g, "-")}`;
  const bytes = readFileSync(new globalThis.URL(`../assets/${file}`, import.meta.url));
  must(await factory.client.storage.from("org-public").upload(path, bytes, { contentType: "image/jpeg" }), `upload ${name}`);
  must(await factory.client.from("documents").insert({
    org_id: factoryOrg.id, kind: "product_image", bucket: "org-public", storage_path: path,
    file_name: name, mime_type: "image/jpeg", size_bytes: bytes.length,
    title: name.replace(/\.jpg$/, ""), caption,
  }), `record ${name}`);
}

// The demo brand's profile, filled in the way brand onboarding fills it,
// through its own login: the answers, tags, brand images, a pending invitation
// for a second decision maker, and the verified registration behind its
// verified status. Its profile page (/profile) shows all of it, and a factory
// that can see one of its requests reads the vendor-safe part.
console.log("brand profile");
must(await brand.client.from("brand_profiles").update({
  legal_name: LOGINS.brand.name,
  business_email: "hello@demobrand.example.com",
  website_url: "https://demobrand.example.com",
  founded_year: 2019,
  brand_category: "direct-to-consumer-brand",
  intro: "London womenswear label making organic cotton shirts and light outerwear in small, repeatable runs. We send full tech packs, approve samples within a week and reorder the styles that sell.",
  annual_revenue_band: "$1M-$5M",
  pieces_per_year_band: "5,000-20,000 pieces",
  order_size_band: "300-1,000 pieces per style",
  collections_per_year: "3-4",
  reorder_cadence: "Quarterly reorders",
  sourcing_stage: "Producing now",
  target_price_min_cents: 1200,
  target_price_max_cents: 2800,
}).eq("org_id", brandOrg.id), "brand profile answers");
const brandTags = [
  ["brand_category", "direct-to-consumer-brand"], ["brand_category", "wholesale-brand"],
  ["product_category", "womenswear"], ["product_category", "tops"], ["product_category", "outerwear"],
  ["market_level", "premium-contemporary"],
  ["region", "portugal"], ["region", "europe"], ["region", "china"],
  ["certification", "gots"], ["certification", "oeko-tex-standard-100"],
  ["service", "full-package"], ["service", "sample-development"],
];
must(await brand.client.from("taxonomy_links").insert(await Promise.all(brandTags.map(async ([kind, slug]) => ({
  subject_type: "brand_profile", subject_id: brandOrg.id, org_id: brandOrg.id, term_id: await termId(kind, slug),
})))), "brand profile tags");
for (const [file, name, caption] of [
  ["moodboard-warm-clay.jpg", "SS27 colour story.jpg", "Moodboard · warm clay and sand"],
  ["moodboard-soft-concrete.jpg", "Poplin shirt references.jpg", "Wovens · fit and finish"],
  ["moodboard-internet-blue.jpg", "Outerwear direction.jpg", "Light outerwear · trims"],
]) {
  const path = `${brandOrg.id}/product_image/${crypto.randomUUID()}-${name.replace(/\s+/g, "-")}`;
  const bytes = readFileSync(new globalThis.URL(`../assets/${file}`, import.meta.url));
  must(await brand.client.storage.from("org-public").upload(path, bytes, { contentType: "image/jpeg" }), `upload ${name}`);
  must(await brand.client.from("documents").insert({
    org_id: brandOrg.id, kind: "product_image", bucket: "org-public", storage_path: path,
    file_name: name, mime_type: "image/jpeg", size_bytes: bytes.length,
    title: name.replace(/\.jpg$/, ""), caption,
  }), `record ${name}`);
}
must(await brand.client.from("org_invitations").insert({
  org_id: brandOrg.id, email: "production@demobrand.example.com", role: "member",
}), "brand decision maker invitation");
{
  const name = "Business registration.pdf";
  const path = `${brandOrg.id}/business_registration/${crypto.randomUUID()}-Business-registration.pdf`;
  const bytes = new TextEncoder().encode(
    "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n"
    + "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 120]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
  );
  must(await brand.client.storage.from("org-private").upload(path, bytes, { contentType: "application/pdf" }), `upload brand ${name}`);
  must(await admin.from("documents").insert({
    org_id: brandOrg.id, kind: "business_registration", bucket: "org-private", storage_path: path,
    file_name: name, mime_type: "application/pdf", size_bytes: bytes.length, status: "verified",
    reviewed_at: new Date().toISOString(),
  }), `record brand ${name}`);
}

// A second verified factory, so a request can have two quotes to compare.
const secondFactoryOrg = must(await secondFactory.client.rpc("create_org", { org_name: LOGINS.secondFactory.name, org_kind: "factory" }), "create second factory org");
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
// Its profile filled in through its own login, so Browse vendors has a second
// full card and its filters (production type, price, location, lead time,
// certifications, open capacity) tell the two factories apart.
const secondFactoryTags = [
  ["manufacturing_model", "cmt"], ["production_type", "wovens"],
  ["product_category", "tops"], ["product_category", "bottoms"], ["product_category", "menswear"],
  ["make", "linen-co-ords"], ["make", "button-down-shirts"],
  ["market_level", "mid-range"],
  ["specialty", "wash-development"], ["specialty", "small-batch-production"], ["specialty", "trim-sourcing"],
];
must(await secondFactory.client.from("taxonomy_links").insert(await Promise.all(secondFactoryTags.map(async ([kind, slug]) => ({
  subject_type: "factory_profile", subject_id: secondFactoryOrg.id, org_id: secondFactoryOrg.id, term_id: await termId(kind, slug),
})))), "second factory tags");
must(await secondFactory.client.from("factory_capacity").insert({
  org_id: secondFactoryOrg.id, category_term_id: await termId("capacity_category", "wovens"), input_mode: "units", monthly_units: 2400,
}), "second factory capacity");
must(await secondFactory.client.from("factory_capacity_months").insert(
  ["full", "open", "open", "partial", "partial", "open"].map((level, offset) => ({ org_id: secondFactoryOrg.id, month: firstOfMonth(offset), level })),
), "second factory booking calendar");
must(await secondFactory.client.from("factory_certifications").insert([
  { org_id: secondFactoryOrg.id, term_id: await termId("certification", "bsci") },
  { org_id: secondFactoryOrg.id, term_id: await termId("certification", "grs") },
]), "second factory certifications");
for (const [file, name, caption] of [
  ["dashboard-rfq-shirt.jpg", "Washed linen shirt.jpg", "Wovens · garment wash"],
  ["dashboard-rfq-denim.jpg", "Linen trouser fit sample.jpg", "Bottoms · fit sample"],
]) {
  const path = `${secondFactoryOrg.id}/product_image/${crypto.randomUUID()}-${name.replace(/\s+/g, "-")}`;
  const bytes = readFileSync(new globalThis.URL(`../assets/${file}`, import.meta.url));
  must(await secondFactory.client.storage.from("org-public").upload(path, bytes, { contentType: "image/jpeg" }), `upload ${name}`);
  must(await secondFactory.client.from("documents").insert({
    org_id: secondFactoryOrg.id, kind: "product_image", bucket: "org-public", storage_path: path,
    file_name: name, mime_type: "image/jpeg", size_bytes: bytes.length,
    title: name.replace(/\.jpg$/, ""), caption,
  }), `record ${name}`);
}

// A factory that finished onboarding and waits for a decision: the admin
// console's verification queue has it, and its own login sees "in review".
const newFactoryOrg = must(await newFactory.client.rpc("create_org", { org_name: LOGINS.newFactory.name, org_kind: "factory" }), "create new factory org");
must(await admin.from("factory_profiles").upsert({
  org_id: newFactoryOrg.id,
  legal_name: "Atlas Knit Studio Ltd",
  website_url: "https://atlasknit.example.com",
  country_code: "GB",
  location: "Leicester, UK",
  founded_year: 2014,
  moq: 100,
  typical_lead_days: 30,
  intro: "Circular and flat knitwear, 100-unit minimums, sampling in a week.",
  onboarding_completed_at: new Date().toISOString(),
  verification_status: "pending",
}), "new factory profile");

// A brand that has just finished onboarding: no requests and no orders, so
// its dashboard shows the newcomer layout and its "Recommended factories".
// Its product focus (tops, dresses) is what those are ranked by.
console.log("new brand and trading company");
const newBrandOrg = must(await newBrand.client.rpc("create_org", { org_name: LOGINS.newBrand.name, org_kind: "brand" }), "create new brand org");
must(await admin.from("brand_profiles").upsert({
  org_id: newBrandOrg.id,
  hq_location: "Copenhagen, Denmark",
  onboarding_completed_at: new Date().toISOString(),
  verification_status: "verified",
}), "new brand profile");
must(await newBrand.client.from("taxonomy_links").insert(await Promise.all(
  [["product_category", "tops"], ["product_category", "dresses-jumpsuits"]].map(async ([kind, slug]) => ({
    subject_type: "brand_profile", subject_id: newBrandOrg.id, org_id: newBrandOrg.id, term_id: await termId(kind, slug),
  })),
)), "new brand product focus");

// A verified trading company, its profile filled in the way the trading
// onboarding fills it (its own questions, columns and tags), through its own
// login: so its profile page (/profile) has everything on it, and brands find
// it in the invite step and on the newcomer dashboard.
const tradingOrg = must(await tradingCompany.client.rpc("create_org", { org_name: LOGINS.tradingCompany.name, org_kind: "factory" }), "create trading company org");
must(await admin.from("factory_profiles").upsert({
  org_id: tradingOrg.id,
  vendor_kind: "trading_company",
  legal_name: "Kowloon Sourcing Partners",
  website_url: "https://kowloonsourcing.example.com",
  country_code: "HK",
  location: "Hong Kong / Shenzhen, China",
  founded_year: 2015,
  employee_count: 25,
  languages_supported: "English, Mandarin, Cantonese",
  moq: 300,
  typical_lead_days: 50,
  typical_order_value_band: "$15,000-$100,000",
  partner_factory_count: 18,
  supported_incoterms: "FOB · EXW · DDP",
  typical_payment_terms: "30% deposit · 70% before shipment",
  equipment_notes: "Packaging development, Freight consolidation",
  intro: "Apparel sourcing and production management for premium brands. We match each style to one of 18 partner factories in China and Portugal, run sampling and costing, and inspect in line and before shipment.",
  onboarding_completed_at: new Date().toISOString(),
  verification_status: "verified",
  published_at: new Date().toISOString(),
}), "trading company profile");
must(await admin.from("credit_ledger").insert({
  org_id: tradingOrg.id, delta: 500, reason: "onboarding_grant", note: "demo seed",
}), "trading company credits");
const tradingTags = [
  ["production_program", "oem"], ["production_program", "full-package"], ["production_program", "small-batch"],
  ["production_type", "wovens"], ["production_type", "cut-sew-knits"],
  ["product_category", "tops"], ["product_category", "dresses-jumpsuits"], ["product_category", "outerwear"],
  ["make", "button-down-shirts"], ["make", "woven-dresses"],
  ["sourcing_region", "china"], ["sourcing_region", "portugal"],
  ["market_level", "premium-contemporary"],
  ["core_service", "supplier-matching"], ["core_service", "sample-management"], ["core_service", "production-management"],
  ["product_development", "tech-pack-support"], ["product_development", "material-sourcing"],
  ["quality_compliance", "factory-verification"], ["quality_compliance", "in-line-inspection"], ["quality_compliance", "final-inspection"],
  ["region", "united-states"], ["region", "europe"],
];
must(await tradingCompany.client.from("taxonomy_links").insert(await Promise.all(tradingTags.map(async ([kind, slug]) => ({
  subject_type: "factory_profile", subject_id: tradingOrg.id, org_id: tradingOrg.id, term_id: await termId(kind, slug),
})))), "trading company tags");
must(await tradingCompany.client.from("profile_references").insert(
  ["Northline Studio", "Maison Ora"].map((title, sort) => ({ org_id: tradingOrg.id, title, sort })),
), "trading company references");
must(await tradingCompany.client.from("factory_certifications").insert(
  { org_id: tradingOrg.id, term_id: await termId("certification", "bsci") },
), "trading company certification");
for (const [file, name, caption] of [
  ["dashboard-rfq-shirt.jpg", "Organic cotton shirt program.jpg", "Supplier matching · sampling · QC"],
  ["dashboard-rfq-knit.jpg", "Premium knit capsule.jpg", "Yarn sourcing · production management"],
  ["dashboard-rfq-denim.jpg", "Denim wash development.jpg", "Factory verification · final inspection"],
]) {
  const path = `${tradingOrg.id}/product_image/${crypto.randomUUID()}-${name.replace(/\s+/g, "-")}`;
  const bytes = readFileSync(new globalThis.URL(`../assets/${file}`, import.meta.url));
  must(await tradingCompany.client.storage.from("org-public").upload(path, bytes, { contentType: "image/jpeg" }), `upload ${name}`);
  must(await tradingCompany.client.from("documents").insert({
    org_id: tradingOrg.id, kind: "product_image", bucket: "org-public", storage_path: path,
    file_name: name, mime_type: "image/jpeg", size_bytes: bytes.length,
    title: name.replace(/\.jpg$/, ""), caption,
  }), `record ${name}`);
}

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
    quote_id: quote.id, stage: "Fit sample", cost_cents: 6500, timing_days: 10, sort: 0,
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
// A user's message is saved to be checked first (the database insists), and
// the screen delivers it, as api/screen-message.js does with the secret key.
const deliverMessage = async (message, label) => must(await admin.rpc("record_message_screening", {
  target_message: message.id, outcome: "delivered", method: "pattern_only",
}), label);
await deliverMessage(must(await brand.client.from("messages").insert({
  thread_id: threadId, sender_org_id: brandOrg.id, sender_user_id: brand.id,
  body: "Could you confirm the lab dip timing before we award?",
}).select("id").single(), "message"), "deliver the message");

// The factory keeps the brand on its Saved page (Saved brands), the way its
// profile's "Save brand" does. It can: it sees the brand's open request.
must(await factory.client.from("saved_brands").insert({
  org_id: factoryOrg.id, brand_org_id: brandOrg.id, saved_by: factory.id,
}), "factory saves the brand");

// A message staff already turned down: the brand shared an email address. It
// was held, then rejected with a reason, so the brand sees "Not delivered"
// and has the notification; the factory never saw it.
const rejectedMessage = must(await brand.client.from("messages").insert({
  thread_id: threadId, sender_org_id: brandOrg.id, sender_user_id: brand.id,
  body: "You can also email me directly at sourcing@demo-brand.example.",
}).select("id").single(), "message to reject");
must(await admin.rpc("record_message_screening", {
  target_message: rejectedMessage.id, outcome: "held", method: "pattern", reason: "email address",
}), "hold the message to reject");
must(await adminUser.client.rpc("reject_held_message", {
  target_message: rejectedMessage.id,
  note: "Email addresses can't be shared here. Please keep the conversation on The Sourcing Club.",
}), "reject the message");

// A message held for review: the brand asks to move to WeChat. It is saved to
// be checked first, like every message, and the verdict is recorded with the secret key, as the
// server does. The brand sees it in the thread; the factory sees nothing of
// it until staff release it.
const heldMessage = must(await brand.client.from("messages").insert({
  thread_id: threadId, sender_org_id: brandOrg.id, sender_user_id: brand.id,
  body: "Easier to sort the details on WeChat, my ID is demo_brand_88.",
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
await deliverMessage(must(await brand.client.from("messages").insert({
  thread_id: orderThread?.id ?? orderThread, sender_org_id: brandOrg.id, sender_user_id: brand.id,
  body: "Thanks, we'll review the fit sample today.",
}).select("id").single(), "order message"), "deliver the order message");

// Calls, through each company's own login, so every notification is the real
// one. The brand works in New York and the factory in Porto, so each side
// reads the other's time. The factory invites the brand to a fit-sample call
// on the order (waiting on the brand: Accept / Propose another time /
// Decline); a call on the shirting request is confirmed for tomorrow; and an
// earlier invite on the order was declined with a reason.
console.log("calls");
const BRAND_ZONE = "America/New_York";
const FACTORY_ZONE = "Europe/Lisbon";
must(await brand.client.rpc("set_my_time_zone", { zone: BRAND_ZONE }), "brand's time zone");
must(await factory.client.rpc("set_my_time_zone", { zone: FACTORY_ZONE }), "factory's time zone");
const daysAhead = (days, minutes, zone) => {
  const { year, month, day } = dateIn(new Date(Date.now() + days * 86400000), zone);
  return zonedTime(year, month, day, minutes, zone).toISOString();
};
const orderThreadId = orderThread?.id ?? orderThread;
must(await factory.client.rpc("propose_call", {
  target_thread: orderThreadId, starts_at: daysAhead(2, 15 * 60, FACTORY_ZONE), duration_minutes: 30,
  title: "Fit sample review", agenda: "Walk through the washed-linen fit sample on camera: collar, pockets, sleeve length.",
  time_zone: FACTORY_ZONE,
}), "factory invites the brand to a call");
const kickoff = must(await brand.client.rpc("propose_call", {
  target_thread: threadId, starts_at: daysAhead(1, 10 * 60, BRAND_ZONE), duration_minutes: 30,
  title: "Shirting questions", agenda: "Lab dip timing and the three-month price hold.",
  time_zone: BRAND_ZONE,
}), "brand proposes a call on the request");
must(await factory.client.rpc("accept_call", { target_call: kickoff.id, time_zone: FACTORY_ZONE }), "factory accepts");
const washTest = must(await brand.client.rpc("propose_call", {
  target_thread: orderThreadId, starts_at: daysAhead(3, 9 * 60, BRAND_ZONE), duration_minutes: 30,
  title: "Wash test results", agenda: null, time_zone: BRAND_ZONE,
}), "brand proposes an early call");
must(await factory.client.rpc("decline_call", {
  target_call: washTest.id, note: "Too early for Porto, and the wash test is not back yet.",
}), "factory declines it");

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

// Two running orders with a cancellation waiting on an answer, so both
// sides' cancel banners can be seen without clicking one into being: on the
// first the factory proposed (the brand sees Accept / Keep order), on the
// second the brand did (the brand sees Withdraw). Each goes request → quote →
// award → steps confirmed → proposed, through the companies' own logins.
console.log("orders with a cancellation proposed");
async function orderWithCancelProposed({ title, brief, quantity, unitPrice, proposer, reason }) {
  const { id: rfqId } = must(await brand.client
    .from("rfqs")
    .insert({ brand_org_id: brandOrg.id, status: "draft", visibility: "open_to_all" })
    .select("id")
    .single(), `draft: ${title}`);
  must(await brand.client.from("rfqs").update({
    title,
    brief,
    quantity_total: quantity,
    requires_sample: true,
    quote_deadline: new Date(Date.now() + 12 * 864e5).toISOString(),
    status: "open",
    published_at: new Date().toISOString(),
  }).eq("id", rfqId), `publish: ${title}`);
  const { id: quoteId } = must(await factory.client.from("quotes").insert({
    rfq_id: rfqId,
    factory_org_id: factoryOrg.id,
    unit_price_cents: unitPrice,
    production_quantity: quantity,
    bulk_lead_time_days: 30,
    deposit_pct: 30,
    balance_pct: 70,
    payment_term_id: paymentTermId,
    incoterm_id: incotermId,
    valid_until: validUntil,
  }).select("id").single(), `quote: ${title}`);
  must(await factory.client.from("quote_sample_lines").insert({
    quote_id: quoteId, stage: "Fit sample", cost_cents: 5000, timing_days: 10, sort: 0,
  }), `sample line: ${title}`);
  must(await factory.client.rpc("submit_quote", { quote_id: quoteId }), `submit: ${title}`);
  must(await brand.client.rpc("award_quote", { quote_id: quoteId }), `award: ${title}`);
  const order = must(await brand.client.from("production_orders")
    .select("id, schedule_revision").eq("quote_id", quoteId).single(), `order: ${title}`);
  // The brand confirms the steps, which starts the order; the factory agrees
  // only where the schema still asks it to.
  must(await brand.client.rpc("agree_schedule", { target_order: order.id, revision: order.schedule_revision }), `brand confirms: ${title}`);
  const { data: after } = await brand.client.from("production_orders").select("status").eq("id", order.id).single();
  if (after?.status === "pending_schedule") {
    must(await vendor.client.rpc("agree_schedule", { target_order: order.id, revision: order.schedule_revision }), `factory agrees: ${title}`);
  }
  must(await proposer.client.rpc("propose_cancellation", { target_order: order.id, reason }), `propose: ${title}`);
}
await orderWithCancelProposed({
  title: "Linen trousers, SS27",
  brief: "220 wide-leg linen trousers, garment-washed. Fit sample before bulk.",
  quantity: 220,
  unitPrice: 2900,
  proposer: factory,
  reason: "Our linen mill has moved the fabric to late March, so we can't hold the delivery date.",
});
await orderWithCancelProposed({
  title: "Recycled nylon windbreaker",
  brief: "150 packable windbreakers in recycled nylon ripstop.",
  quantity: 150,
  unitPrice: 3800,
  proposer: brand,
  reason: "The windbreaker was cut from the AW27 range.",
});

// Payments in each state the brand's Payments page lists. TSC holds the
// money through Stripe: a step's payment falls due as the step opens, the
// brand funds it, and approving the step pays the factory. The seed makes no
// Stripe calls: it records each payment the way the Stripe webhook does,
// through the same service-only functions (record_payment_*), so the states
// are real database states with nothing at Stripe behind them. Paying a
// "Due" or "Failed" one on a test site goes through Stripe test mode for real.
console.log("payments");
// Where staff would pay Demo Factory by bank if it had no Stripe account.
// Plainly not a real account.
must(await factory.client.from("factory_payout_accounts").insert({
  org_id: factoryOrg.id, label: "Demo account", bank_name: "Demo Bank (test data, not a real account)",
  account_name: "Demo Factory", account_number_last4: "0000", bank_country: "PT",
  instructions: "Demo data only. Nothing is ever sent to this account.", is_primary: true,
}), "the factory's payout details");
async function runningOrder({ title, brief, quantity, unitPrice, vendor = factory, vendorOrg = factoryOrg }) {
  const rfq = await publishRequest({
    title, brief, quantity,
    colours: [["Ecru", quantity]],
    material: "As per the tech pack",
    samples: "Fit sample before bulk",
    extra: "",
    month: "2027-03-01",
    tags: [["product_category", "tops"], ["region", "portugal"]],
    question: "Can you hold this price for the reorder?",
  });
  let order = await award(await sendQuote(vendor, vendorOrg, rfq, {
    price: unitPrice, quantity, lead: 30, note: "Fit sample, then bulk.",
  }));
  must(await brand.client.rpc("agree_schedule", { target_order: order.id, revision: order.schedule_revision }), `brand confirms: ${title}`);
  order = must(await admin.from("production_orders").select("*").eq("id", order.id).single(), `order: ${title}`);
  if (order.status === "pending_schedule") {
    must(await vendor.client.rpc("agree_schedule", { target_order: order.id, revision: order.schedule_revision }), `factory agrees: ${title}`);
  }
  return order;
}
const dueNow = async (order, title) => must(await admin.from("order_payments").select("id, state, amount_cents")
  .eq("order_id", order.id).in("state", ["due", "failed"]).single(), `the payment due: ${title}`);
const CARD = ["card", "Visa ···4242"];
const BANK = ["us_bank_account", "STRIPE TEST BANK ···6789"];
/** What the brand is charged: the step plus the fee, as checkout charges it. */
async function charged(payment) {
  const fee = must(await admin.rpc("payment_fee_cents", { target_payment: payment.id }), "the fee");
  const total = Number(payment.amount_cents) + Number(fee);
  must(await admin.rpc("attach_payment_intent", { target_payment: payment.id, payment_intent: null, charged: total }), "the charge");
  return total;
}
const clearing = async (payment, [type, label]) =>
  must(await admin.rpc("record_payment_processing", { target_payment: payment.id, method_type: type, method_label: label }), "a bank payment clearing");
const failed = async (payment, reason) =>
  must(await admin.rpc("record_payment_failed", { target_payment: payment.id, reason }), "a payment that came back");
async function funded(payment, [type, label]) {
  const total = await charged(payment);
  return must(await admin.rpc("record_payment_funded", {
    target_payment: payment.id, charge: null, method_type: type, method_label: label, received: total,
  }), "a payment held by TSC");
}
/** The factory posts on the open step and the brand approves it (it must be funded). */
async function approveOpenStep(order, title, vendor = factory) {
  const step = must(await admin.from("order_milestones").select("id")
    .eq("order_id", order.id).eq("state", "active").order("sort").limit(1).single(), `open step: ${title}`);
  must(await vendor.client.rpc("post_milestone_update", {
    target_milestone: step.id, body: "Fit sample is sewn and measured against the spec sheet.", document_ids: [],
  }), `factory update: ${title}`);
  must(await brand.client.rpc("approve_milestone", { target_milestone: step.id, note: "Fit approved." }), `approve: ${title}`);
}

// 1. Fit sample funded by card, approved and paid to the factory ("Paid";
//    by hand, as staff do for a factory with no Stripe account), then the
//    bulk deposit funded by card: a payment-only step, so it is owed to the
//    factory at once and waits on staff ("Funded", payout pending).
const poplinTitle = "Organic poplin shirt, AW27";
const poplin = await runningOrder({ title: poplinTitle, brief: "160 organic poplin shirts, relaxed fit.", quantity: 160, unitPrice: 2600 });
const poplinFit = await dueNow(poplin, poplinTitle);
await funded(poplinFit, CARD);
await approveOpenStep(poplin, poplinTitle);
must(await adminUser.client.rpc("release_payment_to_factory", { target_payment: poplinFit.id, note: "Demo data: paid out by bank by staff." }), "release the fit sample");
await funded(await dueNow(poplin, poplinTitle), CARD);
// 2. Fit sample funded by card and held while the factory works ("Funded").
const twillTitle = "Cotton twill overshirt, AW27";
const twill = await runningOrder({ title: twillTitle, brief: "140 cotton twill overshirts, garment-dyed.", quantity: 140, unitPrice: 2900 });
await funded(await dueNow(twill, twillTitle), CARD);
// 3. Fit sample paid by bank, clearing ("Processing").
const ribTitle = "Merino rib tank, AW27";
const rib = await runningOrder({ title: ribTitle, brief: "120 fine merino rib tanks.", quantity: 120, unitPrice: 3100 });
const ribFit = await dueNow(rib, ribTitle);
await charged(ribFit);
await clearing(ribFit, BANK);
// 4. A bank payment that came back ("Failed"): the brand pays again.
const chinoTitle = "Stretch chino, AW27";
const chino = await runningOrder({ title: chinoTitle, brief: "200 stretch cotton chinos.", quantity: 200, unitPrice: 2400 });
const chinoFit = await dueNow(chino, chinoTitle);
await charged(chinoFit);
await clearing(chinoFit, BANK);
await failed(chinoFit, "The bank account has been closed.");
// 5. Fit sample owed ("Due").
const denimTitle = "Washed denim jacket, AW27";
await runningOrder({ title: denimTitle, brief: "90 rigid denim jackets, enzyme washed.", quantity: 90, unitPrice: 4800 });
// 6. Ningbo Loomworks is in mainland China, where Stripe cannot pay out: its
//    fit sample is funded and approved, and the payout waits on staff to pay
//    it by bank ("Payout owed" on the staff payments page).
must(await secondFactory.client.from("factory_payout_accounts").insert({
  org_id: secondFactoryOrg.id, label: "Demo account", bank_name: "Demo Bank Ningbo (test data, not a real account)",
  account_name: LOGINS.secondFactory.name, account_number_last4: "0000", bank_country: "CN",
  instructions: "Demo data only. Nothing is ever sent to this account.", is_primary: true,
}), "the second factory's payout details");
const seersuckerTitle = "Seersucker camp shirt, AW27";
const seersucker = await runningOrder({
  title: seersuckerTitle, brief: "180 cotton seersucker camp-collar shirts.", quantity: 180, unitPrice: 1900,
  vendor: secondFactory, vendorOrg: secondFactoryOrg,
});
await funded(await dueNow(seersucker, seersuckerTitle), CARD);
await approveOpenStep(seersucker, seersuckerTitle, secondFactory);

// Dates on the steps not done yet, as a brand sets them on "Production
// steps", so "Next due" on the dashboard and the orders list, and each step's
// due date, show a real day instead of "—". Two weeks apart from today.
console.log("step dates");
const brandOrders = must(await admin.from("production_orders").select("id")
  .eq("brand_org_id", brandOrg.id).in("status", ["pending_schedule", "active"]), "the brand's open orders");
for (const { id } of brandOrders) {
  const steps = must(await admin.from("order_milestones").select("id, state, sort").eq("order_id", id).order("sort"), "steps");
  let n = 0;
  for (const step of steps) {
    if (step.state === "complete" || step.state === "cancelled") continue;
    n += 1;
    const day = new Date(Date.now() + n * 14 * 864e5).toISOString().slice(0, 10);
    must(await admin.from("order_milestones").update({ due_on: day }).eq("id", step.id), "a step's date");
  }
}

// The brand's saved vendors (Saved), saved through its own login.
must(await brand.client.from("saved_factories").insert([
  { org_id: brandOrg.id, factory_org_id: factoryOrg.id, saved_by: brand.id },
  { org_id: brandOrg.id, factory_org_id: tradingOrg.id, saved_by: brand.id },
]), "the brand saves two vendors");

// Credits and a discount code, so the Savings card has real figures.
must(await admin.from("credit_ledger").insert({
  org_id: brandOrg.id, delta: 500, reason: "onboarding_grant", note: "demo seed",
}), "credits");
must(await admin.from("discount_codes").insert({
  code: "DEMO-BRAND", owner_org_id: brandOrg.id, amount_cents: 5000,
}), "discount code");

// Something for the daily job to say (Admin → Settings → "Run daily jobs
// now"): one of Demo Factory's steps in progress is due in three days, and
// its capacity was last changed 31 days ago. Rows are written again rather
// than updated, because an update stamps updated_at with now.
console.log("daily reminders");
const factoryOrders = must(await admin.from("production_orders").select("id")
  .eq("factory_org_id", factoryOrg.id).eq("status", "active"), "the factory's running orders");
const [dueSoonStep] = must(await admin.from("order_milestones").select("id, title")
  .in("order_id", factoryOrders.map((order) => order.id)).eq("state", "active").order("sort").limit(1), "a step in progress");
if (dueSoonStep) {
  must(await admin.from("order_milestones")
    .update({ due_on: new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10) })
    .eq("id", dueSoonStep.id), "a step due in three days");
}
const monthAgo = new Date(Date.now() - 31 * 864e5).toISOString();
const [capacityRow] = must(await admin.from("factory_capacity").select("*").eq("org_id", factoryOrg.id), "the factory's capacity");
const capacityMonths = must(await admin.from("factory_capacity_months").select("*").eq("org_id", factoryOrg.id), "its booking calendar");
must(await admin.from("factory_capacity").delete().eq("org_id", factoryOrg.id), "capacity, to write again");
must(await admin.from("factory_capacity").insert({ ...capacityRow, created_at: monthAgo, updated_at: monthAgo }), "capacity, a month old");
must(await admin.from("factory_capacity_months").delete().eq("org_id", factoryOrg.id), "calendar, to write again");
must(await admin.from("factory_capacity_months").insert(capacityMonths.map((row) => ({ ...row, updated_at: monthAgo }))), "calendar, a month old");

// Email switches: the brand has "Payment and approval requests" off, so a
// tester sees a switch in both states. The seed's own notifications are not
// news to anyone, so none of their queued emails go out.
must(await brand.client.rpc("set_notification_preference", {
  target_org: brandOrg.id, category: "payments", enabled: false,
}), "the brand's email switches");
must(await admin.from("notification_email_outbox")
  .update({ status: "skipped", last_error: "demo seed" })
  .in("recipient_user_id", demoUserIds)
  .eq("status", "pending"), "skip the seed's own emails");

const app = isLocal ? "http://127.0.0.1:5173/app.html" : "<the site>/app.html";
console.log(`
done. Every login uses the password "${PASSWORD}".

  brand           ${LOGINS.brand.email}   ${app}
  factory         ${LOGINS.factory.email}   ${app}?portal=factory
  second factory  ${LOGINS.secondFactory.email}   (a competing quote)
  new factory     ${LOGINS.newFactory.email}   (waiting for verification)
  new brand       ${LOGINS.newBrand.email}   (no requests yet: recommended factories)
  trading company ${LOGINS.tradingCompany.email}   ${app}?portal=factory
  admin           ${LOGINS.admin.email}   ${app.replace("app.html", "admin.html")}

  The brand has:
    - "${shirting.title}": open, with two quotes to compare
    - "${merino.title}": an order waiting for its production steps
    - "${linen.title}": a running order, its first step sent for approval;
      in its conversation, a call invite from ${LOGINS.factory.name} (Accept / Propose another time / Decline)
      and an earlier invite the factory declined
    - "${shirting.title}" conversation: a call confirmed for tomorrow (on both dashboards)
    - "${tote.title}": an order cancelled by both sides
    - "Linen trousers, SS27": the factory proposed cancelling (Accept / Keep order)
    - "Recycled nylon windbreaker": the brand proposed cancelling (Withdraw)
    - "Organic poplin shirt, AW27": fit sample paid out, bulk deposit held and owed to the factory
    - "Cotton twill overshirt, AW27": fit sample funded by card, held while the factory works
    - "Merino rib tank, AW27": fit sample paid by bank, clearing
    - "Stretch chino, AW27": fit sample bank payment failed, to pay again
    - "Washed denim jacket, AW27": fit sample payment due
    - "Seersucker camp shirt, AW27" (${LOGINS.secondFactory.name}): fit sample approved, owed to a factory
      Stripe cannot pay (China): staff pay it by bank from the admin's Payments page
  Payments lists those payments (Paid, Funded, Processing, Failed, Due) and its discount code.
  Its profile (/profile) is filled in, with a pending invitation.
  Settings → Notifications: "Payment and approval requests" emails are off; the others are on.
  ${LOGINS.factory.name} has it under Saved → Saved brands.
  Browse vendors lists ${LOGINS.factory.name} and ${LOGINS.secondFactory.name} (Factories) and ${LOGINS.tradingCompany.name} (Trading companies).
  Saved has ${LOGINS.factory.name} and ${LOGINS.tradingCompany.name}.
  The admin's verification queue has ${LOGINS.newFactory.name}.
  Admin → Settings → "Run daily jobs now" reminds ${LOGINS.factory.name} that its capacity is a
  month old${dueSoonStep ? ` and that "${dueSoonStep.title}" is due in three days` : ""} (bell and email, once).

  Run this again at any time to put the demo companies back to this state.
  It deletes them, and any order another company has with them.
`);
