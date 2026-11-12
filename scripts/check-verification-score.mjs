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
  SCORES, lifted, reasonIsEarlier, registryCheck, approvalBlockRow, approvalBlockWords, certificateNumber, certificateHolder, scoreGroup as groupScore, watermarkWords, photosCheck, scoreGroup, scoreOverall, scoreVerification, standingFor, tierFor, weakestCheck, namesPartlyMatch, licenceCheck, renamedWhy,
} from "../src/shared/verification-score.mjs";
import { DEMO_LOGINS, DEMO_PASSWORD } from "../src/shared/demo-logins.mjs";
import * as prototypeScoring from "../src/admin-prototype/verification-scoring.js";
import { compareAddresses, addressOwnerCheck } from "../api/_address.js";
import { addressCheck } from "../src/shared/verification-score.mjs";
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
check(scoreOverall([{ ...group, checks: [{ weight: 1, score: 100 }] }, { key: "company_information", checks: [{ weight: 1, score: 50 }] }, { key: "certification", checks: [{ score: 0 }] }]) === 80, "overall 60/40, certification not counted");
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
      const addr = v.groups[1].checks.find((c) => c.key === "address");
      check(addr.verdict.startsWith("Same as the licence") && v.weakest?.key !== "address", `Hangzhou address: ${addr.verdict} ${addr.score}; weakest ${v.weakest?.label}`);
    }
    if (key === "verifyCnCopy") {
      const addr = v.groups[1].checks.find((c) => c.key === "address");
      const site = v.groups[1].fields.find((f) => f.key === "siteAddress");
      check(addr.verdict === "Building differs from the licence" && (site?.licenceParts ?? []).join() === "3栋", `Guangzhou address: ${addr.verdict}; boxed ${(site?.licenceParts ?? []).join()}`);
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
