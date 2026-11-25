#!/usr/bin/env node
/**
 * The two address checks (verification v3), with no network: recorded
 * Nominatim and Overpass answers in scripts/fixtures/address/, and a fake
 * fetch for the lookups. `npm run check:address`.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  addressOwnerCheck, addressSiteCheck, addressSources, compareAddresses, judgeFromTags, officeAddressText, overpass, ownerAtReading,
  parseAddress, placeMismatch, summariseTags,
} from "../api/_address.js";
import { addressAnswer, runAddressCheck, siteDetails } from "../api/registry-assist.js";

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/address/${name}`, import.meta.url), "utf8"));
const nominatim = fixture("nominatim.json");
let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL ${name}\n     ${error.message.split("\n").join("\n     ")}`);
  }
}
const contract = (c, key) => {
  assert.equal(c.key, key);
  assert.ok(["high", "medium", "low", "unknown"].includes(c.level), c.level);
  assert.ok(Array.isArray(c.reasons) && c.reasons.every((r) => typeof r === "string"));
  assert.equal(typeof c.details, "object");
  assert.ok(!Number.isNaN(Date.parse(c.checkedAt)));
};

// ---------------------------------------------------------------- parsing
await check("CN licence address splits into its parts", () => {
  const { parts } = parseAddress("广东省广州市番禺区石碁镇市莲路南浦段28号");
  assert.deepEqual(parts, { province: "广东", city: "广州", district: "番禺", town: "石碁", road: "市莲路南浦段".replace(/路.*/, ""), number: "28" });
});
await check("CN municipality and full-width digits, invisible characters", () => {
  const { parts } = parseAddress("上海市松江区​洞泾镇沈砖公路２２８号");
  assert.equal(parts.city, "上海");
  assert.equal(parts.district, "松江");
  assert.equal(parts.town, "洞泾");
  assert.equal(parts.number, "228");
});
await check("PT address: road, number, postcode, city", () => {
  const { parts } = parseAddress("Rua da Indústria, 125, 4470-211 Maia, Portugal");
  assert.equal(parts.postcode, "4470-211");
  assert.equal(parts.city, "maia");
  assert.equal(parts.number, "125");
  assert.match(parts.road, /da industria/);
});
await check("TR address: mahalle, cadde, no, district/city", () => {
  const { parts } = parseAddress("Merkez Mah. Fabrika Cad. No:12 Güngören/İstanbul");
  assert.equal(parts.town, "merkez");
  assert.equal(parts.road, "fabrika");
  assert.equal(parts.number, "12");
  assert.equal(parts.district, "gungoren");
  assert.equal(parts.city, "istanbul");
});

// ---------------------------------------------------------------- comparing
await check("same CN address written with and without suffixes matches", () => {
  const c = compareAddresses("广东省广州市番禺区石碁镇市莲路28号", "广州番禺区石碁镇市莲路 28 号");
  assert.equal(c.verdict, "match");
});
await check("CN: another district is 'differs', naming the district", () => {
  const c = compareAddresses("广东省广州市番禺区石碁镇市莲路28号", "广东省广州市天河区体育西路191号");
  assert.equal(c.verdict, "differs");
  assert.ok(c.differs.some((d) => d.part === "district"));
});
await check("CN: same street, another number differs on the number", () => {
  const c = compareAddresses("广东省广州市番禺区石碁镇市莲路28号", "广东省广州市番禺区石碁镇市莲路280号");
  assert.deepEqual(c.differs.map((d) => d.part), ["number"]);
});
await check("CN licence against English typed city: partial when the city agrees", () => {
  const c = compareAddresses("广东省广州市番禺区石碁镇市莲路28号", "Panyu District, Guangzhou, China");
  assert.equal(c.verdict, "partial");
  assert.ok(c.same.includes("city") && c.same.includes("district"));
});
await check("CN licence against English typed city: another city differs", () => {
  const c = compareAddresses("浙江省杭州市萧山区新塘街道工业路8号", "Guangzhou, China");
  assert.equal(c.verdict, "differs");
  assert.equal(c.differs[0].part, "city");
});
await check("CN: one character apart (北纬 read as 北绣) nearly matches, never differs", () => {
  const c = compareAddresses("广东省广州市番禺区北纬四路28号", "广东省广州市番禺区北绣四路28号");
  assert.equal(c.verdict, "near");
  assert.equal(c.near[0].part, "road");
  const owner = addressOwnerCheck({ license: "广东省广州市番禺区北纬四路28号", registry: "广东省广州市番禺区北绣四路28号", typed: "" });
  assert.equal(owner.level, "medium");
  assert.match(owner.reasons[0], /one character apart/);
  // A dropped character is near too; two characters, another district or another number are not.
  assert.equal(compareAddresses("广东省广州市番禺区北纬四路28号", "广东省广州市番禺区北四路28号").verdict, "near");
  assert.equal(compareAddresses("广东省广州市番禺区北纬四路28号", "广东省广州市番禺区南京西路28号").verdict, "differs");
  assert.equal(compareAddresses("广东省广州市番禺区北纬四路28号", "广东省广州市番禺区北纬四路29号").verdict, "differs");
});
await check("PT: other postcode and city differ", () => {
  const c = compareAddresses("Rua da Indústria, 125, 4470-211 Maia", "Avenida da Liberdade 110, 1250-146 Lisboa");
  assert.equal(c.verdict, "differs");
  assert.ok(c.differs.some((d) => d.part === "postcode"));
});
await check("PT: VIES's upper case, newline form matches the licence", () => {
  const c = compareAddresses("Rua da Indústria, 125, 4470-211 Maia", "RUA DA INDUSTRIA 125\n4470-211 MAIA".replace(/\n/g, ", "));
  assert.equal(c.verdict, "match");
});

