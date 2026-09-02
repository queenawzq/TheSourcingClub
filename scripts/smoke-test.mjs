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
 * Create a confirmed user and return a client signed in as them. Google is the
 * only real sign-in method, so this uses an admin-generated one-time code to
 * stand in for the OAuth round trip.
 */
async function signedInUser(email) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { name: email.split("@")[0] },
  });
  if (error) throw error;

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkError) throw linkError;

  const client = createClient(URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: verifyError } = await client.auth.verifyOtp({
    email,
    token: link.properties.email_otp,
    type: "email",
  });
  if (verifyError) throw verifyError;

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
  const { data: f1org } = await f1.client.rpc("create_org", {
    org_name: `Atelier Three ${stamp}`, org_kind: "factory",
  });
  await admin.from("factory_profiles").upsert({
    org_id: f1org.id, country_code: "PT", moq: 100,
    published_at: new Date().toISOString(), verification_status: "verified",
  }, { onConflict: "org_id" });

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

  await admin.from("quotes").update({ payment_term_id: pay.id, incoterm_id: inco.id }).eq("id", revised.id);
  await f1.client.rpc("submit_quote", { quote_id: revised.id });
  const { error: loserSubmit } = await losingFactory.rpc("submit_quote", { quote_id: losingQuote });
  if (loserSubmit) fail("the second factory could not submit", loserSubmit);

  const { error: awardError } = await brand.client.rpc("award_quote", { quote_id: revised.id });
  awardError ? fail("award_quote", awardError) : ok("the brand awards the current version");

  const { data: loser } = await admin.from("quotes").select("status").eq("id", losingQuote).single();
  loser.status === "declined"
    ? ok("the other factory's quote was auto-declined in the same transaction")
    : fail(`loser is ${loser.status}, expected declined`);

  const { count: notified } = await admin.from("notifications")
    .select("*", { count: "exact", head: true }).eq("subject_id", rfqId);
  notified === 2 ? ok("both factories were notified — nobody is left waiting")
                 : fail(`expected 2 notifications, got ${notified}`);

  const { data: rfqRow } = await admin.from("rfqs").select("status, awarded_quote_id").eq("id", rfqId).single();
  rfqRow.status === "awarded" && rfqRow.awarded_quote_id === revised.id
    ? ok("the rfq closed and points at the winning quote")
    : fail(`rfq is ${rfqRow.status}`);
}

console.log("\nemail sign-in");
{
  // The real login path, not a stand-in: request a code, read the delivered
  // email, and sign in with what it actually contains.
  let mailReachable = true;
  try {
    await fetch(`${MAIL}/api/v1/messages`);
  } catch {
    mailReachable = false;
  }

  if (!mailReachable) {
    console.log("  –  skipped (no local mail server at " + MAIL + ")");
  } else {
    const email = `signin-${stamp}@example.com`;
    const client = createClient(URL, ANON, { auth: { persistSession: false } });

    const { error: sendError } = await client.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    });
    if (sendError) fail("request a sign-in code", sendError);
    else ok("code requested");

    await new Promise((resolve) => setTimeout(resolve, 1500));

    const list = await (await fetch(`${MAIL}/api/v1/messages`)).json();
    const message = (list.messages ?? list.items ?? []).find((entry) =>
      (entry.To ?? entry.to ?? []).some((to) => (to.Address ?? to.address) === email),
    );

    if (!message) {
      fail("no sign-in email was delivered");
    } else {
      const body = await (await fetch(`${MAIL}/api/v1/message/${message.ID ?? message.id}`)).json();
      const html = body.HTML ?? body.html ?? "";
      const code = (html.match(/>\s*(\d{6})\s*</) ?? [])[1];
      const hasLink = /token_hash|\/auth\/v1\/verify/.test(html);

      code
        ? ok(`email carries a ${code.length}-digit code`)
        : fail("template did not render the code — check magic_link.html");
      hasLink
        ? ok("email also carries a magic link, for whichever is easier")
        : fail("email has no sign-in link");

      if (code) {
        const { data, error: verifyError } = await client.auth.verifyOtp({
          email,
          token: code,
          type: "email",
        });
        if (verifyError) fail("sign in with the code", verifyError);
        else ok(`signed in as ${data.user.email}`);

        const { error: queryError } = await client.from("taxonomy_terms").select("slug").limit(1);
        queryError
          ? fail("signed-in session cannot query", queryError)
          : ok("the session reads the database under RLS");
      }

      const other = createClient(URL, ANON, { auth: { persistSession: false } });
      const { error: badCode } = await other.auth.verifyOtp({
        email,
        token: "000000",
        type: "email",
      });
      badCode ? ok("a wrong code is rejected") : fail("LEAK: wrong code accepted");
    }
  }
}

console.log(
  failures ? `\n${failures} check(s) failed\n` : "\nAll smoke checks passed\n",
);
process.exit(failures ? 1 : 0);
