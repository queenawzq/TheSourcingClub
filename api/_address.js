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

import { spellings } from "./_pinyin.js";

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
  合肥: "hefei", 泰安: "taian",
  // Every province (R3t2): a licence may print only its province and county, and the province alone tells two places apart.
  山西: "shanxi", 陕西: "shaanxi", 辽宁: "liaoning", 吉林: "jilin", 黑龙江: "heilongjiang", 四川: "sichuan", 贵州: "guizhou",
  云南: "yunnan", 海南: "hainan", 甘肃: "gansu", 青海: "qinghai", 广西: "guangxi", 宁夏: "ningxia", 新疆: "xinjiang",
  内蒙古: "neimenggu", 西藏: "xizang",
};

// The provinces (and the four cities that are provinces), in characters and pinyin.
const PROVINCES = ["北京", "天津", "上海", "重庆", "河北", "山西", "辽宁", "吉林", "黑龙江", "江苏", "浙江", "安徽", "福建", "江西", "山东",
  "河南", "湖北", "湖南", "广东", "海南", "四川", "贵州", "云南", "陕西", "甘肃", "青海", "广西", "内蒙古", "西藏", "宁夏", "新疆"];
const PROVINCE_PINYIN = new Set(PROVINCES.map((han) => PINYIN[han]));
// 陕西 is often written "Shanxi" in English, which is 山西's name: never a difference between the two.
const SAME_PROVINCE = { shaanxi: ["shanxi"], shanxi: ["shaanxi"], neimenggu: ["innermongolia"], xizang: ["tibet"] };
// The province of a city we know by name, so "Dongguan" can be compared with a licence that prints only 山东.
const CITY_PROVINCE = Object.fromEntries([
  ["广东", "广州 深圳 东莞 佛山 中山 汕头 惠州 江门 珠海 揭阳 潮州 普宁"], ["浙江", "杭州 宁波 绍兴 湖州 嘉兴 义乌 金华 温州 桐乡 台州"],
  ["江苏", "苏州 无锡 常州 南通 南京 常熟 江阴 张家港 昆山 扬州"], ["福建", "厦门 泉州 晋江 石狮 福州 莆田"],
  ["山东", "青岛 济南 烟台 潍坊 泰安"], ["湖北", "武汉"], ["河南", "郑州"], ["安徽", "合肥"],
].flatMap(([province, cities]) => cities.split(" ").map((city) => [city, province])));

const pinyinOf = (core) => PINYIN[core] ?? null;
// The other way round: "dongguan" → "东莞", so a city typed in English can be looked for in a licence's characters.
const HAN_OF = Object.fromEntries(Object.entries(PINYIN).map(([han, py]) => [py, han]));

// Characters common in road names, read one by one (fix round 4), so "江东三路18号"
// can be compared with "18 Jiangdong 3rd Road". A road with a character not
// here is simply not compared, never guessed.
const CHAR_PINYIN = Object.fromEntries(`
江jiang 东dong 西xi 南nan 北bei 中zhong 黄huang 浦pu 埔pu 新xin 华hua 人ren 民min 解jie 放fang 建jian 设she 工gong 业ye
兴xing 发fa 展zhan 长chang 安an 宁ning 平ping 和he 光guang 明ming 文wen 化hua 学xue 园yuan 区qu 大da 小xiao 上shang 下xia
前qian 后hou 金jin 银yin 山shan 水shui 湖hu 海hai 河he 桥qiao 港gang 湾wan 城cheng 村cun 镇zhen 环huan 滨bin 沙sha 石shi
龙long 凤feng 白bai 云yun 天tian 鹤he 花hua 都du 宝bao 庆qing 康kang 泰tai 福fu 富fu 贵gui 盛sheng 昌chang 隆long 广guang
州zhou 杭hang 萧xiao 钱qian 塘tang 嘉jia 禾he 秀xiu 阳yang 春chun 景jing 星xing 友you 谊yi 交jiao 通tong 车che 站zhan
高gao 科ke 技ji 创chuang 振zhen 永yong 先xian 锋feng 胜sheng 利li 红hong 旗qi 朝chao 望wang 鸿hong 运yun 通tong 万wan
一yi 二er 三san 四si 五wu 六liu 七qi 八ba 九jiu 十shi 纺fang 织zhi 服fu 装zhuang 鞋xie 塘tang 坑keng 岭ling 田tian 林lin
盈ying 丰feng 益yi 荣rong 德de 顺shun 祥xiang 瑞rui 达da 成cheng 美mei 洲zhou 源yuan 泉quan 溪xi 桂gui 荔li 莲lian 松song
柏bai 竹zhu 梅mei 桃tao 杨yang 洪hong 坪ping 涌chong 沥li 井jing 岗gang 围wei 屋wu 横heng 厚hou 埗bu 头tou 尾wei 口kou
`.trim().split(/\s+/).map((pair) => [pair[0], pair.slice(1)]));
const CN_DIGITS = { 一: "1", 二: "2", 三: "3", 四: "4", 五: "5", 六: "6", 七: "7", 八: "8", 九: "9", 十: "10" };

