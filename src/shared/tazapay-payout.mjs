/**
 * Which factory bank accounts Tazapay pays, and whether one has everything a
 * Tazapay payout needs. One place for both, read by the server before it calls
 * Tazapay (api/ loads it with import()) and, later, by the factory's form and
 * the staff board.
 *
 * Tazapay pays the two places Stripe Connect cannot reach for TSC's factories:
 *   CN: CNY to a mainland bank over CNAPS.
 *   HK: HKD to a Hong Kong bank over CHATS (the cheaper of its two local networks
 *       in the sandbox; FPS refused a business payee).
 * Every payout is PYR031, "Advance payments for goods", with an invoice: a
 * production payment comes before anything ships, and the goods route (PYR022)
 * needs a tracking number.
 *
 * What each country needs is what Tazapay's corridor metadata asked for in the
 * sandbox (GET /v3/metadata/payout/bank) plus what its payee needs to be made
 * (an address), checked here before Tazapay is ever called, since Tazapay
 * accepts an incomplete payee and only refuses the payout.
 *
 * Fields are the columns of factory_payout_accounts. The database checks their
 * format too (migration 20261115600000); this says what is missing for a payout.
 * The full account number never reaches this file: `number_changed_at` says
 * whether one is stored.
 */
import { normaliseRegistrationNumber, registrationNumberProblem } from "./registration-number.mjs";

export const TAZAPAY_ROUTES = Object.freeze({
  CN: Object.freeze({ country: "CN", currency: "CNY", type: "local", network: "cnaps", purpose: "PYR031" }),
  HK: Object.freeze({ country: "HK", currency: "HKD", type: "local", network: "chats", purpose: "PYR031" }),
});

/** The route Tazapay would pay this account by, or null when Tazapay doesn't pay it. */
/**
 * Tazapay's usual fee per payout, in US cents, from its sandbox quotes
 * (Nov 16): the board's "too small" check before any quote. What the factory
 * is charged is the fixed placeholder in src/shared/withdrawal-fees.mjs (from
 * 2026-11-17), which withdrawalFee() applies whatever figure is passed.
 */
export const TAZAPAY_TYPICAL_FEE_CENTS = Object.freeze({ CN: 544, HK: 323 });

/**
 * The database's tazapay_pays_account(): a bank account in mainland China or
 * Hong Kong with no Wise recipient. Tazapay pays it.
 */
export const tazapayPaysAccount = (account) => account?.method === "bank" && !account.wise_recipient_type
  && ["CN", "HK"].includes(String(account.bank_country ?? "").trim().toUpperCase());

/**
 * The database's withdrawal_provider_for() (20261117510000): the provider that
 * pays a saved method. The factory's Withdraw dialog and the staff board's
 * "changed where it is paid" check both read it.
 */
export const withdrawalProviderFor = (account) => (account?.method === "paypal" ? "paypal"
  : account?.method === "bank" && account.wise_recipient_type ? "wise"
  : tazapayPaysAccount(account) ? "tazapay"
  : account?.method === "bank" ? "bank" : null);

export function tazapayRoute(account) {
  if (!account || account.method !== "bank") return null;
  return TAZAPAY_ROUTES[String(account.bank_country ?? "").trim().toUpperCase()] ?? null;
}

const text = (value) => String(value ?? "").trim();
// The database's payout_name_is_latin(): printable ASCII and Latin letters with accents, and a letter.
const isLatinName = (value) => /^[\x20-\x7EÀ-ɏ’]+$/.test(value) && /[A-Za-zÀ-ɏ]/.test(value);
const hasChinese = (value) => /[㐀-鿿]/.test(value);
const isSwift = (value) => /^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(value.replace(/\s/g, "").toUpperCase());

