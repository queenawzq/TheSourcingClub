/**
 * A company's registration number, per country: what it is called, the one
 * line that says where to find it, how it is checked, and where staff look it
 * up. The database runs the same rules (`registration_number_problem()`,
 * migration 20261108600000); `npm run check:registration` pins both.
 *
 * Only China, Turkey and Portugal have rules (the countries most of TSC's
 * factories come from, Nov 5). Anywhere else takes the number as written.
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
    label: { en: "Unified Social Credit Code", zh: "统一社会信用代码" },
    hint: { en: "18 characters, on your business licence", zh: "18 位，见营业执照" },
  },
  TR: {
    label: { en: "Company tax number (VKN)", zh: "公司税号（VKN）" },
    hint: { en: "10 digits, on your tax plate (vergi levhası)", zh: "10 位数字，见税务登记牌" },
    second: {
      column: "trade_registry",
      label: { en: "Trade registry number and city", zh: "商业登记号及城市" },
      hint: { en: "Optional. Ticaret Sicil No, e.g. 123456 İstanbul", zh: "选填。Ticaret Sicil No，例如 123456 İstanbul" },
    },
  },
  PT: {
    label: { en: "NIPC (company tax number)", zh: "NIPC（公司税号）" },
    hint: { en: "9 digits, on your permanent certificate", zh: "9 位数字，见商业登记永久证明" },
    second: {
      column: "access_code",
      label: { en: "Permanent certificate access code", zh: "永久证明访问码" },
      hint: { en: "Optional. 12 digits, e.g. 1234-5678-9012", zh: "选填。12 位数字，例如 1234-5678-9012" },
    },
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
  if (/t[uü]rk(ey|iye)/i.test(text)) return "TR";
  if (/portugal/i.test(text)) return "PT";
  if (/china|中国|prc\b/i.test(text)) return "CN";
  return null;
}

/** Spaces, dots and dashes removed; letters upper-case; "PT" prefix dropped. */
export function normaliseRegistrationNumber(country, value) {
  let text = String(value ?? "").trim().toUpperCase().replace(/[\s.\-/]/g, "");
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
  if (problem === "check_digit") flags.push(confirmed ? "Check digit doesn't match; the factory confirmed the number" : "Check digit doesn't match");
  if (country === "CN" && value.length === 18) {
    if (value.slice(0, 2) === "92") flags.push("92: individual business (个体工商户), not a company");
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

/** Turkey's trade registry entry: free text, short. Null when too long. */
export function normaliseTradeRegistry(value) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  return text.length > 80 ? null : text;
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
export const REGISTRY_SOURCES = {
  CN: [
    { key: "gsxt", label: "GSXT (National Enterprise Credit Information)", url: "https://www.gsxt.gov.cn/" },
    { key: "permit", label: "National pollutant permit site", url: "https://permit.mee.gov.cn/perxxgkinfo/syssb/xkgg/xkgg!licenseInformation.action" },
  ],
  TR: [
    { key: "gazette", label: "Trade Registry Gazette, title search", url: "https://www.ticaretsicil.gov.tr/view/hizlierisim/unvansorgulama.php" },
    { key: "tobb", label: "TOBB industry database (capacity reports)", url: "https://sanayi.org.tr/" },
    { key: "edevlet", label: "e-Devlet document check (barcode)", url: "https://www.turkiye.gov.tr/belge-dogrulama" },
  ],
  PT: [
    { key: "vies", label: "EU VIES tax number check", url: "https://ec.europa.eu/taxation_customs/vies/" },
    { key: "certidao", label: "gov.pt permanent certificate (needs the access code)", url: "https://www.gov.pt/servicos/consultar-a-certidao-permanente-de-registo-comercial" },
    { key: "acts", label: "Published company acts", url: "https://publicacoes.mj.pt/Pesquisa.aspx" },
  ],
};

const OTHER_SOURCES = [
  { key: "other", label: "OpenCorporates search", url: "https://opencorporates.com/" },
];

export function registrySources(country) {
  return REGISTRY_SOURCES[country] ?? OTHER_SOURCES;
}

export const REGISTRY_RESULTS = [
  { key: "found", label: "Found, matches" },
  { key: "mismatch", label: "Found, name or address differs" },
  { key: "not_found", label: "Not found" },
  { key: "could_not_check", label: "Couldn't check" },
];

export function registryResultLabel(key) {
  return REGISTRY_RESULTS.find((result) => result.key === key)?.label ?? key;
}

export function registrySourceLabel(country, key) {
  if (key === "check_digit") return "Check digit";
  return [...registrySources(country), ...Object.values(REGISTRY_SOURCES).flat(), ...OTHER_SOURCES].find((s) => s.key === key)?.label ?? key;
}

/** "Nov 2026": the month a brand is shown, never the day or who checked. */
export function checkedMonth(isoDate) {
  if (!isoDate) return "";
  const date = new Date(isoDate);
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}
