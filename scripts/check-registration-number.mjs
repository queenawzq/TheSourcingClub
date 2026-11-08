/**
 * The registration number rules (src/shared/registration-number.mjs), pinned:
 * China's GB 32100 check character, Portugal's mod-11 check digit, Turkey's
 * 16-digit MERSİS number, anything else as written, and what VIES's answers
 * become. The database runs the same rules (registration_number_problem(),
 * migration 20261108600000); supabase/tests/registry_checks_test.sql pins
 * that copy with the same numbers. Runs in the build.
 */
import assert from "node:assert/strict";
import {
  normaliseAccessCode, normaliseRegistrationNumber, registrationCountryFrom, registrationNumberProblem,
} from "../src/shared/registration-number.mjs";
import { viesResult } from "../api/registry-vies.js";

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
  ["CN", "91350100M000100I43", "format"],
  ["PT", "501964843", null],
  ["PT", "PT 501 964 843", null],
  ["PT", "501964844", "check_digit"],
  ["PT", "509999999", null],
  ["PT", "50196484", "format"],
  ["TR", "0123456789000015", null],
  ["TR", "0123-4567-8900-0015", null],
  ["TR", "012345678900001", "format"],
  ["TR", "01234567890000AB", "format"],
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

check("Turkey typed as Turkey or Türkiye", () => {
  assert.equal(registrationCountryFrom("Istanbul, Turkey"), "TR");
  assert.equal(registrationCountryFrom("Bursa, Türkiye"), "TR");
  assert.equal(registrationCountryFrom("Porto, Portugal"), "PT");
  assert.equal(registrationCountryFrom("广东东莞, 中国"), "CN");
  assert.equal(registrationCountryFrom("Shanghai"), null);
  assert.equal(registrationCountryFrom("anything", "VN"), "VN");
});

check("VIES valid → found, with name and address", () => {
  const out = viesResult({ valid: true, name: "EMPRESA TESTE LDA", address: "RUA X\n4000 PORTO" });
  assert.equal(out.result, "found");
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
