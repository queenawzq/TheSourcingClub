/**
 * A company's registration number and the official-registry checks against
 * it (migration 20261108600000). The rules live in
 * src/shared/registration-number.mjs and, the same, in the database.
 */
import { supabase, unwrap } from "../supabase.js";
import { normaliseAccessCode, normaliseRegistrationLetter, normaliseRegistrationNumber, numberFromDocument, registrationNumberProblem, registrationProblemText } from "../../shared/registration-number.mjs";

export async function getRegistration(orgId) {
  return unwrap(
    await supabase.from("company_registrations").select("org_id, country_code, number, number_source, no_company_number, access_code, registration_letter_number, check_digit_confirmed, updated_at").eq("org_id", orgId).maybeSingle(),
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
  if (numberFromDocument(country) && !normaliseRegistrationNumber(country, number ?? "")) {
    // China: the number is read off the licence; only the country is saved.
    return unwrap(
      await supabase.rpc("save_company_registration", { target_org: orgId, country, number: null }),
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
    // Optional: the tax plate (vergi levhası) has no letter number.
    registrationLetterNumber = normaliseRegistrationLetter(second);
    if (registrationLetterNumber === "") registrationLetterNumber = null;
    else if (registrationLetterNumber === null) throw new Error(zh ? "证明编号为 14 位字母或数字" : "The letter number is 14 letters and digits");
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

/**
 * After saving: is this number already another company's on TSC? Yes or no,
 * never which one. False when it can't be asked: the warning is a courtesy,
 * staff see the duplicate either way.
 */
export async function registrationInUse(orgId) {
  const { data, error } = await supabase.rpc("registration_in_use", { target_org: orgId });
  return !error && data === true;
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
export function approvalBlockText(detail) {
  if (!detail?.registration) return "Needs the company's registration number first";
  const problem = detail.approvalProblem;
  if (problem === "no_check") {
    return detail.current && detail.current.result !== "found"
      ? "The latest registry check did not find a match"
      : "Record a registry check that found the company first";
  }
  if (problem === "renamed") return "The company was renamed after its registry check: check it again";
  if (problem === "name_differs") return `The registry names another company (${detail.nameDiffers}): record a check confirming why`;
  if (problem === "document_differs") return "The AI reading of the document shows another number or name: record a check confirming why";
  if (problem === "duplicate") return "Another company uses this registration number: explain it first";
  if (problem === "number_check_digit_fails") return "The number read off the license fails its check digit: type it from the image";
  if (problem === "number_needs_staff") return "This license needs its number typed by staff (old 15-digit or Hong Kong)";
  if (problem === "trading_only") return "The license's business scope is trading only: record a reason in the Trading scope row first";
  return null;
}

export async function registryApprovalBlock(orgId) {
  return approvalBlockText(await adminRegistryDetail(orgId));
}

/**
 * Staff: record what a source showed. `seen` is what staff read there (name,
 * address, startDate, industry); `nameDiffersConfirmed` says the names differ
 * and staff checked why, which a "found" needs when they do.
 */
export async function recordRegistryCheck(orgId, { source, result, note, confirmed = false, seen = {}, nameDiffersConfirmed = false }) {
  return unwrap(
    await supabase.rpc("admin_record_registry_check", {
      target_org: orgId, source, result, note: note || null, confirmed, seen, name_differs_confirmed: nameDiffersConfirmed,
    }),
    "record the check",
  );
}

/** Staff: say why two companies share a number; approval needs it. */
export async function explainDuplicate(orgId, note) {
  return unwrap(await supabase.rpc("admin_explain_duplicate", { target_org: orgId, note }), "save the explanation");
}

/** Staff: photos, certificates, registration files and every signal recorded. */
export async function adminVerificationSignals(orgId) {
  return unwrap(await supabase.rpc("admin_verification_signals", { target_org: orgId }), "load the verification checks");
}

/** Staff: a photo's reverse search, or a certificate's check. */
export async function recordSignal(orgId, { kind, subjectId, result, note, details = {} }) {
  const saved = unwrap(
    await supabase.rpc("admin_record_signal", { target_org: orgId, kind, subject: subjectId, result, note, details }),
    "record the check",
  );
  // A photo mark ("Own photos", "Found elsewhere") changes the photos level now, not at "Run again".
  if (kind === "photo") await runPhotoCheck(orgId, { marksOnly: true });
  return saved;
}

/**
 * Staff: ask the server to read the registration with AI, or to check the
 * address. Answers `{ available: false, reason }` in words when it can't.
 */
export async function requestRegistryAssist(orgId, action, extra = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  let response;
  try {
    response = await fetch("/api/registry-assist", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
      body: JSON.stringify({ orgId, action, ...extra }),
    });
  } catch {
    return { available: false, reason: "The server couldn't be reached." };
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) return { available: false, reason: result.error || "The server couldn't do it." };
  return result;
}

/** Verification v3 states for a company: approval problem, number source, trader reason, reopenings. Staff only. */
export async function adminVerificationRules(orgId) {
  const { data, error } = await supabase.rpc("admin_verification_rules", { target_org: orgId });
  return error ? null : data ?? null;
}

/** Staff record why a trading-only license may still be approved. */
export async function explainTradingScope(orgId, note) {
  const { error } = await supabase.rpc("admin_explain_trading_scope", { target_org: orgId, note });
  if (error) throw error;
}

/** Runs the automatic photo check (staff only). Same answer shape as requestRegistryAssist. */
export async function runPhotoCheck(orgId, { marksOnly = false } = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  let response;
  try {
    response = await fetch("/api/photo-check", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
      body: JSON.stringify(marksOnly ? { orgId, marksOnly: true } : { orgId }),
    });
  } catch {
    return { available: false, reason: "The server couldn't be reached." };
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) return { available: false, reason: result.error || "The server couldn't do it." };
  return result;
}

/** The last photo check's result for a company, or null. */
export async function latestPhotoCheck(orgId) {
  const { data, error } = await supabase.rpc("admin_photo_check_latest", { target_org: orgId });
  return error ? null : data ?? null;
}

/** Which of a vendor's certificates staff found on the issuer's lookup, by certification id. */
export async function certificateChecks(orgId) {
  const { data, error } = await supabase.rpc("factory_certificate_checks", { target_org: orgId });
  if (error) return new Map();
  return new Map((data ?? []).map((row) => [row.certification_id, row.checked_at]));
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

/*
 * Verification v3.1 staff writes (migration 202611111200*, session "sql").
 * The RPC names are the brief's; their argument names are in this one block
 * so they can be matched to the migration in one place.
 */
export const V31_RPC = {
  setNumber: { name: "admin_set_registration_number", args: (orgId, number, note, country) => ({ target_org: orgId, number, note, country: country ?? null }) },
  explainCheck: { name: "admin_explain_check", args: (orgId, checkKey, note) => ({ target_org: orgId, check_key: checkKey, note }) },
  companyFacts: { name: "admin_record_company_facts", args: (orgId, { insuredStaff, foundedOn }) => ({ target_org: orgId, insured_staff: insuredStaff, founded_on: foundedOn }) },
};

/** Staff type the number off the license image (number_source = 'staff'). */
export async function adminSetRegistrationNumber(orgId, number, note, country = null) {
  const rpc = V31_RPC.setNumber;
  return unwrap(await supabase.rpc(rpc.name, rpc.args(orgId, number, note, country)), "save the number");
}

/** Staff record why a row's level may stand: lifts Low to Medium, shown on the row. */
export async function explainCheck(orgId, checkKey, note) {
  const rpc = V31_RPC.explainCheck;
  return unwrap(await supabase.rpc(rpc.name, rpc.args(orgId, checkKey, note)), "save the reason");
}

/** Staff record the insured staff (参保人数) and the founding date (成立日期). */
export async function recordCompanyFacts(orgId, facts) {
  const rpc = V31_RPC.companyFacts;
  return unwrap(await supabase.rpc(rpc.name, rpc.args(orgId, facts)), "save the company facts");
}

/** What the factory claimed about its size and age (factory_profiles), for the company facts row. */
export async function adminCompanyClaims(orgId) {
  const { data, error } = await supabase.from("factory_profiles").select("employee_count, founded_year").eq("org_id", orgId).maybeSingle();
  if (error || !data) return null;
  return { workers: data.employee_count ?? null, foundedYear: data.founded_year ?? null };
}

/**
 * Everything the review page reads to draw the levels, in one call, so the
 * queue can show each company's overall level too.
 */
export async function adminLevelInputs(orgId) {
  const [detail, signals, photoResult, rules, claims] = await Promise.all([
    adminRegistryDetail(orgId),
    adminVerificationSignals(orgId).catch(() => ({ signals: [], photos: [], registrationFiles: [], certificates: [] })),
    latestPhotoCheck(orgId),
    adminVerificationRules(orgId),
    adminCompanyClaims(orgId),
  ]);
  return { detail, extra: { ...signals, rules, claims, checkResults: photoResult ? [photoResult] : [] } };
}

/** Who signed the terms for the company (B2: shown beside the license's legal representative). */
export async function adminTermsSigner(orgId) {
  const { data, error } = await supabase.rpc("admin_verification_detail", { target_org: orgId });
  if (error || !data?.terms) return null;
  return { signature: data.terms.signature ?? null, signedBy: data.terms.signedBy ?? null, acceptedAt: data.terms.acceptedAt ?? null };
}
