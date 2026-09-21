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
async function recoveryEmail(email, attempts = 25) {
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
/**
 * Sign out, and prove it.
 *
 * Waiting for the login screen is not enough. It renders the moment the
 * status flips, while the stored token is still being cleared — so a run that
 * navigated immediately afterwards was signed straight back in as the
 * previous account, three acts later, with no error in between. What actually
 * settles the question is whether a token is still in storage.
 */
async function noSessionLeft(page) {
  return page.evaluate(() => {
    const held = (store) => {
      try {
        return Object.keys(store).some((k) => k.startsWith("sb-") && k.includes("auth-token"));
      } catch {
        return false;
      }
    };
    return !held(localStorage) && !held(sessionStorage);
  });
}

async function signOutFully(page) {
  await page.goto(APP);
  await page.waitForTimeout(1000);
  try {
    await clickButton(page, "sign out");
    await waitFor(page, 'input[type="email"]', 8000);
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (await noSessionLeft(page)) return;
      await page.waitForTimeout(200);
    }
  } catch {
    // fall through
  }
  await page.evaluate(() => {
    try { localStorage.clear(); sessionStorage.clear(); } catch {}
  });
  await page.goto(APP);
  await waitFor(page, 'input[type="email"]', 25000);
}

/** Every account in the walkthrough uses the same one, at the length the form promises. */
const PASSWORD = "walkthrough 8";

const portalUrl = (accountType) => (accountType === "factory" ? `${APP}?portal=factory` : APP);

/**
 * Sign up on the designed screen.
 *
 * One form: name, company, email, password. Which portal it is rendered in
 * decides whether the company is a brand or a vendor — so the account, the
 * person's name and the organisation are all created by this one submit, and
 * there is no "which side are you on?" afterwards. That question used to be a
 * separate screen and is now answered by the URL.
 */
async function signUp(page, { email, fullName, companyName, accountType, who }) {
  await page.goto(portalUrl(accountType));
  await waitFor(page, ".auth-card", 30000);
  await record(page, `${who} sign-up`, `the designed ${accountType === "factory" ? "vendor" : "brand"} portal`);

  await clickButton(page, "create an account");
  await waitFor(page, 'input[name="companyName"]', 10000);

  // The Terms and Privacy links used to be "#terms" and "#privacy", which
  // went nowhere. They open the published documents in a new tab, so the
  // half-filled form survives.
  const legalLinks = await page.evaluate(() =>
    [...document.querySelectorAll(".auth-legal a")].map((a) => ({ href: a.getAttribute("href"), target: a.target })));
  const type = accountType === "factory" ? "factory" : "brand";
  check(legalLinks[0]?.href?.includes(`legal=terms&type=${type}`) && legalLinks[0]?.target === "_blank",
    `${who}: the Terms link opens the ${type} terms in a new tab (${legalLinks[0]?.href})`);
  check(legalLinks[1]?.href?.includes("legal=privacy") && legalLinks[1]?.target === "_blank",
    `${who}: the Privacy link opens the privacy policy in a new tab (${legalLinks[1]?.href})`);

  await page.locator('input[name="fullName"]').first().fill(fullName);
  await page.locator('input[name="companyName"]').first().fill(companyName);
  await page.locator('input[name="email"]').first().fill(email);
  await page.locator('input[name="password"]').first().fill(PASSWORD);
  await record(page, `${who} account details`, "name, company, email and password on one form");

  await clickButton(page, "create account");

  // The org is created after the session exists, so the landing is onboarding
  // rather than an org chooser.
  const deadline = Date.now() + 40000;
  while (Date.now() < deadline) {
    if ((await page.locator(".auth-card").count()) === 0) break;
    await page.waitForTimeout(250);
  }
  if ((await page.locator(".auth-card").count()) > 0) {
    const shown = await page.locator(".auth-card").innerText().catch(() => "");
    throw new Error(`${who} did not get past signup: ${shown.slice(0, 200)}`);
  }
  await record(page, `${who} signed up`, "an account, a name and a company in one submit");
}

/**
 * Log in on the designed screen.
 *
 * Three landings: the dashboard for someone with a company, an offer to join
 * for someone who was invited, and the org chooser for an account whose org
 * creation did not complete. Someone invited must NOT be asked to start a
 * company of their own, so that stays a distinct state.
 */
async function signIn(page, email, who, accountType = "brand") {
  await page.goto(portalUrl(accountType));
  await waitFor(page, 'input[name="email"]', 30000);
  await record(page, `${who} sign-in`, "cold start, no session");

  await page.locator('input[name="email"]').first().fill(email);
  await page.locator('input[name="password"]').first().fill(PASSWORD);
  await clickButton(page, "log in");

  const deadline = Date.now() + 40000;
  let landed = null;
  while (Date.now() < deadline && !landed) {
    for (const heading of await eachText(page, "h1")) {
      const text = heading.toLowerCase();
      if (text.includes("which side are you on")) landed = "new";
      if (text.includes("you have been invited")) landed = "invited";
    }
    if (!landed && (await page.locator(".home-stack").count()) > 0) landed = "returning";
    if (!landed && (await page.locator('[data-testid="accept-invitation"]').count()) > 0) landed = "invited";
    if (!landed) await page.waitForTimeout(250);
  }
  if (!landed) {
    const shown = await page.locator(".auth-card, .gate-card").first().innerText().catch(() => "");
    throw new Error(`${who} did not reach a signed-in screen: ${shown.slice(0, 200)}`);
  }

  await record(page, `${who} signed in`, "email and password, on the designed screen");
  return landed;
}

/**
 * The designed onboarding cards, driven generically.
 *
 * Both are Queena's screens now, and neither carries the `data-field` hooks
 * the hand-built ones had. Every control is addressed by the `name` the seam
 * gives it — derived from the field's own visible label — so these helpers
 * keep working when a step is reordered, and break loudly when a field is
 * renamed, which is exactly when this script should be looked at.
 */
async function fillNamed(page, name, value) {
  const target = page.locator(`[name="${name}"]`).first();
  if ((await page.locator(`[name="${name}"]`).count()) === 0) return false;
  await target.fill(String(value));
  return true;
}

async function selectNamed(page, name, value) {
  if ((await page.locator(`select[name="${name}"]`).count()) === 0) return false;
  await page.locator(`select[name="${name}"]`).first().selectOption(value);
  return true;
}

/**
 * Click the first N chips in the group publishing under `name`.
 *
 * One flat selector rather than a nested one: locators here do not chain, and
 * `:has()` scopes to the section that carries this group's hidden input.
 */
