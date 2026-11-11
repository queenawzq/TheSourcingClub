/**
 * Verification v3: each check's level, by fixed rules over the evidence.
 *
 * A level is `high | medium | low | unknown` with short reasons. Nothing here
 * is a percentage and nothing comes from a model's opinion of itself: the
 * model may have READ a field, but whether that reading agrees with the typed
 * one is our code's comparison (CLAUDE.md: confidence scores are not built;
 * v3 lifts that only for levels computed from evidence).
 *
 * Contract shared with api/registry-assist.js and api/photo-check.js: a check
 * result is `{ key, level, reasons: string[], details: object, checkedAt }`.
 * A result that arrives in that shape replaces the one derived here from v2
 * data (`mergeArrived`).
 *
 * Overall = the lowest level among decisive checks (any not `unknown`),
 * and never High while the license read or the registry is undecided.
 * Video is never decisive: it is not submitted yet.
 */

export const LEVELS = ["low", "medium", "high", "unknown"];
export const LEVEL_WORDS = { high: "High", medium: "Medium", low: "Low", unknown: "Can't tell" };
export const LEVEL_TONE = { high: "success", medium: "warning", low: "danger", unknown: "neutral" };
const RANK = { low: 0, medium: 1, high: 2 };

/**
 * v3.1 principles (fix round, Nov 11):
 *   - a check that can't tell says Can't tell, never Low;
 *   - Low is only for real evidence of a trader or fraud;
 *   - anything the company writes about itself is Medium at most;
 *   - every Low or Medium row says what would settle it;
 *   - a staff reason on a row lifts Low to Medium and is shown.
 *
 * Field names other sessions own and had not fixed when this was written,
 * in one place so the coordinator can rename them here.
 */
export const FIELD_NAMES = {
  // admin_verification_rules(): staff reasons per check, { [checkKey]: { note, reasonedAt, reasonedBy } } (sql, e08429f)
  explanations: "reasons",
  // admin_verification_rules(): { insuredStaff, foundedOn, recordedAt, claimedEmployees, claimedFoundedYear } (sql, e08429f)
  companyFacts: "companyFacts",
  // document_reading details.tradingScope: activity codes printed on the document (PT CAE, TR NACE)
  activityCodes: ["activityCodes", "codes"],
  // document_reading details.extracted: the founding date read off the licence
  foundedOn: ["foundedOn", "establishedOn", "foundedDate", "establishmentDate"],
  // address signal details: the placement is a road / came from the shortened query / the typed address / office words on the licence
  placementRoad: ["roadPlacement", "placedOnRoad"],
  shortenedQuery: ["shortened", "fromShortQuery"],
  officeText: ["officeText", "officeAddress"],
};
const pick = (object, names) => {
  for (const name of [].concat(names)) if (object?.[name] != null) return object[name];
  return undefined;
};

export const CHECKS = [
  { key: "license_read", label: "License read" },
  { key: "registry", label: "Registry" },
  { key: "trading_scope", label: "Trading scope" },
  { key: "address_owner", label: "Address belongs to this factory" },
  { key: "address_site", label: "Address is a factory site" },
  { key: "photos", label: "Photos" },
  { key: "company_facts", label: "Company size and age" },
  { key: "video", label: "Video" },
];
export const CHECK_KEYS = CHECKS.map((check) => check.key);

const result = (key, level, reasons, details = {}, checkedAt = null) => ({ key, level, reasons, details, checkedAt });

/** The lower of two levels; `unknown` never lowers a decided one. */
export function lowerOf(a, b) {
  if (a === "unknown") return b;
  if (b === "unknown") return a;
  return RANK[a] <= RANK[b] ? a : b;
}
/** Cap a level at `max` (unknown stays unknown). */
export function capAt(level, max) {
  return level === "unknown" ? level : RANK[level] <= RANK[max] ? level : max;
}

function latest(signals, kind, subjectId) {
  return (signals ?? []).find((signal) => signal.kind === kind && (subjectId === undefined || signal.subjectId === subjectId));
}

// --- license read -----------------------------------------------------------

