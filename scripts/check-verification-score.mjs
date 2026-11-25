#!/usr/bin/env node
/**
 * The verification score's rules (src/shared/verification-score.mjs).
 *
 *   node scripts/check-verification-score.mjs           the rules, no database
 *   node scripts/check-verification-score.mjs --seeded  also the four demo cases
 *     on the local stack after `npm run seed:demo`, read as the demo admin
 *     through admin_verification_score_input(), as the page reads them.
 */
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import {
  SCORES, lifted, reasonIsEarlier, registryCheck, approvalBlockRow, approvalBlockWords, certificateNumber, certificateHolder, scoreGroup as groupScore, watermarkWords, photosCheck, scoreGroup, scoreOverall, scoreVerification, standingFor, tierFor, weakestCheck, namesPartlyMatch, licenceCheck, renamedWhy, scopeCheck,
} from "../src/shared/verification-score.mjs";
import { DEMO_LOGINS, DEMO_PASSWORD } from "../src/shared/demo-logins.mjs";
import { brandVerification } from "../src/shared/brand-verification.mjs";
import * as prototypeScoring from "../src/admin-prototype/verification-scoring.js";
import { compareAddresses, addressOwnerCheck } from "../api/_address.js";
import { addressCheck, siteDifferences } from "../src/shared/verification-score.mjs";
import { dropContradictedPhotoFindings } from "../api/admin-review-assist.js";

let failed = 0;
const check = (ok, what) => {
  if (ok) console.log(`  ok    ${what}`);
  else { failed += 1; console.log(`  FAIL  ${what}`); }
};

console.log("rules");
check(lifted(10, { text: "x" }) === 60, "a reason lifts 10 to 60");
check(lifted(90, { text: "x" }) === 90, "a reason leaves 90 alone");
check(lifted(null, { text: "x" }) === null, "a reason does not score an unscored check");
check(tierFor(90) === "strong" && tierFor(75) === "good" && tierFor(60) === "potential" && tierFor(59) === "low", "tiers 90 / 75 / 60");
check(standingFor(85).word === "Strong" && standingFor(84).word === "Needs a look" && standingFor(59).word === "Flagged", "standing 85 / 60");
const tiles = [{ result: "own" }, { result: "unchecked" }, { result: "elsewhere" }, { result: "own", flag: "office" }, { result: "unchecked", flag: "stock" }, { result: "unchecked", flag: "tsc", others: 2 }];
check(photosCheck(tiles).score === Math.round((100 + 50 + 0 + 40 + 10 + 0) / 6), "photo points: own 100, unchecked 50, elsewhere 0, office 40, stock 10, TSC 0");
check(photosCheck([]).score === null, "no photos: no score");
const group = { key: "business_registration", label: "Business registration", checks: [{ key: "licence", weight: 30, score: 40 }, { key: "registry", weight: 30, score: null, verdict: "Not checked yet" }] };
check(scoreGroup(group) === 20, "an unchecked check counts as 0");
check(weakestCheck([group])?.key === "licence", "an unchecked check is not the weakest");
check(scoreOverall([{ ...group, checks: [{ weight: 1, score: 100 }] }, { key: "company_information", checks: [{ weight: 1, score: 50 }] }, { key: "certification", checks: [{ score: 0 }] }]) === 88, "groups 75/25, certification not counted");
// The address is in Business registration (Nov 25), but the overall keeps the old split: licence + registry 60,
// factory or trader + address + photos 40, each rounded as before (72, where 75/25 by group would say 73).
{
  const moved = [
    { key: "business_registration", checks: [{ key: "licence", weight: 30, score: 100 }, { key: "registry", weight: 30, score: 100 }, { key: "address", weight: 15, score: 0 }] },
    { key: "company_information", checks: [{ key: "scope", weight: 10, score: 50 }, { key: "photos", weight: 15, score: 50 }] },
    { key: "certification", checks: [{ score: 0 }] },
  ];
  check(scoreOverall(moved) === 72 && prototypeScoring.scoreOverall(moved) === 72, `the overall keeps the 60/40 split from before the address moved (${scoreOverall(moved)}, card ${prototypeScoring.scoreOverall(moved)})`);
}
check(namesPartlyMatch("Têxteis Douro, Lda", "Têxteis Douro – Confecções, Lda"), "a name cut short partly matches");
check(!namesPartlyMatch("EDP, S.A.", "Fiação do Vale, Lda"), "another company's name does not");
check(SCORES.registry.found === 90 && SCORES.registry.nameDiffers === 60 && SCORES.registry.notFound === 5 && SCORES.certificate.expired === 15, "approved registry and certificate points");

