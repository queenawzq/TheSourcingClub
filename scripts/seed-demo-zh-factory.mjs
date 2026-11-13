/**
 * Adds ONLY the demo factory whose profile is in Chinese (zhFactory in
 * src/shared/demo-logins.mjs) to a database already seeded with the demo
 * companies, without reseeding or touching any other company. For a shared
 * test database people may be signed in to, where `seed:demo` would delete
 * the demo companies under them.
 *
 *   npm run seed:demo:zh-factory                      (local stack)
 *   SUPABASE_URL=… SUPABASE_ANON_KEY=… SUPABASE_SERVICE_KEY=… npm run seed:demo:zh-factory -- --remote
 *
 * Refuses production, as seed:demo does. Does nothing if the login already
 * belongs to a company. Needs Brand two and its "Organic baby rompers"
 * request to exist (seed:demo makes them). The next full `seed:demo` deletes
 * and rebuilds this company with the others.
 */
import { createClient } from "@supabase/supabase-js";
import { DEMO_LOGINS as LOGINS, DEMO_PASSWORD as PASSWORD } from "../src/shared/demo-logins.mjs";
import { demoTarget } from "./demo-target.mjs";
import { seedZhFactory, ZH_FACTORY_REQUEST } from "./demo-zh-factory.mjs";

const { URL, ANON, SERVICE } = demoTarget("add the factory to");
const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });
const must = ({ data, error }, what) => {
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
};
const signIn = async (email) => {
  const client = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  return error ? null : { client, id: data.user.id };
};
const companiesOf = async (userId) => must(await admin.from("org_members")
  .select("org_id, role, orgs!inner(id, name, type)").eq("user_id", userId), "memberships");

const login = LOGINS.zhFactory;
const started = new Date().toISOString();

// Already there: nothing to do.
const existing = must(await admin.from("user_profiles").select("id").eq("email", login.email).maybeSingle(), `look up ${login.email}`);
if (existing && (await companiesOf(existing.id)).length) {
  console.log(`${login.email} already has a company; nothing changed.`);
  process.exit(0);
}

// Brand two and its request must already be there; this adds nothing to them
// but the invitation, the quote, the saved vendor and the conversation.
const brandProfile = must(await admin.from("user_profiles").select("id").eq("email", LOGINS.secondBrand.email).maybeSingle(), "Brand two's login");
const brandOrg = brandProfile && (await companiesOf(brandProfile.id))
  .find((m) => m.role === "owner" && m.orgs.type === "brand" && m.orgs.name === LOGINS.secondBrand.name)?.orgs;
if (!brandOrg) {
  console.error(`No "${LOGINS.secondBrand.name}" here: run seed:demo first (never on a database people are using).`);
  process.exit(1);
}
const rfq = must(await admin.from("rfqs").select("id").eq("brand_org_id", brandOrg.id)
  .eq("title", ZH_FACTORY_REQUEST).eq("status", "open").limit(1), "the request");
if (!rfq.length) {
  console.error(`${LOGINS.secondBrand.name} has no open "${ZH_FACTORY_REQUEST}" request: nothing added.`);
  process.exit(1);
}
const brand = await signIn(LOGINS.secondBrand.email);
if (!brand) {
  console.error(`Could not sign in as ${LOGINS.secondBrand.email} with the demo password: nothing added.`);
  process.exit(1);
}

const countCompanies = async () => {
  const { count, error } = await admin.from("orgs").select("id", { count: "exact", head: true });
  if (error) throw new Error(`count companies: ${error.message}`);
  return count;
};
const before = await countCompanies();

// The factory's login: made, or (made earlier but with no company) its
// password set back to the demo one.
if (existing) {
  must(await admin.auth.admin.updateUserById(existing.id, { password: PASSWORD, email_confirm: true, ban_duration: "none" }), `reset ${login.email}`);
} else {
  must(await admin.auth.admin.createUser({ email: login.email, password: PASSWORD, email_confirm: true, user_metadata: { name: login.name } }), `create ${login.email}`);
}
const factory = await signIn(login.email);
if (!factory) throw new Error(`sign in as ${login.email}`);
// Staff's registry check, if the demo admin signs in as it is; never reset here.
const staff = (await signIn(LOGINS.admin.email))?.client ?? null;

let made;
try {
  made = await seedZhFactory({
    admin, factory, name: login.name, brand: { ...brand, org: brandOrg }, staff,
  });
} catch (error) {
  // A step failed part way: take back the company this run started (only
  // that one: this login had none before), its files with it, so running
  // again starts clean rather than finding a half-built company.
  const mine = (await companiesOf(factory.id)).map((m) => m.org_id);
  if (mine.length) {
    const files = must(await admin.from("documents").select("bucket, storage_path").in("org_id", mine), "its files");
    for (const bucket of new Set(files.map((file) => file.bucket))) {
      await admin.storage.from(bucket).remove(files.filter((file) => file.bucket === bucket).map((file) => file.storage_path));
    }
    must(await admin.from("orgs").delete().in("id", mine), "take back the half-built company");
  }
  console.error(`Nothing added: ${error.message}`);
  process.exit(1);
}

// The demo's own notifications are not news to anyone: their emails stay unsent,
// for the two companies this touched, and only those queued by this run.
must(await admin.from("notification_email_outbox")
  .update({ status: "skipped", last_error: "demo seed" })
  .in("recipient_user_id", [factory.id, brand.id])
  .eq("status", "pending")
  .gte("created_at", started), "skip this run's emails");

const after = await countCompanies();
console.log(`
added ${login.name} (${made.org.id}), login ${login.email}
  request  ${ZH_FACTORY_REQUEST} ${made.rfq.id}
  quote    ${made.quote.id}
  thread   ${made.threadId}
  registry check: ${staff ? "recorded" : "skipped (demo admin did not sign in)"}
  companies before ${before}, after ${after}
`);
