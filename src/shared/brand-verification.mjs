/**
 * A brand's verification score, in the factory card's shape (Nov 13).
 *
 * Queena, Nov 12 call (40:58): brand review pages take the factory's layout
 * (`VerificationScoreCard`: one score, rows that open modals) instead of the
 * old "Verification checks" list, without contact domain or the duplicate
 * company signal. Brands are held to less than factories: many are new and
 * not registered yet, so a missing registration is shown and not counted,
 * never scored as a failure.
 *
 * Groups (weights are a decision for Queena to confirm):
 *   Business registration  20, only when a document is uploaded; else shown, not counted
 *   Company information    50  company details 70 + terms 30
 *   Brand evidence         30  logo, product images and brand direction
 *
 * Input is what the page already has: the `org_verification_checks()` rows
 * (`[label, result, value, detail]`, on every queue row, so the queue's score
 * and the page's are the same arithmetic), and, on the page only, the
 * company's files for the modals' previews. Nothing is read from the
 * database here, and nothing is written: brand rows have no record forms,
 * no reasons and no Run again.
 */

export const BRAND_WEIGHTS = { business_registration: 20, company_information: 50, brand_evidence: 30 };
export const BRAND_SCORES = { registration: { accepted: 100, uploaded: 80, empty: 0, rejected: 0 }, terms: { signed: 100, missing: 0 }, evidence: { three: 100, some: 50, none: 0 } };

const EVIDENCE_KINDS = new Set(["brand_direction", "product_image", "logo"]);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Nov 12" from "12 Nov 2026" (the database's words) or an ISO time in the reader's zone. */
function day(value, timeZone) {
  if (!value) return "";
  const words = /^(\d{1,2}) (\w{3}) \d{4}$/.exec(String(value).trim());
  if (words && MONTHS.includes(words[2])) return `${words[2]} ${Number(words[1])}`;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(timeZone ? { timeZone } : {}) });
}

const tuple = (checks, label) => {
  const row = (checks ?? []).find((check) => check?.[0] === label);
  return row ? { result: row[1], value: row[2], detail: String(row[3] ?? "") } : null;
};

function toFile(document, timeZone) {
  return {
    id: document.id, name: document.file_name ?? document.name ?? "File", bucket: document.bucket, path: document.storage_path ?? document.path,
    mimeType: document.mime_type ?? document.mimeType ?? null, when: day(document.created_at ?? document.createdAt, timeZone),
    ...(document.src || document.url ? { url: document.src ?? document.url } : {}),
  };
}

const newestFirst = (a, b) => String(b.created_at ?? b.createdAt ?? "").localeCompare(String(a.created_at ?? a.createdAt ?? ""));

function registrationCheck(row) {
  const base = { key: "registration", label: "Registration document", weight: 1 };
  if (!row || row.result === "Missing") return { ...base, score: null, verdict: "Not uploaded (optional for brands)", missing: true };
  if (row.result === "Rejected") return { ...base, score: BRAND_SCORES.registration.rejected, verdict: "Rejected by staff" };
  if (row.result === "Verified") return { ...base, score: BRAND_SCORES.registration.accepted, verdict: "Accepted by staff" };
  if (Number(row.value) === 0) return { ...base, score: BRAND_SCORES.registration.empty, verdict: "The file is empty" };
  return { ...base, score: BRAND_SCORES.registration.uploaded, verdict: "Uploaded, not reviewed yet" };
}

function detailsCheck(row) {
  const base = { key: "details", label: "Company details", weight: 70 };
  if (!row) return { ...base, score: null, verdict: "Not checked yet" };
  const gaps = /Not filled in: ([^.]+)\./.exec(row.detail)?.[1] ?? "";
  const score = row.value == null ? null : Math.max(0, Math.min(100, Math.round(Number(row.value))));
  if (score === 100 || (!gaps && score != null && score >= 100)) return { ...base, score: 100, verdict: "Complete", gaps: "" };
  return { ...base, score, verdict: gaps ? `Missing: ${gaps}` : "Not complete", gaps };
}

function termsCheck(row, timeZone) {
  const base = { key: "terms", label: "Terms", weight: 30 };
  if (!row || row.result !== "Clear") return { ...base, score: BRAND_SCORES.terms.missing, verdict: "Not signed" };
  const signed = /Signed "([^"]*)" on (\d{1,2} \w{3} \d{4})/.exec(row.detail);
  const words = [signed?.[1], day(signed?.[2], timeZone)].filter(Boolean).join(", ");
  return { ...base, score: BRAND_SCORES.terms.signed, verdict: words ? `Signed by ${words}` : "Signed", signedWords: words };
}

/** The same file stored twice (same name and size, e.g. onboarding's Next pressed twice) counts once. */
const repeats = (documents) => {
  const seen = new Set();
  let extra = 0;
  for (const d of documents) {
    const key = `${d.file_name ?? d.name ?? ""}\u0001${d.size_bytes ?? d.size ?? ""}`;
    if (seen.has(key)) extra += 1;
    else seen.add(key);
  }
  return extra;
};

function evidenceCheck(row, documents = []) {
  const base = { key: "brand_files", label: "Logo and product images", weight: 1 };
  const count = Math.max(0, Number(/^(\d+)/.exec(row?.detail ?? "")?.[1] ?? 0) - repeats(documents));
  if (!row || count === 0) return { ...base, score: BRAND_SCORES.evidence.none, verdict: "Nothing uploaded", count: 0 };
  const files = `${count} ${count === 1 ? "file" : "files"}`;
  return { ...base, score: count >= 3 ? BRAND_SCORES.evidence.three : BRAND_SCORES.evidence.some, verdict: count >= 3 ? `${files} uploaded` : `Only ${files} uploaded`, count };
}