/**
 * What stops Tazapay paying this account, as [{ field, problem }], in the order
 * a form shows them. Empty when it can be paid. Problems:
 *   missing, not_latin (the English name), not_chinese (the Chinese name),
 *   format, check_digit, old_number (a pre-2017 Chinese number), and
 *   not_the_company (a registration number other than the company's own: the
 *   account must be the company's, not an owner's or an agent's).
 * `companyRegistration` is the company's verified number, when there is one.
 */
export function tazapayDetailsProblems(account, { companyRegistration = null, registrationKnown = false } = {}) {
  const route = tazapayRoute(account);
  if (!route) return [{ field: "bank_country", problem: "not_tazapay" }];
  const problems = [];
  const need = (field, problem) => problems.push({ field, problem });
  const country = route.country;

  const name = text(account.account_name);
  if (!name) need("account_name", "missing");
  else if (!isLatinName(name)) need("account_name", "not_latin");

  const local = text(account.holder_name_local);
  if (!local) { if (country === "CN") need("holder_name_local", "missing"); }
  else if (!hasChinese(local) || local.length < 2 || local.length > 140) need("holder_name_local", "not_chinese");

  const registration = text(account.registration_number);
  if (!registration) {
    if (country === "CN") need("registration_number", "missing");
  } else {
    const problem = registrationNumberProblem(country, registration);
    if (problem) need("registration_number", problem === "missing" ? "format" : problem);
    // The payout needs the company's own registration on file to match (tazapay_account_check).
    else if (country === "CN" && registrationKnown && !companyRegistration) need("registration_number", "not_on_file");
    else if (companyRegistration
      && normaliseRegistrationNumber(country, companyRegistration) !== normaliseRegistrationNumber(country, registration)) {
      need("registration_number", "not_the_company");
    }
  }

  if (!text(account.bank_name)) need("bank_name", "missing");
  if (!account.number_changed_at) need("full_number", "missing");

  const code = text(account.bank_code);
  if (country === "HK") {
    if (!code) need("bank_code", "missing");
    else if (!/^\d{3}$/.test(code)) need("bank_code", "format");
  } else if (code && !/^\d{12}$/.test(code)) {
    need("bank_code", "format");
  }

  const swift = text(account.swift);
  if (!swift) { if (country === "HK") need("swift", "missing"); }
  else if (!isSwift(swift)) need("swift", "format");

  if (!text(account.address_line1)) need("address_line1", "missing");
  if (!text(account.address_city)) need("address_city", "missing");
  // Hong Kong has no postcodes; its district or region is what Tazapay's `state` takes.
  if (country === "HK" && !text(account.address_state)) need("address_state", "missing");

  return problems;
}

/** Whether Tazapay can pay this account now. */
export function tazapayCanPay(account, options) {
  return tazapayDetailsProblems(account, options).length === 0;
}

const FIELD_WORDS = {
  bank_country: "a bank in mainland China or Hong Kong",
  account_name: "the account holder's name in English",
  holder_name_local: "the account holder's Chinese name as the bank has it",
  registration_number: "the company's registration number",
  bank_name: "the bank's name",
  full_number: "the full account number",
  bank_code: "the bank code",
  swift: "the SWIFT code",
  address_line1: "the street address",
  address_city: "the city",
  address_state: "the district or province",
};
const PROBLEM_WORDS = {
  missing: "",
  not_latin: " (in English letters)",
  not_chinese: " (in Chinese characters)",
  format: " (not in the right form)",
  check_digit: " (its last character doesn't check out)",
  old_number: " (the current 18-character code, not the old 15-digit number)",
  not_the_company: " (it isn't the company's own)",
  not_on_file: " (the company has no registration on file with TSC for it to match)",
  not_tazapay: "",
};

/** One sentence for staff, in English: what the account still needs. */
export function tazapayProblemsSentence(problems) {
  if (!problems?.length) return null;
  const parts = problems.map(({ field, problem }) => `${FIELD_WORDS[field] ?? field}${PROBLEM_WORDS[problem] ?? ""}`);
  return `Tazapay can't pay this account yet. It needs ${parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0]}.`;
}