// Flow check round 2 (R2S1, R2S3, R2S4): another city is a major difference, a postcode compares without its
// separator, and an English address is read against a Chinese licence through its place names, street and room.
await check("PT: a different city (Famalicão / Leiria) is low, not 'street differs'", () => {
  const owner = addressOwnerCheck({ license: "ESTRADA DA MATA, MARRAZES, 2415 557 LEIRIA", typed: "Rua das Fontaínhas 245, 4760-112 Vila Nova de Famalicão, Portugal", registry: "", typedFrom: "production" });
  assert.equal(owner.level, "low");
  assert.equal(owner.details.comparisons[0].differs[0].part, "city");
});
await check("PT: postcode '2415-557' and '2415 557' are the same", () => {
  assert.equal(parseAddress("ESTRADA DA MATA, MARRAZES, 2415 557 LEIRIA").parts.postcode, "2415-557");
  const c = compareAddresses("ESTRADA DA MATA, MARRAZES, 2415 557 LEIRIA", "Estrada da Mata 12, Marrazes, 2415-557 Leiria, Portugal");
  assert.equal(c.verdict, "match");
  assert.ok(c.same.includes("postcode") && !c.differs.length);
});
await check("CN: the same address in English matches the Chinese licence (street, number, room)", () => {
  const c = compareAddresses("广东省东莞市大朗镇盈丰七街76号101室", "Room 101, No. 76 Yingfeng 7th Street, Dalang Town, Dongguan, Guangdong, China");
  assert.equal(c.verdict, "match");
  for (const part of ["city", "town", "road", "number", "room"]) assert.ok(c.same.includes(part), part);
  assert.equal(addressOwnerCheck({ license: "广东省东莞市大朗镇盈丰七街76号101室", typed: "Room 101, No. 76 Yingfeng 7th Street, Dalang Town, Dongguan, Guangdong, China", registry: "", typedFrom: "production" }).level, "high");
});
await check("CN: 'No. 76' in an English address is not read as Turkish", () => {
  const { parts } = parseAddress("Room 101, No. 76 Yingfeng 7th Street, Dalang Town, Dongguan, Guangdong, China");
  assert.equal(parts.city, "dongguan");
  assert.equal(parts.town, "dalang");
});
await check("CN: another room in the same building differs on the room", () => {
  const c = compareAddresses("广东省东莞市大朗镇盈丰七街76号101室", "Room 301, No. 76 Yingfeng 7th Street, Dalang Town, Dongguan");
  assert.deepEqual(c.differs.map((d) => d.part), ["room"]);
});
await check("CN: Dongguan typed against a Tongxiang licence is another city, low", () => {
  const owner = addressOwnerCheck({ license: "桐乡市濮院镇毛衫城工业园区内", typed: "Room 101, No. 76 Yingfeng 7th Street, Dalang Town, Dongguan, Guangdong, China", registry: "", typedFrom: "production" });
  assert.equal(owner.level, "low");
  assert.equal(owner.details.comparisons[0].differs[0].part, "city");
});
await check("CN: a typed city whose characters are in the licence at another level still agrees (嘉兴市桐乡市)", () => {
  const c = compareAddresses("浙江省嘉兴市桐乡市濮院镇工业路8号", "8 Gongye Road, Puyuan Town, Tongxiang, Zhejiang");
  assert.ok(!c.differs.some((d) => d.part === "city"), JSON.stringify(c.differs));
});
// Round 3 (R3t2, R3t4, R3t6).
const HEFEI_LICENCE = "合肥市新站区瑶海工业园区纬二路北合肥雷神数控科技有限公司科研楼4楼";
const HEFEI_ENGLISH = "4th Floor, Research Building, Hefei Leishen CNC Technology Co., North of Weier Road, Yaohai Industrial Park, Xinzhan District, Hefei, Anhui, China";
await check("CN: a licence printing only its province and county, against another province, is low on the province (R3t2)", () => {
  const owner = addressOwnerCheck({ license: "山东宁阳环城科技产业园", typed: "18 Gongye Road, Humen Town, Dongguan, Guangdong, China", registry: "", typedFrom: "production", typedCity: "Dongguan" });
  assert.equal(owner.level, "low");
  assert.equal(owner.details.comparisons[0].differs[0].part, "province");
});
await check("CN: the typed city's province is compared when the typed address names no province (R3t2)", () => {
  const c = compareAddresses("山东宁阳环城科技产业园", "18 Gongye Road, Humen Town, Dongguan, China");
  assert.deepEqual(c.differs.map((d) => d.part), ["province"]);
});
await check("CN: a province-only licence in the typed city's own province is not a difference", () => {
  const c = compareAddresses("广东虎门镇工业路8号", "8 Gongye Road, Humen Town, Dongguan, China");
  assert.ok(!c.differs.length, JSON.stringify(c.differs));
  assert.ok(c.same.includes("province"));
});
await check("CN: Shanxi typed for 陕西 is not another province", () => {
  const c = compareAddresses("陕西西安工业路8号", "8 Gongye Road, Xi'an, Shanxi, China");
  assert.ok(!c.differs.some((d) => d.part === "province"), JSON.stringify(c.differs));
});
await check("CN: the English translation of a licence address is the same address (R3t4)", () => {
  assert.deepEqual(parseAddress(HEFEI_LICENCE).parts, { city: "合肥", district: "新站", town: "瑶海", road: "纬二" });
  const owner = addressOwnerCheck({ license: HEFEI_LICENCE, typed: HEFEI_ENGLISH, registry: "", typedFrom: "production", typedCity: "Hefei" });
  assert.equal(owner.level, "high");
  assert.deepEqual(owner.details.comparisons[0].same, ["city", "district", "town", "road", "floor"]);
});
await check("CN: the same translation on another floor is a difference below the city", () => {
  const owner = addressOwnerCheck({ license: HEFEI_LICENCE, typed: HEFEI_ENGLISH.replace("4th Floor", "6th Floor"), registry: "", typedFrom: "production" });
  assert.equal(owner.level, "medium");
  assert.deepEqual(owner.details.comparisons[0].differs.map((d) => d.part), ["floor"]);
});
await check("CN: the same translation in another district of Hefei differs on the district", () => {
  const c = compareAddresses(HEFEI_LICENCE, HEFEI_ENGLISH.replace("Xinzhan District", "Shushan District").replace("Yaohai Industrial Park", "Gaoxin Industrial Park"));
  assert.notEqual(c.verdict, "match");
});
await check("CN: the licence text with its province in front is the same address (R3t6)", () => {
  const c = compareAddresses(HEFEI_LICENCE, `安徽省${HEFEI_LICENCE}`);
  assert.equal(c.verdict, "match");
  assert.equal(addressOwnerCheck({ license: HEFEI_LICENCE, typed: `中国安徽省${HEFEI_LICENCE}`, registry: "", typedFrom: "staff" }).level, "high");
});
await check("CN: another province in front of the same text is not the same address", () => {
  const c = compareAddresses(`安徽省${HEFEI_LICENCE}`, `江苏省${HEFEI_LICENCE}`);
  assert.notEqual(c.verdict, "match");
});
await check("CN: the city from the structured parts is used when the text names none", () => {
  const owner = addressOwnerCheck({ license: "桐乡市濮院镇毛衫城工业园区内", typed: "Room 101, No. 76 Yingfeng 7th Street", registry: "", typedFrom: "production", typedCity: "Dongguan" });
  assert.equal(owner.level, "low");
  assert.equal(owner.details.comparisons[0].differs[0].part, "city");
});
await check("CN: another Chinese town in the same city is low (大朗 / 虎门)", () => {
  const owner = addressOwnerCheck({ license: "广东省东莞市虎门镇工业路8号", typed: "广东省东莞市大朗镇工业路8号", registry: "", typedFrom: "production" });
  assert.equal(owner.level, "low");
});
// Review d2: a licence that doesn't print its city is never "another city"; a town under a district is a neighbourhood.
await check("CN: 虎门镇 with no city on the licence vs Humen Town, Dongguan is High", () => {
  assert.equal(addressOwnerCheck({ license: "虎门镇工业路8号", typed: "8 Gongye Road, Humen Town, Dongguan, Guangdong", registry: "", typedFrom: "production" }).level, "high");
});
await check("CN: 濮院镇 vs Puyuan Town, Tongxiang is not Low", () => {
  assert.notEqual(addressOwnerCheck({ license: "濮院镇毛衫城工业园区内", typed: "Puyuan Town, Tongxiang, Zhejiang", registry: "", typedFrom: "production" }).level, "low");
});
await check("CN: 番禺区石碁镇 vs Panyu District, Guangzhou is not Low", () => {
  assert.notEqual(addressOwnerCheck({ license: "番禺区石碁镇市莲路28号", typed: "28 Shilian Road, Shiji Town, Panyu District, Guangzhou", registry: "", typedFrom: "production" }).level, "low");
});
await check("CN: another 街道 in the same district (福永 / 沙井 in 宝安区) is Medium", () => {
  assert.equal(addressOwnerCheck({ license: "广东省深圳市宝安区福永街道工业路8号", typed: "广东省深圳市宝安区沙井街道工业路8号", registry: "", typedFrom: "production" }).level, "medium");
});
await check("TR: another mahalle in the same district stays medium", () => {
  const owner = addressOwnerCheck({ license: "Merkez Mah. Fabrika Cad. No:12 Güngören/İstanbul", typed: "Tozkoparan Mah. Fabrika Cad. No:12 Güngören/İstanbul", registry: "", typedFrom: "production" });
  assert.equal(owner.level, "medium");
});

