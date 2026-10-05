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
  // Tabs are saved per company in the live app; the prototype keeps its own.
  check(body.includes("Active orders (4)") && body.includes("Closed (6)") && body.includes("Spring 27"),
    "the design's example tabs and counts");
  // The live archive adds an "Archived" tab; the design has none.
  check(!/Archived \(/.test(body), "and no Archived tab, which only the live app adds");

  const cards = await page.locator("article").count();
  check(cards >= 3, `the project cards render (${cards} articles)`);

  // Live "Reorder style" starts a new draft request; the design's own jumps to
  // its contract screen, filled in as a reorder. That must stay as drawn.
  const reorderPage = await stagehand.browser.context.newPage(`${BASE}/prototype.html?screen=projects`);
  await reorderPage.setViewportSize(1440, 1100);
  await reorderPage.waitForTimeout(3500);
  await reorderPage.locator('article button[aria-label="More order actions"]').first().click();
  await reorderPage.waitForTimeout(500);
  const reorderItem = reorderPage.locator(".project-overflow-menu > button").first();
  check(/reorder style/i.test(await reorderItem.innerText()), "the brand card's menu has Reorder style");
  await reorderItem.click();
  await reorderPage.waitForTimeout(1500);
  const reorderBody = await reorderPage.locator("body").innerText();
  check(/confirm final terms/i.test(reorderBody) && /reorder with Atelier Minho/i.test(reorderBody),
    "and it opens the design's contract screen as a reorder, with no database");

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

  // The brand's schedule builder and the factory's order screens are mounted
  // live with optional props. Without them they must still be the design's
  // own example content.
  const milestones = await stagehand.browser.context.newPage(`${BASE}/prototype.html?screen=milestones`);
  await milestones.setViewportSize(1440, 1100);
  await milestones.waitForTimeout(3500);
  const milestonesBody = await milestones.locator("body").innerText();
  check(/production schedule/i.test(milestonesBody), "the schedule builder renders with no database");
  check(milestonesBody.includes("Fit sample") && milestonesBody.includes("Atelier Minho"),
    "with its example steps and its example factory");
  const exampleSteps = await milestones.locator(".milestone-edit").count();
  check(exampleSteps === 4, `the four example steps (${exampleSteps})`);

  const factoryOrders = await stagehand.browser.context.newPage(`${BASE}/factory-prototype.html?screen=projects`);
  await factoryOrders.setViewportSize(1440, 1100);
  await factoryOrders.waitForTimeout(3500);
  const factoryOrdersBody = await factoryOrders.locator("body").innerText();
  check(factoryOrdersBody.includes("Maison Rue") && factoryOrdersBody.includes("Active orders (4)"),
    "the factory's order list keeps its example orders and counts");
  const factoryCards = await factoryOrders.locator(".factory-active-project-card").count();
  check(factoryCards === 4, `the four example order cards (${factoryCards})`);
  // The factory card's "..." now opens the same menu as the brand's.
  await factoryOrders.locator('.factory-active-project-card button[aria-label="More order actions"]').first().click();
  await factoryOrders.waitForTimeout(500);
  check((await factoryOrders.locator(".project-overflow-menu").count()) === 1,
    "the factory card's menu opens, with no database");
  // The design draws no archive item on the factory's card; live adds one.
  check(!/archive/i.test(await factoryOrders.locator(".project-overflow-menu").innerText()),
    "and it has no archive item, as drawn");

  const factoryDetail = await stagehand.browser.context.newPage(`${BASE}/factory-prototype.html?screen=projectDetail`);
  await factoryDetail.setViewportSize(1440, 1100);
  await factoryDetail.waitForTimeout(3500);
  const factoryDetailBody = await factoryDetail.locator("body").innerText();
  check(/production timeline/i.test(factoryDetailBody) && factoryDetailBody.includes("$5,780"),
    "the factory's order detail keeps its example timeline and figures");
  const factorySteps = await factoryDetail.locator(".factory-milestone-item").count();
  check(factorySteps === 7, `the seven example steps (${factorySteps})`);

  // The admin workspace now reads through the same seam, so it makes the same
  // promise and can break the same way. Every screen here is behind a
  // security-definer RPC in the live console; with no database it must still
  // be a populated page Queena can iterate on.
  const adminPage = await stagehand.browser.context.newPage(`${BASE}/admin-prototype.html`);
  await adminPage.setViewportSize(1440, 1100);
  await adminPage.waitForTimeout(4000);
  const adminBody = await adminPage.locator("body").innerText();
  check(/admin overview/i.test(adminBody), "the admin overview renders with no database");
  check(
    adminBody.includes("Atelier Minho"),
    "mock profiles reach the queue through the provider",
  );
  check(
    !/loading the marketplace/i.test(adminBody),
    "and never flashes the loading state a synchronous adapter cannot reach",
  );
  check(
    !/could not load/i.test(adminBody),
    "nor the error state",
  );

  const adminQueue = await stagehand.browser.context.newPage(
    `${BASE}/admin-prototype.html?screen=quotes`,
  );
  await adminQueue.setViewportSize(1440, 1100);
  await adminQueue.waitForTimeout(3500);
  const queueBody = await adminQueue.locator("body").innerText();
  check(
    queueBody.includes("Porto Stitch Studio"),
    "the quote table still reads its rows after they moved to a prop",
  );
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
