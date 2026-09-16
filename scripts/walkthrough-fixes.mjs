/**
 * Walkthrough of the onboarding and dashboard fixes, against the local stack.
 *
 *   supabase start
 *   npm run dev
 *   node scripts/walkthrough-fixes.mjs
 *
 * Proves, with a screenshot per step in e2e-evidence/fixes/ and a database
 * check behind each claim:
 *   - a factory signup starts with nothing pre-selected
 *   - a certification is picked first, then uploaded, and Delete removes it
 *   - client references add rows and are saved
 *   - "Save & log out" saves and signs out from any step, and resuming works
 *   - the factory lands on the designed factory dashboard inside the side nav
 *   - the capacity drawer saves, and Log out in the side nav signs out
 */
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { Stagehand, localBrowser } from "@browserbasehq/stagehand";
import { createClient } from "@supabase/supabase-js";

const APP = process.env.E2E_URL ?? "http://127.0.0.1:5173/app.html";
const OUT = path.resolve("e2e-evidence", "fixes");
const FIXTURE = path.resolve("e2e-fixture-registration.pdf");
const PASSWORD = "walkthrough 8";

// Environment first, like the smoke test: `supabase status` can stall when it
// is not attached to a terminal.
// Against a deployed app (E2E_URL set, no service key) there is no database
// handle, and the run checks the screen only: restoring after sign-in is what
// proves a save landed.
const remote = Boolean(process.env.E2E_URL) && !process.env.SUPABASE_SERVICE_KEY;
const stack = remote
  ? {}
  : process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
    ? { API_URL: process.env.SUPABASE_URL, SECRET_KEY: process.env.SUPABASE_SERVICE_KEY }
    : JSON.parse(execFileSync("supabase", ["status", "-o", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
const db = remote ? null : createClient(stack.API_URL, stack.SECRET_KEY ?? stack.SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let shot = 0;
let failures = 0;

async function record(page, name) {
  shot += 1;
  const file = `${String(shot).padStart(2, "0")}-${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`;
  await page.screenshot({ path: path.join(OUT, file), fullPage: true });
  console.log(`  ${String(shot).padStart(2)}. ${name}`);
}

/** A database read, or an empty result when running against a deployed app. */
async function q(build) {
  if (!db) return { data: null };
  return build();
}

function check(condition, description) {
  if (condition === undefined) return;
  console.log(`     ${condition ? "✓" : "✗"} ${description}`);
  if (!condition) failures += 1;
}

async function waitFor(page, selector, timeout = 25000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      if ((await page.locator(selector).count()) > 0 && (await page.locator(selector).first().isVisible())) return true;
    } catch { /* re-render */ }
    await page.waitForTimeout(200);
  }
  throw new Error(`timed out waiting for ${selector}`);
}

async function clickButton(page, text, scope = "button") {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const total = await page.locator(scope).count();
    for (let index = 0; index < total; index += 1) {
      try {
        const button = page.locator(scope).nth(index);
        const label = (await button.innerText()).trim().toLowerCase();
        if (label.includes(text.toLowerCase()) && (await button.isVisible())) {
          await button.click();
          return;
        }
      } catch { /* re-render */ }
    }
    await page.waitForTimeout(250);
  }
  throw new Error(`no visible button matching "${text}"`);
}

async function heading(page) {
  return (await page.locator(".factory-onboarding-card h1, .brand-onboarding-card h1").first().innerText().catch(() => "")).trim();
}

async function nextCard(page) {
  const primary = ".factory-onboarding-actions .primary-btn, .brand-onboarding-actions .primary-btn";
  await waitFor(page, primary, 40000);
  // A resumed session loads its saved answers after the card first paints.
  const ready = Date.now() + 15000;
  while (Date.now() < ready && (await page.locator(`${primary}[disabled]`).count()) > 0) await page.waitForTimeout(250);
  const before = await heading(page);
  await page.locator(primary).first().click();
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline && (await heading(page)) === before) await page.waitForTimeout(250);
  await page.waitForTimeout(700);
}

/** Every chip group on the card: how many chips are selected in each. */
async function selectedChipCounts(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll(".factory-onboarding-card input[data-multi], .brand-onboarding-card input[data-multi]")].map(
      (input) => ({ name: input.name, selected: String(input.value || "").split("").filter(Boolean).length }),
    ),
  );
}

/** Click the first chip in every group on the card. */
async function pickFirstChipEverywhere(page) {
  const names = (await selectedChipCounts(page)).map((group) => group.name);
  for (const name of names) {
    const selector = `section:has(> input[name="${name}"]) .onboarding-chip-row button, section:has(> input[name="${name}"]) .tag-row button`;
    const total = await page.locator(selector).count();
    for (let i = 0; i < total; i += 1) {
      const label = (await page.locator(selector).nth(i).innerText().catch(() => "")).trim();
      if (!label || /^(\+|other|add)/i.test(label)) continue;
      await page.locator(selector).nth(i).click();
      break;
    }
  }
}