// ---------------------------------------------------------------- address_owner
await check("address_owner: typed address in another district of the same city → medium, says which part", () => {
  const c = addressOwnerCheck({ typed: "广东省广州市番禺区石碁镇市莲路28号", license: "广东省广州市天河区体育西路191号", registry: "" });
  contract(c, "address_owner");
  assert.equal(c.level, "medium");
  assert.match(c.reasons[0], /licence.*district/);
});
await check("address_owner: licence and registry disagree → low", () => {
  const c = addressOwnerCheck({ typed: "", license: "Rua da Indústria, 125, 4470-211 Maia", registry: "Avenida da Liberdade 110, 1250-146 Lisboa" });
  assert.equal(c.level, "low");
  assert.match(c.reasons[0], /licence and the registry differ/);
});
await check("address_owner: all three agree to the number → high", () => {
  const c = addressOwnerCheck({ typed: "Rua da Indústria 125, 4470-211 Maia", license: "Rua da Indústria, 125, 4470-211 Maia", registry: "RUA DA INDUSTRIA 125, 4470-211 MAIA" });
  contract(c, "address_owner");
  assert.equal(c.level, "high");
});
await check("address_owner: typed is only a city that agrees → medium", () => {
  const c = addressOwnerCheck({ typed: "Guangzhou, China", license: "广东省广州市番禺区石碁镇市莲路28号", registry: "" });
  assert.equal(c.level, "medium");
});
await check("address_owner: no licence read → unknown", () => {
  const c = addressOwnerCheck({ typed: "Guangzhou", license: "", registry: "" });
  assert.equal(c.level, "unknown");
  assert.match(c.reasons[0], /licence/);
});
await check("address_owner: sources never take another company's registry address", () => {
  const detail = { location: "Maia", registration: { number: "509" }, checks: [{ numberChecked: "509", nameMatches: false, details: { address: "X" } }] };
  const signals = [{ kind: "document_reading", details: { numberAtReading: "509", extracted: { address: "Rua A 1, 4470-211 Maia" } } }];
  assert.deepEqual(addressSources(detail, signals), { typed: "Maia", typedFrom: "location", license: "Rua A 1, 4470-211 Maia", registry: "", registryFrom: "", country: "" });
});
await check("B4: the production address is the typed one when given, else the location", () => {
  const detail = { location: "Maia", productionAddress: "Rua da Indústria 125, 4470-211 Maia", registration: { number: "509", country: "pt" } };
  const sources = addressSources(detail, []);
  assert.equal(sources.typed, "Rua da Indústria 125, 4470-211 Maia");
  assert.equal(sources.typedFrom, "production");
  assert.equal(sources.country, "PT");
  assert.equal(addressSources({ location: "Maia", productionAddress: "  " }, []).typed, "Maia");
});
await check("address_owner: production address on another street of the same city → medium, says what settles it", () => {
  const c = addressOwnerCheck({ typed: "广东省广州市番禺区石碁镇市莲路28号", typedFrom: "production", license: "广东省广州市番禺区石碁镇金山大道8号", registry: "" });
  assert.equal(c.level, "medium");
  assert.match(c.reasons[0], /production address/);
  assert.ok(c.reasons.some((r) => r.startsWith("To settle")));
  assert.equal(c.details.parts.license.city, "广州");
});
await check("address_owner: production address in another city → low", () => {
  const c = addressOwnerCheck({ typed: "浙江省杭州市萧山区新塘街道工业路8号", typedFrom: "production", license: "广东省广州市番禺区石碁镇市莲路28号", registry: "" });
  assert.equal(c.level, "low");
});
await check("A4: ownerAtReading uses the address just read, null when unreadable", () => {
  const detail = { location: "Guangzhou, China", registration: { number: "1" } };
  const c = ownerAtReading({ detail, signals: [], extracted: { address: "广东省广州市番禺区石碁镇市莲路28号", readable: true } });
  assert.equal(c.key, "address_owner");
  assert.equal(c.level, "medium");
  assert.equal(ownerAtReading({ detail, signals: [], extracted: { address: "x", readable: false } }), null);
  assert.equal(ownerAtReading({ detail, signals: [], extracted: { address: "" } }), null);
});