export function licenseRead({ reading, hasFile, latestFileId, currentNumber }) {
  if (!hasFile) return result("license_read", "unknown", ["No registration document"]);
  if (!reading) return result("license_read", "unknown", ["Not read yet"]);
  const d = reading.details ?? {};
  const x = d.extracted ?? {};
  const at = reading.checkedAt ?? null;
  const base = { fileName: d.fileName ?? null, extracted: x, differences: d.differences ?? [] };
  if (x.readable === false) return result("license_read", "low", ["Not readable as a registration document"], base, at);
  if (latestFileId && reading.subjectId && reading.subjectId !== latestFileId) return result("license_read", "unknown", ["Read from an earlier upload"], base, at);
  if (d.numberAtReading !== undefined && (d.numberAtReading ?? null) !== (currentNumber ?? null)) return result("license_read", "unknown", ["Read before the number changed"], base, at);
  const reasons = [];
  let level = "high";
  if (x.specimen || d.specimen || x.markedAsSample) { level = "low"; reasons.push("Looks like a specimen or sample"); }
  // Edited is the AI's impression, not evidence: Medium until staff compare it with the registry.
  if (x.edited || d.edited || x.looksEdited) { level = lowerOf(level, "medium"); reasons.push("Looks edited: compare it with the registry"); }
  if (x.verificationWatermark || d.verificationWatermark) reasons.push("Marked for verification use only (normal)");
  for (const line of d.differences ?? []) {
    level = "low";
    reasons.push(`${line.field === "number" ? "Number" : "Name"} differs: document "${line.document || "none"}", typed "${line.typed ?? ""}"`);
  }
  const missing = [["registrationNumber", "number"], ["legalName", "legal name"]].filter(([field]) => !x[field]).map(([, words]) => words);
  if (missing.length) { level = lowerOf(level, "medium"); reasons.push(`Not read: ${missing.join(", ")}`); }
  if (d.numberCheckDigitFails || x.numberCheckDigitFails) { level = lowerOf(level, "medium"); reasons.push("Number read, check digit fails: type it from the image"); }
  if (!reasons.length || reasons.every((line) => line.endsWith("(normal)"))) reasons.unshift("Number and name read from the document");
  return result("license_read", level, reasons, base, at);
}

// --- registry ---------------------------------------------------------------

export function registry(detail) {
  const reg = detail?.registration;
  if (!reg?.number) return result("registry", "unknown", [reg?.noCompanyNumber ? "No company number (sole proprietor)" : "No number given"]);
  const checks = (detail.checks ?? []).filter((check) => !check.numberChecked || check.numberChecked === reg.number);
  const reasons = [];
  let level = null;
  const person = checks.find((check) => !check.automatic && check.source !== "document");
  const auto = checks.find((check) => check.automatic);
  const top = person ?? auto ?? checks[0];
  const checkedAt = top?.checkedAt ?? null;
  const sourceWords = (check) => check.sourceLabel ?? check.source;
  if (!top) {
    level = "unknown";
    reasons.push("Not checked on a registry");
  } else if (top.result === "found") {
    if (top.nameMatches === false || top.details?.nameDiffersConfirmed) {
      level = "medium";
      reasons.push(`Found on ${sourceWords(top)} under another name (staff confirmed why)`);
    } else {
      level = top.source === "document" ? "medium" : "high";
      reasons.push(top.source === "document" ? "Checked on the document only" : `Found on ${sourceWords(top)} by ${top.checkedBy ?? "staff"}`);
    }
  } else if (top.result === "registered") {
    level = "medium";
    reasons.push(`${sourceWords(top)}: registered, not yet checked by staff`);
  } else if (top.result === "mismatch" || top.result === "not_found") {
    level = "low";
    reasons.push(top.result === "mismatch" ? `${sourceWords(top)} shows another company` : `Not found on ${sourceWords(top)}`);
  } else {
    level = "unknown";
    reasons.push(`Couldn't check on ${sourceWords(top)}`);
  }
  if (reg.problem && !reg.confirmed) { level = lowerOf(level, "low"); reasons.push(reg.problem === "check_digit" ? "Check digit doesn't match" : "Number has the wrong format"); }
  if (detail.nameDiffers) { level = lowerOf(level, "low"); reasons.push(`Registry names another company: ${detail.nameDiffers}`); }
  if (detail.renamedSinceCheck || (detail.reopenings ?? []).length) { level = lowerOf(level, "low"); reasons.push("Name or number changed since the check"); }
  if (detail.duplicates?.length) {
    const names = detail.duplicates.map((other) => other.name).join(", ");
    if (detail.duplicateExplained) { level = capAt(level, "medium"); reasons.push(`Number shared with ${names} (explained)`); }
    else { level = lowerOf(level, "low"); reasons.push(`Number also used by ${names}`); }
  }
  return result("registry", level, reasons, { number: reg.number, source: top ? sourceWords(top) : null, result: top?.result ?? null }, checkedAt);
}

