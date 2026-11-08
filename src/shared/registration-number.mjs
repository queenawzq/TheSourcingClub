/**
 * A company's registration number, per country: what it is called, the one
 * line that says where to find it, how it is checked, and where staff look it
 * up. The database runs the same rules (`registration_number_problem()`,
 * migration 20261108600000); `npm run check:registration` pins both.
 *
 * Only China, Turkey and Portugal have rules (the countries most of TSC's
 * factories come from, Nov 5). Anywhere else takes the number as written.
 */

// China, GB 32100-2015: 18 characters from this alphabet (no I, O, Z, S, V).
const USCC_CHARS = "0123456789ABCDEFGHJKLMNPQRTUWXY";
const USCC_WEIGHTS = [1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28];

export const REGISTRATION_COUNTRIES = {
  CN: {
    label: { en: "Unified Social Credit Code *", zh: "统一社会信用代码 *" },
    hint: { en: "18 characters, on your business licence", zh: "18 位，见营业执照" },
  },
  TR: {
    label: { en: "MERSİS number *", zh: "MERSİS 编号 *" },
    hint: { en: "16 digits, on your Trade Registry Gazette notice", zh: "16 位数字，见贸易登记公报" },
  },
  PT: {
    label: { en: "NIPC (company tax number) *", zh: "NIPC（公司税号）*" },
    hint: { en: "9 digits, on your permanent certificate", zh: "9 位数字，见商业登记永久证明" },
    accessCode: {
      label: { en: "Permanent certificate access code", zh: "永久证明访问码" },
      hint: { en: "Optional. 12 digits, e.g. 1234-5678-9012", zh: "选填。12 位数字，例如 1234-5678-9012" },
    },
  },
};

const OTHER = {
  label: { en: "Business registration number *", zh: "企业注册号 *" },
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

export function nifCheckDigit(first8) {
  let sum = 0;
  for (let i = 0; i < 8; i += 1) sum += Number(first8[i]) * (9 - i);
  const r = sum % 11;
  return r < 2 ? 0 : 11 - r;
}

/**
 * Null when the number is acceptable, else a code: `missing`, `format`
 * (length or characters) or `check_digit`. Runs on a normalised number.
 */
export function registrationNumberProblem(country, raw) {
  const value = normaliseRegistrationNumber(country, raw);
  if (!value) return "missing";
  if (country === "CN") {
    if (!/^[0-9A-HJ-NPQRTUWXY]{18}$/.test(value)) return "format";
    return usccCheckChar(value.slice(0, 17)) === value[17] ? null : "check_digit";
  }
  if (country === "TR") return /^\d{16}$/.test(value) ? null : "format";
  if (country === "PT") {
    if (!/^\d{9}$/.test(value)) return "format";
    return nifCheckDigit(value.slice(0, 8)) === Number(value[8]) ? null : "check_digit";
  }
  return /^[0-9A-Z]{3,40}$/.test(value) ? null : "format";
}

export function registrationProblemText(country, problem, language = "en") {
  if (!problem) return "";
  const zh = language === "zh";
  if (problem === "missing") return zh ? "请填写注册号" : "Enter the registration number";
  if (problem === "check_digit") return zh ? "最后一位不符，请核对号码" : "The last digit doesn't match. Check the number";
  const copy = REGISTRATION_COUNTRIES[country];
  if (copy) return zh ? `格式不符：${copy.hint.zh}` : `Wrong format: ${copy.hint.en}`;
  return zh ? "只能包含字母和数字" : "Letters and digits only";
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
