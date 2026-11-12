/**
 * Run again, from the staff review page's modal (Nov 12).
 *
 *   rerunVerificationGroup({ orgId, group, fields, before?, subjectId? })
 *     → { ok: true, verification, group, before, after, delta, words, outOfDate }
 *     → { ok: false, error, code, verification?, group?, before?, after? }
 *
 * `fields` holds only what staff edited, in the contract's field keys.
 * `before` is the `verification` object already on screen (contract shape);
 * without it the score is read first. After the run the score is read again,
 * so `before` / `after` are the group's scores for "Score updated: 75% to 95%".
 * A run that failed part-way may still have changed the score: the answer
 * then carries both the error words and the new score. Never throws.
 *
 * `readScore(orgId)` is builder A's reader returning the contract's
 * `verification` object; it defaults to `verificationScore` in
 * ./verification-score.js, loaded when called.
 */
import { rerunFailureWords, scoreChangeWords } from "../../shared/verification-rerun.mjs";

export { readingOutOfDate, outOfDateWords, scoreChangeWords, GROUP_FIELDS } from "../../shared/verification-rerun.mjs";

async function sessionToken() {
  const { supabase } = await import("../supabase.js");
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token ?? null;
}

// A glob, not an import: it builds whether or not A's file has landed yet.
// Outside Vite (the check script) there is no glob, and readScore is passed in.
let scoreModules = {};
try {
  scoreModules = import.meta.glob("./verification-score.js");
} catch {
  scoreModules = {};
}

async function defaultReadScore(orgId) {
  const load = scoreModules["./verification-score.js"];
  if (!load) throw new Error("verificationScore is missing");
  const module = await load();
  const read = module.verificationScore ?? module.default;
  if (typeof read !== "function") throw new Error("verificationScore is missing");
  const answer = await read(orgId);
  // Either the contract object, or a { data } hook-style answer.
  return answer?.groups ? answer : answer?.data ?? answer?.verification ?? null;
}

/** A group's score from the contract shape: its own `score`, else the weighted checks. */
export function groupScore(verification, key) {
  const group = verification?.groups?.find((g) => g.key === key);
  if (!group) return null;
  if (typeof group.score === "number") return group.score;
  const counted = (group.checks ?? []).filter((check) => check.weight);
  if (!counted.length) return group.checks?.[0]?.score ?? null;
  const total = counted.reduce((sum, check) => sum + check.weight, 0);
  return Math.round(counted.reduce((sum, check) => sum + (check.score ?? 0) * check.weight, 0) / total);
}

/** The runner, with its dependencies passed in so the check script can drive it. */
export function createRerun({ getToken = sessionToken, fetchImpl = (...args) => fetch(...args), readScore = defaultReadScore } = {}) {
  return async function rerunVerificationGroup({ orgId, group, fields = {}, before = null, subjectId = null } = {}) {
    let previous = before;
    try {
      if (!previous) previous = await readScore(orgId).catch(() => null);
      const token = await getToken().catch(() => null);
      if (!token) return { ok: false, code: "signed_out", error: rerunFailureWords("signed_out") };
      let answer = null;
      try {
        const reply = await fetchImpl("/api/verification-rerun", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ orgId, group, fields, ...(subjectId ? { subjectId } : {}) }),
        });
        answer = await reply.json().catch(() => null);
        if (!answer) answer = { ok: false, code: reply.status === 401 ? "signed_out" : reply.status === 403 ? "not_staff" : "failed" };
      } catch {
        answer = { ok: false, code: "failed" };
      }
      // Refused before anything ran: the score did not move.
      const nothingRan = !answer.ran || !Object.values(answer.ran).some((step) => step?.ran);
      const error = answer.ok ? null : answer.error || rerunFailureWords(answer.code);
      if (!answer.ok && nothingRan) return { ok: false, code: answer.code ?? "failed", error };
      const verification = await readScore(orgId).catch(() => null);
      const beforeScore = groupScore(previous, group);
      const afterScore = groupScore(verification, group);
      const result = {
        ok: Boolean(answer.ok),
        verification,
        group: verification?.groups?.find((g) => g.key === group) ?? null,
        before: beforeScore,
        after: afterScore,
        delta: beforeScore != null && afterScore != null ? afterScore - beforeScore : null,
        words: scoreChangeWords(beforeScore, afterScore),
        outOfDate: answer.outOfDate ?? null,
        edited: answer.edits ?? [],
      };
      if (!answer.ok) Object.assign(result, { code: answer.code, error });
      if (!verification && answer.ok) Object.assign(result, { ok: false, code: "failed", error: "Ran, but the score couldn't be read. Reload the page." });
      return result;
    } catch {
      return { ok: false, code: "failed", error: rerunFailureWords("failed") };
    }
  };
}

export const rerunVerificationGroup = createRerun();

/** Who edited which field, and when: { group: { field: { value, before, by, at } } }. Staff only. */
export async function verificationFieldEdits(orgId) {
  const { supabase } = await import("../supabase.js");
  const { data, error } = await supabase.rpc("admin_verification_field_edits", { target_org: orgId });
  if (error) throw error;
  return data ?? {};
}
