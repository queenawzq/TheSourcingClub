/**
 * End-to-end smoke test against a running local Supabase.
 *
 *   supabase start
 *   npm run smoke
 *
 * The pgTAP suite (supabase/tests) proves the access rules in SQL. This proves
 * the layer above them: that supabase-js, PostgREST embeds, RPC signatures and
 * role grants all line up with what src/lib actually calls. It already caught
 * one real bug — service_role having no data privileges, which would have
 * broken every server-side path while every SQL test still passed.
 *
 * Keys are read from the running local stack rather than hardcoded. The local
 * development keys are identical on every machine and are not real secrets, but
 * a literal starting with sb_secret_ trips GitHub's secret scanner and teaches
 * the wrong habit, so there is none in this repository.
 *
 * Point at something else with SUPABASE_URL / SUPABASE_ANON_KEY /
 * SUPABASE_SERVICE_KEY.
 */
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

/** Ask the CLI for the running stack's URL and keys. */
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
  console.error(
    "No Supabase connection details.\n" +
      "Start the local stack with `supabase start`, or set SUPABASE_URL, " +
      "SUPABASE_ANON_KEY and SUPABASE_SERVICE_KEY.",
  );
  process.exit(1);
}
// Local mail catcher. Absent when pointing at a hosted project, in which case
// the sign-in round trip is skipped rather than failed.
const MAIL = process.env.SUPABASE_MAIL_URL ?? stack.MAILPIT_URL ?? stack.INBUCKET_URL ?? "";

const admin = createClient(URL, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let failures = 0;
const ok = (message) => console.log("  ✓", message);
const fail = (message, detail) => {
  failures += 1;
  console.error("  ✗", message, detail ? `— ${detail.message ?? detail}` : "");
};

/**
 * The password every account in this file is created with.
 *
 * Eight characters, because that is what the designed signup form promises and
 * what minimum_password_length enforces. A shorter one here would pass locally
 * and fail the moment config.toml was pushed.
 */
const TEST_PASSWORD = "smoke test 8";

/**
 * Run the real api/screen-message.js handler for a user's message, the way the
 * page does after a send, with Vercel's (request, response) shape. No model
 * key here, so a message the patterns pass is delivered as `pattern_only`.
 */
async function screenAs(client, messageId) {
  const { data } = await client.auth.getSession();
  return screenWithToken(data?.session?.access_token, messageId);
}

async function screenWithToken(token, messageId) {
  const { default: screen } = await import("../api/screen-message.js");
  const saved = { ...process.env };
  Object.assign(process.env, { SUPABASE_URL: URL, SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE, OPENROUTER_API_KEY: "" });
  let status = 0;
  let body = null;
  const response = {
    status(code) { status = code; return response; },
    json(payload) { body = payload; return response; },
  };
  try {
    await screen({ method: "POST", headers: { authorization: `Bearer ${token}` }, body: { messageId } }, response);
  } finally {
    for (const key of ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "OPENROUTER_API_KEY"]) {
      if (key in saved) process.env[key] = saved[key]; else delete process.env[key];
    }
  }
  return { status, ...body };
}

/**
 * Run one of the staff routes (api/admin-review-assist.js,
 * api/admin-test-data.js) as a client, the way screenAs runs the screen.
 * `env` overrides variables for the one call (an OpenRouter key, or a
 * production address to prove it is refused); `model` stands in for
 * OpenRouter, so no request ever leaves the machine.
 */
