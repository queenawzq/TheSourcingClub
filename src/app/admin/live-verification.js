/**
 * The staff review page's verification score, on live data (Nov 12 design).
 *
 * The card (`VerificationScoreCard`, shared with the prototype) reads
 * `verificationScore(orgId)` and writes through the actions below; after each
 * write it reads the score again, so what staff see is always the database's.
 *
 * Builders A (scoring) and C (Run again) add the domain modules this calls in
 * parallel with this screen. They are found with `import.meta.glob`, so the
 * page builds before they land: without A's read the card says the score
 * could not load, and each write falls back to today's domain functions,
 * which are what the approval guard reads (`registry_approval_problem`):
 *
 *   Found / Name differs  → recordRegistryCheck, result "found", confirmed,
 *                            the name seen, and "the names differ, checked"
 *   a reason on a check   → explainCheck (and explainTradingScope for the
 *                            "Factory or trader" row: a trading-only licence)
 *   Explain shared number → explainDuplicate
 *   a photo's search      → recordSignal kind "photo"
 *   a certificate check   → recordSignal kind "certificate"
 *   an edited number      → adminSetRegistrationNumber, before Run again
 */
import { urlFor } from "../../lib/domain/documents.js";
import {
  adminSetRegistrationNumber, explainCheck, explainDuplicate, explainTradingScope, recordRegistryCheck, recordSignal,
} from "../../lib/domain/registration.js";

const scoringModule = import.meta.glob("../../lib/domain/verification-score.js");
const rerunModule = import.meta.glob("../../lib/domain/verification-rerun.js");

async function load(modules) {
  const [loader] = Object.values(modules);
  return loader ? loader() : {};
}

export const scoreAvailable = Object.keys(scoringModule).length > 0;

/** `{ facts, groups }` in the shape of verification-mock.js, or throws. */
export async function loadVerificationScore(orgId) {
  const { verificationScore } = await load(scoringModule);
  if (typeof verificationScore !== "function") throw new Error("The score isn't available");
  return verificationScore(orgId);
}

/** A signed link for a stored file (licence, certificate, photo). */
export function verificationFileUrl(file) {
  if (file?.url) return Promise.resolve(file.url);
  return urlFor({ bucket: file.bucket, storage_path: file.path, file_name: file.name }, 900);
}

const DB_PHOTO = { own: "own", elsewhere: "found_elsewhere", could_not: "could_not_check" };
const noteOf = (...parts) => parts.map((part) => (part ?? "").trim()).filter(Boolean).join("\n") || null;

/** Today's writes, for a check A's module does not yet write itself. */
const fallback = {
  async recordCheck(orgId, check, { result, reference, name, reason, source }) {
    if (check.kind === "certificate") {
      return recordSignal(orgId, {
        kind: "certificate", subjectId: check.subjectId ?? null, result, note: noteOf(reason, reference) ?? "", details: { link: reference ?? "" },
      });
    }
    const found = result === "found" || result === "name_differs";
    return recordRegistryCheck(orgId, {
      source: source ?? check.registry?.sourceKey ?? String(check.registry?.source ?? "").toLowerCase(),
      result: found ? "found" : result,
      note: noteOf(reason, reference),
      // Choosing Found (or Name differs with a reason) is the confirmation; the two checkboxes are gone.
      confirmed: found,
      seen: found && name ? { name } : {},
      nameDiffersConfirmed: result === "name_differs",
    });
  },
  async saveReason(orgId, check, text) {
    if (check.key === "scope") await explainTradingScope(orgId, text);
    return explainCheck(orgId, check.reasonKey ?? check.key, text);
  },
  recordPhoto(orgId, photo, { result, whereUrl }) {
    return recordSignal(orgId, { kind: "photo", subjectId: photo.id, result: DB_PHOTO[result] ?? result, note: "", details: { link: whereUrl ?? "" } });
  },
  explainSharedNumber: (orgId, text) => explainDuplicate(orgId, text),
};

// A refusal the database words for a person (a guard's 22023, an RPC's P0001) is shown; anything else is not.
const PERSON_WORDED = new Set(["22023", "P0001", "23514", "42501"]);

function staffWords(error) {
  if (error?.noAnswer) return error.message;
  const code = error?.code ?? error?.cause?.code;
  if (!PERSON_WORDED.has(code)) return "Couldn't save. Try again.";
  // `unwrap` prefixes its context ("record the check: …"); the database's own words are in `cause`.
  const text = String(error.cause?.message ?? error.message ?? "");
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : "Couldn't save. Try again.";
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
    recordCheck: (groupKey, check, record) => after(async () => {
      const { recordVerificationCheck } = await load(scoringModule);
      return recordVerificationCheck
        ? recordVerificationCheck(orgId, { checkKey: check.key, groupKey, ...record })
        : fallback.recordCheck(orgId, check, record);
    }),
    saveReason: (groupKey, check, text) => after(async () => {
      const { saveCheckReason } = await load(scoringModule);
      return saveCheckReason ? saveCheckReason(orgId, check.key, text) : fallback.saveReason(orgId, check, text);
    }),
    recordPhoto: (groupKey, index, record, photo) => after(async () => {
      const { recordPhotoCheck } = await load(scoringModule);
      return recordPhotoCheck
        ? recordPhotoCheck(orgId, { photoId: photo?.id, result: record.result, where: record.whereUrl })
        : fallback.recordPhoto(orgId, photo, record);
    }),
    explainField: (groupKey, field, text) => after(async () => {
      const { explainSharedNumber } = await load(scoringModule);
      return explainSharedNumber ? explainSharedNumber(orgId, text) : fallback.explainSharedNumber(orgId, text);
    }),
    /** Never throws for an expected failure: `{ error }` in short words, shown in the modal's footer. */
    runAgain: async (groupKey, values, edited) => {
      const { runAgain } = await load(rerunModule);
      let outcome;
      if (runAgain) {
        outcome = await runAgain(orgId, groupKey, { values, edited });
      } else if (groupKey === "business_registration" && edited.includes("number")) {
        // Until C's re-read lands: an edited number is still saved as staff's, which approval needs.
        await adminSetRegistrationNumber(orgId, String(values.number ?? "").replace(/\s+/g, "").toUpperCase(), "Edited on the review page");
        outcome = {};
      } else {
        return { error: "Run again isn't available yet" };
      }
      if (outcome?.error) return { error: outcome.error };
      await reload();
      changed?.();
      return {};
    },
  };
}