// --- trading scope ----------------------------------------------------------

export function tradingScope({ reading, tradingReason }) {
  const scope = reading?.details?.tradingScope;
  const at = reading?.checkedAt ?? null;
  if (!reading) return result("trading_scope", "unknown", ["License not read"]);
  if (!scope?.read) return result("trading_scope", "unknown", ["No business scope on the document"], {}, at);
  if (scope.recognised === false) return result("trading_scope", "unknown", ["No trading or making words recognised"], { quote: scope.quote ?? null }, at);
  const codes = activityCodesOf(scope);
  const making = codes.filter((code) => /^1[345]/.test(code));
  const wholesale = codes.filter((code) => /^46/.test(code));
  const details = { quote: scope.quote ?? null, ...(codes.length ? { codes: codes.join(", ") } : {}) };
  if (scope.trading || (wholesale.length && !making.length)) {
    const what = scope.trading ? `Trading only: ${scope.quote}` : `Wholesale activity code ${wholesale.join(", ")}`;
    // Session 2: staff record why a trading-only licence may still pass.
    if (tradingReason) return result("trading_scope", "medium", [what, `Staff reason: ${tradingReason}`], details, at);
    return result("trading_scope", "low", [what, "Record why it may pass as a factory, or ask for proof of production"], details, at);
  }
  // A making code printed on the document is a registry fact; words in the scope are the company's own.
  if (making.length) return result("trading_scope", "high", [`Making activity code ${making.join(", ")}`, ...(scope.quote ? [`Scope: ${scope.quote}`] : [])], details, at);
  return result("trading_scope", "medium", [`Includes making: ${scope.quote}`, "From the scope text only: confirm on photos, video or a visit"], details, at);
}

function activityCodesOf(scope) {
  const raw = pick(scope, FIELD_NAMES.activityCodes) ?? [];
  return (Array.isArray(raw) ? raw : String(raw).split(/[,;\s]+/))
    .map((code) => String(typeof code === "object" ? code?.code ?? "" : code).replace(/\D/g, ""))
    .filter(Boolean);
}

// --- address belongs to this factory ----------------------------------------

/**
 * The comparison itself is the address check's (api/_address.js,
 * addressOwnerCheck: parsed part by part), which arrives as a contract
 * result and replaces this one. Until it has run, the row only lists the
 * addresses: no comparison here, so a crude one can never win.
 */
export function addressOwner({ typed, license, registry: registryAddress }) {
  const addresses = { typed: typed || "", license: license || "", registry: registryAddress || "" };
  const given = Object.values(addresses).filter((text) => String(text).trim()).length;
  return result("address_owner", "unknown", [given < 2 ? "Fewer than two addresses to compare" : "Not compared yet"], { addresses });
}

// --- address is a factory site ----------------------------------------------

export function addressSite(signal) {
  if (!signal) return result("address_site", "unknown", ["Not checked"]);
  const d = signal.details ?? {};
  const at = signal.checkedAt ?? null;
  const reasons = [...(d.reasons ?? [])].slice(0, 3);
  // Residential or office is not proof of a trader: Medium, a video or a visit settles it.
  let level = { industrial: "high", office: "medium", residential: "medium" }[signal.result] ?? "unknown";
  if (signal.result === "unknown") reasons.unshift("Can't tell from the map");
  if (signal.result === "office") reasons.unshift("Office or commercial building: needs a video or a visit");
  if (signal.result === "residential") reasons.unshift("Residential area: needs a video or a visit");
  if (signal.result === "industrial") reasons.unshift("Industrial area");
  if (d.found === false) { level = "unknown"; reasons.unshift("Address not found on the map"); }
  else if (d.precise === false) { level = capAt(level, "medium"); reasons.push("Placed by town or district only"); }
  else if (pick(d, FIELD_NAMES.placementRoad)) { level = capAt(level, "medium"); reasons.push("Placed on a road, not a building"); }
  if (pick(d, FIELD_NAMES.shortenedQuery)) { level = capAt(level, "medium"); reasons.push("Found only with a shortened address"); }
  if (d.from === "typed") { level = capAt(level, "medium"); reasons.push("From the address the factory typed, not the licence"); }
  return result("address_site", level, reasons, d, at);
}

