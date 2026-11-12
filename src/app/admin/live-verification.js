/**
 * The staff review page's verification score, on live data (Nov 12 design).
 *
 * The card (`VerificationScoreCard`, shared with the prototype) reads
 * `verificationScore(orgId)` and writes through the actions below; after each
 * write it reads the score again, so what staff see is always the database's.
 *
 * This is the thin layer between the card's calls and the domain modules:
 *
 *   the score                 → verificationScore (verification-score.js),
 *                               with Run again's field edits drawn as "Edited by"
 *   Found / Name differs / …  → recordRegistryResult; on a certificate,
 *                               recordCertificateResult
 *   a reason on a check       → saveCheckReason
 *   a photo's search          → recordPhoto
 *   Explain shared number     → explainSharedNumber
 *   Run again                 → rerunVerificationGroup (verification-rerun.js),
 *                               sending only the fields staff edited
 */
import { urlFor } from "../../lib/domain/documents.js";
import {
  explainSharedNumber, recordCertificateResult, recordPhoto, recordRegistryResult, saveCheckReason, verificationScore,
} from "../../lib/domain/verification-score.js";
import { rerunVerificationGroup, verificationFieldEdits } from "../../lib/domain/verification-rerun.js";

export const scoreAvailable = true;

const DAY = { month: "short", day: "numeric" };
const editedWords = (edit) => {
  const when = edit.at ? new Date(edit.at).toLocaleDateString("en-US", DAY) : "";
  return `Edited${edit.by ? ` by ${edit.by}` : ""}${when ? `, ${when}` : ""}`;
};

/** Run again's last edit of each field, as the field's "Edited by …" line. */
function withEdits(verification, edits) {
  if (!edits || !Object.keys(edits).length) return verification;
  return {
    ...verification,
    groups: verification.groups.map((group) => {
      const byField = edits[group.key];
      if (!byField) return group;
      return {
        ...group,
        fields: (group.fields ?? []).map((field) => {
          const edit = byField[field.key];
          if (!edit) return field;
          // The factory address staff entered is what the address check ran on (Run again keeps it, not
          // the profile's): show it, so "Edited" clears once Run again has used it.
          if (field.key === "siteAddress") return { ...field, value: String(edit.value ?? ""), by: editedWords(edit) };
          // A reading field: only while it still shows the edited value; a later reading replaces it.
          return String(edit.value ?? "") === String(field.value ?? "") ? { ...field, by: editedWords(edit) } : field;
        }),
      };
    }),
  };
}

/** The photo tile's "Search image" link, from the first reverse-image search. */
function withSearchLinks(verification) {
  return {
    ...verification,
    groups: verification.groups.map((group) => (group.evidence?.kind !== "photos" ? group : {
      ...group,
      evidence: {
        ...group.evidence,
        photos: group.evidence.photos.map((photo) => ({ ...photo, searchHref: photo.searchHref ?? photo.searchLinks?.[0]?.href ?? null })),
      },
    })),
  };
}

// The score last read per company: Run again's "before", and the certificate it re-reads.
const lastRead = new Map();

/** `{ facts, groups, … }` in the shape of verification-mock.js, or throws. */
export async function loadVerificationScore(orgId, { urls = true } = {}) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [score, edits] = await Promise.all([
    verificationScore(orgId, { urls, timeZone }),
    urls ? verificationFieldEdits(orgId).catch(() => null) : null,
  ]);
  const verification = withSearchLinks(withEdits(score, edits));
  if (urls) lastRead.set(orgId, verification);
  return verification;
}

/** A signed link for a stored file (licence, certificate, photo). */
export function verificationFileUrl(file) {
  if (file?.url) return Promise.resolve(file.url);
  return urlFor({ bucket: file.bucket, storage_path: file.path, file_name: file.name }, 900);
}

const DB_PHOTO = { own: "own", elsewhere: "found_elsewhere", could_not: "could_not_check" };

// A refusal the database words for a person (a guard's 22023, an RPC's P0001) is shown; anything else is not.
const PERSON_WORDED = new Set(["22023", "P0001", "P0002", "23514", "42501"]);

function staffWords(error) {
  const code = error?.code ?? error?.cause?.code;
  if (!PERSON_WORDED.has(code)) return "Couldn't save. Try again.";
  // `unwrap` prefixes its context ("record the check: …"); the database's own words are in `cause`.
  const text = String(error.cause?.message ?? error.message ?? "");
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : "Couldn't save. Try again.";
}

/** The certificate whose fields the certification modal shows (the one with a file, else the first). */
function shownCertificate(verification) {
  const evidence = verification?.groups?.find((group) => group.key === "certification")?.evidence;
  if (evidence?.kind !== "certificate") return null;
  const list = evidence.certificates ?? [];
  return (list.find((c) => c.file && c.file.id === evidence.file?.id) ?? list[0])?.id ?? null;
}

/**
 * The card's actions for one company. `reload` reads the score again (and
 * resolves once it has); `changed` tells the page a record may have moved the
 * approval block and the queue's figure.
 */
export function verificationActions(orgId, { reload, changed }) {
  const after = async (work) => {
    try {
      await work();
    } catch (error) {
      throw new Error(staffWords(error));
    }
    await reload();
    changed?.();
  };
  return {
    recordCheck: (groupKey, check, { result, reference, name, reason, source }) => after(() => (
      check.kind === "certificate"
        ? recordCertificateResult(orgId, check.subjectId, { result, reference, note: reason })
        : recordRegistryResult(orgId, { source: source ?? check.registry?.sourceKey, result, reference, name, reason })
    )),
    saveReason: (groupKey, check, text) => after(() => saveCheckReason(orgId, check.reasonKey ?? check.key, text, check.subjectId ?? null)),
    recordPhoto: (groupKey, index, record, photo) => after(() => recordPhoto(orgId, photo?.id, {
      result: DB_PHOTO[record.result] ?? record.result, link: record.whereUrl ?? "",
    })),
    explainField: (groupKey, field, text) => after(() => explainSharedNumber(orgId, text)),
    /** Never throws for an expected failure: `{ error }` in short words, shown in the modal's footer. */
    runAgain: async (groupKey, values, edited) => {
      const before = lastRead.get(orgId) ?? null;
      const fields = Object.fromEntries(edited.map((key) => [key, values[key] ?? ""]));
      const subjectId = groupKey === "certification" ? shownCertificate(before) : null;
      const outcome = await rerunVerificationGroup({ orgId, group: groupKey, fields, before, subjectId });
      // A run that failed part-way may still have moved the score: read it either way, unless nothing ran.
      if (outcome.ok || outcome.verification) {
        await reload();
        changed?.();
      }
      return outcome.ok ? {} : { error: outcome.error || "Couldn't run again" };
    },
  };
}