// ---------------------------------------------------------------- A7 office words
await check("A7: office unit in the licence's words, not a factory building", () => {
  assert.ok(officeAddressText("广东省广州市天河区体育西路191号维多利广场B塔3201室"));
  assert.ok(officeAddressText("广州市越秀区环市东路华侨大厦12楼"));
  assert.ok(officeAddressText("Merter Mah. Fatih Cad. Merter İş Merkezi No:12 Kat:3 Güngören/İstanbul"));
  assert.ok(officeAddressText("Avenida X 10, Sala 4, 4470-211 Maia"));
  assert.ok(officeAddressText("Rua Y 3, Escritório 2, Barcelos"));
  assert.equal(officeAddressText("广州市番禺区石碁镇工业园厂房3栋"), null);
  assert.equal(officeAddressText("广州市白云区太和镇自编3栋101房"), null);
  assert.equal(officeAddressText("广州市番禺区某某中心路8号"), null);
  assert.equal(officeAddressText("Rua da Indústria 125, 4470-211 Maia"), null);
});

// ---------------------------------------------------------------- A6 place mismatch
await check("A6: the map placing it in another city or postcode is a mismatch", () => {
  assert.equal(placeMismatch("广东省广州市番禺区石碁镇市莲路28号", { display_name: "市莲路, 番禺区, 广州市, 广东省", address: { city: "广州市" } }), null);
  assert.equal(placeMismatch("广东省广州市番禺区石碁镇市莲路28号", { display_name: "市莲路, 佛山市", address: { city: "佛山市" } }).part, "city");
  assert.equal(placeMismatch("Rua da Indústria 125, 4470-211 Maia", { display_name: "Rua da Indústria, Braga", address: { postcode: "4700-123", city: "Braga" } }).part, "postcode");
  assert.equal(placeMismatch("Rua da Indústria 125, 4470-211 Maia", { display_name: "Rua da Indústria, Maia", address: { postcode: "4470-211", city: "Maia" } }), null);
  assert.equal(placeMismatch("Merter Mah. Fatih Cad. No:12 Güngören/İstanbul", { display_name: "Fatih Caddesi, Merter, Güngören, İstanbul, Türkiye", address: { province: "İstanbul" } }), null);
});

