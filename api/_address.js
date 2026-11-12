/**
 * Address checks for verification v3 (Nov 11). Pure functions, so
 * `npm run check:address` runs them on recorded data with no network, plus
 * the two lookups (Nominatim, Overpass) with their politeness rules.
 *
 *   address_owner: the address the factory typed, the one printed on its
 *     licence (read_document) and the registry's (VIES / staff's record),
 *     compared part by part: province, city, district, town, road, number,
 *     postcode. A licence address that differs is the strongest sign of a
 *     trader showing someone else's factory, so it is Low.
 *   address_site: the licence's full address placed on the map (limited to
 *     the registration's country); when placed at street level or better,
 *     the place's own class, a reverse lookup at building level and, when
 *     it answers, Overpass's tags around it say industrial, office or
 *     residential. An office unit in the licence's words (1203室, Kat 3,
 *     Sala 2) is a reason of its own (v3.1, A7).
 *
 * Every check returns the shared contract
 *   { key, level: "high" | "medium" | "low" | "unknown", reasons: string[], details, checkedAt }
 * The level is decided here by fixed rules, never by a model.
 */

// ---------------------------------------------------------------------------
// Normalising
// ---------------------------------------------------------------------------

const FULLWIDTH = /[\uFF10-\uFF19\uFF21-\uFF3A\uFF41-\uFF5A]/g;
const INVISIBLE = /[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF\u00AD]/g;

function clean(text) {
  return String(text ?? "")
    .replace(INVISIBLE, "")
    .replace(FULLWIDTH, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/　/g, " ")
    .trim();
}

