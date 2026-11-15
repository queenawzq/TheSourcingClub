/**
 * Which factory accounts Tazapay pays, and what stops a payout, before Tazapay
 * is ever called (src/shared/tazapay-payout.mjs). No stack, no keys. What the
 * database refuses is in supabase/tests/tazapay_payout_details_test.sql.
 *
 * The evasions, written before the code: a Stripe country routed to Tazapay; a
 * PayPal or Payoneer row routed; a lower-case or padded country missed; a
 * Chinese name that is only pinyin; an English name in Chinese; a USCC with a
 * bad check character, the old 15-digit number, or another company's number;
 * a HK account with no bank code; a CNAPS code where the HK bank code goes; an
 * account with no full number on file; a HK address with no district.
 */
import assert from "node:assert/strict";
import { PAYOUT_COUNTRIES } from "../src/shared/stripe-payout-countries.mjs";
import { usccCheckChar } from "../src/shared/registration-number.mjs";
import {
  TAZAPAY_ROUTES, tazapayCanPay, tazapayDetailsProblems, tazapayProblemsSentence, tazapayRoute,
} from "../src/shared/tazapay-payout.mjs";

const uscc = (first17) => first17 + usccCheckChar(first17);
const USCC = uscc("91440300MA5G8X2Q7");
const OTHER_USCC = uscc("91330200MA2AB1234");
const badCheck = USCC.slice(0, 17) + (USCC[17] === "0" ? "1" : "0");

const CN = {
  method: "bank", bank_country: "CN", account_name: "Shenzhen Hengda Garment Co., Ltd.",
  holder_name_local: "深圳市恒达服装制造有限公司", registration_number: USCC,
  bank_name: "Bank of China", number_changed_at: "2026-11-15T00:00:00Z",
  address_line1: "88 Bantian Industrial Road", address_city: "Shenzhen", address_state: "Guangdong",
};
const HK = {
  method: "bank", bank_country: "HK", account_name: "Kowloon Knitwear Trading Limited",
  bank_name: "HSBC", number_changed_at: "2026-11-15T00:00:00Z", bank_code: "004", swift: "HSBCHKHH",
  address_line1: "Unit 12, 8/F, 45 Hung To Road", address_city: "Kwun Tong", address_state: "Kowloon",
};
const fields = (account, options) => tazapayDetailsProblems(account, options).map((p) => `${p.field}:${p.problem}`);

// --- Routing: CN and HK bank accounts, nothing else ---------------------------
assert.deepEqual(tazapayRoute(CN), TAZAPAY_ROUTES.CN, "a mainland bank goes to Tazapay");
assert.equal(tazapayRoute(CN).network, "cnaps");
assert.equal(tazapayRoute(CN).purpose, "PYR031", "a production payment is an advance payment for goods");
assert.deepEqual(tazapayRoute(HK), TAZAPAY_ROUTES.HK, "a Hong Kong bank goes to Tazapay");
assert.equal(tazapayRoute(HK).network, "chats");
assert.equal(tazapayRoute({ ...CN, bank_country: " cn " })?.country, "CN", "a lower-case or padded country is still China");
for (const country of ["TW", "MO", "US", "TR", "", null]) assert.equal(tazapayRoute({ ...CN, bank_country: country }), null, `${country} is not Tazapay's`);
for (const country of PAYOUT_COUNTRIES) assert.equal(tazapayRoute({ ...CN, bank_country: country }), null, `${country}: Stripe pays it`);
for (const method of ["paypal", "payoneer", undefined]) assert.equal(tazapayRoute({ ...CN, method }), null, `a ${method} row is not a bank`);
assert.equal(tazapayRoute(null), null);
assert.deepEqual(fields({ ...CN, bank_country: "TW" }), ["bank_country:not_tazapay"], "an account Tazapay doesn't pay says so, and only that");

