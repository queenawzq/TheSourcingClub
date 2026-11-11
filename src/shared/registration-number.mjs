/**
 * A company's registration number, per country: what it is called, the one
 * line that says where to find it, how it is checked, and where staff look it
 * up. The database runs the same rules (`registration_number_problem()`,
 * migration 20261108600000); `npm run check:registration` pins both.
 *
 * Only China, Turkey and Portugal have rules (the countries most of TSC's
 * factories come from, Nov 5). Anywhere else takes the number as written.
 * Company names are compared by `companyNameKey()`, the same rules as the
 * database's `company_name_key()` (migration 20261108700000).
 */

// China, GB 32100-2015: 18 characters from this alphabet (no I, O, S, V, Z).
const USCC_CHARS = "0123456789ABCDEFGHJKLMNPQRTUWXY";
const USCC_WEIGHTS = [1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28];
// The organisation code inside it (characters 9-17), GB 11714: advisory only.
const ORG_WEIGHTS = [3, 7, 9, 10, 5, 8, 4, 2];

/**
 * Per country: the number's label and hint, and an optional second field
 * (`second.column` is where the database keeps it). Turkey asks for the VKN,
 * the one Turkish number with a check digit, and the trade registry entry,
 * which is what the Gazette search takes (research, Nov 8). A sole
 * proprietor's tax number is the owner's national ID, so the hint says
 * "company".
 */
export const REGISTRATION_COUNTRIES = {
  CN: {
    // Not typed (Nov 11): the number is the one the AI reads off the licence
    // (migration 20261111100000).
    fromDocument: true,
    label: { en: "Unified Social Credit Code", zh: "统一社会信用代码" },
    hint: { en: "18 characters, on your business licence", zh: "18 位，见营业执照" },
    upload: { en: "Business licence", zh: "营业执照" },
  },
  TR: {
    label: { en: "Company tax number (VKN)", zh: "公司税号（VKN）" },
    hint: { en: "10 digits, on your tax registration letter (mükellefiyet yazısı)", zh: "10 位数字，见纳税登记证明" },
    second: {
      column: "registration_letter_number",
      label: { en: "Letter number (Dilekçe No.)", zh: "证明编号（Dilekçe No.）" },
      hint: { en: "14 characters, only if you upload the tax registration letter", zh: "14 位，仅在上传纳税登记证明时填写" },
      // Most factories hold the tax plate (vergi levhası), which has no letter number.
      required: false,
    },
    // What the registration upload is, named as on the document.
    upload: { en: "Tax plate (vergi levhası) or tax registration letter (mükellefiyet yazısı)", zh: "税牌（vergi levhası）或纳税登记证明（mükellefiyet yazısı）" },
    soleUpload: { en: "Tax plate (vergi levhası) or tax registration letter (mükellefiyet yazısı)", zh: "税牌（vergi levhası）或纳税登记证明（mükellefiyet yazısı）" },
    // A sole proprietor's tax number is the owner's national ID: never asked.
    soleProprietor: true,
  },
  PT: {
    label: { en: "NIPC (company tax number)", zh: "NIPC（公司税号）" },
    hint: { en: "9 digits, on your permanent certificate", zh: "9 位数字，见商业登记永久证明" },
    second: {
      column: "access_code",
      label: { en: "Permanent certificate access code", zh: "永久证明访问码" },
      hint: { en: "12 digits, e.g. 1234-5678-9012", zh: "12 位数字，例如 1234-5678-9012" },
    },
    upload: { en: "Permanent certificate (Certidão permanente)", zh: "商业登记永久证明（Certidão permanente）" },
    soleUpload: { en: "Owner's ID or declaration of activity (Declaração de início de atividade)", zh: "经营者身份证件或开业申报（Declaração de início de atividade）" },
    soleProprietor: true,
  },
};

const OTHER = {
  label: { en: "Business registration number", zh: "企业注册号" },
  hint: { en: "As printed on your registration document", zh: "与注册文件上一致" },
};

export function registrationCopy(country) {
  return REGISTRATION_COUNTRIES[country] ?? OTHER;
}

/**
 * The country a typed location names, for the three countries with rules,
 * when the taxonomy match found none: the taxonomy calls Turkey "Türkiye", so
 * "Istanbul, Turkey" matched nothing.
 */
export function registrationCountryFrom(location, matched = null) {
  if (matched) return matched;
  const text = String(location ?? "");
  // "TÜRKİYE" in capitals: İ is not I to a plain case-insensitive match.
  if (/t[uü]rk(ey|[iİı]ye)/i.test(text)) return "TR";
  if (/portugal/i.test(text)) return "PT";
  if (/china|中国|prc\b/i.test(text)) return "CN";
  // "宁波，浙江": a location written in Chinese, outside Hong Kong, Macau and
  // Taiwan, is in mainland China.
  if (/[\u4e00-\u9fff]/.test(text) && !/香港|澳门|澳門|台湾|台灣|臺灣|台北|臺北|新北|台中|臺中|台南|臺南|高雄|桃园|桃園/.test(text)) return "CN";
  return null;
}