/** Lower case, accents and punctuation off, Turkish dotless i folded. */
export function fold(text) {
  return clean(text).toLowerCase().replace(/ı/g, "i").replace(/İ/g, "i")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[\s,.;:'"()（）、，。·\-_/#º°ª]+/g, "");
}

const hasHan = (text) => /[一-鿿]/.test(text);

// Garment-region place names, so an address typed in English can be read
// against a licence printed in Chinese. Cores only: 广州, not 广州市.
const PINYIN = {
  北京: "beijing", 上海: "shanghai", 天津: "tianjin", 重庆: "chongqing", 广东: "guangdong", 浙江: "zhejiang", 江苏: "jiangsu",
  福建: "fujian", 山东: "shandong", 河北: "hebei", 河南: "henan", 湖北: "hubei", 湖南: "hunan", 安徽: "anhui", 江西: "jiangxi",
  广州: "guangzhou", 深圳: "shenzhen", 东莞: "dongguan", 佛山: "foshan", 中山: "zhongshan", 汕头: "shantou", 惠州: "huizhou",
  江门: "jiangmen", 珠海: "zhuhai", 揭阳: "jieyang", 潮州: "chaozhou", 普宁: "puning", 番禺: "panyu", 增城: "zengcheng",
  新塘: "xintang", 虎门: "humen", 大朗: "dalang", 白云: "baiyun", 海珠: "haizhu", 南沙: "nansha", 花都: "huadu", 天河: "tianhe",
  杭州: "hangzhou", 宁波: "ningbo", 绍兴: "shaoxing", 湖州: "huzhou", 嘉兴: "jiaxing", 义乌: "yiwu", 金华: "jinhua", 温州: "wenzhou",
  桐乡: "tongxiang", 柯桥: "keqiao", 濮院: "puyuan", 织里: "zhili", 萧山: "xiaoshan", 余杭: "yuhang", 台州: "taizhou",
  苏州: "suzhou", 无锡: "wuxi", 常州: "changzhou", 南通: "nantong", 南京: "nanjing", 常熟: "changshu", 江阴: "jiangyin",
  张家港: "zhangjiagang", 昆山: "kunshan", 吴江: "wujiang", 盛泽: "shengze", 海门: "haimen", 扬州: "yangzhou",
  厦门: "xiamen", 泉州: "quanzhou", 晋江: "jinjiang", 石狮: "shishi", 福州: "fuzhou", 莆田: "putian", 长乐: "changle",
  青岛: "qingdao", 济南: "jinan", 烟台: "yantai", 潍坊: "weifang", 即墨: "jimo", 武汉: "wuhan", 郑州: "zhengzhou",
};

const pinyinOf = (core) => PINYIN[core] ?? null;
const KNOWN_PINYIN = new Set(Object.values(PINYIN));

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

const PARTS = ["province", "city", "district", "town", "road", "number", "postcode"];

/**
 * A Chinese address in its own order: 省 → 市 → 区/县 → 镇/街道 → 路/街 → 号.
 * Each part is matched once, left to right, and kept without its suffix.
 */
function parseChinese(raw) {
  let rest = clean(raw).replace(/\s+/g, "").replace(/^(中华人民共和国|中国)/, "");
  const out = {};
  const take = (key, pattern) => {
    const hit = rest.match(pattern);
    if (!hit) return;
    out[key] = hit[1];
    rest = rest.slice(hit.index + hit[0].length);
  };
  const municipality = rest.match(/^(北京|上海|天津|重庆)(市)?/);
  if (municipality) {
    out.province = municipality[1];
    out.city = municipality[1];
    rest = rest.slice(municipality[0].length);
  } else {
    take("province", /^(.{2,7}?)(省|自治区|特别行政区)/);
    take("city", /^(.{2,6}?)(市|地区|自治州|盟)/);
  }
  take("district", /^(.{1,8}?)(区|县级市|县|市|旗)/);
  take("town", /^(.{1,8}?)(镇|街道|乡|开发区|工业区|工业园)/);
  take("road", /^(?:.{0,10}?村)?(.{1,14}?)(大道|路|街|道|巷|弄|大街)/);
  take("number", /^.{0,8}?(\d+)\s*(号|號)/);
  if (!out.number) {
    const any = rest.match(/(\d+)\s*(号|號)/);
    if (any) out.number = any[1];
  }
  return out;
}

const PT_ROAD = /\b(rua|r\.|avenida|av\.?|travessa|tv\.?|estrada|est\.?|largo|praca|alameda|rotunda|zona industrial|parque industrial|lugar|beco|caminho|quinta)\b/;
const TR_LEVELS = /\b(mahallesi|mah\.?|mh\.?)\b/;
const TR_ROAD = /\b(caddesi|cad\.?|cd\.?|sokak|sokagi|sok\.?|sk\.?|bulvari|blv\.?|bulv\.?)\b/;

/** Latin-script address: Portugal's and Turkey's forms, else a generic one. */
function parseLatin(raw) {
  const text = clean(raw);
  const lower = text.toLowerCase().replace(/ı/g, "i").normalize("NFD").replace(/[̀-ͯ]/g, "");
  const out = {};
  const pt = lower.match(/\b(\d{4})\s*-\s*(\d{3})\s+([a-z][a-z .'-]*)/);
  if (pt) {
    out.postcode = `${pt[1]}-${pt[2]}`;
    out.city = pt[3].replace(/\b(portugal)\b/, "").trim();
  }
  const segments = lower.split(/[,\n]+/).map((s) => s.trim()).filter(Boolean);
  if (TR_LEVELS.test(lower) || TR_ROAD.test(lower) || /\bno\s*[:.]\s*\d/.test(lower)) {
    const mah = lower.match(/([a-z0-9 ]{2,30}?)\s+(?:mahallesi|mah\.?|mh\.?)(?=[\s,]|$)/);
    if (mah) out.town = mah[1].trim().split(/\s+/).slice(-2).join(" ");
    const road = lower.match(/([a-z0-9 .]{2,40}?)\s+(?:caddesi|cad\.?|cd\.?|sokak|sokagi|sok\.?|sk\.?|bulvari|blv\.?|bulv\.?)(?=[\s,]|$)/);
    if (road) out.road = road[1].replace(/^.*\b(?:mahallesi|mah\.?|mh\.?)\s+/, "").trim();
    const no = lower.match(/\bno\s*[:.]?\s*(\d+[a-z]?)/);
    if (no) out.number = no[1];
    // A Turkish postcode is 5 digits starting with a province code (01-81).
    // Organised industrial zones number their streets ("10003 Sokak"), so a
    // number followed by a street word is a street, not a postcode.
    const pc = [...lower.matchAll(/\b(\d{5})\b(?!\s*\.?\s*(?:sokak|sokagi|sok\.?|sk\.?|cadde|caddesi|cad\.?|cd\.?|bulvari|blv\.?))/g)]
      .map((m) => m[1]).find((code) => Number(code.slice(0, 2)) >= 1 && Number(code.slice(0, 2)) <= 81);
    if (pc) out.postcode = pc;
    // "Merter / Güngören / İstanbul": the last two names are district and city.
    const slash = lower.replace(/\bturkiye\b|\bturkey\b/g, "").split("/").map((s) => s.trim().split(/[\s,]+/).filter(Boolean).pop()).filter(Boolean);
    if (slash.length >= 2) {
      out.city = slash[slash.length - 1];
      out.district = slash[slash.length - 2];
    }
    return out;
  }
  const roadSegment = segments.find((s) => PT_ROAD.test(s)) ?? null;
  if (roadSegment) {
    out.road = roadSegment.replace(/\b(n\.?\s*º?|no\.?|numero)\s*/g, " ").replace(/\b\d+[a-z]?\b.*$/, "").replace(PT_ROAD, "").trim();
    const num = roadSegment.match(/\b(\d+[a-z]?)\b/) ?? segments[segments.indexOf(roadSegment) + 1]?.match(/^(?:n\.?\s*º?|no\.?|lote)?\s*(\d+[a-z]?)\b/);
    if (num) out.number = num[1];
  }
  if (!out.city) {
    const named = segments.map((s) => s.replace(/\b(china|portugal|turkey|turkiye|prc|p\.r\.c)\b/g, "").trim()).filter(Boolean);
    // English for a Chinese address: "Panyu District, Guangzhou, Guangdong".
    for (const segment of named) {
      const word = segment.replace(/\b(city|district|province|town|county|shi|qu|zhen)\b/g, "").trim().replace(/\s+/g, "");
      if (!KNOWN_PINYIN.has(word)) continue;
      if (/province/.test(segment) || ["guangdong", "zhejiang", "jiangsu", "fujian", "shandong", "hebei", "henan", "hubei", "hunan", "anhui", "jiangxi"].includes(word)) out.province ??= word;
      else if (/district|county|qu\b/.test(segment)) out.district ??= word;
      else if (/town|zhen\b/.test(segment)) out.town ??= word;
      else if (!out.city) out.city = word;
      else out.district ??= word;
    }
    if (!out.city && named.length && !roadSegment) out.city = named[named.length - 1 - (named.length > 1 && /^\d/.test(named[named.length - 1]) ? 1 : 0)];
  }
  return out;
}

/** An address split into parts; `script` says how it was read. */
export function parseAddress(raw) {
  const text = clean(raw);
  if (!text) return { script: "none", parts: {} };
  if (hasHan(text)) return { script: "han", parts: parseChinese(text) };
  return { script: "latin", parts: parseLatin(text) };
}

// ---------------------------------------------------------------------------
// Comparing
// ---------------------------------------------------------------------------

const AREA = new Set(["province", "city", "district", "town", "postcode"]);

function sameValue(a, b) {
  const x = fold(a);
  const y = fold(b);
  if (!x || !y) return null;
  return x === y || (Math.min(x.length, y.length) >= 2 && (x.includes(y) || y.includes(x)));
}

/** Two Chinese names one character apart: one substituted, added or dropped. */
export function oneCharApart(x, y) {
  const a = [...fold(x)];
  const b = [...fold(y)];
  if (!a.length || !b.length || !hasHan(a.join("")) || Math.abs(a.length - b.length) > 1 || a.join("") === b.join("")) return false;
  if (Math.min(a.length, b.length) < 2) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  if (a.length === b.length) return a.slice(i + 1).join("") === b.slice(i + 1).join("");
  const [longer, shorter] = a.length > b.length ? [a, b] : [b, a];
  return longer.slice(i + 1).join("") === shorter.slice(i).join("");
}

/** A part of a Chinese address in pinyin, when we know the name. */
function latinOf(value) {
  return pinyinOf(String(value ?? "").replace(/(省|市|区|县|镇)$/, ""));
}

/**
 * Two addresses compared part by part.
 * `{ verdict: "match" | "partial" | "differs" | "unknown", same: [], differs: [{ part, a, b }] }`.
 *   match: road and number (or postcode and road) agree and nothing differs;
 *   partial: only the area agrees (city, district…), nothing differs;
 *   near: one Chinese character apart in a name (a misread), nothing else differs;
 *   differs: a part both name is different.
 */
export function compareAddresses(rawA, rawB) {
  const a = parseAddress(rawA);
  const b = parseAddress(rawB);
  if (a.script === "none" || b.script === "none") return { verdict: "unknown", same: [], differs: [], note: "missing" };
  const same = [];
  const differs = [];
  if (a.script !== b.script) {
    // Chinese against English: only the place names we can read both ways.
    const [han, latin] = a.script === "han" ? [a, b] : [b, a];
    const latinText = fold(a.script === "han" ? rawB : rawA);
    for (const part of ["province", "city", "district", "town"]) {
      const py = latinOf(han.parts[part]);
      if (!py) continue;
      if (latinText.includes(py)) same.push(part);
      else if (latin.parts[part] && KNOWN_PINYIN.has(fold(latin.parts[part]))) differs.push({ part, a: han.parts[part], b: latin.parts[part] });
    }
    // A Chinese road and number cannot be read against English words.
    if (han.parts.number && latin.parts.number && fold(han.parts.number) !== fold(latin.parts.number)) differs.push({ part: "number", a: han.parts.number, b: latin.parts.number });
    if (differs.length) return { verdict: "differs", same, differs, note: "scripts" };
    return { verdict: same.length ? "partial" : "unknown", same, differs, note: "scripts" };
  }
  const near = [];
  for (const part of PARTS) {
    // A number or postcode is the same only when it is exactly the same: 28 is not 280.
    const verdict = part === "number" || part === "postcode"
      ? (a.parts[part] && b.parts[part] ? fold(a.parts[part]) === fold(b.parts[part]) : null)
      : sameValue(a.parts[part], b.parts[part]);
    if (verdict === null) continue;
    if (verdict) same.push(part);
    // One Chinese character apart is more often a blurry read (北纬 / 北绣) than another place.
    else if (a.script === "han" && oneCharApart(a.parts[part], b.parts[part])) near.push({ part, a: a.parts[part], b: b.parts[part] });
    else differs.push({ part, a: a.parts[part], b: b.parts[part] });
  }
  if (differs.length) return { verdict: "differs", same, differs, near };
  if (near.length) return { verdict: "near", same, differs, near };
  if (same.includes("road") && (same.includes("number") || same.includes("postcode"))) return { verdict: "match", same, differs };
  if (same.length) return { verdict: "partial", same, differs };
  // Nothing parsed on one side: compare the whole text.
  const x = fold(rawA);
  const y = fold(rawB);
  if (x && x === y) return { verdict: "match", same: ["whole"], differs };
  return { verdict: "unknown", same, differs };
}

const PART_WORDS = { province: "province", city: "city", district: "district", town: "town or neighbourhood", road: "street", number: "street number", postcode: "postcode" };
const SOURCE_WORDS = { typed: "the address the factory typed", license: "the licence", registry: "the registry" };

/**
 * Where each address comes from. Never a registry address for another company.
 * The typed address is the factory's production address when it gave one
 * (B4, `factory_profiles.production_address`), else its location.
 */
export function addressSources(detail, signals) {
  const number = detail?.registration?.number ?? null;
  const fromCheck = (detail?.checks ?? []).find((check) => check.details?.address && check.numberChecked === number && check.nameMatches !== false);
  const reading = (signals ?? []).find((signal) => signal.kind === "document_reading" && signal.details?.extracted?.address
    && (signal.details?.numberAtReading ?? null) === number);
  const production = String(detail?.productionAddress ?? detail?.production_address ?? "").trim();
  return {
    typed: production || String(detail?.location ?? "").trim(),
    typedFrom: production ? "production" : "location",
    license: String(reading?.details?.extracted?.address ?? "").trim(),
    registry: fromCheck ? String(fromCheck.details.address).replace(/\s*\n\s*/g, ", ").trim() : "",
    registryFrom: fromCheck ? (fromCheck.automatic ? "VIES" : "the registry check") : "",
    country: String(detail?.registration?.country ?? detail?.countryCode ?? "").trim().toUpperCase(),
  };
}

// A different city or province is another place; a different street in the
// same city can be an honest factory producing away from its registered seat.
const PLACE_PARTS = new Set(["province", "city"]);

/**
 * address_owner: typed vs licence vs registry.
 *   low: the licence and the registry disagree, or the typed address is in
 *     another city or province than the licence or registry;
 *   medium: the typed address differs only below the city (another street),
 *     or only the area agrees;
 *   high: two sources agree to street and number (or postcode) and nothing differs;
 *   unknown: nothing to compare.
 */
export function addressOwnerCheck({ typed, license, registry, typedFrom = "location" }, now = new Date()) {
  const pairs = [["license", "typed"], ["license", "registry"], ["registry", "typed"]];
  const addresses = { typed, license, registry };
  const words = { ...SOURCE_WORDS, typed: typedFrom === "production" ? "the production address the factory typed" : typedFrom === "staff" ? "the address staff entered" : SOURCE_WORDS.typed };
  const comparisons = [];
  for (const [x, y] of pairs) {
    if (!addresses[x] || !addresses[y]) continue;
    comparisons.push({ between: [x, y], ...compareAddresses(addresses[x], addresses[y]) });
  }
  const parts = Object.fromEntries(Object.entries(addresses).filter(([, text]) => text).map(([key, text]) => [key, parseAddress(text).parts]));
  const reasons = [];
  let level = "unknown";
  const differing = comparisons.filter((c) => c.verdict === "differs");
  const serious = differing.filter((c) => !c.between.includes("typed") || c.differs.some((d) => PLACE_PARTS.has(d.part)));
  const describe = (c) => `${capital(words[c.between[0]])} and ${words[c.between[1]]} differ: ${c.differs.map((d) => `${PART_WORDS[d.part]} (${d.a} / ${d.b})`).join(", ")}`;
  if (serious.length) {
    level = "low";
    for (const c of differing) reasons.push(describe(c));
    reasons.push("To settle: ask the factory why, and for a document or video of the site at the licence's address");
  } else if (differing.length) {
    level = "medium";
    for (const c of differing) reasons.push(describe(c));
    reasons.push("To settle: a factory can produce away from its registered address; ask for a lease, a utility bill or a video of the production site");
  } else if (comparisons.some((c) => c.verdict === "near")) {
    level = "medium";
    for (const c of comparisons.filter((c) => c.verdict === "near")) {
      reasons.push(`${capital(words[c.between[0]])} and ${words[c.between[1]]} nearly match, one character apart: ${c.near.map((d) => `${PART_WORDS[d.part]} (${d.a} / ${d.b})`).join(", ")}`);
    }
    reasons.push("To settle: look at the licence; a blurry character is often misread");
  } else if (comparisons.some((c) => c.verdict === "match") && !comparisons.some((c) => c.verdict === "partial" && c.between.includes("license") && c.note !== "scripts")) {
    level = "high";
    for (const c of comparisons.filter((c) => c.verdict === "match")) reasons.push(`${capital(words[c.between[0]])} and ${words[c.between[1]]} give the same street and number`);
  } else if (comparisons.some((c) => c.verdict === "partial")) {
    level = "medium";
    for (const c of comparisons.filter((c) => c.verdict === "partial")) {
      reasons.push(`${capital(words[c.between[0]])} and ${words[c.between[1]]} agree on ${c.same.map((p) => PART_WORDS[p] ?? p).join(", ")} only`);
    }
    reasons.push("To settle: the factory's full production address, or a video of the site");
  } else if (!license) {
    reasons.push("No address read from the licence yet");
  } else if (!typed && !registry) {
    reasons.push("Only the licence gives an address");
  } else {
    reasons.push("The addresses could not be compared");
  }
  return { key: "address_owner", level, reasons, details: { addresses, typedFrom, parts, comparisons }, checkedAt: now.toISOString() };
}

/**
 * The address_owner result for a reading that has just copied a licence
 * address (A4): saved as the reading's details.levelResult. Null when the
 * document could not be read or printed no address.
 */
export function ownerAtReading({ detail, signals, extracted }) {
  const address = String(extracted?.address ?? "").trim();
  if (!address || extracted?.readable === false) return null;
  return addressOwnerCheck({ ...addressSources(detail, signals), license: address });
}

// ---------------------------------------------------------------------------
// An office address, from its words alone (A7)
// ---------------------------------------------------------------------------

// A unit in a tower: 1203室, or an office-building word with a floor or room
// number. 厂房 or 栋 alone (a factory building) is not one.
const CN_ROOM = /(\d+)\s*室/;
const CN_TOWER = /(大厦|大廈|广场|廣場|中心|写字楼|寫字樓|商务楼|商務樓)/;
const CN_FLOOR = /(\d+|[一二三四五六七八九十]+)\s*(楼|樓|层|層|F)/i;
const LATIN_OFFICE = [
  /\bi[sş]\s*merkezi\b/i,
  /\bkat\s*[:.]?\s*\d+/i,
  /\bescrit[oó]rio\s*(n\.?\s*º?\s*)?\d+/i,
  /\bsala\s*(n\.?\s*º?\s*)?\d+/i,
  /\bpiso\s*\d+/i,
  /\bplaza\b.*\d/i,
];

/** `{ words }` when the address reads as an office unit, else null. */
export function officeAddressText(raw) {
  const text = clean(raw);
  if (!text) return null;
  if (hasHan(text)) {
    const room = text.match(CN_ROOM);
    if (room) return { words: room[0] };
    const tower = text.match(CN_TOWER);
    const floor = tower && text.slice(tower.index).match(CN_FLOOR);
    if (tower && floor) return { words: `${tower[0]}…${floor[0]}` };
    return null;
  }
  const merkezi = text.match(LATIN_OFFICE[0]);
  // İş Merkezi is the building; with any floor, door or unit number it is an office.
  if (merkezi && /\d/.test(text)) return { words: merkezi[0] };
  for (const pattern of LATIN_OFFICE.slice(1)) {
    const hit = text.match(pattern);
    if (hit) return { words: hit[0].trim() };
  }
  return null;
}

const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1);

// ---------------------------------------------------------------------------
// The site: tags around the placed point
// ---------------------------------------------------------------------------

const INDUSTRIAL = new Set(["industrial", "factory", "manufacture", "warehouse", "works"]);
const OFFICE = new Set(["commercial", "office", "retail", "commercial;retail"]);
const HOMES = new Set(["residential", "house", "apartments", "detached", "terrace", "semidetached_house", "dormitory"]);

export function distanceMetres(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return Math.round(6371000 * 2 * Math.asin(Math.sqrt(a)));
}

function inside(lat, lon, ring) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi, yj, xj] = [ring[i].lat, ring[i].lon, ring[j].lat, ring[j].lon];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/**
 * How far an OSM element is from the point: 0 when the point is inside its
 * outline, else the nearest vertex. A large industrial estate's centre can be
 * 400 m away while the factory sits inside it; the outline decides.
 */
export function elementDistance(element, lat, lon) {
  const rings = [];
  if (Array.isArray(element.geometry)) rings.push(element.geometry);
  for (const member of element.members ?? []) {
    if (member.role !== "inner" && Array.isArray(member.geometry)) rings.push(member.geometry);
  }
  const points = rings.flat().filter((p) => p && p.lat != null);
  if (points.length) {
    if (rings.some((ring) => ring.length > 3 && inside(lat, lon, ring))) return 0;
    return Math.min(...points.map((p) => distanceMetres(lat, lon, p.lat, p.lon)));
  }
  const at = element.center ?? (element.lat != null ? { lat: element.lat, lon: element.lon } : null);
  return at ? distanceMetres(lat, lon, at.lat, at.lon) : null;
}

/**
 * Overpass elements as "key=value" with how many and the nearest distance,
 * nearest first. Only landuse, building, man_made, industrial and office tags.
 */
export function summariseTags(elements, lat, lon) {
  const tags = new Map();
  for (const element of elements ?? []) {
    const metres = elementDistance(element, lat, lon);
    for (const key of ["landuse", "building", "man_made", "industrial", "office"]) {
      const value = element.tags?.[key];
      if (!value || (key === "building" && value === "yes")) continue;
      const tag = `${key}=${value}`;
      const seen = tags.get(tag) ?? { tag, count: 0, nearest: null };
      seen.count += 1;
      if (metres != null && (seen.nearest == null || metres < seen.nearest)) seen.nearest = metres;
      tags.set(tag, seen);
    }
  }
  return [...tags.values()].sort((a, b) => (a.nearest ?? 1e9) - (b.nearest ?? 1e9)).slice(0, 15);
}

const kindOf = (t) => {
  const [key, value] = t.tag.split("=");
  if (INDUSTRIAL.has(value) || key === "industrial" || t.tag === "man_made=works") return "industrial";
  if (OFFICE.has(value) || key === "office") return "office";
  if (HOMES.has(value)) return "residential";
  return null;
};

/**
 * The judgement from the tags alone, by rule.
 *   1. a building tag within 40 m says what the building is;
 *   2. else the land use the point is inside;
 *   3. else what lies within 150 m, when it is one kind.
 */
export function judgeFromTags(tags, precise = true) {
  if (!precise) return { judgement: "unknown", reasons: ["OpenStreetMap placed the address only at town or district level"] };
  const building = tags.find((t) => t.tag.startsWith("building=") && t.nearest != null && t.nearest <= 40 && kindOf(t));
  if (building) return { judgement: kindOf(building), reasons: [`${building.tag} within ${building.nearest} m`] };
  const within = tags.filter((t) => t.nearest === 0 && kindOf(t) && !t.tag.startsWith("office="));
  const withinKinds = [...new Set(within.map(kindOf))];
  if (withinKinds.length === 1) return { judgement: withinKinds[0], reasons: [`Inside ${within[0].tag}`] };
  const near = tags.filter((t) => t.nearest != null && t.nearest <= 150);
  const industrial = near.find((t) => kindOf(t) === "industrial");
  const office = near.find((t) => kindOf(t) === "office");
  const homes = near.find((t) => kindOf(t) === "residential");
  if (industrial && !office) return { judgement: "industrial", reasons: [`${industrial.tag} within ${industrial.nearest} m`] };
  if (office && !industrial) return { judgement: "office", reasons: [`${office.tag} within ${office.nearest} m`] };
  if (homes && !industrial && !office) return { judgement: "residential", reasons: [`${homes.tag} within ${homes.nearest} m`] };
  if (industrial && office) return { judgement: "unknown", mixed: true, reasons: [`${industrial.tag} and ${office.tag} both within 150 m`] };
  return { judgement: "unknown", reasons: ["No land-use or building tags within 150 m"] };
}

/** Whether Nominatim placed the address at a street, building or site. */
export function isPrecise(hit) {
  const hitClass = hit?.category ?? hit?.class ?? "";
  return Number(hit?.place_rank ?? 0) >= 26 || ["landuse", "building", "man_made", "industrial", "office", "amenity", "shop"].includes(hitClass);
}

/** The place itself as a tag: "landuse=industrial" for an industrial estate. */
export function ownTag(hit) {
  const hitClass = hit?.category ?? hit?.class ?? "";
  return ["landuse", "building", "man_made", "industrial", "office"].includes(hitClass) && hit?.type ? `${hitClass}=${hit.type}` : null;
}

/** Whether the hit is a road rather than a building or site. */
export function isRoad(hit) {
  const hitClass = hit?.category ?? hit?.class ?? "";
  return hitClass === "highway" || (hit?.addresstype ?? "") === "road";
}

/**
 * Whether the map placed the address in the city and postcode it names
 * (A6). `{ part, expected, got }` when it did not, else null.
 */
export function placeMismatch(raw, hit) {
  const { script, parts } = parseAddress(raw);
  const address = hit?.address ?? {};
  if (parts.postcode && address.postcode) {
    const want = String(parts.postcode).replace(/\D/g, "");
    const got = String(address.postcode).replace(/\D/g, "");
    const n = Math.min(want.length, got.length, 4);
    if (n >= 4 && want.slice(0, n) !== got.slice(0, n)) return { part: "postcode", expected: parts.postcode, got: address.postcode };
  }
  // A city we read with confidence: Chinese, or next to a postcode, or Turkey's "district/city".
  if (parts.city && (script === "han" || parts.postcode || parts.district)) {
    const everything = fold([...Object.values(address), hit?.display_name ?? ""].join(" "));
    const city = fold(parts.city);
    const py = latinOf(parts.city);
    if (everything && city && !everything.includes(city) && !(py && everything.includes(py))) {
      return { part: "city", expected: parts.city, got: address.city ?? address.town ?? address.county ?? address.state ?? address.province ?? "" };
    }
  }
  return null;
}

/**
 * Nominatim's address keys name the land-use area the point is in
 * ("industrial": "石碁工业区"). Each one is a tag at 0 m.
 */
export function areaTags(...addresses) {
  const map = { industrial: "landuse=industrial", commercial: "landuse=commercial", retail: "landuse=retail", residential: "landuse=residential" };
  const out = [];
  for (const address of addresses) {
    for (const [key, tag] of Object.entries(map)) {
      if (address?.[key] && !out.some((t) => t.tag === tag)) out.push({ tag, count: 1, nearest: 0, name: String(address[key]).slice(0, 80) });
    }
  }
  return out;
}

const LEVEL_ORDER = ["low", "medium", "high"];
const capLevel = (level, cap) => (LEVEL_ORDER.includes(level) && LEVEL_ORDER.indexOf(level) > LEVEL_ORDER.indexOf(cap) ? cap : level);

/**
 * address_site: from the judgement to a level (v3.1).
 *   industrial: High only when address_owner is High too, else Medium;
 *   office or residential: Medium, settled by a video or a visit;
 *   an office unit in the licence's words: Medium, Low when address_owner is Low;
 *   capped at Medium when placed from the typed address, on a road, or
 *   from the shortened query; Can't tell when not placed at street level,
 *   placed in another city or postcode, or the map data didn't answer.
 */
export function addressSiteCheck(site, { owner = null, now = new Date() } = {}) {
  const reasons = [...(site.reasons ?? [])];
  const ownerLevel = owner?.level ?? "unknown";
  let level = "unknown";
  if (!site.found || !site.precise || site.mismatch) level = "unknown";
  else if (site.judgement === "industrial") {
    level = ownerLevel === "high" ? "high" : "medium";
    if (level === "medium") reasons.push("To settle: the address belongs to this factory (licence, registry and typed address agree), or a video of the site");
  } else if (site.judgement === "office" || site.judgement === "residential") {
    level = "medium";
    reasons.push("Needs a video or a visit");
  } else if (site.mixed) {
    level = "medium";
    reasons.push("To settle: a video of the site");
  } else if (site.tagsUnavailable && !reasons.some((r) => r.includes("didn't answer"))) reasons.push("The map's building data didn't answer");
  if (site.mismatch) reasons.unshift(`The map placed it in another ${site.mismatch.part} (${site.mismatch.got || "unnamed"}, not ${site.mismatch.expected})`);
  if (site.found && site.precise && !site.mismatch) {
    const caps = [
      site.fromTyped && "Placed from the address the factory typed, not the licence",
      site.road && "Placed on the street, not a building",
      site.shortened && "Placed from a shortened address",
    ].filter(Boolean);
    if (caps.length && level === "high") level = "medium";
    reasons.push(...caps);
  }
  if (site.officeText) {
    reasons.unshift(`The licence's address reads as an office unit (${site.officeText.words})`);
    level = ownerLevel === "low" ? "low" : capLevel(level === "unknown" ? "medium" : level, "medium");
    if (level === "medium") reasons.push("Needs a video or a visit");
  }
  if (site.from && site.from !== "the licence" && !site.fromTyped) reasons.push(`Placed from ${site.from}, not the licence`);
  return { key: "address_site", level, reasons: [...new Set(reasons)], details: site, checkedAt: now.toISOString() };
}

export function overpassQuery(lat, lon) {
  return `[out:json][timeout:6];(way(around:300,${lat},${lon})[landuse];relation(around:300,${lat},${lon})[landuse];way(around:150,${lat},${lon})[building];node(around:150,${lat},${lon})[office];way(around:300,${lat},${lon})[man_made=works];);out tags geom 80;`;
}

// ---------------------------------------------------------------------------
// The lookups
// ---------------------------------------------------------------------------

// Nominatim's usage policy asks for an application name and a contact, and
// overpass-api.de refuses a request without a User-Agent (406).
export const USER_AGENT = "TheSourcingClub-verification/1.0 (operations@contact.sourcing-club.com)";
export const OVERPASS_MIRRORS = [
  process.env.OVERPASS_URL,
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
].filter((url, i, all) => url && all.indexOf(url) === i);

async function fetchJson(url, init, timeoutMs, fetchImpl = fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(300, timeoutMs));
  try {
    const answer = await fetchImpl(url, { ...init, signal: controller.signal, headers: { "User-Agent": USER_AGENT, Accept: "application/json", ...(init?.headers ?? {}) } });
    if (!answer.ok) return { error: answer.status };
    return { data: await answer.json() };
  } catch (error) {
    return { error: error.name === "AbortError" ? "timeout" : "unreachable" };
  } finally {
    clearTimeout(timeout);
  }
}

// One request a second to Nominatim, per server instance.
let lastNominatim = 0;
async function nominatimTurn() {
  const wait = lastNominatim + 1100 - Date.now();
  lastNominatim = Math.max(Date.now(), lastNominatim + 1100);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}

/** Search, limited to the registration's country when we know it (A6). */
export async function nominatim(query, { base, deadline, fetchImpl, countryCode = "" } = {}) {
  await nominatimTurn();
  const params = new URLSearchParams({ format: "jsonv2", limit: "1", addressdetails: "1", q: query });
  if (/^[A-Za-z]{2}$/.test(countryCode)) params.set("countrycodes", countryCode.toLowerCase());
  return fetchJson(`${base}?${params}`, {}, Math.min(3000, deadline - Date.now()), fetchImpl);
}

/** What is at the point, building level (zoom 18). */
export async function nominatimReverse(lat, lon, { base, deadline, fetchImpl } = {}) {
  await nominatimTurn();
  const params = new URLSearchParams({ format: "jsonv2", zoom: "18", addressdetails: "1", lat: String(lat), lon: String(lon) });
  const url = String(base).replace(/\/search\/?$/, "/reverse");
  return fetchJson(`${url}?${params}`, {}, Math.min(2500, deadline - Date.now()), fetchImpl);
}

/** The first mirror that answers, each with a short timeout, inside the deadline. */
export async function overpass(query, { deadline, mirrors = OVERPASS_MIRRORS, fetchImpl } = {}) {
  const tried = [];
  for (const url of mirrors) {
    const left = deadline - Date.now();
    if (left < 600) break;
    // The main server gets the longer wait; the mirrors share what is left.
    const wait = Math.min(tried.length ? 2000 : 3500, left - 200);
    const answer = await fetchJson(url, { method: "POST", body: new URLSearchParams({ data: query }), headers: { "Content-Type": "application/x-www-form-urlencoded" } }, wait, fetchImpl);
    tried.push({ url: new URL(url).host, error: answer.error ?? null });
    if (!answer.error && Array.isArray(answer.data?.elements)) return { data: answer.data, tried };
  }
  return { error: "unavailable", tried };
}

/**
 * Shorter forms of an address for a second Nominatim try: a Chinese address
 * without its number and building ("…路"), a Latin one without its first part.
 */
export function shorterAddress(address) {
  const text = clean(address);
  if (hasHan(text)) {
    const road = text.match(/^.*?(大道|路|街|巷|弄)/);
    if (road && road[0] !== text) return road[0];
    const town = text.match(/^.*?(镇|街道)/);
    return town && town[0] !== text ? town[0] : "";
  }
  // Turkish abbreviations spelled out, the door number dropped: OpenStreetMap
  // names "Fatih Caddesi", never "Fatih Cad. No:12".
  if (/\b(mah|cad|sok|sk|mh|cd)\.|\bno\s*:/i.test(text)) {
    return text.replace(/\bmah\.|\bmh\./gi, "Mahallesi").replace(/\bcad\.|\bcd\./gi, "Caddesi").replace(/\bsok\.|\bsk\./gi, "Sokak")
      .replace(/\bno\s*[:.]?\s*\d+[a-z]?/gi, "").replace(/\s*\/\s*/g, ", ").replace(/\s+/g, " ").trim();
  }
  const parts = text.split(",").map((s) => s.trim()).filter(Boolean);
  return parts.length > 2 ? parts.slice(1).join(", ") : "";
}