async function staffRouteAs(route, client, { method = "POST", body, env = {}, model = null } = {}) {
  const { default: handle } = await import(`../api/${route}.js`);
  const { data } = client ? await client.auth.getSession() : { data: null };
  const keys = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "OPENROUTER_API_KEY", "RESEND_API_KEY", "RESEND_FROM_EMAIL"];
  const saved = Object.fromEntries(keys.filter((key) => key in process.env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, { SUPABASE_URL: URL, SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE, OPENROUTER_API_KEY: "" }, env);
  const realFetch = globalThis.fetch;
  if (model) {
    globalThis.fetch = (url, init) => String(url).startsWith("https://openrouter.ai/")
      ? Promise.resolve(new Response(JSON.stringify({
        model: "smoke/fake-model",
        choices: [{ message: { tool_calls: [{ function: { arguments: JSON.stringify(model) } }] } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      : realFetch(url, init);
  }
  let status = 0;
  let payload = null;
  const response = {
    status(code) { status = code; return response; },
    json(value) { payload = value; return response; },
  };
  try {
    await handle({ method, headers: { authorization: data?.session ? `Bearer ${data.session.access_token}` : "" }, body }, response);
  } finally {
    globalThis.fetch = realFetch;
    for (const key of keys) {
      if (key in saved) process.env[key] = saved[key]; else delete process.env[key];
    }
  }
  return { status, ...payload };
}

/**
 * Run the real api/screen-call-text.js handler as a client: the server's
 * contact-details check on a call's words, which the database then requires.
 */
async function checkCallTextAs(client, texts) {
  const { default: check } = await import("../api/screen-call-text.js");
  const { data } = await client.auth.getSession();
  const keys = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
  const saved = { ...process.env };
  Object.assign(process.env, { SUPABASE_URL: URL, SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE });
  let status = 0;
  let body = null;
  const response = {
    status(code) { status = code; return response; },
    json(payload) { body = payload; return response; },
  };
  try {
    await check({ method: "POST", headers: { authorization: `Bearer ${data?.session?.access_token}` }, body: { texts } }, response);
  } finally {
    for (const key of keys) {
      if (key in saved) process.env[key] = saved[key]; else delete process.env[key];
    }
  }
  return { status, ...body };
}

/**
 * Run the real api/call-join.js handler as a client. `zoom` sets fake Zoom
 * variables (enough to pass "is Zoom set up?", never enough to reach Zoom);
 * without it they are cleared, as on a site without video.
 */
async function joinAs(client, callId, { zoom = false } = {}) {
  const { default: join } = await import("../api/call-join.js");
  const { data } = client ? await client.auth.getSession() : { data: null };
  const keys = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY",
    "ZOOM_ACCOUNT_ID", "ZOOM_CLIENT_ID", "ZOOM_CLIENT_SECRET", "ZOOM_SDK_CLIENT_ID", "ZOOM_SDK_CLIENT_SECRET"];
  const saved = { ...process.env };
  const fake = zoom ? "smoke-not-a-key" : "";
  Object.assign(process.env, {
    SUPABASE_URL: URL, SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE,
    ZOOM_ACCOUNT_ID: fake, ZOOM_CLIENT_ID: fake, ZOOM_CLIENT_SECRET: fake, ZOOM_SDK_CLIENT_ID: fake, ZOOM_SDK_CLIENT_SECRET: fake,
  });
  let status = 0;
  let body = null;
  const response = {
    status(code) { status = code; return response; },
    json(payload) { body = payload; return response; },
  };
  try {
    const token = data?.session?.access_token;
    await join({ method: "POST", headers: { authorization: token ? `Bearer ${token}` : "" }, body: { callId } }, response);
  } finally {
    for (const key of keys) {
      if (key in saved) process.env[key] = saved[key]; else delete process.env[key];
    }
  }
  return { status, ...body };
}

// What a message may carry: the picker's list and the private bucket's
// allowlist must be the same, or a file is offered and then refused.
{
  const { PRIVATE_BUCKET_TYPES } = await import("../src/shared/private-bucket-types.mjs");
  const { data: bucket } = await admin.storage.getBucket("org-private");
  const allowed = new Set(bucket?.allowed_mime_types ?? []);
  const same = allowed.size === PRIVATE_BUCKET_TYPES.length && PRIVATE_BUCKET_TYPES.every((type) => allowed.has(type));
  if (same) ok("the message file picker offers exactly what the private bucket accepts");
  else fail(`the private bucket accepts ${[...allowed].join(", ")} but private-bucket-types.mjs offers ${PRIVATE_BUCKET_TYPES.join(", ")}`);
}

// Where Stripe can pay out: the server (api/_stripe.js) and the factory's
// Payments page keep their own copies, because Vercel builds api/ on its own.
{
  const { PAYOUT_COUNTRIES: server } = await import("../api/_stripe.js");
  const { PAYOUT_COUNTRIES: page } = await import("../src/shared/stripe-payout-countries.mjs");
  const same = server.size === page.size && [...server].every((code) => page.has(code));
  if (same) ok("the server and the factory page agree on where Stripe can pay out");
  else fail("the payout country lists differ between api/_stripe.js and src/shared/stripe-payout-countries.mjs");
}

/**
 * Create a confirmed user and return a client signed in as them.
 *
 * Email and password, the same pair src/shared/AuthScreen.jsx collects. The
 * account is created through the admin API rather than signUp() so the run
 * does not depend on email delivery for every one of its dozen users — the
 * real signup path is exercised once, below, and end to end in e2e.mjs.
 */
async function signedInUser(email) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
    user_metadata: { name: email.split("@")[0] },
  });
  if (error) throw error;

  const client = createClient(URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: signInError } = await client.auth.signInWithPassword({
    email,
    password: TEST_PASSWORD,
  });
  if (signInError) throw signInError;

  return { client, id: data.user.id };
}

const stamp = Date.now();

console.log("\nsignup");
const brand = await signedInUser(`brand-${stamp}@example.com`);
{
  const { data, error } = await admin
    .from("user_profiles")
    .select("id, full_name")
    .eq("id", brand.id)
    .maybeSingle();
  if (error) fail("service_role can read user_profiles", error);
  else if (data) ok(`trigger created a profile for ${data.full_name}`);
  else fail("no user_profiles row was created by the signup trigger");
}

console.log("\norgs");
// Names carry the run stamp so the suite is repeatable without a db reset —
// otherwise the second run's "duplicate" is really the fourth and the expected
// slug suffix drifts.
const ORG_NAME = `Maison Rue ${stamp}`;
const ORG_SLUG = ORG_NAME.toLowerCase().replace(/[^a-z0-9]+/g, "-");

const { data: org, error: orgError } = await brand.client.rpc("create_org", {
  org_name: ORG_NAME,
  org_kind: "brand",
});
if (orgError) fail("create_org RPC", orgError);
else ok(`created ${org.name} (${org.slug}), type ${org.type}`);

const factory = await signedInUser(`factory-${stamp}@example.com`);
const { data: dupe } = await brand.client.rpc("create_org", {
  org_name: ORG_NAME,
  org_kind: "brand",
});
dupe?.slug === `${ORG_SLUG}-2`
  ? ok("a duplicate name gets a numbered slug")
  : fail(`expected slug ${ORG_SLUG}-2, got ${dupe?.slug}`);

{
  const { data, error } = await brand.client
    .from("org_members")
    .select("role, orgs (id, type, name, slug, is_demo, created_at)");
  if (error) fail("listMyOrgs embed shape", error);
  else if (data.length === 2) ok(`membership embed returns ${data.length} orgs as ${data[0].role}`);
  else fail(`expected 2 memberships, got ${data.length}`);
}

console.log("\naccess rules");
{
  const { data } = await factory.client.from("orgs").select("id").eq("id", org.id);
  data?.length === 0
    ? ok("another user cannot see this org")
    : fail("LEAK: another user could read this org");
}
{
  const { error } = await brand.client
    .from("credit_ledger")
    .insert({ org_id: org.id, delta: 500, reason: "onboarding_grant" });
  error ? ok("credit ledger rejects a client write") : fail("LEAK: ledger accepted a client write");
}
{
  const { error } = await brand.client.from("taxonomy_terms").insert({
    kind: "market_level",
    slug: `made-up-${stamp}`,
    label_en: "Made up",
    org_id: org.id,
  });
  error
    ? ok("closed vocabularies reject invented terms")
    : fail("LEAK: a custom term was accepted on a closed vocabulary");
}
{
  const { error } = await brand.client.from("taxonomy_terms").insert({
    kind: "production_type",
    slug: `bespoke-${stamp}`,
    label_en: "Bespoke tailoring",
    org_id: org.id,
  });
  error
    ? fail("open vocabularies should accept custom terms", error)
    : ok("open vocabularies accept an org's own term");
}

console.log("\ntaxonomy");
{
  const { data, error } = await brand.client
    .from("taxonomy_terms")
    .select("slug, label_en, label_zh, extra")
    .eq("kind", "capacity_category")
    .order("sort");
  if (error) fail("read capacity categories", error);
  else {
    ok(`${data.length} capacity categories seeded`);
    const sweaters = data.find((term) => term.slug === "sweaters");
    sweaters?.extra?.minutes_per_piece === 42
      ? ok(`sweaters = 42 min/piece, zh "${sweaters.label_zh}" (dashboard hardcodes 18)`)
      : fail(`sweaters minutes_per_piece was ${sweaters?.extra?.minutes_per_piece}`);
  }

  const { count } = await brand.client
    .from("taxonomy_terms")
    .select("*", { count: "exact", head: true });
  count >= 142 ? ok(`${count} taxonomy terms visible`) : fail(`only ${count} terms visible`);
}

console.log("\ncapacity maths");
{
  const { data: category } = await brand.client
    .from("taxonomy_terms")
    .select("id, extra")
    .eq("kind", "capacity_category")
    .eq("slug", "sweaters")
    .single();

  const { error } = await admin.from("factory_capacity").insert({
    org_id: org.id,
    category_term_id: category.id,
    input_mode: "hours",
    line_hours: 2400,
  });
  if (error) fail("seed capacity", error);

  const { data: units, error: unitsError } = await admin.rpc("capacity_monthly_units", {
    org: org.id,
  });
  if (unitsError) fail("capacity_monthly_units", unitsError);
  else if (units === 3429) ok("2,400 sweater hours = 3,429 pieces (UI shows 8,000)");
  else fail(`expected 3429 pieces, got ${units}`);
}

console.log("\nonboarding write path");
{
  // Step-by-step saving: onboarding upserts a few columns at a time rather
  // than writing one whole object at the end.
  const { error: e1 } = await brand.client
    .from("brand_profiles")
    .upsert({ org_id: org.id, legal_name: ORG_NAME, hq_location: "New York, USA" },
            { onConflict: "org_id" });
  if (e1) fail("first partial save creates the row", e1);
  else ok("first partial save creates the profile row");

  const { data: after, error: e2 } = await brand.client
    .from("brand_profiles")
    .upsert({ org_id: org.id, intro: "Womenswear, small batch." }, { onConflict: "org_id" })
    .select("legal_name, hq_location, intro")
    .single();
  if (e2) fail("second partial save", e2);
  else if (after.legal_name === ORG_NAME && after.intro)
    ok("a later partial save does not clobber earlier steps");
  else fail(`partial save lost data: ${JSON.stringify(after)}`);

  const { error: e3 } = await brand.client
    .from("brand_profiles")
    .upsert({ org_id: org.id, brand_category: "fashion-brand" }, { onConflict: "org_id" });
  e3 ? fail("brand_category column", e3) : ok("brand_category persists");
}

console.log("\ntaxonomy links");
{
  const { data: wovens } = await brand.client
    .from("taxonomy_terms").select("id").eq("kind", "production_type").eq("slug", "wovens").single();
  const { data: gots } = await brand.client
    .from("taxonomy_terms").select("id").eq("kind", "certification").eq("slug", "gots").single();

  const { error } = await brand.client.from("taxonomy_links").insert([
    { subject_type: "brand_profile", subject_id: org.id, term_id: wovens.id, org_id: org.id },
    { subject_type: "brand_profile", subject_id: org.id, term_id: gots.id, org_id: org.id },
  ]);
  if (error) fail("link taxonomy terms", error);
  else ok("brand profile links to production type and certification");

  // The kind-scoped read that setLinks() uses to diff selections.
  const { data: scoped, error: scopedError } = await brand.client
    .from("taxonomy_links")
    .select("term_id, taxonomy_terms!inner (kind)")
    .eq("subject_type", "brand_profile")
    .eq("subject_id", org.id)
    .eq("taxonomy_terms.kind", "production_type");
  if (scopedError) fail("kind-scoped link read", scopedError);
  else if (scoped.length === 1)
    ok("kind-scoped read returns only that group, so saving one chip group cannot wipe another");
  else fail(`expected 1 production_type link, got ${scoped.length}`);
}

console.log("\nmatch score against a real profile");
{
  const factoryOrgRow = await factory.client.rpc("create_org", {
    org_name: `Atelier ${stamp}`, org_kind: "factory",
  });
  const factoryOrg = factoryOrgRow.data;

  await admin.from("factory_profiles").insert({
    org_id: factoryOrg.id, country_code: "PT", moq: 150, published_at: new Date().toISOString(),
  });
  const { data: wovens } = await admin
    .from("taxonomy_terms").select("id").eq("kind", "production_type").eq("slug", "wovens").single();
  await admin.from("taxonomy_links").insert({
    subject_type: "factory_profile", subject_id: factoryOrg.id,
    term_id: wovens.id, org_id: factoryOrg.id,
  });

  const { data: score, error } = await admin.rpc("match_score", {
    brand_org: org.id, factory_org: factoryOrg.id,
  });
  if (error) fail("match_score", error);
  else if (Number(score) > 0 && Number(score) < 1)
    ok(`scores ${(score * 100).toFixed(0)}% — production type matches, required GOTS is unverified`);
  else fail(`expected a partial score, got ${score}`);

  const { data: tier } = await admin.rpc("match_tier", { score });
  ok(`tier: ${tier}`);
}

console.log("\nterms acceptance");
{
  const { error } = await brand.client.from("terms_acceptances").insert({
    org_id: org.id, terms_version: "2026-09-01", signature: "John Maheswaran",
    accepted_by: brand.id,
  });
  error ? fail("record a signature", error) : ok("signature recorded");

  const { error: forgeError } = await brand.client.from("terms_acceptances").insert({
    org_id: org.id, terms_version: "2026-09-01", signature: "Someone Else",
    accepted_by: factory.id,
  });
  forgeError
    ? ok("cannot record a signature in someone else's name")
    : fail("LEAK: signed on behalf of another user");

  const { error: updateError } = await brand.client
    .from("terms_acceptances").update({ signature: "Changed" }).eq("org_id", org.id);
  updateError
    ? ok("a recorded signature cannot be edited afterwards")
    : fail("LEAK: signature was editable after the fact");
}

console.log("\nlegal documents");
{
  // The one function granted to anon: signup links to the terms before the
  // visitor has an account to read them with.
  const signedOut = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data: current, error: currentError } = await signedOut.rpc("current_legal_documents");
  const byKind = Object.fromEntries((current ?? []).map((row) => [row.kind, row]));
  if (currentError) fail("a signed-out visitor can read the current terms", currentError);
  else ["terms_brand", "terms_factory", "terms_trading", "privacy"].every((kind) => byKind[kind])
    ? ok("a signed-out visitor reads the current version of all four documents")
    : fail(`current documents incomplete: ${Object.keys(byKind).join(", ")}`);

  const { error: tableLeak } = await signedOut.from("legal_documents").select("id");
  tableLeak ? ok("but NOT the table behind them")
            : fail("LEAK: legal_documents is readable signed out");

  const { error: signError } = await brand.client.from("terms_acceptances").insert({
    org_id: org.id, terms_version: `terms_brand v${byKind.terms_brand?.version}`,
    signature: "John Maheswaran", accepted_by: brand.id, legal_document_id: byKind.terms_brand?.id,
  });
  signError ? fail("sign against the exact published version", signError)
            : ok("a signature records the exact version signed");

  const { error: privacySign } = await brand.client.from("terms_acceptances").insert({
    org_id: org.id, terms_version: "privacy", signature: "John Maheswaran",
    accepted_by: brand.id, legal_document_id: byKind.privacy?.id,
  });
  privacySign ? ok("a privacy policy cannot be 'signed'")
              : fail("a signature was recorded against the privacy policy");

  const { error: publishLeak } = await brand.client.from("legal_documents").insert({
    kind: "terms_brand", version: 999, onboarding_en: "Heading\nBody", full_en: "Title\nSub",
  });
  publishLeak ? ok("a brand CANNOT publish terms of its own")
              : fail("LEAK: a brand wrote to legal_documents");
}

console.log("\nprivate documents");
{
  const { error } = await brand.client.from("documents").insert({
    org_id: org.id, kind: "business_registration", bucket: "org-private",
    storage_path: `${org.id}/business_registration/${stamp}.pdf`,
    file_name: "registration.pdf", status: "pending",
  });
  if (error) fail("record a private document", error);
  else ok("private document recorded as pending review");

  const { data: seen } = await factory.client.from("documents").select("id").eq("org_id", org.id);
  seen?.length === 0
    ? ok("another org cannot see it")
    : fail("LEAK: private document visible to another org");

  const { error: reviewError } = await brand.client.rpc("review_document", {
    document_id: (await admin.from("documents").select("id").eq("org_id", org.id).single()).data.id,
    decision: "verified",
  });
  reviewError
    ? ok("a brand cannot verify its own registration")
    : fail("LEAK: self-verification succeeded");
}

console.log("\nphase 2 — verification unlocks quoting");
let rfqId = null;
let winningQuote = null;
let losingQuote = null;
let awardedQuote = null;
let f1Client = null;      // the winning factory acts as itself: RPCs key on auth.uid()
let losingFactory = null;   // its own client: RPCs key on auth.uid(), so
                            // service_role cannot act on a factory's behalf
{
  // A second verified factory is required to prove the award is atomic: with
  // one quote, "auto-decline the others" has nothing to decline.
  const f2 = await signedInUser(`f2-${stamp}@example.com`);
  losingFactory = f2.client;
  const { data: f2org } = await f2.client.rpc("create_org", {
    org_name: `Atelier Two ${stamp}`, org_kind: "factory",
  });

  const factoryOrgId = (await admin.from("orgs").select("id").eq("name", `Atelier ${stamp}`).maybeSingle()).data?.id;
  const orgs = [factoryOrgId, f2org.id].filter(Boolean);

  // Quoting costs credits now; every fixture factory starts with a grant.
  for (const id of orgs) {
    await admin.from("credit_ledger").insert({
      org_id: id, delta: 500, reason: "onboarding_grant", note: "smoke fixture",
    });
  }

  for (const id of orgs) {
    await admin.from("factory_profiles").upsert(
      { org_id: id, country_code: "PT", moq: 100, published_at: new Date().toISOString() },
      { onConflict: "org_id" },
    );
  }

  // An unverified factory must not be able to quote, whatever the UI shows.
  const { data: draftRfq } = await admin.from("rfqs").insert({
    brand_org_id: org.id, title: `Smoke RFQ ${stamp}`, status: "open",
    visibility: "open_to_all", quantity_total: 300,
  }).select().single();
  rfqId = draftRfq.id;

  const { error: blocked } = await f2.client.from("quotes")
    .insert({ rfq_id: rfqId, factory_org_id: f2org.id });
  blocked
    ? ok("an unverified factory is refused at the database, not just in the UI")
    : fail("LEAK: an unverified factory inserted a quote");

  // Approve through the same RPC the admin page calls.
  const { data: adminUser } = await admin.auth.admin.createUser({
    email: `sysadmin-${stamp}@example.com`, email_confirm: true,
  });
  await admin.from("platform_admins").insert({ user_id: adminUser.user.id });

  for (const id of orgs) {
    const { data: doc } = await admin.from("documents").insert({
      org_id: id, kind: "business_registration", bucket: "org-private",
      storage_path: `${id}/reg-${stamp}.pdf`, file_name: "reg.pdf", status: "pending",
    }).select().single();
    // review_document is gated on auth.uid(), so it has to run as the admin.
    const { error: reviewError } = await admin.rpc("review_document", {
      document_id: doc.id, decision: "verified",
    });
    if (!reviewError) fail("review_document ran without an authenticated admin");
  }
  ok("review_document refuses to run without an authenticated admin");

  // Verify directly for the rest of the run; the browser path is covered e2e.
  for (const id of orgs) {
    await admin.from("factory_profiles").update({ verification_status: "verified" }).eq("org_id", id);
  }

  const { data: nowQuote, error: allowed } = await f2.client.from("quotes").insert({
    rfq_id: rfqId, factory_org_id: f2org.id, unit_price_cents: 1840,
    production_quantity: 300, bulk_lead_time_days: 28,
    valid_until: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
  }).select().single();
  allowed ? fail("a verified factory could not quote", allowed) : ok("once verified, the same factory can quote");
  losingQuote = nowQuote?.id;
}

console.log("\nphase 2 — the loop");
{
  const f1 = await signedInUser(`f1-${stamp}@example.com`);
  f1Client = f1.client;
  const { data: f1org } = await f1.client.rpc("create_org", {
    org_name: `Atelier Three ${stamp}`, org_kind: "factory",
  });
  await admin.from("factory_profiles").upsert({
    org_id: f1org.id, country_code: "PT", moq: 100,
    published_at: new Date().toISOString(), verification_status: "verified",
  }, { onConflict: "org_id" });
  // Sending a quote costs credits, so a fixture factory needs a balance the
  // way a real one gets an onboarding grant.
  await admin.from("credit_ledger").insert({
    org_id: f1org.id, delta: 500, reason: "onboarding_grant", note: "smoke fixture",
  });

  const { data: q } = await f1.client.from("quotes").insert({
    rfq_id: rfqId, factory_org_id: f1org.id, unit_price_cents: 1710,
    production_quantity: 300, bulk_lead_time_days: 26,
    valid_until: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
  }).select().single();
  winningQuote = q.id;

  await f1.client.from("quote_sample_lines").insert([
    { quote_id: q.id, stage: "Fit sample", cost_cents: 9500, timing_days: 10, sort: 1 },
    { quote_id: q.id, stage: "PP sample",  cost_cents: 16500, timing_days: 11, sort: 2 },
  ]);

  const { data: subtotal } = await admin.rpc("quote_sample_subtotal", { target_quote: q.id });
  subtotal === 26000
    ? ok("sample subtotal is summed from the lines ($260), never stored")
    : fail(`expected 26000, got ${subtotal}`);

  const terms = await admin.from("taxonomy_terms").select("id, kind, slug")
    .in("kind", ["payment_term", "incoterm"]);
  const pay = terms.data.find((t) => t.slug === "deposit-30-70");
  const inco = terms.data.find((t) => t.slug === "fob");

  const { error: incomplete } = await f1.client.rpc("submit_quote", { quote_id: q.id });
  incomplete && /payment terms/.test(incomplete.message)
    ? ok(`submit names what is missing: "${incomplete.message.slice(0, 60)}…"`)
    : fail(`expected a field-named error, got ${incomplete?.message}`);

  await f1.client.from("quotes").update({ payment_term_id: pay.id, incoterm_id: inco.id }).eq("id", q.id);
  await admin.from("quotes").update({ payment_term_id: pay.id, incoterm_id: inco.id }).eq("id", losingQuote);

  const { error: e1 } = await f1.client.rpc("submit_quote", { quote_id: q.id });
  e1 ? fail("submit_quote", e1) : ok("a complete quote submits");

  const { data: brandView } = await brand.client.from("quotes").select("id").eq("rfq_id", rfqId);
  brandView?.length >= 1
    ? ok(`the brand sees ${brandView.length} submitted quote(s), and no drafts`)
    : fail("the brand cannot see the submitted quote");

  // Revision must supersede rather than overwrite.
  const { data: revised, error: reviseError } = await f1.client.rpc("revise_quote", { quote_id: q.id });
  if (reviseError) fail("revise_quote", reviseError);
  else if (revised?.version === 2) ok("revising creates version 2 and supersedes version 1");
  else fail(`expected version 2, got ${revised?.version}`);
  if (!revised) throw new Error("cannot continue without a revision");
  const { data: oldRow } = await admin.from("quotes").select("status").eq("id", q.id).single();
  oldRow.status === "superseded" ? ok("the previous version is kept, marked superseded")
                                 : fail(`old version is ${oldRow.status}`);

  const { data: clonedLines } = await admin.from("quote_sample_lines").select("id").eq("quote_id", revised.id);
  clonedLines?.length === 2 ? ok("sample lines are carried into the revision") : fail("sample lines were lost");

  // Awarding the superseded row must be refused.
  const { error: staleError } = await brand.client.rpc("award_quote", { quote_id: q.id });
  staleError ? ok("awarding a superseded version is refused") : fail("LEAK: awarded a stale quote version");

  // A deposit split, as the quote form collects it. It is nullable and
  // submit_quote does not require it — the no-split case is pinned in pgTAP,
  // where the schedule still has to total the contract exactly.
  await admin.from("quotes").update({
    payment_term_id: pay.id, incoterm_id: inco.id, deposit_pct: 30, balance_pct: 70,
  }).eq("id", revised.id);
  await f1.client.rpc("submit_quote", { quote_id: revised.id });

  // Sending tells the brand, and a revision sent again says so.
  const { data: received } = await admin.from("notifications")
    .select("title").eq("kind", "quote_received").eq("subject_id", rfqId);
  received?.length === 2 && received.some((row) => /revised quote/.test(row.title))
    ? ok("the brand is notified of each quote sent, and of the revision as one")
    : fail(`expected 2 quote_received notifications, got ${received?.length}`);

  // A third vendor sends and withdraws while the request is still open.
  {
    const f3 = await signedInUser(`f3-${stamp}@example.com`);
    const { data: f3org } = await f3.client.rpc("create_org", {
      org_name: `Withdrawing Mill ${stamp}`, org_kind: "factory",
    });
    await admin.from("factory_profiles").upsert({
      org_id: f3org.id, country_code: "PT", moq: 100,
      published_at: new Date().toISOString(), verification_status: "verified",
    }, { onConflict: "org_id" });
    await admin.from("credit_ledger").insert({
      org_id: f3org.id, delta: 500, reason: "onboarding_grant", note: "smoke fixture",
    });
    const { data: q3 } = await f3.client.from("quotes").insert({
      rfq_id: rfqId, factory_org_id: f3org.id, unit_price_cents: 1990,
      production_quantity: 300, bulk_lead_time_days: 30,
      payment_term_id: pay.id, incoterm_id: inco.id,
      valid_until: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
    }).select().single();
    await f3.client.rpc("submit_quote", { quote_id: q3.id });
    const { error: withdrawError } = await f3.client.rpc("withdraw_quote", { quote_id: q3.id });
    withdrawError ? fail("withdraw_quote", withdrawError) : ok("a vendor withdraws a sent quote");

    const { count: toldWithdrawn } = await admin.from("notifications")
      .select("*", { count: "exact", head: true })
      .eq("kind", "quote_withdrawn").eq("subject_id", rfqId);
    toldWithdrawn === 1 ? ok("the brand is notified of the withdrawal")
                        : fail(`expected 1 quote_withdrawn notification, got ${toldWithdrawn}`);

    const { error: requote } = await f3.client.from("quotes").insert({ rfq_id: rfqId, factory_org_id: f3org.id });
    requote ? ok("a withdrawal is final: the same vendor cannot start another quote")
            : fail("LEAK: a vendor quoted again after withdrawing");
  }

  const { error: loserSubmit } = await losingFactory.rpc("submit_quote", { quote_id: losingQuote });
  if (loserSubmit) fail("the second factory could not submit", loserSubmit);

  const { error: awardError } = await brand.client.rpc("award_quote", { quote_id: revised.id });
  awardError ? fail("award_quote", awardError) : ok("the brand awards the current version");
  awardedQuote = revised.id;

  const { data: loser } = await admin.from("quotes").select("status").eq("id", losingQuote).single();
  loser.status === "declined"
    ? ok("the other factory's quote was auto-declined in the same transaction")
    : fail(`loser is ${loser.status}, expected declined`);

  // Counted by kind, not subject: since Phase 3 the winner's notification
  // points at the production order it just gained and the loser's at the
  // request, because those are the two different things worth opening.
  const { data: madeOrder } = await admin
    .from("production_orders").select("id").eq("quote_id", revised.id).maybeSingle();
  // Scoped to this run's request and order. A bare count over the whole table
  // passes alone and fails the moment anything else has run first.
  const { count: notified } = await admin.from("notifications")
    .select("*", { count: "exact", head: true })
    .in("kind", ["quote_accepted", "quote_declined"])
    .or(`subject_id.eq.${rfqId},order_id.eq.${madeOrder?.id ?? rfqId}`);
  notified === 2 ? ok("both factories were notified — nobody is left waiting")
                 : fail(`expected 2 notifications, got ${notified}`);

  const { data: rfqRow } = await admin.from("rfqs").select("status, awarded_quote_id").eq("id", rfqId).single();
  rfqRow.status === "awarded" && rfqRow.awarded_quote_id === revised.id
    ? ok("the rfq closed and points at the winning quote")
    : fail(`rfq is ${rfqRow.status}`);

  // The exact embed listFactoryRfqs() sends. Unqualified, `rfqs (...)` from
  // quotes is ambiguous (quotes.rfq_id and rfqs.awarded_quote_id) and the
  // factory's whole RFQs page failed to load.
  const { data: factoryList, error: factoryListError } = await f1.client
    .from("quotes")
    .select("id, rfq_id, status, rfqs!quotes_rfq_id_fkey (id, title, orgs!rfqs_brand_org_id_fkey (name))")
    .eq("factory_org_id", f1org.id)
    .neq("status", "superseded");
  factoryListError
    ? fail("the factory's own quotes list, embedded with its request", factoryListError)
    : factoryList.some((row) => row.rfqs?.id === rfqId)
      ? ok("a factory lists its quotes with the request embedded")
      : fail("the factory's quote list came back without its request");

  // listRfqs() counts only the live row per vendor, so revising does not
  // inflate the brand's "quotes received".
  const { data: counted, error: countError } = await brand.client
    .from("rfqs")
    .select("id, quotes!quotes_rfq_id_fkey(count)")
    .eq("id", rfqId)
    .in("quotes.status", ["submitted", "accepted", "declined"])
    .single();
  countError
    ? fail("the brand's quote count", countError)
    : counted.quotes?.[0]?.count === 2
      ? ok("the brand's quote count ignores superseded versions (2 vendors, 3 rows)")
      : fail(`expected 2 live quotes, counted ${counted.quotes?.[0]?.count}`);
}

console.log("\nphase 3 — the order runs");
{
  // Everything here goes through the same calls src/lib/domain makes, because
  // the point of this file is the layer pgTAP cannot reach: PostgREST embeds,
  // RPC argument names, and role grants.
  const { data: order, error: orderError } = await admin
    .from("production_orders").select("*").eq("quote_id", awardedQuote).maybeSingle();

  if (orderError || !order) {
    fail("awarding created a production order", orderError);
  } else {
    ok(`awarding created order ${order.order_number} with nobody pressing another button`);

    const { data: milestones } = await admin
      .from("order_milestones").select("*").eq("order_id", order.id).order("sort");

    const total = milestones.reduce((sum, m) => sum + Number(m.amount_cents ?? 0), 0);
    total === Number(order.order_total_cents)
      ? ok(`the generated schedule totals ${total} — exactly the contract value`)
      : fail(`schedule totals ${total}, contract is ${order.order_total_cents}`);

    milestones.some((m) => m.kind === "payment_only" && m.title === "Bulk deposit")
      ? ok("the deposit came from the quote's payment split, not a template")
      : fail("no deposit milestone was derived");

    milestones.every((m) =>
      (["approval_and_payment", "payment_only"].includes(m.kind)) === (m.amount_cents !== null))
      ? ok("only the steps that involve money carry an amount")
      : fail("a step's amount disagrees with its kind");

    // The summary view is what every header reads. If it disagrees with the
    // rows beneath it, four screens are wrong at once.
    const { data: summary, error: viewError } = await admin
      .from("production_order_summary").select("*").eq("id", order.id).maybeSingle();
    if (viewError) fail("the summary view is queryable", viewError);
    else Number(summary.total_cents) === total && Number(summary.paid_cents) === 0
      ? ok("the summary view agrees with the rows it sums")
      : fail(`view says ${summary.total_cents}/${summary.paid_cents}`);

    // The exact select strings the client uses. documents now has two foreign
    // keys into the order graph, and an ambiguous embed is refused rather than
    // guessed — which is how the quotes!quotes_rfq_id_fkey lesson was learned.
    const { error: embedError } = await admin
      .from("order_milestones")
      .select("id, title, order_payments (id, state, amount_cents, fee_bps)")
      .eq("order_id", order.id);
    embedError ? fail("milestone → payment embed parses", embedError)
               : ok("the embed src/lib/domain/milestone.js uses parses");

    // The order list and detail embed through the summary VIEW, which only
    // works while PostgREST can see the base table's foreign keys through it.
    const { data: listed, error: listEmbedError } = await brand.client
      .from("production_order_summary")
      .select("id, rfqs (title, brief), brand:brand_org_id (name), factory:factory_org_id (name, factory_profiles (location, country_code)), order_milestones (id, title, sort, state, due_on, amount_cents, order_payments (state))")
      .eq("id", order.id)
      .maybeSingle();
    listEmbedError
      ? fail("the order list's embeds parse through the summary view", listEmbedError)
      : Array.isArray(listed?.order_milestones) && listed.order_milestones.length > 0
      ? ok("the order list's embeds parse through the summary view, steps included")
      : fail("the order list's step embed came back empty");


    const { error: updateEmbedError } = await admin
      .from("milestone_updates")
      .select("id, body, orgs:author_org_id (name), documents (id, file_name)")
      .eq("order_id", order.id);
    updateEmbedError ? fail("update → documents embed parses", updateEmbedError)
                     : ok("the embed src/lib/domain/milestone.js uses for photos parses");

    // ---- the brand sets the steps; its confirmation starts the order ------
    // The factory has to act as itself: every RPC keys on auth.uid(), so
    // service_role genuinely cannot stand in for a party here.
    const { data: winner } = await admin
      .from("quotes").select("factory_org_id").eq("id", awardedQuote).single();
    // Reuse the winning factory's own session from the loop above.
    const factoryClient = f1Client;

    const { error: factoryEdit } = await factoryClient.rpc("set_order_schedule", {
      target_order: order.id,
      lines: milestones.map((m) => ({ kind: m.kind, title: m.title, amount_cents: m.amount_cents, sort: m.sort })),
    });
    factoryEdit ? ok("the factory CANNOT change the production steps; only the brand does")
                : fail("LEAK: the factory rewrote the brand's production steps");

    const factoryAgree = await factoryClient.rpc("agree_schedule", {
      target_order: order.id, revision: order.schedule_revision,
    });
    factoryAgree.error ? fail("a factory agreeing (the current site) is still accepted", factoryAgree.error)
                       : ok("a factory agreeing (the current site) is still accepted");

    const { data: halfway } = await admin
      .from("production_orders").select("status").eq("id", order.id).single();
    halfway.status === "pending_schedule"
      ? ok("the factory agreeing does not start the order")
      : fail(`order is ${halfway.status} after the factory's agreement`);

    const brandAgree = await brand.client.rpc("agree_schedule", {
      target_order: order.id, revision: order.schedule_revision,
    });
    brandAgree.error ? fail("the brand confirms the production steps", brandAgree.error)
                     : ok("the brand confirms the production steps");

    const { data: active } = await admin
      .from("production_orders").select("status, activated_at").eq("id", order.id).single();
    active.status === "active"
      ? ok("the brand's confirmation starts the order")
      : fail(`order is ${active.status} after the brand confirmed`);

    const { data: payments } = await admin
      .from("order_payments").select("*, order_milestones (title, sort, kind)")
      .eq("order_id", order.id);
    const paying = milestones.filter((m) => m.amount_cents !== null).length;
    payments.length === paying
      ? ok(`activation created ${payments.length} payments — one per paying step, none for the rest`)
      : fail(`expected ${paying} payments, got ${payments.length}`);

    // The SHAPE of that embed, not just that it parses. order_payments
    // .milestone_id is unique, so PostgREST reads the relationship as to-one
    // and returns an object where an ordinary embed returns an array. Reading
    // it as [0] yields undefined rather than an error, and the timeline
    // silently loses every payment status with nothing to say so.
    const { data: shaped } = await admin
      .from("order_milestones")
      .select("id, kind, order_payments (id, state)")
      .eq("order_id", order.id)
      .in("kind", ["approval_and_payment", "payment_only"])
      .limit(1);
    const embedded = shaped?.[0]?.order_payments;
    (embedded && !Array.isArray(embedded))
      ? ok("the payment embed is to-ONE and comes back as an object — domain code must not index it")
      : fail(`the payment embed came back as ${Array.isArray(embedded) ? "an array" : typeof embedded}`);

    // The service fee is fixed per order when its payments are created: 5% at
    // $5,000 and over, 7% under (20261012000200).
    payments.every((p) => [500, 700].includes(p.fee_bps) && p.fee_bps === payments[0].fee_bps && p.currency === "USD")
      ? ok(`every payment stores the order's fee rate (${payments[0]?.fee_bps / 100}%) and currency, rather than inheriting a default`)
      : fail("a payment is missing its fee rate or currency, or the rates differ within one order");

    // ---- the gate ---------------------------------------------------------
    // The first sample is what actually opens: the deposit sits AFTER the
    // samples in the derived schedule, so it is correctly not_due until they
    // are done. Following the real order is the only way to reach the gate.
    const first = milestones[0];
    first.kind === "approval_and_payment"
      ? ok(`the schedule opens with "${first.title}", the first stage the factory quoted`)
      : fail(`first step is ${first.kind}`);

    // Bank details are NOT visible yet: nothing is owed.
    const { data: tooEarly } = await brand.client
      .from("factory_payout_accounts").select("id").eq("org_id", winner.factory_org_id);
    (tooEarly ?? []).length === 0
      ? ok("a brand CANNOT see the factory's bank details before anything is owed")
      : fail("LEAK: bank details visible with no payment outstanding");

    await admin.from("factory_payout_accounts").insert({
      org_id: winner.factory_org_id, bank_name: "Banco Smoke",
      account_number_last4: "9911", is_primary: true,
    });

    const posted = await factoryClient.rpc("post_milestone_update", {
      target_milestone: first.id,
      body: "Fit sample finished and photographed.",
      document_ids: [],
    });
    posted.error ? fail("the factory posts an update", posted.error)
                 : ok("the factory posts an update against the step it is working on");

    // Since 065 a brand comments on a step through the same RPC. What must
    // never happen is the comment being stored as the factory's own work.
    const brandPost = await brand.client.rpc("post_milestone_update", {
      target_milestone: first.id, body: "Looks good", document_ids: [],
    });
    brandPost.error
      ? fail("the brand comments on the step", brandPost.error)
      : brandPost.data?.author_org_id === org.id
      ? ok("a brand comments on a step as itself, never as the factory")
      : fail("LEAK: the brand's comment was stored as another company's post");

    // The brand can read what the factory posted. This is the positive twin of
    // every isolation check, and the one whose absence is silent: get the
    // policy wrong and the gallery is simply empty, with no error at all.
    const { data: seen } = await brand.client
      .from("milestone_updates").select("id, body")
      .eq("milestone_id", first.id).eq("author_org_id", winner.factory_org_id);
    (seen ?? []).length === 1
      ? ok("the brand CAN read the factory's update — the counterparty policy works")
      : fail(`the brand sees ${(seen ?? []).length} factory updates, expected 1`);

    const { data: commentSeen } = await factoryClient
      .from("milestone_updates").select("id")
      .eq("milestone_id", first.id).eq("author_org_id", org.id);
    (commentSeen ?? []).length === 1
      ? ok("the factory CAN read the brand's comment")
      : fail(`the factory sees ${(commentSeen ?? []).length} brand comments, expected 1`);

    // Reminders: once a day per step, and only between the two parties.
    const reminded = await brand.client.rpc("remind_milestone", { target_milestone: first.id });
    reminded.error ? fail("the brand reminds the factory about an open step", reminded.error)
                   : ok("the brand reminds the factory about an open step");
    const { error: remindedTwice } = await brand.client.rpc("remind_milestone", { target_milestone: first.id });
    remindedTwice ? ok("a second reminder the same day is refused")
                  : fail("a second reminder the same day went through");
    const { error: strangerRemind } = await losingFactory.rpc("remind_milestone", { target_milestone: first.id });
    strangerRemind ? ok("a factory that lost the bid CANNOT send a reminder on the order")
                   : fail("LEAK: an outsider sent a reminder");

    // The activity list: the parties' own rows, and nothing for anyone else.
    const { data: activity, error: activityError } = await brand.client
      .rpc("order_activity", { target_order: order.id });
    activityError
      ? fail("order_activity answers a party", activityError)
      : (activity ?? []).some((row) => row.kind === "update_posted" && row.actor_org_id === winner.factory_org_id)
      ? ok("order_activity shows the brand the factory's update, credited to the factory")
      : fail("order_activity is missing the factory's update");
    const { data: outsiderActivity } = await losingFactory.rpc("order_activity", { target_order: order.id });
    (outsiderActivity ?? []).length === 0
      ? ok("order_activity is empty for a factory that lost the bid")
      : fail("LEAK: an outsider read the order's activity");

    // Order tabs: the company's own groupings, and nobody else's business.
    {
      const { data: tab, error: addTabError } = await brand.client
        .rpc("add_order_tab", { target_org: org.id, new_label: `Smoke ${stamp}` });
      addTabError ? fail("the brand adds an order tab", addTabError) : ok("the brand adds an order tab");

      const { error: fileError } = await brand.client
        .from("order_tab_orders").insert({ tab_id: tab?.id, order_id: order.id, added_by: brand.id });
      fileError ? fail("the brand files its order in the tab", fileError)
                : ok("the brand files its order in the tab");

      const { data: brandTabs, error: listTabsError } = await brand.client
        .from("order_tabs").select("id, kind, label, sort, order_tab_orders (order_id)")
        .eq("org_id", org.id).order("sort");
      listTabsError
        ? fail("the brand reads its tabs with their orders", listTabsError)
        : (brandTabs ?? []).map((row) => row.kind).join() === "active,closed,custom"
          && brandTabs[2].order_tab_orders.some((row) => row.order_id === order.id)
        ? ok("the brand reads Active, Closed and its tab, with the order in it")
        : fail(`the brand's tabs read back as ${JSON.stringify(brandTabs)}`);

      const { data: factoryView } = await factoryClient.from("order_tabs").select("id").eq("org_id", org.id);
      (factoryView ?? []).length === 0
        ? ok("the factory on the order CANNOT see the brand's tabs")
        : fail("LEAK: the factory read the brand's tabs");

      const { error: strangerSave } = await losingFactory.rpc("save_order_tabs", { target_org: org.id, tabs: [] });
      strangerSave ? ok("an outsider CANNOT save another company's tabs")
                   : fail("LEAK: an outsider saved the brand's tabs");

      const { error: directInsert } = await brand.client
        .from("order_tabs").insert({ org_id: org.id, kind: "custom", label: "Direct", sort: 1 });
      directInsert ? ok("a tab CANNOT be written directly, only through the two functions")
                   : fail("LEAK: a tab was inserted directly");

      const { data: kept, error: saveError } = await brand.client.rpc("save_order_tabs", {
        target_org: org.id,
        tabs: [{ kind: "closed", label: "Done" }, { kind: "active", label: "Running" }],
      });
      saveError
        ? fail("save_order_tabs renames, reorders and deletes in one call", saveError)
        : (kept ?? []).map((row) => row.label).join() === "Done,Running"
        ? ok("save_order_tabs renames, reorders and deletes in one call")
        : fail(`save_order_tabs left ${JSON.stringify(kept)}`);
    }

    // The archive: closed orders only, and each company's own. This order is
    // still running, so every archive below must be refused.
    {
      const { error: openArchive } = await brand.client
        .from("order_archives").insert({ org_id: org.id, order_id: order.id, archived_by: brand.id });
      openArchive ? ok("an order still running CANNOT be archived")
                  : fail("LEAK: an open order was archived");

      const { error: strangerArchive } = await losingFactory
        .from("order_archives").insert({ org_id: org.id, order_id: order.id });
      strangerArchive ? ok("an outsider CANNOT archive the brand's order")
                      : fail("LEAK: an outsider archived the brand's order");

      const { data: factoryArchive, error: factoryArchiveError } = await factoryClient
        .from("order_archives").select("order_id").eq("org_id", org.id);
      factoryArchiveError
        ? fail("the factory's read of the brand's archive answers", factoryArchiveError)
        : (factoryArchive ?? []).length === 0
        ? ok("the factory on the order CANNOT see the brand's archive")
        : fail("LEAK: the factory read the brand's archive");
    }

    // Reorder style: the brand's request, copied into a new draft that
    // remembers the order. The request is the brand's, so nobody else may.
    {
      const { data: draftId, error: reorderError } = await brand.client
        .rpc("duplicate_rfq_from_order", { target_order: order.id });
      const { data: draft } = draftId
        ? await brand.client.from("rfqs").select("status, visibility, title, reorder_of_order_id").eq("id", draftId).single()
        : { data: null };
      reorderError
        ? fail("the brand reorders an order as a new draft request", reorderError)
        : draft?.status === "draft" && draft.visibility === "invited_only"
          && draft.reorder_of_order_id === order.id && /\(reorder\)$/.test(draft.title)
        ? ok("the brand reorders an order as a new draft request")
        : fail(`the reorder draft reads back as ${JSON.stringify(draft)}`);

      const { error: factoryReorder } = await factoryClient
        .rpc("duplicate_rfq_from_order", { target_order: order.id });
      factoryReorder ? ok("the factory on the order CANNOT reorder the brand's request")
                     : fail("LEAK: the factory copied the brand's request");

      const { error: strangerReorder } = await losingFactory
        .rpc("duplicate_rfq_from_order", { target_order: order.id });
      strangerReorder ? ok("an outsider CANNOT reorder the brand's order")
                      : fail("LEAK: an outsider copied the brand's request");

      if (draftId) await brand.client.from("rfqs").delete().eq("id", draftId);
    }

    // Cancelling (035, 070): a proposal is taken back by the side that made
    // it, and nobody else. The order is left running for what follows.
    {
      const { error: proposeError } = await brand.client
        .rpc("propose_cancellation", { target_order: order.id, reason: "Smoke test" });
      proposeError ? fail("the brand proposes cancelling", proposeError) : ok("the brand proposes cancelling");

      const { error: strangerWithdraw } = await losingFactory
        .rpc("withdraw_cancellation", { target_order: order.id });
      strangerWithdraw ? ok("an outsider CANNOT withdraw the brand's proposal")
                       : fail("LEAK: an outsider withdrew a proposal to cancel");

      const { error: factoryWithdraw } = await factoryClient
        .rpc("withdraw_cancellation", { target_order: order.id });
      factoryWithdraw ? ok("the factory CANNOT withdraw the brand's proposal")
                      : fail("LEAK: the factory withdrew the brand's proposal");

      const { data: withdrawn, error: withdrawError } = await brand.client
        .rpc("withdraw_cancellation", { target_order: order.id });
      withdrawError
        ? fail("the brand withdraws its proposal", withdrawError)
        : withdrawn?.cancel_proposed_by_org === null && withdrawn?.status !== "cancelled"
        ? ok("the brand withdraws its proposal, and the order carries on")
        : fail(`withdrawing returned ${JSON.stringify(withdrawn)}`);

      const { error: nothingToDecline } = await factoryClient
        .rpc("decline_cancellation", { target_order: order.id });
      /nobody has proposed/.test(nothingToDecline?.message ?? "")
        ? ok("decline_cancellation(target_order) answers, and refuses with nothing proposed")
        : fail("decline_cancellation's signature or refusal", nothingToDecline);
    }

    const { data: notSeen } = await losingFactory
      .from("milestone_updates").select("id").eq("milestone_id", first.id);
    (notSeen ?? []).length === 0
      ? ok("a competing factory CANNOT read that update")
      : fail("LEAK: a competitor read the update");

    // TSC holds the money (20261012000200): a paid step is funded as it
    // opens, and approving it is what pays the factory. Stripe's word comes in
    // through service-only functions, called here with the service key the
    // way /api/stripe-webhook calls them.
    const unfundedApproval = await brand.client.rpc("approve_milestone", {
      target_milestone: first.id, note: "Approved from the smoke test",
    });
    /fund .* first/.test(unfundedApproval.error?.message ?? "")
      ? ok("the brand CANNOT approve a paid step before its money is held")
      : fail("approving an unfunded paid step was not refused", unfundedApproval.error);

    const { data: deposit } = await admin
      .from("order_payments").select("*").eq("milestone_id", first.id).single();

    deposit.state === "due"
      ? ok("the open paid step's payment is due: it is funded before the work")
      : fail(`payment is ${deposit.state} on an open paid step, expected due`);

    {
      const { data: payout } = await brand.client
        .from("factory_payout_accounts").select("id").eq("org_id", winner.factory_org_id);
      (payout ?? []).length === 1
        ? ok("and the brand can read the factory's bank details — because money is owed")
        : fail("the brand cannot read the payout account with a payment due");

      const checkout = await brand.client.rpc("begin_payment_checkout", { target_payment: deposit.id });
      checkout.error ? fail("the brand owner starts paying", checkout.error)
        : Number(checkout.data.charged_cents) === Number(deposit.amount_cents) + Number(checkout.data.fee_cents)
            && [500, 700].includes(checkout.data.fee_bps)
          ? ok(`the brand owner starts paying: the step plus a ${checkout.data.fee_bps / 100}% service fee`)
          : fail(`checkout charges ${checkout.data.charged_cents} for a ${deposit.amount_cents} step`);

      const factoryCheckout = await factoryClient.rpc("begin_payment_checkout", { target_payment: deposit.id });
      factoryCheckout.error ? ok("the factory CANNOT start a payment to itself")
                            : fail("LEAK: the factory started a checkout");

      const brandFunds = await brand.client.rpc("record_payment_funded", {
        target_payment: deposit.id, charge: null, method_type: "card", method_label: "Visa ···4242", received: null,
      });
      brandFunds.error ? ok("the brand that pays CANNOT say its own payment arrived")
                       : fail("LEAK: the payer recorded its own payment as funded");

      const factoryFunds = await factoryClient.rpc("record_payment_funded", {
        target_payment: deposit.id, charge: null, method_type: "card", method_label: "Visa ···4242", received: null,
      });
      factoryFunds.error ? ok("the factory that is owed the money CANNOT say it arrived")
                         : fail("LEAK: the payee recorded the payment as funded");

      const clearing = await admin.rpc("record_payment_processing", {
        target_payment: deposit.id, method_type: "us_bank_account", method_label: "STRIPE TEST BANK ···6789",
      });
      clearing.error ? fail("a bank payment is recorded as clearing", clearing.error)
                     : ok("a bank payment is recorded as clearing, as the webhook does");

      const { data: afterClearing } = await admin
        .from("production_order_summary").select("paid_cents").eq("id", order.id).single();
      Number(afterClearing.paid_cents) === 0
        ? ok("a bank payment still clearing does not count as funded")
        : fail(`paid_cents is ${afterClearing.paid_cents} while the payment is only clearing`);

      const staff = await signedInUser(`payments-admin-${stamp}@example.com`);
      await admin.from("platform_admins").insert({ user_id: staff.id });

      const { data: board, error: boardError } = await staff.client.rpc("admin_payment_board");
      if (boardError) fail("the staff payments board is readable by staff", boardError);
      else board.some((row) => row.payment_id === deposit.id && row.state === "processing")
        ? ok("the clearing payment is on the board staff watch")
        : fail("the clearing payment is not on the staff board");

      const { error: boardLeak } = await brand.client.rpc("admin_payment_board");
      boardLeak ? ok("a brand CANNOT read the platform-wide payments board")
                : fail("LEAK: the payments board is readable by a party");

      const funded = await admin.rpc("record_payment_funded", {
        target_payment: deposit.id, charge: null, method_type: "us_bank_account",
        method_label: "STRIPE TEST BANK ···6789", received: null,
      });
      funded.error ? fail("the payment is recorded as held by TSC", funded.error)
                   : ok("the payment cleared: TSC holds it");

      const { data: heldStep } = await admin
        .from("order_milestones").select("state").eq("id", first.id).single();
      heldStep.state === "active"
        ? ok("funding does not finish a paid step: the brand still approves the work")
        : fail(`step is ${heldStep.state} after funding`);

      const { data: stillShut } = await admin
        .from("order_milestones").select("state").eq("id", milestones[1].id).single();
      stillShut.state === "pending"
        ? ok("the NEXT step stays shut until the brand approves")
        : fail(`next step is ${stillShut.state} before the approval`);

      const approved = await brand.client.rpc("approve_milestone", {
        target_milestone: first.id, note: "Approved from the smoke test",
      });
      approved.error ? fail("the brand approves the funded sample from the factory's update", approved.error)
                     : ok("the brand approves the funded sample from the factory's update, with no send-for-approval step");

      const { data: afterApproval } = await admin
        .from("order_milestones").select("state").eq("id", first.id).single();
      afterApproval.state === "complete"
        ? ok("the step completes on the brand's approval")
        : fail(`step is ${afterApproval.state} after approval`);

      const { data: opened } = await admin
        .from("order_milestones").select("state").eq("id", milestones[1].id).single();
      opened.state === "active"
        ? ok("and the next step opens, WITHOUT waiting for the payout")
        : fail(`next step is ${opened.state} after approval`);

      const { data: owed } = await admin
        .from("order_payments").select("state, release_requested_at").eq("id", deposit.id).single();
      owed.state === "confirmed" && owed.release_requested_at
        ? ok("the held money is now owed to the factory (payout requested)")
        : fail(`after approval the payment is ${owed.state}, payout requested: ${Boolean(owed.release_requested_at)}`);

      const { data: paid } = await admin
        .from("production_order_summary").select("paid_cents").eq("id", order.id).single();
      Number(paid.paid_cents) === Number(deposit.amount_cents)
        ? ok("the header total moved because a payment row moved, not because anything was typed")
        : fail(`paid_cents is ${paid.paid_cents}, expected ${deposit.amount_cents}`);

      const { data: told } = await admin
        .from("notifications").select("kind, org_id, order_id")
        .eq("order_id", order.id).eq("kind", "payment_confirmed");
      told.some((n) => n.org_id === winner.factory_org_id)
        ? ok("the factory was told, in the same transaction, that the money is held")
        : fail("the factory was not notified of the funding");

      told.every((n) => n.order_id === order.id)
        ? ok("payment notifications carry their order, so the link in the feed resolves")
        : fail("a payment notification has no order to link to");

      const released = await admin.rpc("record_payment_released", { target_payment: deposit.id, transfer: null });
      released.error ? fail("the payout is recorded", released.error)
                     : ok("the payout to the factory is recorded");

      const { data: stillOpen } = await admin
        .from("order_milestones").select("state").eq("id", milestones[1].id).single();
      stillOpen.state === "active"
        ? ok("paying out changes no milestone state — the work opened at approval")
        : fail(`paying out moved the next step to ${stillOpen.state}`);

      const { data: events } = await admin
        .from("payment_events").select("to_state").eq("payment_id", deposit.id).order("created_at");
      events.length === 4
        ? ok(`every transition left an event behind: ${events.map((e) => e.to_state).join(" → ")}`)
        : fail(`expected 4 payment events, got ${events.length}`);

      // ---- phase 4: the two sides can talk --------------------------------
      console.log("\nphase 4 — conversations");

      const threadOpen = await brand.client.rpc("open_order_thread", { target_order: order.id });
      threadOpen.error ? fail("the brand opens the conversation on its order", threadOpen.error)
                       : ok("the brand opens the conversation on its order");

      const threadId = threadOpen.data?.id;

      const again = await factoryClient.rpc("open_order_thread", { target_order: order.id });
      again.data?.id === threadId
        ? ok("the factory opening it reaches the same conversation, not a second one")
        : fail("opening from the other side created a different thread");

      const { error: outsiderOpen } = await losingFactory
        .rpc("open_order_thread", { target_order: order.id });
      outsiderOpen ? ok("a factory that lost the bid CANNOT open a conversation on the order")
                   : fail("LEAK: a non-party opened a conversation");

      // Sending is a plain insert governed by a with-check, unlike almost
      // everything else in this schema. Worth exercising through PostgREST.
      const { data: sent, error: sendError } = await brand.client.from("messages").insert({
        thread_id: threadId,
        sender_org_id: order.brand_org_id,
        sender_user_id: brand.id,
        body: "Can you confirm the sleeve opening on the PP sample?",
        body_lang: "en",
        body_translated: "你能确认PP样品的袖口尺寸吗？",
        body_translated_lang: "zh",
        translated_by: "smoke-test",
        delivery: "delivered",
      }).select("id, delivery").single();
      sendError ? fail("the brand sends a message", sendError) : ok("the brand sends a message");
      sent?.delivery === "checking"
        ? ok("it is saved to be checked first, even when the insert asks for delivered")
        : fail(`LEAK: a client wrote its own message as ${sent?.delivery}`);

      const { data: unscreened } = await factoryClient.from("messages").select("id").eq("id", sent?.id);
      (unscreened ?? []).length === 0
        ? ok("the factory sees nothing of it until the screen has looked")
        : fail("LEAK: the factory read a message still being checked");

      const strangerScreen = await screenAs(factoryClient, sent?.id);
      strangerScreen.status === 404
        ? ok("the other side CANNOT ask the screen to decide someone else's message")
        : fail(`the factory screened the brand's message (${strangerScreen.status} ${strangerScreen.delivery})`);

      const screened = await screenAs(brand.client, sent?.id);
      screened.delivery === "delivered" && screened.method === "pattern_only"
        ? ok("the screen delivers an ordinary message (no model key: pattern_only)")
        : fail(`the screen answered ${JSON.stringify(screened)}`);

      const rescreened = await screenAs(brand.client, sent?.id);
      rescreened.delivery === "delivered" && rescreened.method === null
        ? ok("screening it again changes nothing")
        : fail(`a repeated screen answered ${JSON.stringify(rescreened)}`);

      const { error: impersonation } = await brand.client.from("messages").insert({
        thread_id: threadId,
        sender_org_id: order.factory_org_id,
        sender_user_id: brand.id,
        body: "Pretending to be the factory",
      });
      impersonation ? ok("a party CANNOT write a message as the other side")
                    : fail("LEAK: impersonated the counterparty");

      const { data: rivalRead } = await losingFactory
        .from("messages").select("id").eq("thread_id", threadId);
      (rivalRead ?? []).length === 0
        ? ok("a factory outside the order reads none of the conversation")
        : fail("LEAK: an outsider read the messages");

      // The exact select string src/lib/domain/message.js uses. documents now
      // has THREE foreign keys into this graph, so an ambiguous embed would be
      // refused rather than guessed.
      const { data: withEmbeds, error: embedFail } = await factoryClient
        .from("messages")
        .select("id, body, body_translated, orgs:sender_org_id (name), documents (id, file_name)")
        .eq("thread_id", threadId);
      embedFail ? fail("the message embeds parse", embedFail)
                : ok("the embeds src/lib/domain/message.js uses parse");

      withEmbeds?.[0]?.orgs?.name
        ? ok(`a message names its sender from stored data ("${withEmbeds[0].orgs.name}")`)
        : fail("a message has no sender name");

      Array.isArray(withEmbeds?.[0]?.documents)
        ? ok("attachments embed as an ARRAY — a message can carry several")
        : fail("the attachment embed is not an array");

      const { data: unreadForFactory } = await factoryClient
        .from("message_thread_summary").select("unread_count, subject_kind, subject_title")
        .eq("id", threadId).single();
      unreadForFactory.unread_count === 1
        ? ok("the factory has exactly one unread message")
        : fail(`factory unread is ${unreadForFactory.unread_count}, expected 1`);
      unreadForFactory.subject_kind === "order"
        ? ok(`the conversation knows what it is about (${unreadForFactory.subject_title})`)
        : fail("the thread has no subject");

      const { data: unreadForSender } = await brand.client
        .from("message_thread_summary").select("unread_count").eq("id", threadId).single();
      unreadForSender.unread_count === 0
        ? ok("your own message is never unread to you")
        : fail(`sender sees ${unreadForSender.unread_count} unread`);

      await factoryClient.rpc("mark_thread_read", { target_thread: threadId });
      const { data: afterRead } = await factoryClient
        .from("message_thread_summary").select("unread_count").eq("id", threadId).single();
      afterRead.unread_count === 0
        ? ok("reading it clears the count — derived per person, so it cannot get stuck")
        : fail(`still ${afterRead.unread_count} unread after marking read`);

      const { error: readLeak } = await losingFactory
        .rpc("mark_thread_read", { target_thread: threadId });
      readLeak ? ok("an outsider CANNOT mark a stranger's conversation read")
               : fail("LEAK: outsider marked a thread read");

      const { data: msgNotif } = await admin
        .from("notifications").select("org_id, subject_type")
        .eq("subject_type", "thread").eq("subject_id", threadId);
      msgNotif.length === 1 && msgNotif[0].org_id === order.factory_org_id
        ? ok("sending notified the other side, and only the other side")
        : fail(`expected one notification to the factory, got ${msgNotif.length}`);

      // A message saved to be checked first. Only the server, holding the
      // secret key, records the verdict; while it is held the factory sees
      // nothing of it and is told nothing.
      const { data: held, error: heldError } = await brand.client.from("messages").insert({
        thread_id: threadId,
        sender_org_id: order.brand_org_id,
        sender_user_id: brand.id,
        body: "Easier on WeChat, my ID is smoke_brand_88",
      }).select("id").single();
      heldError ? fail("the brand sends a message with a WeChat ID", heldError)
                : ok("the brand sends a message with a WeChat ID");

      const { error: selfVerdict } = await brand.client.rpc("record_message_screening", {
        target_message: held?.id, outcome: "delivered", method: "ai",
      });
      selfVerdict ? ok("a sender CANNOT record the verdict on its own message")
                  : fail("LEAK: a sender delivered its own message past the check");

      const holding = await screenAs(brand.client, held?.id);
      holding.delivery === "held" && holding.method === "pattern"
        ? ok("the screen holds it on the patterns, without asking a model")
        : fail(`the screen answered ${JSON.stringify(holding)}`);

      const { data: heldRow } = await brand.client.from("messages").select("held_for").eq("id", held?.id).single();
      heldRow?.held_for === "contact_details" && holding.heldFor === "contact_details"
        ? ok("and its sender can read what it was held for (contact details), so the page says the right thing")
        : fail(`the sender reads held_for ${heldRow?.held_for} (screen said ${holding.heldFor})`);

      const { data: why } = await admin.from("message_screenings").select("reason").eq("message_id", held?.id).single();
      why?.reason === "a WeChat contact"
        ? ok(`and records why, for staff ("${why.reason}")`)
        : fail(`the screening reason is ${why?.reason}`);

      const { data: factorySeesHeld } = await factoryClient
        .from("messages").select("id").eq("id", held?.id);
      (factorySeesHeld ?? []).length === 0
        ? ok("the factory CANNOT read a held message")
        : fail("LEAK: the factory read a held message");

      const { data: afterHold } = await admin
        .from("notifications").select("id")
        .eq("subject_type", "thread").eq("subject_id", threadId);
      afterHold.length === 1
        ? ok("and is not notified of it")
        : fail(`expected still one notification, got ${afterHold.length}`);

      // Calls on the same conversation: the exact signatures and the select
      // string src/lib/domain/calls.js uses, so a renamed argument or an
      // ambiguous embed fails here rather than on a screen.
      const startsAt = new Date(Date.now() + 2 * 86400000).toISOString();

      // A call's words reach the other side, so they pass the same pattern
      // check as a message first, and the database refuses words it did not.
      const sneaky = "Quick one, or just WhatsApp me on +44 7700 900123 instead.";
      const { error: uncheckedError } = await brand.client.rpc("propose_call", {
        target_thread: threadId, starts_at: startsAt, duration_minutes: 30,
        title: "Smoke call", agenda: sneaky, time_zone: "America/New_York",
      });
      uncheckedError
        ? ok("a call's words the server never checked are refused (propose_call called directly)")
        : fail("LEAK: a call description went out without the contact-details check");
      const refused = await checkCallTextAs(brand.client, ["Smoke call", sneaky]);
      refused.status === 422 && /contact details/.test(refused.error ?? "")
        ? ok("the check refuses a WhatsApp number, saying to keep contact details out")
        : fail(`the check answered ${refused.status} ${refused.error ?? ""}`);
      const { error: stillRefused } = await brand.client.rpc("propose_call", {
        target_thread: threadId, starts_at: startsAt, duration_minutes: 30,
        title: "Smoke call", agenda: sneaky, time_zone: "America/New_York",
      });
      stillRefused ? ok("and a refused description is still refused by the database")
                   : fail("LEAK: a description the check refused went out");
      // A title reaches the other side on its own (the card, the
      // notification's title), so contact details in the title alone are
      // refused like a description's.
      const sneakyTitle = "Samples: text +44 7700 900123";
      const titleRefused = await checkCallTextAs(brand.client, [sneakyTitle]);
      titleRefused.status === 422 && /phone number/.test(titleRefused.error ?? "")
        ? ok("the check refuses a phone number in a call's title alone")
        : fail(`a title with a phone number answered ${titleRefused.status} ${titleRefused.error ?? ""}`);
      const { error: titleStillRefused } = await brand.client.rpc("propose_call", {
        target_thread: threadId, starts_at: startsAt, duration_minutes: 30,
        title: sneakyTitle, agenda: null, time_zone: "America/New_York",
      });
      titleStillRefused ? ok("and the database refuses that title with no description")
                        : fail("LEAK: a call title with a phone number went out");
      const { error: selfCheck } = await brand.client.rpc("record_call_text_check", {
        target_user: brand.id, texts: [sneaky],
      });
      selfCheck ? ok("a client CANNOT record its own words as checked")
                : fail("LEAK: a client recorded its own call text as checked");
      const passed = await checkCallTextAs(brand.client, ["Smoke call"]);
      passed.status === 200
        ? ok("ordinary words pass the check")
        : fail(`ordinary call words answered ${passed.status} ${passed.error ?? ""}`);

      const { data: proposed, error: proposeError } = await brand.client.rpc("propose_call", {
        target_thread: threadId, starts_at: startsAt, duration_minutes: 30,
        title: "Smoke call", agenda: null, time_zone: "America/New_York",
      });
      proposeError ? fail("the brand proposes a call", proposeError) : ok("the brand proposes a call");

      const { data: seenCalls, error: callsError } = await factoryClient.from("calls").select(`
        id, thread_id, counter_of, title, agenda, starts_at, duration_minutes,
        proposer_org_id, proposer_time_zone, status, responded_at, response_note,
        cancelled_by_org_id, created_at,
        thread:message_threads (
          id, order_id, rfq_id, brand_org_id, factory_org_id,
          brand:orgs!message_threads_brand_org_id_fkey (name),
          factory:orgs!message_threads_factory_org_id_fkey (name)
        )
      `).eq("id", proposed?.id);
      !callsError && seenCalls?.length === 1 && seenCalls[0].thread?.brand?.name
        ? ok("the factory reads it, with both companies' names embedded")
        : fail("the factory reads the call with its conversation", callsError);

      const { error: zoneError } = await factoryClient.rpc("set_my_time_zone", { zone: "Europe/Lisbon" });
      const { data: theirZone } = await brand.client.rpc("thread_counterparty_time_zone", { target_thread: threadId });
      !zoneError && theirZone === "Europe/Lisbon"
        ? ok("the brand reads the factory's time zone")
        : fail(`the brand read the factory's zone as ${theirZone}`, zoneError);

      const { error: ownAccept } = await brand.client.rpc("accept_call", { target_call: proposed?.id, time_zone: null });
      ownAccept ? ok("the brand CANNOT accept its own invite")
                : fail("LEAK: the proposer accepted its own call");

      const { data: strangerCalls } = await losingFactory.from("calls").select("id").eq("thread_id", threadId);
      (strangerCalls ?? []).length === 0
        ? ok("an outsider CANNOT see the conversation's calls")
        : fail("LEAK: an outsider read another conversation's calls");

      const { error: accepted } = await factoryClient.rpc("accept_call", { target_call: proposed?.id, time_zone: "Europe/Lisbon" });
      accepted ? fail("the factory accepts", accepted) : ok("the factory accepts");

      const { data: meetings, error: meetingsError } = await factoryClient.from("call_meetings").select("*");
      meetingsError || (meetings ?? []).length === 0
        ? ok("the video meetings table is unreadable from the browser")
        : fail("LEAK: a party read call_meetings");

      const { error: claimError } = await factoryClient.rpc("claim_call_meeting", { target_call: proposed?.id });
      claimError ? ok("a party CANNOT claim the meeting (the server's job)")
                 : fail("LEAK: a party called claim_call_meeting");

      // Joining: who may, and when. The call is two days out, so a party is
      // told it is not open yet, before anything asks Zoom.
      const signedOut = await joinAs(null, proposed?.id, { zoom: true });
      signedOut.status === 401 ? ok("joining needs a sign-in") : fail(`a signed-out join answered ${signedOut.status}`);
      const stranger = await joinAs(losingFactory, proposed?.id, { zoom: true });
      stranger.status === 404 ? ok("an outsider CANNOT join (and cannot tell the call exists)") : fail(`LEAK: an outsider's join answered ${stranger.status}`);
      const early = await joinAs(factoryClient, proposed?.id, { zoom: true });
      early.status === 409 && !early.signature
        ? ok("a party is told the call opens 10 minutes before it starts")
        : fail(`an early join answered ${early.status}`);

      // Moved to now by the secret key, as only a test may: without Zoom set
      // up, the answer says so and the call stands.
      await admin.from("calls").update({ starts_at: new Date(Date.now() + 5 * 60000).toISOString() }).eq("id", proposed?.id);
      const unset = await joinAs(factoryClient, proposed?.id);
      unset.status === 503 && /set up/.test(unset.error ?? "")
        ? ok("without Zoom, Join says video isn't set up yet")
        : fail(`a join without Zoom answered ${unset.status} ${unset.error}`);
      const { data: noMeeting } = await admin.from("call_meetings").select("call_id").eq("call_id", proposed?.id);
      (noMeeting ?? []).length === 0
        ? ok("and no meeting was claimed")
        : fail("a join without Zoom claimed a meeting");

      const { error: cancelError } = await brand.client.rpc("cancel_call", { target_call: proposed?.id, note: null });
      cancelError ? fail("either side cancels an accepted call", cancelError) : ok("either side cancels an accepted call");

      // A session signed out somewhere else. signOut() ends the session on
      // the auth server at once, but its access token is still a valid JWT
      // to the database until it expires, so the message is saved. The
      // screen used to ask the auth server (getUser) and answer 401, and the
      // message stayed `checking` for good with nobody told (#51's preview,
      // 23 Oct). It now asks the database, as the insert did.
      {
        const second = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
        const { data: login } = await second.auth.signInWithPassword({ email: `brand-${stamp}@example.com`, password: TEST_PASSWORD });
        const oldToken = login?.session?.access_token;
        await second.auth.signOut({ scope: "local" });
        const { data: gone } = await admin.auth.getUser(oldToken);
        const stale = createClient(URL, ANON, {
          global: { headers: { Authorization: `Bearer ${oldToken}` } },
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data: late, error: lateError } = await stale.from("messages").insert({
          thread_id: threadId,
          sender_org_id: order.brand_org_id,
          sender_user_id: brand.id,
          body: "Packing list attached for the first carton.",
        }).select("id, delivery").single();
        !gone?.user && !lateError && late?.delivery === "checking"
          ? ok("a token whose session was signed out elsewhere still saves a message (the database only checks the JWT)")
          : fail(`setup: signed-out token ${gone?.user ? "still known to auth" : "refused by auth"}, insert ${lateError?.message ?? late?.delivery}`);
        const lateScreen = await screenWithToken(oldToken, late?.id);
        lateScreen.delivery === "delivered"
          ? ok("and the screen still checks and delivers it, so it cannot sit in checking for good")
          : fail(`a message sent from a signed-out session was left ${lateScreen.delivery ?? "unscreened"} (${lateScreen.status} ${lateScreen.error ?? ""})`);
        const forged = await screenWithToken(`${oldToken.split(".")[0]}.${Buffer.from(JSON.stringify({ sub: brand.id, role: "authenticated" })).toString("base64url")}.x`, late?.id);
        forged.status === 401
          ? ok("a token with a forged signature CANNOT ask the screen anything")
          : fail(`a forged token got ${forged.status} ${forged.delivery}`);
      }
    }
  }
}

console.log("\nnotification emails");
{
  // The server's copy of the link rules must open the same place as the bell.
  const { notificationLink } = await import("../src/shared/notification-link.mjs");
  const { notificationPath } = await import("./generate-notification-email.mjs");
  const samples = [
    ["rfq", "quote_received"], ["rfq", "rfq_invited"], ["order", "order_created"],
    ["milestone", "milestone_submitted"], ["payment", "payment_due"], ["thread", "message"],
    ["capacity", "capacity_reminder"], ["milestone", "milestone_due_soon"], ["rfq", "rfq_matched"],
    ["credits", "credits_granted"], ["credits", "credits_adjusted"], ["org", "verification_needs_information"], ["referral", "referral_joined"], ["unknown", "x"],
  ].flatMap(([subject_type, kind]) => [true, false].map((isFactory) => [{
    subject_type, kind, subject_id: "00000000-0000-0000-0000-000000000001", order_id: "00000000-0000-0000-0000-000000000002",
  }, isFactory]));
  samples.every(([n, isFactory]) => notificationLink(n, { isFactory }) === notificationPath(n, { isFactory }))
    ? ok("an email's button opens where the bell's link does")
    : fail("the email's link rules differ from the bell's");

  // A vendor signed out lands on the vendor sign-in, still on its deep link.
  const { notificationEmail } = await import("./generate-notification-email.mjs");
  const emailEnv = { appUrl: "https://tsc.test", logoUrl: "", supportEmail: "ops@tsc.test", companyAddress: "" };
  const linkOf = (row) => notificationEmail({ category: "payments", title: "t", ...row }, emailEnv).text.match(/https:\/\/tsc\.test\S*/)?.[0];
  const ids = { subject_id: "00000000-0000-0000-0000-000000000001", order_id: "00000000-0000-0000-0000-000000000002" };
  const vendorStep = linkOf({ org_type: "factory", subject_type: "milestone", kind: "milestone_due_soon", ...ids });
  const vendorCredits = linkOf({ org_type: "factory", subject_type: "referral", kind: "referral_joined", ...ids });
  const brandStep = linkOf({ org_type: "brand", subject_type: "milestone", kind: "milestone_due_soon", ...ids });
  vendorStep === `https://tsc.test/app.html/orders/${ids.order_id}/milestones/${ids.subject_id}?portal=factory`
    && vendorCredits === "https://tsc.test/app.html/payout?tab=credits&portal=factory"
    && brandStep === `https://tsc.test/app.html/orders/${ids.order_id}/milestones/${ids.subject_id}`
    ? ok("a vendor's email links open the vendor sign-in; a brand's open the brand's")
    : fail(`email links: ${vendorStep} / ${vendorCredits} / ${brandStep}`);

  const sender = await signedInUser(`notify-sender-${stamp}@example.com`);
  const receiver = await signedInUser(`notify-receiver-${stamp}@example.com`);
  const { data: senderOrg } = await sender.client.rpc("create_org", { org_name: `Notify Brand ${stamp}`, org_kind: "brand" });
  const { data: receiverOrg } = await receiver.client.rpc("create_org", { org_name: `Notify Factory ${stamp}`, org_kind: "factory" });

  const { error: strangerSet } = await sender.client.rpc("set_notification_preference", { target_org: receiverOrg?.id, category: "rfq", enabled: false });
  strangerSet ? ok("a company CANNOT change another company's email switches")
              : fail("LEAK: a company changed another's email switches");
  const { data: strangerRead } = await sender.client.from("notification_preferences").select("org_id").eq("org_id", receiverOrg?.id);
  (strangerRead ?? []).length === 0 ? ok("nor read them") : fail("LEAK: a company read another's email switches");
  const { data: queueRead, error: queueError } = await sender.client.from("notification_email_outbox").select("id").limit(1);
  queueError || (queueRead ?? []).length === 0 ? ok("the email queue is unreadable from the browser") : fail("LEAK: a user read the email queue");
  const { error: claimError } = await sender.client.rpc("claim_notification_emails", { max_rows: 1 });
  claimError ? ok("a user CANNOT claim emails (the server's job)") : fail("LEAK: a user claimed emails");

  const { data: switched, error: switchError } = await receiver.client.rpc("set_notification_preference", { target_org: receiverOrg?.id, category: "messages", enabled: false });
  !switchError && switched?.message_emails === false && switched?.rfq_emails === true
    ? ok("a member turns one switch off, and only that one")
    : fail("a member turns a switch off", switchError);

  // Notifications are written by functions; the secret key stands in here.
  const { data: quoteNote } = await admin.from("notifications").insert({
    org_id: receiverOrg?.id, kind: "rfq_invited", subject_type: "rfq", subject_id: senderOrg?.id,
    title: `Notify Brand ${stamp} invited you to quote`, body: "Quotes close soon.",
  }).select().single();
  const { data: messageNote } = await admin.from("notifications").insert({
    org_id: receiverOrg?.id, kind: "message", subject_type: "thread", subject_id: senderOrg?.id, title: "A message",
  }).select().single();
  const { data: queued } = await admin.from("notification_email_outbox").select("notification_id, status").eq("org_id", receiverOrg?.id);
  (queued ?? []).length === 1 && queued[0].notification_id === quoteNote?.id
    ? ok("the invite is queued for email; the message, with its switch off, is not")
    : fail(`queued ${JSON.stringify(queued)}`);

  const { default: send } = await import("../api/notification-emails.js");
  const callSender = async (token) => {
    const keys = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "RESEND_API_KEY", "RESEND_FROM_EMAIL", "MAILPIT_URL", "VERCEL"];
    const saved = { ...process.env };
    Object.assign(process.env, { SUPABASE_URL: URL, SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE, MAILPIT_URL: "http://127.0.0.1:54324" });
    for (const key of ["RESEND_API_KEY", "RESEND_FROM_EMAIL", "VERCEL"]) delete process.env[key];
    let status = 0;
    let body = null;
    const response = { status(code) { status = code; return response; }, json(payload) { body = payload; return response; } };
    try {
      await send({ method: "POST", headers: { host: "127.0.0.1:5173", ...(token ? { authorization: `Bearer ${token}` } : {}) } }, response);
    } finally {
      for (const key of keys) if (key in saved) process.env[key] = saved[key]; else delete process.env[key];
    }
    return { status, ...body };
  };

  (await callSender(null)).status === 401 ? ok("sending needs a sign-in") : fail("a signed-out caller ran the sender");

  const mailpitUp = await fetch("http://127.0.0.1:54324/api/v1/info").then((r) => r.ok).catch(() => false);
  if (!mailpitUp) {
    ok("(skipped: no local Mailpit to send to)");
  } else {
    const { data: session } = await sender.client.auth.getSession();
    let row = null;
    for (let round = 0; round < 30 && row?.status !== "sent"; round += 1) {
      await callSender(session?.session?.access_token);
      ({ data: row } = await admin.from("notification_email_outbox").select("status, last_error").eq("notification_id", quoteNote?.id).single());
    }
    row?.status === "sent" ? ok("the sender delivers it") : fail(`the queued email is ${row?.status}`, row?.last_error);
    const search = await fetch(`http://127.0.0.1:54324/api/v1/search?query=${encodeURIComponent(`to:notify-receiver-${stamp}@example.com`)}`).then((r) => r.json());
    const arrived = (search.messages ?? []).find((message) => message.Subject === quoteNote?.title);
    arrived ? ok("and it arrives, with the notification's title as its subject") : fail("no email arrived in Mailpit");
  }
  void messageNote;
}

console.log("\ndaily notifications and dates in the reader's zone");
{
  // The server's copy of the date wording must say what the bell says.
  const { notificationBody } = await import("../src/shared/notification-text.mjs");
  const { notificationBody: emailBody } = await import("./generate-notification-email.mjs");
  const deadline = "2026-11-20T20:00:00+00:00";
  const samples = [
    { kind: "rfq_invited", body: "Quotes close Nov 20.", data: { quote_deadline: deadline } },
    { kind: "rfq_matched", body: "Demo Brand is looking for a factory. Quotes close Nov 20.", data: { quote_deadline: deadline } },
    { kind: "call_proposed", body: "Fit review", data: { starts_at: deadline, duration_minutes: 30 } },
    { kind: "message", body: "A message", data: {} },
    { kind: "message", body: "Trims by Friday.", data: { message_text: { en: "Trims by Friday.", zh: "辅料周五前确认。" } } },
    { kind: "rfq_invited", body: "Quotes close Nov 20.", data: null },
  ];
  const zones = [undefined, "UTC", "Asia/Shanghai", "America/New_York", "Not/AZone"];
  samples.every((n) => zones.every((timeZone) => [true, false].every((withZone) =>
    notificationBody(n, { timeZone, withZone }) === emailBody(n, { timeZone, withZone }))))
    ? ok("an email words its dates as the bell does")
    : fail("the email's date wording differs from the bell's");
  const translated = samples.find((n) => n.data?.message_text);
  notificationBody(translated) === "Trims by Friday."
    && notificationBody(translated, { locale: "zh" }) === "辅料周五前确认。"
    && emailBody(translated, { locale: "zh" }) === "辅料周五前确认。"
    && emailBody(translated, { locale: "en" }) === "Trims by Friday."
    ? ok("a message reaches the bell and the email in the reader's language")
    : fail("the message notification's language", { bell: notificationBody(translated), zhEmail: emailBody(translated, { locale: "zh" }) });
  const { notificationTitle } = await import("../src/shared/notification-text.mjs");
  const { notificationTitle: emailTitle } = await import("./generate-notification-email.mjs");
  const titles = [
    { kind: "milestone_due_soon", title: '"Fit sample" is due in 3 days', data: { due_on: "2026-11-05" } },
    { kind: "milestone_due_soon", title: '"Fit sample" is due today', data: { due_on: "2026-10-20" } },
    { kind: "milestone_due_soon", title: '"Fit sample" is due tomorrow', data: null },
    { kind: "quote_received", title: "New quote", data: {} },
  ];
  const instants = ["2026-11-02T07:00:00Z", "2026-11-04T20:00:00Z"].map((iso) => new Date(iso));
  titles.every((n) => zones.every((timeZone) => instants.every((now) =>
    notificationTitle(n, { timeZone, now }) === emailTitle(n, { timeZone, now }))))
    ? ok("an email counts a step's days as the bell does")
    : fail("the email's due-date title differs from the bell's");
  const shanghai = notificationBody(samples[0], { timeZone: "Asia/Shanghai", withZone: true });
  const utc = notificationBody(samples[0], { timeZone: "UTC", withZone: true });
  /Nov 21/.test(shanghai) && /Nov 20/.test(utc) && /GMT\+8/.test(shanghai)
    ? ok(`a deadline is said in the reader's zone: "${utc}" / "${shanghai}"`)
    : fail(`deadline wording: "${utc}" / "${shanghai}"`);

  const stranger = await signedInUser(`daily-stranger-${stamp}@example.com`);
  const { error: runError } = await stranger.client.rpc("run_daily_notifications");
  runError ? ok("a user CANNOT run the daily job") : fail("LEAK: a user ran the daily job");
  const { error: matchError } = await stranger.client.rpc("notify_rfq_matches", { target_rfq: "00000000-0000-0000-0000-000000000001" });
  matchError ? ok("nor tell factories about a request") : fail("LEAK: a user sent request matches");
  const { data: remindersRead, error: remindersError } = await stranger.client.from("notification_reminders").select("kind").limit(1);
  remindersError || (remindersRead ?? []).length === 0 ? ok("nor read which reminders went out") : fail("LEAK: a user read the reminders");
  const { data: noticeData, error: noticeDataError } = await admin.from("notifications").select("data").limit(1);
  !noticeDataError && Array.isArray(noticeData) ? ok("notifications carry data") : fail("notifications.data", noticeDataError);

  // The route refuses everyone but the cron and staff. Running it for real is
  // the e2e's job (it sends reminders to whoever is due).
  const { default: daily } = await import("../api/cron-daily.js");
  const callDaily = async (method, authorization) => {
    const saved = { ...process.env };
    Object.assign(process.env, { SUPABASE_URL: URL, SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE, CRON_SECRET: "smoke-secret" });
    let status = 0;
    const response = { status(code) { status = code; return response; }, json() { return response; } };
    try {
      await daily({ method, headers: { host: "127.0.0.1:5173", ...(authorization ? { authorization } : {}) } }, response);
    } finally {
      for (const key of ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "CRON_SECRET"]) {
        if (key in saved) process.env[key] = saved[key]; else delete process.env[key];
      }
    }
    return status;
  };
  const { data: strangerSession } = await stranger.client.auth.getSession();
  (await callDaily("GET", null)) === 401 ? ok("the daily job refuses a call with no secret") : fail("the daily job ran without its secret");
  (await callDaily("GET", "Bearer wrong")) === 401 ? ok("and a wrong secret") : fail("the daily job ran with a wrong secret");
  (await callDaily("POST", `Bearer ${strangerSession?.session?.access_token}`)) === 401
    ? ok("and a signed-in user who is not staff") : fail("LEAK: a user ran the daily job through the route");
  (await callDaily("PUT", null)) === 405 ? ok("and any other method") : fail("the daily job took a PUT");
}

