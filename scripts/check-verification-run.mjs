// npm run check:auto: the automatic verification run, with stubbed steps and
// a fake database. No network, no stack.
import assert from "node:assert/strict";
import {
  REPEAT_MS, STALE_MS, callerRole, isRepeat, loadSteps, needsRun, runAll, runCron, runOnce, STEPS,
} from "../api/verification-run.js";
import { createVerificationRunner } from "../src/lib/domain/verification-run.js";

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL ${name}\n     ${error.message}`);
  }
}

const NOW = Date.parse("2026-11-11T12:00:00Z");
const iso = (ms) => new Date(ms).toISOString();

/** A fake service client: tables → rows, answering the chains the route uses. */
function fakeDb(tables) {
  return {
    from(table) {
      let rows = [...(tables[table] ?? [])];
      const q = {
        select: () => q,
        eq: (col, value) => { rows = rows.filter((row) => row[col] === value); return q; },
        order: (col, { ascending }) => { rows.sort((a, b) => (a[col] < b[col] ? -1 : 1) * (ascending ? 1 : -1)); return q; },
        limit: (n) => { rows = rows.slice(0, n); return q; },
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        then: (resolve) => resolve({ data: rows, error: null }),
      };
      return q;
    },
  };
}

function recorder(order, name, answer = { available: true }) {
  return async (args) => {
    order.push(name);
    assert.ok(args.orgId && args.asServer, `${name} gets orgId and asServer`);
    if (answer instanceof Error) throw answer;
    if (answer === "hang") return new Promise(() => {});
    return answer;
  };
}

await check("the reading runs before the address check; photos run too", async () => {
  const order = [];
  const result = await runAll({
    orgId: "o1", asServer: {},
    steps: { read: recorder(order, "read"), address: recorder(order, "address"), photos: recorder(order, "photos") },
  });
  assert.ok(order.indexOf("read") < order.indexOf("address"));
  assert.ok(order.includes("photos"));
  assert.deepEqual([result.read.ran, result.address.ran, result.photos.ran], [true, true, true]);
});

await check("one step throwing does not stop the others", async () => {
  const order = [];
  const result = await runAll({
    orgId: "o1", asServer: {},
    steps: { read: recorder(order, "read", new Error("boom")), address: recorder(order, "address"), photos: recorder(order, "photos") },
  });
  assert.deepEqual(result.read, { ran: false, reason: "failed" });
  assert.equal(result.address.ran, true);
  assert.equal(result.photos.ran, true);
});

await check("a missing export is skipped and named", async () => {
  const result = await runAll({ orgId: "o1", asServer: {}, steps: { read: null, address: null, photos: async () => ({ available: true }) } });
  assert.equal(result.read.reason, "not built yet");
  assert.equal(result.address.reason, "not built yet");
  assert.equal(result.photos.ran, true);
});

await check("loadSteps finds real exports and nulls missing ones", async () => {
  const steps = await loadSteps({
    a: { load: async () => ({ runX: () => 1 }), name: "runX" },
    b: { load: async () => ({}), name: "runY" },
    c: { load: async () => { throw new Error("no module"); }, name: "runZ" },
  });
  assert.equal(typeof steps.a, "function");
  assert.equal(steps.b, null);
  assert.equal(steps.c, null);
});

await check("the real modules load (missing exports reported, not thrown)", async () => {
  const steps = await loadSteps(STEPS);
  console.log(`     exports present: ${Object.entries(steps).map(([k, v]) => `${k}=${v ? "yes" : "no"}`).join(", ")}`);
});

await check("an unavailable step and a hanging step are reported, the run still answers", async () => {
  const result = await runAll({
    orgId: "o1", asServer: {}, budgetMs: 1500,
    steps: { read: async () => ({ available: false, reason: "No registration document is uploaded." }), address: async () => ({ available: true }), photos: recorder([], "photos", "hang") },
  });
  assert.equal(result.read.reason, "No registration document is uploaded.");
  assert.equal(result.photos.reason, "took too long");
});

await check("repeat guard: a run under two minutes old, with nothing new since, is skipped", () => {
  assert.equal(isRepeat({ lastRun: NOW - 60_000, lastInput: NOW - 90_000 }, NOW), true);
  assert.equal(isRepeat({ lastRun: NOW - 60_000, lastInput: NOW - 30_000 }, NOW), false, "a new upload runs again");
  assert.equal(isRepeat({ lastRun: NOW - REPEAT_MS - 1, lastInput: 0 }, NOW), false);
  assert.equal(isRepeat({ lastRun: 0, lastInput: 0 }, NOW), false);
});

await check("runOnce skips a repeat, staff force runs it", async () => {
  const db = fakeDb({
    verification_signals: [{ org_id: "o1", automatic: true, checked_at: iso(Date.now() - 30_000) }],
    documents: [{ org_id: "o1", created_at: iso(Date.now() - 60_000) }],
  });
  const steps = { read: async () => ({}), address: async () => ({}), photos: async () => ({}) };
  const skipped = await runOnce({ orgId: "o1", asServer: db, steps });
  assert.match(skipped.skipped, /two minutes/);
  const forced = await runOnce({ orgId: "o1", asServer: db, steps, force: true });
  assert.equal(forced.read.ran, true);
});

await check("two calls at once run once", async () => {
  let reads = 0;
  const db = fakeDb({});
  const steps = { read: async () => { reads += 1; await new Promise((r) => setTimeout(r, 50)); return {}; }, address: async () => ({}), photos: async () => ({}) };
  const [a, b] = await Promise.all([runOnce({ orgId: "o2", asServer: db, steps }), runOnce({ orgId: "o2", asServer: db, steps })]);
  assert.equal(reads, 1);
  assert.ok([a, b].some((r) => r.skipped === "already running"));
});

await check("cron picks: missing, older than an upload, stale; not fresh, not empty", async () => {
  assert.equal(needsRun({ lastRun: 0, lastInput: NOW - 1000 }, NOW), true, "missing");
  assert.equal(needsRun({ lastRun: NOW - 5000, lastInput: NOW - 1000 }, NOW), true, "upload since");
  assert.equal(needsRun({ lastRun: NOW - STALE_MS - 1, lastInput: NOW - STALE_MS - 9 }, NOW), true, "stale");
  assert.equal(needsRun({ lastRun: NOW - 1000, lastInput: NOW - 5000 }, NOW), false, "fresh");
  assert.equal(needsRun({ lastRun: 0, lastInput: 0 }, NOW), false, "nothing uploaded");
});

await check("cron runs only pending factories that need it, in a small batch", async () => {
  const pending = Array.from({ length: 7 }, (_, i) => ({ org_id: `p${i}`, verification_status: "pending" }));
  const db = fakeDb({
    factory_profiles: [...pending, { org_id: "v1", verification_status: "verified" }],
    documents: [...pending, { org_id: "v1" }].map(({ org_id }) => ({ org_id, created_at: iso(NOW - 3600_000) })),
    verification_signals: [{ org_id: "p0", automatic: true, checked_at: iso(NOW - 60_000) }],
  });
  const ran = [];
  const steps = { read: async ({ orgId }) => { ran.push(orgId); return {}; }, address: async () => ({}), photos: async () => ({}) };
  const { results } = await runCron({ asServer: db, steps, now: NOW });
  assert.equal(results.length, 4);
  assert.ok(!ran.includes("p0"), "fresh results are left alone");
  assert.ok(!ran.includes("v1"), "verified factories are left alone");
});

await check("callerRole: cron by secret, staff and members by the database", async () => {
  const env = { CRON_SECRET: "s3cret" };
  const get = (auth) => ({ method: "GET", headers: { authorization: auth } });
  assert.equal(await callerRole(get("Bearer s3cret"), null, { env }), "cron");
  assert.equal(await callerRole(get("Bearer nope"), null, { env }), null);
  assert.equal(await callerRole(get("Bearer s3cret"), null, { env: {} }), null, "no secret set: no cron");
  const client = (answers) => () => ({ rpc: async (name) => answers[name] ?? { data: null, error: { code: "42501" } } });
  const post = { method: "POST", headers: { authorization: "Bearer tok" } };
  assert.equal(await callerRole(post, "o1", { env, makeClient: client({ is_platform_admin: { data: true } }) }), "staff");
  assert.equal(await callerRole(post, "o1", { env, makeClient: client({ is_platform_admin: { data: false }, is_org_member: { data: true } }) }), "member");
  assert.equal(await callerRole(post, "o1", { env, makeClient: client({ is_platform_admin: { data: false }, is_org_member: { data: false } }) }), null);
  assert.equal(await callerRole({ method: "POST", headers: {} }, "o1", { env, makeClient: client({}) }), null, "no token");
  assert.equal(await callerRole({ method: "POST", headers: { authorization: "Bearer s3cret" } }, "o1", { env, makeClient: client({}) }), null, "the cron secret is not a POST pass");
});

await check("browser: a burst of uploads is one call, and nothing throws", async () => {
  const calls = [];
  const timers = [];
  const run = createVerificationRunner({
    getToken: async () => "tok",
    fetchImpl: async (url, init) => { calls.push([url, JSON.parse(init.body)]); throw new Error("offline"); },
    setTimer: (fn) => { timers.push(fn); return timers.length - 1; },
    clearTimer: (id) => { if (id !== undefined) timers[id] = null; },
  });
  run("o1"); run("o1"); run("o1"); run(null);
  timers.filter(Boolean).forEach((fn) => fn());
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(calls, [["/api/verification-run", { orgId: "o1" }]]);
});

if (failures) {
  console.log(`\n${failures} failed`);
  process.exit(1);
}
console.log("\ncheck:auto passed");
