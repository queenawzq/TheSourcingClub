/**
 * The verification checks, run automatically (Queena, Nov 11: no staff
 * buttons to press first).
 *
 * Who may call it:
 *   - a member of the company, with its own token, right after it uploads a
 *     licence or photos and when it sends its profile for review
 *     (`runVerification(orgId)` in src/lib/domain/verification-run.js);
 *   - TSC staff, with their own token (the review page fills in anything
 *     missing; `force: true` is "Run again");
 *   - Vercel's cron, with GET and `Authorization: Bearer $CRON_SECRET`, as
 *     api/cron-daily.js does: factories under review whose results are
 *     missing or older than their newest upload, a few per day.
 * Membership and staff are asked of the database with the caller's token
 * (`is_org_member`, `is_platform_admin`), never decided here.
 *
 * What it runs, with the server key: the licence reading, then the address
 * checks (they use the address the reading found), and beside them the photo
 * check. Each is a named export of its own module, loaded when called: a
 * missing export is skipped and named in the answer, and a step that throws
 * or takes too long never stops the others. The steps record their own
 * results; this only starts them and says what happened.
 *
 * A burst of uploads runs once: a company whose automatic results are under
 * two minutes old, and newer than everything it has uploaded since, is not
 * run again (staff can force it). The browser also waits a moment after the
 * last upload before asking.
 */
import { createClient } from "@supabase/supabase-js";
import { supabaseServerEnv } from "./_supabase-env.js";

// Same ceiling as api/profile-translation.js; vercel.json sets none.
export const config = { maxDuration: 60 };

export const REPEAT_MS = 2 * 60_000;
// One company's run must answer before the function's ceiling.
export const RUN_BUDGET_MS = 50_000;
// The cron: a few companies, one after another, inside the same ceiling.
export const CRON_BATCH = 4;
export const CRON_BUDGET_MS = 45_000;
// Results older than this are run again by the cron even with no new upload.
export const STALE_MS = 14 * 24 * 60 * 60_000;

/** The three steps: [name, module loader, export name]. */
export const STEPS = {
  read: { load: () => import("./registry-assist.js"), name: "runReadDocument" },
  address: { load: () => import("./registry-assist.js"), name: "runAddressCheck" },
  photos: { load: () => import("./photo-check.js"), name: "runPhotoCheck" },
};

/** The step functions that exist; a missing one is null. Never throws. */
export async function loadSteps(steps = STEPS) {
  const found = {};
  for (const [key, { load, name }] of Object.entries(steps)) {
    try {
      const module = await load();
      found[key] = typeof module?.[name] === "function" ? module[name] : null;
    } catch (error) {
      console.error("verification-run: load", key, error?.message);
      found[key] = null;
    }
  }
  return found;
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((resolve) => { timer = setTimeout(() => resolve({ timedOut: true }), ms); }),
  ]).finally(() => clearTimeout(timer));
}

/** One step's outcome in a word or two, for the answer and the logs. */
function outcome(result) {
  if (result?.timedOut) return { ran: false, reason: "took too long" };
  if (result && result.available === false) return { ran: false, reason: String(result.reason ?? "not available") };
  return { ran: true, ...(result?.repeated ? { repeated: true } : {}) };
}

async function runStep(fn, args, ms) {
  if (!fn) return { ran: false, reason: "not built yet" };
  try {
    return outcome(await withTimeout(Promise.resolve().then(() => fn(args)), ms));
  } catch (error) {
    console.error("verification-run: step failed", error?.message);
    return { ran: false, reason: "failed" };
  }
}

/**
 * Runs the three steps for one company. The reading comes before the address
 * check; the photo check runs beside them. Never throws.
 */
export async function runAll({ orgId, asServer, requestedBy = null, force = false, steps, budgetMs = RUN_BUDGET_MS }) {
  const started = Date.now();
  const fns = steps ?? (await loadSteps());
  const args = { orgId, asServer, requestedBy, force };
  const left = () => Math.max(1000, budgetMs - (Date.now() - started));
  const chain = (async () => {
    const read = await runStep(fns.read, args, left());
    const address = await runStep(fns.address, args, left());
    return { read, address };
  })();
  const [{ read, address }, photos] = await Promise.all([chain, runStep(fns.photos, args, budgetMs)]);
  return { orgId, read, address, photos, ms: Date.now() - started };
}

const time = (value) => (value ? new Date(value).getTime() : 0);

/**
 * When the company's automatic results were last written and when it last
 * gave us something new to check. Reads with the server key; a failed read
 * counts as "never", so it errs towards running.
 */
export async function lastRunAndInput(asServer, orgId) {
  const [signal, photo, doc, profile] = await Promise.all([
    asServer.from("verification_signals").select("checked_at").eq("org_id", orgId).eq("automatic", true)
      .order("checked_at", { ascending: false }).limit(1).maybeSingle(),
    asServer.from("photo_checks").select("created_at").eq("org_id", orgId)
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
    asServer.from("documents").select("created_at").eq("org_id", orgId)
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
    asServer.from("factory_profiles").select("updated_at").eq("org_id", orgId).maybeSingle(),
  ]);
  return {
    lastRun: Math.max(time(signal.data?.checked_at), time(photo.data?.created_at)),
    lastInput: Math.max(time(doc.data?.created_at), time(profile.data?.updated_at)),
  };
}