console.log("\nphase 5 — the home screen, and joining a team");
{
  // dashboard_snapshot is the single source for every figure on the home
  // screen. It runs as the CALLER, so a mistake in it can under-report but
  // cannot leak — which is why it is not a definer function.
  const { data: brandRows, error: snapError } = await brand.client
    .rpc("dashboard_snapshot", { target_org: org.id });
  const snap = Array.isArray(brandRows) ? brandRows[0] : brandRows;

  if (snapError || !snap) {
    fail("the brand's dashboard snapshot loads", snapError);
  } else {
    ok("the brand's dashboard snapshot loads in one round trip");

    snap.is_factory === false
      ? ok("it knows which side it is describing")
      : fail("the snapshot has the wrong side");

    // Cross-check a figure against the rows it claims to summarise. A
    // dashboard that disagrees with the screen it links to is worse than one
    // that shows nothing.
    const { count: reallyActive } = await admin
      .from("production_orders").select("*", { count: "exact", head: true })
      .eq("brand_org_id", org.id).eq("status", "active");
    snap.orders_active === reallyActive
      ? ok(`the order count matches the rows behind it (${snap.orders_active})`)
      : fail(`snapshot says ${snap.orders_active} active, table says ${reallyActive}`);

    // Scoped to THIS org's orders. Summing every due payment in the database
    // compares one org's snapshot against the whole marketplace, which passes
    // on a fresh stack and fails the moment the walkthrough has run first.
    const { data: myOrders } = await admin
      .from("production_orders").select("id").eq("brand_org_id", org.id);
    const myOrderIds = (myOrders ?? []).map((row) => row.id);
    const { data: duePayments } = await admin
      .from("order_payments").select("amount_cents, order_id, state")
      .eq("state", "due")
      .in("order_id", myOrderIds.length ? myOrderIds : ["00000000-0000-0000-0000-000000000000"]);
    const dueSum = duePayments.reduce((t, p) => t + Number(p.amount_cents), 0);
    Number(snap.payments_due_cents) === dueSum
      ? ok(`money due matches the payment rows (${snap.payments_due_cents})`)
      : fail(`snapshot says ${snap.payments_due_cents} due, rows say ${dueSum}`);
  }

  // An org you are not in tells you nothing, even by shape.
  const { data: nosyRows } = await losingFactory
    .rpc("dashboard_snapshot", { target_org: org.id });
  const nosy = Array.isArray(nosyRows) ? nosyRows[0] : nosyRows;
  (!nosy || (nosy.orders_active === 0 && Number(nosy.payments_due_cents) === 0))
    ? ok("someone outside the org learns nothing from its dashboard")
    : fail("LEAK: the dashboard reported another org's figures");

  // ---- invitations, which nothing has ever exercised --------------------
  const joiner = await signedInUser(`joiner-${stamp}@example.com`);

  const { error: inviteError } = await brand.client.from("org_invitations").insert({
    org_id: org.id, email: `joiner-${stamp}@example.com`, role: "member",
  });
  inviteError ? fail("an owner invites someone", inviteError)
              : ok("an owner invites someone by email address");

  const { data: theirs } = await joiner.client
    .from("org_invitations").select("id, role, orgs (name)").eq("status", "pending");
  (theirs ?? []).length === 1
    ? ok("the invited person can see the invitation addressed to them")
    : fail(`the invited person sees ${(theirs ?? []).length} invitations`);

  // The one that matters: an invitation is addressed to an email, and only
  // the holder of that address may see or take it.
  const { data: notTheirs } = await losingFactory
    .from("org_invitations").select("id").eq("status", "pending");
  (notTheirs ?? []).length === 0
    ? ok("somebody else's invitation is invisible to you")
    : fail("LEAK: read an invitation addressed to another person");

  const { error: stealError } = await losingFactory
    .rpc("accept_invitation", { invitation_id: theirs?.[0]?.id });
  stealError ? ok("and cannot be accepted by anyone but the person invited")
             : fail("LEAK: accepted somebody else's invitation");

  const { error: acceptError } = await joiner.client
    .rpc("accept_invitation", { invitation_id: theirs[0].id });
  acceptError ? fail("the invited person accepts", acceptError)
              : ok("the invited person accepts and joins the organisation");

  const { data: nowIn } = await admin
    .from("org_members").select("role").eq("org_id", org.id).eq("user_id", joiner.id).maybeSingle();
  nowIn?.role === "member"
    ? ok("they are a member of the org, at the role they were invited as")
    : fail("the accepted invitation did not create a membership");

  const { data: usedUp } = await admin
    .from("org_invitations").select("status").eq("id", theirs[0].id).single();
  usedUp.status === "accepted"
    ? ok("and the invitation is spent, not left open")
    : fail(`invitation is ${usedUp.status} after being accepted`);

  // A new member is a member, not an owner: the money actions stay shut.
  // Unconditional on purpose — mark_payment_sent checks who you are BEFORE it
  // checks what state the payment is in, so any payment on the order proves
  // the authorisation. An assertion that only runs when the data happens to
  // suit it is an assertion that quietly stops running.
  const { data: anyPayment } = await admin
    .from("order_payments").select("id, order_id, production_orders!inner(brand_org_id)")
    .eq("production_orders.brand_org_id", org.id).limit(1).maybeSingle();

  if (!anyPayment) {
    fail("no payment on the brand's orders to test member permissions against");
  } else {
    const { error: notOwner } = await joiner.client
      .rpc("mark_payment_sent", { target_payment: anyPayment.id, reference: null, note: null });
    notOwner
      ? ok("a newly joined member CANNOT record a payment as sent — that stays with owners")
      : fail("LEAK: a plain member moved money");
  }
}

