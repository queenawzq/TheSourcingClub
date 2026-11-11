// Verification v3 levels: fixed rules over the evidence (src/shared/verification-levels.mjs).
import assert from "node:assert/strict";
import {
  addressOwner, addressSite, deriveLevels, licenseRead, mergeArrived, overallLevel, photos, registry, tradingScope, video,
} from "../src/shared/verification-levels.mjs";

let passed = 0;
const t = (name, fn) => { try { fn(); passed += 1; } catch (error) { console.error(`✗ ${name}\n  ${error.message}`); process.exitCode = 1; } };

const reading = (details, extra = {}) => ({ kind: "document_reading", subjectId: "f1", checkedAt: "2026-11-10T10:00:00Z", details: { numberAtReading: "91330200MA2XXXXX1A", ...details }, ...extra });
const okExtracted = { registrationNumber: "91330200MA2XXXXX1A", legalName: "Ningbo Loomworks Co., Ltd." };

// license read
t("no file → can't tell", () => assert.equal(licenseRead({ hasFile: false }).level, "unknown"));
t("file not read → can't tell", () => assert.equal(licenseRead({ hasFile: true }).level, "unknown"));
t("clean read → high", () => assert.equal(licenseRead({ hasFile: true, latestFileId: "f1", currentNumber: "91330200MA2XXXXX1A", reading: reading({ extracted: okExtracted }) }).level, "high"));
t("number differs → low", () => {
  const r = licenseRead({ hasFile: true, latestFileId: "f1", currentNumber: "91330200MA2XXXXX1A", reading: reading({ extracted: okExtracted, differences: [{ field: "number", document: "X", typed: "Y" }] }) });
  assert.equal(r.level, "low");
  assert.match(r.reasons[0], /Number differs/);
});
t("specimen → low", () => assert.equal(licenseRead({ hasFile: true, latestFileId: "f1", currentNumber: "91330200MA2XXXXX1A", reading: reading({ extracted: { ...okExtracted, specimen: true } }) }).level, "low"));
t("unreadable → low", () => assert.equal(licenseRead({ hasFile: true, latestFileId: "f1", reading: reading({ extracted: { readable: false } }) }).level, "low"));
t("name not read → medium", () => assert.equal(licenseRead({ hasFile: true, latestFileId: "f1", currentNumber: "91330200MA2XXXXX1A", reading: reading({ extracted: { registrationNumber: "91330200MA2XXXXX1A" } }) }).level, "medium"));
t("earlier upload → can't tell", () => assert.equal(licenseRead({ hasFile: true, latestFileId: "f2", currentNumber: "91330200MA2XXXXX1A", reading: reading({ extracted: okExtracted }) }).level, "unknown"));
t("number changed since → can't tell", () => assert.equal(licenseRead({ hasFile: true, latestFileId: "f1", currentNumber: "OTHER", reading: reading({ extracted: okExtracted }) }).level, "unknown"));

// registry
const reg = { number: "N1" };
t("no number → can't tell", () => assert.equal(registry({ registration: null }).level, "unknown"));
t("not checked → can't tell", () => assert.equal(registry({ registration: reg, checks: [] }).level, "unknown"));
t("staff found → high", () => assert.equal(registry({ registration: reg, checks: [{ source: "qcc", result: "found", numberChecked: "N1", checkedBy: "Ana" }] }).level, "high"));
t("VIES registered only → medium", () => assert.equal(registry({ registration: reg, checks: [{ source: "vies", automatic: true, result: "registered", numberChecked: "N1" }] }).level, "medium"));
t("not found → low", () => assert.equal(registry({ registration: reg, checks: [{ source: "qcc", result: "not_found", numberChecked: "N1" }] }).level, "low"));
t("check on old number ignored", () => assert.equal(registry({ registration: reg, checks: [{ source: "qcc", result: "found", numberChecked: "OLD" }] }).level, "unknown"));
t("unexplained duplicate → low", () => assert.equal(registry({ registration: reg, checks: [{ source: "qcc", result: "found", numberChecked: "N1" }], duplicates: [{ name: "Other Co" }] }).level, "low"));
t("explained duplicate → medium", () => assert.equal(registry({ registration: reg, checks: [{ source: "qcc", result: "found", numberChecked: "N1" }], duplicates: [{ name: "Other Co" }], duplicateExplained: { note: "x" } }).level, "medium"));
t("renamed since check → low", () => assert.equal(registry({ registration: reg, checks: [{ source: "qcc", result: "found", numberChecked: "N1" }], renamedSinceCheck: true }).level, "low"));
t("bad check digit → low", () => assert.equal(registry({ registration: { ...reg, problem: "check_digit" }, checks: [{ source: "qcc", result: "found", numberChecked: "N1" }] }).level, "low"));

// trading scope
const scoped = (scope) => ({ checkedAt: "2026-11-10T10:00:00Z", details: { tradingScope: scope } });
t("trading only → low", () => assert.equal(tradingScope({ reading: scoped({ read: true, trading: true, quote: "批发" }) }).level, "low"));
t("trading only with staff reason → medium", () => assert.equal(tradingScope({ reading: scoped({ read: true, trading: true, quote: "批发" }), tradingReason: "Own plant seen on video" }).level, "medium"));
t("making → high", () => assert.equal(tradingScope({ reading: scoped({ read: true, trading: false, quote: "生产" }) }).level, "high"));
t("no scope → can't tell", () => assert.equal(tradingScope({ reading: scoped({ read: false }) }).level, "unknown"));

