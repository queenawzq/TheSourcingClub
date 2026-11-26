/**
 * A licence reading against the company's number and name: the one copy of
 * these rules for the server (api/registry-assist.js, loaded lazily because
 * Vercel compiles api/*.js to CommonJS) and the review window
 * (src/shared/verification-levels.mjs, worked out live when the page opens).
 * The approval rule mirrors them in SQL (registry_reading_differs).
 * Pure: the registration-number helpers are passed in.
 */

/**
 * Where the document's text differs from what the factory typed. Each line
 * quotes the document. Never "fake": a person decides what a difference means.
 */
export function documentDifferences(extracted, typedValues = {}, helpers = {}) {
  return compareDocument(extracted, typedValues, helpers).differences;
}

const CJK = /[\u3400-\u9fff\uf900-\ufaff]/u;
/** At most one character inserted, removed or changed between a and b. */
function oneEditApart(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  let j = 0;
  while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j += 1;
  return a.length - i - j <= 1 && b.length - i - j <= 1;
}

/**
 * One character apart on a Chinese (or other CJK) text of four or more
 * characters: a blurred photo's misread (森仲华 / 森神华), which staff look at,
 * never "differs". Exported for the address rules to share.
 */
export function nearlySameCjk(a, b, key = (text) => String(text ?? "").normalize("NFKC").replace(/[\s\p{P}\p{Cf}]/gu, "")) {
  const x = key(a);
  const y = key(b);
  if (!x || !y || x === y || !CJK.test(x) || !CJK.test(y)) return false;
  return Math.min(x.length, y.length) >= 4 && oneEditApart(x, y);
}

/**
 * The document against what the factory typed: `differences` (each quoting
 * the document; a person decides what one means), and `unsure`: a number
 * read with the wrong length or a failing check digit while the typed one is
 * valid, no number read at all, or a name one character off on a CJK name.
 * Unsure is "look at it", never "differs".
 */
export function compareDocument(extracted, { country, number, title } = {}, { companyNamesMatch, companyNameKey, normaliseRegistrationNumber, registrationNumberProblem, sameRegistrationNumber }) {
  const differences = [];
  const unsure = [];
  const docNumber = normaliseRegistrationNumber(country, extracted?.registrationNumber ?? "");
  const typed = normaliseRegistrationNumber(country, number ?? "");
  const problem = (value) => (registrationNumberProblem && country ? registrationNumberProblem(country, value) : null);
  // The same number written another way by the country's rule (a Hong Kong certificate's full number) is no difference.
  if (docNumber && typed && docNumber !== typed && !(sameRegistrationNumber && sameRegistrationNumber(country, docNumber, typed))) {
    const docProblem = problem(docNumber);
    if (docProblem && !problem(typed)) unsure.push({ field: "number", document: extracted.registrationNumber, typed: number, reason: docProblem === "check_digit" ? "The number read fails its check digit" : "The number read has the wrong length or characters" });
    else differences.push({ field: "number", document: extracted.registrationNumber, typed: number });
  }
  if (!docNumber && typed) unsure.push({ field: "number", document: "", typed: number, reason: "No number could be read off the document" });
  const names = [extracted?.legalName, extracted?.legalNameEnglish].filter((name) => String(name ?? "").trim());
  if (names.length && title && !names.some((name) => companyNamesMatch(name, title))) {
    const key = companyNameKey ? (text) => companyNameKey(text).replace(/\s+/g, "") : undefined;
    if (names.some((name) => nearlySameCjk(name, title, key))) unsure.push({ field: "name", document: names.join(" / "), typed: title, reason: "One character differs: check the document" });
    else differences.push({ field: "name", document: names.join(" / "), typed: title });
  }
  return { differences, unsure };
}

