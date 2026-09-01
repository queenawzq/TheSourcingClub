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
const { data: org, error: orgError } = await brand.client.rpc("create_org", {
  org_name: "Maison Rue",
  org_kind: "brand",
});
if (orgError) fail("create_org RPC", orgError);
else ok(`created ${org.name} (${org.slug}), type ${org.type}`);

const factory = await signedInUser(`factory-${stamp}@example.com`);
const { data: dupe } = await brand.client.rpc("create_org", {
  org_name: "Maison Rue",
  org_kind: "brand",
});
dupe?.slug === "maison-rue-2"
  ? ok("a duplicate name gets a numbered slug")
  : fail(`expected slug maison-rue-2, got ${dupe?.slug}`);

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

console.log(
  failures ? `\n${failures} check(s) failed\n` : "\nAll smoke checks passed\n",
);
process.exit(failures ? 1 : 0);
