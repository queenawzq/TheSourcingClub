/**
 * The browser's own "Failed to fetch" must not reach a person, and every
 * failure the sign-in screens word must exist in both languages.
 *
 * A vendor in China saw exactly that on Create account (Nov 2026). The shapes
 * below are the ones supabase-js really produced on a local stack with its
 * gateway stopped; a new version that words them differently fails here.
 */
import { AUTH_MESSAGES, authErrorLines, authFailure, authLanguages, isNoAnswer } from "../src/shared/auth-messages.mjs";

let failures = 0;
const check = (ok, label) => {
  if (!ok) { failures += 1; console.error("  ✗", label); }
};

const authError = Object.assign(new Error("Failed to fetch"), { name: "AuthRetryableFetchError", status: 0 });
const gatewayError = Object.assign(new Error("HTTP 522"), { name: "AuthRetryableFetchError", status: 522 });
const noAnswer = [
  authError,
  gatewayError,
  new TypeError("Failed to fetch"),
  new TypeError("Load failed"),
  new TypeError("NetworkError when attempting to fetch resource."),
  new Error("create your organisation: TypeError: Failed to fetch"),
];
for (const error of noAnswer) check(isNoAnswer(error), `no answer: ${error.message}`);

const answered = [
  Object.assign(new Error("Invalid login credentials"), { name: "AuthApiError", status: 400 }),
  Object.assign(new Error("User already registered"), { name: "AuthApiError", status: 422, code: "user_already_exists" }),
  new Error("create your organisation: organisation name is required"),
  null,
];
for (const error of answered) check(!isNoAnswer(error), `an answer: ${error?.message}`);

for (const [kind, words] of Object.entries(AUTH_MESSAGES)) {
  const en = words.en({ min: 8 });
  const zh = words.zh({ min: 8 });
  check(en && !/[一-鿿]/.test(en), `${kind}: English is English`);
  check(/[一-鿿]/.test(zh), `${kind}: Chinese is Chinese`);
  check(!/undefined|Failed to fetch/.test(en + zh), `${kind}: no raw words`);
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
check(same(authLanguages({ factory: true, zhPage: true }), ["zh"]), "Chinese vendor page reads Chinese");
check(same(authLanguages({ factory: true, zhPage: false, browserLanguages: ["zh-CN", "en"] }), ["en", "zh"]), "English vendor page, Chinese browser, reads both");
check(same(authLanguages({ factory: true, zhPage: false, browserLanguages: ["en-US"] }), ["en"]), "English vendor page, English browser");
check(same(authLanguages({ factory: false, zhPage: false, browserLanguages: ["zh-CN"] }), ["en"]), "brand page stays English");
check(same(authLanguages({ factory: true, zhPage: false, browserLanguages: ["zu"] }), ["en"]), "another language starting with z is not Chinese");

check(authErrorLines(new Error("Something else"), ["zh"]) === null, "an error with no kind keeps its own words");
check(authErrorLines(authFailure("short_password", { min: 8 }), ["zh"])[0].includes("8"), "the minimum reaches the sentence");

if (failures) {
  console.error(`check:auth-messages failed: ${failures}`);
  process.exit(1);
}
console.log("check:auth-messages passed");
