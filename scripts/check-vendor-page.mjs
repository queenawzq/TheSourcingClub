/**
 * The brand's view of a vendor sits in the window, on both designs.
 *
 * A `main` wrapped around the manufacturer's designed `main` applied the
 * sidebar's offset twice, which pushed "Message factory" and "Request quote"
 * off the page at 1440. e2e passed: it clicks by text, and a browser scrolls
 * to whatever it clicks. So this measures, as a brand, at a laptop's width and
 * a phone's, for a manufacturer and a trading company.
 *
 *   needs the local stack, a fresh `npm run seed:demo` and the dev server
 *   VENDOR_PAGE_URL=http://127.0.0.1:5173 npm run check:vendor-page
 */
import { Stagehand, localBrowser } from "@browserbasehq/stagehand";
import { execSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.VENDOR_PAGE_URL ?? "http://127.0.0.1:5173";
const status = JSON.parse(execSync("npx supabase status -o json 2>/dev/null", { encoding: "utf8" }));
const database = createClient(status.API_URL, status.SERVICE_ROLE_KEY ?? status.SECRET_KEY, { auth: { persistSession: false } });

const VENDORS = [
  { name: "Demo Factory", design: "manufacturer" },
  { name: "Kowloon Sourcing Partners", design: "trading company" },
];
const WIDTHS = [{ width: 1440, height: 900, rail: 276 }, { width: 375, height: 812, rail: 0 }];

let failures = 0;
const check = (ok, note) => {
  console.log(ok ? `  ✓ ${note}` : `  ✗ ${note}`);
  if (!ok) failures += 1;
};

const measure = `(() => {
  const inView = (el) => {
    const box = el.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== "hidden";
  };
  const tell = (el) => (el.tagName + "." + String(el.className).split(" ")[0] + " " + (el.innerText || "").trim().slice(0, 30));
  const rail = document.querySelector(".side-nav");
  const railRight = rail && inView(rail) ? rail.getBoundingClientRect().right : 0;
  const pages = [...document.querySelectorAll("main")].filter(inView);
  const content = [...document.querySelectorAll("main h1, main h2, main h3, main p, main button, main a, main img, main dd, main strong")]
    .filter(inView)
    .filter((el) => !el.closest(".side-nav") && !el.closest("[aria-hidden=true]"));
  return {
    window: innerWidth,
    page: document.documentElement.scrollWidth,
    pages: pages.length,
    nested: document.querySelectorAll("main main").length,
    railRight,
    indent: Math.min(...content.map((el) => el.getBoundingClientRect().left)) - railRight,
    count: content.length,
    past: content.filter((el) => el.getBoundingClientRect().right > innerWidth + 1).map(tell).slice(0, 4),
    under: content.filter((el) => el.getBoundingClientRect().left < railRight - 1).map(tell).slice(0, 4),
    contact: [...document.querySelectorAll("main button")].filter((b) => /message factory|request quote|start conversation/i.test(b.innerText)).filter(inView)
      .map((b) => Math.round(b.getBoundingClientRect().right)),
  };
})()`;

const browser = await localBrowser.launch({ headless: true });
const stagehand = await Stagehand.create({ browser });
try {
  const page = await stagehand.browser.context.newPage(`${BASE}/app.html`);
  await page.setViewportSize(1440, 900);
  await page.waitForTimeout(4000);
  await page.evaluate(`[...document.querySelectorAll("button")].find((b) => b.innerText.includes("demo-brand@example.com")).click()`);
  await page.waitForTimeout(5000);
  for (const vendor of VENDORS) {
    const { data, error } = await database.from("orgs").select("id").eq("name", vendor.name).limit(1).maybeSingle();
    if (error || !data) throw new Error(`no ${vendor.name}: run npm run seed:demo`);
    for (const size of WIDTHS) {
      await page.setViewportSize(size.width, size.height);
      await page.goto(`${BASE}/app.html/factories/${data.id}`);
      await page.waitForTimeout(4000);
      const seen = await page.evaluate(measure);
      const at = `${vendor.design} at ${size.width}`;
      check(seen.count > 10, `${at}: the page has drawn (${seen.count} elements)`);
      check(seen.nested === 0, `${at}: no page inside a page`);
      check(seen.page <= seen.window, `${at}: no sideways scroll (${seen.page} in ${seen.window})`);
      check(seen.past.length === 0, `${at}: nothing past the right edge ${seen.past.join("; ")}`);
      check(seen.under.length === 0, `${at}: nothing under the sidebar ${seen.under.join("; ")}`);
      check(seen.indent < 70, `${at}: no dead space on its left (starts ${Math.round(seen.indent)} from the sidebar)`);
      check(seen.contact.length > 0 && seen.contact.every((right) => right <= seen.window), `${at}: its contact buttons are on screen`);
      if (size.rail) check(Math.abs(seen.railRight - size.rail) < 2 , `${at}: beside the sidebar, which ends at ${seen.railRight}`);
    }
  }
} finally {
  await stagehand.close();
  await browser.close().catch(() => {});
}

if (failures) {
  console.error(`check:vendor-page: ${failures} failed`);
  process.exit(1);
}
console.log("check:vendor-page: every vendor page is inside the window");
process.exit(0);
