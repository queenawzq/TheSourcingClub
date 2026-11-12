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