console.log("\nphase 6 — admin operations");
{
  // Every function on this surface is security definer and therefore has no
  // policy behind it. The checks that matter are the ones a party fails.
  const staff = await signedInUser(`ops-admin-${stamp}@example.com`);
  await admin.from("platform_admins").insert({ user_id: staff.id });

  // org_members_read ends in `or is_platform_admin()`, so an unfiltered read of
  // that table returns every membership in the marketplace to staff. The app
  // took the first row as the signed-in user's own org, which dropped an admin
  // into a stranger's workspace mid-onboarding. RLS says what may be read; it
  // does not say what a query means.
  const { data: staffOrgs, error: staffOrgsError } = await staff.client
    .from("org_members")
    .select("org_id")
    .eq("user_id", staff.id);
  if (staffOrgsError) fail("staff can query their own memberships", staffOrgsError);
  else (staffOrgs ?? []).length === 0
    ? ok("an admin's own membership list is empty — they are staff, not a company")
    : fail(`an admin appears to belong to ${staffOrgs.length} org(s)`);

  const { data: everyMembership } = await staff.client.from("org_members").select("org_id");
  (everyMembership ?? []).length > 0
    ? ok("while the same table unfiltered shows staff the whole marketplace, by design")
    : fail("admin tooling can no longer see memberships at all");

  const { data: queue, error: queueError } = await staff.client.rpc("admin_verification_queue");
  if (queueError) fail("staff can read the verification queue", queueError);
  else ok(`the verification queue is readable by staff (${queue.length} companies)`);

  const { error: queueLeak } = await brand.client.rpc("admin_verification_queue");
  queueLeak ? ok("a brand CANNOT read the verification queue")
            : fail("LEAK: the verification queue is readable by a party");

  const { error: rfqLeak } = await factory.client.rpc("admin_rfq_queue");
  rfqLeak ? ok("a factory CANNOT read every brand's requests")
          : fail("LEAK: marketplace-wide requests are readable by a factory");

  const { error: quoteLeak } = await brand.client.rpc("admin_quote_queue");
  quoteLeak ? ok("a brand CANNOT read every factory's prices")
            : fail("LEAK: marketplace-wide quotes are readable by a brand");

  const { error: metricsLeak } = await brand.client.rpc("admin_overview_metrics");
  metricsLeak ? ok("nor the marketplace counts")
              : fail("LEAK: the overview metrics are readable by a party");

  // The whole gate: approving yourself is approving your own right to quote.
  // ORG_NAME, not a guess at it. This read used to be `Maison ${stamp}` while
  // the org is `Maison Rue ${stamp}`, so it never matched and fell through to
  // "any org this user belongs to" — which is a different org the moment the
  // duplicate-name check above creates a second one, and then the profile
  // assertion below is about a company that has no profile.
  const selfOrg = org?.id
    ?? (await admin.from("orgs").select("id").eq("name", ORG_NAME).maybeSingle()).data?.id;

  if (!selfOrg) {
    fail("could not resolve the brand's org for the self-approval check");
  } else {
    const { error: selfApprove } = await brand.client.rpc("admin_review_decision", {
      target_org: selfOrg, decision: "approved", note: null, risk: null,
    });
    selfApprove ? ok("a brand CANNOT approve its own company")
                : fail("LEAK: a brand verified itself");

    const { error: reviewRowLeak, data: reviewRows } = await brand.client
      .from("org_reviews").select("org_id, note, owner_user_id").eq("org_id", selfOrg);
    if (reviewRowLeak) ok("org_reviews is refused outright to the company under review");
    else (reviewRows ?? []).length === 0
      ? ok("the company under review cannot read the staff notes about itself")
      : fail("LEAK: internal review notes are readable by the company");

    // And the admin path works end to end.
    const returned = await staff.client.rpc("admin_review_decision", {
      target_org: selfOrg, decision: "needs_information", note: null, risk: null,
    });
    returned.error ? ok("returning a review with no note is refused")
                   : fail("a review went back with nothing for the company to act on");

    const withNote = await staff.client.rpc("admin_review_decision", {
      target_org: selfOrg, decision: "needs_information",
      note: "Please upload your business registration.", risk: "medium",
    });
    withNote.error ? fail("an admin returns a review with a note", withNote.error)
                   : ok("an admin returns a review with a note");

    const { data: told } = await brand.client
      .from("notifications").select("id, body").eq("kind", "verification_needs_information");
    (told ?? []).length > 0
      ? ok("and the company is told what is missing")
      : fail("the company was not notified of what to send");

    // The finish card the company waits on reads this. Without it the
    // company saw "awaiting verification" and nothing it could act on.
    const { data: ownReview, error: ownReviewError } = await brand.client
      .rpc("my_review_status", { target_org: selfOrg });
    const own = (ownReview ?? [])[0];
    ownReviewError
      ? fail("the company can read its own review", ownReviewError)
      : own?.state === "needs_information" && own?.message === "Please upload your business registration."
        ? ok("the company reads the request it was sent, on its own screen")
        : fail(`the company read ${JSON.stringify(own)}`);

    const { error: strangerReview } = await factory.client.rpc("my_review_status", { target_org: selfOrg });
    strangerReview ? ok("another company CANNOT read that review")
                   : fail("LEAK: another company read a review that is not its own");

    const { data: resent, error: resentError } = await brand.client
      .rpc("resubmit_for_review", { target_org: selfOrg });
    resentError ? fail("the company sends its profile back", resentError)
      : resent === "ready_for_review" ? ok("and sends its profile back to the top of staff's queue")
      : fail(`resubmit_for_review returned ${resent}`);

    const approved = await staff.client.rpc("admin_review_decision", {
      target_org: selfOrg, decision: "approved", note: "Registration checked.", risk: "low",
    });
    approved.error ? fail("an admin approves the company", approved.error)
                   : ok("an admin approves the company");

    const { data: profileAfter } = await admin
      .from("brand_profiles").select("verification_status").eq("org_id", selfOrg).maybeSingle();
    profileAfter?.verification_status === "verified"
      ? ok("approval writes the same column review_document() writes, so the two cannot disagree")
      : fail(`profile is ${profileAfter?.verification_status} after approval`);
  }

  // Shapes the domain modules index into. A renamed column here is a blank
  // screen, not an error.
  const { data: rfqRows } = await staff.client.rpc("admin_rfq_queue", { row_limit: 50 });
  const rfqRow = (rfqRows ?? [])[0];
  rfqRow && "invited_count" in rfqRow && "quote_count" in rfqRow && "brand_name" in rfqRow
    ? ok("the request queue carries the counts the table column headers promise")
    : fail("admin_rfq_queue is missing the columns the admin table reads");

  const { data: quoteRows } = await staff.client.rpc("admin_quote_queue", { row_limit: 50 });
  const quoteRow = (quoteRows ?? [])[0];
  if (!quoteRow) fail("admin_quote_queue returned nothing after a full run");
  else {
    "total_cents" in quoteRow && "factory_name" in quoteRow
      ? ok("the quote queue carries a total and both party names")
      : fail("admin_quote_queue is missing the columns the admin table reads");

    const priced = (quoteRows ?? []).find((row) => row.total_cents != null);
    priced && Number.isFinite(Number(priced.total_cents))
      ? ok("and the total is a number, summed in SQL rather than in JavaScript")
      : fail("no quote in the queue carries a usable total");
  }

  // The request page staff open from that table. It read the prototype's
  // constants, so a request with quotes said "0 vendor quotes" and an empty
  // brief. It now reads the records with the brand screens' own select
  // strings (src/lib/domain/rfq.js, quote.js, admin.js rfqDetail), which only
  // works because the read policies end in `or is_platform_admin()`.
  const quoted = (rfqRows ?? []).find((row) => row.quote_count >= 2);
  if (!quoted) fail("no request in the queue has two quotes after a full run");
  else {
    const { data: staffRfq, error: staffRfqError } = await staff.client
      .from("rfqs")
      .select("id, title, brief, quantity_total, material_notes, target_delivery_month, requires_sample, sample_notes, target_unit_price_min_cents, target_unit_price_max_cents, currency, additional_details, orgs!rfqs_brand_org_id_fkey (id, name)")
      .eq("id", quoted.rfq_id)
      .maybeSingle();
    staffRfqError || !staffRfq
      ? fail("staff can read a request's brief", staffRfqError)
      : ok("staff read the request's brief through the brand's own select");

    const { data: staffQuotes, error: staffQuotesError } = await staff.client
      .from("quotes")
      .select("id, status, unit_price_cents, production_quantity, bulk_lead_time_days, deposit_pct, factory_notes, orgs!quotes_factory_org_id_fkey (id, name, slug, factory_profiles (verification_status, trust_tier, location))")
      .eq("rfq_id", quoted.rfq_id)
      .in("status", ["submitted", "accepted", "declined", "superseded", "withdrawn"]);
    staffQuotesError
      ? fail("staff can read a request's quotes", staffQuotesError)
      : (staffQuotes ?? []).length === quoted.quote_count
        ? ok(`and every quote the list counts (${quoted.quote_count}), revisions included`)
        : fail(`the list counts ${quoted.quote_count} quotes, staff read ${(staffQuotes ?? []).length}`);

    const ids = (staffQuotes ?? []).map((row) => row.id);
    const [lines, links, splits] = await Promise.all([
      staff.client.from("quote_sample_lines").select("quote_id, stage, cost_cents, timing_days").in("quote_id", ids),
      staff.client.from("taxonomy_links").select("term_id").eq("subject_type", "rfq").eq("subject_id", quoted.rfq_id),
      staff.client.from("rfq_colour_splits").select("id, colour, quantity, sort").eq("rfq_id", quoted.rfq_id),
    ]);
    [lines, links, splits].every((result) => !result.error)
      ? ok("with their sample plans, the request's categories and its colour split")
      : fail("staff cannot read part of a request's detail", lines.error ?? links.error ?? splits.error);
    (lines.data ?? []).length > 0
      ? ok("and the sample plan lines are really there, not just permitted")
      : fail("staff read no sample lines for a request whose quotes have them");
  }

  // Test emails. The demo staff login is @example.com, which has no mailbox;
  // the provider's refusal used to reach the screen word for word.
  const mailEnv = { RESEND_API_KEY: "re_smoke_not_a_key", RESEND_FROM_EMAIL: "TSC <noreply@smoke.invalid>" };
  const providerCalls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (url, init) => {
    if (!String(url).startsWith("https://api.resend.com/")) return realFetch(url, init);
    providerCalls.push(url);
    return Promise.resolve(new Response(
      JSON.stringify({ statusCode: 422, name: "validation_error", message: "Invalid `to` field. The email address needs to follow the `email@example.com` or `Name <email@example.com>` format." }),
      { status: 422, headers: { "Content-Type": "application/json" } },
    ));
  };
  try {
    const reserved = await staffRouteAs("send-test-email", staff.client, { body: { template: "review-approved" }, env: mailEnv });
    reserved.status === 422 && /reserved for examples and testing/.test(reserved.error ?? "") && providerCalls.length === 0
      ? ok("a test email to a reserved address is refused in plain words, before the provider is called")
      : fail(`a reserved address got ${reserved.status}: ${reserved.error} (${providerCalls.length} provider call(s))`);

    const realStaff = await signedInUser(`mail-admin-${stamp}@smoke-mail.dev`);
    await admin.from("platform_admins").insert({ user_id: realStaff.id });
    const refused = await staffRouteAs("send-test-email", realStaff.client, { body: { template: "review-approved" }, env: mailEnv });
    refused.status === 502 && !/`to` field|validation_error/.test(refused.error ?? "") && /nothing was sent/.test(refused.error ?? "")
      ? ok("and a provider refusal reads as a sentence, not the provider's message")
      : fail(`a provider refusal read: ${refused.error}`);
  } finally {
    globalThis.fetch = realFetch;
  }

  const { data: metrics } = await staff.client.rpc("admin_overview_metrics");
  const m = (metrics ?? [])[0];
  m && typeof m.payments_awaiting_confirmation === "number"
    ? ok("the overview counts payments nothing else will ever chase")
    : fail("admin_overview_metrics did not return the payment backstop count");
}


