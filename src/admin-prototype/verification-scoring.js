/**
 * The arithmetic of the staff verification score (Nov 12 design), shared by
 * the prototype's mock and the live review page. Pure functions only: no
 * data, so importing it never brings the mock profiles into the live app.
 *
 * Overall = Business registration 60 + Company information 40. Certification
 * evidence is shown but not counted. A check not done yet scores 0 and says
 * so, so an unchecked registry never looks like a passed one.
 */
export const GROUP_WEIGHTS = { business_registration: 60, company_information: 40 };

export function scoreGroup(group) {
  if (!group?.checks?.length) return null;
  const counted = group.checks.filter((check) => check.weight);
  if (!counted.length) return group.checks[0]?.score ?? null;
  // Nothing in the group checked yet: "Not checked", not 0%.
  if (!counted.some((check) => check.score != null)) return null;
  const total = counted.reduce((sum, check) => sum + check.weight, 0);
  // `counts`: an unscored check that still counts as something ("Couldn't check" counts as Not found, never below it).
  return Math.round(counted.reduce((sum, check) => sum + (check.score ?? check.counts ?? 0) * check.weight, 0) / total);
}

export function scoreOverall(groups) {
  let sum = 0;
  let weight = 0;
  let scored = false;
  for (const group of groups) {
    const w = GROUP_WEIGHTS[group.key];
    if (!w) continue;
    if ((group.checks ?? []).some((check) => check.weight && check.score != null)) scored = true;
    sum += (scoreGroup(group) ?? 0) * w;
    weight += w;
  }
  // Nothing counted has been checked yet: "Not checked", never a 0% that reads as a failure.
  return weight && scored ? Math.round(sum / weight) : null;
}

/** The lowest counted check that has been done: the overall line names it. A check not done yet is a to-do, not evidence. */
export function weakestCheck(groups) {
  return groups
    .filter((group) => GROUP_WEIGHTS[group.key])
    .flatMap((group) => group.checks.filter((check) => check.weight && check.score != null).map((check) => ({ ...check, group: group.label })))
    .sort((a, b) => (a.score ?? 0) - (b.score ?? 0))[0];
}

/** Fit tiers from TSC_DESIGN_SYSTEM.md, plus "tradeoff" for a low score. */
export function tierFor(score) {
  if (score == null) return "none";
  if (score >= 90) return "strong";
  if (score >= 75) return "good";
  if (score >= 60) return "potential";
  return "low";
}

/** A counted check in the red (under 60), with its number kept: the standing is at most "Needs a look". */
export function redCheck(groups) {
  return (groups ?? []).filter((group) => GROUP_WEIGHTS[group.key])
    .flatMap((group) => group.checks ?? []).find((check) => check.weight && check.score != null && check.score < 60) ?? null;
}

export function standingFor(score, groups = null) {
  if (score == null) return { word: "Not checked", tone: "none" };
  if (score >= 85 && !redCheck(groups)) return { word: "Strong", tone: "strong" };
  if (score >= 60) return { word: "Needs a look", tone: "potential" };
  return { word: "Flagged", tone: "low" };
}

/* ------------------------------------------------------------ photos */

const PHOTO_POINTS = { own: 100, unchecked: 50, could_not: 50, elsewhere: 0 };
const FLAG_POINTS = { stock: 10, office: 40, tsc: 0 };

export function photoCaption(photo) {
  if (photo.flag === "stock") return "Stock photo";
  if (photo.flag === "office") return "Office, not a factory";
  if (photo.flag === "tsc") return `On ${photo.others} other TSC companies`;
  if (photo.result === "elsewhere") return photo.where ? `On ${photo.where}` : "Found elsewhere";
  if (photo.result === "unchecked") return "Not checked";
  if (photo.result === "could_not") return "Couldn't check";
  return null; // their own: no caption, only a mark
}