/** True when a run now would only repeat one that just happened. */
export function isRepeat({ lastRun, lastInput }, now = Date.now()) {
  return Boolean(lastRun) && now - lastRun < REPEAT_MS && lastRun >= lastInput;
}

/** True when the cron should run this company: results missing, older than an upload, or old. */
export function needsRun({ lastRun, lastInput }, now = Date.now()) {
  if (!lastInput) return false; // nothing uploaded: nothing to check
  return !lastRun || lastRun < lastInput || now - lastRun > STALE_MS;
}

// Runs in progress on this instance, so two calls at once run once.
const running = new Map();

export async function runOnce({ orgId, asServer, requestedBy, force, steps, now = Date.now() }) {
  if (running.has(orgId)) return { orgId, skipped: "already running" };
  // Claimed before the first await, so a second call at once sees it.
  running.set(orgId, true);
  try {
    if (!force) {
      const stamps = await lastRunAndInput(asServer, orgId).catch(() => ({ lastRun: 0, lastInput: 0 }));
      if (isRepeat(stamps, now)) return { orgId, skipped: "ran in the last two minutes" };
    }
    return await runAll({ orgId, asServer, requestedBy, force, steps });
  } finally {
    running.delete(orgId);
  }
}

/** The cron's pick: factories under review that need a run, longest-waiting first. */
export async function pickForCron(asServer, now = Date.now(), batch = CRON_BATCH) {
  const { data, error } = await asServer.from("factory_profiles").select("org_id")
    .eq("verification_status", "pending").limit(200);
  if (error) throw error;
  const rows = [];
  for (const { org_id: orgId } of data ?? []) {
    const stamps = await lastRunAndInput(asServer, orgId).catch(() => null);
    if (stamps && needsRun(stamps, now)) rows.push({ orgId, lastRun: stamps.lastRun });
  }
  return rows.sort((a, b) => a.lastRun - b.lastRun).slice(0, batch).map((row) => row.orgId);
}

export async function runCron({ asServer, steps, now = Date.now(), budgetMs = CRON_BUDGET_MS }) {
  const started = Date.now();
  const orgIds = await pickForCron(asServer, now);
  const results = [];
  for (const orgId of orgIds) {
    const left = budgetMs - (Date.now() - started);
    if (left < 5000) {
      results.push({ orgId, skipped: "out of time; next run" });
      continue;
    }
    results.push(await runAll({ orgId, asServer, requestedBy: null, steps, budgetMs: left }));
  }
  return { cron: true, results };
}

function bodyOf(request) {
  if (request.body && typeof request.body === "object" && !Buffer.isBuffer(request.body)) return request.body;
  try {
    return JSON.parse(Buffer.isBuffer(request.body) ? request.body.toString("utf8") : request.body || "{}");
  } catch {
    return {};
  }
}

/** The user id a token names, unverified: the database has verified it by the time this is used. */
function tokenSubject(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
    return typeof payload?.sub === "string" && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
}

/**
 * Who is asking: "cron", "staff", "member" or null. The `make` arguments
 * let the check script run it without a database.
 */
export async function callerRole(request, orgId, { supabaseUrl, anonKey, env = process.env, makeClient = createClient } = {}) {
  const authorization = String(request.headers?.authorization ?? "");
  const cronSecret = env.CRON_SECRET;
  if (request.method === "GET") {
    return cronSecret && authorization === `Bearer ${cronSecret}` ? "cron" : null;
  }
  if (!/^Bearer\s+\S/i.test(authorization)) return null;
  const asCaller = makeClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data: staff, error: staffError } = await asCaller.rpc("is_platform_admin");
  if (!staffError && staff === true) return "staff";
  if (!orgId) return null;
  const { data: member, error: memberError } = await asCaller.rpc("is_org_member", { target_org: orgId });
  return !memberError && member === true ? "member" : null;
}

export default async function handler(request, response) {
  if (request.method !== "GET" && request.method !== "POST") {
    response.status(405).json({ error: "method not allowed" });
    return;
  }
  const { supabaseUrl, anonKey, serviceKey } = supabaseServerEnv();
  if (!supabaseUrl || !anonKey || !serviceKey) {
    response.status(200).json({ available: false, reason: "The server is not set up for this." });
    return;
  }
  const body = request.method === "POST" ? bodyOf(request) : {};
  const orgId = typeof body.orgId === "string" ? body.orgId : null;

  let role = null;
  try {
    role = await callerRole(request, orgId, { supabaseUrl, anonKey });
  } catch (error) {
    console.error("verification-run: caller", error?.message);
  }
  if (!role) {
    response.status(401).json({ error: "Sign in again, then retry." });
    return;
  }
  const asServer = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    if (role === "cron") {
      response.status(200).json(await runCron({ asServer }));
      return;
    }
    if (!orgId) {
      response.status(400).json({ error: "Which company?" });
      return;
    }
    // A member's run is automatic: nobody "checked" it. Staff are named.
    const token = String(request.headers.authorization).replace(/^Bearer\s+/i, "");
    const requestedBy = role === "staff" ? tokenSubject(token) : null;
    const force = role === "staff" && body.force === true;
    response.status(200).json(await runOnce({ orgId, asServer, requestedBy, force }));
  } catch (error) {
    console.error("verification-run", error?.message);
    response.status(200).json({ available: false, reason: "The checks could not run. They will run again later." });
  }
}