console.log("\nadmin — AI help for reviewers, and clearing test data");
{
  const staff = await signedInUser(`assist-admin-${stamp}@example.com`);
  await admin.from("platform_admins").insert({ user_id: staff.id });
  const { data: mill } = await admin.from("orgs")
    .insert({ type: "factory", name: `Assist Mill ${stamp}`, slug: `assist-mill-${stamp}` })
    .select("id").single();
  await admin.from("factory_profiles").insert({
    org_id: mill.id, legal_name: "Assist Mill Textiles Ltd", website_url: "https://assist-mill.example.com",
    country_code: "PT", moq: 200, intro: "Jersey and fleece.",
  });

  const { data: input, error: inputError } = await staff.client.rpc("admin_review_assist_input", { target_org: mill.id });
  inputError ? fail("staff read what the AI would be given", inputError)
    : input?.profile?.legal_name === "Assist Mill Textiles Ltd" && !JSON.stringify(input).includes(`assist-admin-${stamp}`)
      ? ok("the AI reads the company's details and no one's address")
      : fail("admin_review_assist_input did not read as expected");

  const stranger = await staffRouteAs("admin-review-assist", brand.client, { body: { action: "check", orgId: mill.id } });
  stranger.status === 403 ? ok("a company CANNOT ask for review suggestions") : fail(`a brand got ${stranger.status} from review help`);

  const noKey = await staffRouteAs("admin-review-assist", staff.client, { body: { action: "check", orgId: mill.id } });
  noKey.status === 200 && noKey.available === false && !noKey.findings
    ? ok("without a model key there are no suggestions, and nothing stands in for them")
    : fail("review suggestions without a key", noKey);

  const draft = await staffRouteAs("admin-review-assist", staff.client, {
    body: { action: "draft", orgId: mill.id, topics: ["Company ownership details", "not a topic"] },
  });
  draft.source === "template" && draft.message.includes("Company ownership details")
    && draft.message.includes("Business registration") && !draft.message.includes("not a topic")
    ? ok("without a model the draft is built from the ticked topics and the incomplete checks")
    : fail("the fallback draft", draft);

  const grounded = await staffRouteAs("admin-review-assist", staff.client, {
    body: { action: "check", orgId: mill.id },
    env: { OPENROUTER_API_KEY: "smoke-not-a-key" },
    model: {
      checked: ["Legal name", "Business registration"],
      findings: [
        { topic: "Legal name", observation: "The legal name differs from the company name.", evidence: "Assist Mill Textiles Ltd", ask: "Which entity signs contracts?" },
        { topic: "Registration", observation: "Registered in Delaware.", evidence: "Registered in Delaware in 1999", ask: "Send the certificate." },
      ],
      score: 92,
    },
  });
  grounded.available && grounded.findings?.length === 1 && grounded.dropped === 1 && !("score" in grounded)
    ? ok("a suggestion whose evidence is not in the submission is dropped, and no score gets through")
    : fail("the evidence check on suggestions", grounded);

  const { data: saved } = await staff.client.rpc("admin_review_assists", { target_org: mill.id });
  saved?.check?.output?.findings?.length === 1 && saved.check.model === "smoke/fake-model"
    ? ok("staff see the last suggestions again without asking the model")
    : fail("the saved suggestions", saved);

  const { error: forged } = await staff.client.rpc("record_review_assist", {
    target_org: mill.id, assist_kind: "check", model_name: "x", assist: {}, acting_user: staff.id,
  });
  forged ? ok("even staff CANNOT write suggestions from the browser") : fail("LEAK: record_review_assist is callable by a signed-in user");

  // What staff are told when the model cannot help: what happened, in words.
  const upstreamAnswers = async (status, run) => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (url, init) => String(url).startsWith("https://openrouter.ai/")
      ? Promise.resolve(new Response("{}", { status })) : realFetch(url, init);
    try { return await run(); } finally { globalThis.fetch = realFetch; }
  };
  const refused = await upstreamAnswers(401, () => staffRouteAs("admin-review-assist", staff.client, {
    body: { action: "check", orgId: mill.id }, env: { OPENROUTER_API_KEY: "smoke-not-a-key" },
  }));
  const broke = await upstreamAnswers(402, () => staffRouteAs("admin-review-assist", staff.client, {
    body: { action: "check", orgId: mill.id }, env: { OPENROUTER_API_KEY: "smoke-not-a-key" },
  }));
  refused.available === false && /refused this site's key/.test(refused.reason) && /out of credits/.test(broke.reason)
    ? ok("a refused key and an empty account are each said as what they are, not \"try again\"")
    : fail("the model failure reasons", { refused: refused.reason, broke: broke.reason });

  const gaps = [
    { label: "Business registration", result: "Missing", detail: "No business registration document has been uploaded." },
    { label: "Duplicate company signal", result: "Review", detail: `Shares a legal name or website domain with: Rival Mill ${stamp}.` },
  ];
  const noModelNote = await staffRouteAs("suggest-review-request", staff.client, { body: { orgId: mill.id, companyName: "Assist Mill", gaps } });
  const refusedNote = await upstreamAnswers(401, () => staffRouteAs("suggest-review-request", staff.client, {
    body: { orgId: mill.id, companyName: "Assist Mill", gaps }, env: { OPENROUTER_API_KEY: "smoke-not-a-key" },
  }));
  const unknownNote = await staffRouteAs("suggest-review-request", staff.client, {
    body: { orgId: "00000000-0000-4000-8000-000000000000", companyName: "Nobody", gaps },
  });
  const brandNote = await staffRouteAs("suggest-review-request", brand.client, { body: { orgId: mill.id, gaps } });
  unknownNote.status === 404 && !unknownNote.message && brandNote.status === 403
    ? ok("\"Suggest with AI\" refuses a company that does not exist, and anyone but staff")
    : fail("the request note for an unknown company", { unknownNote, brandNote: brandNote.status });
  noModelNote.message?.includes("No business registration document") && /not set up on this site/.test(noModelNote.notice)
    && /refused this site's key/.test(refusedNote.notice) && refusedNote.message
    && ![noModelNote.message, refusedNote.message].some((message) => message.includes(`Rival Mill ${stamp}`))
    ? ok("\"Suggest with AI\" without a model builds the note from the checks, says why, and names no other company")
    : fail("the request note without a model", { noModelNote, refusedNote });

  // Two leftovers made the way the smoke run makes companies: one two hours
  // old (test data), one just made (a run in progress: left alone).
  const { data: leftovers } = await admin.from("orgs").insert([
    { type: "factory", name: `Smoke Leftover ${stamp}`, slug: `smoke-leftover-${stamp}`, created_at: new Date(Date.now() - 2 * 3600e3).toISOString() },
    { type: "factory", name: `Smoke Fresh ${stamp}`, slug: `smoke-fresh-${stamp}`, created_at: new Date().toISOString() },
  ]).select("id, slug");
  const old = leftovers.find((row) => row.slug.startsWith("smoke-leftover-"));
  const fresh = leftovers.find((row) => row.slug.startsWith("smoke-fresh-"));

  const preview = await staffRouteAs("admin-test-data", staff.client, { method: "GET" });
  const listed = new Set((preview.companies ?? []).map((company) => company.id));
  preview.status === 200 && listed.has(old.id) && !listed.has(fresh.id) && !listed.has(org.id) && !listed.has(mill.id)
    && !(preview.companies ?? []).some((company) => company.name.startsWith("Demo "))
    ? ok("the test-data list has an old leftover, not a fresh one, a demo company or one without a run number")
    : fail("the test-data preview", { status: preview.status, count: preview.companies?.length });

  const brandPreview = await staffRouteAs("admin-test-data", brand.client, { method: "GET" });
  brandPreview.status === 403 ? ok("a company CANNOT list test data") : fail(`a brand got ${brandPreview.status} from the test-data list`);

  const production = await staffRouteAs("admin-test-data", staff.client, {
    method: "GET", env: { SUPABASE_URL: "https://wxzliajdtwekqdvwzqfb.supabase.co" },
  });
  production.status === 403 ? ok("clearing test data is refused on the production project") : fail(`the production project answered ${production.status}`);

  const purged = await staffRouteAs("admin-test-data", staff.client, { body: { orgIds: [old.id, fresh.id, org.id], userIds: [] } });
  const { data: still } = await admin.from("orgs").select("id").in("id", [old.id, fresh.id, org.id]);
  const left = new Set((still ?? []).map((row) => row.id));
  purged.status === 200 && purged.companies === 1 && purged.skipped === 2 && !left.has(old.id) && left.has(fresh.id) && left.has(org.id)
    ? ok("the cleanup deletes only what still matches the rule, whatever ids it is sent")
    : fail("the cleanup", purged);

  await admin.from("orgs").delete().in("id", [fresh.id, mill.id]);
}