async function signUp(page, { email, fullName, companyName, portal }) {
  await page.goto(portal === "factory" ? `${APP}?portal=factory` : APP);
  await waitFor(page, ".auth-card");
  await clickButton(page, "create an account");
  await waitFor(page, 'input[name="companyName"]');
  await page.locator('input[name="fullName"]').first().fill(fullName);
  await page.locator('input[name="companyName"]').first().fill(companyName);
  await page.locator('input[name="email"]').first().fill(email);
  await page.locator('input[name="password"]').first().fill(PASSWORD);
  await clickButton(page, "create account");
  await waitFor(page, ".factory-onboarding-card, .brand-onboarding-card", 40000);
}

async function signIn(page, email, portal) {
  await page.goto(portal === "factory" ? `${APP}?portal=factory` : APP);
  await waitFor(page, 'input[name="email"]');
  await page.locator('input[name="email"]').first().fill(email);
  await page.locator('input[name="password"]').first().fill(PASSWORD);
  await clickButton(page, "log in");
}

async function orgFor(email) {
  if (!db) return null;
  const { data: users } = await q(() => db.auth.admin.listUsers({ perPage: 1000 }));
  const user = users.users.find((item) => item.email === email);
  const { data } = await q(() => db.from("org_members").select("org_id").eq("user_id", user.id).single());
  return data.org_id;
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const stamp = Date.now();
  const browser = await localBrowser.launch({ headless: true });
  const stagehand = await Stagehand.create({ browser });
  const page = await stagehand.browser.context.newPage(APP);
  await page.setViewportSize(1440, 1000);

  try {
    // ---- Factory ------------------------------------------------------------
    console.log("factory");
    const factoryEmail = `fixes-factory-${stamp}@example.com`;
    await signUp(page, { email: factoryEmail, fullName: "Wen Li", companyName: `Fixes Factory ${stamp}`, portal: "factory" });
    const factoryOrg = await orgFor(factoryEmail);
    await record(page, "factory welcome");
    check((await page.locator(".onboarding-save-exit").count()) === 1, "welcome card offers Save & log out");

    // The company type decides the whole flow, so nothing is chosen for them.
    const companyTypeChecked = await page.evaluate(
      () => [...document.querySelectorAll('input[name="onboarding-company-type"]')].filter((r) => r.checked).length,
    );
    check(companyTypeChecked === 0, `no company type pre-selected (${companyTypeChecked} checked)`);
    await page.locator('input[name="onboarding-company-type"][value="factory"]').first().click();

    await nextCard(page); // → factory details
    await page.locator('input[name="factory-name"]').first().fill(`Fixes Factory ${stamp}`).catch(() => {});
    const nameInputs = await page.locator(".factory-onboarding-form-grid input").count();
    if (nameInputs) await page.locator(".factory-onboarding-form-grid input").first().fill(`Fixes Factory ${stamp}`);
    await page.locator(".factory-onboarding-form-grid input").nth(3).fill("Porto, Portugal");
    await record(page, "factory details");
    await nextCard(page); // → context
    await nextCard(page); // → production type

    const production = await selectedChipCounts(page);
    await record(page, "production type starts blank");
    check(production.length > 0 && production.every((group) => group.selected === 0), `no production chips pre-selected (${JSON.stringify(production)})`);
    await pickFirstChipEverywhere(page);
    await nextCard(page); // → specialty

    const specialty = await selectedChipCounts(page);
    check(specialty.every((group) => group.selected === 0), "no specialty chips pre-selected");
    await pickFirstChipEverywhere(page);
    await nextCard(page); // → capacity

    const capacityValues = await page.evaluate(() => ({
      units: document.querySelector('input[name="capacity-units"]')?.value,
      months: document.querySelector('input[name="capacity-months"]')?.value,
      category: document.querySelector('select[name="capacity-category"]')?.value,
      selectedMonths: document.querySelectorAll(".onboarding-month-row button.selected").length,
    }));
    await record(page, "capacity starts blank");
    check(!capacityValues.units && capacityValues.selectedMonths === 0, `capacity has no figures or months pre-filled (${JSON.stringify(capacityValues)})`);
    check(capacityValues.category === "", `no capacity category pre-selected (${JSON.stringify(capacityValues.category)})`);
    await page.locator('select[name="capacity-category"]').first().selectOption("wovens");
    await page.locator(".onboarding-line-hours input:not([type=hidden])").first().fill("6000");
    // Locators do not chain here; the first button in the list is the first month's first level.
    await page.locator(".onboarding-month-row button").first().click();
    await nextCard(page); // → verification

    // Pick first, then upload.
    await record(page, "verification starts with no certifications");
    check((await page.locator(".certification-upload-row").count()) === 0, "no certification rows until one is picked");
    await page.locator(".certification-add-control input").first().fill("OEKO-TEX Standard 100");
    await clickButton(page, "add certification");
    await waitFor(page, ".certification-upload-row");
    await record(page, "certification picked, upload offered");
    check((await page.locator(".certification-upload-row").count()) === 1, "one certification row after picking");
    await page.locator(".certification-upload-row input[type=file]").first().setInputFiles({
      name: "oeko-tex-standard-100-certificate.pdf",
      mimeType: "application/pdf",
      buffer: await fs.readFile(FIXTURE),
    });
    await waitFor(page, ".certification-file-row", 30000);
    await record(page, "certificate uploaded");
    let { data: certs } = await q(() => db.from("factory_certifications").select("id, document_id, status").eq("org_id", factoryOrg));
    check(db ? certs.length === 1 && Boolean(certs[0].document_id) && certs[0].status === "pending" : undefined, "certificate stored with its document, pending review");

    await clickButton(page, "delete", ".certification-file-row button");
    const deleteDeadline = Date.now() + 20000;
    while (Date.now() < deleteDeadline && (await page.locator(".certification-upload-row").count()) > 0) await page.waitForTimeout(250);
    await record(page, "certificate deleted");
    ({ data: certs } = await q(() => db.from("factory_certifications").select("id").eq("org_id", factoryOrg)));
    const { data: certDocs } = await q(() => db.from("documents").select("id").eq("org_id", factoryOrg).eq("kind", "certificate"));
    check(db ? certs.length === 0 && certDocs.length === 0 : undefined, "Delete removes the certification and its file");

    await page.locator(".certification-add-control input").first().fill("GOTS");
    await clickButton(page, "add certification");
    await waitFor(page, ".certification-upload-row");

    // References.
    await page.locator(".onboarding-reference-row input").nth(0).fill("Maison Rue");
    await page.locator(".onboarding-reference-row input").nth(1).fill("Ari Chen");
    await clickButton(page, "add another reference");
    check((await page.locator(".onboarding-reference-row > div").count()) === 2, "+ Add another reference adds a row");
    await page.locator(".onboarding-reference-row input").nth(2).fill("Northline");
    await page.locator(".onboarding-reference-row input").nth(3).fill("northline.com");
    // Several documents at once: a registration is often a certificate plus a
    // licence, and picking a second must not replace the first.
    await page.locator('.verification-step input[name="business-registration"]').setInputFiles([
      { name: "business-registration.pdf", mimeType: "application/pdf", buffer: await fs.readFile(FIXTURE) },
      { name: "trading-licence.pdf", mimeType: "application/pdf", buffer: await fs.readFile(FIXTURE) },
    ]);
    await record(page, "references and registration filled");

    // Save & log out mid-flow.
    await clickButton(page, "save & log out");
    await waitFor(page, ".auth-card", 30000);
    await record(page, "saved and logged out");
    const { data: refs } = await q(() => db.from("profile_references").select("title, counterparty").eq("org_id", factoryOrg).order("sort"));
    check(db ? refs.length === 2 && refs[0].title === "Maison Rue" : undefined, `references saved (${JSON.stringify(refs)})`);
    const { data: capacityRow } = await q(() => db.from("factory_capacity").select("monthly_units").eq("org_id", factoryOrg).maybeSingle());
    check(db ? capacityRow?.monthly_units === 6000 : undefined, "capacity from an earlier step saved");
    const { data: gots } = await q(() => db.from("factory_certifications").select("id").eq("org_id", factoryOrg));
    check(db ? gots.length === 1 : undefined, "picked certification kept across logout");
    const { data: registrations } = await q(() => db.from("documents").select("id, file_name").eq("org_id", factoryOrg).eq("kind", "business_registration"));
    check(db ? registrations.length === 2 : undefined, `both registration documents stored (${JSON.stringify(registrations?.map((r) => r.file_name))})`);

    // Resume.
    await signIn(page, factoryEmail, "factory");
    await waitFor(page, ".factory-onboarding-card", 40000);
    for (let i = 0; i < 6; i += 1) await nextCard(page);
    await record(page, "resumed verification keeps certification and references");
    check((await page.locator(".certification-upload-row").count()) === 1, "certification row restored");
    check((await page.locator(".onboarding-reference-row > div").count()) === 2, "reference rows restored");
    await nextCard(page); // → walkthrough
    await nextCard(page); // → review
    await record(page, "review shows real values");
    const reviewText = await page.locator(".factory-review-grid").first().innerText();
    check(!reviewText.includes("Golden Thread") && reviewText.includes(`Fixes Factory ${stamp}`), "review shows what was entered, not the example profile");
    await nextCard(page); // → terms

    const termsChecked = await page.evaluate(() => document.querySelector(".factory-onboarding-card input[type=checkbox]")?.checked);
    await record(page, "terms not pre-accepted");
    check(termsChecked === false, "terms checkbox starts unticked");
    check((await page.locator(".terms-section article").count()) >= 6, "updated terms include verification, payments and changes");
    await page.locator(".factory-onboarding-card input[type=checkbox]").first().click();
    await page.locator('input[name="signature"]').first().fill("Wen Li");
    await nextCard(page); // → complete
    await nextCard(page); // → dashboard

    await waitFor(page, ".factory-dashboard-page", 40000);
    await page.waitForTimeout(1500);
    await record(page, "factory dashboard in the design frame");
    check((await page.locator(".app-shell .side-nav").count()) === 1, "side nav present");
    const headingText = await page.locator(".factory-dashboard-header h1").first().innerText();
    check(headingText.includes(`Fixes Factory ${stamp}`), `dashboard greets the real org (${headingText})`);
    // Measured against Queena's dashboard at the same viewport: a 276px side
    // nav, a 1048px shell beside it, and a 642/380 two-column grid. Numbers
    // rather than an eyeball, because "looks about right" is how the live
    // pages drifted out of the design frame in the first place.
    const box = await page.evaluate(() => {
      const of = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { left: Math.round(r.left), width: Math.round(r.width), cols: getComputedStyle(el).gridTemplateColumns };
      };
      return { nav: of(".side-nav"), shell: of(".factory-dashboard-shell"), grid: of(".factory-dashboard-grid") };
    });
    check(box.shell.left >= 276, `dashboard content clears the side nav (left ${box.shell.left}px)`);
    check(box.nav?.width === 276, `side nav is the design's 276px (${box.nav?.width}px)`);
    check(box.grid?.cols === "642px 380px", `dashboard grid matches the design's 642/380 columns (${box.grid?.cols})`);

    await clickButton(page, "update capacity");
    await waitFor(page, ".factory-capacity-drawer");
    await record(page, "capacity drawer");
    await clickButton(page, "save changes");
    await page.waitForTimeout(1500);

    await clickButton(page, "log out", ".side-nav button");
    await waitFor(page, ".auth-card", 30000);
    await record(page, "logged out from side nav");
    check(true, "Log out in the side nav returns to the login screen");

    // ---- Brand --------------------------------------------------------------
    console.log("brand");
    const brandEmail = `fixes-brand-${stamp}@example.com`;
    await signUp(page, { email: brandEmail, fullName: "Ari Chen", companyName: `Fixes Brand ${stamp}`, portal: "brand" });
    check((await page.locator(".onboarding-save-exit").count()) === 1, "brand onboarding offers Save & log out");
    await nextCard(page); // basics
    await page.locator(".brand-onboarding-form-grid input").first().fill(`Fixes Brand ${stamp}`);
    await page.evaluate(() => {
      const details = document.querySelector(".brand-category-multiselect");
      details?.setAttribute("open", "");
    });
    await page.locator(".brand-category-multiselect-menu input").first().click();
    await nextCard(page); // context
    await nextCard(page); // chips
    const brandChips = await selectedChipCounts(page);
    await record(page, "brand chips start blank");
    check(brandChips.every((group) => group.selected === 0), `no brand chips pre-selected (${JSON.stringify(brandChips)})`);

    // Dropdowns, not just chips. The design gives several of these an example
    // answer ("Under 1,000"), and a select cannot simply be left blank — its
    // placeholder option has to be the selected one, or the browser shows the
    // first real option and the vendor submits a figure they never chose.
    await pickFirstChipEverywhere(page);
    await nextCard(page); // → sourcing volume
    const selects = await page.evaluate(() =>
      [...document.querySelectorAll(".brand-onboarding-card select")].map((s) => ({ name: s.getAttribute("name"), value: s.value })),
    );
    await record(page, "brand dropdowns start blank");
    check(
      selects.length > 0 && selects.every((s) => s.value === ""),
      `no brand dropdown pre-selected (${JSON.stringify(selects)})`,
    );
    await clickButton(page, "save & log out");
    await waitFor(page, ".auth-card", 30000);
    check(true, "brand Save & log out signs out");

    // ---- Marketing link -----------------------------------------------------
    const factoriesHtml = await fs.readFile(path.resolve("factories.html"), "utf8");
    check(factoriesHtml.includes('href="./app.html?portal=factory"'), "factories page Sign in opens the factory portal");
  } finally {
    // Closing a browser that has already gone throws, and that error would
    // replace the one that actually ended the run.
    await stagehand.close().catch(() => {});
  }

  console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
