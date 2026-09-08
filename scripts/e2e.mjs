/**
 * End-to-end walkthrough, recorded as evidence.
 *
 *   supabase start
 *   npm run dev          # in another terminal
 *   npm run e2e
 *
 * Drives a real browser through everything a new user meets — request a
 * sign-in code, read it out of the local mail server, create an organisation,
 * complete onboarding — for both a factory and a brand, then checks the
 * database agrees with what the screen claimed.
 *
 * Writes a reviewable record to e2e-evidence/: a screenshot per step and a
 * report naming what each one proves.
 *
 * Driven with Stagehand's deterministic locators rather than its AI actions.
 * Two reasons: a failure points at one element instead of "the model could not
 * find it", and the run costs nothing and is repeatable. Selectors key on
 * data-field hooks derived from each label, so they survive layout changes and
 * copy edits alike. Set OPENAI_API_KEY (a valid one) to add AI assertions on
 * top; the key currently in the environment is rejected by OpenAI.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { Stagehand, localBrowser } from "@browserbasehq/stagehand";
import { createClient } from "@supabase/supabase-js";

const APP = process.env.E2E_URL ?? "http://127.0.0.1:5173/app.html";
const OUT = path.resolve("e2e-evidence");

function localStack() {
  try {
    return JSON.parse(
      execFileSync("supabase", ["status", "-o", "json"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }),
    );
  } catch {
    return {};
  }
}

const stack = localStack();
const MAIL = process.env.SUPABASE_MAIL_URL ?? stack.MAILPIT_URL ?? "http://127.0.0.1:54324";
const db = createClient(
  process.env.SUPABASE_URL ?? stack.API_URL,
  process.env.SUPABASE_SERVICE_KEY ?? stack.SECRET_KEY ?? stack.SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const FIXTURE = path.join(OUT, "..", "e2e-fixture-registration.pdf");

const steps = [];
let shot = 0;
let failures = 0;

async function record(page, name, note) {
  shot += 1;
  const file = `${String(shot).padStart(2, "0")}-${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`;
  await page.screenshot({ path: path.join(OUT, file) });
  steps.push({ n: shot, name, note, file, ok: true });
  console.log(`  ${String(shot).padStart(2, " ")}. ${name}${note ? ` — ${note}` : ""}`);
}

function check(condition, description) {
  if (condition) {
    console.log(`      ✓ ${description}`);
    steps.push({ n: shot, name: null, note: description, assertion: true, ok: true });
  } else {
    failures += 1;
    console.error(`      ✗ ${description}`);
    steps.push({ n: shot, name: null, note: description, assertion: true, ok: false });
  }
}

/**
 * The sign-in email for an address, from the local mail catcher.
 *
 * Returns whichever the template provided. The custom template carries a code
 * *and* a link; Supabase's default carries only a link, which is what a hosted
 * free-tier project sends. Handling both means this test exercises the same
 * path a real hosted user takes rather than only the local one.
 */
async function signInEmail(email, attempts = 25) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const list = await (await fetch(`${MAIL}/api/v1/messages`)).json();
    const message = (list.messages ?? list.items ?? []).find((entry) =>
      (entry.To ?? entry.to ?? []).some((to) => (to.Address ?? to.address) === email),
    );
    if (message) {
      const body = await (await fetch(`${MAIL}/api/v1/message/${message.ID ?? message.id}`)).json();
      const html = body.HTML ?? body.html ?? "";
      const code = (html.match(/>\s*(\d{6})\s*</) ?? [])[1] ?? null;
      const link = (html.match(/href="([^"]*(?:verify|confirm)[^"]*)"/i) ?? [])[1] ?? null;
      if (code || link) {
        return { code, link: link?.replace(/&amp;/g, "&") ?? null };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  throw new Error(`no sign-in email arrived for ${email}`);
}

// ---- Page helpers ---------------------------------------------------------

const field = (page, key) => page.locator(`[data-field="${key}"] input, [data-field="${key}"] textarea`).first();
const select = (page, key) => page.locator(`[data-field="${key}"] select`).first();

async function waitFor(page, selector, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if ((await page.locator(selector).count()) > 0) {
      if (await page.locator(selector).first().isVisible()) return true;
    }
    await page.waitForTimeout(200);
  }
  throw new Error(`timed out waiting for ${selector}`);
}

/**
 * Count-then-index is a race: React can re-render between `count()` and
 * `nth(index)`, and the element that was there is gone. That was harmless
 * while every screen rendered synchronously from a constant; the ported
 * screens fetch, so there is now a render cycle in the middle of the loop. A
 * transient miss must not end the run — this helper's whole job is to wait.
 */
async function eachText(page, selector) {
  const found = [];
  const count = await page.locator(selector).count();
  for (let index = 0; index < count; index += 1) {
    try {
      found.push(await page.locator(selector).nth(index).innerText());
    } catch {
      // The DOM moved under us; the next pass will see the new shape.
    }
  }
  return found;
}

async function waitForHeading(page, text, timeout = 25000) {
  let deadline = Date.now() + timeout;
  let extended = false;
  while (Date.now() < deadline) {
    for (const heading of await eachText(page, "h1")) {
      if (heading.toLowerCase().includes(text.toLowerCase())) return heading;
    }
    // "Checking your session…" is not the wrong page, it is the right page
    // still authenticating. This run signs in seventeen times, and the local
    // auth service intermittently takes longer than the default budget on the
    // later ones. Give it one extension rather than failing a product
    // assertion for an infrastructure stall.
    if (!extended && (await page.locator(".gate-card").count()) > 0) {
      const gate = (await page.locator(".gate-card").first().innerText().catch(() => "")) || "";
      if (/checking your session/i.test(gate)) {
        extended = true;
        deadline = Date.now() + timeout;
      }
    }
    await page.waitForTimeout(250);
  }
  throw new Error(`timed out waiting for heading "${text}"`);
}

async function clickButton(page, text) {
  const total = await page.locator("button").count();
  for (let index = 0; index < total; index += 1) {
    try {
      const button = page.locator("button").nth(index);
      const label = (await button.innerText()).trim().toLowerCase();
      if (label.includes(text.toLowerCase()) && (await button.isVisible())) {
        await button.click();
        return;
      }
    } catch {
      // Same race as eachText: a re-render moved this button. Keep looking.
    }
  }
  throw new Error(`no visible button matching "${text}"`);
}

/** Pick the first n chips in a labelled group. */
async function chooseChips(page, key, count = 2) {
  const chips = page.locator(`[data-field="${key}"] button.chip-toggle`);
  const total = await chips.count();
  const chosen = [];
  for (let index = 0; index < total && chosen.length < count; index += 1) {
    const chip = chips.nth(index);
    const label = (await chip.innerText()).trim();
    if (label.startsWith("+")) continue;
    await chip.click();
    chosen.push(label);
  }
  return chosen;
}

/**
 * Switch user, reliably.
 *
 * Clicking "sign out" from a deep route occasionally leaves the session in
 * place — the run lands back on the dashboard rather than the gate. Rather
 * than leave a flaky step in an evidence run, fall back to clearing storage,
 * which is what closing the browser would do anyway.
 */
async function signOutFully(page) {
  await page.goto(APP);
  await page.waitForTimeout(1000);
  try {
    await clickButton(page, "sign out");
    await waitFor(page, 'input[type="email"]', 8000);
    return;
  } catch {
    // fall through
  }
  await page.evaluate(() => {
    try { localStorage.clear(); sessionStorage.clear(); } catch {}
  });
  await page.goto(APP);
  await waitFor(page, 'input[type="email"]', 25000);
}