// --- China ---------------------------------------------------------------------
assert.deepEqual(fields(CN), [], "a complete mainland account can be paid");
assert.equal(tazapayCanPay(CN), true);
assert.deepEqual(fields(CN, { companyRegistration: USCC.toLowerCase() }), [], "the company's own number, however it was typed");
assert.deepEqual(fields({ ...CN, bank_code: "104100000004", swift: "BKCHCNBJ" }), [], "a CNAPS code and SWIFT are welcome but not needed");
assert.deepEqual(fields({ ...CN, holder_name_local: "" }), ["holder_name_local:missing"], "China needs the Chinese name");
assert.deepEqual(fields({ ...CN, holder_name_local: "Shenzhen Hengda" }), ["holder_name_local:not_chinese"], "pinyin is not the Chinese name");
assert.deepEqual(fields({ ...CN, holder_name_local: "深" }), ["holder_name_local:not_chinese"], "one character is not a company name");
assert.deepEqual(fields({ ...CN, account_name: "深圳市恒达服装制造有限公司" }), ["account_name:not_latin"], "the English name must be in English letters");
assert.deepEqual(fields({ ...CN, account_name: "  " }), ["account_name:missing"]);
assert.deepEqual(fields({ ...CN, registration_number: "" }), ["registration_number:missing"], "China needs the USCC");
assert.deepEqual(fields({ ...CN, registration_number: badCheck }), ["registration_number:check_digit"], "a USCC that doesn't check out is refused, not confirmed: it would pay another company");
assert.deepEqual(fields({ ...CN, registration_number: "440301103425421" }), ["registration_number:old_number"], "the pre-2017 number is refused");
assert.deepEqual(fields({ ...CN, registration_number: "ABC" }), ["registration_number:format"]);
assert.deepEqual(fields(CN, { companyRegistration: OTHER_USCC }), ["registration_number:not_the_company"], "an account in another company's name is refused");
assert.deepEqual(fields({ ...CN, bank_code: "004" }), ["bank_code:format"], "a HK bank code is not a CNAPS code");
assert.deepEqual(fields({ ...CN, swift: "BKCH" }), ["swift:format"]);
assert.deepEqual(fields({ ...CN, number_changed_at: null }), ["full_number:missing"], "no full number on file, nothing to pay");
assert.deepEqual(fields({ ...CN, bank_name: "" }), ["bank_name:missing"]);
assert.deepEqual(fields({ ...CN, address_line1: "", address_city: "" }), ["address_line1:missing", "address_city:missing"], "Tazapay's payee needs an address");
assert.deepEqual(fields({ ...CN, address_state: "" }), [], "a mainland province is optional");

// --- Hong Kong -------------------------------------------------------------------
assert.deepEqual(fields(HK), [], "a complete Hong Kong account can be paid");
assert.deepEqual(fields({ ...HK, holder_name_local: "九龍針織貿易有限公司", registration_number: "31234567" }), [], "a Chinese name and BR number are welcome");
assert.deepEqual(fields({ ...HK, bank_code: "" }), ["bank_code:missing"], "Hong Kong needs the bank code");
assert.deepEqual(fields({ ...HK, bank_code: "104100000004" }), ["bank_code:format"], "a CNAPS code is not a HK bank code");
assert.deepEqual(fields({ ...HK, swift: "" }), ["swift:missing"], "Hong Kong needs the SWIFT code");
assert.deepEqual(fields({ ...HK, address_state: "" }), ["address_state:missing"], "and the district");
assert.deepEqual(fields({ ...HK, holder_name_local: "Kowloon" }), ["holder_name_local:not_chinese"], "an optional Chinese name must still be Chinese");

// --- The sentence staff read ----------------------------------------------------
assert.equal(tazapayProblemsSentence([]), null);
assert.equal(
  tazapayProblemsSentence(tazapayDetailsProblems({ ...CN, holder_name_local: "", registration_number: badCheck })),
  "Tazapay can't pay this account yet. It needs the account holder's Chinese name as the bank has it and the company's registration number (its last character doesn't check out).",
);
assert(!/\d{5,}/.test(tazapayProblemsSentence(tazapayDetailsProblems({ ...CN, registration_number: badCheck }))), "the sentence never repeats a number");

console.log("check:tazapay ok");
