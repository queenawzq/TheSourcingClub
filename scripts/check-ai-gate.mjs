/**
 * check:ai-gate — every route a brand or a factory can call that spends the
 * model key asks api/_ai-gate.js who is asking and counts an hourly budget.
 * The budget guards cost, not access: a limiter that cannot answer lets the
 * call through, and screening a message past its budget falls back to the
 * patterns instead of refusing the send.
 *
 * Runs with no database and no network.
 */
import { readFileSync } from "node:fs";

let fetched = 0;
globalThis.fetch = async () => {
  fetched += 1;
  throw new Error("no network in this check");
};

const { aiBudget, aiCaller, tokenSubject } = await import("../api/_ai-gate.js");

let failures = 0;
const check = (ok, label) => { if (!ok) { failures += 1; console.log(`FAIL ${label}`); } };
const quiet = async (run) => {
  const error = console.error;
  console.error = () => {};
  try { return await run(); } finally { console.error = error; }
};

const user = "11111111-1111-1111-1111-111111111111";
const token = `x.${Buffer.from(JSON.stringify({ sub: user })).toString("base64url")}.y`;
check(tokenSubject(token) === user, "a token's subject is read");
check(tokenSubject("not-a-token") === null && tokenSubject("") === null && tokenSubject(undefined) === null, "a garbled, empty or missing token names nobody");

const env = { SUPABASE_URL: "http://db.test", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service" };
const signedOut = await aiCaller({ headers: {} }, { side: "brand", env });
check(signedOut.refused?.[0] === 401, "signed out is refused with 401");
const garbled = await aiCaller({ headers: { authorization: "Bearer nope" } }, { side: "factory", env });
check(garbled.refused?.[0] === 401, "a token that names nobody is refused with 401");
check(fetched === 0, "neither reached the database");

// A fake database: memberships, permissions and the limiter, as answers.
function fakeClient({ memberships = [], membershipError = null, permission = true, limiter = { data: true } } = {}) {
  return () => ({
    from: () => ({ select: () => ({ eq: async () => ({ data: memberships, error: membershipError }) }) }),
    rpc: async (name) => (name === "has_org_permission" ? { data: permission, error: null } : limiter),
  });
}
const request = { headers: { authorization: `Bearer ${token}` } };
const brandRow = { org_id: "b", orgs: { type: "brand" } };
const factoryRow = { org_id: "f", orgs: { type: "factory" } };

let who = await aiCaller(request, { side: "brand", env, makeClient: fakeClient({ memberships: [brandRow] }) });
check(who.userId === user && !who.refused, "a brand member passes the brand gate");
who = await aiCaller(request, { side: "brand", env, makeClient: fakeClient({ memberships: [factoryRow] }) });
check(who.refused?.[0] === 403, "a factory member is refused at the brand gate");
who = await aiCaller(request, { side: "brand", permission: "rfqFlow", env, makeClient: fakeClient({ memberships: [brandRow], permission: false }) });
check(who.refused?.[0] === 403, "a brand member without the permission is refused");
// A permission check that fails is not a "no".
function failingPermission(error) {
  return () => ({
    from: () => ({ select: () => ({ eq: async () => ({ data: [brandRow], error: null }) }) }),
    rpc: async () => ({ data: null, error }),
  });
}
who = await aiCaller(request, { side: "brand", permission: "rfqFlow", env, makeClient: failingPermission({ code: "PGRST301", message: "JWT expired" }) });
check(who.refused?.[0] === 401, "an expired sign-in during the permission check is 401, not 403");
who = await quiet(() => aiCaller(request, { side: "brand", permission: "rfqFlow", env, makeClient: failingPermission({ code: "XX000", message: "boom" }) }));
check(who.refused?.[0] === 503, "a permission check that fails is 'could not check', not 403");
who = await aiCaller(request, { side: "factory", env, makeClient: fakeClient({ membershipError: { code: "PGRST301", message: "JWT expired" } }) });
check(who.refused?.[0] === 401, "an expired sign-in is refused as one");
who = await quiet(() => aiCaller(request, { side: "factory", env, makeClient: fakeClient({ membershipError: { code: "XX000", message: "boom" } }) }));
check(who.refused?.[0] === 503, "a membership read that fails is 'could not check', not a sign-in problem");
who = await quiet(() => aiCaller(request, { side: "brand", env: {}, makeClient: fakeClient() }));
check(who.refused?.[0] === 503, "no database settings is refused, and said");

const gate = (limiter) => ({ userId: user, service: fakeClient({ limiter })() });
check(await aiBudget(gate({ data: true }), "x", 10) === "ok", "under budget: ok");
check(await aiBudget(gate({ data: false }), "x", 10) === "over", "over budget: over");
check(await quiet(() => aiBudget(gate({ data: null, error: { message: "down" } }), "x", 10)) === "ok", "a limiter that errors lets the call through");
check(await quiet(() => aiBudget({ userId: user, service: null }, "x", 10)) === "ok", "no server key lets the call through");

// Every user-facing AI route uses the gate and keeps no copy of its own.
const ROUTES = ["generate-brief", "parse-capacity-window", "profile-translation", "content-translation", "screen-message"];
for (const route of ROUTES) {
  const source = readFileSync(new URL(`../api/${route}.js`, import.meta.url), "utf8");
  check(/from "\.\/_ai-gate\.js"/.test(source), `${route} uses api/_ai-gate.js`);
  check(!/function tokenSubject\(/.test(source), `${route} keeps no tokenSubject of its own`);
  check(/aiBudget\(/.test(source), `${route} counts an hourly budget`);
}
// Past the budget, a message only the model could judge waits; it is never
// delivered unjudged, or spending the budget would switch the check off.
const { pastBudget } = await import("../api/screen-message.js");
check(pastBudget({ patternHit: false, contract: false }) === "wait", "past budget, a message only the model can judge stays checking");
check(pastBudget({ patternHit: true, contract: false }) === "untranslated", "past budget, a pattern hit is still decided by the patterns");
check(pastBudget({ patternHit: false, contract: true }) === "untranslated", "past budget, a thread with a contract is still delivered, untranslated");

if (failures) {
  console.log(`check:ai-gate: ${failures} failed`);
  process.exit(1);
}
console.log(`check:ai-gate: ${ROUTES.length} AI routes ask one gate and count an hourly budget`);
