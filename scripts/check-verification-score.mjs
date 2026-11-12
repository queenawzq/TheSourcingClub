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
  SCORES, lifted, reasonIsEarlier, registryCheck, approvalBlockRow, approvalBlockWords, certificateNumber, scoreGroup as groupScore, photosCheck, scoreGroup, scoreOverall, scoreVerification, standingFor, tierFor, weakestCheck, namesPartlyMatch, licenceCheck, renamedWhy,
} from "../src/shared/verification-score.mjs";
import { DEMO_LOGINS, DEMO_PASSWORD } from "../src/shared/demo-logins.mjs";

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
  check(row?.check === "registry" && /number difference/.test(row.words), `the number difference is named on the registry row (${row?.words})`);
  check(/number on the licence/.test(approvalBlockWords("document_differs", {}, reading)), "the side panel names the number too");
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
  }
}

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nverification score: all ok");