const empty = scoreVerification({ detail: {}, extra: {}, rules: {} });
check(empty.overall === null && empty.standing.word === "Not checked" && empty.tier === "none" && empty.weakest === null, "nothing recorded: Not checked (never 0%), no weakest");
{
  const pt = (details) => licenceCheck({ reading: { details }, files: [{ id: "f" }], registration: {}, country: "PT", title: "Têxteis Douro – Confecções, Lda" });
  const noNumber = pt({ fileId: "f", extracted: { legalName: "Têxteis Douro – Confecções, Lda", registrationNumber: "" }, unsure: [{ field: "number", document: "" }] });
  check(noNumber.verdict === "Number not read" && noNumber.score === 70, `a number not read is named as such (${noNumber.verdict})`);
  const cut = pt({ fileId: "f", extracted: { legalName: "Têxteis Douro, Lda", registrationNumber: "513284974" } });
  check(cut.verdict === "Read; legal name looks cut short", `a shorter name read is cut short (${cut.verdict})`);
  const longer = licenceCheck({ reading: { details: { extracted: { legalName: "Têxteis Douro – Confecções, Lda", registrationNumber: "513284974" } } }, files: [{ id: "f" }], registration: {}, country: "PT", title: "Têxteis Douro" });
  check(longer.score === SCORES.licence.clean, `the full legal name against a short title is not cut short (${longer.verdict})`);
  check(renamedWhy({ source: "GİB", for: "Merter Tekstil Ltd. Şti." }, "Merter Tekstil Toptan Ticaret Ltd. Şti.") === "GİB was checked for “Merter Tekstil Ltd. Şti.”; the name is now longer.", "a rename's why says what was checked and what changed");
}
console.log("staff's own result (Nov 25)");
{
  const address = "55 Renmin Road, Haidian, Beijing";
  const base = { detail: { title: "杭州钱江服装有限公司", productionAddress: address, registration: { country: "CN", number: "91330109MA2B3K7Q4L" } }, extra: { registrationFiles: [{ id: "f" }], signals: [
    { kind: "document_reading", subjectId: "f", automatic: true, checkedAt: "2026-11-10T10:00:00Z", details: { fileId: "f", extracted: { legalName: "杭州钱江服装有限公司", registrationNumber: "91330109MA2B3K7Q4L", address: "杭州市萧山区江东三路18号" }, edited: true, tradingScope: { trading: true, quote: "批发" } } },
  ] }, rules: {} };
  const withSignals = (more) => scoreVerification({ ...base, extra: { ...base.extra, signals: [...more, ...base.extra.signals] } }, { timeZone: "UTC" });
  const find = (v, key) => v.groups.flatMap((g) => g.checks).find((c) => c.key === key);
  const before = withSignals([]);
  const after = withSignals([
    { kind: "licence", subjectId: "f", automatic: false, result: "original", note: "Saw the original", checkedBy: "Maya", checkedAt: "2026-11-12T10:00:00Z" },
    { kind: "scope", automatic: false, result: "factory", note: "Sewing lines seen on site", checkedBy: "Maya", checkedAt: "2026-11-12T10:00:00Z" },
    { kind: "address", automatic: false, result: "problem", note: "A shop front", details: { address }, checkedBy: "Maya", checkedAt: "2026-11-12T10:00:00Z" },
  ]);
  const lic = find(after, "licence");
  check(find(before, "licence").score === SCORES.licence.edited && lic.score === SCORES.licence.clean && lic.verdict === "Original, by staff" && lic.staff.by === "Maya, Nov 12",
    `staff's "Original" replaces the reading's ${find(before, "licence").verdict} (${lic.score}, ${lic.staff?.by})`);
  check(find(after, "scope").score === SCORES.scope.making && find(after, "scope").verdict === "Factory, by staff",
    `staff's "Factory" scores as a factory (${find(after, "scope").score}, ${find(after, "scope").verdict})`);
  check(find(after, "address").score === SCORES.address.elsewhere && find(after, "address").verdict === "Problem found by staff", `staff's address problem scores ${find(after, "address").score}`);
  const moved = scoreVerification({ ...base, detail: { ...base.detail, productionAddress: "1 Other Road, Beijing" }, extra: { ...base.extra, signals: [
    { kind: "address", automatic: false, result: "problem", note: "A shop front", details: { address }, checkedAt: "2026-11-12T10:00:00Z" }, ...base.extra.signals] } }, { timeZone: "UTC" });
  check(!find(moved, "address").staff, "a staff result on an address no longer typed does not count");
  const newFile = scoreVerification({ ...base, extra: { ...base.extra, registrationFiles: [{ id: "g" }, { id: "f" }], signals: [
    { kind: "licence", subjectId: "f", automatic: false, result: "original", note: "x", checkedAt: "2026-11-12T10:00:00Z" }, ...base.extra.signals] } }, { timeZone: "UTC" });
  check(!find(newFile, "licence").staff, "a staff result on an earlier licence file does not count");
  const couldnt = withSignals([{ kind: "licence", subjectId: "f", automatic: false, result: "could_not_check", note: "x", checkedAt: "2026-11-12T10:00:00Z" }]);
  check(find(couldnt, "licence").score === find(before, "licence").score && find(couldnt, "licence").verdict === "Staff couldn't check", "Couldn't check keeps the automatic score");
  const trader = scoreVerification({ ...base, profile: { vendorKind: "trading_company" }, extra: { ...base.extra, signals: [{ kind: "scope", automatic: false, result: "factory", note: "x", checkedAt: "2026-11-12T10:00:00Z" }, ...base.extra.signals] } }, { timeZone: "UTC" });
  check(find(trader, "scope").score === SCORES.scope.trading, "a trading company judged a factory scores as a mismatch");
}
{
  // Staff confirmed the current address: a registry check's address difference no longer counts (Nov 25 tester).
  const current = { id: "x", source: "gib", result: "found", details: { form: 2, outcome: "found", site: "GİB", name: "A Tekstil", number: "6230418795", address: "Izmir, Türkiye" } };
  const reg = (addressConfirmed) => registryCheck({ detail: { registration: { country: "TR", number: "6230418795" }, current, checks: [{ id: "x" }] }, country: "TR", title: "A Tekstil", typedAddress: "Kemalpaşa Cd. 12, Bornova, Izmir", addressConfirmed });
  check(reg(false).score === 60 && /address differs/.test(reg(false).registry.summary), `an address the registry shows differently flags (${reg(false).registry.summary})`);
  check(reg(true).score === 90 && !/address/.test(reg(true).registry.summary), `once staff confirm the address, it is settled (${reg(true).score}, ${reg(true).registry.summary})`);
}
console.log("Hong Kong (Nov 25)");
{
  const address = "Unit 1205, 12/F, Tower 2, Harbour Centre, 8 Hok Cheung Street, Hung Hom, Kowloon, Hong Kong";
  const v = scoreVerification({
    detail: { title: "Harbour Line Trading Limited", productionAddress: address, registration: { country: "HK", number: "71234567" } },
    extra: { registrationFiles: [{ id: "f" }], signals: [
      { kind: "document_reading", subjectId: "f", automatic: true, checkedAt: "2026-11-24T10:00:00Z", details: { fileId: "f", numberAtReading: "71234567",
        extracted: { legalName: "Harbour Line Trading Limited", registrationNumber: "71234567-000-11-25-6", address },
        differences: [{ field: "number", document: "71234567-000-11-25-6", typed: "71234567" }] } },
    ] },
    rules: { approvalProblem: null },
  }, { timeZone: "UTC" });
  const find = (key) => v.groups.flatMap((g) => g.checks).find((c) => c.key === key);
  check(find("licence").score === SCORES.licence.clean && !v.groups[0].fields.find((f) => f.key === "number")?.typed,
    `the certificate's full number is the typed BR number (${find("licence").verdict})`);
  // The address check stored before the fix said "only the area matches" on identical text.
  const stored = { kind: "address", automatic: true, checkedAt: "2026-11-24T10:00:00Z", result: "industrial", details: { checks: [
    { key: "address_owner", level: "medium", reasons: [], details: { comparisons: [{ between: ["license", "typed"], verdict: "partial", same: ["city"], differs: [] }] } },
  ] } };
  const w = scoreVerification({
    detail: { title: "Harbour Line Trading Limited", productionAddress: address, registration: { country: "HK", number: "71234567" } },
    extra: { registrationFiles: [{ id: "f" }], signals: [stored,
      { kind: "document_reading", subjectId: "f", automatic: true, checkedAt: "2026-11-24T10:00:00Z", details: { fileId: "f", numberAtReading: "71234567", extracted: { legalName: "Harbour Line Trading Limited", registrationNumber: "71234567", address } } }] },
    rules: { approvalProblem: null },
  }, { timeZone: "UTC" });
  const addr = w.groups.flatMap((g) => g.checks).find((c) => c.key === "address");
  check(addr.verdict.startsWith("Same as the licence") && addr.score === SCORES.address.same, `identical addresses match (${addr.verdict}, ${addr.score})`);
  // Nov 25: compared with the registry's address only (no licence read), it never says "the licence".
  const registryOnly = addressCheck({ owner: { level: "high", details: { comparisons: [{ between: ["registry", "typed"], verdict: "match", differs: [] }] } }, siteSignal: null, typedAddress: address });
  check(registryOnly.verdict === "Same as the registry", `an address matched only against the registry says so (${registryOnly.verdict})`);
  const owner = addressOwnerCheck({ typed: address, license: address, registry: "", typedFrom: "production" });
  check(owner.level === "high" && compareAddresses(address, `${address}.`).verdict === "match", `the address check itself says identical text is the same address (${owner.level})`);
  check(compareAddresses("Merter, Güngören, Istanbul", "Merter, Güngören, Istanbul").verdict !== "match", "an identical area with no number is still only an area");
  check(!siteDifferences({ number: "71234567-000-11-25-6" }, { number: "71234567", country: "HK" }).number
    && siteDifferences({ number: "71234568-000-11-25-6" }, { number: "71234567", country: "HK" }).number, "the registry's full certificate number is the company's BR number");
  // The proof stays on the row after an explanation, which is a check of its own with no files.
  const reg = registryCheck({ detail: { registration: { country: "HK", number: "71234567" },
    current: { id: "y", source: "hk_cr", result: "found", details: { name: "Harbour Line Trading Limited", nameDiffersConfirmed: true, reason: "x" } },
    checks: [{ id: "y", details: {} }, { id: "x", details: { form: 2, outcome: "found", proof: [{ path: "p/1.png", name: "registry-check.png" }] } }] }, country: "HK", title: "Harbour Line Trading Limited" });
  check(reg.registry.proof?.[0]?.name === "registry-check.png", `the explained check keeps its proof (${reg.registry.proof?.length ?? 0} file)`);
}
console.log("fix round 2");
{
  // 1. A reason belongs to the verdict it was written for.
  const reason = { text: "seen on the map", writtenFor: "Same as the licence" };
  check(!reasonIsEarlier(reason, "Same as the licence"), "a reason for the current verdict is current");
  check(reasonIsEarlier(reason, "City differs from the licence"), "a reason for an earlier verdict is earlier");
  check(!reasonIsEarlier({ text: "old" }, "anything"), "a reason saved before writtenFor keeps lifting");
  const base = { detail: { title: "杭州钱江服装有限公司", productionAddress: "55 Renmin Road, Haidian, Beijing", registration: { country: "CN", number: "91330109MA2B3K7Q4L" } }, extra: { registrationFiles: [{ id: "f" }], signals: [
    { kind: "document_reading", subjectId: "f", automatic: true, details: { fileId: "f", extracted: { legalName: "杭州钱江服装有限公司", registrationNumber: "91330109MA2B3K7Q4L", address: "杭州市萧山区江东三路18号" }, differences: [{ field: "name", document: "杭州钱江服装有限公司", typed: "Other" }] } },
  ] }, rules: {} };
  const stale = scoreVerification({ ...base, reasons: [{ checkKey: "license_read", note: "licence matches QCC", at: "2026-11-12T10:00:00Z", by: "Staff", writtenFor: "Original, every field readable" }] }, { timeZone: "UTC" });
  const lic = stale.groups[0].checks.find((c) => c.key === "licence");
  check(lic.score === SCORES.licence.differs && lic.reason?.earlier && lic.reason.for === "Original, every field readable", `an earlier reason does not lift a new problem (${lic.score}, ${lic.reason?.for})`);
  const fresh = scoreVerification({ ...base, reasons: [{ checkKey: "license_read", note: "typo", at: "2026-11-12T10:00:00Z", by: "Staff", writtenFor: lic.verdict }] }, { timeZone: "UTC" });
  check(fresh.groups[0].checks.find((c) => c.key === "licence").score === 60, "a reason for this very verdict lifts it to 60");
  // 3. The certificate number is never wiped.
  const signals = [
    { kind: "certificate", subjectId: "c", automatic: true, details: { certNumber: "", holder: "" } },
    { kind: "certificate", subjectId: "c", automatic: false, result: "found", details: {} },
    { kind: "certificate", subjectId: "c", automatic: false, result: "found", details: { number: "CU 1048211" } },
  ];
  check(certificateNumber("c", signals) === "CU 1048211", "an empty reading and a record without a number keep the stored number");
  check(certificateHolder("c", [...signals, { kind: "certificate", subjectId: "c", automatic: false, details: { holder: "Têxteis Douro, Lda" } }]) === "Têxteis Douro, Lda", "an empty reading falls back to staff's recorded holder");
  check(certificateHolder("c", [{ kind: "certificate", subjectId: "c", automatic: true, details: { holder: "Read Holder Ltd" } }, { kind: "certificate", subjectId: "c", automatic: false, details: { holder: "Staff" } }]) === "Read Holder Ltd", "the holder read off the certificate comes first");
  // 4. Couldn't check counts as Not found, never below it.
  const reg = (result) => registryCheck({ detail: { registration: { country: "CN", number: "91330109MA2B3K7Q4L" }, current: { id: "x", source: "qcc", result, details: {} }, checks: [{ id: "x" }] }, country: "CN", title: "A" });
  const couldnt = reg("could_not_check");
  const notFound = reg("not_found");
  const grp = (c) => groupScore({ key: "business_registration", checks: [{ key: "licence", weight: 30, score: 95 }, { ...c, weight: 30 }] });
  check(couldnt.score === null && grp(couldnt) >= grp(notFound), `Couldn't check (${grp(couldnt)}) is never below Not found (${grp(notFound)})`);
  check(couldnt.verdict === "Couldn't check QCC", `the source keeps its capitals (${couldnt.verdict})`);
  // 5. The block shows on the row where it is cleared, naming number or name.
  const reading = { details: { differences: [{ field: "number", document: "1", typed: "2" }] } };
  const row = approvalBlockRow("document_differs", {}, reading);
  check(row?.check === "registry" && /number differs/.test(row.words), `the number difference is named on the registry row (${row?.words})`);
  check(/number differs/.test(approvalBlockWords("document_differs", {}, reading)), "the side panel names the number too");
}
{
  check(watermarkWords("仅供认证使用") === "仅供认证使用 (for verification use only)", "the watermark is translated");
  const pt = licenceCheck({ reading: null, files: [{ id: "f" }], registration: { accessCode: "4821-7730-9145" }, country: "PT", title: "X" });
  check(pt.lookup?.label === "Open online certificate" && pt.lookup.copy === "4821-7730-9145", "Portugal: Open online certificate copies the access code");
  const nd = registryCheck({ detail: { registration: { country: "CN", number: "1" }, current: { id: "x", source: "qcc", result: "found", checked_at: "2026-11-12T10:00:00Z", details: { outcome: "name_differs", name: "A", reason: "old name on QCC" } }, checks: [{ id: "x", checkedBy: "Staff" }] }, country: "CN", title: "A", timeZone: "UTC" });
  check(nd.reason?.text === "old name on QCC" && /Staff/.test(nd.reason.by), "the reason typed with Name differs stays on the row");
}
console.log("fix round 4");
{
  // 1. Couldn't check never below Not found, in the page's arithmetic too (the prototype module draws the live card).
  const reg = (result) => registryCheck({ detail: { registration: { country: "CN", number: "91330109MA2B3K7Q4L" }, current: { id: "x", source: "qcc", result, details: {} }, checks: [{ id: "x" }] }, country: "CN", title: "A" });
  const hz = (c) => ({ key: "business_registration", checks: [{ key: "licence", weight: 30, score: 95 }, { ...c, weight: 30 }] });
  const p = prototypeScoring.scoreGroup;
  check(p(hz(reg("could_not_check"))) === 50 && p(hz(reg("not_found"))) === 50, `Hangzhou on the card: Couldn't check ${p(hz(reg("could_not_check")))} = Not found ${p(hz(reg("not_found")))} (was 48 / 50)`);
  const recorded = prototypeScoring.recordedCheck({ key: "registry", weight: 30, registry: { source: "QCC" } }, { result: "could_not_check" });
  check(p(hz(recorded)) === 50, `a Couldn't check recorded on the card counts as Not found (${p(hz(recorded))})`);
  // 4. Strong needs no counted check in the red; the number stays.
  const red = [{ key: "business_registration", checks: [{ weight: 30, score: 95 }] }, { key: "company_information", checks: [{ weight: 15, score: 55 }] }];
  check(standingFor(89, red).word === "Needs a look" && prototypeScoring.standingFor(89, red).word === "Needs a look", "89 with a red address (55) is at most Needs a look, page and prototype");
  check(standingFor(89, [{ key: "business_registration", checks: [{ weight: 30, score: 60 }] }]).word === "Strong", "60 is not red: Strong");
  check(standingFor(89, [{ key: "certification", checks: [{ score: 15 }] }]).word === "Strong", "an uncounted certificate does not cap");
  // 3. The watermark is translated once.
  check(watermarkWords("仅供认证使用 | for verification use only") === "仅供认证使用 | for verification use only", "a stamp already in English is not translated again");
  // 5. Romanised address against the Chinese licence.
  const hzOwner = addressOwnerCheck({ typed: "18 Jiangdong 3rd Road, Xiaoshan, Hangzhou", license: "杭州市萧山区江东三路18号", registry: "", typedFrom: "production" });
  const hzAddress = addressCheck({ owner: hzOwner, siteSignal: null, typedAddress: "18 Jiangdong 3rd Road, Xiaoshan, Hangzhou" });
  check(hzAddress.verdict === "Same as the licence" && hzAddress.score === SCORES.address.same, `Hangzhou: ${hzAddress.verdict} (${hzAddress.score})`);
  const gzOwner = addressOwnerCheck({ typed: "Building 5, 112 Huangpu Road, Baiyun, Guangzhou", license: "广州市白云区黄浦路112号3栋", registry: "", typedFrom: "production" });
  const gzAddress = addressCheck({ owner: gzOwner, siteSignal: null, typedAddress: "Building 5, 112 Huangpu Road, Baiyun, Guangzhou" });
  const gzParts = gzOwner.details.comparisons.flatMap((c) => c.differs.map((d) => d.a));
  check(gzAddress.verdict === "Building differs from the licence" && gzParts.join() === "3栋", `Guangzhou: ${gzAddress.verdict}, boxed ${gzParts.join()}`);
  check(compareAddresses("广州市白云区黄浦路112号", "113 Huangpu Road, Guangzhou").differs.some((d) => d.part === "number"), "a different street number still differs");
  // 6. A number difference is named as a number, with a way to clear it that fits a number.
  const numberReading = { details: { differences: [{ field: "number", document: "91440111MA59C2RX8B", typed: "91440111MA59C2RY8C" }] } };
  const found = registryCheck({ detail: { registration: { country: "CN", number: "91440111MA59C2RY8C" }, current: { id: "x", source: "qcc", result: "found", details: {} }, checks: [{ id: "x" }] }, country: "CN", title: "A", documentDiffers: "number" });
  check(!/match/.test(found.verdict) && /another number/.test(found.verdict), `the row does not say "match" (${found.verdict})`);
  const rowWords = approvalBlockRow("document_differs", {}, numberReading).words;
  const panelWords = approvalBlockWords("document_differs", {}, numberReading);
  check(/number/.test(rowWords) && /Typed:/.test(rowWords) && !/Name differs/.test(rowWords), `row: ${rowWords}`);
  check(/number/.test(panelWords) && !/name on the licence/.test(panelWords), `side panel: ${panelWords}`);
  // 7. AI suggestions never call photos staff recorded as their own generic or reused.
  const ownLines = ["Photo 1: recorded by staff as their own", "Photo 2: recorded by staff as their own"];
  const ai = [{ topic: "Factory photos", observation: "Factory photo file names look like generic or reused images", evidence: "IMG_001.jpg" }, { topic: "Address", observation: "Looks like a home", evidence: "55%" }];
  const kept = dropContradictedPhotoFindings(ai, ownLines);
  check(kept.findings.length === 1 && kept.findings[0].topic === "Address" && kept.dropped === 1, "a 'generic or reused photos' finding is dropped once staff recorded them their own");
  check(dropContradictedPhotoFindings(ai, ["Photo 1: not checked yet"]).findings.length === 2, "kept while a photo is not checked");
  // 9. After Couldn't check the side panel does not say "found no match".
  const could = approvalBlockWords("no_check", { current: { result: "could_not_check", source: "qcc" } });
  check(!/found no match/.test(could) && /couldn't check/i.test(could), `Couldn't check: ${could}`);
}
console.log("Nov 13");
{
  // Factory or trader says plainly whether it is a factory; the scope read sits with the licence.
  const making = scopeCheck({ reading: { details: { tradingScope: { read: true, quote: "服装制造" } } }, level: { level: "high" }, country: "CN" });
  check(making.verdict === "Factory: licence includes manufacturing (服装制造)", `making: ${making.verdict}`);
  const trading = scopeCheck({ reading: { details: { tradingScope: { read: true, trading: true, quote: "服装批发" } } }, level: { level: "low" }, country: "CN" });
  check(trading.verdict === "Not a factory: trading only (服装批发)", `trading: ${trading.verdict}`);
  const wholesale = scopeCheck({ reading: { details: { tradingScope: { read: true, trading: true, quote: "Toptan giyim ticareti" } } }, level: { level: "low" }, country: "TR" });
  check(wholesale.verdict === "Not a factory: wholesale trade only", `Türkiye wholesale: ${wholesale.verdict}`);
  const coded = scopeCheck({ reading: { details: { tradingScope: { read: true }, extracted: { activityCodes: ["46421", "46160"] } } }, level: { level: "low" }, country: "PT" });
  check(coded.verdict === "Not a factory: wholesale trade only", `every code wholesale: ${coded.verdict}`);
  const club = scopeCheck({ reading: { details: { tradingScope: { read: true }, extracted: { activityCodes: ["93120", "46421", "56301"], businessScope: "Clube desportivo" } } }, level: { level: "low" }, country: "PT" });
  check(club.verdict === "Not a factory: no manufacturing on the licence" && club.formerVerdict === "Wholesale trade only, no manufacturing", `a sports club is not called a wholesaler: ${club.verdict}`);
  const input = (writtenFor) => ({
    detail: { title: "杭州钱江服装有限公司", registration: { country: "CN", number: "91330109MA2B3K7Q4L" } },
    extra: { registrationFiles: [{ id: "f" }], signals: [{ kind: "document_reading", subjectId: "f", automatic: true, details: { fileId: "f", extracted: { legalName: "杭州钱江服装有限公司", businessScope: "服装批发；货物进出口" }, tradingScope: { read: true, trading: true, quote: "服装批发" } } }] },
    rules: {},
    reasons: [{ checkKey: "trading_scope", note: "sews in its own unit", at: "2026-11-12T10:00:00Z", by: "Staff", writtenFor }],
  });
  const old = scoreVerification(input("Trading only (服装批发)"), { timeZone: "UTC" });
  const scope = old.groups[1].checks.find((c) => c.key === "scope");
  check(scope.verdict.startsWith("Not a factory") && scope.score === 60 && !scope.reason?.earlier && !("formerVerdict" in scope), `a reason written for the old words still lifts (${scope.score}, ${scope.verdict})`);
  const other = scoreVerification(input("Can't tell from the licence"), { timeZone: "UTC" }).groups[1].checks.find((c) => c.key === "scope");
  check(other.reason?.earlier && other.score === 10, "a reason for another verdict still does not");
  check(old.groups[0].fields.some((f) => f.key === "scope" && f.label === "Business scope on the licence") && !old.groups[1].fields.some((f) => f.key === "scope"), "the business scope is under Business registration, not Company information");
}
console.log("brands (Nov 13)");
{
  const rows = {
    unregistered: [["Business registration", "Missing", 0, "No business registration document has been uploaded."], ["Company details", "Review", 83, "Not filled in: Year founded."], ["Terms accepted", "Clear", 100, "Signed \"Ava Brooks\" on 11 Nov 2026 against terms version 1."], ["Contact domain", "Review", 50, "No member address uses x.com."], ["Duplicate company signal", "Review", 0, "Shares a legal name with: Other."], ["Brand evidence", "Clear", 100, "4 image or walkthrough file(s) uploaded. Nobody has confirmed."]],
    registered: [["Business registration", "Review", 100, "Uploaded 12 Nov 2026."], ["Company details", "Clear", 100, "Every profile field asked for is filled in."], ["Terms accepted", "Clear", 100, "Signed \"Sam Lee\" on 2 Nov 2026 against terms version 1."], ["Brand evidence", "Review", 50, "2 image or walkthrough file(s) uploaded."]],
    nothing: [["Business registration", "Missing", 0, ""], ["Company details", "Missing", 20, "Not filled in: Legal name, Website."], ["Terms accepted", "Missing", 0, ""], ["Brand evidence", "Missing", 0, "0 image or walkthrough file(s) uploaded."]],
  };
  const P = prototypeScoring;
  const of = (key) => brandVerification({ checks: rows[key], timeZone: "UTC" });
  const a = of("unregistered");
  const br = a.groups.find((g) => g.key === "business_registration");
  check(a.groups.map((g) => g.key).join() === "business_registration,company_information,brand_evidence", "brand groups: registration, company information, brand evidence");
  check(!JSON.stringify(a).includes("Contact domain") && !JSON.stringify(a).includes("Shares a legal name"), "no contact domain, no duplicate company signal");
  check(P.groupWeight(br) === 0 && P.scoreGroup(br) == null && P.tierFor(P.scoreGroup(br)) === "none" && !P.redCheck(a.groups) && br.verdict === "Not uploaded (optional for brands)", "an unregistered brand: registration shown, not counted, never red");
  check(P.scoreOverall(a.groups) === Math.round(((Math.round(83 * 0.7 + 100 * 0.3)) * 50 + 100 * 30) / 80), `unregistered overall from company information 50 + evidence 30 (${P.scoreOverall(a.groups)})`);
  check(!a.facts.find((f) => f.key === "registration").ok && a.facts.find((f) => f.key === "registration").ok !== false && a.facts.find((f) => f.key === "terms").value === "Ava Brooks, Nov 11", "facts: registration missing is information, not a gap; terms signer and day");
  const b = of("registered");
  check(P.groupWeight(b.groups[0]) === 20 && P.scoreGroup(b.groups[0]) === 80 && b.groups[2].verdict === "Only 2 files uploaded", `a registered brand: registration counts 20 (${P.scoreOverall(b.groups)})`);
  const c = of("nothing");
  check(P.standingFor(P.scoreOverall(c.groups), c.groups).word === "Flagged" && c.groups[1].verdict === "Terms not signed" && c.facts.find((f) => f.key === "details").value === "Not filled in: Legal name, Website", `a brand with nothing is Flagged (${c.groups[1].verdict})`);
  check(a.groups.every((g) => g.reasons === false && g.rerunnable === false), "brand rows have no reasons and no Run again");
  check(a.groups.find((g) => g.key === "company_information").evidencePane === false, "a brand's Company information has no file pane");
  const twice = [{ id: "1", kind: "product_image", file_name: "shirt.jpg", size_bytes: 2048, created_at: "2026-11-13T10:00:00Z" }, { id: "2", kind: "product_image", file_name: "shirt.jpg", size_bytes: 2048, created_at: "2026-11-13T10:01:00Z" }];
  const dup = brandVerification({ checks: [["Brand evidence", "Review", 50, "2 image or walkthrough file(s) uploaded."]], documents: twice, timeZone: "UTC" });
  const be = dup.groups.find((g) => g.key === "brand_evidence");
  check(be.verdict === "Only 1 file uploaded" && be.evidence.files.length === 1, `the same photo stored twice counts once (${be.verdict})`);
}
check(empty.groups.map((g) => g.key).join() === "business_registration,company_information,certification", "three groups, in order");
check(!JSON.stringify(empty).includes("Maison") && !JSON.stringify(empty).includes("Qianjiang"), "no mock constants");

if (process.argv.includes("--seeded")) {
  console.log("\nseeded demo cases");
  const stack = process.env.SUPABASE_URL ? {} : JSON.parse(execFileSync("npx", ["supabase", "status", "-o", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  const url = process.env.SUPABASE_URL ?? stack.API_URL;
  const anon = process.env.SUPABASE_ANON_KEY ?? stack.PUBLISHABLE_KEY ?? stack.ANON_KEY;
  const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInWithPassword({ email: DEMO_LOGINS.admin.email, password: DEMO_PASSWORD });
  if (error) throw new Error(`sign in as the demo admin: ${error.message}`);
  const expected = [
    ["verifyCn", 88, 100, "Strong", null],
    ["verifyCnCopy", 66, 80, "Needs a look", "document_differs"],
    ["verifyTr", 20, 36, "Flagged", "renamed"],
    ["verifyPt", 66, 80, "Needs a look", "no_check"],
  ];
  for (const [key, low, high, word, problem] of expected) {
    const { data: org } = await client.from("orgs").select("id").eq("name", DEMO_LOGINS[key].name).order("created_at", { ascending: false }).limit(1).single();
    const { data: input, error: readError } = await client.rpc("admin_verification_score_input", { target_org: org.id });
    if (readError) { check(false, `${key}: ${readError.message}`); continue; }
    const v = scoreVerification(input, { timeZone: "UTC" });
    const rows = v.groups.map((g) => `${g.label} ${g.score ?? "—"}: ${g.checks.map((c) => `${c.label} ${c.score ?? "—"}`).join(", ")}`).join(" | ");
    console.log(`        ${DEMO_LOGINS[key].name}: ${v.overall}% ${v.standing.word}; weakest ${v.weakest?.label ?? "none"}; block ${v.approvalProblem ?? "none"}\n          ${rows}`);
    check(v.overall >= low && v.overall <= high && v.standing.word === word, `${key} ${v.overall}% within ${low}–${high}, ${word}`);
    check((v.approvalProblem ?? null) === problem, `${key} approval: ${problem ?? "open"}`);
    if (v.standing.word === "Strong") check(!v.groups.some((g) => ["business_registration", "company_information"].includes(g.key) && g.checks.some((c) => c.weight && c.score != null && c.score < 60)), `${key}: Strong with no red check`);
    if (key === "verifyCn" || key === "verifyPt") {
      const cert = v.groups.find((g) => g.key === "certification");
      const want = key === "verifyCn" ? "杭州钱江服装有限公司 · Hangzhou Qianjiang Garment Co., Ltd." : "Têxteis Douro – Confecções, Lda";
      const field = cert.fields.find((f) => f.key === "holder")?.value;
      check(field === want && cert.evidence.holder === want, `${key} certificate holder: field "${field}", card "${cert.evidence.holder}"`);
    }
    if (key === "verifyCn") {
      const as = (result) => { const i = structuredClone(input); i.detail.current = { ...i.detail.current, result, details: { ...i.detail.current.details, outcome: result } }; return scoreVerification(i, { timeZone: "UTC" }); };
      const nf = as("not_found");
      const cc = as("could_not_check");
      const g = (x) => prototypeScoring.scoreGroup(x.groups[0]);
      check(g(cc) >= g(nf) && prototypeScoring.scoreOverall(cc.groups) >= prototypeScoring.scoreOverall(nf.groups),
        `Hangzhou, as the card draws it: Couldn't check ${g(cc)}/${prototypeScoring.scoreOverall(cc.groups)} vs Not found ${g(nf)}/${prototypeScoring.scoreOverall(nf.groups)}`);
      const addr = v.groups[0].checks.find((c) => c.key === "address");
      check(!v.groups[1].checks.some((c) => c.key === "address") && !v.facts.some((f) => f.key === "address"), "Hangzhou: the address is only in Business registration (Nov 25)");
      check(addr.verdict.startsWith("Same as the licence") && v.weakest?.key !== "address", `Hangzhou address: ${addr.verdict} ${addr.score}; weakest ${v.weakest?.label}`);
    }
    if (key === "verifyCnCopy") {
      const addr = v.groups[0].checks.find((c) => c.key === "address");
      const site = addr.lines?.find((line) => line.key === "licence");
      check(addr.verdict === "Building differs from the licence" && (site?.parts ?? []).join() === "3栋" && addr.lines[0].key === "typed", `Guangzhou address: ${addr.verdict}; boxed ${(site?.parts ?? []).join()}`);
      const registry = v.groups[0].checks.find((c) => c.key === "registry");
      check(!/match/.test(registry.verdict), `Guangzhou registry row: ${registry.verdict}`);
    }
  }
}

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nverification score: all ok");
