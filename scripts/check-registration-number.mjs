/**
 * The registration number rules (src/shared/registration-number.mjs), pinned:
 * China's GB 32100 check character, Portugal's mod-11 check digit, Turkey's
 * VKN (mod 10), China's pre-2017 15 digits, anything else as written, and what VIES's answers
 * become. The database runs the same rules (registration_number_problem(),
 * migration 20261108600000); supabase/tests/registry_checks_test.sql pins
 * that copy with the same numbers. Runs in the build.
 */
import assert from "node:assert/strict";
import {
  normaliseAccessCode, normaliseRegistrationNumber, normaliseRegistrationLetter, registrationCountryFrom, registrationFlags,
  registrationNumberProblem, registryResultLabel, companyNameKey, companyNamesMatch, registrySources, registrySourceUrl, OFFICIAL_SOURCES,
} from "../src/shared/registration-number.mjs";
import { certificateLookup, reverseImageLinks } from "../src/shared/certificate-lookups.mjs";
import { viesResult } from "../api/registry-vies.js";
import { aiReadsDocuments, documentDifferences, groundedReasons, judgeFromTags, tradingScope } from "../api/registry-assist.js";

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`ok   ${name}`); } catch (error) { failures += 1; console.error(`FAIL ${name}\n     ${error.message}`); }
}

// The two published worked examples of each check digit, and fakes built with it.
const cases = [
  ["CN", "91350100M000100Y43", null],
  ["CN", "91350100m000100y43", null],
  ["CN", "9135 0100 M000 100Y 43", null],
  ["CN", "91350100M000100Y44", "check_digit"],
  ["CN", "91440300MA5F00001A", null],
  ["CN", "91350100M000100Y4", "format"],
  ["CN", "91330100MA2B7C4D3F", null],
  ["CN", "９１３３０１００ＭＡ２Ｂ７Ｃ４Ｄ３Ｆ", null],
  ["CN", "91330100MA2B7C4D31", "check_digit"],
  ["CN", "330100000012345", "old_number"],
  ["CN", "9133O100MA2B7C4D3F", "format"],
  ["CN", "91350100M000100I43", "format"],
  ["PT", "501964843", null],
  ["PT", "PT 501 964 843", null],
  ["PT", "501964844", "check_digit"],
  ["PT", "509999999", null],
  ["PT", "50196484", "format"],
  ["PT", "509123457", null],
  ["PT", "009123457", "format"],
  ["TR", "4837261591", null],
  ["TR", "483 726 1591", null],
  ["TR", "4837261592", "check_digit"],
  ["TR", "0123456789000015", "format"],
  ["TR", "483726159", "format"],
  ["GB", "SC123456", null],
  [null, "HRB 12345", null],
  [null, "", "missing"],
  [null, "!!", "format"],
];
for (const [country, number, expected] of cases) {
  check(`${country ?? "other"} ${JSON.stringify(number)} → ${expected ?? "ok"}`, () => {
    assert.equal(registrationNumberProblem(country, number), expected);
  });
}

check("PT prefix and spaces are dropped", () => assert.equal(normaliseRegistrationNumber("PT", "PT 501.964.843"), "501964843"));
check("access code: 12 digits, dashed", () => assert.equal(normaliseAccessCode("123456789012"), "1234-5678-9012"));
check("access code: blank is blank", () => assert.equal(normaliseAccessCode(""), ""));
check("access code: 11 digits is refused", () => assert.equal(normaliseAccessCode("1234-5678-901"), null));

