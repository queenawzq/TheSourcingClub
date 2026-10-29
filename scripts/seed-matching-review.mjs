/**
 * Matching fixtures: a brand, three factories (qualified, provisional,
 * excluded), staff and a draft request. Turns matching v2 on for that
 * database. Prints the two env lines a dev server needs rather than writing
 * .env.local, which holds other keys.
 *
 *   MATCHING_SUPABASE_WORKDIR=$PWD node scripts/seed-matching-review.mjs
 *   SUPABASE_URL=… SUPABASE_SERVICE_KEY=… node scripts/seed-matching-review.mjs --remote
 *
 * --remote is for a test database (the qa branch the PR previews use) and
 * refuses the production project outright, as seed-demo.mjs does.
 */
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { DEMO_PASSWORD } from "../src/shared/demo-logins.mjs";
const PRODUCTION_REF = "wxzliajdtwekqdvwzqfb";
const remote = process.argv.includes("--remote");
let stack;
if (remote) {
  stack = {
    API_URL: process.env.SUPABASE_URL,
    SECRET_KEY: process.env.SUPABASE_SERVICE_KEY,
    PUBLISHABLE_KEY: process.env.SUPABASE_ANON_KEY,
  };
  if (!stack.API_URL || !stack.SECRET_KEY)
    throw new Error("--remote needs SUPABASE_URL and SUPABASE_SERVICE_KEY for a test database.");
  // A JWT-style key names its project; sb_secret_ keys don't, so the URL check always applies.
  let keyRef = null;
  try {
    keyRef = JSON.parse(Buffer.from(stack.SECRET_KEY.split(".")[1], "base64url").toString()).ref ?? null;
  } catch {}
  if (stack.API_URL.includes(PRODUCTION_REF) || keyRef === PRODUCTION_REF)
    throw new Error("Refusing to seed: that is the production database.");
} else {
  const workdir = process.env.MATCHING_SUPABASE_WORKDIR;
  if (!workdir)
    throw new Error(
      "Set MATCHING_SUPABASE_WORKDIR to an isolated local Supabase project, or pass --remote for a test database.",
    );
  stack = JSON.parse(
    execFileSync(
      "./node_modules/.bin/supabase",
      ["status", "--workdir", workdir, "-o", "json"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ),
  );
  if (!["127.0.0.1", "localhost"].includes(new URL(stack.API_URL).hostname))
    throw new Error("Without --remote this only seeds a local stack.");
}
const key = stack.PUBLISHABLE_KEY ?? stack.ANON_KEY;
const service = createClient(
  stack.API_URL,
  stack.SECRET_KEY ?? stack.SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const check = ({ data, error }) => {
  if (error) throw error;
  return data;
};
const ids = {
  brand: "e9800000-0000-0000-0000-000000000001",
  qualified: "e9800000-0000-0000-0000-000000000002",
  provisional: "e9800000-0000-0000-0000-000000000003",
  excluded: "e9800000-0000-0000-0000-000000000004",
  rfq: "e9800000-0000-0000-0000-000000000005",
};
const users = {};
const existing = check(
  await service.auth.admin.listUsers({ perPage: 1000 }),
).users;
for (const role of ["brand", "qualified", "staff"]) {
  const email = `matching-review-${role}@example.com`;
  // The demo seed's password, so each login signs in on the ordinary form.
  const found = existing.find((x) => x.email === email);
  users[role] = found
    ? check(
        await service.auth.admin.updateUserById(found.id, {
          password: DEMO_PASSWORD,
        }),
      ).user
    : check(
        await service.auth.admin.createUser({
          email,
          password: DEMO_PASSWORD,
          email_confirm: true,
          user_metadata: { name: `Matching review ${role}` },
        }),
      ).user;
}
check(
  await service.from("platform_admins").upsert({
    user_id: users.staff.id,
    note: "Isolated local matching test reviewer",
  }),
);
for (const [role, name] of [
  ["brand", "Matching Review Brand"],
  ["qualified", "Lusitania Shirts"],
  ["provisional", "Porto Development Studio"],
  ["excluded", "High Volume Garments"],
]) {
  check(
    await service.from("orgs").upsert({
      id: ids[role],
      type: role === "brand" ? "brand" : "factory",
      name,
      slug: `matching-review-${role}`,
    }),
  );
  if (users[role])
    check(
      await service
        .from("org_members")
        .upsert({ org_id: ids[role], user_id: users[role].id, role: "owner" }),
    );
  if (role === "brand")
    check(
      await service.from("brand_profiles").upsert({
        org_id: ids[role],
        legal_name: name,
        onboarding_completed_at: new Date().toISOString(),
        verification_status: "verified",
      }),
    );
  else {
    check(
      await service.from("factory_profiles").upsert({
        org_id: ids[role],
        legal_name: name,
        location: "Porto, Portugal",
        country_code: "PT",
        moq: role === "excluded" ? 500 : 100,
        typical_lead_days: 20,
        sample_lead_days: 7,
        intro:
          "Woven shirt production with embroidery, patternmaking and sampling support.",
        published_at: new Date().toISOString(),
        onboarding_completed_at: new Date().toISOString(),
        verification_status: "verified",
      }),
    );
    check(
      await service.from("factory_matching_facts").upsert({
        org_id: ids[role],
        moq_per_colour: role === "provisional" ? null : 50,
        usual_order_min: role === "provisional" ? null : 200,
        usual_order_max: role === "provisional" ? null : 500,
      }),
    );
    check(
      await service.from("factory_capacity").upsert({
        org_id: ids[role],
        input_mode: "units",
        monthly_units: 3000,
      }),
    );
    for (let n = 0; n < 6; n++) {
      const now = new Date();
      const month = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + n, 1),
      )
        .toISOString()
        .slice(0, 10);
      check(
        await service
          .from("factory_capacity_months")
          .upsert({ org_id: ids[role], month, level: "open" }),
      );
    }
  }
}
const terms = check(
  await service
    .from("taxonomy_terms")
    .select("id,kind,slug,label_en,org_id")
    .is("org_id", null),
);
const shirt = terms.find(
  (t) => t.kind === "product_category" && t.slug === "tops",
);
if (!shirt) throw new Error("The local taxonomy has no tops category.");
const selected = [
  shirt,
  ...[
    ["fabric", "woven"],
    ["technique", "embroidery"],
    ["development_service", "sampling"],
    ["development_service", "patternmaking"],
  ].map(([kind, slug]) =>
    terms.find((t) => t.kind === kind && t.slug === slug),
  ),
];
if (selected.some((t) => !t))
  throw new Error("Run the matching migration before seeding fixtures.");
