/**
 * What a bank wire needs for a factory's country, on the form staff pay from.
 * Labels only: every country stores the same columns. An IBAN country's number
 * is checked as an IBAN, in the database too.
 */
import { PAYOUT_COUNTRIES } from "./stripe-payout-countries.mjs";

const IBAN_COUNTRIES = new Set([...PAYOUT_COUNTRIES].filter((code) => !["US", "CA"].includes(code)).concat(["TR", "PK", "EG"]));

const BRANCH = {
  CN: { label: "Branch name and CNAPS code", placeholder: "The branch that holds the account, and its 12-digit code", required: true },
  HK: { label: "Bank code and branch code", placeholder: "3 digits and 3 digits", required: true },
  IN: { label: "IFSC code", placeholder: "11 characters", required: true },
  TW: { label: "Bank and branch code", placeholder: "Your bank's code and branch" },
};

export function bankFieldsFor(country) {
  const iban = IBAN_COUNTRIES.has(country);
  return {
    numberKind: iban ? "iban" : "account",
    numberLabel: iban ? "IBAN" : "Full account number",
    branch: BRANCH[country] ?? { label: "Branch or routing code", placeholder: "If your bank uses one" },
  };
}

/** The form of the database's check: letters and digits, spaces and hyphens ignored. */
export const normalBankNumber = (value) => (value ?? "").replace(/[\s-]/g, "").toUpperCase();
export const validBankNumber = (value) => {
  const number = normalBankNumber(value);
  return /^[A-Z0-9]{5,34}$/.test(number) && number.replace(/\D/g, "").length >= 4;
};
export const validSwift = (value) => /^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test((value ?? "").replace(/\s/g, "").toUpperCase());