// ---------------------------------------------------------------- address_site rules on recorded tags
const judgeFixture = (name, lat, lon) => judgeFromTags(summariseTags(fixture(name).elements, lat, lon));
await check("site: inside an industrial estate whose centre is 450 m away → industrial", () => {
  const tags = summariseTags(fixture("overpass-industrial.json").elements, 22.963159, 113.4622815);
  assert.equal(tags.find((t) => t.tag === "landuse=industrial").nearest, 0);
  assert.equal(judgeFixture("overpass-industrial.json", 22.963159, 113.4622815).judgement, "industrial");
});
await check("site: office building on the point → office", () => {
  assert.equal(judgeFixture("overpass-office.json", 38.7205, -9.1454).judgement, "office");
});
await check("site: inside a residential multipolygon → residential", () => {
  const judged = judgeFixture("overpass-residential.json", 41.1605, -8.642);
  assert.equal(judged.judgement, "residential");
  assert.match(judged.reasons[0], /landuse=residential/);
});
await check("site: industrial and office both near, point in neither → unknown, mixed", () => {
  const judged = judgeFixture("overpass-mixed.json", 41.25, -8.62);
  assert.equal(judged.judgement, "unknown");
  assert.equal(judged.mixed, true);
});
await check("site: RECORDED Overpass answer, Avenida da Liberdade, Lisbon (overpass-api.de, Nov 11) → office", () => {
  const judged = judgeFixture("recorded-lisbon-avenida-liberdade.json", 38.7205, -9.1454);
  assert.equal(judged.judgement, "office");
  assert.equal(judged.reasons[0], "Inside landuse=retail");
});
await check("site levels (v3.1): industrial high only with the owner high; office, residential, mixed medium; town-level unknown", () => {
  const base = { found: true, precise: true, from: "the licence" };
  const high = { level: "high" };
  assert.equal(addressSiteCheck({ ...base, judgement: "industrial" }, { owner: high }).level, "high");
  assert.equal(addressSiteCheck({ ...base, judgement: "industrial" }, { owner: { level: "medium" } }).level, "medium");
  assert.equal(addressSiteCheck({ ...base, judgement: "office" }).level, "medium");
  assert.ok(addressSiteCheck({ ...base, judgement: "office" }).reasons.includes("Needs a video or a visit"));
  assert.equal(addressSiteCheck({ ...base, judgement: "residential" }).level, "medium");
  assert.equal(addressSiteCheck({ ...base, judgement: "unknown", mixed: true }).level, "medium");
  assert.equal(addressSiteCheck({ found: true, precise: false, judgement: "unknown" }).level, "unknown");
  contract(addressSiteCheck({ ...base, judgement: "industrial" }), "address_site");
});
await check("A6 caps: typed address, a road, a shortened query → medium at most; a mismatch → unknown", () => {
  const base = { found: true, precise: true, from: "the licence", judgement: "industrial" };
  const high = { owner: { level: "high" } };
  assert.equal(addressSiteCheck({ ...base, fromTyped: true }, high).level, "medium");
  assert.equal(addressSiteCheck({ ...base, road: true }, high).level, "medium");
  assert.equal(addressSiteCheck({ ...base, shortened: true }, high).level, "medium");
  const off = addressSiteCheck({ ...base, mismatch: { part: "city", expected: "广州", got: "佛山市" } }, high);
  assert.equal(off.level, "unknown");
  assert.match(off.reasons[0], /another city/);
});
await check("A7: office words cap the site at medium, low with the owner check low", () => {
  const base = { found: true, precise: true, from: "the licence", judgement: "industrial", officeText: { words: "3201室" } };
  assert.equal(addressSiteCheck(base, { owner: { level: "high" } }).level, "medium");
  assert.equal(addressSiteCheck({ ...base, judgement: "unknown" }, { owner: { level: "unknown" } }).level, "medium");
  const low = addressSiteCheck(base, { owner: { level: "low" } });
  assert.equal(low.level, "low");
  assert.match(low.reasons[0], /office unit \(3201室\)/);
});

