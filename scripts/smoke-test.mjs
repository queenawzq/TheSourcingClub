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
 * Keys default to the well-known local development values, which are identical
 * on every machine and are not secrets.
 */
import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON =
  process.env.SUPABASE_ANON_KEY ?? "";
const SERVICE = process.env.SUPABASE_SERVICE_KEY ?? "";

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

console.log(
  failures ? `\n${failures} check(s) failed\n` : "\nAll smoke checks passed\n",
);
process.exit(failures ? 1 : 0);
