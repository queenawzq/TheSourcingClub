/**
 * Run again (staff verification review, Nov 12): one group's automatic
 * checks, run again with the fields staff edited under "What the AI read".
 *
 *   POST { orgId, group, fields, subjectId? }   staff token
 *     group: business_registration | company_information | certification
 *     fields: only the fields staff edited, in the contract's keys
 *             (src/shared/verification-rerun.mjs GROUP_FIELDS)
 *   → 200 { ok: true, group, ran, outOfDate }
 *   → 200 { ok: false, code, error, ran }  error = the footer's words
 *   → 401 / 403 { ok: false, code, error } signed out / not staff
 *
 * The admin test is the first thing done, before any read: the caller's own
 * token asks the database (`is_platform_admin`), never decided here. Staff in
 * the company itself are refused as every admin verification function does.
 *
 * What each group runs, recording the results the way the automatic run does
 * (verification-run.js), so the score reads them like any other run:
 *   business_registration: the reading (from the file when the reading of
 *     record is out of date or nothing was edited, else the reading of record
 *     with the edits laid over it; no model call), an edited number saved as
 *     the staff number (`admin_set_registration_number`), and for Portugal
 *     EU VIES asked again. China's QCC and Turkey's GİB are recorded by staff:
 *     nothing here can ask them.
 *   company_information: an edited business scope is laid over the reading;
 *     the address checks with the address staff entered, and the photo check.
 *   certification: the certificate's number, date and holder as staff edited
 *     them, checked against today's date and the company's name.
 * Who edited which field, and the value before, is kept in
 * `verification_field_edits` (`record_verification_field_edits`, as the staff
 * member), before anything runs.
 */
import { createClient } from "@supabase/supabase-js";
import { supabaseServerEnv } from "./_supabase-env.js";

export const config = { maxDuration: 60 };

// Inside the function's ceiling, with room to answer.
export const RERUN_BUDGET_MS = 45_000;

// Vercel compiles api/*.js as CommonJS; ESM helpers are imported lazily.
const loadRules = () => import("../src/shared/verification-rerun.mjs");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((resolve) => { timer = setTimeout(() => resolve({ timedOut: true }), ms); }),
  ]).finally(() => clearTimeout(timer));
}

/** Default step implementations; the check script passes its own. */
export const STEPS = {
  registryAssist: () => import("./registry-assist.js"),
  photoCheck: () => import("./photo-check.js"),
  vies: () => import("./registry-vies.js"),
};

/** The reading of record: the newest document_reading signal. */
async function latestReading(asServer, orgId) {
  const { data } = await asServer.from("verification_signals").select("kind, subject_id, details, automatic, checked_at")
    .eq("org_id", orgId).eq("kind", "document_reading").order("checked_at", { ascending: false }).limit(1);
  const row = Array.isArray(data) ? data[0] : null;
  return row ? { kind: row.kind, subjectId: row.subject_id, details: row.details ?? {}, automatic: row.automatic, checkedAt: row.checked_at } : null;
}

/** The reading's fields in the contract's keys, for "the value before". */
function readingValues(reading, READING_KEYS) {
  const extracted = reading?.details?.extracted ?? {};
  const out = {};
  for (const [field, key] of Object.entries(READING_KEYS)) {
    const value = extracted[key];
    if (value == null) continue;
    out[field] = Array.isArray(value) ? value.join("\n") : String(value);
  }
  if (out.number == null && reading?.details?.numberAtReading) out.number = reading.details.numberAtReading;
  return out;
}

/**
 * The staff edits a new reading carries: the ones the reading of record
 * already had (only when it was read from the same file), then today's.
 * In the reading's own keys: [{ key, value, field }].
 */
export function standingEdits({ previous, fileId, edits, READING_KEYS }) {
  const carried = previous?.details?.fileId && previous.details.fileId === fileId ? previous.details.staffEdits ?? [] : [];
  const byField = new Map();
  for (const edit of [...carried, ...edits]) {
    if (!READING_KEYS[edit.field]) continue;
    byField.set(edit.field, { field: edit.field, from: edit.from ?? null, to: edit.to });
  }
  return [...byField.values()];
}

