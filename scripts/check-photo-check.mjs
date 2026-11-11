#!/usr/bin/env node
/**
 * The photos check's rules (verification v3.1, A1 / A8 / B2), with no
 * database and no model: `photoLevel`, `licenseCopyLevel`, `readLook`, and
 * the fingerprint's behaviour on a non-image (a PDF license).
 *
 *   node scripts/check-photo-check.mjs
 */
import assert from "node:assert/strict";
import { photoLevel, licenseCopyLevel, readLook, runPhotoCheck, recomputePhotoMarks } from "../api/photo-check.js";
import { fingerprint } from "../api/_photo-hash.js";

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (error) {
    console.error(`FAIL ${name}\n  ${error.message}`);
    process.exitCode = 1;
  }
}

const floor = (id, extra = {}) => ({ documentId: id, staffMark: null, ai: { kind: "factory_floor", mark: "none", matchesProducts: "yes", ...extra } });
const own = (photo) => ({ ...photo, staffMark: "own" });

// A1 ------------------------------------------------------------------------
test("no workshop photo is Can't tell, even with product images", () => {
  const r = photoLevel({ workshop: [], copies: [], staffMarks: [] });
  assert.equal(r.level, "unknown");
  assert.deepEqual(r.reasons, ["No workshop photos"]);
});
test("a production floor without staff's Own is Medium, with what settles it", () => {
  const r = photoLevel({ workshop: [floor("a")] });
  assert.equal(r.level, "medium");
  assert.match(r.reasons.join(" "), /Own photos.*To settle/);
});
test("a production floor with staff's Own on every workshop photo is High", () => {
  assert.equal(photoLevel({ workshop: [own(floor("a")), own(floor("b"))] }).level, "high");
});
test("Own on only some workshop photos stays Medium", () => {
  assert.equal(photoLevel({ workshop: [own(floor("a")), floor("b")] }).level, "medium");
});
test("a client's brand label on a garment is Medium at most, never Low", () => {
  const r = photoLevel({ workshop: [own(floor("a", { mark: "client_label" }))] });
  assert.equal(r.level, "medium");
  assert.match(r.reasons.join(" "), /brand label/);
});
test("a watermark or another company's sign is Low", () => {
  assert.equal(photoLevel({ workshop: [own(floor("a", { mark: "watermark_or_other_company" }))] }).level, "low");
});
test("a stock picture is Low", () => {
  assert.equal(photoLevel({ workshop: [floor("a", { kind: "stock_or_marketing" })] }).level, "low");
});
test("no production floor seen is Medium, not Low", () => {
  assert.equal(photoLevel({ workshop: [own(floor("a", { kind: "product_closeup" }))] }).level, "medium");
});
test("the AI not looking, nothing else: Can't tell", () => {
  assert.equal(photoLevel({ workshop: [{ documentId: "a", ai: null, staffMark: null }] }).level, "unknown");
});
test("staff found a photo elsewhere: Low", () => {
  assert.equal(photoLevel({ workshop: [own(floor("a"))], staffMarks: [{ documentId: "p", result: "found_elsewhere" }] }).level, "low");
});
test("every Low and Medium says what settles it", () => {
  for (const r of [
    photoLevel({ workshop: [floor("a")] }),
    photoLevel({ workshop: [floor("a", { kind: "stock_or_marketing" })] }),
    photoLevel({ workshop: [own(floor("a"))], copies: [{ documentId: "a", otherOrgId: "o", match: "similar", mineLater: true }] }),
  ]) assert.match(r.reasons.join(" "), /To settle/, r.level);
});

// A8 ------------------------------------------------------------------------
const copy = (match, mineLater) => ({ documentId: "a", otherOrgId: "o", otherOrgName: "Other", match, mineLater });
test("an exact copy uploaded later is Low", () => {
  assert.equal(photoLevel({ workshop: [own(floor("a"))], copies: [copy("exact", true)] }).level, "low");
});
test("the earlier uploader of the same photo is not flagged", () => {
  assert.equal(photoLevel({ workshop: [own(floor("a"))], copies: [copy("exact", false)] }).level, "high");
});
test("a similar (not exact) copy uploaded later is Medium", () => {
  assert.equal(photoLevel({ workshop: [own(floor("a"))], copies: [copy("similar", true)] }).level, "medium");
});
test("a later exact copy of a product image is Low even with no workshop photo", () => {
  assert.equal(photoLevel({ workshop: [], copies: [copy("exact", true)] }).level, "low");
});
test("a later similar copy with no workshop photo is Medium", () => {
  assert.equal(photoLevel({ workshop: [], copies: [copy("similar", true)] }).level, "medium");
});