console.log("\ncredits — granted on verification, invites, staff adjustments");
{
  const staff = await signedInUser(`credits-admin-${stamp}@example.com`);
  await admin.from("platform_admins").insert({ user_id: staff.id });
  const owner = await signedInUser(`credits-owner-${stamp}@smoke-mill-a.test`);
  const { data: mill } = await owner.client.rpc("create_org", { org_name: `Credits Mill ${stamp}`, org_kind: "factory" });
  await owner.client.from("factory_profiles").insert({ org_id: mill.id, intro: "Knitwear." });

  const { error: selfVerify } = await owner.client.from("factory_profiles")
    .update({ verification_status: "verified" }).eq("org_id", mill.id);
  selfVerify ? ok("a factory CANNOT verify itself") : fail("LEAK: a factory set its own profile to verified");

  const { error: decideError } = await staff.client.rpc("admin_review_decision", { target_org: mill.id, decision: "approved" });
  if (decideError) fail("staff approve the factory", decideError);
  const { data: lines } = await owner.client.from("credit_ledger").select("delta, reason").eq("org_id", mill.id);
  (lines ?? []).length === 1 && lines[0].delta === 500 && lines[0].reason === "onboarding_grant"
    ? ok("verification grants 500 credits, read by the factory itself")
    : fail("the verification grant", lines);
  const { data: bell } = await owner.client.from("notifications").select("kind, subject_type").eq("org_id", mill.id).eq("kind", "credits_granted");
  (bell ?? []).length === 1 && bell[0].subject_type === "credits"
    ? ok("and the factory is notified")
    : fail("the credits notification", bell);

  const invitee = `invited-${stamp}@smoke-mill-b.test`;
  const sent = await staffRouteAs("send-invite", owner.client, {
    body: { orgId: mill.id, email: invitee, message: "Join us on TSC" },
    env: { MAILPIT_URL: MAIL, RESEND_API_KEY: "" },
  });
  sent.status === 200 && sent.id && (sent.emailed || !MAIL)
    ? ok(`an invite is saved${sent.emailed ? " and emailed" : ""}`)
    : fail("send an invite", sent);
  if (MAIL && sent.emailed) {
    const found = await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:${invitee}`)}`).then((r) => r.json()).catch(() => null);
    (found?.messages ?? []).some((m) => m.Subject?.includes(`Credits Mill ${stamp} invited you`))
      ? ok("the invite email arrives, naming the inviting company")
      : fail("the invite email was not in Mailpit", found);
  }

  const ownDomain = await staffRouteAs("send-invite", owner.client, { body: { orgId: mill.id, email: `cousin-${stamp}@smoke-mill-a.test` } });
  ownDomain.status === 400 ? ok("an invite to the company's own email domain is refused") : fail("own-domain invite", ownDomain);
  const stranger = await staffRouteAs("send-invite", brand.client, { body: { orgId: mill.id, email: `x-${stamp}@smoke-mill-c.test` } });
  stranger.status === 403 ? ok("nobody sends invites for a company they are not in") : fail("a stranger's invite", stranger);

  // An address that has an account, on another domain: refused in words, and
  // the same words when asked again (the refusal is a row, so it counts).
  const taken = `taken-${stamp}@smoke-mill-d.test`;
  await signedInUser(taken);
  const hasAccount = await staffRouteAs("send-invite", owner.client, { body: { orgId: mill.id, email: taken } });
  const askedAgain = await staffRouteAs("send-invite", owner.client, { body: { orgId: mill.id, email: taken } });
  hasAccount.status === 400 && /already has a Sourcing Club account/.test(hasAccount.error)
    && askedAgain.status === 400 && /already has a Sourcing Club account/.test(askedAgain.error)
    ? ok("an invite to an address with an account is refused, the same way twice")
    : fail("the already-has-an-account refusal", { hasAccount, askedAgain });

  // Saved but not emailed: the screen is told why, as a code it words
  // (inviteNotice). Each case runs offline.
  const mailEnv = ["RESEND_API_KEY", "RESEND_FROM_EMAIL", "MAILPIT_URL"];
  const savedMailEnv = Object.fromEntries(mailEnv.map((key) => [key, process.env[key]]));
  const notEmailed = async (email, env) => (await staffRouteAs("send-invite", owner.client, {
    body: { orgId: mill.id, email }, env: { RESEND_API_KEY: "", RESEND_FROM_EMAIL: "", MAILPIT_URL: "", ...env },
  }));
  const noMail = await notEmailed(`plain-${stamp}@smoke-mill-e.test`, {});
  const reserved = await notEmailed(`reserved-${stamp}@example.com`, { RESEND_API_KEY: "re_smoke_not_a_key", RESEND_FROM_EMAIL: "smoke@sourcing-club.test" });
  const failed = await notEmailed(`failed-${stamp}@smoke-mill-f.test`, { MAILPIT_URL: "http://127.0.0.1:9" });
  for (const [key, value] of Object.entries(savedMailEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  noMail.status === 200 && noMail.emailed === false && noMail.reason === "email_not_set_up"
    ? ok("an invite on a server with no email is saved, and says so") : fail("no-email invite", noMail);
  reserved.status === 200 && reserved.emailed === false && reserved.reason === "reserved_address"
    ? ok("an invite to a reserved test address is saved, not emailed, and says why") : fail("reserved-address invite", reserved);
  failed.status === 200 && failed.emailed === false && failed.reason === "email_failed"
    ? ok("an invite the email service did not take is saved, and says so") : fail("failed-email invite", failed);

  const { error: relink } = await owner.client.from("referrals").update({ referred_org_id: org.id }).eq("referrer_org_id", mill.id);
  relink ? ok("a client CANNOT link an invite to a company") : fail("LEAK: a client re-linked its invite");

  const joined = await signedInUser(invitee);
  const { data: joinedOrg } = await joined.client.rpc("create_org", { org_name: `Invited Mill ${stamp}`, org_kind: "factory" });
  const { data: link } = await owner.client.from("referrals").select("referred_org_id, accepted_at").eq("email", invitee).single();
  link?.referred_org_id === joinedOrg?.id && link?.accepted_at
    ? ok("signing up with the invited address links the invite")
    : fail("the invite was not linked", link);

  await admin.from("factory_profiles").insert({ org_id: joinedOrg.id });
  await staff.client.rpc("admin_review_decision", { target_org: joinedOrg.id, decision: "approved" });
  const { data: earned } = await owner.client.from("credit_ledger").select("delta").eq("org_id", mill.id).eq("reason", "referral_grant");
  (earned ?? []).length === 1 && earned[0].delta === 500
    ? ok("the inviter earns 500 when the invited factory is verified")
    : fail("the referral grant", earned);

  const { error: selfAdjust } = await owner.client.rpc("admin_adjust_credits", { target_org: mill.id, amount: 100, reason: "More please" });
  selfAdjust ? ok("a factory CANNOT adjust its own credits") : fail("LEAK: a factory adjusted its credits");
  const { data: after, error: adjustError } = await staff.client.rpc("admin_adjust_credits", { target_org: mill.id, amount: -200, reason: "Smoke adjustment" });
  !adjustError && after === 800 ? ok("staff remove 200 credits with a reason (balance 800)") : fail("staff adjustment", adjustError ?? after);
}

console.log("\nemail and password sign-in");
{
  // The real signup path, once, end to end: an account, a profile name and an
  // organisation from one form, exactly as src/shared/AuthScreen.jsx collects
  // them. Everything else in this file uses the admin API to save time.
  const email = `signup-${stamp}@example.com`;
  const client = createClient(URL, ANON, { auth: { persistSession: false } });

  const { data: signedUp, error: signUpError } = await client.auth.signUp({
    email,
    password: TEST_PASSWORD,
    options: { data: { full_name: "Signup Probe", company_name: `Signup Co ${stamp}` } },
  });

  if (signUpError) fail("sign up with a password", signUpError);
  else ok(`signed up as ${email} — a password, not a code`);

  signedUp?.session
    ? ok("and is signed in immediately, with no confirmation step in the way")
    : fail("signUp returned no session — enable_confirmations must be off for this flow");

  // handle_new_user() copies the name out of the signup metadata.
  const { data: profile } = await admin
    .from("user_profiles").select("full_name").eq("email", email).maybeSingle();
  profile?.full_name === "Signup Probe"
    ? ok("the name typed on the signup form reached user_profiles")
    : fail(`user_profiles.full_name is ${JSON.stringify(profile?.full_name)}`);

  // The portal decides the org type; create_org makes the caller its owner.
  const { error: orgError } = await client.rpc("create_org", {
    org_name: `Signup Co ${stamp}`, org_kind: "brand",
  });
  orgError ? fail("signup creates the org from the company name", orgError)
           : ok("and the company name became an org, owned by the person who typed it");

  // The minimum the form promises has to be the minimum the server enforces.
  // A client-side minLength alone is a promise the product does not keep.
  const { error: weak } = await createClient(URL, ANON, { auth: { persistSession: false } })
    .auth.signUp({ email: `weak-${stamp}@example.com`, password: "abc123" });
  weak ? ok(`a password under 8 characters is refused by the server: ${weak.message}`)
       : fail("LEAK: the server accepted a password the signup form forbids");

  // Wrong password, right address.
  const { error: wrong } = await createClient(URL, ANON, { auth: { persistSession: false } })
    .auth.signInWithPassword({ email, password: "not the password" });
  wrong ? ok("a wrong password is rejected")
        : fail("LEAK: a wrong password signed in");

  const { error: right } = await createClient(URL, ANON, { auth: { persistSession: false } })
    .auth.signInWithPassword({ email, password: TEST_PASSWORD });
  right ? fail("sign in with the right password", right)
        : ok("and the right one is accepted");

  // "Forgot password" must not double as a way to ask who has an account.
  const stranger = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error: unknownReset } = await stranger.auth
    .resetPasswordForEmail(`nobody-${stamp}@example.com`);
  unknownReset
    ? fail(`reset for an unknown address reported an error: ${unknownReset.message}`)
    : ok("a reset for an address with no account reports success, like any other");
}

