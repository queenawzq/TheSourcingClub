/**
 * No dashboard draws a layout before its reads have answered.
 *
 * A brand with orders was shown the new-brand layout ("Ready to start
 * sourcing?") on every visit, until its lists arrived: the layout was chosen
 * from lists that start empty. It was thought fixed once (#35 added the right
 * guard and used it only for a fetch), and nothing could tell, because e2e
 * looks at the page after the reads have finished, and a flash is over by then.
 *
 * React's server render runs no effects, so no read has started and none has
 * answered: rendering the real mounts once IS their first paint. No database,
 * no browser, under a few seconds; it runs in the build.
 *
 * What it cannot see is the change after the reads answer. That is the rule's
 * table below, and by hand, a MutationObserver log (notes/LEARNINGS.md).
 */
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { brandHasHistory, factoryHasHistory, followRead, homeLayout, withinCap } from "../src/app/home/home-layout.mjs";

let failures = 0;
let checks = 0;
const check = (ok, note) => {
  checks += 1;
  if (!ok) {
    failures += 1;
    console.log(`  ✗ ${note}`);
  }
};

// ---- Which layout is true, once the reads have answered ----
for (const hasHistory of [true, false]) {
  check(homeLayout({ status: "loading", hasHistory }) === "loading", `loading never picks a layout (history: ${hasHistory})`);
  check(homeLayout({ status: "failed", hasHistory }) === "failed", `a failed read never picks a layout (history: ${hasHistory})`);
}
check(homeLayout({ status: "ready", hasHistory: true }) === "active", "history, answered: the working dashboard");
check(homeLayout({ status: "ready", hasHistory: false }) === "newcomer", "nothing, answered: the new layout");
check(homeLayout({ hasHistory: true }) === "loading", "no status is not an answer");

check(!brandHasHistory([], []), "a brand with nothing is new");
check(!brandHasHistory([{ status: "draft" }], []), "a brand with only a draft is new: nobody has seen it");
check(brandHasHistory([{ status: "open" }], []), "a published request counts");
check(brandHasHistory([{ status: "awarded" }], []), "an awarded request still counts: it is not their first");
check(brandHasHistory([{ status: "cancelled" }], []), "a cancelled request still counts");
check(brandHasHistory([], [{ id: "archived order" }]), "any order counts, archived or not");
check(!factoryHasHistory([], false), "a vendor with nothing is new");
check(factoryHasHistory([], true), "a quote from any month counts: the layout must not go back on the 1st");
check(factoryHasHistory([{ id: "order" }], false), "an order counts");
check(await withinCap(new Promise(() => {}), "fallback", 5) === "fallback", "a read that never answers cannot hold the dashboard up");
check(await withinCap(Promise.resolve("answer"), "fallback", 5) === "answer", "a read that answers is used");

// ---- A read past the cap: the page draws without it, and its answer is still used ----
const after = (ms, value) => new Promise((resolve) => setTimeout(() => resolve(value), ms));
const following = (read, giveUpMs) => {
  const seen = { state: { list: [], answered: false } };
  const stop = followRead(read, (next) => {
    seen.state = typeof next === "function" ? next(seen.state) : next;
  }, giveUpMs);
  return { seen, stop };
};
{
  const slow = after(20, ["late vendor"]);
  check(await withinCap(slow, null, 5) === null, "vendors over the cap: the page draws without them");
  const late = following(after(20, ["late vendor"]), 1000);
  await after(5);
  check(late.seen.state.answered === false, "still waiting after the cap: the panel may not say it has nothing");
  await after(30);
  check(late.seen.state.answered && late.seen.state.list[0] === "late vendor", "the late answer fills the panel");
  late.stop();

  const silent = following(new Promise(() => {}), 5);
  await after(15);
  check(silent.seen.state.answered && silent.seen.state.list.length === 0, "a read that never answers stops saying it is looking");
  silent.stop();

  const afterGivingUp = following(after(15, ["very late"]), 5);
  await after(30);
  check(afterGivingUp.seen.state.list[0] === "very late", "an answer after giving up is still used");
  afterGivingUp.stop();

  const left = following(after(10, ["other company's"]), 1000);
  left.stop();
  await after(20);
  check(left.seen.state.list.length === 0, "a page that moved on takes no answer: one company's vendors never reach another");
}
// The mount has to use it: a server render runs no effects, so this is by name.
const liveHome = readFileSync(new URL("../src/app/home/LiveHome.jsx", import.meta.url), "utf8");
check(liveHome.includes("followRead(vendorsRead, setVendors)"), "LiveHome follows its vendors past the cap");
check(liveHome.includes("vendorsPending={!vendors.answered}"), "LiveHome tells the panel it is still waiting");