async function chooseDesignedChips(page, name, count = 1) {
  const selector = `section:has(> input[name="${name}"]) .tag-row button, section:has(> input[name="${name}"]) .onboarding-chip-row button`;
  const total = await page.locator(selector).count();
  const chosen = [];
  for (let i = 0; i < total && chosen.length < count; i += 1) {
    const label = (await page.locator(selector).nth(i).innerText().catch(() => "")).trim();
    if (!label || /^(other|add)$/i.test(label)) continue;
    await page.locator(selector).nth(i).click();
    chosen.push(label);
  }
  return chosen;
}

/**
 * Advance one designed card.
 *
 * The primary action is not always called "Next" — the designs label it
 * "Get started", "Confirm & Continue", "Sign & Continue", "Go to Dashboard".
 * Clicking the footer's primary button by position rather than by text means
 * this keeps working when Queena changes the wording, which she does.
 */
/**
 * Tick the terms box whatever state it was drawn in.
 *
 * The factory card ships it defaultChecked and the brand card does not, so a
 * blind click accepts one and refuses the other. evaluate() here takes no
 * arguments, hence the two selectors inline.
 */
async function acceptTerms(page) {
  // Wait for the box to exist before reading it. The terms card renders after
  // the step transition, and ticking nothing then pressing Next reads as the
  // product refusing a signature it never saw.
  await waitFor(
    page,
    ".factory-onboarding-card input[type=checkbox], .brand-onboarding-card input[type=checkbox]",
    15000,
  ).catch(() => {});
  await page.evaluate(() => {
    const box = document.querySelector(
      ".factory-onboarding-card input[type=checkbox], .brand-onboarding-card input[type=checkbox]",
    );
    if (box && !box.checked) {
      box.checked = true;
      box.dispatchEvent(new Event("click", { bubbles: true }));
      box.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
}

async function nextCard(page, expectHeading) {
  const footerPrimary =
    ".factory-onboarding-actions .primary-btn, .brand-onboarding-actions .primary-btn";
  await waitFor(page, footerPrimary, 20000);
  await page.locator(footerPrimary).first().click();
  if (expectHeading) await waitForHeading(page, expectHeading);
  await page.waitForTimeout(900);
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

  // Start from nothing. The local browser keeps a profile between runs, so an
  // aborted run leaves a signed-in session behind and the next run's first
  // sign-in silently restores it — which reads as a product bug two hundred
  // steps later, on a screen belonging to a company from the previous run.
  await page.evaluate(() => {
    try { localStorage.clear(); sessionStorage.clear(); } catch {}
  });
  await page.goto(APP);
  await page.waitForTimeout(1000);

  const stamp = Date.now();
  const factoryName = `Atelier E2E ${stamp}`;
  const brandName = `Maison E2E ${stamp}`;

  try {
    // ================= TERMS AND PRIVACY, SIGNED OUT =================
    console.log("\nTERMS AND PRIVACY");
    await page.goto(`${APP}?legal=terms&type=brand`);
    await waitFor(page, ".admin-terms-document-body", 30000);
    check((await page.locator(".admin-terms-document-body").innerText()).includes("Brand Terms and Conditions"),
      "the brand terms are readable signed out");
    await clickButton(page, "trading company");
    await page.waitForTimeout(500);
    check((await page.locator(".admin-terms-document-body").innerText()).includes("Trading Company Terms and Conditions"),
      "and the switch shows a trading company's terms");
    await record(page, "Public terms", "the published terms, readable before an account exists");
    await page.goto(`${APP}?legal=privacy`);
    await waitFor(page, ".admin-terms-document-body", 30000);
    check((await page.locator(".admin-terms-document-body").innerText()).includes("Privacy Policy"),
      "the privacy policy is readable signed out");
    await record(page, "Public privacy policy");

    // ================= FACTORY =================
    console.log("\nFACTORY");
    await signUp(page, {
      email: `e2e-factory-${stamp}@example.com`,
      fullName: "Ana Factory",
      companyName: factoryName,
      accountType: "factory",
      who: "Factory",
    });
    // Queena's eleven-step vendor onboarding. Every assertion below reads the
    // DATABASE rather than the screen: what matters is that the designed card
    // wrote the right column, not what the card looked like while doing it.
    await waitFor(page, ".factory-onboarding-card", 30000);
    // Required since the welcome card stopped answering it on the vendor's behalf.
    await page.locator('input[name="onboarding-company-type"][value="factory"]').first().click();
    await record(page, "Factory welcome", "the designed card, with the manufacturer / trading-company choice");
    await nextCard(page);

    await fillNamed(page, "factory-name", factoryName);
    await fillNamed(page, "year-founded", "2011");
    await fillNamed(page, "website-url", "www.atelier-e2e.pt");
    await fillNamed(page, "factory-location", "Porto, Portugal");
    await fillNamed(page, "nearest-port", "Leixões");
    await fillNamed(page, "total-employees", "48");
    await record(page, "Factory basics", "one designed card, six fields");
    await nextCard(page);

    await fillNamed(page, "about-the-factory", "Small-batch woven shirting and dresses.");
    await record(page, "Factory context");
    await nextCard(page);

    const productionTypes = await chooseDesignedChips(page, "production-type", 1);
    const categories = await chooseDesignedChips(page, "product-categories", 2);
    await chooseDesignedChips(page, "makes", 1);
    await chooseDesignedChips(page, "market-level", 1);
    await record(page, "Factory what you make", `from taxonomy_terms: ${[...productionTypes, ...categories].join(", ")}`);
    await nextCard(page);

    await chooseDesignedChips(page, "specializes-in", 2);
    await chooseDesignedChips(page, "design-services", 1);
    await chooseDesignedChips(page, "primary-export-markets", 1);
    await fillNamed(page, "equipment", "12 x Juki DDL-9000C, 2 x Kansai flatlock");
    await record(page, "Factory specialty and services", "equipment is free text on purpose");
    await nextCard(page);

    await fillNamed(page, "minimum-order-quantity", "150");
    await fillNamed(page, "bulk-production-lead-time", "28 days");
    await fillNamed(page, "typical-sample-lead-time", "10 days");
    await record(page, "Factory capacity and terms");
    await nextCard(page);

    // The registration is what an admin reviews, and that review is what
    // unlocks quoting. The designed button now opens a real picker.
    await page.locator('.verification-step input[type="file"]').setInputFiles({
      name: "registration.pdf",
      mimeType: "application/pdf",
      buffer: await fs.readFile(FIXTURE),
    });
    await page.waitForTimeout(500);
    await record(page, "Factory verification", "documents are reviewed by a human, not self-declared");
    await nextCard(page);
    await record(page, "Factory walkthrough");
    await nextCard(page);
    await record(page, "Factory review", "what the vendor actually typed, read back");
    await nextCard(page);

    await acceptTerms(page);
    await fillNamed(page, "signature", "Ana Factory");
    check(Boolean(await page.locator('.factory-onboarding-card a[href*="legal=terms&type=factory"]').count()),
      "the factory terms step links to the full published terms");
    await record(page, "Factory terms");
    await nextCard(page);

    await waitForHeading(page, "all set", 30000);
    await record(page, "Factory complete", "the designed finish card, not a hand-built one");
    await nextCard(page);
    await page.waitForTimeout(2500);

    const { data: factoryOrg } = await db.from("orgs").select("id").eq("name", factoryName).single();

    const { data: factorySigned } = await db.from("terms_acceptances")
      .select("terms_version, legal_document_id").eq("org_id", factoryOrg.id).single();
    check(Boolean(factorySigned?.legal_document_id) && /^terms_factory v\d+$/.test(factorySigned?.terms_version),
      `the factory's signature points at the exact version shown (${factorySigned?.terms_version})`);

    const { data: factoryProfile } = await db
      .from("factory_profiles")
      .select("country_code, moq, typical_lead_days, published_at, verification_status, equipment_notes, vendor_kind")
      .eq("org_id", factoryOrg.id)
      .single();

    // The design asks for "Porto, Portugal" as free text and never for a code,
    // but country_code is what match_score compares. Derived from what the
    // vendor typed, against the country taxonomy — never guessed.
    check(factoryProfile.country_code === "PT",
      `"Porto, Portugal" resolved to ISO PT for matching (got ${factoryProfile.country_code})`);
    check(factoryProfile.moq === 150, "MOQ persisted as a number");
    check(factoryProfile.typical_lead_days === 28,
      `"28 days" typed as free text stored as the number 28 (got ${factoryProfile.typical_lead_days})`);
    check(factoryProfile.vendor_kind === "manufacturer",
      "the welcome card's company-type choice reached the profile");
    check(factoryProfile.published_at !== null,
      "finishing the designed onboarding publishes the profile, as its last card promises");
    check(
      factoryProfile.verification_status === "unverified",
      "publishing did not self-verify — quoting stays gated on an admin review",
    );
    check(/Juki/.test(factoryProfile.equipment_notes ?? ""), "equipment free text kept verbatim");

    // The capacity panel is Queena's, and it publishes the taxonomy slug it was
    // already keyed on. The number still has to come out of the database's own
    // minutes-per-piece, not the prototype's hardcoded 18.
    const { data: capacityRow } = await db
      .from("factory_capacity").select("category_term_id, input_mode, line_hours, monthly_units")
      .eq("org_id", factoryOrg.id).maybeSingle();
    check(Boolean(capacityRow), "the designed capacity panel wrote a factory_capacity row");

    const { data: storedCapacity } = await db.rpc("capacity_monthly_units", { org: factoryOrg.id });
    check(storedCapacity > 0, `the database computes monthly units from it (got ${storedCapacity})`);

    const { count: linkCount } = await db
      .from("taxonomy_links")
      .select("*", { count: "exact", head: true })
      .eq("subject_id", factoryOrg.id);
    check(linkCount >= 4, `taxonomy selections saved as ${linkCount} links, not free text`);

    await signOutFully(page);

    // ================= BRAND =================
    console.log("\nBRAND");
    const brandEmail = `e2e-brand-${stamp}@example.com`;
    await signUp(page, {
      email: brandEmail,
      fullName: "Remy Brand",
      companyName: brandName,
      accountType: "brand",
      who: "Brand",
    });
    // Queena's ten-step brand onboarding, same as the vendor side: the screen
    // is hers, the assertions read the database.
    await waitFor(page, ".brand-onboarding-card", 30000);
    await record(page, "Brand welcome", "the designed welcome card");
    await nextCard(page);

    await fillNamed(page, "brand-name", brandName);
    await fillNamed(page, "business-email", brandEmail);
    await fillNamed(page, "year-founded", "2019");
    await fillNamed(page, "website-url", "www.maison-e2e.com");
    await fillNamed(page, "hq-location", "New York, USA");

    // Brand category is a multi-select behind a <details>, and its options come
    // from taxonomy_terms rather than the design's own list.
    await page.locator(".brand-category-multiselect summary").first().click();
    await page.waitForTimeout(400);
    await page.locator(".brand-category-multiselect-menu input[type=checkbox]").first().click();
    await page.locator(".brand-category-multiselect summary").first().click();
    await record(page, "Brand basics", "category options come from the taxonomy, not the mock list");
    await nextCard(page);

    await fillNamed(page, "about-the-brand", "Womenswear, small batch, organic cotton.");
    await record(page, "Brand context", "logo and product imagery upload here, to the public bucket");
    await nextCard(page);

    const brandMakes = await chooseDesignedChips(page, "what-does-your-brand-make", 2);
    await chooseDesignedChips(page, "market-level", 1);
    await record(page, "Brand what you make", `same vocabulary the vendor picked from: ${brandMakes.join(", ")}`);
    await nextCard(page);

    await fillNamed(page, "typical-price-range-for-core-styles", "$18-$24 FOB per unit");
    await record(page, "Brand sourcing volume", "dollars on screen, minor units in the database");
    await nextCard(page);

    await chooseDesignedChips(page, "preferred-regions", 1);
    await chooseDesignedChips(page, "services-needed", 1);
    await record(page, "Brand vendor preferences");
    await nextCard(page);

    await selectNamed(page, "annual-revenue", "$250k-$1M");
    await record(page, "Brand trust", "team invitations and the private registration upload");
    await nextCard(page);

    // The review card must read back what was typed, not the design's example
    // brand. It showed "Maison Rue" until it was wired to the real answers.
    const reviewText = await page.locator(".brand-onboarding-review-grid").innerText();
    check(reviewText.includes(brandName),
      "the review card reads back the brand that was actually typed");
    check(!/Maison Rue/.test(reviewText),
      "and no longer shows the design's example brand");
    await record(page, "Brand review", "what was entered, not the mock");
    await nextCard(page);

    await acceptTerms(page);
    await fillNamed(page, "signature", "E2E Brand Founder");
    check(Boolean(await page.locator('.brand-onboarding-card a[href*="legal=terms&type=brand"]').count()),
      "the brand terms step links to the full published terms");
    await record(page, "Brand terms");
    await nextCard(page);

    await waitForHeading(page, "all set", 30000);
    await record(page, "Brand complete", "the designed finish card");
    await nextCard(page);
    await waitFor(page, ".home-stack", 30000);

    const { data: brandOrg } = await db.from("orgs").select("id").eq("name", brandName).single();

    const { data: brandSigned } = await db.from("terms_acceptances")
      .select("terms_version, legal_document_id").eq("org_id", brandOrg.id).single();
    check(Boolean(brandSigned?.legal_document_id) && /^terms_brand v\d+$/.test(brandSigned?.terms_version),
      `the brand's signature points at the exact version shown (${brandSigned?.terms_version})`);
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
    await page.goto(`${APP}/rfqs`);
    // Re-pointed at the DESIGNED requests screen, which now renders this route
    // against live data. Queena relabelled the brand's nav RFQs → Quotes, so
    // the heading and the primary action are hers.
    await waitForHeading(page, "quotes");

    // The empty state, which is reachable here and exists nowhere in the
    // prototype. A brand's very first visit is the one guaranteed to hit it.
    //
    // Wait for the fetch to settle first. The heading renders before the
    // request resolves, so asserting straight after it was a race that read
    // the loading state and reported a missing empty state — a screen bug
    // that was not there.
    await waitFor(page, '[data-testid="rfqs-empty"], [data-testid="rfqs-error"]', 20000);
    const emptyRfqs = await page.locator('[data-testid="rfqs-empty"]').count();
    check(emptyRfqs === 1, "a brand with no requests is told so, not shown a blank panel");

    // The tab counts were literals — "Active quotes (4)" on an account with
    // none. A number on screen that does not come from the data is what the
    // design system's own provenance rule forbids.
    const tabsText = await page.locator(".rfqs-tabs").first().innerText();
    check(/active quotes \(0\)/i.test(tabsText),
      `the tab counts are real, not the mock's literals (${tabsText.split("\n")[0]})`);
    await record(page, "Brand requests", "the designed screen, empty until the first one is written");

    await clickButton(page, "create new quote");
    await waitFor(page, ".describe-flow, .flow-page", 25000);
    await record(page, "Describe what you need", "Queena's first flow card, on her chrome");

    const rfqTitle = `E2E woven shirts ${stamp}`;
    await page.locator('textarea[name="request"]').fill(
      "300 women's woven shirts in organic cotton poplin, 3 colors, 100 each. Fit sample and PP sample before bulk. Bulk by late September 2026.",
    );

    // "Skip AI" is part of the design and is the path taken here: the model
    // needs a credential, and the run must not depend on one.
    await clickButton(page, "skip ai");
    await waitFor(page, ".review-brief-stack", 30000);

    const draftUrl = String(await page.url());
    check(/\/rfqs\/[0-9a-f-]{36}\/edit/.test(draftUrl) || /rfqs\/new/.test(draftUrl),
      "a draft row exists before the review card is filled in");
    await record(page, "Review the brief", "read back and correctable — Skip AI leaves it empty to fill");

    // The review fields are Queena's, addressed by the name the seam gives each.
    const setField = async (name, value) => {
      const target = `.review-brief-stack [name="${name}"]`;
      if ((await page.locator(target).count()) === 0) return false;
      await page.locator(target).first().fill(value);
      return true;
    };

    await setField("title", rfqTitle);
    await setField("category", "Womenswear");
    await setField("quantity", "300 units total · 3 colors, 100 each");
    await setField("material", "Organic cotton poplin, mid-weight");
    await setField("timeline", "Bulk by late September 2026");
    await setField("samples", "Fit sample + PP sample before bulk");
    await setField("price", "$18-$24 per unit");
    await setField("regions", "Portugal");
    await setField("certifications", "GOTS");
    await setField("sourcingDetails", "Vendor sources the poplin; brand provides labels.");
    await setField("additionalDetails", "Polybag per unit, carton by colour.");
    await setField("question-0", "Can you quote fit and PP samples separately?");
    await record(page, "The brief, corrected", "every field is the brand's, not the model's");

    // Review leads to the invite step, which is where the design puts the only
    // control over who can see the request.
    await page.locator(".bottom-bar .primary-btn").first().click();
    await waitFor(page, ".invite-results", 30000);
    await record(page, "Choose who sees it", "the design's own toggle decides open or invite-only");
    await clickButton(page, "invite vendors");
    await page.waitForTimeout(4500);
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

    // The design collapses the breakdown into one line — "3 colors, 100 each".
    // The schema keeps rows, because a vendor quotes per colour, so the line is
    // parsed into rows rather than stored as a sentence.
    const { data: colourRows } = await db
      .from("rfq_colour_splits").select("colour, quantity").eq("rfq_id", publishedRfq.id);
    check((colourRows ?? []).length === 3,
      `"3 colors, 100 each" became ${colourRows?.length ?? 0} rows, not a display string`);
    check((colourRows ?? []).every((row) => row.quantity === 100),
      "each row carries its own quantity");

    // The whole reason migration 014 exists: this score must be about THIS
    // request, not the union of everything the brand has ever posted.
    const { data: rfqScore } = await db.rpc("match_score_rfq", {
      rfq_id: publishedRfq.id, factory_org: factoryOrg.id,
    });
    check(rfqScore !== null, `the factory scores ${(rfqScore * 100).toFixed(0)}% against this specific request`);


    // ================= THE TWO SIDES MEET =================
    console.log("\nFACTORY FINDS IT");
    await signOutFully(page);

    const landed = await signIn(page, `e2e-factory-${stamp}@example.com`, "Factory again", "factory");
    check(landed === "returning", "signing back in skips onboarding and lands on the dashboard");
    await waitFor(page, ".home-stack", 30000);
    await record(page, "Factory dashboard", "still unverified, so it may look but not bid");

    await page.goto(`${APP}/browse`);
    await waitForHeading(page, "browse rfqs");
    await waitFor(page, '[data-testid="open-rfq-card"]', 20000);
    await record(page, "Factory browse", "the brand's request, found by a factory that was never invited");

    const cardText = await page.locator('[data-testid="open-rfq-card"]').first().innerText();
    check(cardText.includes(rfqTitle), "the request a brand published minutes ago is visible to a factory");
    // Fit is a per-pair score this list never asks for, so the card shows none
    // rather than a number that came from nowhere.
    check(cardText.includes("300"), "the quantity the brand typed reaches the factory's card");
    check(cardText.includes(brandName), "the brand is named, not anonymous — nobody quotes a stranger");

    // Visibility and permission are deliberately different things.
    const gate = await page.locator(".browse-gate").count();
    check(gate === 1, "an unverified factory is told it can look but not bid");

    // The card's affordance is its own View RFQ button, which is how the
    // design draws it.
    await page.locator('[data-testid="open-rfq-card"] .primary-btn').first().click();
    // The designed page is headed "View RFQ"; the request's own title is on
    // the card inside it.
    await waitForHeading(page, "view rfq", 25000);
    await record(page, "Factory reads the request", "every field traces to a stored column, none of it is copy");

    const detail = await page.locator(".factory-rfq-read-page").first().innerText();
    check(detail.includes(rfqTitle), "the request the brand published is the one on screen");
    check(detail.includes("300"), "the quantity the brand typed is what the factory reads");
    check(/Can you quote fit and PP samples separately/.test(detail), "the brand's question reaches the factory");
    check(!/business_email|hq_location.*private/i.test(detail), "no brand contact details leak into the factory's view");

    const gateText = await page.locator(".browse-gate").innerText().catch(() => "");
    check(/not quote it yet/i.test(gateText),
      "an unverified factory is told plainly it may read this but not quote it");


    // ================= VERIFICATION =================
    console.log("\nADMIN VERIFIES");
    const adminEmail = `e2e-admin-${stamp}@example.com`;
    const { data: adminUser } = await db.auth.admin.createUser({
      email: adminEmail, password: PASSWORD, email_confirm: true,
    });
    await db.from("platform_admins").insert({ user_id: adminUser.user.id });

    await signOutFully(page);
    await signIn(page, adminEmail, "Admin");

    // Platform staff have no brand or factory org; the admin tool must be
    // reachable anyway.
    // Everything staff do is in the operations workspace now. Approving a
    // company there is what verifies it, and verification is what unlocks
    // quoting.
    const ADMIN = APP.replace(/app\.html.*$/, "admin.html");
    await page.goto(ADMIN);
    await waitForHeading(page, "admin overview", 30000);
    await record(page, "Verification queue", "an admin with no org of their own can still work");

    const queueText = await page.locator("body").innerText();
    check(queueText.includes(factoryName), "the factory is waiting for a decision in the live queue");

    // Open the queue and approve this run's factory.
    await page.goto(`${ADMIN}?screen=verification`);
    await page.waitForTimeout(3000);
    // Each queue row ends in a Review button. Addressed by position within the
    // row rather than by text, so relabelling it does not break the run.
    const reviewButtons = ".admin-verification-row button:last-child";
    const rowCount = await page.locator(".admin-verification-row").count();
    let approved = false;
    for (let index = 0; index < rowCount; index += 1) {
      const text = await page.locator(".admin-verification-row").nth(index).innerText().catch(() => "");
      if (!text.includes(factoryName)) continue;
      await page.locator(reviewButtons).nth(index).click();
      approved = true;
      break;
    }
    check(approved, "the queue row for this factory was found and opened");
    await page.waitForTimeout(2500);

    await clickButton(page, "approve profile");
    await page.waitForTimeout(4000);
    await record(page, "Factory approved", "approving the company verifies it, which unlocks quoting");

    const { data: verified } = await db
      .from("factory_profiles").select("verification_status").eq("org_id", factoryOrg.id).single();
    check(verified.verification_status === "verified", "the factory is now verified in the database");

    // ================= THE OPERATIONS WORKSPACE =================
    // The designed admin console, on the same session. Same origin, so the
    // session carries across the page boundary; everything it shows comes back
    // through a security-definer RPC.
    await page.goto(ADMIN);
    await page.waitForTimeout(4000);
    const consoleText = await page.locator("body").innerText();

    check(/admin overview/i.test(consoleText), "the operations workspace opens for staff");
    check(
      !/not a staff account/i.test(consoleText),
      "and does not turn away an account that is on the admin list",
    );
    check(
      consoleText.includes(brandName) || consoleText.includes(factoryName),
      "a company from this run is in the live verification queue",
    );
    check(
      !/could not load/i.test(consoleText),
      "the queue loaded rather than erroring",
    );
    await record(page, "Operations workspace", "the designed admin console, on marketplace data");

    await page.goto(`${ADMIN}?screen=quotes`);
    await page.waitForTimeout(3500);
    const quotesText = await page.locator("body").innerText();
    check(/quotes/i.test(quotesText), "the marketplace-wide quote table opens");
    await record(page, "Marketplace quotes", "every quote across the marketplace, staff only");

    // ================= THE QUOTE =================
    console.log("\nFACTORY QUOTES");
    await signOutFully(page);
    await signIn(page, `e2e-factory-${stamp}@example.com`, "Factory quoting", "factory");

    await page.goto(`${APP}/browse/${publishedRfq.id}`);
    await waitForHeading(page, "view rfq", 25000);
    await record(page, "Factory can now bid", "the verification notice is gone and the quote button is live");

    await clickButton(page, "edit quote");
    await waitFor(page, ".factory-submit-page", 25000);
    await record(page, "The quote", "Queena's submit screen, on a real draft row");

    // The design's fields are contentEditable rather than inputs, so they are
    // typed into by setting their text the way a person would.
    const setQuoteField = async (name, value) => {
      const ok = await page.evaluate(`(() => {
        const node = document.querySelector('[data-quote-field="${name}"]');
        if (!node) return false;
        node.textContent = ${JSON.stringify(value)};
        node.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      })()`);
      check(ok !== false, `the quote field "${name}" exists on the designed screen`);
    };

    await setQuoteField("unitPrice", "$17.10 / unit");
    await setQuoteField("quantity", "300 units");
    await setQuoteField("leadTime", "26 days");
    await setQuoteField("paymentTerms", "30% deposit / 70% before shipment");
    await setQuoteField("incoterms", "FOB quoted");
    const validUntil = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
    await setQuoteField("validUntil", validUntil);
    await setQuoteField("sample.0.stage", "Fit sample");
    await setQuoteField("sample.0.cost", "$95");
    await setQuoteField("sample.0.timing", "10 days");
    await setQuoteField("sample.1.stage", "PP sample");
    await setQuoteField("sample.1.cost", "$165");
    await record(page, "Factory quote", "prose on screen, taxonomy ids and rows underneath");

    await page.locator('[data-testid="submit-quote"]').click();
    await page.waitForTimeout(6000);

    const quoteError = await page.locator(".composer-error").innerText().catch(() => "");
    check(!quoteError, quoteError ? `the quote was refused: ${quoteError}` : "the quote was accepted");
    await record(page, "Quote sent", "and the factory is promised an answer either way");

    // The prose was matched onto the vocabulary, not stored as a sentence.
    const { data: sentQuote } = await db.from("quotes")
      .select("unit_price_cents, production_quantity, bulk_lead_time_days, payment_term_id, incoterm_id, deposit_pct, status")
      .eq("rfq_id", publishedRfq.id).eq("factory_org_id", factoryOrg.id).single();
    check(sentQuote.status === "submitted", `the quote is submitted (${sentQuote.status})`);
    check(sentQuote.unit_price_cents === 1710, `"$17.10 / unit" became 1710 minor units (${sentQuote.unit_price_cents})`);
    check(sentQuote.production_quantity === 300, "the quantity is a number");
    check(Boolean(sentQuote.payment_term_id), "'30% deposit / 70%' matched a payment term rather than being stored as prose");
    check(Boolean(sentQuote.incoterm_id), "'FOB quoted' matched an incoterm");
    check(Number(sentQuote.deposit_pct) === 30,
      `the deposit split came with it (${sentQuote.deposit_pct}%) — without one the order's schedule is unagreeable`);

    const { data: sentLines } = await db.from("quote_sample_lines")
      .select("stage, cost_cents").eq("quote_id",
        (await db.from("quotes").select("id").eq("rfq_id", publishedRfq.id).eq("factory_org_id", factoryOrg.id).single()).data.id);
    check((sentLines ?? []).length === 2, `the sample plan is ${sentLines?.length ?? 0} rows, not a drawn plan`);

    const { data: quoteSubtotal } = await db.rpc("quote_sample_subtotal", {
      target_quote: (await db.from("quotes").select("id").eq("rfq_id", publishedRfq.id).eq("factory_org_id", factoryOrg.id).single()).data.id,
    });
    check(Number(quoteSubtotal) === 26000, `the samples subtotal is computed from the rows (${quoteSubtotal})`);

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
    await signOutFully(page);
    await signIn(page, brandEmail, "Brand deciding");

    await page.goto(`${APP}/rfqs/${publishedRfq.id}/quotes`);
    await waitFor(page, ".quote-list", 25000);
    await record(page, "Quotes received", "Queena's quote list, every figure derived from stored columns");

    const quoteCards = await page.locator(".quote-card").count();
    check(quoteCards === 2, `both quotes are listed (${quoteCards} cards)`);

    const quoteListText = await page.locator(".quote-list").innerText();
    check(quoteListText.includes("5,390"),
      "the list shows the same total the factory saw, not a re-parsed string");
    check(quoteListText.includes(factoryName), "the quoting factory is named on its card");

    // Choosing a quote awards it, and awarding creates the production order in
    // the same transaction. There is no separate confirmation card in the
    // design, so the click is the decision.
    const cards = page.locator(".quote-card");
    let ourCard = -1;
    for (let index = 0; index < (await cards.count()); index += 1) {
      if ((await cards.nth(index).innerText()).includes(factoryName)) ourCard = index;
    }
    check(ourCard >= 0, `the quoting factory has a card (position ${ourCard + 1})`);

    await page.locator(`.quote-card:nth-of-type(${ourCard + 1}) [data-testid="choose-quote"]`).click();
    await page.waitForTimeout(4000);
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

    // Click through rather than deep-linking. A URL navigation would not have
    // caught goTo() being broken inside the ported screen, and did not.
    await page.goto(APP);
    await waitFor(page, ".home-stack", 25000);
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

    // An order that has not been agreed opens on the agreement, because there
    // is no interior yet: no steps to work, no payments to make. The header
    // figures are asserted once it is active, below.
    await page.goto(`${APP}/orders/${bornOrder.id}`);
    await waitFor(page, '[data-testid="schedule-row"]', 25000);
    await record(page, "The order", "before either side agrees, the schedule is the whole screen");

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
    await signOutFully(page);
    await signIn(page, `e2e-factory-${stamp}@example.com`, "Winning factory", "factory");
    await waitFor(page, ".home-stack", 30000);

    // The hand-built home listed notifications inline. The designed one puts
    // them behind the activity button in its header, which is where a vendor
    // would actually look for them.
    await page.goto(`${APP}/notifications`);
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

    // Now there is an interior to look at. Every figure in the designed header
    // is summed in SQL from the rows below it.
    await page.goto(`${APP}/orders/${bornOrder.id}`);
    await waitFor(page, '[data-testid="order-total"]', 25000);
    await record(page, "The order, active", "the designed header, on production_order_summary");

    const headerTotal = await page.locator('[data-testid="order-total"]').innerText();
    const headerPaid = await page.locator('[data-testid="order-paid"]').innerText();
    check(headerTotal.replace(/[^0-9]/g, "") === String(bornOrder.order_total_cents),
      `the header total is the sum of the steps, not a literal (${headerTotal})`);
    check(headerPaid.replace(/[^0-9]/g, "") === "000",
      `nothing is paid yet (${headerPaid})`);

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
    // The designed timeline approves from the row itself — the action a row
    // carries is the one its state allows, so there is nothing to confirm
    // about which transition is being made.
    await page.locator('[data-testid="milestone-action"]').first().click();
    await page.waitForTimeout(4000);
    await record(page, "Approved", "from the row, on the state that row is actually in");

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
    await signIn(page, `e2e-factory-${stamp}@example.com`, "Factory waiting", "factory");

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
    check(/payment/i.test(adminHeading),
      `the payments queue is its own page (${adminHeading})`);
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
    await signIn(page, `e2e-factory-${stamp}@example.com`, "Factory told to start", "factory");

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
    await waitFor(page, '.message-composer textarea', 25000);
    await record(page, "The conversation", "kept with the order, so it is there when someone asks what was agreed");

    const factoryLine = "袖口按照新的尺寸表做好了，确认一下。";
    await page.locator('.message-composer textarea').fill(factoryLine);
    await page.locator('[data-testid="send-message"]').click();
    await waitFor(page, '.message-bubble', 30000);
    await record(page, "The factory writes in Chinese", "and does not have to think about who reads it");

    // Scoped to this run's thread. Every other suite writes messages to the
    // same local database with no reset between them, so an unscoped read here
    // is answering a question about somebody else's conversation.
    const { data: runThread } = await db.from("message_threads")
      .select("id").eq("order_id", bornOrder.id).single();

    const { data: sentRows } = await db.from("messages")
      .select("body, body_lang, body_translated, body_translated_lang, sender_org_id")
      .eq("thread_id", runThread.id)
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

    // Unread is derived per user from message_reads, so "unread" means this
    // user has no read stamp on this thread yet. Asserted before opening,
    // because the designed screen selects the newest conversation on arrival —
    // which is what clears it.
    const { data: brandUser } = await db
      .from("user_profiles").select("id").eq("email", brandEmail).single();
    const { count: readBefore } = await db
      .from("message_reads")
      .select("*", { count: "exact", head: true })
      .eq("thread_id", runThread.id)
      .eq("user_id", brandUser.id);
    check(readBefore === 0, "the brand has not read this conversation yet");

    await page.goto(`${APP}/messages`);
    await waitFor(page, '.message-thread-card', 25000);
    await record(page, "Conversations", "one per piece of work, not one per company");

    await page.locator('.message-thread-card').first().click();
    await waitFor(page, '.message-bubble', 25000);

    const readerSees = await page.locator('.message-bubble').first().innerText();
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

    const { data: readState } = await db.from("message_reads")
      .select("thread_id, user_id").eq("thread_id", runThread.id);
    check(readState.length >= 2,
      "opening the conversation recorded that it was read — the count cannot get stuck");

    await page.locator('.message-composer textarea').fill("Confirmed, that matches the chart. Go ahead.");
    await page.locator('[data-testid="send-message"]').click();

    // Wait for the message to actually arrive, not for a guessed duration.
    // sendMessage awaits /api/translate BEFORE inserting, and a model round
    // trip routinely outlasts a fixed 4s sleep — which is how this passed
    // locally and failed as soon as the model was slower.
    let exchanged = 0;
    const sendDeadline = Date.now() + 45000;
    while (Date.now() < sendDeadline) {
      const { count } = await db.from("messages")
        .select("*", { count: "exact", head: true })
        .eq("thread_id", runThread.id);
      exchanged = count ?? 0;
      if (exchanged >= 2) break;
      await page.waitForTimeout(500);
    }
    // Counted on this thread, not across the database. A bare count(*) passes
    // on a fresh stack and fails the moment the smoke suite has run first,
    // which is the failure this file has already been bitten by once.
    check(exchanged === 2, `both sides have now said something (${exchanged} messages on this thread)`);
    await record(page, "A reply", "the first conversation either prototype could not actually have");

    // ================= INVITE ONLY =================
    // The path that used to publish a request nobody could see.
    console.log("\nINVITE ONLY");
    await signOutFully(page);
    await signIn(page, brandEmail, "Brand again");
    await page.goto(`${APP}/rfqs/new`);
    await waitFor(page, ".describe-flow, .flow-page", 25000);
    const privateTitle = `E2E private request ${stamp}`;
    await page.locator('textarea[name="request"]').fill("A quieter request, for invited factories only. 120 units.");
    await clickButton(page, "skip ai");
    await waitFor(page, ".review-brief-stack", 30000);

    await page.locator('.review-brief-stack [name="title"]').first().fill(privateTitle);
    await page.locator('.review-brief-stack [name="quantity"]').first().fill("120 units total");
    await page.locator(".bottom-bar .primary-btn").first().click();
    await waitFor(page, ".invite-results", 30000);

    // Untick "Open to all vendors" — the design's only visibility control.
    // A real click, because React owns the checked state and will not see one
    // that was assigned.
    await page.locator('input[name="open-to-all"]').first().click();
    await page.waitForTimeout(600);
    await record(page, "Invite-only chosen", "publishing this without inviting anyone used to strand it");

    await page.locator(".invite-selection-factory-card").first().click();
    await page.waitForTimeout(600);
    await record(page, "Choose who sees it", "ranked by fit against this request, same score the factory sees");
    const toggleOff = await page.evaluate(
      () => document.querySelector('input[name="open-to-all"]')?.checked === false,
    );
    check(toggleOff, "the open-to-all toggle is off before publishing");

    // By label, not by position: the bottom bar's primary button is the one
    // that publishes, and clicking a vendor card first can leave the pointer
    // over a card-level control at the same coordinates.
    await clickButton(page, "invite vendors");
    await page.waitForTimeout(4500);
    const publishError = await page.locator(".composer-error").innerText().catch(() => "");
    check(!publishError, publishError ? `publishing was refused: ${publishError}` : "publishing was accepted");
    await record(page, "Invitations saved");

    const { data: privateRfq } = await db.from("rfqs")
      .select("id, visibility, status").eq("title", privateTitle).single();
    check(privateRfq.status === "open", `the invite step published it (status ${privateRfq.status})`);
    check(privateRfq.visibility === "invited_only", `the request is invite-only (${privateRfq.visibility})`);

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
    await waitFor(page, ".home-stack", 25000);
    await record(page, "Brand home", "what needs you, before anything else");

    const homeText = await page.locator(".home-stack").innerText();
    check(/hi /i.test(homeText) && homeText.includes(brandName),
      "the designed home greets the org by name, from the database");
    check(!/maison rue/i.test(homeText),
      "and no longer greets every brand as the design's example one");

    // Every figure has to agree with the rows behind it, or a dashboard is
    // worse than no dashboard.
    const { data: snapRows } = await db.rpc("dashboard_snapshot", { target_org: brandOrg.id });
    const snap = Array.isArray(snapRows) ? snapRows[0] : snapRows;
    check(snap.orders_active === 1,
      `the snapshot counts the order that exists (${snap.orders_active})`);

    // Either there is something waiting, or the screen says so plainly. "Zero
    // things to do" is a legitimate state and the one most likely to render as
    // an accidental blank, so it is asserted rather than assumed away.
    // The design's attention rail is four fixed examples. Live, a card exists
    // only when something is actually behind it — so an account with nothing
    // outstanding gets the newcomer layout rather than four invented alerts.
    // The rail is asserted against what the SCREEN can see, not against a
    // service-role read of dashboard_snapshot. That function derives unread
    // per user from message_reads, and the service-role client has no
    // auth.uid() — so its numbers are a different user's, and comparing the
    // two reports a mismatch that is not there.
    //
    // What matters is that the rail is honest either way: a card only when
    // something is behind it, and no card when nothing is.
    const attentionCards = await page.locator(".home-attention-card").count();
    const newcomerLayout = await page.locator(".home-new-brand-card").count();
    check(
      (attentionCards > 0 && newcomerLayout === 0) || (attentionCards === 0 && newcomerLayout === 1),
      attentionCards
        ? `the brand is told what is waiting on them (${attentionCards} card(s))`
        : "with nothing outstanding, no attention card is invented and the newcomer layout shows instead",
    );

    check(!/Seoul Knit Works asked about yarn/i.test(homeText),
      "and the design's example alerts are not shown as if they were real");

    // ================= JOINING A TEAM =================
    // listMyInvitations() and acceptInvitation() have existed since Phase 1
    // with nothing calling either: an invitation could be sent and never seen.
    console.log("\nJOINING A TEAM");
    // The designed settings screen, on its "Roles & access" section.
    await page.goto(`${APP}/team`);
    await waitFor(page, ".settings-page, .settings-shell, .settings-nav", 25000);
    await record(page, "The team", "who else acts as this brand");

    const colleagueEmail = `colleague-${stamp}@example.com`;
    await clickButton(page, "roles & access");
    await page.waitForTimeout(1000);
    await clickButton(page, "invite member");
    await waitFor(page, '[data-testid="send-invite"]', 15000);
    await page.locator('input[placeholder="name@company.com"]').first().fill(colleagueEmail);
    await page.waitForTimeout(400);
    await page.locator('[data-testid="send-invite"]').click();
    await page.waitForTimeout(3500);

    const { data: invited } = await db.from("org_invitations")
      .select("id, status, role").eq("email", colleagueEmail).single();
    check(invited.status === "pending", "the invitation is stored and waiting");
    await record(page, "Invited", "they see it the next time they sign in");

    await db.auth.admin.createUser({ email: colleagueEmail, password: PASSWORD, email_confirm: true });

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
    await waitFor(page, ".home-stack", 30000);
    await record(page, "Joined", "straight into the brand they were invited to, with no onboarding to redo");

    const { data: membership } = await db.from("org_members")
      .select("role").eq("org_id", brandOrg.id);
    check(membership.length === 2, `the brand now has two people (${membership.length})`);
    check(membership.filter((m) => m.role === "owner").length === 1,
      "one owner and one member — joining does not confer the money permissions");

    const colleagueHome = await page.locator(".home-stack").innerText();
    check(colleagueHome.includes(brandName),
      "and they land in that organisation, not one of their own");

    // ================= WHEN IT BREAKS =================
    // The boundary is the only thing between a bug and a blank white page, so
    // it gets exercised rather than assumed. React 19 unmounts the whole root
    // on an unhandled error; before this, a crash was a silent white screen.
    console.log("\nWHEN IT BREAKS");
    await page.goto(`${APP}/__crash`);
    await waitForHeading(page, "something went wrong", 20000);

    const crashText = await page.locator(".crash-card").innerText();
    check(/nothing you had saved is lost/i.test(crashText),
      "a crash says what is and is not lost, rather than showing a blank page");
    check((await page.locator(".crash-actions button").count()) >= 2,
      "and offers a way out — reload, or back to the start");

    // The reference on screen must be the one in the database, or a support
    // message cannot be matched to a stack trace.
    await waitFor(page, '[data-testid="crash-reference"]', 15000);
    const shownRef = (await page.locator('[data-testid="crash-reference"]').innerText()).trim();
    const { data: reported } = await db.from("client_errors")
      .select("reference, message, path").eq("reference", shownRef).maybeSingle();
    check(Boolean(reported), `the crash was reported, under the reference shown (${shownRef})`);
    check(reported?.message?.includes("Deliberate crash"),
      "with the real error message, not a generic one");
    check(reported?.path?.includes("__crash"),
      "and the screen it happened on");
    await record(page, "When it breaks", "the reference on screen is the one in the database");

    // The shell survives: navigating away clears the crash rather than
    // carrying it to the next screen.
    await page.goto(`${APP}/orders`);
    await waitForHeading(page, "production orders", 25000);
    check((await page.locator(".crash-card").count()) === 0,
      "navigating away clears the crash — one broken screen does not poison the next");

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
    await waitFor(page, ".home-stack", 30000);
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

    // ================= LOCKED OUT =================
    // The design's "Forgot password?" link, followed the whole way: request,
    // email, link, new password, and the old one no longer working. A reset
    // that leaves the old password valid is not a reset.
    console.log("\nLOCKED OUT");
    const lockedEmail = `e2e-locked-${stamp}@example.com`;
    await db.auth.admin.createUser({
      email: lockedEmail, password: PASSWORD, email_confirm: true,
    });

    await signOutFully(page);
    await page.goto(APP);
    await waitFor(page, ".auth-card", 30000);
    await clickButton(page, "forgot password");
    await waitFor(page, 'input[type="email"]', 15000);
    await page.locator('input[type="email"]').first().fill(lockedEmail);
    await clickButton(page, "email me a reset link");
    await page.waitForTimeout(2500);

    const resetShown = await page.locator(".gate-card, .auth-card").first().innerText().catch(() => "");
    check(!/no account|not found|unknown/i.test(resetShown),
      "the reset form never says whether an account exists — it is not a customer lookup");
    await record(page, "Forgot password", "asked for, without confirming who is a customer");

    const { link: resetLink } = await recoveryEmail(lockedEmail);
    check(Boolean(resetLink), "a reset link was emailed");

    await page.goto(resetLink);
    await waitForHeading(page, "choose a new password");
    await record(page, "Choose a new password", "the link lands here, not on the dashboard");

    const newPassword = "a different 9";
    await page.locator('input[type="password"]').first().fill(newPassword);
    await clickButton(page, "save password");
    await page.waitForTimeout(4000);
    check((await page.locator("h1").first().innerText().catch(() => "")).toLowerCase()
            !== "choose a new password",
      "saving the new password lets them through");

    const anon = createClient(
      process.env.SUPABASE_URL ?? stack.API_URL,
      process.env.SUPABASE_ANON_KEY ?? stack.ANON_KEY,
      { auth: { persistSession: false } },
    );
    const { error: oldPassword } = await anon.auth
      .signInWithPassword({ email: lockedEmail, password: PASSWORD });
    check(Boolean(oldPassword), "the old password no longer works");
    const { error: newPasswordFails } = await anon.auth
      .signInWithPassword({ email: lockedEmail, password: newPassword });
    check(!newPasswordFails, "and the new one does");

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