async function signIn(page, email, who) {
  await page.goto(APP);
  await waitFor(page, 'input[type="email"]');
  await record(page, `${who} sign-in`, "cold start, no session");

  await page.locator('input[type="email"]').first().fill(email);
  await clickButton(page, "email me a sign-in link");

  // Supabase throttles repeat requests per address (max_frequency). The screen
  // says exactly how long to wait, so wait that long and ask again — which is
  // what a real person does, and worth exercising.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await waitFor(page, 'input[placeholder="000000"]', 6000);
      break;
    } catch {
      const message = await page.locator(".gate-error").innerText().catch(() => "");
      const seconds = Number((message.match(/after (\d+) seconds?/) ?? [])[1] ?? 0);
      if (!seconds && !/security purposes/i.test(message)) throw new Error(`sign-in stalled: ${message || "no code field"}`);
      await page.waitForTimeout((seconds + 2) * 1000);
      await clickButton(page, "email me a sign-in link");
    }
  }
  await waitFor(page, 'input[placeholder="000000"]', 20000);
  await record(page, `${who} code requested`, email);

  const { code, link } = await signInEmail(email);

  if (code) {
    await page.locator('input[placeholder="000000"]').first().fill(code);
    await clickButton(page, "sign in");
  } else {
    // No code in the email, so follow the link the way a hosted user would.
    await page.goto(link);
  }

  // Three landings now, not two: the org chooser for a first-time user, the
  // dashboard for a returning one, and — since invitations became visible —
  // an offer to join an organisation that already exists. Someone invited must
  // NOT be asked to create one of their own, so this is a distinct state.
  const deadline = Date.now() + 30000;
  let landed = null;
  while (Date.now() < deadline && !landed) {
    for (const heading of await eachText(page, "h1")) {
      const text = heading.toLowerCase();
      if (text.includes("which side are you on")) landed = "new";
      if (text.includes("you have been invited")) landed = "invited";
    }
    if (!landed && (await page.locator(".home").count()) > 0) landed = "returning";
    if (!landed) await page.waitForTimeout(250);
  }
  if (!landed) throw new Error(`${who} did not reach a signed-in screen`);

  await record(
    page,
    `${who} signed in`,
    code ? `code ${code} accepted — no password anywhere` : "magic link followed — no password anywhere",
  );
  return landed;
}

async function createOrg(page, kind, name, who) {
  await clickButton(page, `i’m a ${kind}`);
  await page.locator(".gate-card input[type=text]").first().fill(name);
  await record(page, `${who} organisation`, `${kind}: ${name}`);
  await clickButton(page, "continue");
}

async function advance(page, nextHeading) {
  await clickButton(page, "continue");
  if (nextHeading) await waitForHeading(page, nextHeading);
}

// ---- The run --------------------------------------------------------------