// ---- The first paint of the real mounts ----
const store = { getItem: () => null, setItem() {}, removeItem() {} };
const listeners = { addEventListener() {}, removeEventListener() {} };
globalThis.window = {
  location: { pathname: "/app.html", search: "", hash: "", href: "http://stub.invalid/app.html" },
  history: { pushState() {}, replaceState() {} },
  localStorage: store,
  sessionStorage: store,
  matchMedia: () => ({ matches: false, ...listeners }),
  ...listeners,
};
globalThis.document = { visibilityState: "visible", ...listeners };
globalThis.localStorage = store;
globalThis.sessionStorage = store;

const server = await createServer({
  configFile: false,
  logLevel: "error",
  appType: "custom",
  cacheDir: "node_modules/.vite-check-dashboard",
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  plugins: [react()],
  define: {
    __DEMO_SIGN_IN__: "false",
    __DEPLOY_TARGET__: '"local"',
    __PREVIEW_SUPABASE__: "null",
    "import.meta.env.VITE_SUPABASE_URL": '"http://stub.invalid"',
    "import.meta.env.VITE_SUPABASE_ANON_KEY": '"stub"',
  },
});

// Anything that belongs to a layout, by name; and, because a new panel would
// not be on this list, no panel of any kind.
const LAYOUT_MARKS = [
  "home-new-brand-card", "home-recommendations-layout", "home-recommended-factories", "home-dashboard-grid",
  "home-active-rfqs", "home-active-orders", "home-attention", "home-dashboard-empty-state",
  "factory-dashboard-grid", "factory-dashboard-metrics", "factory-dashboard-capacity", "factory-dashboard-credit-card",
  "factory-active-projects-panel",
];
const PROTOTYPE_WORDS = ["Maison Rue", "Atelier Minho", "Pacific Source Partners", "Seoul Knit Works", "$18.40"];

function checkFirstPaint(label, html, company) {
  for (const mark of LAYOUT_MARKS) check(!html.includes(mark), `${label}: first paint draws no ${mark}`);
  for (const tag of ["<section", "<article"]) check(!html.includes(tag), `${label}: first paint draws no ${tag}>`);
  for (const word of PROTOTYPE_WORDS) check(!html.includes(word), `${label}: first paint has none of the prototype's "${word}"`);
  check(html.includes(`Hi ${company}`), `${label}: first paint has the company's own header`);
  check(html.includes("Loading your dashboard"), `${label}: first paint says it is loading`);
  check(html.includes('aria-label="Open activity"'), `${label}: the bell is there from the first paint`);
}

