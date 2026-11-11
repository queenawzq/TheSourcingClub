#!/usr/bin/env node
/**
 * The two address checks (verification v3), with no network: recorded
 * Nominatim and Overpass answers in scripts/fixtures/address/, and a fake
 * fetch for the lookups. `npm run check:address`.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  addressOwnerCheck, addressSiteCheck, addressSources, compareAddresses, judgeFromTags, overpass, parseAddress, summariseTags,
} from "../api/_address.js";
import { siteDetails } from "../api/registry-assist.js";

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
await check("PT: other postcode and city differ", () => {
  const c = compareAddresses("Rua da Indústria, 125, 4470-211 Maia", "Avenida da Liberdade 110, 1250-146 Lisboa");
  assert.equal(c.verdict, "differs");
  assert.ok(c.differs.some((d) => d.part === "postcode"));
});
await check("PT: VIES's upper case, newline form matches the licence", () => {
  const c = compareAddresses("Rua da Indústria, 125, 4470-211 Maia", "RUA DA INDUSTRIA 125\n4470-211 MAIA".replace(/\n/g, ", "));
  assert.equal(c.verdict, "match");
});

// ---------------------------------------------------------------- address_owner
await check("address_owner: licence elsewhere than typed → low, says which part", () => {
  const c = addressOwnerCheck({ typed: "广东省广州市番禺区石碁镇市莲路28号", license: "广东省广州市天河区体育西路191号", registry: "" });
  contract(c, "address_owner");
  assert.equal(c.level, "low");
  assert.match(c.reasons[0], /licence.*district/);
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
  assert.deepEqual(addressSources(detail, signals), { typed: "Maia", license: "Rua A 1, 4470-211 Maia", registry: "", registryFrom: "" });
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
await check("site levels: industrial high, office low, residential low, mixed medium, town-level unknown", () => {
  const base = { found: true, precise: true };
  assert.equal(addressSiteCheck({ ...base, judgement: "industrial", from: "the licence" }).level, "high");
  assert.equal(addressSiteCheck({ ...base, judgement: "office", from: "the licence" }).level, "low");
  assert.equal(addressSiteCheck({ ...base, judgement: "residential", from: "the licence" }).level, "low");
  assert.equal(addressSiteCheck({ ...base, judgement: "unknown", mixed: true, from: "the licence" }).level, "medium");
  assert.equal(addressSiteCheck({ found: true, precise: false, judgement: "unknown" }).level, "unknown");
  contract(addressSiteCheck({ ...base, judgement: "industrial" }), "address_site");
});

// ---------------------------------------------------------------- the lookups, faked
function fakeFetch({ nominatimAnswers, overpassAnswers }) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: String(url), ua: init?.headers?.["User-Agent"] });
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
await check("siteDetails: geocodes the LICENCE address, reads tags, rule decides industrial", async () => {
  const { impl, calls } = fakeFetch({ nominatimAnswers: [nominatim.street], overpassAnswers: [fixture("overpass-industrial.json")] });
  const site = await siteDetails({ typed: "Guangzhou", license: "广东省广州市番禺区石碁镇市莲路28号", registry: "" }, { fetchImpl: impl, callModelImpl: async () => ({}) });
  assert.equal(site.from, "the licence");
  assert.ok(decodeURIComponent(calls[0].url.replace(/\+/g, " ")).includes("番禺区"));
  assert.equal(site.judgement, "industrial");
  assert.equal(site.how, "rule");
  assert.equal(addressSiteCheck(site).level, "high");
});
await check("siteDetails: full address not found, the shorter one is tried", async () => {
  const { impl, calls } = fakeFetch({ nominatimAnswers: [[], nominatim.town], overpassAnswers: [] });
  const site = await siteDetails({ license: "广东省广州市番禺区石碁镇市莲路28号" }, { fetchImpl: impl, callModelImpl: async () => ({}) });
  assert.equal(calls.length, 2);
  assert.equal(site.precise, false);
  assert.equal(addressSiteCheck(site).level, "unknown");
});
await check("siteDetails: every map server down → unknown, never a verdict", async () => {
  const { impl } = fakeFetch({ nominatimAnswers: [nominatim.street], overpassAnswers: [500, 500, 500, 500] });
  const site = await siteDetails({ license: "广东省广州市番禺区石碁镇市莲路28号" }, { fetchImpl: impl, callModelImpl: async () => ({}) });
  assert.equal(site.tagsUnavailable, true);
  assert.equal(addressSiteCheck(site).level, "unknown");
});

await check("the address answer as saved and sent can be turned into JSON (Nov 11 preview crash)", async () => {
  const { impl } = fakeFetch({ nominatimAnswers: [nominatim.street], overpassAnswers: [500, 500, 500, 500] });
  const details = await siteDetails({ license: "广东省广州市番禺区石碁镇市莲路28号" }, { fetchImpl: impl, callModelImpl: async () => ({}) });
  details.checks = [addressOwnerCheck({ license: "广东省广州市番禺区石碁镇市莲路28号", typed: "Guangzhou" }), addressSiteCheck({ ...details })];
  assert.doesNotThrow(() => JSON.stringify(details));
});

if (failures) {
  console.log(`\n${failures} failed`);
  process.exit(1);
}
console.log("\nall address checks passed");