// --- photos -------------------------------------------------------------

export function photos({ photos: list, signals }) {
  const all = list ?? [];
  if (!all.length) return result("photos", "unknown", ["No photos uploaded"]);
  const checks = all.map((photo) => latest(signals, "photo", photo.id)).filter(Boolean);
  const elsewhere = checks.filter((check) => check.result === "found_elsewhere");
  const own = checks.filter((check) => check.result === "own");
  const checkedAt = checks.map((check) => check.checkedAt).filter(Boolean).sort().at(-1) ?? null;
  const details = { total: all.length, searched: checks.length, elsewhere: elsewhere.length };
  if (elsewhere.length) return result("photos", "low", [`${elsewhere.length} of ${all.length} found elsewhere`], details, checkedAt);
  if (!checks.length) return result("photos", "unknown", [`${all.length} not searched`], details, null);
  if (own.length === all.length) return result("photos", "high", [`All ${all.length} searched by staff, own photos`], { ...details, staffOwnAll: true }, checkedAt);
  return result("photos", "medium", [`${checks.length} of ${all.length} searched`], details, checkedAt);
}

// --- company size and age (B3) ---------------------------------------------

const yearOf = (value) => {
  const match = String(value ?? "").match(/(1[89]|20)\d{2}/);
  return match ? Number(match[0]) : null;
};

/**
 * Staff record the insured staff (参保人数, from the free annual report) and
 * the founding date (成立日期, or read off the licence); the factory claimed
 * its workers and the year it started. The claims alone decide nothing.
 */
export function companyFacts({ facts, claims, licenseFounded, now = new Date() }) {
  const insured = facts?.insuredStaff ?? null;
  const foundedYear = yearOf(facts?.foundedOn) ?? yearOf(licenseFounded);
  const foundedFrom = yearOf(facts?.foundedOn) ? "recorded by staff" : foundedYear ? "read off the licence" : null;
  const workers = Number(claims?.workers) || null;
  const claimedYear = Number(claims?.foundedYear) || null;
  const details = {
    ...(workers ? { claimedWorkers: String(workers) } : {}),
    ...(insured != null ? { insuredStaff: String(insured) } : {}),
    ...(claimedYear ? { claimedFounded: String(claimedYear) } : {}),
    ...(foundedYear ? { founded: `${foundedYear} (${foundedFrom})` } : {}),
  };
  const at = facts?.recordedAt ?? null;
  if (insured == null && !foundedYear) return result("company_facts", "unknown", ["Insured staff and founding date not recorded: see the annual report"], details, at);
  let level = "high";
  const reasons = [];
  if (insured != null && workers) {
    if (Number(insured) < workers * 0.1) { level = "low"; reasons.push(`${insured} insured staff against ${workers} workers claimed`); }
    else reasons.push(`${insured} insured staff, ${workers} workers claimed`);
  } else if (insured != null) { level = lowerOf(level, "medium"); reasons.push(`${insured} insured staff; no worker count claimed`); }
  else { level = lowerOf(level, "medium"); reasons.push("Insured staff not recorded: see the annual report"); }
  if (foundedYear && claimedYear) {
    const actual = now.getFullYear() - foundedYear;
    const claimed = now.getFullYear() - claimedYear;
    if (claimed - actual >= 5 || (claimed >= 4 && actual < claimed / 2)) { level = lowerOf(level, "medium"); reasons.push(`Founded ${foundedYear}, claims ${claimedYear}: ask about the earlier years`); }
    else reasons.push(`Founded ${foundedYear}, claims ${claimedYear}`);
  } else if (!foundedYear) { level = lowerOf(level, "medium"); reasons.push("Founding date not recorded"); }
  return result("company_facts", level, reasons, details, at);
}

// --- video --------------------------------------------------------------

