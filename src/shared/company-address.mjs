/**
 * A vendor's one address: the factory's ("Factory Address") or the trading
 * company's office ("Company Address").
 *
 * The full address is the company's and staff's only. It is kept in
 * factory_production_addresses (members and staff, 20261111120000), with its
 * parts (20261124400000). A brand reads factory_profiles.location, which is
 * only ever what brandLocation() makes: "City, Country", or the country alone.
 *
 * The parts come from a model (api/structure-address.js), and nothing a model
 * says is kept unless the typed address says it too (acceptAddressParts):
 * every part must be found in the typed text; an English city name only
 * stands beside a native-script city that was found; the country comes from a
 * country named in the text, else (marked inferred) from the model when a city
 * or region it gave was found. A country's name is always ours, from its code.
 *
 * Shared by the browser and api/ (loaded there with import()).
 */
import { registrationCountryFrom } from "./registration-number.mjs";

export const ADDRESS_MAX = 500;
const PART_MAX = 200;
const CITY_MAX = 60;

const INVISIBLE = /[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF\u00AD]/g;

/** Lower case, full-width folded, accents and punctuation off, Turkish ı/İ folded. */
export function foldAddress(text) {
  return String(text ?? "")
    .replace(INVISIBLE, "")
    .normalize("NFKC")
    .replace(/İ/g, "i").replace(/ı/g, "i")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[\s,.;:'"()（）、，。·\-_/#º°ª|]+/g, "");
}

const clean = (value) => String(value ?? "").replace(INVISIBLE, "").replace(/\s+/g, " ").trim();

/** Latin letters only (accents allowed): a name a brand reading English can read. */
const isLatin = (text) => /^[\p{Script=Latin}\s.'’\-]+$/u.test(text);
const isAsciiName = (text) => /^[A-Za-z][A-Za-z .'\-]*$/.test(text);

// Words that make a "city" part of the street, so it never reaches a brand.
const STREET_WORDS = /\d|\b(road|rd|street|st|avenue|ave|lane|unit|floor|flat|room|suite|building|bldg|tower|block|no|po box|p\.?o\.?|sokak|sok|cadde|cad|mahalle|duong|đường|phố)\b|[路街道号號室楼樓栋棟座层層巷弄村]/i;

// ---------------------------------------------------------------------------
// Countries: names from the platform's own table (Intl's English names), never
// from a model's words.
// ---------------------------------------------------------------------------

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
let regionNames = null;
let codes = null;

function names(locale) {
  try {
    return new Intl.DisplayNames([locale], { type: "region", fallback: "none" });
  } catch {
    return null;
  }
}

function canonical(code) {
  try {
    return Intl.getCanonicalLocales(`und-${code}`)[0].split("-").pop();
  } catch {
    return code;
  }
}

function allCodes() {
  if (codes) return codes;
  regionNames ??= names("en");
  const zh = names("zh");
  codes = [];
  if (!regionNames) return codes;
  for (const a of LETTERS) {
    for (const b of LETTERS) {
      const code = a + b;
      const en = regionNames.of(code);
      // Intl answers codes it does not know with the code itself (or nothing).
      if (!en || en === code || /unknown/i.test(en)) continue;
      // Reserved and grouping codes (EU, UN, EZ, QO, XA…) are not countries.
      if (["EU", "EZ", "UN", "QO", "XA", "XB", "XK", "ZZ", "AQ"].includes(code)) continue;
      // Retired codes (VD, North Vietnam) that Intl still names: only the current one.
      if (canonical(code) !== code) continue;
      codes.push({ code, en, zh: zh?.of(code) ?? null });
    }
  }
  return codes;
}

// Intl's long forms, shortened to what a brand expects to read.
const SHORT_NAMES = { HK: "Hong Kong", MO: "Macau", TW: "Taiwan", US: "United States", GB: "United Kingdom", KR: "South Korea" };

/** The English name brands read for a country code: ours, never the model's. */
export function countryName(code) {
  const upper = String(code ?? "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(upper)) return null;
  const known = allCodes().find((row) => row.code === upper);
  return known ? SHORT_NAMES[upper] ?? known.en : null;
}

// Other ways people write a country, beyond Intl's English and Chinese names.
const ALIASES = {
  CN: ["PRC", "P.R.C.", "P.R. China", "PR China", "People's Republic of China", "中國", "中华人民共和国"],
  HK: ["Hong Kong", "Hong Kong SAR", "Hongkong", "HKSAR", "香港", "中国香港", "中國香港"],
  MO: ["Macao", "Macau", "澳门", "澳門"],
  TW: ["台湾", "台灣", "臺灣", "台北", "臺北", "新北", "台中", "臺中", "台南", "臺南", "高雄", "桃园", "桃園"],
  TR: ["Turkey", "Turkiye", "Türkiye", "土耳其"],
  VN: ["Viet Nam", "Vietnam", "越南"],
  US: ["USA", "U.S.A.", "United States of America", "U.S."],
  GB: ["UK", "U.K.", "England", "Scotland", "Wales", "Great Britain"],
  KR: ["Korea", "Republic of Korea", "韩国", "韓國"],
  AE: ["UAE", "U.A.E."],
  BD: ["孟加拉"],
  IN: ["印度"],
  PK: ["巴基斯坦"],
  KH: ["柬埔寨"],
  ID: ["印尼", "印度尼西亚"],
  PT: ["葡萄牙"],
  IT: ["意大利"],
};

// Names that are also a US state or a common street or person's name: they
// count only as the last part of the address.
const AMBIGUOUS = new Set(["GE", "JE", "JO", "TD", "NE", "PE", "CO", "GU"]);
// More specific places inside a larger one: Hong Kong wins over China.
const SPECIFIC = new Set(["HK", "MO", "TW"]);

const plain = (text) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D");

function nameAt(text, name) {
  if (!name) return -1;
  if (/[\u4e00-\u9fff]/.test(name)) return text.lastIndexOf(name);
  text = plain(text);
  name = plain(name);
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Short all-caps names ("UK", "USA", "PRC") count only in capitals.
  const caseSensitive = /^[A-Z.]{2,6}$/.test(name);
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, caseSensitive ? "gu" : "giu");
  let at = -1;
  for (const match of text.matchAll(pattern)) at = match.index;
  return at;
}

/**
 * The country the typed text names, or null. The latest-written name wins
 * ("Jordan Road, Kowloon, Hong Kong" is Hong Kong); Hong Kong, Macau and
 * Taiwan win over China ("Hong Kong, China"); Chinese script naming no place
 * outside the mainland is China (registrationCountryFrom's rule).
 */
export function countryIn(typed) {
  const text = clean(typed).normalize("NFKC").replace(/İ/g, "I");
  if (!text) return null;
  const lastPart = text.split(/[,，、\n/／]/).map((part) => part.trim()).filter(Boolean).pop() ?? "";
  const found = [];
  for (const row of allCodes()) {
    const candidates = [row.en, row.zh, ...(ALIASES[row.code] ?? [])];
    for (const name of candidates) {
      if (!name) continue;
      const at = nameAt(text, name);
      if (at < 0) continue;
      if (AMBIGUOUS.has(row.code) && foldAddress(lastPart) !== foldAddress(name)) continue;
      found.push({ code: row.code, end: at + name.length });
    }
  }
  const specific = found.filter((row) => SPECIFIC.has(row.code));
  const pool = specific.length ? specific : found;
  const best = pool.sort((a, b) => b.end - a.end)[0];
  if (best) return best.code;
  return /[\u4e00-\u9fff]/.test(text) ? registrationCountryFrom(text) : null;
}

// ---------------------------------------------------------------------------
// The model's parts, kept only where the typed address agrees
// ---------------------------------------------------------------------------

/** Is this part written in the typed address? */
export function grounded(typed, part) {
  const said = foldAddress(part);
  return said.length > 0 && foldAddress(typed).includes(said);
}

const partOrNull = (typed, value, max = PART_MAX) => {
  const text = clean(value);
  if (!text || text.length > max) return null;
  return grounded(typed, text) ? text : null;
};

// Words around a place's name that do not change which place it is.
const PLACE_WORDS = /\b(city|town|district|province|state|municipality|county|thanh pho|tp|tinh|quan|huyen|il|ilce|sehri|merkez|sar|new territories)\b/g;
const placeCore = (text) => foldAddress(plain(String(text ?? "")).toLowerCase().replace(/\d+/g, " ").replace(PLACE_WORDS, " "));

/**
 * A place in Latin letters must be a whole part of the address on its own
 * (between commas or lines, give or take a postcode or "City"): a name found
 * inside a sentence ("…, the city is Paris") is not a place the vendor gave.
 * In other scripts, addresses are written without commas ("广东省东莞市虎门镇"),
 * so being in the text is enough.
 */
function placeOrNull(typed, value, max) {
  const text = partOrNull(typed, value, max);
  if (!text || !isLatin(text)) return text;
  const core = placeCore(text);
  if (!core) return null;
  // Commas, lines, "/" ("Esenyurt / İstanbul / TÜRKİYE") and sentence breaks.
  const segments = String(typed ?? "").split(/[,，;\n/／]|\.\s/).map(placeCore);
  return segments.includes(core) ? text : null;
}

/**
 * The parts to store, from the model's answer and the typed address. Always
 * an object: what was not found is null.
 */
export function acceptAddressParts(typed, model = {}) {
  const answer = model && typeof model === "object" ? model : {};
  const street = partOrNull(typed, answer.street);
  const region = placeOrNull(typed, answer.region, CITY_MAX * 2);
  const postal = clean(answer.postal_code);
  const postalCode = postal && /^[\p{L}\p{N} \-]{2,12}$/u.test(postal) && grounded(typed, postal) ? postal : null;

  let city = placeOrNull(typed, answer.city, CITY_MAX);
  if (city && STREET_WORDS.test(city)) city = null;

  // An English name stands beside a city only when the city itself was found.
  // Beside a Latin-script city it must be that city's own name ("Ho Chi Minh
  // City" beside "Hồ Chí Minh"); beside another script it can only be checked
  // through the city it belongs to.
  let cityEn = clean(answer.city_en);
  if (!city || !cityEn || cityEn.length > CITY_MAX || !isAsciiName(cityEn) || STREET_WORDS.test(cityEn)) {
    cityEn = null;
  } else if (isLatin(city)) {
    const a = placeCore(city);
    const b = placeCore(cityEn);
    if (!(b.includes(a) || a.includes(b))) cityEn = null;
  }

  const named = countryIn(typed);
  let countryCode = named;
  let countryInferred = false;
  if (!countryCode) {
    const guess = String(answer.country_code ?? "").toUpperCase();
    if (countryName(guess) && (city || region)) {
      countryCode = guess;
      countryInferred = true;
    }
  }

  return {
    street,
    city,
    city_en: cityEn,
    region,
    postal_code: postalCode,
    country_code: countryCode,
    country_inferred: countryInferred,
  };
}

/**
 * What a brand reads: "City, Country", the country alone, or null. The city
 * shows only in Latin letters (its English name, else the city as typed when
 * it is already Latin) and never with a number or a street word in it.
 */
export function brandLocation(parts) {
  const country = countryName(parts?.country_code);
  const typedCity = clean(parts?.city);
  const cityEn = clean(parts?.city_en);
  let city = null;
  if (cityEn && isAsciiName(cityEn) && !STREET_WORDS.test(cityEn)) city = cityEn;
  else if (typedCity && isLatin(typedCity) && !STREET_WORDS.test(typedCity) && typedCity.length <= CITY_MAX) city = typedCity;
  if (city && country && foldAddress(city) === foldAddress(country)) city = null;
  if (city && country) return `${city}, ${country}`;
  return country ?? city ?? null;
}

/** What a brand reads when no parts could be had: the country alone, or nothing. */
export function fallbackLocation(typed) {
  return countryName(countryIn(typed));
}

/**
 * An address that names no country we can read, or nothing beside its
 * country: brands would read the country alone, or nothing. The company is
 * asked to add them (ADDRESS_PLACE_NOTICE); nothing is refused.
 */
export function addressMissesPlace(typed) {
  const said = String(typed ?? "").trim();
  if (!said) return false;
  if (!countryIn(said)) return true;
  // Chinese script runs province, city and street together.
  if (/\p{Script=Han}/u.test(said)) return said.replace(/中华人民共和国|中國|中国/g, "").trim().length < 2;
  return said.split(/[,，;\n/／]/).map((part) => part.trim()).filter(Boolean).length < 2;
}

export const ADDRESS_PLACE_NOTICE = {
  en: "Add the city and country, so brands can see where you are.",
  zh: "请填写城市和国家/地区，以便品牌了解您的位置。",
};