// address belongs to this factory
t("one address → can't tell", () => assert.equal(addressOwner({ typed: "12 Rua das Flores, Porto" }).level, "unknown"));
t("typed matches license → high", () => assert.equal(addressOwner({ typed: "Rua das Flores 12, 4050-262 Porto", license: "R. das Flores, 12, 4050-262 Porto, Portugal" }).level, "high"));
t("typed differs from license → low", () => assert.equal(addressOwner({ typed: "Rua das Flores 12, 4050-262 Porto", license: "Av. da Liberdade 200, 1250-147 Lisboa" }).level, "low"));
t("Chinese addresses compared by character", () => assert.equal(addressOwner({ license: "浙江省宁波市鄞州区工业园区振兴路88号", registry: "宁波市鄞州区振兴路88号" }).level, "high"));
t("Chinese different district → low", () => assert.equal(addressOwner({ license: "浙江省宁波市鄞州区振兴路88号", registry: "广东省深圳市福田区华强北街1号" }).level, "low"));
t("a town alone is not a match → medium", () => assert.equal(addressOwner({ typed: "Izmir, Türkiye", license: "Kemalpaşa OSB, 35730 Kemalpaşa, Izmir" }).level, "medium"));
t("invisible characters stripped", () => assert.equal(addressOwner({ typed: "Rua​ das Flores 12 Porto", license: "Rua das Flores 12 Porto" }).level, "high"));

// address is a factory site
t("not checked → can't tell", () => assert.equal(addressSite(null).level, "unknown"));
t("industrial, precise → high", () => assert.equal(addressSite({ result: "industrial", details: { found: true, precise: true } }).level, "high"));
t("industrial, town only → medium", () => assert.equal(addressSite({ result: "industrial", details: { found: true, precise: false } }).level, "medium"));
t("office → low", () => assert.equal(addressSite({ result: "office", details: { found: true, precise: true } }).level, "low"));
t("residential → low", () => assert.equal(addressSite({ result: "residential", details: { found: true, precise: true } }).level, "low"));
t("not on the map → can't tell", () => assert.equal(addressSite({ result: "unknown", details: { found: false } }).level, "unknown"));

// photos
const ps = [{ id: "p1" }, { id: "p2" }];
t("no photos → can't tell", () => assert.equal(photos({ photos: [], signals: [] }).level, "unknown"));
t("none searched → can't tell", () => assert.equal(photos({ photos: ps, signals: [] }).level, "unknown"));
t("one found elsewhere → low", () => assert.equal(photos({ photos: ps, signals: [{ kind: "photo", subjectId: "p1", result: "found_elsewhere" }] }).level, "low"));
t("all own → high", () => assert.equal(photos({ photos: ps, signals: [{ kind: "photo", subjectId: "p1", result: "own" }, { kind: "photo", subjectId: "p2", result: "own" }] }).level, "high"));
t("half searched → medium", () => assert.equal(photos({ photos: ps, signals: [{ kind: "photo", subjectId: "p1", result: "own" }] }).level, "medium"));

// video
t("video not submitted", () => { const v = video(); assert.equal(v.level, "unknown"); assert.deepEqual(v.reasons, ["Not submitted"]); });

// overall
t("overall = lowest decisive", () => {
  const o = overallLevel([{ key: "registry", level: "high", details: {} }, { key: "photos", level: "medium", details: {} }, { key: "address_site", level: "unknown", details: {} }]);
  assert.equal(o.level, "medium");
  assert.deepEqual(o.low, ["photos"]);
});
t("overall ignores can't tell and video", () => assert.equal(overallLevel([{ key: "registry", level: "high", details: {} }, { key: "license_read", level: "high", details: {} }, video()]).level, "high"));
t("overall is not High while the license is unread", () => assert.equal(overallLevel([{ key: "registry", level: "high", details: {} }, { key: "license_read", level: "unknown", details: {} }]).level, "medium"));
t("overall with nothing decided → can't tell", () => assert.equal(overallLevel([video(), { key: "photos", level: "unknown", details: {} }]).level, "unknown"));
t("one low makes overall low", () => assert.equal(overallLevel([{ key: "registry", level: "high", details: {} }, { key: "trading_scope", level: "low", details: {} }]).level, "low"));

// the contract
t("arrived result replaces derived", () => {
  const merged = mergeArrived([{ key: "photos", level: "unknown", reasons: [], details: {} }], [{ key: "photos", level: "low", reasons: ["Same photo as Acme"], details: {}, checkedAt: "2026-11-11T00:00:00Z" }]);
  assert.equal(merged[0].level, "low");
});
t("malformed arrived result ignored", () => {
  const merged = mergeArrived([{ key: "photos", level: "high", reasons: [], details: {} }], [{ key: "photos", level: "94%" }, { key: "nope", level: "low" }]);
  assert.equal(merged[0].level, "high");
});
t("deriveLevels gives all seven, in order", () => {
  assert.deepEqual(deriveLevels({ detail: null, extra: null }).map((r) => r.key), ["license_read", "registry", "trading_scope", "address_owner", "address_site", "photos", "video"]);
});
t("no level is a number", () => {
  for (const r of deriveLevels({ detail: { registration: reg, checks: [{ source: "qcc", result: "found", numberChecked: "N1" }] }, extra: { signals: [], photos: ps } })) {
    assert.ok(["high", "medium", "low", "unknown"].includes(r.level));
  }
});

console.log(`${passed} level checks passed${process.exitCode ? ", some failed" : ""}`);