export function video() {
  return result("video", "unknown", ["Not submitted"], { decisive: false });
}

// --- all together -----------------------------------------------------------

/** The registry address a check recorded for the current number, if any. */
function registryAddressOf(detail) {
  const number = detail?.registration?.number;
  const check = (detail?.checks ?? []).find((item) => item.details?.address && (!item.numberChecked || item.numberChecked === number));
  return check?.details?.address ?? null;
}

/**
 * Every check from the v2 data the review page already loads:
 * `detail` = admin_registry_detail, `extra` = admin_verification_signals.
 * `states` is where session 2's states arrive (e.g. `tradingReason`).
 */
export function deriveLevels({ detail, extra, states = {} }) {
  const signals = extra?.signals ?? [];
  const reading = latest(signals, "document_reading");
  const files = extra?.registrationFiles ?? [];
  const addressSignal = signals.find((signal) => signal.kind === "address" && signal.automatic) ?? latest(signals, "address");
  return [
    licenseRead({ reading, hasFile: files.length > 0, latestFileId: files[0]?.id ?? null, currentNumber: detail?.registration?.number ?? null }),
    registry(detail ? { ...detail, reopenings: states.reopenings ?? [] } : detail),
    tradingScope({ reading, tradingReason: states.tradingReason ?? detail?.tradingReason ?? null }),
    addressOwner({
      typed: detail?.productionAddress ?? detail?.address ?? detail?.typedAddress ?? detail?.location ?? null,
      license: reading?.details?.extracted?.address ?? null,
      registry: registryAddressOf(detail),
    }),
    addressSite(addressSignal),
    photos({ photos: extra?.photos, signals }),
    companyFacts({
      facts: states.companyFacts ?? null,
      claims: states.claims ?? null,
      licenseFounded: pick(reading?.details?.extracted, FIELD_NAMES.foundedOn) ?? null,
    }),
    video(),
  ];
}

/** A well-formed contract result, or null. */
export function asResult(item) {
  if (!item || !CHECK_KEYS.includes(item.key) || !LEVELS.includes(item.level)) return null;
  return {
    key: item.key,
    level: item.level,
    reasons: Array.isArray(item.reasons) ? item.reasons.filter((line) => typeof line === "string" && line.trim()) : [],
    details: item.details && typeof item.details === "object" ? item.details : {},
    checkedAt: item.checkedAt ?? null,
  };
}

/** Results that arrived in the contract's shape replace the derived ones, by key. */
export function mergeArrived(derived, arrived = []) {
  const byKey = new Map();
  for (const item of arrived ?? []) {
    const ok = asResult(item);
    if (ok) byKey.set(ok.key, ok);
  }
  return derived.map((item) => {
    const next = byKey.get(item.key);
    // A newer derived result (e.g. staff recorded a check after) wins.
    if (!next) return item;
    if (item.checkedAt && next.checkedAt && item.checkedAt > next.checkedAt && item.level !== "unknown") return item;
    return next;
  });
}

/**
 * The rules that need more than one row, and staff reasons, applied after
 * the arrived results are merged (so they bind those too).
 */
export function applyRules(results, { explanations = {} } = {}) {
  const byKey = Object.fromEntries(results.map((item) => [item.key, item]));
  const owner = byKey.address_owner?.level;
  return results.map((item) => {
    let next = item;
    const set = (level, reason) => { next = { ...next, level, reasons: [...next.reasons, ...(reason ? [reason] : [])] }; };
    if (item.key === "address_site") {
      const office = item.details?.result === "office" || pick(item.details, FIELD_NAMES.officeText);
      // Industrial is High only when the address is also the factory's own.
      if (item.level === "high" && owner !== "high") set("medium", "High needs the address check to match too");
      // Low only with the owner mismatch on an office address.
      if (item.level === "low" && !(office && owner === "low")) set("medium");
    }
    if (item.key === "photos" && item.level === "high" && !item.details?.staffOwnAll) {
      set("medium", "Staff to record \"own\" from the reverse-search links");
    }
    const why = explanations?.[item.key];
    if (why?.note && !next.reasons.includes(`Staff reason: ${why.note}`)) {
      next = { ...next, level: next.level === "low" ? "medium" : next.level, reasons: [...next.reasons, `Staff reason: ${why.note}`], details: { ...next.details, explanation: why } };
    }
    return next;
  });
}