/**
 * The reading step, shared by business_registration and company_information.
 * Returns `{ ran, code? }`.
 */
async function readingStep({ orgId, asServer, requestedBy, edits, mustRead, steps, rules }) {
  const assist = await steps.registryAssist();
  const context = await assist.readingContext(asServer, orgId);
  if (!context) return { ran: false, code: "file_unreadable" };
  const previous = await latestReading(asServer, orgId);
  const newest = context.files[0] ?? null;
  const outOfDate = rules.readingOutOfDate({ reading: previous, newestFile: newest, number: context.detail.registration.number, title: context.detail.title });
  const fromFile = mustRead || !previous || (outOfDate && ["earlier_upload", "never_read"].includes(outOfDate.reason));
  const fileId = fromFile ? newest?.id ?? null : previous?.details?.fileId ?? null;
  const staffEdits = standingEdits({ previous, fileId, edits, READING_KEYS: rules.READING_KEYS });
  const overlay = staffEdits.map((edit) => ({ key: rules.READING_KEYS[edit.field], value: edit.to }));
  const extraDetails = { staffEdits, rerunBy: requestedBy, rerunAt: new Date().toISOString(), rerunFrom: fromFile ? "file" : "reading" };
  if (fromFile && !newest) return { ran: false, code: "no_file" };
  const answer = fromFile
    ? await assist.runReadDocument({ orgId, asServer, requestedBy, edits: overlay, extraDetails, keepIfWorse: previous ? { previous, worse: rules.worseReading } : null })
    : await assist.rereadWithEdits({ orgId, detail: context.detail, signals: context.signals, reading: previous, asServer, requestedBy, edits: overlay, extraDetails });
  // A worse reading was not saved: the stored one, its fields and the score stay as they were.
  if (answer?.kept) return { ran: false, code: "kept_reading" };
  // The model failing to read at all also keeps the stored reading (nothing was saved).
  if (answer?.available === false) return { ran: false, code: rules.failureCode(answer.reason) };
  if (answer?.saved === false) return { ran: false, code: "save_failed" };
  return { ran: true, from: extraDetails.rerunFrom, outOfDateBefore: outOfDate };
}

/** Portugal only: EU VIES asked again for the number on record. */
async function viesStep({ orgId, asServer, requestedBy, steps }) {
  const { data: registration } = await asServer.from("company_registrations").select("country_code, number").eq("org_id", orgId).maybeSingle();
  if (!registration || registration.country_code !== "PT" || !registration.number) return { ran: false, skipped: "no automatic registry" };
  // The last real VIES answer: kept unless the number changed since it was asked (a staff edit or a new reading).
  const { data: lastRows } = await asServer.from("registry_checks").select("result, number_checked").eq("org_id", orgId).eq("source", "vies")
    .eq("automatic", true).neq("result", "could_not_check").order("checked_at", { ascending: false }).limit(1);
  const last = Array.isArray(lastRows) ? lastRows[0] ?? null : null;
  const reading = await latestReading(asServer, orgId);
  const readNumber = reading?.details?.extracted?.registrationNumber ?? null;
  if (!viesNeedsAsking({ number: registration.number, readNumber, last })) return { ran: true, kept: true, result: last.result };
  const { askVies } = await steps.vies();
  const outcome = await askVies(registration.number);
  // A re-query that errors keeps the last answer: only a real answer is recorded over one.
  if (outcome.result === "could_not_check" && last) return { ran: true, code: "registry_unreachable", source: "EU VIES", kept: true };
  const { error } = await asServer.rpc("record_registry_check", {
    target_org: orgId, number_checked: registration.number, source: "vies",
    result: outcome.result, details: outcome.details ?? {}, requested_by: requestedBy,
  });
  if (error) return { ran: false, code: "save_failed" };
  if (outcome.result === "could_not_check") return { ran: true, code: "registry_unreachable", source: "EU VIES" };
  return { ran: true, result: outcome.result };
}

