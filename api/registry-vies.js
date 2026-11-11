/**
 * Look a Portuguese company up on the EU's VIES service and record what it
 * said (migration 20261108600000, `registry_checks`).
 *
 * Asked by the factory's page right after it saves a Portuguese number, and by
 * staff's "Check on VIES". The caller is checked through the database with
 * their own token (`can_request_registry_check`: staff, or the company's own
 * members), never `auth.getUser()`, for the reason CLAUDE.md gives under
 * Conversations. The number is read from `company_registrations` here, never
 * taken from the request, so a member can only look up what it saved.
 *
 * Nothing is ever refused by this: VIES down, slow or saying "invalid" is
 * recorded ("could_not_check" / "not_found") for a person to decide on.
 * VIES answers for VAT-registered companies only, so "not found" is a reason
 * to look, not a verdict.
 */
import { createClient } from "@supabase/supabase-js";
import { supabaseServerEnv } from "./_supabase-env.js";

const VIES_URL = process.env.VIES_API_URL ?? "https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number";
const TIMEOUT_MS = 8000;
// The same number is not sent again within this window, unless staff ask.
const REPEAT_MS = 10 * 60 * 1000;

function json(response, status, body) {
  response.status(status).json(body);
}

function bodyOf(request) {
  if (request.body && typeof request.body === "object" && !Buffer.isBuffer(request.body)) return request.body;
  try {
    return JSON.parse(Buffer.isBuffer(request.body) ? request.body.toString("utf8") : request.body || "{}");
  } catch {
    return {};
  }
}

/** VIES's answer as one of our results. Exported for the check script. */
export function viesResult(answer) {
  if (!answer || typeof answer !== "object") return { result: "could_not_check", reason: "no answer" };
  const valid = answer.valid ?? answer.isValid;
  // A valid number says a VAT registration exists, not that it is this
  // company's: "registered", with the name VIES gives, for staff to compare.
  if (valid === true) {
    return {
      result: "registered",
      details: {
        name: typeof answer.name === "string" && answer.name !== "---" ? answer.name : null,
        address: typeof answer.address === "string" && answer.address !== "---" ? answer.address : null,
        requestDate: answer.requestDate ?? null,
      },
    };
  }
  if (valid === false && (!answer.userError || answer.userError === "INVALID")) return { result: "not_found", details: {} };
  return { result: "could_not_check", details: { reason: String(answer.userError ?? answer.errorWrappers?.[0]?.error ?? "unavailable") } };
}

export async function askVies(number, fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const reply = await fetchImpl(VIES_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ countryCode: "PT", vatNumber: number }),
      signal: controller.signal,
    });
    const answer = await reply.json().catch(() => null);
    if (!reply.ok && !answer) return { result: "could_not_check", details: { reason: `HTTP ${reply.status}` } };
    return viesResult(answer);
  } catch (error) {
    return { result: "could_not_check", details: { reason: error?.name === "AbortError" ? "timed out" : "unreachable" } };
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(request, response) {
  if (request.method !== "POST") return json(response, 405, { error: "method not allowed" });

  const { supabaseUrl, anonKey, serviceKey } = supabaseServerEnv();
  if (!supabaseUrl || !anonKey || !serviceKey) return json(response, 503, { error: "registry checks aren't set up on this site" });

  const token = String(request.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json(response, 401, { error: "sign in is required" });
  const { orgId, force } = bodyOf(request);
  if (typeof orgId !== "string" || !/^[0-9a-f-]{36}$/i.test(orgId)) return json(response, 400, { error: "orgId is required" });

  const caller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: allowed, error: allowError } = await caller.rpc("can_request_registry_check", { target_org: orgId });
  if (allowError) return json(response, 401, { error: "sign in again" });
  if (!allowed) return json(response, 403, { error: "not your company" });
  const { data: isStaff } = await caller.rpc("is_platform_admin");
  const { data: who } = await caller.auth.getUser(token).catch(() => ({ data: null }));

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: registration } = await db
    .from("company_registrations")
    .select("country_code, number")
    .eq("org_id", orgId)
    .maybeSingle();
  if (!registration || registration.country_code !== "PT") return json(response, 200, { skipped: "not a Portuguese number" });

  if (!(force && isStaff)) {
    const since = new Date(Date.now() - REPEAT_MS).toISOString();
    const { data: recent } = await db
      .from("registry_checks")
      .select("id, result, details, checked_at")
      .eq("org_id", orgId)
      .eq("source", "vies")
      .eq("number_checked", registration.number)
      .gte("checked_at", since)
      .limit(1);
    if (recent?.length) return json(response, 200, { check: recent[0], repeated: true });
  }

  const outcome = await askVies(registration.number);
  const { data: check, error } = await db.rpc("record_registry_check", {
    target_org: orgId,
    number_checked: registration.number,
    source: "vies",
    result: outcome.result,
    details: outcome.details ?? {},
    requested_by: who?.user?.id ?? null,
  });
  if (error) {
    console.error("registry-vies record", error.message);
    return json(response, 500, { error: "the result could not be saved" });
  }
  return json(response, 200, { check });
}
