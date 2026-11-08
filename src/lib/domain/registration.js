/**
 * A company's registration number and the official-registry checks against
 * it (migration 20261108600000). The rules live in
 * src/shared/registration-number.mjs and, the same, in the database.
 */
import { supabase, unwrap } from "../supabase.js";
import { normaliseAccessCode, normaliseRegistrationLetter, registrationNumberProblem, registrationProblemText } from "../../shared/registration-number.mjs";

export async function getRegistration(orgId) {
  return unwrap(
    await supabase.from("company_registrations").select("org_id, country_code, number, no_company_number, access_code, registration_letter_number, check_digit_confirmed, updated_at").eq("org_id", orgId).maybeSingle(),
    "load the registration number",
  );
}

/**
 * Save the number and the country's second field (Portugal's access code,
 * Turkey's trade registry entry). Refuses in words before the database would,
 * so the step can say which field is wrong; a failed check digit is saved
 * only when the factory `confirmed` it. Asks VIES after a Portuguese number
 * is saved, without waiting for it: the answer is for staff.
 */
export async function saveRegistration(orgId, { country, number, second = "", confirmed = false, noNumber = false }, language = "en") {
  const zh = language === "zh";
  if (noNumber) {
    // A sole proprietor's tax number is the owner's national ID: never asked.
    return unwrap(
      await supabase.rpc("save_company_registration", { target_org: orgId, country: country ?? null, number: null, no_number: true }),
      "save the registration",
    );
  }
  const problem = registrationNumberProblem(country, number);
  if (problem && !(problem === "check_digit" && confirmed)) throw new Error(registrationProblemText(country, problem, language));
  let accessCode = null;
  let registrationLetterNumber = null;
  if (country === "PT") {
    accessCode = normaliseAccessCode(second);
    if (accessCode === null) throw new Error(zh ? "访问码须为 12 位数字" : "The access code is 12 digits");
  } else if (country === "TR") {
    registrationLetterNumber = normaliseRegistrationLetter(second);
    if (registrationLetterNumber === null) throw new Error(zh ? "编号最多 40 个字符" : "The letter number is 40 characters at most");
  }
  const saved = unwrap(
    await supabase.rpc("save_company_registration", {
      target_org: orgId,
      country: country ?? null,
      number,
      access_code: accessCode || null,
      registration_letter_number: registrationLetterNumber || null,
      confirmed: Boolean(confirmed),
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

/**
 * Staff: why the company cannot be approved yet, or null. Mirrors the
 * database's guard (guard_approval_needs_registry).
 */
export async function registryApprovalBlock(orgId) {
  const detail = await adminRegistryDetail(orgId);
  if (!detail?.registration) return "Needs the company's registration number first";
  const current = detail.current;
  if (!current) return "Record a registry check that found the company first";
  if (current.result !== "found") return "The latest registry check did not find a match";
  return null;
}

/** Staff: record what an official source showed. */
export async function recordRegistryCheck(orgId, { source, result, note, confirmed = false }) {
  return unwrap(
    await supabase.rpc("admin_record_registry_check", { target_org: orgId, source, result, note: note || null, confirmed }),
    "record the check",
  );
}

/** The month a verified vendor's registration was last found on an official source, or null. */
export async function registryFact(orgId) {
  const { data, error } = await supabase.rpc("factory_registry_fact", { target_org: orgId });
  if (error) return null;
  return data ?? null;
}

/** Staff: every vendor's registry state ('found', 'lost', 'none'), by org id. */
export async function adminRegistryStates() {
  const { data, error } = await supabase.rpc("admin_registry_states");
  if (error) return new Map();
  return new Map((data ?? []).map((row) => [row.org_id, row]));
}