const plainNumber = (value) => String(value ?? "").replace(/[^0-9A-Za-z]/g, "").replace(/^PT/i, "");

/**
 * Whether Run again asks EU VIES again: only when there is no earlier answer,
 * or the number changed since it was asked (staff edited it, or a new reading
 * read another one). Otherwise the last answer stands.
 */
export function viesNeedsAsking({ number, readNumber = null, last = null }) {
  if (!last) return true;
  const asked = plainNumber(last.number_checked);
  if (plainNumber(number) !== asked) return true;
  return Boolean(readNumber) && plainNumber(readNumber) !== asked;
}

/** The address checks; the words when the map could not place it. */
export function addressOutcome(answer) {
  if (!answer || answer.timedOut) return { ran: false, code: "map_unreachable" };
  if (answer.available === false) return { ran: false, code: /saved/.test(String(answer.reason)) ? "save_failed" : "map_unreachable" };
  if (!answer.address) return { ran: true, code: "no_address" };
  if (answer.found === false) return { ran: true, code: answer.lookupFailed ? "map_unreachable" : "address_not_found" };
  return { ran: true, judgement: answer.judgement ?? "unknown" };
}

const LATEST_SITE_ADDRESS = async (asServer, orgId) => {
  const { data } = await asServer.from("verification_field_edits").select("value_after")
    .eq("org_id", orgId).eq("group_key", "company_information").eq("field_key", "siteAddress")
    .order("edited_at", { ascending: false }).limit(1);
  return Array.isArray(data) && data[0] ? data[0].value_after : "";
};

/** Runs one group. Never throws: `{ ok, code?, source?, ran }`. */
export async function runGroup({ orgId, group, fields, edits, asServer, requestedBy, subjectId = null, steps = STEPS, rules, budgetMs = RERUN_BUDGET_MS }) {
  const ran = {};
  const started = Date.now();
  const left = () => Math.max(1000, budgetMs - (Date.now() - started));
  const timed = async (name, promise, timeoutCode) => {
    const answer = await withTimeout(promise.catch((error) => {
      console.error("verification-rerun", name, error?.message);
      return { ran: false, code: "failed" };
    }), left());
    ran[name] = answer?.timedOut ? { ran: false, code: timeoutCode } : answer;
    return ran[name];
  };
  if (group === "business_registration") {
    await timed("reading", readingStep({ orgId, asServer, requestedBy, edits, mustRead: edits.length === 0, steps, rules }), "ai_timeout");
    await timed("registry", viesStep({ orgId, asServer, requestedBy, steps }), "registry_unreachable");
    if (ran.registry?.code === "registry_unreachable") ran.registry.source = "EU VIES";
  } else if (group === "company_information") {
    const scopeEdits = edits.filter((edit) => edit.field === "scope");
    if (scopeEdits.length) {
      await timed("reading", readingStep({ orgId, asServer, requestedBy, edits: scopeEdits, mustRead: false, steps, rules }), "ai_timeout");
    }
    const siteAddress = fields.siteAddress ?? (await LATEST_SITE_ADDRESS(asServer, orgId).catch(() => ""));
    const assist = await steps.registryAssist();
    const { runPhotoCheck } = await steps.photoCheck();
    await Promise.all([
      timed("address", assist.runAddressCheck({ orgId, asServer, requestedBy, siteAddress, keepIfFailed: true, extraDetails: { rerunBy: requestedBy, rerunAt: new Date().toISOString() } }).then(addressOutcome), "map_unreachable"),
      timed("photos", runPhotoCheck({ orgId, asServer, requestedBy }).then((answer) => (answer?.available === false ? { ran: false, code: "photos_failed" } : { ran: true })), "photos_failed"),
    ]);
  } else if (group === "certification") {
    await timed("certificate", certificateStep({ orgId, asServer, requestedBy, fields, edits, subjectId }), "failed");
  }
  // The first failure, in the order the steps matter to the score.
  const failed = ["reading", "registry", "address", "photos", "certificate"].map((name) => ran[name]).find((step) => step?.code);
  if (failed) return { ok: false, code: failed.code, source: failed.source ?? null, ran };
  return { ok: true, ran };
}