for (const role of ["brand", "qualified", "provisional", "excluded"])
  check(
    await service.from("taxonomy_links").upsert(
      selected.map((t) => ({
        subject_type: role === "brand" ? "brand_profile" : "factory_profile",
        subject_id: ids[role],
        org_id: ids[role],
        term_id: t.id,
      })),
      { onConflict: "subject_type,subject_id,term_id" },
    ),
  );
check(
  await service.from("matching_requirements").upsert(
    {
      subject_type: "brand_profile",
      subject_id: ids.brand,
      org_id: ids.brand,
      quantity: 300,
      colour_quantities: [150, 150],
      preferred_countries: ["PT"],
      required_term_ids: selected
        .filter((t) => t.kind === "technique")
        .map((t) => t.id),
    },
    { onConflict: "subject_type,subject_id" },
  ),
);
check(
  await service.from("rfqs").upsert({
    id: ids.rfq,
    brand_org_id: ids.brand,
    title: "Embroidered woven shirts",
    brief:
      "300 woven shirts, 150 navy and 150 white, with embroidery. Patternmaking and sampling support needed.",
    quantity_total: 300,
    status: "draft",
    visibility: "invited_only",
    requires_sample: true,
  }),
);
check(await service.from("rfq_colour_splits").delete().eq("rfq_id", ids.rfq));
check(
  await service.from("rfq_colour_splits").insert([
    { rfq_id: ids.rfq, colour: "Navy", quantity: 150, sort: 0 },
    { rfq_id: ids.rfq, colour: "White", quantity: 150, sort: 1 },
  ]),
);
check(
  await service.from("taxonomy_links").upsert(
    selected.map((t) => ({
      subject_type: "rfq",
      subject_id: ids.rfq,
      org_id: ids.brand,
      term_id: t.id,
    })),
    { onConflict: "subject_type,subject_id,term_id" },
  ),
);
check(
  await service.from("matching_requirements").upsert(
    {
      subject_type: "rfq",
      subject_id: ids.rfq,
      org_id: ids.brand,
      quantity: 300,
      colour_quantities: [150, 150],
      preferred_countries: ["PT"],
      required_term_ids: selected
        .filter((t) => t.kind === "technique")
        .map((t) => t.id),
    },
    { onConflict: "subject_type,subject_id" },
  ),
);
check(
  await service
    .from("matching_settings")
    .update({ enabled: true })
    .eq("id", true),
);
console.log(
  JSON.stringify(
    {
      url: stack.API_URL,
      env: `VITE_SUPABASE_URL=${stack.API_URL}\nVITE_SUPABASE_ANON_KEY=${key}`,
      logins: Object.values(users).map((u) => u.email),
      ids,
    },
    null,
    2,
  ),
);