// ---------------------------------------------------------------- the lookups, faked
function fakeFetch({ nominatimAnswers, overpassAnswers, reverseAnswers = [] }) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: String(url), ua: init?.headers?.["User-Agent"] });
    if (String(url).includes("/reverse")) {
      const next = reverseAnswers.shift() ?? { error: "Unable to geocode" };
      if (typeof next === "number") return { ok: false, status: next };
      return { ok: true, json: async () => next };
    }
    if (String(url).includes("nominatim")) {
      const next = nominatimAnswers.shift();
      return { ok: true, json: async () => next };
    }
    const next = overpassAnswers.shift();
    if (next === "timeout") {
      return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("abort"), { name: "AbortError" }))));
    }
    if (typeof next === "number") return { ok: false, status: next };
    return { ok: true, json: async () => next };
  };
  return { impl, calls };
}

await check("overpass: first mirror refuses, second times out, third answers", async () => {
  const { impl, calls } = fakeFetch({ nominatimAnswers: [], overpassAnswers: [406, "timeout", fixture("overpass-office.json")] });
  const answer = await overpass("q", { deadline: Date.now() + 7000, mirrors: ["https://a.example/api", "https://b.example/api", "https://c.example/api"], fetchImpl: impl });
  assert.ok(answer.data.elements.length);
  assert.deepEqual(answer.tried.map((t) => t.error), [406, "timeout", null]);
  assert.ok(calls.every((c) => c.ua?.includes("operations@")), "every lookup names us");
});
const searches = (calls) => calls.filter((c) => c.url.includes("nominatim") && !c.url.includes("/reverse"));
const noModel = { callModelImpl: async () => ({}) };
await check("siteDetails: geocodes the LICENCE address in its country, reads tags, rule decides industrial", async () => {
  const { impl, calls } = fakeFetch({ nominatimAnswers: [nominatim.street], overpassAnswers: [fixture("overpass-industrial.json")] });
  const site = await siteDetails({ typed: "Guangzhou", license: "广东省广州市番禺区石碁镇市莲路28号", registry: "", country: "CN" }, { fetchImpl: impl, ...noModel });
  assert.equal(site.from, "the licence");
  assert.ok(decodeURIComponent(calls[0].url.replace(/\+/g, " ")).includes("番禺区"));
  assert.ok(calls[0].url.includes("countrycodes=cn"), "searches in the registration's country");
  assert.equal(site.judgement, "industrial");
  assert.equal(site.how, "rule");
  assert.equal(site.road, true, "the recorded hit is a road");
  // A road placement keeps it at medium even with the owner high.
  assert.equal(addressSiteCheck(site, { owner: { level: "high" } }).level, "medium");
});
await check("siteDetails: full address not found, the shorter one is tried and marked", async () => {
  const { impl, calls } = fakeFetch({ nominatimAnswers: [[], nominatim.town], overpassAnswers: [] });
  const site = await siteDetails({ license: "广东省广州市番禺区石碁镇市莲路28号" }, { fetchImpl: impl, ...noModel });
  assert.equal(searches(calls).length, 2);
  assert.equal(site.shortened, true);
  assert.equal(site.precise, false);
  assert.equal(addressSiteCheck(site).level, "unknown");
});
await check("A6: Overpass doesn't answer (one try), the reverse lookup's building still gives a verdict", async () => {
  const hit = { lat: "22.9631590", lon: "113.4622815", category: "building", type: "yes", place_rank: 30, addresstype: "building", display_name: "28号, 市莲路, 石碁镇, 番禺区, 广州市, 广东省, 中国", address: { city: "广州市" } };
  const back = { lat: "22.9632", lon: "113.4623", category: "building", type: "industrial", addresstype: "building", display_name: "厂房, 市莲路", address: { city: "广州市" } };
  const { impl, calls } = fakeFetch({ nominatimAnswers: [[hit]], overpassAnswers: [502, 502, 502], reverseAnswers: [back] });
  const site = await siteDetails({ license: "广东省广州市番禺区石碁镇市莲路28号", country: "CN" }, { fetchImpl: impl, ...noModel });
  assert.equal(calls.filter((c) => !c.url.includes("nominatim")).length, 1, "Overpass gets one try");
  assert.ok(calls.some((c) => c.url.includes("/reverse") && c.url.includes("zoom=18")));
  assert.equal(site.tagsUnavailable, true);
  assert.equal(site.judgement, "industrial");
  assert.equal(addressSiteCheck(site, { owner: { level: "high" } }).level, "high");
});
await check("A6: the place's address names an industrial area → industrial with no Overpass", async () => {
  const hit = { lat: "41.53", lon: "-8.61", category: "place", type: "house", place_rank: 30, addresstype: "place", display_name: "125, Rua da Indústria, Zona Industrial, Maia", address: { industrial: "Zona Industrial da Maia I", postcode: "4470-211", city: "Maia" } };
  const { impl } = fakeFetch({ nominatimAnswers: [[hit]], overpassAnswers: ["timeout"] });
  const site = await siteDetails({ license: "Rua da Indústria 125, 4470-211 Maia", country: "PT" }, { fetchImpl: impl, ...noModel });
  assert.equal(site.judgement, "industrial");
  assert.equal(site.reasons[0], "Inside landuse=industrial");
});
await check("A6: placed in another postcode → unknown, nothing read around it", async () => {
  const hit = { lat: "41.5", lon: "-8.4", category: "building", type: "industrial", place_rank: 30, addresstype: "building", display_name: "Rua da Indústria, Braga", address: { postcode: "4700-123", city: "Braga" } };
  const { impl, calls } = fakeFetch({ nominatimAnswers: [[hit]], overpassAnswers: [] });
  const site = await siteDetails({ license: "Rua da Indústria 125, 4470-211 Maia", country: "PT" }, { fetchImpl: impl, ...noModel });
  assert.equal(site.mismatch.part, "postcode");
  assert.equal(calls.length, 1);
  assert.equal(addressSiteCheck(site, { owner: { level: "high" } }).level, "unknown");
});
await check("A6: placed from the typed (production) address → medium at most", async () => {
  const hit = { lat: "41.53", lon: "-8.61", category: "building", type: "industrial", place_rank: 30, addresstype: "building", display_name: "Maia", address: { postcode: "4470-211", city: "Maia" } };
  const { impl } = fakeFetch({ nominatimAnswers: [[hit]], overpassAnswers: [502] });
  const site = await siteDetails({ typed: "Rua da Indústria 125, 4470-211 Maia", typedFrom: "production" }, { fetchImpl: impl, ...noModel });
  assert.equal(site.fromTyped, true);
  assert.equal(site.from, "the factory's production address");
  assert.equal(site.judgement, "industrial");
  assert.equal(addressSiteCheck(site, { owner: { level: "high" } }).level, "medium");
});
await check("siteDetails: every map server down → unknown, never a verdict", async () => {
  const { impl } = fakeFetch({ nominatimAnswers: [nominatim.street], overpassAnswers: [500], reverseAnswers: [500] });
  const site = await siteDetails({ license: "广东省广州市番禺区石碁镇市莲路28号" }, { fetchImpl: impl, ...noModel });
  assert.equal(site.tagsUnavailable, true);
  assert.equal(addressSiteCheck(site).level, "unknown");
});

