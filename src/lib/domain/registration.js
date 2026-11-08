/**
 * A company's registration number and the official-registry checks against
 * it (migration 20261108600000). The rules live in
 * src/shared/registration-number.mjs and, the same, in the database.
 */
import { supabase, unwrap } from "../supabase.js";
import { normaliseAccessCode, registrationNumberProblem, registrationProblemText } from "../../shared/registration-number.mjs";

export async function getRegistration(orgId) {
  return unwrap(
    await supabase.from("company_registrations").select("org_id, country_code, number, access_code, updated_at").eq("org_id", orgId).maybeSingle(),
    "load the registration number",
  );
}

/**
 * Save the number (and Portugal's access code). Refuses in words before the
 * database would, so the step can say which field is wrong. Asks VIES after a
 * Portuguese number is saved, without waiting for it: the answer is for staff.
 */
export async function saveRegistration(orgId, { country, number, accessCode = "" }, language = "en") {
  const problem = registrationNumberProblem(country, number);
  if (problem) throw new Error(registrationProblemText(country, problem, language));
  const code = normaliseAccessCode(accessCode);
  if (code === null) throw new Error(language === "zh" ? "访问码须为 12 位数字" : "The access code is 12 digits");
  const saved = unwrap(
    await supabase.rpc("save_company_registration", {
      target_org: orgId,
      country: country ?? null,
      number,
      access_code: code || null,
    }),
    "save the registration number",
  );
  if (saved?.country_code === "PT") requestViesCheck(orgId).catch(() => {});
  return saved;
}

/** Ask the server to look the company up on VIES. `force` (staff) skips the 10-minute repeat guard. */
export async function requestViesCheck(orgId, { force = false } = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const response = await fetch("/api/registry-vies", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
    body: JSON.stringify({ orgId, force }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "VIES could not be asked");
  return result;
}

/** Staff: the number, the country, and every check, newest first. */
export async function adminRegistryDetail(orgId) {
  return unwrap(await supabase.rpc("admin_registry_detail", { target_org: orgId }), "load the registry checks");
}

/** Staff: record what an official source showed. */
export async function recordRegistryCheck(orgId, { source, result, note }) {
  return unwrap(
    await supabase.rpc("admin_record_registry_check", { target_org: orgId, source, result, note: note || null }),
    "record the check",
  );
}

/** The month a verified vendor's registration was last found on an official source, or null. */
export async function registryFact(orgId) {
  const { data, error } = await supabase.rpc("factory_registry_fact", { target_org: orgId });
  if (error) return null;
  return data ?? null;
}