/** The Photos check, from the tiles: what staff record on a tile moves it. */
export function photoCheck(photos) {
  const n = photos.length;
  const points = photos.map((photo) => (photo.flag ? FLAG_POINTS[photo.flag] : PHOTO_POINTS[photo.result]));
  const score = n ? Math.round(points.reduce((sum, value) => sum + value, 0) / n) : null;
  const count = (test) => photos.filter(test).length;
  const own = count((photo) => photo.result === "own" && !photo.flag);
  const elsewhere = count((photo) => photo.flag === "tsc" || (!photo.flag && photo.result === "elsewhere"));
  const stock = count((photo) => photo.flag === "stock");
  const office = count((photo) => photo.flag === "office");
  const open = count((photo) => !photo.flag && (photo.result === "unchecked" || photo.result === "could_not"));
  let verdict;
  if (own === n) verdict = `All ${n} are their own`;
  else if (own === 0 && open === 0) verdict = `None of the ${n} is their own`;
  else {
    const parts = [`${own} of ${n} their own`];
    if (elsewhere) parts.push(`${elsewhere} found elsewhere`);
    if (stock) parts.push(`${stock} stock`);
    if (office) parts.push(`${office} office`);
    if (open) parts.push(`${open} not checked yet`);
    verdict = parts.join(", ");
  }
  return { score, verdict };
}

/* ---------------------------------------------------- staff records */

export const RECORD_RESULTS = {
  registry: [
    { key: "found", label: "Found" },
    { key: "name_differs", label: "Name differs" },
    { key: "not_found", label: "Not found" },
    { key: "could_not_check", label: "Couldn't check" },
  ],
  certificate: [
    { key: "found", label: "Found" },
    { key: "expired", label: "Expired" },
    { key: "not_found", label: "Not found" },
    { key: "could_not_check", label: "Couldn't check" },
  ],
};

/** What a staff record does to a registry or certificate check. */
export function recordedCheck(check, { result, reference, name, reason }) {
  const source = check.registry.source;
  const outcome = check.kind === "certificate"
    ? {
      found: { score: 92, verdict: "Found on the issuer's list" },
      expired: { score: 15, verdict: "Expired on the issuer's list" },
      not_found: { score: 5, verdict: "Not on the issuer's list" },
      could_not_check: { score: null, verdict: "Couldn't check the issuer's list" },
    }[result]
    : {
      found: { score: 90, verdict: `Found on ${source}, name and number match` },
      name_differs: { score: 60, verdict: `Found on ${source}, name differs` },
      not_found: { score: 5, verdict: `Not found on ${source}` },
      could_not_check: { score: null, counts: 5, verdict: `Couldn't check ${source}` },
    }[result];
  const next = { ...check, counts: undefined, ...outcome, registry: { ...check.registry, result, reference, name, by: "You, just now", for: null } };
  return reason ? withReason(next, reason) : next;
}

/**
 * A staff reason is on record, and lifts a low check to 60 ("needs a look"),
 * as a reason lifts Low to Medium on today's page. A check with no evidence
 * yet (no score) stays unscored: a reason is not a check.
 */
export function withReason(check, text) {
  const lifted = check.score != null && check.score < 60 ? 60 : check.score;
  return { ...check, score: lifted, reason: { text, by: "You, just now" } };
}

export const GROUP_TIPS = {
  business_registration: "The licence and the official registry: is this a registered company? Counts for 60% of the score.",
  company_information: "Factory or trader, and whether the address and photos are its own. Counts for 40% of the score.",
  certification: "Whether each certificate is real and current. Not part of the score.",
};

/** The Photos check is worked out from the tiles, so the mock and a staff record agree. */
export function withPhotoCheck(group) {
  if (group.evidence?.kind !== "photos") return group;
  const derived = photoCheck(group.evidence.photos);
  return { ...group, checks: group.checks.map((check) => (check.key === "photos" ? { ...check, ...derived, reason: check.reason } : check)) };
}