/** "江东三" → ["jiangdong3", "jiangdongsan"]; null when a character is not known. */
function roadKeys(han) {
  const chars = [...String(han ?? "")];
  if (!chars.length) return null;
  // A character the road table lacks is read from the full table (纬二 is Weier, R3t4); never guessed.
  if (chars.some((c) => !CHAR_PINYIN[c] && !/\d/.test(c))) {
    const spelled = spellings(chars.join(""), 16);
    if (!spelled) return null;
    const numbered = chars.map((c, i) => (CN_DIGITS[c] && i > 0 ? CN_DIGITS[c] : null));
    return [...new Set([...spelled, ...(numbered.some(Boolean) ? (spellings(chars.map((c, i) => numbered[i] ?? c).join(""), 16) ?? []) : [])])];
  }
  const spelled = chars.map((c) => CHAR_PINYIN[c] ?? c).join("");
  const numbered = chars.map((c, i) => (CN_DIGITS[c] && i > 0 ? CN_DIGITS[c] : CHAR_PINYIN[c] ?? c)).join("");
  return [...new Set([numbered, spelled])];
}

const LATIN_ROAD = /\b(road|rd|street|st|avenue|ave|boulevard|blvd|lane|ln|lu|jie|dadao|dao|way)\b\.?/;

/** The road and number of an address typed in English for a Chinese one: "18 Jiangdong 3rd Road" → { road: "jiangdong3", number: "18" }. */
function latinRoadOf(raw) {
  const segments = clean(raw).toLowerCase().split(/[,\n]+/).map((s) => s.trim()).filter(Boolean);
  const segment = segments.find((s) => LATIN_ROAD.test(s));
  if (!segment) return {};
  const number = segment.match(/^(?:no\.?\s*)?(\d+)[a-z]?\b/)?.[1] ?? segment.match(/\bno\.?\s*(\d+)\b/)?.[1] ?? null;
  // "North of Weier Road" is how 纬二路北 reads in English: the side of the road is not its name.
  const name = segment.replace(/^(?:no\.?\s*)?\d+[a-z]?\s+/, "").replace(/\bno\.?\s*\d+\b/, "").replace(/^(?:north|south|east|west)\s+of\s+/, "").split(LATIN_ROAD)[0]
    .replace(/(\d+)(st|nd|rd|th)\b/g, "$1").replace(/[^a-z0-9]+/g, "");
  return { road: name || null, number };
}

