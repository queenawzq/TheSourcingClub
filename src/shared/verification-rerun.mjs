/**
 * Run again (staff verification review, Nov 12): the rules shared by the
 * server (api/verification-rerun.js), the domain caller
 * (src/lib/domain/verification-rerun.js) and the screen. No network here, so
 * `npm run check:rerun` runs it offline.
 *
 * A failure is a short sentence the modal footer shows in red, by code,
 * never a raw error. A reading is out of date when it was made from an
 * earlier upload, or for a number or name the company no longer has.
 */

export const RERUN_GROUPS = ["business_registration", "company_information", "certification"];

/** The contract's field keys (verification-mock.js) → the reading's own keys. */
export const READING_KEYS = {
  number: "registrationNumber",
  legalName: "legalName",
  legalNameEnglish: "legalNameEnglish",
  representative: "legalRepresentative",
  established: "foundingDate",
  address: "address",
  activity: "activityCodes",
  accessCode: "accessCode",
  letterNumber: "letterNumber",
  taxOffice: "taxOffice",
  scope: "businessScope",
};

/** Which fields each group may edit. Anything else is refused by name. */
export const GROUP_FIELDS = {
  business_registration: ["number", "legalName", "legalNameEnglish", "representative", "established", "address", "activity", "accessCode", "letterNumber", "taxOffice"],
  company_information: ["scope", "siteAddress"],
  certification: ["certNumber", "validUntil", "holder"],
};

export const MAX_FIELD_LENGTH = 2000;

/** Failure codes → the footer's words. */
export const RERUN_WORDS = {
  signed_out: "Sign in again, then retry.",
  not_staff: "Only TSC staff can do this.",
  not_set_up: "Run again isn't set up on this site.",
  bad_request: "Couldn't run the checks. Reload the page.",
  unknown_field: "That field can't be edited here.",
  too_long: "That value is too long.",
  busy: "Already running. Wait a moment.",
  ai_off: "AI reading isn't set up.",
  ai_timeout: "The AI took too long. Try again.",
  ai_busy: "The AI is busy. Try again in a minute.",
  ai_failed: "The AI couldn't read it. Try again.",
  no_file: "Nothing uploaded to read.",
  file_unreadable: "The file couldn't be opened.",
  file_too_large: "The file is too large for the AI.",
  bad_number: "That number isn't valid. Check it.",
  address_not_found: "Address not found on the map. Add the postcode.",
  no_address: "No address to check. Add one.",
  map_unreachable: "The map didn't answer. Try again.",
  registry_unreachable: "The registry didn't answer. Try again later.",
  photos_failed: "The photo check couldn't run. Try again.",
  no_certificate: "No certificate to check.",
  bad_date: "Write the date as YYYY-MM-DD.",
  save_failed: "Couldn't save the result. Try again.",
  kept_reading: "Couldn't read the file. Kept the earlier reading.",
  failed: "Couldn't run the checks. Try again.",
};

/** The registry's own name in the "didn't answer" line, when we know it. */
export function rerunFailureWords(code, { source } = {}) {
  if (code === "registry_unreachable" && source) return `${source} didn't answer. Try again later.`;
  return RERUN_WORDS[code] ?? RERUN_WORDS.failed;
}

/**
 * A model or reading failure sentence (api/admin-review-assist.js
 * modelFailure, registry-assist's reasons) as one of our codes.
 */
export function failureCode(reason) {
  const text = String(reason ?? "").toLowerCase();
  if (!text) return "failed";
  if (/reading documents with ai is off|ai help is not set up|not set up|refused this site's key|out of credits/.test(text)) return "ai_off";
  if (/in time|took too long|timed out/.test(text)) return "ai_timeout";
  if (/busy|not available right now/.test(text)) return "ai_busy";
  if (/no registration document|nothing to read/.test(text)) return "no_file";
  if (/over 5 mb|too large/.test(text)) return "file_too_large";
  if (/could not be opened|could not open|pdfs and pictures only|documents could not be read/.test(text)) return "file_unreadable";
  if (/\bai\b/.test(text)) return "ai_failed";
  return "failed";
}

const day = (value) => {
  const time = value ? new Date(value) : null;
  return time && !Number.isNaN(time.getTime()) ? time : null;
};

const sameText = (a, b) => String(a ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase()
  === String(b ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Null when the reading is current; otherwise `{ reason, since }`:
 *   earlier_upload: made from a file older than the newest upload;
 *   number_changed / name_changed: made for a number or name the company no
 *   longer has. `since` is when the reading was made.
 * `reading` is a document_reading signal ({ details, checkedAt }), `newestFile`
 * the newest business_registration upload ({ id, createdAt }).
 */
export function readingOutOfDate({ reading, newestFile, number, title } = {}) {
  if (!reading) return newestFile ? { reason: "never_read", since: null } : null;
  const details = reading.details ?? {};
  const since = reading.checkedAt ?? reading.checked_at ?? null;
  if (newestFile?.id && details.fileId && newestFile.id !== details.fileId) return { reason: "earlier_upload", since };
  if (newestFile?.createdAt && since && day(newestFile.createdAt) > day(since) && !details.fileId) return { reason: "earlier_upload", since };
  if ((details.numberAtReading ?? null) !== (number ?? null) && details.numberAtReading !== undefined) return { reason: "number_changed", since };
  if (title && details.titleAtReading && !sameText(details.titleAtReading, title)) return { reason: "name_changed", since };
  return null;
}

/** "Read from an earlier upload, Nov 9", in the reader's zone. */
export function outOfDateWords(state, { timeZone } = {}) {
  if (!state) return "";
  const when = day(state.since);
  const date = when ? when.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(timeZone ? { timeZone } : {}) }) : "";
  const head = {
    earlier_upload: "Read from an earlier upload",
    number_changed: "Read for an earlier number",
    name_changed: "Read for an earlier name",
    never_read: "Not read yet",
  }[state.reason] ?? "Read earlier";
  return date && state.reason !== "never_read" ? `${head}, ${date}` : head;
}

/**
 * Only what staff really changed: [{ field, from, to }]. `current` is the
 * field values on screen before editing ({ key: value }).
 */
export function editsFrom(fields = {}, current = {}) {
  return Object.entries(fields ?? {})
    .map(([field, value]) => ({ field, from: current?.[field] == null ? null : String(current[field]), to: String(value ?? "").trim() }))
    .filter((edit) => edit.from == null || !sameText(edit.from, edit.to));
}

/**
 * The request's fields checked against the group: `{ code }` when one is
 * refused, else `{ fields }` trimmed.
 */
export function checkFields(group, fields = {}) {
  if (!RERUN_GROUPS.includes(group)) return { code: "bad_request" };
  if (fields == null || typeof fields !== "object" || Array.isArray(fields)) return { code: "bad_request" };
  const allowed = GROUP_FIELDS[group];
  const out = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!allowed.includes(key)) return { code: "unknown_field", field: key };
    const text = String(value ?? "").trim();
    if (text.length > MAX_FIELD_LENGTH) return { code: "too_long", field: key };
    out[key] = text;
  }
  if (group === "certification" && out.validUntil && !/^\d{4}-\d{2}-\d{2}$/.test(out.validUntil)) return { code: "bad_date", field: "validUntil" };
  return { fields: out };
}

