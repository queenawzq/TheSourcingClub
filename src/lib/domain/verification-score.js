/**
 * The staff review page's Verification score, and the records staff make on
 * it (Nov 12). Shape and actions: ./verification-score.contract.md.
 *
 * The read is one staff-only RPC (`admin_verification_score_input`); the
 * arithmetic is src/shared/verification-score.mjs. Every write is followed,
 * by the screen, with a fresh `verificationScore()` and the approval block.
 */
import { supabase, unwrap } from "../supabase.js";
import { reverseImageLinks } from "../../shared/certificate-lookups.mjs";
import { scoreVerification } from "../../shared/verification-score.mjs";
import { runPhotoCheck } from "./registration.js";

/** A refusal in the database's own short words, keeping its code. */
function plain(result, context) {
  if (!result.error || result.error.code === "PGRST116") return unwrap(result, context);
  if (/^(22023|P0002|42501)$/.test(String(result.error.code ?? ""))) {
    const error = new Error(capitalise(result.error.message));
    error.code = result.error.code;
    error.cause = result.error;
    throw error;
  }
  return unwrap(result, context);
}
const capitalise = (text) => (text ? text[0].toUpperCase() + text.slice(1) : text);

async function signed(file, seconds) {
  if (!file?.bucket || !file?.path) return null;
  if (file.bucket === "org-public") return supabase.storage.from(file.bucket).getPublicUrl(file.path).data?.publicUrl ?? null;
  const { data } = await supabase.storage.from(file.bucket).createSignedUrl(file.path, seconds);
  return data?.signedUrl ?? null;
}

/** The records the score reads (staff only). */
export async function verificationScoreInput(orgId) {
  return plain(await supabase.rpc("admin_verification_score_input", { target_org: orgId }), "load the verification score");
}

/**
 * The contract's `verification` object. `urls` signs the evidence pane's
 * files and photos (an hour); the queue passes `{ urls: false }`.
 */
export async function verificationScore(orgId, { urls = true, timeZone } = {}) {
  const input = await verificationScoreInput(orgId);
  const verification = scoreVerification(input, { timeZone });
  if (!urls) return verification;
  const seconds = 60 * 60;
  const groups = await Promise.all(verification.groups.map(async (group) => {
    const evidence = group.evidence;
    if (evidence.kind === "licence") {
      return { ...group, evidence: { ...evidence, files: await Promise.all(evidence.files.map(async (f) => ({ ...f, url: await signed(f, seconds) }))) } };
    }
    if (evidence.kind === "photos") {
      const photos = await Promise.all(evidence.photos.map(async (p) => {
        // No search link here: one is minted per click, short-lived (photoSearchLink).
        return { ...p, src: await signed(p, seconds) };
      }));
      return { ...group, evidence: { ...evidence, photos } };
    }
    if (evidence.kind === "certificate") {
      const file = evidence.file ? { ...evidence.file, url: await signed(evidence.file, seconds) } : null;
      const certificates = await Promise.all((evidence.certificates ?? []).map(async (c) => ({ ...c, file: c.file ? { ...c.file, url: await signed(c.file, seconds) } : null })));
      return { ...group, evidence: { ...evidence, file, certificates } };
    }
    return group;
  }));
  return { ...verification, groups };
}

/**
 * "Search image" (fix round 2): a reverse image search needs a link the
 * search service can open, so a signed link to the private photo is minted
 * only when staff click, and lives 10 minutes. The page is staff-only, and
 * storage signs a private photo only for staff or the company itself.
 */
export const SEARCH_LINK_SECONDS = 10 * 60;
export async function photoSearchLink(photo) {
  const url = await signed(photo, SEARCH_LINK_SECONDS);
  return url ? reverseImageLinks(url)[0]?.href ?? null : null;
}

/**
 * Registry record form: found | name_differs | not_found | could_not_check.
 * Name differs needs `reason`, which is the confirmation approval asks for.
 */
export async function recordRegistryResult(orgId, { source, result, reference = "", name = "", reason = "" }) {
  return plain(await supabase.rpc("admin_record_registry_result", {
    target_org: orgId, source, result,
    reference: reference || null, name_on_registry: name || null, reason: reason || null,
  }), "record the check");
}

const CERT_WORDS = { found: "Found on the issuer's list", expired: "Expired on the issuer's list", not_found: "Not on the issuer's list", could_not_check: "Could not check the issuer's list" };

/** Certificate record form: found | expired | not_found | could_not_check. */
export async function recordCertificateResult(orgId, certificationId, { result, reference = "", note = "", number = "" }) {
  // The number on screen goes with the record, so the record never leaves it blank.
  const details = { ...(reference ? { link: reference } : {}), ...(String(number || "").trim() ? { number: String(number).trim() } : {}) };
  return plain(await supabase.rpc("admin_record_signal", {
    target_org: orgId, kind: "certificate", subject: certificationId, result,
    note: String(note || "").trim() || CERT_WORDS[result] || result,
    details,
  }), "record the check");
}

const PHOTO_WORDS = { own: "Their own photo", found_elsewhere: "Found elsewhere", could_not_check: "Could not check" };

