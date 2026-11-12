/**
 * The staff review page's Verification score (Nov 12), from the records.
 *
 * Input: what `admin_verification_score_input()` returns (staff only).
 * Output: the `verification` object of the approved mock
 * (src/lib/domain/verification-score.contract.md), so the designed card and
 * its modals draw it as they draw the mock.
 *
 * Every number comes from fixed rules over recorded evidence (the approved
 * scoring, NOTE.md round 2), never from a model's opinion of itself: a model
 * may have READ a field; whether it agrees is our code's comparison. A check
 * with no evidence yet has no score: it counts as 0, says so, and is left
 * out of "Weakest", so an unchecked registry can never look passed.
 *
 * Plain functions, no network: the page, the queue and
 * `npm run check:verification-score` all run this.
 */
import { computeLevels } from "./verification-levels.mjs";
import { companyNameKey, registrySources } from "./registration-number.mjs";
import { certificateLookup } from "./certificate-lookups.mjs";

export const GROUP_WEIGHTS = { business_registration: 60, company_information: 40 };

export const SCORES = {
  licence: { clean: 95, taxPlate: 70, partial: 70, differs: 50, edited: 40, copy: 40, sample: 10, unreadable: 10, otherCompanyFirst: 5 },
  registry: { found: 90, partly: 80, nameDiffers: 60, document: 60, notFound: 5 },
  scope: { making: 100, trading: 10 },
  address: { same: 90, partDiffers: 70, elsewhere: 15, siteCap: 55, districtCap: 30, mapIndustrial: 60, mapOther: 40 },
  photo: { own: 100, unchecked: 50, could_not: 50, elsewhere: 0 },
  photoFlag: { stock: 10, office: 40, tsc: 0 },
  certificate: { found: 90, expired: 15, not_found: 5 },
  reasonFloor: 60,
};

/* ------------------------------------------------------------ arithmetic */

export function scoreGroup(group) {
  const counted = group.checks.filter((check) => check.weight);
  if (!counted.length) {
    const scored = group.checks.filter((check) => check.score != null);
    return scored.length ? Math.round(scored.reduce((sum, check) => sum + check.score, 0) / scored.length) : null;
  }
  // Nothing in the group checked yet: "Not checked", not 0%.
  if (!counted.some((check) => check.score != null)) return null;
  const total = counted.reduce((sum, check) => sum + check.weight, 0);
  return Math.round(counted.reduce((sum, check) => sum + (check.score ?? 0) * check.weight, 0) / total);
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
  if (!scored) return null;
  return weight ? Math.round(sum / weight) : null;
}

/** The lowest counted check that has a score: a check not done yet is a to-do, not evidence. */
export function weakestCheck(groups) {
  return groups
    .filter((group) => GROUP_WEIGHTS[group.key])
    .flatMap((group) => group.checks.filter((check) => check.weight && check.score != null).map((check) => ({ ...check, group: group.label })))
    .sort((a, b) => a.score - b.score)[0] ?? null;
}

export function tierFor(score) {
  if (score == null) return "none";
  if (score >= 90) return "strong";
  if (score >= 75) return "good";
  if (score >= 60) return "potential";
  return "low";
}

export function standingFor(score) {
  if (score == null) return { word: "Not checked", tone: "none" };
  if (score >= 85) return { word: "Strong", tone: "strong" };
  if (score >= 60) return { word: "Needs a look", tone: "potential" };
  return { word: "Flagged", tone: "low" };
}

/** A staff reason lifts a scored check under 60 to 60; an unscored one stays unscored. */
export function lifted(score, reason) {
  return reason && score != null && score < SCORES.reasonFloor ? SCORES.reasonFloor : score;
}

/* ------------------------------------------------------------ words */