/** Full-width digits, letters and punctuation (a Chinese keyboard's) as plain ones. */
function halfWidth(value) {
  return String(value ?? "").replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)).replace(/\u3000/g, " ");
}

/** Does this country's number come from the document rather than the form? */
export function numberFromDocument(country) {
  return Boolean(REGISTRATION_COUNTRIES[country]?.fromDocument);
}

/** Spaces, dots and dashes removed; letters upper-case; "PT" prefix dropped. */
export function normaliseRegistrationNumber(country, value) {
  // \p{Cf}: a copied number can carry invisible characters (U+200B seen from the AI read).
  let text = halfWidth(value).trim().toUpperCase().replace(/[\s.\-/\p{Cf}]/gu, "");
  if (country === "PT" && /^PT\d{9}$/.test(text)) text = text.slice(2);
  return text;
}

export function usccCheckChar(first17) {
  let sum = 0;
  for (let i = 0; i < 17; i += 1) sum += USCC_CHARS.indexOf(first17[i]) * USCC_WEIGHTS[i];
  const c = 31 - (sum % 31);
  return USCC_CHARS[c === 31 ? 0 : c];
}

export function orgCodeCheckChar(first8) {
  let sum = 0;
  for (let i = 0; i < 8; i += 1) {
    const ch = first8[i];
    sum += (/[0-9]/.test(ch) ? Number(ch) : ch.charCodeAt(0) - 55) * ORG_WEIGHTS[i];
  }
  const c = 11 - (sum % 11);
  return c === 10 ? "X" : c === 11 ? "0" : String(c);
}

export function nifCheckDigit(first8) {
  let sum = 0;
  for (let i = 0; i < 8; i += 1) sum += Number(first8[i]) * (9 - i);
  const r = sum % 11;
  return r < 2 ? 0 : 11 - r;
}

