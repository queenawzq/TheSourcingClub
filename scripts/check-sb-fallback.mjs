/**
 * The way to the database, against a fake network. What it pins: a write is
 * never sent twice unless it is safe to, a blocked host costs a person nothing,
 * and someone whose direct host works never touches our proxy.
 *
 * The read-only list is also checked against the migrations, because repeating
 * a function that writes is the mistake this file exists to prevent.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fillOlderBrowsers } from "../src/lib/older-browsers.mjs";
import { CHECK_MS, GIVE_UP_MS, HEDGE_MS, READ_RPCS, classify, createRoute, proxyPathFor } from "../src/lib/supabase-route.mjs";

let failed = 0;
const pass = (label) => console.log(`  ok  ${label}`);
const fail = (label, detail) => {
  failed += 1;
  console.error(`FAIL  ${label}${detail ? `: ${detail}` : ""}`);
};
const same = (label, actual, expected) => {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) pass(label);
  else fail(label, `got ${a}, wanted ${b}`);
};

const BASE = "https://abc.supabase.co";
const PROXY = "https://site.test/sb/abc";
const json = (status = 200) => ({ ok: status < 400, status, headers: new Map([["content-type", "application/json"]]) });
const html = (status) => ({ ok: false, status, headers: new Map([["content-type", "text/html"]]) });
const networkError = () => new TypeError("Failed to fetch");
const never = (init) => new Promise((_, reject) => {
  init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
});

/** A network whose direct and proxy ways each behave as told. Records what was sent. */
function network({ direct = "open", proxy = "open", health = direct, storage = null, onFallback } = {}) {
  const sent = [];
  const way = (mode, init) => {
    if (typeof mode === "function") return mode(init);
    if (mode === "open") return Promise.resolve(json());
    if (mode === "shut") return Promise.reject(networkError());
    if (mode === "frozen") return never(init);
    if (mode === "lost") return Promise.reject(networkError()); // Delivered; the answer never came.
    return Promise.resolve(html(mode));
  };
  const route = createRoute({
    base: BASE,
    proxyBase: PROXY,
    storage,
    onFallback,
    // The real delays, run fifty times faster: the build should not wait on them.
    setTimer: (run, ms) => setTimeout(run, ms / 50),
    fetch: (url, init) => {
      const isHealth = url.endsWith("/auth/v1/health");
      const isProxy = url.startsWith(PROXY);
      if (!isHealth) sent.push(`${isProxy ? "proxy" : "direct"} ${init?.method ?? "GET"} ${url.replace(isProxy ? PROXY : BASE, "")}`);
      return way(isHealth ? health : isProxy ? proxy : direct, init);
    },
  });
  return { route, sent };
}
const call = (route, path, method = "GET") => route.fetch(`${BASE}${path}`, { method });
const settled = (promise) => promise.then(() => "answered", (error) => `failed: ${error.message}`);
const memory = () => {
  const values = new Map();
  return { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: (k) => values.delete(k) };
};

// ---- What may be repeated
same("a plain read", classify("/rest/v1/orders", "GET"), "read");
same("a read-only function", classify("/rest/v1/rpc/my_invitation_companies", "POST"), "read");
same("a function that charges credits", classify("/rest/v1/rpc/submit_quote", "POST"), "write");
same("a bank number", classify("/rest/v1/rpc/save_bank_payout_account", "POST"), "write");
same("an insert", classify("/rest/v1/messages", "POST"), "write");
same("an update", classify("/rest/v1/orgs", "PATCH"), "write");
same("a file upload", classify("/storage/v1/object/org-private/a.pdf", "POST"), "write");
same("signing a file link", classify("/storage/v1/object/sign/org-private/a.pdf", "POST"), "read");
same("a sign-up", classify("/auth/v1/signup", "POST"), "repeatable");
same("a company, deduped on the server", classify("/rest/v1/rpc/create_org", "POST"), "repeatable");
same("the password reset email", classify("/auth/v1/recover", "POST"), "write");
same("an unknown method", classify("/rest/v1/rpc/my_review_status", "PUT"), "write");

// A query string decides nothing: only the path is classified.
{
  const { route, sent } = network({ direct: "shut", health: "open" });
  await settled(route.fetch(`${BASE}/rest/v1/messages?x=/auth/v1/signup`, { method: "POST" }));
  same("a query string can't make a write repeatable", sent, ["direct POST /rest/v1/messages?x=/auth/v1/signup"]);
}

// ---- Direct works: nothing else happens
{
  const { route, sent } = network();
  await call(route, "/rest/v1/orders");
  await call(route, "/rest/v1/messages", "POST");
  same("host open: only direct", sent, ["direct GET /rest/v1/orders", "direct POST /rest/v1/messages"]);
  same("host open: not on the fallback", route.isOnFallback(), false);
  same("host open: file links stay direct", route.fileUrl(`${BASE}/storage/v1/object/public/x.png`), `${BASE}/storage/v1/object/public/x.png`);
}