console.log("\ncredit purchases");
{
  // Its own factory, so no other section's balance is counted here.
  const buyer = await signedInUser(`credits-${stamp}@example.com`);
  const stranger = await signedInUser(`credits-stranger-${stamp}@example.com`);
  const { data: buyerOrg } = await buyer.client.rpc("create_org", {
    org_name: `Credits Factory ${stamp}`, org_kind: "factory",
  });

  const { data: packs, error: packsError } = await buyer.client.rpc("credit_packs");
  packsError ? fail("a factory reads the credit packs", packsError)
    : packs.map((pack) => `${pack.credits}:${pack.amount_cents}`).join(",") === "500:5000,1000:10000,2500:25000"
      ? ok("the packs are priced in the database: 500 for $50, 1,000 for $100, 2,500 for $250")
      : fail(`unexpected credit packs ${JSON.stringify(packs)}`);

  const { error: clientCreate } = await buyer.client.rpc("create_credit_purchase", {
    target_org: buyerOrg.id, pack_credits: 500, buyer: buyer.id,
  });
  clientCreate ? ok("a client cannot begin a purchase itself; only the server can")
               : fail("LEAK: create_credit_purchase ran from the browser");

  const { error: clientRecord } = await buyer.client.rpc("record_credit_purchase_succeeded", {
    target_purchase: buyerOrg.id, payment_intent: "pi_fake", received: 5000, method_label: null,
  });
  clientRecord ? ok("nor say it was paid")
               : fail("LEAK: record_credit_purchase_succeeded ran from the browser");

  const { error: clientInsert } = await buyer.client.from("credit_purchases").insert({
    org_id: buyerOrg.id, credits: 500, amount_cents: 5000,
  });
  clientInsert ? ok("credit_purchases rejects a client write")
               : fail("LEAK: credit_purchases accepted a client write");

  const { error: strangerCreate } = await admin.rpc("create_credit_purchase", {
    target_org: buyerOrg.id, pack_credits: 500, buyer: stranger.id,
  });
  strangerCreate?.code === "42501"
    ? ok("someone who does not own the factory cannot buy for it")
    : fail("LEAK: a stranger began a credit purchase", strangerCreate);

  const { error: madeUpPack } = await admin.rpc("create_credit_purchase", {
    target_org: buyerOrg.id, pack_credits: 7, buyer: buyer.id,
  });
  madeUpPack ? ok("a pack that is not on sale is refused")
             : fail("a made-up pack was accepted");

  const { data: purchase, error: createError } = await admin.rpc("create_credit_purchase", {
    target_org: buyerOrg.id, pack_credits: 1000, buyer: buyer.id,
  });
  if (createError) fail("the owner begins a purchase", createError);
  else {
    purchase.amount_cents === 10000
      ? ok("the owner begins a purchase, at the database's price")
      : fail(`expected 10000 cents, got ${purchase.amount_cents}`);

    const { error: shortError } = await admin.rpc("record_credit_purchase_succeeded", {
      target_purchase: purchase.id, payment_intent: `pi_smoke_${stamp}`, received: 100, method_label: null,
    });
    shortError ? ok("a payment for less than the pack grants nothing")
               : fail("credits were granted for less than the pack costs");

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await admin.rpc("record_credit_purchase_succeeded", {
        target_purchase: purchase.id, payment_intent: `pi_smoke_${stamp}`, received: 10000, method_label: "Visa ···4242",
      });
    }
    const { data: lines } = await admin.from("credit_ledger")
      .select("delta").eq("org_id", buyerOrg.id).eq("reason", "purchase");
    lines?.length === 1 && lines[0].delta === 1000
      ? ok("paid twice over (webhook and page), it is still one ledger line of 1,000")
      : fail(`expected one purchase line of 1000, got ${JSON.stringify(lines)}`);

    const { data: balance } = await buyer.client.rpc("credit_balance", { org: buyerOrg.id });
    balance === 1000 ? ok("and the factory sees the 1,000 credits it bought")
                     : fail(`expected a balance of 1000, got ${balance}`);

    // Refunded in Stripe: the refunded share comes back off the balance, and
    // the charge's running total means a repeat takes nothing more.
    for (const refunded of [5000, 5000, 10000]) {
      await admin.rpc("record_credit_purchase_refunded", {
        payment_intent: `pi_smoke_${stamp}`, refunded_cents: refunded,
      });
    }
    const { data: afterRefund } = await buyer.client.rpc("credit_balance", { org: buyerOrg.id });
    afterRefund === 0
      ? ok("a refund takes the credits back, half then the rest, never twice")
      : fail(`expected a balance of 0 after a full refund, got ${afterRefund}`);

    const { error: clientRefund } = await buyer.client.rpc("record_credit_purchase_refunded", {
      payment_intent: `pi_smoke_${stamp}`, refunded_cents: 0,
    });
    clientRefund ? ok("and only the server records a refund")
                 : fail("LEAK: record_credit_purchase_refunded ran from the browser");

    const { data: seen } = await stranger.client.from("credit_purchases").select("id").eq("id", purchase.id);
    seen?.length === 0 ? ok("another company cannot see the purchase")
                       : fail("LEAK: another company read a credit purchase");
  }
}

