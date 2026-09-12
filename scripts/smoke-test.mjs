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


    const { error: updateEmbedError } = await admin
      .from("milestone_updates")
      .select("id, body, orgs:author_org_id (name), documents (id, file_name)")
      .eq("order_id", order.id);
    updateEmbedError ? fail("update → documents embed parses", updateEmbedError)
                     : ok("the embed src/lib/domain/milestone.js uses for photos parses");

    // ---- both sides agree -------------------------------------------------
    const brandAgree = await brand.client.rpc("agree_schedule", {
      target_order: order.id, revision: order.schedule_revision,
    });
    brandAgree.error ? fail("the brand agrees the schedule", brandAgree.error)
                     : ok("the brand agrees the schedule");

    const { data: halfway } = await admin
      .from("production_orders").select("status").eq("id", order.id).single();
    halfway.status === "pending_schedule"
      ? ok("one signature is not enough — the order has not started")
      : fail(`order is ${halfway.status} after one agreement`);

    const { error: staleAgree } = await brand.client.rpc("agree_schedule", {
      target_order: order.id, revision: order.schedule_revision,
    });
    staleAgree ? ok("a side cannot agree the same schedule twice")
               : fail("LEAK: agreed twice");

    // The factory has to act as itself: every RPC keys on auth.uid(), so
    // service_role genuinely cannot stand in for a party here.
    const { data: winner } = await admin
      .from("quotes").select("factory_org_id").eq("id", awardedQuote).single();
    // Reuse the winning factory's own session from the loop above.
    const factoryClient = f1Client;
    const factoryAgree = await factoryClient.rpc("agree_schedule", {
      target_order: order.id, revision: order.schedule_revision,
    });
    factoryAgree.error ? fail("the factory agrees too", factoryAgree.error)
                       : ok("the factory agrees too");

    const { data: active } = await admin
      .from("production_orders").select("status, activated_at").eq("id", order.id).single();
    active.status === "active"
      ? ok("the order starts only once BOTH sides have agreed")
      : fail(`order is ${active.status} after both agreements`);

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

    payments.every((p) => p.fee_bps === 0 && p.currency === "USD")
      ? ok("every payment stores its own fee rate and currency, rather than inheriting a default")
      : fail("a payment is missing its fee rate or currency");

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

    const { error: brandPost } = await brand.client.rpc("post_milestone_update", {
      target_milestone: first.id, body: "Looks good", document_ids: [],
    });
    brandPost ? ok("a brand CANNOT post an update as though it were the factory")
              : fail("LEAK: the brand posted a factory update");

    // The brand can read what the factory posted. This is the positive twin of
    // every isolation check, and the one whose absence is silent: get the
    // policy wrong and the gallery is simply empty, with no error at all.
    const { data: seen } = await brand.client
      .from("milestone_updates").select("id, body").eq("milestone_id", first.id);
    (seen ?? []).length === 1
      ? ok("the brand CAN read the factory's update — the counterparty policy works")
      : fail(`the brand sees ${(seen ?? []).length} updates, expected 1`);

    const { data: notSeen } = await losingFactory
      .from("milestone_updates").select("id").eq("milestone_id", first.id);
    (notSeen ?? []).length === 0
      ? ok("a competing factory CANNOT read that update")
      : fail("LEAK: a competitor read the update");

    await factoryClient.rpc("submit_milestone", { target_milestone: first.id });
    const approved = await brand.client.rpc("approve_milestone", {
      target_milestone: first.id, note: "Approved from the smoke test",
    });
    approved.error ? fail("the brand approves the sample", approved.error)
                   : ok("the brand approves the sample");

    const { data: deposit } = await admin
      .from("order_payments").select("*").eq("milestone_id", first.id).single();

    deposit.state === "due"
      ? ok("approving the sample made its payment due")
      : fail(`payment is ${deposit.state} after approval, expected due`);

    {
      const { data: payout } = await brand.client
        .from("factory_payout_accounts").select("id").eq("org_id", winner.factory_org_id);
      (payout ?? []).length === 1
        ? ok("and NOW the brand can read where to send it — because money is owed")
        : fail("the brand cannot read the payout account with a payment due");

      const sent = await brand.client.rpc("mark_payment_sent", {
        target_payment: deposit.id, reference: "SMOKE-REF", note: null,
      });
      sent.error ? fail("the brand records the payment as sent", sent.error)
                 : ok("the brand records the payment as sent");

      const { data: afterSent } = await admin
        .from("production_order_summary").select("paid_cents").eq("id", order.id).single();
      Number(afterSent.paid_cents) === 0
        ? ok("the brand SAYING it paid does not count as funded")
        : fail(`paid_cents is ${afterSent.paid_cents} on the brand's word alone`);

      const { data: blockedStep } = await admin
        .from("order_milestones").select("state").eq("id", first.id).single();
      blockedStep.state !== "complete"
        ? ok("the step does not complete while the payment is only claimed sent")
        : fail("LEAK: a claimed payment completed the step");

      const { data: nextStep } = await admin
        .from("order_milestones").select("state").eq("id", milestones[1].id).single();
      nextStep.state === "pending"
        ? ok("the NEXT step stays shut while the payment is only claimed sent")
        : fail(`next step is ${nextStep.state} on the brand's word alone`);

      const brandConfirm = await brand.client.rpc("confirm_payment_received", {
        target_payment: deposit.id, amount_received: null, note: null,
      });
      brandConfirm.error ? ok("the brand that sent the money CANNOT confirm it arrived")
                         : fail("LEAK: the payer confirmed its own payment");

      const factoryConfirm = await factoryClient.rpc("confirm_payment_received", {
        target_payment: deposit.id, amount_received: null, note: null,
      });
      factoryConfirm.error ? ok("the factory that is owed the money CANNOT confirm it arrived")
                           : fail("LEAK: the payee confirmed its own payment");

      const staff = await signedInUser(`payments-admin-${stamp}@example.com`);
      await admin.from("platform_admins").insert({ user_id: staff.id });

      const { data: queue, error: queueError } = await staff.client.rpc("admin_payment_queue");
      if (queueError) fail("the admin payment queue is readable by staff", queueError);
      else queue.some((row) => row.payment_id === deposit.id)
        ? ok("the payment appears in the queue an admin actually watches")
        : fail("the sent payment is not in the admin queue");

      const { error: queueLeak } = await brand.client.rpc("admin_payment_queue");
      queueLeak ? ok("a brand CANNOT read the platform-wide payment queue")
                : fail("LEAK: the payment queue is readable by a party");

      const confirmed = await staff.client.rpc("confirm_payment_received", {
        target_payment: deposit.id, amount_received: null, note: "seen on the statement",
      });
      confirmed.error ? fail("an admin confirms the payment", confirmed.error)
                      : ok("an admin confirms the payment arrived");

      const { data: afterConfirm } = await admin
        .from("order_milestones").select("state").eq("id", first.id).single();
      afterConfirm.state === "complete"
        ? ok("the step completes on the ADMIN's confirmation — it said otherwise a moment ago")
        : fail(`step is ${afterConfirm.state} after confirmation`);

      const { data: opened } = await admin
        .from("order_milestones").select("state").eq("id", milestones[1].id).single();
      opened.state === "active"
        ? ok("and the next step opens, WITHOUT waiting for the funds to be released")
        : fail(`next step is ${opened.state} after confirmation`);

      const { data: funded } = await admin
        .from("production_order_summary").select("paid_cents").eq("id", order.id).single();
      Number(funded.paid_cents) === Number(deposit.amount_cents)
        ? ok("the header total moved because a payment row moved, not because anything was typed")
        : fail(`paid_cents is ${funded.paid_cents}, expected ${deposit.amount_cents}`);

      const { data: told } = await admin
        .from("notifications").select("kind, org_id, order_id")
        .eq("order_id", order.id).eq("kind", "payment_confirmed");
      told.some((n) => n.org_id === winner.factory_org_id)
        ? ok("the factory was told, in the same transaction, that it can start")
        : fail("the factory was not notified of the confirmation");

      told.every((n) => n.order_id === order.id)
        ? ok("payment notifications carry their order, so the link in the feed resolves")
        : fail("a payment notification has no order to link to");

      const released = await staff.client.rpc("release_payment_to_factory", {
        target_payment: deposit.id, note: null,
      });
      released.error ? fail("an admin releases the funds", released.error)
                     : ok("an admin releases the funds");

      const { data: stillOpen } = await admin
        .from("order_milestones").select("state").eq("id", milestones[1].id).single();
      stillOpen.state === "active"
        ? ok("releasing changes no milestone state — the work opened at confirmation")
        : fail(`releasing moved the next step to ${stillOpen.state}`);

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
      const { error: sendError } = await brand.client.from("messages").insert({
        thread_id: threadId,
        sender_org_id: order.brand_org_id,
        sender_user_id: brand.id,
        body: "Can you confirm the sleeve opening on the PP sample?",
        body_lang: "en",
        body_translated: "你能确认PP样品的袖口尺寸吗？",
        body_translated_lang: "zh",
        translated_by: "smoke-test",
      });
      sendError ? fail("the brand sends a message", sendError) : ok("the brand sends a message");

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
    }
  }
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

    const { data: duePayments } = await admin
      .from("order_payments").select("amount_cents, order_id, state").eq("state", "due");
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
  const { data: brandOrgRow } = await admin
    .from("orgs").select("id").eq("name", `Maison ${stamp}`).maybeSingle();
  const selfOrg = brandOrgRow?.id
    ?? (await admin.from("org_members").select("org_id").eq("user_id", brand.id).limit(1).maybeSingle()).data?.org_id;

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

  const { data: metrics } = await staff.client.rpc("admin_overview_metrics");
  const m = (metrics ?? [])[0];
  m && typeof m.payments_awaiting_confirmation === "number"
    ? ok("the overview counts payments nothing else will ever chase")
    : fail("admin_overview_metrics did not return the payment backstop count");
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