// ---- Host shut from the start
{
  let told = 0;
  const { route, sent } = network({ direct: "shut", onFallback: () => { told += 1; } });
  const signup = await settled(call(route, "/auth/v1/signup?redirect_to=x", "POST"));
  same("shut: the sign-up answers", signup, "answered");
  same("shut: the sign-up is sent once, the open way", sent, ["proxy POST /auth/v1/signup?redirect_to=x"]);
  same("shut: not counted as sent twice", route.takeRepeated("/auth/v1/signup"), false);
  await call(route, "/rest/v1/rpc/submit_quote", "POST");
  same("shut: a later write goes straight the open way", sent[1], "proxy POST /rest/v1/rpc/submit_quote");
  same("shut: file links go through our host", route.fileUrl(`${BASE}/storage/v1/object/public/x.png`), `${PROXY}/storage/v1/object/public/x.png`);
  await call(route, "/rest/v1/orders");
  same("shut: reads too", sent[2], "proxy GET /rest/v1/orders");
  same("shut: told once", told, 1);
}

// ---- Host fine at the check, and the write's reply is lost: the heart of it
{
  const { route, sent } = network({ direct: "lost", health: "open" });
  const result = await settled(call(route, "/rest/v1/rpc/submit_quote", "POST"));
  same("lost reply: a charging write is not repeated", sent, ["direct POST /rest/v1/rpc/submit_quote"]);
  same("lost reply: the person hears it", result, "failed: Failed to fetch");
  await call(route, "/rest/v1/rpc/submit_quote", "POST");
  same("lost reply: pressing again goes the other way", sent[1], "proxy POST /rest/v1/rpc/submit_quote");
}
{
  const { route, sent } = network({ direct: "lost", health: "open" });
  await call(route, "/auth/v1/signup", "POST");
  same("lost reply: a sign-up is repeated", sent, ["direct POST /auth/v1/signup", "proxy POST /auth/v1/signup"]);
  same("lost reply: auth can ask it was", route.takeRepeated("/auth/v1/signup"), true);
  same("lost reply: asked once", route.takeRepeated("/auth/v1/signup"), false);
}
{
  const { route, sent } = network({ direct: "lost", health: "open" });
  await call(route, "/rest/v1/rpc/create_org", "POST");
  same("lost reply: a company is repeated", sent.length, 2);
}
// Lost on the fallback: same rule.
{
  const { route, sent } = network({ direct: "shut", proxy: "lost" });
  const result = await settled(call(route, "/rest/v1/rpc/approve_milestone", "POST"));
  same("fallback reply lost: not repeated", sent, ["proxy POST /rest/v1/rpc/approve_milestone"]);
  same("fallback reply lost: said", result, "failed: Failed to fetch");
}

// ---- Vercel answering for itself is not an answer from the database
{
  for (const status of [401, 404]) {
    const { route, sent } = network({ direct: "shut", proxy: status });
    const result = await settled(call(route, "/rest/v1/orders"));
    same(`our host's ${status}: read fails, in the usual words`, result, "failed: Failed to fetch");
    same(`our host's ${status}: direct tried`, sent.includes("direct GET /rest/v1/orders"), true);
  }
  const { route, sent } = network({ direct: "open", proxy: 404, health: "shut" });
  await settled(call(route, "/rest/v1/rpc/submit_quote", "POST"));
  same("our host's 404: a write it never passed on may go direct", sent, ["proxy POST /rest/v1/rpc/submit_quote", "direct POST /rest/v1/rpc/submit_quote"]);
  const gateway = network({ direct: "open", proxy: 502, health: "shut" });
  await settled(call(gateway.route, "/rest/v1/rpc/submit_quote", "POST"));
  same("our host's 502: it may have reached the database, so no repeat", gateway.sent, ["proxy POST /rest/v1/rpc/submit_quote"]);
}

// ---- Both shut
{
  const { route } = network({ direct: "shut", proxy: "shut" });
  same("both shut: a read fails in the browser's words, for unwrap to word", await settled(call(route, "/rest/v1/orders")), "failed: Failed to fetch");
  same("both shut: a write too", await settled(call(route, "/rest/v1/messages", "POST")), "failed: Failed to fetch");
}

// ---- A real answer is passed on, whatever it says
{
  const { route, sent } = network({ direct: () => Promise.resolve(json(422)) });
  const answer = await call(route, "/auth/v1/signup", "POST");
  same("a refusal is an answer, not a failure", [answer.status, sent.length, route.isOnFallback()], [422, 1, false]);
}