// B2 ------------------------------------------------------------------------
test("the same license file: Low for the later uploader", () => {
  const r = licenseCopyLevel([copy("exact", true)]);
  assert.equal(r.level, "low");
  assert.match(r.reasons[0], /Other/);
});
test("the same license file: the earlier uploader is told, keeps its level", () => {
  const r = licenseCopyLevel([copy("exact", false)]);
  assert.equal(r.level, null);
  assert.equal(r.reasons.length, 1);
});
test("no license copy: nothing", () => {
  assert.deepEqual(licenseCopyLevel([]), { level: null, reasons: [], copies: [] });
});
test("a similar license is never evidence", () => {
  assert.equal(licenseCopyLevel([copy("similar", true)]).level, null);
});

// Demo companies -------------------------------------------------------------
test("a copy between two demo companies never counts", () => {
  assert.equal(photoLevel({ workshop: [own(floor("a"))], copies: [{ ...copy("exact", true), bothDemo: true }] }).level, "high");
  assert.equal(licenseCopyLevel([{ ...copy("exact", true), bothDemo: true }]).level, null);
});
test("a real company and a demo one still count", () => {
  assert.equal(photoLevel({ workshop: [own(floor("a"))], copies: [{ ...copy("exact", true), bothDemo: false }] }).level, "low");
  assert.equal(licenseCopyLevel([{ ...copy("exact", true), bothDemo: false }]).level, "low");
});

// The model's answer --------------------------------------------------------
test("readLook keeps the schema and maps v3's otherCompanyMark", () => {
  assert.equal(readLook({ kind: "factory_floor", mark: "client_label", matchesProducts: "yes" }).ai.mark, "client_label");
  assert.equal(readLook({ kind: "factory_floor", otherCompanyMark: true }).ai.mark, "watermark_or_other_company");
  assert.ok(readLook({ kind: "nonsense" }).failure);
  assert.equal(readLook({ kind: "other", matchesProducts: "maybe" }).ai.matchesProducts, "cannot_tell");
});

// A PDF license gets a file hash and no picture hash.
test("a PDF is fingerprinted by its bytes only", () => {
  const print = fingerprint(Buffer.from("%PDF-1.4\n%license\n"));
  assert.match(print.sha256, /^[0-9a-f]{64}$/);
  assert.equal(print.dhash, null);
});

// runPhotoCheck never throws.
const broken = { from() { throw new Error("boom"); }, rpc() { throw new Error("boom"); }, storage: { from() { throw new Error("boom"); } } };
const results = await Promise.all([
  runPhotoCheck({ orgId: "x", asServer: broken }),
  runPhotoCheck({}),
]);
test("runPhotoCheck answers unavailable instead of throwing", () => {
  for (const r of results) {
    assert.equal(r.available, false);
    assert.ok(r.reason);
  }
});

// Staff's mark recomputes the stored result at once, with no download or AI.
const recorded = [];
const stored = { key: "photos", level: "medium", reasons: ["x"], details: { perPhoto: [{ documentId: "a", workshop: true, staffMark: null, ai: floor("a").ai }], duplicates: [], licenseCopies: [] } };
const fake = {
  from: () => ({ select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: { result: stored } }) }) }) }) }) }),
  rpc: async (name, args) => {
    if (name === "photo_staff_marks") return { data: [{ document_id: "a", result: "own" }] };
    if (name === "record_photo_check") { recorded.push(args.check_result); return { data: null }; }
    throw new Error(`unexpected ${name}`);
  },
  storage: { from() { throw new Error("no download expected"); } },
};
const recomputed = await recomputePhotoMarks({ orgId: "o", asServer: fake });
test("recording Own on every workshop photo lifts the stored result to High at once", () => {
  assert.equal(recomputed.level, "high");
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].details.perPhoto[0].staffMark, "own");
});

console.log(`check-photo-check: ${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