/** Photo tile: own | found_elsewhere (needs `link`) | could_not_check. Updates the photo check's marks too. */
export async function recordPhoto(orgId, documentId, { result, link = "", note = "" }) {
  const saved = plain(await supabase.rpc("admin_record_signal", {
    target_org: orgId, kind: "photo", subject: documentId, result,
    note: String(note || "").trim() || PHOTO_WORDS[result] || result,
    details: link ? { link } : {},
  }), "record the photo");
  // The stored photo check carries each photo's mark; refresh it from the evidence it already has.
  await runPhotoCheck(orgId, { marksOnly: true }).catch(() => null);
  return saved;
}

/**
 * Staff's own result on a check (Nov 25): address confirmed | problem | could_not_check (for the address shown),
 * scope factory | trading_company | could_not_tell, licence original | problem | could_not_check (for its file).
 */
export async function recordStaffResult(orgId, check, { result, note }) {
  return plain(await supabase.rpc("admin_record_signal", {
    target_org: orgId, kind: check.key, subject: check.key === "licence" ? check.fileId ?? null : null, result,
    note: String(note || "").trim(),
    details: check.key === "address" ? { address: check.edit?.value ?? "" } : {},
  }), "record the check");
}

/** "Add reason" on a sub-check: licence | registry | scope | address | photos | certificate (with its id). */
export async function saveCheckReason(orgId, checkKey, text, subjectId = null, writtenFor = null) {
  // `writtenFor`: the verdict the reason explains; it stops lifting the check once the verdict changes.
  return plain(await supabase.rpc("admin_check_reason_for", {
    target_org: orgId, check_key: checkKey, note: text, subject: subjectId, written_for: writtenFor || null,
  }), "save the reason");
}

/** "Explain" under a shared registration number. */
export async function explainSharedNumber(orgId, text) {
  return plain(await supabase.rpc("admin_explain_duplicate", { target_org: orgId, note: text }), "save the explanation");
}

/* ------------------------------------------------------------ the one form (Nov 24) */

/** Proof files live under one staff folder in the private bucket; the company's own rules never reach it. */
export const PROOF_FOLDER = "5aff0000-0000-4000-8000-000000000001";
export const PROOF_TYPES = ["image/png", "image/jpeg", "image/webp", "application/pdf"];
export const PROOF_LIMIT_MB = 20;

const extensionOf = (file) => {
  const fromName = /\.([a-z0-9]{1,5})$/i.exec(file?.name ?? "")?.[1];
  if (fromName) return fromName.toLowerCase();
  return { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "application/pdf": "pdf" }[file?.type] ?? "bin";
};

/** Upload one proof file (staff only). Resolves `{ path, name, type }`, or throws in short words. */
export async function uploadProofFile(orgId, file) {
  if (!PROOF_TYPES.includes(file?.type)) throw new Error("Use a screenshot (PNG, JPG, WebP) or a PDF");
  if (file.size > PROOF_LIMIT_MB * 1024 * 1024) throw new Error(`Files up to ${PROOF_LIMIT_MB} MB`);
  const path = `${PROOF_FOLDER}/${orgId}/${crypto.randomUUID()}.${extensionOf(file)}`;
  const { error } = await supabase.storage.from("org-private").upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error("Couldn't upload the file. Try again.");
  return { path, name: file.name || "file", type: file.type };
}

/** Remove a proof file that was never saved on a check (best effort). */
export async function removeProofFile(path) {
  if (!String(path ?? "").startsWith(`${PROOF_FOLDER}/`)) return;
  await supabase.storage.from("org-private").remove([path]).catch(() => null);
}

/** A signed link to a proof file, 15 minutes. */
export async function proofFileUrl(path) {
  const { data } = await supabase.storage.from("org-private").createSignedUrl(path, 900);
  return data?.signedUrl ?? null;
}

const proofList = (files) => (files ?? []).map((f) => ({ path: f.path, name: f.name, type: f.type ?? "" }));

/** Registry form: result found | not_found | could_not_check; seen = { name, number, address } as the site shows them. */
export async function saveRegistryCheck(orgId, { site, siteKey, result, seen = {}, note = "", link = "", proof = [] }) {
  return plain(await supabase.rpc("admin_save_registry_check", {
    target_org: orgId, site, site_key: siteKey ?? "site", result,
    seen: result === "found" ? seen : {}, note: note || null, link: link || null, proof: proofList(proof),
  }), "record the check");
}

/** Certificate form: found | expired | not_found | could_not_check; seen = { number, holder }. */
export async function saveCertificateCheck(orgId, certificationId, { site, result, seen = {}, note = "", link = "", proof = [] }) {
  return plain(await supabase.rpc("admin_save_certificate_check", {
    target_org: orgId, certificate: certificationId, site, result,
    seen, note: note || null, link: link || null, proof: proofList(proof),
  }), "record the check");
}

/** Staff change a vendor's type (manufacturer | trading_company) and/or its address. The company is told. */
export async function updateCompanyProfile(orgId, { vendorKind = null, address = null }) {
  return plain(await supabase.rpc("admin_update_company_profile", {
    target_org: orgId, vendor_kind: vendorKind, address,
  }), "update the company");
}

/** The review history: [{ kind, details, at, by }], newest first. */
export async function reviewChanges(orgId) {
  return plain(await supabase.rpc("admin_review_changes", { target_org: orgId }), "load the history") ?? [];
}
