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

export const CHECKS = [
  { key: "license_read", label: "License read" },
  { key: "registry", label: "Registry" },
  { key: "trading_scope", label: "Trading scope" },
  { key: "address_owner", label: "Address belongs to this factory" },
  { key: "address_site", label: "Address is a factory site" },
  { key: "photos", label: "Photos" },
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
  if (x.edited || d.edited || x.looksEdited) { level = "low"; reasons.push("Looks edited"); }
  for (const line of d.differences ?? []) {
    level = "low";
    reasons.push(`${line.field === "number" ? "Number" : "Name"} differs: document "${line.document || "none"}", typed "${line.typed ?? ""}"`);
  }
  const missing = [["registrationNumber", "number"], ["legalName", "legal name"]].filter(([field]) => !x[field]).map(([, words]) => words);
  if (missing.length) { level = lowerOf(level, "medium"); reasons.push(`Not read: ${missing.join(", ")}`); }
  if (!reasons.length) reasons.push("Number and name match what the factory typed");
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
  if (scope.trading) {
    // Session 2: staff record why a trading-only licence may still pass.
    if (tradingReason) return result("trading_scope", "medium", [`Trading only: ${scope.quote}`, `Staff reason: ${tradingReason}`], { quote: scope.quote }, at);
    return result("trading_scope", "low", [`Trading only: ${scope.quote}`], { quote: scope.quote }, at);
  }
  return result("trading_scope", "high", [`Includes making: ${scope.quote}`], { quote: scope.quote }, at);
}

// --- address belongs to this factory ----------------------------------------

/** Lowercase, drop punctuation and the words every address has. */
export function addressTokens(text) {
  const plain = String(text ?? "")
    .normalize("NFKC")
    .replace(/[​-‍⁠﻿]/g, "")
    .toLowerCase();
  const cjk = plain.match(/[一-鿿]/g) ?? [];
  const words = plain
    .replace(/[一-鿿]/g, " ")
    .split(/[^a-z0-9À-ɏ]+/)
    .filter((word) => word.length > 1 && !ADDRESS_FILLER.has(word));
  return new Set([...words, ...cjk.filter((ch) => !CJK_FILLER.has(ch))]);
}
const ADDRESS_FILLER = new Set(["no", "the", "of", "road", "rd", "street", "st", "ave", "avenue", "district", "city", "province", "china", "prc", "floor", "room", "building", "bldg", "rua", "de", "da", "do", "mah", "cad", "sok", "sk", "cd", "turkey", "türkiye", "portugal"]);
const CJK_FILLER = new Set(["省", "市", "区", "县", "镇", "路", "号", "街", "道", "中", "国", "楼", "室", "层"]);

/** Share of the smaller address's tokens found in the larger one (0..1). */
export function addressOverlap(a, b) {
  const ta = addressTokens(a);
  const tb = addressTokens(b);
  if (!ta.size || !tb.size) return null;
  const [small, large] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  let shared = 0;
  for (const token of small) if (large.has(token)) shared += 1;
  return shared / small.size;
}

export function addressOwner({ typed, license, registry: registryAddress, checkedAt = null }) {
  const sources = [["typed", "Typed", typed], ["license", "License", license], ["registry", "Registry", registryAddress]].filter(([, , text]) => String(text ?? "").trim());
  const details = Object.fromEntries(sources.map(([key, , text]) => [key, text]));
  if (sources.length < 2) return result("address_owner", "unknown", [sources.length ? `Only the ${sources[0][1].toLowerCase()} address to compare` : "No address to compare"], details, checkedAt);
  let level = "high";
  const reasons = [];
  for (let i = 0; i < sources.length; i += 1) {
    for (let j = i + 1; j < sources.length; j += 1) {
      const overlap = addressOverlap(sources[i][2], sources[j][2]);
      if (overlap == null) continue;
      const pair = `${sources[i][1]} vs ${sources[j][1].toLowerCase()}`;
      const smaller = Math.min(addressTokens(sources[i][2]).size, addressTokens(sources[j][2]).size);
      if (overlap >= 0.7 && smaller < 3) { level = lowerOf(level, "medium"); reasons.push(`${pair}: same town only`); }
      else if (overlap >= 0.7) reasons.push(`${pair}: match`);
      else if (overlap >= 0.4) { level = lowerOf(level, "medium"); reasons.push(`${pair}: partly match`); }
      else { level = lowerOf(level, "low"); reasons.push(`${pair}: differ`); }
    }
  }
  return result("address_owner", level, reasons, details, checkedAt);
}

// --- address is a factory site ----------------------------------------------

export function addressSite(signal) {
  if (!signal) return result("address_site", "unknown", ["Not checked"]);
  const d = signal.details ?? {};
  const at = signal.checkedAt ?? null;
  const reasons = [...(d.reasons ?? [])].slice(0, 3);
  let level = { industrial: "high", office: "low", residential: "low" }[signal.result] ?? "unknown";
  if (signal.result === "unknown") reasons.unshift("Can't tell from the map");
  if (signal.result === "office") reasons.unshift("Office or commercial building");
  if (signal.result === "residential") reasons.unshift("Residential area");
  if (signal.result === "industrial") reasons.unshift("Industrial area");
  if (d.found === false) { level = "unknown"; reasons.unshift("Address not found on the map"); }
  else if (d.precise === false) { level = capAt(level, "medium"); reasons.push("Placed by town or district only"); }
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
  if (own.length === all.length) return result("photos", "high", [`All ${all.length} searched, own photos`], details, checkedAt);
  return result("photos", "medium", [`${checks.length} of ${all.length} searched`], details, checkedAt);
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
      typed: detail?.address ?? detail?.typedAddress ?? detail?.location ?? null,
      license: reading?.details?.extracted?.address ?? null,
      registry: registryAddressOf(detail),
      checkedAt: reading?.checkedAt ?? null,
    }),
    addressSite(addressSignal),
    photos({ photos: extra?.photos, signals }),
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