check("registration letter number: 14 letters and digits, spaces dropped, upper-case", () => {
  assert.equal(normaliseRegistrationLetter(" ab12 cd34 ef56 78 "), "AB12CD34EF5678");
  assert.equal(normaliseRegistrationLetter(""), "");
  assert.equal(normaliseRegistrationLetter("AB12"), null);
  assert.equal(normaliseRegistrationLetter("x".repeat(15)), null);
});
// The same names as verification_v2_test.sql pins for company_name_key().
check("company names: legal forms, accents and case dropped, as the database does", () => {
  assert.equal(companyNameKey("EDP, S.A."), "edp");
  assert.equal(companyNameKey("Fiação do Vale, Lda."), "fiacao do vale");
  assert.equal(companyNameKey("ÖRME TEKSTİL SANAYİ VE TİCARET LİMİTED ŞİRKETİ"), "orme tekstil");
  assert.equal(companyNameKey("宁波织造有限公司"), "宁波织造");
  assert.ok(companyNamesMatch("FIACAO DO VALE LDA", "Fiação do Vale, Lda."));
  assert.ok(!companyNamesMatch("EDP, S.A.", "Fiação do Vale, Lda."));
  assert.ok(!companyNamesMatch("", ""));
});
check("GİB's letter check opens prefilled with the VKN and the letter number", () => {
  const gib = registrySources("TR").find((item) => item.key === "gib");
  assert.equal(registrySourceUrl(gib, { number: "4837261591", registrationLetterNumber: "AB12CD34EF5678" }),
    "https://dijital.gib.gov.tr/dogrulamalar/mukellefiyetDogrulama?vknTckn=4837261591&dilekceOid=AB12CD34EF5678");
});
check("dead links are gone: gov.pt certificate, Gazette title search, e-Devlet barcode", () => {
  const urls = ["TR", "PT"].flatMap((c) => registrySources(c)).map((item) => registrySourceUrl(item, { number: "1" }, "x") ?? "");
  assert.ok(!urls.some((url) => /gov\.pt\/servicos|ticaretsicil|belge-dogrulama/.test(url)));
});
check("official sources: the same list as registry_source_is_official()", () => {
  assert.deepEqual([...OFFICIAL_SOURCES].sort(), ["acts", "certidao", "gib", "gsxt", "national", "permit", "vies"]);
});
check("trading scope: trade words with no making word are flagged, quoting the words", () => {
  assert.deepEqual(tradingScope("纺织品、服装的批发、零售；货物进出口"), { trading: true, read: true, quote: "进出口, 批发, 零售" });
  assert.equal(tradingScope("针织服装制造、加工；货物进出口").trading, false);
  assert.equal(tradingScope("").read, false);
});
check("document differences: number and name, quoting the document", () => {
  const lines = documentDifferences({ registrationNumber: "91330100MA2B7C4D3F", legalName: "宁波贸易有限公司" }, { country: "CN", number: "91330100MA2B7C4D3F", title: "Ningbo Loomworks" });
  assert.deepEqual(lines.map((line) => line.field), ["name"]);
  assert.equal(documentDifferences({ registrationNumber: "500697256", legalName: "Fiação do Vale Lda" }, { country: "PT", number: "PT 500 697 256", title: "Fiação do Vale, Lda." }).length, 0);
});
check("address: judged from the tags by rule, imprecise is unknown", () => {
  assert.equal(judgeFromTags([{ tag: "landuse=industrial", count: 2, nearest: 40 }]).judgement, "industrial");
  assert.equal(judgeFromTags([{ tag: "building=office", count: 1, nearest: 10 }]).judgement, "office");
  assert.equal(judgeFromTags([{ tag: "landuse=industrial", count: 1, nearest: 40 }], false).judgement, "unknown");
  assert.equal(judgeFromTags([]).judgement, "unknown");
});
check("address: a model's reason that names no tag found is dropped", () => {
  assert.deepEqual(groundedReasons(["landuse=industrial at 40 m", "Looks like a big factory"], [{ tag: "landuse=industrial" }]), ["landuse=industrial at 40 m"]);
});
check("AI reads documents: on off production, off on production, the setting wins", () => {
  assert.equal(aiReadsDocuments({ VERCEL_ENV: "preview" }), true);
  assert.equal(aiReadsDocuments({}), true);
  assert.equal(aiReadsDocuments({ VERCEL_ENV: "production" }), false);
  assert.equal(aiReadsDocuments({ VERCEL_ENV: "production", VERIFY_AI_READS_DOCUMENTS: "on" }), true);
  assert.equal(aiReadsDocuments({ VERIFY_AI_READS_DOCUMENTS: "off" }), false);
});
check("certificate lookups: OEKO-TEX opens the certificate, amfori has none", () => {
  assert.equal(certificateLookup("oeko-tex-standard-100").url("13.HTR.25381"), "https://www.oeko-tex.com/en/detail/?number=13.HTR.25381");
  assert.equal(certificateLookup("bsci").url(), null);
  assert.match(reverseImageLinks("https://x.test/a b.jpg")[1].href, /tineye\.com\/search\?url=https%3A%2F%2Fx\.test%2Fa%20b\.jpg/);
});
check("TÜRKİYE in capitals is Turkey", () => assert.equal(registrationCountryFrom("İSTANBUL, TÜRKİYE"), "TR"));
check("staff flags: a clean company code has none", () => assert.deepEqual(registrationFlags("CN", "91330100MA2B7C4D3F"), []));
check("staff flags: 92 is an individual business", () => {
  assert.ok(registrationFlags("CN", "92330100MA2B7C4D3F").some((f) => f.startsWith("92")));
});
check("staff flags: a Portuguese personal NIF is a sole trader", () => assert.ok(registrationFlags("PT", "123456789").some((f) => /sole trader/.test(f))));
check("a location in Chinese is China, but not Hong Kong or Taiwan", () => {
  assert.equal(registrationCountryFrom("宁波，浙江"), "CN");
  assert.equal(registrationCountryFrom("香港九龙"), null);
  assert.equal(registrationCountryFrom("台北市"), null);
  assert.equal(registrationCountryFrom("新北市 台灣"), null);
});
check("VIES's own answers never read as a match", () => {
  assert.equal(registryResultLabel("registered"), "Registered for VAT");
  assert.equal(registryResultLabel("not_found", { automatic: true }), "Not registered for VAT");
  assert.equal(registryResultLabel("found", { source: "document" }), "Document shows this number and name");
});
check("Turkey typed as Turkey or Türkiye", () => {
  assert.equal(registrationCountryFrom("Istanbul, Turkey"), "TR");
  assert.equal(registrationCountryFrom("Bursa, Türkiye"), "TR");
  assert.equal(registrationCountryFrom("Porto, Portugal"), "PT");
  assert.equal(registrationCountryFrom("广东东莞, 中国"), "CN");
  assert.equal(registrationCountryFrom("Shanghai"), null);
  assert.equal(registrationCountryFrom("anything", "VN"), "VN");
});

check("VIES valid → registered (never found), with name and address", () => {
  const out = viesResult({ valid: true, name: "EMPRESA TESTE LDA", address: "RUA X\n4000 PORTO" });
  assert.equal(out.result, "registered");
  assert.equal(out.details.name, "EMPRESA TESTE LDA");
});
check("VIES isValid (REST shape) → found", () => assert.equal(viesResult({ isValid: true, name: "---" }).details.name, null));
check("VIES invalid → not_found", () => assert.equal(viesResult({ valid: false }).result, "not_found"));
check("VIES member state down → could_not_check", () => assert.equal(viesResult({ valid: false, userError: "MS_UNAVAILABLE" }).result, "could_not_check"));
check("VIES error wrapper → could_not_check", () => assert.equal(viesResult({ actionSucceed: false, errorWrappers: [{ error: "MS_MAX_CONCURRENT_REQ" }] }).result, "could_not_check"));
check("no answer → could_not_check", () => assert.equal(viesResult(null).result, "could_not_check"));

if (failures) {
  console.error(`\n${failures} registration check(s) failed`);
  process.exit(1);
}
console.log("\nregistration numbers: all checks pass");