// ---- Stopped by the caller: no route change, no repeat
{
  const controller = new AbortController();
  const { route, sent } = network({ direct: "frozen", health: "open" });
  const pending = settled(route.fetch(`${BASE}/rest/v1/orders`, { signal: controller.signal }));
  await new Promise((resolve) => setTimeout(resolve, 5));
  controller.abort();
  await pending;
  same("the caller stopping: stays direct", [route.isOnFallback(), sent.length], [false, 1]);
}

// ---- Remembered across a reload, and left when the time is up
{
  const storage = memory();
  const first = network({ direct: "shut", storage });
  await call(first.route, "/rest/v1/orders");
  const again = network({ direct: "shut", storage });
  await call(again.route, "/rest/v1/orders");
  same("the next page goes straight the open way", again.sent, ["proxy GET /rest/v1/orders"]);
}
{
  const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
  const { route } = network({ direct: "shut", storage: broken });
  same("storage blocked: still works", await settled(call(route, "/rest/v1/orders")), "answered");
}

// ---- A hung connection (dropped traffic), on timers that really run
{
  const started = Date.now();
  const { route, sent } = network({ direct: "frozen" });
  const result = await settled(call(route, "/rest/v1/orders"));
  same("frozen: a read answers through our host", result, "answered");
  same("frozen: as soon as the look says so", Date.now() - started < CHECK_MS + 1000, true);
  same("frozen: then direct is left alone", sent.at(-1), "proxy GET /rest/v1/orders");
}
{
  const { route, sent } = network({ direct: "frozen" });
  same("frozen: a write answers", await settled(call(route, "/rest/v1/messages", "POST")), "answered");
  same("frozen: and was never sent direct", sent, ["proxy POST /rest/v1/messages"]);
}
{
  const started = Date.now();
  const { route } = network({ direct: "frozen", proxy: "shut", health: "open" });
  const result = await settled(call(route, "/rest/v1/orders"));
  same("frozen and our host down: the screen gets an error", result.startsWith("failed"), true);
  same("frozen and our host down: within the limit", Date.now() - started < HEDGE_MS + GIVE_UP_MS + 1000, true);
}

// ---- Functions an older engine lacks
{
  const scope = { Object: { ...Object, prototype: Object.prototype, defineProperty: Object.defineProperty }, Array: { prototype: {} }, String: { prototype: {} }, crypto: { getRandomValues: (b) => globalThis.crypto.getRandomValues(b) } };
  delete scope.Object.hasOwn;
  fillOlderBrowsers(scope);
  same("hasOwn filled", [scope.Object.hasOwn({ a: 1 }, "a"), scope.Object.hasOwn({}, "toString")], [true, false]);
  same("at filled", scope.Array.prototype.at.call([1, 2, 3], -1), 3);
  same("randomUUID filled", /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(scope.crypto.randomUUID()), true);
  const real = Object.hasOwn;
  fillOlderBrowsers();
  same("a modern browser's own are left alone", Object.hasOwn, real);
}

// ---- Addresses
same("production's project", proxyPathFor("https://wxz.supabase.co"), "/sb/wxz");
same("a local stack", proxyPathFor("http://127.0.0.1:54321"), "/sb/local");
same("a lookalike host is not a project", proxyPathFor("https://wxz.supabase.co.evil.test"), "/sb/local");

// ---- Every RPC called "read" is one, in its latest definition
const latest = new Map();
for (const file of readdirSync("supabase/migrations").filter((name) => name.endsWith(".sql")).sort()) {
  const sql = readFileSync(`supabase/migrations/${file}`, "utf8");
  for (const match of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z_0-9]+)\s*\(([\s\S]*?)\$\w*\$/gi)) {
    latest.set(match[1], /\b(stable|immutable)\b/i.test(match[2]));
  }
}
const notReads = [...READ_RPCS].filter((name) => latest.get(name) !== true);
same("the read-only list holds only stable functions", notReads, []);

// ---- vercel.json reaches exactly the two databases, and does not cache
const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));
const proxied = vercel.rewrites.filter((rule) => rule.source.startsWith("/sb/"));
same("one rewrite per database", proxied.length, 2);
for (const rule of proxied) {
  const ref = rule.source.split("/")[2];
  same(`${ref} goes only to itself`, rule.destination, `https://${ref}.supabase.co/:path*`);
}
same("/sb is never cached", vercel.headers?.some((rule) => rule.source === "/sb/(.*)"
  && rule.headers.some((h) => h.key === "x-vercel-enable-rewrite-caching" && h.value === "0")), true);

if (failed) {
  console.error(`check:sb-fallback: ${failed} failed`);
  process.exit(1);
}
console.log("check:sb-fallback passed");
process.exit(0);