/** "Building 5" / "Block 5" / "5栋" / "5号楼". */
function buildingOf(raw, han) {
  const text = clean(raw);
  const hit = han ? text.match(/(\d+)\s*(栋|幢|座|号楼|號樓)/) : text.match(/\b(?:building|bldg\.?|block|blk\.?)\s*(?:no\.?\s*)?(\d+)\b/i);
  return hit ? { value: hit[1], shown: han ? hit[0] : hit[0] } : null;
}
/** "4th Floor" / "Floor 4" / "4楼" / "4层". */
function floorOf(raw, han) {
  const text = clean(raw);
  const hit = han ? text.match(/(\d+)\s*(楼|樓|层|層)(?!\d)/) : text.match(/\b(\d+)(?:st|nd|rd|th)?\s*(?:floor|fl\.?|f)\b|\bfloor\s*(\d+)\b/i);
  return hit ? { value: hit[1] ?? hit[2], shown: hit[0] } : null;
}
/** "Room 101" / "Rm 101" / "101室". */
function roomOf(raw, han) {
  const text = clean(raw);
  const hit = han ? text.match(/(\d+)\s*(室|房)/) : text.match(/\b(?:room|rm\.?|unit)\s*(?:no\.?\s*)?(\d+)\b/i);
  return hit ? { value: hit[1], shown: hit[0] } : null;
}
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
    // A province printed without 省 ("山东宁阳环城科技产业园", R3t2).
    if (!out.province) take("province", new RegExp(`^(${PROVINCES.join("|")})()`));
    take("city", /^(.{2,6}?)(市|地区|自治州|盟)/);
  }
  take("district", /^(.{1,8}?)(区|县级市|县|市|旗)/);
  // 工业园区 before 工业园, or the 区 is left to start the road ("瑶海工业园区纬二路" read the road as 区纬二).
  take("town", /^(.{1,8}?)(镇|街道|乡|开发区|工业园区|工业区|工业园)/);
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
  // A Portuguese postcode, with its hyphen or, as certificates print it, a space: "2415-557" / "2415 557".
  const pt = lower.match(/\b(\d{4})(?:\s*-\s*|\s)(\d{3})\s+([a-z][a-z .'-]*)/);
  if (pt) {
    out.postcode = `${pt[1]}-${pt[2]}`;
    out.city = pt[3].replace(/\b(portugal)\b/, "").trim();
  }
  const segments = lower.split(/[,\n]+/).map((s) => s.trim()).filter(Boolean);
  // "No:12" is Turkish; "No. 76" is how an English address numbers a street in China, so it does not decide.
  if (TR_LEVELS.test(lower) || TR_ROAD.test(lower) || /\bno\s*:\s*\d/.test(lower)) {
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
      if (/province/.test(segment) || PROVINCE_PINYIN.has(word)) out.province ??= word;
      else if (/district|county|qu\b/.test(segment)) out.district ??= word;
      else if (/town|zhen\b/.test(segment)) out.town ??= word;
      else if (!out.city) out.city = word;
      else out.district ??= word;
    }
    // The last place-like part; a street or a room ("No. 76 Yingfeng 7th Street", "Room 101") is never the city.
    const places = named.filter((segment) => !LATIN_ROAD.test(segment) && !/\b(room|rm|unit|no)\b\.?\s*\d/.test(segment)
      && !PROVINCE_PINYIN.has(segment.replace(/\bprovince\b/, "").replace(/\s+/g, "")));
    if (!out.city && places.length && !roadSegment) out.city = places[places.length - 1 - (places.length > 1 && /^\d/.test(places[places.length - 1]) ? 1 : 0)];
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

/** Every way the part may be written in English: the known name (and its other spelling), else its characters read one by one. */
function latinForms(value) {
  const core = String(value ?? "").replace(/(省|市|区|县|镇)$/, "");
  const known = pinyinOf(core);
  if (known) return [known, ...(SAME_PROVINCE[known] ?? [])];
  // Read from the full table only for a name of two characters or more, spelled in four letters or more (R3t4: 瑶海, 新站).
  return [...core].length >= 2 ? (spellings(core, 8) ?? []).filter((form) => form.length >= 4) : [];
}

/** The province of a known city, in characters, when the address names no province. */
function provinceOfCity(parts, script) {
  for (const part of ["city", "district", "town"]) {
    const value = parts[part];
    if (!value) continue;
    const han = script === "han" ? String(value).replace(/(市|区|县|镇)$/, "") : HAN_OF[fold(value)];
    if (han && CITY_PROVINCE[han]) return CITY_PROVINCE[han];
  }
  return null;
}

/** The text without the country and a leading province: "安徽省合肥市…" and "合肥市…" are the same address (R3t6). */
function withoutProvince(raw) {
  const text = fold(raw).replace(/^(中华人民共和国|中国)/, "");
  return text.replace(new RegExp(`^(${PROVINCES.join("|")})(省|自治区|市)?`), "");
}

/**
 * Two addresses compared part by part.
 * `{ verdict: "match" | "partial" | "differs" | "unknown", same: [], differs: [{ part, a, b }] }`.
 *   match: road and number (or postcode and road) agree and nothing differs;
 *   partial: only the area agrees (city, district…), nothing differs;
 *   near: one Chinese character apart in a name (a misread), nothing else differs;
 *   differs: a part both name is different.
 */
export function compareAddresses(rawA, rawB, { cityB = "" } = {}) {
  const a = parseAddress(rawA);
  const b = parseAddress(rawB);
  // The city from the address's structured parts (factory_production_addresses.city_en), when the text alone did not give one.
  if (b.script === "latin" && !b.parts.city && cityB) b.parts.city = String(cityB).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  if (a.script === "none" || b.script === "none") return { verdict: "unknown", same: [], differs: [], note: "missing" };
  // The same text, to the punctuation, with a street or building number in it: the same address, in any
  // language, whatever the parser could split (an English Hong Kong address yields only its city). Without a
  // number ("Merter, Güngören, Istanbul") it is only an area, compared as before.
  if (fold(rawA) === fold(rawB) && /\d/.test(fold(rawA))) return { verdict: "match", same: ["address"], differs: [], note: "identical" };
  // The same Chinese text with the province (or the country) written in front of one of them only.
  if (a.script === "han" && b.script === "han" && withoutProvince(rawA) === withoutProvince(rawB) && /\d/.test(withoutProvince(rawA))
    && !(a.parts.province && b.parts.province && fold(a.parts.province) !== fold(b.parts.province))) {
    return { verdict: "match", same: ["address"], differs: [], note: "identical" };
  }
  const same = [];
  const differs = [];
  if (a.script !== b.script) {
    // Chinese against English: only the place names we can read both ways.
    const [han, latin] = a.script === "han" ? [a, b] : [b, a];
    const latinText = fold(a.script === "han" ? rawB : rawA);
    const hanText = fold(a.script === "han" ? rawA : rawB);
    // A place typed in English whose characters are in the licence: 桐乡 in 嘉兴市桐乡市 is Tongxiang, whichever level it was parsed at.
    const typedPlaceInLicence = (part) => {
      const core = HAN_OF[fold(latinParts[part] ?? "")];
      return Boolean(core && hanText.includes(core));
    };
    // A province one side leaves out is the province of a city it names, when the other side prints no city to
    // compare (R3t2: a licence printing only 山东, against Dongguan).
    const hanParts = { ...han.parts };
    const latinParts = { ...latin.parts };
    if (!hanParts.province && latinParts.province && !latinParts.city) hanParts.province = provinceOfCity(hanParts, "han") ?? undefined;
    if (!latinParts.province && hanParts.province && !hanParts.city) {
      const province = provinceOfCity(latinParts, "latin");
      if (province) latinParts.province = PINYIN[province];
    }
    for (const part of ["province", "city", "district", "town"]) {
      const py = latinOf(hanParts[part]);
      if (hanParts[part] && latinForms(hanParts[part]).some((form) => latinText.includes(form))) { same.push(part); continue; }
      if (typedPlaceInLicence(part)) { same.push(part); continue; }
      // A licence part we can't read in Latin letters is not compared: never a difference.
      if (!py) continue;
      // Another place: the typed one is a name we can read and it is nowhere in the licence.
      if (hanParts[part] && latinParts[part] && KNOWN_PINYIN.has(fold(latinParts[part]))) {
        // A town is a place of its own only directly under the city (Dongguan's 镇); under a district it is a neighbourhood.
        differs.push({ part, a: hanParts[part], b: latinParts[part], ...(part === "town" && !hanParts.district ? { place: true } : {}) });
      }
    }
    const hanRaw = a.script === "han" ? rawA : rawB;
    const latinRaw = a.script === "han" ? rawB : rawA;
    // The road read character by character, the number and the building as digits (fix round 4).
    const typedRoad = latinRoadOf(latinRaw);
    const keys = roadKeys(han.parts.road);
    if (keys && typedRoad.road) {
      if (keys.includes(typedRoad.road)) same.push("road");
      else differs.push({ part: "road", a: han.parts.road, b: typedRoad.road });
    }
    const latinNumber = latin.parts.number ?? typedRoad.number ?? null;
    if (han.parts.number && latinNumber) {
      if (fold(han.parts.number) === fold(latinNumber)) same.push("number");
      else differs.push({ part: "number", a: `${han.parts.number}号`, b: latinNumber });
    }
    const hanBuilding = buildingOf(hanRaw, true);
    const latinBuilding = buildingOf(latinRaw, false);
    if (hanBuilding && latinBuilding) {
      if (hanBuilding.value === latinBuilding.value) same.push("building");
      else differs.push({ part: "building", a: hanBuilding.shown, b: latinBuilding.shown });
    }
    const hanRoom = roomOf(hanRaw, true);
    const latinRoom = roomOf(latinRaw, false);
    if (hanRoom && latinRoom) {
      if (hanRoom.value === latinRoom.value) same.push("room");
      else differs.push({ part: "room", a: hanRoom.shown, b: latinRoom.shown });
    }
    const hanFloor = floorOf(hanRaw, true);
    const latinFloor = floorOf(latinRaw, false);
    if (hanFloor && latinFloor) {
      if (hanFloor.value === latinFloor.value) same.push("floor");
      else differs.push({ part: "floor", a: hanFloor.shown, b: latinFloor.shown });
    }
    if (differs.length) return { verdict: "differs", same, differs, note: "scripts" };
    if (same.includes("road") && same.includes("number")) return { verdict: "match", same, differs, note: "scripts" };
    // A licence that prints no street number (纬二路北…科研楼4楼): the street and the building, floor or room it does print.
    // Every place the licence prints must be found in the English too: a street name alone repeats across districts.
    if (same.includes("road") && !han.parts.number && ["building", "floor", "room"].some((part) => same.includes(part))
      && ["province", "city", "district", "town"].every((part) => !han.parts[part] || same.includes(part))) {
      return { verdict: "match", same, differs, note: "scripts" };
    }
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
    // A Chinese town (镇) directly under the city is a place of its own; under a district, or a Turkish mahalle, a neighbourhood.
    else differs.push({ part, a: a.parts[part], b: b.parts[part], ...(part === "town" && a.script === "han" && !a.parts.district && !b.parts.district ? { place: true } : {}) });
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

const PART_WORDS = { province: "province", city: "city", district: "district", town: "town or neighbourhood", road: "street", number: "street number", building: "building", floor: "floor", room: "room", postcode: "postcode" };
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
    // The production address's city in English, from its structured parts (save_company_address_parts).
    ...(production && String(detail?.productionCity ?? "").trim() ? { typedCity: String(detail.productionCity).trim() } : {}),
    country: String(detail?.registration?.country ?? detail?.countryCode ?? "").trim().toUpperCase(),
  };
}

// A different city or province (or a Chinese town) is another place; a different
// street in the same city can be an honest factory producing away from its registered seat.
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
export function addressOwnerCheck({ typed, license, registry, typedFrom = "location", typedCity = "" }, now = new Date()) {
  const pairs = [["license", "typed"], ["license", "registry"], ["registry", "typed"]];
  const addresses = { typed, license, registry };
  const words = { ...SOURCE_WORDS, typed: typedFrom === "production" ? "the production address the factory typed" : typedFrom === "staff" ? "the address staff entered" : SOURCE_WORDS.typed };
  const comparisons = [];
  for (const [x, y] of pairs) {
    if (!addresses[x] || !addresses[y]) continue;
    comparisons.push({ between: [x, y], ...compareAddresses(addresses[x], addresses[y], y === "typed" && typedFrom === "production" ? { cityB: typedCity } : {}) });
  }
  const parts = Object.fromEntries(Object.entries(addresses).filter(([, text]) => text).map(([key, text]) => [key, parseAddress(text).parts]));
  const reasons = [];
  let level = "unknown";
  const differing = comparisons.filter((c) => c.verdict === "differs");
  const serious = differing.filter((c) => !c.between.includes("typed") || c.differs.some((d) => PLACE_PARTS.has(d.part) || d.place));
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
    for (const c of comparisons.filter((c) => c.verdict === "match")) {
      // Only the parts that matched: a match on the street and the floor is not "the same building" (review d3).
      const what = c.note === "identical" ? "address" : c.same.includes("number") || c.same.includes("postcode") ? "street and number"
        : `street and ${["building", "floor", "room"].filter((part) => c.same.includes(part)).join(" and ")}`;
      reasons.push(`${capital(words[c.between[0]])} and ${words[c.between[1]]} give the same ${what}`);
    }
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