const READING_FIELD_KEYS = ["documentType", "registrationNumber", "legalName", "legalNameEnglish", "legalRepresentative", "address", "businessScope", "taxOffice", "issueDate", "foundingDate"];
const filledFields = (extracted) => READING_FIELD_KEYS.filter((key) => String(extracted?.[key] ?? "").trim()).length
  + (Array.isArray(extracted?.activityCodes) && extracted.activityCodes.length ? 1 : 0);

/**
 * Whether a new reading would replace a better one (Run again, Nov 12): a
 * reading that could not read the file never replaces one that could, and a
 * reading of the same file with fewer fields filled never replaces the fuller
 * one. `previous` is the stored document_reading signal ({ details }), `next`
 * the new reading's `extracted`, `fileId` the file it was read from.
 */
export function worseReading(next, previous, fileId) {
  const before = previous?.details?.extracted;
  if (!before || before.readable === false) return false;
  if (next?.readable === false) return true;
  const sameFile = Boolean(fileId) && previous.details.fileId === fileId;
  return sameFile && filledFields(next) < filledFields(before);
}

/**
 * The country an edited number belongs to, when its format says so (PICKS C:
 * "HK marked automatically from the number format"). A Hong Kong company
 * registration (CR) is 7 or 8 digits; a mainland code is 18 characters, or
 * an old 15-digit one. Only between China and Hong Kong, and only when the
 * format is unambiguous: anything else keeps the current country (null).
 */
export function numberCountry(number, current) {
  const v = String(number ?? "").replace(/[\s.\/-]/g, "").toUpperCase();
  const country = String(current ?? "").toUpperCase();
  if (country !== "CN" && country !== "HK") return null;
  if (/^\d{7,8}$/.test(v)) return country === "HK" ? null : "HK";
  if (/^[0-9A-Z]{18}$/.test(v) || /^\d{15}$/.test(v)) return country === "CN" ? null : "CN";
  return null;
}

/** The before/after line: "Score updated: 75% to 95%". Null when either is missing. */
export function scoreChangeWords(before, after) {
  if (before == null || after == null) return null;
  return before === after ? `Score unchanged: ${after}%` : `Score updated: ${before}% to ${after}%`;
}

/**
 * How specific an address answer is: not placed 0, placed only at district
 * or town 1, placed but the map could not say what is there 2, a judgement
 * (industrial, office, residential) 3.
 */
export function addressSpecificity(details) {
  if (!details || details.found === false) return 0;
  if (details.precise === false || details.mismatch) return 1;
  if (!details.judgement || details.judgement === "unknown") return details.mixed ? 3 : 2;
  return 3;
}

/**
 * Whether a re-check of an UNCHANGED address should keep the earlier result
 * (fix round 2): the map and its building data answer differently from one
 * day to the next, and a warning staff saw must not vanish, nor a good
 * answer turn into "District only", because a server was slow. Kept when the
 * new answer is less specific than the stored one for the same address.
 * Staff editing the address always takes the new answer.
 */
export function keepEarlierAddress(next, previous, { staffAddress = "" } = {}) {
  if (!previous) return false;
  const plain = (text) => String(text ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
  const typed = plain(staffAddress);
  if (typed && typed !== plain(previous.address) && typed !== plain(previous.staffAddress)) return false;
  if (previous.address && next?.address && plain(previous.address) !== plain(next.address)) return false;
  // The map not finding an address it did not find before either is no new answer (fix round 4): keep it, say nothing red.
  if (next?.found === false && addressSpecificity(previous) === 0) return true;
  return addressSpecificity(next) < addressSpecificity(previous);
}