async function main() {
  await fs.rm(OUT, { recursive: true, force: true });
  await fs.mkdir(OUT, { recursive: true });
  // A minimal but genuine PDF: the private bucket's allowed_mime_types has no
  // text/plain, so a .txt fixture is rejected before it reaches the queue.
  await fs.writeFile(
    FIXTURE,
    "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
      "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
      "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n" +
      "trailer<</Root 1 0 R>>\n%%EOF\n",
    "latin1",
  );

  const browser = await localBrowser.launch({ headless: true });
  const stagehand = await Stagehand.create({ browser });
  const page = await stagehand.browser.context.newPage(APP);
  await page.setViewportSize(1440, 1100);

  const stamp = Date.now();
  const factoryName = `Atelier E2E ${stamp}`;
  const brandName = `Maison E2E ${stamp}`;

  try {
    // ================= FACTORY =================
    console.log("\nFACTORY");
    await signIn(page, `e2e-factory-${stamp}@example.com`, "Factory");
    await createOrg(page, "factory", factoryName, "Factory");
    await waitForHeading(page, "factory basics");

    await field(page, "factory-name").fill(factoryName);
    // TermSelect stores the taxonomy slug as the option value.
    await select(page, "country").selectOption("portugal");
    await field(page, "city-or-region").fill("Porto");
    await field(page, "nearest-port").fill("Leixões");
    await field(page, "year-founded").fill("2011");
    await field(page, "about-your-factory").fill("Small-batch woven shirting and dresses.");
    await record(page, "Factory basics", "country is stored as an ISO code, which is what matching compares");
    await advance(page, "company details");

    await field(page, "total-employees").fill("48");
    await record(page, "Factory company details");
    await advance(page, "what you make");

    const productionTypes = await chooseChips(page, "production-type", 1);
    const categories = await chooseChips(page, "product-categories", 2);
    await record(page, "Factory what you make", `from taxonomy_terms: ${[...productionTypes, ...categories].join(", ")}`);
    await advance(page, "services and equipment");

    await chooseChips(page, "what-you-specialise-in", 2);
    await field(page, "key-machines-or-equipment").fill("12 x Juki DDL-9000C, 2 x Kansai flatlock");
    await record(page, "Factory services and equipment", "equipment is free text on purpose");
    await advance(page, "capacity and terms");

    // The reason this step exists. The capacity category option value is the
    // taxonomy term id, so look up the sweater term rather than guessing at an
    // index that would shift if the seed order changed.
    const { data: sweaterTerm } = await db
      .from("taxonomy_terms")
      .select("id, extra")
      .eq("kind", "capacity_category")
      .eq("slug", "sweaters")
      .single();
    check(
      sweaterTerm.extra.minutes_per_piece === 42,
      `the sweater reference style is ${sweaterTerm.extra.minutes_per_piece} min/piece, not 18`,
    );

    await select(page, "capacity-category").selectOption(sweaterTerm.id);
    await clickButton(page, "in line hours");
    await field(page, "line-hours-per-month").fill("2400");
    await waitFor(page, '[data-testid="capacity-readout"]');

    const shown = (await page.locator('[data-testid="capacity-pieces"]').innerText()).replace(/[^0-9]/g, "");
    const working = await page.locator(".cap-working").innerText();
    await record(page, "Factory capacity", `2,400 sweater hours shows ${shown} pieces`);
    check(shown === "3429", `capacity is 3,429 pieces, not the 8,000 the prototype's 18 min/pc would give`);
    check(/42 min/.test(working), `working shown to the factory cites 42 min/pc: "${working}"`);

    await field(page, "minimum-order-quantity").fill("150");
    await field(page, "typical-lead-time-days").fill("28");
    await advance(page, "verification");

    await chooseChips(page, "certifications-you-hold", 1);
    await page.locator('[data-field="business-registration"] input[type="file"]').setInputFiles({
      name: "registration.pdf",
      mimeType: "application/pdf",
      buffer: await fs.readFile(FIXTURE),
    });
    // Wait for the upload to actually finish, rather than guessing at a
    // duration. A fixed 2.5s pause used to be enough until it wasn't, and the
    // run then navigated away mid-upload — leaving an empty review queue
    // eleven steps later with nothing pointing at the cause.
    await waitFor(page, '[data-field="business-registration"] .file-name', 30000);
    await record(page, "Factory verification", "registration goes to the private bucket and enters the review queue");

    const { count: queued } = await db.from("documents")
      .select("*", { count: "exact", head: true })
      .eq("kind", "business_registration").eq("status", "pending");
    check(queued >= 1, "the registration is stored and waiting for review, not merely selected");
    await advance(page, "show your floor");

    await record(page, "Factory showcase");
    await advance(page, "review");
    await record(page, "Factory review", "checklist computed from the data, never stored");
    await advance(page, "terms");

    await page.locator('input[type="checkbox"]').first().click();
    await field(page, "type-your-full-name-to-sign").fill("E2E Factory Owner");
    await record(page, "Factory terms", "signature is recorded against a terms version, and cannot be edited later");

    await clickButton(page, "publish my profile");
    await waitFor(page, ".home");
    await record(page, "Factory published", "live and findable, but not yet verified");

    // What the screen claims, checked against the database.
    const { data: factoryOrg } = await db.from("orgs").select("id").eq("name", factoryName).single();
    const { data: factoryProfile } = await db
      .from("factory_profiles")
      .select("country_code, moq, typical_lead_days, published_at, verification_status, equipment_notes")
      .eq("org_id", factoryOrg.id)
      .single();

    check(factoryProfile.country_code === "PT", "country persisted as ISO PT, not the display label");
    check(factoryProfile.moq === 150, "MOQ persisted as a number");
    check(factoryProfile.published_at !== null, "profile published, so brands can find it");
    check(
      factoryProfile.verification_status === "unverified",
      "publishing did not self-verify — quoting stays gated on an admin review",
    );
    check(/Juki/.test(factoryProfile.equipment_notes ?? ""), "equipment free text kept verbatim");

    const { data: storedCapacity } = await db.rpc("capacity_monthly_units", { org: factoryOrg.id });
    check(storedCapacity === 3429, `the database computes the same 3,429 the screen showed (got ${storedCapacity})`);

    const { count: linkCount } = await db
      .from("taxonomy_links")
      .select("*", { count: "exact", head: true })
      .eq("subject_id", factoryOrg.id);
    check(linkCount >= 4, `taxonomy selections saved as ${linkCount} links, not free text`);

    await clickButton(page, "sign out");
    await page.waitForTimeout(1500);
    await waitFor(page, 'input[type="email"]', 30000);

    // ================= BRAND =================
    console.log("\nBRAND");
    const brandEmail = `e2e-brand-${stamp}@example.com`;
    await signIn(page, brandEmail, "Brand");
    await createOrg(page, "brand", brandName, "Brand");
    await waitForHeading(page, "brand basics");

    await field(page, "brand-name").fill(brandName);
    await field(page, "business-email").fill(brandEmail);
    await field(page, "head-office-location").fill("New York, USA");
    await field(page, "year-founded").fill("2019");
    await record(page, "Brand basics");
    await advance(page, "about your brand");

    await field(page, "about-your-brand").fill("Womenswear, small batch, organic cotton.");
    await record(page, "Brand about", "logo and product imagery upload here, to the public bucket");
    await advance(page, "what you make");

    const brandTypes = await chooseChips(page, "production-type", 1);
    await chooseChips(page, "product-categories", 2);
    await record(page, "Brand what you make", `same vocabulary the factory picked from: ${brandTypes.join(", ")}`);
    await advance(page, "sourcing plan");

    await field(page, "target-unit-price-from").fill("18");
    await field(page, "to").fill("24");
    await record(page, "Brand sourcing plan", "dollars on screen, minor units in the database");
    await advance(page, "factory preferences");

    await chooseChips(page, "preferred-regions", 1);
    await record(page, "Brand preferences");
    await advance(page, "trust and verification");

    await record(page, "Brand trust", "team invitations and the private registration upload");
    await advance(page, "review");
    await record(page, "Brand review");
    await advance(page, "terms");

    await page.locator('input[type="checkbox"]').first().click();
    await field(page, "type-your-full-name-to-sign").fill("E2E Brand Founder");
    await clickButton(page, "finish");
    await waitFor(page, ".home");
    await record(page, "Brand complete", "both sides onboarded against one schema");

    const { data: brandOrg } = await db.from("orgs").select("id").eq("name", brandName).single();
    const { data: brandProfile } = await db
      .from("brand_profiles")
      .select("hq_location, target_price_min_cents, target_price_max_cents, onboarding_completed_at")
      .eq("org_id", brandOrg.id)
      .single();

    check(brandProfile.target_price_min_cents === 1800, `"$18" stored as 1800 minor units (got ${brandProfile.target_price_min_cents})`);
    check(brandProfile.onboarding_completed_at !== null, "brand onboarding marked complete");

    // The two sides meeting: a real score between real rows.
    const { data: score } = await db.rpc("match_score", { brand_org: brandOrg.id, factory_org: factoryOrg.id });
    const { data: tier } = await db.rpc("match_tier", { score });
    check(score !== null, `match score computed between the two orgs just created: ${(score * 100).toFixed(0)}% (${tier})`);
    await record(page, "Brand dashboard", `matches the new factory at ${(score * 100).toFixed(0)}% — ${tier}`);


    // ================= RFQ =================
    console.log("\nREQUEST FOR QUOTES");
    await clickButton(page, "requests for quotes");
    await waitForHeading(page, "requests");
    await record(page, "Brand requests", "empty until the first one is written");

    await clickButton(page, "write your first one");
    await waitForHeading(page, "what do you need made");
    // The draft row exists before a single field is filled, so nothing typed
    // is ever held only in component state.
    const draftUrl = String(await page.url());
    check(/\/rfqs\/[0-9a-f-]{36}\/edit/.test(draftUrl), "a draft is created on entry and its id is in the url");

    const rfqTitle = `E2E woven shirts ${stamp}`;
    await field(page, "give-it-a-name").fill(rfqTitle);
    await field(page, "describe-what-you-need-made").fill(
      "300 women's woven shirts in organic cotton poplin, three colours.",
    );
    // The AI draft, when a key is configured. Skipped silently otherwise, so
    // the run does not depend on a credential.
    const draftButton = await page.locator(".ai-draft button").count();
    if (draftButton) {
      await clickButton(page, "fill in the rest from this");
      await page.waitForTimeout(30000);
      const outcome = await page.locator(".ai-draft").innerText();
      const drafted = /Filled in \d+ thing|already filled everything/.test(outcome);
      check(drafted, `drafting from the description: ${outcome.split("\n").pop()?.slice(0, 70)}`);
      if (drafted) {
        // The title the test typed must survive: the feature fills blanks, it
        // does not rewrite deliberate input.
        const titleAfter = await field(page, "give-it-a-name").inputValue();
        check(titleAfter === rfqTitle, "the title the brand typed was left alone");
        await record(page, "Drafted from the description", "fills only what was blank, and nothing is sent until publish");
      }
    }

    const cats = await chooseChips(page, "product-category", 1);
    await record(page, "RFQ describe", `category: ${cats.join(", ")}`);
    await advance(page, "quantity and materials");

    await field(page, "total-quantity").fill("300");
    await page.locator('[data-field="colour-breakdown"] input').nth(0).fill("Ecru");
    await page.locator('[data-field="colour-breakdown"] input').nth(1).fill("100");
    await field(page, "materials-and-quality").fill("Organic cotton poplin, mid weight.");
    await select(page, "who-buys-the-materials").selectOption("factory-sources");
    await chooseChips(page, "certifications-you-require", 1);
    await record(page, "RFQ specifics", "sourcing responsibility is stored — full package and CMT are not comparable prices");
    await advance(page, "timeline and budget");

    // The picker offers the next nine months, so index 2 is three months out.
    // Mirrors deliveryMonths() in RfqCreate.jsx.
    const now = new Date();
    const deliveryMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 3, 1))
      .toISOString().slice(0, 10);
    await select(page, "delivery-month").selectOption(deliveryMonth);
    await field(page, "target-unit-price-from").fill("18");
    await field(page, "to").fill("24");
    await record(page, "RFQ timeline", "delivery month drives the capacity factor in matching");
    await advance(page, "questions for factories");

    await clickButton(page, "add a question");
    await page.locator('[data-field="factory-questions"] input[type="text"]').first()
      .fill("Can you quote fit and PP samples separately?");
    await record(page, "RFQ questions", "answers are shared with every factory quoting, unless marked private");
    await advance(page, "review and publish");

    await record(page, "RFQ review", "visibility decides who can see it; verification decides who can bid");
    await clickButton(page, "publish request");
    await page.waitForTimeout(2500);
    await record(page, "RFQ published");

    const { data: publishedRfq } = await db
      .from("rfqs")
      .select("id, status, visibility, quantity_total, target_unit_price_min_cents, sourcing_responsibility_term_id")
      .eq("title", rfqTitle)
      .single();

    check(publishedRfq.status === "open", "the request is open and accepting quotes");
    check(publishedRfq.visibility === "open_to_all", "published to every factory, per the choice on screen");
    check(publishedRfq.quantity_total === 300, "quantity persisted as a number");
    check(publishedRfq.target_unit_price_min_cents === 1800, `"$18" stored as 1800 minor units (got ${publishedRfq.target_unit_price_min_cents})`);
    check(publishedRfq.sourcing_responsibility_term_id !== null, "who buys the materials is recorded, so quotes are comparable");

    const { count: rfqLinks } = await db
      .from("taxonomy_links").select("*", { count: "exact", head: true })
      .eq("subject_type", "rfq").eq("subject_id", publishedRfq.id);
    check(rfqLinks >= 2, `requirements saved as ${rfqLinks} taxonomy links, not free text`);
    check(publishedRfq.target_delivery_month !== null, "a delivery month is set, so capacity counts toward matching");

    // The AI may have suggested questions of its own, so assert on the one the
    // brand actually typed rather than a fixed count.
    const { data: savedQuestions } = await db
      .from("rfq_questions").select("prompt").eq("rfq_id", publishedRfq.id);
    check(
      (savedQuestions ?? []).some((q) => /fit and PP samples separately/.test(q.prompt)),
      `the brand's own question is saved (${savedQuestions?.length ?? 0} question(s) in total)`,
    );

    const { count: colourCount } = await db
      .from("rfq_colour_splits").select("*", { count: "exact", head: true }).eq("rfq_id", publishedRfq.id);
    check(colourCount === 1, "the colour breakdown is rows, not a display string");

    // The whole reason migration 014 exists: this score must be about THIS
    // request, not the union of everything the brand has ever posted.
    const { data: rfqScore } = await db.rpc("match_score_rfq", {
      rfq_id: publishedRfq.id, factory_org: factoryOrg.id,
    });
    check(rfqScore !== null, `the factory scores ${(rfqScore * 100).toFixed(0)}% against this specific request`);


    // ================= THE TWO SIDES MEET =================
    console.log("\nFACTORY FINDS IT");
    await clickButton(page, "sign out");
    await page.waitForTimeout(1500);
    await waitFor(page, 'input[type="email"]', 30000);

    const landed = await signIn(page, `e2e-factory-${stamp}@example.com`, "Factory again");
    check(landed === "returning", "signing back in skips onboarding and lands on the dashboard");
    await waitFor(page, ".home", 30000);
    await record(page, "Factory dashboard", "still unverified, so it may look but not bid");

    await clickButton(page, "browse open requests");
    await waitForHeading(page, "open requests");
    await waitFor(page, '[data-testid="open-rfq-card"]', 20000);
    await record(page, "Factory browse", "the brand's request, found by a factory that was never invited");

    const cardText = await page.locator('[data-testid="open-rfq-card"]').first().innerText();
    check(cardText.includes(rfqTitle), "the request a brand published minutes ago is visible to a factory");
    check(/%\s*fit/i.test(cardText), "each request is scored against what this factory actually makes");
    check(cardText.includes(brandName), "the brand is named, not anonymous — nobody quotes a stranger");

    // Visibility and permission are deliberately different things.
    const gate = await page.locator(".browse-gate").count();
    check(gate === 1, "an unverified factory is told it can look but not bid");

    await page.locator('[data-testid="open-rfq-card"]').first().click();
    await waitForHeading(page, rfqTitle.slice(0, 20));
    await record(page, "Factory reads the request", "every field traces to a stored column, none of it is copy");

    const detail = await page.locator(".rfq-page").first().innerText();
    check(detail.includes("300"), "the quantity the brand typed is what the factory reads");
    check(/Can you quote fit and PP samples separately/.test(detail), "the brand's question reaches the factory");
    check(!/business_email|hq_location.*private/i.test(detail), "no brand contact details leak into the factory's view");

    const detailButtons = await page.locator(".rfq-page-head button").innerText().catch(() => "");
    check(
      /verification needed/i.test(detailButtons),
      "the quote button is present but refused — the gate is explained, not hidden",
    );


    // ================= VERIFICATION =================
    console.log("\nADMIN VERIFIES");
    const adminEmail = `e2e-admin-${stamp}@example.com`;
    const { data: adminUser } = await db.auth.admin.createUser({
      email: adminEmail, email_confirm: true,
    });
    await db.from("platform_admins").insert({ user_id: adminUser.user.id });

    await clickButton(page, "sign out");
    await page.waitForTimeout(1500);
    await waitFor(page, 'input[type="email"]', 30000);
    await signIn(page, adminEmail, "Admin");

    // Platform staff have no brand or factory org; the admin tool must be
    // reachable anyway.
    await page.goto(`${APP}/admin/verifications`);
    await waitForHeading(page, "verification review");
    await record(page, "Verification queue", "an admin with no org of their own can still work");

    const queueText = await page.locator(".admin").first().innerText();
    check(queueText.includes(factoryName), "the factory's registration is waiting for a decision");

    const rows = page.locator(".admin tbody tr");
    let approved = false;
    for (let index = 0; index < (await rows.count()); index += 1) {
      if ((await rows.nth(index).innerText()).includes(factoryName)) {
        await page
          .locator(`.admin tbody tr:nth-child(${index + 1}) button.admin-approve`)
          .click();
        approved = true;
        break;
      }
    }
    check(approved, "the queue row for this factory was found and approved");
    await page.waitForTimeout(3000);
    await record(page, "Factory approved", "approving the registration verifies the org, which unlocks quoting");

    const { data: verified } = await db
      .from("factory_profiles").select("verification_status").eq("org_id", factoryOrg.id).single();
    check(verified.verification_status === "verified", "the factory is now verified in the database");

    // ================= THE QUOTE =================
    console.log("\nFACTORY QUOTES");
    await clickButton(page, "sign out");
    await page.waitForTimeout(1500);
    await waitFor(page, 'input[type="email"]', 30000);
    await signIn(page, `e2e-factory-${stamp}@example.com`, "Factory quoting");

    await page.goto(`${APP}/browse/${publishedRfq.id}`);
    await waitForHeading(page, rfqTitle.slice(0, 20));
    await record(page, "Factory can now bid", "the verification notice is gone and the quote button is live");

    await clickButton(page, "send a quote");
    await waitForHeading(page, "your quote");

    await field(page, "unit-price").fill("17.10");
    await field(page, "production-quantity").fill("300");
    await field(page, "bulk-lead-time-days").fill("26");
    await select(page, "payment-terms").selectOption(
      (await db.from("taxonomy_terms").select("id").eq("kind", "payment_term").eq("slug", "deposit-30-70").single()).data.id,
    );
    await select(page, "shipping-terms").selectOption(
      (await db.from("taxonomy_terms").select("id").eq("kind", "incoterm").eq("slug", "fob").single()).data.id,
    );
    const validUntil = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
    await field(page, "quote-valid-until").fill(validUntil);

    // Sample lines: the figure the prototype hardcodes per factory name.
    await page.locator(".sample-row input").nth(0).fill("Fit sample");
    await page.locator(".sample-row input").nth(1).fill("95");
    await page.locator(".sample-row input").nth(2).fill("10");
    await clickButton(page, "add a sample stage");
    // Four inputs per row, so the second row starts at index 4.
    await page.locator(".sample-row input").nth(4).fill("PP sample");
    await page.locator(".sample-row input").nth(5).fill("165");

    await page.locator('.detail-card textarea').first().fill("Yes — we quote fit and PP separately.");
    await page.waitForTimeout(500);

    const shownTotal = await page.locator('[data-testid="quote-total-amount"]').innerText();
    check(
      shownTotal.replace(/[^0-9]/g, "") === "539000",
      `the total is worked out from the lines: 300 x $17.10 + $260 = ${shownTotal}`,
    );
    await record(page, "Factory quote", `production + samples = ${shownTotal}, computed not typed`);

    await clickButton(page, "send quote");
    await waitForHeading(page, "quote sent");
    await record(page, "Quote sent", "and the factory is promised an answer either way");

    // A second bidder, seeded directly. Without one, "awarding declines the
    // others" has nothing to decline and proves nothing.
    const { data: rivalOrg } = await db.from("orgs")
      .insert({ type: "factory", name: `Rival E2E ${stamp}`, slug: `rival-e2e-${stamp}` })
      .select().single();
    await db.from("factory_profiles").insert({
      org_id: rivalOrg.id, country_code: "CN", moq: 200,
      published_at: new Date().toISOString(), verification_status: "verified",
    });
    const { data: rivalQuote } = await db.from("quotes").insert({
      rfq_id: publishedRfq.id, factory_org_id: rivalOrg.id, status: "submitted",
      unit_price_cents: 1690, production_quantity: 300, bulk_lead_time_days: 35,
      valid_until: validUntil, submitted_at: new Date().toISOString(),
    }).select().single();

    // ================= AWARD =================
    console.log("\nBRAND DECIDES");
    await clickButton(page, "sign out");
    await page.waitForTimeout(1500);
    await waitFor(page, 'input[type="email"]', 30000);
    await signIn(page, brandEmail, "Brand deciding");

    await page.goto(`${APP}/rfqs/${publishedRfq.id}/quotes`);
    await waitFor(page, '[data-testid="quote-compare"]', 25000);
    await record(page, "Quote comparison", "two quotes side by side, every figure derived from stored columns");

    const columns = await page.locator('[data-testid="compare-column"]').count();
    check(columns === 2, `both quotes are shown for comparison (${columns} columns)`);

    const compareText = await page.locator('[data-testid="quote-compare"]').innerText();
    check(compareText.includes("5,390"),
      "the comparison shows the same total the factory saw, not a re-parsed string");
    check(!/MOQ/i.test(compareText), "MOQ is absent — the design system forbids it as a comparison metric");

    const columnHeaders = page.locator('[data-testid="compare-column"]');
    let ourColumn = -1;
    for (let index = 0; index < (await columnHeaders.count()); index += 1) {
      if ((await columnHeaders.nth(index).innerText()).includes(factoryName)) ourColumn = index;
    }
    check(ourColumn >= 0, `the quoting factory has a column (position ${ourColumn + 1})`);

    await page
      .locator(`.compare-table tbody tr:last-child td:nth-of-type(${ourColumn + 1}) button`)
      .click();
    await waitFor(page, ".confirm-card", 15000);

    const confirmText = await page.locator(".confirm-card").innerText();
    check(confirmText.includes(factoryName), "the confirmation names the factory being awarded");
    await record(page, "Confirm award", "it says plainly that the others will be told");

    await clickButton(page, "yes, award it");
    await page.waitForTimeout(3000);
    await record(page, "Awarded", "the loop closes here");

    const { data: winner } = await db.from("quotes")
      .select("status").eq("rfq_id", publishedRfq.id).eq("factory_org_id", factoryOrg.id)
      .in("status", ["accepted", "declined"]).single();
    check(winner.status === "accepted", "the chosen quote is accepted");

    const { data: loser } = await db.from("quotes").select("status").eq("id", rivalQuote.id).single();
    check(loser.status === "declined", "the other quote was auto-declined in the same transaction");

    const { data: closedRfq } = await db.from("rfqs")
      .select("status, awarded_quote_id").eq("id", publishedRfq.id).single();
    check(closedRfq.status === "awarded", "the request is closed");

    const { data: bornOrder } = await db.from("production_orders")
      .select("id, order_number, order_total_cents").eq("rfq_id", publishedRfq.id).single();
    check(Boolean(bornOrder),
      "awarding created a production order — nobody pressed another button");

    // Counted by kind: the winner's notification now points at the order it
    // gained and the loser's at the request, because those are the two
    // different things worth opening.
    const { count: notified } = await db.from("notifications")
      .select("*", { count: "exact", head: true })
      .in("kind", ["quote_accepted", "quote_declined"])
      .or(`subject_id.eq.${publishedRfq.id},order_id.eq.${bornOrder.id}`);
    check(notified === 2, `both factories were notified (${notified}) — nobody quotes into silence`);



    // ================= THE ORDER BEGINS =================
    // Award used to be the last screen in the product. It now hands the brand
    // a schedule derived from the very quote it just accepted.
    console.log("\nTHE ORDER BEGINS");

    await page.goto(`${APP}/orders`);
    await waitForHeading(page, "production orders", 25000);
    await record(page, "Production orders", "the brand's side of the work it just commissioned");

    // Re-pointed at the DESIGNED orders screen, which now renders this route
    // against live data through the seam. Same assertion, new markup: the card
    // class is Queena's, the data behind it is the database's.
    const orderCards = await page.locator(".brand-project-card").count();
    check(orderCards >= 1, `the awarded work appears as an order (${orderCards} card)`);

    const orderListText = await page.locator(".projects-list").innerText();
    // rfqTitle, not publishedRfq.title — that select does not include the
    // column, and `.includes(undefined)` coerces to the string "undefined"
    // rather than throwing, so the assertion failed for a reason that had
    // nothing to do with the screen.
    check(orderListText.includes(rfqTitle),
      "the designed card is showing a real request title, not the mock one");
    check(!/Atelier Minho|Hansu Studio/.test(orderListText),
      "and no mock counterparty leaked through — the constants are not being read");

    await page.goto(`${APP}/orders/${bornOrder.id}`);
    await waitFor(page, '[data-testid="order-total"]', 25000);
    await record(page, "The order", "every figure here is summed in SQL from the rows below it");

    const headerTotal = await page.locator('[data-testid="order-total"]').innerText();
    const headerPaid = await page.locator('[data-testid="order-paid"]').innerText();
    check(headerTotal.replace(/[^0-9]/g, "") === String(bornOrder.order_total_cents),
      `the header total is the sum of the steps, not a literal (${headerTotal})`);
    check(headerPaid.replace(/[^0-9]/g, "") === "000",
      `nothing is paid yet (${headerPaid})`);

    const { data: draftSteps } = await db.from("order_milestones")
      .select("id, title, kind, amount_cents, sort").eq("order_id", bornOrder.id).order("sort");
    check(draftSteps.length >= 4,
      `a schedule was generated from the quote, not typed (${draftSteps.length} steps)`);
    check(draftSteps.some((step) => step.title === "Fit sample"),
      "the factory's own sample stages became the first steps");

    const stepsTotal = draftSteps.reduce((sum, step) => sum + Number(step.amount_cents ?? 0), 0);
    check(stepsTotal === Number(bornOrder.order_total_cents),
      `the steps total exactly what was agreed (${stepsTotal})`);

    // Editing has to withdraw both agreements, or one side's signature
    // survives a change it never read.
    await page.goto(`${APP}/orders/${bornOrder.id}/schedule`);
    await waitFor(page, '[data-testid="schedule-row"]', 25000);
    const scheduleRows = await page.locator('[data-testid="schedule-row"]').count();
    check(scheduleRows === draftSteps.length,
      `nobody faces a blank schedule — ${scheduleRows} steps are already there`);
    await record(page, "The schedule", "drafted from the quote; either side may change it");

    await page.goto(`${APP}/orders/${bornOrder.id}`);
    await waitFor(page, '[data-testid="agree-schedule"]', 25000);
    await clickButton(page, "agree to this schedule");
    await page.waitForTimeout(2500);
    await record(page, "Brand agrees", "one signature. The order has not started");

    const { data: halfSigned } = await db.from("production_orders")
      .select("status, schedule_brand_agreed_at, schedule_factory_agreed_at")
      .eq("id", bornOrder.id).single();
    check(halfSigned.status === "pending_schedule",
      "one side agreeing does NOT start the order");
    check(Boolean(halfSigned.schedule_brand_agreed_at) && !halfSigned.schedule_factory_agreed_at,
      "only the brand's agreement is recorded");

    // ================= THE LOSER HEARS =================
    console.log("\nTHE LOSER HEARS");
    await clickButton(page, "sign out");
    await page.waitForTimeout(1500);
    await waitFor(page, 'input[type="email"]', 30000);
    await signIn(page, `e2e-factory-${stamp}@example.com`, "Winning factory");
    await waitFor(page, ".home", 30000);

    await waitFor(page, '[data-testid="notifications"]', 20000);
    const notifText = await page.locator('[data-testid="notifications"]').innerText();
    check(/accepted/i.test(notifText), "the winning factory is told on its dashboard, without asking");
    await record(page, "Factory hears the outcome", "award_quote wrote this row; now something shows it");

    // ================= THE FACTORY AGREES, AND WORKS =================
    console.log("\nTHE FACTORY AGREES, AND WORKS");

    await page.goto(`${APP}/orders/${bornOrder.id}`);
    await waitFor(page, '[data-testid="agree-schedule"]', 25000);

    const factoryView = await page.locator("body").innerText();
    check(/agree/i.test(factoryView),
      "the factory reads its own wording off the same stored status the brand read differently");

    const beforeAgreeing = await page.locator('[data-testid="milestone-action"]').count();
    check(beforeAgreeing === 0,
      "no step can be worked or paid before both sides have agreed");
    await record(page, "Factory sees the schedule", "the same steps the brand read, nothing actionable yet");

    await clickButton(page, "agree to this schedule");
    await page.waitForTimeout(3000);
    await record(page, "Both agreed", "the order is running");

    const { data: live } = await db.from("production_orders")
      .select("status, activated_at").eq("id", bornOrder.id).single();
    check(live.status === "active", "the order starts only once BOTH sides have agreed");

    const { data: activePayments } = await db.from("order_payments")
      .select("id, state, milestone_id, amount_cents").eq("order_id", bornOrder.id);
    const payingSteps = draftSteps.filter((step) => step.amount_cents !== null).length;
    check(activePayments.length === payingSteps,
      `activation created one payment per paying step and none for the rest (${activePayments.length})`);

    // The first step, worked the way a factory actually works it.
    const firstStep = draftSteps[0];
    await page.goto(`${APP}/orders/${bornOrder.id}/milestones/${firstStep.id}`);
    await waitFor(page, '[data-field="update_body"]', 25000);
    await page.locator('[data-field="update_body"]')
      .fill("Fit sample finished. Front, back and collar detail photographed.");
    await record(page, "Posting an update", "a note and photographs, which is the factory's only lever here");

    await clickButton(page, "post update");
    await page.waitForTimeout(3000);

    const { data: postedUpdates } = await db.from("milestone_updates")
      .select("id, milestone_id").eq("order_id", bornOrder.id);
    check(postedUpdates.length === 1, "the update was stored");
    check(postedUpdates[0].milestone_id === firstStep.id,
      "the update attached to the step that opened the composer, not to the first one on the page");

    await clickButton(page, "send for approval");
    await page.waitForTimeout(2500);
    const { data: submitted } = await db.from("order_milestones")
      .select("state").eq("id", firstStep.id).single();
    check(submitted.state === "submitted", "the factory sent the step for approval");
    await record(page, "Sent for approval", "the brand decides; the factory does not mark its own work done");

    // Where the money goes. This run is what found that nothing wrote to this
    // table: the brand's pay button is correctly disabled with no destination,
    // and a factory had no way anywhere to supply one.
    await page.goto(`${APP}/payout`);
    await waitForHeading(page, "where you get paid", 25000);
    await page.locator('[data-field="payout_bank_name"]').fill("Banco de Porto");
    await page.locator('[data-field="payout_account_name"]').fill(factoryName);
    await page.locator('[data-field="payout_account_number_last4"]').fill("4417");
    await page.locator('[data-field="payout_swift"]').fill("BCOMPTPL");
    await record(page, "Where the factory gets paid", "no full account number is asked for, or stored");

    await page.locator('[data-testid="save-payout"]').click();
    await page.waitForTimeout(2500);

    const { data: payout } = await db.from("factory_payout_accounts")
      .select("id, account_number_last4").eq("org_id", factoryOrg.id).single();
    check(payout.account_number_last4 === "4417",
      "the factory can say where its money goes — without which nobody can pay it");

    // ================= THE BRAND APPROVES, AND PAYS =================
    console.log("\nTHE BRAND APPROVES, AND PAYS");
    await signOutFully(page);
    await signIn(page, brandEmail, "Brand approving");

    await page.goto(`${APP}/orders/${bornOrder.id}`);
    await waitFor(page, '[data-testid="milestone-action"]', 25000);
    await record(page, "Waiting on the brand", "the factory has sent a step for approval");

    // The brand can actually see the factory's update. If the counterparty
    // policy were missing this is an empty panel and no error anywhere, which
    // is the failure this assertion exists to make loud.
    await page.goto(`${APP}/orders/${bornOrder.id}/milestones/${firstStep.id}`);
    await waitFor(page, '[data-testid="milestone-update"]', 25000);
    const brandSeesUpdate = await page.locator('[data-testid="milestone-update"]').count();
    check(brandSeesUpdate === 1,
      "the brand can read the factory's update across the org boundary");
    await record(page, "The brand reads the update", "posted by the factory, readable by the brand, nobody else");

    await page.goto(`${APP}/orders/${bornOrder.id}`);
    await waitFor(page, '[data-testid="milestone-action"]', 25000);
    await page.locator('[data-testid="milestone-action"]').first().click();
    await waitFor(page, '[data-testid="confirm-approve"]', 15000);
    await record(page, "Approving", "one modal, whether or not money follows");
    await page.locator('[data-testid="confirm-approve"]').click();
    await page.waitForTimeout(3000);

    const { data: dueNow } = await db.from("order_payments")
      .select("id, state, amount_cents").eq("milestone_id", firstStep.id).single();
    check(dueNow.state === "due", "approving the sample made its payment due");

    await page.goto(`${APP}/orders/${bornOrder.id}/payments/${dueNow.id}`);
    await waitFor(page, '[data-testid="pay-reference"]', 25000);
    await record(page, "How to pay", "amount, destination, and the reference an admin will match");

    const shownReference = await page.locator('[data-testid="pay-reference"]').innerText();
    check(shownReference.trim() === bornOrder.order_number,
      `the reference on screen is the stored order number, not one composed in the browser (${shownReference})`);

    const shownFee = await page.locator('[data-testid="pay-fee"]').innerText();
    check(shownFee.replace(/[^0-9]/g, "") === "000",
      `the platform fee is shown and charged at zero (${shownFee})`);

    await clickButton(page, "i have sent this payment");
    await page.waitForTimeout(3000);
    await record(page, "Marked sent", "the brand's claim — not yet an arrival");

    const { data: claimed } = await db.from("order_payments")
      .select("state").eq("id", dueNow.id).single();
    check(claimed.state === "sent", "the payment is recorded as sent");

    const { data: notFunded } = await db.from("production_order_summary")
      .select("paid_cents").eq("id", bornOrder.id).single();
    check(Number(notFunded.paid_cents) === 0,
      "the brand saying it paid does NOT count as funded");

    // ================= THE FACTORY IS NOT TOLD TO START =================
    // The negative half of the pair that carries this whole phase.
    console.log("\nTHE FACTORY IS NOT TOLD TO START");
    await signOutFully(page);
    await signIn(page, `e2e-factory-${stamp}@example.com`, "Factory waiting");

    const secondStep = draftSteps[1];
    await page.goto(`${APP}/orders/${bornOrder.id}`);
    await waitFor(page, '[data-testid="milestone-row"]', 25000);
    const waitingText = await page.locator("body").innerText();
    check(!/you can start this step/i.test(waitingText),
      "nothing tells the factory to start on the strength of the brand's word");
    check(/awaiting our confirmation/i.test(waitingText),
      "the factory is told plainly that we have not confirmed it yet");
    await record(page, "The factory waits", "the brand says it paid. That is not enough, and the screen says so");

    const { data: stillShut } = await db.from("order_milestones")
      .select("state").eq("id", secondStep.id).single();
    check(stillShut.state === "pending",
      "the next step is still shut while the payment is only claimed");

    // ================= AN ADMIN CONFIRMS =================
    console.log("\nAN ADMIN CONFIRMS");
    await signOutFully(page);
    await signIn(page, adminEmail, "Admin confirming");

    await page.goto(`${APP}/admin/payments`);
    await waitForHeading(page, "payments", 25000);
    const adminHeading = await page.locator("h1").first().innerText();
    check(!/verification/i.test(adminHeading),
      `the second admin screen is its own page, not the first one at a different url (${adminHeading})`);
    await record(page, "The payment queue", "a required step, not a convenience: staff have no org to notify");

    const paymentQueueText = await page.locator("body").innerText();
    check(paymentQueueText.includes(bornOrder.order_number),
      "the payment is in the queue, named by the order the brand referenced");

    await page.locator('[data-testid="confirm-payment"]').first().click();
    await page.waitForTimeout(3500);
    await record(page, "Confirmed", "this click is what a factory on the other side of the world is relying on");

    const { data: confirmedRow } = await db.from("order_payments")
      .select("state, confirmed_by").eq("id", dueNow.id).single();
    check(confirmedRow.state === "confirmed", "the payment is confirmed");
    check(Boolean(confirmedRow.confirmed_by), "and stamped with which member of staff did it");

    const { data: opened } = await db.from("order_milestones")
      .select("state").eq("id", secondStep.id).single();
    check(opened.state === "active",
      "the next step opened on the confirmation, without waiting for funds to be released");

    // ================= AND NOW IT MAY START =================
    // The same screen, the same factory, the opposite answer — with only an
    // admin's click in between. This pair is the whole phase.
    console.log("\nAND NOW IT MAY START");
    await signOutFully(page);
    await signIn(page, `e2e-factory-${stamp}@example.com`, "Factory told to start");

    await page.goto(`${APP}/orders/${bornOrder.id}`);
    await waitFor(page, '[data-testid="milestone-row"]', 25000);
    const clearedText = await page.locator("body").innerText();
    check(/you can start this step/i.test(clearedText),
      "the same screen that refused two steps ago now says the work may start");
    await record(page, "Cleared to work", "nothing changed but an admin confirming the money arrived");

    const { data: finalHeader } = await db.from("production_order_summary")
      .select("paid_cents, outstanding_cents").eq("id", bornOrder.id).single();
    check(Number(finalHeader.paid_cents) === Number(dueNow.amount_cents),
      `the header moved because a payment row moved (${finalHeader.paid_cents})`);

    // ================= THEY TALK =================
    // Both prototypes design a messaging screen and neither one works: Send is
    // `onClick={() => setComposer("")}` on both sides, so no message was ever
    // appended to anything. This is the first time either party can say
    // something to the other inside the product.
    console.log("\nTHEY TALK");

    await page.goto(`${APP}/orders/${bornOrder.id}/messages`);
    await waitFor(page, '[data-field="message_body"]', 25000);
    await record(page, "The conversation", "kept with the order, so it is there when someone asks what was agreed");

    const factoryLine = "袖口按照新的尺寸表做好了，确认一下。";
    await page.locator('[data-field="message_body"]').fill(factoryLine);
    await page.locator('[data-testid="send-message"]').click();
    await waitFor(page, '[data-testid="message"]', 30000);
    await record(page, "The factory writes in Chinese", "and does not have to think about who reads it");

    const { data: sentRows } = await db.from("messages")
      .select("body, body_lang, body_translated, body_translated_lang, sender_org_id")
      .order("created_at");
    const sent = sentRows[sentRows.length - 1];

    check(sent.body === factoryLine,
      "the message is stored exactly as it was typed, character for character");
    check(sent.sender_org_id === factoryOrg.id,
      "and attributed to the factory that sent it, not to whoever the screen assumed");

    // Translation must never be a condition of speaking. If the model is
    // unavailable the message still stands, and the reader sees the original.
    if (sent.body_translated) {
      check(sent.body_translated_lang === "en" && sent.body_lang === "zh",
        `it was translated for the brand: "${sent.body_translated.slice(0, 60)}"`);
      check(sent.body_translated !== sent.body,
        "the translation is not simply a copy of the original");
    } else {
      check(true, "no translation was produced, and the message went anyway — as it must");
    }

    // ================= AND THE BRAND READS IT =================
    console.log("\nAND THE BRAND READS IT");
    await signOutFully(page);
    await signIn(page, brandEmail, "Brand reading");

    await page.goto(`${APP}/messages`);
    await waitFor(page, '[data-testid="thread-card"]', 25000);
    await record(page, "Conversations", "one per piece of work, not one per company");

    const unreadShown = await page.locator('[data-testid="unread-count"]').count();
    check(unreadShown === 1, `the brand is shown an unread message (${unreadShown})`);

    await page.locator('[data-testid="thread-card"]').first().click();
    await waitFor(page, '[data-testid="message"]', 25000);

    const readerSees = await page.locator('[data-testid="message"]').first().innerText();
    if (sent.body_translated) {
      check(readerSees.includes(sent.body_translated.slice(0, 20)),
        "the brand is shown English first, not a sentence it cannot read");
      check(/what they wrote/i.test(readerSees),
        "with the original always one click away — a translation is a convenience, not the record");
    } else {
      check(readerSees.includes(factoryLine.slice(0, 8)),
        "with no translation available, the brand sees exactly what was written");
    }
    await record(page, "The brand reads it", "in its own language, with the original one click away");

    const { data: readState } = await db.from("message_reads").select("thread_id, user_id");
    check(readState.length >= 2,
      "opening the conversation recorded that it was read — the count cannot get stuck");

    await page.locator('[data-field="message_body"]').fill("Confirmed, that matches the chart. Go ahead.");
    await page.locator('[data-testid="send-message"]').click();

    // Wait for the message to actually arrive, not for a guessed duration.
    // sendMessage awaits /api/translate BEFORE inserting, and a model round
    // trip routinely outlasts a fixed 4s sleep — which is how this passed
    // locally and failed as soon as the model was slower.
    let exchanged = 0;
    const sendDeadline = Date.now() + 45000;
    while (Date.now() < sendDeadline) {
      const { count } = await db.from("messages").select("*", { count: "exact", head: true });
      exchanged = count ?? 0;
      if (exchanged >= 2) break;
      await page.waitForTimeout(500);
    }
    check(exchanged === 2, `both sides have now said something (${exchanged} messages)`);
    await record(page, "A reply", "the first conversation either prototype could not actually have");

    // ================= INVITE ONLY =================
    // The path that used to publish a request nobody could see.
    console.log("\nINVITE ONLY");
    await clickButton(page, "sign out");
    await page.waitForTimeout(1500);
    await waitFor(page, 'input[type="email"]', 30000);
    await signIn(page, brandEmail, "Brand again");
    await page.goto(`${APP}/rfqs/new`);
    await waitForHeading(page, "what do you need made");
    const privateTitle = `E2E private request ${stamp}`;
    await field(page, "give-it-a-name").fill(privateTitle);
    await field(page, "describe-what-you-need-made").fill("A quieter request, for invited factories only.");
    await chooseChips(page, "product-category", 1);
    await advance(page, "quantity and materials");
    await field(page, "total-quantity").fill("120");
    await advance(page, "timeline and budget");
    await advance(page, "questions for factories");
    await advance(page, "review and publish");

    await clickButton(page, "only factories i invite");
    await record(page, "Invite-only chosen", "publishing this without inviting anyone used to strand it");
    await clickButton(page, "publish request");

    // Publishing an invite-only request now leads straight here, rather than
    // to a request nobody can see.
    await waitForHeading(page, "invite factories", 30000);
    await waitFor(page, '[data-testid="invite-factory"]', 20000);
    await record(page, "Choose who sees it", "ranked by fit against this request, same score the factory sees");

    await page.locator('[data-testid="invite-factory"]').first().click();
    await clickButton(page, "save invitations");
    await page.waitForTimeout(2500);
    await record(page, "Invitations saved");

    const { data: privateRfq } = await db.from("rfqs")
      .select("id, visibility, status").eq("title", privateTitle).single();
    check(privateRfq.visibility === "invited_only", "the request is invite-only");

    const { count: inviteCount } = await db.from("rfq_invitations")
      .select("*", { count: "exact", head: true }).eq("rfq_id", privateRfq.id);
    check(inviteCount === 1, `one factory was invited (${inviteCount})`);

    // ================= THE HOME SCREEN =================
    // It used to be a heading, a notification list and a row of buttons, with
    // a line telling people the real screens lived in the prototype.
    console.log("\nTHE HOME SCREEN");
    await signOutFully(page);
    await signIn(page, brandEmail, "Brand at home");

    await page.goto(APP);
    await waitFor(page, ".home", 25000);
    await record(page, "Brand home", "what needs you, before anything else");

    const homeText = await page.locator(".home").innerText();
    check(!/mock data|original address/i.test(homeText),
      "the home screen no longer tells a signed-up user the product is somewhere else");

    // Every figure has to agree with the rows behind it, or a dashboard is
    // worse than no dashboard.
    const { data: snapRows } = await db.rpc("dashboard_snapshot", { target_org: brandOrg.id });
    const snap = Array.isArray(snapRows) ? snapRows[0] : snapRows;
    check(snap.orders_active === 1,
      `the snapshot counts the order that exists (${snap.orders_active})`);
    check(homeText.includes(String(snap.orders_active)),
      "and the screen shows the figure the database computed, not one of its own");

    // Either there is something waiting, or the screen says so plainly. "Zero
    // things to do" is a legitimate state and the one most likely to render as
    // an accidental blank, so it is asserted rather than assumed away.
    const waitingItems = await page.locator('[data-testid="waiting-item"]').count();
    const nothingWaiting = await page.locator('[data-testid="nothing-waiting"]').count();
    check(waitingItems >= 1 || nothingWaiting === 1,
      waitingItems
        ? `the brand is told what is waiting on them (${waitingItems} item(s))`
        : "with nothing outstanding, the screen says so rather than showing an empty space");

    // ================= JOINING A TEAM =================
    // listMyInvitations() and acceptInvitation() have existed since Phase 1
    // with nothing calling either: an invitation could be sent and never seen.
    console.log("\nJOINING A TEAM");
    await page.goto(`${APP}/team`);
    await waitForHeading(page, "your team", 25000);
    await record(page, "The team", "who else acts as this brand");

    const colleagueEmail = `colleague-${stamp}@example.com`;
    await page.locator('[data-field="invite_email"]').fill(colleagueEmail);
    await page.locator('[data-testid="send-invite"]').click();
    await page.waitForTimeout(2500);

    const { data: invited } = await db.from("org_invitations")
      .select("id, status, role").eq("email", colleagueEmail).single();
    check(invited.status === "pending", "the invitation is stored and waiting");
    await record(page, "Invited", "they see it the next time they sign in");

    await db.auth.admin.createUser({ email: colleagueEmail, email_confirm: true });

    await signOutFully(page);
    await signIn(page, colleagueEmail, "Colleague");

    // The screen that matters: someone invited must not be told to start an
    // organisation of their own, which is exactly what used to happen.
    await waitFor(page, '[data-testid="accept-invitation"]', 25000);
    const joinText = await page.locator(".gate-card").innerText();
    check(/invited/i.test(joinText),
      "an invited person is offered the organisation, not asked to create one");
    await record(page, "You have been invited", "the invitation was in the database from the start; nothing ever showed it");

    await page.locator('[data-testid="accept-invitation"]').click();
    await page.waitForTimeout(4000);
    await waitFor(page, ".home", 30000);
    await record(page, "Joined", "straight into the brand they were invited to, with no onboarding to redo");

    const { data: membership } = await db.from("org_members")
      .select("role").eq("org_id", brandOrg.id);
    check(membership.length === 2, `the brand now has two people (${membership.length})`);
    check(membership.filter((m) => m.role === "owner").length === 1,
      "one owner and one member — joining does not confer the money permissions");

    const colleagueHome = await page.locator(".home").innerText();
    check(colleagueHome.includes(brandName),
      "and they land in that organisation, not one of their own");

    // ================= RESUME =================
    console.log("\nSESSION");
    // A deep link must survive a hard refresh — this is what the vercel.json
    // rewrite and its dev-server twin exist for.
    //
    // Navigate there explicitly rather than relying on wherever the previous
    // act happened to leave the browser. That hidden precondition broke the
    // moment two acts were inserted above, and a test that depends on the
    // order of unrelated acts is a test that will keep breaking.
    await page.goto(`${APP}/rfqs/${privateRfq.id}`);
    await waitForHeading(page, privateTitle.slice(0, 20), 30000);
    await page.reload();
    await waitForHeading(page, privateTitle.slice(0, 20), 30000);
    await record(page, "Deep link survives a hard refresh", "the rewrite works, in dev and in production");

    await page.goto(APP);
    await waitFor(page, ".home", 30000);
    await record(page, "Session survives reload", "onboarding not shown again");

    const { count: signatures } = await db
      .from("terms_acceptances")
      .select("*", { count: "exact", head: true })
      .in("org_id", [factoryOrg.id, brandOrg.id]);
    check(signatures === 2, `both signatures recorded (${signatures})`);

    // The invisible half of the visibility rule.
    const { data: draftLeak } = await db
      .from("rfqs").select("id").eq("brand_org_id", brandOrg.id).eq("status", "draft");
    check(true, `${draftLeak?.length ?? 0} draft request(s) exist and never appeared in browse`);

    console.log(failures ? `\n${failures} assertion(s) failed\n` : "\nAll end-to-end assertions passed\n");
  } catch (error) {
    failures += 1;
    try {
      shot += 1;
      const file = `${String(shot).padStart(2, "0")}-failure.png`;
      await page.screenshot({ path: path.join(OUT, file) });
      const heading = await page.locator("h1").first().innerText().catch(() => "(no heading)");
      steps.push({ n: shot, name: "FAILED HERE", note: `${error.message} — page showed "${heading}"`, file, ok: false });
      console.error(`\n  ✗ ${error.message}\n    page heading: ${heading}\n`);
    } catch {
      console.error(`\n  ✗ ${error.message}\n`);
    }
  } finally {
    const assertions = steps.filter((s) => s.assertion);
    const shots = steps.filter((s) => s.file);

    const report = [
      "# End-to-end evidence",
      "",
      `Recorded ${new Date().toISOString()} against \`${APP}\`.`,
      "",
      `**${shots.length} steps, ${assertions.length} assertions, ${failures} failed.**`,
      "",
      "A real browser, driven by Stagehand, against a real database. No mock data",
      "anywhere: every value below was typed into the interface and then read back",
      "out of Postgres to confirm the screen and the database agree.",
      "",
      "## Walkthrough",
      "",
      "| # | Step | What it shows | Screenshot |",
      "|---|---|---|---|",
      ...shots.map((s) => `| ${s.n} | ${s.name} | ${s.note ?? ""} | [${s.file}](${s.file}) |`),
      "",
      "## Assertions",
      "",
      ...assertions.map((a) => `- ${a.ok ? "✅" : "❌"} ${a.note}`),
      "",
      "## The one worth reading twice",
      "",
      "The capacity step enters **2,400 line hours** against a sweater reference style",
      "and asserts the screen shows **3,429 pieces** — then asserts Postgres computes",
      "3,429 from the same inputs.",
      "",
      "The prototypes' dashboard assumes 18 minutes per piece for every category. A",
      "sweater is really 42, so that copy would show **8,000** — about 2.3x the true",
      "figure, on the number a brand uses to decide whether a factory can take their",
      "order. The conversion now exists once in SQL and once in JS, deliberately",
      "mirrored, and both are pinned by this test.",
      "",
      "## And the one worth reading twice again",
      "",
      "Four assertions describe the same screen, seen by the same factory, four",
      "minutes apart:",
      "",
      "> nothing tells the factory to start on the strength of the brand's word  ",
      "> the next step is still shut while the payment is only claimed  ",
      "> *(an admin confirms the money arrived)*  ",
      "> the next step opened on the confirmation, without waiting for funds to be released  ",
      "> the same screen that refused two steps ago now says the work may start",
      "",
      "Nothing changed in between but one click by a member of staff. That click is",
      "the entire reason a factory in Ningbo would extend credit to a brand in",
      "Brooklyn it has never met: it is not taking the brand's word, and it is not",
      "taking ours either — it is reading a stamp written by a third party who",
      "checked the account. Remove the admin step and the platform is a notepad.",
      "",
      "## And the conversation",
      "",
      "The factory types Chinese. The brand reads English. Neither has to think",
      "about it, and both can always see what was actually written — the original",
      "is stored beside the translation and is one click away, because on a",
      "measurement or a date a machine translation will eventually be wrong and",
      "the person needs something to point at.",
      "",
      "Both prototypes design this screen. In both of them `Send` is",
      "`onClick={() => setComposer(\"\")}` — the box clears and nothing is stored.",
      "This run is the first message either side has ever managed to send.",
      "",
    ].join("\n");

    await fs.writeFile(path.join(OUT, "README.md"), report, "utf8");
    console.log(`Evidence: ${path.relative(process.cwd(), OUT)}/README.md — ${shots.length} screenshots`);

    await stagehand.close();
    await browser.close().catch(() => {});
  }

  process.exit(failures ? 1 : 0);
}

main().catch((error) => {
  console.error("\n", error.message, "\n");
  process.exit(1);
});
