import { readFileSync } from "node:fs";
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
  REGISTRATION_COUNTRIES, registrationNumberProblem, registrationProblemText, sameRegistrationNumber, usccCheckChar, registryResultLabel, companyNameKey, companyNamesMatch, registrySources, registrySourceUrl, OFFICIAL_SOURCES,
} from "../src/shared/registration-number.mjs";
import { certificateLookup, reverseImageLinks } from "../src/shared/certificate-lookups.mjs";
import { viesResult } from "../api/registry-vies.js";
import {
  activityDivisions, aiReadsDocuments, authorisationCheck, bestAddress, chinaNumberFromDocument, documentWarnings, groundedReasons,
  isoDateFrom, judgeFromTags, tradingScope,
} from "../api/registry-assist.js";
import { compareDocument, documentDifferences, nearlySameCjk } from "../src/shared/compare-document.mjs";

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

// Nov 26: the label typed before a number is dropped, only in the country it belongs to
// ("No:" with a colon anywhere). The same cases are
// pinned for the database's normalise_registration_number() in verification_round2_test.sql.
const labelled = [
  ["PT", "NIF 519211596", "519211596"],
  ["PT", "NIPC: 519211596", "519211596"],
  ["PT", "PT 519 211 596", "519211596"],
  ["PT", "pt519211596", "519211596"],
  ["PT", "nif:519211596", "519211596"],
  ["PT", "N.º 519 211 596", "519211596"],
  ["CN", "统一社会信用代码：91330100MA2B7C4D3F", "91330100MA2B7C4D3F"],
  ["CN", "统一社会信用代码 91330100MA2B7C4D3F", "91330100MA2B7C4D3F"],
  ["TR", "VKN 4837261591", "4837261591"],
  ["TR", "Vergi No: 4837261591", "4837261591"],
  [null, "No: 12345", "12345"],
  // A number that merely starts with a label's letters keeps them.
  ["GB", "NO12345", "NO12345"],
  ["PT", "51921159", "51921159"],
  // Another country's label is part of the number there (R16).
  ["NO", "NO 123456789 MVA", "NO123456789MVA"],
  ["GB", "VAT 123456789", "VAT123456789"],
  ["GB", "NIF 519211596", "NIF519211596"],
  ["PT", "VKN 4837261591", "VKN4837261591"],
  ["TR", "USCC 91330100MA2B7C4D3F", "USCC91330100MA2B7C4D3F"],
  ["GB", "统一社会信用代码 12345", "统一社会信用代码12345"],
  // "No" without a colon is kept; with one it is dropped anywhere.
  [null, "NO 12345", "NO12345"],
  ["GB", "Nr: 12345", "12345"],
  ["CN", "USCC: 91330100MA2B7C4D3F", "91330100MA2B7C4D3F"],
];
for (const [country, typed, stored] of labelled) {
  check(`label dropped: ${country ?? "other"} ${JSON.stringify(typed)} → ${stored}`, () => assert.equal(normaliseRegistrationNumber(country, typed), stored));
}
check("labelled numbers pass their country's rule; a short one says the expected format", () => {
  assert.equal(registrationNumberProblem("PT", "NIF 519211596"), null);
  assert.equal(registrationNumberProblem("CN", "统一社会信用代码：91330100MA2B7C4D3F"), null);
  assert.equal(registrationNumberProblem("TR", "VKN 4837261591"), null);
  assert.equal(registrationNumberProblem("PT", "51921159"), "format");
  // R13: the expected format, then where the company finds its number (not said to staff); China names the letters it never uses.
  assert.equal(registrationProblemText("PT", "format"), "A Portuguese company number has 9 digits, e.g. 519211596. Find it on your permanent certificate");
  assert.equal(registrationProblemText("TR", "format"), "A Turkish company tax number (VKN) has 10 digits, e.g. 4837261591. Find it on your tax plate (vergi levhası) or tax registration letter");
  assert.equal(registrationProblemText("CN", "format"), "A Unified Social Credit Code has 18 characters, e.g. 91330100MA2B7C4D3F, without the letters I, O, S, V or Z");
  assert.equal(registrationProblemText("PT", "format", "zh"), "葡萄牙公司编号为 9 位数字，例如 519211596。见商业登记永久证明");
  assert.equal(registrationProblemText("CN", "format", "zh"), "统一社会信用代码为 18 位，例如 91330100MA2B7C4D3F，不含字母 I、O、S、V、Z");
  assert.equal(registrationProblemText("PT", "format", "en", { staff: true }), "A Portuguese company number has 9 digits, e.g. 519211596");
  assert.equal(registrationProblemText("TR", "format", "en", { staff: true }), "A Turkish company tax number (VKN) has 10 digits, e.g. 4837261591");
  assert.equal(registrationProblemText("GB", "format"), "Letters and digits only");
});
check("company names: the same name once legal form and every space are ignored", () => {
  assert.ok(companyNamesMatch("Hellstitch Lda", "HELL STITCH - UNIPESSOAL LDA"));
  assert.ok(companyNamesMatch("Acme Textiles B.V.", "ACME TEXTILES"));
  assert.ok(companyNamesMatch("Foo Pvt. Ltd.", "FOO PRIVATE LIMITED"));
  assert.ok(companyNamesMatch("Anadolu Tekstil Ltd. Şti.", "ANADOLU TEKSTİL LİMİTED ŞİRKETİ"));
  assert.ok(!companyNamesMatch("Hellstitch Lda", "Riverbend Knit Ltd"));
  assert.ok(!companyNamesMatch("Lda", "Ltd"));
});
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
  assert.equal(companyNameKey("Công ty TNHH Dệt May Sài Gòn"), "det may sai gon");
  assert.ok(companyNamesMatch("CÔNG TY TNHH DỆT MAY SÀI GÒN", "Dệt May Sài Gòn Co., Ltd"));
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
  assert.deepEqual([...OFFICIAL_SOURCES].sort(), ["acts", "certidao", "companies_house", "gib", "gsxt", "hk_cr", "mca", "national", "permit",
    "registro_imprese", "rjsc", "rmc", "state_register", "vies"]);
});
check("trading scope: trade words with no making word are flagged, quoting the words", () => {
  assert.deepEqual(tradingScope("纺织品、服装的批发、零售；货物进出口"), { trading: true, read: true, recognised: true, quote: "进出口, 批发, 零售" });
  assert.equal(tradingScope("针织服装制造、加工；货物进出口").trading, false);
  assert.equal(tradingScope("").read, false);
  assert.deepEqual(tradingScope("Kinh doanh bất động sản"), { trading: false, read: true, recognised: false, quote: "" });
  assert.equal(tradingScope("Bán buôn hàng may mặc; xuất nhập khẩu").trading, true);
  assert.equal(tradingScope("Ban buon hang may mac; xuat nhap khau").trading, true);
  assert.equal(tradingScope("Sản xuất hàng may mặc; xuất nhập khẩu").trading, false);
  assert.equal(tradingScope("Xuất nhập khẩu, bán buôn quần áo").trading, true);
});
check("document differences: number and name, quoting the document", () => {
  const lines = documentDifferences({ registrationNumber: "91330100MA2B7C4D3F", legalName: "宁波贸易有限公司" }, { country: "CN", number: "91330100MA2B7C4D3F", title: "Ningbo Loomworks" }, { companyNamesMatch, normaliseRegistrationNumber });
  assert.deepEqual(lines.map((line) => line.field), ["name"]);
  assert.equal(documentDifferences({ registrationNumber: "500697256", legalName: "Fiação do Vale Lda" }, { country: "PT", number: "PT 500 697 256", title: "Fiação do Vale, Lda." }, { companyNamesMatch, normaliseRegistrationNumber }).length, 0);
  // The model copied a Chinese licence number with U+200B inside it (Nov 8): not a difference.
  assert.equal(documentDifferences({ registrationNumber: "91330100\u200BMA2B7C4D3F", legalName: "" }, { country: "CN", number: "91330100MA2B7C4D3F", title: "" }, { companyNamesMatch, normaliseRegistrationNumber }).length, 0);
  assert.equal(normaliseRegistrationNumber("TR", "\uFEFF0123\u00AD456\u200D789"), "0123456789");
});
check("address: judged from the tags by rule, imprecise is unknown", () => {
  assert.equal(judgeFromTags([{ tag: "landuse=industrial", count: 2, nearest: 40 }]).judgement, "industrial");
  assert.equal(judgeFromTags([{ tag: "building=office", count: 1, nearest: 10 }]).judgement, "office");
  assert.equal(judgeFromTags([{ tag: "landuse=industrial", count: 1, nearest: 40 }], false).judgement, "unknown");
  assert.equal(judgeFromTags([]).judgement, "unknown");
});
check("address: a place filed as land use is judged on its own tag, and a registry naming another company gives no address", () => {
  assert.equal(judgeFromTags([{ tag: "landuse=industrial", count: 1, nearest: 0 }]).judgement, "industrial");
  const detail = { registration: { number: "500697256" }, location: "Porto, Portugal",
    checks: [{ automatic: true, numberChecked: "500697256", nameMatches: false, details: { name: "EDP, S.A.", address: "LISBOA" } }] };
  assert.deepEqual(bestAddress(detail, []), { address: "Porto, Portugal", from: "the factory's location" });
});
check("address: a model's reason that names no tag found is dropped", () => {
  assert.deepEqual(groundedReasons(["landuse=industrial at 40 m", "Looks like a big factory"], [{ tag: "landuse=industrial" }]), ["landuse=industrial at 40 m"]);
});
check("AI reads documents: on everywhere, production included; the setting switches it off", () => {
  assert.equal(aiReadsDocuments({ VERCEL_ENV: "preview" }), true);
  assert.equal(aiReadsDocuments({}), true);
  assert.equal(aiReadsDocuments({ VERCEL_ENV: "production" }), true);
  assert.equal(aiReadsDocuments({ VERCEL_ENV: "production", VERIFY_AI_READS_DOCUMENTS: "off" }), false);
  assert.equal(aiReadsDocuments({ VERIFY_AI_READS_DOCUMENTS: "on" }), true);
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

// One language per locale: the English words carry no Chinese (a document's Turkish or Portuguese name stays).
check("English copy has no Chinese", () => {
  const english = Object.values(REGISTRATION_COUNTRIES).flatMap((copy) => [copy.label, copy.hint, copy.upload, copy.soleUpload, copy.second?.label, copy.second?.hint]).map((text) => text?.en ?? "");
  assert.deepEqual(english.filter((text) => /[\u3400-\u9fff]/.test(text)), []);
});
check("China's upload in each language", () => assert.deepEqual(REGISTRATION_COUNTRIES.CN.upload, { en: "Business licence", zh: "营业执照" }));

check("v3.1 A2: making words and activity codes (PT CAE, TR NACE)", () => {
  assert.equal(tradingScope("Confecção de vestuário; comércio por grosso").trading, false);
  assert.equal(tradingScope("Konfeksiyon üretimi ve ticaret").trading, false);
  assert.equal(tradingScope("Sản xuất, may trang phục; xuất nhập khẩu").trading, false);
  assert.equal(tradingScope("x", ["14131-R3 — Confeção de outro vestuário"]).makingFrom, "codes");
  assert.equal(tradingScope("服装生产").makingFrom, "words");
  // The registry's code decides over the words.
  assert.equal(tradingScope("Confecção e comércio", ["46420 — Comércio por grosso de vestuário"]).trading, true);
  assert.equal(tradingScope("", ["NACE 14.39.01 — Örme kazak"]).trading, false);
  assert.deepEqual(activityDivisions(["CAE 14131-R3", "NACE 46.42", "68100"]), { making: ["CAE 14131-R3"], trade: ["NACE 46.42"], other: ["68100"] });
});
check("v3.1 A3: China's code read with O/I/S/Z means 0/1/5/2", () => {
  const code = `91330203MA2AH7K5X${usccCheckChar("91330203MA2AH7K5X")}`;
  const read = chinaNumberFromDocument(code.replace(/0/g, "O").replace(/1/g, "I"), { normaliseRegistrationNumber, registrationNumberProblem });
  assert.deepEqual([read.number, read.mapped, read.problem], [code, true, null]);
  assert.equal(chinaNumberFromDocument(`${code.slice(0, 17)}${code[17] === "1" ? "2" : "1"}`, { normaliseRegistrationNumber, registrationNumberProblem }).problem, "check_digit");
});
check("v3.1 A5: a verification watermark is not a specimen; text under a seal is not an edit", () => {
  let look = documentWarnings({ markedAsSample: true, sampleReason: "Watermark 仅供The Sourcing Club认证使用 across the page" });
  assert.deepEqual([look.specimen, look.watermark], [false, true]);
  look = documentWarnings({ markedAsSample: true, sampleReason: "Red SPECIMEN / 测试样本 stamp", watermarkText: "他用无效" });
  assert.deepEqual([look.specimen, look.watermark], [true, true]);
  assert.equal(documentWarnings({ verificationWatermark: true, watermarkText: "" }).watermark, false);
  assert.equal(documentWarnings({ verificationWatermark: true, watermarkText: "SPECIMEN" }).specimen, true);
  assert.equal(documentWarnings({ looksEdited: true, editedReason: "Some characters appear under the red seal" }).edited, false);
  assert.equal(documentWarnings({ looksEdited: true, editedReason: "The last six digits are in a different font" }).edited, true);
});
check("v3.1 B3: founding date", () => {
  assert.equal(isoDateFrom("2016年04月18日"), "2016-04-18");
  assert.equal(isoDateFrom("02.09.2011"), "2011-09-02");
  assert.equal(isoDateFrom("2031-01-01"), null);
});
check("v3.1 B2: authorisation", () => {
  const now = new Date("2026-11-11T12:00:00Z");
  const helpers = { companyNamesMatch };
  const name = ["宁波明纬服饰制造有限公司"];
  assert.equal(authorisationCheck({ readable: true, handwrittenText: "The Sourcing Club 2026.11.10", handwrittenDate: "2026.11.10", hasRedSeal: false }, { names: name, uploadedAt: now.toISOString(), now }, helpers).level, "high");
  assert.equal(authorisationCheck({ readable: true, handwrittenText: "The Sourcing Club 2025.01.10", handwrittenDate: "2025.01.10", hasRedSeal: false }, { names: name, uploadedAt: now.toISOString(), now }, helpers).level, "medium");
  assert.equal(authorisationCheck({ readable: true, handwrittenText: "", hasRedSeal: true, sealText: "宁波明纬服饰制造有限公司" }, { names: name, now }, helpers).level, "high");
  assert.equal(authorisationCheck({ readable: true, handwrittenText: "", hasRedSeal: true, sealText: "义乌市恒越进出口贸易有限公司" }, { names: name, now }, helpers).level, "low");
  assert.equal(authorisationCheck({ readable: true, handwrittenText: "hello", hasRedSeal: false }, { names: name, now }, helpers).level, "medium");
  // Onboarding no longer asks for an authorisation (Nov 18): without an upload
  // nothing is checked or stored, and no hint ever asks staff to request one.
  assert.equal(authorisationCheck(null, {}, helpers), null);
  const cases = [
    { readable: true, handwrittenText: "The Sourcing Club 2025.01.10", handwrittenDate: "2025.01.10", hasRedSeal: false },
    { readable: true, handwrittenText: "hello", hasRedSeal: false },
    { readable: true, handwrittenText: "", hasRedSeal: false, looksEdited: true, editedReason: "pasted" },
    { readable: true, handwrittenText: "", hasRedSeal: true, sealText: "" },
  ];
  for (const fields of cases) {
    const settle = authorisationCheck(fields, { names: name, now }, helpers).details?.settle ?? "";
    assert.ok(!/^ask for|licence photo with|today's date/i.test(settle), `no hint asks for an authorisation: "${settle}"`);
  }
});
check("v3.1 B2: a reading stores nothing about authorisation without an upload", () => {
  const source = readFileSync("api/registry-assist.js", "utf8");
  assert.ok(/function authorisationFrom\(\{ file, fields, failure \}[^)]*\) \{\s*if \(!file\) return null;/.test(source));
  assert.ok(/\.\.\.\(authorisation \? \{ authorisation \} : \{\}\)/.test(source));
  assert.ok(/carried\?\.details\?\.fileId/.test(source));
});
check("the same number written two ways, by the country's rule (Nov 25)", () => {
  // Hong Kong: the 8-digit BR number is the start of the certificate's full number.
  assert.equal(sameRegistrationNumber("HK", "71234567", "71234567-000-11-25-6"), true);
  assert.equal(sameRegistrationNumber("HK", "71234568", "71234567-000-11-25-6"), false);
  assert.equal(sameRegistrationNumber("HK", "7123456", "71234567000"), false);
  // An EU VAT number is the country's prefix and the national number; Greece writes EL.
  assert.equal(sameRegistrationNumber("ES", "B12345678", "ES B12345678"), true);
  assert.equal(sameRegistrationNumber("IT", "12345678901", "IT12345678901"), true);
  assert.equal(sameRegistrationNumber("GR", "094014201", "EL094014201"), true);
  assert.equal(sameRegistrationNumber("ES", "B12345678", "FRB12345678"), false);
  // Not the EU: a UK company number is not its VAT number. China's old number is not derivable from the code.
  assert.equal(sameRegistrationNumber("GB", "12345678", "GB12345678"), false);
  assert.equal(sameRegistrationNumber("CN", "91330109MA2B3K7Q4L", "330100000012345"), false);
  const helpers = { companyNamesMatch, companyNameKey, normaliseRegistrationNumber, registrationNumberProblem, sameRegistrationNumber };
  const seen = compareDocument({ registrationNumber: "71234567-000-11-25-6", legalName: "Harbour Line Trading Limited" }, { country: "HK", number: "71234567", title: "Harbour Line Trading Limited" }, helpers);
  assert.deepEqual([seen.differences.length, seen.unsure.length], [0, 0]);
  // The database's copy agrees.
  const sql = readFileSync("supabase/migrations/20261124370000_registration_numbers_same.sql", "utf8");
  assert.ok(/country = 'HK' and short ~ '\^\\d\{8\}\$'/.test(sql) && /'GR' and long = 'EL' \|\| short/.test(sql));
});
check("public licences: a misread number or one CJK character is unsure, not differs", () => {
  const helpers = { companyNamesMatch, companyNameKey, normaliseRegistrationNumber, registrationNumberProblem };
  // 19 characters read for an 18-character code.
  let seen = compareDocument({ registrationNumber: "913304837550908666L", legalName: "" }, { country: "CN", number: "91330483755908666L", title: "" }, helpers);
  assert.deepEqual([seen.differences.length, seen.unsure.map((u) => u.field)], [0, ["number"]]);
  seen = compareDocument({ registrationNumber: "", legalName: "温州森神华服饰有限公司" }, { country: "CN", number: "", title: "温州森仲华服饰有限公司" }, helpers);
  assert.deepEqual([seen.differences.length, seen.unsure.map((u) => u.field)], [0, ["name"]]);
  // Two characters off is still a different company.
  seen = compareDocument({ registrationNumber: "", legalName: "温州森神宝服饰有限公司" }, { country: "CN", number: "", title: "温州森仲华服饰有限公司" }, helpers);
  assert.deepEqual(seen.differences.map((d) => d.field), ["name"]);
  assert.equal(nearlySameCjk("温州市瓯海经济开发区北绣四路4号", "温州市瓯海经济开发区北纬四路4号"), true);
  assert.equal(nearlySameCjk("Ningbo Textile", "Ningbo Textila"), false);
  assert.equal(nearlySameCjk("宁波", "宁海"), false);
});
if (failures) {
  console.error(`\n${failures} registration check(s) failed`);
  process.exit(1);
}
console.log("\nregistration numbers: all checks pass");