console.log("\npassword recovery email");
{
  let mailReachable = true;
  try {
    await fetch(`${MAIL}/api/v1/messages`);
  } catch {
    mailReachable = false;
  }

  if (!mailReachable) {
    console.log("  –  skipped (no local mail server at " + MAIL + ")");
  } else {
    // The one email the app still sends. Nothing signs in with a code any
    // more, but someone locked out has to be able to get back in.
    const email = `recover-${stamp}@example.com`;
    await admin.auth.admin.createUser({ email, password: TEST_PASSWORD, email_confirm: true });

    const client = createClient(URL, ANON, { auth: { persistSession: false } });
    const { error: sendError } = await client.auth.resetPasswordForEmail(email);
    sendError ? fail("request a password reset", sendError) : ok("reset requested");

    await new Promise((resolve) => setTimeout(resolve, 1500));

    const list = await (await fetch(`${MAIL}/api/v1/messages`)).json();
    const message = (list.messages ?? list.items ?? []).find((entry) =>
      (entry.To ?? entry.to ?? []).some((to) => (to.Address ?? to.address) === email),
    );

    if (!message) {
      fail("no recovery email was delivered");
    } else {
      const body = await (await fetch(`${MAIL}/api/v1/message/${message.ID ?? message.id}`)).json();
      const html = body.HTML ?? body.html ?? "";
      const token = (html.match(/>\s*(\d{6})\s*</) ?? [])[1];
      const hasLink = /token_hash|\/auth\/v1\/verify/.test(html);

      hasLink ? ok("the recovery email carries a link back into the app")
              : fail("the recovery email has no link — check magic_link.html");

      if (token) {
        const { data, error: verifyError } = await client.auth.verifyOtp({
          email, token, type: "recovery",
        });
        if (verifyError) fail("the recovery code opens a session to set a new password", verifyError);
        else ok(`recovery signed in ${data.user.email} for long enough to choose a password`);

        const { error: changeError } = await client.auth.updateUser({ password: "a new one 99" });
        changeError ? fail("set a new password on the recovery session", changeError)
                    : ok("and the new password is saved");

        const { error: oldStillWorks } = await createClient(URL, ANON, { auth: { persistSession: false } })
          .auth.signInWithPassword({ email, password: TEST_PASSWORD });
        oldStillWorks ? ok("the old password stops working, which is the point of a reset")
                      : fail("LEAK: the old password still signs in after a reset");

        const { error: newFails } = await createClient(URL, ANON, { auth: { persistSession: false } })
          .auth.signInWithPassword({ email, password: "a new one 99" });
        newFails ? fail("sign in with the new password", newFails)
                 : ok("and the new one does");
      } else {
        ok("no code in the recovery email — the link is the way back, and it is there");
      }
    }
  }
}

console.log(
  failures ? `\n${failures} check(s) failed\n` : "\nAll smoke checks passed\n",
);
process.exit(failures ? 1 : 0);
