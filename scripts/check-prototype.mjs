/**
 * The prototype must keep rendering with NO database.
 *
 * That is the whole promise of the data seam: Queena opens prototype.html,
 * sees populated screens, and iterates on visuals without a session, a network
 * or a Supabase container. If the mock adapter rots she will not find out
 * until she needs it, which is exactly the wrong moment.
 *
 *   npm run dev
 *   npm run check:prototype
 */
import { Stagehand, localBrowser } from "@browserbasehq/stagehand";

const BASE = process.env.PROTOTYPE_URL ?? "http://127.0.0.1:5173";

let failures = 0;
const check = (ok, note) => {
  console.log(ok ? "  ✓ " + note : "  ✗ " + note);
  if (!ok) failures += 1;
};

const browser = await localBrowser.launch({ headless: true });
const stagehand = await Stagehand.create({ browser });

try {
  const page = await stagehand.browser.context.newPage(`${BASE}/prototype.html?screen=projects`);
  await page.setViewportSize(1440, 1100);
  await page.waitForTimeout(4000);

  const body = await page.locator("body").innerText();
  check(/production orders/i.test(body), "the orders screen renders with no database");
  check(
    body.includes("Organic cotton woven shirt production"),
    "mock data reaches the screen through the provider",
  );
  check(body.includes("Atelier Minho"), "and the counterparty name with it");

  const cards = await page.locator("article").count();
  check(cards >= 3, `the project cards render (${cards} articles)`);

  // Against a synchronous adapter these states must never be reached, or the
  // prototype has started flashing UI it never used to.
  check(
    (await page.locator('[data-testid="orders-loading"]').count()) === 0,
    "no loading flash against a synchronous adapter",
  );
  check(
    (await page.locator('[data-testid="orders-empty"]').count()) === 0,
    "no empty state, since the mock has data",
  );
  check(
    (await page.locator('[data-testid="orders-error"]').count()) === 0,
    "and no error state",
  );

  const factory = await stagehand.browser.context.newPage(`${BASE}/factory-prototype.html`);
  await factory.waitForTimeout(3500);
  const factoryBody = await factory.locator("body").innerText();
  check(factoryBody.trim().length > 200, "the factory prototype still renders too");
} finally {
  await stagehand.close();
  await browser.close().catch(() => {});
}

console.log(
  failures
    ? `\n${failures} check(s) failed — the design loop is broken\n`
    : "\nthe prototype renders unchanged, with no backend\n",
);
process.exit(failures ? 1 : 0);