await check("the address answer as saved and sent can be turned into JSON (Nov 11 preview crash)", async () => {
  const { impl } = fakeFetch({ nominatimAnswers: [nominatim.street], overpassAnswers: [500], reverseAnswers: [500] });
  const detail = { location: "Guangzhou", registration: { number: "1", country: "CN" } };
  const signals = [{ kind: "document_reading", details: { numberAtReading: "1", extracted: { address: "广东省广州市天河区体育西路191号维多利广场B塔3201室" } } }];
  const details = await addressAnswer({ detail, signals, fetchImpl: impl, ...noModel });
  assert.doesNotThrow(() => JSON.stringify(details));
  assert.deepEqual(details.checks.map((c) => c.key), ["address_owner", "address_site"]);
  assert.equal(details.checks[1].details.checks, undefined, "the site check's details do not hold the checks");
});

// ---------------------------------------------------------------- runAddressCheck, with a fake server client
function fakeServer({ tables, fail = null, saved = [] }) {
  const query = (name) => {
    const rows = tables[name] ?? [];
    const answer = { data: rows, error: fail === name ? { message: "boom" } : null };
    const chain = {
      select: () => chain, eq: () => chain, order: () => chain, limit: () => chain,
      maybeSingle: async () => ({ data: rows[0] ?? null, error: answer.error }),
      then: (resolve) => resolve(answer),
    };
    return chain;
  };
  return {
    from: query,
    rpc: async (name, args) => {
      if (name === "record_verification_signal") { saved.push(args); return { error: null }; }
      if (name === "company_title") return { data: "广州某某服装有限公司", error: null };
      if (name === "company_names_match") return { data: true, error: null };
      return { data: null, error: { message: "unknown" } };
    },
  };
}
await check("runAddressCheck: reads through the server key, uses the production address, saves one JSON-safe signal", async () => {
  const saved = [];
  const asServer = fakeServer({
    saved,
    tables: {
      company_registrations: [{ country_code: "CN", number: "91440101MA5CXXXX1X" }],
      factory_profiles: [{ location: "Guangzhou", production_address: "广东省广州市番禺区石碁镇市莲路28号" }],
      registry_checks: [],
      verification_signals: [{ kind: "document_reading", details: { numberAtReading: "91440101MA5CXXXX1X", extracted: { address: "广东省广州市番禺区石碁镇市莲路28号" } }, automatic: true, checked_at: new Date().toISOString() }],
    },
  });
  const { impl, calls } = fakeFetch({ nominatimAnswers: [nominatim.street], overpassAnswers: [fixture("overpass-industrial.json")] });
  const answer = await runAddressCheck({ orgId: "o1", asServer, requestedBy: null, fetchImpl: impl, ...noModel });
  assert.equal(answer.available, true);
  assert.ok(calls[0].url.includes("countrycodes=cn"));
  assert.equal(saved.length, 1);
  assert.doesNotThrow(() => JSON.stringify(saved[0]));
  const [owner, site] = saved[0].details.checks;
  assert.equal(owner.level, "high", "licence and production address agree to the number");
  assert.equal(owner.details.typedFrom, "production");
  assert.equal(site.level, "medium", "industrial, but placed on a road");
});
await check("runAddressCheck: never throws, says why", async () => {
  const broken = await runAddressCheck({ orgId: "o1", asServer: fakeServer({ tables: {}, fail: "factory_profiles" }) });
  assert.equal(broken.available, false);
  assert.equal(typeof broken.reason, "string");
  const thrower = await runAddressCheck({ orgId: "o1", asServer: { from() { throw new Error("x"); }, rpc() { throw new Error("x"); } } });
  assert.equal(thrower.available, false);
  assert.equal((await runAddressCheck({})).available, false);
});

if (failures) {
  console.log(`\n${failures} failed`);
  process.exit(1);
}
console.log("\nall address checks passed");
