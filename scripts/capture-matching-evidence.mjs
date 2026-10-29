/**
 * The screenshots in docs/matching-evidence/, taken from the live app on a
 * local stack. Run it again after a design pass so the docs show what ships.
 *
 *   MATCHING_SUPABASE_WORKDIR=$PWD node scripts/seed-matching-review.mjs
 *   (then the evidence and decisions in docs/explainable-matching.md)
 *   npm run dev
 *   E2E_URL=http://127.0.0.1:5173 node scripts/capture-matching-evidence.mjs
 *
 * Writes PNGs; `sips` turns them into the JPEGs the docs link.
 */
import path from "node:path";
import { execFileSync } from "node:child_process";
import { Stagehand, localBrowser } from "@browserbasehq/stagehand";
import { DEMO_PASSWORD } from "../src/shared/demo-logins.mjs";

const BASE = (process.env.E2E_URL ?? "http://127.0.0.1:5173").replace(/\/app\.html$/, "");
const OUT = path.resolve("docs/matching-evidence");
const RFQ = "e9800000-0000-0000-0000-000000000005";
const EXCLUDED = "e9800000-0000-0000-0000-000000000004";

const browser = await localBrowser.launch({ headless: true });
const stagehand = await Stagehand.create({ browser });
const page = await stagehand.browser.context.newPage(`${BASE}/app.html`);
await page.setViewportSize(1440, 1000);

const wait = (ms) => page.waitForTimeout(ms);
// Interactions run in the page: the panels are plain DOM, and this keeps the
// script independent of the driver's locator API.
const run = (fn, arg) => page.evaluate(fn, arg);

async function signIn(url, email) {
  await page.goto(url);
  await wait(1500);
  await run(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto(url);
  await wait(2500);
  await page.locator('input[name="email"]').first().fill(email);
  await page.locator('input[name="password"]').first().fill(DEMO_PASSWORD);
  await page.keyPress("Enter");
  await wait(5000);
}

// Scroll an element to the top of the viewport, leaving `above` pixels of context.
async function bringToTop(selector, above = 24) {
  await run(([sel, gap]) => {
    const el = document.querySelector(sel);
    window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - gap);
  }, [selector, above]);
  await wait(1500); // the designs fade sections in as they scroll into view
}

// Scroll so an element's bottom sits `gap` pixels above the viewport's bottom.
async function bringToBottom(selector, gap = 100) {
  await run(([sel, g]) => {
    const el = document.querySelector(sel);
    window.scrollTo(0, el.getBoundingClientRect().bottom + window.scrollY - window.innerHeight + g);
  }, [selector, gap]);
  await wait(1500);
}

async function shoot(name) {
  const png = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: png });
  execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "80", png, "--out", path.join(OUT, `${name}.jpg`)], { stdio: "ignore" });
  execFileSync("rm", [png]);
  console.log(`  ✓ ${name}.jpg`);
}

try {
  // Brand: Browse ranks and explains, with one explanation open.
  await signIn(`${BASE}/app.html`, "matching-review-brand@example.com");
  await page.goto(`${BASE}/app.html/browse`);
  await wait(4000);
  await run(() => {
    const card = [...document.querySelectorAll(".matching-why")].find((d) => d.querySelector(".matching-pill.is-warn"));
    if (card) card.open = true;
  });
  // Tall enough for all three states: qualified, provisional (open) and not eligible.
  await page.setViewportSize(1440, 1900);
  await bringToTop(".matching-why", 140);
  await shoot("qualified-provisional-excluded");
  await page.setViewportSize(1440, 1000);

  // Brand: a vendor page that does not meet the must-haves.
  await page.goto(`${BASE}/app.html/factories/${EXCLUDED}`);
  await wait(4000);
  await bringToTop(".factory-profile-hero", 24);
  await shoot("vendor-not-eligible");

  // Brand: the invite step, a provisional factory selected and acknowledged.
  await page.goto(`${BASE}/app.html/rfqs/${RFQ}/invite`);
  await wait(5000);
  await run(() => {
    document.querySelector('button[aria-label="Select Porto Development Studio"]')?.click();
  });
  await wait(600);
  await run(() => {
    const ack = document.querySelector(".matching-acknowledge input");
    if (ack && !ack.checked) ack.click();
    const card = [...document.querySelectorAll(".invite-selection-factory-card")].find((c) => c.textContent.includes("Porto Development"));
    const why = card?.querySelector(".matching-why");
    if (why) why.open = true;
  });
  await wait(600);
  // The acknowledgement sits under the list, just above the invite button.
  await bringToBottom(".matching-acknowledge", 110);
  await shoot("acknowledged-invitation");

  // Factory: its evidence, a note from TSC and an approved certificate.
  await signIn(`${BASE}/app.html?portal=factory`, "matching-review-qualified@example.com");
  await page.goto(`${BASE}/app.html/profile`);
  await wait(4500);
  await bringToTop('section[aria-label="Matching evidence review"]');
  await shoot("factory-profile");

  // Staff: the evidence panel under the Verification queue.
  await signIn(`${BASE}/admin.html?screen=verification`, "matching-review-staff@example.com");
  await page.goto(`${BASE}/admin.html?screen=verification`);
  await wait(4500);
  await bringToTop(".admin-list-header", 32);
  await shoot("staff-evidence-review");
} finally {
  await stagehand.close();
}
// The local browser can keep the event loop alive after closing.
process.exit(0);