const MONTH_DAY = { month: "short", day: "numeric" };
export function dayWords(iso, timeZone) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { ...MONTH_DAY, ...(timeZone ? { timeZone } : {}) });
}
export function stampWords(iso, timeZone) {
  if (!iso) return "";
  const date = new Date(iso);
  const day = date.toLocaleDateString("en-US", { ...MONTH_DAY, ...(timeZone ? { timeZone } : {}) });
  const time = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, ...(timeZone ? { timeZone } : {}) });
  return `${day}, ${time}`;
}
const byWords = (who, iso, timeZone) => [who, dayWords(iso, timeZone)].filter(Boolean).join(", ");
const hostOf = (link) => {
  try {
    return new URL(/^https?:/i.test(link) ? link : `https://${link}`).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

const SHORT_SOURCE = {
  qcc: "QCC", gib: "GİB", vies: "EU VIES", gsxt: "GSXT", certidao: "the certidão", acts: "the published acts",
  permit: "the permit site", national: "the national portal", other: "OpenCorporates", document: "the document",
  gazette: "the Trade Registry Gazette", edevlet: "e-Devlet",
};
const DEFAULT_SOURCE = { CN: "qcc", TR: "gib", PT: "vies", VN: "national" };
export const sourceWords = (key) => SHORT_SOURCE[key] ?? key ?? "the registry";

function defaultSource(country) {
  return DEFAULT_SOURCE[country] ?? "other";
}

/** "Open QCC" with the link and what to copy, for the registry sub-row. */
function registryLookup(country, sourceKey, registration, title) {
  const source = registrySources(country).find((s) => s.key === sourceKey)
    ?? registrySources(country).find((s) => s.key !== "document" && typeof s.url === "function");
  if (!source || typeof source.url !== "function") return null;
  const copy = source.copy === "accessCode" ? registration?.accessCode : registration?.number;
  return { label: `Open ${sourceWords(source.key).replace(/^the /, "")}`, href: source.url(registration, title), ...(copy ? { copy } : {}) };
}

/** One name is the other cut short: "Têxteis Douro, Lda" against "Têxteis Douro – Confecções, Lda". */
export function namesPartlyMatch(a, b) {
  const x = companyNameKey(a);
  const y = companyNameKey(b);
  if (!x || !y || x === y) return false;
  return x.startsWith(`${y} `) || y.startsWith(`${x} `);
}

const latest = (signals, kind, subjectId) => (signals ?? []).find((s) => s.kind === kind && (subjectId === undefined || s.subjectId === subjectId));
const capital = (text) => (text ? text[0].toUpperCase() + text.slice(1) : text);

/* ------------------------------------------------------------ reasons */

const REASON_KEYS = { license_read: "licence", registry: "registry", trading_scope: "scope", address_owner: "address", address_site: "address", photos: "photos" };

/** The newest staff reason per check key (`certificate:<id>` for a certificate). */
export function reasonsByKey(input, timeZone) {
  const out = {};
  for (const row of input.reasons ?? []) {
    const key = row.checkKey === "certificate" ? `certificate:${row.subjectId}` : REASON_KEYS[row.checkKey];
    if (!key || out[key]) continue;
    out[key] = { text: row.note, by: byWords(row.by, row.at, timeZone), at: row.at };
  }
  // A reason recorded on the old page for a trading licence counts too.
  const trading = input.rules?.tradingOnly?.explanation;
  if (trading?.note && (!out.scope || (trading.reviewedAt && out.scope.at && trading.reviewedAt > out.scope.at))) {
    out.scope = { text: trading.note, by: byWords(null, trading.reviewedAt, timeZone), at: trading.reviewedAt ?? null };
  }
  return out;
}

/* ------------------------------------------------------------ business registration */

function licenceLabel(country, reading) {
  const type = String(reading?.details?.extracted?.documentType ?? "");
  if (country === "TR") return /levha/i.test(type) ? "Tax plate" : "Tax registration letter";
  if (country === "PT") return "Registration certificate";
  if (country === "CN") return "Licence";
  return "Registration document";
}

export function licenceCheck({ reading, files, registration, country, title, licenseCopyLow }) {
  const label = licenceLabel(country, reading);
  const base = { key: "licence", label, weight: 30, reasonKey: "licence" };
  if (!files.length) return { ...base, score: null, verdict: "No licence uploaded", canReason: false };
  if (!reading) return { ...base, score: null, verdict: "Not read yet", canReason: true };
  const d = reading.details ?? {};
  const x = d.extracted ?? {};
  if (x.readable === false) return { ...base, score: SCORES.licence.unreadable, verdict: "Can't be read", canReason: true };
  const found = [];
  // `first`: among equal scores, the cause staff must act on is named (a number not read before a name).
  const add = (score, verdict, first = false) => found.push({ score, verdict, first });
  if (licenseCopyLow) add(SCORES.licence.otherCompanyFirst, "Same licence uploaded by another company first");
  if (x.specimen || d.specimen || x.markedAsSample) add(SCORES.licence.sample, "Marked as a sample");
  const warned = (kind) => (d.warnings ?? []).some((w) => w?.kind === kind);
  if (x.verificationWatermark || d.verificationWatermark || warned("verificationWatermark")) add(SCORES.licence.copy, "Copy, not the original licence");
  if (x.edited || d.edited || x.looksEdited) add(SCORES.licence.edited, "Looks edited");
  for (const line of d.differences ?? []) {
    const what = line.field === "number" ? "Number" : "Name";
    if (line.nearly) add(SCORES.licence.partial, `Read; ${what.toLowerCase()} nearly matches`);
    else if (line.field !== "number" && namesPartlyMatch(line.document, line.typed ?? title)) add(SCORES.licence.partial, "Read; legal name looks cut short");
    else add(SCORES.licence.differs, `${what} differs from what they typed`);
  }
  const numberNotRead = !String(x.registrationNumber ?? "").trim()
    || (d.unsure ?? []).some((line) => line.field === "number" && !String(line.document ?? "").trim());
  for (const line of d.unsure ?? []) {
    if (line.field === "number" && numberNotRead) continue;
    add(SCORES.licence.partial, `Read; ${line.field === "number" ? "number" : "name"} unsure`, line.field === "number");
  }
  if (numberNotRead) add(SCORES.licence.partial, "Number not read", true);
  else if (!x.legalName) add(SCORES.licence.partial, "Read; no legal name found on it");
  const problem = d.numberCheck?.problem;
  if (problem === "check_digit" || d.numberCheckDigitFails || x.numberCheckDigitFails) add(SCORES.licence.partial, "Read; number fails its check digit");
  else if (problem === "old_number" || problem === "format") add(SCORES.licence.partial, "Read; not a mainland credit code");
  if (label === "Tax plate") add(SCORES.licence.taxPlate, "Read, tax number valid");
  // A name the reading cut short, against the registry's longer one.
  // Only when the name read is the shorter one: a full legal name against a short trading title is not cut short.
  const plainLength = (name) => String(name ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().length;
  if (!(d.differences ?? []).length && x.legalName && plainLength(x.legalName) < plainLength(title) && namesPartlyMatch(x.legalName, title)) add(SCORES.licence.partial, "Read; legal name looks cut short");
  if (!found.length) {
    return { ...base, score: SCORES.licence.clean, verdict: country === "CN" ? "Original, every field readable" : "Every field read", short: country === "CN" ? "Original licence" : `${label} read`, canReason: true };
  }
  found.sort((a, b) => a.score - b.score || Number(b.first) - Number(a.first));
  const { first, ...worst } = found[0];
  return { ...base, ...worst, short: worst.verdict, canReason: true };
}

export function registryCheck({ detail, country, title, readName = null, timeZone }) {
  const reg = detail?.registration ?? null;
  const sourceKey = detail?.current && !detail.current.automatic && detail.current.source !== "document"
    ? detail.current.source : defaultSource(country);
  const base = { key: "registry", label: "Official registry", kind: "registry", weight: 30, reasonKey: "registry" };
  const lookup = reg?.number ? registryLookup(country, sourceKey, reg, title) : null;
  const record = (fields) => ({ source: sourceWords(sourceKey).replace(/^the /, ""), sourceKey, by: "", result: null, reference: "", name: title ?? "", ...fields });
  if (!reg) return { ...base, score: null, verdict: "No registration number yet", canReason: false, registry: record({}) };
  if (!reg.number && !reg.noCompanyNumber) return { ...base, score: null, verdict: "Number not read yet", canReason: true, registry: record({}), ...(lookup ? { lookup } : {}) };
  const current = detail.current ?? null;
  const checks = (detail.checks ?? []).filter((c) => !c.numberChecked || c.numberChecked === reg.number);
  let out;
  if (current) {
    const person = checks.find((c) => c.id === current.id) ?? {};
    const cd = current.details ?? {};
    const src = sourceWords(current.source);
    const by = current.automatic ? "Checked automatically" : byWords(person.checkedBy, current.checked_at, timeZone);
    const outcome = cd.outcome ?? (current.result === "found" && cd.nameDiffersConfirmed ? "name_differs" : current.result);
    const registry = record({
      source: src.replace(/^the /, ""), sourceKey: current.source, by, result: outcome === "mismatch" ? "not_found" : outcome,
      reference: cd.reference ?? "", name: (detail.renamedSinceCheck ? title : cd.name ?? title) ?? "",
    });
    if (detail.renamedSinceCheck) {
      out = { score: null, verdict: "Renamed since the check", registry: { ...registry, for: cd.titleAtCheck ?? cd.nameAtCheck ?? null } };
    } else if (current.result === "found" && current.source === "document") {
      out = { score: SCORES.registry.document, verdict: "Checked on the document only", short: "checked on the document only", registry };
    } else if (outcome === "name_differs" && cd.name && companyNameKey(cd.name) === companyNameKey(title)) {
      // Name differs chosen for the licence's difference, with the registry showing this very name.
      out = { score: SCORES.registry.found, verdict: `Found on ${src}, difference explained`, short: `found on ${src}`, registry };
    } else if (outcome === "name_differs") {
      out = { score: SCORES.registry.nameDiffers, verdict: `Found on ${src}, name differs`, short: `found on ${src}, name differs`, registry };
    } else if (current.result === "found") {
      out = detail.nameDiffers
        ? { score: SCORES.registry.nameDiffers, verdict: `Found on ${src}; another source names ${detail.nameDiffers}`, registry }
        : { score: SCORES.registry.found, verdict: `Found on ${src}, name and number match`, short: `found on ${src}`, registry };
    } else if (current.result === "mismatch") {
      out = { score: SCORES.registry.notFound, verdict: `${capital(src)} shows another company`, registry };
    } else if (current.result === "not_found") {
      out = { score: SCORES.registry.notFound, verdict: `Not found on ${src}`, registry };
    } else {
      out = { score: null, verdict: `Couldn't check ${src}`, registry };
    }
  } else {
    const auto = checks.find((c) => c.automatic);
    if (auto) {
      const src = sourceWords(auto.source);
      const registry = record({ source: src, sourceKey: auto.source, by: "Checked automatically",
        // Approve still needs a person's record (registry_approval_problem: no_check), so the row keeps its form.
        recordable: true,
        result: auto.result === "registered" ? "found" : auto.result, reference: auto.numberChecked ? `${country ?? ""}${auto.numberChecked}` : "" });
      const name = String(auto.details?.name ?? "").trim();
      if (auto.result === "registered") {
        const named = name && !/^-+$/.test(name);
        if (!named) out = { score: SCORES.registry.partly, verdict: `${src}: VAT number valid`, short: `valid on ${src}`, registry };
        // The name read off their document is the registry's cut short: matches only in part.
        else if (auto.nameMatches && readName && namesPartlyMatch(readName, name)) out = { score: SCORES.registry.partly, verdict: `${src}: VAT number valid, name partly matches`, short: `valid on ${src}`, registry };
        else if (auto.nameMatches) out = { score: SCORES.registry.found, verdict: `${src}: VAT number valid, name matches`, short: `name and VAT number match ${src}`, registry };
        else if (namesPartlyMatch(name, title)) out = { score: SCORES.registry.partly, verdict: `${src}: VAT number valid, name partly matches`, short: `valid on ${src}`, registry };
        else out = { score: SCORES.registry.nameDiffers, verdict: `${src}: VAT number valid, name differs`, registry };
      } else if (auto.result === "not_found") {
        out = { score: SCORES.registry.notFound, verdict: `${src}: not registered for VAT`, registry };
      } else {
        out = { score: null, verdict: `Couldn't check ${src}`, registry };
      }
    } else {
      out = { score: null, verdict: "Not checked yet", registry: record({}) };
    }
  }
  // A number another company uses, not explained: the registry check can't say whose it is.
  if ((detail.duplicates ?? []).length && !detail.duplicateExplained && out.score != null && out.score > SCORES.registry.nameDiffers) {
    out = { ...out, score: SCORES.registry.nameDiffers, verdict: `${out.verdict}; number also used by ${detail.duplicates.map((o) => o.name).join(", ")}`, short: null };
  }
  return { ...base, ...out, canReason: true, ...(lookup ? { lookup } : {}) };
}

const NUMBER_LABEL = { CN: "Registration number", TR: "Tax number (VKN)", PT: "NIPC (company number)" };

function registrationFields({ reading, detail, country, timeZone }) {
  const x = reading?.details?.extracted ?? {};
  const reg = detail?.registration ?? {};
  const differences = reading?.details?.differences ?? [];
  const typedOf = (field) => differences.find((line) => line.field === field && !line.nearly)?.typed ?? null;
  const fields = [];
  const push = (field) => { if (field.value || field.always) fields.push(Object.fromEntries(Object.entries(field).filter(([k]) => k !== "always"))); };
  const duplicates = detail?.duplicates ?? [];
  const explained = detail?.duplicateExplained;
  push({
    key: "number", label: NUMBER_LABEL[country] ?? "Registration number", value: String(x.registrationNumber || reg.number || ""), copy: true, editable: true, always: true,
    ...(country === "TR" ? { wide: true } : {}),
    ...(typedOf("number") ? { typed: String(typedOf("number")) } : {}),
    ...(duplicates.length ? { duplicate: {
      with: duplicates.map((o) => o.name).join(", "), orgIds: duplicates.map((o) => o.orgId),
      explained: explained ? { text: explained.note, by: byWords(explained.reviewedBy, explained.reviewedAt, timeZone), at: explained.reviewedAt } : null,
    } } : {}),
  });
  if (country === "PT") push({ key: "accessCode", label: "Access code", value: reg.accessCode ?? "", copy: true });
  if (country === "TR") push({ key: "letterNumber", label: "Letter number", value: reg.registrationLetterNumber ?? "", copy: true });
  if (country === "TR") push({ key: "taxOffice", label: "Tax office", value: x.taxOffice ?? "" });
  push({ key: "established", label: country === "PT" ? "Registered" : "Established", value: reading?.details?.foundedOn ?? x.foundingDate ?? x.issueDate ?? "" });
  push({ key: "legalName", label: "Legal name", value: x.legalName ?? "", editable: true, always: Boolean(reading), ...(typedOf("name") ? { typed: String(typedOf("name")) } : {}), ...(country === "TR" ? { wide: true } : {}) });
  push({ key: "representative", label: "Legal representative", value: x.legalRepresentative ?? "" });
  push({ key: "legalNameEnglish", label: "Name in English", value: x.legalNameEnglish ?? "", wide: true });
  const codes = (x.activityCodes ?? []).join(" · ");
  if (country === "PT" || country === "TR") push({ key: "activity", label: country === "PT" ? "Activity code (CAE)" : "Main activity", value: codes || (country === "TR" ? x.businessScope ?? "" : ""), wide: country === "PT" });
  push({ key: "address", label: country === "PT" ? "Registered address" : "Address", value: x.address ?? "", wide: true, editable: true });
  return reading ? fields : [];
}

/* ------------------------------------------------------------ company information */

export function scopeCheck({ reading, level, country }) {
  const base = { key: "scope", label: "Factory or trader", weight: 10, reasonKey: "scope" };
  const scope = reading?.details?.tradingScope;
  if (!reading) return { ...base, score: null, verdict: "Licence not read yet", canReason: false };
  if (!scope?.read || scope.recognised === false || level?.level === "unknown") return { ...base, score: null, verdict: "Can't tell from the licence", canReason: true };
  const quote = scope.quote ? ` (${scope.quote})` : "";
  if (level?.level === "low" || scope.trading) {
    return { ...base, score: SCORES.scope.trading, verdict: country === "TR" || country === "PT" ? "Wholesale trade only, no manufacturing" : `Trading only${quote}`, canReason: true, trading: true };
  }
  return { ...base, score: SCORES.scope.making, verdict: scope.makingFrom === "codes" ? `Making activity code${quote}` : `Licence includes making${quote}`, short: "licence includes making", canReason: true };
}

const PART_WORDS = { province: "Province", city: "City", district: "District", town: "Neighbourhood", road: "Street", number: "Building or street number", postcode: "Postcode" };

export function addressCheck({ owner, siteSignal, typedAddress }) {
  const base = { key: "address", label: "Address", weight: 15, reasonKey: "address" };
  const lookup = typedAddress ? { label: "Open map", href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(typedAddress)}` } : null;
  const comparisons = owner?.details?.comparisons ?? [];
  const differing = comparisons.find((c) => c.verdict === "differs" && c.between.includes("license"))
    ?? comparisons.find((c) => c.verdict === "differs");
  const part = differing?.differs?.[0]?.part;
  const against = differing && differing.between.includes("license") ? "the licence" : "the registry";
  let score = null;
  let verdict = "Not checked yet";
  const level = owner?.level ?? "unknown";
  if (level === "high") { score = SCORES.address.same; verdict = "Same as the licence"; }
  else if (level === "medium") {
    score = SCORES.address.partDiffers;
    verdict = part ? `${PART_WORDS[part] ?? "Part"} differs from ${against}`
      : comparisons.some((c) => c.verdict === "near") ? "Nearly the same as the licence" : "Only the area matches the licence";
  } else if (level === "low") {
    score = SCORES.address.elsewhere;
    verdict = differing && !differing.between.includes("typed") ? "Licence and registry addresses differ"
      : part ? `${PART_WORDS[part] ?? "Address"} differs from ${against}` : "Not the licence's address";
  }
  const d = siteSignal?.details ?? {};
  const kind = siteSignal?.result;
  const capWith = (cap, words, mapOnly) => {
    if (score == null) { score = mapOnly; verdict = words; return; }
    if (score > cap) { score = cap; verdict = words; }
  };
  if (siteSignal && d.found === false) {
    if (score == null) verdict = "Not found on the map";
  } else if (siteSignal && d.precise === false) {
    capWith(SCORES.address.districtCap, "District only, no street or building", SCORES.address.districtCap);
  } else if (kind === "residential") {
    capWith(SCORES.address.siteCap, "Looks like a home, not a factory site", SCORES.address.mapOther);
  } else if (kind === "office") {
    capWith(SCORES.address.siteCap, "An office, not a factory site", SCORES.address.mapOther);
  } else if (kind === "industrial") {
    if (score == null) { score = SCORES.address.mapIndustrial; verdict = "In an industrial area"; }
    else if (level === "high") verdict = "Same as the licence, in an industrial area";
  }
  return { ...base, score, verdict, short: score != null && score >= 75 ? verdict.toLowerCase() : null, canReason: Boolean(typedAddress || siteSignal || owner), ...(lookup ? { lookup } : {}) };
}

/** Each tile's result and flag from the staff record, the photo check and the copies across TSC. */
export function photoTiles({ photos, signals, photoCheck, timeZone }) {
  const perPhoto = new Map((photoCheck?.details?.perPhoto ?? []).map((entry) => [entry.documentId, entry]));
  return (photos ?? []).map((photo) => {
    const entry = perPhoto.get(photo.id) ?? null;
    const mark = (signals ?? []).find((x) => x.kind === "photo" && x.subjectId === photo.id && !x.automatic);
    const tile = { id: photo.id, name: photo.name, bucket: photo.bucket, path: photo.path, result: "unchecked" };
    if (mark) {
      tile.result = { own: "own", found_elsewhere: "elsewhere", could_not_check: "could_not" }[mark.result] ?? "unchecked";
      tile.by = byWords(mark.checkedBy, mark.checkedAt, timeZone);
      if (mark.details?.link) { tile.link = mark.details.link; tile.where = hostOf(mark.details.link); }
    }
    const later = (entry?.duplicateOf ?? []).filter((copy) => copy.mineLater);
    if (later.length) { tile.flag = "tsc"; tile.others = new Set(later.map((copy) => copy.otherOrgId)).size; }
    // "Stock" is the AI's impression: staff recording the photo as their own overrules it.
    // An office photo stays an office however it is recorded, and a later copy stays a copy.
    else if (entry?.ai?.kind === "stock_or_marketing" && tile.result !== "own") tile.flag = "stock";
    else if (entry?.ai?.kind === "office_or_showroom") tile.flag = "office";
    if (entry?.reverseSearch) tile.reverseSearch = entry.reverseSearch;
    return tile;
  });
}

export function tilePoints(tile) {
  if (tile.result === "elsewhere") return SCORES.photo.elsewhere;
  return tile.flag ? SCORES.photoFlag[tile.flag] : SCORES.photo[tile.result];
}

export function photosCheck(tiles) {
  const base = { key: "photos", label: "Photos", weight: 15, reasonKey: "photos" };
  const n = tiles.length;
  if (!n) return { ...base, score: null, verdict: "No photos uploaded", canReason: false };
  const score = Math.round(tiles.reduce((sum, tile) => sum + tilePoints(tile), 0) / n);
  const count = (test) => tiles.filter(test).length;
  const own = count((t) => t.result === "own" && !t.flag);
  const elsewhere = count((t) => t.flag === "tsc" || t.result === "elsewhere");
  const stock = count((t) => t.flag === "stock" && t.result !== "elsewhere");
  const office = count((t) => t.flag === "office" && t.result !== "elsewhere");
  const open = count((t) => !t.flag && (t.result === "unchecked" || t.result === "could_not"));
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
  return { ...base, score, verdict, canReason: true };
}

/* ------------------------------------------------------------ certification */

const monthYear = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }) : "");

export function certificateChecks({ certificates, signals, now, timeZone }) {
  const today = String(now ?? new Date().toISOString()).slice(0, 10);
  return (certificates ?? []).map((cert) => {
    // Staff's record on the issuer's list decides; Run again's automatic reading (result "read") only
    // supplies the date and holder it read off the certificate.
    const mark = (signals ?? []).find((x) => x.kind === "certificate" && x.subjectId === cert.id && !x.automatic);
    const read = (signals ?? []).find((x) => x.kind === "certificate" && x.subjectId === cert.id && x.automatic);
    const expiresAt = cert.expiresAt ?? read?.details?.validUntil ?? null;
    const lookupDef = certificateLookup(cert.slug);
    const number = mark?.details?.number ?? "";
    const href = typeof lookupDef.url === "function" ? lookupDef.url(number, null) : null;
    const expiredByDate = expiresAt && String(expiresAt).slice(0, 10) < today;
    const result = mark?.result ?? null;
    let score = null;
    let verdict = "Not checked yet";
    if (result === "found") { score = SCORES.certificate.found; verdict = `Found on the issuer's list${expiresAt && !expiredByDate ? `, valid to ${monthYear(expiresAt)}` : ""}`; }
    else if (result === "expired") { score = SCORES.certificate.expired; verdict = "Expired on the issuer's list"; }
    else if (result === "not_found") { score = SCORES.certificate.not_found; verdict = "Not on the issuer's list"; }
    else if (result === "could_not_check") verdict = "Couldn't check the issuer's list";
    if (score == null && read?.details?.holderMatches === false) verdict = "Holder differs from the company";
    if (expiredByDate && (score == null || score > SCORES.certificate.expired)) { score = SCORES.certificate.expired; verdict = `Expired ${monthYear(expiresAt)}`; }
    return {
      key: `certificate:${cert.id}`, label: cert.label, kind: "certificate", subjectId: cert.id, reasonKey: "certificate", canReason: true,
      score, verdict,
      registry: { source: "Issuer's list", sourceKey: "issuer", by: mark ? byWords(mark.checkedBy, mark.checkedAt, timeZone) : "", result, reference: mark?.details?.link ?? "" },
      ...(href ? { lookup: { label: "Open issuer's list", href, ...(number ? { copy: number } : {}) } } : {}),
      checkedAt: mark?.checkedAt ?? read?.checkedAt ?? null,
    };
  });
}

/** The certificate's fields: what Run again read off it (or staff typed), each editable for the next run. */
function certFields(cert, signals, title) {
  const read = (signals ?? []).find((x) => x.kind === "certificate" && x.subjectId === cert.id && x.automatic)?.details ?? {};
  const staffNumber = (signals ?? []).find((x) => x.kind === "certificate" && x.subjectId === cert.id && !x.automatic)?.details?.number ?? "";
  return [
    { key: "certNumber", label: "Certificate number", value: String(read.certNumber ?? staffNumber ?? ""), copy: true, editable: true },
    { key: "validUntil", label: "Valid until", value: String(read.validUntil ?? cert.expiresAt ?? "").slice(0, 10), editable: true },
    { key: "holder", label: "Holder", value: String(read.holder ?? ""), wide: true, editable: true, ...(read.holder ? {} : { placeholder: title }) },
  ];
}

/* ------------------------------------------------------------ approval */

/** What Approve waits for, named by where it is done on the new screen. */
export function approvalBlockWords(problem, detail) {
  if (!problem) return null;
  const src = sourceWords(detail?.current?.source ?? defaultSource(detail?.registration?.country ?? detail?.countryCode));
  return {
    no_check: detail?.current && detail.current.result !== "found" ? `Registry: the last check on ${src} found no match` : "Registry: record a check first",
    renamed: "Registry: renamed since the check, check it again",
    name_differs: "Registry: name differs, record Name differs with a reason",
    document_differs: "Registry: the licence differs from what they typed, record Name differs with a reason",
    duplicate: "Shared number: explain it first",
    number_check_digit_fails: "Number fails its check digit: correct it from the licence",
    number_needs_staff: "Number: type it from the licence",
    number_unread: "Number not read: ask for a clearer licence",
    trading_only: "Factory or trader: add a reason first",
  }[problem] ?? "Not ready to approve";
}

/* ------------------------------------------------------------ all together */

/** The header's "why" for a rename: what was checked, and what changed since. */
export function renamedWhy(registry, title) {
  const was = String(registry?.for ?? "").trim();
  const now = String(title ?? "").trim();
  const source = registry?.source ?? "The registry";
  if (!was) return `${source} was checked before the company changed its name.`;
  const plain = (name) => name.normalize("NFKC").replace(/\s+/g, " ").toLowerCase();
  const change = !now ? "the name has changed since"
    : plain(now).length > plain(was).length && namesPartlyMatch(was, now) ? "the name is now longer"
      : plain(now).length < plain(was).length && namesPartlyMatch(was, now) ? "the name is now shorter"
        : `the name is now “${now}”`;
  return `${source} was checked for “${was}”; ${change}.`;
}

function groupVerdict(checks, good, { title } = {}) {
  const counted = checks.filter((c) => c.weight);
  const renamed = counted.find((c) => c.verdict === "Renamed since the check");
  if (renamed) return { verdict: "Renamed since the registry check", lead: renamed, explain: renamedWhy(renamed.registry, title) };
  const weak = counted.filter((c) => c.score != null && c.score < 75).sort((a, b) => a.score - b.score)[0];
  if (weak) return { verdict: weak.verdict, lead: weak };
  const open = counted.find((c) => c.score == null);
  if (open) return { verdict: `${open.label}: ${open.verdict.toLowerCase()}`, lead: open };
  return { verdict: good(), lead: null };
}

const whyFrom = (checks, lead) => checks.filter((c) => c !== lead).map((c) => `${c.label}: ${c.verdict}`).join(". ").concat(checks.length > 1 ? "." : "");

export function scoreVerification(input, { timeZone } = {}) {
  const detail = input?.detail ?? {};
  const extra = input?.extra ?? {};
  const signals = extra.signals ?? [];
  const now = input?.now ?? new Date().toISOString();
  const country = detail.registration?.country ?? detail.countryCode ?? input?.profile?.countryCode ?? null;
  const title = detail.title ?? input?.profile?.legalName ?? input?.profile?.name ?? "";
  const files = extra.registrationFiles ?? [];
  const reading = latest(signals, "document_reading");
  const reasons = reasonsByKey(input ?? {}, timeZone);
  const photoCheck = input?.photoCheck ?? null;

  // The level rules already merge every arrived result (address, licence copies): reused, with no staff reasons
  // in them, so a reason lifts a score once, here.
  const { results } = computeLevels({
    detail,
    extra: { ...extra, rules: { ...(input?.rules ?? {}), reasons: {}, tradingOnly: input?.rules?.tradingOnly ? { ...input.rules.tradingOnly, explanation: null } : null }, checkResults: photoCheck ? [photoCheck] : [] },
  });
  const level = Object.fromEntries(results.map((r) => [r.key, r]));
  const licenseCopyLow = (photoCheck?.licenseCopy ?? photoCheck?.details?.licenseCopy)?.level === "low";

  const withReason = (check) => {
    const reason = reasons[check.key];
    if (!reason || check.canReason === false) return check;
    return { ...check, score: lifted(check.score, reason), reason: { text: reason.text, by: reason.by, at: reason.at } };
  };
  const clean = (check) => Object.fromEntries(Object.entries(check).filter(([k]) => !["short", "trading", "checkedAt"].includes(k)));

  // Business registration
  const licence = withReason(licenceCheck({ reading, files, registration: detail.registration, country, title, licenseCopyLow }));
  const registry = withReason(registryCheck({ detail, country, title, readName: reading?.details?.extracted?.legalName ?? null, timeZone }));
  const brChecks = [licence, registry];
  const brVerdict = groupVerdict(brChecks, () => `${licence.short ?? licence.verdict}, ${registry.short ?? registry.verdict.toLowerCase()}`, { title });
  const staleWords = (() => {
    if (!reading) return null;
    if (files[0] && reading.subjectId && reading.subjectId !== files[0].id) {
      const earlier = files.find((f) => f.id === reading.subjectId);
      return `Read from an earlier upload${earlier?.createdAt ? `, ${dayWords(earlier.createdAt, timeZone)}` : ""}`;
    }
    const at = reading.details?.numberAtReading;
    if (at !== undefined && (at ?? null) !== (detail.registration?.number ?? null)) return "Read before the number changed";
    return null;
  })();
  const business = {
    key: "business_registration",
    label: "Business registration",
    verdict: brVerdict.verdict,
    why: [brVerdict.explain, whyFrom(brChecks, brVerdict.lead), reading?.details?.extracted?.watermarkText ? `Stamped “${reading.details.extracted.watermarkText}”.` : ""].filter(Boolean).join(" "),
    checking: Boolean(input?.pending?.registration),
    evidence: files.length
      ? { kind: "licence", files: files.map((f) => ({ id: f.id, name: f.name, bucket: f.bucket, path: f.path, mimeType: f.mimeType ?? null, when: dayWords(f.createdAt, timeZone) })) }
      : { kind: "none" },
    readAt: reading ? `Read ${stampWords(reading.checkedAt, timeZone)}` : "",
    readAtIso: reading?.checkedAt ?? null,
    stale: staleWords,
    fields: registrationFields({ reading, detail, country, timeZone }),
    checks: brChecks.map(clean),
  };

  // Company information
  const typedAddress = String(detail.productionAddress ?? "").trim() || String(detail.location ?? "").trim();
  const siteSignal = signals.find((s) => s.kind === "address" && s.automatic) ?? latest(signals, "address") ?? null;
  const scope = withReason(scopeCheck({ reading, level: level.trading_scope, country }));
  const address = withReason(addressCheck({ owner: level.address_owner, siteSignal, typedAddress }));
  const tiles = photoTiles({ photos: extra.photos, signals, photoCheck, timeZone });
  const photos = withReason(photosCheck(tiles));
  const ciChecks = [scope, address, photos];
  const ciVerdict = groupVerdict(ciChecks, () => `Factory: ${scope.short ?? scope.verdict.toLowerCase()}`);
  const licenceAddress = String(reading?.details?.extracted?.address ?? "").trim();
  const x = reading?.details?.extracted ?? {};
  const scopeText = String(x.businessScope ?? "").trim() || (x.activityCodes ?? []).join(" · ");
  const ciStamp = [photoCheck?.checkedAt, siteSignal?.checkedAt].filter(Boolean).sort().at(-1) ?? null;
  const company = {
    key: "company_information",
    label: "Company information",
    verdict: ciVerdict.verdict,
    why: whyFrom(ciChecks, ciVerdict.lead),
    checking: Boolean(input?.pending?.photos),
    evidence: tiles.length ? { kind: "photos", photos: tiles } : { kind: "none" },
    readAt: ciStamp ? `Checked ${stampWords(ciStamp, timeZone)}` : "",
    readAtIso: ciStamp,
    stale: null,
    fields: [
      ...(scopeText ? [{ key: "scope", label: country === "TR" ? "Activity on the tax plate" : country === "PT" ? "Activity on the certificate" : "Business scope on the licence", value: scopeText, wide: true, multiline: true, editable: true }] : []),
      ...(typedAddress ? [{
        key: "siteAddress", label: "Factory address", value: typedAddress, wide: true, editable: true,
        ...(licenceAddress && address.score != null && address.score < SCORES.address.same && level.address_owner?.level !== "high" ? { licence: licenceAddress } : {}),
      }] : []),
    ],
    checks: ciChecks.map(clean),
  };

  // Certification evidence (shown, not counted)
  const certs = extra.certificates ?? [];
  const certChecks = certificateChecks({ certificates: certs, signals, now, timeZone }).map(withReason);
  const certScored = certChecks.filter((c) => c.score != null).sort((a, b) => a.score - b.score);
  const certWeak = certScored[0] ?? certChecks[0] ?? null;
  const certWithFile = certs.find((c) => c.document) ?? certs[0] ?? null;
  const certStamp = certChecks.map((c) => c.checkedAt).filter(Boolean).sort().at(-1) ?? null;
  const certification = certs.length
    ? {
      key: "certification",
      label: "Certification evidence",
      verdict: certChecks.length === 1 ? `${certChecks[0].label}: ${certChecks[0].verdict}` : `${certWeak.label}: ${certWeak.verdict}`,
      why: certChecks.length > 1 ? certChecks.filter((c) => c !== certWeak).map((c) => `${c.label}: ${c.verdict}`).join(". ").concat(".") : "",
      checking: false,
      evidence: {
        kind: "certificate", name: certWithFile.label, number: "", valid: certWithFile.expiresAt ? dayWords(`${String(certWithFile.expiresAt).slice(0, 10)}T12:00:00Z`, "UTC") : "", holder: title,
        file: certWithFile.document ? { id: certWithFile.document.id, name: certWithFile.document.name, bucket: certWithFile.document.bucket, path: certWithFile.document.path, mimeType: certWithFile.document.mimeType ?? null } : null,
        certificates: certs.map((c) => ({ id: c.id, label: c.label, file: c.document ? { id: c.document.id, name: c.document.name, bucket: c.document.bucket, path: c.document.path, mimeType: c.document.mimeType ?? null } : null })),
      },
      readAt: certStamp ? `Checked ${stampWords(certStamp, timeZone)}` : "",
      readAtIso: certStamp,
      stale: null,
      fields: certFields(certWithFile, signals, title),
      checks: certChecks.map(clean),
    }
    : {
      key: "certification", label: "Certification evidence", verdict: "No certificate uploaded", why: "", checking: false,
      evidence: { kind: "none" }, readAt: "", readAtIso: null, stale: null, fields: [],
      checks: [{ key: "certificate", label: "Certificates", score: null, verdict: "None uploaded", reasonKey: "certificate", canReason: false }],
    };

  const groups = [business, company, certification].map((group) => {
    const score = scoreGroup(group);
    return { ...group, score, tier: tierFor(score) };
  });
  const overall = scoreOverall(groups);
  const weakest = weakestCheck(groups);
  const approvalProblem = input?.rules?.approvalProblem ?? detail.approvalProblem ?? null;

  return {
    overall,
    standing: standingFor(overall),
    tier: tierFor(overall),
    weakest: weakest ? { key: weakest.key, label: weakest.label, group: weakest.group, score: weakest.score, verdict: weakest.verdict } : null,
    approvalProblem,
    approvalBlock: approvalBlockWords(approvalProblem, detail),
    facts: factsFrom({ input, reading, files, typedAddress, timeZone, country, licenceLabel: licence.label }),
    groups,
  };
}

/* ------------------------------------------------------------ review details */

const DETAIL_FIELDS = [["legalName", "legal name"], ["website", "website"], ["location", "location"], ["employees", "team size"], ["foundedYear", "year founded"], ["intro", "introduction"]];

function factsFrom({ input, reading, files, typedAddress, timeZone, country, licenceLabel }) {
  const facts = [];
  const terms = input?.terms;
  const signer = terms?.signedBy && terms.signature && companyNameKey(terms.signedBy) !== companyNameKey(terms.signature)
    ? `${terms.signature} (account: ${terms.signedBy})` : terms?.signature || terms?.signedBy || "";
  facts.push(terms
    ? { key: "terms", label: "Terms signed", value: [signer, dayWords(terms.acceptedAt, timeZone)].filter(Boolean).join(", "), ok: true }
    : { key: "terms", label: "Terms signed", value: "Not signed", ok: false });
  facts.push(files.length
    ? { key: "registration", label: "Registration uploaded", value: files[0].name, ok: true }
    : { key: "registration", label: "Registration uploaded", value: "Not uploaded", ok: false });
  const profile = input?.profile ?? {};
  const present = DETAIL_FIELDS.filter(([key]) => profile[key] != null && String(profile[key]).trim() !== "");
  const complete = present.length === DETAIL_FIELDS.length;
  const listed = present.map(([, words]) => words);
  facts.push({
    key: "details", label: "Company details", ok: complete,
    value: complete ? "Complete" : listed.length ? `${capital(listed.length > 1 ? `${listed.slice(0, -1).join(", ")} and ${listed.at(-1)}` : listed[0])} only` : "Not filled in",
  });
  if (typedAddress) facts.push({ key: "address", label: "Address", value: typedAddress });
  const founded = reading?.details?.foundedOn ?? null;
  const where = licenceLabel === "Tax plate" ? "the tax plate" : country === "PT" ? "the certificate" : "the licence";
  if (founded) {
    const start = new Date(`${String(founded).slice(0, 10)}T12:00:00Z`);
    const years = Math.floor((new Date(input?.now ?? Date.now()) - start) / (365.25 * 24 * 3600 * 1000));
    const label = licenceLabel === "Tax plate" ? "tax plate" : country === "PT" ? "certificate" : "licence";
    facts.push({ key: "age", label: "Company age", value: `${years} ${years === 1 ? "year" : "years"} (${label}: ${start.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })})` });
  } else if (reading) {
    facts.push({ key: "age", label: "Company age", value: `Not on ${where}` });
  }
  const who = input?.submittedBy;
  if (who) facts.push({ key: "submittedBy", label: "Submitted by", value: [who.name, who.email].filter(Boolean).join(" · ") });
  return facts;
}