/**
 * The certificate as staff edited it, against today's date and the company's
 * name, recorded as an automatic `certificate` signal (result "read"). Staff's
 * own records (found / expired / …) are the non-automatic ones.
 */
async function certificateStep({ orgId, asServer, requestedBy, fields, edits, subjectId }) {
  let query = asServer.from("factory_certifications").select("id, expires_at, created_at").eq("org_id", orgId);
  if (subjectId) query = query.eq("id", subjectId);
  const { data: certs } = await query.order("created_at", { ascending: false }).limit(1);
  const cert = Array.isArray(certs) ? certs[0] : null;
  if (!cert) return { ran: false, code: "no_certificate" };
  const { data: prior } = await asServer.from("verification_signals").select("details")
    .eq("org_id", orgId).eq("kind", "certificate").eq("subject_id", cert.id).eq("automatic", true)
    .order("checked_at", { ascending: false }).limit(1);
  const before = (Array.isArray(prior) && prior[0]?.details) || {};
  const value = (key, fallback = "") => fields[key] ?? before[key] ?? fallback;
  const certNumber = value("certNumber");
  const validUntil = value("validUntil", cert.expires_at ?? "");
  const holder = value("holder");
  const today = new Date().toISOString().slice(0, 10);
  const expired = validUntil ? validUntil < today : null;
  let holderMatches = null;
  if (holder) {
    const { data: title } = await asServer.rpc("company_title", { target_org: orgId });
    if (title) {
      const { data, error } = await asServer.rpc("company_names_match", { a: holder, b: title });
      if (!error && typeof data === "boolean") holderMatches = data;
    }
  }
  const staffEdits = [...(before.staffEdits ?? []).filter((edit) => !edits.some((e) => e.field === edit.field)), ...edits];
  const details = { certNumber, validUntil, holder, expired, holderMatches, staffEdits, rerunBy: requestedBy, rerunAt: new Date().toISOString() };
  const { error } = await asServer.rpc("record_verification_signal", {
    target_org: orgId, kind: "certificate", subject: cert.id, result: "read", details, requested_by: requestedBy,
  });
  if (error) return { ran: false, code: "save_failed" };
  return { ran: true, expired, holderMatches };
}

/** The "value before" for each field of a group, from what is on record. */
async function currentValues({ group, orgId, asServer, rules, subjectId }) {
  if (group === "certification") {
    let query = asServer.from("verification_signals").select("details").eq("org_id", orgId).eq("kind", "certificate").eq("automatic", true);
    if (subjectId) query = query.eq("subject_id", subjectId);
    const { data } = await query.order("checked_at", { ascending: false }).limit(1);
    const details = (Array.isArray(data) && data[0]?.details) || {};
    return { certNumber: details.certNumber, validUntil: details.validUntil, holder: details.holder };
  }
  const reading = await latestReading(asServer, orgId);
  const values = readingValues(reading, rules.READING_KEYS);
  if (group === "business_registration") {
    // The number the screen shows: the reading's when it has one, else the one on record
    // (verification-score.mjs: `x.registrationNumber || reg.number`). Comparing with the
    // record alone dropped an edit back to the typed number as "no change".
    const { data } = await asServer.from("company_registrations").select("number").eq("org_id", orgId).maybeSingle();
    if (data?.number && !values.number) values.number = data.number;
    return values;
  }
  return { scope: values.scope, siteAddress: (await LATEST_SITE_ADDRESS(asServer, orgId).catch(() => "")) || null };
}

// Groups running on this instance, so a double press runs once.
const running = new Set();

function fail(response, status, code, rules, extra = {}) {
  response.status(status).json({ ok: false, code, error: rules.rerunFailureWords(code, extra), ...extra });
}

export default function handler(request, response) {
  return handle(request, response);
}