try {
  const { RouterProvider } = await server.ssrLoadModule("/src/lib/router.jsx");
  const { AuthProvider } = await server.ssrLoadModule("/src/lib/auth.jsx");
  const render = (element) => renderToStaticMarkup(createElement(AuthProvider, null, createElement(RouterProvider, null, element)));
  const LiveHome = (await server.ssrLoadModule("/src/app/home/LiveHome.jsx")).default;
  const LiveFactoryHome = (await server.ssrLoadModule("/src/app/home/LiveFactoryHome.jsx")).default;
  const brand = { id: "b", name: "Check Brand", role: "owner", type: "brand" };
  const factory = { id: "f", name: "Check Factory", role: "owner", type: "factory" };

  checkFirstPaint("brand", render(createElement(LiveHome, { org: brand, isFactory: false, goTo() {} })), brand.name);
  checkFirstPaint("factory", render(createElement(LiveFactoryHome, { org: factory, profile: { vendor_kind: "manufacturer", verification_status: "verified" } })), factory.name);
  checkFirstPaint("trading company", render(createElement(LiveFactoryHome, { org: factory, profile: { vendor_kind: "trading_company", verification_status: "verified" } })), factory.name);

  // The designed components with no `holding` still draw what Queena drew.
  const { HomeScreen } = await server.ssrLoadModule("/src/prototype/main.jsx");
  const { FactoryDashboardPage } = await server.ssrLoadModule("/src/factory-prototype/main.jsx");
  const brandNew = render(createElement(HomeScreen, { dashboardState: "newcomer", goTo() {} }));
  const brandActive = render(createElement(HomeScreen, { dashboardState: "active", goTo() {} }));
  check(brandNew.includes("home-new-brand-card") && brandNew.includes("Maison Rue"), "prototype: the brand's new layout, with its examples");
  check(brandActive.includes("home-dashboard-grid") && brandActive.includes("home-active-orders"), "prototype: the brand's working dashboard");

  // The vendor panel says "nothing here" only once the answer is in.
  const NOTHING_HERE = "Find your next production partner";
  const card = { id: "v", initials: "V", name: "Check Vendor", location: "Porto", trust: "", match: "", rating: "", orders: "", stats: [], notes: [""], products: [] };
  const vendorPanel = (dashboardState, props) => render(createElement(HomeScreen, { dashboardState, goTo() {}, attention: [], rfqs: [], projects: [], ...props }));
  const waiting = vendorPanel("active", { factories: [], vendorsPending: true });
  check(waiting.includes("Finding vendors") && !waiting.includes(NOTHING_HERE), "working dashboard, vendors late: says it is looking, not that there are none");
  const none = vendorPanel("active", { factories: [] });
  check(none.includes(NOTHING_HERE) && !none.includes("Finding vendors"), "working dashboard, answered with none: the design's box");
  const arrived = vendorPanel("active", { factories: [card] });
  check(arrived.includes("Check Vendor") && !arrived.includes(NOTHING_HERE) && !arrived.includes("Finding vendors"), "working dashboard, late answer in: the vendor's card");
  const newWaiting = vendorPanel("newcomer", { factories: [], vendorsPending: true });
  check(newWaiting.includes("Finding vendors") && newWaiting.includes("Ready to start sourcing"), "new brand, vendors late: says it is looking");
  const newArrived = vendorPanel("newcomer", { factories: [card] });
  check(newArrived.includes("Check Vendor") && !newArrived.includes("Finding vendors"), "new brand, late answer in: the vendor's card");
  check(!brandActive.includes("Finding vendors") && !brandNew.includes("Finding vendors"), "prototype: never says it is looking");

  const factoryNew = render(createElement(FactoryDashboardPage, { dashboardState: "newcomer", language: "en" }));
  const factoryActive = render(createElement(FactoryDashboardPage, { dashboardState: "active", language: "en" }));
  check(factoryNew.includes("factory-dashboard-grid") && !factoryNew.includes("factory-dashboard-metrics"), "prototype: the factory's new layout");
  check(factoryActive.includes("factory-dashboard-metrics"), "prototype: the factory's working dashboard");
} catch (failure) {
  failures += 1;
  console.log(`  ✗ could not render the dashboards: ${failure.message}`);
} finally {
  await server.close();
}

if (failures) {
  console.error(`check:dashboard: ${failures} of ${checks} failed. A dashboard must not choose a layout before its reads answer (src/app/home/home-layout.mjs).`);
  process.exit(1);
}
console.log(`check:dashboard: ${checks} checks passed`);
process.exit(0);