export function vknCheckDigit(first9) {
  let sum = 0;
  for (let i = 0; i < 9; i += 1) {
    const pos = 9 - i;
    const t = (Number(first9[i]) + pos) % 10;
    if (t !== 0) sum += (t * 2 ** pos) % 9 || 9;
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * Null when the number is acceptable, else a code: `missing`, `format`
 * (length or characters: refused), `old_number` (China's pre-2017 15 digits:
 * refused, ask for the current licence) or `check_digit` (the factory may
 * confirm it, and staff are shown that it did). Runs on a normalised number.
 */
export function registrationNumberProblem(country, raw) {
  const value = normaliseRegistrationNumber(country, raw);
  if (!value) return "missing";
  if (country === "CN") {
    if (/^\d{15}$/.test(value)) return "old_number";
    if (!/^[0-9A-HJ-NPQRTUWXY]{2}\d{6}[0-9A-HJ-NPQRTUWXY]{10}$/.test(value)) return "format";
    return usccCheckChar(value.slice(0, 17)) === value[17] ? null : "check_digit";
  }
  if (country === "TR") {
    if (!/^\d{10}$/.test(value)) return "format";
    return vknCheckDigit(value) === Number(value[9]) ? null : "check_digit";
  }
  if (country === "PT") {
    if (!/^[1-9]\d{8}$/.test(value)) return "format";
    return nifCheckDigit(value.slice(0, 8)) === Number(value[8]) ? null : "check_digit";
  }
  return /^[0-9A-Z]{3,40}$/.test(value) ? null : "format";
}

/**
 * What staff should know about a number that passed (or was confirmed): never
 * shown to the factory, never a refusal.
 */
export function registrationFlags(country, raw, { confirmed = false } = {}) {
  const value = normaliseRegistrationNumber(country, raw);
  const flags = [];
  const problem = registrationNumberProblem(country, value);
  if (country === "CN" && value.length === 18) {
    if (value.slice(0, 2) === "92") flags.push("92: individual business, not a company");
    else if (value.slice(0, 2) !== "91" && value.slice(0, 2) !== "93") flags.push(`Starts ${value.slice(0, 2)}: not a registered enterprise (91)`);
    if (orgCodeCheckChar(value.slice(8, 16)) !== value[16]) flags.push("Organisation-code check (17th character) doesn't match; some real codes fail it");
  }
  if (country === "PT" && value.length === 9) {
    if (["1", "2", "3"].includes(value[0]) || value.startsWith("45")) flags.push("A person's tax number (sole trader), not a company's");
    else if (value[0] !== "5") flags.push(`Starts ${value[0]}: not the company range (5)`);
  }
  return flags;
}

export function registrationProblemText(country, problem, language = "en") {
  if (!problem) return "";
  const zh = language === "zh";
  if (problem === "missing") return zh ? "请填写注册号" : "Enter the registration number";
  if (problem === "old_number") return zh ? "这是旧的 15 位注册号，请填写新营业执照上的 18 位代码" : "That's the old 15-digit number. Enter the 18 characters on your current licence";
  if (problem === "check_digit") return zh ? "最后一位不符，请核对号码" : "The last digit doesn't match. Check the number";
  if (country === "CN") return zh ? "格式不符：18 位，不含字母 I、O、S、V、Z" : "Wrong format: 18 characters, without the letters I, O, S, V or Z";
  const copy = REGISTRATION_COUNTRIES[country];
  if (copy) return zh ? `格式不符：${copy.hint.zh}` : `Wrong format: ${copy.hint.en}`;
  return zh ? "只能包含字母和数字" : "Letters and digits only";
}

/**
 * The number on Turkey's tax registration letter (Dilekçe No.): 14 letters
 * and digits, spaces dropped, upper-case. "" when empty, null when not 14.
 */
export function normaliseRegistrationLetter(value) {
  const text = halfWidth(value).replace(/\s+/g, "").toUpperCase();
  if (!text) return "";
  return /^[A-Z0-9]{14}$/.test(text) ? text : null;
}

// Legal forms and joining words dropped from a name (Portuguese, Turkish,
// English, Vietnamese, Chinese); the database's company_name_key() drops the
// same, and strips accents the same way (NFD).
const NAME_FORMS = new Set(["sa", "sl", "lda", "limitada", "unipessoal", "sociedade", "anonima", "ltd", "ltda", "limited", "co", "company", "corp", "corporation", "inc", "llc", "gmbh", "plc", "jsc", "srl", "spa", "sti", "sirketi", "ticaret", "sanayi", "san", "tic", "ve", "as", "ith", "ihr", "imalat", "pazarlama", "and", "e", "cia", "comercio", "industria", "tnhh", "mtv"]);
const NAME_PHRASES = / (cong ty|trach nhiem huu han|mot thanh vien|co phan|s a|a s)(?= )/g;
const WHOLE_FROM = "đıøłßæœ";
const WHOLE_TO = "diolsao";

/** "EDP, S.A." → "edp"; "Fiação do Vale, Lda." → "fiacao do vale"; "Công ty TNHH Dệt May" → "det may"; "宁波织造有限公司" → "宁波织造". */
export function companyNameKey(raw) {
  let text = String(raw ?? "").replace(/İ/g, "i").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  text = [...text].map((ch) => { const at = WHOLE_FROM.indexOf(ch); return at >= 0 ? WHOLE_TO[at] : ch; }).join("");
  text = text.replace(/(股份有限公司|有限责任公司|有限公司|分公司|公司|厂)$/u, "");
  text = ` ${text.replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `.replace(NAME_PHRASES, " ");
  return text.split(" ").filter((word) => word && !NAME_FORMS.has(word)).join(" ");
}

export function companyNamesMatch(a, b) {
  const key = companyNameKey(a);
  return key !== "" && key === companyNameKey(b);
}

/** Portugal's permanent-certificate access code: 12 digits, kept as 0000-0000-0000. */
export function normaliseAccessCode(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.length === 12 ? `${digits.slice(0, 4)}-${digits.slice(4, 8)}-${digits.slice(8)}` : null;
}

/**
 * Where staff look a company up, per country (Nov 6 research). `vies` is the
 * one checked by program; the rest are links a person opens.
 */
// The uploaded registration document, compared with the typed number. For
// China it is the check that works (GSXT is behind a captcha and a real-name
// login, and refuses foreign connections); everywhere it is the fallback.
const DOCUMENT_SOURCE = { key: "document", label: "Uploaded registration document", url: null, seen: ["name"] };
const enc = encodeURIComponent;

/**
 * Where staff look a company up, per country. `url` is a function of the
 * company's registration and title where the source can be opened on the
 * company itself; `copy` is what to put on the clipboard first. `vies` is
 * also checked by program. Sources whose links were dead or wrong (gov.pt's
 * certificate page, the Gazette's title search, the e-Devlet barcode check)
 * are kept only in LEGACY_SOURCES, so old checks still read.
 */
export const REGISTRY_SOURCES = {
  CN: [
    { ...DOCUMENT_SOURCE, label: "Uploaded business licence" },
    // QCC's free search answers from outside China (tested Nov 8). A
    // commercial copy of the registry: a brand reads its check as
    // "Registration document", not "Official registry".
    { key: "qcc", label: "QCC (commercial copy of the registry)", action: "Look up on QCC", url: () => "https://www.qcckyc.com/free-company-search", copy: "number", seen: ["name", "address", "startDate", "industry"] },
    { key: "gsxt", label: "GSXT (needs a mainland connection)", url: () => "https://www.gsxt.gov.cn/", seen: ["name", "address"] },
    { key: "permit", label: "National pollutant permit site", url: () => "https://permit.mee.gov.cn/perxxgkinfo/syssb/xkgg/xkgg!licenseInformation.action", seen: ["name", "address"] },
  ],
  TR: [
    // GİB's letter check, prefilled with the VKN and the letter's number:
    // the form then asks for no captcha, and GİB shows its own copy.
    { key: "gib", label: "GİB letter check (Mükellefiyet Yazısı Doğrulama)", action: "Check on GİB",
      url: (reg) => (reg?.number && reg?.registrationLetterNumber
        ? `https://dijital.gib.gov.tr/dogrulamalar/mukellefiyetDogrulama?vknTckn=${enc(reg.number)}&dilekceOid=${enc(reg.registrationLetterNumber)}`
        : "https://dijital.gib.gov.tr/dogrulamalar/mukellefiyetDogrulama"),
      seen: ["name", "address"] },
    { ...DOCUMENT_SOURCE, label: "Uploaded tax registration letter" },
  ],
  PT: [
    { key: "vies", label: "EU VIES tax number check", url: () => "https://ec.europa.eu/taxation_customs/vies/", seen: ["name", "address"] },
    // The certidão answers only Portuguese connections (tested Nov 8): staff
    // read the PDF the factory uploaded, or one opened with the access code.
    { key: "certidao", label: "Permanent certificate (certidão, with the access code)", url: null, copy: "accessCode", seen: ["name", "address"] },
    { key: "acts", label: "Published company acts", url: () => "https://publicacoes.mj.pt/Pesquisa.aspx", copy: "number", seen: ["name"] },
    DOCUMENT_SOURCE,
  ],
  VN: [
    DOCUMENT_SOURCE,
    { key: "national", label: "National Business Registration Portal", url: () => "https://dangkykinhdoanh.gov.vn/vn/Pages/Trangchu.aspx", copy: "number", seen: ["name", "address"] },
    { key: "other", label: "OpenCorporates search", url: (reg, title) => `https://opencorporates.com/companies?q=${enc(title ?? "")}`, seen: ["name", "address"] },
  ],
};

const OTHER_SOURCES = [
  DOCUMENT_SOURCE,
  { key: "other", label: "OpenCorporates search", url: (reg, title) => `https://opencorporates.com/companies?q=${enc(title ?? "")}`, seen: ["name", "address"] },
];

// Sources no longer offered, so checks recorded on them still have a name.
const LEGACY_SOURCES = [
  { key: "gazette", label: "Trade Registry Gazette" },
  { key: "edevlet", label: "e-Devlet barcode check" },
];

export function registrySources(country) {
  return REGISTRY_SOURCES[country] ?? OTHER_SOURCES;
}

/** The link for a source, on this company where the source allows it. */
export function registrySourceUrl(source, registration, title) {
  return typeof source?.url === "function" ? source.url(registration, title) : null;
}

/** An official source (the brand reads "Official registry"); the same list as registry_source_is_official(). */
export const OFFICIAL_SOURCES = new Set(["vies", "gib", "gsxt", "certidao", "acts", "permit", "national"]);

export const REGISTRY_RESULTS = [
  { key: "found", label: "Found, matches" },
  { key: "mismatch", label: "Found, name or address differs" },
  { key: "not_found", label: "Not found" },
  { key: "could_not_check", label: "Couldn't check" },
];

// The same four results, worded for a document a person reads.
const DOCUMENT_RESULTS = [
  { key: "found", label: "Document shows this number and name" },
  { key: "mismatch", label: "Document shows something else" },
  { key: "not_found", label: "No number on the document" },
  { key: "could_not_check", label: "Unreadable" },
];

export function registryResultsFor(source) {
  return source === "document" ? DOCUMENT_RESULTS : REGISTRY_RESULTS;
}

/** A result's words. VIES's own answers read as what they are, never a match. */
export function registryResultLabel(key, { automatic = false, source = null } = {}) {
  if (key === "registered") return "Registered for VAT";
  if (automatic && key === "not_found") return "Not registered for VAT";
  return registryResultsFor(source).find((result) => result.key === key)?.label ?? key;
}

export function registrySourceLabel(country, key) {
  if (key === "check_digit") return "Check digit";
  return [...registrySources(country), ...Object.values(REGISTRY_SOURCES).flat(), ...OTHER_SOURCES, ...LEGACY_SOURCES].find((s) => s.key === key)?.label ?? key;
}

/** "Nov 2026": the month a brand is shown, never the day or who checked. */
export function checkedMonth(isoDate) {
  if (!isoDate) return "";
  const date = new Date(isoDate);
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}