const CORE = ["license_read", "registry"];

/** Lowest level among decisive checks; video never decides; High needs the core checks decided. */
export function overallLevel(results) {
  const decisive = results.filter((item) => item.level !== "unknown" && item.details?.decisive !== false && item.key !== "video");
  if (!decisive.length) return { level: "unknown", reasons: ["No check decided yet"], low: [] };
  let level = decisive.reduce((acc, item) => lowerOf(acc, item.level), "high");
  const low = decisive.filter((item) => item.level === level).map((item) => item.key);
  const undecided = results.filter((item) => item.level === "unknown" && item.key !== "video").length;
  const label = (key) => CHECKS.find((check) => check.key === key)?.label ?? key;
  const reasons = [level === "high" ? "Every decided check is high" : `Lowest: ${low.map(label).join(", ")}`];
  // High needs the license read and the registry both decided.
  const coreOpen = CORE.filter((key) => results.find((item) => item.key === key)?.level === "unknown");
  if (level === "high" && coreOpen.length) {
    level = "medium";
    reasons[0] = `${coreOpen.map(label).join(", ")}: can't tell`;
  }
  if (undecided) reasons.push(`${undecided} can't tell`);
  return { level, reasons, low };
}

/**
 * Results that arrived in the contract's shape, wherever the server put them:
 * the page's own fields, a signal's details.levelResult, and the automatic
 * address check's details.checks.
 */
export function arrivedResults(detail, extra) {
  const signals = extra?.signals ?? [];
  const signalResults = signals.map((signal) => signal.details?.levelResult).filter(Boolean);
  const address = signals.find((signal) => signal.kind === "address" && signal.automatic);
  const addressResults = Array.isArray(address?.details?.checks) ? address.details.checks : [];
  return [...(detail?.checkResults ?? []), ...(extra?.checkResults ?? []), ...signalResults, ...addressResults];
}

const claimsFrom = (facts) => (facts ? { workers: facts.claimedEmployees ?? null, foundedYear: facts.claimedFoundedYear ?? null } : null);

/** The staff states the rules read, from admin_verification_rules and the claims. */
export function stateFlags(detail, extra) {
  const rules = extra?.rules ?? null;
  return {
    tradingReason: rules?.tradingOnly?.explanation?.note ?? detail?.tradingReason ?? detail?.tradingOverride?.reason ?? null,
    reopenings: rules?.reopenings ?? [],
    explanations: rules?.[FIELD_NAMES.explanations] ?? {},
    companyFacts: rules?.[FIELD_NAMES.companyFacts] ?? null,
    claims: extra?.claims ?? claimsFrom(rules?.[FIELD_NAMES.companyFacts]),
  };
}

/** Every row and the overall, as the review page and the queue show them. */
export function computeLevels({ detail, extra, sourceLabel = (country, source) => source }) {
  const country = detail?.registration?.country ?? detail?.countryCode ?? null;
  const named = detail ? { ...detail, checks: (detail.checks ?? []).map((check) => ({ ...check, sourceLabel: sourceLabel(country, check.source) })) } : detail;
  const states = stateFlags(detail, extra);
  const results = withLicenseCopy(applyRules(mergeArrived(deriveLevels({ detail: named, extra, states }), arrivedResults(detail, extra)), states), extra);
  return { results, overall: overallLevel(results) };
}

/**
 * The photo check also fingerprints license uploads across TSC (B2): the
 * same license image at another company, uploaded earlier, makes the License
 * read row Low with the reason. A staff reason on the row still lifts it.
 */
export function withLicenseCopy(results, extra) {
  const photo = (extra?.checkResults ?? []).find((item) => item?.key === "photos");
  const copy = photo?.licenseCopy ?? photo?.details?.licenseCopy ?? null;
  if (!copy || copy.level !== "low") return results;
  return results.map((item) => item.key !== "license_read" ? item : {
    ...item,
    level: item.details?.explanation?.note ? "medium" : "low",
    reasons: [...(copy.reasons ?? ["The same license image was uploaded by another company first"]), ...(item.reasons ?? [])],
    details: { ...(item.details ?? {}), licenseCopy: copy },
  });
}