/** The route, with its clients passed in so the check script can drive it. */
export async function handle(request, response, { env = supabaseServerEnv(), makeClient = createClient, steps = STEPS } = {}) {
  const rules = await loadRules();
  if (request.method !== "POST") {
    response.status(405).json({ ok: false, code: "bad_request", error: rules.rerunFailureWords("bad_request") });
    return;
  }
  const { supabaseUrl, anonKey, serviceKey } = env;
  if (!supabaseUrl || !anonKey || !serviceKey) return fail(response, 200, "not_set_up", rules);

  const authorization = String(request.headers?.authorization ?? "");
  if (!/^Bearer\s+\S/i.test(authorization)) return fail(response, 401, "signed_out", rules);
  const asCaller = makeClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });

  // Staff only, asked first: nothing is read before this answers.
  const { data: staff, error: staffError } = await asCaller.rpc("is_platform_admin");
  if (staffError) return fail(response, 401, "signed_out", rules);
  if (staff !== true) return fail(response, 403, "not_staff", rules);

  const { orgId, group, fields = {}, subjectId = null } = bodyOf(request);
  if (typeof orgId !== "string" || !UUID.test(orgId) || (subjectId != null && !UUID.test(String(subjectId)))) return fail(response, 400, "bad_request", rules);
  const checked = rules.checkFields(group, fields);
  if (checked.code) return fail(response, 400, checked.code, rules, checked.field ? { field: checked.field } : {});

  // Staff who belong to the company don't review it.
  const { data: member } = await asCaller.rpc("is_org_member", { target_org: orgId });
  if (member === true) return fail(response, 403, "not_staff", rules);

  const key = `${orgId}:${group}`;
  if (running.has(key)) return fail(response, 409, "busy", rules);
  running.add(key);
  try {
    const asServer = makeClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const requestedBy = tokenSubject(authorization.replace(/^Bearer\s+/i, ""));
    const current = await currentValues({ group, orgId, asServer, rules, subjectId });
    const edits = rules.editsFrom(checked.fields, current);

    // An edited number is the staff number, saved as the staff member.
    const numberEdit = group === "business_registration" ? edits.find((edit) => edit.field === "number") : null;
    if (numberEdit) {
      // A Hong Kong CR typed over a mainland reading (or back) moves the country with it.
      const { data: registration } = await asServer.from("company_registrations").select("country_code").eq("org_id", orgId).maybeSingle();
      const country = rules.numberCountry ? rules.numberCountry(numberEdit.to, registration?.country_code) : null;
      const { error } = await asCaller.rpc("admin_set_registration_number", {
        target_org: orgId, number: numberEdit.to, note: "Edited under What the AI read, then Run again", country,
      });
      if (error) return fail(response, 200, error.code === "22023" ? "bad_number" : error.code === "42501" ? "not_staff" : "save_failed", rules);
    }
    if (edits.length) {
      const { error } = await asCaller.rpc("record_verification_field_edits", { target_org: orgId, group_key: group, edits });
      if (error) return fail(response, 200, error.code === "42501" ? "not_staff" : "save_failed", rules);
    }

    const result = await runGroup({ orgId, group, fields: checked.fields, edits, asServer, requestedBy, subjectId, rules, steps });
    let outOfDate = null;
    if (group !== "certification") {
      const assist = await steps.registryAssist();
      const context = await assist.readingContext(asServer, orgId).catch(() => null);
      if (context) {
        const reading = await latestReading(asServer, orgId);
        outOfDate = rules.readingOutOfDate({ reading, newestFile: context.files[0], number: context.detail.registration.number, title: context.detail.title });
      }
    }
    const body = { ok: result.ok, group, ran: result.ran, edits: edits.map(({ field }) => field), outOfDate };
    if (!result.ok) Object.assign(body, { code: result.code, error: rules.rerunFailureWords(result.code, { source: result.source }) });
    response.status(200).json(body);
  } catch (error) {
    console.error("verification-rerun", error?.message);
    fail(response, 200, "failed", rules);
  } finally {
    running.delete(key);
  }
}