const lower = (text) => (text ? text[0].toLowerCase() + text.slice(1) : text);
const plain = (check) => Object.fromEntries(Object.entries(check).filter(([key]) => !["missing", "gaps", "signedWords", "count"].includes(key)));

/**
 * What "Suggest with AI" in Request more information asks a brand for: the
 * `org_verification_checks()` rows it was asked from before Nov 13 (details,
 * terms, brand images), in the words `api/suggest-review-request.js` maps. A
 * registration that is simply missing is left out: it is optional for
 * brands. One that was rejected or is empty is still asked for again.
 */
export function brandRequestGaps(checks, documents = []) {
  const gaps = [];
  for (const [label, result, value, detail] of checks ?? []) {
    if (label === "Company details" && Number(value) < 100) gaps.push({ label, result, detail });
    else if (label === "Terms accepted" && result !== "Clear") gaps.push({ label, result, detail });
    // Fewer than 3 different files (a repeat counts once), as the card scores it.
    else if (label === "Brand evidence" && evidenceCheck({ detail }, (documents ?? []).filter((d) => d && EVIDENCE_KINDS.has(d.kind))).score < 100) gaps.push({ label, result, detail });
    // The database's words for an empty file say "empty (0 bytes)", which is what the request reads.
    else if (label === "Business registration" && (result === "Rejected" || (result === "Review" && Number(value) === 0))) gaps.push({ label, result, detail });
  }
  return gaps;
}

/**
 * `{ facts, groups }` for `VerificationScoreCard` and `VerificationFacts`.
 * `checks`: the `[label, result, value, detail]` rows. `documents`: the
 * company's files (`admin_org_documents()` rows), or none on the queue.
 */
export function brandVerification({ checks, documents = [], submittedBy = null, timeZone } = {}) {
  const registration = registrationCheck(tuple(checks, "Business registration"));
  const details = detailsCheck(tuple(checks, "Company details"));
  const terms = termsCheck(tuple(checks, "Terms accepted"), timeZone);
  const files = (documents ?? []).filter(Boolean);
  const evidence = evidenceCheck(tuple(checks, "Brand evidence"), files.filter((d) => EVIDENCE_KINDS.has(d.kind)));

  const registrationFiles = files.filter((d) => d.kind === "business_registration").sort(newestFirst).map((d) => toFile(d, timeZone));
  const brandFiles = files.filter((d) => EVIDENCE_KINDS.has(d.kind)).sort(newestFirst)
    .filter((d, i, all) => all.findIndex((o) => (o.file_name ?? o.name) === (d.file_name ?? d.name) && (o.size_bytes ?? o.size) === (d.size_bytes ?? d.size)) === i)
    .map((d) => toFile(d, timeZone));
  const evidenceOf = (list, label) => (list.length ? { kind: "licence", label, files: list } : { kind: "none" });
  const shared = { checking: false, readAt: "", readAtIso: null, stale: null, fields: [], reasons: false, rerunnable: false };

  const businessRegistration = {
    ...shared,
    key: "business_registration",
    label: "Business registration",
    weight: registration.missing ? 0 : BRAND_WEIGHTS.business_registration,
    tip: "The brand's registration document. Optional for brands: it counts only when uploaded.",
    verdict: registration.verdict,
    why: "",
    evidence: evidenceOf(registrationFiles, "Registration document"),
    checks: [plain(registration)],
  };

  const ciChecks = [details, terms];
  // The verdict names what is not done yet, lowest first; "complete" only when both are.
  const weak = ciChecks.filter((c) => c.score != null && c.score < 100).sort((a, b) => a.score - b.score)[0] ?? null;
  const companyInformation = {
    ...shared,
    key: "company_information",
    label: "Company information",
    weight: BRAND_WEIGHTS.company_information,
    tip: "Whether the profile is filled in and the terms are signed.",
    verdict: weak === details ? `Details ${lower(details.verdict)}` : weak === terms ? "Terms not signed" : details.score == null ? "Not checked yet" : "Details complete, terms signed",
    why: ciChecks.filter((c) => c !== weak).map((c) => `${c.label}: ${lower(c.verdict)}`).join(". ").concat("."),
    evidence: { kind: "none" },
    evidencePane: false,
    checks: ciChecks.map(plain),
  };

  const brandEvidence = {
    ...shared,
    key: "brand_evidence",
    label: "Brand evidence",
    weight: BRAND_WEIGHTS.brand_evidence,
    tip: "The logo, product images and brand direction the brand uploaded.",
    verdict: evidence.verdict,
    why: "",
    evidence: evidenceOf(brandFiles, "Brand file"),
    checks: [plain(evidence)],
  };

  const facts = [
    terms.score ? { key: "terms", label: "Terms signed", value: terms.signedWords || "Signed", ok: true } : { key: "terms", label: "Terms signed", value: "Not signed", ok: false },
    registration.missing
      ? { key: "registration", label: "Registration uploaded", value: "Not uploaded (optional)" }
      : { key: "registration", label: "Registration uploaded", value: registrationFiles[0]?.name ?? "Uploaded", ok: registration.score > 0 },
    { key: "details", label: "Company details", value: details.score === 100 ? "Complete" : details.gaps ? `Not filled in: ${details.gaps}` : "Not complete", ok: details.score === 100 },
  ];
  if (submittedBy && (submittedBy.name || submittedBy.email)) {
    facts.push({ key: "submittedBy", label: "Submitted by", value: [submittedBy.name, submittedBy.email].filter((v) => v && v !== "Not provided").join(" · ") });
  }

  return { facts, groups: [businessRegistration, companyInformation, brandEvidence] };
}
